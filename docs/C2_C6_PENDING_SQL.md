# C2 + C6 — คำสั่งที่เตรียมไว้ รอยืนยันก่อนรัน

> **สถานะ: ยังไม่ได้รันกับฐานข้อมูลจริง** — ทั้งสองข้อเป็นการแก้ข้อมูล production
> ผู้รันคือทีม IT เท่านั้น

---

## C2 · ปิดเคส 6 เหตุการณ์ตายค้าง

### ตรวจแล้วพบว่าไม่มีการจองซ้ำเลย — E-2 ปิดได้

เดิมผมตั้งข้อสงสัยว่ามี 2 งานที่อาจจองซ้ำ **ผิด** ตรวจจริงแล้วได้ผลดังนี้

```sql
-- นัดที่มี ext_ref ซ้ำกันเป๊ะ ๆ (คือการจองซ้ำจริง)
select ext_ref, count(*) from appointments
where ext_ref is not null group by 1 having count(*) > 1;
-- ผลลัพธ์: 0 แถว
```

ที่เห็นว่า "งานเดียวมีหลายนัด" เป็นพฤติกรรมที่ถูกต้อง เพราะ `ext_ref` ผูกกับ
**หนึ่งวันติดตั้ง** (`bbps:{id}:{date}`) งานที่กินเวลา 7 วันจึงมี 7 นัดโดยตั้งใจ
และรายการที่มีสถานะ `cancelled` ปนอยู่คือการเลื่อนวัน ไม่ใช่ของซ้ำ

**สรุป** ไม่ต้องรบกวนหัวหน้าช่างให้ตรวจ · ไม่มีข้อมูลเสียหายจาก 6 เหตุการณ์ที่ตาย

### คำสั่งปิดเคส

```sql
-- ทำเครื่องหมายว่าตรวจแล้วและตัดสินใจไม่ยิงซ้ำ — ไม่ลบ เพื่อเก็บประวัติไว้
update public.outbox_events
set last_error = 'ปิดเคส 2026-09: ปลายทางมีนัดครบแล้ว ไม่มี ext_ref ซ้ำ '
              || 'จึงไม่ยิงซ้ำ (สาเหตุเดิม: permission denied for table install_jobs แก้แล้ว)'
where status = 'dead'
  and event_type = 'floor.job.sync.v1';
-- คาดหวัง: UPDATE 6
```

**ตรวจหลังรัน**

```sql
select status, count(*) from public.outbox_events group by 1;
-- คาดหวัง: delivered 15 · dead 6 (เท่าเดิม แต่มีคำอธิบายกำกับแล้ว)
```

**ย้อนกลับ** `update public.outbox_events set last_error = null where status = 'dead';`

---

## C6 · รวมค่าสถานะ `done` เข้ากับ `เสร็จสิ้น`

### หลักฐาน

```sql
select status, count(*) from install_jobs group by 1 order by 2 desc;
```

| สถานะ | จำนวน |
|---|---|
| `Active` | 39 |
| `รอใส่ข้อมูล` | 37 |
| **`เสร็จสิ้น`** | **12** |
| **`done`** | **10** |
| `ยกเลิกคิว` | 6 |
| ... อีก 11 ค่า | |

รวม 16 ค่าที่ต่างกัน โดย `เสร็จสิ้น` กับ `done` มีความหมายเดียวกัน

### ตรวจโค้ดก่อนแล้ว — ปลอดภัย

ไล่ทั้งสอง repo แล้ว **ไม่มีที่ไหนเทียบ `install_jobs.status` กับสตริง `'done'`**
ค่าที่เจอเป็นของคนละเรื่อง (`StageStatus` ของงานเอกสาร · `design_tasks_bbps.status`)
ดังนั้นการรวมค่าจะไม่ทำให้ตรรกะไหนพัง

### ขั้นที่ 1 — รวมค่า (รันได้เลยหลังอนุมัติ)

```sql
begin;

-- เก็บสำเนาไว้ก่อน เผื่อต้องย้อน
create table if not exists public._backup_install_jobs_status_20260908 as
select job_no, status from public.install_jobs where status = 'done';

update public.install_jobs
set status = 'เสร็จสิ้น', updated_at = now()
where status = 'done';
-- คาดหวัง: UPDATE 10

commit;
```

**ตรวจหลังรัน**

```sql
select count(*) from public.install_jobs where status = 'done';        -- คาดหวัง 0
select count(*) from public.install_jobs where status = 'เสร็จสิ้น';   -- คาดหวัง 22
select count(*) from public.v_crm_completed_installations;             -- คาดหวัง 22 (เท่าเดิม)
```

**ย้อนกลับ**

```sql
update public.install_jobs j set status = 'done'
from public._backup_install_jobs_status_20260908 b
where j.job_no = b.job_no;
```

### ขั้นที่ 2 — ล็อกไม่ให้มีค่าใหม่หลุดเข้ามา (**รอ E-3**)

ต้องให้หัวหน้าช่างและหัวหน้าผลิตยืนยันรายการค่าที่ถูกต้องก่อน จึงยังไม่เขียนเงื่อนไขจริง

```sql
-- ตัวอย่างโครง — เติมรายการค่าที่ตกลงกันแล้วก่อนรัน
-- alter table public.install_jobs
--   add constraint install_jobs_status_check
--   check (status in (
--     'รอใส่ข้อมูล', 'รอฝ่ายขายเติมข้อมูล', 'Active', 'จองคิวติดตั้ง',
--     'รอหัวหน้าช่างยืนยัน', 'ยืนยันคิวแล้ว', 'รอคลังรับงาน',
--     'กำลังเตรียมสินค้า', 'รอติดตั้ง', 'กำลังติดตั้ง', 'รอ CS โทรประเมิน',
--     'เสร็จสิ้น', 'ยกเลิกคิว', 'ส่งกลับฝ่ายขายแก้ไข', 'ส่งกลับ BBPS แก้ไข'
--   ));
```

**คำถามที่ต้องถามก่อนใส่เงื่อนไข**
1. 15 ค่าข้างบนครบหรือยัง มีสถานะไหนที่ใช้อยู่แต่ยังไม่มีงานในระบบตอนนี้
2. `Active` หมายถึงอะไร ต่างจาก `รอติดตั้ง` อย่างไร — ชื่อเดียวที่เป็นภาษาอังกฤษ น่าจะเป็นค่าตกค้างจากการนำเข้าข้อมูลเก่า
3. ถ้าต้องเพิ่มสถานะใหม่ในอนาคต ใครเป็นคนอนุมัติ

### เมื่อ C6 ขั้นที่ 1 รันแล้ว

แก้วิว `v_crm_completed_installations` ให้เหลือเงื่อนไขค่าเดียว

```sql
create or replace view public.v_crm_completed_installations as
select ... from public.install_jobs j where j.status = 'เสร็จสิ้น';
```

---

## ลำดับที่แนะนำ

1. Merge PR `fix/job-monitoring` (C0)
2. Merge PR `feat/installations-completed-followup` (C3) แล้วรัน migration ของวิว
3. รัน C2 — ไม่ต้องรอใคร ตรวจครบแล้ว
4. Merge PR `feat/flush-pending-chat` (C4)
5. รัน C6 ขั้นที่ 1 — ไม่ต้องรอใคร ตรวจโค้ดแล้ว
6. C6 ขั้นที่ 2 รอคำตอบ E-3 จากหัวหน้าช่าง

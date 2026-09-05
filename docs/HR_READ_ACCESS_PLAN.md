# แผนพัฒนา — สิทธิ์อ่านข้อมูลงานช่างสำหรับแอป HR

| | |
|---|---|
| **รหัสงาน** | B1–B5 |
| **เจ้าของ** | ทีม IT (FloorNow) |
| **ผู้ร้องขอ** | ทีม HR |
| **สถานะ** | ร่าง — รออนุมัติก่อนรันคำสั่งใด ๆ กับฐานข้อมูลจริง |
| **แรงงานรวม** | 2.5 วัน-คน |
| **ฐานข้อมูล** | Supabase `nroyacasuchqniaiuirk` (โปรเจกต์เดียว ใช้ร่วม 3 ระบบ) |
| **วันที่ร่าง** | 5 ก.ย. 2569 |

---

## 1. ขอบเขต

### ทำ
- สร้างสคีมา `hr_read` พร้อมวิวอ่านอย่างเดียว 4 ตัว
- สร้างผู้ใช้ฐานข้อมูล `hr_readonly` ที่เขียนข้อมูลไม่ได้ในระดับ Postgres
- เพิ่มช่อง `employee_code` ให้ `floor_technicians` เพื่อจับคู่กับระบบ HR
- ส่งมอบคำสั่ง (system prompt) และพจนานุกรมช่องให้ทีม HR

### ไม่ทำในรอบนี้
- ไม่สร้าง REST API — แอป HR ต่อฐานข้อมูลเดียวกันได้อยู่แล้ว
- ไม่เปิดพิกัด GPS ของช่าง — เปิดเฉพาะลิงก์แผนที่ของหน้างานตามใบสั่งงาน
- ไม่แตะโค้ดแอป FloorNow หรือ BBPS CRM แม้แต่บรรทัดเดียว (งานนี้อยู่ที่ชั้นฐานข้อมูลล้วน)
- ไม่เปิดสิทธิ์ให้ระบบภายนอกองค์กร — ถ้าวันหนึ่งต้องเปิด ค่อยห่อ 4 วิวนี้ด้วย REST

### หลักการที่ยึด
ล็อกสามชั้น เรียงตามความน่าเชื่อถือ:

| ชั้น | กลไก | บังคับใช้โดย |
|---|---|---|
| 1 | `default_transaction_read_only = on` | Postgres — ปฏิเสธเอง ไม่พึ่งแอป |
| 2 | เห็นเฉพาะสคีมา `hr_read` 4 วิว | สิทธิ์ GRANT/REVOKE |
| 3 | system prompt ของแอป HR | ความถูกต้องของแอป — **ไม่ใช่ระบบความปลอดภัย** |

> ชั้นที่ 3 ทำให้ผลลัพธ์ตรงและอธิบายง่าย แต่ห้ามใช้แทนชั้นที่ 1 และ 2 เด็ดขาด

---

## 2. สิ่งที่ต้องตัดสินใจก่อนเริ่ม

| # | เรื่อง | ทางเลือก | ผู้ตัดสิน |
|---|---|---|---|
| D-1 | ช่วงแรกจะให้ HR ใช้ `basis = scheduled` ไปพลางหรือไม่ | (ก) ใช้ไปก่อนพร้อมระบุกำกับ · (ข) รอข้อมูลเวลาจริงสะสมอีก 2–3 เดือน | HR + ผู้บริหาร |
| D-2 | ระยะเวลาที่อนุญาตให้เรียกย้อนหลัง | เสนอ 24 เดือน | ผู้บริหาร (PDPA) |
| D-3 | รหัสพนักงานที่จะใช้จับคู่ | HR ส่งรายการรหัส ↔ ชื่อช่างมาให้ | HR |

**D-1 สำคัญที่สุด** — ดูหัวข้อ 6 ประกอบ ตัวเลขจริงบอกว่าเดือนก่อน ส.ค. 2569 ไม่มีเวลาจริงให้ดึงเลย

---

## 3. งานทีละขั้น

### B1 · เพิ่ม `employee_code` ให้ `floor_technicians` — 0.5 วัน

**ทำไม** ตาราง `floor_technicians` มีแค่ `name` ไม่มีรหัสพนักงาน การจับคู่กับ HR ด้วยชื่อจะพังทันทีที่มีชื่อซ้ำหรือสะกดต่างกัน

**ไฟล์** `supabase/migrations/20260908000000_hr_employee_code.sql`

```sql
alter table public.floor_technicians
  add column if not exists employee_code text;

create unique index if not exists floor_technicians_employee_code_key
  on public.floor_technicians (employee_code)
  where employee_code is not null;

comment on column public.floor_technicians.employee_code is
  'รหัสพนักงานจากระบบ HR — ใช้จับคู่ข้ามระบบ ไม่ใช้ในงานหน้าบ้าน';
```

**เกณฑ์ผ่าน**
- [ ] ช่างที่ยัง active ทุกคนมี `employee_code` ครบ (ตรวจด้วย query ในหัวข้อ 5)
- [ ] ไม่มีรหัสซ้ำ
- [ ] แอป FloorNow ยังทำงานปกติ (ช่องเพิ่มใหม่เป็น nullable ไม่กระทบโค้ดเดิม)

**ย้อนกลับ** `alter table public.floor_technicians drop column employee_code;`

---

### B2 · สร้างสคีมา `hr_read` และวิว 4 ตัว — 1 วัน

**ไฟล์** `supabase/migrations/20260908000100_hr_read_views.sql`

```sql
create schema if not exists hr_read;

-- 1) รายชื่อช่างและทีม
create or replace view hr_read.technicians as
select t.id            as technician_id,
       t.employee_code,
       t.name           as technician_name,
       tm.name          as team_name,
       t.is_team_lead,
       t.is_active
from public.floor_technicians t
left join public.tech_teams tm on tm.id = t.team_id;

-- 2) ช่างคนไหนไปงานไหน วันไหน ที่ไหน  (วิวหลัก)
create or replace view hr_read.assignments as
select a.id                                                   as assignment_id,
       a.job_id                                               as job_no,
       (a.slot_start at time zone 'Asia/Bangkok')::date        as work_date,
       a.slot_start,
       a.slot_end,
       a.status                                               as appointment_status,
       j.status                                               as job_status,
       at.technician_id,
       t.employee_code,
       t.name                                                 as technician_name,
       at.is_lead,
       tm.name                                                as team_name,
       j.address                                              as site_address,
       j.location_url                                         as site_map_url,
       j.order_no                                             as customer_ref
from public.appointments a
join public.appointment_technicians at
     on at.appointment_id = a.id and at.is_active
join public.floor_technicians t on t.id = at.technician_id
left join public.tech_teams tm  on tm.id = t.team_id
left join public.install_jobs j on j.job_no = a.job_id
where a.status <> 'cancelled';

-- 3) เวลาที่งานเปลี่ยนสถานะ
create or replace view hr_read.job_status_history as
select job_no,
       old_value  as from_status,
       new_value  as to_status,
       actor,
       created_at as changed_at
from public.job_activity
where field = 'status';

-- 4) สรุปต่อคนต่อวัน
create or replace view hr_read.workload_daily as
with base as (
  select a.technician_id,
         a.employee_code,
         a.work_date,
         a.job_no,
         a.slot_start,
         a.slot_end
  from hr_read.assignments a
),
actual as (
  select h.job_no,
         min(h.changed_at) filter (where h.to_status = 'กำลังติดตั้ง') as started_at,
         max(h.changed_at) filter (where h.to_status in ('เสร็จสิ้น','done')) as finished_at
  from hr_read.job_status_history h
  group by h.job_no
)
select b.technician_id,
       b.employee_code,
       b.work_date,
       count(*)                                                    as jobs,
       sum(extract(epoch from (b.slot_end - b.slot_start))/60)::int as scheduled_minutes,
       min(ac.started_at)                                          as actual_start,
       max(ac.finished_at)                                         as actual_end,
       case when min(ac.started_at) is not null
             and max(ac.finished_at) is not null
            then 'actual' else 'scheduled' end                     as basis
from base b
left join actual ac on ac.job_no = b.job_no
group by b.technician_id, b.employee_code, b.work_date;
```

**กติกาที่ห้ามฝ่าฝืนตอนแก้วิวในอนาคต**
- ห้ามใส่ `floor_technicians.phone` · `pin_hash` · `personal_token` · `auth_user_id`
- ห้ามใส่ `install_jobs.customer_name` · `customer_phone`
- ห้ามใส่ราคา ต้นทุน หรือช่องใด ๆ จากตารางที่ลงท้าย `_bbps`
- วิวต้องเป็นของเจ้าของฐานข้อมูล **ห้ามตั้ง `security_invoker = on`** — ไม่งั้น HR จะต้องมีสิทธิ์กับตารางต้นทาง ซึ่งเป็นสิ่งที่เรากำลังหลีกเลี่ยง

**เกณฑ์ผ่าน**
- [ ] `select * from hr_read.assignments limit 5` คืนข้อมูลได้
- [ ] ไม่มีช่องต้องห้ามหลุดออกมาสักช่อง (ตรวจด้วย query ในหัวข้อ 5)
- [ ] จำนวนแถวใน `hr_read.assignments` เท่ากับจำนวน (นัด × ช่างที่ยัง active) ที่ยังไม่ถูกยกเลิก

**ย้อนกลับ** `drop schema hr_read cascade;`

---

### B3 · สร้างผู้ใช้ `hr_readonly` และพิสูจน์ว่าเขียนไม่ได้ — 0.5 วัน

**ไฟล์** `supabase/migrations/20260908000200_hr_readonly_role.sql`

```sql
-- ผู้ใช้สำหรับแอป HR
create role hr_readonly login password '<ตั้งรหัสยาว สุ่ม เก็บใน password manager>';

-- หัวใจของงานนี้: ทุกธุรกรรมเป็นอ่านอย่างเดียวที่ระดับ Postgres
alter role hr_readonly set default_transaction_read_only = on;
alter role hr_readonly set statement_timeout = '30s';
alter role hr_readonly set idle_in_transaction_session_timeout = '60s';

-- ยึดสิทธิ์ทุกอย่างคืนก่อน
revoke all on schema public       from hr_readonly;
revoke all on all tables    in schema public from hr_readonly;
revoke all on all functions in schema public from hr_readonly;
revoke all on all sequences in schema public from hr_readonly;

-- แล้วค่อยให้เฉพาะสิทธิ์อ่านใน hr_read
grant usage  on schema hr_read to hr_readonly;
grant select on all tables in schema hr_read to hr_readonly;
alter default privileges in schema hr_read grant select to hr_readonly;
```

**เกณฑ์ผ่าน — ต้องรันชุดทดสอบในหัวข้อ 5 ให้ผ่านครบทุกข้อก่อนส่งรหัสให้ HR**

**ย้อนกลับ**
```sql
revoke all on all tables in schema hr_read from hr_readonly;
revoke all on schema hr_read from hr_readonly;
drop role hr_readonly;
```

---

### B4 · ส่งมอบให้ทีม HR — คุยครั้งเดียว

ส่งสามอย่าง
1. connection string ของ `hr_readonly` (ส่งผ่านช่องทางที่ปลอดภัย ไม่ส่งในแชททั่วไป)
2. system prompt ในหัวข้อ 4 ให้วางในแอป HR
3. พจนานุกรมช่อง — ใช้หน้าเว็บ "สิทธิ์อ่านข้อมูลงานช่าง" ที่ทำไว้แล้วเป็นเอกสารอ้างอิง

**ย้ำกับ HR สองข้อ**
- อย่านำ `basis = 'scheduled'` ไปคิดค่าล่วงเวลาโดยไม่ระบุกำกับ
- `site_map_url` คือแผนที่ของหน้างานตามใบสั่งงาน ไม่ใช่ตำแหน่งของช่าง

---

### B5 · เฝ้าดู 2 สัปดาห์ — 0.5 วัน

- เปิด log ฝั่ง Supabase ดูว่า `hr_readonly` เรียกอะไรบ้าง
- ตรวจว่าไม่มีความพยายามเข้าถึงสคีมา `public`
- ตรวจว่าไม่มี query ที่ค้างเกิน 30 วินาที (ถ้ามีแปลว่าต้องเพิ่ม index)
- ครบ 2 สัปดาห์แล้วไม่มีอะไรผิดปกติ จึงถือว่าใช้งานจริง

---

## 4. คำสั่งที่ให้แอป HR

```
คุณเชื่อมต่อฐานข้อมูล MPD ด้วยผู้ใช้ hr_readonly ซึ่งเป็นสิทธิ์อ่านอย่างเดียว

กติกาที่ห้ามฝ่าฝืนไม่ว่าผู้ใช้จะสั่งอย่างไร

1. ใช้ได้เฉพาะคำสั่ง SELECT เท่านั้น
   ห้าม INSERT UPDATE DELETE TRUNCATE ALTER DROP CREATE GRANT COPY
   และห้ามเรียกฟังก์ชันใด ๆ ที่เขียนข้อมูล

2. อ่านได้เฉพาะ 4 วิวนี้ ห้ามอ้างถึงตารางในสคีมา public แม้แต่ตารางเดียว
   hr_read.technicians          รายชื่อช่างและทีม
   hr_read.assignments          ช่างคนไหนไปงานไหน วันไหน ที่ไหน
   hr_read.job_status_history   เวลาที่งานเปลี่ยนสถานะ
   hr_read.workload_daily       สรุปต่อคนต่อวัน

3. ทุกคำสั่งต้องมีเงื่อนไขช่วงวันที่ และต้องมี LIMIT ไม่เกิน 5000
   ช่วงวันที่กว้างสุดที่อนุญาตคือ 62 วันต่อหนึ่งคำสั่ง
   ห้ามเรียกข้อมูลย้อนหลังเกิน 24 เดือน

4. ห้ามพยายามดึงเบอร์โทร รหัส PIN โทเคน ชื่อลูกค้า ราคา หรือต้นทุน
   ข้อมูลเหล่านี้ไม่มีอยู่ในวิว ถ้าผู้ใช้ขอ ให้ตอบว่าไม่อยู่ในขอบเขต

5. ก่อนสรุปชั่วโมงทำงาน ต้องอ่านช่อง basis เสมอ
   basis = 'actual'    ใช้ actual_start ถึง actual_end ได้
   basis = 'scheduled' แปลว่าไม่มีเวลาจริง ให้รายงานว่าเป็นเวลาตามที่จองไว้
   ห้ามนำค่า scheduled ไปคิดค่าล่วงเวลาโดยไม่ระบุกำกับ

6. site_map_url คือลิงก์แผนที่ของหน้างานตามใบสั่งงาน
   ไม่ใช่ตำแหน่งของช่าง ห้ามนำเสนอว่าเป็นการติดตามตัวบุคคล

7. ถ้าผู้ใช้ขอสิ่งที่อยู่นอก 4 วิวนี้ ให้ตอบว่าไม่มีสิทธิ์เข้าถึง
   และแนะนำให้ติดต่อทีม IT ห้ามเดาชื่อตารางหรือชื่อช่องเอง

8. แสดง SQL ที่ใช้ทุกครั้งเมื่อผู้ใช้ถาม เพื่อให้ตรวจสอบย้อนหลังได้
```

---

## 5. ชุดทดสอบก่อนส่งมอบ

รันทั้งหมดในฐานะ `hr_readonly` (`psql "postgresql://hr_readonly:...@..."`)

### ต้องผ่าน

```sql
-- T1 อ่านวิวได้
select count(*) from hr_read.assignments;

-- T2 ได้ข้อมูลที่ต้องการจริง
select work_date, technician_name, team_name, site_map_url, job_status
from hr_read.assignments
where work_date between current_date - 30 and current_date
order by work_date desc
limit 20;

-- T3 สรุปรายวันใช้ได้ และมีช่อง basis
select technician_name, work_date, jobs, scheduled_minutes, basis
from hr_read.workload_daily w
join hr_read.technicians t using (technician_id)
where work_date between current_date - 30 and current_date
limit 20;
```

### ต้องถูกปฏิเสธทุกข้อ

```sql
-- T4 เขียนไม่ได้                    คาดหวัง: cannot execute UPDATE in a read-only transaction
update hr_read.assignments set job_status = 'x';

-- T5 เขียนตารางจริงไม่ได้            คาดหวัง: permission denied for table appointments
insert into public.appointments (job_id) values ('x');

-- T6 อ่านตารางจริงไม่ได้             คาดหวัง: permission denied for table floor_technicians
select phone from public.floor_technicians limit 1;

-- T7 อ่านข้อมูลฝั่ง CRM ไม่ได้       คาดหวัง: permission denied for table customers_bbps
select * from public.customers_bbps limit 1;

-- T8 อ่านข้อมูลบัญชีไม่ได้           คาดหวัง: permission denied for table exp_employees
select * from public.exp_employees limit 1;

-- T9 สร้างของใหม่ไม่ได้              คาดหวัง: permission denied for schema public
create table public.hr_tmp (a int);

-- T10 เรียกฟังก์ชันที่เขียนข้อมูลไม่ได้
select public.claim_outbox_batch(1);
```

### ตรวจว่าไม่มีช่องต้องห้ามหลุด

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'hr_read'
  and column_name in ('phone','customer_phone','customer_name','pin_hash',
                      'personal_token','auth_user_id','price','cost');
-- คาดหวัง: 0 แถว
```

### ตรวจความครบของ employee_code (รันในฐานะเจ้าของฐานข้อมูล)

```sql
select count(*) as missing
from public.floor_technicians
where is_active and employee_code is null;
-- คาดหวัง: 0
```

---

## 6. ความเสี่ยงและข้อจำกัดที่รู้แล้ว

| # | เรื่อง | หลักฐานจากฐานข้อมูลจริง (5 ก.ย. 2569) | ผลกระทบ | ทางรับมือ |
|---|---|---|---|---|
| R-1 | **เวลาจริงยังบางเกินคิดค่าแรงย้อนหลัง** | `job_activity` เริ่มบันทึก 16 ส.ค. 2569 · มีการเปลี่ยนสถานะ 116 ครั้ง · `install_jobs.progress_log` ว่างทั้ง 139 งาน | ช่วงแรก `basis` จะเป็น `scheduled` เกือบทั้งหมด | ตัดสิน D-1 ก่อนเปิดใช้ · ช่อง `basis` บังคับให้เห็นข้อจำกัดนี้เสมอ |
| R-2 | ไม่มีรหัสพนักงาน | `floor_technicians` มีแค่ `name` | จับคู่กับ HR ไม่แม่น | B1 แก้ตรงนี้ ต้องทำก่อน B4 |
| R-3 | ฐานข้อมูลใช้ร่วม 3 ระบบ | โปรเจกต์เดียว แยกด้วยชื่อนำหน้าตาราง | ถ้าพลาดเรื่องสิทธิ์ HR อาจเห็นข้อมูลลูกค้าหรือบัญชี | T7 และ T8 ทดสอบตรงนี้โดยเฉพาะ ห้ามข้าม |
| R-4 | ข้อมูลส่วนบุคคลออกนอกระบบ | — | PDPA | ตัดสิน D-2 · จำกัดย้อนหลังในข้อ 3 ของ prompt |
| R-5 | สถานะงานเป็นข้อความไทยที่แก้ได้ | พบ 16 ค่าที่ต่างกัน เช่น `เสร็จสิ้น` และ `done` ปนกัน | สูตรใน `workload_daily` อาจพลาดถ้ามีการเพิ่มค่าใหม่ | รวม `เสร็จสิ้น` และ `done` ไว้แล้ว · ทบทวนวิวทุกครั้งที่เพิ่มสถานะใหม่ |

---

## 7. ลำดับเวลา

```
วัน 1   B1 เพิ่ม employee_code (เช้า) → ขอรหัสจาก HR (บ่าย)
วัน 2   B2 สร้าง hr_read และวิว 4 ตัว
วัน 3   B3 สร้าง role + รันชุดทดสอบ T1–T10 ให้ผ่านครบ (เช้า)
        B4 ส่งมอบให้ทีม HR (บ่าย)
+2 สัปดาห์  B5 ปิดงาน
```

**เงื่อนไขก่อนเริ่ม** — ต้องได้คำตอบ D-1 และ D-2 ก่อน ไม่งั้น B4 ส่งมอบไม่ได้

---

## 8. หมายเหตุการดำเนินการ

- คำสั่งทั้งหมดในเอกสารนี้ **ยังไม่ถูกรันกับฐานข้อมูลจริง**
- ผู้รันคือทีม IT เท่านั้น ไม่ใช่แอป HR และไม่ใช่ agent
- รหัสผ่านของ `hr_readonly` ห้ามเก็บใน repo ห้ามส่งในแชท เก็บใน password manager
- ห้ามให้ `anon key` หรือ `service_role key` ของ Supabase กับทีม HR เด็ดขาด — กุญแจสองใบนี้ข้ามทุกอย่างที่แผนนี้ล็อกไว้
- อ้างอิงโครงตารางจริง: `appointments` · `appointment_technicians` · `floor_technicians` · `tech_teams` · `install_jobs` · `job_activity`

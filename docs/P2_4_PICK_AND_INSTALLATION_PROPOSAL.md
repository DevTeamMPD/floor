# P2.4 — Pick Confirmation และ Installation Report

สถานะ: **อนุมัติและ apply migration แล้ว; template/worker รวมอยู่ในชุด deploy P2.2–P2.6**

## เป้าหมาย

ทำเอกสารคุณภาพ 2 ฉบับจากหลักฐานที่ระบบบังคับเก็บอยู่แล้ว โดยไม่ให้พนักงานกรอกข้อมูลซ้ำ และไม่แก้ business RPC เดิม

| เอกสาร | จุดเริ่ม | ข้อมูลที่ใช้ | สถานะเอกสาร |
| --- | --- | --- | --- |
| Pick Confirmation | `warehouse_completed` | จำนวนจริงของ `floor_work_order_items`, ผู้ดำเนินการ/เวลา, หมายเหตุ และ `photo_paths` จาก event | draft quality record |
| Installation Report | `field_completed` | ทีม/ช่างผู้บันทึก, เวลา, ภาพก่อนปิดงาน, หมายเหตุ และรายการวัสดุจริง | draft quality record |

## Flow

```text
คลังยืนยันการเตรียมสินค้า
  complete_floor_warehouse_order_v2()
    → floor_work_order_events.warehouse_completed
    → P2.4 trigger enqueue pick_confirmation
    → worker → HTML + SharePoint / 03-warehouse / register

ช่างกด “ติดตั้งเสร็จ”
  record_technician_work_status(... 'completed')
    → floor_work_progress_events.completed
    → existing sync → floor_work_order_events.field_completed
    → P2.4 trigger enqueue installation_report
    → worker → HTML + SharePoint / 04-installation / register
```

## หน้าตาและข้อมูลของเอกสาร

ทั้งสองฉบับใช้ controlled-document header เดียวกับ Work Order/BOQ: โลโก้ LENDI Space, ชื่อนิติบุคคล, เลขทะเบียน, ที่อยู่, รหัสเอกสาร, revision, source timestamp และ footer สำเนาควบคุม

### Pick Confirmation

1. เลขงาน/บิล/วันที่นัด/ทีมติดตั้ง
2. ผู้ยืนยันคลังและเวลาที่เสร็จ
3. ตารางเทียบ `ปริมาณแผน` กับ `ปริมาณจัดจริง` ทุกรายการ พร้อมผลต่าง
4. หมายเหตุคลัง
5. หลักฐานรูป: เก็บเป็นรายชื่อ path ใน snapshot และลิงก์ reference เท่านั้น (ไม่ฝัง URL ที่มีสิทธิ์)
6. ช่องลงชื่อผู้จัด/ผู้ตรวจคลัง/ผู้รับมอบ

### Installation Report

1. เลขงาน/ลูกค้า/สถานที่/วันนัด/ทีมติดตั้ง
2. ผู้บันทึกและเวลาติดตั้งเสร็จ
3. ตารางวัสดุจริงและขอบเขตงาน
4. บันทึกหน้างานและรายการภาพหลักฐาน
5. ช่องลงชื่อหัวหน้าทีม/ผู้ตรวจ/ลูกค้า (ลายเซ็นลูกค้าจริงเป็น Customer Acceptance ใน P2.5 จึงไม่คัดลอกมาเป็นลายเซ็นในเอกสารนี้)

## Data contract ที่ตรวจจาก schema จริง

- `warehouse_completed` ถูกสร้างใน `complete_floor_warehouse_order_v2` หลังบันทึก `actual_qty`, มี `actor_name`, `note`, `photo_paths`, และ `occurred_at`
- `field_completed` ถูกสร้างจาก `floor_work_progress_events.status='completed'` ผ่าน trigger เดิม มีช่าง, `note`, `photo_paths`, และ `occurred_at`
- ทั้งสอง action บังคับภาพหลักฐานใน RPC อยู่แล้ว จึงไม่เพิ่ม field หรือ UX การกรอกซ้ำ
- Trigger ใหม่จะอ่าน `floor_work_orders.updated_at` เป็น source version, enqueue ผ่าน helper P2.2 และไม่ call HTTP/SharePoint/render

## Guardrails

- จะไม่ enqueue `warehouse_completed` ก่อน renderer มีจริง
- ผู้ใช้ทำงานหลักได้แม้ worker/upload ล้ม; queue retry อยู่เบื้องหลัง
- เอกสารใหม่เป็น `draft`; ไม่ supersede ฉบับเก่าจนกว่าจะมี approval flow P2.6
- ขั้น P2.4 ไม่มี schema ใหม่ถ้า snapshot ดึงจาก tables/events เดิมได้

## สิ่งที่จะทำเมื่ออนุมัติ P2.4

1. ขยาย server-only snapshot ให้รวม event หลักฐานตาม job/work-order
2. เพิ่ม renderer สอง template และ register worker mapping
3. เสนอ migration trigger เฉพาะสอง event พร้อม rollback
4. ตรวจ HTML static + test และรออนุมัติ apply/deploy แยกกัน

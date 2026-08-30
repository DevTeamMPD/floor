# P2.3 — Trigger งานยืนยันใบสั่งงาน → คิวสร้างเอกสาร

สถานะ: **apply migration แล้ว; worker รวมอยู่ในชุด deploy P2.2–P2.6**
ขอบเขต: สร้าง outbox item จากเหตุการณ์ `head_confirmed` เท่านั้น

## ผลลัพธ์เมื่อหัวหน้าช่างยืนยัน

```text
confirm_floor_work_order_v2()
  └─ insert floor_work_order_events(event_type = head_confirmed)
       └─ AFTER INSERT trigger (P2.3)
            ├─ enqueue work_order (02-planning, controlled document)
            └─ enqueue boq        (02-planning, controlled document)
                 └─ worker P2.2 (หลัง deploy) สร้าง HTML → SharePoint → document register
```

## หลักประกัน

| เรื่อง | วิธีที่ใช้ |
| --- | --- |
| ไม่เกิดซ้ำ | helper ใช้ idempotency key `{job_no}:{document_type}:{floor_work_orders.updated_at}` และ `ON CONFLICT DO NOTHING` |
| ไม่กระทบการยืนยันงาน | trigger ไม่มี HTTP/SharePoint/render และครอบ enqueue ด้วย exception boundary; ถ้าคิวผิดปกติ RPC ยืนยันงานยังสำเร็จ |
| ตรวจสอบย้อนหลัง | source event id (`floor_work_order_events.id`) และ source timestamp ถูกบันทึกใน outbox |
| เอกสารยังเป็น draft | worker สร้าง register status `draft`; ไม่มีการอนุมัติหรือ supersede อัตโนมัติ |
| สิทธิ์ | trigger/helper เป็น `SECURITY DEFINER`, revoke public; ไม่มี secret หรือ service-role ฝั่ง client |

## สิ่งที่จงใจไม่ทำใน P2.3

- **ไม่ trigger `warehouse_completed`**: ต้องการ Pick Confirmation แต่ template อยู่ P2.4; enqueue ตอนนี้จะวน retry โดยสร้างเอกสารไม่ได้
- ไม่เรียก SharePoint จาก trigger และไม่แก้ RPC `confirm_floor_work_order_v2`
- ไม่ตั้ง Vercel Cron: ต้องยืนยันความถี่ worker ก่อน deploy

## การตรวจหลัง apply (read-only)

1. trigger `trg_floor_docgen_head_confirmed` และ function มีอยู่
2. ยืนยันงานทดสอบ 1 ใบ แล้ว outbox มี exactly 2 แถว (`work_order`, `boq`) สำหรับ event นั้น
3. เรียก worker ด้วย authorization ที่ถูกต้องหลัง deploy แล้วตรวจว่า 2 แถว `succeeded` และมี document register/SharePoint file
4. ยืนยันซ้ำโดยไม่มี source change: ไม่เพิ่ม outbox ซ้ำ

ไฟล์ migration: `supabase/migrations/20260901010000_document_generation_head_confirmed_trigger.sql`

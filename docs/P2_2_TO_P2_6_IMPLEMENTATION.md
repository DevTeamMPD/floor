# FloorNow — ระบบเอกสารอัตโนมัติ P2.2–P2.6

สถานะ ณ 31 สิงหาคม 2569: implementation และ production build ผ่าน; P2.2–P2.5 database migrations ถูก apply ที่ Supabase project `nroyacasuchqniaiuirk` แล้ว

## Flow ที่ใช้งานจริง

1. ผู้ใช้ทำงานเดิมตามปกติ เช่น ยืนยันใบสั่งงาน ปิดคลัง บันทึกติดตั้ง ลูกค้าเซ็น รายงานเศษ ประเมินหลังการขาย หรือปิดงาน
2. Database trigger เพิ่มรายการลง `floor_document_generation_jobs` ภายใน transaction เดิม โดย trigger ครอบ error เพื่อไม่ทำให้งานหลักของผู้ใช้ล้ม
3. Vercel Cron เรียก `/api/documents/process` ทุก 5 นาที พร้อม `CRON_SECRET`
4. Worker claim งานทีละรายการ, snapshot ข้อมูลจริง, render HTML ภาษาไทย และ upload ไป SharePoint
5. Microsoft Graph แปลง HTML เป็น PDF แล้วเก็บ PDF เป็นไฟล์ทางการในทะเบียน `floor_job_documents`
6. ระบบ auto-approve เฟส 1 และ mark revision ก่อนหน้าเป็น `superseded`
7. ถ้าล้ม ระบบ retry แบบ 1/2/4/8/16/30 นาที สูงสุด 6 ครั้ง โดยไม่กระทบงานหน้าบ้าน

## เอกสารที่สร้าง

| Event | เอกสาร | Class |
|---|---|---|
| head_confirmed | ใบสั่งงาน, BOQ | Controlled |
| warehouse_completed | ใบยืนยันการหยิบ | Quality record |
| field_completed | รายงานติดตั้ง | Quality record |
| customer_signed | ใบรับมอบงาน | Quality record |
| remnants_submitted | รายงานเศษ | Quality record |
| job_evaluations มีคะแนน | ประเมินหลังการขาย | Quality record |
| NCR สร้าง/เปลี่ยนสถานะ | NCR | Controlled |
| cs_closed | ใบส่งมอบ | Quality record |

## Control ที่เพิ่ม

- CSAT due 3 วันหลังลูกค้าเซ็น
- NCR SLA: Critical 4 ชม., High 24 ชม., Medium 7 วัน, Low 14 วัน
- NCR เขียนผ่าน audited server RPC เท่านั้น
- ปิดงานต้องมีลายเซ็น รายงานเศษที่รับแล้ว คะแนน CSAT และไม่มี High/Critical NCR ค้าง
- ผู้อนุมัติข้อยกเว้น: `Supakrit.k@mpdgroup.co`
- upload เอกสารทั่วไปสูงสุด 250 MB ผ่าน SharePoint upload session แบบ chunk 3.2 MB
- หน้า `/document-control` แสดงคิว เอกสารขาด CSAT ครบกำหนด และปุ่ม retry

## Security

- Secret อยู่ server/Vercel environment เท่านั้น
- Cron ตรวจ `Authorization: Bearer CRON_SECRET`
- ตารางใหม่เปิด RLS และให้ active staff อ่านเท่านั้น
- การสร้าง metadata, PDF และ upload SharePoint ใช้ server-side service role
- upload session ตรวจไฟล์บน SharePoint ว่าอยู่ใต้ path ของ job/stage ก่อนลงทะเบียน

## Verification

- `npm exec tsc -- --noEmit` ผ่าน
- `npm test` ผ่าน 60 tests
- `npm run build` ผ่าน 35 static pages และ routes ใหม่ `/api/documents/health`, `/api/documents/process`, `/document-control`

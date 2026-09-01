# P5 — Quality Dashboard และ Management Review

## เป้าหมาย

รวมข้อมูล NCR, After-sales, CAPA และ CSAT ให้ฝ่ายบริหารและ Quality เห็นแนวโน้ม ความเสี่ยง และงานค้าง โดยไม่ต้องรวม spreadsheet เอง และ trace กลับถึงใบงาน/หลักฐานได้ตาม ISO 9001:2015 ข้อ 9.3 และ 10.2

## ขอบเขตที่พัฒนา

- หน้า `/quality-review` ใช้ข้อมูลจริงจาก `ncr_reports`, `floor_after_sales_cases`, `floor_after_sales_actions`, `floor_after_sales_events`, `job_evaluations`, `install_jobs` และ `floor_job_documents`
- KPI: NCR เปิด/เกิน SLA, เคสหลังการขายเปิด, CAPA ค้าง, corrective-action effectiveness, CSAT เฉลี่ย และ service recovery time
- มุมวิเคราะห์: severity, type, ทีม, SKU, recurrence ภายใน 90 วัน และ CSAT trend รายเดือน
- Drill-down จากรายการที่ต้องตัดสินใจไป NCR หรือ After-sales จริง
- Management Review export เป็น HTML ภาษาไทยสำหรับพิมพ์/PDF มี KPI, top issue, trend และรายการต้องตัดสินใจ
- NCR Audit export เป็น HTML controlled report รวม NCR, เคสที่เชื่อม, CAPA, event timeline และลิงก์เอกสาร SharePoint

## นิยาม KPI รุ่นแรก

| KPI | นิยาม |
| --- | --- |
| NCR เปิด | `status <> closed` ภายในช่วงเวลาที่เลือก |
| NCR เกิน SLA | NCR เปิดที่ `due_at < now()` |
| After-sales เปิด | สถานะที่ไม่ใช่ `resolved/closed` |
| CAPA ค้าง | action สถานะ `open/in_progress` |
| Corrective-action effectiveness | NCR สถานะ `verified/closed` ÷ NCR ทั้งหมดในช่วงเวลา |
| Recurrence 90 วัน | NCR ตั้งแต่ 2 รายการขึ้นไปที่มี `type + SKU` เดียวกันใน 90 วัน |
| Service recovery time | ชั่วโมงเฉลี่ยจาก `opened_at` ถึง `resolved_at/closed_at` |
| CSAT trend | ค่าเฉลี่ย `satisfaction_score` แยกรายเดือน |

## ค่าเริ่มต้นสำหรับรอบทบทวน

- หน้าจอเริ่มที่ 90 วัน และเลือก 30 วัน / 12 เดือน / ทั้งหมดได้
- รายงาน Management Review สร้างแบบ manual เมื่อประชุม; ไม่ส่งอีเมลอัตโนมัติใน P5
- ผู้ใช้เป้าหมาย: Admin, CS, หัวหน้าช่าง และ Executive
- ไม่มี schema migration และไม่มี privileged mutation เพิ่มใน P5

## Verification

- Unit test สำหรับ metric และ period filtering
- TypeScript, regression tests และ Next.js production build
- Local browser: KPI, recurrence drill-down และ Audit popup

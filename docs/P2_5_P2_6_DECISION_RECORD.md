# P2.5–P2.6 Decision Record

สถานะ: business rules **approved**; schema/deploy ยังต้องอนุมัติแยกตามกติกาโครงการ

## สิ่งที่เจ้าของธุรกิจยืนยัน

| ประเด็น | ข้อสรุป |
| --- | --- |
| การอนุมัติเอกสาร | Auto-approve ในเฟสแรก |
| ชั้นเอกสาร | Work Order, BOQ, NCR = controlled document; ที่เหลือ = quality record |
| การปิดงาน | บล็อกเมื่อหลักฐาน, CSAT หรือ NCR ที่จำเป็นยังไม่ครบ |
| ข้อยกเว้นการปิดงาน | ผู้อนุมัติ: `Supakrit.k@mpdgroup.co` |
| CSAT | สร้างเมื่อเซ็นรับงานแล้ว 3 วัน |
| NCR | ย้ายการเขียนจาก client เป็น server RPC |
| ภาษาเอกสาร | ไทย בלבד |

## NCR policy ที่เสนอ

| Severity | กำหนดแก้ไข | Escalation |
| --- | --- | --- |
| Critical | 4 ชั่วโมง | แจ้งผู้อนุมัติข้อยกเว้นทันที |
| High | 24 ชั่วโมง | แจ้งหัวหน้าฝ่าย + ผู้อนุมัติข้อยกเว้น |
| Medium | 7 วัน | แจ้งผู้รับผิดชอบทุกวัน |
| Low | 14 วัน | แจ้งผู้รับผิดชอบก่อนครบกำหนด 3 วัน |

สถานะ NCR ที่ใช้: `open → investigating → corrective_action → verified → closed`; งานจะปิดไม่ได้ตราบใดที่มี NCR ระดับ Critical/High ที่ยังไม่ `closed` เว้นแต่มี exception approval ที่บันทึก audit แล้ว

## Worker recommendation

ตั้ง Vercel Cron ทุก **5 นาที** ไปยัง `/api/documents/process` ด้วย `DOCUMENT_GENERATION_CRON_SECRET` (fallback `CRON_SECRET`). เป็น near-realtime ที่เหมาะกับเอกสารหลังบ้านและไม่กระทบ business RPC.

## P2.5 deliverables

1. Handover, Customer Acceptance, Remnant Report, CSAT และ NCR renderer ภาษาไทย
2. snapshot เพิ่ม customer signature, remnant report/pieces และ CSAT/NCR summary
3. P2.5 trigger: customer signed/remnants submitted/CS closed; CSAT due-worker + NCR server RPC outbox hook
4. close-work guard + exception approval/audit

## P2.6 deliverables

1. HTML-to-PDF renderer, upload session สำหรับไฟล์เกิน 4 MB
2. approval/revision UI และ auto-approval audit
3. dashboard เอกสารขาด / retry queue / due CSAT/NCR
4. production cron และ deployment verification

## Approval gates ที่ยังเหลือ

- `ยืนยัน apply P2.5` สำหรับ schema/trigger/close guard/NCR RPC
- `ยืนยัน deploy P2.2–P2.6` สำหรับ worker, UI, PDF, cron และ production smoke test

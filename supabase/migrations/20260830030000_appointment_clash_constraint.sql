-- กันคิวช่างชนกันที่ระดับฐานข้อมูล
--
-- เดิมการกันคิวชนอยู่ที่ browser อย่างเดียว (app/share/queue/page.tsx: SELECT
-- คิวเดิม -> เทียบช่วงเวลาใน JS -> alert) ซึ่งกันได้ไม่จริงอย่างน้อย 3 ทาง
--   1) สองคนกดบันทึกพร้อมกัน: ต่างคนต่าง SELECT ไม่เจอกัน แล้ว INSERT ทับกัน
--   2) งานที่ไหลเข้ามาจาก BBPS ผ่าน lib/bbps-sync.ts ไม่ผ่านหน้าจอนั้นเลย
--   3) การ SELECT ฝั่ง client กรองด้วย slot_start ในช่วงวันที่เลือกเท่านั้น
--      คิวข้ามวันที่ "เริ่มก่อน" ช่วงนั้นแต่ลากมาทับ จึงมองไม่เห็น
-- ผลจริง: สแกนย้อนหลังพบคิวซ้อนทับ 6 คู่ และ 3 ใน 6 คู่มีงาน source='bbps'
-- รวมถึงงาน BBPS ที่ถูกจองทับบล็อก "วันหยุด" ของทีม B เมื่อ 2026-08-20
--
-- ตัวคุมจริงต้องอยู่ที่ฐานข้อมูล เพราะเป็นจุดเดียวที่ทุกทางเข้าผ่าน

create extension if not exists btree_gist with schema extensions;

-- opclass ของ btree_gist อยู่ใน schema extensions จึงต้องมองเห็นตอนสร้าง constraint
set search_path = public, extensions;

-- ขอบเขต: บังคับเฉพาะคิวตั้งแต่ 2026-08-30 (วันที่ออก migration) เป็นต้นไป
-- ข้อมูลย้อนหลังที่ซ้อนกันอยู่แล้ว 6 คู่เป็นบันทึกงานที่เกิดขึ้นจริงไปแล้ว
-- จะไม่แก้ไขหรือลบทิ้งเพื่อให้ migration ผ่าน  (ยืนยันแล้วว่าตั้งแต่วันตัดยอด
-- เป็นต้นไปไม่มีคู่ที่ซ้อนกันเหลืออยู่ constraint จึงสร้างผ่านโดยไม่ต้องแตะข้อมูลเดิม)
--
-- ช่วงเวลาใช้ '[)' คือชนขอบไม่ถือว่าซ้อน  09:00-12:00 กับ 12:00-17:00 ยังจองต่อกันได้
-- สถานะที่ยังกันคิวอยู่คือทุกสถานะยกเว้น 'cancelled' ซึ่งตรงกับที่ฝั่ง browser ใช้อยู่
-- ('completed' ยังกันคิว เพราะช่างครองเวลานั้นไปแล้วจริง)
alter table public.appointments
  add constraint appointments_no_overlap_per_team
  exclude using gist (
    tech_id with =,
    tstzrange(slot_start, slot_end, '[)') with &&
  )
  where (
    status is distinct from 'cancelled'
    and slot_start is not null
    and slot_end is not null
    and slot_end > slot_start
    and slot_start >= '2026-08-30 00:00:00+07'::timestamptz
  );

comment on constraint appointments_no_overlap_per_team on public.appointments is
  'ทีมช่างหนึ่งทีมรับงานที่เวลาซ้อนกันไม่ได้ (ยกเว้นคิวที่ยกเลิกแล้ว) — ละเมิดจะได้ SQLSTATE 23P01';

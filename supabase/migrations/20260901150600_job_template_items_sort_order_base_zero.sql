-- FloorNow P1: ปรับ sort_order ของรายการในแม่แบบให้เป็นฐาน 0 ทั้งหมด (ให้ตรงกับที่ UI/RPC เขียน)
--
-- ที่มา: final review ข้อ 13 (Minor) — seed ของ T4a ใส่ sort_order 1..15 (ฐาน 1) ขณะที่หน้าจอส่ง
-- sort_order: idx (ฐาน 0) และ RPC ใช้ค่า default v_idx - 1 (ฐาน 0) พอหัวหน้าช่างกดบันทึกทับครั้งแรก
-- เลขทั้งชุดจะเปลี่ยนฐานเงียบ ๆ ไม่กระทบลำดับที่แสดง (เรียงด้วย order by sort_order) แต่ทำให้ค่าที่เก็บ
-- ไม่สม่ำเสมอ และใครก็ตามที่เขียนโค้ดใหม่โดยเชื่อว่า "ข้อแรก sort_order = 0" จะเจอข้อมูลสองแบบ
--
-- แก้ที่ข้อมูลแทนการแก้ไฟล์ seed ที่ apply ไปแล้ว (ห้ามแก้ migration ที่ apply แล้ว) โดยไล่เรียงใหม่
-- ต่อแม่แบบให้เป็น 0..n-1 ตามลำดับเดิมที่แสดงอยู่ — ลำดับที่ผู้ใช้เห็นจึงไม่เปลี่ยนแม้แต่ข้อเดียว
-- ทั้งสองตารางถูกสร้างโดยสาขานี้เอง การอัปเดตค่าจึงไม่แตะข้อมูลเดิมของระบบ
-- คำสั่งนี้ idempotent (รันซ้ำแล้วไม่มีแถวไหนเปลี่ยนอีก เพราะ where sort_order <> ค่าที่ควรเป็น)

begin;

with ranked as (
  select id, (row_number() over (partition by template_id order by sort_order, created_at, id) - 1) as new_order
  from public.job_checklist_template_items
)
update public.job_checklist_template_items i
set sort_order = r.new_order, updated_at = now()
from ranked r
where r.id = i.id and i.sort_order <> r.new_order;

with ranked as (
  select id, (row_number() over (partition by template_id order by sort_order, created_at, id) - 1) as new_order
  from public.job_prep_template_items
)
update public.job_prep_template_items i
set sort_order = r.new_order, updated_at = now()
from ranked r
where r.id = i.id and i.sort_order <> r.new_order;

commit;

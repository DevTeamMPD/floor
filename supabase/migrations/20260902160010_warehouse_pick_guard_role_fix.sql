-- FloorNow (แก้ตามรีวิว D3): warehouse_pick_guard — แก้เหตุผลที่ผิด และแก้ด่านที่จะล็อกคนจริงออก
--
-- คอมเมนต์เดิมใน 20260902140000_warehouse_line_picking.sql เขียนว่า
--   "role 'admin' และ 'warehouse' เท่านั้น — ชุดเดียวกับ accept_floor_warehouse_order_v2
--    และ complete_floor_warehouse_order_v2"
-- ประโยคนี้ไม่จริง ตรวจฐานข้อมูลจริงด้วย pg_get_functiondef พบว่าเวอร์ชันที่ deploy อยู่ของสองตัวนั้นคือ
--   select * into v_actor from public.floor_staff_profiles where id = (select auth.uid()) and is_active;
-- ไม่มีเงื่อนไข role เลย (ไฟล์ migration 20260823190000 ในรีโปมี role แต่ฐานจริงถูกผ่อนไปแล้ว
--   — เป็น drift ระหว่างรีโปกับฐาน ที่ควรตามเก็บในงานแยก ไม่ใช่ในไฟล์นี้)
-- ด่านใหม่จึงไม่ได้ "เท่ากับของเดิม" แต่ "เข้มกว่า" โดยไม่มีใครตรวจว่าคนที่หยิบของจริงถืออะไรอยู่
--
-- ข้อมูลจริงที่ตรวจก่อนตัดสินใจ (นับจาก floor_work_orders.warehouse_assignee_id
--   และ floor_work_order_events ชนิด warehouse_accepted / warehouse_completed):
--   คนที่เคยใช้หน้าคลังจริงมี 3 คนเท่านั้น
--     dev                        role = admin      · 4 ใบ · 8 เหตุการณ์
--     นางสาว ศกาวรัตน์ ชัยวงศ์    role = staff      · 1 ใบ · 1 เหตุการณ์
--     นาย พิสิฐธร ปราณีตพลกรัง    role = staff      · 1 ใบ · 2 เหตุการณ์
--   ส่วนคนที่ถือ role = 'warehouse' มี 6 คน และ **ยังไม่เคยแตะหน้าคลังเลยสักครั้ง**
--
-- แปลว่าด่าน admin/warehouse ของเดิมจะล็อกคนที่หยิบของจริง 2 ใน 3 คนออกจากฟีเจอร์ทั้งฟีเจอร์
-- และล็อกแบบที่อ่านไม่ออกด้วย: หน้าจอ (app/(admin)/warehouse/page.tsx) ปล่อยปุ่มตาม canAct
-- ซึ่งเช็คแค่ "พนักงานที่ยัง active" คนสองคนนี้จึงจะเห็นปุ่มหยิบ กดแล้วเจอ error สิทธิ์
-- ทั้งที่รับใบงานใบเดียวกันได้ และปิดใบงานใบเดียวกันได้ — สามอย่างนี้ขัดกันเองอย่างสิ้นเชิง
--
-- ตัดสินใจ: ขยายชุด role ให้ครอบคลุมคนที่ทำงานนี้จริง คือ admin, warehouse, staff
-- ไม่ผ่อนไปถึง "is_active เฉย ๆ" แบบที่ฐานจริงของ accept/complete_v2 เป็นอยู่ตอนนี้ เพราะ
--   1) กติกาของโปรเจกต์บังคับว่าทางเขียนต้องมีด่าน role
--   2) role ที่ตัดออก (sales, cs, executive, head_technician) ไม่มีใครเคยแตะหน้าคลังเลย
--      การตัดออกจึงไม่ล็อกใครที่ทำงานอยู่จริงแม้แต่คนเดียว
-- ที่เหลือยังเข้มเหมือนเดิมทุกข้อ: ต้อง active · ใบต้องอยู่สถานะ warehouse_preparing
-- และต้องเป็นคนที่กดรับงานใบนั้น (หรือ admin) ซึ่งเป็นด่านที่คุมของจริงมากกว่า role อยู่แล้ว
--
-- additive ล้วน: create or replace ฟังก์ชันของสาขานี้เอง ไม่แตะตาราง ไม่แตะข้อมูลแถวใด

begin;

create or replace function public.warehouse_pick_guard(p_work_order_id uuid)
returns public.floor_staff_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_order public.floor_work_orders%rowtype;
begin
  -- ชุด role มาจากข้อมูลจริงของคนที่หยิบของอยู่ทุกวัน ไม่ได้ลอกมาจากฟังก์ชันอื่น (ดูหัวไฟล์)
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'warehouse', 'staff');
  if v_actor.id is null then
    raise exception 'ต้องเป็นพนักงานคลัง หน้างาน หรือ admin ที่ยังใช้งานอยู่ จึงจะบันทึกการหยิบของได้';
  end if;

  select * into v_order from public.floor_work_orders where id = p_work_order_id for update;
  if v_order.id is null then
    raise exception 'ไม่พบใบสั่งงาน id=%', p_work_order_id;
  end if;
  if v_order.status <> 'warehouse_preparing' then
    raise exception 'บันทึกการหยิบได้เฉพาะตอนคลังกำลังเตรียมสินค้าเท่านั้น (สถานะปัจจุบัน: %)', v_order.status;
  end if;
  -- ด่านที่คุมของจริง: คนที่กดรับงานเป็นเจ้าของกองของนั้น (เงื่อนไขเดียวกับ complete_floor_warehouse_order_v2)
  if v_order.warehouse_assignee_id <> v_actor.id and v_actor.role <> 'admin' then
    raise exception 'ใบสั่งงานนี้มีพนักงานคลังคนอื่นรับไปแล้ว เฉพาะคนที่กดรับงาน (หรือ admin) เท่านั้นที่บันทึกการหยิบได้';
  end if;
  return v_actor;
end;
$function$;

comment on function public.warehouse_pick_guard(uuid) is
  'ด่านของการหยิบของรายบรรทัด: role admin/warehouse/staff ที่ยัง active — ชุดนี้มาจากข้อมูลจริงของคนที่เคยใช้หน้าคลัง '
  '(2 ใน 3 คนถือ role = staff) ไม่ใช่จากการลอกด่านของฟังก์ชันอื่น ซึ่งบนฐานจริงเช็คแค่ is_active เท่านั้น '
  'จากนั้นล็อกแถวใบสั่งงานด้วย for update ตรวจว่ายังเตรียมสินค้าอยู่ และผู้เรียกคือคนที่กดรับงาน (หรือ admin)';

revoke all on function public.warehouse_pick_guard(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;

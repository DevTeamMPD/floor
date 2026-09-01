-- FloorNow P3-3 (แก้ตามรีวิว C4): ให้ทางเขียนทั้งสี่ตัวแย่งล็อกตัวเดียวกัน จะได้เข้าคิวแทนที่จะทับกัน
--
-- ของเดิมทำอะไรผิด:
--   generate_job_prep_items ล็อกแถว floor_work_orders (for update)
--   แต่ save_job_prep_item_override และ remove_job_prep_item ล็อกแค่แถว floor_work_order_items
--   สองฝั่งจึงไม่เห็นกัน: หัวหน้าช่างกด "แก้จำนวน" พร้อมกับอีกคนกด "สร้างรายการจากแม่แบบ"
--   ตัวสร้างอ่าน is_manual_override = false ไปแล้วก่อนที่การแก้จะ commit → เขียนทับตัวเลขที่คนเพิ่งแก้
--   แล้วบันทึกเหตุผลใน job_prep_item_overrides ก็ยังอยู่ กลายเป็น "มีเหตุผล แต่ตัวเลขไม่ตรงกับเหตุผล"
--
-- แก้อย่างไร: ย้ายการล็อกแถวใบสั่งงานเข้าไปอยู่ใน job_prep_edit_guard ซึ่งทั้งสามทางเขียน
-- (save / add / remove) เรียกอยู่แล้ว และให้ล็อก "ใบสั่งงานก่อน แล้วค่อยล็อกบรรทัด" เสมอ
-- ลำดับเดียวกับ generate_job_prep_items ทุกตัว จึงเป็นคิวเดียวกันและไม่เกิด deadlock
--
-- ผลข้างเคียงที่ตั้งใจ: การแก้สองบรรทัดคนละบรรทัดในใบเดียวกันพร้อมกันจะเข้าคิวกันด้วย
-- ยอมได้ เพราะหนึ่งใบสั่งงานมีหัวหน้าช่างดูแลคนเดียว และการรอไม่กี่มิลลิวินาที
-- ถูกกว่าการที่ตัวเลขของคนหนึ่งหายไปโดยไม่มีใครรู้
--
-- additive ล้วน: แทนที่เฉพาะตัวฟังก์ชัน ไม่แตะโครงตาราง ไม่แตะข้อมูลแถวเดิม

begin;

-- ---------------------------------------------------------------------------
-- ตัวช่วยภายใน: ตรวจสิทธิ์ + ล็อกใบสั่งงาน + ตรวจหน้าต่างเวลา
-- ---------------------------------------------------------------------------
create or replace function public.job_prep_edit_guard(p_work_order_id uuid)
returns public.floor_staff_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_order public.floor_work_orders%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะแก้รายการของที่ต้องเตรียมได้';
  end if;
  -- for update: ล็อกตัวเดียวกับที่ generate_job_prep_items ใช้ ทางเขียนทุกตัวจึงเข้าคิวเดียวกัน
  select * into v_order from public.floor_work_orders where id = p_work_order_id for update;
  if v_order.id is null then
    raise exception 'ไม่พบใบสั่งงาน id=%', p_work_order_id;
  end if;
  if v_order.status not in ('head_review', 'returned_sales') then
    raise exception 'แก้รายการได้เฉพาะก่อนส่งให้คลังเท่านั้น (สถานะปัจจุบัน: %)', v_order.status;
  end if;
  return v_actor;
end;
$function$;

comment on function public.job_prep_edit_guard(uuid) is
  'ด่านของทางเขียนรายการเตรียมของ: ตรวจ role (admin/head_technician) ล็อกแถวใบสั่งงานด้วย for update '
  'แล้วตรวจว่ายังอยู่ก่อนส่งคลัง — ล็อกตัวเดียวกับ generate_job_prep_items เพื่อให้ทุกทางเขียนเข้าคิวกัน';

-- ---------------------------------------------------------------------------
-- 1) แก้บรรทัดที่มีอยู่ให้ต่างจากแม่แบบ — ล็อกใบสั่งงานก่อน แล้วค่อยล็อกบรรทัด
-- ---------------------------------------------------------------------------
create or replace function public.save_job_prep_item_override(
  p_item_id uuid,
  p_planned_qty numeric,
  p_item_name text,
  p_unit text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line public.floor_work_order_items%rowtype;
  v_work_order_id uuid;
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_unit text;
  v_override_id uuid;
begin
  -- อ่านแบบไม่ล็อกก่อน เพื่อรู้ว่าบรรทัดนี้อยู่ใบไหน แล้วจึงล็อกตามลำดับ ใบสั่งงาน → บรรทัด
  select work_order_id into v_work_order_id from public.floor_work_order_items where id = p_item_id;
  if v_work_order_id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;
  v_actor := public.job_prep_edit_guard(v_work_order_id);

  -- อ่านซ้ำหลังได้ล็อกใบสั่งงานแล้ว ค่าที่อ่านได้ตรงนี้จึงเป็นค่าที่ไม่มีใครแก้ระหว่างทางได้อีก
  select * into v_line from public.floor_work_order_items where id = p_item_id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;

  if v_reason = '' then
    raise exception 'ต้องระบุเหตุผลที่แก้ต่างจากแม่แบบ เพื่อให้ตรวจย้อนกลับได้ว่าทำไมจึงไม่ใช้ตัวเลขของแม่แบบ';
  end if;
  if v_line.picked_qty is not null then
    raise exception 'คลังหยิบของบรรทัดนี้ออกไปแล้ว จึงแก้จำนวนตามแผนไม่ได้';
  end if;
  if p_planned_qty is null or p_planned_qty < 0 then
    raise exception 'จำนวนตามแผนต้องเป็นตัวเลขไม่ติดลบ';
  end if;
  v_name := coalesce(nullif(btrim(coalesce(p_item_name, '')), ''), v_line.item_name);
  v_unit := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_line.unit);

  if v_line.planned_qty = p_planned_qty and v_line.item_name = v_name and v_line.unit = v_unit then
    raise exception 'ค่าที่ส่งมาเหมือนเดิมทุกอย่าง จึงไม่มีอะไรต้องบันทึกเป็นส่วนต่างจากแม่แบบ';
  end if;

  insert into public.job_prep_item_overrides(
    work_order_id, item_id, template_item_id, template_id, change_kind,
    template_item_name, template_unit, template_qty,
    human_item_name, human_unit, human_qty,
    calc_basis, reason, changed_by, changed_by_name
  ) values (
    v_line.work_order_id, v_line.id, v_line.template_item_id,
    (select t.template_id from public.job_prep_template_items t where t.id = v_line.template_item_id),
    'qty_changed',
    v_line.item_name, v_line.unit, v_line.planned_qty,
    v_name, v_unit, p_planned_qty,
    public.job_prep_calc_basis(v_line.work_order_id, v_line.template_item_id),
    v_reason, v_actor.id, v_actor.full_name
  ) returning id into v_override_id;

  update public.floor_work_order_items
  set planned_qty = p_planned_qty, item_name = v_name, unit = v_unit,
      is_manual_override = true, updated_at = now()
  where id = v_line.id;

  return v_override_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) ลบบรรทัดของแม่แบบทิ้ง — ล็อกลำดับเดียวกัน
-- ---------------------------------------------------------------------------
create or replace function public.remove_job_prep_item(p_item_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line public.floor_work_order_items%rowtype;
  v_work_order_id uuid;
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_override_id uuid;
begin
  select work_order_id into v_work_order_id from public.floor_work_order_items where id = p_item_id;
  if v_work_order_id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;
  v_actor := public.job_prep_edit_guard(v_work_order_id);

  select * into v_line from public.floor_work_order_items where id = p_item_id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;
  if v_reason = '' then
    raise exception 'ต้องระบุเหตุผลที่ลบรายการของแม่แบบทิ้ง';
  end if;
  if v_line.picked_qty is not null then
    raise exception 'คลังหยิบของบรรทัดนี้ออกไปแล้ว จึงลบออกจากรายการไม่ได้';
  end if;

  insert into public.job_prep_item_overrides(
    work_order_id, item_id, template_item_id, template_id, change_kind,
    template_item_name, template_unit, template_qty,
    calc_basis, reason, changed_by, changed_by_name
  ) values (
    v_line.work_order_id, null, v_line.template_item_id,
    (select t.template_id from public.job_prep_template_items t where t.id = v_line.template_item_id),
    'removed',
    v_line.item_name, v_line.unit, v_line.planned_qty,
    public.job_prep_calc_basis(v_line.work_order_id, v_line.template_item_id),
    v_reason, v_actor.id, v_actor.full_name
  ) returning id into v_override_id;

  -- บรรทัดที่คนเพิ่มเองก็ลบได้ และถูกบันทึกด้วย change_kind = 'removed' เหมือนกัน
  delete from public.floor_work_order_items where id = v_line.id;
  return v_override_id;
end;
$function$;

revoke all on function public.job_prep_edit_guard(uuid) from public, anon, authenticated;
revoke all on function public.save_job_prep_item_override(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.remove_job_prep_item(uuid, text) from public, anon;
grant execute on function public.save_job_prep_item_override(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.remove_job_prep_item(uuid, text) to authenticated;

commit;

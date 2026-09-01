-- FloorNow P3-3: ทางเขียนของ "คนแก้รายการเตรียมของ" — ทุกการแก้ต้องทิ้งเหตุผลไว้
--
-- สามอย่างที่นับเป็น "ต่างจากแม่แบบ" และต้องถูกบันทึกเหมือนกันหมด:
--   1) แก้จำนวน/ชื่อ/หน่วยของบรรทัดที่มาจากแม่แบบ  → change_kind = 'qty_changed'
--   2) เพิ่มบรรทัดที่ไม่มีในแม่แบบ                   → change_kind = 'added'
--   3) ลบบรรทัดของแม่แบบทิ้ง                        → change_kind = 'removed'
--
-- สิทธิ์: admin / head_technician — ชุดเดียวกับที่แก้แม่แบบและยืนยันใบสั่งงานได้
-- หน้าต่างเวลา: เฉพาะใบสั่งงานสถานะ head_review / returned_sales คือ "ก่อนส่งให้คลัง"
-- และห้ามแก้บรรทัดที่คลังหยิบออกไปแล้ว (picked_qty ไม่เป็น null) ไม่ว่าสถานะใบจะเป็นอะไร
--
-- ทั้งสาม RPC เขียนสองที่ในทรานแซกชันเดียว: แก้ floor_work_order_items และบันทึก
-- job_prep_item_overrides พร้อมกัน จึงเป็นไปไม่ได้ที่จะมีการแก้ที่ไม่มีบันทึกเหตุผล

begin;

-- ---------------------------------------------------------------------------
-- ตัวช่วยภายใน: ตรวจสิทธิ์ + หาใบสั่งงาน + ตรวจหน้าต่างเวลา
-- ---------------------------------------------------------------------------
create or replace function public.job_prep_edit_guard(p_work_order_id uuid)
returns public.floor_staff_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_status text;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะแก้รายการของที่ต้องเตรียมได้';
  end if;
  select status into v_status from public.floor_work_orders where id = p_work_order_id;
  if v_status is null then
    raise exception 'ไม่พบใบสั่งงาน id=%', p_work_order_id;
  end if;
  if v_status not in ('head_review', 'returned_sales') then
    raise exception 'แก้รายการได้เฉพาะก่อนส่งให้คลังเท่านั้น (สถานะปัจจุบัน: %)', v_status;
  end if;
  return v_actor;
end;
$function$;

-- ---------------------------------------------------------------------------
-- ตัวช่วยภายใน: ค่าตั้งต้นที่แม่แบบใช้คำนวณบรรทัดนี้ ณ ตอนนี้
-- ---------------------------------------------------------------------------
create or replace function public.job_prep_calc_basis(p_work_order_id uuid, p_template_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_job public.install_jobs%rowtype;
  v_item public.job_prep_template_items%rowtype;
  v_tpl public.job_prep_templates%rowtype;
  v_area numeric;
  v_units numeric;
begin
  select * into v_order from public.floor_work_orders where id = p_work_order_id;
  if v_order.id is null then return null; end if;
  select * into v_job from public.install_jobs where job_no = v_order.job_no;
  v_area := public.job_prep_area_sqm(v_job.survey_data);
  select nullif(sum(planned_qty), 0) into v_units
  from public.floor_work_order_items
  where work_order_id = v_order.id
    and category in ('floor_material', 'remnant')
    and unit in ('แผ่น', 'sheet', 'sheets');
  if v_units is null then
    select nullif(planned_sheet_count, 0) into v_units
    from public.floor_job_materials where appointment_id = v_order.appointment_id;
  end if;
  if p_template_item_id is not null then
    select * into v_item from public.job_prep_template_items where id = p_template_item_id;
    select * into v_tpl from public.job_prep_templates where id = v_item.template_id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'area_sqm', v_area,
    'unit_count', v_units,
    'calc_mode', v_item.calc_mode,
    'calc_qty', v_item.calc_qty,
    'waste_pct', v_item.waste_pct,
    'template_id', v_tpl.id,
    'template_version', v_tpl.version
  ));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 1) แก้บรรทัดที่มีอยู่ให้ต่างจากแม่แบบ
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
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_unit text;
  v_override_id uuid;
begin
  select * into v_line from public.floor_work_order_items where id = p_item_id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;
  v_actor := public.job_prep_edit_guard(v_line.work_order_id);

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
-- 2) เพิ่มบรรทัดที่ไม่มีในแม่แบบ — ก็เป็นส่วนต่างจากแม่แบบเหมือนกัน
-- ---------------------------------------------------------------------------
create or replace function public.add_job_prep_item(
  p_work_order_id uuid,
  p_item_name text,
  p_unit text,
  p_planned_qty numeric,
  p_item_kind text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text := btrim(coalesce(p_item_name, ''));
  v_unit text := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), 'ชิ้น');
  v_kind text := coalesce(nullif(btrim(coalesce(p_item_kind, '')), ''), 'consumable');
  v_sort integer;
  v_item_id uuid;
begin
  v_actor := public.job_prep_edit_guard(p_work_order_id);
  if v_reason = '' then
    raise exception 'ต้องระบุเหตุผลที่เพิ่มรายการนอกแม่แบบ เพื่อให้ตรวจย้อนกลับได้ว่าทำไมแม่แบบจึงยังไม่ครอบคลุม';
  end if;
  if v_name = '' then
    raise exception 'ต้องระบุชื่อรายการ';
  end if;
  if v_kind not in ('consumable', 'tool') then
    raise exception 'ประเภทของต้องเป็น consumable หรือ tool เท่านั้น';
  end if;
  if p_planned_qty is null or p_planned_qty < 0 then
    raise exception 'จำนวนตามแผนต้องเป็นตัวเลขไม่ติดลบ';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.floor_work_order_items where work_order_id = p_work_order_id;

  insert into public.floor_work_order_items(
    work_order_id, category, item_name, planned_qty, unit, source_type, sort_order,
    item_kind, template_item_id, is_manual_override
  ) values (
    p_work_order_id, v_kind, v_name, p_planned_qty, v_unit, 'warehouse', v_sort,
    v_kind, null, true
  ) returning id into v_item_id;

  insert into public.job_prep_item_overrides(
    work_order_id, item_id, template_item_id, change_kind,
    human_item_name, human_unit, human_qty,
    calc_basis, reason, changed_by, changed_by_name
  ) values (
    p_work_order_id, v_item_id, null, 'added',
    v_name, v_unit, p_planned_qty,
    public.job_prep_calc_basis(p_work_order_id, null),
    v_reason, v_actor.id, v_actor.full_name
  );

  return v_item_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) ลบบรรทัดของแม่แบบทิ้ง — บันทึกไว้ และห้าม generate ปลุกกลับมา
-- ---------------------------------------------------------------------------
create or replace function public.remove_job_prep_item(p_item_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line public.floor_work_order_items%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_override_id uuid;
begin
  select * into v_line from public.floor_work_order_items where id = p_item_id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;
  v_actor := public.job_prep_edit_guard(v_line.work_order_id);
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
  -- ต่างกันแค่ template_item_id เป็น null จึงไม่มีบรรทัดแม่แบบให้กันการปลุกกลับ
  delete from public.floor_work_order_items where id = v_line.id;
  return v_override_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) ทางอ่านส่วนต่าง — ให้หน้าจอติดป้ายได้ว่าบรรทัดไหนต่างจากแม่แบบ
-- ---------------------------------------------------------------------------
create or replace function public.get_job_prep_overrides(p_job_no text)
returns table (
  id uuid,
  work_order_id uuid,
  item_id uuid,
  template_item_id uuid,
  change_kind text,
  template_item_name text,
  template_unit text,
  template_qty numeric,
  human_item_name text,
  human_unit text,
  human_qty numeric,
  calc_basis jsonb,
  reason text,
  changed_by_name text,
  changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_job_no text := btrim(coalesce(p_job_no, ''));
  v_wo public.floor_work_orders%rowtype;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูส่วนต่างจากแม่แบบได้';
  end if;
  if v_job_no = '' then return; end if;

  -- หาใบสั่งงานด้วยลำดับเดียวกับ get_job_prep_list เป๊ะ ๆ เพื่อไม่ให้สองทางอ่านชี้คนละใบ
  select * into v_wo from public.floor_work_orders
  where job_no = v_job_no order by created_at desc limit 1;
  if v_wo.id is null then
    select w.* into v_wo from public.floor_work_orders w
    join public.appointments a on a.id = w.appointment_id
    where a.job_id = v_job_no and a.status <> 'cancelled'
    order by w.created_at desc limit 1;
  end if;
  if v_wo.id is null then return; end if;

  return query
  select o.id, o.work_order_id, o.item_id, o.template_item_id, o.change_kind,
         o.template_item_name, o.template_unit, o.template_qty,
         o.human_item_name, o.human_unit, o.human_qty,
         o.calc_basis, o.reason, o.changed_by_name, o.changed_at
  from public.job_prep_item_overrides o
  where o.work_order_id = v_wo.id
  order by o.changed_at desc, o.id;
end;
$function$;

revoke all on function public.job_prep_edit_guard(uuid) from public, anon, authenticated;
revoke all on function public.job_prep_calc_basis(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_job_prep_item_override(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.add_job_prep_item(uuid, text, text, numeric, text, text) from public, anon;
revoke all on function public.remove_job_prep_item(uuid, text) from public, anon;
revoke all on function public.get_job_prep_overrides(text) from public, anon;
grant execute on function public.save_job_prep_item_override(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.add_job_prep_item(uuid, text, text, numeric, text, text) to authenticated;
grant execute on function public.remove_job_prep_item(uuid, text) to authenticated;
grant execute on function public.get_job_prep_overrides(text) to authenticated;

commit;

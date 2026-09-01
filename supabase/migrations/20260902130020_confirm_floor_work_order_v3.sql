-- FloorNow (แก้ตามรีวิว C3): confirm_floor_work_order_v3 — ยืนยันใบสั่งงานโดยไม่ล้างคอลัมน์ของ P3-1/P3-2/P3-3
--
-- ของเดิมทำอะไรผิด:
--   confirm_floor_work_order_v2 ทำ "ลบทุกบรรทัดแล้วเขียนใหม่จาก payload ของหน้าจอ"
--   แต่ payload ไม่ได้ส่ง template_item_id / material_id / item_kind / is_manual_override / picked_qty
--   กลับมา ทุกครั้งที่กดยืนยันใบสั่งงาน คอลัมน์เหล่านี้จึงถูกล้างเป็น null / false
--   วันนี้ยังไม่กัด เพราะไม่มีเส้นทางไหนพาใบที่ยืนยันแล้วกลับมาที่ head_review / returned_sales
--   แต่กลไกกันของที่คนแก้ไม่ให้ถูกทับทั้งหมดยืนอยู่บนคอลัมน์ชุดนี้ ถ้าวันหนึ่งมีเส้นทางนั้น
--   ทุกอย่างจะพังเงียบ ๆ: บรรทัดที่คนแก้ไว้กลายเป็นบรรทัดธรรมดา แล้วถูกแม่แบบเขียนทับ
--
-- v3 ต่างจาก v2 ตรงเดียว: แทนที่จะ "ลบทั้งหมดแล้วเขียนใหม่" เปลี่ยนเป็น
--   * บรรทัดที่ payload ส่ง id มาและ id นั้นอยู่ในใบนี้จริง → update ทับที่เดิม (คอลัมน์ที่ payload
--     ไม่ได้พูดถึงจึงอยู่ครบทุกตัว รวมถึง id ที่ job_prep_item_overrides.item_id ชี้อยู่)
--   * บรรทัดที่ไม่มี id (คนเพิ่มใหม่บนฟอร์ม) → insert
--   * บรรทัดเดิมที่ไม่อยู่ใน payload เลย (คนลบออกจากฟอร์ม) → delete เหมือนเดิม
-- ด่านสิทธิ์ ด่านข้อมูลลูกค้า ด่านช่างหัวหน้า ด่าน SKU ของ floor_material และการอัปเดตสถานะ
-- ทุกบรรทัดเหมือน v2 เป๊ะ ๆ ไม่มีการผ่อนเกณฑ์ใด
--
-- v2 ยังอยู่ครบไม่ถูกแตะ (ยังมีของเดิมเรียกได้ และเป็นทางถอยถ้า v3 มีปัญหา)
-- ผู้เรียกในแอปถูกย้ายมา v3 แล้ว: app/(admin)/orders/[jobNo]/page.tsx (confirmOrder)
--
-- ข้อจำกัดที่รู้ตัวและจงใจไม่แก้ในไฟล์นี้:
--   ถ้าหัวหน้าช่างแก้จำนวนของบรรทัดที่มาจากแม่แบบ "บนฟอร์มยืนยัน" (ไม่ใช่ผ่านปุ่มแก้จำนวนที่บันทึกเหตุผล)
--   v3 จะเก็บ is_manual_override ไว้ตามเดิม (ไม่ตั้งเป็น true ให้เอง) เพราะการตั้งธงโดยไม่มีแถวเหตุผล
--   ใน job_prep_item_overrides จะทำให้ข้อตกลง "ทุกส่วนต่างต้องมีเหตุผล" เสียไป
--   ทางที่ถูกคือบังคับให้แก้ผ่านปุ่มที่บันทึกเหตุผล ซึ่งเป็นงานของหน้าจอ ไม่ใช่ของฟังก์ชันนี้
--
-- additive ล้วน: ฟังก์ชันใหม่ทั้งตัว ไม่แตะโครงตาราง ไม่แตะข้อมูลแถวเดิม

begin;

create or replace function public.confirm_floor_work_order_v3(
  p_work_order_id uuid,
  p_items jsonb,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_appt public.appointments%rowtype;
  v_job public.install_jobs%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_item jsonb;
  v_sort integer := 0;
  v_raw_id text;
  v_id uuid;
  v_keep uuid[] := array[]::uuid[];
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะยืนยันใบสั่งงานได้';
  end if;

  select * into v_order from public.floor_work_orders
  where id = p_work_order_id and status in ('head_review', 'returned_sales') for update;
  if v_order.id is null then
    raise exception 'ใบสั่งงานนี้ไม่ได้อยู่ในสถานะที่รอการยืนยัน';
  end if;

  select * into v_appt from public.appointments where id = v_order.appointment_id and status <> 'cancelled';
  select * into v_job from public.install_jobs where job_no = v_order.job_no;
  if v_appt.id is null or v_job.job_no is null then
    raise exception 'ไม่พบนัดหมายหรืองานติดตั้งของใบสั่งงานนี้';
  end if;

  if nullif(btrim(coalesce(v_job.customer_name, '')), '') is null
     or nullif(btrim(coalesce(v_job.customer_phone, '')), '') is null
     or (nullif(btrim(coalesce(v_job.address, '')), '') is null and nullif(btrim(coalesce(v_job.location_url, '')), '') is null)
     or nullif(btrim(coalesce(v_job.product_name, v_appt.requirement, '')), '') is null then
    raise exception 'ต้องมีชื่อลูกค้า เบอร์โทร สถานที่ และรายละเอียดงานให้ครบก่อนยืนยัน';
  end if;
  if not exists (
    select 1 from public.appointment_technicians a
    where a.appointment_id = v_appt.id and a.is_active and a.is_lead
  ) then
    raise exception 'ต้องมอบหมายช่างหัวหน้าทีมก่อนยืนยันใบสั่งงาน';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ต้องมีรายการวัสดุหรืออุปกรณ์อย่างน้อยหนึ่งบรรทัด';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'category', '') not in ('floor_material', 'remnant', 'accessory', 'consumable', 'equipment', 'tool')
       or nullif(btrim(coalesce(v_item->>'itemName', '')), '') is null
       or nullif(btrim(coalesce(v_item->>'unit', '')), '') is null
       or coalesce((v_item->>'plannedQty')::numeric, -1) < 0 then
      raise exception 'บรรทัดในใบสั่งงานไม่ถูกต้อง';
    end if;
    -- Gap 4 (เหมือน v2): floor_material ต้องมี SKU ยกเว้นทำเครื่องหมายอนุมัติ SKU นอกคลัง
    if v_item->>'category' = 'floor_material'
       and coalesce(nullif(v_item->>'sourceType', ''), 'new') <> 'other'
       and nullif(btrim(coalesce(v_item->>'sku', '')), '') is null then
      raise exception 'บรรทัดวัสดุปูพื้นต้องมี SKU (หรือทำเครื่องหมายว่าอนุมัติ SKU นอกคลัง)';
    end if;

    -- id ที่หน้าจอส่งกลับมา = บรรทัดเดิมที่ต้องแก้ทับที่เดิม ไม่ใช่ลบแล้วสร้างใหม่
    v_raw_id := nullif(btrim(coalesce(v_item->>'id', '')), '');
    if v_raw_id is not null and v_raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_id := v_raw_id::uuid;
    else
      v_id := null;
    end if;
    -- id ที่ไม่ได้อยู่ในใบนี้ หรือถูกส่งซ้ำสองครั้ง ให้ถือว่าเป็นบรรทัดใหม่ ไม่ใช่แก้ทับ
    if v_id is not null and (
      v_id = any (v_keep)
      or not exists (
        select 1 from public.floor_work_order_items i
        where i.id = v_id and i.work_order_id = v_order.id
      )
    ) then
      v_id := null;
    end if;

    if v_id is null then
      insert into public.floor_work_order_items(
        work_order_id, category, item_name, sku, specification, planned_qty, unit, source_type, note, sort_order
      ) values (
        v_order.id, v_item->>'category', btrim(v_item->>'itemName'),
        nullif(btrim(coalesce(v_item->>'sku', '')), ''),
        nullif(btrim(coalesce(v_item->>'specification', '')), ''),
        (v_item->>'plannedQty')::numeric, btrim(v_item->>'unit'),
        coalesce(nullif(v_item->>'sourceType', ''), 'new'),
        nullif(btrim(coalesce(v_item->>'note', '')), ''), v_sort
      ) returning id into v_id;
    else
      -- แก้ทับที่เดิม: คอลัมน์ที่ payload ไม่ได้พูดถึง (template_item_id, material_id, item_kind,
      -- is_manual_override, picked_qty, returned_qty, used_qty) อยู่ครบตามเดิม — นี่คือเหตุผลทั้งหมดของ v3
      update public.floor_work_order_items set
        category = v_item->>'category',
        item_name = btrim(v_item->>'itemName'),
        sku = nullif(btrim(coalesce(v_item->>'sku', '')), ''),
        specification = nullif(btrim(coalesce(v_item->>'specification', '')), ''),
        planned_qty = (v_item->>'plannedQty')::numeric,
        unit = btrim(v_item->>'unit'),
        source_type = coalesce(nullif(v_item->>'sourceType', ''), 'new'),
        note = nullif(btrim(coalesce(v_item->>'note', '')), ''),
        sort_order = v_sort,
        updated_at = now()
      where id = v_id;
    end if;

    v_keep := v_keep || v_id;
    v_sort := v_sort + 1;
  end loop;

  -- บรรทัดเดิมที่คนลบออกจากฟอร์ม — พฤติกรรมเดียวกับ v2 (v2 ลบทุกบรรทัดแล้วไม่เขียนกลับ)
  delete from public.floor_work_order_items
  where work_order_id = v_order.id and not (id = any (v_keep));

  insert into public.floor_job_materials(appointment_id, planned_sheet_count, planned_by, planned_at, updated_at)
  select v_order.appointment_id,
    coalesce(ceil(sum(planned_qty) filter (
      where category in ('floor_material', 'remnant') and unit in ('แผ่น', 'sheet', 'sheets')
    )), 0)::integer,
    v_actor.full_name, now(), now()
  from public.floor_work_order_items where work_order_id = v_order.id
  on conflict (appointment_id) do update set
    planned_sheet_count = excluded.planned_sheet_count,
    planned_by = excluded.planned_by,
    planned_at = excluded.planned_at,
    updated_at = excluded.updated_at;

  update public.floor_work_orders set
    status = 'warehouse_waiting', revision = revision + 1,
    confirmed_by = v_actor.id, confirmed_at = now(),
    note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = v_order.id;
  update public.appointments set status = 'confirmed', confirmed_at = now() where id = v_order.appointment_id;
  update public.install_jobs set
    status = 'รอคลังรับงาน', waiting_on = 'คลังสินค้า', waiting_since = now(),
    flag_note = null, updated_at = now()
  where job_no = v_order.job_no;
  insert into public.floor_work_order_events(
    work_order_id, event_type, from_status, to_status, actor_staff_id, actor_name, note
  ) values (
    v_order.id, 'head_confirmed', v_order.status, 'warehouse_waiting',
    v_actor.id, v_actor.full_name, nullif(btrim(coalesce(p_note, '')), '')
  );
  return true;
end;
$function$;

comment on function public.confirm_floor_work_order_v3(uuid, jsonb, text) is
  'ยืนยันใบสั่งงานและส่งต่อให้คลัง — เหมือน confirm_floor_work_order_v2 ทุกด่าน '
  'ต่างกันที่แก้บรรทัดทับที่เดิมด้วย id ที่หน้าจอส่งกลับมา แทนการลบทุกบรรทัดแล้วเขียนใหม่ '
  'จึงไม่ล้าง template_item_id / material_id / item_kind / is_manual_override / picked_qty '
  'ซึ่งเป็นคอลัมน์ที่กลไกกันของที่คนแก้ไม่ให้ถูกแม่แบบทับทั้งหมดยืนอยู่บนนั้น';

revoke all on function public.confirm_floor_work_order_v3(uuid, jsonb, text) from public, anon;
grant execute on function public.confirm_floor_work_order_v3(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;

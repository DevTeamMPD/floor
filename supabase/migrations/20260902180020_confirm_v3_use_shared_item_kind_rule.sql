-- ============================================================================
-- confirm_v3_use_shared_item_kind_rule
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   ก่อนหน้านี้ confirm_floor_work_order_v3 มีกติกาเดา item_kind เขียนฝังอยู่ในตัวเอง
--   (migration 20260901102542 confirm_v3_carry_item_kind) พอมีการเติมย้อนหลังเข้ามา
--   จะกลายเป็นกติกาสองชุดที่ต้องคอยแก้ให้ตรงกันด้วยมือ — ซึ่งไม่มีวันตรงกันได้นาน
--
--   ไฟล์นี้จึงเปลี่ยนให้ v3 เรียก public.derive_floor_work_order_item_kind()
--   ที่เป็นกติกาเดียวของระบบแทน (สร้างใน migration 20260901105536)
--   ผลคือแถวที่ยืนยันใหม่วันนี้ กับแถวเก่าที่ถูกเติมย้อนหลัง ได้คำตอบจากตรรกะชุดเดียวกันเป๊ะ
--
--   ลำดับความสำคัญยังเหมือนเดิมทุกประการ:
--     1. ค่าที่หน้าจอส่งมา (itemKind) ชนะเสมอ — คนเห็นของจริง ระบบไม่ควรเถียง
--     2. หน้าจอไม่ได้บอก จึงค่อยเดาด้วยกติกากลาง
--     3. ตอนแก้ทับบรรทัดเดิมใช้ coalesce(ค่าใหม่, ค่าเดิม) — ไม่ล้างค่าที่ถูกต้องอยู่แล้วทิ้ง
--
-- ไฟล์นี้รันซ้ำได้ เพราะเป็น create or replace function
-- ต้องรันหลัง 20260901105536 (ต้องมี derive_floor_work_order_item_kind ก่อน)
-- คัดลอกจาก pg_get_functiondef ของฐานข้อมูลจริงแบบตัวอักษรต่อตัวอักษร
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_floor_work_order_v3(p_work_order_id uuid, p_items jsonb, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_appt public.appointments%rowtype;
  v_job public.install_jobs%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_item jsonb;
  v_sort integer := 0;
  v_raw_id text;
  v_id uuid;
  v_kind text;
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

    -- D6 + E3: ชนิดของ (item_kind) — รับค่าจากหน้าจอก่อนเสมอ ถ้าหน้าจอไม่ได้บอกจึงค่อยเดา
    -- การเดาย้ายไปอยู่ที่ public.derive_floor_work_order_item_kind() ซึ่งเป็น "กติกาเดียวในระบบ"
    -- ที่การเติมย้อนหลัง (E3) ใช้ตัวเดียวกันเป๊ะ — แถวเก่ากับแถวใหม่ที่หน้าตาเหมือนกันจึงได้คำตอบเดียวกัน
    -- กติกาเดิมของ D6 ถูกเก็บไว้ครบ (tool ต้อง planned > 0) และเพิ่มสองข้อ:
    --   * บรรทัด "โน้ต Freeform จากหัวหน้าช่าง" ถูกกันด้วยเงื่อนไขครบ 6 ข้อ ไม่ใช่แค่ planned = 0
    --   * floor_material -> consumable เพราะวัสดุปูพื้นถูกติดตั้งลงพื้นบ้านลูกค้า ไม่มีวันกลับคลัง
    v_kind := nullif(btrim(coalesce(v_item->>'itemKind', '')), '');
    if v_kind is not null and v_kind not in ('consumable', 'tool') then
      raise exception 'ชนิดของ (itemKind) ต้องเป็น consumable หรือ tool เท่านั้น (ได้รับ: %)', v_kind;
    end if;
    if v_kind is null then
      v_kind := public.derive_floor_work_order_item_kind(
        v_item->>'category',
        coalesce(nullif(v_item->>'sourceType', ''), 'new'),
        nullif(btrim(coalesce(v_item->>'sku', '')), ''),
        btrim(v_item->>'itemName'),
        btrim(v_item->>'unit'),
        (v_item->>'plannedQty')::numeric
      );
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
        work_order_id, category, item_name, sku, specification, planned_qty, unit, source_type, note, sort_order, item_kind
      ) values (
        v_order.id, v_item->>'category', btrim(v_item->>'itemName'),
        nullif(btrim(coalesce(v_item->>'sku', '')), ''),
        nullif(btrim(coalesce(v_item->>'specification', '')), ''),
        (v_item->>'plannedQty')::numeric, btrim(v_item->>'unit'),
        coalesce(nullif(v_item->>'sourceType', ''), 'new'),
        nullif(btrim(coalesce(v_item->>'note', '')), ''), v_sort, v_kind
      ) returning id into v_id;
    else
      -- แก้ทับที่เดิม: คอลัมน์ที่ payload ไม่ได้พูดถึง (template_item_id, material_id,
      -- is_manual_override, picked_qty, returned_qty, used_qty) อยู่ครบตามเดิม — นี่คือเหตุผลทั้งหมดของ v3
      -- D6: item_kind เขียนแบบ coalesce(ค่าใหม่, ค่าเดิม) — หน้าจอบอกมาก็ใช้ตามนั้น
      -- ไม่บอกก็เก็บของเดิมไว้ (เช่นบรรทัดที่มาจากแม่แบบซึ่งมี item_kind ถูกต้องอยู่แล้ว) ไม่ล้างทิ้ง
      update public.floor_work_order_items set
        category = v_item->>'category',
        item_kind = coalesce(v_kind, item_kind),
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

-- สิทธิ์ — ตรงตามสถานะจริง: {postgres, authenticated, service_role}
revoke all on function public.confirm_floor_work_order_v3(uuid, jsonb, text) from public;
revoke all on function public.confirm_floor_work_order_v3(uuid, jsonb, text) from anon;
grant execute on function public.confirm_floor_work_order_v3(uuid, jsonb, text) to authenticated, service_role;

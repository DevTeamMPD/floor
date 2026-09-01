-- FloorNow (แก้ตามรีวิว D6): confirm_floor_work_order_v3 ต้องเขียน item_kind ไม่ใช่เมินมันทั้งฟังก์ชัน
--
-- ปัญหาที่เจอตอนทำงานถัดไป (รายการ "เครื่องมือค้างคืน"):
--   get_outstanding_tools กรองด้วย  i.item_kind = 'tool'  และ picked_qty > 0
--   แต่ confirm_floor_work_order_v3 ไม่เคยเขียนคอลัมน์ item_kind เลยแม้แต่ทางเดียว
--   ทั้งที่คอมเมนต์ของตัวมันเองภูมิใจว่า "ไม่ล้าง item_kind" ซึ่งจริง — แต่ "ไม่ล้าง" กับ "เขียน" คนละเรื่อง
--   ผลคือเครื่องมือที่ **หัวหน้าช่างพิมพ์เองบนฟอร์ม** (ไม่ได้มาจากแม่แบบ) ได้ item_kind = null เสมอ
--   ยืนยันกับฐานจริงแล้ว: floor_work_order_items ทั้ง 13 แถวมี item_kind = null ทุกแถว
--   เครื่องมือกลุ่มนี้จึงไม่มีวันโผล่ในรายการเครื่องมือค้างคืน และไม่มีใครตามของคืนได้
--
-- ทางแก้: ส่ง itemKind มากับ payload (app/(admin)/orders/[jobNo]/page.tsx rpcItems)
-- และเขียนลงคอลัมน์ทั้งทาง insert และ update พร้อมค่าเดาที่ปลอดภัยเมื่อหน้าจอไม่ได้บอก
--   insert: coalesce(ค่าจากหน้าจอ, เดาจาก category)
--   update: coalesce(ค่าจากหน้าจอ, ค่าเดิมในตาราง)  <- ไม่ล้างของแม่แบบทิ้ง ซึ่งคือเหตุผลทั้งหมดของ v3
-- กติกาการเดา: tool ที่ planned > 0 -> 'tool' · consumable -> 'consumable' · นอกนั้น -> null
-- เงื่อนไข planned > 0 กันบรรทัด "โน้ต Freeform จากหัวหน้าช่าง" (category = tool, planned = 0)
-- ไม่ให้กลายเป็นเครื่องมือค้างคืน — โน้ตไม่ใช่ของ ไม่มีใครหอบมันกลับคลัง
--
-- v2 ไม่ถูกแตะเลยแม้แต่บรรทัดเดียวตามข้อกำหนด (ยังเป็นทางถอยได้เหมือนเดิม)
-- ด่านสิทธิ์ ด่านข้อมูลลูกค้า ด่าน SKU และการเดินสถานะทุกบรรทัดเหมือนเดิมเป๊ะ ไม่มีการผ่อนเกณฑ์ใด
-- ค่า itemKind ที่ไม่รู้จักถูกปฏิเสธเป็น error ภาษาไทย ไม่ใช่เขียนลงตารางแล้วให้ constraint เด้งทีหลัง
--
-- พิสูจน์ด้วยโพรบ D6-a / D6-b / D6-c ที่รันจริงแล้ว rollback — ดู sdd-jobtpl/p35fix-probes.sql
-- additive ล้วน: create or replace ฟังก์ชันของสาขานี้เอง ไม่แตะโครงตาราง ไม่แตะข้อมูลแถวใด

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

    -- D6: ชนิดของ (item_kind) — v3 เดิม "ไม่เคยเขียนคอลัมน์นี้เลย" ทั้งทาง insert และ update
    -- บรรทัดเครื่องมือที่หัวหน้าช่างพิมพ์เองบนฟอร์มจึงได้ item_kind = null ตลอดกาล
    -- และไม่มีวันโผล่ในรายการ "เครื่องมือค้างคืน" (get_outstanding_tools กรองด้วย item_kind = 'tool')
    -- รับค่าจากหน้าจอก่อนเสมอ ถ้าหน้าจอไม่ได้บอก ค่อยเดาจาก category แบบอนุรักษ์นิยม:
    --   category = 'tool' และมีจำนวนตามแผนจริง -> 'tool'
    --   category = 'consumable'                -> 'consumable'
    --   นอกนั้น (วัสดุปูพื้น เศษวัสดุ อุปกรณ์ ฯลฯ) -> null เพราะไม่มีคำที่ตรงในคำศัพท์ชุดนี้
    -- เงื่อนไข planned_qty > 0 คือสิ่งที่กันบรรทัด "โน้ต Freeform จากหัวหน้าช่าง" (category = tool, planned = 0)
    -- ไม่ให้กลายเป็นเครื่องมือค้างคืนโดยไม่ตั้งใจ — โน้ตไม่ใช่ของ ไม่มีใครหอบมันกลับคลัง
    v_kind := nullif(btrim(coalesce(v_item->>'itemKind', '')), '');
    if v_kind is not null and v_kind not in ('consumable', 'tool') then
      raise exception 'ชนิดของ (itemKind) ต้องเป็น consumable หรือ tool เท่านั้น (ได้รับ: %)', v_kind;
    end if;
    if v_kind is null then
      v_kind := case
        when v_item->>'category' = 'tool' and coalesce((v_item->>'plannedQty')::numeric, 0) > 0 then 'tool'
        when v_item->>'category' = 'consumable' then 'consumable'
        else null
      end;
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
comment on function public.confirm_floor_work_order_v3(uuid, jsonb, text) is
  'ยืนยันใบสั่งงานและส่งต่อให้คลัง — เหมือน confirm_floor_work_order_v2 ทุกด่าน '
  'ต่างกันที่แก้บรรทัดทับที่เดิมด้วย id ที่หน้าจอส่งกลับมา แทนการลบทุกบรรทัดแล้วเขียนใหม่ '
  'จึงไม่ล้าง template_item_id / material_id / is_manual_override / picked_qty '
  'และตั้งแต่ D6 เป็นต้นไป "เขียน" item_kind จาก payload ด้วย (เดาจาก category เมื่อหน้าจอไม่ได้บอก) '
  'เพราะเครื่องมือที่หัวหน้าช่างพิมพ์เองต้องโผล่ในรายการเครื่องมือค้างคืนได้จริง';

revoke all on function public.confirm_floor_work_order_v3(uuid, jsonb, text) from public, anon;
grant execute on function public.confirm_floor_work_order_v3(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;

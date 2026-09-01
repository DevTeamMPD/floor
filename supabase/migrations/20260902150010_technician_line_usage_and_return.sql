-- FloorNow P4-1 (2/3): ให้ช่างบันทึกหน้างานว่า "ของนี้ใช้ไปเท่าไหร่ และเอากลับมาคืนเท่าไหร่"
--
-- ปัญหาที่แก้: returned_qty และ used_qty มีคอลัมน์รออยู่ตั้งแต่ P3-1 แต่ไม่มีใครเขียนเลย
-- ของที่เบิกออกไปจึงหายไปจากระบบทันทีที่ออกจากคลัง ไม่มีใครตอบได้ว่าใช้จริงเท่าไหร่
-- เศษเหลือกลับมาไหม และเครื่องมือที่หยิบไปยังอยู่กับใคร
--
-- ใครเป็นคนบันทึก: ช่างที่ถือของอยู่ในมือ ผ่าน token + PIN เดียวกับหน้าจอช่างทุกตัว
-- ไม่ทำทางเขียนที่สองให้ฝั่งคลัง โดยตั้งใจ — คนที่รู้ว่าใช้ไปเท่าไหร่คือคนที่ใช้
-- และการมีสองมือเขียนตัวเลขเดียวกันแปลว่าจะมีวันที่สองมือเขียนไม่ตรงกันแล้วไม่มีใครรู้ว่าใครถูก
--
-- ตัวเลขที่ส่งมาเป็น "ค่าล่าสุดทั้งหมด" ไม่ใช่ส่วนเพิ่ม (absolute ไม่ใช่ delta) โดยตั้งใจ:
-- ช่างที่กดผิดแล้วกดใหม่ต้องได้ผลลัพธ์เท่ากับที่เห็นบนจอ ไม่ใช่ผลบวกสะสมที่มองไม่เห็น
-- และเป็นสิ่งเดียวกับที่ทำให้ stock_movements นับซ้ำไม่ได้ (sync_job_stock_movements เขียนทับแถวเดิม)
--
-- ด่าน: technician_assignment_guard (token+PIN+ใบมอบหมายที่ยัง active) ตัวเดิมทุกตัวอักษร
-- บวกด่านที่สำคัญกว่าสำหรับทางเขียน: บรรทัดต้องอยู่ในใบสั่งงานของนัดหมายที่ช่างคนนั้นถืออยู่จริง
-- ล็อกลำดับเดิม: ใบสั่งงานก่อน แล้วค่อยบรรทัด (เหมือน job_prep_edit_guard / warehouse_pick_guard)
--
-- ช่วงเวลาที่เขียนได้: ตั้งแต่คลังจ่ายของแล้ว (ready_to_install) จนถึงปิดงาน (closed)
-- ที่ยอมให้เขียนตอน closed ด้วย เพราะเครื่องมือที่เอากลับมาคืนช้ากว่าวันปิดงานเป็นเรื่องปกติหน้างาน
-- ถ้าห้ามไว้ รายการเครื่องมือค้างคืนจะค้างตลอดกาลโดยไม่มีทางเคลียร์ ซึ่งแย่กว่าการยอมให้บันทึกความจริง
-- แต่ตอน closed แก้ได้เฉพาะ "จำนวนที่คืน" เท่านั้น — ยอดการใช้ของงานที่ปิดไปแล้วห้ามขยับ
--
-- additive ล้วน: เพิ่มคอลัมน์ nullable สามตัวบน floor_work_order_items (ใครบันทึก เมื่อไหร่ หมายเหตุ)
-- ไม่แตะคอลัมน์เดิม ไม่แตะข้อมูลแถวเดิม ไม่เปิดสิทธิ์ตารางใดให้ anon เพิ่ม

begin;

-- ---------------------------------------------------------------------------
-- 1) ร่องรอยว่า "ใครบันทึกตัวเลขนี้ เมื่อไหร่"
--    ผูกกับ floor_technicians เพราะคนบันทึกคือช่าง ไม่ใช่พนักงานออฟฟิศ
--    on delete set null: ช่างลาออกได้ แต่ตัวเลขที่เขาบันทึกไว้ต้องไม่หายไปด้วย
-- ---------------------------------------------------------------------------
alter table public.floor_work_order_items
  add column if not exists usage_recorded_at timestamptz,
  add column if not exists usage_recorded_by uuid,
  add column if not exists usage_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_usage_recorded_by_fkey'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_usage_recorded_by_fkey
      foreign key (usage_recorded_by) references public.floor_technicians(id) on delete set null;
  end if;
end
$$;

comment on column public.floor_work_order_items.usage_recorded_at is
  'เวลาที่ช่างบันทึก "ใช้ไปเท่าไหร่ / คืนเท่าไหร่" ของบรรทัดนี้ครั้งล่าสุด';
comment on column public.floor_work_order_items.usage_recorded_by is
  'ช่างที่บันทึกยอดใช้/คืนครั้งล่าสุด — ใช้ตอบคำถาม "เครื่องมือชิ้นนี้อยู่กับใคร" ใน P4-2';
comment on column public.floor_work_order_items.usage_note is
  'หมายเหตุจากช่างตอนบันทึกยอดใช้/คืน เช่น เหตุผลที่ของหายไประหว่างทาง';

create index if not exists floor_work_order_items_outstanding_tool_idx
  on public.floor_work_order_items(work_order_id)
  where item_kind = 'tool' and picked_qty is not null;

-- ---------------------------------------------------------------------------
-- 2) แกนกลาง: เขียนตัวเลขลงบรรทัด แล้วปรับสมุดบัญชีให้ตรง — ที่เดียวในระบบ
--    ถ้าวันหนึ่งมีทางเขียนที่สอง (เช่นฝั่งคลัง) ต้องเรียกตัวนี้ ห้ามเขียนคอลัมน์ตรง
-- ---------------------------------------------------------------------------
create or replace function public.apply_job_line_usage(
  p_item_id uuid,
  p_used_qty numeric,
  p_returned_qty numeric,
  p_note text,
  p_technician_id uuid,
  p_actor_label text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line public.floor_work_order_items%rowtype;
  v_expected numeric;
  v_ledger jsonb;
begin
  select * into v_line from public.floor_work_order_items where id = p_item_id;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;

  update public.floor_work_order_items
  set used_qty = p_used_qty,
      returned_qty = p_returned_qty,
      usage_note = p_note,
      usage_recorded_at = now(),
      usage_recorded_by = coalesce(p_technician_id, usage_recorded_by),
      updated_at = now()
  where id = v_line.id
  returning * into v_line;

  -- ทุกการขยับของตัวเลข = สมุดบัญชีต้องตรงทันทีในทรานแซกชันเดียวกัน
  v_ledger := public.sync_job_stock_movements(v_line.id, p_actor_label);

  v_expected := coalesce(v_line.picked_qty, v_line.actual_qty, v_line.planned_qty, 0);
  return jsonb_build_object(
    'itemId', v_line.id,
    'itemName', v_line.item_name,
    'unit', v_line.unit,
    'itemKind', v_line.item_kind,
    'expectedQty', v_expected,
    'usedQty', coalesce(v_line.used_qty, 0),
    'returnedQty', coalesce(v_line.returned_qty, 0),
    -- ของที่เบิกไปแล้วไม่ได้ใช้และไม่ได้คืน = ยังอยู่กับทีมช่าง (หรือหายไป) ต้องมองเห็นเป็นตัวเลข
    'unaccountedQty', v_expected - coalesce(v_line.used_qty, 0) - coalesce(v_line.returned_qty, 0),
    'toolOutstanding', (v_line.item_kind = 'tool' and coalesce(v_line.returned_qty, 0) < coalesce(v_line.picked_qty, 0)),
    'usageRecordedAt', v_line.usage_recorded_at,
    'ledger', v_ledger
  );
end;
$function$;

comment on function public.apply_job_line_usage(uuid, numeric, numeric, text, uuid, text) is
  'เขียน used_qty/returned_qty ของบรรทัดหนึ่งแล้ว sync stock_movements ในทรานแซกชันเดียวกัน '
  '— ที่เดียวในระบบที่แตะสองคอลัมน์นี้ กติกา "ใช้+คืน ต้องไม่เกินที่เบิก" บังคับด้วย trigger ระดับตาราง '
  'เรียกได้เฉพาะจากฟังก์ชัน security definer ตัวอื่น ไม่เปิดให้ client เรียกตรง';

-- ---------------------------------------------------------------------------
-- 3) ทางอ่านของหน้าช่าง: บรรทัดที่ต้องปิดยอด + ตัวเลขที่เคยบันทึกไว้
-- ---------------------------------------------------------------------------
create or replace function public.get_technician_usage_lines(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_assignment public.appointment_technicians%rowtype;
  v_order public.floor_work_orders%rowtype;
begin
  v_assignment := public.technician_assignment_guard(p_token, p_pin, p_assignment_id);

  select * into v_order from public.floor_work_orders
  where appointment_id = v_assignment.appointment_id
  order by created_at desc limit 1;

  if v_order.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_work_order', 'canRecord', false, 'lines', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'found', true,
    'workOrderId', v_order.id,
    'workOrderStatus', v_order.status,
    'jobNo', v_order.job_no,
    'canRecord', v_order.status in ('ready_to_install', 'installing', 'waiting_cs', 'closed'),
    -- งานปิดแล้วยังคืนเครื่องมือได้ แต่แก้ยอดการใช้ไม่ได้ — หน้าจอต้องบอกช่างล่วงหน้า ไม่ใช่ให้กดแล้วเด้ง
    'returnOnly', v_order.status = 'closed',
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.id,
        'category', i.category,
        'itemKind', i.item_kind,
        'itemName', i.item_name,
        'sku', i.sku,
        'specification', i.specification,
        'unit', i.unit,
        'note', i.note,
        'plannedQty', i.planned_qty,
        'actualQty', i.actual_qty,
        'pickedQty', i.picked_qty,
        'pickStatus', i.pick_status,
        'expectedQty', coalesce(i.picked_qty, i.actual_qty, i.planned_qty),
        'usedQty', i.used_qty,
        'returnedQty', i.returned_qty,
        'usageNote', i.usage_note,
        'usageRecordedAt', i.usage_recorded_at,
        'usageRecordedByName', t.name
      ) order by i.sort_order, i.created_at)
      from public.floor_work_order_items i
      left join public.floor_technicians t on t.id = i.usage_recorded_by
      where i.work_order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function public.get_technician_usage_lines(uuid, text, uuid) is
  'รายการของงานนั้นพร้อมยอดเบิก/ใช้/คืนล่าสุด สำหรับหน้าจอช่าง — อ่านอย่างเดียว คืนเฉพาะงานของผู้เรียก';

-- ---------------------------------------------------------------------------
-- 4) ทางเขียนของหน้าช่าง
-- ---------------------------------------------------------------------------
create or replace function public.record_technician_line_usage(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_item_id uuid,
  p_used_qty numeric default null,
  p_returned_qty numeric default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.appointment_technicians%rowtype;
  v_tech public.floor_technicians%rowtype;
  v_order public.floor_work_orders%rowtype;
  v_line public.floor_work_order_items%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_used numeric;
  v_returned numeric;
begin
  v_assignment := public.technician_assignment_guard(p_token, p_pin, p_assignment_id);
  select * into v_tech from public.floor_technicians where id = v_assignment.technician_id;

  -- ล็อกใบสั่งงานก่อน แล้วค่อยบรรทัด — ลำดับเดียวกับทางเขียนอื่นทั้งหมด จึงเข้าคิวกันไม่ชนกัน
  select * into v_order from public.floor_work_orders
  where appointment_id = v_assignment.appointment_id for update;
  if v_order.id is null then
    raise exception 'ยังไม่มีใบสั่งงานของนัดหมายนี้ จึงบันทึกยอดใช้/คืนไม่ได้';
  end if;
  if v_order.status not in ('ready_to_install', 'installing', 'waiting_cs', 'closed') then
    raise exception 'บันทึกยอดใช้/คืนได้เฉพาะหลังคลังจ่ายของแล้วเท่านั้น (สถานะปัจจุบัน: %)', v_order.status;
  end if;

  -- ด่านสำคัญที่สุด: บรรทัดต้องอยู่ในใบสั่งงานของนัดหมายที่ช่างคนนี้ถืออยู่จริง
  -- ถ้าไม่ตรวจ ช่างที่มี token+PIN ถูกต้องคนเดียวจะแก้ยอดของงานคนอื่นได้ทั้งฐานข้อมูล
  select * into v_line from public.floor_work_order_items
  where id = p_item_id and work_order_id = v_order.id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการนี้ในใบสั่งงานของคุณ';
  end if;

  if p_used_qty is null and p_returned_qty is null then
    raise exception 'ต้องระบุอย่างน้อยหนึ่งอย่าง: ใช้ไปเท่าไหร่ หรือคืนเท่าไหร่';
  end if;

  -- null = ไม่แตะค่าเดิม (หน้าจอส่งมาเฉพาะช่องที่ช่างกรอก)
  v_used := coalesce(p_used_qty, v_line.used_qty);
  v_returned := coalesce(p_returned_qty, v_line.returned_qty);

  if v_order.status = 'closed' and coalesce(v_used, 0) <> coalesce(v_line.used_qty, 0) then
    raise exception 'งานนี้ปิดไปแล้ว แก้ยอดที่ใช้ไม่ได้ — บันทึกได้เฉพาะจำนวนเครื่องมือ/ของที่เอากลับมาคืน';
  end if;

  return public.apply_job_line_usage(
    v_line.id, v_used, v_returned, v_note, v_tech.id,
    coalesce(v_tech.name, 'ช่างหน้างาน')
  );
end;
$function$;

comment on function public.record_technician_line_usage(uuid, text, uuid, uuid, numeric, numeric, text) is
  'ช่างบันทึกยอด "ใช้จริง / คืนกลับคลัง" ของหนึ่งบรรทัด (token+PIN) — ตัวเลขเป็นค่าล่าสุดทั้งหมดไม่ใช่ส่วนเพิ่ม '
  'ทุกครั้งที่บันทึก stock_movements ของบรรทัดนั้นถูกปรับให้ตรง ไม่ได้เพิ่มแถวใหม่ จึงนับซ้ำไม่ได้';

-- ---------------------------------------------------------------------------
-- 5) สิทธิ์ — RPC ของหน้าช่างเปิดให้ anon เรียกตามแพตเทิร์นเดิมของหน้านั้น
--    (ด่านจริงคือ token+PIN ในตัวฟังก์ชัน) ส่วนแกนกลางไม่ให้ใครเรียกตรงเลย
-- ---------------------------------------------------------------------------
revoke all on function public.apply_job_line_usage(uuid, numeric, numeric, text, uuid, text) from public, anon, authenticated;

revoke all on function public.get_technician_usage_lines(uuid, text, uuid) from public;
grant execute on function public.get_technician_usage_lines(uuid, text, uuid) to anon, authenticated, service_role;

revoke all on function public.record_technician_line_usage(uuid, text, uuid, uuid, numeric, numeric, text) from public;
grant execute on function public.record_technician_line_usage(uuid, text, uuid, uuid, numeric, numeric, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

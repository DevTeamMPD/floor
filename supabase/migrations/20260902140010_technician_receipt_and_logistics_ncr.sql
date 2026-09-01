-- FloorNow P3-6: ให้ช่างยืนยัน "ของที่มาถึงหน้างานจริง" ทีละบรรทัด และเปิด NC เองเมื่อของไม่ครบ
--
-- ปัญหาที่แก้: วันนี้ช่างกรอกตัวเลขเดียวทั้งใบ ("จำนวนแผ่นที่หยิบจริง") ลง
-- floor_job_materials.picked_sheet_count ตัวเลขนั้นบอกได้แค่ว่า "รวมแล้วไม่ตรง" แต่บอกไม่ได้ว่า
-- ขาดรายการไหน ขาดเพราะอะไร และไม่มีใครถูกบังคับให้ตอบ ผลคือของขาดหน้างานจบลงที่การโทรหากัน
-- แล้วหายไปจากระบบ ไม่มีร่องรอยว่าต้นตอเป็นเรื่องคลัง/การขนของ (logistics) ซ้ำ ๆ ที่จุดไหน
--
-- ทางแก้: บันทึกการตรวจรับ "รายบรรทัด" พร้อมเหตุผลภาษาไทยที่คนหน้างานพูดจริง
-- และเมื่อบรรทัดไหนได้ไม่ครบหรือได้ผิด ให้ระบบเปิด NC ให้เองทันที ผ่านทางเดียวกับที่หน้า /ncr ใช้
-- ช่างไม่ต้องรู้ว่า NC คืออะไร แค่ตอบว่า "ได้ไม่ครบ เพราะอะไร" แล้วเรื่องเข้าระบบเอง
--
-- เรื่อง ncr_reports.type — สิ่งที่เลือกและเหตุผล (สำคัญ อ่านก่อนแก้):
--   check constraint อนุญาตแค่ quality, damage, missing, wrong, other และงานนี้ "ห้าม" เพิ่มค่าใหม่
--   (คอลัมน์ cause_code เป็นงานแยกที่วางแผนไว้แล้ว) จึงจับคู่จากเหตุผลที่ช่างเลือกไปยังค่าที่ใกล้ที่สุด:
--     ของไม่พอในคลัง / ลืมโหลดขึ้นรถ / ตกหล่นระหว่างทาง / อื่น ๆ -> 'missing'  (ของหายไปจากกอง)
--     ของเสียหาย                                              -> 'damage'
--     ผิดรุ่น / ผิดสี                                           -> 'wrong'
--   ค่าตั้งต้นของเหตุการณ์นี้คือ 'missing' และคำว่า "logistics" ถูกพาไปกับ description เสมอ
--   ด้วยแท็ก [logistics] ที่ต้นข้อความ + บรรทัด "สาเหตุหลัก: โลจิสติกส์ (logistics)" ท้ายข้อความ
--   เมื่อคอลัมน์ cause_code มาถึง ให้ย้ายค่าจากบรรทัดนั้นมาเป็นคอลัมน์ แล้วเลิกพึ่ง description
--
-- severity เลือก 'medium' โดยตั้งใจ: close_floor_work_order_cs_v3 บล็อกการปิดงานถ้ามี NC
-- severity critical/high ที่ยังไม่ปิด ถ้าตั้งเป็น high ของขาดหนึ่งบรรทัดจะทำให้ปิดงานไม่ได้ทุกใบ
-- ซึ่งเป็นการเปลี่ยนพฤติกรรมการปิดงานที่มีอยู่เดิม — นอกขอบเขตงานนี้ และไม่ใช่สิ่งที่ใครสั่ง
--
-- ห้าม NC ซ้ำ: หนึ่งบรรทัด = หนึ่งแถวใน floor_work_order_item_receipts (unique item_id)
-- และ ncr_id ผูกอยู่บนแถวนั้น ช่างแก้บรรทัดเดิมกี่ครั้งก็ยังเป็นแถวเดิมและ NC ใบเดิม
-- การแก้ครั้งหลังเป็น "อัปเดต NC ใบเดิม + เพิ่ม floor_ncr_events" ไม่ใช่การเปิดใบใหม่
-- ข้อบังคับนี้ถูกล็อกด้วยโครงสร้าง (unique index) ไม่ใช่ด้วยความระวังของโค้ด
--
-- ทางเข้าของช่าง: token + PIN + ใบมอบหมายที่ยัง active เท่านั้น แพตเทิร์นเดียวกับ
-- get_technician_job_checklist ทุกประการ และเพิ่มด่านที่สำคัญกว่านั้นสำหรับทางเขียน:
-- บรรทัดที่แก้ต้องอยู่ในใบสั่งงานของนัดหมายนั้นจริง ๆ มิฉะนั้นช่างที่มี token ถูกต้อง
-- จะเขียนทับบรรทัดของงานคนอื่นได้ทั้งระบบ — ไม่มีตารางใดเปิดสิทธิ์ให้ anon เพิ่มแม้แต่ตารางเดียว

begin;

-- ---------------------------------------------------------------------------
-- 1) แคตตาล็อกเหตุผล — แหล่งความจริงเดียวของทั้ง ป้ายภาษาไทย และการจับคู่ไปยัง ncr_reports.type
--    หน้าจอ "อ่านรายการนี้จากเซิร์ฟเวอร์" ไม่ได้ฝังรายการของตัวเอง จึงไม่มีทางเพี้ยนจากฝั่ง SQL
-- ---------------------------------------------------------------------------
create or replace function public.floor_receipt_reason_catalog()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object('code', 'stock_short',   'label', 'ของไม่พอในคลัง',      'ncrType', 'missing'),
    jsonb_build_object('code', 'not_loaded',    'label', 'ลืมโหลดขึ้นรถ',        'ncrType', 'missing'),
    jsonb_build_object('code', 'lost_on_route', 'label', 'ตกหล่นระหว่างทาง',    'ncrType', 'missing'),
    jsonb_build_object('code', 'damaged',       'label', 'ของเสียหาย',          'ncrType', 'damage'),
    jsonb_build_object('code', 'wrong_item',    'label', 'ผิดรุ่น/ผิดสี',         'ncrType', 'wrong'),
    jsonb_build_object('code', 'other',         'label', 'อื่น ๆ (ระบุเอง)',      'ncrType', 'missing')
  );
$function$;

comment on function public.floor_receipt_reason_catalog() is
  'เหตุผลที่ช่างเลือกได้เมื่อของมาไม่ครบ พร้อมป้ายภาษาไทยและ ncr_reports.type ที่ใกล้เคียงที่สุด '
  '— แหล่งความจริงเดียว หน้าจออ่านรายการนี้จากเซิร์ฟเวอร์ ไม่ได้ฝังรายการของตัวเอง';

-- ---------------------------------------------------------------------------
-- 2) ตารางผลการตรวจรับหน้างาน — หนึ่งบรรทัดของใบสั่งงาน = หนึ่งแถว
-- ---------------------------------------------------------------------------
create table if not exists public.floor_work_order_item_receipts (
  id uuid primary key default gen_random_uuid(),
  -- unique: นี่คือหลักประกันเชิงโครงสร้างว่าหนึ่งบรรทัดมีผลตรวจรับได้ใบเดียว
  -- และเป็นเหตุผลที่ NC ซ้ำเกิดไม่ได้ เพราะ ncr_id อยู่บนแถวนี้แถวเดียว
  item_id uuid not null unique references public.floor_work_order_items(id) on delete cascade,
  work_order_id uuid not null references public.floor_work_orders(id) on delete cascade,
  job_no text not null,
  assignment_id uuid references public.appointment_technicians(id) on delete set null,
  technician_id uuid references public.floor_technicians(id) on delete set null,
  technician_name text not null,
  receipt_status text not null,
  -- จำนวนที่ "ควรจะได้" ณ เวลาที่ช่างกด = picked_qty ของคลัง ถ้าไม่มีถอยไป actual_qty แล้ว planned_qty
  -- เก็บเป็นสำเนาไว้ เพราะถ้าคลังแก้ตัวเลขทีหลัง ผลตรวจรับของช่างต้องยังอ่านออกว่าตอนนั้นเทียบกับอะไร
  expected_qty numeric not null,
  received_qty numeric not null,
  shortage_qty numeric not null,
  reason_code text,
  reason_note text,
  ncr_id uuid references public.ncr_reports(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint floor_work_order_item_receipts_status_check
    check (receipt_status in ('received_full', 'received_partial', 'not_received')),
  constraint floor_work_order_item_receipts_qty_check
    check (expected_qty >= 0 and received_qty >= 0 and shortage_qty >= 0),
  -- ไม่ครบเมื่อไหร่ต้องมีเหตุผลเสมอ — ข้อบังคับนี้คือหัวใจของงานนี้ ("ได้ไม่ครบ + เหตุผล")
  constraint floor_work_order_item_receipts_reason_required_check
    check (receipt_status = 'received_full' or reason_code is not null),
  constraint floor_work_order_item_receipts_reason_code_check
    check (reason_code is null or reason_code in ('stock_short', 'not_loaded', 'lost_on_route', 'damaged', 'wrong_item', 'other')),
  -- "อื่น ๆ" ที่ไม่พิมพ์อะไรเลยคือการกดผ่านเฉย ๆ ใช้ตามต่อไม่ได้ จึงบังคับข้อความอิสระ
  constraint floor_work_order_item_receipts_other_note_check
    check (reason_code is distinct from 'other' or nullif(btrim(coalesce(reason_note, '')), '') is not null),
  constraint floor_work_order_item_receipts_not_received_check
    check (receipt_status <> 'not_received' or received_qty = 0)
);

-- หนึ่ง NC ผูกได้กับผลตรวจรับใบเดียวเท่านั้น กันทั้ง "หนึ่งบรรทัดหลาย NC" และ "หนึ่ง NC หลายบรรทัด"
create unique index if not exists floor_work_order_item_receipts_ncr_unique
  on public.floor_work_order_item_receipts(ncr_id) where ncr_id is not null;
create index if not exists floor_work_order_item_receipts_order_idx
  on public.floor_work_order_item_receipts(work_order_id);
create index if not exists floor_work_order_item_receipts_job_idx
  on public.floor_work_order_item_receipts(job_no, confirmed_at desc);

comment on table public.floor_work_order_item_receipts is
  'ผลการตรวจรับของหน้างานรายบรรทัดที่ช่างยืนยันเอง (P3-6) — unique(item_id) คือหลักประกันว่าแก้ซ้ำแล้ว NC ไม่ซ้ำ';
comment on column public.floor_work_order_item_receipts.expected_qty is
  'จำนวนที่ควรได้ ณ เวลาที่ช่างกด (สำเนาของ picked_qty/actual_qty/planned_qty) — เก็บไว้เพื่อให้ย้อนอ่านได้ว่าตอนนั้นเทียบกับอะไร';
comment on column public.floor_work_order_item_receipts.ncr_id is
  'NC ที่ระบบเปิดให้อัตโนมัติจากบรรทัดนี้ — null แปลว่าได้ครบ หรือเปิด NC ไม่สำเร็จ (ดู ncrError ที่ RPC คืนกลับ)';

alter table public.floor_work_order_item_receipts enable row level security;
revoke all on public.floor_work_order_item_receipts from anon, authenticated;
grant select on public.floor_work_order_item_receipts to authenticated;
drop policy if exists floor_work_order_item_receipts_active_staff_read on public.floor_work_order_item_receipts;
create policy floor_work_order_item_receipts_active_staff_read on public.floor_work_order_item_receipts
  for select to authenticated using ((select public.is_floor_staff_active()));

-- ---------------------------------------------------------------------------
-- 3) แยก "แกนกลางของการเปิด NC" ออกจาก "ด่านตรวจสิทธิ์ของหน้าแอดมิน"
--
--    เหตุผล: create_floor_ncr ตรวจ auth.uid() กับ floor_staff_profiles ซึ่งช่างหน้างานไม่มี
--    (ช่างวิ่งเป็น anon ยืนยันตัวด้วย token+PIN และอยู่ในตาราง floor_technicians คนละตาราง)
--    ถ้าเขียน insert ชุดที่สองให้ช่าง ระบบจะมีทางสร้าง NC สองทางที่ค่อย ๆ เพี้ยนจากกัน
--    จึงยกไส้ในออกมาเป็น create_floor_ncr_as() ที่รับ "ผู้กระทำ" เข้ามา แล้วให้ทั้งสองทางเรียกตัวเดียวกัน
--    insert เข้า ncr_reports จึงยังมีอยู่ที่เดียวในระบบเหมือนเดิม ไม่ได้เพิ่มทางที่สอง
--
--    create_floor_ncr ลายเซ็นเดิมทุกตัวอักษร หน้า /ncr เรียกเหมือนเดิม ไม่ต้องแก้อะไร
-- ---------------------------------------------------------------------------
create or replace function public.create_floor_ncr_as(
  p_actor_id uuid,
  p_actor_name text,
  p_job_no text,
  p_title text,
  p_type text,
  p_product_sku text default null,
  p_quantity numeric default null,
  p_description text default null,
  p_estimated_value_thb numeric default null,
  p_created_by text default null,
  p_severity text default 'medium'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_due timestamptz;
begin
  if nullif(btrim(coalesce(p_job_no, '')), '') is null
     or not exists (select 1 from public.install_jobs where job_no = p_job_no) then
    raise exception 'valid job number is required';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'NCR title is required'; end if;
  if p_severity not in ('critical', 'high', 'medium', 'low') then raise exception 'invalid NCR severity'; end if;

  v_due := now() + case p_severity
    when 'critical' then interval '4 hours'
    when 'high' then interval '24 hours'
    when 'medium' then interval '7 days'
    else interval '14 days' end;

  insert into public.ncr_reports(
    job_no, title, type, status, product_sku, quantity, description,
    estimated_value_thb, created_by, severity, due_at, owner_staff_id, created_at, updated_at
  ) values (
    p_job_no, left(btrim(p_title), 300), p_type, 'open',
    nullif(btrim(coalesce(p_product_sku, '')), ''), p_quantity,
    nullif(left(btrim(coalesce(p_description, '')), 3000), ''),
    p_estimated_value_thb,
    coalesce(nullif(btrim(coalesce(p_created_by, '')), ''), nullif(btrim(coalesce(p_actor_name, '')), '')),
    p_severity, v_due, p_actor_id, now(), now()
  ) returning id into v_id;

  insert into public.floor_ncr_events(ncr_id, event_type, to_status, actor_id, detail)
  values (v_id, 'created', 'open', p_actor_id, jsonb_build_object('severity', p_severity, 'dueAt', v_due));

  return v_id;
end;
$function$;

comment on function public.create_floor_ncr_as(uuid, text, text, text, text, text, numeric, text, numeric, text, text) is
  'แกนกลางของการเปิด NC — insert เข้า ncr_reports ที่เดียวของทั้งระบบ รับผู้กระทำเข้ามาแทนการอ่าน auth.uid() '
  'เรียกได้เฉพาะจากฟังก์ชัน security definer ตัวอื่น (create_floor_ncr และ record_technician_item_receipt) เท่านั้น';

create or replace function public.create_floor_ncr(
  p_job_no text, p_title text, p_type text, p_product_sku text default null,
  p_quantity numeric default null, p_description text default null,
  p_estimated_value_thb numeric default null, p_created_by text default null,
  p_severity text default 'medium'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active
    and role in ('admin', 'head_technician', 'warehouse', 'cs');
  if v_actor.id is null then raise exception 'NCR permission required'; end if;

  return public.create_floor_ncr_as(
    v_actor.id, v_actor.full_name, p_job_no, p_title, p_type, p_product_sku,
    p_quantity, p_description, p_estimated_value_thb, p_created_by, p_severity
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) ด่านของหน้าช่าง — token + PIN + ใบมอบหมายที่ยัง active (แพตเทิร์นเดียวกับ RPC อื่นของหน้านั้น)
-- ---------------------------------------------------------------------------
create or replace function public.technician_assignment_guard(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid
) returns public.appointment_technicians
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_assignment public.appointment_technicians%rowtype;
begin
  select a.* into v_assignment
  from public.appointment_technicians a
  join public.floor_technicians t on t.id = a.technician_id
  where a.id = p_assignment_id
    and a.is_active
    and t.is_active
    and t.personal_token = p_token
    and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash;
  if v_assignment.id is null then
    raise exception 'assignment not found';
  end if;
  return v_assignment;
end;
$function$;

comment on function public.technician_assignment_guard(uuid, text, uuid) is
  'ด่านเดียวกับ get_technician_job_checklist / get_technician_work_order_v2: token ตรง PIN ถูก และใบมอบหมายยัง active '
  '— ข้อความ error เหมือนเดิมทุกกรณีเพื่อไม่ให้แยกออกว่า token ผิด PIN ผิด หรือใบมอบหมายถูกยกเลิก';

-- ---------------------------------------------------------------------------
-- 5) ทางอ่านของหน้าช่าง: บรรทัดที่ต้องตรวจรับ + สิ่งที่คลังบอกว่าจ่ายมา + ผลที่เคยยืนยันไว้
-- ---------------------------------------------------------------------------
create or replace function public.get_technician_receipt_lines(
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
    return jsonb_build_object(
      'found', false, 'reason', 'no_work_order',
      'reasonOptions', public.floor_receipt_reason_catalog(), 'lines', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'workOrderId', v_order.id,
    'workOrderStatus', v_order.status,
    'jobNo', v_order.job_no,
    -- ยืนยันการรับของได้เฉพาะหลังคลังจ่ายของแล้ว และก่อนงานจบ ที่นอกช่วงนี้หน้าจอจะแสดงเหตุผลแทนปุ่ม
    'canConfirm', v_order.status in ('ready_to_install', 'installing'),
    'reasonOptions', public.floor_receipt_reason_catalog(),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.id,
        'category', i.category,
        'itemName', i.item_name,
        'sku', i.sku,
        'specification', i.specification,
        'unit', i.unit,
        'note', i.note,
        'plannedQty', i.planned_qty,
        'actualQty', i.actual_qty,
        'pickedQty', i.picked_qty,
        'pickStatus', i.pick_status,
        'pickNote', i.pick_note,
        'expectedQty', coalesce(i.picked_qty, i.actual_qty, i.planned_qty),
        'receipt', case when r.id is null then null else jsonb_build_object(
          'status', r.receipt_status,
          'receivedQty', r.received_qty,
          'expectedQty', r.expected_qty,
          'shortageQty', r.shortage_qty,
          'reasonCode', r.reason_code,
          'reasonNote', r.reason_note,
          'ncrId', r.ncr_id,
          'technicianName', r.technician_name,
          'confirmedAt', r.confirmed_at
        ) end
      ) order by i.sort_order, i.created_at)
      from public.floor_work_order_items i
      left join public.floor_work_order_item_receipts r on r.item_id = i.id
      where i.work_order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function public.get_technician_receipt_lines(uuid, text, uuid) is
  'รายการที่ช่างต้องตรวจรับหน้างานของใบมอบหมายนั้น พร้อมสิ่งที่คลังบันทึกว่าหยิบให้ และผลตรวจรับที่เคยยืนยันไว้ '
  '— อ่านอย่างเดียว คืนเฉพาะงานของผู้เรียก และไม่เปิดสิทธิ์ตารางใดให้ anon';

-- ---------------------------------------------------------------------------
-- 6) ทางเขียนของหน้าช่าง: ยืนยันรับของหนึ่งบรรทัด + เปิด/อัปเดต NC ให้เองเมื่อไม่ครบ
-- ---------------------------------------------------------------------------
create or replace function public.record_technician_item_receipt(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_item_id uuid,
  p_receipt_status text,
  p_received_qty numeric default null,
  p_reason_code text default null,
  p_reason_note text default null
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
  v_existing public.floor_work_order_item_receipts%rowtype;
  v_status text := btrim(coalesce(p_receipt_status, ''));
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_reason_entry jsonb;
  v_expected numeric;
  v_received numeric;
  v_shortage numeric;
  v_ncr_id uuid;
  v_ncr_type text;
  v_ncr_error text;
  v_title text;
  v_description text;
  v_reason_label text;
  v_receipt_id uuid;
begin
  v_assignment := public.technician_assignment_guard(p_token, p_pin, p_assignment_id);
  select * into v_tech from public.floor_technicians where id = v_assignment.technician_id;

  -- ล็อกใบสั่งงานก่อน แล้วค่อยล็อกบรรทัด — ลำดับเดียวกับ job_prep_edit_guard และ warehouse_pick_guard
  -- ทางเขียนทั้งหมดของ floor_work_order_items จึงเข้าคิวเดียวกัน ไม่มีทางจับล็อกสวนทางกันจนตาย
  select * into v_order from public.floor_work_orders
  where appointment_id = v_assignment.appointment_id for update;
  if v_order.id is null then
    raise exception 'ยังไม่มีใบสั่งงานของนัดหมายนี้ จึงยืนยันรับของไม่ได้';
  end if;
  if v_order.status not in ('ready_to_install', 'installing') then
    raise exception 'ยืนยันรับของได้เฉพาะเมื่อคลังจ่ายของแล้วและงานยังไม่จบ (สถานะปัจจุบัน: %)', v_order.status;
  end if;

  -- ด่านที่สำคัญที่สุดของทางเขียนนี้: บรรทัดต้องอยู่ในใบสั่งงานของนัดหมายที่ช่างคนนี้ถืออยู่จริง
  -- ถ้าไม่ตรวจ ช่างที่มี token+PIN ถูกต้องจะเขียนทับผลตรวจรับของงานคนอื่นได้ทั้งฐานข้อมูล
  select * into v_line from public.floor_work_order_items
  where id = p_item_id and work_order_id = v_order.id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการนี้ในใบสั่งงานของคุณ';
  end if;

  if v_status not in ('received_full', 'received_partial', 'not_received') then
    raise exception 'สถานะการรับของต้องเป็น received_full, received_partial หรือ not_received เท่านั้น (ได้รับ: %)',
      coalesce(nullif(v_status, ''), '(ว่าง)');
  end if;

  v_expected := coalesce(v_line.picked_qty, v_line.actual_qty, v_line.planned_qty);

  if v_status = 'received_full' then
    v_received := v_expected;
    -- ได้ครบแล้วไม่ต้องมีเหตุผล และถ้าเผลอส่งมาก็ทิ้ง ไม่เก็บเหตุผลที่ขัดกับสถานะ
    v_reason := null;
    v_note := null;
  elsif v_status = 'not_received' then
    v_received := 0;
  else
    if p_received_qty is null then
      raise exception 'ได้รับไม่ครบต้องระบุจำนวนที่ได้รับจริง';
    end if;
    if p_received_qty <= 0 then
      raise exception 'จำนวนที่ได้รับต้องมากกว่า 0 — ถ้าไม่ได้รับเลยให้เลือก "ไม่ได้รับ"';
    end if;
    if p_received_qty >= v_expected then
      raise exception 'จำนวนที่ได้รับ (%) ไม่น้อยกว่าจำนวนที่คลังจ่ายมา (%) — ถ้าได้ครบให้เลือก "ได้ครบ"',
        p_received_qty, v_expected;
    end if;
    v_received := p_received_qty;
  end if;

  v_shortage := greatest(v_expected - v_received, 0);

  if v_status <> 'received_full' then
    if v_reason is null then
      raise exception 'ของไม่ครบต้องระบุเหตุผล เพราะเหตุผลคือสิ่งเดียวที่ทำให้แก้ต้นตอได้';
    end if;
    select e.value into v_reason_entry
      from jsonb_array_elements(public.floor_receipt_reason_catalog()) as e(value)
     where e.value->>'code' = v_reason;
    if v_reason_entry is null then
      raise exception 'ไม่รู้จักเหตุผล "%" — เลือกจากรายการที่ระบบให้มาเท่านั้น', v_reason;
    end if;
    if v_reason = 'other' and v_note is null then
      raise exception 'เลือก "อื่น ๆ" ต้องพิมพ์อธิบายด้วย';
    end if;
    v_ncr_type := v_reason_entry->>'ncrType';
    v_reason_label := v_reason_entry->>'label';
  end if;

  select * into v_existing from public.floor_work_order_item_receipts
  where item_id = v_line.id for update;

  -- ------------------------------------------------------------------
  -- NC: เปิดใบใหม่เฉพาะเมื่อบรรทัดนี้ยังไม่เคยมี NC เท่านั้น
  -- ถ้ามีอยู่แล้วให้ "อัปเดตใบเดิม" — ช่างแก้บรรทัดเดิมกี่ครั้งก็ยังเป็น NC ใบเดียว
  -- ------------------------------------------------------------------
  v_ncr_id := v_existing.ncr_id;

  if v_status <> 'received_full' then
    v_title := left(format('ของไม่ครบหน้างาน · %s · %s', v_line.item_name, v_order.job_no), 300);
    v_description := format(
      '[logistics] ช่างแจ้งของไม่ครบตอนรับของหน้างาน'
      || E'\n' || 'งาน: %s · รายการ: %s%s'
      || E'\n' || 'คลังจ่ายมา %s %s · ช่างได้รับ %s %s · ขาด %s %s'
      || E'\n' || 'เหตุผลที่ช่างเลือก: %s (%s)'
      || E'\n' || 'หมายเหตุจากช่าง: %s'
      || E'\n' || 'คลังบันทึกไว้ตอนหยิบ: %s%s'
      || E'\n' || 'ผู้แจ้ง: %s (ช่างหน้างาน) · ใบมอบหมาย %s'
      || E'\n' || 'สาเหตุหลัก: โลจิสติกส์ (logistics) — ncr_reports.type ยังไม่มีค่านี้ จึงบันทึกไว้ในคำอธิบายจนกว่าจะมีคอลัมน์ cause_code',
      v_order.job_no, v_line.item_name, coalesce(' (' || v_line.sku || ')', ''),
      v_expected, v_line.unit, v_received, v_line.unit, v_shortage, v_line.unit,
      v_reason_label, v_reason,
      coalesce(v_note, '—'),
      coalesce(v_line.pick_status, 'ไม่ได้บันทึกรายบรรทัด'), coalesce(' · ' || v_line.pick_note, ''),
      coalesce(v_tech.name, 'ไม่ทราบชื่อ'), v_assignment.id
    );

    if v_ncr_id is null then
      begin
        -- ผู้รับผิดชอบตั้งต้น = พนักงานคลังที่รับใบนี้ไป เพราะเป็นคนเดียวที่ตอบได้ว่าของหายไปตอนไหน
        -- (null ได้ ถ้ายังไม่มีใครรับ — ncr_reports.owner_staff_id เป็น nullable อยู่แล้ว)
        v_ncr_id := public.create_floor_ncr_as(
          v_order.warehouse_assignee_id,
          coalesce(v_tech.name, 'ช่างหน้างาน'),
          v_order.job_no,
          v_title,
          v_ncr_type,
          v_line.sku,
          v_shortage,
          v_description,
          null,
          coalesce(v_tech.name, 'ช่างหน้างาน'),
          'medium'
        );
      exception when others then
        -- ผลตรวจรับของช่างสำคัญกว่าการเปิด NC สำเร็จ ถ้า NC เปิดไม่ได้ (เช่น job_no ไม่มีใน install_jobs)
        -- ต้องไม่ทำให้สิ่งที่ช่างเพิ่งกรอกหน้างานหายไปทั้งก้อน — บันทึกผลไว้ แล้วบอกตรง ๆ ว่า NC ไม่ได้เปิด
        v_ncr_id := null;
        v_ncr_error := sqlerrm;
      end;
    else
      update public.ncr_reports
      set title = v_title,
          type = v_ncr_type,
          product_sku = nullif(btrim(coalesce(v_line.sku, '')), ''),
          quantity = v_shortage,
          description = nullif(left(btrim(v_description), 3000), ''),
          updated_at = now()
      where id = v_ncr_id;

      insert into public.floor_ncr_events(ncr_id, event_type, actor_id, detail)
      values (v_ncr_id, 'technician_receipt_updated', null, jsonb_build_object(
        'itemId', v_line.id, 'receiptStatus', v_status, 'expectedQty', v_expected,
        'receivedQty', v_received, 'shortageQty', v_shortage,
        'reasonCode', v_reason, 'technician', v_tech.name, 'cause', 'logistics'
      ));
    end if;
  elsif v_ncr_id is not null then
    -- ช่างแก้กลับเป็น "ได้ครบ" — ไม่ปิด NC ให้เอง เพราะการปิดต้องมีคนตรวจว่าของมาถึงจริง
    -- (advance_floor_ncr บังคับให้เดินสถานะทีละขั้นโดยคนอยู่แล้ว) แต่ต้องทิ้งร่องรอยว่าตัวเลขเปลี่ยน
    insert into public.floor_ncr_events(ncr_id, event_type, actor_id, detail)
    values (v_ncr_id, 'technician_receipt_updated', null, jsonb_build_object(
      'itemId', v_line.id, 'receiptStatus', v_status, 'expectedQty', v_expected,
      'receivedQty', v_received, 'shortageQty', 0,
      'technician', v_tech.name, 'cause', 'logistics',
      'note', 'ช่างแก้เป็นได้รับครบภายหลัง — NC ยังเปิดอยู่ รอคนตรวจแล้วปิดเอง'
    ));
  end if;

  if v_existing.id is null then
    insert into public.floor_work_order_item_receipts(
      item_id, work_order_id, job_no, assignment_id, technician_id, technician_name,
      receipt_status, expected_qty, received_qty, shortage_qty, reason_code, reason_note, ncr_id
    ) values (
      v_line.id, v_order.id, v_order.job_no, v_assignment.id, v_tech.id,
      coalesce(v_tech.name, 'ช่างหน้างาน'),
      v_status, v_expected, v_received, v_shortage, v_reason, v_note, v_ncr_id
    ) returning id into v_receipt_id;
  else
    update public.floor_work_order_item_receipts
    set receipt_status = v_status,
        expected_qty = v_expected,
        received_qty = v_received,
        shortage_qty = v_shortage,
        reason_code = v_reason,
        reason_note = v_note,
        ncr_id = v_ncr_id,
        assignment_id = v_assignment.id,
        technician_id = v_tech.id,
        technician_name = coalesce(v_tech.name, 'ช่างหน้างาน'),
        confirmed_at = now(),
        updated_at = now()
    where id = v_existing.id
    returning id into v_receipt_id;
  end if;

  return jsonb_build_object(
    'receiptId', v_receipt_id,
    'itemId', v_line.id,
    'status', v_status,
    'expectedQty', v_expected,
    'receivedQty', v_received,
    'shortageQty', v_shortage,
    'reasonCode', v_reason,
    'reasonNote', v_note,
    'ncrId', v_ncr_id,
    'ncrCreated', (v_ncr_id is not null and v_existing.ncr_id is null),
    'ncrError', v_ncr_error
  );
end;
$function$;

comment on function public.record_technician_item_receipt(uuid, text, uuid, uuid, text, numeric, text, text) is
  'ช่างยืนยันรับของหนึ่งบรรทัดหน้างาน (token+PIN) — ของไม่ครบบังคับให้เลือกเหตุผล และเปิด NC ให้เองผ่าน create_floor_ncr_as '
  'ด้วย type ที่ใกล้เคียงที่สุด (missing/damage/wrong) โดยพา "logistics" ไปกับ description '
  'แก้บรรทัดเดิมซ้ำจะอัปเดต NC ใบเดิมเสมอ ไม่เปิดใบใหม่ (unique(item_id) เป็นคนบังคับ)';

-- ---------------------------------------------------------------------------
-- 7) สิทธิ์
--    create_floor_ncr_as: ไม่ให้ใครเรียกตรงเลย เรียกได้เฉพาะจาก security definer ตัวอื่น
--    RPC ของหน้าช่าง: ให้ anon เรียกได้ตามแพตเทิร์นเดิมของหน้านั้น (ด่านจริงคือ token+PIN ในตัวฟังก์ชัน)
-- ---------------------------------------------------------------------------
revoke all on function public.create_floor_ncr_as(uuid, text, text, text, text, text, numeric, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.technician_assignment_guard(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.create_floor_ncr(text, text, text, text, numeric, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.create_floor_ncr(text, text, text, text, numeric, text, numeric, text, text) to authenticated;

revoke all on function public.floor_receipt_reason_catalog() from public;
grant execute on function public.floor_receipt_reason_catalog() to anon, authenticated, service_role;

revoke all on function public.get_technician_receipt_lines(uuid, text, uuid) from public;
grant execute on function public.get_technician_receipt_lines(uuid, text, uuid) to anon, authenticated, service_role;

revoke all on function public.record_technician_item_receipt(uuid, text, uuid, uuid, text, numeric, text, text) from public;
grant execute on function public.record_technician_item_receipt(uuid, text, uuid, uuid, text, numeric, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

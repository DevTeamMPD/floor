-- P5-8 — ใบสั่งซื้อที่บอกได้ว่า "เราสั่งอะไร ต้องได้เมื่อไร และของแบบไหนถึงจะรับ" (ISO 9001:2015 ข้อ 8.4.3)
--
-- สภาพก่อนหน้า: purchase_orders และ po_items มีตารางอยู่แต่ 0 แถวทั้งคู่ และหน้าจอเดิม
-- (app/(admin)/purchase-orders/page.tsx) เขียนตารางตรงจาก client โดยไม่มีด่านอะไรเลย
-- ที่สำคัญกว่านั้นคือ "ข้อกำหนดที่ผู้ขายต้องทำได้" ไม่มีที่เก็บ — 8.4.3 ต้องการให้เราสื่อสาร
-- ข้อกำหนดกับผู้ให้บริการก่อนสั่ง ไม่ใช่ไปเถียงกันตอนของมาถึงแล้วว่าตกลงกันว่าอะไร
--
-- สิ่งที่ใบสั่งซื้อหนึ่งใบต้องตอบได้ตาม 8.4.3 และคอลัมน์ที่รับหน้าที่นั้น:
--   ซื้อจากใคร              supplier_id            (มีอยู่แล้ว — ตอนนี้บังคับว่าต้องเป็นรายที่อนุมัติแล้ว)
--   ซื้ออะไร เท่าไร          po_items.material_id/qty_ordered  (มีอยู่แล้ว)
--   ราคาที่ตกลง             po_items.unit_price / total_amount (มีอยู่แล้ว)
--   ต้องได้ของเมื่อไร        required_date          <- ใหม่ (คนละตัวกับ eta ซึ่งคือวันที่ "ผู้ขายบอกว่าจะส่ง")
--   ของแบบไหนถึงจะรับ       acceptance_requirements <- ใหม่ (ระดับใบ) + po_items.acceptance_spec (ระดับรายการ)
--   ใครสั่ง ใครออกใบ         created_by / issued_by  <- ใหม่
--
-- ทำไม required_date ต้องแยกจาก eta: eta คือคำสัญญาของผู้ขาย ส่วน required_date คือความต้องการของเรา
-- สองค่านี้ต่างกันเมื่อผู้ขายรับปากไม่ทัน และ "ความต่าง" นั้นเองคือข้อมูลที่ใช้ประเมินผู้ขาย
-- ถ้าเก็บช่องเดียวแล้วให้คนแก้ทับ ข้อมูลนั้นจะหายไปทุกครั้งที่ผู้ขายเลื่อน
--
-- additive ล้วน: ทั้งสองตารางมี 0 แถว การเพิ่มคอลัมน์และ check constraint จึงไม่กระทบข้อมูลใด
-- ไม่ลบ ไม่เปลี่ยนชื่อ ไม่แตะ purchase_orders_status_check เดิม (draft/ordered/partial/received/cancelled ยังเป็นชุดเดิม)

begin;

-- ---------------------------------------------------------------------------
-- 1) คอลัมน์ที่ 8.4.3 เรียกหา
-- ---------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists required_date date,
  add column if not exists acceptance_requirements text,
  add column if not exists job_no text,
  add column if not exists created_by uuid,
  add column if not exists created_by_name text,
  add column if not exists issued_at timestamptz,
  add column if not exists issued_by uuid,
  add column if not exists issued_by_name text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_name text,
  add column if not exists cancel_reason text,
  add column if not exists inspection_sample_pct numeric;

alter table public.po_items
  add column if not exists acceptance_spec text,
  add column if not exists qty_rejected numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='purchase_orders_job_no_fkey' and conrelid='public.purchase_orders'::regclass) then
    alter table public.purchase_orders add constraint purchase_orders_job_no_fkey
      foreign key (job_no) references public.install_jobs(job_no);
  end if;
  if not exists (select 1 from pg_constraint where conname='purchase_orders_created_by_fkey' and conrelid='public.purchase_orders'::regclass) then
    alter table public.purchase_orders add constraint purchase_orders_created_by_fkey
      foreign key (created_by) references public.floor_staff_profiles(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='purchase_orders_issued_by_fkey' and conrelid='public.purchase_orders'::regclass) then
    alter table public.purchase_orders add constraint purchase_orders_issued_by_fkey
      foreign key (issued_by) references public.floor_staff_profiles(id);
  end if;

  -- ด่านของ 8.4.3 ระดับโครงสร้าง: ใบที่ "ออกไปถึงผู้ขายแล้ว" ต้องมีข้อกำหนดครบเสมอ
  -- ร่างที่ยังไม่ส่ง (issued_at = null) กรอกไม่ครบได้ เพราะยังไม่ได้สื่อสารกับใคร
  if not exists (select 1 from pg_constraint where conname='purchase_orders_issued_needs_requirements' and conrelid='public.purchase_orders'::regclass) then
    alter table public.purchase_orders add constraint purchase_orders_issued_needs_requirements
      check (
        issued_at is null
        or (
          supplier_id is not null
          and required_date is not null
          and btrim(coalesce(acceptance_requirements,'')) <> ''
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname='purchase_orders_po_number_not_blank' and conrelid='public.purchase_orders'::regclass) then
    alter table public.purchase_orders add constraint purchase_orders_po_number_not_blank check (btrim(po_number) <> '');
  end if;

  -- po_items ไม่เคยมี check เลย (บันทึกไว้ใน recon C15) — ตารางว่าง จึงเติมได้โดยไม่กระทบใคร
  -- ไม่ใส่กฎ "รับได้ไม่เกินที่สั่ง" ไว้ตรงนี้โดยตั้งใจ: ของมาเกินเป็นเหตุการณ์จริงที่เกิดได้
  -- และต้องถูกปฏิเสธด้วยข้อความไทยที่บอกว่าเกินไปเท่าไร ซึ่ง check constraint ทำไม่ได้ (ดู P5-9)
  if not exists (select 1 from pg_constraint where conname='po_items_qty_ordered_positive' and conrelid='public.po_items'::regclass) then
    alter table public.po_items add constraint po_items_qty_ordered_positive check (qty_ordered > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='po_items_qty_nonneg' and conrelid='public.po_items'::regclass) then
    alter table public.po_items add constraint po_items_qty_nonneg
      check (coalesce(qty_received,0) >= 0 and qty_rejected >= 0 and (unit_price is null or unit_price >= 0));
  end if;
end $$;

create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id) where supplier_id is not null;
create index if not exists purchase_orders_job_no_idx on public.purchase_orders(job_no) where job_no is not null;
create index if not exists po_items_po_id_idx on public.po_items(po_id);

comment on column public.purchase_orders.required_date is
  'วันที่ "เราต้องได้ของ" ตามข้อกำหนดของเรา — คนละตัวกับ eta ที่เป็นวันที่ผู้ขายรับปากว่าจะส่ง '
  'ความต่างระหว่างสองค่านี้คือข้อมูลที่ใช้ประเมินผู้ขายภายหลัง';
comment on column public.purchase_orders.acceptance_requirements is
  'ข้อกำหนดการตรวจรับที่ผู้ขายต้องทำได้ (ISO 8.4.3) — เช่น เอกสารที่ต้องแนบ วิธีบรรจุ เกณฑ์ที่ถือว่าไม่ผ่าน '
  'ว่างไม่ได้เมื่อใบถูกออกไปถึงผู้ขายแล้ว (purchase_orders_issued_needs_requirements)';
comment on column public.purchase_orders.job_no is
  'งานติดตั้งที่ใบสั่งซื้อนี้ซื้อเพื่อ (ถ้ามี) — ใช้ผูก NC ที่เกิดจากของไม่ผ่านตรวจรับกลับไปหางาน '
  'null = ซื้อเข้าสต็อกกลาง ไม่ได้ผูกกับงานใด';
comment on column public.purchase_orders.inspection_sample_pct is
  'สัดส่วนการสุ่มตรวจที่คัดลอกมาจากทะเบียนผู้ให้บริการ ณ วันที่ออกใบ — เก็บไว้กับใบเพื่อให้ย้อนดูได้ว่า '
  'ตอนนั้นตกลงกันว่าสุ่มเท่าไร แม้ทะเบียนจะถูกแก้ทีหลัง';
comment on column public.po_items.acceptance_spec is
  'ข้อกำหนดการตรวจรับเฉพาะของรายการนี้ เช่น ค่าความชื้น ความหนา หรือรุ่นที่ยอมรับได้';
comment on column public.po_items.qty_rejected is
  'จำนวนที่ตรวจรับแล้วไม่ผ่านและถูกปฏิเสธ — ของกลุ่มนี้ไม่เข้าคลังและไม่มีบรรทัดในสมุดสต็อก (P5-9)';

-- ---------------------------------------------------------------------------
-- 2) เลขใบสั่งซื้อ — ออกฝั่งเซิร์ฟเวอร์เสมอ
--    ของเดิมสุ่มเลขที่ฝั่งหน้าจอ (PO{yymmdd}-{rand 3 หลัก}) ซึ่งชนกันได้เงียบ ๆ และเรียงไม่ได้
-- ---------------------------------------------------------------------------
create or replace function public.next_purchase_order_number()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prefix text := 'PO-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYYYMM') || '-';
  v_seq int;
begin
  select coalesce(max(nullif(regexp_replace(po_number, '^' || v_prefix, ''), '')::int), 0) + 1
    into v_seq
  from public.purchase_orders
  where po_number like v_prefix || '%'
    and po_number ~ ('^' || v_prefix || '[0-9]+$');

  return v_prefix || lpad(v_seq::text, 4, '0');
end;
$function$;

comment on function public.next_purchase_order_number() is
  'เลขใบสั่งซื้อรูปแบบ PO-YYYYMM-#### ออกจากเซิร์ฟเวอร์ เรียงตามเดือนและไม่ชนกันเอง '
  '(unique index บน po_number เป็นด่านสุดท้าย ถ้ามีสองคนกดพร้อมกัน ผู้เรียกจะลองใหม่)';

revoke all on function public.next_purchase_order_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) ด่านตรวจผู้ให้บริการก่อนสั่งซื้อ — ใช้ร่วมกับ P5-10
-- ---------------------------------------------------------------------------
create or replace function public.assert_provider_can_take_new_work(p_provider_id uuid, p_need text)
returns public.suppliers
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v public.suppliers%rowtype;
begin
  select * into v from public.suppliers where id = p_provider_id;
  if v.id is null then
    raise exception 'ไม่พบผู้ให้บริการที่เลือกในทะเบียน';
  end if;
  if v.approval_status = 'suspended' then
    raise exception 'ผู้ให้บริการ "%" ถูกระงับการรับงานใหม่ตั้งแต่ % โดย % เหตุผล: % — ต้องคืนสิทธิ์ก่อนจึงจะมอบงานใหม่ได้',
      v.name, to_char(v.suspended_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY'),
      coalesce(v.suspended_by_name, 'ไม่ระบุ'), coalesce(v.suspension_reason, 'ไม่ระบุ');
  end if;
  if v.approval_status <> 'approved' then
    raise exception 'ผู้ให้บริการ "%" ยังไม่ผ่านการอนุมัติ (สถานะ: %) จึงยังมอบงานใหม่ให้ไม่ได้', v.name, v.approval_status;
  end if;
  if not v.is_active then
    raise exception 'ผู้ให้บริการ "%" ถูกปิดการใช้งานอยู่', v.name;
  end if;
  if p_need is not null and coalesce(v.provider_kind,'') not in (p_need, 'both') then
    if p_need = 'material' then
      raise exception 'ผู้ให้บริการ "%" ขึ้นทะเบียนไว้เป็นทีมรับเหมาติดตั้ง ไม่ใช่ผู้ขายวัสดุ จึงออกใบสั่งซื้อให้ไม่ได้', v.name;
    else
      raise exception 'ผู้ให้บริการ "%" ขึ้นทะเบียนไว้เป็นผู้ขายวัสดุ ไม่ใช่ทีมรับเหมาติดตั้ง', v.name;
    end if;
  end if;
  return v;
end;
$function$;

comment on function public.assert_provider_can_take_new_work(uuid, text) is
  'ด่านเดียวที่ตอบว่า "รายนี้รับงานใหม่ได้ไหม" — อนุมัติแล้ว ยังใช้งานอยู่ ไม่ถูกระงับ และตรงพันธุ์ที่ต้องการ '
  'ใช้ทั้งตอนออกใบสั่งซื้อ (material) และตอนมอบงานติดตั้ง (labor) เพื่อไม่ให้มีกฎสองชุด';

revoke all on function public.assert_provider_can_take_new_work(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) สร้างใบสั่งซื้อ — ทางเขียนเดียว
-- ---------------------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_required_date date,
  p_acceptance_requirements text,
  p_items jsonb,
  p_eta date default null,
  p_notes text default null,
  p_job_no text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_provider public.suppliers%rowtype;
  v_po_id uuid;
  v_po_number text;
  v_row jsonb;
  v_material public.materials%rowtype;
  v_qty numeric;
  v_price numeric;
  v_total numeric := 0;
  v_count int := 0;
  v_req text := nullif(btrim(coalesce(p_acceptance_requirements,'')), '');
  v_attempt int := 0;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'ออกใบสั่งซื้อ');

  if p_supplier_id is null then
    raise exception 'ต้องเลือกผู้ให้บริการที่จะสั่งซื้อ — ใบสั่งซื้อที่ไม่รู้ว่าส่งถึงใคร ไม่ใช่ข้อกำหนดที่สื่อสารได้';
  end if;
  v_provider := public.assert_provider_can_take_new_work(p_supplier_id, 'material');

  if p_required_date is null then
    raise exception 'ต้องระบุวันที่ต้องได้ของ';
  end if;
  if p_required_date < (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'วันที่ต้องได้ของเป็นวันในอดีตไม่ได้';
  end if;
  if v_req is null then
    raise exception 'ต้องระบุข้อกำหนดการตรวจรับ — ISO 8.4.3 บังคับให้บอกผู้ขายก่อนสั่งว่า "ของแบบไหนถึงจะรับ"';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ใบสั่งซื้อต้องมีรายการอย่างน้อยหนึ่งรายการ';
  end if;
  if p_job_no is not null and not exists (select 1 from public.install_jobs where job_no = p_job_no) then
    raise exception 'ไม่พบเลขงาน % ในทะเบียนงานติดตั้ง', p_job_no;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_po_number := public.next_purchase_order_number();
    begin
      insert into public.purchase_orders(
        po_number, supplier_id, status, eta, required_date, acceptance_requirements,
        job_no, notes, total_amount, created_by, created_by_name,
        inspection_sample_pct, created_at, updated_at
      ) values (
        v_po_number, p_supplier_id, 'draft', p_eta, p_required_date, v_req,
        p_job_no, nullif(btrim(coalesce(p_notes,'')),''), 0, v_actor.id, v_actor.full_name,
        v_provider.inspection_sample_pct, now(), now()
      ) returning id into v_po_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'ออกเลขใบสั่งซื้อไม่สำเร็จเพราะมีคนสร้างพร้อมกันหลายครั้ง กรุณากดใหม่อีกครั้ง';
      end if;
    end;
  end loop;

  for v_row in select value from jsonb_array_elements(p_items) loop
    select * into v_material from public.materials where id = nullif(v_row->>'materialId','')::uuid;
    if v_material.id is null then
      raise exception 'ไม่พบวัสดุที่เลือกในรายการที่ % — อาจถูกลบไปแล้ว', v_count + 1;
    end if;
    v_qty := coalesce((v_row->>'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'จำนวนที่สั่งของ "%" ต้องมากกว่า 0', v_material.name;
    end if;
    v_price := coalesce((v_row->>'unitPrice')::numeric, v_material.unit_cost, 0);
    if v_price < 0 then
      raise exception 'ราคาต่อหน่วยของ "%" ติดลบไม่ได้', v_material.name;
    end if;

    insert into public.po_items(po_id, material_id, qty_ordered, qty_received, qty_rejected, unit_price, note, acceptance_spec)
    values (
      v_po_id, v_material.id, v_qty, 0, 0, v_price,
      nullif(btrim(coalesce(v_row->>'note','')),''),
      nullif(btrim(coalesce(v_row->>'acceptanceSpec','')),'')
    );

    v_total := v_total + v_qty * v_price;
    v_count := v_count + 1;
  end loop;

  update public.purchase_orders set total_amount = v_total, updated_at = now() where id = v_po_id;

  return jsonb_build_object(
    'id', v_po_id, 'poNumber', v_po_number, 'itemCount', v_count,
    'totalAmount', v_total, 'providerName', v_provider.name, 'actorName', v_actor.full_name
  );
end;
$function$;

comment on function public.create_purchase_order(uuid, date, text, jsonb, date, text, text) is
  'สร้างใบสั่งซื้อพร้อมรายการทั้งใบในธุรกรรมเดียว (role admin/warehouse) — ผู้ขายต้องอนุมัติแล้ว ไม่ถูกระงับ '
  'และเป็นชนิด material/both เท่านั้น บังคับวันที่ต้องได้ของและข้อกำหนดการตรวจรับตาม ISO 8.4.3';

-- ---------------------------------------------------------------------------
-- 5) ออกใบไปถึงผู้ขาย / ยกเลิกใบ
-- ---------------------------------------------------------------------------
create or replace function public.issue_purchase_order(p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_po public.purchase_orders%rowtype;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'ออกใบสั่งซื้อไปถึงผู้ขาย');

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if v_po.status <> 'draft' then
    raise exception 'ใบ % ไม่ได้อยู่ในสถานะร่างแล้ว (สถานะปัจจุบัน: %)', v_po.po_number, v_po.status;
  end if;
  if not exists (select 1 from public.po_items where po_id = p_po_id) then
    raise exception 'ใบ % ยังไม่มีรายการสินค้า จึงส่งให้ผู้ขายไม่ได้', v_po.po_number;
  end if;

  -- ถึงตอนกดส่งจริงถึงเช็คซ้ำ เพราะผู้ขายอาจถูกระงับหลังจากร่างใบไว้แล้ว
  perform public.assert_provider_can_take_new_work(v_po.supplier_id, 'material');

  update public.purchase_orders set
    status = 'ordered', issued_at = now(), issued_by = v_actor.id, issued_by_name = v_actor.full_name, updated_at = now()
  where id = p_po_id;

  return jsonb_build_object('id', p_po_id, 'poNumber', v_po.po_number, 'status', 'ordered', 'issuedByName', v_actor.full_name);
end;
$function$;

comment on function public.issue_purchase_order(uuid) is
  'เปลี่ยนใบสั่งซื้อจากร่างเป็น "สั่งแล้ว" พร้อมบันทึกผู้ออกใบและเวลา — ตรวจซ้ำว่าผู้ขายยังไม่ถูกระงับ ณ เวลาที่ส่งจริง';

create or replace function public.cancel_purchase_order(p_po_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_po public.purchase_orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'ยกเลิกใบสั่งซื้อ');
  if v_reason is null then raise exception 'การยกเลิกใบสั่งซื้อต้องระบุเหตุผล'; end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if v_po.status = 'cancelled' then raise exception 'ใบ % ถูกยกเลิกไปแล้ว', v_po.po_number; end if;
  if exists (select 1 from public.po_items where po_id = p_po_id and coalesce(qty_received,0) > 0) then
    raise exception 'ใบ % รับของเข้าคลังไปแล้วบางส่วน จึงยกเลิกทั้งใบไม่ได้ — ต้องปิดใบตามของที่รับจริง', v_po.po_number;
  end if;

  update public.purchase_orders set
    status = 'cancelled', cancelled_at = now(), cancelled_by_name = v_actor.full_name,
    cancel_reason = v_reason, updated_at = now()
  where id = p_po_id;

  return jsonb_build_object('id', p_po_id, 'poNumber', v_po.po_number, 'status', 'cancelled');
end;
$function$;

comment on function public.cancel_purchase_order(uuid, text) is
  'ยกเลิกใบสั่งซื้อพร้อมเหตุผลที่บังคับกรอก — ใบที่รับของเข้าคลังไปแล้วยกเลิกไม่ได้';

-- ---------------------------------------------------------------------------
-- 6) ตัวเลือกของฟอร์ม + ข้อมูลทั้งหน้าจอ
-- ---------------------------------------------------------------------------
create or replace function public.purchase_order_form_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_providers jsonb;
  v_materials jsonb;
  v_jobs jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะเปิดฟอร์มใบสั่งซื้อได้';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'providerKind', s.provider_kind,
      'leadTimeDays', s.lead_time_days, 'paymentTerms', s.payment_terms,
      'inspectionSamplePct', s.inspection_sample_pct
    ) order by s.name), '[]'::jsonb) into v_providers
  from public.suppliers s
  where s.approval_status = 'approved' and s.is_active and coalesce(s.provider_kind,'') in ('material','both');

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'sku', m.sku, 'name', m.name, 'unit', m.unit, 'unitCost', m.unit_cost,
      'qtyOnHand', m.qty_on_hand
    ) order by m.name), '[]'::jsonb) into v_materials
  from public.materials m;

  select coalesce(jsonb_agg(jsonb_build_object('jobNo', j.job_no, 'customer', j.customer_name) order by j.job_no desc), '[]'::jsonb)
    into v_jobs
  from (select job_no, customer_name from public.install_jobs order by job_no desc limit 300) j;

  return jsonb_build_object(
    'providers', v_providers,
    'materials', v_materials,
    'jobs', v_jobs,
    'providerTotal', (select count(*) from public.suppliers)::int,
    'materialProviderTotal', (select count(*) from public.suppliers where coalesce(provider_kind,'') in ('material','both'))::int
  );
end;
$function$;

comment on function public.purchase_order_form_options() is
  'ตัวเลือกของฟอร์มสร้างใบสั่งซื้อ — เฉพาะผู้ขายที่อนุมัติแล้วและยังไม่ถูกระงับ พร้อมจำนวนรวมในทะเบียน '
  'เพื่อให้หน้าจอบอกความต่างระหว่าง "ยังไม่มีใครในทะเบียน" กับ "มีแต่ยังไม่อนุมัติ" ได้';

revoke all on function public.create_purchase_order(uuid, date, text, jsonb, date, text, text) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, text, jsonb, date, text, text) to authenticated, service_role;

revoke all on function public.issue_purchase_order(uuid) from public, anon;
grant execute on function public.issue_purchase_order(uuid) to authenticated, service_role;

revoke all on function public.cancel_purchase_order(uuid, text) from public, anon;
grant execute on function public.cancel_purchase_order(uuid, text) to authenticated, service_role;

revoke all on function public.purchase_order_form_options() from public, anon;
grant execute on function public.purchase_order_form_options() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) สิทธิ์ระดับตาราง — ปิดรูที่ anon มีสิทธิ์ครบทุกอย่าง (รวม TRUNCATE) บนสองตารางนี้
--    ตรวจพบตอนสำรวจ: anon ถือ SELECT/INSERT/UPDATE/DELETE/TRUNCATE บนทั้ง purchase_orders
--    และ po_items ตั้งแต่ก่อน branch นี้ RLS กันชั้นแถวไว้ก็จริง แต่ TRUNCATE ไม่ผ่าน RLS
--    และ policy po_items.authenticated_all (for all using true) แปลว่าใครที่ล็อกอินก็เขียนได้หมด
--    ไม่ลบ policy เดิม (ห้ามลบของเดิม) แต่ถอน grant จนเหลือ select — ทางเขียนเดียวคือ RPC ข้างบน
-- ---------------------------------------------------------------------------
revoke all on public.purchase_orders from anon;
revoke all on public.po_items from anon;
revoke insert, update, delete, truncate on public.purchase_orders from authenticated;
revoke insert, update, delete, truncate on public.po_items from authenticated;
grant select on public.purchase_orders to authenticated;
grant select on public.po_items to authenticated;

-- po_items ยังไม่มี policy อ่านสำหรับพนักงานที่ชัดเจน (มีแต่ authenticated_all แบบ using true)
-- เพิ่ม policy อ่านตามแพตเทิร์นของโปรเจกต์ ไม่ลบของเดิม
drop policy if exists po_items_active_staff_read on public.po_items;
create policy po_items_active_staff_read on public.po_items
  for select to authenticated using ((select public.is_floor_staff_active()));

notify pgrst, 'reload schema';

commit;

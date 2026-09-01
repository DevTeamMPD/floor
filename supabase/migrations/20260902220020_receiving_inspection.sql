-- P5-9 — ตรวจรับของจากผู้ขาย: ลงสมุดสต็อก และเปิด NC เมื่อของไม่ผ่าน (ISO 9001:2015 ข้อ 8.4.2/8.6)
--
-- สภาพก่อนหน้า: หน้าจอ purchase-orders รับของด้วยการ update po_items.qty_received แล้ว
-- update materials.qty_on_hand แล้ว insert stock_movements ตรง ๆ จาก client ทีละคำสั่ง
-- ไม่มีธุรกรรม ไม่มีด่านสิทธิ์ ไม่มีที่บันทึกว่า "ตรวจแล้วผ่านหรือไม่ผ่าน" และถ้าของมีปัญหา
-- ก็ไม่มีอะไรเกิดขึ้นในระบบเลย — ผู้ขายที่ส่งของเสียซ้ำ ๆ จึงไม่ทิ้งร่องรอยไว้ที่ไหน
--
-- ของที่ไม่ผ่านต้องกลายเป็น "ใบ" ไม่ใช่ความทรงจำ:
--   ทุกครั้งที่มีจำนวนถูกปฏิเสธ ระบบเปิด NC ให้ "หนึ่งใบต่อหนึ่งครั้งที่รับของ" เสมอ
--   (ไม่ใช่ใบละรายการ — ของสามอย่างในรถคันเดียวกันที่มาไม่ได้มาตรฐาน คือเหตุการณ์เดียว
--    ที่ต้องคุยกับผู้ขายครั้งเดียว ถ้าแตกเป็นสามใบ คนตามงานจะไล่ปิดสามรอบโดยไม่ได้ประโยชน์)
--   cause_code = 'MATERIAL' เสมอ เพราะนี่คือแกน "ทำไมถึงเกิด" ที่ตรงกับความจริงของเส้นทางนี้:
--   ตัวสินค้าจากต้นทางไม่ได้มาตรฐาน (ดูแคตตาล็อกที่ 20260902200000_ncr_cause_code_and_provider.sql)
--   และ provider_id = ผู้ขายของใบสั่งซื้อนั้น ทำให้ NC ผูกกลับไปหาบริษัทที่ต้องรับผิดชอบได้จริง
--
-- ทำไมต้องมีเลขงาน (job_no) ตอนของไม่ผ่าน:
--   ncr_reports.job_no ในระบบนี้เป็นคอลัมน์บังคับที่มี FK ไป install_jobs และ create_floor_ncr_as
--   ปฏิเสธทุกคำขอที่ไม่มีเลขงานจริง — เป็นกติกาที่มีอยู่ก่อนงานนี้ ไม่ใช่สิ่งที่ไฟล์นี้เพิ่ม
--   ทางออกที่ซื่อสัตย์คือ "ถามให้ชัดว่าของล็อตนี้กระทบงานไหน" ไม่ใช่แอบสร้างงานปลอมให้ NC เกาะ
--   ใบสั่งซื้อที่ซื้อเพื่องานหนึ่ง ๆ (purchase_orders.job_no) จะเติมให้อัตโนมัติ
--
-- สมุดสต็อก: ใช้คำศัพท์และแพตเทิร์นเดียวกับ 20260902150000_job_stock_movement_ledger.sql
--   คือ "ปรับให้ตรง (sync)" ไม่ใช่ "เพิ่มรายการ (append)" + unique index กันนับซ้ำ
--   เพิ่มคำใหม่หนึ่งคำในคำศัพท์เดิม: movement_kind = 'po_receipt' คู่กับ type = 'in'
--   (type 'in' คือค่าที่ระบบนี้ใช้แปลว่า "ของเข้าคลัง" อยู่แล้ว — หน้า inventory คิด delta = +qty)
--   ของที่ถูกปฏิเสธ *ไม่มี* บรรทัดในสมุด เพราะมันไม่เคยเข้าคลัง — การลงบรรทัดแล้วหักออกทีหลัง
--   จะทำให้ยอดรับสะสมของผู้ขายดูดีกว่าความจริง
--
-- additive ล้วน: ตารางใหม่สองตาราง คอลัมน์ใหม่บน stock_movements (0 แถว)
-- และขยาย movement_kind check ที่ branch นี้เพิ่งเพิ่มเองใน 20260902150000 ให้รับคำใหม่

begin;

-- ---------------------------------------------------------------------------
-- 1) ขยายคำศัพท์ของสมุดสต็อก
-- ---------------------------------------------------------------------------
alter table public.stock_movements add column if not exists ref_po_receipt_line_id uuid;

comment on column public.stock_movements.ref_po_receipt_line_id is
  'บรรทัดของใบตรวจรับที่ทำให้เกิดการเคลื่อนไหวนี้ — คู่กับ movement_kind เป็น unique จึงนับซ้ำไม่ได้ '
  'แพตเทิร์นเดียวกับ ref_work_order_item_id ของเส้นทางงานติดตั้ง';

-- ---------------------------------------------------------------------------
-- 2) ตารางใบตรวจรับ
-- ---------------------------------------------------------------------------
create table if not exists public.po_receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete restrict,
  receipt_no text not null unique,
  received_at timestamptz not null default now(),
  received_by uuid references public.floor_staff_profiles(id),
  received_by_name text not null,
  -- ผลการตรวจ: pass = รับครบตามที่ตรวจ, partial_fail = มีบางส่วนไม่ผ่าน, fail = ไม่ผ่านทั้งหมดที่รับรอบนี้
  inspection_result text not null,
  sample_pct numeric,
  note text,
  defect_summary text,
  ncr_id uuid unique references public.ncr_reports(id),
  created_at timestamptz not null default now(),

  constraint po_receipts_receipt_no_not_blank check (btrim(receipt_no) <> ''),
  constraint po_receipts_received_by_name_not_blank check (btrim(received_by_name) <> ''),
  constraint po_receipts_result_check check (inspection_result in ('pass','partial_fail','fail')),
  constraint po_receipts_sample_pct_range check (sample_pct is null or (sample_pct >= 0 and sample_pct <= 100)),
  -- ผลไม่ผ่านต้องมีใบ NC เสมอ และผลผ่านต้องไม่มี — บังคับที่โครงสร้าง ไม่ใช่ที่มารยาทของโค้ด
  constraint po_receipts_fail_needs_ncr check (
    (inspection_result = 'pass' and ncr_id is null)
    or (inspection_result in ('partial_fail','fail') and ncr_id is not null)
  )
);

create table if not exists public.po_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.po_receipts(id) on delete cascade,
  po_item_id uuid not null references public.po_items(id) on delete restrict,
  qty_accepted numeric not null default 0,
  qty_rejected numeric not null default 0,
  defect_note text,
  created_at timestamptz not null default now(),

  constraint po_receipt_lines_qty_nonneg check (qty_accepted >= 0 and qty_rejected >= 0),
  constraint po_receipt_lines_qty_some check (qty_accepted + qty_rejected > 0),
  -- ของที่ปฏิเสธต้องบอกได้ว่าเสียตรงไหน ไม่งั้นผู้ขายจะเถียงไม่ได้และเราจะแก้อะไรไม่ได้
  constraint po_receipt_lines_reject_needs_note check (qty_rejected = 0 or btrim(coalesce(defect_note,'')) <> ''),
  constraint po_receipt_lines_one_per_item unique (receipt_id, po_item_id)
);

create index if not exists po_receipts_po_id_idx on public.po_receipts(po_id);
create index if not exists po_receipt_lines_receipt_id_idx on public.po_receipt_lines(receipt_id);
create index if not exists po_receipt_lines_po_item_id_idx on public.po_receipt_lines(po_item_id);

comment on table public.po_receipts is
  'ใบตรวจรับของจากผู้ขายหนึ่งครั้ง (ISO 8.4.2) — หนึ่งใบสั่งซื้อรับได้หลายครั้ง แต่ละครั้งมีผลตรวจของตัวเอง '
  'ครั้งที่มีของไม่ผ่านจะผูกกับ NC หนึ่งใบเสมอ (ncr_id unique)';
comment on column public.po_receipts.ncr_id is
  'ใบ NC ที่เปิดจากการตรวจรับครั้งนี้ — หนึ่งครั้งต่อหนึ่งใบ (unique) จึงไม่มีทางเปิดซ้ำหรือใช้ใบร่วมกัน';
comment on column public.po_receipts.sample_pct is
  'สัดส่วนที่สุ่มตรวจจริงในครั้งนี้ (%) — ค่าเริ่มต้นมาจาก suppliers.inspection_sample_pct ผ่านใบสั่งซื้อ';
comment on table public.po_receipt_lines is
  'จำนวนที่รับและที่ปฏิเสธของแต่ละรายการในการตรวจรับหนึ่งครั้ง — ของที่ปฏิเสธต้องมีคำอธิบายเสมอ';

alter table public.po_receipts enable row level security;
alter table public.po_receipt_lines enable row level security;

revoke all on public.po_receipts from anon, authenticated;
revoke all on public.po_receipt_lines from anon, authenticated;

grant select on public.po_receipts to authenticated;
grant select on public.po_receipt_lines to authenticated;

drop policy if exists po_receipts_active_staff_read on public.po_receipts;
create policy po_receipts_active_staff_read on public.po_receipts
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists po_receipt_lines_active_staff_read on public.po_receipt_lines;
create policy po_receipt_lines_active_staff_read on public.po_receipt_lines
  for select to authenticated using ((select public.is_floor_staff_active()));

-- ---------------------------------------------------------------------------
-- 3) ขยาย movement_kind ให้รับ 'po_receipt' — ค่าเดิมสามค่ายังอยู่ครบ
--    constraint นี้ถูกเพิ่มโดย branch เดียวกันนี้เอง (20260902150000) และตารางมี 0 แถว
-- ---------------------------------------------------------------------------
alter table public.stock_movements drop constraint if exists stock_movements_movement_kind_check;
alter table public.stock_movements
  add constraint stock_movements_movement_kind_check
  check (movement_kind is null or movement_kind in ('job_issue','job_return','job_consumption','po_receipt'));

create unique index if not exists stock_movements_po_receipt_line_kind_unique
  on public.stock_movements(ref_po_receipt_line_id, movement_kind)
  where ref_po_receipt_line_id is not null and movement_kind is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='stock_movements_ref_po_receipt_line_fkey' and conrelid='public.stock_movements'::regclass) then
    -- on delete set null ด้วยเหตุผลเดียวกับ ref_work_order_item_id: ประวัติของคลังต้องไม่หายไปกับใบ
    alter table public.stock_movements add constraint stock_movements_ref_po_receipt_line_fkey
      foreign key (ref_po_receipt_line_id) references public.po_receipt_lines(id) on delete set null;
  end if;
end $$;

comment on column public.stock_movements.movement_kind is
  'ความหมายทางธุรกิจของแถวนี้: job_issue = เบิกไปที่งาน (type out), job_return = คืนเข้าคลัง (type return), '
  'job_consumption = ใช้จริงที่หน้างาน (type adjust, ผลต่อยอดคลัง = 0), '
  'po_receipt = รับของเข้าคลังจากใบสั่งซื้อหลังผ่านการตรวจรับ (type in) — ของที่ถูกปฏิเสธไม่มีบรรทัดที่นี่';

-- ---------------------------------------------------------------------------
-- 4) ตัวเดียวในระบบที่เขียน stock_movements ของเส้นทางรับของ
--    เป็นฟังก์ชัน "ปรับให้ตรง" เหมือน sync_job_stock_movements ทุกประการ
-- ---------------------------------------------------------------------------
create or replace function public.sync_po_receipt_stock_movements(
  p_receipt_line_id uuid,
  p_actor text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line public.po_receipt_lines%rowtype;
  v_receipt public.po_receipts%rowtype;
  v_item public.po_items%rowtype;
  v_po public.purchase_orders%rowtype;
  v_material public.materials%rowtype;
  v_actor text := coalesce(nullif(btrim(coalesce(p_actor,'')), ''), 'ระบบ');
  v_note text;
begin
  select * into v_line from public.po_receipt_lines where id = p_receipt_line_id;
  if v_line.id is null then raise exception 'ไม่พบบรรทัดใบตรวจรับ id=%', p_receipt_line_id; end if;

  select * into v_receipt from public.po_receipts where id = v_line.receipt_id;
  select * into v_item from public.po_items where id = v_line.po_item_id;
  select * into v_po from public.purchase_orders where id = v_receipt.po_id;
  select * into v_material from public.materials where id = v_item.material_id;

  if v_line.qty_accepted > 0 then
    v_note := format('รับเข้าคลังจากใบสั่งซื้อ %s · %s · %s %s · ใบตรวจรับ %s',
      v_po.po_number, coalesce(v_material.name, 'ไม่ระบุวัสดุ'),
      v_line.qty_accepted, coalesce(v_material.unit, 'หน่วย'), v_receipt.receipt_no);

    update public.stock_movements
    set material_id = v_item.material_id,
        type = 'in',
        qty = v_line.qty_accepted,
        ref_po_id = v_po.id,
        ref_job_no = v_po.job_no,
        note = v_note,
        created_by = v_actor,
        updated_at = now()
    where ref_po_receipt_line_id = v_line.id and movement_kind = 'po_receipt';

    if not found then
      insert into public.stock_movements(
        material_id, type, qty, ref_po_id, ref_job_no, note, created_by,
        ref_po_receipt_line_id, movement_kind, updated_at
      ) values (
        v_item.material_id, 'in', v_line.qty_accepted, v_po.id, v_po.job_no, v_note, v_actor,
        v_line.id, 'po_receipt', now()
      );
    end if;
  else
    -- รับได้ 0 หน่วย = ไม่มีของเข้าคลัง ต่างจาก "เข้าคลัง 0 หน่วย" สมุดจึงต้องไม่มีบรรทัดนั้น
    delete from public.stock_movements
    where ref_po_receipt_line_id = v_line.id and movement_kind = 'po_receipt';
  end if;

  return jsonb_build_object(
    'receiptLineId', v_line.id,
    'poNumber', v_po.po_number,
    'qtyAccepted', v_line.qty_accepted,
    'qtyRejected', v_line.qty_rejected,
    'movementKind', case when v_line.qty_accepted > 0 then 'po_receipt' else null end
  );
end;
$function$;

comment on function public.sync_po_receipt_stock_movements(uuid, text) is
  'ปรับ stock_movements ของบรรทัดใบตรวจรับหนึ่งบรรทัดให้ตรงกับจำนวนที่รับจริง (movement_kind po_receipt / type in) '
  '— หนึ่งบรรทัดมีได้แถวเดียว (unique index) เรียกซ้ำผลเท่าเดิม จึงนับซ้ำไม่ได้ '
  'ของที่ถูกปฏิเสธไม่มีบรรทัดในสมุดเพราะไม่เคยเข้าคลัง เรียกได้จาก security definer ตัวอื่นเท่านั้น';

revoke all on function public.sync_po_receipt_stock_movements(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) เลขใบตรวจรับ
-- ---------------------------------------------------------------------------
create or replace function public.next_po_receipt_number()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prefix text := 'RC-' || to_char((now() at time zone 'Asia/Bangkok'), 'YYYYMM') || '-';
  v_seq int;
begin
  select coalesce(max(nullif(regexp_replace(receipt_no, '^' || v_prefix, ''), '')::int), 0) + 1
    into v_seq
  from public.po_receipts
  where receipt_no like v_prefix || '%' and receipt_no ~ ('^' || v_prefix || '[0-9]+$');
  return v_prefix || lpad(v_seq::text, 4, '0');
end;
$function$;

revoke all on function public.next_po_receipt_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) ตรวจรับของ — ธุรกรรมเดียวจบ: ใบตรวจรับ + ยอดคลัง + สมุดสต็อก + NC เมื่อไม่ผ่าน
-- ---------------------------------------------------------------------------
create or replace function public.record_po_receipt(
  p_po_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_sample_pct numeric default null,
  p_ncr_job_no text default null,
  p_defect_summary text default null,
  p_ncr_severity text default 'medium',
  p_ncr_type text default 'quality'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_po public.purchase_orders%rowtype;
  v_row jsonb;
  v_item public.po_items%rowtype;
  v_material public.materials%rowtype;
  v_accepted numeric;
  v_rejected numeric;
  v_remaining numeric;
  v_receipt_id uuid;
  v_receipt_no text;
  v_line_id uuid;
  v_total_accepted numeric := 0;
  v_total_rejected numeric := 0;
  v_reject_value numeric := 0;
  v_result text;
  v_ncr_id uuid;
  v_job_no text;
  v_defect_lines text := '';
  v_ledger jsonb := '[]'::jsonb;
  v_attempt int := 0;
  v_all_received boolean;
  v_any_received boolean;
  v_new_status text;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'ตรวจรับของจากผู้ขาย');

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if v_po.status not in ('ordered','partial') then
    raise exception 'ใบ % อยู่ในสถานะ "%" จึงรับของไม่ได้ — ต้องเป็นใบที่สั่งไปแล้วเท่านั้น', v_po.po_number, v_po.status;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ต้องระบุอย่างน้อยหนึ่งรายการที่รับ';
  end if;
  if p_ncr_severity not in ('critical','high','medium','low') then
    raise exception 'ระดับความรุนแรงของ NC ไม่ถูกต้อง';
  end if;
  if p_ncr_type not in ('quality','damage','missing','wrong','other') then
    raise exception 'ชนิดของ NC ไม่ถูกต้อง';
  end if;
  if p_sample_pct is not null and (p_sample_pct < 0 or p_sample_pct > 100) then
    raise exception 'สัดส่วนการสุ่มตรวจต้องอยู่ระหว่าง 0 ถึง 100 เปอร์เซ็นต์';
  end if;

  -- ตรวจทุกบรรทัดให้จบก่อน แล้วค่อยเขียน — คนที่กรอกผิดหนึ่งช่องต้องไม่ได้ใบที่เขียนไปแล้วครึ่งใบ
  for v_row in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.po_items where id = nullif(v_row->>'poItemId','')::uuid;
    if v_item.id is null or v_item.po_id <> p_po_id then
      raise exception 'มีรายการที่ไม่ได้อยู่ในใบสั่งซื้อ % — กรุณารีเฟรชหน้าจอแล้วลองใหม่', v_po.po_number;
    end if;
    select * into v_material from public.materials where id = v_item.material_id;

    v_accepted := coalesce((v_row->>'qtyAccepted')::numeric, 0);
    v_rejected := coalesce((v_row->>'qtyRejected')::numeric, 0);
    if v_accepted < 0 or v_rejected < 0 then
      raise exception 'จำนวนที่รับและจำนวนที่ปฏิเสธของ "%" ติดลบไม่ได้', coalesce(v_material.name,'รายการนี้');
    end if;
    if v_accepted + v_rejected = 0 then
      continue;
    end if;
    if v_rejected > 0 and nullif(btrim(coalesce(v_row->>'defectNote','')), '') is null then
      raise exception 'ของที่ปฏิเสธของ "%" ต้องระบุว่าเสียตรงไหน — ผู้ขายต้องแก้ตามคำอธิบายนี้', coalesce(v_material.name,'รายการนี้');
    end if;

    v_remaining := v_item.qty_ordered - coalesce(v_item.qty_received,0) - coalesce(v_item.qty_rejected,0);
    if v_accepted + v_rejected > v_remaining then
      raise exception 'รายการ "%": รับ % + ปฏิเสธ % = % แต่ยังค้างรับอยู่แค่ % % — ของมาเกินที่สั่งต้องแก้ใบสั่งซื้อก่อน ไม่ใช่รับเข้ามาเงียบ ๆ',
        coalesce(v_material.name,'ไม่ระบุ'), v_accepted, v_rejected, v_accepted + v_rejected,
        v_remaining, coalesce(v_material.unit,'หน่วย');
    end if;

    v_total_accepted := v_total_accepted + v_accepted;
    v_total_rejected := v_total_rejected + v_rejected;
    if v_rejected > 0 then
      v_reject_value := v_reject_value + v_rejected * coalesce(v_item.unit_price, 0);
      v_defect_lines := v_defect_lines || format('- %s: ปฏิเสธ %s %s (%s)%s',
        coalesce(v_material.name,'ไม่ระบุ'), v_rejected, coalesce(v_material.unit,'หน่วย'),
        btrim(v_row->>'defectNote'), chr(10));
    end if;
  end loop;

  if v_total_accepted + v_total_rejected = 0 then
    raise exception 'ยังไม่ได้กรอกจำนวนที่รับหรือที่ปฏิเสธเลยสักรายการ';
  end if;

  v_result := case
    when v_total_rejected = 0 then 'pass'
    when v_total_accepted = 0 then 'fail'
    else 'partial_fail'
  end;

  -- เลขงานสำหรับ NC: ใบสั่งซื้อที่ซื้อเพื่องานใดงานหนึ่งจะเติมให้เอง ถ้าไม่มีต้องให้คนระบุ
  if v_result <> 'pass' then
    v_job_no := coalesce(nullif(btrim(coalesce(p_ncr_job_no,'')), ''), v_po.job_no);
    if v_job_no is null then
      raise exception 'ของบางรายการไม่ผ่านตรวจรับ ระบบจะเปิดใบ NC ให้ แต่ใบ NC ในระบบนี้ต้องผูกกับเลขงานเสมอ — กรุณาระบุว่าของล็อตนี้ซื้อมาเพื่องานใด';
    end if;
    if not exists (select 1 from public.install_jobs where job_no = v_job_no) then
      raise exception 'ไม่พบเลขงาน % ในทะเบียนงานติดตั้ง', v_job_no;
    end if;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_receipt_no := public.next_po_receipt_number();
    begin
      insert into public.po_receipts(
        po_id, receipt_no, received_by, received_by_name, inspection_result,
        sample_pct, note, defect_summary
      ) values (
        p_po_id, v_receipt_no, v_actor.id, v_actor.full_name,
        -- ใบถูกสร้างเป็น pass ไว้ก่อนเมื่อยังไม่มี NC แล้วอัปเดตพร้อม ncr_id ทีเดียว
        -- เพื่อไม่ให้ชน po_receipts_fail_needs_ncr ระหว่างทาง
        'pass',
        coalesce(p_sample_pct, v_po.inspection_sample_pct),
        nullif(btrim(coalesce(p_note,'')),''),
        nullif(btrim(coalesce(p_defect_summary,'')),'')
      ) returning id into v_receipt_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'ออกเลขใบตรวจรับไม่สำเร็จเพราะมีคนบันทึกพร้อมกันหลายครั้ง กรุณากดใหม่อีกครั้ง';
      end if;
    end;
  end loop;

  for v_row in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.po_items where id = nullif(v_row->>'poItemId','')::uuid for update;
    v_accepted := coalesce((v_row->>'qtyAccepted')::numeric, 0);
    v_rejected := coalesce((v_row->>'qtyRejected')::numeric, 0);
    if v_accepted + v_rejected = 0 then continue; end if;

    insert into public.po_receipt_lines(receipt_id, po_item_id, qty_accepted, qty_rejected, defect_note)
    values (v_receipt_id, v_item.id, v_accepted, v_rejected, nullif(btrim(coalesce(v_row->>'defectNote','')),''))
    returning id into v_line_id;

    update public.po_items set
      qty_received = coalesce(qty_received,0) + v_accepted,
      qty_rejected = coalesce(qty_rejected,0) + v_rejected
    where id = v_item.id;

    -- ของที่รับจริงเท่านั้นที่เข้าคลัง ของที่ปฏิเสธไม่แตะยอดคลังเลย
    if v_accepted > 0 then
      update public.materials set qty_on_hand = coalesce(qty_on_hand,0) + v_accepted, updated_at = now()
      where id = v_item.material_id;
    end if;

    v_ledger := v_ledger || public.sync_po_receipt_stock_movements(v_line_id, v_actor.full_name);
  end loop;

  -- ของไม่ผ่าน = เปิด NC หนึ่งใบต่อการตรวจรับหนึ่งครั้ง ผ่านทางเดิมของระบบเท่านั้น
  if v_result <> 'pass' then
    v_ncr_id := public.create_floor_ncr_as(
      v_actor.id, v_actor.full_name, v_job_no,
      format('ของไม่ผ่านตรวจรับจากใบสั่งซื้อ %s', v_po.po_number),
      p_ncr_type, null::text, v_total_rejected,
      format('ตรวจรับตามใบ %s เมื่อ %s พบของไม่ได้มาตรฐานรวม %s หน่วย%s%s%s',
        v_receipt_no,
        to_char(now() at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),
        v_total_rejected, chr(10), v_defect_lines,
        coalesce(chr(10) || 'สรุปโดยผู้ตรวจรับ: ' || nullif(btrim(coalesce(p_defect_summary,'')),''), '')),
      v_reject_value, v_actor.full_name, p_ncr_severity,
      'MATERIAL', v_po.supplier_id
    );

    update public.po_receipts set inspection_result = v_result, ncr_id = v_ncr_id where id = v_receipt_id;
  end if;

  -- สถานะใบสั่งซื้อ: "รับครบ" หมายถึงทุกรายการปิดยอดแล้ว ไม่ว่าจะปิดด้วยของที่รับหรือของที่ปฏิเสธ
  select
    bool_and(coalesce(qty_received,0) + coalesce(qty_rejected,0) >= qty_ordered),
    bool_or(coalesce(qty_received,0) + coalesce(qty_rejected,0) > 0)
  into v_all_received, v_any_received
  from public.po_items where po_id = p_po_id;

  v_new_status := case when v_all_received then 'received' when v_any_received then 'partial' else v_po.status end;
  update public.purchase_orders set status = v_new_status, updated_at = now() where id = p_po_id;

  return jsonb_build_object(
    'receiptId', v_receipt_id,
    'receiptNo', v_receipt_no,
    'poNumber', v_po.po_number,
    'inspectionResult', v_result,
    'qtyAccepted', v_total_accepted,
    'qtyRejected', v_total_rejected,
    'rejectValueThb', v_reject_value,
    'ncrId', v_ncr_id,
    'ncrJobNo', v_job_no,
    'poStatus', v_new_status,
    'ledger', v_ledger,
    'receivedByName', v_actor.full_name
  );
end;
$function$;

comment on function public.record_po_receipt(uuid, jsonb, text, numeric, text, text, text, text) is
  'ตรวจรับของจากใบสั่งซื้อหนึ่งครั้งในธุรกรรมเดียว (role admin/warehouse): '
  'บันทึกใบตรวจรับ + อัปเดตยอดคลังเฉพาะของที่รับจริง + ลง stock_movements (po_receipt/in) '
  'และเปิด NC หนึ่งใบด้วย cause_code = MATERIAL พร้อม provider_id ของผู้ขาย เมื่อมีของถูกปฏิเสธ';

revoke all on function public.record_po_receipt(uuid, jsonb, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.record_po_receipt(uuid, jsonb, text, numeric, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) ข้อมูลหน้าจอใบสั่งซื้อ + การตรวจรับ ในคำขอเดียว
-- ---------------------------------------------------------------------------
create or replace function public.purchase_orders_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_pos jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะเปิดหน้าใบสั่งซื้อได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p."createdAt" desc), '[]'::jsonb) into v_pos
  from (
    select po.id, po.po_number as "poNumber", po.status, po.eta, po.required_date as "requiredDate",
           po.acceptance_requirements as "acceptanceRequirements", po.job_no as "jobNo",
           po.total_amount as "totalAmount", po.notes, po.created_at as "createdAt",
           po.created_by_name as "createdByName", po.issued_at as "issuedAt", po.issued_by_name as "issuedByName",
           po.cancelled_at as "cancelledAt", po.cancel_reason as "cancelReason",
           po.inspection_sample_pct as "inspectionSamplePct",
           po.supplier_id as "supplierId",
           s.name as "supplierName", s.provider_kind as "supplierKind", s.approval_status as "supplierApprovalStatus",
           (select coalesce(jsonb_agg(jsonb_build_object(
              'id', it.id, 'materialId', it.material_id,
              'materialName', m.name, 'sku', m.sku, 'unit', m.unit,
              'qtyOrdered', it.qty_ordered, 'qtyReceived', coalesce(it.qty_received,0),
              'qtyRejected', coalesce(it.qty_rejected,0),
              'unitPrice', it.unit_price, 'note', it.note, 'acceptanceSpec', it.acceptance_spec
            ) order by m.name), '[]'::jsonb)
            from public.po_items it left join public.materials m on m.id = it.material_id
            where it.po_id = po.id) as items,
           (select coalesce(jsonb_agg(jsonb_build_object(
              'id', r.id, 'receiptNo', r.receipt_no, 'receivedAt', r.received_at,
              'receivedByName', r.received_by_name, 'inspectionResult', r.inspection_result,
              'samplePct', r.sample_pct, 'note', r.note, 'defectSummary', r.defect_summary,
              'ncrId', r.ncr_id,
              'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                  'poItemId', rl.po_item_id, 'qtyAccepted', rl.qty_accepted,
                  'qtyRejected', rl.qty_rejected, 'defectNote', rl.defect_note)), '[]'::jsonb)
                from public.po_receipt_lines rl where rl.receipt_id = r.id)
            ) order by r.received_at desc), '[]'::jsonb)
            from public.po_receipts r where r.po_id = po.id) as receipts
    from public.purchase_orders po
    left join public.suppliers s on s.id = po.supplier_id
  ) p;

  return jsonb_build_object('purchaseOrders', v_pos);
end;
$function$;

comment on function public.purchase_orders_snapshot() is
  'ใบสั่งซื้อทั้งหมดพร้อมรายการและประวัติการตรวจรับในคำขอเดียว — หน้าจอไม่ต้องประกอบเองจากหลายตาราง';

revoke all on function public.purchase_orders_snapshot() from public, anon;
grant execute on function public.purchase_orders_snapshot() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

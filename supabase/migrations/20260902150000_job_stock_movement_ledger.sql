-- FloorNow P4-1 (1/3): ทำให้ "ของที่ขยับจริง" ทุกครั้งมีบรรทัดใน stock_movements ที่อ้างถึงงาน
--
-- ปัญหาที่แก้: วันนี้ floor_work_order_items รู้ว่าเบิกไปเท่าไหร่ (picked_qty) แต่ stock_movements
-- ซึ่งเป็นสมุดบัญชีการเคลื่อนไหวของคลัง มี 0 แถว และไม่มีอะไรในระบบเขียนลงไปเลยจากเส้นทางงานติดตั้ง
-- ผลคือหน้า waste-cost ที่อ่าน stock_movements ต่องาน (ref_job_no) เพื่อสรุป "เบิกเท่าไหร่ คืนเท่าไหร่"
-- ได้ข้อมูลว่างเปล่าเสมอ และไม่มีใครตอบได้ว่าของหายไประหว่างทางกี่หน่วย
--
-- ค่าที่ใช้ได้ของ stock_movements.type ถูกล็อกด้วย check constraint อยู่แล้ว
-- (in, out, reserve, return, adjust) งานนี้ "ไม่แตะ" constraint นั้นเลย และเลือกใช้จากค่าที่มีอยู่:
--
--   ธุรกิจ                    movement_kind      type      จำนวน            ผลต่อยอดคลัง
--   เบิกออกไปที่งาน           job_issue          out       picked_qty       ลดลง (ของออกจากคลังจริง)
--   คืนกลับเข้าคลัง           job_return         return    returned_qty     เพิ่มขึ้น (ของกลับเข้ามา)
--   ใช้จริงที่หน้างาน         job_consumption    adjust    used_qty         ไม่กระทบ (ออกไปตั้งแต่ตอนเบิกแล้ว)
--
-- ทำไม out/return: app/(admin)/waste-cost/page.tsx:373-377 อ่านแถวที่ ref_job_no = เลขงาน แล้วตีความ
--   type='out' = "เบิก" และ type='return' = "คืน" อยู่แล้ววันนี้ นี่คือความหมายที่โค้ดในระบบใช้จริง
--   การเลือกค่าอื่นจะทำให้หน้าที่มีอยู่แล้วอ่านสมุดบัญชีนี้ไม่ออก
--
-- ทำไม "ใช้จริง" ต้องไม่เป็น out: ถ้าเป็น out หน้า waste-cost จะบวกยอดเบิกซ้ำสองรอบ (เบิก 10 ใช้ 7
--   จะกลายเป็นเบิก 17) ของถูกนับออกจากคลังไปแล้วตอนเบิก บรรทัด "ใช้จริง" จึงต้องมีผลต่อยอดคลัง = 0
--   ในบรรดาค่าที่เหลือ adjust คือค่าเดียวที่ระบบนี้ให้ delta = 0 จริง ๆ (inventory/page.tsx:140
--   คิด delta = 0 สำหรับ adjust และ waste-cost มองข้ามค่าที่ไม่ใช่ out/return)
--   ส่วน reserve แปลว่า "จอง" ตามป้ายที่ inventory/page.tsx:40 ใช้ ซึ่งโกหกเพราะของถูกใช้ไปแล้ว
--   ข้อจำกัดนี้ถูกบันทึกไว้ตรง ๆ: ถ้าวันหนึ่งมีค่า 'consume' เพิ่มเข้า constraint ให้ย้ายมาใช้ค่านั้น
--
-- ห้ามนับซ้ำ — บังคับด้วยโครงสร้าง ไม่ใช่ด้วยความระวังของโค้ด:
--   หนึ่งบรรทัดของใบสั่งงาน มีได้ movement ละหนึ่งแถวต่อหนึ่ง movement_kind เท่านั้น
--   (unique index บน (ref_work_order_item_id, movement_kind))
--   ทุกครั้งที่ตัวเลขบนบรรทัดเปลี่ยน ระบบ "เขียนทับแถวเดิมให้ตรงกับตัวเลขล่าสุด" ไม่ใช่เพิ่มแถวใหม่
--   ช่างแก้ "ใช้ไป 3" เป็น 5 แล้วเป็น 2 กี่รอบก็ตาม แถว job_consumption ยังมีใบเดียวและ qty = ค่าล่าสุด
--   ถ้าตัวเลขกลับเป็น 0 แถวนั้นถูกลบทิ้ง เพราะ "ไม่มีการเคลื่อนไหว" ไม่ใช่ "เคลื่อนไหว 0 หน่วย"
--
-- additive ล้วน: เพิ่มคอลัมน์ nullable บน stock_movements (ตารางว่าง 0 แถว) และเพิ่ม trigger
-- ที่ยิงเฉพาะแถวที่มี used_qty/returned_qty เท่านั้น แถวเดิม 13 แถวมีทั้งคู่เป็น null จึงไม่ถูกแตะ
-- ไม่ลบ ไม่เปลี่ยนชื่อ ไม่แก้ check constraint เดิมของตารางใด

begin;

-- ---------------------------------------------------------------------------
-- 1) คอลัมน์ที่ผูก movement เข้ากับ "บรรทัดของใบสั่งงาน" ที่มันเกิดมาจาก
--    ref_job_no มีอยู่แล้ว (FK -> install_jobs.job_no) และเป็นตัวที่แผนเรียกหา — ใช้ตัวนั้น
--    แต่ ref_job_no อย่างเดียวบอกไม่ได้ว่า movement นี้เกิดจากบรรทัดไหน จึงเพิ่มตัวชี้ระดับบรรทัด
--    ซึ่งเป็นสิ่งที่ทำให้ "หนึ่งบรรทัด = หนึ่งแถวต่อชนิด" บังคับได้ด้วย unique index
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists ref_work_order_item_id uuid,
  add column if not exists movement_kind text,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_movements'::regclass
      and conname = 'stock_movements_ref_work_order_item_fkey'
  ) then
    -- on delete set null: ถ้าบรรทัดถูกลบ (confirm_floor_work_order_v3 ลบแล้วสร้างใหม่ตอนหัวหน้าช่างยืนยัน)
    -- ประวัติการเคลื่อนไหวของคลังต้องไม่หายไปด้วย — มันยังอ้างถึงงานผ่าน ref_job_no ได้อยู่
    alter table public.stock_movements
      add constraint stock_movements_ref_work_order_item_fkey
      foreign key (ref_work_order_item_id) references public.floor_work_order_items(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_movements'::regclass
      and conname = 'stock_movements_movement_kind_check'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_movement_kind_check
      check (movement_kind is null or movement_kind in ('job_issue', 'job_return', 'job_consumption'));
  end if;
end
$$;

-- หัวใจของ "ห้ามนับซ้ำ": หนึ่งบรรทัด หนึ่งชนิด ได้แถวเดียวตลอดกาล
create unique index if not exists stock_movements_job_line_kind_unique
  on public.stock_movements(ref_work_order_item_id, movement_kind)
  where ref_work_order_item_id is not null and movement_kind is not null;

create index if not exists stock_movements_ref_job_no_idx
  on public.stock_movements(ref_job_no) where ref_job_no is not null;

comment on column public.stock_movements.ref_work_order_item_id is
  'บรรทัดของใบสั่งงานที่ทำให้เกิดการเคลื่อนไหวนี้ — คู่กับ movement_kind เป็น unique จึงนับซ้ำไม่ได้ '
  'null = แถวที่คนกรอกเองจากหน้าคลัง/ใบสั่งซื้อ ซึ่งไม่ได้ผูกกับบรรทัดใด';
comment on column public.stock_movements.movement_kind is
  'ความหมายทางธุรกิจของแถวนี้: job_issue = เบิกไปที่งาน (type out), job_return = คืนเข้าคลัง (type return), '
  'job_consumption = ใช้จริงที่หน้างาน (type adjust, ผลต่อยอดคลัง = 0 เพราะของออกไปแล้วตอนเบิก)';
comment on column public.stock_movements.updated_at is
  'เวลาที่แถวนี้ถูกปรับให้ตรงกับตัวเลขล่าสุดบนบรรทัด — แถวที่ผูกกับบรรทัดถูกเขียนทับ ไม่ได้เพิ่มแถวใหม่';

-- ---------------------------------------------------------------------------
-- 2) กติกาการกระทบยอดระดับฐานข้อมูล: ใช้ + คืน ต้องไม่เกินที่เบิกออกไป
--
--    ทำไมเป็น trigger ไม่ใช่ check constraint: ข้อความที่คนอ่านต้องเป็นภาษาไทยและต้องบอกว่า
--    "บรรทัดไหน เกินไปเท่าไหร่" ซึ่ง check constraint ทำไม่ได้ (ได้แค่ชื่อ constraint)
--    และเพราะเป็นด่านระดับตาราง ต่อให้มีทางเขียนใหม่ในอนาคตที่ลืมตรวจ ก็ยังผ่านไปไม่ได้
--
--    "ที่เบิกออกไป" ใช้บันไดเดียวกับที่ P3-6 ใช้ตัดสิน expected: picked_qty -> actual_qty -> planned_qty
--    เพราะใบที่คลังปิดงานด้วยทางเดิม (complete_floor_warehouse_order_v2) มีแต่ actual_qty ไม่มี picked_qty
--    ถ้ายึด picked_qty อย่างเดียว ช่างจะบันทึกของที่ถืออยู่ในมือจริง ๆ ไม่ได้เลยทั้งใบ
--
--    trigger ยิงเฉพาะแถวที่มี used_qty หรือ returned_qty เท่านั้น (WHEN clause)
--    ทางเขียนเดิมทุกตัวในระบบไม่เคยแตะสองคอลัมน์นี้ จึงไม่มีทางเขียนใดถูกเปลี่ยนพฤติกรรม
-- ---------------------------------------------------------------------------
create or replace function public.floor_work_order_items_usage_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_expected numeric := coalesce(new.picked_qty, new.actual_qty, new.planned_qty, 0);
  v_used numeric := coalesce(new.used_qty, 0);
  v_returned numeric := coalesce(new.returned_qty, 0);
begin
  if v_used < 0 or v_returned < 0 then
    raise exception 'รายการ "%": จำนวนที่ใช้และจำนวนที่คืนต้องไม่ติดลบ', new.item_name;
  end if;

  -- เครื่องมือไม่ใช่ของสิ้นเปลือง: สว่านไม่ได้ "ถูกใช้หมดไป" มันถูกคืนหรือยังไม่ถูกคืนเท่านั้น
  -- ถ้าปล่อยให้บันทึก "ใช้ไป" บนเครื่องมือได้ ยอดค้างคืนจะถูกกลบด้วยคำว่าใช้ไปแล้ว
  -- และรายการเครื่องมือที่ยังไม่ได้คืน (P4-2) จะโกหกทันที
  if new.item_kind = 'tool' and v_used > 0 then
    raise exception 'รายการ "%" เป็นเครื่องมือที่ต้องคืน ไม่ใช่ของสิ้นเปลือง จึงบันทึก "ใช้ไป" ไม่ได้ — ถ้าเอากลับมาแล้วให้บันทึกเป็นจำนวนที่คืน ถ้าหายหรือพังให้ปล่อยค้างไว้แล้วแจ้งหัวหน้าช่าง', new.item_name;
  end if;

  if v_used + v_returned > v_expected then
    raise exception 'รายการ "%": ใช้ไป % + คืน % = % % แต่เบิกออกไปแค่ % % — ยอดใช้บวกยอดคืนต้องไม่เกินของที่เบิกออกไป',
      new.item_name, v_used, v_returned, v_used + v_returned, new.unit, v_expected, new.unit;
  end if;

  return new;
end;
$function$;

comment on function public.floor_work_order_items_usage_guard() is
  'ด่านกระทบยอดระดับตาราง: ใช้ + คืน ต้องไม่เกินที่เบิกออกไป (picked_qty -> actual_qty -> planned_qty) '
  'และเครื่องมือ (item_kind = tool) บันทึก "ใช้ไป" ไม่ได้ — ข้อความเป็นภาษาไทยและบอกชื่อรายการเสมอ';

drop trigger if exists floor_work_order_items_usage_guard_trg on public.floor_work_order_items;
create trigger floor_work_order_items_usage_guard_trg
  before insert or update on public.floor_work_order_items
  for each row
  when (new.used_qty is not null or new.returned_qty is not null)
  execute function public.floor_work_order_items_usage_guard();

-- ---------------------------------------------------------------------------
-- 3) ตัวเดียวในระบบที่เขียน stock_movements ของเส้นทางงานติดตั้ง
--
--    เป็นฟังก์ชัน "ปรับให้ตรง" (sync) ไม่ใช่ "เพิ่มรายการ" (append) โดยตั้งใจ:
--    มันอ่านตัวเลขล่าสุดบนบรรทัดแล้วทำให้สมุดบัญชีตรงกับตัวเลขนั้น
--    เรียกกี่ครั้งก็ได้ผลลัพธ์เดียวกัน (idempotent) — นี่คือเหตุผลที่การแก้ซ้ำนับซ้ำไม่ได้
-- ---------------------------------------------------------------------------
create or replace function public.sync_job_stock_movements(
  p_item_id uuid,
  p_actor text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_line public.floor_work_order_items%rowtype;
  v_order public.floor_work_orders%rowtype;
  v_actor text := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'ระบบ');
  v_row record;
  v_note text;
  v_written jsonb := '[]'::jsonb;
begin
  select * into v_line from public.floor_work_order_items where id = p_item_id;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;

  select * into v_order from public.floor_work_orders where id = v_line.work_order_id;
  if v_order.id is null then
    raise exception 'ไม่พบใบสั่งงานของรายการ id=%', p_item_id;
  end if;

  -- stock_movements.ref_job_no เป็น FK ไปที่ install_jobs.job_no แต่ floor_work_orders.job_no
  -- ไม่มี FK บังคับไว้ ถ้าเลขงานไม่มีจริงจะเขียนสมุดบัญชีไม่ได้ — ต้องบอกตรง ๆ ไม่ใช่เงียบแล้วข้าม
  -- เพราะ "ของขยับแต่ไม่มีบรรทัดในสมุด" คือสิ่งที่งานนี้ตั้งใจกำจัด
  if not exists (select 1 from public.install_jobs where job_no = v_order.job_no) then
    raise exception 'เลขงาน % ไม่มีในทะเบียนงานติดตั้ง จึงบันทึกความเคลื่อนไหวสต็อกที่อ้างถึงงานนี้ไม่ได้', v_order.job_no;
  end if;

  for v_row in
    select *
      from (values
        ('job_issue',       'out',    coalesce(v_line.picked_qty, 0),   'เบิกออกจากคลังไปหน้างาน'),
        ('job_return',      'return', coalesce(v_line.returned_qty, 0), 'คืนของกลับเข้าคลัง'),
        ('job_consumption', 'adjust', coalesce(v_line.used_qty, 0),     'ใช้จริงที่หน้างาน (ไม่หักยอดคลังซ้ำ เพราะของออกจากคลังไปแล้วตอนเบิก)')
      ) as t(kind, mtype, qty, label)
  loop
    if v_row.qty > 0 then
      v_note := format('%s · %s%s · %s %s · ใบสั่งงาน %s',
        v_row.label, v_line.item_name,
        coalesce(' (' || v_line.sku || ')', ''),
        v_row.qty, v_line.unit, v_order.job_no);

      -- เขียนทับแถวเดิมก่อนเสมอ ถ้าไม่มีค่อยสร้างใหม่ — unique index เป็นตัวกันไม่ให้มีแถวที่สอง
      update public.stock_movements
      set material_id = v_line.material_id,
          type = v_row.mtype,
          qty = v_row.qty,
          ref_job_no = v_order.job_no,
          note = v_note,
          created_by = v_actor,
          updated_at = now()
      where ref_work_order_item_id = v_line.id and movement_kind = v_row.kind;

      if not found then
        insert into public.stock_movements(
          material_id, type, qty, ref_job_no, note, created_by,
          ref_work_order_item_id, movement_kind, updated_at
        ) values (
          v_line.material_id, v_row.mtype, v_row.qty, v_order.job_no, v_note, v_actor,
          v_line.id, v_row.kind, now()
        );
      end if;

      v_written := v_written || jsonb_build_object('kind', v_row.kind, 'type', v_row.mtype, 'qty', v_row.qty);
    else
      -- ไม่มีการเคลื่อนไหว ต่างจากเคลื่อนไหว 0 หน่วย — สมุดบัญชีจึงต้องไม่มีบรรทัดนั้นเลย
      delete from public.stock_movements
      where ref_work_order_item_id = v_line.id and movement_kind = v_row.kind;
    end if;
  end loop;

  return jsonb_build_object(
    'itemId', v_line.id,
    'jobNo', v_order.job_no,
    'pickedQty', coalesce(v_line.picked_qty, 0),
    'returnedQty', coalesce(v_line.returned_qty, 0),
    'usedQty', coalesce(v_line.used_qty, 0),
    'movements', v_written
  );
end;
$function$;

comment on function public.sync_job_stock_movements(uuid, text) is
  'ปรับ stock_movements ของบรรทัดหนึ่งให้ตรงกับ picked_qty/returned_qty/used_qty ล่าสุด '
  '— หนึ่งบรรทัดมีได้แถวละหนึ่งต่อ movement_kind (unique index) เรียกซ้ำกี่ครั้งผลเท่าเดิม จึงนับซ้ำไม่ได้ '
  'เรียกได้เฉพาะจากฟังก์ชัน security definer ตัวอื่นเท่านั้น ไม่เปิดให้ client เรียกตรง';

-- ---------------------------------------------------------------------------
-- 4) ทางเขียนเดิมของคลัง (P3-5) ต้องลงสมุดบัญชีด้วย
--    ลายเซ็นเดิมทุกตัวอักษร หน้าคลังไม่ต้องแก้ — เพิ่มเฉพาะการ sync ท้ายสุด
--    (ประกาศซ้ำทั้งตัวเพราะห้ามแก้ไฟล์ migration ที่ apply ไปแล้ว)
-- ---------------------------------------------------------------------------
create or replace function public.record_warehouse_item_pick(
  p_item_id uuid,
  p_pick_status text,
  p_picked_qty numeric default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_work_order_id uuid;
  v_actor public.floor_staff_profiles%rowtype;
  v_line public.floor_work_order_items%rowtype;
  v_status text := btrim(coalesce(p_pick_status, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_qty numeric;
  v_ledger jsonb;
begin
  select work_order_id into v_work_order_id from public.floor_work_order_items where id = p_item_id;
  if v_work_order_id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;
  v_actor := public.warehouse_pick_guard(v_work_order_id);

  select * into v_line from public.floor_work_order_items where id = p_item_id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;

  if v_status not in ('picked_full', 'picked_partial', 'unavailable') then
    raise exception 'สถานะการหยิบต้องเป็น picked_full, picked_partial หรือ unavailable เท่านั้น (ได้รับ: %)', coalesce(nullif(v_status, ''), '(ว่าง)');
  end if;

  if v_status = 'picked_full' then
    v_qty := v_line.planned_qty;
  elsif v_status = 'unavailable' then
    v_qty := 0;
    if v_note is null then
      raise exception 'เมื่อไม่มีของให้หยิบ ต้องระบุหมายเหตุว่าทำไม เพราะช่างและหัวหน้าช่างต้องใช้เหตุผลนี้หาของทดแทน';
    end if;
  else
    if p_picked_qty is null then
      raise exception 'หยิบได้บางส่วนต้องระบุจำนวนที่หยิบได้';
    end if;
    if p_picked_qty <= 0 then
      raise exception 'หยิบได้บางส่วนต้องมากกว่า 0 — ถ้าหยิบไม่ได้เลยให้เลือก "ไม่มีของ"';
    end if;
    if p_picked_qty >= v_line.planned_qty then
      raise exception 'จำนวนที่กรอก (%) ไม่น้อยกว่าจำนวนตามแผน (%) — ถ้าหยิบได้ครบให้เลือก "หยิบครบ"', p_picked_qty, v_line.planned_qty;
    end if;
    v_qty := p_picked_qty;
  end if;

  -- ลดจำนวนที่เบิกลงต่ำกว่า "ใช้ + คืน" ที่ช่างบันทึกไว้แล้วไม่ได้ — trigger จะปฏิเสธพร้อมข้อความไทย
  update public.floor_work_order_items
  set picked_qty = v_qty,
      pick_status = v_status,
      picked_by = v_actor.id,
      picked_at = now(),
      pick_note = v_note,
      updated_at = now()
  where id = v_line.id;

  -- P4-1: ของออกจากคลังจริงเมื่อไหร่ สมุดบัญชีต้องมีบรรทัดนั้นทันที ไม่ใช่ตอนปิดงานทั้งใบ
  v_ledger := public.sync_job_stock_movements(v_line.id, v_actor.full_name);

  return jsonb_build_object(
    'itemId', v_line.id,
    'workOrderId', v_line.work_order_id,
    'pickStatus', v_status,
    'pickedQty', v_qty,
    'plannedQty', v_line.planned_qty,
    'pickNote', v_note,
    'pickedByName', v_actor.full_name,
    'pickedAt', now(),
    'ledger', v_ledger
  );
end;
$function$;

comment on function public.record_warehouse_item_pick(uuid, text, numeric, text) is
  'บันทึกผลการหยิบของหนึ่งบรรทัดลง floor_work_order_items.picked_qty พร้อมสถานะ ผู้หยิบ และเวลา '
  '— จำนวนของ picked_full มาจาก planned_qty ฝั่งเซิร์ฟเวอร์เสมอ และ unavailable บังคับให้ระบุเหตุผล '
  'P4-1: ลง stock_movements (job_issue/out) ให้ตรงกับจำนวนล่าสุดทุกครั้ง';

-- ---------------------------------------------------------------------------
-- 5) สิทธิ์
--    sync_job_stock_movements: ไม่ให้ใครเรียกตรง เรียกได้จาก security definer ตัวอื่นเท่านั้น
--
--    และถอน grant ค้างของ anon บน stock_movements ทิ้ง — RLS policy ของตารางนี้
--    ผูกไว้กับ role authenticated อยู่แล้ว anon จึงอ่าน/เขียนไม่ได้จริงตั้งแต่แรก
--    แต่ grant ที่ค้างอยู่ทำให้คนอ่านสคีมาเข้าใจผิดว่าเปิดไว้ และถ้าวันหนึ่งมีใครเผลอเพิ่ม policy
--    ที่กว้างกว่า anon จะได้สิทธิ์ทันทีโดยไม่มีใครตั้งใจ (แพตเทิร์นเดียวกับที่ P3-6 ถอนบน ncr_reports)
-- ---------------------------------------------------------------------------
revoke all on function public.sync_job_stock_movements(uuid, text) from public, anon, authenticated;
revoke all on function public.floor_work_order_items_usage_guard() from public, anon, authenticated;

revoke all on public.stock_movements from anon;

notify pgrst, 'reload schema';

commit;

-- FloorNow P3-5: ให้คลัง "หยิบของทีละบรรทัด" แทนที่จะกรอกตัวเลขรวมทั้งใบ
--
-- ปัญหาที่แก้: วันนี้หน้าคลัง (app/(admin)/warehouse/page.tsx) กรอก actual_qty ต่อบรรทัดก็จริง
-- แต่กรอกได้ครั้งเดียวตอน "ปิดงานคลัง" ทั้งใบ — คนหยิบของจึงต้องจำไว้ในหัวว่าหยิบอะไรไปแล้วบ้าง
-- จนกว่าจะหยิบครบทั้งใบถึงจะบันทึกได้ ถ้าหยิบครึ่งใบแล้วเปลี่ยนกะ คนถัดไปไม่รู้ว่าถึงไหนแล้ว
-- และไม่มีที่ให้บอกว่า "บรรทัดนี้ของหมด หยิบไม่ได้" นอกจากกรอกเลข 0 ซึ่งอ่านไม่ออกว่าเป็น
-- "หยิบได้ 0" หรือ "ยังไม่ได้หยิบ"
--
-- ทางแก้: บันทึกผลการหยิบ "ทีละบรรทัด ทันทีที่หยิบ" ลง picked_qty (คอลัมน์ที่ P3-1 เตรียมไว้
-- แต่ยังไม่มีใครเขียน) พร้อมสถานะสามค่าที่คนคลังพูดจริง: หยิบครบ / หยิบได้บางส่วน / ไม่มีของ
-- และบันทึกว่าใครหยิบ เมื่อไหร่ เพื่อให้ตอบได้ว่า "ของหายไปตอนไหน" เมื่อช่างแจ้งของไม่ครบ (P3-6)
--
-- ทางเดิมยังอยู่ครบ: complete_floor_warehouse_order_v2 ไม่ถูกแตะเลยแม้แต่บรรทัดเดียว
-- การหยิบรายบรรทัดเป็นของ "เพิ่ม" ไม่ใช่ของ "แทนที่" — คลังยังปิดงานทั้งใบด้วย actual_qty เหมือนเดิม
-- หน้าจอเพียงเอา picked_qty ไป prefill ช่อง actual_qty ให้ จะได้ไม่ต้องพิมพ์เลขเดิมซ้ำสองรอบ
--
-- ใครหยิบได้: role 'admin' และ 'warehouse' เท่านั้น — ชุดเดียวกับ accept_floor_warehouse_order_v2
-- และ complete_floor_warehouse_order_v2 ที่คุมสถานะใบสั่งงานของหน้าจอนี้อยู่แล้ว
-- การหยิบของคือการกระทำเดียวกับที่สองตัวนั้นคุม (ของออกจากคลังจริง) จึงห้ามหลวมกว่ากัน
-- และเงื่อนไข "เฉพาะคนที่กดรับงาน หรือ admin" ก็ลอกมาจาก complete_v2 ตรง ๆ ด้วยเหตุผลเดียวกัน:
-- ถ้าใครก็ได้ในทีมคลังเดินมาหยิบทับใบที่คนอื่นรับไปแล้ว จะไม่มีใครรู้ว่าของในกองนั้นครบหรือไม่
--
-- additive ล้วน: เพิ่มคอลัมน์ nullable + constraint ที่ผ่านทุกแถวเดิม (12 แถวมี pick_status = null)
-- ไม่ลบ ไม่เปลี่ยนชื่อ ไม่เปลี่ยนความหมายคอลัมน์เดิม ไม่แตะข้อมูลแถวเดิมสักแถว

begin;

-- ---------------------------------------------------------------------------
-- 1) คอลัมน์บันทึก "ใครหยิบ เมื่อไหร่ และหยิบได้แค่ไหน"
-- ---------------------------------------------------------------------------
alter table public.floor_work_order_items
  add column if not exists pick_status text,
  add column if not exists picked_by uuid,
  add column if not exists picked_at timestamptz,
  add column if not exists pick_note text;

do $$
begin
  -- ผู้หยิบชี้ไปที่ทะเบียนพนักงาน — on delete set null เพราะพนักงานลาออกได้
  -- แต่ประวัติว่า "บรรทัดนี้ถูกหยิบแล้ว" ต้องไม่หายไปพร้อมกับคน
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_picked_by_fkey'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_picked_by_fkey
      foreign key (picked_by) references public.floor_staff_profiles(id) on delete set null;
  end if;

  -- สามค่าที่คนคลังพูดจริงหน้ากองของ ไม่มีค่าที่สี่
  -- null = ยังไม่ได้แตะบรรทัดนี้ ซึ่งต่างจาก 'unavailable' (แตะแล้ว แต่ของไม่มี) อย่างสิ้นเชิง
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_pick_status_check'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_pick_status_check
      check (pick_status is null or pick_status in ('picked_full', 'picked_partial', 'unavailable'));
  end if;

  -- สถานะกับตัวเลขต้องไม่ขัดกันเอง: มีสถานะเมื่อไหร่ต้องมีตัวเลขเสมอ
  -- และ 'ไม่มีของ' ต้องเป็นศูนย์เป๊ะ ไม่ใช่ "ไม่มีของแต่หยิบมา 3"
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_pick_state_check'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_pick_state_check
      check (
        pick_status is null
        or (picked_qty is not null and (pick_status <> 'unavailable' or picked_qty = 0))
      );
  end if;
end
$$;

create index if not exists floor_work_order_items_pick_status_idx
  on public.floor_work_order_items(work_order_id, pick_status);

comment on column public.floor_work_order_items.pick_status is
  'ผลการหยิบต่อบรรทัด: picked_full = หยิบครบตามแผน, picked_partial = หยิบได้บางส่วน, unavailable = ไม่มีของให้หยิบ '
  '— null แปลว่ายังไม่ได้แตะบรรทัดนี้ ซึ่งต่างจาก unavailable ที่แปลว่าแตะแล้วและของไม่มีจริง';
comment on column public.floor_work_order_items.picked_by is 'พนักงานคลังที่กดบันทึกการหยิบบรรทัดนี้ครั้งล่าสุด';
comment on column public.floor_work_order_items.picked_at is 'เวลาที่บันทึกการหยิบบรรทัดนี้ครั้งล่าสุด';
comment on column public.floor_work_order_items.pick_note is 'หมายเหตุจากคลังต่อบรรทัด — บังคับกรอกเมื่อ pick_status = unavailable เพราะ "ไม่มีของ" ที่ไม่บอกเหตุผลใช้ตามต่อไม่ได้';

-- ---------------------------------------------------------------------------
-- 2) ด่านของทางเขียน: ตรวจสิทธิ์ + ล็อกใบสั่งงาน + ตรวจสถานะ
--    ลำดับล็อกเดียวกับ job_prep_edit_guard: "ใบสั่งงานก่อน แล้วค่อยบรรทัด" เสมอ
--    ทางเขียนทุกตัวในระบบจึงเข้าคิวเดียวกันและไม่มีทางเกิด deadlock ข้ามกัน
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_pick_guard(p_work_order_id uuid)
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
  where id = (select auth.uid()) and is_active and role in ('admin', 'warehouse');
  if v_actor.id is null then
    raise exception 'ต้องเป็นพนักงานคลัง (warehouse) หรือ admin เท่านั้นจึงจะบันทึกการหยิบของได้';
  end if;

  select * into v_order from public.floor_work_orders where id = p_work_order_id for update;
  if v_order.id is null then
    raise exception 'ไม่พบใบสั่งงาน id=%', p_work_order_id;
  end if;
  if v_order.status <> 'warehouse_preparing' then
    raise exception 'บันทึกการหยิบได้เฉพาะตอนคลังกำลังเตรียมสินค้าเท่านั้น (สถานะปัจจุบัน: %)', v_order.status;
  end if;
  -- เงื่อนไขเดียวกับ complete_floor_warehouse_order_v2: คนที่กดรับงานเป็นเจ้าของกองของนั้น
  if v_order.warehouse_assignee_id <> v_actor.id and v_actor.role <> 'admin' then
    raise exception 'ใบสั่งงานนี้มีพนักงานคลังคนอื่นรับไปแล้ว เฉพาะคนที่กดรับงาน (หรือ admin) เท่านั้นที่บันทึกการหยิบได้';
  end if;
  return v_actor;
end;
$function$;

comment on function public.warehouse_pick_guard(uuid) is
  'ด่านของการหยิบของรายบรรทัด: ตรวจ role (admin/warehouse) ล็อกแถวใบสั่งงานด้วย for update แล้วตรวจว่ายังเตรียมสินค้าอยู่ '
  'และผู้เรียกคือคนที่กดรับงาน — ล็อกลำดับเดียวกับ job_prep_edit_guard เพื่อให้ทุกทางเขียนเข้าคิวกัน';

-- ---------------------------------------------------------------------------
-- 3) บันทึกการหยิบหนึ่งบรรทัด
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
begin
  -- อ่านแบบไม่ล็อกก่อน เพื่อรู้ว่าบรรทัดนี้อยู่ใบไหน แล้วจึงล็อกตามลำดับ ใบสั่งงาน -> บรรทัด
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
    -- จำนวนมาจากแผนเสมอ ไม่รับตัวเลขจากผู้เรียก — "ครบ" แปลว่าครบตามแผน ไม่ใช่ครบตามที่พิมพ์
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

  update public.floor_work_order_items
  set picked_qty = v_qty,
      pick_status = v_status,
      picked_by = v_actor.id,
      picked_at = now(),
      pick_note = v_note,
      updated_at = now()
  where id = v_line.id;

  return jsonb_build_object(
    'itemId', v_line.id,
    'workOrderId', v_line.work_order_id,
    'pickStatus', v_status,
    'pickedQty', v_qty,
    'plannedQty', v_line.planned_qty,
    'pickNote', v_note,
    'pickedByName', v_actor.full_name,
    'pickedAt', now()
  );
end;
$function$;

comment on function public.record_warehouse_item_pick(uuid, text, numeric, text) is
  'บันทึกผลการหยิบของหนึ่งบรรทัดลง floor_work_order_items.picked_qty พร้อมสถานะ ผู้หยิบ และเวลา '
  '— จำนวนของ picked_full มาจาก planned_qty ฝั่งเซิร์ฟเวอร์เสมอ และ unavailable บังคับให้ระบุเหตุผล';

-- ---------------------------------------------------------------------------
-- 4) ทางอ่านของหน้าคลัง: บรรทัด + ผลการหยิบ + ของคงเหลือจริง ในการเรียกครั้งเดียว
--    ชื่อคอลัมน์ชุดสต็อกตั้งให้ตรงกับ get_job_stock_check เป๊ะ ๆ โดยตั้งใจ
--    เพื่อให้ฝั่งหน้าจอส่งแถวเข้า calculateJobStockShortage() ตัวเดิมได้เลย
--    ไม่ต้องมีสูตรคำนวณ "ของขาดเท่าไหร่" ชุดที่สองในระบบ
-- ---------------------------------------------------------------------------
create or replace function public.get_warehouse_pick_lines(p_work_order_id uuid)
returns table (
  item_id uuid,
  prep_source text,
  category text,
  item_name text,
  line_sku text,
  specification text,
  note text,
  unit text,
  sort_order integer,
  planned_qty numeric,
  actual_qty numeric,
  picked_qty numeric,
  pick_status text,
  pick_note text,
  picked_at timestamptz,
  picked_by_name text,
  stock_key text,
  stock_source text,
  registry_qty numeric,
  warehouse_qty numeric,
  available_qty numeric,
  warehouse_name text,
  snapshot_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- ด่านอ่านเดียวกับ RLS ของ floor_work_order_items (พนักงานที่ยัง active อ่านได้)
  -- ไม่เข้มกว่านั้น เพราะหน้าอื่นก็อ่านตารางนี้ตรง ๆ ได้อยู่แล้ว การทำให้เข้มกว่าจึงเป็นภาพลวง
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูรายการหยิบของได้';
  end if;

  return query
    with lines as (
      select i.*, coalesce(nullif(btrim(m.sku), ''), nullif(btrim(i.sku), '')) as stock_key
        from public.floor_work_order_items i
        left join public.materials m on m.id = i.material_id
       where i.work_order_id = p_work_order_id
    )
    select
      l.id,
      'work_order_item'::text,
      l.category,
      l.item_name,
      l.sku,
      l.specification,
      l.note,
      l.unit,
      l.sort_order,
      l.planned_qty,
      l.actual_qty,
      l.picked_qty,
      l.pick_status,
      l.pick_note,
      l.picked_at,
      p.full_name,
      l.stock_key,
      s.stock_source,
      s.registry_qty,
      s.warehouse_qty,
      s.available_qty,
      s.warehouse_name,
      s.snapshot_date
    from lines l
    left join public.floor_staff_profiles p on p.id = l.picked_by
    left join public.stock_availability_v1 s on s.sku = l.stock_key
    order by l.sort_order, l.created_at;
end;
$function$;

comment on function public.get_warehouse_pick_lines(uuid) is
  'รายการของที่คลังต้องหยิบของใบสั่งงานหนึ่งใบ พร้อมผลการหยิบรายบรรทัดและยอดคงเหลือของ SKU นั้น '
  '— ชื่อคอลัมน์ชุดสต็อกตรงกับ get_job_stock_check เพื่อให้ใช้ calculateJobStockShortage() ตัวเดียวกันได้';

-- ---------------------------------------------------------------------------
-- 5) สิทธิ์: เขียนได้เฉพาะ authenticated (แล้วยังต้องผ่านด่าน role ในตัวฟังก์ชันอีกชั้น)
--    anon ไม่ได้อะไรเพิ่มเลย และตารางไม่ได้เปิดสิทธิ์เขียนให้ client เพิ่มแม้แต่นิดเดียว
-- ---------------------------------------------------------------------------
revoke all on function public.warehouse_pick_guard(uuid) from public, anon, authenticated;
revoke all on function public.record_warehouse_item_pick(uuid, text, numeric, text) from public, anon;
revoke all on function public.get_warehouse_pick_lines(uuid) from public, anon;
grant execute on function public.record_warehouse_item_pick(uuid, text, numeric, text) to authenticated;
grant execute on function public.get_warehouse_pick_lines(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

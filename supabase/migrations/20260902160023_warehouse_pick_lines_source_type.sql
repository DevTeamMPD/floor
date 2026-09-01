-- FloorNow (แก้ตามรีวิว): get_warehouse_pick_lines คืน source_type เพื่อให้หน้าคลังกรองบรรทัดโน้ตได้ (D5) — คืน TABLE จึงต้อง drop ก่อนสร้างใหม่
--
-- บริบทเต็มของชุดแก้ D2/D4/D5 อยู่ในหัวไฟล์ 20260902160020 ไฟล์นี้เป็นส่วนหนึ่งของชุดเดียวกัน
-- และถูก apply เป็นคนละ migration entry บนฐานจริง ชื่อตรงกับชื่อไฟล์

begin;

-- get_warehouse_pick_lines คืน TABLE จึงต้อง drop ก่อน แล้วสร้างใหม่พร้อมคอลัมน์ source_type
drop function if exists public.get_warehouse_pick_lines(uuid);

create function public.get_warehouse_pick_lines(p_work_order_id uuid)
returns table (
  item_id uuid,
  prep_source text,
  category text,
  source_type text,
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
      l.source_type,
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
  '— ชื่อคอลัมน์ชุดสต็อกตรงกับ get_job_stock_check เพื่อให้ใช้ calculateJobStockShortage() ตัวเดียวกันได้ '
  'และคืน source_type เพื่อให้หน้าคลังกรองบรรทัดโน้ตของหัวหน้าช่างด้วยกฎตัวเดียวกับฝั่งช่าง (D5)';

-- ตั้งสิทธิ์คืนให้เหมือนเดิมเป๊ะหลัง drop: เขียน/อ่านได้เฉพาะ authenticated และ anon ไม่ได้อะไรเลย
revoke all on function public.get_warehouse_pick_lines(uuid) from public, anon;
grant execute on function public.get_warehouse_pick_lines(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

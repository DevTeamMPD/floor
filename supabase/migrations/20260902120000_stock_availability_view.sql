-- FloorNow P3-4 (1/4): ทางอ่าน "ของคงเหลือต่อ SKU" ทางเดียว — คืนดีสองแหล่งที่ขัดกันอยู่
--
-- ปัญหา: วันนี้ระบบมีตัวเลขของคงเหลืออยู่สองที่ และไม่มีใครเชื่อมให้
--   1) public.materials.qty_on_hand  — ทะเบียนวัสดุที่แอปเขียนเอง (หน้าคลังวัสดุ / รับของจาก PO)
--      วันนี้มีแค่ 2 แถว (RS-140, RS-110) และยอดเป็น 0 ทั้งคู่ → แทบไม่มีข้อมูลจริง
--   2) public.warehouseinventory   — snapshot ของคลังจริง (Samaedam_FG) ป้อนเข้ามาจากภายนอกทุกคืน
--      ~1,020 SKU ต่อวัน และ "หนึ่ง SKU มีหนึ่งแถวต่อหนึ่งวัน" (unique warehouse_name+sku+snapshot_date)
--
-- กับดักที่ต้องกันให้ตาย: ตาราง warehouseinventory เก็บ "ทุกวัน" (วันนี้ 78 วัน 76,115 แถว)
-- ถ้าเผลอ query โดยไม่กรองวันที่ ยอดคงเหลือทุกตัวจะถูกบวกซ้ำ 78 เท่า
-- จึงต้องกรอง snapshot_date = (select max(snapshot_date) from public.warehouseinventory) เสมอ
-- ตัวกรองบรรทัดนี้ถูกล็อกด้วยเทสที่ lib/stock-shortage.test.ts (อ่านไฟล์ migration นี้ตรง ๆ)
-- ถ้ามีใครลบออก เทสจะแดงทันที
--
-- ทำไมเป็น view: ตัวเลขของคงเหลือเป็นข้อมูลอ่านอย่างเดียวล้วน ๆ ไม่มี parameter ต่อหนึ่งงาน
-- และต้องถูกใช้ซ้ำจากหลายฟังก์ชัน (เช็คต่อใบสั่งงาน / เช็ครวมตอนกลางคืน) จึงเหมาะกับ view
-- แต่ view นี้ "ไม่เปิดให้ client อ่านตรง" — revoke ทิ้งทั้ง anon และ authenticated
-- เพราะ warehouseinventory ไม่เคยเปิดให้ client มาก่อน การมี view ต้องไม่กลายเป็นช่องใหม่
-- ฝั่งหน้าจออ่านผ่าน RPC get_stock_availability() ซึ่งมีด่านตรวจพนักงานในตัว

begin;

create or replace view public.stock_availability_v1 as
select
  coalesce(m.sku, w.sku)                                   as sku,
  m.id                                                     as material_id,
  coalesce(nullif(btrim(m.name), ''), w.product_name)      as item_name,
  m.unit                                                   as unit,
  w.warehouse_name                                         as warehouse_name,
  w.snapshot_date                                          as snapshot_date,
  -- แยกสองแหล่งไว้ให้เห็นทั้งคู่ ไม่ยุบรวมเงียบ ๆ เพราะเมื่อไหร่ที่สองเลขไม่ตรงกัน คนต้องเห็นว่าไม่ตรง
  m.qty_on_hand                                            as registry_qty,
  w.qty_available                                          as warehouse_qty,
  -- ยอดที่ใช้ตัดสิน: ถ้ามีใน snapshot คลังจริง ใช้คลังจริงเสมอ เพราะทะเบียน materials แทบว่าง
  -- และ snapshot มาจากการนับของจริงรายวัน ส่วนทะเบียนเป็นตัวเลขที่คนกรอกมือ
  case when w.sku is not null then w.qty_available else m.qty_on_hand end as available_qty,
  case
    when w.sku is not null then 'warehouse'
    when m.id  is not null then 'materials'
  end                                                      as stock_source
from public.materials m
full join (
  select
    w.sku,
    max(w.warehouse_name) as warehouse_name,
    max(w.product_name)   as product_name,
    w.snapshot_date       as snapshot_date,
    sum(coalesce(w.qty_available, 0)) as qty_available
  from public.warehouseinventory w
  where w.sku is not null
    and btrim(w.sku) <> ''
    and w.snapshot_date = (select max(snapshot_date) from public.warehouseinventory)
  group by w.sku, w.snapshot_date
) w on w.sku = m.sku;

comment on view public.stock_availability_v1 is
  'ของคงเหลือต่อ SKU รวมสองแหล่ง: materials.qty_on_hand (ทะเบียน) และ warehouseinventory (snapshot ล่าสุดของคลังจริง). '
  'บังคับกรอง snapshot_date = max(snapshot_date) เสมอ มิฉะนั้นยอดจะถูกนับซ้ำเท่าจำนวนวันใน snapshot. '
  'ไม่เปิดให้ client อ่านตรง — อ่านผ่าน public.get_stock_availability() เท่านั้น';

revoke all on public.stock_availability_v1 from anon, authenticated;

-- ด่านตรวจร่วมของงานเช็คสต็อก: พนักงานที่ยัง active อ่านได้ และงานเบื้องหลังที่วิ่งด้วย service_role อ่านได้
-- ตัวหลังจำเป็นเพราะ cron ไม่มี session ของคน แต่ service_role ข้าม RLS ได้อยู่แล้วโดยธรรมชาติ
-- จึงไม่ได้เปิดสิทธิ์ใหม่ให้ใคร เป็นแค่การบอกฟังก์ชันว่า "ผู้เรียกที่ไม่มี auth.uid() คือเซิร์ฟเวอร์"
create or replace function public.is_floor_stock_reader()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null then
    return (select public.is_floor_staff_active());
  end if;
  return coalesce((select auth.jwt()->>'role'), '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin');
end;
$function$;

comment on function public.is_floor_stock_reader() is
  'true เมื่อผู้เรียกเป็นพนักงานที่ยัง active หรือเป็นงานเบื้องหลังที่วิ่งด้วย service_role';

create or replace function public.get_stock_availability()
returns table (
  sku text,
  material_id uuid,
  item_name text,
  unit text,
  warehouse_name text,
  snapshot_date date,
  registry_qty numeric,
  warehouse_qty numeric,
  available_qty numeric,
  stock_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (select public.is_floor_stock_reader()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูยอดคงเหลือได้';
  end if;
  return query
    select s.sku, s.material_id, s.item_name, s.unit, s.warehouse_name, s.snapshot_date,
           s.registry_qty, s.warehouse_qty, s.available_qty, s.stock_source
      from public.stock_availability_v1 s
     order by s.sku;
end;
$function$;

comment on function public.get_stock_availability() is
  'ยอดคงเหลือต่อ SKU (อ่านอย่างเดียว) จาก stock_availability_v1 พร้อมบอกว่ายอดมาจากแหล่งไหน';

revoke all on function public.is_floor_stock_reader() from public, anon;
revoke all on function public.get_stock_availability() from public, anon;
grant execute on function public.get_stock_availability() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

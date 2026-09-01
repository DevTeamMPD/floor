-- FloorNow P3-4 (3/4): เทียบ "ของที่งานหนึ่งใบต้องใช้" กับ "ของที่มีจริง" และหางานที่ใกล้ถึงวันติดตั้ง
--
-- ฟังก์ชันในไฟล์นี้ "ไม่ตัดสิน" ว่าขาดหรือไม่ขาด มันคืนแค่ตัวเลขดิบต่อบรรทัด
-- การคำนวณว่าขาดเท่าไหร่ อยู่ในฟังก์ชันบริสุทธิ์ฝั่ง TypeScript ที่ lib/stock-shortage.ts
-- เหตุผล: ตรรกะเดียวถูกใช้ทั้งบนหน้าจอ (ตอนคนเปิดดู) และใน cron (ตอนกลางคืน)
-- ถ้าเขียนไว้สองที่ (SQL หนึ่งชุด TS อีกชุด) วันหนึ่งตัวเลขบนหน้าจอกับในแจ้งเตือนจะไม่ตรงกัน
-- และไม่มีใครรู้ว่าอันไหนถูก จึงเลือกให้ SQL เป็น "ผู้ส่งข้อมูล" และ TS เป็น "ผู้ตัดสิน" ที่เดียว
--
-- รายการของที่ต้องเตรียม อ่านผ่าน public.get_job_prep_list เท่านั้น (ทางเดียวตามที่ P3-7 วางไว้)
-- ของคงเหลือ อ่านผ่าน public.stock_availability_v1 (กรอง snapshot ล่าสุดแล้วในตัว view)

begin;

create or replace function public.get_job_stock_check(p_job_no text)
returns table (
  item_id uuid,
  prep_source text,
  category text,
  item_name text,
  line_sku text,
  unit text,
  planned_qty numeric,
  actual_qty numeric,
  picked_qty numeric,
  -- SKU ที่ใช้จับคู่กับสต็อกจริง: ถ้าบรรทัดผูกทะเบียนวัสดุไว้ ใช้ SKU ของทะเบียน มิฉะนั้นใช้ SKU บนบรรทัด
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
  if not (select public.is_floor_stock_reader()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะตรวจสอบสต็อกของงานนี้ได้';
  end if;

  return query
    with lines as (
      select l.*, coalesce(nullif(btrim(m.sku), ''), nullif(btrim(l.sku), '')) as stock_key
        from public.get_job_prep_list(p_job_no) l
        left join public.materials m on m.id = l.material_id
    )
    select
      l.item_id,
      l.source,
      l.category,
      l.item_name,
      l.sku,
      l.unit,
      l.planned_qty,
      l.actual_qty,
      l.picked_qty,
      l.stock_key,
      s.stock_source,
      s.registry_qty,
      s.warehouse_qty,
      s.available_qty,
      s.warehouse_name,
      s.snapshot_date
    from lines l
    left join public.stock_availability_v1 s on s.sku = l.stock_key
    order by l.sort_order, l.item_name;
end;
$function$;

comment on function public.get_job_stock_check(text) is
  'คืนรายการของที่ต้องเตรียมของงานหนึ่งใบ พร้อมยอดคงเหลือของ SKU นั้นจากสต็อกจริง (อ่านอย่างเดียว) โดยไม่ตัดสินว่าขาดหรือไม่ — การตัดสินอยู่ที่ lib/stock-shortage.ts';

-- หางานที่ใกล้ถึงวันติดตั้งภายใน N วัน
-- ใช้ appointments.slot_start เป็นวันติดตั้งจริง (ไม่ใช่ install_jobs.appt_date) ตามที่หน้าปฏิบัติการใช้อยู่
-- และตีความ "วัน" ตามเวลาไทย เพราะคนที่ต้องลงมือทำอยู่ที่ไทย ไม่ใช่ UTC
create or replace function public.list_upcoming_jobs_for_stock_check(p_days_ahead integer default 7)
returns table (
  job_no text,
  customer_name text,
  appointment_id uuid,
  work_order_id uuid,
  work_order_status text,
  slot_start timestamptz,
  install_date date,
  days_until integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  -- กันค่าเพี้ยน: ติดลบหรือ null ให้ใช้ 7 และไม่ให้เกิน 60 วัน เพื่อไม่ให้ cron ไปกวาดทั้งปฏิทิน
  v_days integer := least(greatest(coalesce(p_days_ahead, 7), 0), 60);
begin
  if not (select public.is_floor_stock_reader()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูงานที่ใกล้ถึงวันติดตั้งได้';
  end if;

  return query
    select distinct on (a.job_id)
      a.job_id,
      j.customer_name,
      a.id,
      w.id,
      w.status,
      a.slot_start,
      (a.slot_start at time zone 'Asia/Bangkok')::date,
      ((a.slot_start at time zone 'Asia/Bangkok')::date - v_today)::integer
    from public.appointments a
    join public.install_jobs j on j.job_no = a.job_id
    join public.floor_work_orders w
      on (w.job_no = a.job_id or w.appointment_id = a.id)
     and w.status not in ('closed', 'cancelled', 'returned_sales')
    where a.status <> 'cancelled'
      and (a.slot_start at time zone 'Asia/Bangkok')::date >= v_today
      and (a.slot_start at time zone 'Asia/Bangkok')::date <= v_today + v_days
    order by a.job_id, a.slot_start, w.created_at desc;
end;
$function$;

comment on function public.list_upcoming_jobs_for_stock_check(integer) is
  'งานที่มีวันติดตั้ง (appointments.slot_start ตามเวลาไทย) ภายใน N วันนับจากวันนี้ และใบสั่งงานยังไม่ปิด/ยกเลิก — หนึ่งแถวต่อหนึ่งงาน';

revoke all on function public.get_job_stock_check(text) from public, anon;
revoke all on function public.list_upcoming_jobs_for_stock_check(integer) from public, anon;
grant execute on function public.get_job_stock_check(text) to authenticated, service_role;
grant execute on function public.list_upcoming_jobs_for_stock_check(integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- FloorNow P4-2: ตามเครื่องมือที่เบิกออกไปแล้วยังไม่ได้คืน และตอบให้ได้ว่า "ตอนนี้อยู่กับใคร"
--
-- ปัญหาที่แก้: เครื่องมือ (item_kind = 'tool') ถูกเบิกออกจากคลังไปกับทีมช่างทุกวัน
-- แต่ไม่มีที่ไหนในระบบที่บอกว่าชิ้นไหนยังไม่กลับมา ออกไปกี่วันแล้ว และต้องโทรหาใคร
-- คลังจึงรู้ว่าของหายก็ต่อเมื่อวันหนึ่งหยิบให้งานถัดไปไม่ได้
--
-- "อยู่กับใคร" = ทีม เป็นคำตอบหลัก และช่างรายคนเป็นคำตอบเสริม — เหตุผลจากข้อมูลจริง:
--   * งานถูกมอบหมายที่ระดับทีมเสมอ: appointments.tech_id -> tech_teams (92 นัดหมาย มีทีมครบ 92)
--   * ช่างรายคนใน appointment_technicians เป็นของที่ "อาจจะมี" เท่านั้น
--     (มีแค่ 25 จาก 92 นัดหมายที่ระบุตัวช่าง) ถ้ายึดคนเป็นคำตอบหลัก เครื่องมือ 2 ใน 3 ใบ
--     จะไม่มีใครรับผิดชอบเลย ซึ่งแย่กว่าการตอบว่า "อยู่กับทีม ก"
--   * เครื่องมือเดินทางไปกับรถของทีม ไม่ได้อยู่ในกระเป๋าของคนใดคนหนึ่ง ตัวช่างในทีมเปลี่ยนได้ระหว่างงาน
--     แต่ทีมยังเป็นทีมเดิม หนี้ทางของจึงเป็นของทีม
--   * กรณีที่สำคัญที่สุดคือทีมภายนอก: tech_teams.provider_type = 'subcontract' แปลว่า
--     เครื่องมือที่ค้างอยู่คือหนี้ของบริษัทอื่น ไม่ใช่ของพนักงานเรา และถ้าช่างคนล่าสุดที่แตะบรรทัดนั้น
--     มี floor_technicians.provider_id เราจะรู้ชื่อผู้รับเหมาจาก suppliers ตรง ๆ
--     สองคอลัมน์นี้ branch นี้เพิ่งเพิ่มมาและยังไม่มีโค้ดไหนอ่าน — ที่นี่คือที่แรกที่ใช้จริง
--   ช่างรายคนที่คืนมาด้วยคือ "เบอร์ที่โทรได้" ไม่ใช่ตัวผู้รับผิดชอบ ไล่จาก คนที่บันทึกยอดใช้/คืนล่าสุด
--   -> คนที่ตรวจรับของบรรทัดนั้นหน้างาน -> หัวหน้าทีมของนัดหมายนั้น
--
-- "ค้างกี่วัน" นับจากวันที่ของออกจากคลัง ไล่ลงมาตามความแม่นยำ:
--   picked_at (คลังหยิบบรรทัดนี้) -> warehouse_completed_at (คลังปิดงานทั้งใบ)
--   -> slot_start (วันนัดติดตั้ง) -> updated_at ของบรรทัด
--   บรรทัดที่คลังหยิบผ่านทางเดิมทั้งใบไม่มี picked_at จึงต้องมีบันไดนี้ ไม่งั้นจะแสดง "— วัน"
--
-- ขอบเขตของ "ยังไม่ได้คืน": item_kind = 'tool' และ picked_qty > 0 และ returned_qty < picked_qty
--   งานที่ปิดไปแล้วยังต้องอยู่ในรายการ — เครื่องมือไม่ได้กลับมาเพราะงานจบ นั่นแหละคือปัญหา
--   งานที่ยังไม่ถึงมือช่าง (head_review / returned_sales / warehouse_waiting / warehouse_preparing)
--   ไม่นับ เพราะของยังกองอยู่ที่คลัง ไม่ได้อยู่กับใคร
--
-- อ่านอย่างเดียว ไม่มีทางเขียนใหม่ในไฟล์นี้ ไม่มีตารางใหม่ ไม่เปิดสิทธิ์ให้ anon

begin;

create or replace function public.get_outstanding_tools()
returns table (
  item_id uuid,
  work_order_id uuid,
  work_order_status text,
  job_no text,
  customer_name text,
  item_name text,
  sku text,
  unit text,
  picked_qty numeric,
  returned_qty numeric,
  outstanding_qty numeric,
  out_since timestamptz,
  out_since_source text,
  days_out integer,
  appointment_start timestamptz,
  team_id uuid,
  team_name text,
  team_phone text,
  team_provider_type text,
  holder_technician_id uuid,
  holder_technician_name text,
  holder_technician_phone text,
  holder_source text,
  provider_id uuid,
  provider_name text,
  usage_recorded_at timestamptz,
  usage_note text,
  pick_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- ด่านอ่านเดียวกับ RLS ของ floor_work_order_items: พนักงานที่ยัง active เท่านั้น
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูรายการเครื่องมือค้างคืนได้';
  end if;

  return query
  with tools as (
    select i.*, w.job_no as wo_job_no, w.status as wo_status, w.appointment_id, w.warehouse_completed_at
      from public.floor_work_order_items i
      join public.floor_work_orders w on w.id = i.work_order_id
     where i.item_kind = 'tool'
       and coalesce(i.picked_qty, 0) > 0
       and coalesce(i.returned_qty, 0) < coalesce(i.picked_qty, 0)
       and w.status not in ('head_review', 'returned_sales', 'warehouse_waiting', 'warehouse_preparing')
  ),
  holder as (
    select t.id as tool_item_id,
           coalesce(t.usage_recorded_by, r.technician_id, lead.technician_id) as technician_id,
           case
             when t.usage_recorded_by is not null then 'usage'
             when r.technician_id is not null then 'receipt'
             when lead.technician_id is not null then 'team_lead'
             else 'unknown'
           end as holder_source
      from tools t
      left join public.floor_work_order_item_receipts r on r.item_id = t.id
      left join lateral (
        select at.technician_id
          from public.appointment_technicians at
         where at.appointment_id = t.appointment_id and at.is_active
         order by at.is_lead desc, at.assigned_at
         limit 1
      ) lead on true
  )
  select
    t.id,
    t.work_order_id,
    t.wo_status,
    t.wo_job_no,
    j.customer_name,
    t.item_name,
    t.sku,
    t.unit,
    coalesce(t.picked_qty, 0),
    coalesce(t.returned_qty, 0),
    coalesce(t.picked_qty, 0) - coalesce(t.returned_qty, 0),
    coalesce(t.picked_at, t.warehouse_completed_at, a.slot_start, t.updated_at),
    case
      when t.picked_at is not null then 'picked_at'
      when t.warehouse_completed_at is not null then 'warehouse_completed_at'
      when a.slot_start is not null then 'appointment'
      else 'row_updated_at'
    end,
    greatest(0, floor(extract(epoch from (now() - coalesce(t.picked_at, t.warehouse_completed_at, a.slot_start, t.updated_at))) / 86400))::integer,
    a.slot_start,
    tt.id,
    coalesce(tt.name, 'ยังไม่ระบุทีม'),
    tt.phone,
    tt.provider_type,
    h.technician_id,
    ft.name,
    ft.phone,
    h.holder_source,
    ft.provider_id,
    s.name,
    t.usage_recorded_at,
    t.usage_note,
    t.pick_note
  from tools t
  join holder h on h.tool_item_id = t.id
  left join public.appointments a on a.id = t.appointment_id
  left join public.tech_teams tt on tt.id = a.tech_id
  left join public.install_jobs j on j.job_no = t.wo_job_no
  left join public.floor_technicians ft on ft.id = h.technician_id
  left join public.suppliers s on s.id = ft.provider_id
  -- ค้างนานสุดขึ้นก่อนเสมอ: เรียงตามวันที่ของออกจากคลังจากเก่าไปใหม่
  order by coalesce(t.picked_at, t.warehouse_completed_at, a.slot_start, t.updated_at) asc, t.wo_job_no;
end;
$function$;

comment on function public.get_outstanding_tools() is
  'เครื่องมือ (item_kind = tool) ที่เบิกออกไปแล้วยังคืนไม่ครบ พร้อมทีมที่รับผิดชอบ ช่างที่โทรได้ '
  'ผู้รับเหมาภายนอก (ถ้ามี) และจำนวนวันที่ค้าง — เรียงจากค้างนานสุดก่อน อ่านอย่างเดียว เฉพาะพนักงานที่ active';

revoke all on function public.get_outstanding_tools() from public, anon;
grant execute on function public.get_outstanding_tools() to authenticated;

-- ถอน grant ค้างของ anon บน suppliers ทิ้ง — RLS policy ของตารางนี้ผูกกับ role authenticated อยู่แล้ว
-- anon จึงอ่านไม่ได้จริงตั้งแต่แรก แต่ตั้งแต่ P4-2 เป็นต้นไป ชื่อผู้รับเหมาภายนอกเป็นข้อมูลที่ระบบใช้ตอบ
-- ว่า "เครื่องมืออยู่กับบริษัทไหน" จึงไม่ควรเหลือ grant ที่ทำให้เข้าใจผิดว่าเปิดให้คนนอกอ่านได้
-- (แพตเทิร์นเดียวกับที่ P3-6 ถอนบน ncr_reports และที่ไฟล์ ...150000 ถอนบน stock_movements)
revoke all on public.suppliers from anon;

notify pgrst, 'reload schema';

commit;

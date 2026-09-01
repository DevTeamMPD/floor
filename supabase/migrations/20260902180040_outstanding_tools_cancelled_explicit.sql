-- ============================================================================
-- outstanding_tools_cancelled_explicit
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   get_outstanding_tools คือรายงาน "เครื่องมือที่ออกจากคลังแล้วยังไม่กลับ"
--   เดิมกรองสถานะใบสั่งงานด้วย "บัญชีดำ" (status not in (...)) ซึ่งมีปัญหาสองข้อ
--     1) สถานะใหม่ที่ใครเพิ่มเข้ามาในอนาคตจะไหลเข้ารายการนี้เองโดยไม่มีใครตัดสินใจ
--        — บัญชีดำคือรายการที่ลืมอัปเดตได้ง่ายที่สุด
--     2) สถานะ 'cancelled' เคยหลุดออกจากรายงาน ซึ่งเป็นช่องโหว่ที่ร้ายแรงที่สุด
--        คือ "ยกเลิกงานแล้วหนี้ทางของหายไปด้วย" — วิธีทำของหายที่ไม่มีใครเห็น
--
--   ไฟล์นี้จึงเปลี่ยนเป็น "บัญชีขาว" ที่ตัดสินไว้ทีละตัวครบทั้ง 9 ค่าของ
--   floor_work_orders_status_check:
--     ยังไม่นับ (ของยังอยู่ในคลัง) : head_review, returned_sales,
--                                    warehouse_waiting, warehouse_preparing
--     นับ (ของออกจากคลังไปแล้ว)   : ready_to_install, installing, waiting_cs,
--                                    closed, cancelled
--
--   เหตุผลที่ 'cancelled' ต้องถูกนับ: การยกเลิกงานเป็นเรื่องของสัญญากับลูกค้า
--   ไม่ใช่เรื่องของตำแหน่งทางกายภาพของของ สว่านที่ถูกเบิกออกไปแล้วไม่ได้เดินกลับมาเอง
--   เพราะงานถูกยกเลิก เหตุผลเต็มอยู่ในคอมเมนต์ในตัวฟังก์ชัน (คัดจากฐานข้อมูลจริง)
--
-- ไฟล์นี้รันซ้ำได้ เพราะเป็น create or replace function
-- คัดลอกจาก pg_get_functiondef ของฐานข้อมูลจริงแบบตัวอักษรต่อตัวอักษร
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_outstanding_tools()
 RETURNS TABLE(item_id uuid, work_order_id uuid, work_order_status text, job_no text, customer_name text, item_name text, sku text, unit text, picked_qty numeric, returned_qty numeric, outstanding_qty numeric, out_since timestamp with time zone, out_since_source text, days_out integer, appointment_start timestamp with time zone, team_id uuid, team_name text, team_phone text, team_provider_type text, holder_technician_id uuid, holder_technician_name text, holder_technician_phone text, holder_source text, provider_id uuid, provider_name text, usage_recorded_at timestamp with time zone, usage_note text, pick_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       -- E4: เปลี่ยนจาก "ไม่เอาสถานะเหล่านี้" (บัญชีดำ) เป็น "เอาเฉพาะสถานะเหล่านี้" (บัญชีขาว)
       -- ของเดิมเป็น not in (...) ซึ่งแปลว่าสถานะใหม่ที่ใครเพิ่มเข้ามาวันหน้าจะไหลเข้ารายการนี้เงียบ ๆ
       -- ครบทั้ง 9 ค่าของ floor_work_orders_status_check ถูกตัดสินไว้ตรงนี้ทีละตัว ไม่มีตัวไหนตกสำรวจ:
       --   ยังไม่นับ (ของยังอยู่ในคลัง ไม่ได้อยู่กับใคร):
       --     head_review, returned_sales  = ใบยังไม่ถึงคลังด้วยซ้ำ
       --     warehouse_waiting, warehouse_preparing = คลังยังไม่จ่ายของออกไป
       --   นับ (ของออกจากคลังไปแล้ว จึงมีคนถืออยู่):
       --     ready_to_install, installing, waiting_cs
       --     closed    = งานจบแล้วแต่เครื่องมือยังไม่กลับ — นี่คือกรณีที่ตั้งใจตามตั้งแต่แรก
       --     cancelled = **จงใจรวมไว้** เครื่องมือที่ออกจากคลังไปแล้วยังอยู่นอกคลังจริง ๆ
       --                 ต่อให้งานถูกยกเลิก สว่านก็ไม่ได้เดินกลับมาเอง การยกเลิกงานเป็นเรื่องของสัญญากับลูกค้า
       --                 ไม่ใช่เรื่องของตำแหน่งทางกายภาพของของ ถ้าตัดออกจะกลายเป็นช่องโหว่ที่แย่ที่สุด
       --                 คือ "ยกเลิกงานแล้วหนี้ทางของหายไปด้วย" ซึ่งเป็นวิธีทำของหายที่ไม่มีใครเห็น
       --                 ข้อมูลจริงยืนยันว่ากรณีนี้เกิดขึ้นแล้ว: floor_work_order_items 3 จาก 13 แถว
       --                 อยู่บนใบที่สถานะ cancelled และทั้ง 3 แถวมี actual_qty (ของออกจากคลังไปแล้วจริง)
       and w.status in ('ready_to_install', 'installing', 'waiting_cs', 'closed', 'cancelled')
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

-- สิทธิ์ — ตรงตามสถานะจริง: {postgres, authenticated, service_role}
-- (anon ถูกตัดออกไปแล้วใน migration 20260901094102 outstanding_tools_revoke_anon_suppliers)
revoke all on function public.get_outstanding_tools() from public;
revoke all on function public.get_outstanding_tools() from anon;
grant execute on function public.get_outstanding_tools() to authenticated, service_role;

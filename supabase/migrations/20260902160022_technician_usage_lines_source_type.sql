-- FloorNow (แก้ตามรีวิว): get_technician_usage_lines ส่ง sourceType กลับ เพื่อให้แผงปิดยอดใช้กฎเดียวกัน (D2)
--
-- บริบทเต็มของชุดแก้ D2/D4/D5 อยู่ในหัวไฟล์ 20260902160020 ไฟล์นี้เป็นส่วนหนึ่งของชุดเดียวกัน
-- และถูก apply เป็นคนละ migration entry บนฐานจริง ชื่อตรงกับชื่อไฟล์

begin;

create or replace function public.get_technician_usage_lines(
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
    return jsonb_build_object('found', false, 'reason', 'no_work_order', 'canRecord', false, 'lines', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'found', true,
    'workOrderId', v_order.id,
    'workOrderStatus', v_order.status,
    'jobNo', v_order.job_no,
    'canRecord', v_order.status in ('ready_to_install', 'installing', 'waiting_cs', 'closed'),
    -- งานปิดแล้วยังคืนเครื่องมือได้ แต่แก้ยอดการใช้ไม่ได้ — หน้าจอต้องบอกช่างล่วงหน้า ไม่ใช่ให้กดแล้วเด้ง
    'returnOnly', v_order.status = 'closed',
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.id,
        'category', i.category,
        'itemKind', i.item_kind,
        'itemName', i.item_name,
        'sourceType', i.source_type,
        'sku', i.sku,
        'specification', i.specification,
        'unit', i.unit,
        'note', i.note,
        'plannedQty', i.planned_qty,
        'actualQty', i.actual_qty,
        'pickedQty', i.picked_qty,
        'pickStatus', i.pick_status,
        'expectedQty', coalesce(i.picked_qty, i.actual_qty, i.planned_qty),
        'usedQty', i.used_qty,
        'returnedQty', i.returned_qty,
        'usageNote', i.usage_note,
        'usageRecordedAt', i.usage_recorded_at,
        'usageRecordedByName', t.name
      ) order by i.sort_order, i.created_at)
      from public.floor_work_order_items i
      left join public.floor_technicians t on t.id = i.usage_recorded_by
      where i.work_order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$function$;

notify pgrst, 'reload schema';

commit;

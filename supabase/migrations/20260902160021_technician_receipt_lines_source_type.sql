-- FloorNow (แก้ตามรีวิว): get_technician_receipt_lines ส่ง sourceType กลับให้หน้าจอช่าง (D2)
--
-- บริบทเต็มของชุดแก้ D2/D4/D5 อยู่ในหัวไฟล์ 20260902160020 ไฟล์นี้เป็นส่วนหนึ่งของชุดเดียวกัน
-- และถูก apply เป็นคนละ migration entry บนฐานจริง ชื่อตรงกับชื่อไฟล์

begin;

create or replace function public.get_technician_receipt_lines(
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
    return jsonb_build_object(
      'found', false, 'reason', 'no_work_order',
      'reasonOptions', public.floor_receipt_reason_catalog(), 'lines', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'workOrderId', v_order.id,
    'workOrderStatus', v_order.status,
    'jobNo', v_order.job_no,
    -- ยืนยันการรับของได้เฉพาะหลังคลังจ่ายของแล้ว และก่อนงานจบ ที่นอกช่วงนี้หน้าจอจะแสดงเหตุผลแทนปุ่ม
    'canConfirm', v_order.status in ('ready_to_install', 'installing'),
    'reasonOptions', public.floor_receipt_reason_catalog(),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', i.id,
        'category', i.category,
        'itemName', i.item_name,
        'sku', i.sku,
        -- D2: หน้าจอต้องรู้ source_type จึงจะใช้กฎ isFreeformWorkNote() ตัวจริงได้ (ครบ 6 เงื่อนไข)
        'sourceType', i.source_type,
        'specification', i.specification,
        'unit', i.unit,
        'note', i.note,
        'plannedQty', i.planned_qty,
        'actualQty', i.actual_qty,
        'pickedQty', i.picked_qty,
        'pickStatus', i.pick_status,
        'pickNote', i.pick_note,
        'expectedQty', coalesce(i.picked_qty, i.actual_qty, i.planned_qty),
        'receipt', case when r.id is null then null else jsonb_build_object(
          'status', r.receipt_status,
          'receivedQty', r.received_qty,
          'expectedQty', r.expected_qty,
          'shortageQty', r.shortage_qty,
          'reasonCode', r.reason_code,
          'reasonNote', r.reason_note,
          'ncrId', r.ncr_id,
          'technicianName', r.technician_name,
          'confirmedAt', r.confirmed_at
        ) end
      ) order by i.sort_order, i.created_at)
      from public.floor_work_order_items i
      left join public.floor_work_order_item_receipts r on r.item_id = i.id
      where i.work_order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$function$;

notify pgrst, 'reload schema';

commit;

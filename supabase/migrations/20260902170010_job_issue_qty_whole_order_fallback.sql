-- ============================================================================
-- job_issue_qty_whole_order_fallback
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   sync_job_stock_movements คือจุดเดียวที่แปล "บรรทัดของในใบสั่งงาน" ให้เป็น
--   ความเคลื่อนไหวสต็อกจริง (stock_movements) ปัญหาคือคลังมีสองทางบันทึกการจ่ายของ
--     * ทางหยิบทีละบรรทัด  (record_warehouse_item_pick)      -> เขียนลง picked_qty
--     * ทางปิดทั้งใบแบบเดิม (complete_floor_warehouse_order_v2) -> เขียนลง actual_qty
--   เดิมฟังก์ชันอ่านแต่ picked_qty ทำให้ใบที่คลังปิดทั้งใบ (ไม่ได้หยิบทีละบรรทัด)
--   ได้ยอดเบิกเป็น 0 — ของออกจากคลังไปแล้วจริงแต่บัญชีสต็อกไม่ขยับ
--
--   จึงเพิ่ม fallback เป็น coalesce(picked_qty, actual_qty, 0)
--
--   *** เจตนาสำคัญ: หยุดที่ actual_qty ไม่ถอยไป planned_qty ***
--   planned_qty คือ "แผนว่าจะเบิก" ไม่ใช่ "ของที่ออกจากคลังจริง"
--   ถ้าเอา planned_qty มาเป็น fallback ระบบจะตัดสต็อกตามแผนของใบที่คลังยังไม่จ่ายของ
--   ซึ่งทำให้ยอดคงเหลือหายไปทั้งที่ของยังอยู่บนชั้น — เป็น bug ที่หาไม่เจอง่าย
--   ค่า 0 (คือ "ยังไม่มีการเบิก") ถูกต้องกว่าการเดาจากแผนเสมอ
--
-- ไฟล์นี้รันซ้ำได้ เพราะเป็น create or replace function
-- คัดลอกมาจาก pg_get_functiondef ของฐานข้อมูลจริงแบบตัวอักษรต่อตัวอักษร
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_job_stock_movements(p_item_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line public.floor_work_order_items%rowtype;
  v_order public.floor_work_orders%rowtype;
  v_actor text := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'ระบบ');
  v_row record;
  v_note text;
  v_written jsonb := '[]'::jsonb;
  -- E2: จำนวนที่ออกจากคลังจริง — ตั้งค่าหลัง select เท่านั้น (ตอน declare ยังไม่มีข้อมูลบรรทัด)
  v_issued numeric;
begin
  select * into v_line from public.floor_work_order_items where id = p_item_id;
  if v_line.id is null then
    raise exception 'ไม่พบรายการ id=%', p_item_id;
  end if;

  -- ทางหยิบทีละบรรทัด (record_warehouse_item_pick) เขียน picked_qty
  -- ทางเดิมทั้งใบ (complete_floor_warehouse_order_v2) เขียน actual_qty
  -- หยุดแค่สองขั้น ไม่ถอยไป planned_qty เพราะแผนไม่ใช่ของที่ออกจากคลังจริง
  v_issued := coalesce(v_line.picked_qty, v_line.actual_qty, 0);

  select * into v_order from public.floor_work_orders where id = v_line.work_order_id;
  if v_order.id is null then
    raise exception 'ไม่พบใบสั่งงานของรายการ id=%', p_item_id;
  end if;

  if not exists (select 1 from public.install_jobs where job_no = v_order.job_no) then
    raise exception 'เลขงาน % ไม่มีในทะเบียนงานติดตั้ง จึงบันทึกความเคลื่อนไหวสต็อกที่อ้างถึงงานนี้ไม่ได้', v_order.job_no;
  end if;

  for v_row in
    select *
      from (values
        ('job_issue',       'out',    v_issued,                         'เบิกออกจากคลังไปหน้างาน'),
        ('job_return',      'return', coalesce(v_line.returned_qty, 0), 'คืนของกลับเข้าคลัง'),
        ('job_consumption', 'adjust', coalesce(v_line.used_qty, 0),     'ใช้จริงที่หน้างาน (ไม่หักยอดคลังซ้ำ เพราะของออกจากคลังไปแล้วตอนเบิก)')
      ) as t(kind, mtype, qty, label)
  loop
    if v_row.qty > 0 then
      v_note := format('%s · %s%s · %s %s · ใบสั่งงาน %s',
        v_row.label, v_line.item_name,
        coalesce(' (' || v_line.sku || ')', ''),
        v_row.qty, v_line.unit, v_order.job_no);

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
      delete from public.stock_movements
      where ref_work_order_item_id = v_line.id and movement_kind = v_row.kind;
    end if;
  end loop;

  return jsonb_build_object(
    'itemId', v_line.id,
    'jobNo', v_order.job_no,
    'issuedQty', v_issued,
    'issuedFrom', case when v_line.picked_qty is not null then 'picked_qty'
                       when v_line.actual_qty is not null then 'actual_qty'
                       else 'none' end,
    'pickedQty', coalesce(v_line.picked_qty, 0),
    'actualQty', coalesce(v_line.actual_qty, 0),
    'returnedQty', coalesce(v_line.returned_qty, 0),
    'usedQty', coalesce(v_line.used_qty, 0),
    'movements', v_written
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- สิทธิ์เรียกใช้: ตรงตามสถานะจริงในฐานข้อมูล
--   proacl = {postgres=X/postgres, service_role=X/postgres}
-- ฟังก์ชันนี้เขียนบัญชีสต็อกโดยตรง จึงไม่เปิดให้ผู้ใช้ที่ล็อกอิน (authenticated)
-- เรียกเองได้ ต้องถูกเรียกต่อจากฟังก์ชันอื่นที่ตรวจสิทธิ์แล้วเท่านั้น
-- (create or replace ไม่รีเซ็ต ACL แต่ระบุไว้ให้ไฟล์นี้สร้างสถานะเดียวกันได้บนฐานใหม่)
-- ----------------------------------------------------------------------------
revoke all on function public.sync_job_stock_movements(uuid, text) from public;
revoke all on function public.sync_job_stock_movements(uuid, text) from anon;
revoke all on function public.sync_job_stock_movements(uuid, text) from authenticated;
grant execute on function public.sync_job_stock_movements(uuid, text) to service_role;

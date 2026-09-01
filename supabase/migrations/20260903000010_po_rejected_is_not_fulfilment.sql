-- P5-7 — ของที่ถูกปฏิเสธ ไม่ใช่ของที่ส่งมอบแล้ว
--
-- อาการที่พบจากการรีวิว (พิสูจน์ด้วย probe แล้ว ดูท้ายไฟล์):
--   record_po_receipt() เดิมตัดสินว่าใบสั่งซื้อ "รับครบ" ด้วยเงื่อนไข
--       qty_received + qty_rejected >= qty_ordered
--   การตรวจรับที่ปฏิเสธทุกรายการจึงทำให้ใบสั่งซื้อกลายเป็น status = 'received'
--   ทั้งที่ของเข้าคลัง 0 ชิ้นและไม่มี stock_movements สักแถว
--   (ผลจาก probe: result=fail poStatus=received movements=0)
--
-- ทำไมถึงสำคัญกว่าที่เห็น:
--   1) ใบที่เป็น 'received' แล้วรับของเพิ่มไม่ได้อีก (ด่านต้นฟังก์ชันยอมเฉพาะ ordered/partial)
--      ของที่ผู้ขายส่งมาแทนของที่เสีย จึงบันทึกเข้าใบเดิมไม่ได้เลย
--      สายหลักฐาน "ของชุดไหนถูกปฏิเสธ แล้วของชุดไหนมาแทน" ขาดตรงนั้นพอดี
--      ซึ่งเป็นสิ่งที่ ISO 9001:2015 ข้อ 8.7 ต้องการให้ตามรอยได้
--   2) ยอดค้างรับรายบรรทัด (v_remaining) ก็หักของที่ปฏิเสธออกด้วยเหมือนกัน
--      ต่อให้เปิดสถานะใบให้รับต่อได้ บรรทัดนั้นก็ยังค้างรับ 0 อยู่ดี จึงต้องแก้คู่กัน
--
-- เส้นที่ลากใหม่: "รับครบ" = ของที่รับจริงครบตามที่สั่ง เท่านั้น
--   ของที่ปฏิเสธไม่ใช่การส่งมอบ แต่เป็นหนี้ที่ผู้ขายยังค้างอยู่ ใบจึงเปิดค้างไว้รอของมาแทน
--   qty_rejected ยังถูกบันทึกสะสมไว้เหมือนเดิมทุกประการ (เป็นหลักฐานว่าปฏิเสธไปเท่าไร)
--   และ NC ที่เปิดอัตโนมัติตอนปฏิเสธก็ยังทำงานเหมือนเดิม ไม่มีอะไรถูกถอดออก
--
-- ขอบเขต: แทนที่ฟังก์ชันเดียว ไม่แตะตาราง ไม่แตะข้อมูลเดิมสักแถว
--   ใบสั่งซื้อที่วันนี้เป็น 'received' อยู่แล้วไม่ถูกเปลี่ยนสถานะย้อนหลัง
--   (ถ้ามีใบที่ปิดไปด้วยของที่ปฏิเสธ ให้คนตัดสินใจเปิดใหม่เอง ไม่ใช่ migration ไปแก้เงียบ ๆ)

begin;

create or replace function public.record_po_receipt(
  p_po_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_sample_pct numeric default null,
  p_ncr_job_no text default null,
  p_defect_summary text default null,
  p_ncr_severity text default 'medium',
  p_ncr_type text default 'quality'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_po public.purchase_orders%rowtype;
  v_row jsonb;
  v_item public.po_items%rowtype;
  v_material public.materials%rowtype;
  v_accepted numeric;
  v_rejected numeric;
  v_remaining numeric;
  v_receipt_id uuid;
  v_receipt_no text;
  v_line_id uuid;
  v_total_accepted numeric := 0;
  v_total_rejected numeric := 0;
  v_reject_value numeric := 0;
  v_result text;
  v_ncr_id uuid;
  v_job_no text;
  v_defect_lines text := '';
  v_ledger jsonb := '[]'::jsonb;
  v_attempt int := 0;
  v_all_received boolean;
  v_any_received boolean;
  v_new_status text;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'ตรวจรับของจากผู้ขาย');

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'ไม่พบใบสั่งซื้อ'; end if;
  if v_po.status not in ('ordered','partial') then
    raise exception 'ใบ % อยู่ในสถานะ "%" จึงรับของไม่ได้ — ต้องเป็นใบที่สั่งไปแล้วเท่านั้น', v_po.po_number, v_po.status;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ต้องระบุอย่างน้อยหนึ่งรายการที่รับ';
  end if;
  if p_ncr_severity not in ('critical','high','medium','low') then
    raise exception 'ระดับความรุนแรงของ NC ไม่ถูกต้อง';
  end if;
  if p_ncr_type not in ('quality','damage','missing','wrong','other') then
    raise exception 'ชนิดของ NC ไม่ถูกต้อง';
  end if;
  if p_sample_pct is not null and (p_sample_pct < 0 or p_sample_pct > 100) then
    raise exception 'สัดส่วนการสุ่มตรวจต้องอยู่ระหว่าง 0 ถึง 100 เปอร์เซ็นต์';
  end if;

  -- ตรวจทุกบรรทัดให้จบก่อน แล้วค่อยเขียน — คนที่กรอกผิดหนึ่งช่องต้องไม่ได้ใบที่เขียนไปแล้วครึ่งใบ
  for v_row in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.po_items where id = nullif(v_row->>'poItemId','')::uuid;
    if v_item.id is null or v_item.po_id <> p_po_id then
      raise exception 'มีรายการที่ไม่ได้อยู่ในใบสั่งซื้อ % — กรุณารีเฟรชหน้าจอแล้วลองใหม่', v_po.po_number;
    end if;
    select * into v_material from public.materials where id = v_item.material_id;

    v_accepted := coalesce((v_row->>'qtyAccepted')::numeric, 0);
    v_rejected := coalesce((v_row->>'qtyRejected')::numeric, 0);
    if v_accepted < 0 or v_rejected < 0 then
      raise exception 'จำนวนที่รับและจำนวนที่ปฏิเสธของ "%" ติดลบไม่ได้', coalesce(v_material.name,'รายการนี้');
    end if;
    if v_accepted + v_rejected = 0 then
      continue;
    end if;
    if v_rejected > 0 and nullif(btrim(coalesce(v_row->>'defectNote','')), '') is null then
      raise exception 'ของที่ปฏิเสธของ "%" ต้องระบุว่าเสียตรงไหน — ผู้ขายต้องแก้ตามคำอธิบายนี้', coalesce(v_material.name,'รายการนี้');
    end if;

    -- ยอดค้างรับนับจาก "ของที่รับจริง" เท่านั้น ของที่ปฏิเสธไม่ปิดยอดที่สั่งไว้
    -- ถ้าหักของที่ปฏิเสธออกจากยอดค้างด้วย ของที่ผู้ขายส่งมาแก้จะบันทึกเข้าใบเดิมไม่ได้เลย
    v_remaining := v_item.qty_ordered - coalesce(v_item.qty_received,0);
    if v_accepted > v_remaining then
      raise exception 'รายการ "%": รับ % แต่ยังค้างรับอยู่แค่ % % — ของมาเกินที่สั่งต้องแก้ใบสั่งซื้อก่อน ไม่ใช่รับเข้ามาเงียบ ๆ',
        coalesce(v_material.name,'ไม่ระบุ'), v_accepted,
        v_remaining, coalesce(v_material.unit,'หน่วย');
    end if;

    v_total_accepted := v_total_accepted + v_accepted;
    v_total_rejected := v_total_rejected + v_rejected;
    if v_rejected > 0 then
      v_reject_value := v_reject_value + v_rejected * coalesce(v_item.unit_price, 0);
      v_defect_lines := v_defect_lines || format('- %s: ปฏิเสธ %s %s (%s)%s',
        coalesce(v_material.name,'ไม่ระบุ'), v_rejected, coalesce(v_material.unit,'หน่วย'),
        btrim(v_row->>'defectNote'), chr(10));
    end if;
  end loop;

  if v_total_accepted + v_total_rejected = 0 then
    raise exception 'ยังไม่ได้กรอกจำนวนที่รับหรือที่ปฏิเสธเลยสักรายการ';
  end if;

  v_result := case
    when v_total_rejected = 0 then 'pass'
    when v_total_accepted = 0 then 'fail'
    else 'partial_fail'
  end;

  -- เลขงานสำหรับ NC: ใบสั่งซื้อที่ซื้อเพื่องานใดงานหนึ่งจะเติมให้เอง ถ้าไม่มีต้องให้คนระบุ
  if v_result <> 'pass' then
    v_job_no := coalesce(nullif(btrim(coalesce(p_ncr_job_no,'')), ''), v_po.job_no);
    if v_job_no is null then
      raise exception 'ของบางรายการไม่ผ่านตรวจรับ ระบบจะเปิดใบ NC ให้ แต่ใบ NC ในระบบนี้ต้องผูกกับเลขงานเสมอ — กรุณาระบุว่าของล็อตนี้ซื้อมาเพื่องานใด';
    end if;
    if not exists (select 1 from public.install_jobs where job_no = v_job_no) then
      raise exception 'ไม่พบเลขงาน % ในทะเบียนงานติดตั้ง', v_job_no;
    end if;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_receipt_no := public.next_po_receipt_number();
    begin
      insert into public.po_receipts(
        po_id, receipt_no, received_by, received_by_name, inspection_result,
        sample_pct, note, defect_summary
      ) values (
        p_po_id, v_receipt_no, v_actor.id, v_actor.full_name,
        -- ใบถูกสร้างเป็น pass ไว้ก่อนเมื่อยังไม่มี NC แล้วอัปเดตพร้อม ncr_id ทีเดียว
        -- เพื่อไม่ให้ชน po_receipts_fail_needs_ncr ระหว่างทาง
        'pass',
        coalesce(p_sample_pct, v_po.inspection_sample_pct),
        nullif(btrim(coalesce(p_note,'')),''),
        nullif(btrim(coalesce(p_defect_summary,'')),'')
      ) returning id into v_receipt_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'ออกเลขใบตรวจรับไม่สำเร็จเพราะมีคนบันทึกพร้อมกันหลายครั้ง กรุณากดใหม่อีกครั้ง';
      end if;
    end;
  end loop;

  for v_row in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.po_items where id = nullif(v_row->>'poItemId','')::uuid for update;
    v_accepted := coalesce((v_row->>'qtyAccepted')::numeric, 0);
    v_rejected := coalesce((v_row->>'qtyRejected')::numeric, 0);
    if v_accepted + v_rejected = 0 then continue; end if;

    insert into public.po_receipt_lines(receipt_id, po_item_id, qty_accepted, qty_rejected, defect_note)
    values (v_receipt_id, v_item.id, v_accepted, v_rejected, nullif(btrim(coalesce(v_row->>'defectNote','')),''))
    returning id into v_line_id;

    update public.po_items set
      qty_received = coalesce(qty_received,0) + v_accepted,
      qty_rejected = coalesce(qty_rejected,0) + v_rejected
    where id = v_item.id;

    -- ของที่รับจริงเท่านั้นที่เข้าคลัง ของที่ปฏิเสธไม่แตะยอดคลังเลย
    if v_accepted > 0 then
      update public.materials set qty_on_hand = coalesce(qty_on_hand,0) + v_accepted, updated_at = now()
      where id = v_item.material_id;
    end if;

    v_ledger := v_ledger || public.sync_po_receipt_stock_movements(v_line_id, v_actor.full_name);
  end loop;

  -- ของไม่ผ่าน = เปิด NC หนึ่งใบต่อการตรวจรับหนึ่งครั้ง ผ่านทางเดิมของระบบเท่านั้น
  if v_result <> 'pass' then
    v_ncr_id := public.create_floor_ncr_as(
      v_actor.id, v_actor.full_name, v_job_no,
      format('ของไม่ผ่านตรวจรับจากใบสั่งซื้อ %s', v_po.po_number),
      p_ncr_type, null::text, v_total_rejected,
      format('ตรวจรับตามใบ %s เมื่อ %s พบของไม่ได้มาตรฐานรวม %s หน่วย%s%s%s',
        v_receipt_no,
        to_char(now() at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'),
        v_total_rejected, chr(10), v_defect_lines,
        coalesce(chr(10) || 'สรุปโดยผู้ตรวจรับ: ' || nullif(btrim(coalesce(p_defect_summary,'')),''), '')),
      v_reject_value, v_actor.full_name, p_ncr_severity,
      'MATERIAL', v_po.supplier_id
    );

    update public.po_receipts set inspection_result = v_result, ncr_id = v_ncr_id where id = v_receipt_id;
  end if;

  -- สถานะใบสั่งซื้อ: "รับครบ" นับจากของที่รับจริงเท่านั้น
  -- ของที่ปฏิเสธไม่ใช่การส่งมอบ — มันคือหนี้ที่ผู้ขายยังต้องส่งของมาแก้
  -- (ของเดิมนับ qty_received + qty_rejected >= qty_ordered ใบที่ปฏิเสธทั้งใบจึงกลายเป็น
  --  'received' ทั้งที่ของเข้าคลัง 0 ชิ้น แล้วของที่ส่งมาแก้ก็ผูกกลับเข้าใบเดิมไม่ได้อีก
  --  สายหลักฐานระหว่าง "ของที่ถูกปฏิเสธ" กับ "ของที่มาแทน" จึงขาดตรงนั้น)
  select
    bool_and(coalesce(qty_received,0) >= qty_ordered),
    bool_or(coalesce(qty_received,0) > 0)
  into v_all_received, v_any_received
  from public.po_items where po_id = p_po_id;

  v_new_status := case when v_all_received then 'received' when v_any_received then 'partial' else v_po.status end;
  update public.purchase_orders set status = v_new_status, updated_at = now() where id = p_po_id;

  return jsonb_build_object(
    'receiptId', v_receipt_id,
    'receiptNo', v_receipt_no,
    'poNumber', v_po.po_number,
    'inspectionResult', v_result,
    'qtyAccepted', v_total_accepted,
    'qtyRejected', v_total_rejected,
    'rejectValueThb', v_reject_value,
    'ncrId', v_ncr_id,
    'ncrJobNo', v_job_no,
    'poStatus', v_new_status,
    'ledger', v_ledger,
    'receivedByName', v_actor.full_name
  );
end;
$function$;

comment on function public.record_po_receipt(uuid, jsonb, text, numeric, text, text, text, text) is
  'ตรวจรับของจากใบสั่งซื้อหนึ่งครั้งในธุรกรรมเดียว (role admin/warehouse): '
  'บันทึกใบตรวจรับ + อัปเดตยอดคลังเฉพาะของที่รับจริง + ลง stock_movements (po_receipt/in) '
  'และเปิด NC หนึ่งใบด้วย cause_code = MATERIAL พร้อม provider_id ของผู้ขาย เมื่อมีของถูกปฏิเสธ. '
  'P5-7: สถานะ received และยอดค้างรับนับจากของที่รับจริงเท่านั้น ของที่ปฏิเสธไม่ปิดยอดสั่ง '
  'ใบจึงเปิดค้างไว้ให้ของที่ส่งมาแทนผูกกลับเข้าใบเดิมได้ (ISO 9001:2015 ข้อ 8.7)';

revoke all on function public.record_po_receipt(uuid, jsonb, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.record_po_receipt(uuid, jsonb, text, numeric, text, text, text, text) to authenticated, service_role;

commit;

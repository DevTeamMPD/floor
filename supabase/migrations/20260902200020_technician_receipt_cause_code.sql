-- P4-4 (ต่อ) — ทางรับของหน้างานเลิกฝาก "logistics" ไว้ในข้อความ แล้วเขียนลง cause_code จริง
--
-- ก่อนหน้านี้ NC ที่เกิดจากช่างแจ้งของไม่ครบ พา "สาเหตุ = โลจิสติกส์" ไปกับ description
-- เป็นแท็ก [logistics] ที่ต้นข้อความ เพราะยังไม่มีคอลัมน์ให้เก็บ (เขียนไว้ตรง ๆ ในไฟล์เดิม)
-- ผลคือคำถามอย่าง "เดือนนี้ NC ที่ต้นตอเป็นเรื่องขนส่งกี่ใบ" ตอบได้ด้วยการ ilike หาข้อความเท่านั้น
-- ซึ่งพังทันทีที่มีคนพิมพ์คำว่า logistics ในคำอธิบายด้วยเหตุผลอื่น
--
-- ไฟล์นี้เปลี่ยนสามจุดในฟังก์ชันเดียว ที่เหลือคงเดิมทุกบรรทัด:
--   1. ตอนเปิด NC ใบใหม่ ส่ง p_cause_code = 'LOGISTICS' ให้ create_floor_ncr_as
--   2. ตอนอัปเดต NC ใบเดิม เขียน cause_code = 'LOGISTICS' ด้วย
--      (ใบที่เปิดไว้ก่อนมี migration นี้จึงได้สาเหตุเมื่อช่างแก้บรรทัดเดิมครั้งถัดไป)
--   3. ข้อความท้าย description ที่เคยบอกว่า "ยังไม่มีคอลัมน์ cause_code" ไม่จริงอีกต่อไป จึงแก้ให้ตรง
--      แท็ก [logistics] ที่ต้นข้อความยังอยู่เหมือนเดิม เพราะเป็นสิ่งที่ backfill ใช้อ้างอิง
--      และยังช่วยตอนคนค้นด้วยข้อความ — เราเพิ่มที่เก็บใหม่ ไม่ได้ย้ายของเก่าทิ้ง
--
-- additive ล้วน: แทนที่ฟังก์ชันของสาขานี้เองด้วย create or replace (ลายเซ็นเดิมทุกตัว)
-- จึงไม่ต้องตั้งสิทธิ์ใหม่ — สิทธิ์เดิม (anon/authenticated เรียกได้ เพราะช่างเข้าด้วย token+PIN
-- ไม่ได้ล็อกอิน) ติดมากับฟังก์ชันเดิมและไม่ถูกแตะ

begin;

create or replace function public.record_technician_item_receipt(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_item_id uuid,
  p_receipt_status text,
  p_received_qty numeric default null,
  p_reason_code text default null,
  p_reason_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.appointment_technicians%rowtype;
  v_tech public.floor_technicians%rowtype;
  v_order public.floor_work_orders%rowtype;
  v_line public.floor_work_order_items%rowtype;
  v_existing public.floor_work_order_item_receipts%rowtype;
  v_status text := btrim(coalesce(p_receipt_status, ''));
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_reason_entry jsonb;
  v_expected numeric;
  v_received numeric;
  v_shortage numeric;
  v_ncr_id uuid;
  v_ncr_type text;
  v_ncr_error text;
  v_title text;
  v_description text;
  v_reason_label text;
  v_receipt_id uuid;
begin
  v_assignment := public.technician_assignment_guard(p_token, p_pin, p_assignment_id);
  select * into v_tech from public.floor_technicians where id = v_assignment.technician_id;

  -- ล็อกใบสั่งงานก่อน แล้วค่อยล็อกบรรทัด — ลำดับเดียวกับ job_prep_edit_guard และ warehouse_pick_guard
  -- ทางเขียนทั้งหมดของ floor_work_order_items จึงเข้าคิวเดียวกัน ไม่มีทางจับล็อกสวนทางกันจนตาย
  select * into v_order from public.floor_work_orders
  where appointment_id = v_assignment.appointment_id for update;
  if v_order.id is null then
    raise exception 'ยังไม่มีใบสั่งงานของนัดหมายนี้ จึงยืนยันรับของไม่ได้';
  end if;
  if v_order.status not in ('ready_to_install', 'installing') then
    raise exception 'ยืนยันรับของได้เฉพาะเมื่อคลังจ่ายของแล้วและงานยังไม่จบ (สถานะปัจจุบัน: %)', v_order.status;
  end if;

  -- ด่านที่สำคัญที่สุดของทางเขียนนี้: บรรทัดต้องอยู่ในใบสั่งงานของนัดหมายที่ช่างคนนี้ถืออยู่จริง
  -- ถ้าไม่ตรวจ ช่างที่มี token+PIN ถูกต้องจะเขียนทับผลตรวจรับของงานคนอื่นได้ทั้งฐานข้อมูล
  select * into v_line from public.floor_work_order_items
  where id = p_item_id and work_order_id = v_order.id for update;
  if v_line.id is null then
    raise exception 'ไม่พบรายการนี้ในใบสั่งงานของคุณ';
  end if;

  if v_status not in ('received_full', 'received_partial', 'not_received') then
    raise exception 'สถานะการรับของต้องเป็น received_full, received_partial หรือ not_received เท่านั้น (ได้รับ: %)',
      coalesce(nullif(v_status, ''), '(ว่าง)');
  end if;

  v_expected := coalesce(v_line.picked_qty, v_line.actual_qty, v_line.planned_qty);

  if v_status = 'received_full' then
    v_received := v_expected;
    -- ได้ครบแล้วไม่ต้องมีเหตุผล และถ้าเผลอส่งมาก็ทิ้ง ไม่เก็บเหตุผลที่ขัดกับสถานะ
    v_reason := null;
    v_note := null;
  elsif v_status = 'not_received' then
    v_received := 0;
  else
    if p_received_qty is null then
      raise exception 'ได้รับไม่ครบต้องระบุจำนวนที่ได้รับจริง';
    end if;
    if p_received_qty <= 0 then
      raise exception 'จำนวนที่ได้รับต้องมากกว่า 0 — ถ้าไม่ได้รับเลยให้เลือก "ไม่ได้รับ"';
    end if;
    if p_received_qty >= v_expected then
      raise exception 'จำนวนที่ได้รับ (%) ไม่น้อยกว่าจำนวนที่คลังจ่ายมา (%) — ถ้าได้ครบให้เลือก "ได้ครบ"',
        p_received_qty, v_expected;
    end if;
    v_received := p_received_qty;
  end if;

  v_shortage := greatest(v_expected - v_received, 0);

  if v_status <> 'received_full' then
    if v_reason is null then
      raise exception 'ของไม่ครบต้องระบุเหตุผล เพราะเหตุผลคือสิ่งเดียวที่ทำให้แก้ต้นตอได้';
    end if;
    select e.value into v_reason_entry
      from jsonb_array_elements(public.floor_receipt_reason_catalog()) as e(value)
     where e.value->>'code' = v_reason;
    if v_reason_entry is null then
      raise exception 'ไม่รู้จักเหตุผล "%" — เลือกจากรายการที่ระบบให้มาเท่านั้น', v_reason;
    end if;
    if v_reason = 'other' and v_note is null then
      raise exception 'เลือก "อื่น ๆ" ต้องพิมพ์อธิบายด้วย';
    end if;
    v_ncr_type := v_reason_entry->>'ncrType';
    v_reason_label := v_reason_entry->>'label';
  end if;

  select * into v_existing from public.floor_work_order_item_receipts
  where item_id = v_line.id for update;

  -- ------------------------------------------------------------------
  -- NC: เปิดใบใหม่เฉพาะเมื่อบรรทัดนี้ยังไม่เคยมี NC เท่านั้น
  -- ถ้ามีอยู่แล้วให้ "อัปเดตใบเดิม" — ช่างแก้บรรทัดเดิมกี่ครั้งก็ยังเป็น NC ใบเดียว
  -- ------------------------------------------------------------------
  v_ncr_id := v_existing.ncr_id;

  if v_status <> 'received_full' then
    v_title := left(format('ของไม่ครบหน้างาน · %s · %s', v_line.item_name, v_order.job_no), 300);
    v_description := format(
      '[logistics] ช่างแจ้งของไม่ครบตอนรับของหน้างาน'
      || E'\n' || 'งาน: %s · รายการ: %s%s'
      || E'\n' || 'คลังจ่ายมา %s %s · ช่างได้รับ %s %s · ขาด %s %s'
      || E'\n' || 'เหตุผลที่ช่างเลือก: %s (%s)'
      || E'\n' || 'หมายเหตุจากช่าง: %s'
      || E'\n' || 'คลังบันทึกไว้ตอนหยิบ: %s%s'
      || E'\n' || 'ผู้แจ้ง: %s (ช่างหน้างาน) · ใบมอบหมาย %s'
      || E'\n' || 'สาเหตุหลัก: โลจิสติกส์ (logistics) — บันทึกไว้ที่ ncr_reports.cause_code = LOGISTICS ของใบนี้แล้ว',
      v_order.job_no, v_line.item_name, coalesce(' (' || v_line.sku || ')', ''),
      v_expected, v_line.unit, v_received, v_line.unit, v_shortage, v_line.unit,
      v_reason_label, v_reason,
      coalesce(v_note, '—'),
      coalesce(v_line.pick_status, 'ไม่ได้บันทึกรายบรรทัด'), coalesce(' · ' || v_line.pick_note, ''),
      coalesce(v_tech.name, 'ไม่ทราบชื่อ'), v_assignment.id
    );

    if v_ncr_id is null then
      begin
        -- ผู้รับผิดชอบตั้งต้น = พนักงานคลังที่รับใบนี้ไป เพราะเป็นคนเดียวที่ตอบได้ว่าของหายไปตอนไหน
        -- (null ได้ ถ้ายังไม่มีใครรับ — ncr_reports.owner_staff_id เป็น nullable อยู่แล้ว)
        v_ncr_id := public.create_floor_ncr_as(
          v_order.warehouse_assignee_id,
          coalesce(v_tech.name, 'ช่างหน้างาน'),
          v_order.job_no,
          v_title,
          v_ncr_type,
          v_line.sku,
          v_shortage,
          v_description,
          null,
          coalesce(v_tech.name, 'ช่างหน้างาน'),
          'medium',
          -- P4-4: ตั้งแต่นี้ไป "logistics" ไม่ได้อยู่แค่ในข้อความอีกแล้ว แต่เป็นข้อมูลที่กรองและนับได้
          'LOGISTICS'
        );
      exception when others then
        -- ผลตรวจรับของช่างสำคัญกว่าการเปิด NC สำเร็จ ถ้า NC เปิดไม่ได้ (เช่น job_no ไม่มีใน install_jobs)
        -- ต้องไม่ทำให้สิ่งที่ช่างเพิ่งกรอกหน้างานหายไปทั้งก้อน — บันทึกผลไว้ แล้วบอกตรง ๆ ว่า NC ไม่ได้เปิด
        v_ncr_id := null;
        v_ncr_error := sqlerrm;
      end;
    else
      -- แก้ตามรีวิว D4: ทางนี้เคยไม่มี exception handler ต่างจากทาง "เปิด NC ใบใหม่" ข้างบน
      -- ถ้า update ncr_reports ล้มเหลว (สิทธิ์ constraint trigger ฯลฯ) ทั้งธุรกรรมจะ rollback
      -- แล้วผลตรวจรับที่ช่างเพิ่งกรอกกลางหน้างานหายทั้งก้อน ซึ่งขัดกับเจตนาที่เขียนไว้เองข้างบน
      -- ตอนนี้ทั้งสองทางทำเหมือนกัน: ผลตรวจรับของช่างสำคัญกว่าการอัปเดต NC สำเร็จเสมอ
      begin
        update public.ncr_reports
        set title = v_title,
            type = v_ncr_type,
            -- ใบที่เปิดไว้ก่อนมีคอลัมน์นี้จะได้สาเหตุตอนช่างแก้บรรทัดเดิมครั้งถัดไป
            cause_code = 'LOGISTICS',
            product_sku = nullif(btrim(coalesce(v_line.sku, '')), ''),
            quantity = v_shortage,
            description = nullif(left(btrim(v_description), 3000), ''),
            updated_at = now()
        where id = v_ncr_id;

        insert into public.floor_ncr_events(ncr_id, event_type, actor_id, detail)
        values (v_ncr_id, 'technician_receipt_updated', null, jsonb_build_object(
          'itemId', v_line.id, 'receiptStatus', v_status, 'expectedQty', v_expected,
          'receivedQty', v_received, 'shortageQty', v_shortage,
          'reasonCode', v_reason, 'technician', v_tech.name, 'cause', 'logistics'
        ));
      exception when others then
        -- NC ใบเดิมยังอยู่ (แค่อัปเดตไม่ผ่าน) จึงคง v_ncr_id ไว้ ไม่ตั้งเป็น null
        -- ต่างจากทางเปิดใหม่ที่ต้องตั้ง null เพราะใบนั้นไม่เคยถูกสร้างขึ้นมาจริง
        v_ncr_error := sqlerrm;
      end;
    end if;
  elsif v_ncr_id is not null then
    -- ช่างแก้กลับเป็น "ได้ครบ" — ไม่ปิด NC ให้เอง เพราะการปิดต้องมีคนตรวจว่าของมาถึงจริง
    -- (advance_floor_ncr บังคับให้เดินสถานะทีละขั้นโดยคนอยู่แล้ว) แต่ต้องทิ้งร่องรอยว่าตัวเลขเปลี่ยน
    -- D4: ห่อด้วย handler ชุดเดียวกัน ด้วยเหตุผลเดียวกัน — ร่องรอยที่เขียนไม่ได้ต้องไม่กลืนผลตรวจรับ
    begin
      insert into public.floor_ncr_events(ncr_id, event_type, actor_id, detail)
      values (v_ncr_id, 'technician_receipt_updated', null, jsonb_build_object(
        'itemId', v_line.id, 'receiptStatus', v_status, 'expectedQty', v_expected,
        'receivedQty', v_received, 'shortageQty', 0,
        'technician', v_tech.name, 'cause', 'logistics',
        'note', 'ช่างแก้เป็นได้รับครบภายหลัง — NC ยังเปิดอยู่ รอคนตรวจแล้วปิดเอง'
      ));
    exception when others then
      v_ncr_error := sqlerrm;
    end;
  end if;

  if v_existing.id is null then
    insert into public.floor_work_order_item_receipts(
      item_id, work_order_id, job_no, assignment_id, technician_id, technician_name,
      receipt_status, expected_qty, received_qty, shortage_qty, reason_code, reason_note, ncr_id
    ) values (
      v_line.id, v_order.id, v_order.job_no, v_assignment.id, v_tech.id,
      coalesce(v_tech.name, 'ช่างหน้างาน'),
      v_status, v_expected, v_received, v_shortage, v_reason, v_note, v_ncr_id
    ) returning id into v_receipt_id;
  else
    update public.floor_work_order_item_receipts
    set receipt_status = v_status,
        expected_qty = v_expected,
        received_qty = v_received,
        shortage_qty = v_shortage,
        reason_code = v_reason,
        reason_note = v_note,
        ncr_id = v_ncr_id,
        assignment_id = v_assignment.id,
        technician_id = v_tech.id,
        technician_name = coalesce(v_tech.name, 'ช่างหน้างาน'),
        confirmed_at = now(),
        updated_at = now()
    where id = v_existing.id
    returning id into v_receipt_id;
  end if;

  return jsonb_build_object(
    'receiptId', v_receipt_id,
    'itemId', v_line.id,
    'status', v_status,
    'expectedQty', v_expected,
    'receivedQty', v_received,
    'shortageQty', v_shortage,
    'reasonCode', v_reason,
    'reasonNote', v_note,
    'ncrId', v_ncr_id,
    'ncrCreated', (v_ncr_id is not null and v_existing.ncr_id is null),
    'ncrError', v_ncr_error
  );
end;
$function$;

notify pgrst, 'reload schema';

commit;

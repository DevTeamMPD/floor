-- ============================================================================
-- close_floor_work_order_cs_v4_acceptance_gate
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   การปิดงานคือจุดที่ระบบประกาศว่า "งานนี้ทำเสร็จและผ่านเกณฑ์แล้ว"
--   ถ้าปิดได้โดยที่เกณฑ์ตรวจรับยังไม่ครบ คำประกาศนั้นก็ไม่มีความหมาย
--   และหลักฐานที่จะใช้ตอบลูกค้า/ผู้ตรวจภายหลังก็ไม่มี
--
--   ไฟล์นี้เพิ่ม "ด่านตรวจรับ" เข้าไปในเส้นทางปิดงาน 4 ชิ้น
--
--   1) job_acceptance_gate(job_no, appointment_id) — ด่านกลางที่ตอบว่าผ่านหรือไม่
--      ตัดสิน 4 เรื่อง เทียบกับแม่แบบรุ่นที่เปิดใช้งานอยู่ (active_job_checklist_template)
--        * not_recorded    : เกณฑ์ที่ยัง active ทุกข้อต้องมีคำตอบ — ข้อที่ไม่ตอบคือข้อที่ไม่ได้ตรวจ
--        * missing_photo   : ข้อที่ requires_photo และผลไม่ใช่ 'na' ต้องมีรูปหลักฐาน
--        * critical_failed : 'fail' บนข้อ is_critical ปิดงานไม่ได้ ไม่มีข้อยกเว้นในตัวด่าน
--        * not_verified    : ทีมภายนอก (tech_teams.provider_type = 'subcontract'
--                            หาผ่าน appointments.tech_id) ต้องมีผู้รับรองชั้นที่สอง
--                            จากฝั่งบริษัท (verified_by/verified_at) เพิ่มอีกชั้น
--                            เหตุผล: งานที่บริษัททำเอง คนของบริษัทอยู่หน้างานอยู่แล้ว
--                            งานที่จ้างช่างนอกทำ ไม่มีใครของบริษัทเห็นด้วยตา
--                            ลายเซ็นชั้นที่สองจึงเป็นสิ่งเดียวที่แทนการเห็นด้วยตาได้
--      อ่านผลล่าสุดต่อข้อด้วย distinct on (item_code) เรียงตาม performed_at desc
--      เพราะข้อเดียวกันอาจถูกบันทึกซ้ำหลายครั้ง ต้องตัดสินด้วยครั้งล่าสุดเท่านั้น
--      ถ้าไม่มีแม่แบบเปิดใช้งานอยู่เลย ด่านตอบ ok = false ทันที — "ไม่มีเกณฑ์"
--      ไม่ได้แปลว่า "ผ่านทุกเกณฑ์" ซึ่งเป็นความผิดพลาดแบบเปิดประตูทิ้ง
--
--   2) verify_job_acceptance_results(job_no, item_codes) — ทางเขียนลายเซ็นชั้นที่สอง
--      ให้ทีมออฟฟิศ (admin / head_technician / cs) เซ็นรับรอง
--      กันคนบันทึกผลเซ็นให้ตัวเองที่ระดับฟังก์ชันด้วย (นอกจากที่ constraint กันไว้แล้ว)
--      เพื่อให้ error message บอกจำนวนข้อที่ติดปัญหาได้อย่างเข้าใจง่าย
--
--   3) close_floor_work_order_cs_v4(work_order_id) — เส้นทางปิดงานปกติของ CS
--      เพิ่ม acceptance_checklist เข้าไปในรายการสิ่งที่ต้องครบ ร่วมกับของเดิม
--      (ลายเซ็นลูกค้า / รายงานเศษวัสดุที่ยอมรับแล้ว / CSAT / ไม่มี NC ระดับสูงค้าง)
--      ยังเคารพ floor_close_exceptions ตามเดิม: ถ้ามีใบยกเว้นที่อนุมัติไว้และยังไม่ถูกใช้
--      ให้ปิดได้ แต่บันทึกว่าใช้ใบยกเว้นกับรายการที่ขาดอะไรไว้ในประวัติ
--      — การยกเว้นต้องทิ้งร่องรอย ไม่ใช่หายไปเงียบ ๆ
--
--   4) close_floor_work_order_special_v2(work_order_id, reason, acknowledge)
--      เส้นทางพิเศษ (จำกัดที่บัญชีเดียว) เดิมข้ามทุกด่าน
--      v2 ไม่ได้ห้ามปิด แต่บังคับให้ "รับทราบ" ก่อน: ถ้าเกณฑ์ยังไม่ครบและยังไม่กด
--      รับทราบ จะปิดไม่ได้ และเมื่อกดรับทราบแล้วระบบบันทึกรายการที่ขาดทั้งชุด
--      ลงใน metadata ของ event — เจตนาคือทำให้การข้ามด่านเป็นการตัดสินใจที่มีชื่อคนกำกับ
--
-- ไฟล์นี้รันซ้ำได้ (create or replace ทั้งสี่ตัว)
-- ต้องรันหลัง 20260901105140 (ต้องมี active_job_checklist_template และคอลัมน์ verified_role)
-- คัดลอกจาก pg_get_functiondef ของฐานข้อมูลจริงแบบตัวอักษรต่อตัวอักษร
-- ============================================================================

CREATE OR REPLACE FUNCTION public.job_acceptance_gate(p_job_no text, p_appointment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_template public.job_checklist_templates%rowtype;
  v_team public.tech_teams%rowtype;
  v_external boolean;
  v_missing jsonb := '[]'::jsonb;
  v_items integer := 0;
  v_recorded integer := 0;
begin
  if p_appointment_id is not null then
    select tt.* into v_team
    from public.appointments a
    join public.tech_teams tt on tt.id = a.tech_id
    where a.id = p_appointment_id;
  end if;
  if v_team.id is null then
    select tt.* into v_team
    from public.appointments a
    join public.tech_teams tt on tt.id = a.tech_id
    where a.job_id = p_job_no
    order by a.slot_start desc
    limit 1;
  end if;

  v_external := coalesce(v_team.provider_type, 'in_house') = 'subcontract';

  v_template := public.active_job_checklist_template();
  if v_template.id is null then
    return jsonb_build_object(
      'ok', false,
      'templateId', null,
      'templateVersion', null,
      'external', v_external,
      'teamId', v_team.id,
      'teamName', v_team.name,
      'providerType', v_team.provider_type,
      'itemCount', 0,
      'recordedCount', 0,
      'missing', jsonb_build_array(jsonb_build_object(
        'code', '-',
        'label', 'แม่แบบเกณฑ์ตรวจรับ',
        'reason', 'no_active_template',
        'text', 'ยังไม่มีแม่แบบเกณฑ์ตรวจรับรุ่นใดเปิดใช้งานอยู่ จึงพิสูจน์ไม่ได้ว่างานผ่านเกณฑ์'
      ))
    );
  end if;

  with item as (
    select i.code, i.label, i.requires_photo, i.is_critical
    from public.job_checklist_template_items i
    where i.template_id = v_template.id and i.is_active
  ),
  latest as (
    select distinct on (r.item_code)
      r.item_code, r.result, r.photo_paths, r.verified_by
    from public.job_acceptance_results r
    where r.job_no = p_job_no
    order by r.item_code, r.performed_at desc nulls last, r.updated_at desc
  ),
  judged as (
    select
      it.code,
      it.label,
      (l.result is not null) as recorded,
      case
        when l.result is null then 'not_recorded'
        when it.requires_photo and l.result <> 'na' and coalesce(array_length(l.photo_paths, 1), 0) = 0 then 'missing_photo'
        when it.is_critical and l.result = 'fail' then 'critical_failed'
        when v_external and l.verified_by is null then 'not_verified'
        else null
      end as reason
    from item it
    left join latest l on l.item_code = it.code
  )
  select
    count(*)::integer,
    count(*) filter (where recorded)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'code', code,
      'label', label,
      'reason', reason,
      'text', case reason
        when 'not_recorded' then 'ยังไม่ได้บันทึกผล'
        when 'missing_photo' then 'ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป'
        when 'critical_failed' then 'บันทึกว่า "ไม่ผ่าน" และเป็นข้อสำคัญ'
        when 'not_verified' then 'ยังไม่มีผู้รับรองชั้นที่สองจากฝั่งบริษัท (งานของทีมภายนอก)'
        else ''
      end
    ) order by code) filter (where reason is not null), '[]'::jsonb)
  into v_items, v_recorded, v_missing
  from judged;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_missing) = 0,
    'templateId', v_template.id,
    'templateVersion', v_template.version,
    'external', v_external,
    'teamId', v_team.id,
    'teamName', v_team.name,
    'providerType', v_team.provider_type,
    'itemCount', v_items,
    'recordedCount', v_recorded,
    'missing', v_missing
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_job_acceptance_results(p_job_no text, p_item_codes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_self integer;
  v_updated integer;
begin
  select * into v_actor
  from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician', 'cs');
  if v_actor.id is null then
    raise exception 'รับรองผลตรวจรับชั้นที่สองได้เฉพาะทีมออฟฟิศ (ผู้ดูแลระบบ หัวหน้าช่าง หรือ CS) เท่านั้น';
  end if;

  if not exists (select 1 from public.install_jobs where job_no = p_job_no) then
    raise exception 'ไม่พบงานเลขที่ %', p_job_no;
  end if;

  select count(*)::integer into v_self
  from public.job_acceptance_results r
  where r.job_no = p_job_no
    and r.result is not null
    and (p_item_codes is null or r.item_code = any(p_item_codes))
    and r.performed_by = v_actor.id;
  if v_self > 0 then
    raise exception 'คนที่บันทึกผลตรวจรับเอง เซ็นรับรองชั้นที่สองให้ตัวเองไม่ได้ (% ข้อ) — ต้องให้คนอื่นในทีมออฟฟิศเป็นผู้รับรอง', v_self;
  end if;

  update public.job_acceptance_results r
  set verified_by = v_actor.id,
      verified_at = now(),
      verified_role = v_actor.role,
      updated_at = now()
  where r.job_no = p_job_no
    and r.result is not null
    and (p_item_codes is null or r.item_code = any(p_item_codes));
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'ยังไม่มีผลตรวจรับที่บันทึกไว้ให้รับรอง — ให้บันทึกผลตรวจรับก่อน';
  end if;

  return jsonb_build_object('verified', v_updated, 'verifiedBy', v_actor.full_name, 'role', v_actor.role);
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_floor_work_order_cs_v4(p_work_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_exception public.floor_close_exceptions%rowtype;
  v_missing text[] := array[]::text[];
  v_gate jsonb;
  v_gate_text text;
  v_detail text;
begin
  select * into v_actor from public.floor_staff_profiles
   where id = (select auth.uid()) and is_active and role in ('admin', 'cs');
  if v_actor.id is null then raise exception 'CS permission required'; end if;

  select * into v_order from public.floor_work_orders
   where id = p_work_order_id and status = 'waiting_cs' for update;
  if v_order.id is null then raise exception 'work order is not waiting for CS'; end if;

  if not exists (select 1 from public.floor_work_order_events
                  where work_order_id = v_order.id and event_type = 'customer_signed') then
    v_missing := array_append(v_missing, 'customer_signature');
  end if;
  if not exists (select 1 from public.floor_remnant_reports
                  where job_no = v_order.job_no and status = 'accepted') then
    v_missing := array_append(v_missing, 'accepted_remnant_report');
  end if;
  if not exists (select 1 from public.job_evaluations
                  where job_no = v_order.job_no and satisfaction_score is not null) then
    v_missing := array_append(v_missing, 'csat');
  end if;
  if exists (select 1 from public.ncr_reports
              where job_no = v_order.job_no and severity in ('critical', 'high') and status <> 'closed') then
    v_missing := array_append(v_missing, 'open_high_ncr');
  end if;

  v_gate := public.job_acceptance_gate(v_order.job_no, v_order.appointment_id);
  if not (v_gate->>'ok')::boolean then
    v_missing := array_append(v_missing, 'acceptance_checklist');
    select string_agg((x->>'code') || ' ' || (x->>'label') || ' — ' || (x->>'text'), ' · ' order by x->>'code')
    into v_gate_text
    from jsonb_array_elements(v_gate->'missing') as t(x);
  end if;

  if cardinality(v_missing) > 0 then
    select string_agg(
      case m
        when 'customer_signature' then 'ลูกค้ายังไม่ได้เซ็นรับงาน'
        when 'accepted_remnant_report' then 'ยังไม่มีรายงานเศษวัสดุที่ผ่านการยอมรับ'
        when 'csat' then 'ยังไม่มีผลประเมินความพึงพอใจจากลูกค้า'
        when 'open_high_ncr' then 'ยังมีใบ NC ระดับสูง/วิกฤตที่ยังไม่ปิด'
        when 'acceptance_checklist' then 'เกณฑ์ตรวจรับยังไม่ครบ: ' || coalesce(v_gate_text, '')
        else m
      end, ' · ')
    into v_detail
    from unnest(v_missing) as t(m);

    select * into v_exception from public.floor_close_exceptions
     where job_no = v_order.job_no and used_at is null
     order by approved_at desc limit 1 for update;
    if v_exception.id is null then
      raise exception 'ปิดงานไม่ได้ ยังขาด: %', v_detail;
    end if;
    update public.floor_close_exceptions
      set used_at = now(), missing_requirements = to_jsonb(v_missing)
    where id = v_exception.id;
  end if;

  update public.floor_work_orders
    set status = 'closed', closed_at = now(), updated_at = now()
  where id = v_order.id;
  update public.install_jobs
    set stage = 6, status = 'เสร็จสิ้น', waiting_on = 'ไม่ได้ค้าง', waiting_since = null,
        closed_at = coalesce(closed_at, now()), updated_at = now()
  where job_no = v_order.job_no;

  insert into public.floor_work_order_events(
    work_order_id, event_type, from_status, to_status, actor_staff_id, actor_name, note, metadata)
  values (
    v_order.id, 'cs_closed', 'waiting_cs', 'closed', v_actor.id, v_actor.full_name,
    'CS ประเมินและปิดงาน',
    jsonb_build_object('exceptionId', v_exception.id, 'missing', v_missing, 'acceptance', v_gate));

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_floor_work_order_special_v2(p_work_order_id uuid, p_reason text, p_acknowledge_incomplete_acceptance boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text;
  v_gate jsonb;
  v_gate_text text;
begin
  select * into v_actor
  from public.floor_staff_profiles
  where id = (select auth.uid())
    and is_active
    and lower(email) = 'supakrit.k@mpdgroup.co';
  if v_actor.id is null then
    raise exception 'special work closure permission required';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'closure reason is required';
  end if;

  select * into v_order
  from public.floor_work_orders
  where id = p_work_order_id and status not in ('closed', 'cancelled')
  for update;
  if v_order.id is null then
    raise exception 'work order is already closed, cancelled, or unavailable';
  end if;

  v_gate := public.job_acceptance_gate(v_order.job_no, v_order.appointment_id);
  if not (v_gate->>'ok')::boolean then
    select string_agg((x->>'code') || ' ' || (x->>'label') || ' — ' || (x->>'text'), ' · ' order by x->>'code')
    into v_gate_text
    from jsonb_array_elements(v_gate->'missing') as t(x);

    if not coalesce(p_acknowledge_incomplete_acceptance, false) then
      raise exception 'สิ้นสุดงานทางพิเศษไม่ได้ทันที เพราะเกณฑ์ตรวจรับยังไม่ครบ: % — ถ้ายืนยันจะสิ้นสุดงานทั้งที่ยังขาด ต้องกดรับทราบรายการที่ขาดก่อน ระบบจะบันทึกไว้ในประวัติงาน', coalesce(v_gate_text, '');
    end if;
  end if;

  update public.floor_work_orders
    set status = 'closed', closed_at = now(), updated_at = now()
  where id = v_order.id;

  update public.install_jobs
    set stage = 6, status = 'เสร็จสิ้น', waiting_on = 'ไม่ได้ค้าง', waiting_since = null,
        closed_at = coalesce(closed_at, now()), flag_note = left(v_reason, 1000), updated_at = now()
  where job_no = v_order.job_no;

  insert into public.floor_work_order_events(
    work_order_id, event_type, from_status, to_status, actor_staff_id, actor_name, note, metadata)
  values (
    v_order.id, 'special_closed', v_order.status, 'closed', v_actor.id, v_actor.full_name,
    left(v_reason, 1000),
    jsonb_build_object(
      'acceptance', v_gate,
      'acceptanceAcknowledged', coalesce(p_acknowledge_incomplete_acceptance, false),
      'acceptanceMissingText', v_gate_text));

  return true;
end;
$function$;

-- ----------------------------------------------------------------------------
-- สิทธิ์ — ตรงตามสถานะจริงทั้งสี่ตัว: {postgres, authenticated, service_role}
-- ด่านสิทธิ์ที่แท้จริงอยู่ในตัวฟังก์ชัน (role in admin,cs / อีเมลเฉพาะเจาะจง)
-- ฟังก์ชันรุ่นเก่า close_floor_work_order_cs_v3 และ close_floor_work_order_special
-- ยังอยู่ในฐานข้อมูล (ทั้งคู่ search_path = public ไม่ใช่ '') — ดู README ข้อ "สิ่งที่ควรตามต่อ"
-- ----------------------------------------------------------------------------
revoke all on function public.job_acceptance_gate(text, uuid) from public;
revoke all on function public.job_acceptance_gate(text, uuid) from anon;
grant execute on function public.job_acceptance_gate(text, uuid) to authenticated, service_role;

revoke all on function public.verify_job_acceptance_results(text, text[]) from public;
revoke all on function public.verify_job_acceptance_results(text, text[]) from anon;
grant execute on function public.verify_job_acceptance_results(text, text[]) to authenticated, service_role;

revoke all on function public.close_floor_work_order_cs_v4(uuid) from public;
revoke all on function public.close_floor_work_order_cs_v4(uuid) from anon;
grant execute on function public.close_floor_work_order_cs_v4(uuid) to authenticated, service_role;

revoke all on function public.close_floor_work_order_special_v2(uuid, text, boolean) from public;
revoke all on function public.close_floor_work_order_special_v2(uuid, text, boolean) from anon;
grant execute on function public.close_floor_work_order_special_v2(uuid, text, boolean) to authenticated, service_role;

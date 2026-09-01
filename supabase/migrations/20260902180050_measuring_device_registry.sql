-- ============================================================================
-- measuring_device_registry
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   ผลตรวจรับที่มีตัวเลขวัด (measured_value) จะเชื่อถือได้ต่อเมื่อรู้ว่า
--   "วัดด้วยเครื่องมือตัวไหน และเครื่องมือตัวนั้นสอบเทียบล่าสุดเมื่อไร"
--   ตาราง public.measuring_devices และคอลัมน์
--   job_acceptance_results.measuring_device_id มีอยู่ก่อนไฟล์นี้แล้ว
--   (ยืนยันจากลำดับ OID: measuring_devices = 137949, job_acceptance_results = 137968
--    ทั้งคู่เก่ากว่าชุด migration รอบนี้ และคอลัมน์สอบเทียบอยู่กลางตาราง
--    ที่ attnum 7-9 แปลว่ามาพร้อม create table ไม่ใช่ alter add ภายหลัง)
--
--   สิ่งที่ไฟล์นี้เพิ่มคือ "ทางเดินของข้อมูล" รอบทะเบียนนั้น 3 ตัว
--     1) upsert_measuring_device() — ทางเขียนทะเบียน
--        * คำนวณ next_due_at ให้เอง = last_calibrated_at + calibration_interval_days
--          ไม่ให้หน้าจอส่งมา เพราะวันครบกำหนดสอบเทียบเป็นผลจากข้อเท็จจริงสองตัว
--          ถ้าให้กรอกเองจะเพี้ยนจากของจริงได้โดยไม่มีใครจับได้
--        * ถ้าไม่รู้วันสอบเทียบล่าสุด หรือไม่รู้รอบสอบเทียบ -> next_due_at = null
--          "ไม่รู้" ต้องหน้าตาไม่เหมือน "ยังไม่ครบกำหนด" อย่างเด็ดขาด
--        * ตรวจ p_calibration_interval_days > 0 เพราะรอบ 0 วันไม่มีความหมาย
--        * จำกัดคนแก้ไว้ที่ admin / head_technician เท่านั้น
--     2) get_measuring_devices() — ทางอ่านทะเบียนพร้อมสรุปการใช้งาน
--        นับเฉพาะการใช้ "หลังการสอบเทียบครั้งล่าสุด" (performed_at >= last_calibrated_at)
--        เพราะคำถามที่ต้องตอบตอนเครื่องมือหลุดสอบเทียบคือ
--        "งานไหนบ้างที่ผลวัดต้องถูกทบทวน" — งานก่อนสอบเทียบครั้งล่าสุดไม่เกี่ยว
--        คอลัมน์ calibration_known บอกตรง ๆ ว่ารู้วันสอบเทียบหรือไม่ ไม่ให้ null กำกวม
--     3) get_measuring_device_usage() — ทางอ่านรายงาน "เครื่องมือตัวนี้ใช้กับงานไหน"
--        แยกเป็นรายงานต่อคู่ (เครื่องมือ, งาน) พร้อมรายการรหัสเกณฑ์ที่วัดด้วยเครื่องมือนั้น
--        รองรับดัชนี job_acceptance_results_device_used_idx ที่สร้างไว้แล้ว
--
-- ไฟล์นี้รันซ้ำได้ (create or replace ทั้งสามตัว)
-- คัดลอกจาก pg_get_functiondef ของฐานข้อมูลจริงแบบตัวอักษรต่อตัวอักษร
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_measuring_device(p_id uuid, p_code text, p_kind text, p_owner_team_id uuid DEFAULT NULL::uuid, p_range_text text DEFAULT NULL::text, p_resolution_text text DEFAULT NULL::text, p_last_calibrated_at date DEFAULT NULL::date, p_calibration_interval_days integer DEFAULT NULL::integer, p_status text DEFAULT 'ok'::text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_code text;
  v_kind text;
  v_status text;
  v_next date;
  v_id uuid;
begin
  select * into v_actor
  from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'จัดการทะเบียนเครื่องมือวัดได้เฉพาะผู้ดูแลระบบและหัวหน้าช่างเท่านั้น';
  end if;

  v_code := nullif(btrim(coalesce(p_code, '')), '');
  v_kind := nullif(btrim(coalesce(p_kind, '')), '');
  if v_code is null then raise exception 'ต้องระบุรหัสเครื่องมือ'; end if;
  if v_kind is null then raise exception 'ต้องระบุชนิดเครื่องมือ'; end if;

  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'ok');
  if v_status not in ('ok', 'due', 'out_of_service') then
    raise exception 'สถานะเครื่องมือต้องเป็น ใช้งานได้ / ครบกำหนดสอบเทียบ / ปลดจากการใช้งาน เท่านั้น';
  end if;

  if p_calibration_interval_days is not null and p_calibration_interval_days <= 0 then
    raise exception 'รอบสอบเทียบต้องมากกว่า 0 วัน';
  end if;

  v_next := case
    when p_last_calibrated_at is not null and p_calibration_interval_days is not null
      then p_last_calibrated_at + (p_calibration_interval_days || ' days')::interval
    else null
  end;

  if p_id is null then
    insert into public.measuring_devices (
      code, kind, owner_team_id, range_text, resolution_text,
      last_calibrated_at, calibration_interval_days, next_due_at, status, note
    ) values (
      v_code, v_kind, p_owner_team_id,
      nullif(btrim(coalesce(p_range_text, '')), ''), nullif(btrim(coalesce(p_resolution_text, '')), ''),
      p_last_calibrated_at, p_calibration_interval_days, v_next, v_status,
      nullif(btrim(coalesce(p_note, '')), '')
    )
    returning id into v_id;
  else
    update public.measuring_devices set
      code = v_code,
      kind = v_kind,
      owner_team_id = p_owner_team_id,
      range_text = nullif(btrim(coalesce(p_range_text, '')), ''),
      resolution_text = nullif(btrim(coalesce(p_resolution_text, '')), ''),
      last_calibrated_at = p_last_calibrated_at,
      calibration_interval_days = p_calibration_interval_days,
      next_due_at = v_next,
      status = v_status,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบเครื่องมือที่ต้องการแก้ไข';
    end if;
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_measuring_devices()
 RETURNS TABLE(id uuid, code text, kind text, status text, owner_team_id uuid, owner_team_name text, range_text text, resolution_text text, last_calibrated_at date, calibration_interval_days integer, next_due_at date, calibration_known boolean, is_overdue boolean, jobs_since_calibration integer, readings_since_calibration integer, last_used_at timestamp with time zone, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูทะเบียนเครื่องมือวัดได้';
  end if;

  return query
  with usage as (
    select
      r.measuring_device_id as device_id,
      count(distinct r.job_no)::integer as job_count,
      count(*)::integer as reading_count,
      max(r.performed_at) as last_used
    from public.job_acceptance_results r
    join public.measuring_devices d on d.id = r.measuring_device_id
    where r.measuring_device_id is not null
      and (d.last_calibrated_at is null or r.performed_at >= d.last_calibrated_at::timestamptz)
    group by r.measuring_device_id
  )
  select
    d.id,
    d.code,
    d.kind,
    d.status,
    d.owner_team_id,
    tt.name,
    d.range_text,
    d.resolution_text,
    d.last_calibrated_at,
    d.calibration_interval_days,
    d.next_due_at,
    (d.last_calibrated_at is not null),
    (d.next_due_at is not null and d.next_due_at < current_date),
    coalesce(u.job_count, 0),
    coalesce(u.reading_count, 0),
    u.last_used,
    d.note
  from public.measuring_devices d
  left join public.tech_teams tt on tt.id = d.owner_team_id
  left join usage u on u.device_id = d.id
  order by d.kind, d.code;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_measuring_device_usage(p_device_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(device_id uuid, device_code text, device_kind text, device_status text, last_calibrated_at date, next_due_at date, calibration_known boolean, job_no text, customer_name text, item_codes text[], readings integer, first_used_at timestamp with time zone, last_used_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูประวัติการใช้เครื่องมือวัดได้';
  end if;

  return query
  select
    d.id,
    d.code,
    d.kind,
    d.status,
    d.last_calibrated_at,
    d.next_due_at,
    (d.last_calibrated_at is not null),
    r.job_no,
    j.customer_name,
    array_agg(r.item_code order by r.item_code),
    count(*)::integer,
    min(r.performed_at),
    max(r.performed_at)
  from public.job_acceptance_results r
  join public.measuring_devices d on d.id = r.measuring_device_id
  left join public.install_jobs j on j.job_no = r.job_no
  where r.measuring_device_id is not null
    and (p_device_id is null or d.id = p_device_id)
    and (d.last_calibrated_at is null or r.performed_at >= d.last_calibrated_at::timestamptz)
  group by d.id, d.code, d.kind, d.status, d.last_calibrated_at, d.next_due_at, r.job_no, j.customer_name
  order by d.code, max(r.performed_at) desc;
end;
$function$;

-- ----------------------------------------------------------------------------
-- สิทธิ์ — ตรงตามสถานะจริงทั้งสามตัว: {postgres, authenticated, service_role}
-- ด่านจริงอยู่ในตัวฟังก์ชัน (is_floor_staff_active / role in admin,head_technician)
-- ไม่ใช่ที่ GRANT — GRANT แค่กันคนที่ไม่ได้ล็อกอิน (anon) ออกไปตั้งแต่ประตูแรก
--
-- หมายเหตุสำคัญ: ฟังก์ชันเก่า public.save_measuring_device(uuid,text,text,uuid,
-- text,text,date,integer,text) (9 พารามิเตอร์, OID 138068) ยังอยู่ในฐานข้อมูล
-- ไม่ได้ถูก drop — upsert_measuring_device เป็นรุ่นใหม่ที่เพิ่ม p_status เข้ามา
-- ทั้งสองตัวเขียนตารางเดียวกันแต่คิด status ต่างกัน (ตัวเก่าคำนวณ status เอง
-- ตัวใหม่รับ status จากผู้เรียก) ควรตัดสินใจว่าจะเก็บตัวไหนแล้ว drop อีกตัวออก
-- ----------------------------------------------------------------------------
revoke all on function public.upsert_measuring_device(uuid, text, text, uuid, text, text, date, integer, text, text) from public;
revoke all on function public.upsert_measuring_device(uuid, text, text, uuid, text, text, date, integer, text, text) from anon;
grant execute on function public.upsert_measuring_device(uuid, text, text, uuid, text, text, date, integer, text, text) to authenticated, service_role;

revoke all on function public.get_measuring_devices() from public;
revoke all on function public.get_measuring_devices() from anon;
grant execute on function public.get_measuring_devices() to authenticated, service_role;

revoke all on function public.get_measuring_device_usage(uuid) from public;
revoke all on function public.get_measuring_device_usage(uuid) from anon;
grant execute on function public.get_measuring_device_usage(uuid) to authenticated, service_role;

-- ทะเบียนเครื่องมือ: อ่านผ่าน RLS ได้เฉพาะพนักงานที่ยัง active, เขียนผ่าน RPC เท่านั้น
revoke all on table public.measuring_devices from anon;
revoke all on table public.measuring_devices from public;
grant select on table public.measuring_devices to authenticated;
grant all on table public.measuring_devices to service_role;
alter table public.measuring_devices enable row level security;

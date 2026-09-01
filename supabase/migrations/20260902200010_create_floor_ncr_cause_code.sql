-- P4-4 + P4-10 — ทางเขียน NC ทุกทางต้องพา cause_code / provider_id ไปด้วยได้
--
-- ทำไมต้อง drop แล้วสร้างใหม่ ไม่ใช่ create or replace:
--   postgres เปลี่ยนรายการพารามิเตอร์ของฟังก์ชันเดิมด้วย create or replace ไม่ได้
--   พารามิเตอร์ใหม่ทั้งสองตัวมี default = null ทางเรียกเดิมทุกทาง (ทั้งชื่อพารามิเตอร์และตำแหน่ง)
--   จึงยังเรียกได้เหมือนเดิมทุกประการ และได้ค่า null ซึ่งแปลว่า "ยังไม่ระบุ" ตามเจตนาของคอลัมน์
--   หลัง drop สิทธิ์บนฟังก์ชันหายไปด้วย จึงต้องตั้งใหม่ให้ครบท้ายไฟล์ (ดูข้อ 3)
--
-- ด่านที่เพิ่ม (ภาษาไทยทั้งหมด เพราะคนที่เห็นคือพนักงานหน้าจอ ไม่ใช่โปรแกรมเมอร์):
--   cause_code ต้องอยู่ในรายการของ ncr_cause_code_catalog() — พิมพ์เองมั่ว ๆ ไม่ได้
--   provider_id ต้องมีอยู่จริงใน suppliers — เลือกผู้ให้บริการที่ถูกลบไปแล้วไม่ได้
--   *** ไม่บังคับว่าทีมของงานต้องเป็น subcontract ***
--   เพราะผู้ให้บริการภายนอกไม่ได้มีแค่ทีมติดตั้ง — ซัพพลายเออร์วัสดุก็เป็นต้นเหตุของ NC ได้
--   ในงานที่ทีมติดตั้งเป็นทีมภายใน การบังคับตรงนี้จะปิดกรณีที่ถูกต้อง หน้าจอเป็นคนเลือกว่า
--   จะโชว์ช่องนี้เมื่อไร (โชว์เมื่อทีมเป็น subcontract) ซึ่งเป็นการจัดหน้าจอ ไม่ใช่กฎของข้อมูล

begin;

drop function if exists public.create_floor_ncr(text, text, text, text, numeric, text, numeric, text, text);
drop function if exists public.create_floor_ncr_as(uuid, text, text, text, text, text, numeric, text, numeric, text, text);

create function public.create_floor_ncr_as(
  p_actor_id uuid,
  p_actor_name text,
  p_job_no text,
  p_title text,
  p_type text,
  p_product_sku text default null,
  p_quantity numeric default null,
  p_description text default null,
  p_estimated_value_thb numeric default null,
  p_created_by text default null,
  p_severity text default 'medium',
  p_cause_code text default null,
  p_provider_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_due timestamptz;
  v_cause text;
begin
  if nullif(btrim(coalesce(p_job_no, '')), '') is null
     or not exists (select 1 from public.install_jobs where job_no = p_job_no) then
    raise exception 'valid job number is required';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'NCR title is required'; end if;
  if p_severity not in ('critical', 'high', 'medium', 'low') then raise exception 'invalid NCR severity'; end if;

  -- สาเหตุ: ว่างได้ (แปลว่ายังไม่ระบุ) แต่ถ้าใส่มาต้องเป็นค่าที่ระบบรู้จัก
  -- upper() เพื่อให้ 'logistics' ที่พิมพ์มาจากทางเดิมยังใช้ได้ ไม่ต้องแก้ผู้เรียกทุกที่พร้อมกัน
  v_cause := nullif(btrim(upper(coalesce(p_cause_code, ''))), '');
  if v_cause is not null and not exists (
    select 1 from jsonb_array_elements(public.ncr_cause_code_catalog()) as e(value)
    where e.value->>'code' = v_cause
  ) then
    raise exception 'ไม่รู้จักรหัสสาเหตุ "%" — เลือกจากรายการที่ระบบให้มาเท่านั้น', p_cause_code;
  end if;

  if p_provider_id is not null and not exists (select 1 from public.suppliers where id = p_provider_id) then
    raise exception 'ไม่พบผู้ให้บริการที่เลือก — อาจถูกลบไปแล้ว กรุณาเลือกใหม่';
  end if;

  v_due := now() + case p_severity
    when 'critical' then interval '4 hours'
    when 'high' then interval '24 hours'
    when 'medium' then interval '7 days'
    else interval '14 days' end;

  insert into public.ncr_reports(
    job_no, title, type, status, product_sku, quantity, description,
    estimated_value_thb, created_by, severity, due_at, owner_staff_id,
    cause_code, provider_id, created_at, updated_at
  ) values (
    p_job_no, left(btrim(p_title), 300), p_type, 'open',
    nullif(btrim(coalesce(p_product_sku, '')), ''), p_quantity,
    nullif(left(btrim(coalesce(p_description, '')), 3000), ''),
    p_estimated_value_thb,
    coalesce(nullif(btrim(coalesce(p_created_by, '')), ''), nullif(btrim(coalesce(p_actor_name, '')), '')),
    p_severity, v_due, p_actor_id,
    v_cause, p_provider_id, now(), now()
  ) returning id into v_id;

  insert into public.floor_ncr_events(ncr_id, event_type, to_status, actor_id, detail)
  values (v_id, 'created', 'open', p_actor_id, jsonb_build_object(
    'severity', p_severity, 'dueAt', v_due, 'causeCode', v_cause, 'providerId', p_provider_id
  ));

  return v_id;
end;
$function$;

comment on function public.create_floor_ncr_as(uuid, text, text, text, text, text, numeric, text, numeric, text, text, text, uuid) is
  'จุด insert เดียวของ ncr_reports — ทุกทางที่เปิด NC ต้องผ่านฟังก์ชันนี้ '
  'p_cause_code = แกน "ทำไม" (null ได้) และ p_provider_id = ผู้ให้บริการภายนอกที่เกี่ยวข้อง (null ได้) '
  'ไม่มีสิทธิ์ให้ใครเรียกตรง — ผู้เรียกคือ create_floor_ncr (พนักงาน) และ record_technician_item_receipt (ช่าง)';

create function public.create_floor_ncr(
  p_job_no text,
  p_title text,
  p_type text,
  p_product_sku text default null,
  p_quantity numeric default null,
  p_description text default null,
  p_estimated_value_thb numeric default null,
  p_created_by text default null,
  p_severity text default 'medium',
  p_cause_code text default null,
  p_provider_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active
    and role in ('admin', 'head_technician', 'warehouse', 'cs');
  if v_actor.id is null then raise exception 'NCR permission required'; end if;

  return public.create_floor_ncr_as(
    v_actor.id, v_actor.full_name, p_job_no, p_title, p_type, p_product_sku,
    p_quantity, p_description, p_estimated_value_thb, p_created_by, p_severity,
    p_cause_code, p_provider_id
  );
end;
$function$;

comment on function public.create_floor_ncr(text, text, text, text, numeric, text, numeric, text, text, text, uuid) is
  'เปิด NC จากหน้าจอพนักงาน (/ncr) — role admin/head_technician/warehouse/cs เท่านั้น';

-- ---------------------------------------------------------------------------
-- 2) ตัวเลือกของฟอร์มเปิด NC — ส่งจากเซิร์ฟเวอร์ชุดเดียว หน้าจอไม่ประกอบเอง
--    รวม: ใบงาน + ทีมของใบงานนั้นว่าเป็นทีมภายนอกไหม + รายการสาเหตุ + รายชื่อผู้ให้บริการ
--    เหตุผลที่รวมเป็น RPC เดียว: หน้าจอต้องรู้ "งานนี้ทีมภายนอกหรือเปล่า" ถึงจะรู้ว่าควรโชว์ช่อง
--    ผู้ให้บริการหรือไม่ ถ้าให้หน้าจอไปประกอบเองจาก appointments + tech_teams จะได้กฎคนละชุด
--    กับที่ฝั่งเซิร์ฟเวอร์เข้าใจ และเพี้ยนได้เงียบ ๆ
-- ---------------------------------------------------------------------------
create or replace function public.ncr_form_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_jobs jsonb;
  v_providers jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะเปิดฟอร์ม NC ได้';
  end if;

  -- ทีมของงาน: หนึ่งงานอาจมีหลายนัด (เลื่อนนัด/ไปซ้ำ) จึงยึด "นัดล่าสุด" เป็นทีมปัจจุบัน
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.job_no desc), '[]'::jsonb) into v_jobs
  from (
    select j.job_no,
           j.customer_name as customer,
           tt.name as team_name,
           tt.provider_type,
           (tt.provider_type = 'subcontract') as is_external
    from public.install_jobs j
    left join lateral (
      select a.tech_id from public.appointments a
      where a.job_id = j.job_no and a.tech_id is not null
      order by a.slot_start desc limit 1
    ) last_appt on true
    left join public.tech_teams tt on tt.id = last_appt.tech_id
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'providerKind', s.provider_kind) order by s.name), '[]'::jsonb)
    into v_providers
  from public.suppliers s;

  return jsonb_build_object(
    'jobs', v_jobs,
    'causeCodes', public.ncr_cause_code_catalog(),
    'providers', v_providers
  );
end;
$function$;

comment on function public.ncr_form_options() is
  'ตัวเลือกทั้งหมดของฟอร์มเปิด NC ในคำขอเดียว — ใบงานพร้อมทีม/ประเภททีม, รายการสาเหตุ, รายชื่อผู้ให้บริการ';

-- ---------------------------------------------------------------------------
-- 3) สิทธิ์ — ตั้งใหม่ทั้งหมดหลัง drop (ค่าเริ่มต้นของ postgres คือ PUBLIC execute ได้ ต้องปิดเอง)
--    anon ต้องไม่เหลือสิทธิ์อะไรบนของที่ไฟล์นี้สร้าง
-- ---------------------------------------------------------------------------
revoke all on function public.create_floor_ncr_as(uuid, text, text, text, text, text, numeric, text, numeric, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_floor_ncr_as(uuid, text, text, text, text, text, numeric, text, numeric, text, text, text, uuid) to service_role;

revoke all on function public.create_floor_ncr(text, text, text, text, numeric, text, numeric, text, text, text, uuid) from public, anon;
grant execute on function public.create_floor_ncr(text, text, text, text, numeric, text, numeric, text, text, text, uuid) to authenticated, service_role;

revoke all on function public.ncr_form_options() from public, anon;
grant execute on function public.ncr_form_options() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

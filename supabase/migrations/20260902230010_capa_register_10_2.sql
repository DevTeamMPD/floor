-- P5-5 — ทะเบียน CAPA: การแก้ไขและป้องกันการเกิดซ้ำ (ISO 9001:2015 ข้อ 10.2)
--
-- ช่องว่างที่ปิด:
--   ncr_reports บันทึกว่า "มีอะไรผิดพลาด" ได้แล้ว (อาการ + สาเหตุผ่าน cause_code)
--   แต่ไม่มีที่เก็บว่า "แล้วทำอะไรเพื่อไม่ให้เกิดอีก" และ "ที่ทำไปนั้นได้ผลจริงไหม"
--   ข้อ 10.2.1 ต้องการทั้งการแก้ไขเฉพาะหน้า การหาสาเหตุราก และการลงมือแก้ที่ราก
--   ข้อ 10.2.2 ต้องการหลักฐานว่าได้ทบทวนประสิทธิผลของสิ่งที่ทำไปแล้ว
--   ส่วนที่คนข้ามกันมากที่สุดคือส่วนหลัง — ไฟล์นี้จึงบังคับด้วย constraint ไม่ใช่แค่มีช่องให้กรอก
--
-- โครงสร้าง:
--   capa_records     ใบ CAPA หนึ่งใบ = ปัญหาหนึ่งเรื่องที่ต้องแก้ไม่ให้เกิดซ้ำ
--   capa_ncr_links   ผูกกับ NC ได้หลายใบ (ปัญหาเดียวมักโผล่เป็น NC หลายครั้งก่อนมีคนตั้ง CAPA)
--
-- "CAPA รวมสองฝั่ง" — ทำเฉพาะฝั่ง LENDI ตามที่สั่ง:
--   ฝั่ง BBPS เป็นคนละแอปคนละ repo ไฟล์นี้ไม่ยิง HTTP ข้ามระบบและไม่อ้างตารางของอีกฝั่ง
--   แต่ออกแบบให้ต้นเรื่องฝั่ง BBPS มาต่อทีหลังได้โดยไม่ต้องแก้สคีมา ผ่านสามคอลัมน์:
--     origin_system  'lendi' (ค่าเริ่มต้น) หรือ 'bbps'
--     origin_ref     รหัสอ้างอิงของต้นเรื่องในระบบนั้น (text จึงไม่ผูกกับชนิด id ของอีกฝั่ง)
--     origin_detail  jsonb สำหรับสำเนาข้อมูลต้นเรื่องเท่าที่ต้องใช้อ่านโดยไม่ต้องข้ามระบบ
--   และ capa_ncr_links เป็น "ศูนย์หรือหลายใบ" ไม่ใช่ "ต้องมีอย่างน้อยหนึ่ง"
--   ใบที่มาจาก BBPS จึงมีอยู่ได้โดยไม่ต้องมี ncr_reports ฝั่งนี้รองรับ
--   ทั้งหมดนี้เป็นการเผื่อโครงสร้าง ไม่ใช่การเปิดทาง — ยังไม่มีอะไรเขียน 'bbps' ได้ในวันนี้
--
-- ใครเขียนได้: admin, head_technician, warehouse, cs
--   ชุดเดียวกับ create_floor_ncr และ advance_floor_ncr ที่มีอยู่แล้ว เพื่อไม่ให้เกิด
--   โมเดลสิทธิ์ที่สามที่ต้องมาไล่ตามทีหลัง — คนที่เปิด NC ได้ควรเป็นคนที่ตั้ง CAPA ได้
--   role staff อ่านได้ (โปร่งใส) แต่เขียนไม่ได้ ตามหลักการของโปรเจกต์ที่ client เขียนผ่าน RPC เท่านั้น

begin;

-- ---------------------------------------------------------------------------
-- 1) คำศัพท์ — สถานะและคำตัดสินประสิทธิผล เป็นแหล่งความจริงเดียวของทั้งระบบ
-- ---------------------------------------------------------------------------
create or replace function public.capa_status_catalog()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object('code','draft',        'label','ร่าง',                'help','เพิ่งตั้งเรื่อง ยังไม่เริ่มวิเคราะห์'),
    jsonb_build_object('code','analysis',     'label','กำลังหาสาเหตุราก',    'help','กำลังวิเคราะห์ว่าทำไมถึงเกิด'),
    jsonb_build_object('code','action',       'label','กำลังแก้ไข',          'help','รู้สาเหตุแล้ว กำลังลงมือแก้ที่ต้นเหตุ'),
    jsonb_build_object('code','verification', 'label','รอตรวจประสิทธิผล',    'help','แก้เสร็จแล้ว รอดูว่าได้ผลจริงไหม'),
    jsonb_build_object('code','closed',       'label','ปิดเรื่อง',            'help','ตรวจประสิทธิผลแล้วและสรุปผลได้'),
    jsonb_build_object('code','cancelled',    'label','ยกเลิก',              'help','ไม่ดำเนินการต่อ ต้องระบุเหตุผล')
  );
$function$;

comment on function public.capa_status_catalog() is
  'ลำดับสถานะของใบ CAPA พร้อมป้ายภาษาไทย — หน้าจอและ RPC อ่านชุดเดียวกันนี้';

revoke all on function public.capa_status_catalog() from public, anon, authenticated;
grant execute on function public.capa_status_catalog() to authenticated, service_role;

create or replace function public.capa_effectiveness_catalog()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object('code','effective',    'label','ได้ผล',            'help','ปัญหาเดิมไม่กลับมาอีกในช่วงที่เฝ้าดู'),
    jsonb_build_object('code','not_effective','label','ไม่ได้ผล',          'help','ปัญหาเดิมยังเกิดซ้ำ ต้องกลับไปหาสาเหตุใหม่'),
    jsonb_build_object('code','inconclusive', 'label','ยังสรุปไม่ได้',     'help','ข้อมูลยังน้อยเกินกว่าจะบอกได้ ต้องเฝ้าดูต่อ')
  );
$function$;

comment on function public.capa_effectiveness_catalog() is
  'คำตัดสินผลการตรวจประสิทธิผลตามข้อ 10.2.2 — "ยังสรุปไม่ได้" เป็นคำตอบที่ซื่อสัตย์ '
  'และตั้งใจให้มี เพื่อไม่ให้คนถูกบังคับให้ตอบว่า "ได้ผล" ทั้งที่ยังไม่รู้';

revoke all on function public.capa_effectiveness_catalog() from public, anon, authenticated;
grant execute on function public.capa_effectiveness_catalog() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) ตารางหลัก
-- ---------------------------------------------------------------------------
create sequence if not exists public.capa_no_seq;

create table if not exists public.capa_records (
  id uuid primary key default gen_random_uuid(),
  capa_no text not null unique,
  title text not null,

  -- ต้นเรื่อง — เผื่อให้ฝั่ง BBPS มาต่อทีหลังโดยไม่ต้องแก้สคีมา
  origin_system text not null default 'lendi',
  origin_ref text,
  origin_detail jsonb not null default '{}'::jsonb,

  -- 10.2.1 (a) ปัญหาคืออะไร และทำอะไรทันทีเพื่อคุมไม่ให้ลาม
  problem_statement text not null,
  immediate_correction text,

  -- 10.2.1 (b) สาเหตุราก
  cause_code text,
  root_cause_method text,
  root_cause_analysis text,

  -- 10.2.1 (d) แก้ที่ราก ใครรับผิดชอบ ภายในเมื่อไร
  corrective_action text,
  owner_staff_id uuid not null references public.floor_staff_profiles(id),
  due_date date,

  status text not null default 'draft',

  -- 10.2.2 ทบทวนประสิทธิผล — ส่วนที่คนข้ามกันมากที่สุด
  effectiveness_due_date date,
  effectiveness_checked_at timestamptz,
  effectiveness_checked_by uuid references public.floor_staff_profiles(id),
  effectiveness_verdict text,
  effectiveness_evidence text,

  cancelled_reason text,
  closed_at timestamptz,
  created_by uuid references public.floor_staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint capa_records_origin_system_check
    check (origin_system in ('lendi', 'bbps')),
  -- ใบที่มาจากระบบอื่นต้องบอกได้ว่าอ้างถึงเรื่องไหน ไม่งั้นตามกลับไปหาต้นเรื่องไม่ได้
  constraint capa_records_external_origin_needs_ref
    check (origin_system = 'lendi' or btrim(coalesce(origin_ref, '')) <> ''),
  constraint capa_records_origin_detail_is_object
    check (jsonb_typeof(origin_detail) = 'object'),
  constraint capa_records_title_not_blank check (btrim(title) <> ''),
  constraint capa_records_problem_not_blank check (btrim(problem_statement) <> ''),
  constraint capa_records_status_check
    check (status in ('draft', 'analysis', 'action', 'verification', 'closed', 'cancelled')),
  constraint capa_records_cause_code_check
    check (cause_code is null or cause_code in
      ('MATERIAL', 'PRODUCTION', 'INSTALL', 'DESIGN', 'LOGISTICS', 'SITE', 'OTHER')),
  constraint capa_records_root_cause_method_check
    check (root_cause_method is null or root_cause_method in ('5why', 'fishbone', 'other')),
  constraint capa_records_effectiveness_verdict_check
    check (effectiveness_verdict is null or effectiveness_verdict in
      ('effective', 'not_effective', 'inconclusive')),

  -- คำตัดสินต้องมาพร้อมวันที่และคนตรวจเสมอ — "ได้ผล" ที่ไม่มีใครเซ็นไม่ใช่หลักฐาน
  constraint capa_records_verdict_needs_checker
    check (
      effectiveness_verdict is null
      or (effectiveness_checked_at is not null and effectiveness_checked_by is not null)
    ),

  -- *** หัวใจของข้อ 10.2.2 ***
  -- ปิดเรื่องไม่ได้ถ้ายังไม่ได้ตรวจว่าสิ่งที่ทำไปได้ผลจริงไหม
  -- บังคับที่ระดับฐานข้อมูล ไม่ใช่แค่ที่หน้าจอ เพราะนี่คือส่วนที่คนข้ามเป็นประจำ
  constraint capa_records_closed_needs_effectiveness
    check (
      status <> 'closed'
      or (effectiveness_verdict is not null
          and effectiveness_checked_at is not null
          and effectiveness_checked_by is not null
          and btrim(coalesce(corrective_action, '')) <> ''
          and btrim(coalesce(root_cause_analysis, '')) <> ''
          and closed_at is not null)
    ),
  -- ปิดด้วยผล "ไม่ได้ผล" ไม่ได้ — ถ้ายังไม่ได้ผลแปลว่ายังแก้ไม่เสร็จ ต้องกลับไปหาสาเหตุใหม่
  constraint capa_records_cannot_close_ineffective
    check (status <> 'closed' or effectiveness_verdict <> 'not_effective'),

  constraint capa_records_cancelled_needs_reason
    check (status <> 'cancelled' or btrim(coalesce(cancelled_reason, '')) <> '')
);

create index if not exists capa_records_status_idx on public.capa_records(status);
create index if not exists capa_records_owner_idx on public.capa_records(owner_staff_id);
create index if not exists capa_records_due_idx on public.capa_records(due_date)
  where status not in ('closed', 'cancelled');
create index if not exists capa_records_effectiveness_due_idx
  on public.capa_records(effectiveness_due_date) where status = 'verification';
create index if not exists capa_records_origin_idx
  on public.capa_records(origin_system, origin_ref) where origin_system <> 'lendi';

comment on table public.capa_records is
  'ทะเบียนการแก้ไขและป้องกันการเกิดซ้ำ (CAPA) ตาม ISO 9001:2015 ข้อ 10.2 '
  'หนึ่งใบ = ปัญหาหนึ่งเรื่องที่ต้องแก้ไม่ให้เกิดซ้ำ ผูกกับ ncr_reports ได้หลายใบผ่าน capa_ncr_links';
comment on column public.capa_records.origin_system is
  'ระบบต้นเรื่อง — ''lendi'' คือเกิดในระบบนี้ ''bbps'' เผื่อไว้ให้อีกระบบมาต่อทีหลัง '
  'โดยไม่ต้องแก้สคีมา วันนี้ยังไม่มี RPC ตัวไหนเขียนค่า ''bbps'' ได้';
comment on column public.capa_records.origin_ref is
  'รหัสอ้างอิงต้นเรื่องในระบบนั้น เก็บเป็น text จึงไม่ผูกกับชนิด id ของอีกฝั่ง';
comment on column public.capa_records.origin_detail is
  'สำเนาข้อมูลต้นเรื่องเท่าที่ต้องใช้อ่าน เพื่อไม่ต้องเรียกข้ามระบบตอนแสดงผล';
comment on column public.capa_records.immediate_correction is
  'การแก้เฉพาะหน้าเพื่อคุมผลกระทบ (ข้อ 10.2.1 ก) — คนละเรื่องกับ corrective_action ที่แก้ที่ต้นเหตุ';
comment on column public.capa_records.effectiveness_verdict is
  'ผลการทบทวนประสิทธิผลตามข้อ 10.2.2 — ปิดเรื่องไม่ได้ถ้าช่องนี้ยังว่าง (constraint บังคับ)';

-- ---------------------------------------------------------------------------
-- 3) ผูกกับ NC — หลายใบต่อหนึ่ง CAPA
-- ---------------------------------------------------------------------------
create table if not exists public.capa_ncr_links (
  capa_id uuid not null references public.capa_records(id) on delete cascade,
  ncr_id uuid not null references public.ncr_reports(id) on delete restrict,
  linked_at timestamptz not null default now(),
  linked_by uuid references public.floor_staff_profiles(id),
  primary key (capa_id, ncr_id)
);

create index if not exists capa_ncr_links_ncr_idx on public.capa_ncr_links(ncr_id);

comment on table public.capa_ncr_links is
  'ผูกใบ CAPA กับ NC ที่เป็นหลักฐานของปัญหา — เป็นหลายต่อหลายโดยตั้งใจ '
  'เพราะปัญหาเดียวมักโผล่เป็น NC หลายครั้งก่อนจะมีคนตั้ง CAPA '
  'on delete restrict ฝั่ง NC: ลบ NC ที่เป็นหลักฐานของ CAPA ที่ยังอยู่ไม่ได้';

-- ---------------------------------------------------------------------------
-- 4) RLS + grants — อ่านได้เฉพาะพนักงาน active เขียนผ่าน RPC เท่านั้น
-- ---------------------------------------------------------------------------
alter table public.capa_records enable row level security;
alter table public.capa_ncr_links enable row level security;

revoke all on public.capa_records from anon, authenticated;
revoke all on public.capa_ncr_links from anon, authenticated;
revoke all on sequence public.capa_no_seq from anon, authenticated;

grant select on public.capa_records to authenticated;
grant select on public.capa_ncr_links to authenticated;

drop policy if exists capa_records_active_staff_read on public.capa_records;
create policy capa_records_active_staff_read on public.capa_records
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists capa_ncr_links_active_staff_read on public.capa_ncr_links;
create policy capa_ncr_links_active_staff_read on public.capa_ncr_links
  for select to authenticated using ((select public.is_floor_staff_active()));

-- ---------------------------------------------------------------------------
-- 5) ด่านสิทธิ์ร่วม
-- ---------------------------------------------------------------------------
create or replace function public.capa_guard(p_action text)
returns public.floor_staff_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_roles text[] := array['admin', 'head_technician', 'warehouse', 'cs'];
begin
  select * into v_actor from public.floor_staff_profiles
   where id = (select auth.uid()) and is_active;
  if v_actor.id is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงานที่ยังใช้งานอยู่ จึงจะ%ได้', p_action;
  end if;
  if not (v_actor.role = any(v_roles)) then
    raise exception 'บัญชีของคุณไม่มีสิทธิ์% — ต้องเป็นตำแหน่ง %',
      p_action, array_to_string(v_roles, ' หรือ ');
  end if;
  return v_actor;
end;
$function$;

comment on function public.capa_guard(text) is
  'ด่านสิทธิ์ร่วมของ RPC ทะเบียน CAPA — ชุดตำแหน่งเดียวกับ create_floor_ncr/advance_floor_ncr '
  'เพื่อไม่ให้เกิดโมเดลสิทธิ์ที่สามที่ต้องมาไล่ตามทีหลัง';

revoke all on function public.capa_guard(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) เปิดเรื่อง CAPA
-- ---------------------------------------------------------------------------
create or replace function public.create_capa(
  p_title text,
  p_problem_statement text,
  p_owner_staff_id uuid,
  p_ncr_ids uuid[] default null,
  p_immediate_correction text default null,
  p_cause_code text default null,
  p_due_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_id uuid;
  v_capa_no text;
  v_owner public.floor_staff_profiles%rowtype;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_problem text := nullif(btrim(coalesce(p_problem_statement, '')), '');
  v_ncr uuid;
  v_linked int := 0;
begin
  v_actor := public.capa_guard('เปิดเรื่อง CAPA');

  if v_title is null then raise exception 'ต้องระบุชื่อเรื่อง CAPA'; end if;
  if v_problem is null then
    raise exception 'ต้องอธิบายว่าปัญหาคืออะไร — ใบ CAPA ที่ไม่มีคำอธิบายปัญหาใช้ทำงานต่อไม่ได้';
  end if;

  select * into v_owner from public.floor_staff_profiles
   where id = p_owner_staff_id and is_active;
  if v_owner.id is null then
    raise exception 'ต้องระบุผู้รับผิดชอบที่เป็นพนักงานที่ยังใช้งานอยู่ — เรื่องที่ไม่มีเจ้าของจะไม่มีใครทำ';
  end if;

  v_capa_no := 'CAPA-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMM') || '-' ||
               lpad(nextval('public.capa_no_seq')::text, 4, '0');

  insert into public.capa_records(
    capa_no, title, problem_statement, immediate_correction, cause_code,
    owner_staff_id, due_date, status, created_by
  ) values (
    v_capa_no, v_title, v_problem,
    nullif(btrim(coalesce(p_immediate_correction, '')), ''),
    nullif(btrim(coalesce(p_cause_code, '')), ''),
    v_owner.id, p_due_date, 'draft', v_actor.id
  ) returning id into v_id;

  if p_ncr_ids is not null then
    foreach v_ncr in array p_ncr_ids loop
      if not exists (select 1 from public.ncr_reports where id = v_ncr) then
        raise exception 'ไม่พบใบ NC ที่ระบุ (%)', v_ncr;
      end if;
      insert into public.capa_ncr_links(capa_id, ncr_id, linked_by)
      values (v_id, v_ncr, v_actor.id)
      on conflict do nothing;
      v_linked := v_linked + 1;
    end loop;
  end if;

  return jsonb_build_object('capaId', v_id, 'capaNo', v_capa_no, 'linkedNcrCount', v_linked);
end;
$function$;

comment on function public.create_capa(text, text, uuid, uuid[], text, text, date) is
  'เปิดเรื่อง CAPA ใหม่ พร้อมผูกกับ NC ที่เป็นหลักฐานได้หลายใบ '
  'บังคับให้มีผู้รับผิดชอบที่ยัง active เสมอ เพราะเรื่องที่ไม่มีเจ้าของจะไม่มีใครทำ';

revoke all on function public.create_capa(text, text, uuid, uuid[], text, text, date) from public, anon, authenticated;
grant execute on function public.create_capa(text, text, uuid, uuid[], text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) บันทึกการวิเคราะห์สาเหตุรากและมาตรการแก้ไข
-- ---------------------------------------------------------------------------
create or replace function public.record_capa_analysis(
  p_capa_id uuid,
  p_root_cause_analysis text,
  p_corrective_action text,
  p_root_cause_method text default null,
  p_cause_code text default null,
  p_effectiveness_due_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_capa public.capa_records%rowtype;
  v_root text := nullif(btrim(coalesce(p_root_cause_analysis, '')), '');
  v_action text := nullif(btrim(coalesce(p_corrective_action, '')), '');
begin
  v_actor := public.capa_guard('บันทึกการวิเคราะห์ CAPA');

  select * into v_capa from public.capa_records where id = p_capa_id for update;
  if v_capa.id is null then raise exception 'ไม่พบใบ CAPA ที่เลือก'; end if;
  if v_capa.status in ('closed', 'cancelled') then
    raise exception 'ใบ CAPA นี้ปิดไปแล้ว (สถานะ %) แก้ไขไม่ได้', v_capa.status;
  end if;
  if v_root is null then
    raise exception 'ต้องอธิบายสาเหตุราก — ถ้ายังไม่รู้สาเหตุ มาตรการที่ออกมาจะแก้ไม่ตรงจุด';
  end if;
  if v_action is null then
    raise exception 'ต้องระบุมาตรการแก้ไขที่ต้นเหตุ';
  end if;

  update public.capa_records set
    root_cause_analysis = v_root,
    corrective_action = v_action,
    root_cause_method = coalesce(nullif(btrim(coalesce(p_root_cause_method, '')), ''), root_cause_method),
    cause_code = coalesce(nullif(btrim(coalesce(p_cause_code, '')), ''), cause_code),
    effectiveness_due_date = coalesce(p_effectiveness_due_date, effectiveness_due_date),
    status = 'action',
    updated_at = now()
  where id = p_capa_id;

  return jsonb_build_object('capaId', p_capa_id, 'status', 'action');
end;
$function$;

comment on function public.record_capa_analysis(uuid, text, text, text, text, date) is
  'บันทึกสาเหตุรากและมาตรการแก้ไขของใบ CAPA แล้วเลื่อนสถานะไป action (ข้อ 10.2.1 ข และ ง)';

revoke all on function public.record_capa_analysis(uuid, text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.record_capa_analysis(uuid, text, text, text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) แจ้งว่าแก้เสร็จแล้ว เข้าสู่ช่วงเฝ้าดูผล
-- ---------------------------------------------------------------------------
create or replace function public.submit_capa_for_verification(
  p_capa_id uuid,
  p_effectiveness_due_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_capa public.capa_records%rowtype;
begin
  v_actor := public.capa_guard('ส่งใบ CAPA เข้าตรวจประสิทธิผล');

  select * into v_capa from public.capa_records where id = p_capa_id for update;
  if v_capa.id is null then raise exception 'ไม่พบใบ CAPA ที่เลือก'; end if;
  if v_capa.status in ('closed', 'cancelled') then
    raise exception 'ใบ CAPA นี้ปิดไปแล้ว (สถานะ %)', v_capa.status;
  end if;
  if btrim(coalesce(v_capa.root_cause_analysis, '')) = ''
     or btrim(coalesce(v_capa.corrective_action, '')) = '' then
    raise exception 'ยังบันทึกสาเหตุรากและมาตรการแก้ไขไม่ครบ จึงยังส่งเข้าตรวจประสิทธิผลไม่ได้';
  end if;

  update public.capa_records set
    status = 'verification',
    effectiveness_due_date = coalesce(p_effectiveness_due_date, effectiveness_due_date),
    updated_at = now()
  where id = p_capa_id;

  return jsonb_build_object('capaId', p_capa_id, 'status', 'verification');
end;
$function$;

comment on function public.submit_capa_for_verification(uuid, date) is
  'เลื่อนใบ CAPA ไปสถานะรอตรวจประสิทธิผล หลังลงมือแก้ที่ต้นเหตุเสร็จแล้ว';

revoke all on function public.submit_capa_for_verification(uuid, date) from public, anon, authenticated;
grant execute on function public.submit_capa_for_verification(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) ตรวจประสิทธิผล — ส่วนที่คนข้าม และเป็นเหตุผลที่ไฟล์นี้มีอยู่
-- ---------------------------------------------------------------------------
create or replace function public.record_capa_effectiveness(
  p_capa_id uuid,
  p_verdict text,
  p_evidence text,
  p_close boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_capa public.capa_records%rowtype;
  v_verdict text := nullif(btrim(coalesce(p_verdict, '')), '');
  v_evidence text := nullif(btrim(coalesce(p_evidence, '')), '');
  v_now timestamptz := now();
  v_status text;
begin
  v_actor := public.capa_guard('บันทึกผลการตรวจประสิทธิผล CAPA');

  select * into v_capa from public.capa_records where id = p_capa_id for update;
  if v_capa.id is null then raise exception 'ไม่พบใบ CAPA ที่เลือก'; end if;
  if v_capa.status in ('closed', 'cancelled') then
    raise exception 'ใบ CAPA นี้ปิดไปแล้ว (สถานะ %)', v_capa.status;
  end if;
  if v_verdict is null or v_verdict not in ('effective', 'not_effective', 'inconclusive') then
    raise exception 'ต้องระบุผลการตรวจเป็น effective, not_effective หรือ inconclusive';
  end if;
  if v_evidence is null then
    raise exception 'ต้องระบุหลักฐานที่ใช้ตัดสิน — คำว่า "ได้ผล" ที่ไม่มีหลักฐานประกอบไม่ใช่การทบทวน';
  end if;
  if btrim(coalesce(v_capa.corrective_action, '')) = ''
     or btrim(coalesce(v_capa.root_cause_analysis, '')) = '' then
    raise exception 'ยังไม่มีสาเหตุรากหรือมาตรการแก้ไขในใบนี้ จึงยังไม่มีอะไรให้ตรวจประสิทธิผล';
  end if;

  -- ปิดได้เฉพาะเมื่อผลออกมาว่าได้ผลจริง
  -- "ไม่ได้ผล" แปลว่ายังแก้ไม่เสร็จ ต้องกลับไปหาสาเหตุใหม่ ไม่ใช่ปิดเรื่องทิ้ง
  if p_close and v_verdict <> 'effective' then
    raise exception 'ปิดเรื่องด้วยผล "%" ไม่ได้ — ถ้ายังไม่ได้ผลแปลว่าปัญหายังไม่ถูกแก้ '
                    'ให้กลับไปทบทวนสาเหตุรากใหม่', v_verdict;
  end if;

  v_status := case
    when p_close then 'closed'
    when v_verdict = 'not_effective' then 'analysis'
    else 'verification'
  end;

  update public.capa_records set
    effectiveness_verdict = v_verdict,
    effectiveness_evidence = v_evidence,
    effectiveness_checked_at = v_now,
    effectiveness_checked_by = v_actor.id,
    status = v_status,
    closed_at = case when p_close then v_now else closed_at end,
    updated_at = v_now
  where id = p_capa_id;

  return jsonb_build_object(
    'capaId', p_capa_id, 'verdict', v_verdict, 'status', v_status,
    'reopenedForAnalysis', v_verdict = 'not_effective'
  );
end;
$function$;

comment on function public.record_capa_effectiveness(uuid, text, text, boolean) is
  'บันทึกผลการทบทวนประสิทธิผลตาม ISO 9001:2015 ข้อ 10.2.2 พร้อมวันที่และผู้ตรวจ '
  'ผล "ไม่ได้ผล" จะดึงเรื่องกลับไปสถานะหาสาเหตุใหม่โดยอัตโนมัติ ไม่ใช่ปล่อยให้ปิด';

revoke all on function public.record_capa_effectiveness(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_capa_effectiveness(uuid, text, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10) ยกเลิกเรื่อง — ต้องมีเหตุผล
-- ---------------------------------------------------------------------------
create or replace function public.cancel_capa(p_capa_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_capa public.capa_records%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_actor := public.capa_guard('ยกเลิกใบ CAPA');
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'การยกเลิกใบ CAPA ต้องอธิบายเหตุผลให้คนที่มาอ่านทีหลังเข้าใจได้';
  end if;

  select * into v_capa from public.capa_records where id = p_capa_id for update;
  if v_capa.id is null then raise exception 'ไม่พบใบ CAPA ที่เลือก'; end if;
  if v_capa.status = 'closed' then
    raise exception 'ใบ CAPA ที่ปิดเรื่องแล้วยกเลิกไม่ได้';
  end if;
  if v_capa.status = 'cancelled' then
    raise exception 'ใบ CAPA นี้ถูกยกเลิกไปแล้ว';
  end if;

  update public.capa_records set
    status = 'cancelled', cancelled_reason = v_reason, updated_at = now()
  where id = p_capa_id;

  return jsonb_build_object('capaId', p_capa_id, 'status', 'cancelled');
end;
$function$;

comment on function public.cancel_capa(uuid, text) is 'ยกเลิกใบ CAPA พร้อมเหตุผลที่บังคับให้ยาวพอจะเข้าใจได้';

revoke all on function public.cancel_capa(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_capa(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11) ผูก / ถอด NC ออกจากใบ CAPA
-- ---------------------------------------------------------------------------
create or replace function public.link_ncr_to_capa(p_capa_id uuid, p_ncr_id uuid, p_attach boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_capa public.capa_records%rowtype;
begin
  v_actor := public.capa_guard('ผูกใบ NC กับ CAPA');

  select * into v_capa from public.capa_records where id = p_capa_id;
  if v_capa.id is null then raise exception 'ไม่พบใบ CAPA ที่เลือก'; end if;
  if v_capa.status in ('closed', 'cancelled') then
    raise exception 'ใบ CAPA นี้ปิดไปแล้ว แก้รายการ NC ที่ผูกอยู่ไม่ได้';
  end if;
  if not exists (select 1 from public.ncr_reports where id = p_ncr_id) then
    raise exception 'ไม่พบใบ NC ที่ระบุ';
  end if;

  if p_attach then
    insert into public.capa_ncr_links(capa_id, ncr_id, linked_by)
    values (p_capa_id, p_ncr_id, v_actor.id) on conflict do nothing;
  else
    delete from public.capa_ncr_links where capa_id = p_capa_id and ncr_id = p_ncr_id;
  end if;

  return jsonb_build_object('capaId', p_capa_id, 'ncrId', p_ncr_id, 'attached', p_attach);
end;
$function$;

comment on function public.link_ncr_to_capa(uuid, uuid, boolean) is
  'ผูกหรือถอดใบ NC ออกจากใบ CAPA — ปัญหาเดียวมักโผล่เป็น NC หลายครั้ง จึงต้องผูกได้หลายใบ';

revoke all on function public.link_ncr_to_capa(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.link_ncr_to_capa(uuid, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) ภาพรวมสำหรับหน้าจอ
-- ---------------------------------------------------------------------------
create or replace function public.capa_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
  v_ncr jsonb;
  v_staff jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูทะเบียน CAPA ได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."createdAt" desc), '[]'::jsonb) into v_rows
  from (
    select c.id as "capaId", c.capa_no as "capaNo", c.title, c.status,
           c.origin_system as "originSystem", c.origin_ref as "originRef",
           c.problem_statement as "problemStatement",
           c.immediate_correction as "immediateCorrection",
           c.cause_code as "causeCode",
           c.root_cause_method as "rootCauseMethod",
           c.root_cause_analysis as "rootCauseAnalysis",
           c.corrective_action as "correctiveAction",
           c.owner_staff_id as "ownerStaffId",
           o.full_name as "ownerName",
           c.due_date as "dueDate",
           c.effectiveness_due_date as "effectivenessDueDate",
           c.effectiveness_checked_at as "effectivenessCheckedAt",
           ec.full_name as "effectivenessCheckedByName",
           c.effectiveness_verdict as "effectivenessVerdict",
           c.effectiveness_evidence as "effectivenessEvidence",
           c.cancelled_reason as "cancelledReason",
           c.closed_at as "closedAt", c.created_at as "createdAt",
           (c.due_date is not null and c.due_date < current_date
             and c.status not in ('closed','cancelled')) as "overdue",
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'ncrId', n.id, 'title', n.title, 'status', n.status,
               'severity', n.severity, 'causeCode', n.cause_code, 'jobNo', n.job_no)
               order by n.created_at)
               from public.capa_ncr_links l
               join public.ncr_reports n on n.id = l.ncr_id
              where l.capa_id = c.id), '[]'::jsonb) as "linkedNcrs"
      from public.capa_records c
      left join public.floor_staff_profiles o on o.id = c.owner_staff_id
      left join public.floor_staff_profiles ec on ec.id = c.effectiveness_checked_by
  ) x;

  -- NC ที่ยังไม่ถูกผูกกับ CAPA ใบไหน — คือรายการที่รอคนตั้งเรื่องแก้ที่ต้นเหตุ
  select coalesce(jsonb_agg(jsonb_build_object(
           'ncrId', n.id, 'title', n.title, 'status', n.status, 'severity', n.severity,
           'causeCode', n.cause_code, 'jobNo', n.job_no, 'createdAt', n.created_at)
           order by n.created_at desc), '[]'::jsonb) into v_ncr
    from public.ncr_reports n
   where not exists (select 1 from public.capa_ncr_links l where l.ncr_id = n.id);

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role)
           order by p.full_name), '[]'::jsonb) into v_staff
    from public.floor_staff_profiles p where p.is_active;

  return jsonb_build_object(
    'statusCatalog', public.capa_status_catalog(),
    'effectivenessCatalog', public.capa_effectiveness_catalog(),
    'causeCodeCatalog', public.ncr_cause_code_catalog(),
    'canEdit', (
      select p.role = any(array['admin','head_technician','warehouse','cs'])
        from public.floor_staff_profiles p where p.id = (select auth.uid()) and p.is_active
    ),
    'records', coalesce(v_rows, '[]'::jsonb),
    'unlinkedNcrs', coalesce(v_ncr, '[]'::jsonb),
    'staff', coalesce(v_staff, '[]'::jsonb)
  );
end;
$function$;

comment on function public.capa_snapshot() is
  'ภาพรวมทะเบียน CAPA สำหรับหน้าจอ รวมรายการ NC ที่ยังไม่ถูกผูกกับ CAPA ใบไหน '
  'ซึ่งคือรายการที่รอคนตั้งเรื่องแก้ที่ต้นเหตุ';

revoke all on function public.capa_snapshot() from public, anon, authenticated;
grant execute on function public.capa_snapshot() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

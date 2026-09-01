-- P5-10 — ระงับผู้ให้บริการที่คะแนนต่ำกว่าเกณฑ์ โดยต้องมีคนเซ็นและมีเหตุผลเสมอ (ISO 9001:2015 ข้อ 8.4.1)
--
-- ต่อยอดจากงานก่อนหน้าโดยตรง ไม่สร้างของซ้ำ:
--   คะแนน 0–100 ต่อทีม อยู่ที่ public.tech_team_eval_scores (20260902200030/200040/200050)
--   คณิตศาสตร์การให้คะแนนอยู่ที่ lib/provider-eval.ts และมีเทสครบแล้ว
--   ไฟล์นี้ "อ่าน" คะแนนนั้น ไม่คำนวณใหม่ และไม่เพิ่มตารางคะแนนอีกใบ
--
-- หลักการที่ต้องไม่ยอมแลก: การระงับต้องเป็นการกระทำของคน ไม่ใช่แฟล็กที่ระบบตั้งเองเงียบ ๆ
--   ระบบทำสองอย่างเท่านั้น:
--     1) "ชี้ตัว" — บอกว่าใครเข้าเกณฑ์ควรถูกพิจารณา พร้อมกางหลักฐานว่ามาจากทีมไหน คะแนนเท่าไร
--     2) "บังคับใช้" — เมื่อคนตัดสินใจแล้ว รายนั้นรับงานใหม่ไม่ได้จริง ๆ ทุกทาง
--   ระบบไม่ทำ: ตั้งสถานะระงับให้เองตามคะแนน เพราะคะแนนต่ำอาจมาจากงานที่ยากผิดปกติ
--   จากลูกค้าที่มีปัญหา หรือจากข้อมูลที่ยังน้อยเกินไป — คนที่รู้บริบทต้องเป็นคนตัดสิน
--   และต้องเซ็นชื่อกำกับ เพราะการตัดคนออกจากงานคือการตัดรายได้ของครอบครัวหนึ่ง
--
-- ที่ตั้งของ "สถานะระงับ" คือ suppliers.approval_status = 'suspended' พร้อมคอลัมน์หลักฐาน
-- ซึ่ง 20260902220000 เพิ่มไว้แล้วพร้อม check constraint suppliers_suspended_needs_record
-- ที่บังคับว่าสถานะนี้จะมีอยู่ไม่ได้ถ้าขาดผู้อนุมัติหรือเหตุผล — ต่อให้เขียนตรงด้วย service_role
--
-- วันนี้: suppliers 0 แถว, tech_team_eval_scores 0 แถว, tech_teams.provider_id ว่างทั้งสองทีม
-- ทุกอย่างในไฟล์นี้จึงทำงานถูกต้องแบบไม่มีผลกับใคร และจะเริ่มมีผลทันทีที่มีข้อมูลจริง

begin;

-- ---------------------------------------------------------------------------
-- 1) นโยบาย — ตัวเลขเดียวที่ทั้งหน้าจอและฝั่งเซิร์ฟเวอร์อ้างถึง
-- ---------------------------------------------------------------------------
create or replace function public.provider_suspension_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'scoreThreshold', 60,
    'scoreScale', '0-100 ตามคะแนนรวมของ tech_team_eval_scores.eval_score',
    'minJobs', 3,
    'requiresSettledScore', true,
    'note', 'คะแนนที่ยังไม่นิ่ง (is_provisional) ไม่ถูกใช้ตัดสินระงับ เพราะงานยังน้อยเกินกว่าจะแยกฝีมือออกจากโชค'
  );
$function$;

comment on function public.provider_suspension_policy() is
  'เกณฑ์การพิจารณาระงับผู้ให้บริการ — คะแนนต่ำกว่า 60 จาก 100 และต้องเป็นคะแนนที่นิ่งแล้วเท่านั้น '
  'ตัวเลขนี้เป็นเกณฑ์ "ชี้ตัวเพื่อพิจารณา" ไม่ใช่คำสั่งระงับอัตโนมัติ';

revoke all on function public.provider_suspension_policy() from public, anon, authenticated;
grant execute on function public.provider_suspension_policy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) ประวัติการระงับ/คืนสิทธิ์ — เขียนแล้วไม่ลบ ไม่แก้
-- ---------------------------------------------------------------------------
create table if not exists public.provider_suspension_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.suppliers(id) on delete restrict,
  action text not null,
  reason text not null,
  score_at_action numeric,
  threshold_at_action numeric,
  above_threshold boolean not null default false,
  team_evidence jsonb not null default '[]'::jsonb,
  decided_by uuid not null references public.floor_staff_profiles(id),
  decided_by_name text not null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint provider_suspension_events_action_check check (action in ('suspend','reinstate')),
  constraint provider_suspension_events_reason_not_blank check (btrim(reason) <> ''),
  constraint provider_suspension_events_decider_not_blank check (btrim(decided_by_name) <> ''),
  constraint provider_suspension_events_evidence_is_array check (jsonb_typeof(team_evidence) = 'array')
);

create index if not exists provider_suspension_events_provider_idx
  on public.provider_suspension_events(provider_id, decided_at desc);

comment on table public.provider_suspension_events is
  'ประวัติทุกครั้งที่มีคนระงับหรือคืนสิทธิ์ผู้ให้บริการ พร้อมเหตุผล คะแนน ณ เวลานั้น และชื่อผู้ตัดสิน '
  'เขียนอย่างเดียว ไม่มี grant ให้ใครแก้หรือลบ — เป็นหลักฐานว่าการตัดสินใจนี้มีคนรับผิดชอบ';
comment on column public.provider_suspension_events.above_threshold is
  'true = ตอนที่ระงับ คะแนนยังไม่ต่ำกว่าเกณฑ์ (หรือยังไม่มีคะแนน) แต่คนตัดสินใจระงับด้วยเหตุผลอื่น '
  'เก็บไว้เพื่อให้แยกออกว่ากรณีไหนตามเกณฑ์ กรณีไหนเป็นดุลพินิจ';
comment on column public.provider_suspension_events.team_evidence is
  'คะแนนรายทีมที่ใช้ประกอบการตัดสินใจ ณ เวลานั้น — คัดลอกไว้เพราะคะแนนจะถูกคำนวณใหม่เรื่อย ๆ';

alter table public.provider_suspension_events enable row level security;
revoke all on public.provider_suspension_events from anon, authenticated;
grant select on public.provider_suspension_events to authenticated;

drop policy if exists provider_suspension_events_active_staff_read on public.provider_suspension_events;
create policy provider_suspension_events_active_staff_read on public.provider_suspension_events
  for select to authenticated using ((select public.is_floor_staff_active()));

-- ---------------------------------------------------------------------------
-- 3) ชี้ตัว — ใครเข้าเกณฑ์ควรถูกพิจารณา และหลักฐานคืออะไร
--    คะแนนของบริษัท = ค่าเฉลี่ยถ่วงด้วยจำนวนงานของทีมที่สังกัดบริษัทนั้น
--    นับเฉพาะทีมที่มีคะแนน "นิ่งแล้ว" — ทีมใหม่ที่ยังไม่รู้จักไม่ควรลากบริษัทลงเหว
-- ---------------------------------------------------------------------------
create or replace function public.provider_score_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_threshold numeric := (public.provider_suspension_policy()->>'scoreThreshold')::numeric;
  v_rows jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูคะแนนผู้ให้บริการได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."providerName"), '[]'::jsonb) into v_rows
  from (
    select s.id as "providerId",
           s.name as "providerName",
           s.provider_kind as "providerKind",
           s.approval_status as "approvalStatus",
           t.settled_jobs as "settledJobs",
           t.settled_teams as "settledTeams",
           t.total_teams as "totalTeams",
           t.score as "providerScore",
           case
             when t.score is null then false
             else t.score < v_threshold
           end as "belowThreshold",
           case
             when t.total_teams = 0 then 'ยังไม่มีทีมช่างสังกัดบริษัทนี้'
             when t.settled_teams = 0 then 'มีทีมสังกัดอยู่ แต่ยังไม่มีทีมไหนที่คะแนนนิ่งพอจะใช้ตัดสิน'
             when t.score < v_threshold then format('คะแนน %s ต่ำกว่าเกณฑ์ %s', round(t.score, 1), v_threshold)
             else format('คะแนน %s ยังไม่ต่ำกว่าเกณฑ์ %s', round(t.score, 1), v_threshold)
           end as "reason",
           t.teams
    from public.suppliers s
    cross join lateral (
      select
        count(*)::int as total_teams,
        count(*) filter (where e.has_data and not e.is_provisional and e.eval_score is not null)::int as settled_teams,
        coalesce(sum(e.job_count) filter (where e.has_data and not e.is_provisional and e.eval_score is not null), 0)::int as settled_jobs,
        case
          when coalesce(sum(e.job_count) filter (where e.has_data and not e.is_provisional and e.eval_score is not null), 0) = 0
            then null
          else sum(e.eval_score * e.job_count) filter (where e.has_data and not e.is_provisional and e.eval_score is not null)
               / sum(e.job_count) filter (where e.has_data and not e.is_provisional and e.eval_score is not null)
        end as score,
        coalesce(jsonb_agg(jsonb_build_object(
          'teamId', tt.id, 'teamName', tt.name,
          'evalScore', e.eval_score, 'evalAvg', e.eval_avg, 'jobCount', coalesce(e.job_count, 0),
          'isProvisional', coalesce(e.is_provisional, true), 'hasData', coalesce(e.has_data, false),
          'computedAt', e.computed_at
        ) order by tt.name) filter (where tt.id is not null), '[]'::jsonb) as teams
      from public.tech_teams tt
      left join public.tech_team_eval_scores e on e.team_id = tt.id
      where tt.provider_id = s.id
    ) t
    where coalesce(s.provider_kind,'') in ('labor','both')
  ) x;

  return jsonb_build_object(
    'policy', public.provider_suspension_policy(),
    'providers', v_rows,
    'candidateCount', (
      select count(*) from jsonb_array_elements(v_rows) as e(value)
      where (e.value->>'belowThreshold')::boolean and e.value->>'approvalStatus' = 'approved'
    )::int
  );
end;
$function$;

comment on function public.provider_score_board() is
  'คะแนนของผู้ให้บริการงานติดตั้งแต่ละราย = ค่าเฉลี่ยถ่วงจำนวนงานของทีมที่สังกัด นับเฉพาะทีมที่คะแนนนิ่งแล้ว '
  'พร้อมรายทีมเป็นหลักฐาน และธงว่าใครต่ำกว่าเกณฑ์ — เป็นการ "ชี้ตัวให้คนพิจารณา" ไม่ใช่การสั่งระงับ';

revoke all on function public.provider_score_board() from public, anon;
grant execute on function public.provider_score_board() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) ระงับ / คืนสิทธิ์ — การกระทำของคนที่มีชื่อกำกับ
-- ---------------------------------------------------------------------------
create or replace function public.suspend_provider(
  p_provider_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_provider public.suppliers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  v_threshold numeric := (public.provider_suspension_policy()->>'scoreThreshold')::numeric;
  v_score numeric;
  v_evidence jsonb := '[]'::jsonb;
  v_jobs int;
begin
  v_actor := public.provider_registry_guard(array['admin'], 'ระงับผู้ให้บริการ');

  if v_reason is null then
    raise exception 'การระงับผู้ให้บริการต้องระบุเหตุผล — นี่คือการตัดงานของคนกลุ่มหนึ่ง ต้องอธิบายได้ว่าเพราะอะไร';
  end if;
  if length(v_reason) < 10 then
    raise exception 'เหตุผลสั้นเกินไป กรุณาอธิบายให้คนที่มาอ่านทีหลังเข้าใจได้ว่าเกิดอะไรขึ้น';
  end if;

  select * into v_provider from public.suppliers where id = p_provider_id for update;
  if v_provider.id is null then raise exception 'ไม่พบผู้ให้บริการที่เลือก'; end if;
  if v_provider.approval_status = 'suspended' then
    raise exception 'ผู้ให้บริการ "%" ถูกระงับอยู่แล้วตั้งแต่ %', v_provider.name,
      to_char(v_provider.suspended_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY');
  end if;
  if v_provider.approval_status <> 'approved' then
    raise exception 'ผู้ให้บริการ "%" ยังไม่ได้อยู่ในสถานะอนุมัติ (สถานะ: %) จึงไม่มีสิทธิ์อะไรให้ระงับ — ถ้าไม่ต้องการใช้งานให้ใช้ "ไม่อนุมัติ" แทน',
      v_provider.name, v_provider.approval_status;
  end if;

  -- คะแนน ณ เวลาที่ตัดสินใจ — คัดลอกเก็บไว้เป็นหลักฐาน เพราะคะแนนจะถูกคำนวณใหม่เรื่อย ๆ
  select
    case when coalesce(sum(e.job_count),0) = 0 then null
         else sum(e.eval_score * e.job_count) / sum(e.job_count) end,
    coalesce(sum(e.job_count), 0)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'teamId', tt.id, 'teamName', tt.name, 'evalScore', e.eval_score,
      'jobCount', e.job_count, 'computedAt', e.computed_at)), '[]'::jsonb)
  into v_score, v_jobs, v_evidence
  from public.tech_teams tt
  join public.tech_team_eval_scores e on e.team_id = tt.id
  where tt.provider_id = p_provider_id
    and e.has_data and not e.is_provisional and e.eval_score is not null;

  update public.suppliers set
    approval_status = 'suspended',
    suspended_at = now(),
    suspension_reason = v_reason,
    suspended_by = v_actor.id,
    suspended_by_name = v_actor.full_name,
    suspended_score = v_score,
    suspended_threshold = v_threshold,
    reinstated_at = null,
    updated_at = now()
  where id = p_provider_id;

  insert into public.provider_suspension_events(
    provider_id, action, reason, score_at_action, threshold_at_action, above_threshold,
    team_evidence, decided_by, decided_by_name
  ) values (
    p_provider_id, 'suspend', v_reason, v_score, v_threshold,
    (v_score is null or v_score >= v_threshold),
    coalesce(v_evidence, '[]'::jsonb), v_actor.id, v_actor.full_name
  );

  return jsonb_build_object(
    'providerId', p_provider_id,
    'providerName', v_provider.name,
    'score', v_score,
    'threshold', v_threshold,
    'settledJobs', v_jobs,
    'aboveThreshold', (v_score is null or v_score >= v_threshold),
    'decidedByName', v_actor.full_name,
    'decidedAt', now()
  );
end;
$function$;

comment on function public.suspend_provider(uuid, text) is
  'ระงับผู้ให้บริการจากการรับงานใหม่ (role admin เท่านั้น) — บังคับเหตุผลอย่างน้อย 10 ตัวอักษร '
  'บันทึกคะแนน เกณฑ์ หลักฐานรายทีม และชื่อผู้ตัดสินไว้ทั้งบนทะเบียนและในประวัติ '
  'ระงับผู้ที่คะแนนยังไม่ต่ำกว่าเกณฑ์ได้ แต่จะถูกทำเครื่องหมายว่าเป็นดุลพินิจ (above_threshold)';

create or replace function public.reinstate_provider(
  p_provider_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_provider public.suppliers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  v_actor := public.provider_registry_guard(array['admin'], 'คืนสิทธิ์ผู้ให้บริการ');

  if v_reason is null or length(v_reason) < 10 then
    raise exception 'การคืนสิทธิ์ต้องระบุเหตุผลว่าปัญหาที่ทำให้ถูกระงับได้รับการแก้ไขอย่างไร';
  end if;

  select * into v_provider from public.suppliers where id = p_provider_id for update;
  if v_provider.id is null then raise exception 'ไม่พบผู้ให้บริการที่เลือก'; end if;
  if v_provider.approval_status <> 'suspended' then
    raise exception 'ผู้ให้บริการ "%" ไม่ได้ถูกระงับอยู่ (สถานะ: %)', v_provider.name, v_provider.approval_status;
  end if;

  update public.suppliers set
    approval_status = 'approved',
    suspended_at = null,
    suspension_reason = null,
    suspended_by = null,
    suspended_by_name = null,
    suspended_score = null,
    suspended_threshold = null,
    reinstated_at = now(),
    updated_at = now()
  where id = p_provider_id;

  insert into public.provider_suspension_events(
    provider_id, action, reason, score_at_action, threshold_at_action, above_threshold,
    team_evidence, decided_by, decided_by_name
  ) values (
    p_provider_id, 'reinstate', v_reason, v_provider.suspended_score, v_provider.suspended_threshold,
    false, '[]'::jsonb, v_actor.id, v_actor.full_name
  );

  return jsonb_build_object('providerId', p_provider_id, 'providerName', v_provider.name,
    'status', 'approved', 'decidedByName', v_actor.full_name, 'decidedAt', now());
end;
$function$;

comment on function public.reinstate_provider(uuid, text) is
  'คืนสิทธิ์ผู้ให้บริการที่ถูกระงับ (role admin) — ต้องอธิบายว่าปัญหาถูกแก้อย่างไร และบันทึกลงประวัติเช่นเดียวกัน';

revoke all on function public.suspend_provider(uuid, text) from public, anon;
grant execute on function public.suspend_provider(uuid, text) to authenticated, service_role;
revoke all on function public.reinstate_provider(uuid, text) from public, anon;
grant execute on function public.reinstate_provider(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) บังคับใช้จริง — มอบงานใหม่ให้ทีมของบริษัทที่ถูกระงับไม่ได้
--
--    ทำไมเป็น trigger บนตาราง ไม่ใช่การเช็คในหน้าจอ: การมอบงานเกิดได้จากหลายทาง
--    (หน้าปฏิทิน, หน้าคิวทีมช่าง, การนำเข้าจากระบบอื่น) ถ้าเช็คในหน้าจอ จะมีทางที่ลืมเช็คเสมอ
--
--    ขอบเขตที่แคบโดยตั้งใจ: ยิงเฉพาะตอน "ผูกทีมเข้ากับนัด" เท่านั้น
--    (insert ที่มี tech_id หรือ update ที่เปลี่ยน tech_id)
--    นัดที่มอบไปแล้วก่อนถูกระงับยังปิดงาน เลื่อนเวลา หรือยกเลิกได้ตามปกติ — การระงับคือ
--    "ห้ามรับงานใหม่" ไม่ใช่ "ลบงานที่ค้างอยู่ทิ้ง" ซึ่งจะทิ้งลูกค้าที่นัดไว้แล้วกลางทาง
-- ---------------------------------------------------------------------------
create or replace function public.appointments_provider_suspension_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v record;
begin
  select tt.name as team_name, s.name as provider_name, s.approval_status,
         s.suspended_at, s.suspended_by_name, s.suspension_reason
    into v
  from public.tech_teams tt
  join public.suppliers s on s.id = tt.provider_id
  where tt.id = new.tech_id;

  if found and v.approval_status = 'suspended' then
    raise exception 'ทีม "%" สังกัดบริษัท "%" ซึ่งถูกระงับการรับงานใหม่ตั้งแต่ % โดย % (เหตุผล: %) จึงมอบงานใหม่ให้ไม่ได้ — ถ้าจะมอบงานต้องคืนสิทธิ์บริษัทนี้ก่อน',
      v.team_name, v.provider_name,
      to_char(v.suspended_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY'),
      coalesce(v.suspended_by_name, 'ไม่ระบุ'),
      coalesce(v.suspension_reason, 'ไม่ระบุ');
  end if;

  return new;
end;
$function$;

comment on function public.appointments_provider_suspension_guard() is
  'ด่านระดับตาราง: มอบนัดใหม่ให้ทีมที่สังกัดบริษัทซึ่งถูกระงับไม่ได้ ไม่ว่าจะเขียนมาจากหน้าจอไหน '
  'ยิงเฉพาะตอนผูกทีมเข้ากับนัด — นัดเดิมยังปิด เลื่อน หรือยกเลิกได้ตามปกติ';

drop trigger if exists appointments_provider_suspension_guard_ins on public.appointments;
create trigger appointments_provider_suspension_guard_ins
  before insert on public.appointments
  for each row
  when (new.tech_id is not null)
  execute function public.appointments_provider_suspension_guard();

drop trigger if exists appointments_provider_suspension_guard_upd on public.appointments;
create trigger appointments_provider_suspension_guard_upd
  before update on public.appointments
  for each row
  when (new.tech_id is not null and new.tech_id is distinct from old.tech_id)
  execute function public.appointments_provider_suspension_guard();

revoke all on function public.appointments_provider_suspension_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) ประวัติสำหรับหน้าจอ
-- ---------------------------------------------------------------------------
create or replace function public.provider_suspension_history(p_provider_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูประวัติการระงับได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(e)::jsonb order by e."decidedAt" desc), '[]'::jsonb) into v_rows
  from (
    select ev.id, ev.provider_id as "providerId", s.name as "providerName", ev.action, ev.reason,
           ev.score_at_action as "scoreAtAction", ev.threshold_at_action as "thresholdAtAction",
           ev.above_threshold as "aboveThreshold", ev.team_evidence as "teamEvidence",
           ev.decided_by_name as "decidedByName", ev.decided_at as "decidedAt"
    from public.provider_suspension_events ev
    join public.suppliers s on s.id = ev.provider_id
    where p_provider_id is null or ev.provider_id = p_provider_id
  ) e;

  return jsonb_build_object('events', v_rows);
end;
$function$;

comment on function public.provider_suspension_history(uuid) is
  'ประวัติการระงับ/คืนสิทธิ์ทั้งหมด หรือเฉพาะรายเดียว — อ่านได้โดยพนักงานที่ยังใช้งานอยู่';

revoke all on function public.provider_suspension_history(uuid) from public, anon;
grant execute on function public.provider_suspension_history(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

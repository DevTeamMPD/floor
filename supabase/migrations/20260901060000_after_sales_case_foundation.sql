-- FloorNow P1: After-sales case foundation.
-- Additive only. Do not apply until reviewed and explicitly approved.
-- All mutations flow through audited RPCs; browser clients receive read-only access.

begin;

create sequence if not exists public.floor_after_sales_case_no_seq;

create table if not exists public.floor_after_sales_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique,
  job_no text not null references public.install_jobs(job_no) on delete restrict,
  source text not null check (source in ('csat','customer_call','technician','sales','manual')),
  category text not null check (category in ('service_request','complaint','warranty','installation_adjustment','information')),
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  status text not null default 'new' check (status in ('new','triaging','scheduled','in_progress','waiting_customer','resolved','closed','reopened')),
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  customer_impact text,
  owner_staff_id uuid references public.floor_staff_profiles(id) on delete set null,
  assigned_team text,
  due_at timestamptz not null,
  opened_by uuid not null references public.floor_staff_profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution text,
  linked_ncr_id uuid references public.ncr_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists floor_after_sales_cases_queue_idx
  on public.floor_after_sales_cases(status, due_at, priority, opened_at desc)
  where status not in ('closed');
create index if not exists floor_after_sales_cases_job_idx
  on public.floor_after_sales_cases(job_no, opened_at desc);
create index if not exists floor_after_sales_cases_owner_idx
  on public.floor_after_sales_cases(owner_staff_id, status, due_at)
  where status not in ('closed');
create index if not exists floor_after_sales_cases_linked_ncr_idx
  on public.floor_after_sales_cases(linked_ncr_id)
  where linked_ncr_id is not null;

create table if not exists public.floor_after_sales_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.floor_after_sales_cases(id) on delete cascade,
  event_type text not null check (event_type in ('created','status_changed','owner_changed','action_added','action_completed','ncr_linked','note_added','reopened')),
  from_status text,
  to_status text,
  actor_id uuid references public.floor_staff_profiles(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists floor_after_sales_events_case_time_idx
  on public.floor_after_sales_events(case_id, occurred_at desc);

create table if not exists public.floor_after_sales_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.floor_after_sales_cases(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text,
  acceptance_criteria text,
  owner_staff_id uuid references public.floor_staff_profiles(id) on delete set null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  outcome text,
  completed_at timestamptz,
  completed_by uuid references public.floor_staff_profiles(id) on delete set null,
  created_by uuid not null references public.floor_staff_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists floor_after_sales_actions_case_idx
  on public.floor_after_sales_actions(case_id, status, due_at);
create index if not exists floor_after_sales_actions_owner_idx
  on public.floor_after_sales_actions(owner_staff_id, status, due_at)
  where status in ('open','in_progress');

alter table public.floor_after_sales_cases enable row level security;
alter table public.floor_after_sales_events enable row level security;
alter table public.floor_after_sales_actions enable row level security;

revoke all on public.floor_after_sales_cases from anon, authenticated;
revoke all on public.floor_after_sales_events from anon, authenticated;
revoke all on public.floor_after_sales_actions from anon, authenticated;
grant select on public.floor_after_sales_cases, public.floor_after_sales_events, public.floor_after_sales_actions to authenticated;

drop policy if exists floor_after_sales_cases_active_staff_read on public.floor_after_sales_cases;
create policy floor_after_sales_cases_active_staff_read on public.floor_after_sales_cases
  for select to authenticated using ((select public.is_floor_staff_active()));
drop policy if exists floor_after_sales_events_active_staff_read on public.floor_after_sales_events;
create policy floor_after_sales_events_active_staff_read on public.floor_after_sales_events
  for select to authenticated using ((select public.is_floor_staff_active()));
drop policy if exists floor_after_sales_actions_active_staff_read on public.floor_after_sales_actions;
create policy floor_after_sales_actions_active_staff_read on public.floor_after_sales_actions
  for select to authenticated using ((select public.is_floor_staff_active()));

create or replace function public.create_floor_after_sales_case(
  p_job_no text,
  p_source text,
  p_category text,
  p_priority text,
  p_summary text,
  p_customer_impact text default null,
  p_owner_staff_id uuid default null,
  p_assigned_team text default null,
  p_due_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_owner public.floor_staff_profiles%rowtype;
  v_case_id uuid;
  v_case_no text;
  v_due timestamptz;
begin
  select * into v_actor from public.floor_staff_profiles
    where id = (select auth.uid()) and is_active and role in ('admin','cs','head_technician');
  if v_actor.id is null then raise exception 'after-sales case permission required'; end if;
  if nullif(btrim(coalesce(p_job_no,'')), '') is null or not exists (select 1 from public.install_jobs where job_no = p_job_no) then
    raise exception 'valid job number is required';
  end if;
  if p_source not in ('csat','customer_call','technician','sales','manual') then raise exception 'invalid case source'; end if;
  if p_category not in ('service_request','complaint','warranty','installation_adjustment','information') then raise exception 'invalid case category'; end if;
  if p_priority not in ('urgent','high','normal','low') then raise exception 'invalid case priority'; end if;
  if nullif(btrim(coalesce(p_summary,'')), '') is null then raise exception 'case summary is required'; end if;
  if p_owner_staff_id is not null then
    select * into v_owner from public.floor_staff_profiles where id=p_owner_staff_id and is_active;
    if v_owner.id is null then raise exception 'case owner must be active staff'; end if;
  end if;
  v_due := coalesce(p_due_at, now() + case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '1 day' when 'normal' then interval '3 days' else interval '7 days' end);
  v_case_no := 'ASC-' || to_char(timezone('Asia/Bangkok', now()), 'YYYYMM') || '-' || lpad(nextval('public.floor_after_sales_case_no_seq')::text, 6, '0');
  insert into public.floor_after_sales_cases(case_no, job_no, source, category, priority, summary, customer_impact, owner_staff_id, assigned_team, due_at, opened_by)
  values(v_case_no, btrim(p_job_no), p_source, p_category, p_priority, left(btrim(p_summary),500), nullif(left(btrim(coalesce(p_customer_impact,'')),3000),''), coalesce(p_owner_staff_id,v_actor.id), nullif(left(btrim(coalesce(p_assigned_team,'')),100),''), v_due, v_actor.id)
  returning id into v_case_id;
  insert into public.floor_after_sales_events(case_id,event_type,to_status,actor_id,detail)
  values(v_case_id,'created','new',v_actor.id,jsonb_build_object('caseNo',v_case_no,'source',p_source,'category',p_category,'priority',p_priority,'dueAt',v_due));
  return v_case_id;
end $$;

create or replace function public.assign_floor_after_sales_case(p_case_id uuid, p_owner_staff_id uuid, p_assigned_team text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.floor_staff_profiles%rowtype; v_owner public.floor_staff_profiles%rowtype; v_case public.floor_after_sales_cases%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles where id=(select auth.uid()) and is_active and role in ('admin','cs','head_technician');
  if v_actor.id is null then raise exception 'after-sales assignment permission required'; end if;
  select * into v_case from public.floor_after_sales_cases where id=p_case_id for update;
  if v_case.id is null then raise exception 'after-sales case not found'; end if;
  select * into v_owner from public.floor_staff_profiles where id=p_owner_staff_id and is_active;
  if v_owner.id is null then raise exception 'case owner must be active staff'; end if;
  update public.floor_after_sales_cases set owner_staff_id=v_owner.id, assigned_team=nullif(left(btrim(coalesce(p_assigned_team,'')),100),''), updated_at=now() where id=v_case.id;
  insert into public.floor_after_sales_events(case_id,event_type,actor_id,detail) values(v_case.id,'owner_changed',v_actor.id,jsonb_build_object('fromOwner',v_case.owner_staff_id,'toOwner',v_owner.id,'assignedTeam',p_assigned_team));
  return true;
end $$;

create or replace function public.advance_floor_after_sales_case(p_case_id uuid, p_next_status text, p_resolution text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.floor_staff_profiles%rowtype; v_case public.floor_after_sales_cases%rowtype; v_allowed boolean;
begin
  select * into v_actor from public.floor_staff_profiles where id=(select auth.uid()) and is_active and role in ('admin','cs','head_technician');
  if v_actor.id is null then raise exception 'after-sales transition permission required'; end if;
  select * into v_case from public.floor_after_sales_cases where id=p_case_id for update;
  if v_case.id is null then raise exception 'after-sales case not found'; end if;
  v_allowed := (v_case.status='new' and p_next_status='triaging') or
               (v_case.status='triaging' and p_next_status in ('scheduled','in_progress','waiting_customer','resolved')) or
               (v_case.status='scheduled' and p_next_status in ('in_progress','waiting_customer')) or
               (v_case.status='in_progress' and p_next_status in ('waiting_customer','resolved')) or
               (v_case.status='waiting_customer' and p_next_status in ('in_progress','resolved')) or
               (v_case.status='resolved' and p_next_status in ('closed','reopened')) or
               (v_case.status='closed' and p_next_status='reopened') or
               (v_case.status='reopened' and p_next_status in ('triaging','in_progress'));
  if not v_allowed then raise exception 'invalid after-sales status transition'; end if;
  if p_next_status in ('resolved','closed') and nullif(btrim(coalesce(p_resolution,'')),'') is null then raise exception 'resolution is required'; end if;
  update public.floor_after_sales_cases set status=p_next_status, resolution=case when p_next_status in ('resolved','closed') then left(btrim(p_resolution),3000) else resolution end,
    resolved_at=case when p_next_status='resolved' then now() else resolved_at end,
    closed_at=case when p_next_status='closed' then now() else case when p_next_status='reopened' then null else closed_at end end,
    updated_at=now() where id=v_case.id;
  insert into public.floor_after_sales_events(case_id,event_type,from_status,to_status,actor_id,detail)
  values(v_case.id,case when p_next_status='reopened' then 'reopened' else 'status_changed' end,v_case.status,p_next_status,v_actor.id,jsonb_build_object('resolution',nullif(btrim(coalesce(p_resolution,'')),'')));
  return true;
end $$;

create or replace function public.add_floor_after_sales_action(p_case_id uuid, p_title text, p_description text default null, p_acceptance_criteria text default null, p_owner_staff_id uuid default null, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.floor_staff_profiles%rowtype; v_case public.floor_after_sales_cases%rowtype; v_owner public.floor_staff_profiles%rowtype; v_action_id uuid;
begin
  select * into v_actor from public.floor_staff_profiles where id=(select auth.uid()) and is_active and role in ('admin','cs','head_technician');
  if v_actor.id is null then raise exception 'after-sales action permission required'; end if;
  select * into v_case from public.floor_after_sales_cases where id=p_case_id for update;
  if v_case.id is null or v_case.status='closed' then raise exception 'open after-sales case required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'action title is required'; end if;
  if p_owner_staff_id is not null then select * into v_owner from public.floor_staff_profiles where id=p_owner_staff_id and is_active; if v_owner.id is null then raise exception 'action owner must be active staff'; end if; end if;
  insert into public.floor_after_sales_actions(case_id,title,description,acceptance_criteria,owner_staff_id,due_at,created_by)
  values(v_case.id,left(btrim(p_title),300),nullif(left(btrim(coalesce(p_description,'')),3000),''),nullif(left(btrim(coalesce(p_acceptance_criteria,'')),3000),''),coalesce(p_owner_staff_id,v_case.owner_staff_id,v_actor.id),p_due_at,v_actor.id)
  returning id into v_action_id;
  insert into public.floor_after_sales_events(case_id,event_type,actor_id,detail) values(v_case.id,'action_added',v_actor.id,jsonb_build_object('actionId',v_action_id));
  return v_action_id;
end $$;

create or replace function public.complete_floor_after_sales_action(p_action_id uuid, p_outcome text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.floor_staff_profiles%rowtype; v_action public.floor_after_sales_actions%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles where id=(select auth.uid()) and is_active and role in ('admin','cs','head_technician');
  if v_actor.id is null then raise exception 'after-sales action permission required'; end if;
  select * into v_action from public.floor_after_sales_actions where id=p_action_id for update;
  if v_action.id is null or v_action.status in ('completed','cancelled') then raise exception 'open after-sales action required'; end if;
  if nullif(btrim(coalesce(p_outcome,'')),'') is null then raise exception 'action outcome is required'; end if;
  update public.floor_after_sales_actions set status='completed',outcome=left(btrim(p_outcome),3000),completed_at=now(),completed_by=v_actor.id,updated_at=now() where id=v_action.id;
  insert into public.floor_after_sales_events(case_id,event_type,actor_id,detail) values(v_action.case_id,'action_completed',v_actor.id,jsonb_build_object('actionId',v_action.id));
  return true;
end $$;

revoke all on function public.create_floor_after_sales_case(text,text,text,text,text,text,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.assign_floor_after_sales_case(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.advance_floor_after_sales_case(uuid,text,text) from public,anon,authenticated;
revoke all on function public.add_floor_after_sales_action(uuid,text,text,text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_floor_after_sales_action(uuid,text) from public,anon,authenticated;
grant execute on function public.create_floor_after_sales_case(text,text,text,text,text,text,uuid,text,timestamptz) to authenticated;
grant execute on function public.assign_floor_after_sales_case(uuid,uuid,text) to authenticated;
grant execute on function public.advance_floor_after_sales_case(uuid,text,text) to authenticated;
grant execute on function public.add_floor_after_sales_action(uuid,text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.complete_floor_after_sales_action(uuid,text) to authenticated;

commit;

-- FloorNow P4: CSAT low-score after-sales automation.
-- Additive migration. The customer workflow stays fail-safe: the evaluation trigger only enqueues work.

begin;

alter table public.floor_after_sales_cases
  add column if not exists source_evaluation_id uuid references public.job_evaluations(id) on delete set null;

create unique index if not exists floor_after_sales_cases_source_evaluation_uidx
  on public.floor_after_sales_cases(source_evaluation_id)
  where source_evaluation_id is not null;

create table if not exists public.floor_csat_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.job_evaluations(id) on delete cascade,
  job_no text not null references public.install_jobs(job_no) on delete cascade,
  idempotency_key text not null unique,
  requested_by uuid references public.floor_staff_profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','processing','retrying','succeeded','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  result_case_id uuid references public.floor_after_sales_cases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists floor_csat_automation_jobs_claim_idx
  on public.floor_csat_automation_jobs(next_attempt_at, created_at)
  where status in ('pending','retrying');
create index if not exists floor_csat_automation_jobs_job_idx
  on public.floor_csat_automation_jobs(job_no, created_at desc);

alter table public.floor_csat_automation_jobs enable row level security;
revoke all on public.floor_csat_automation_jobs from anon, authenticated;
grant select on public.floor_csat_automation_jobs to authenticated;
drop policy if exists floor_csat_automation_jobs_active_staff_read on public.floor_csat_automation_jobs;
create policy floor_csat_automation_jobs_active_staff_read on public.floor_csat_automation_jobs
  for select to authenticated using ((select public.is_floor_staff_active()));

create or replace function public.enqueue_floor_csat_automation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- CSAT/document tracking must never make the user's evaluation save fail.
  begin
    if new.satisfaction_score is null then return new; end if;

    update public.floor_csat_followups
      set completed_at=now(), evaluation_id=new.id, updated_at=now()
      where job_no=new.job_no;

    perform public.enqueue_floor_document_job(
      new.job_no,'csat','05-closing','quality_record','csat_completed',
      new.id::text,coalesce(new.updated_at,new.created_at,now())
    );

    if new.satisfaction_score <= 2 then
      insert into public.floor_csat_automation_jobs(
        evaluation_id,job_no,idempotency_key,requested_by,status,next_attempt_at,updated_at
      ) values (
        new.id,new.job_no,'csat-after-sales:' || new.id::text,(select auth.uid()),'pending',now(),now()
      )
      on conflict(idempotency_key) do update set
        job_no=excluded.job_no,
        requested_by=coalesce(public.floor_csat_automation_jobs.requested_by,excluded.requested_by),
        status=case
          when public.floor_csat_automation_jobs.status in ('succeeded','processing') then public.floor_csat_automation_jobs.status
          else 'pending'
        end,
        next_attempt_at=case
          when public.floor_csat_automation_jobs.status in ('succeeded','processing') then public.floor_csat_automation_jobs.next_attempt_at
          else now()
        end,
        attempt_count=case when public.floor_csat_automation_jobs.status in ('succeeded','processing') then public.floor_csat_automation_jobs.attempt_count else 0 end,
        completed_at=case when public.floor_csat_automation_jobs.status='succeeded' then public.floor_csat_automation_jobs.completed_at else null end,
        last_error=case when public.floor_csat_automation_jobs.status='succeeded' then public.floor_csat_automation_jobs.last_error else null end,
        updated_at=now();
    else
      update public.floor_csat_automation_jobs
        set status='skipped',last_error=null,completed_at=now(),updated_at=now()
        where evaluation_id=new.id and status in ('pending','retrying','failed');
    end if;
  exception when others then
    raise warning 'CSAT automation enqueue skipped for evaluation %: %',new.id,sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.enqueue_floor_csat_automation() from public,anon,authenticated;
drop trigger if exists trg_floor_docgen_csat on public.job_evaluations;
drop trigger if exists trg_floor_csat_automation on public.job_evaluations;
create trigger trg_floor_csat_automation
  after insert or update of satisfaction_score,answers,issues_text,needs_followup
  on public.job_evaluations for each row execute function public.enqueue_floor_csat_automation();

create or replace function public.create_floor_after_sales_case_from_csat(
  p_evaluation_id uuid,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_eval public.job_evaluations%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_case_id uuid;
  v_case_no text;
  v_priority text;
  v_due timestamptz;
begin
  select * into v_eval from public.job_evaluations where id=p_evaluation_id;
  if v_eval.id is null then raise exception 'CSAT evaluation not found'; end if;
  if v_eval.satisfaction_score is null or v_eval.satisfaction_score > 2 then
    raise exception 'CSAT score does not require an automatic case';
  end if;
  select * into v_actor from public.floor_staff_profiles where id=p_actor_id and is_active;
  if v_actor.id is null then raise exception 'active CSAT case owner required'; end if;
  select id into v_case_id from public.floor_after_sales_cases where source_evaluation_id=v_eval.id;
  if v_case_id is not null then return v_case_id; end if;

  v_priority := case when v_eval.satisfaction_score=1 then 'urgent' else 'high' end;
  v_due := now() + case when v_eval.satisfaction_score=1 then interval '4 hours' else interval '24 hours' end;
  v_case_no := 'ASC-' || to_char(timezone('Asia/Bangkok',now()),'YYYYMM') || '-' || lpad(nextval('public.floor_after_sales_case_no_seq')::text,6,'0');

  insert into public.floor_after_sales_cases(
    case_no,job_no,source,category,priority,status,summary,customer_impact,
    owner_staff_id,assigned_team,due_at,opened_by,source_evaluation_id
  ) values (
    v_case_no,v_eval.job_no,'csat','complaint',v_priority,'new',
    'เปิดอัตโนมัติจาก CSAT ' || v_eval.satisfaction_score::text || '/5',
    coalesce(nullif(left(btrim(coalesce(v_eval.issues_text,'')),3000),''),'ลูกค้าให้คะแนนความพึงพอใจต่ำและต้องได้รับการติดตาม'),
    v_actor.id,'CS / After-sales',v_due,v_actor.id,v_eval.id
  ) returning id into v_case_id;
  insert into public.floor_after_sales_events(case_id,event_type,to_status,actor_id,detail)
  values(v_case_id,'created','new',v_actor.id,jsonb_build_object(
    'automated',true,'source','csat','evaluationId',v_eval.id,
    'score',v_eval.satisfaction_score,'policy','score_lte_2'
  ));
  return v_case_id;
exception when unique_violation then
  select id into v_case_id from public.floor_after_sales_cases where source_evaluation_id=p_evaluation_id;
  if v_case_id is not null then return v_case_id; end if;
  raise;
end $$;

revoke all on function public.create_floor_after_sales_case_from_csat(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_floor_after_sales_case_from_csat(uuid,uuid) to service_role;

-- Backfill the call queue for signed jobs that existed before the original P2.5 trigger.
insert into public.floor_csat_followups(job_no,work_order_id,customer_signed_at,due_at,completed_at,evaluation_id)
select distinct on (w.job_no)
  w.job_no,w.id,e.occurred_at,e.occurred_at + interval '3 days',
  case when j.id is not null then coalesce(j.updated_at,j.created_at,now()) end,j.id
from public.floor_work_orders w
join public.floor_work_order_events e on e.work_order_id=w.id and e.event_type='customer_signed'
left join lateral (
  select id,created_at,updated_at from public.job_evaluations
  where job_no=w.job_no and satisfaction_score is not null
  order by coalesce(updated_at,created_at) desc nulls last limit 1
) j on true
order by w.job_no,e.occurred_at desc
on conflict(job_no) do nothing;

-- Existing low-score evaluations are queued once, without opening duplicate cases.
insert into public.floor_csat_automation_jobs(evaluation_id,job_no,idempotency_key,status,next_attempt_at)
select j.id,j.job_no,'csat-after-sales:' || j.id::text,'pending',now()
from public.job_evaluations j
where j.satisfaction_score <= 2
on conflict(idempotency_key) do nothing;

commit;

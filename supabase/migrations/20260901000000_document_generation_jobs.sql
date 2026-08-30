-- =====================================================================
-- PROPOSAL ONLY — DO NOT APPLY WITHOUT BUSINESS + TECH APPROVAL
-- FloorNow · Auto document generation: outbox queue + register extensions
-- Depends on: 20260830020000_floor_job_documents.sql (register already live)
--             20260823190000_operational_flow_v2.sql (floor_work_order_events)
--             20260823170000_staff_auth_and_roles.sql (floor_work_progress_events)
-- Design: transactional OUTBOX. P2.2 establishes its durable queue and
--         register extension only. P2.3 adds the event trigger in the same
--         transaction as the status change; generation itself stays async.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) OUTBOX QUEUE
-- ---------------------------------------------------------------------
create table if not exists public.floor_document_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null references public.install_jobs(job_no) on delete cascade,
  document_type text not null,
  workflow_stage text not null
    check (workflow_stage in ('01-sales','02-planning','03-warehouse','04-installation','05-closing')),
  document_class text not null default 'quality_record'
    check (document_class in ('controlled_document','quality_record','external_reference')),
  -- what caused the enqueue (audit / debugging)
  source_event text not null,                 -- e.g. 'head_confirmed', 'customer_signed'
  source_event_id text,                        -- event ids vary by source (work-order events use bigint)
  source_updated_at timestamptz not null default now(),
  -- idempotency: {job_no}:{document_type}:{source_updated_at}. Revision is
  -- resolved at processing time. ON CONFLICT DO NOTHING makes retries safe.
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed','retrying','skipped_unchanged')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 6 check (max_attempts >= 1),
  last_error text,
  -- authoritative source data captured for the render (filled by worker or trigger)
  source_snapshot_json jsonb,
  result_document_id uuid references public.floor_job_documents(id) on delete set null,
  requested_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists floor_docgen_idem_unique
  on public.floor_document_generation_jobs (idempotency_key);
-- worker claim index: due, non-terminal jobs oldest-first
create index if not exists floor_docgen_claim_idx
  on public.floor_document_generation_jobs (next_attempt_at)
  where status in ('pending','retrying');
create index if not exists floor_docgen_job_idx
  on public.floor_document_generation_jobs (job_no, created_at desc);

create or replace function public.floor_document_generation_jobs_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;
revoke all on function public.floor_document_generation_jobs_touch() from public, anon, authenticated;
drop trigger if exists trg_floor_docgen_touch on public.floor_document_generation_jobs;
create trigger trg_floor_docgen_touch
  before update on public.floor_document_generation_jobs
  for each row execute function public.floor_document_generation_jobs_touch();

-- RLS: read-only for active staff (dashboard "เอกสารขาด"/retry view);
-- all writes go through the SECURITY DEFINER trigger + service-role worker.
alter table public.floor_document_generation_jobs enable row level security;
revoke all on public.floor_document_generation_jobs from anon, authenticated;
grant select on public.floor_document_generation_jobs to authenticated;

create policy floor_docgen_active_staff_read
  on public.floor_document_generation_jobs for select to authenticated
  using ((select public.is_floor_staff_active()));

-- ---------------------------------------------------------------------
-- 2) DOCUMENT REGISTER EXTENSIONS (additive, nullable — no backfill needed)
-- ---------------------------------------------------------------------
alter table public.floor_job_documents
  add column if not exists is_system_generated boolean not null default false,
  add column if not exists generation_job_id uuid references public.floor_document_generation_jobs(id) on delete set null,
  add column if not exists generated_from_version integer,
  add column if not exists template_version text,
  add column if not exists source_snapshot_json jsonb,
  add column if not exists superseded_by uuid references public.floor_job_documents(id) on delete set null;
-- NOTE: approved_by, approved_at, effective_from, superseded_at, status,
--       change_summary, review_due_at, retention_until ALREADY EXIST.

-- ---------------------------------------------------------------------
-- 3) ENQUEUE HELPER (SECURITY DEFINER; called only by triggers below)
-- ---------------------------------------------------------------------
create or replace function public.enqueue_floor_document_job(
  p_job_no text,
  p_document_type text,
  p_workflow_stage text,
  p_document_class text,
  p_source_event text,
  p_source_event_id text,
  p_source_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_job_no is null then return; end if;
  insert into public.floor_document_generation_jobs
    (job_no, document_type, workflow_stage, document_class,
     source_event, source_event_id, source_updated_at, idempotency_key)
  values
    (p_job_no, p_document_type, p_workflow_stage, p_document_class,
     p_source_event, p_source_event_id, coalesce(p_source_updated_at, now()),
     p_job_no || ':' || p_document_type || ':' ||
        to_char(coalesce(p_source_updated_at, now()) at time zone 'UTC','YYYYMMDD"T"HH24MISS.US"Z"'))
  on conflict (idempotency_key) do nothing;  -- idempotent: same source state = no duplicate
end; $$;
revoke all on function public.enqueue_floor_document_job(text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) EVENT-DRIVEN ENQUEUE TRIGGERS — DEFERRED TO P2.3
-- ---------------------------------------------------------------------
-- P2.2 intentionally creates only the outbox and its data contract. P2.3
-- adds the head_confirmed trigger after its worker route is deployed. P2.4/P2.5
-- add their mappings alongside their templates. This prevents claims for
-- document types whose templates do not exist yet.
--
-- The P2.3 trigger must pass new.id::text and new.occurred_at because
-- floor_work_order_events.id is bigint and its event timestamp is occurred_at.

commit;

-- ROLLBACK (safe, additive-only):
--   drop function if exists public.enqueue_floor_document_job(text,text,text,text,text,text,timestamptz);
--   alter table public.floor_job_documents
--     drop column if exists is_system_generated, drop column if exists generation_job_id,
--     drop column if exists generated_from_version, drop column if exists template_version,
--     drop column if exists source_snapshot_json, drop column if exists superseded_by;
--   drop table if exists public.floor_document_generation_jobs;
-- Disabling generation without a migration: just stop the worker cron; rows
-- queue harmlessly and the main user flows are unaffected.

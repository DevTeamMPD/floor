-- Document registry for FloorNow work orders.
-- File bytes live in the configured document provider (SharePoint initially);
-- this table retains the auditable, searchable metadata attached to one job_no.

create table if not exists public.floor_job_document_folders (
  job_no text primary key references public.install_jobs(job_no) on delete cascade,
  provider text not null default 'sharepoint' check (provider in ('sharepoint', 'supabase')),
  provider_folder_id text,
  provider_folder_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.floor_job_documents (
  id uuid primary key default gen_random_uuid(),
  job_no text not null references public.install_jobs(job_no) on delete cascade,
  document_code text check (document_code is null or char_length(btrim(document_code)) between 1 and 80),
  document_type text not null check (char_length(btrim(document_type)) between 1 and 80),
  document_class text not null default 'quality_record' check (document_class in ('controlled_document', 'quality_record', 'external_reference')),
  workflow_stage text not null check (workflow_stage in ('01-sales', '02-planning', '03-warehouse', '04-installation', '05-closing')),
  provider text not null default 'sharepoint' check (provider in ('sharepoint', 'supabase')),
  provider_item_id text,
  provider_web_url text not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'under_review', 'approved', 'superseded', 'archived')),
  change_summary text,
  retention_until date,
  review_due_at date,
  effective_from timestamptz,
  superseded_at timestamptz,
  uploaded_by uuid references public.floor_staff_profiles(id) on delete set null,
  approved_by uuid references public.floor_staff_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint floor_job_documents_approval_complete check (
    (status <> 'approved') or (approved_by is not null and approved_at is not null and effective_from is not null)
  )
);

create table if not exists public.floor_job_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.floor_job_documents(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'uploaded', 'submitted_for_review', 'approved', 'superseded', 'archived', 'opened')),
  actor_id uuid references public.floor_staff_profiles(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists floor_job_documents_job_created_idx
  on public.floor_job_documents(job_no, created_at desc);
create index if not exists floor_job_documents_job_stage_idx
  on public.floor_job_documents(job_no, workflow_stage, status);
create index if not exists floor_job_documents_review_due_idx
  on public.floor_job_documents(review_due_at) where status in ('draft', 'under_review', 'approved');
create unique index if not exists floor_job_documents_current_version_unique
  on public.floor_job_documents(job_no, document_type, workflow_stage, version);
create index if not exists floor_job_document_events_document_created_idx
  on public.floor_job_document_events(document_id, created_at desc);

alter table public.floor_job_document_folders enable row level security;
alter table public.floor_job_documents enable row level security;
alter table public.floor_job_document_events enable row level security;

revoke all on public.floor_job_document_folders from anon, authenticated;
revoke all on public.floor_job_documents from anon, authenticated;
revoke all on public.floor_job_document_events from anon, authenticated;
grant select on public.floor_job_document_folders to authenticated;
grant select on public.floor_job_documents to authenticated;
grant select on public.floor_job_document_events to authenticated;

create policy floor_job_document_folders_active_staff_read
  on public.floor_job_document_folders for select to authenticated
  using ((select public.is_floor_staff_active()));

create policy floor_job_documents_active_staff_read
  on public.floor_job_documents for select to authenticated
  using ((select public.is_floor_staff_active()));

create policy floor_job_document_events_active_staff_read
  on public.floor_job_document_events for select to authenticated
  using ((select public.is_floor_staff_active()));

create or replace function public.floor_job_documents_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.floor_job_documents_set_updated_at() from public, anon, authenticated;
drop trigger if exists trg_floor_job_documents_set_updated_at on public.floor_job_documents;
create trigger trg_floor_job_documents_set_updated_at
  before update on public.floor_job_documents
  for each row execute function public.floor_job_documents_set_updated_at();

comment on table public.floor_job_documents is
  'ISO-aligned, auditable FloorNow job document registry; files are stored by provider, initially SharePoint.';
comment on table public.floor_job_document_events is
  'Immutable audit trail for significant document-control events.';
comment on column public.floor_job_documents.provider_web_url is
  'Browser-safe SharePoint or storage URL returned after the server-side upload succeeds.';

notify pgrst, 'reload schema';

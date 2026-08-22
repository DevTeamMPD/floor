-- FloorNow unified install flow.
-- Use the existing Floor-owned source/external reference columns to make
-- direct and BBPS ingestion idempotent without introducing another sync table.

create unique index if not exists install_jobs_source_external_id_uidx
  on public.install_jobs (source, external_id)
  where external_id is not null;

create unique index if not exists appointments_ext_ref_uidx
  on public.appointments (ext_ref)
  where ext_ref is not null;

comment on index public.install_jobs_source_external_id_uidx is
  'Prevents a source event (for example BBPS production id) from creating duplicate FloorNow tickets.';

comment on index public.appointments_ext_ref_uidx is
  'Prevents repeated external sync events from creating duplicate appointment blocks.';

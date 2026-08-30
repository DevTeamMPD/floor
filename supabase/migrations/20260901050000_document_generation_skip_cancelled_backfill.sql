-- Cancelled jobs have no valid controlled work order snapshot and must not retry.
begin;

update public.floor_document_generation_jobs q
set status='skipped_unchanged',
    processed_at=now(),
    last_error='cancelled work order excluded from bounded backfill',
    updated_at=now()
from public.floor_work_orders w
where w.job_no=q.job_no
  and w.status='cancelled'
  and q.status in ('pending','retrying','failed');

commit;

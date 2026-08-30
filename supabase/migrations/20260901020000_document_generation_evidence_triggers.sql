-- =====================================================================
-- PROPOSAL ONLY — DO NOT APPLY WITHOUT BUSINESS + TECH APPROVAL
-- FloorNow · P2.4 evidence-document outbox triggers
-- Depends on: 20260901000000_document_generation_jobs.sql (live)
--             P2.4 renderer + worker deployment (not yet deployed)
-- =====================================================================

begin;

create or replace function public.enqueue_evidence_floor_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_no text;
begin
  if new.event_type not in ('warehouse_completed', 'field_completed') then
    return new;
  end if;

  select wo.job_no into v_job_no
  from public.floor_work_orders wo
  where wo.id = new.work_order_id;
  if v_job_no is null then return new; end if;

  -- Each event's immutable occurred_at is the source version.  It is required
  -- for field_completed because that event does not mutate floor_work_orders.
  begin
    if new.event_type = 'warehouse_completed' then
      perform public.enqueue_floor_document_job(
        v_job_no, 'pick_confirmation', '03-warehouse', 'quality_record',
        'warehouse_completed', new.id::text, new.occurred_at
      );
    elsif new.event_type = 'field_completed' then
      perform public.enqueue_floor_document_job(
        v_job_no, 'installation_report', '04-installation', 'quality_record',
        'field_completed', new.id::text, new.occurred_at
      );
    end if;
  exception when others then
    raise warning 'Floor document outbox enqueue skipped for evidence event %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.enqueue_evidence_floor_documents() from public, anon, authenticated;

drop trigger if exists trg_floor_docgen_evidence_events on public.floor_work_order_events;
create trigger trg_floor_docgen_evidence_events
  after insert on public.floor_work_order_events
  for each row execute function public.enqueue_evidence_floor_documents();

commit;

-- ROLLBACK:
--   drop trigger if exists trg_floor_docgen_evidence_events on public.floor_work_order_events;
--   drop function if exists public.enqueue_evidence_floor_documents();

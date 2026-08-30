-- =====================================================================
-- PROPOSAL ONLY — DO NOT APPLY WITHOUT BUSINESS + TECH APPROVAL
-- FloorNow · P2.3 automatic-document outbox trigger
-- Depends on: 20260901000000_document_generation_jobs.sql (already live)
--
-- Creates draft Work Order + BOQ jobs when the head confirms a work order.
-- This does not render a file, call SharePoint, or alter any business RPC.
-- =====================================================================

begin;

create or replace function public.enqueue_head_confirmed_floor_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_no text;
  v_source_updated_at timestamptz;
begin
  if new.event_type <> 'head_confirmed' then
    return new;
  end if;

  select wo.job_no, wo.updated_at
    into v_job_no, v_source_updated_at
  from public.floor_work_orders wo
  where wo.id = new.work_order_id;

  if v_job_no is null then
    return new;
  end if;

  -- The inserts occur in the same database transaction as the event.  The
  -- exception boundary is deliberate: document generation must never block
  -- confirmation of a work order.  A later reconciliation can find an event
  -- that has no outbox row if the queue itself is unavailable.
  begin
    perform public.enqueue_floor_document_job(
      v_job_no, 'work_order', '02-planning', 'controlled_document',
      'head_confirmed', new.id::text, v_source_updated_at
    );
    perform public.enqueue_floor_document_job(
      v_job_no, 'boq', '02-planning', 'controlled_document',
      'head_confirmed', new.id::text, v_source_updated_at
    );
  exception when others then
    raise warning 'Floor document outbox enqueue skipped for work-order event %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.enqueue_head_confirmed_floor_documents() from public, anon, authenticated;

drop trigger if exists trg_floor_docgen_head_confirmed on public.floor_work_order_events;
create trigger trg_floor_docgen_head_confirmed
  after insert on public.floor_work_order_events
  for each row execute function public.enqueue_head_confirmed_floor_documents();

commit;

-- P2.4 owns `warehouse_completed` because its Pick Confirmation template is
-- not available in P2.3.  Do not enqueue a document type without a renderer.

-- ROLLBACK:
--   drop trigger if exists trg_floor_docgen_head_confirmed on public.floor_work_order_events;
--   drop function if exists public.enqueue_head_confirmed_floor_documents();

-- One-time, bounded backfill for active work orders and work orders updated in the last 30 days.
-- Uses the same idempotency helper as live triggers, so rerunning is safe.
begin;

do $$
declare r record;
begin
  for r in
    select distinct on (e.work_order_id,e.event_type)
      w.job_no,e.id,e.event_type,e.occurred_at
    from public.floor_work_order_events e
    join public.floor_work_orders w on w.id=e.work_order_id
    where e.event_type in ('head_confirmed','warehouse_completed','field_completed','customer_signed','remnants_submitted','cs_closed')
      and (w.status not in ('closed','cancelled') or (w.status='closed' and w.updated_at>=now()-interval '30 days'))
    order by e.work_order_id,e.event_type,e.occurred_at desc,e.id desc
  loop
    if r.event_type='head_confirmed' then
      perform public.enqueue_floor_document_job(r.job_no,'work_order','02-planning','controlled_document',r.event_type,r.id::text,r.occurred_at);
      perform public.enqueue_floor_document_job(r.job_no,'boq','02-planning','controlled_document',r.event_type,r.id::text,r.occurred_at);
    elsif r.event_type='warehouse_completed' then
      perform public.enqueue_floor_document_job(r.job_no,'pick_confirmation','03-warehouse','quality_record',r.event_type,r.id::text,r.occurred_at);
    elsif r.event_type='field_completed' then
      perform public.enqueue_floor_document_job(r.job_no,'installation_report','04-installation','quality_record',r.event_type,r.id::text,r.occurred_at);
    elsif r.event_type='customer_signed' then
      perform public.enqueue_floor_document_job(r.job_no,'customer_acceptance','04-installation','quality_record',r.event_type,r.id::text,r.occurred_at);
    elsif r.event_type='remnants_submitted' then
      perform public.enqueue_floor_document_job(r.job_no,'remnant_report','04-installation','quality_record',r.event_type,r.id::text,r.occurred_at);
    elsif r.event_type='cs_closed' then
      perform public.enqueue_floor_document_job(r.job_no,'handover','05-closing','quality_record',r.event_type,r.id::text,r.occurred_at);
    end if;
  end loop;

  for r in
    select distinct on (j.job_no) j.job_no,j.id,coalesce(j.updated_at,j.created_at,now()) source_at
    from public.job_evaluations j
    join public.floor_work_orders w on w.job_no=j.job_no
    where j.satisfaction_score is not null and (w.status not in ('closed','cancelled') or (w.status='closed' and w.updated_at>=now()-interval '30 days'))
    order by j.job_no,coalesce(j.updated_at,j.created_at) desc nulls last,j.id desc
  loop
    perform public.enqueue_floor_document_job(r.job_no,'csat','05-closing','quality_record','csat_completed',r.id::text,r.source_at);
  end loop;

  for r in
    select n.job_no,n.id,n.status,coalesce(n.updated_at,n.created_at,now()) source_at
    from public.ncr_reports n
    join public.floor_work_orders w on w.job_no=n.job_no
    where w.status not in ('closed','cancelled') or (w.status='closed' and w.updated_at>=now()-interval '30 days')
  loop
    perform public.enqueue_floor_document_job(r.job_no,'ncr','05-closing','controlled_document','ncr_'||r.status,r.id::text,r.source_at);
  end loop;
end $$;

commit;

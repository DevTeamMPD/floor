-- Customer-facing summary authored by Sales is stored inside the Floor-owned
-- install_jobs.survey_data JSON.  Extend the already token-gated external RPC
-- so that it returns only that explicitly selected data.
create or replace function public.get_floor_external_work_order_v3(p_token uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'jobNo',wo.job_no,
    'status',wo.status,
    'updatedAt',wo.updated_at,
    'customerName',j.customer_name,
    'productName',j.product_name,
    'appointmentStart',a.slot_start,
    'appointmentEnd',a.slot_end,
    'address',j.address,
    'locationUrl',j.location_url,
    'teamName',team.name,
    'trackingToken',(select s.customer_token from public.floor_tracking_sessions s where s.appointment_id=a.id order by s.sharing_started_at desc limit 1),
    'customerSummary',jsonb_build_object(
      'caption',coalesce(j.survey_data::jsonb #>> '{customerSummary,caption}',''),
      'photoPaths',coalesce(j.survey_data::jsonb #> '{customerSummary,photos}','[]'::jsonb),
      'updatedAt',j.survey_data::jsonb #>> '{customerSummary,updatedAt}'
    ),
    'technicians',coalesce((select jsonb_agg(jsonb_build_object(
      'name',t.name,'isLead',at.is_lead
    ) order by at.is_lead desc,t.name) from public.appointment_technicians at
      join public.floor_technicians t on t.id=at.technician_id
      where at.appointment_id=a.id and at.is_active),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(jsonb_build_object(
      'type',e.event_type,'occurredAt',e.occurred_at,
      'photoPaths',case when e.event_type in ('warehouse_completed','installation_accepted','progress','customer_signed') then e.photo_paths else '{}'::text[] end
    ) order by e.occurred_at) from public.floor_work_order_events e
      where e.work_order_id=wo.id),'[]'::jsonb)
  )
  from public.floor_work_orders wo
  join public.appointments a on a.id=wo.appointment_id
  join public.install_jobs j on j.job_no=wo.job_no
  left join public.tech_teams team on team.id=a.tech_id
  where wo.external_share_token=p_token and wo.external_share_enabled and wo.status <> 'cancelled'
  limit 1
$$;

revoke all on function public.get_floor_external_work_order_v3(uuid) from public,anon,authenticated;
grant execute on function public.get_floor_external_work_order_v3(uuid) to anon,authenticated;

-- Expose FloorNow pick_plan to technician workspaces.
-- This lets technicians see the work-order picking list in the web link and mobile app.

create or replace function public.get_technician_workspace(
  p_token uuid,
  p_pin text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with technician_row as (
    select t.*
    from public.floor_technicians t
    where t.personal_token = p_token
      and t.is_active = true
      and t.pin_hash is not null
      and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash
  )
  select jsonb_build_object(
    'technician', jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'phone', t.phone,
      'teamId', t.team_id,
      'teamName', team.name,
      'isTeamLead', t.is_team_lead
    ),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', a.id,
        'isLead', a.is_lead,
        'firstOpenedAt', a.first_opened_at,
        'lastOpenedAt', a.last_opened_at,
        'openCount', a.open_count,
        'acknowledgedAt', a.acknowledged_at,
        'appointmentId', ap.id,
        'slotStart', ap.slot_start,
        'slotEnd', ap.slot_end,
        'appointmentStatus', ap.status,
        'teamName', ap_team.name,
        'notes', ap.notes,
        'requirement', ap.requirement,
        'jobNo', j.job_no,
        'source', j.source,
        'billNo', j.bill_no,
        'customerName', j.customer_name,
        'customerPhone', j.customer_phone,
        'address', j.address,
        'locationUrl', j.location_url,
        'productName', j.product_name,
        'surveyData', j.survey_data,
        'pickPlan', j.pick_plan
      ) order by ap.slot_start)
      from public.appointment_technicians a
      join public.appointments ap on ap.id = a.appointment_id
      left join public.tech_teams ap_team on ap_team.id = ap.tech_id
      left join public.install_jobs j on j.job_no = ap.job_id
      where a.technician_id = t.id
        and a.is_active = true
        and ap.status <> 'cancelled'
    ), '[]'::jsonb)
  )
  from technician_row t
  left join public.tech_teams team on team.id = t.team_id;
$$;

create or replace function public.get_floor_mobile_workspace(p_device_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'device', jsonb_build_object(
      'id', d.id,
      'platform', d.platform,
      'backgroundPermission', d.background_permission
    ),
    'technician', jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'teamId', t.team_id,
      'teamName', team.name,
      'isTeamLead', t.is_team_lead
    ),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', a.id,
        'appointmentId', ap.id,
        'isLead', a.is_lead,
        'acknowledgedAt', a.acknowledged_at,
        'slotStart', ap.slot_start,
        'slotEnd', ap.slot_end,
        'appointmentStatus', ap.status,
        'teamName', ap_team.name,
        'notes', ap.notes,
        'requirement', ap.requirement,
        'jobNo', j.job_no,
        'source', j.source,
        'billNo', j.bill_no,
        'customerName', j.customer_name,
        'customerPhone', j.customer_phone,
        'address', j.address,
        'locationUrl', j.location_url,
        'productName', j.product_name,
        'sitePhotos', j.site_photos,
        'rawPayload', j.raw_payload,
        'pickPlan', j.pick_plan,
        'plannedSheetCount', material.planned_sheet_count,
        'pickedSheetCount', material.picked_sheet_count,
        'trackingSession', case when tracking.id is null then null else jsonb_build_object(
          'id', tracking.id,
          'status', tracking.status,
          'customerToken', tracking.customer_token,
          'sharingStartedAt', tracking.sharing_started_at,
          'latestCapturedAt', tracking.latest_captured_at
        ) end
      ) order by ap.slot_start)
      from public.appointment_technicians a
      join public.appointments ap on ap.id = a.appointment_id
      left join public.tech_teams ap_team on ap_team.id = ap.tech_id
      left join public.install_jobs j on j.job_no = ap.job_id
      left join public.floor_job_materials material on material.appointment_id = ap.id
      left join lateral (
        select s.*
        from public.floor_tracking_sessions s
        where s.appointment_id = ap.id
        order by s.created_at desc
        limit 1
      ) tracking on true
      where a.technician_id = t.id
        and a.is_active = true
        and ap.status <> 'cancelled'
        and ap.slot_end >= now() - interval '12 hours'
    ), '[]'::jsonb)
  )
  from public.floor_technician_devices d
  join public.floor_technicians t on t.id = d.technician_id
  left join public.tech_teams team on team.id = t.team_id
  where d.device_token = p_device_token
    and d.is_active = true
    and t.is_active = true;
$$;

grant execute on function public.get_technician_workspace(uuid, text) to anon, authenticated;
grant execute on function public.get_floor_mobile_workspace(uuid) to anon, authenticated;

-- FloorNow technician link + PIN authentication.
-- This removes the SMS/Auth dependency from the technician worker flow and
-- replaces it with a capability link plus a short PIN managed by the office.

create extension if not exists pgcrypto;

alter table public.floor_technicians
  add column if not exists pin_hash text,
  add column if not exists pin_updated_at timestamptz;

comment on column public.floor_technicians.pin_hash is
  'bcrypt hash of the technician PIN used with the personal link.';
comment on column public.floor_technicians.pin_updated_at is
  'Timestamp of the last PIN reset.';

create or replace function public.set_floor_technician_pin(
  p_personal_token uuid,
  p_pin text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_technician public.floor_technicians%rowtype;
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g');
begin
  if v_pin !~ '^\d{4,6}$' then
    raise exception 'invalid pin';
  end if;

  select *
  into v_technician
  from public.floor_technicians
  where personal_token = p_personal_token
    and is_active = true
  for update;

  if v_technician.id is null then
    return false;
  end if;

  update public.floor_technicians
  set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
      pin_updated_at = now(),
      updated_at = now()
  where id = v_technician.id;

  return true;
end;
$$;

create or replace function public.register_floor_technician_device(
  p_personal_token uuid,
  p_pin text,
  p_platform text,
  p_device_name text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_technician public.floor_technicians%rowtype;
  v_device public.floor_technician_devices%rowtype;
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g');
begin
  if p_platform not in ('android', 'ios') then
    raise exception 'unsupported platform';
  end if;
  if v_pin !~ '^\d{4,6}$' then
    raise exception 'invalid pin';
  end if;

  select *
  into v_technician
  from public.floor_technicians
  where personal_token = p_personal_token
    and is_active = true
  for update;

  if v_technician.id is null then
    raise exception 'invalid technician token';
  end if;
  if v_technician.pin_hash is null then
    raise exception 'pin not configured';
  end if;
  if extensions.crypt(v_pin, v_technician.pin_hash) <> v_technician.pin_hash then
    raise exception 'invalid pin';
  end if;

  insert into public.floor_technician_devices(
    technician_id, platform, device_name, app_version
  ) values (
    v_technician.id,
    p_platform,
    nullif(left(btrim(coalesce(p_device_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_app_version, '')), 40), '')
  )
  returning * into v_device;

  return jsonb_build_object(
    'deviceId', v_device.id,
    'deviceToken', v_device.device_token,
    'technicianId', v_technician.id,
    'technicianName', v_technician.name,
    'teamId', v_technician.team_id,
    'isTeamLead', v_technician.is_team_lead
  );
end;
$$;

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
        'surveyData', j.survey_data
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

create or replace function public.record_technician_work_event(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_event_type text,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_platform text;
begin
  if p_event_type not in ('opened', 'acknowledged') then
    return false;
  end if;

  select a.id, d.platform
  into v_assignment_id, v_platform
  from public.appointment_technicians a
  join public.floor_technicians t on t.id = a.technician_id
  join public.floor_technician_devices d on d.technician_id = a.technician_id
  where a.id = p_assignment_id
    and a.is_active = true
    and t.is_active = true
    and t.personal_token = p_token
    and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash;

  if v_assignment_id is null then
    return false;
  end if;

  if p_event_type = 'opened' then
    update public.appointment_technicians
    set first_opened_at = coalesce(first_opened_at, now()),
        last_opened_at = now(),
        open_count = open_count + 1
    where id = v_assignment_id;
  else
    update public.appointment_technicians
    set acknowledged_at = coalesce(acknowledged_at, now())
    where id = v_assignment_id;
  end if;

  insert into public.technician_work_events(assignment_id, event_type, user_agent)
  values (v_assignment_id, p_event_type, left(coalesce(p_user_agent, 'FloorNow Worker/' || coalesce(v_platform, 'unknown')), 500));

  return true;
end;
$$;

create or replace function public.set_floor_job_material_plan(
  p_device_token uuid,
  p_appointment_id uuid,
  p_planned_sheet_count integer,
  p_planned_by text default 'หัวหน้าช่าง'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.floor_technician_devices%rowtype;
  v_technician public.floor_technicians%rowtype;
begin
  if p_planned_sheet_count < 0 then
    return false;
  end if;

  select d.*
  into v_device
  from public.floor_technician_devices d
  where d.device_token = p_device_token
    and d.is_active = true;

  if v_device.id is null then
    return false;
  end if;

  select *
  into v_technician
  from public.floor_technicians
  where id = v_device.technician_id
    and is_active = true;

  if v_technician.id is null or not v_technician.is_team_lead then
    raise exception 'team lead permission required';
  end if;

  if not exists (
    select 1 from public.appointments ap
    where ap.id = p_appointment_id and ap.status <> 'cancelled'
  ) then
    return false;
  end if;

  insert into public.floor_job_materials(
    appointment_id, planned_sheet_count, planned_by, planned_at, updated_at
  ) values (
    p_appointment_id,
    p_planned_sheet_count,
    coalesce(nullif(left(btrim(coalesce(p_planned_by, '')), 120), ''), 'หัวหน้าช่าง'),
    now(),
    now()
  )
  on conflict (appointment_id) do update
    set planned_sheet_count = excluded.planned_sheet_count,
        planned_by = excluded.planned_by,
        planned_at = excluded.planned_at,
        updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.record_floor_mobile_assignment_event(
  p_device_token uuid,
  p_assignment_id uuid,
  p_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
begin
  if p_event_type not in ('opened', 'acknowledged') then
    return false;
  end if;

  select a.id
  into v_assignment_id
  from public.appointment_technicians a
  join public.floor_technician_devices d on d.technician_id = a.technician_id
  where a.id = p_assignment_id
    and a.is_active = true
    and d.device_token = p_device_token
    and d.is_active = true;

  if v_assignment_id is null then
    return false;
  end if;

  if p_event_type = 'opened' then
    update public.appointment_technicians
    set first_opened_at = coalesce(first_opened_at, now()),
        last_opened_at = now(),
        open_count = open_count + 1
    where id = v_assignment_id;
  else
    update public.appointment_technicians
    set acknowledged_at = coalesce(acknowledged_at, now())
    where id = v_assignment_id;
  end if;

  insert into public.technician_work_events(assignment_id, event_type, user_agent)
  values (v_assignment_id, p_event_type, 'FloorNow Worker');

  return true;
end;
$$;

create or replace function public.update_floor_device_permission(
  p_device_token uuid,
  p_permission text,
  p_app_version text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_permission not in ('unknown', 'denied', 'foreground', 'always') then
    return false;
  end if;

  update public.floor_technician_devices d
  set background_permission = p_permission,
      app_version = coalesce(nullif(left(btrim(coalesce(p_app_version, '')), 40), ''), app_version),
      last_seen_at = now()
  where d.device_token = p_device_token
    and d.is_active = true;

  return found;
end;
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

create or replace function public.start_floor_tracking(
  p_device_token uuid,
  p_assignment_id uuid,
  p_picked_sheet_count integer,
  p_destination_latitude double precision,
  p_destination_longitude double precision,
  p_photo_paths text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.floor_technician_devices%rowtype;
  v_assignment public.appointment_technicians%rowtype;
  v_appointment public.appointments%rowtype;
  v_session public.floor_tracking_sessions%rowtype;
  v_planned_sheet_count integer;
begin
  if p_picked_sheet_count is null or p_picked_sheet_count < 0 then
    raise exception 'picked sheet count is required';
  end if;
  if p_destination_latitude not between -90 and 90
     or p_destination_longitude not between -180 and 180 then
    raise exception 'invalid destination';
  end if;
  if coalesce(cardinality(p_photo_paths), 0) = 0 then
    raise exception 'status photo is required';
  end if;

  select d.* into v_device
  from public.floor_technician_devices d
  where d.device_token = p_device_token
    and d.is_active = true
    and d.background_permission = 'always';

  if v_device.id is null then
    raise exception 'device is not authorized for background location';
  end if;

  select * into v_assignment
  from public.appointment_technicians
  where id = p_assignment_id
    and technician_id = v_device.technician_id
    and is_active = true;

  if v_assignment.id is null then
    raise exception 'assignment not found';
  end if;
  if v_assignment.acknowledged_at is null then
    raise exception 'assignment must be acknowledged before travelling';
  end if;

  select * into v_appointment
  from public.appointments
  where id = v_assignment.appointment_id
    and status <> 'cancelled';

  if v_appointment.id is null then
    raise exception 'appointment not available';
  end if;

  select planned_sheet_count into v_planned_sheet_count
  from public.floor_job_materials
  where appointment_id = v_appointment.id;

  if not found then
    raise exception 'team lead material plan is required';
  end if;

  update public.floor_job_materials
  set picked_sheet_count = p_picked_sheet_count,
      picked_by_technician_id = v_device.technician_id,
      picked_at = now(),
      updated_at = now()
  where appointment_id = v_appointment.id;

  select * into v_session
  from public.floor_tracking_sessions
  where appointment_id = v_appointment.id
    and sharing_ended_at is null
  limit 1;

  if v_session.id is null then
    insert into public.floor_tracking_sessions(
      appointment_id, assignment_id, technician_id, device_id,
      destination_latitude, destination_longitude,
      customer_access_expires_at
    ) values (
      v_appointment.id, v_assignment.id, v_device.technician_id, v_device.id,
      p_destination_latitude, p_destination_longitude,
      greatest(v_appointment.slot_end + interval '12 hours', now() + interval '12 hours')
    ) returning * into v_session;
  elsif v_session.technician_id <> v_device.technician_id then
    raise exception 'another technician is already sharing this job';
  end if;

  insert into public.floor_job_status_events(
    session_id, assignment_id, technician_id, status, photo_paths
  ) values (
    v_session.id, v_assignment.id, v_device.technician_id, 'travelling', p_photo_paths
  );

  update public.floor_technician_devices
  set last_seen_at = now()
  where id = v_device.id;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'customerToken', v_session.customer_token,
    'status', v_session.status,
    'plannedSheetCount', v_planned_sheet_count
  );
end;
$$;

create or replace function public.record_floor_location_batch(
  p_device_token uuid,
  p_session_id uuid,
  p_points jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.floor_technician_devices%rowtype;
  v_session public.floor_tracking_sessions%rowtype;
  v_count integer;
  v_latest record;
begin
  if jsonb_typeof(p_points) <> 'array' then
    raise exception 'points must be an array';
  end if;
  v_count := jsonb_array_length(p_points);
  if v_count < 1 or v_count > 50 then
    raise exception 'point batch must contain 1 to 50 items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_points) point
    where jsonb_typeof(point) <> 'object'
       or nullif(point->>'latitude', '') is null
       or nullif(point->>'longitude', '') is null
       or (point->>'latitude')::double precision not between -90 and 90
       or (point->>'longitude')::double precision not between -180 and 180
       or coalesce(nullif(point->>'capturedAt', '')::timestamptz, now()) < now() - interval '24 hours'
       or coalesce(nullif(point->>'capturedAt', '')::timestamptz, now()) > now() + interval '10 minutes'
  ) then
    raise exception 'invalid or stale location point';
  end if;

  select d.* into v_device
  from public.floor_technician_devices d
  where d.device_token = p_device_token
    and d.is_active = true;

  select * into v_session
  from public.floor_tracking_sessions
  where id = p_session_id
    and device_id = v_device.id
    and technician_id = v_device.technician_id
    and sharing_ended_at is null;

  if v_session.id is null then
    raise exception 'active tracking session not found';
  end if;

  insert into public.floor_location_points(
    session_id, technician_id, device_id, latitude, longitude,
    accuracy_m, speed_mps, heading_deg, captured_at
  )
  select
    v_session.id,
    v_device.technician_id,
    v_device.id,
    (point->>'latitude')::double precision,
    (point->>'longitude')::double precision,
    nullif(point->>'accuracy', '')::double precision,
    nullif(point->>'speed', '')::double precision,
    nullif(point->>'heading', '')::double precision,
    coalesce(nullif(point->>'capturedAt', '')::timestamptz, now())
  from jsonb_array_elements(p_points) point;

  select latitude, longitude, accuracy_m, captured_at
  into v_latest
  from public.floor_location_points
  where session_id = v_session.id
  order by captured_at desc
  limit 1;

  update public.floor_tracking_sessions
  set latest_latitude = v_latest.latitude,
      latest_longitude = v_latest.longitude,
      latest_accuracy_m = v_latest.accuracy_m,
      latest_captured_at = v_latest.captured_at,
      updated_at = now()
  where id = v_session.id;

  update public.floor_technician_devices
  set last_seen_at = now()
  where id = v_device.id;

  return v_count;
end;
$$;

create or replace function public.record_floor_job_status(
  p_device_token uuid,
  p_session_id uuid,
  p_status text,
  p_photo_paths text[],
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.floor_technician_devices%rowtype;
  v_session public.floor_tracking_sessions%rowtype;
begin
  if p_status not in ('arrived', 'installing', 'completed', 'cancelled') then
    return false;
  end if;
  if p_status <> 'cancelled' and coalesce(cardinality(p_photo_paths), 0) = 0 then
    raise exception 'status photo is required';
  end if;

  select d.* into v_device
  from public.floor_technician_devices d
  where d.device_token = p_device_token
    and d.is_active = true;

  select * into v_session
  from public.floor_tracking_sessions
  where id = p_session_id
    and device_id = v_device.id
    and technician_id = v_device.technician_id
    and sharing_ended_at is null;

  if v_session.id is null then
    return false;
  end if;

  if p_status <> 'cancelled' and not (
    (v_session.status = 'travelling' and p_status = 'arrived')
    or (v_session.status = 'arrived' and p_status = 'installing')
    or (v_session.status = 'installing' and p_status = 'completed')
  ) then
    raise exception 'invalid status transition from % to %', v_session.status, p_status;
  end if;

  insert into public.floor_job_status_events(
    session_id, assignment_id, technician_id, status, note, photo_paths,
    latitude, longitude
  ) values (
    v_session.id, v_session.assignment_id, v_session.technician_id,
    p_status, nullif(left(btrim(coalesce(p_note, '')), 1000), ''), p_photo_paths,
    v_session.latest_latitude, v_session.latest_longitude
  );

  update public.floor_tracking_sessions
  set status = p_status,
      sharing_ended_at = case when p_status = 'cancelled' then now() else sharing_ended_at end,
      updated_at = now()
  where id = v_session.id;

  return true;
end;
$$;

create or replace function public.record_floor_customer_signature(
  p_device_token uuid,
  p_session_id uuid,
  p_signer_name text,
  p_signature_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.floor_technician_devices%rowtype;
  v_session public.floor_tracking_sessions%rowtype;
begin
  if nullif(btrim(coalesce(p_signer_name, '')), '') is null
     or nullif(btrim(coalesce(p_signature_path, '')), '') is null then
    raise exception 'signer name and signature are required';
  end if;

  select d.* into v_device
  from public.floor_technician_devices d
  where d.device_token = p_device_token
    and d.is_active = true;

  select * into v_session
  from public.floor_tracking_sessions
  where id = p_session_id
    and device_id = v_device.id
    and sharing_ended_at is null
    and status = 'completed';

  if v_session.id is null then
    return false;
  end if;

  update public.floor_tracking_sessions
  set customer_signed_name = left(btrim(p_signer_name), 160),
      customer_signature_path = left(btrim(p_signature_path), 1000),
      customer_signed_at = now(),
      sharing_ended_at = now(),
      updated_at = now()
  where id = v_session.id;

  insert into public.floor_job_status_events(
    session_id, assignment_id, technician_id, status, note, photo_paths
  ) values (
    v_session.id, v_session.assignment_id, v_session.technician_id,
    'customer_signed', left(btrim(p_signer_name), 160), '{}'
  );

  return true;
end;
$$;

create or replace function public.set_floor_tracking_eta(
  p_device_token uuid,
  p_session_id uuid,
  p_distance_meters integer,
  p_eta_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_distance_meters < 0 or p_eta_minutes < 0 then
    return false;
  end if;

  update public.floor_tracking_sessions s
  set distance_meters = p_distance_meters,
      eta_minutes = p_eta_minutes,
      eta_updated_at = now(),
      updated_at = now()
  from public.floor_technician_devices d
  where s.id = p_session_id
    and s.device_id = d.id
    and d.device_token = p_device_token
    and d.is_active = true
    and s.sharing_ended_at is null;

  return found;
end;
$$;

create or replace function public.can_request_floor_tracking_eta(
  p_device_token uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.floor_tracking_sessions s
    join public.floor_technician_devices d on d.id = s.device_id
    where s.id = p_session_id
      and d.device_token = p_device_token
      and d.is_active = true
      and s.sharing_ended_at is null
      and (s.eta_updated_at is null or s.eta_updated_at < now() - interval '3 minutes')
  );
$$;

revoke all on function public.set_floor_technician_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.register_floor_technician_device(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_technician_workspace(uuid, text) from public, anon, authenticated;
revoke all on function public.record_technician_work_event(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_floor_mobile_assignment_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_floor_job_material_plan(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.update_floor_device_permission(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_floor_mobile_workspace(uuid) from public, anon, authenticated;
revoke all on function public.start_floor_tracking(uuid, uuid, integer, double precision, double precision, text[]) from public, anon, authenticated;
revoke all on function public.record_floor_location_batch(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_floor_job_status(uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.record_floor_customer_signature(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_floor_tracking_eta(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.can_request_floor_tracking_eta(uuid, uuid) from public, anon, authenticated;

grant execute on function public.set_floor_technician_pin(uuid, text) to anon, authenticated;
grant execute on function public.register_floor_technician_device(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.get_technician_workspace(uuid, text) to anon, authenticated;
grant execute on function public.record_technician_work_event(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.record_floor_mobile_assignment_event(uuid, uuid, text) to anon, authenticated;
grant execute on function public.set_floor_job_material_plan(uuid, uuid, integer, text) to anon, authenticated;
grant execute on function public.update_floor_device_permission(uuid, text, text) to anon, authenticated;
grant execute on function public.get_floor_mobile_workspace(uuid) to anon, authenticated;
grant execute on function public.start_floor_tracking(uuid, uuid, integer, double precision, double precision, text[]) to anon, authenticated;
grant execute on function public.record_floor_location_batch(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.record_floor_job_status(uuid, uuid, text, text[], text) to anon, authenticated;
grant execute on function public.record_floor_customer_signature(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.set_floor_tracking_eta(uuid, uuid, integer, integer) to anon, authenticated;
grant execute on function public.can_request_floor_tracking_eta(uuid, uuid) to anon, authenticated;

-- Harden FloorNow background GPS writes and cover all tracking foreign keys.

create index if not exists floor_job_materials_picked_by_technician_idx
  on public.floor_job_materials(picked_by_technician_id);
create index if not exists floor_job_status_events_assignment_idx
  on public.floor_job_status_events(assignment_id);
create index if not exists floor_job_status_events_technician_idx
  on public.floor_job_status_events(technician_id);
create index if not exists floor_location_points_device_idx
  on public.floor_location_points(device_id);
create index if not exists floor_location_points_technician_idx
  on public.floor_location_points(technician_id);
create index if not exists floor_tracking_sessions_device_idx
  on public.floor_tracking_sessions(device_id);
create index if not exists floor_tracking_sessions_technician_idx
  on public.floor_tracking_sessions(technician_id);

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
  join public.floor_technicians t on t.id = d.technician_id
  where d.device_token = p_device_token
    and d.is_active = true
    and t.auth_user_id = (select auth.uid());

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
  join public.floor_technicians t on t.id = d.technician_id
  where d.device_token = p_device_token
    and d.is_active = true
    and t.auth_user_id = (select auth.uid());

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

revoke all on function public.record_floor_location_batch(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_floor_job_status(uuid, uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.record_floor_location_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.record_floor_job_status(uuid, uuid, text, text[], text) to authenticated;

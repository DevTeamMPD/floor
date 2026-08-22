-- Require acknowledgement and the team lead's material plan before travelling starts.

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
  join public.floor_technicians t on t.id = d.technician_id
  where d.device_token = p_device_token
    and d.is_active = true
    and d.background_permission = 'always'
    and t.auth_user_id = (select auth.uid());

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

revoke all on function public.start_floor_tracking(uuid, uuid, integer, double precision, double precision, text[]) from public, anon, authenticated;
grant execute on function public.start_floor_tracking(uuid, uuid, integer, double precision, double precision, text[]) to authenticated;

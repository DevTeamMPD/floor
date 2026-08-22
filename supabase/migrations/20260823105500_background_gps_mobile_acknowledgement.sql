-- Authenticated mobile equivalent of the personal-link open/acknowledge evidence flow.

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
  v_platform text;
begin
  if p_event_type not in ('opened', 'acknowledged') then
    return false;
  end if;

  select a.id, d.platform
  into v_assignment_id, v_platform
  from public.appointment_technicians a
  join public.floor_technician_devices d on d.technician_id = a.technician_id
  join public.floor_technicians t on t.id = d.technician_id
  where a.id = p_assignment_id
    and a.is_active = true
    and d.device_token = p_device_token
    and d.is_active = true
    and t.is_active = true
    and t.auth_user_id = (select auth.uid());

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
  values (v_assignment_id, p_event_type, 'FloorNow Worker/' || v_platform);

  return true;
end;
$$;

revoke all on function public.record_floor_mobile_assignment_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_floor_mobile_assignment_event(uuid, uuid, text) to authenticated;

comment on function public.record_floor_mobile_assignment_event(uuid, uuid, text) is
  'Records authenticated mobile work-order opens and acknowledgements for the assigned technician.';

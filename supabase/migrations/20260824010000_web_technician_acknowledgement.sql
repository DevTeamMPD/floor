-- Web workers authenticate with their personal link + PIN. Mobile device
-- enrollment is reserved for background GPS and must not block basic work
-- acknowledgement in the browser.
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
begin
  if p_event_type not in ('opened', 'acknowledged') then
    return false;
  end if;

  select a.id
  into v_assignment_id
  from public.appointment_technicians a
  join public.floor_technicians t on t.id = a.technician_id
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
  values (v_assignment_id, p_event_type, left(coalesce(nullif(p_user_agent, ''), 'FloorNow Web'), 500));

  return true;
end;
$$;

revoke all on function public.record_technician_work_event(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_technician_work_event(uuid, text, uuid, text, text) to anon, authenticated;

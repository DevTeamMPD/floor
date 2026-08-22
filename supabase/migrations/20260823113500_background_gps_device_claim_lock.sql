-- Serialize first-time technician claims so two Auth users cannot win concurrently.

create or replace function public.register_floor_technician_device(
  p_personal_token uuid,
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
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'unsupported platform';
  end if;

  select * into v_technician
  from public.floor_technicians
  where personal_token = p_personal_token
    and is_active = true
  for update;

  if v_technician.id is null then
    raise exception 'invalid technician token';
  end if;

  if v_technician.auth_user_id is not null
     and v_technician.auth_user_id <> (select auth.uid()) then
    raise exception 'technician account is already claimed';
  end if;

  update public.floor_technicians
  set auth_user_id = (select auth.uid()),
      updated_at = now()
  where id = v_technician.id;

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
    'technicianName', v_technician.name
  );
end;
$$;

revoke all on function public.register_floor_technician_device(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.register_floor_technician_device(uuid, text, text, text) to authenticated;

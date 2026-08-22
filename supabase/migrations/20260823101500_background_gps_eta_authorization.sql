-- Authorize and throttle paid route lookups before the FloorNow API calls Google Routes.

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
    join public.floor_technicians t on t.id = d.technician_id
    where s.id = p_session_id
      and d.device_token = p_device_token
      and d.is_active = true
      and t.auth_user_id = (select auth.uid())
      and s.sharing_ended_at is null
      and (s.eta_updated_at is null or s.eta_updated_at < now() - interval '3 minutes')
  );
$$;

revoke all on function public.can_request_floor_tracking_eta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_request_floor_tracking_eta(uuid, uuid) to authenticated;

comment on function public.can_request_floor_tracking_eta(uuid, uuid) is
  'Checks Floor employee ownership and throttles Google Routes lookups before cost is incurred.';

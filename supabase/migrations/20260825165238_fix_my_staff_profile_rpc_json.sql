-- The client contract expects one JSON object, not a PostgREST table array.

drop function if exists public.get_my_floor_staff_profile();

create function public.get_my_floor_staff_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'role', p.role,
    'is_active', p.is_active,
    'full_name', p.full_name,
    'email', p.email
  )
  from public.floor_staff_profiles p
  where p.id = (select auth.uid())
    and p.is_active;
$$;

revoke all on function public.get_my_floor_staff_profile() from public, anon, authenticated;
grant execute on function public.get_my_floor_staff_profile() to authenticated;

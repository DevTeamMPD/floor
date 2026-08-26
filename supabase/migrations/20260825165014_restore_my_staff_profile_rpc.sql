-- Restores the profile lookup used by authenticated FloorNow pages.
-- It returns only the caller's active FloorNow profile and is not callable by anon.

create or replace function public.get_my_floor_staff_profile()
returns table (
  id uuid,
  role text,
  is_active boolean,
  full_name text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.role, p.is_active, p.full_name, p.email
  from public.floor_staff_profiles p
  where p.id = (select auth.uid())
    and p.is_active;
$$;

revoke all on function public.get_my_floor_staff_profile() from public, anon, authenticated;
grant execute on function public.get_my_floor_staff_profile() to authenticated;

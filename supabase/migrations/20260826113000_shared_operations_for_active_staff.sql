-- Temporary shared-operation mode for FloorNow.
-- Every authenticated, active FloorNow staff member can perform operational work.
-- Authentication and the HR-linked active status remain mandatory.  Staff-account
-- administration is intentionally outside this scope because it can disable users.

create or replace function public.floor_staff_has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.floor_staff_profiles p
    where p.id = (select auth.uid())
      and p.is_active
  )
$$;

revoke all on function public.floor_staff_has_role(text[]) from public, anon, authenticated;
grant execute on function public.floor_staff_has_role(text[]) to authenticated;

-- The operational RPCs predate the shared helper and contain their own
-- role checks.  Re-create only functions that check an active FloorNow staff
-- profile with `role in (...)`, removing that role predicate while retaining
-- every status, validation, stock, evidence and technician-lead rule.
do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%floor_staff_profiles%'
      and pg_get_functiondef(p.oid) ~ 'is_active[[:space:]]+and[[:space:]]+([a-z_]+\.)?role[[:space:]]+in'
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := regexp_replace(
      definition,
      '([[:space:]]and[[:space:]]+)([a-z_]+\.)?is_active[[:space:]]+and[[:space:]]+([a-z_]+\.)?role[[:space:]]+in[[:space:]]*\([^)]*\)',
      '\1\2is_active',
      'g'
    );
    execute definition;
  end loop;
end;
$$;

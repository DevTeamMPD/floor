alter table public.floor_staff_profiles
  add column if not exists access_scope text not null default 'full',
  add column if not exists pin_username text;

alter table public.floor_staff_profiles
  drop constraint if exists floor_staff_profiles_access_scope_check;
alter table public.floor_staff_profiles
  add constraint floor_staff_profiles_access_scope_check
  check (access_scope in ('full', 'warehouse_prep_only'));

create unique index if not exists floor_staff_profiles_pin_username_unique
  on public.floor_staff_profiles(lower(pin_username))
  where pin_username is not null;

comment on column public.floor_staff_profiles.access_scope is
  'Restricts PIN-based warehouse users to the preparation workspace.';

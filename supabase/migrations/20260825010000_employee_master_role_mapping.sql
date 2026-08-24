-- FloorNow employee-master bridge.
-- hr.* remains read-only. All configuration and synced access state live in floor_* tables.

alter table public.floor_staff_profiles
  add column if not exists master_employee_id uuid,
  add column if not exists role_source text not null default 'manual',
  add column if not exists master_synced_at timestamptz;

do $$ begin
  alter table public.floor_staff_profiles
    add constraint floor_staff_profiles_role_source_check
    check (role_source in ('manual', 'master'));
exception when duplicate_object then null;
end $$;

create unique index if not exists floor_staff_profiles_master_employee_unique
  on public.floor_staff_profiles(master_employee_id)
  where master_employee_id is not null;

create table if not exists public.floor_staff_role_mappings (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  label text not null,
  company_id uuid,
  division_id uuid,
  department_id uuid,
  position_id uuid,
  hr_role text,
  floor_role text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint floor_staff_role_mappings_role_check
    check (floor_role in ('admin', 'sales', 'head_technician', 'cs', 'executive', 'warehouse'))
);

alter table public.floor_staff_role_mappings enable row level security;
revoke all on public.floor_staff_role_mappings from anon, authenticated;
grant select, insert, update, delete on public.floor_staff_role_mappings to authenticated;

drop policy if exists floor_staff_role_mappings_admin on public.floor_staff_role_mappings;
create policy floor_staff_role_mappings_admin
  on public.floor_staff_role_mappings for all to authenticated
  using (public.is_floor_staff_admin())
  with check (public.is_floor_staff_admin());

-- Conservative defaults from the current HR organization structure.
-- Rules use master IDs selected by code/name; no HR row is changed.
insert into public.floor_staff_role_mappings(rule_key, label, position_id, floor_role, priority)
select 'executive-position-' || lower(p.code), 'ตำแหน่ง ' || p.name, p.id, 'executive', 250
from hr.positions p
where p.is_active and p.code in ('DIRECTOR', 'EXECUTIVE')
on conflict(rule_key) do update set
  label=excluded.label, position_id=excluded.position_id, floor_role=excluded.floor_role,
  priority=excluded.priority, updated_at=now();

insert into public.floor_staff_role_mappings(rule_key, label, department_id, position_id, floor_role, priority)
select 'head-technician-supervisor', 'หัวหน้าช่าง (ช่าง / Supervisor)', d.id, p.id, 'head_technician', 300
from hr.departments d
join hr.companies c on c.id=d.company_id and c.code='LEN'
cross join hr.positions p
where d.is_active and d.name='ช่าง' and p.is_active and p.code='SUPERVISOR'
on conflict(rule_key) do update set
  label=excluded.label, department_id=excluded.department_id, position_id=excluded.position_id,
  floor_role=excluded.floor_role, priority=excluded.priority, updated_at=now();

insert into public.floor_staff_role_mappings(rule_key, label, department_id, floor_role, priority)
select 'warehouse-department-' || d.id::text, d.name, d.id, 'warehouse', 150
from hr.departments d
join hr.companies c on c.id=d.company_id and c.code='MPD'
where d.is_active and d.name in ('คลังสินค้า', 'ธุรการคลังสินค้า')
on conflict(rule_key) do update set
  label=excluded.label, department_id=excluded.department_id, floor_role=excluded.floor_role,
  priority=excluded.priority, updated_at=now();

insert into public.floor_staff_role_mappings(rule_key, label, department_id, floor_role, priority)
select 'cs-department-' || d.id::text, d.name, d.id, 'cs', 150
from hr.departments d
join hr.companies c on c.id=d.company_id and c.code='MPD'
where d.is_active and d.name='เจ้าหน้าที่ลูกค้าสัมพันธ์'
on conflict(rule_key) do update set
  label=excluded.label, department_id=excluded.department_id, floor_role=excluded.floor_role,
  priority=excluded.priority, updated_at=now();

insert into public.floor_staff_role_mappings(rule_key, label, department_id, floor_role, priority)
select 'sales-department-' || d.id::text, d.name, d.id, 'sales', 100
from hr.departments d
where d.is_active and d.name in (
  'ขายออนไลน์', 'ขายออฟไลน์', 'ขาย BZone', 'ขายงานโครงการ', 'ธุรการขาย'
)
on conflict(rule_key) do update set
  label=excluded.label, department_id=excluded.department_id, floor_role=excluded.floor_role,
  priority=excluded.priority, updated_at=now();

create or replace function public.resolve_floor_role_for_employee(p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = public, hr
as $$
  select m.floor_role
  from hr.employees e
  join public.floor_staff_role_mappings m
    on m.is_active
   and (m.company_id is null or m.company_id=e.company_id)
   and (m.division_id is null or m.division_id=e.division_id)
   and (m.department_id is null or m.department_id=e.department_id)
   and (m.position_id is null or m.position_id=e.position_id)
   and (m.hr_role is null or m.hr_role=e.role::text)
  where e.id=p_employee_id and e.status in ('active','probation')
  order by m.priority desc,
    ((m.company_id is not null)::int + (m.division_id is not null)::int +
     (m.department_id is not null)::int + (m.position_id is not null)::int +
     (m.hr_role is not null)::int) desc,
    m.rule_key
  limit 1;
$$;

create or replace function public.sync_floor_staff_from_employee_master()
returns jsonb
language plpgsql
security definer
set search_path = public, hr, auth
as $$
declare v_upserted integer := 0; v_deactivated integer := 0;
begin
  if (select auth.uid()) is null then
    if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role'
       and session_user not in ('postgres','supabase_admin') then
      raise exception 'service role required';
    end if;
  elsif not public.is_floor_staff_admin() then
    raise exception 'admin permission required';
  end if;

  update public.floor_staff_profiles p
  set is_active=false, master_synced_at=now(), updated_at=now()
  where p.role_source='master' and not exists (
    select 1 from hr.employees e
    where e.id=p.master_employee_id
      and e.auth_user_id=p.id
      and e.status in ('active','probation')
      and public.resolve_floor_role_for_employee(e.id) is not null
  );
  get diagnostics v_deactivated = row_count;

  insert into public.floor_staff_profiles(
    id,email,full_name,role,is_active,master_employee_id,role_source,master_synced_at
  )
  select e.auth_user_id,
    lower(coalesce(nullif(btrim(e.email),''), u.email, e.employee_code || '@employee.local')),
    concat_ws(' ', nullif(btrim(e.title_th),''), e.first_name_th, e.last_name_th),
    public.resolve_floor_role_for_employee(e.id), true, e.id, 'master', now()
  from hr.employees e
  join auth.users u on u.id=e.auth_user_id
  where e.auth_user_id is not null
    and e.status in ('active','probation')
    and public.resolve_floor_role_for_employee(e.id) is not null
  on conflict(id) do update set
    email=excluded.email, full_name=excluded.full_name, role=excluded.role,
    is_active=true, master_employee_id=excluded.master_employee_id,
    master_synced_at=now(), updated_at=now()
  where public.floor_staff_profiles.role_source='master';
  get diagnostics v_upserted = row_count;

  return jsonb_build_object('upserted',v_upserted,'deactivated',v_deactivated,'syncedAt',now());
end;
$$;

create or replace function public.list_floor_employee_role_preview()
returns table(
  employee_id uuid, employee_code text, full_name text, email text,
  employee_status text, department_name text, position_name text,
  mapped_role text, auth_linked boolean, profile_source text, profile_active boolean
)
language plpgsql
stable
security definer
set search_path = public, hr
as $$
begin
  if not public.is_floor_staff_admin() then raise exception 'admin permission required'; end if;
  return query
  select e.id, e.employee_code,
    concat_ws(' ', nullif(btrim(e.title_th),''), e.first_name_th, e.last_name_th),
    e.email, e.status::text, d.name, p.name,
    public.resolve_floor_role_for_employee(e.id), e.auth_user_id is not null,
    fp.role_source, fp.is_active
  from hr.employees e
  left join hr.departments d on d.id=e.department_id
  left join hr.positions p on p.id=e.position_id
  left join public.floor_staff_profiles fp on fp.id=e.auth_user_id
  where e.status in ('active','probation')
    and public.resolve_floor_role_for_employee(e.id) is not null
  order by public.resolve_floor_role_for_employee(e.id), d.name, e.first_name_th;
end;
$$;

-- Login-time activation: master mapping first, manual invitation remains the fallback.
create or replace function public.activate_floor_staff_account()
returns jsonb
language plpgsql
security definer
set search_path = public, hr
as $$
declare
  v_invite public.floor_staff_invites%rowtype;
  v_employee hr.employees%rowtype;
  v_existing public.floor_staff_profiles%rowtype;
  v_role text;
  v_name text;
  v_user_id uuid := (select auth.uid());
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if v_user_id is null or v_email='' then raise exception 'authenticated account required'; end if;

  select * into v_existing from public.floor_staff_profiles where id=v_user_id;
  if v_existing.id is not null and v_existing.role_source='manual' and v_existing.is_active then
    return jsonb_build_object('activated',true,'existing',true,'source','manual','role',v_existing.role);
  end if;

  select * into v_employee
  from hr.employees e
  where e.status in ('active','probation')
    and (e.auth_user_id=v_user_id or (e.auth_user_id is null and lower(e.email)=v_email))
  order by (e.auth_user_id=v_user_id) desc
  limit 1;

  if v_employee.id is not null then
    v_role := public.resolve_floor_role_for_employee(v_employee.id);
    if v_role is not null then
      v_name := concat_ws(' ', nullif(btrim(v_employee.title_th),''), v_employee.first_name_th, v_employee.last_name_th);
      insert into public.floor_staff_profiles(
        id,email,full_name,role,is_active,master_employee_id,role_source,master_synced_at
      ) values (v_user_id,v_email,v_name,v_role,true,v_employee.id,'master',now())
      on conflict(id) do update set
        email=excluded.email, full_name=excluded.full_name, role=excluded.role,
        is_active=true, master_employee_id=excluded.master_employee_id,
        role_source='master', master_synced_at=now(), updated_at=now()
      where public.floor_staff_profiles.role_source='master';
      return jsonb_build_object('activated',true,'source','master','role',v_role);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('floornow-first-staff'));
  if not exists (select 1 from public.floor_staff_profiles) then
    v_role := 'admin';
    v_name := coalesce(nullif(btrim(auth.jwt()->'user_metadata'->>'full_name'),''),split_part(v_email,'@',1));
  else
    select * into v_invite from public.floor_staff_invites
    where lower(email)=v_email and used_at is null
    order by created_at desc limit 1 for update;
    if v_invite.id is null then raise exception 'employee is not mapped or invited to FloorNow'; end if;
    v_role := v_invite.role;
    v_name := coalesce(nullif(btrim(v_invite.full_name),''),nullif(btrim(auth.jwt()->'user_metadata'->>'full_name'),''),split_part(v_email,'@',1));
  end if;

  insert into public.floor_staff_profiles(id,email,full_name,role,is_active,role_source,master_employee_id,master_synced_at)
  values(v_user_id,v_email,v_name,v_role,true,'manual',null,null)
  on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role,
    is_active=true,role_source='manual',master_employee_id=null,master_synced_at=null,updated_at=now();
  if v_invite.id is not null then
    update public.floor_staff_invites set used_by=v_user_id,used_at=now() where id=v_invite.id;
  end if;
  return jsonb_build_object('activated',true,'source','manual','role',v_role);
end;
$$;

revoke all on function public.resolve_floor_role_for_employee(uuid) from public, anon, authenticated;
revoke all on function public.sync_floor_staff_from_employee_master() from public, anon, authenticated;
revoke all on function public.list_floor_employee_role_preview() from public, anon, authenticated;
revoke all on function public.activate_floor_staff_account() from public, anon, authenticated;
grant execute on function public.sync_floor_staff_from_employee_master() to authenticated, service_role;
grant execute on function public.list_floor_employee_role_preview() to authenticated;
grant execute on function public.activate_floor_staff_account() to authenticated;

notify pgrst, 'reload schema';

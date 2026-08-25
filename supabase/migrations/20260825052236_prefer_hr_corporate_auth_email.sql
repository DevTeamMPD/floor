-- Prefer the employee's corporate-email Auth account for FloorNow login.
-- HR remains read-only; its auth_user_id may intentionally point to an internal account.

create or replace function public.resolve_floor_auth_user_for_employee(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, hr, auth
as $$
  select coalesce(
    (
      select u.id
      from hr.employees e
      join auth.users u on lower(u.email)=lower(e.email)
      where e.id=p_employee_id and nullif(btrim(e.email),'') is not null
      order by u.created_at desc
      limit 1
    ),
    (
      select u.id
      from hr.employees e
      join auth.users u on u.id=e.auth_user_id
      where e.id=p_employee_id
      limit 1
    )
  );
$$;

revoke all on function public.resolve_floor_auth_user_for_employee(uuid)
  from public,anon,authenticated;

create or replace function public.sync_floor_staff_from_employee_master()
returns jsonb
language plpgsql
security definer
set search_path = public, hr, auth
as $$
declare v_upserted integer := 0; v_deactivated integer := 0;
begin
  if (select auth.uid()) is null then
    if coalesce((select auth.jwt()->>'role'),'') <> 'service_role'
       and session_user not in ('postgres','supabase_admin') then
      raise exception 'service role required';
    end if;
  elsif not public.is_floor_staff_admin() then
    raise exception 'admin permission required';
  end if;

  update public.floor_staff_profiles p
  set email=lower(coalesce(nullif(btrim(u.email),''),p.email)),
      is_active=false, master_employee_id=null,
      master_synced_at=now(), updated_at=now()
  from auth.users u
  where u.id=p.id and p.role_source='master' and not exists (
    select 1
    from hr.employees e
    where e.id=p.master_employee_id
      and e.status in ('active','probation')
      and public.resolve_floor_auth_user_for_employee(e.id)=p.id
  );
  get diagnostics v_deactivated = row_count;

  insert into public.floor_staff_profiles(
    id,email,full_name,role,is_active,master_employee_id,role_source,master_synced_at
  )
  select canonical.auth_user_id,
    lower(coalesce(nullif(btrim(u.email),''),nullif(btrim(e.email),''),e.employee_code||'@employee.local')),
    concat_ws(' ',nullif(btrim(e.title_th),''),e.first_name_th,e.last_name_th),
    coalesce(public.resolve_floor_role_for_employee(e.id),'staff'),
    true,e.id,'master',now()
  from hr.employees e
  cross join lateral (
    select public.resolve_floor_auth_user_for_employee(e.id) as auth_user_id
  ) canonical
  join auth.users u on u.id=canonical.auth_user_id
  where canonical.auth_user_id is not null and e.status in ('active','probation')
  on conflict(id) do update set
    email=excluded.email,full_name=excluded.full_name,role=excluded.role,
    is_active=true,master_employee_id=excluded.master_employee_id,
    master_synced_at=now(),updated_at=now()
  where public.floor_staff_profiles.role_source='master';
  get diagnostics v_upserted = row_count;

  return jsonb_build_object(
    'upserted',v_upserted,'deactivated',v_deactivated,
    'activeProfiles',(select count(*) from public.floor_staff_profiles where is_active),
    'syncedAt',now()
  );
end;
$$;

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
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if v_user_id is null or v_email='' then raise exception 'authenticated account required'; end if;

  select * into v_existing from public.floor_staff_profiles where id=v_user_id;
  if v_existing.id is not null and v_existing.role_source='manual' then
    if not v_existing.is_active then raise exception 'account disabled by administrator'; end if;
    return jsonb_build_object('activated',true,'existing',true,'source','manual','role',v_existing.role);
  end if;

  select * into v_employee
  from hr.employees e
  where e.status in ('active','probation')
    and (e.auth_user_id=v_user_id or lower(coalesce(e.email,''))=v_email)
  order by (lower(coalesce(e.email,''))=v_email) desc, (e.auth_user_id=v_user_id) desc
  limit 1;

  if v_employee.id is not null then
    v_role := coalesce(public.resolve_floor_role_for_employee(v_employee.id),'staff');
    v_name := concat_ws(' ',nullif(btrim(v_employee.title_th),''),v_employee.first_name_th,v_employee.last_name_th);
    insert into public.floor_staff_profiles(
      id,email,full_name,role,is_active,master_employee_id,role_source,master_synced_at
    ) values (v_user_id,v_email,v_name,v_role,true,v_employee.id,'master',now())
    on conflict(id) do update set
      email=excluded.email,full_name=excluded.full_name,role=excluded.role,
      is_active=true,master_employee_id=excluded.master_employee_id,
      role_source='master',master_synced_at=now(),updated_at=now()
    where public.floor_staff_profiles.role_source='master';
    return jsonb_build_object('activated',true,'source','master','role',v_role);
  end if;

  select * into v_invite from public.floor_staff_invites
  where lower(email)=v_email and used_at is null
  order by created_at desc limit 1 for update;
  if v_invite.id is null then raise exception 'active HR employee or FloorNow invitation required'; end if;

  v_role := v_invite.role;
  v_name := coalesce(nullif(btrim(v_invite.full_name),''),split_part(v_email,'@',1));
  insert into public.floor_staff_profiles(
    id,email,full_name,role,is_active,role_source,master_employee_id,master_synced_at
  ) values (v_user_id,v_email,v_name,v_role,true,'manual',null,null)
  on conflict(id) do update set
    email=excluded.email,full_name=excluded.full_name,role=excluded.role,
    is_active=true,role_source='manual',master_employee_id=null,
    master_synced_at=null,updated_at=now();
  update public.floor_staff_invites set used_by=v_user_id,used_at=now() where id=v_invite.id;
  return jsonb_build_object('activated',true,'source','manual','role',v_role);
end;
$$;

revoke all on function public.sync_floor_staff_from_employee_master()
  from public,anon,authenticated;
revoke all on function public.activate_floor_staff_account()
  from public,anon,authenticated;
grant execute on function public.sync_floor_staff_from_employee_master()
  to authenticated,service_role;
grant execute on function public.activate_floor_staff_account()
  to authenticated;

-- Reconcile FloorNow profiles immediately using the canonical Auth choice.
select public.sync_floor_staff_from_employee_master();

notify pgrst,'reload schema';

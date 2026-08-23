-- FloorNow staff authentication and role workspaces.
-- The first successful signup becomes admin. Later signups require an unused
-- invite created by an active admin.

create table if not exists public.floor_staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint floor_staff_profiles_role_check
    check (role in ('admin', 'sales', 'head_technician', 'cs', 'executive', 'warehouse'))
);

create unique index if not exists floor_staff_profiles_email_unique
  on public.floor_staff_profiles(lower(email));

create table if not exists public.floor_staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  role text not null,
  invited_by uuid references public.floor_staff_profiles(id) on delete restrict,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint floor_staff_invites_role_check
    check (role in ('admin', 'sales', 'head_technician', 'cs', 'executive', 'warehouse'))
);

create unique index if not exists floor_staff_invites_open_email_unique
  on public.floor_staff_invites(lower(email)) where used_at is null;

alter table public.floor_staff_profiles enable row level security;
alter table public.floor_staff_invites enable row level security;

revoke all on public.floor_staff_profiles from anon, authenticated;
revoke all on public.floor_staff_invites from anon, authenticated;
grant select on public.floor_staff_profiles to authenticated;

create or replace function public.is_floor_staff_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.floor_staff_profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  );
$$;

create policy floor_staff_read_self_or_admin
  on public.floor_staff_profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_floor_staff_admin());

create policy floor_staff_admin_update
  on public.floor_staff_profiles for update to authenticated
  using (public.is_floor_staff_admin())
  with check (public.is_floor_staff_admin());

create policy floor_staff_admin_invites
  on public.floor_staff_invites for all to authenticated
  using (public.is_floor_staff_admin())
  with check (public.is_floor_staff_admin());

create or replace function public.activate_floor_staff_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.floor_staff_invites%rowtype;
  v_role text;
  v_name text;
  v_user_id uuid := (select auth.uid());
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if v_user_id is null or v_email = '' then
    raise exception 'authenticated account required';
  end if;
  if exists (select 1 from public.floor_staff_profiles where id = v_user_id and is_active) then
    return jsonb_build_object('activated', true, 'existing', true);
  end if;
  perform pg_advisory_xact_lock(hashtext('floornow-first-staff'));

  if not exists (select 1 from public.floor_staff_profiles) then
    v_role := 'admin';
    v_name := coalesce(nullif(btrim(auth.jwt()->'user_metadata'->>'full_name'), ''), split_part(v_email, '@', 1));
  else
    select * into v_invite
    from public.floor_staff_invites
    where lower(email) = v_email
      and used_at is null
    order by created_at desc
    limit 1
    for update;

    if v_invite.id is null then
      raise exception 'email is not invited to FloorNow';
    end if;
    v_role := v_invite.role;
    v_name := coalesce(nullif(btrim(v_invite.full_name), ''), nullif(btrim(auth.jwt()->'user_metadata'->>'full_name'), ''), split_part(v_email, '@', 1));
  end if;

  insert into public.floor_staff_profiles(id, email, full_name, role)
  values (v_user_id, v_email, v_name, v_role)
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = excluded.role,
        is_active = true,
        updated_at = now();

  if v_invite.id is not null then
    update public.floor_staff_invites
    set used_by = v_user_id, used_at = now()
    where id = v_invite.id;
  end if;
  return jsonb_build_object('activated', true, 'role', v_role);
end;
$$;

create or replace function public.get_floor_staff_bootstrap_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('needsBootstrap', not exists (select 1 from public.floor_staff_profiles));
$$;

create or replace function public.invite_floor_staff(
  p_email text,
  p_full_name text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_floor_staff_admin() then
    raise exception 'admin permission required';
  end if;
  if p_role not in ('admin', 'sales', 'head_technician', 'cs', 'executive', 'warehouse') then
    raise exception 'invalid role';
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'email is required';
  end if;

  insert into public.floor_staff_invites(email, full_name, role, invited_by)
  values (lower(btrim(p_email)), nullif(btrim(coalesce(p_full_name, '')), ''), p_role, (select auth.uid()))
  on conflict (lower(email)) where used_at is null do update
    set full_name = excluded.full_name,
        role = excluded.role,
        invited_by = excluded.invited_by,
        created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.is_floor_staff_admin() from public, anon, authenticated;
revoke all on function public.get_floor_staff_bootstrap_status() from public, anon, authenticated;
revoke all on function public.activate_floor_staff_account() from public, anon, authenticated;
revoke all on function public.invite_floor_staff(text, text, text) from public, anon, authenticated;
grant execute on function public.is_floor_staff_admin() to authenticated;
grant execute on function public.get_floor_staff_bootstrap_status() to anon, authenticated;
grant execute on function public.activate_floor_staff_account() to authenticated;
grant execute on function public.invite_floor_staff(text, text, text) to authenticated;

create or replace function public.list_floor_material_plans_staff()
returns table(appointment_id uuid, planned_sheet_count integer, picked_sheet_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.floor_staff_profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'head_technician')
  ) then
    raise exception 'head technician permission required';
  end if;
  return query select m.appointment_id, m.planned_sheet_count, m.picked_sheet_count from public.floor_job_materials m;
end;
$$;

create or replace function public.set_floor_job_material_plan_staff(
  p_appointment_id uuid,
  p_planned_sheet_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_planned_sheet_count is null or p_planned_sheet_count < 0 then
    raise exception 'planned sheet count is required';
  end if;
  if not exists (
    select 1 from public.floor_staff_profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'head_technician')
  ) then
    raise exception 'head technician permission required';
  end if;
  insert into public.floor_job_materials(appointment_id, planned_sheet_count, planned_by, planned_at, updated_at)
  values (p_appointment_id, p_planned_sheet_count, 'หัวหน้าช่าง', now(), now())
  on conflict (appointment_id) do update
    set planned_sheet_count = excluded.planned_sheet_count,
        planned_by = excluded.planned_by,
        planned_at = excluded.planned_at,
        updated_at = excluded.updated_at;
  return true;
end;
$$;

create or replace function public.release_floor_appointment_staff(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_appt public.appointments%rowtype; v_job public.install_jobs%rowtype;
begin
  if not exists (
    select 1 from public.floor_staff_profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'head_technician')
  ) then raise exception 'head technician permission required'; end if;

  select * into v_appt from public.appointments where id = p_appointment_id and status <> 'cancelled' for update;
  if v_appt.id is null or v_appt.job_id is null then raise exception 'appointment not found'; end if;
  select * into v_job from public.install_jobs where job_no = v_appt.job_id for update;
  if v_job.job_no is null then raise exception 'job not found'; end if;
  if nullif(btrim(coalesce(v_job.customer_name, '')), '') is null
     or nullif(btrim(coalesce(v_job.customer_phone, '')), '') is null
     or (nullif(btrim(coalesce(v_job.address, '')), '') is null and nullif(btrim(coalesce(v_job.location_url, '')), '') is null)
     or nullif(btrim(coalesce(v_job.product_name, v_appt.requirement, '')), '') is null then
    raise exception 'customer, phone, location and work specification are required';
  end if;
  if not exists (select 1 from public.appointment_technicians a where a.appointment_id = v_appt.id and a.is_active) then
    raise exception 'individual technician assignment is required';
  end if;
  if not exists (select 1 from public.floor_job_materials m where m.appointment_id = v_appt.id) then
    raise exception 'planned sheet count is required';
  end if;

  update public.appointments set status = 'confirmed', confirmed_at = now() where id = v_appt.id;
  update public.install_jobs set stage = greatest(stage, 2), status = 'ปล่อยใบงานแล้ว', waiting_on = 'ทีมช่าง', waiting_since = now(), flag_note = null, updated_at = now() where job_no = v_appt.job_id;
  insert into public.job_activity(job_no, actor, action, field, old_value, new_value)
  values (v_appt.job_id, 'หัวหน้าช่าง', 'release', 'appointment', v_appt.status, 'confirmed');
  return true;
end;
$$;

create or replace function public.return_floor_appointment_staff(p_appointment_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_appt public.appointments%rowtype;
begin
  if not exists (
    select 1 from public.floor_staff_profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'head_technician')
  ) then raise exception 'head technician permission required'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'reason is required'; end if;
  select * into v_appt from public.appointments where id = p_appointment_id and status <> 'cancelled' for update;
  if v_appt.id is null or v_appt.job_id is null then raise exception 'appointment not found'; end if;
  update public.appointments set status = 'proposed', confirmed_at = null where id = v_appt.id;
  update public.install_jobs set status = 'ส่งกลับฝ่ายขายแก้ไข', waiting_on = 'ฝ่ายขาย', waiting_since = now(), flag_note = left(btrim(p_reason), 500), updated_at = now() where job_no = v_appt.job_id;
  insert into public.job_activity(job_no, actor, action, field, old_value, new_value)
  values (v_appt.job_id, 'หัวหน้าช่าง', 'return', 'status', v_appt.status, left(btrim(p_reason), 500));
  return true;
end;
$$;

revoke all on function public.list_floor_material_plans_staff() from public, anon, authenticated;
revoke all on function public.set_floor_job_material_plan_staff(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_floor_appointment_staff(uuid) from public, anon, authenticated;
revoke all on function public.return_floor_appointment_staff(uuid, text) from public, anon, authenticated;
grant execute on function public.list_floor_material_plans_staff() to authenticated;
grant execute on function public.set_floor_job_material_plan_staff(uuid, integer) to authenticated;
grant execute on function public.release_floor_appointment_staff(uuid) to authenticated;
grant execute on function public.return_floor_appointment_staff(uuid, text) to authenticated;

create table if not exists public.floor_work_progress_events (
  id bigint generated by default as identity primary key,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  assignment_id uuid not null references public.appointment_technicians(id) on delete restrict,
  technician_id uuid not null references public.floor_technicians(id) on delete restrict,
  status text not null,
  note text,
  photo_paths text[] not null default '{}',
  picked_sheet_count integer,
  customer_signed_name text,
  customer_signature_path text,
  occurred_at timestamptz not null default now(),
  constraint floor_work_progress_status_check check (status in ('travelling', 'arrived', 'installing', 'completed', 'customer_signed')),
  constraint floor_work_progress_picked_check check (picked_sheet_count is null or picked_sheet_count >= 0)
);

create index if not exists floor_work_progress_appointment_time_idx on public.floor_work_progress_events(appointment_id, occurred_at);
create index if not exists floor_work_progress_assignment_time_idx on public.floor_work_progress_events(assignment_id, occurred_at);
alter table public.floor_work_progress_events enable row level security;
revoke all on public.floor_work_progress_events from anon, authenticated;
revoke all on sequence public.floor_work_progress_events_id_seq from anon, authenticated;

create or replace function public.get_technician_work_progress(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plannedSheetCount', material.planned_sheet_count,
    'pickedSheetCount', material.picked_sheet_count,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'note', e.note, 'photoPaths', e.photo_paths,
        'pickedSheetCount', e.picked_sheet_count, 'customerSignedName', e.customer_signed_name,
        'customerSignaturePath', e.customer_signature_path, 'occurredAt', e.occurred_at
      ) order by e.occurred_at)
      from public.floor_work_progress_events e where e.assignment_id = a.id
    ), '[]'::jsonb)
  )
  from public.appointment_technicians a
  join public.floor_technicians t on t.id = a.technician_id
  left join public.floor_job_materials material on material.appointment_id = a.appointment_id
  where a.id = p_assignment_id and a.is_active
    and t.personal_token = p_token and t.is_active and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash;
$$;

create or replace function public.record_technician_work_status(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_status text,
  p_photo_paths text[],
  p_picked_sheet_count integer default null,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_assignment public.appointment_technicians%rowtype; v_latest text;
begin
  if p_status not in ('travelling', 'arrived', 'installing', 'completed') then return false; end if;
  if coalesce(cardinality(p_photo_paths), 0) = 0 then raise exception 'status photo is required'; end if;
  select a.* into v_assignment
  from public.appointment_technicians a join public.floor_technicians t on t.id = a.technician_id
  where a.id = p_assignment_id and a.is_active and t.is_active and t.personal_token = p_token
    and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;
  if v_assignment.acknowledged_at is null then raise exception 'acknowledge assignment first'; end if;
  select status into v_latest from public.floor_work_progress_events where assignment_id = v_assignment.id order by occurred_at desc limit 1;
  if not ((v_latest is null and p_status = 'travelling')
      or (v_latest = 'travelling' and p_status = 'arrived')
      or (v_latest = 'arrived' and p_status = 'installing')
      or (v_latest = 'installing' and p_status = 'completed')) then
    raise exception 'invalid work status transition';
  end if;
  if p_status = 'travelling' and (p_picked_sheet_count is null or p_picked_sheet_count < 0) then
    raise exception 'picked sheet count is required';
  end if;
  if p_status = 'travelling' then
    if not exists (select 1 from public.floor_job_materials where appointment_id = v_assignment.appointment_id) then
      raise exception 'head technician material plan is required';
    end if;
    update public.floor_job_materials set picked_sheet_count = p_picked_sheet_count, picked_by_technician_id = v_assignment.technician_id, picked_at = now(), updated_at = now() where appointment_id = v_assignment.appointment_id;
  end if;
  insert into public.floor_work_progress_events(appointment_id, assignment_id, technician_id, status, note, photo_paths, picked_sheet_count)
  values (v_assignment.appointment_id, v_assignment.id, v_assignment.technician_id, p_status, nullif(left(btrim(coalesce(p_note, '')), 1000), ''), p_photo_paths, case when p_status = 'travelling' then p_picked_sheet_count else null end);
  if p_status = 'completed' then
    update public.install_jobs j set stage = greatest(j.stage, 4), status = 'รอหัวหน้าตรวจงาน', waiting_on = 'หัวหน้าช่าง', waiting_since = now(), updated_at = now()
    from public.appointments ap where ap.id = v_assignment.appointment_id and j.job_no = ap.job_id;
  end if;
  return true;
end;
$$;

create or replace function public.record_technician_customer_signature(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_customer_name text,
  p_signature_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_assignment public.appointment_technicians%rowtype; v_latest text;
begin
  if nullif(btrim(coalesce(p_customer_name, '')), '') is null or nullif(btrim(coalesce(p_signature_path, '')), '') is null then raise exception 'customer name and signature are required'; end if;
  select a.* into v_assignment from public.appointment_technicians a join public.floor_technicians t on t.id = a.technician_id
  where a.id = p_assignment_id and a.is_active and t.is_active and t.personal_token = p_token and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;
  select status into v_latest from public.floor_work_progress_events where assignment_id = v_assignment.id order by occurred_at desc limit 1;
  if v_latest <> 'completed' then raise exception 'complete installation before customer signature'; end if;
  insert into public.floor_work_progress_events(appointment_id, assignment_id, technician_id, status, customer_signed_name, customer_signature_path)
  values (v_assignment.appointment_id, v_assignment.id, v_assignment.technician_id, 'customer_signed', left(btrim(p_customer_name), 200), p_signature_path);
  return true;
end;
$$;

create or replace function public.list_floor_work_progress_staff()
returns table(appointment_id uuid, latest_status text, latest_at timestamptz, customer_signed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.floor_staff_profiles p where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'head_technician')) then raise exception 'head technician permission required'; end if;
  return query
  select distinct on (e.appointment_id) e.appointment_id, e.status, e.occurred_at,
    max(e.occurred_at) filter (where e.status = 'customer_signed') over (partition by e.appointment_id)
  from public.floor_work_progress_events e
  order by e.appointment_id, e.occurred_at desc;
end;
$$;

create or replace function public.close_floor_appointment_staff(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_appt public.appointments%rowtype;
begin
  if not exists (select 1 from public.floor_staff_profiles p where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'head_technician')) then raise exception 'head technician permission required'; end if;
  if not exists (select 1 from public.floor_work_progress_events e where e.appointment_id = p_appointment_id and e.status = 'completed') then raise exception 'completion evidence is required'; end if;
  if not exists (select 1 from public.floor_work_progress_events e where e.appointment_id = p_appointment_id and e.status = 'customer_signed') then raise exception 'customer signature is required'; end if;
  select * into v_appt from public.appointments where id = p_appointment_id and status = 'confirmed' for update;
  if v_appt.id is null then raise exception 'confirmed appointment not found'; end if;
  update public.appointments set status = 'completed' where id = v_appt.id;
  update public.install_jobs set stage = greatest(stage, 5), status = 'รอ CS ติดตาม', waiting_on = 'CS', waiting_since = now(), updated_at = now() where job_no = v_appt.job_id;
  insert into public.job_activity(job_no, actor, action, field, old_value, new_value) values (v_appt.job_id, 'หัวหน้าช่าง', 'close_installation', 'appointment', 'confirmed', 'completed');
  return true;
end;
$$;

revoke all on function public.get_technician_work_progress(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.record_technician_work_status(uuid, text, uuid, text, text[], integer, text) from public, anon, authenticated;
revoke all on function public.record_technician_customer_signature(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_floor_work_progress_staff() from public, anon, authenticated;
revoke all on function public.close_floor_appointment_staff(uuid) from public, anon, authenticated;
grant execute on function public.get_technician_work_progress(uuid, text, uuid) to anon, authenticated;
grant execute on function public.record_technician_work_status(uuid, text, uuid, text, text[], integer, text) to anon, authenticated;
grant execute on function public.record_technician_customer_signature(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.list_floor_work_progress_staff() to authenticated;
grant execute on function public.close_floor_appointment_staff(uuid) to authenticated;

create or replace function public.resolve_legacy_floor_dispatch(p_dispatch_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('technicianToken', t.personal_token, 'jobNo', dn.job_no)
  from public.dispatch_notes dn
  join public.appointments ap on ap.job_id = dn.job_no and ap.status <> 'cancelled'
  join public.appointment_technicians a on a.appointment_id = ap.id and a.is_active
  join public.floor_technicians t on t.id = a.technician_id and t.is_active
  where dn.share_token = p_dispatch_token
  order by a.is_lead desc, ap.slot_start desc
  limit 1;
$$;

revoke all on function public.resolve_legacy_floor_dispatch(text) from public, anon, authenticated;
grant execute on function public.resolve_legacy_floor_dispatch(text) to anon, authenticated;

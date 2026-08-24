-- Shared visibility, capability-based actions, and event-recipient notifications.
-- HR remains read-only. This migration only changes FloorNow-owned objects.

alter table public.floor_staff_profiles
  drop constraint if exists floor_staff_profiles_role_check;
alter table public.floor_staff_profiles
  add constraint floor_staff_profiles_role_check
  check (role in ('admin','staff','sales','head_technician','cs','executive','warehouse'));

alter table public.floor_staff_invites
  drop constraint if exists floor_staff_invites_role_check;
alter table public.floor_staff_invites
  add constraint floor_staff_invites_role_check
  check (role in ('admin','staff','sales','head_technician','cs','executive','warehouse'));

-- Every active/probation employee gets FloorNow access. A specific operational
-- mapping remains a capability role; everyone else receives the read-only staff role.
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
  set is_active=false, master_synced_at=now(), updated_at=now()
  where p.role_source='master' and not exists (
    select 1 from hr.employees e
    where e.id=p.master_employee_id
      and e.status in ('active','probation')
      and (
        e.auth_user_id=p.id
        or (e.auth_user_id is null and lower(coalesce(e.email,''))=lower(p.email))
      )
  );
  get diagnostics v_deactivated = row_count;

  insert into public.floor_staff_profiles(
    id,email,full_name,role,is_active,master_employee_id,role_source,master_synced_at
  )
  select e.auth_user_id,
    lower(coalesce(nullif(btrim(e.email),''),u.email,e.employee_code||'@employee.local')),
    concat_ws(' ',nullif(btrim(e.title_th),''),e.first_name_th,e.last_name_th),
    coalesce(public.resolve_floor_role_for_employee(e.id),'staff'),
    true,e.id,'master',now()
  from hr.employees e
  join auth.users u on u.id=e.auth_user_id
  where e.auth_user_id is not null and e.status in ('active','probation')
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
  select e.id,e.employee_code,
    concat_ws(' ',nullif(btrim(e.title_th),''),e.first_name_th,e.last_name_th),
    e.email,e.status::text,d.name,p.name,
    coalesce(public.resolve_floor_role_for_employee(e.id),'staff'),
    e.auth_user_id is not null,fp.role_source,fp.is_active
  from hr.employees e
  left join hr.departments d on d.id=e.department_id
  left join hr.positions p on p.id=e.position_id
  left join public.floor_staff_profiles fp on fp.id=e.auth_user_id
  where e.status in ('active','probation')
  order by coalesce(public.resolve_floor_role_for_employee(e.id),'staff'),d.name,e.first_name_th;
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
    and (e.auth_user_id=v_user_id or (e.auth_user_id is null and lower(e.email)=v_email))
  order by (e.auth_user_id=v_user_id) desc
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

create or replace function public.invite_floor_staff(
  p_email text,p_full_name text,p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_floor_staff_admin() then raise exception 'admin permission required'; end if;
  if p_role not in ('admin','staff','sales','head_technician','cs','executive','warehouse') then
    raise exception 'invalid role';
  end if;
  if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'email is required'; end if;
  insert into public.floor_staff_invites(email,full_name,role,invited_by)
  values(lower(btrim(p_email)),nullif(btrim(coalesce(p_full_name,'')),''),p_role,(select auth.uid()))
  on conflict(lower(email)) where used_at is null do update set
    full_name=excluded.full_name,role=excluded.role,invited_by=excluded.invited_by,created_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.sync_floor_staff_from_employee_master() from public,anon,authenticated;
revoke all on function public.list_floor_employee_role_preview() from public,anon,authenticated;
revoke all on function public.activate_floor_staff_account() from public,anon,authenticated;
revoke all on function public.invite_floor_staff(text,text,text) from public,anon,authenticated;
grant execute on function public.sync_floor_staff_from_employee_master() to authenticated,service_role;
grant execute on function public.list_floor_employee_role_preview() to authenticated;
grant execute on function public.activate_floor_staff_account() to authenticated;
grant execute on function public.invite_floor_staff(text,text,text) to authenticated;

-- Ticket ownership allows return/progress notifications to target the person
-- who created the direct-sales ticket instead of the whole sales department.
alter table public.install_jobs
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;
alter table public.floor_work_orders
  add column if not exists source_owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists install_jobs_created_by_user_idx
  on public.install_jobs(created_by_user_id) where created_by_user_id is not null;
create index if not exists floor_work_orders_source_owner_idx
  on public.floor_work_orders(source_owner_user_id) where source_owner_user_id is not null;

create or replace function public.capture_floor_ticket_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.created_by_user_id is null and new.source='floor_direct'
     and (select auth.uid()) is not null
     and exists (
       select 1 from public.floor_staff_profiles p
       where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','sales')
     ) then
    new.created_by_user_id := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists install_jobs_capture_floor_owner on public.install_jobs;
create trigger install_jobs_capture_floor_owner
before insert or update on public.install_jobs
for each row execute function public.capture_floor_ticket_owner();

create or replace function public.propagate_floor_ticket_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by_user_id is not null then
    update public.floor_work_orders
    set source_owner_user_id=new.created_by_user_id,updated_at=now()
    where job_no=new.job_no and source_owner_user_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists install_jobs_propagate_floor_owner on public.install_jobs;
create trigger install_jobs_propagate_floor_owner
after insert or update of created_by_user_id on public.install_jobs
for each row execute function public.propagate_floor_ticket_owner();

create or replace function public.capture_floor_work_order_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_owner_user_id is null then
    select j.created_by_user_id into new.source_owner_user_id
    from public.install_jobs j where j.job_no=new.job_no;
  end if;
  return new;
end;
$$;

drop trigger if exists floor_work_orders_capture_owner on public.floor_work_orders;
create trigger floor_work_orders_capture_owner
before insert or update of job_no on public.floor_work_orders
for each row execute function public.capture_floor_work_order_owner();

update public.floor_work_orders wo
set source_owner_user_id=j.created_by_user_id
from public.install_jobs j
where j.job_no=wo.job_no and wo.source_owner_user_id is null and j.created_by_user_id is not null;

-- Role notifications now target exactly the requested capability role.
-- Admin no longer receives a copy of every operational event automatically.
create or replace function public.notify_floor_role(
  p_role text,p_event_type text,p_title text,p_body text,p_target_url text,
  p_job_no text,p_appointment_id uuid,p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.floor_notifications(
    recipient_user_id,event_type,title,body,target_url,job_no,appointment_id,dedupe_key
  )
  select p.id,p_event_type,left(p_title,200),left(p_body,1000),left(p_target_url,500),
    p_job_no,p_appointment_id,
    case when p_dedupe_key is null then null else p_dedupe_key||':'||p.id::text end
  from public.floor_staff_profiles p
  where p.is_active and p.role=p_role
  on conflict do nothing;
end;
$$;

create or replace function public.notify_floor_user(
  p_user_id uuid,p_event_type text,p_title text,p_body text,p_target_url text,
  p_job_no text,p_appointment_id uuid,p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or not exists (
    select 1 from public.floor_staff_profiles p where p.id=p_user_id and p.is_active
  ) then return; end if;
  insert into public.floor_notifications(
    recipient_user_id,event_type,title,body,target_url,job_no,appointment_id,dedupe_key
  ) values (
    p_user_id,p_event_type,left(p_title,200),left(p_body,1000),left(p_target_url,500),
    p_job_no,p_appointment_id,
    case when p_dedupe_key is null then null else p_dedupe_key||':'||p_user_id::text end
  ) on conflict do nothing;
end;
$$;

create or replace function public.notify_floor_work_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.floor_work_orders%rowtype;
  v_job public.install_jobs%rowtype;
  v_title text;
  v_body text;
  v_target text;
  v_dedupe text;
  v_assignment record;
begin
  select * into v_order from public.floor_work_orders where id=new.work_order_id;
  if v_order.id is null then return new; end if;
  select * into v_job from public.install_jobs where job_no=v_order.job_no;
  v_title := coalesce(v_job.customer_name,v_order.job_no)||' · มีการอัปเดตงาน';
  v_body := coalesce(nullif(new.note,''),new.actor_name||' อัปเดตสถานะงาน');
  v_target := '/orders/'||v_order.job_no;
  v_dedupe := 'work-event:'||new.id::text;

  if new.event_type='returned_for_correction' then
    if v_order.source_owner_user_id is not null then
      perform public.notify_floor_user(v_order.source_owner_user_id,'work_returned',
        'งานถูกส่งกลับให้แก้ไข',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    else
      perform public.notify_floor_role('sales','work_returned_unowned',
        'งานถูกส่งกลับ แต่ยังไม่มีเจ้าของตั๋ว',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    end if;
  elsif new.event_type in ('sales_resubmitted','bbps_resubmitted') then
    perform public.notify_floor_role('head_technician','work_resubmitted',
      'มีงานแก้ไขส่งกลับมาตรวจใหม่',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
  elsif new.event_type='head_confirmed' then
    perform public.notify_floor_role('warehouse','warehouse_job_ready',
      'มีใบสั่งงานใหม่ให้คลังรับงาน',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
  elsif new.event_type='warehouse_accepted' then
    perform public.notify_floor_user(v_order.source_owner_user_id,'warehouse_accepted',
      v_title,'คลังรับงานเตรียมสินค้าแล้ว',v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    perform public.notify_floor_role('head_technician','warehouse_accepted',
      v_title,'คลังรับงานเตรียมสินค้าแล้ว',v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
  elsif new.event_type='warehouse_completed' then
    perform public.notify_floor_user(v_order.source_owner_user_id,'warehouse_completed',
      v_title,'คลังเตรียมสินค้าเสร็จแล้ว',v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    perform public.notify_floor_role('head_technician','warehouse_completed',
      v_title,'สินค้าและอุปกรณ์พร้อมติดตั้งแล้ว',v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    for v_assignment in
      select a.id,a.technician_id,t.auth_user_id,t.personal_token
      from public.appointment_technicians a
      join public.floor_technicians t on t.id=a.technician_id
      where a.appointment_id=v_order.appointment_id and a.is_active and t.is_active
    loop
      insert into public.floor_notifications(
        recipient_technician_id,event_type,title,body,target_url,job_no,appointment_id,dedupe_key
      ) values (
        v_assignment.technician_id,'installation_ready','สินค้าและอุปกรณ์พร้อมติดตั้ง',
        coalesce(v_job.customer_name,v_order.job_no),
        '/work/'||v_assignment.personal_token::text||'?job='||v_order.job_no,
        v_order.job_no,v_order.appointment_id,v_dedupe||':tech:'||v_assignment.technician_id::text
      ) on conflict do nothing;
      perform public.notify_floor_user(v_assignment.auth_user_id,'installation_ready',
        'สินค้าและอุปกรณ์พร้อมติดตั้ง',coalesce(v_job.customer_name,v_order.job_no),
        v_target,v_order.job_no,v_order.appointment_id,v_dedupe||':auth-tech');
    end loop;
  elsif new.event_type in ('installation_accepted','field_arrived','field_installing','field_completed') then
    perform public.notify_floor_user(v_order.source_owner_user_id,new.event_type,v_title,v_body,
      v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    perform public.notify_floor_role('head_technician',new.event_type,v_title,v_body,
      v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
  elsif new.event_type='customer_signed' then
    perform public.notify_floor_user(v_order.source_owner_user_id,'installation_completed',
      'ติดตั้งเสร็จและลูกค้าเซ็นรับงานแล้ว',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    perform public.notify_floor_role('head_technician','installation_completed',
      'ติดตั้งเสร็จและลูกค้าเซ็นรับงานแล้ว',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    perform public.notify_floor_role('cs','cs_followup_ready',
      'มีงานใหม่รอ CS ติดตาม',v_body,'/cs-tracking',v_order.job_no,v_order.appointment_id,v_dedupe);
  elsif new.event_type='cs_closed' then
    perform public.notify_floor_user(v_order.source_owner_user_id,'cs_closed',
      'CS ประเมินและปิดงานแล้ว',v_body,v_target,v_order.job_no,v_order.appointment_id,v_dedupe);
    perform public.notify_floor_role('executive','cs_closed',
      'มีงานประเมินเสร็จสมบูรณ์',v_body,'/dashboard',v_order.job_no,v_order.appointment_id,v_dedupe);
  end if;
  return new;
end;
$$;

drop trigger if exists floor_install_jobs_notify_transition on public.install_jobs;
drop trigger if exists floor_work_order_event_notify_recipient on public.floor_work_order_events;
create trigger floor_work_order_event_notify_recipient
after insert on public.floor_work_order_events
for each row execute function public.notify_floor_work_order_event();

-- Assignment notifications continue to support link + PIN, and also reach the
-- employee inbox when a technician is linked to an HR/Auth account.
create or replace function public.notify_floor_technician_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_job_no text; v_customer text; v_tech public.floor_technicians%rowtype;
begin
  if not new.is_active then return new; end if;
  if tg_op='UPDATE' and old.technician_id=new.technician_id and old.is_active=new.is_active then return new; end if;
  select * into v_tech from public.floor_technicians where id=new.technician_id and is_active;
  if v_tech.id is null then return new; end if;
  select a.job_id,j.customer_name into v_job_no,v_customer
  from public.appointments a left join public.install_jobs j on j.job_no=a.job_id
  where a.id=new.appointment_id;
  insert into public.floor_notifications(
    recipient_technician_id,event_type,title,body,target_url,job_no,appointment_id,dedupe_key
  ) values (
    new.technician_id,'technician_assigned','ได้รับมอบหมายงานใหม่',
    coalesce(v_customer,v_job_no,'เปิดตารางงานเพื่อดูรายละเอียด'),
    case when v_job_no is null then null else '/work/'||v_tech.personal_token::text||'?job='||v_job_no end,
    v_job_no,new.appointment_id,'assignment:'||new.id::text
  ) on conflict do nothing;
  perform public.notify_floor_user(v_tech.auth_user_id,'technician_assigned','ได้รับมอบหมายงานใหม่',
    coalesce(v_customer,v_job_no,'เปิดตารางงานเพื่อดูรายละเอียด'),
    case when v_job_no is null then '/appointments' else '/orders/'||v_job_no end,
    v_job_no,new.appointment_id,'assignment-auth:'||new.id::text);
  return new;
end;
$$;

-- Shared reads remain available to every active employee. Mutations keep their
-- capability checks. Remove the legacy purchase-order write-for-all policy.
drop policy if exists floor_staff_read_self_or_admin on public.floor_staff_profiles;
drop policy if exists floor_staff_shared_read on public.floor_staff_profiles;
create policy floor_staff_shared_read on public.floor_staff_profiles
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists authenticated_all on public.purchase_orders;
drop policy if exists purchase_orders_staff_read on public.purchase_orders;
drop policy if exists purchase_orders_warehouse_manage on public.purchase_orders;
create policy purchase_orders_staff_read on public.purchase_orders
  for select to authenticated using ((select public.is_floor_staff_active()));
create policy purchase_orders_warehouse_manage on public.purchase_orders
  for all to authenticated
  using ((select public.floor_staff_has_role(array['admin','warehouse'])))
  with check ((select public.floor_staff_has_role(array['admin','warehouse'])));

revoke all on function public.capture_floor_ticket_owner() from public,anon,authenticated;
revoke all on function public.propagate_floor_ticket_owner() from public,anon,authenticated;
revoke all on function public.capture_floor_work_order_owner() from public,anon,authenticated;
revoke all on function public.notify_floor_role(text,text,text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.notify_floor_user(uuid,text,text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.notify_floor_work_order_event() from public,anon,authenticated;
revoke all on function public.notify_floor_technician_assignment() from public,anon,authenticated;

notify pgrst,'reload schema';

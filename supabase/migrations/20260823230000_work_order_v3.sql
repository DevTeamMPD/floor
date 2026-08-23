-- FloorNow V3: explicit return/resubmit flow, permanent external status links,
-- and CS closure. This migration only touches Floor-owned tables/functions.

alter table public.floor_work_orders
  add column if not exists external_share_token uuid not null default gen_random_uuid(),
  add column if not exists external_share_enabled boolean not null default true,
  add column if not exists returned_reason text,
  add column if not exists returned_by uuid references public.floor_staff_profiles(id) on delete set null,
  add column if not exists returned_at timestamptz,
  add column if not exists resubmitted_at timestamptz;

create unique index if not exists floor_work_orders_external_share_token_unique
  on public.floor_work_orders(external_share_token);

create or replace function public.return_floor_work_order_v3(
  p_work_order_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.floor_work_orders%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin','head_technician');
  if v_actor.id is null then raise exception 'head technician permission required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'return reason is required'; end if;

  select * into v_order from public.floor_work_orders
  where id = p_work_order_id and status = 'head_review' for update;
  if v_order.id is null then raise exception 'work order is not awaiting head review'; end if;

  update public.floor_work_orders set
    status = 'returned_sales', returned_reason = left(btrim(p_reason),1000),
    returned_by = v_actor.id, returned_at = now(), updated_at = now()
  where id = v_order.id;
  update public.appointments set status = 'proposed', confirmed_at = null
  where id = v_order.appointment_id and status <> 'cancelled';
  update public.install_jobs set
    status = case when source = 'bbps' then 'ส่งกลับ BBPS แก้ไข' else 'ส่งกลับฝ่ายขายแก้ไข' end,
    waiting_on = case when source = 'bbps' then 'BBPS' else 'ฝ่ายขาย' end,
    waiting_since = now(), flag_note = left(btrim(p_reason),1000), updated_at = now()
  where job_no = v_order.job_no;
  insert into public.floor_work_order_events(
    work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note
  ) values (
    v_order.id,'returned_for_correction','head_review','returned_sales',
    v_actor.id,v_actor.full_name,left(btrim(p_reason),1000)
  );
  return true;
end;
$$;

create or replace function public.resubmit_floor_work_order_v3(p_work_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.floor_work_orders%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_source text;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin','sales');
  if v_actor.id is null then raise exception 'sales permission required'; end if;

  select * into v_order from public.floor_work_orders
  where id = p_work_order_id and status = 'returned_sales' for update;
  if v_order.id is null then raise exception 'work order is not returned to sales'; end if;
  select source into v_source from public.install_jobs where job_no = v_order.job_no;
  if v_source = 'bbps' then raise exception 'BBPS work must be corrected in BBPS CRM'; end if;

  update public.floor_work_orders set
    status = 'head_review', revision = revision + 1, resubmitted_at = now(), updated_at = now()
  where id = v_order.id;
  update public.install_jobs set
    status = 'รอหัวหน้าช่างยืนยัน', waiting_on = 'หัวหน้าช่าง', waiting_since = now(),
    flag_note = null, updated_at = now()
  where job_no = v_order.job_no;
  insert into public.floor_work_order_events(
    work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note
  ) values (
    v_order.id,'sales_resubmitted','returned_sales','head_review',
    v_actor.id,v_actor.full_name,'ฝ่ายขายแก้ข้อมูลและส่งตรวจใหม่'
  );
  return true;
end;
$$;

create or replace function public.resubmit_returned_bbps_work_order_v3()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.floor_work_orders%rowtype;
begin
  if new.source = 'bbps' and old.raw_payload is distinct from new.raw_payload then
    select * into v_order from public.floor_work_orders
    where job_no = new.job_no and status = 'returned_sales'
    order by created_at desc limit 1 for update;
    if v_order.id is not null then
      update public.floor_work_orders set
        status = 'head_review', revision = revision + 1, resubmitted_at = now(), updated_at = now()
      where id = v_order.id;
      update public.install_jobs set
        status = 'รอหัวหน้าช่างยืนยัน', waiting_on = 'หัวหน้าช่าง', waiting_since = now(), flag_note = null
      where job_no = new.job_no;
      insert into public.floor_work_order_events(
        work_order_id,event_type,from_status,to_status,actor_name,note
      ) values (
        v_order.id,'bbps_resubmitted','returned_sales','head_review','BBPS Sync',
        'BBPS ส่งข้อมูล revision ใหม่กลับมา'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists resubmit_returned_bbps_work_order_after_sync_v3 on public.install_jobs;
create trigger resubmit_returned_bbps_work_order_after_sync_v3
  after update of raw_payload on public.install_jobs
  for each row execute function public.resubmit_returned_bbps_work_order_v3();

create or replace function public.rotate_floor_external_share_v3(p_work_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype; v_token uuid;
begin
  select * into v_actor from public.floor_staff_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','head_technician');
  if v_actor.id is null then raise exception 'head technician permission required'; end if;
  v_token := gen_random_uuid();
  update public.floor_work_orders set external_share_token=v_token,external_share_enabled=true,updated_at=now()
  where id=p_work_order_id;
  if not found then raise exception 'work order not found'; end if;
  return v_token;
end;
$$;

create or replace function public.set_floor_external_share_enabled_v3(
  p_work_order_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists(select 1 from public.floor_staff_profiles
    where id=(select auth.uid()) and is_active and role in ('admin','head_technician'))
  then raise exception 'head technician permission required'; end if;
  update public.floor_work_orders set external_share_enabled=p_enabled,updated_at=now()
  where id=p_work_order_id;
  if not found then raise exception 'work order not found'; end if;
  return true;
end;
$$;

create or replace function public.get_floor_external_work_order_v3(p_token uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'jobNo',wo.job_no,
    'status',wo.status,
    'updatedAt',wo.updated_at,
    'customerName',j.customer_name,
    'productName',j.product_name,
    'appointmentStart',a.slot_start,
    'appointmentEnd',a.slot_end,
    'address',j.address,
    'locationUrl',j.location_url,
    'teamName',team.name,
    'trackingToken',(select s.customer_token from public.floor_tracking_sessions s where s.appointment_id=a.id order by s.sharing_started_at desc limit 1),
    'technicians',coalesce((select jsonb_agg(jsonb_build_object(
      'name',t.name,'isLead',at.is_lead
    ) order by at.is_lead desc,t.name) from public.appointment_technicians at
      join public.floor_technicians t on t.id=at.technician_id
      where at.appointment_id=a.id and at.is_active),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(jsonb_build_object(
      'type',e.event_type,'occurredAt',e.occurred_at,
      'photoPaths',case when e.event_type in ('warehouse_completed','installation_accepted','progress','customer_signed') then e.photo_paths else '{}'::text[] end
    ) order by e.occurred_at) from public.floor_work_order_events e
      where e.work_order_id=wo.id),'[]'::jsonb)
  )
  from public.floor_work_orders wo
  join public.appointments a on a.id=wo.appointment_id
  join public.install_jobs j on j.job_no=wo.job_no
  left join public.tech_teams team on team.id=a.tech_id
  where wo.external_share_token=p_token and wo.external_share_enabled and wo.status <> 'cancelled'
  limit 1
$$;

create or replace function public.close_floor_work_order_cs_v3(p_work_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.floor_work_orders%rowtype; v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','cs');
  if v_actor.id is null then raise exception 'CS permission required'; end if;
  select * into v_order from public.floor_work_orders
  where id=p_work_order_id and status='waiting_cs' for update;
  if v_order.id is null then raise exception 'work order is not waiting for CS'; end if;
  if not exists(select 1 from public.job_evaluations where job_no=v_order.job_no and satisfaction_score is not null)
  then raise exception 'customer evaluation is required'; end if;
  update public.floor_work_orders set status='closed',closed_at=now(),updated_at=now() where id=v_order.id;
  update public.install_jobs set stage=6,status='เสร็จสิ้น',waiting_on='ไม่ได้ค้าง',waiting_since=null,
    closed_at=coalesce(closed_at,now()),updated_at=now() where job_no=v_order.job_no;
  insert into public.floor_work_order_events(
    work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note
  ) values (v_order.id,'cs_closed','waiting_cs','closed',v_actor.id,v_actor.full_name,'CS ประเมินและปิดงาน');
  return true;
end;
$$;

revoke all on function public.return_floor_work_order_v3(uuid,text) from public,anon,authenticated;
revoke all on function public.resubmit_floor_work_order_v3(uuid) from public,anon,authenticated;
revoke all on function public.rotate_floor_external_share_v3(uuid) from public,anon,authenticated;
revoke all on function public.set_floor_external_share_enabled_v3(uuid,boolean) from public,anon,authenticated;
revoke all on function public.get_floor_external_work_order_v3(uuid) from public,anon,authenticated;
revoke all on function public.close_floor_work_order_cs_v3(uuid) from public,anon,authenticated;
grant execute on function public.return_floor_work_order_v3(uuid,text) to authenticated;
grant execute on function public.resubmit_floor_work_order_v3(uuid) to authenticated;
grant execute on function public.rotate_floor_external_share_v3(uuid) to authenticated;
grant execute on function public.set_floor_external_share_enabled_v3(uuid,boolean) to authenticated;
grant execute on function public.get_floor_external_work_order_v3(uuid) to anon,authenticated;
grant execute on function public.close_floor_work_order_cs_v3(uuid) to authenticated;

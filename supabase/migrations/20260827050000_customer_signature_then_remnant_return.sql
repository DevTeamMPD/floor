-- Customer acceptance comes before the remnant handover.
-- The final evidence proves that the technician brought goods/remnants back to the warehouse.

alter table public.floor_work_progress_events
  drop constraint if exists floor_work_progress_status_check;

alter table public.floor_work_progress_events
  add constraint floor_work_progress_status_check
  check (status in ('travelling', 'arrived', 'installing', 'completed', 'customer_signed', 'warehouse_returned'));

create or replace function public.record_technician_customer_signature(
  p_token uuid,p_pin text,p_assignment_id uuid,p_customer_name text,p_signature_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_assignment public.appointment_technicians%rowtype; v_latest text;
begin
  if nullif(btrim(coalesce(p_customer_name,'')),'') is null or nullif(btrim(coalesce(p_signature_path,'')),'') is null then
    raise exception 'customer name and signature are required';
  end if;
  select a.* into v_assignment
  from public.appointment_technicians a join public.floor_technicians t on t.id=a.technician_id
  where a.id=p_assignment_id and a.is_active and t.is_active and t.personal_token=p_token and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;
  if not v_assignment.is_lead then raise exception 'lead technician permission required'; end if;
  select status into v_latest from public.floor_work_progress_events where assignment_id=v_assignment.id order by occurred_at desc limit 1;
  if v_latest <> 'completed' then raise exception 'complete installation before customer signature'; end if;
  insert into public.floor_work_progress_events(appointment_id,assignment_id,technician_id,status,customer_signed_name,customer_signature_path)
  values(v_assignment.appointment_id,v_assignment.id,v_assignment.technician_id,'customer_signed',left(btrim(p_customer_name),200),p_signature_path);
  return true;
end;
$$;

create or replace function public.record_technician_warehouse_return(
  p_token uuid,p_pin text,p_assignment_id uuid,p_photo_paths text[],p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_assignment public.appointment_technicians%rowtype;
begin
  if coalesce(cardinality(p_photo_paths), 0) = 0 then raise exception 'warehouse return photo is required'; end if;
  select a.* into v_assignment
  from public.appointment_technicians a join public.floor_technicians t on t.id=a.technician_id
  where a.id=p_assignment_id and a.is_active and t.is_active and t.personal_token=p_token and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;
  if not v_assignment.is_lead then raise exception 'lead technician permission required'; end if;
  if not exists (select 1 from public.floor_work_progress_events where assignment_id=v_assignment.id and status='customer_signed') then
    raise exception 'customer signature is required before warehouse return';
  end if;
  if not exists (select 1 from public.floor_remnant_reports where appointment_id=v_assignment.appointment_id and status in ('pending_review','accepted')) then
    raise exception 'remnant report is required before warehouse return';
  end if;
  insert into public.floor_work_progress_events(appointment_id,assignment_id,technician_id,status,note,photo_paths)
  values(v_assignment.appointment_id,v_assignment.id,v_assignment.technician_id,'warehouse_returned',nullif(left(btrim(coalesce(p_note,'')),1000),''),p_photo_paths);
  return true;
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
  if not exists (select 1 from public.floor_staff_profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','head_technician')) then
    raise exception 'head technician permission required';
  end if;
  if not exists (select 1 from public.floor_work_progress_events e where e.appointment_id=p_appointment_id and e.status='completed') then raise exception 'completion evidence is required'; end if;
  if not exists (select 1 from public.floor_work_progress_events e where e.appointment_id=p_appointment_id and e.status='customer_signed') then raise exception 'customer signature is required'; end if;
  if not exists (select 1 from public.floor_work_progress_events e where e.appointment_id=p_appointment_id and e.status='warehouse_returned') then raise exception 'warehouse return evidence is required'; end if;
  select * into v_appt from public.appointments where id=p_appointment_id and status='confirmed' for update;
  if v_appt.id is null then raise exception 'confirmed appointment not found'; end if;
  update public.appointments set status='completed' where id=v_appt.id;
  update public.install_jobs set stage=greatest(stage,5),status='รอ CS ติดตาม',waiting_on='CS',waiting_since=now(),updated_at=now() where job_no=v_appt.job_id;
  insert into public.job_activity(job_no,actor,action,field,old_value,new_value) values(v_appt.job_id,'หัวหน้าช่าง','close_installation','appointment','confirmed','completed');
  return true;
end;
$$;

revoke all on function public.record_technician_customer_signature(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.record_technician_warehouse_return(uuid,text,uuid,text[],text) from public,anon,authenticated;
grant execute on function public.record_technician_customer_signature(uuid,text,uuid,text,text) to anon,authenticated;
grant execute on function public.record_technician_warehouse_return(uuid,text,uuid,text[],text) to anon,authenticated;
grant execute on function public.close_floor_appointment_staff(uuid) to authenticated;

notify pgrst, 'reload schema';

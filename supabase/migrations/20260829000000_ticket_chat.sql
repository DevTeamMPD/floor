-- Ticket-scoped communication shared by sales, warehouse and technicians.
create table if not exists public.floor_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.floor_work_orders(id) on delete cascade,
  job_no text not null references public.install_jobs(job_no) on delete cascade,
  sender_kind text not null check (sender_kind in ('sales','warehouse','technician','head_technician','staff')),
  sender_name text not null,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_technician_id uuid references public.floor_technicians(id) on delete set null,
  body text not null default '',
  attachment_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint floor_ticket_messages_body_or_file check (nullif(btrim(body),'') is not null or cardinality(attachment_paths) > 0)
);

create index if not exists floor_ticket_messages_job_created_idx on public.floor_ticket_messages(job_no, created_at);
alter table public.floor_ticket_messages enable row level security;
revoke all on public.floor_ticket_messages from anon, authenticated;
grant select, insert on public.floor_ticket_messages to authenticated;

create policy floor_ticket_messages_staff_read on public.floor_ticket_messages
  for select to authenticated using (public.is_floor_staff_active());
create policy floor_ticket_messages_staff_insert on public.floor_ticket_messages
  for insert to authenticated with check (
    public.is_floor_staff_active()
    and sender_user_id = (select auth.uid())
    and sender_technician_id is null
  );

create or replace function public.get_technician_ticket_messages(p_token uuid, p_pin text, p_job_no text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_technician_id uuid;
begin
  select t.id into v_technician_id from public.floor_technicians t
  where t.personal_token=p_token and t.is_active and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_technician_id is null then raise exception 'technician access denied'; end if;
  if not exists (
    select 1 from public.appointment_technicians a join public.appointments ap on ap.id=a.appointment_id
    where a.technician_id=v_technician_id and a.is_active and ap.job_id=p_job_no
  ) then raise exception 'ticket is not assigned to this technician'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'senderKind',m.sender_kind,'senderName',m.sender_name,'body',m.body,
    'attachmentPaths',m.attachment_paths,'createdAt',m.created_at
  ) order by m.created_at) from public.floor_ticket_messages m where m.job_no=p_job_no), '[]'::jsonb);
end;
$$;

create or replace function public.post_technician_ticket_message(p_token uuid, p_pin text, p_job_no text, p_body text default null, p_attachment_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_technician public.floor_technicians%rowtype; v_message_id uuid; v_work_order_id uuid;
begin
  select * into v_technician from public.floor_technicians t
  where t.personal_token=p_token and t.is_active and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_technician.id is null then raise exception 'technician access denied'; end if;
  if not exists (
    select 1 from public.appointment_technicians a join public.appointments ap on ap.id=a.appointment_id
    where a.technician_id=v_technician.id and a.is_active and ap.job_id=p_job_no
  ) then raise exception 'ticket is not assigned to this technician'; end if;
  if nullif(btrim(coalesce(p_body,'')),'') is null and coalesce(cardinality(p_attachment_paths),0)=0 then raise exception 'message or attachment is required'; end if;
  select id into v_work_order_id from public.floor_work_orders where job_no=p_job_no order by updated_at desc limit 1;
  insert into public.floor_ticket_messages(work_order_id,job_no,sender_kind,sender_name,sender_technician_id,body,attachment_paths)
  values(v_work_order_id,p_job_no,case when v_technician.is_team_lead then 'head_technician' else 'technician' end,v_technician.name,v_technician.id,coalesce(nullif(btrim(p_body),''),''),coalesce(p_attachment_paths,'{}'))
  returning id into v_message_id;
  return v_message_id;
end;
$$;

revoke all on function public.get_technician_ticket_messages(uuid,text,text) from public,anon,authenticated;
revoke all on function public.post_technician_ticket_message(uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.get_technician_ticket_messages(uuid,text,text) to anon,authenticated;
grant execute on function public.post_technician_ticket_message(uuid,text,text,text,text[]) to anon,authenticated;

alter table public.floor_ticket_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.floor_ticket_messages; exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';

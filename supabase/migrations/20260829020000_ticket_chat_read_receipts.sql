create table if not exists public.floor_ticket_message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.floor_ticket_messages(id) on delete cascade,
  job_no text not null references public.install_jobs(job_no) on delete cascade,
  reader_key text not null,
  reader_kind text not null check (reader_kind in ('sales','warehouse','technician','head_technician','staff')),
  reader_name text not null,
  reader_user_id uuid references auth.users(id) on delete set null,
  reader_technician_id uuid references public.floor_technicians(id) on delete set null,
  read_at timestamptz not null default now(),
  unique(message_id, reader_key)
);

create index if not exists floor_ticket_message_reads_job_idx on public.floor_ticket_message_reads(job_no, message_id);
alter table public.floor_ticket_message_reads enable row level security;
revoke all on public.floor_ticket_message_reads from anon, authenticated;
grant select, insert on public.floor_ticket_message_reads to authenticated;

create policy floor_ticket_message_reads_staff_read on public.floor_ticket_message_reads
  for select to authenticated using (public.is_floor_staff_active());
create policy floor_ticket_message_reads_staff_insert on public.floor_ticket_message_reads
  for insert to authenticated with check (
    public.is_floor_staff_active()
    and reader_user_id = (select auth.uid())
    and reader_technician_id is null
    and reader_key = ('staff:' || (select auth.uid())::text)
  );

create or replace function public.get_technician_ticket_messages(p_token uuid, p_pin text, p_job_no text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_technician_id uuid;
begin
  select t.id into v_technician_id from public.floor_technicians t
  where t.personal_token=p_token and t.is_active and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_technician_id is null then raise exception 'technician access denied'; end if;
  if not exists (select 1 from public.appointment_technicians a join public.appointments ap on ap.id=a.appointment_id where a.technician_id=v_technician_id and a.is_active and ap.job_id=p_job_no) then raise exception 'ticket is not assigned to this technician'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'senderKind',m.sender_kind,'senderName',m.sender_name,'body',m.body,
    'attachmentPaths',m.attachment_paths,'createdAt',m.created_at,
    'readBy',coalesce((select jsonb_agg(jsonb_build_object('name',r.reader_name,'kind',r.reader_kind,'readAt',r.read_at) order by r.read_at) from public.floor_ticket_message_reads r where r.message_id=m.id),'[]'::jsonb)
  ) order by m.created_at) from public.floor_ticket_messages m where m.job_no=p_job_no), '[]'::jsonb);
end;
$$;

create or replace function public.mark_technician_ticket_messages_read(p_token uuid, p_pin text, p_job_no text)
returns void language plpgsql security definer set search_path = public as $$
declare v_technician public.floor_technicians%rowtype;
begin
  select * into v_technician from public.floor_technicians t
  where t.personal_token=p_token and t.is_active and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_technician.id is null then raise exception 'technician access denied'; end if;
  if not exists (select 1 from public.appointment_technicians a join public.appointments ap on ap.id=a.appointment_id where a.technician_id=v_technician.id and a.is_active and ap.job_id=p_job_no) then raise exception 'ticket is not assigned to this technician'; end if;
  insert into public.floor_ticket_message_reads(message_id,job_no,reader_key,reader_kind,reader_name,reader_technician_id)
  select m.id,m.job_no,'technician:' || v_technician.id::text,case when v_technician.is_team_lead then 'head_technician' else 'technician' end,v_technician.name,v_technician.id
  from public.floor_ticket_messages m
  where m.job_no=p_job_no and m.sender_technician_id is distinct from v_technician.id
  on conflict (message_id,reader_key) do nothing;
end;
$$;

revoke all on function public.mark_technician_ticket_messages_read(uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_technician_ticket_messages_read(uuid,text,text) to anon,authenticated;
alter table public.floor_ticket_message_reads replica identity full;
do $$ begin alter publication supabase_realtime add table public.floor_ticket_message_reads; exception when duplicate_object then null; end $$;

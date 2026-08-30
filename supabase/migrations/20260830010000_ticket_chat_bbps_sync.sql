-- Ticket Chat Sync — ฝั่ง LENDI Engineering / Floor
-- ต่อยอด public.floor_ticket_messages ให้เก็บข้อความที่ซิงก์กับ BBPS CRM ได้
-- อ้างอิง API_CONTRACT_TICKET_CHAT_SYNC.md
--
-- ข้อควรระวังที่ยึดไว้ตลอดไฟล์นี้:
--   * ตั๋วที่ไม่ได้มาจาก BBPS ต้องมีพฤติกรรมเหมือนเดิมทุกประการ (sync_status = 'local')
--   * ไม่เพิ่มสิทธิ์ให้ anon และไม่ผ่อน RLS เดิม
--   * ข้อความขาเข้าเขียนด้วย service role เท่านั้น (ข้าม RLS) จึงไม่ต้องมี policy ใหม่

alter table public.floor_ticket_messages
  add column if not exists external_source                text,
  add column if not exists external_message_id            text,
  add column if not exists external_ticket_id             text,
  add column if not exists external_provider_message_id   text,
  add column if not exists external_sender_role           text,
  add column if not exists sync_status                    text not null default 'local',
  add column if not exists sync_error                     text,
  add column if not exists sync_attempts                  integer not null default 0,
  add column if not exists synced_at                      timestamptz,
  add column if not exists external_attachments           jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.floor_ticket_messages
    add constraint floor_ticket_messages_external_attachments_is_array
    check (jsonb_typeof(external_attachments) = 'array' and jsonb_array_length(external_attachments) <= 10);
exception when duplicate_object then null; end $$;

-- ข้อความจากภายนอกอาจมีแต่ไฟล์แนบและ body ว่าง ซึ่ง constraint เดิมไม่อนุญาต
alter table public.floor_ticket_messages drop constraint if exists floor_ticket_messages_body_or_file;
alter table public.floor_ticket_messages
  add constraint floor_ticket_messages_body_or_file
  check (
    nullif(btrim(body),'') is not null
    or cardinality(attachment_paths) > 0
    or jsonb_array_length(external_attachments) > 0
  );

do $$ begin
  alter table public.floor_ticket_messages
    add constraint floor_ticket_messages_sync_status_check
    check (sync_status in ('local','pending','delivered','failed'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.floor_ticket_messages
    add constraint floor_ticket_messages_external_source_check
    check (external_source is null or external_source in ('bbps'));
exception when duplicate_object then null; end $$;

comment on column public.floor_ticket_messages.external_source is
  'null = ข้อความที่พิมพ์ใน LENDI · ''bbps'' = รับมาจาก BBPS CRM';
comment on column public.floor_ticket_messages.external_message_id is
  'id ของข้อความที่ระบบต้นทางกำหนด — ใช้กันรับซ้ำ (ขาเข้า) / ใช้เป็นกุญแจ idempotency คงที่ทุก retry (ขาออก)';
comment on column public.floor_ticket_messages.external_provider_message_id is
  'message_id ที่ BBPS ตอบกลับมาหลังรับข้อความขาออกสำเร็จ';
comment on column public.floor_ticket_messages.external_attachments is
  'ไฟล์แนบที่มาจากระบบภายนอกในรูป [{url,type,name}] — เก็บ URL ตามที่ต้นทางส่งมา ไม่ mirror ไฟล์';
comment on column public.floor_ticket_messages.sync_status is
  'local = ไม่ต้องซิงก์ · pending = รอส่งไป BBPS · delivered = BBPS รับแล้ว · failed = ส่งไม่สำเร็จถาวร';

-- กันรับข้อความเดิมซ้ำจาก BBPS (partial: ข้อความ local ที่ยังไม่ส่งจะมี external_message_id เป็น null ได้)
create unique index if not exists floor_ticket_messages_external_uniq
  on public.floor_ticket_messages (external_source, external_message_id)
  where external_message_id is not null;

create index if not exists floor_ticket_messages_pending_sync_idx
  on public.floor_ticket_messages (job_no, created_at)
  where sync_status = 'pending';

-- ---------------------------------------------------------------------------
-- ตัดสินใจตอน insert ว่าข้อความนี้ต้องส่งต่อไป BBPS ไหม
-- ทำใน trigger เพื่อให้ทุกทางที่เขียนข้อความ (หน้าเว็บพนักงาน / RPC ของช่าง / service role)
-- ได้ผลเหมือนกัน โดยไม่ต้องแก้โค้ดทุกจุด
-- ---------------------------------------------------------------------------
create or replace function public.set_floor_ticket_message_sync_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_external_id text;
begin
  -- ข้อความที่รับมาจากภายนอก: ไม่ต้องส่งกลับออกไปอีก (กัน echo วนไม่จบ)
  if new.external_source is not null then
    new.sync_status := 'local';
    return new;
  end if;

  select j.source, j.external_id into v_source, v_external_id
  from public.install_jobs j
  where j.job_no = new.job_no;

  if v_source = 'bbps' and v_external_id is not null then
    new.sync_status       := 'pending';
    new.external_ticket_id := v_external_id;
    -- กุญแจ idempotency ที่คงที่ตลอดอายุข้อความ retry กี่รอบก็ค่าเดิม
    new.external_message_id := coalesce(new.external_message_id, 'lendi-' || new.id::text);
  else
    new.sync_status := 'local';
  end if;

  return new;
end;
$$;

revoke all on function public.set_floor_ticket_message_sync_target() from public, anon, authenticated;

drop trigger if exists trg_floor_ticket_message_sync_target on public.floor_ticket_messages;
create trigger trg_floor_ticket_message_sync_target
before insert on public.floor_ticket_messages
for each row execute function public.set_floor_ticket_message_sync_target();

-- ---------------------------------------------------------------------------
-- ช่างเห็นสถานะซิงก์ด้วย (RPC ของช่างเป็น security definer อยู่แล้ว)
-- ---------------------------------------------------------------------------
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
    'attachmentPaths',m.attachment_paths,'externalAttachments',m.external_attachments,'createdAt',m.created_at,
    'externalSource',m.external_source,'externalSenderRole',m.external_sender_role,
    'syncStatus',m.sync_status,'syncError',m.sync_error,
    'readBy',coalesce((select jsonb_agg(jsonb_build_object('name',r.reader_name,'kind',r.reader_kind,'readAt',r.read_at) order by r.read_at) from public.floor_ticket_message_reads r where r.message_id=m.id),'[]'::jsonb)
  ) order by m.created_at) from public.floor_ticket_messages m where m.job_no=p_job_no), '[]'::jsonb);
end;
$$;

revoke all on function public.get_technician_ticket_messages(uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_technician_ticket_messages(uuid,text,text) to anon,authenticated;

notify pgrst, 'reload schema';

-- Private attachments for ticket chat. Access is verified by the application API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-chat-files',
  'ticket-chat-files',
  false,
  10485760,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'application/pdf','text/plain','text/csv',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists floor_ticket_chat_staff_read on storage.objects;
create policy floor_ticket_chat_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'ticket-chat-files' and public.is_floor_staff_active());

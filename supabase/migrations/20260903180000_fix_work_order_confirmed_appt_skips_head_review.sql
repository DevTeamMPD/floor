-- Fix: ensure_floor_work_order_for_appointment() was jumping a brand-new
-- floor_work_orders row straight to 'ready_to_install' whenever the linked
-- appointment's status was already 'confirmed' -- conflating "appointment
-- slot confirmed" with "materials confirmed by head technician". This let
-- work orders reach ready_to_install with zero floor_work_order_items and
-- confirmed_at/warehouse_accepted_at/warehouse_completed_at all null,
-- because confirm_floor_work_order_v2() (the only place that requires >=1
-- material item) was never invoked. Root-caused for job ORD-202608-1026 on
-- 2026-09-03. New work orders now always start at head_review unless the
-- appointment is already 'completed' (kept for historical/import cases).
-- Applied directly via Supabase MCP on 2026-09-03; this file records it in
-- migration history per HANDOFF_FLOOR.md convention.
create or replace function public.ensure_floor_work_order_for_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_id is not null and new.status <> 'cancelled' then
    insert into public.floor_work_orders(appointment_id, job_no, status)
    values (new.id, new.job_id, case when new.status = 'completed' then 'waiting_cs' else 'head_review' end)
    on conflict (appointment_id) do update set job_no = excluded.job_no, updated_at = now();
  elsif new.status = 'cancelled' then
    update public.floor_work_orders set status = 'cancelled', updated_at = now() where appointment_id = new.id and status <> 'closed';
  end if;
  return new;
end;
$$;

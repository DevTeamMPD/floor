-- Lets warehouse staff replace the evidence photo set they attached when
-- completing prep (floor_work_order_events.photo_paths on the
-- 'warehouse_completed' event), at any time regardless of the work order's
-- current status. Rather than mutating the original historical event row,
-- this inserts a new 'warehouse_evidence_updated' event carrying the full
-- replacement photo set; callers should treat the most recent of
-- {warehouse_completed, warehouse_evidence_updated} per work order as the
-- current evidence set, preserving the original event for audit history.
-- Applied directly via Supabase MCP on 2026-09-03; this file records it in
-- migration history per HANDOFF_FLOOR.md convention.
create or replace function public.update_floor_warehouse_evidence_photos(
  p_work_order_id uuid,
  p_photo_paths text[],
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.floor_work_orders%rowtype; v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles where id = (select auth.uid()) and is_active and role in ('admin','warehouse');
  if v_actor.id is null then raise exception 'warehouse permission required'; end if;
  select * into v_order from public.floor_work_orders where id = p_work_order_id;
  if v_order.id is null then raise exception 'work order not found'; end if;
  if coalesce(cardinality(p_photo_paths),0) = 0 then raise exception 'at least one evidence photo is required'; end if;
  insert into public.floor_work_order_events(work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note,photo_paths)
  values (v_order.id,'warehouse_evidence_updated',v_order.status,v_order.status,v_actor.id,v_actor.full_name,nullif(btrim(coalesce(p_note,'')),''),p_photo_paths);
  return true;
end;
$$;
revoke all on function public.update_floor_warehouse_evidence_photos(uuid,text[],text) from public,anon,authenticated;
grant execute on function public.update_floor_warehouse_evidence_photos(uuid,text[],text) to authenticated;

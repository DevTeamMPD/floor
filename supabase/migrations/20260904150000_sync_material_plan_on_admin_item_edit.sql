-- Fix: floor_job_materials (แผนวัสดุของหัวหน้าช่าง) was only ever written by
-- confirm_floor_work_order_v2(). Work orders that reached ready_to_install
-- without passing head-review (the ensure_floor_work_order_for_appointment()
-- bug fixed on 2026-09-03) therefore have no plan row at all, and
-- record_technician_work_status() blocks the technician at 'travelling' with
-- 'head technician material plan is required'. The admin recovery RPC
-- (admin_update_floor_work_order_items) edited the item list but never
-- refreshed the plan, so there was no way to clear the block from the UI.
-- Root-caused for job ORD-202608-2003 on 2026-09-04 (6 of 9 ready_to_install
-- orders were in this state).
-- Change 1: the admin RPC now upserts the plan from the saved items, using the
--           same formula as confirm_floor_work_order_v2.
-- Change 2: one-off backfill for active work orders that already have items
--           but no plan row.
-- Applied directly via Supabase MCP on 2026-09-04; this file records it in
-- migration history per HANDOFF_FLOOR.md convention.
create or replace function public.admin_update_floor_work_order_items(p_work_order_id uuid, p_items jsonb, p_note text DEFAULT NULL::text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_item jsonb;
  v_sort integer := 0;
  v_keep_ids uuid[] := '{}';
  v_item_id uuid;
begin
  select * into v_actor from public.floor_staff_profiles where id = (select auth.uid()) and is_active and role = 'admin';
  if v_actor.id is null then raise exception 'admin permission required'; end if;

  select * into v_order from public.floor_work_orders where id = p_work_order_id and status <> 'cancelled' for update;
  if v_order.id is null then raise exception 'work order not found or cancelled'; end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'at least one material or equipment item is required'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'category','') not in ('floor_material','remnant','accessory','consumable','equipment','tool')
       or nullif(btrim(coalesce(v_item->>'itemName','')),'') is null
       or nullif(btrim(coalesce(v_item->>'unit','')),'') is null
       or coalesce((v_item->>'plannedQty')::numeric,-1) < 0 then
      raise exception 'invalid work order item';
    end if;

    v_item_id := nullif(v_item->>'id','')::uuid;
    if v_item_id is not null and exists (select 1 from public.floor_work_order_items where id = v_item_id and work_order_id = v_order.id) then
      update public.floor_work_order_items set
        category = v_item->>'category',
        item_name = btrim(v_item->>'itemName'),
        sku = nullif(btrim(coalesce(v_item->>'sku','')),''),
        specification = nullif(btrim(coalesce(v_item->>'specification','')),''),
        planned_qty = (v_item->>'plannedQty')::numeric,
        unit = btrim(v_item->>'unit'),
        source_type = coalesce(nullif(v_item->>'sourceType',''),'new'),
        note = nullif(btrim(coalesce(v_item->>'note','')),''),
        sort_order = v_sort,
        updated_at = now()
      where id = v_item_id;
      v_keep_ids := array_append(v_keep_ids, v_item_id);
    else
      insert into public.floor_work_order_items(work_order_id,category,item_name,sku,specification,planned_qty,unit,source_type,note,sort_order)
      values (v_order.id,v_item->>'category',btrim(v_item->>'itemName'),nullif(btrim(coalesce(v_item->>'sku','')),''),nullif(btrim(coalesce(v_item->>'specification','')),''),(v_item->>'plannedQty')::numeric,btrim(v_item->>'unit'),coalesce(nullif(v_item->>'sourceType',''),'new'),nullif(btrim(coalesce(v_item->>'note','')),''),v_sort)
      returning id into v_item_id;
      v_keep_ids := array_append(v_keep_ids, v_item_id);
    end if;
    v_sort := v_sort + 1;
  end loop;

  delete from public.floor_work_order_items where work_order_id = v_order.id and not (id = any(v_keep_ids));

  -- keep the head technician material plan in sync with the saved item list,
  -- so the technician's start gate reflects what is actually on the order
  insert into public.floor_job_materials(appointment_id,planned_sheet_count,planned_by,planned_at,updated_at)
  select v_order.appointment_id,
    coalesce(ceil(sum(planned_qty) filter (where category in ('floor_material','remnant') and unit in ('แผ่น','sheet','sheets'))),0)::integer,
    v_actor.full_name,now(),now()
  from public.floor_work_order_items where work_order_id = v_order.id
  on conflict (appointment_id) do update set
    planned_sheet_count = excluded.planned_sheet_count,
    planned_by = excluded.planned_by,
    planned_at = excluded.planned_at,
    updated_at = excluded.updated_at;

  insert into public.floor_work_order_events(work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note)
  values (v_order.id,'admin_items_updated',v_order.status,v_order.status,v_actor.id,v_actor.full_name,nullif(btrim(coalesce(p_note,'')),''));

  update public.floor_work_orders set updated_at = now() where id = v_order.id;

  return true;
end;
$function$;

revoke all on function public.admin_update_floor_work_order_items(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.admin_update_floor_work_order_items(uuid,jsonb,text) to authenticated;

-- one-off backfill: active work orders with items but no material plan row
insert into public.floor_job_materials(appointment_id,planned_sheet_count,planned_by,planned_at,updated_at)
select wo.appointment_id,
  coalesce(ceil(sum(i.planned_qty) filter (where i.category in ('floor_material','remnant') and i.unit in ('แผ่น','sheet','sheets'))),0)::integer,
  'ระบบ (backfill 2026-09-04: กู้แผนวัสดุจากรายการในใบสั่งงาน)',
  now(), now()
from public.floor_work_orders wo
join public.floor_work_order_items i on i.work_order_id = wo.id
left join public.floor_job_materials m on m.appointment_id = wo.appointment_id
where wo.status in ('warehouse_waiting','warehouse_preparing','ready_to_install','installing')
  and m.appointment_id is null
group by wo.appointment_id
on conflict (appointment_id) do nothing;

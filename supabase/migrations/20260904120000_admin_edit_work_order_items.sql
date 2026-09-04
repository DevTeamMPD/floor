-- Lets an admin correct a work order's material/equipment list at any status,
-- not just while it is still 'head_review'. Once a head technician confirms
-- an order it moves to warehouse_waiting/preparing/... and every item field
-- becomes read-only in the UI -- if the head technician missed items (or the
-- job was pushed forward with incomplete data, as happened for a live job
-- fixed manually on 2026-09-03), there was previously no way back short of a
-- direct database edit. This RPC is that recovery path, restricted to admins.
--
-- Unlike confirm_floor_work_order_v2 (which always deletes + reinserts the
-- full item set because it only ever runs against a fresh head-review draft),
-- this RPC diffs against what's already saved so it can preserve actual_qty
-- on items the warehouse already picked:
--   - an incoming item with an `id` matching an existing row updates that
--     row's planned fields only (actual_qty untouched)
--   - an incoming item with no `id` (or an id that doesn't match) inserts a
--     new row with actual_qty left null, since the warehouse hasn't picked it
--   - an existing row whose id is not present in the payload is deleted
--     (the admin removed that line)
create or replace function public.admin_update_floor_work_order_items(
  p_work_order_id uuid,
  p_items jsonb,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.floor_work_order_events(work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note)
  values (v_order.id,'admin_items_updated',v_order.status,v_order.status,v_actor.id,v_actor.full_name,nullif(btrim(coalesce(p_note,'')),''));

  update public.floor_work_orders set updated_at = now() where id = v_order.id;

  return true;
end;
$$;
revoke all on function public.admin_update_floor_work_order_items(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.admin_update_floor_work_order_items(uuid,jsonb,text) to authenticated;

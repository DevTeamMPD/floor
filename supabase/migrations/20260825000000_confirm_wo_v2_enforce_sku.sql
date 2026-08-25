-- Gap 4 (V3): บังคับ SKU สำหรับ floor_material ในระดับ DB (defense-in-depth)
-- floor_material ต้องมี SKU ยกเว้นทำเครื่องหมาย "อนุมัติ SKU นอกคลัง" (sourceType = 'other')
-- ใช้แล้วสด via Supabase MCP; ไฟล์นี้เก็บประวัติใน supabase/migrations
-- การเปลี่ยนแปลงเดียวจากเวอร์ชันก่อนหน้า = เพิ่ม block ตรวจ SKU ในลูป item (คอมเมนต์ "Gap 4")
create or replace function public.confirm_floor_work_order_v2(p_work_order_id uuid, p_items jsonb, p_note text default null)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.floor_work_orders%rowtype;
  v_appt public.appointments%rowtype;
  v_job public.install_jobs%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_item jsonb;
  v_sort integer := 0;
begin
  select * into v_actor from public.floor_staff_profiles where id = (select auth.uid()) and is_active and role in ('admin','head_technician');
  if v_actor.id is null then raise exception 'head technician permission required'; end if;
  select * into v_order from public.floor_work_orders where id = p_work_order_id and status in ('head_review','returned_sales') for update;
  if v_order.id is null then raise exception 'work order is not awaiting confirmation'; end if;
  select * into v_appt from public.appointments where id = v_order.appointment_id and status <> 'cancelled';
  select * into v_job from public.install_jobs where job_no = v_order.job_no;
  if v_appt.id is null or v_job.job_no is null then raise exception 'appointment or job not found'; end if;
  if nullif(btrim(coalesce(v_job.customer_name,'')),'') is null
     or nullif(btrim(coalesce(v_job.customer_phone,'')),'') is null
     or (nullif(btrim(coalesce(v_job.address,'')),'') is null and nullif(btrim(coalesce(v_job.location_url,'')),'') is null)
     or nullif(btrim(coalesce(v_job.product_name,v_appt.requirement,'')),'') is null then
    raise exception 'customer, phone, location and work specification are required';
  end if;
  if not exists (select 1 from public.appointment_technicians a where a.appointment_id = v_appt.id and a.is_active and a.is_lead) then
    raise exception 'lead technician assignment is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'at least one material or equipment item is required'; end if;

  delete from public.floor_work_order_items where work_order_id = v_order.id;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'category','') not in ('floor_material','remnant','accessory','consumable','equipment','tool')
       or nullif(btrim(coalesce(v_item->>'itemName','')),'') is null
       or nullif(btrim(coalesce(v_item->>'unit','')),'') is null
       or coalesce((v_item->>'plannedQty')::numeric,-1) < 0 then
      raise exception 'invalid work order item';
    end if;
    -- Gap 4: floor_material ต้องมี SKU ยกเว้นทำเครื่องหมายอนุมัติ SKU นอกคลัง (sourceType = 'other')
    if v_item->>'category' = 'floor_material'
       and coalesce(nullif(v_item->>'sourceType',''),'new') <> 'other'
       and nullif(btrim(coalesce(v_item->>'sku','')),'') is null then
      raise exception 'floor_material item requires SKU (or mark as approved out-of-stock)';
    end if;
    insert into public.floor_work_order_items(work_order_id,category,item_name,sku,specification,planned_qty,unit,source_type,note,sort_order)
    values (v_order.id,v_item->>'category',btrim(v_item->>'itemName'),nullif(btrim(coalesce(v_item->>'sku','')),''),nullif(btrim(coalesce(v_item->>'specification','')),''),(v_item->>'plannedQty')::numeric,btrim(v_item->>'unit'),coalesce(nullif(v_item->>'sourceType',''),'new'),nullif(btrim(coalesce(v_item->>'note','')),''),v_sort);
    v_sort := v_sort + 1;
  end loop;

  insert into public.floor_job_materials(appointment_id,planned_sheet_count,planned_by,planned_at,updated_at)
  select v_order.appointment_id,
    coalesce(ceil(sum(planned_qty) filter (where category in ('floor_material','remnant') and unit in ('แผ่น','sheet','sheets'))),0)::integer,
    v_actor.full_name,now(),now()
  from public.floor_work_order_items where work_order_id=v_order.id
  on conflict (appointment_id) do update set planned_sheet_count=excluded.planned_sheet_count,planned_by=excluded.planned_by,planned_at=excluded.planned_at,updated_at=excluded.updated_at;

  update public.floor_work_orders set status = 'warehouse_waiting', revision = revision + 1,
    confirmed_by = v_actor.id, confirmed_at = now(), note = nullif(btrim(coalesce(p_note,'')),''), updated_at = now()
  where id = v_order.id;
  update public.appointments set status = 'confirmed', confirmed_at = now() where id = v_order.appointment_id;
  update public.install_jobs set status = 'รอคลังรับงาน', waiting_on = 'คลังสินค้า', waiting_since = now(), flag_note = null, updated_at = now() where job_no = v_order.job_no;
  insert into public.floor_work_order_events(work_order_id,event_type,from_status,to_status,actor_staff_id,actor_name,note)
  values (v_order.id,'head_confirmed',v_order.status,'warehouse_waiting',v_actor.id,v_actor.full_name,nullif(btrim(coalesce(p_note,'')),''));
  return true;
end;
$function$;
revoke all on function public.confirm_floor_work_order_v2(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.confirm_floor_work_order_v2(uuid,jsonb,text) to authenticated;

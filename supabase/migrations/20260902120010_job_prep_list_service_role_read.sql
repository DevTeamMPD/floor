-- FloorNow P3-4 (2/4): ให้งานเช็คสต็อกตอนกลางคืนอ่านรายการของที่ต้องเตรียมผ่าน "ทางเดียว" เดิมได้
--
-- P3-7 ตั้งกติกาไว้ว่ารายการของที่ต้องเตรียมมีทางอ่านทางเดียวคือ public.get_job_prep_list
-- (supabase/migrations/20260902100100_job_prep_list_unified_read.sql)
-- แต่ด่านตรวจของมันคือ is_floor_staff_active() ซึ่งดูจาก auth.uid() เท่านั้น
-- งานเช็คสต็อกล่วงหน้าวิ่งจาก cron ไม่มี session ของคน จึงไม่มี auth.uid() และจะถูกปฏิเสธ
--
-- ทางเลือกที่ทิ้งไป: ให้ฟังก์ชันเช็คสต็อกอ่าน floor_work_order_items เอง
-- นั่นคือการสร้าง "ทางอ่านที่สอง" ของรายการเตรียมของ ซึ่งขัดกับสิ่งที่ P3-7 เพิ่งแก้ไป
-- และเมื่อไหร่ที่ตรรกะ fallback เปลี่ยน สองทางจะเพี้ยนจากกันเงียบ ๆ
--
-- ที่ทำแทน: เปลี่ยนเฉพาะ "ด่านตรวจ" ให้ยอมรับ service_role ด้วย โดยตัวฟังก์ชันเหมือนเดิมทุกบรรทัด
-- ไม่ได้เปิดสิทธิ์ใหม่ให้ใครในทางปฏิบัติ เพราะ service_role อ่านตารางเหล่านี้ได้อยู่แล้วโดยข้าม RLS
-- และ key ของ service_role อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยถูกส่งไปที่เบราว์เซอร์
-- สำหรับผู้ใช้ที่เป็นคน (anon / authenticated) เงื่อนไขไม่เปลี่ยนเลย

begin;

create or replace function public.get_job_prep_list(p_job_no text)
returns table (
  source text,
  item_id uuid,
  work_order_id uuid,
  category text,
  item_name text,
  sku text,
  specification text,
  planned_qty numeric,
  actual_qty numeric,
  unit text,
  source_type text,
  note text,
  sort_order integer,
  material_id uuid,
  item_kind text,
  template_item_id uuid,
  is_manual_override boolean,
  picked_qty numeric,
  returned_qty numeric,
  used_qty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_job_no text := btrim(coalesce(p_job_no, ''));
  v_wo public.floor_work_orders%rowtype;
  v_raw jsonb;
  v_plan jsonb;
  v_item_count integer := 0;
begin
  -- ด่านเดียวกับ RLS ของ floor_work_order_items: อ่านได้เฉพาะพนักงานที่ยัง active
  -- จำเป็นเพราะ security definer เดินข้าม RLS ไปแล้ว
  -- P3-4: เพิ่มกรณีงานเบื้องหลังที่วิ่งด้วย service_role (ไม่มี auth.uid() ให้ตรวจ) ผ่าน is_floor_stock_reader()
  -- สำหรับผู้เรียกที่เป็น "คน" เงื่อนไขยังเท่าเดิมทุกประการ คือต้องเป็นพนักงานที่ยัง active
  if not (select public.is_floor_stock_reader()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูรายการของที่ต้องเตรียมได้';
  end if;
  if v_job_no = '' then
    raise exception 'ต้องระบุเลขที่งาน (job_no)';
  end if;

  -- หาใบสั่งงานล่าสุดของงานนี้ ด้วยลำดับเดียวกับที่หน้าใบสั่งงานใช้อยู่เดิม
  select * into v_wo
    from public.floor_work_orders w
   where w.job_no = v_job_no
   order by w.created_at desc
   limit 1;

  -- งานที่ sync มาสมัยเก่าอาจมี job_no ของใบสั่งงานคนละค่า จึงไล่ผ่านนัดหมายของงานนี้แทน
  if v_wo.id is null then
    select w.* into v_wo
      from public.floor_work_orders w
      join public.appointments a on a.id = w.appointment_id
     where a.job_id = v_job_no
       and a.status <> 'cancelled'
     order by w.created_at desc
     limit 1;
  end if;

  if v_wo.id is not null then
    select count(*) into v_item_count
      from public.floor_work_order_items i
     where i.work_order_id = v_wo.id;
  end if;

  -- แหล่งที่ถือว่าถูกต้อง: มีบรรทัดจริงเมื่อไหร่ ใช้อันนี้อย่างเดียว ไม่ผสมกับ legacy
  if v_item_count > 0 then
    return query
      select 'work_order_item'::text,
             i.id, i.work_order_id, i.category, i.item_name, i.sku, i.specification,
             i.planned_qty, i.actual_qty, i.unit, i.source_type, i.note, i.sort_order,
             i.material_id, i.item_kind, i.template_item_id, i.is_manual_override,
             i.picked_qty, i.returned_qty, i.used_qty
        from public.floor_work_order_items i
       where i.work_order_id = v_wo.id
       order by i.sort_order, i.created_at;
    return;
  end if;

  -- ไม่มีบรรทัดจริงเท่านั้นจึงถอยไปอ่านแผนยุคเดิม
  select j.pick_plan into v_raw
    from public.install_jobs j
   where j.job_no = v_job_no;
  if v_raw is null then
    return;
  end if;

  -- job-drawer.tsx เขียน JSON.stringify(payload) ลงคอลัมน์ jsonb จึงได้ค่าเป็น "สตริงของ JSON"
  -- ต้องแกะอีกชั้น และต้องไม่ระเบิดถ้าข้อมูลเพี้ยน
  if jsonb_typeof(v_raw) = 'string' then
    begin
      v_plan := (v_raw #>> '{}')::jsonb;
    exception when others then
      v_plan := null;
    end;
  elsif jsonb_typeof(v_raw) = 'object' then
    v_plan := v_raw;
  else
    v_plan := null;
  end if;
  if v_plan is null or jsonb_typeof(v_plan) <> 'object' then
    return;
  end if;

  return query
    select 'pick_plan_legacy'::text,
           null::uuid,
           v_wo.id,
           r.category,
           r.item_name,
           null::text,
           r.specification,
           r.planned_qty,
           null::numeric,
           'แผ่น'::text,
           r.source_type,
           r.note,
           (row_number() over (order by r.grp, r.pos) - 1)::integer,
           null::uuid, null::text, null::uuid, false,
           null::numeric, null::numeric, null::numeric
      from (
        select 0 as grp,
               e.ordinality::integer as pos,
               'floor_material'::text as category,
               'วัสดุปูพื้น'::text as item_name,
               'หน้ากว้าง ' || coalesce(e.value->>'width', '—')
                 || ' ซม. × ยาว ' || coalesce(e.value->>'length_cm', '—') || ' ซม.' as specification,
               case
                 when jsonb_typeof(e.value->'qty') = 'number' then (e.value->>'qty')::numeric
                 when jsonb_typeof(e.value->'qty') = 'string'
                      and btrim(e.value->>'qty') ~ '^-?[0-9]+([.][0-9]+)?$' then btrim(e.value->>'qty')::numeric
                 else null
               end as planned_qty,
               'new'::text as source_type,
               coalesce(e.value->>'note', '') as note
          from jsonb_array_elements(
                 case when jsonb_typeof(v_plan->'newItems') = 'array' then v_plan->'newItems' else '[]'::jsonb end
               ) with ordinality e(value, ordinality)
         where jsonb_typeof(e.value) = 'object'
        union all
        select 1 as grp,
               e.ordinality::integer as pos,
               'remnant'::text as category,
               coalesce(e.value->>'mat_type', 'เศษวัสดุ') as item_name,
               'กว้าง ' || coalesce(e.value->>'width_bin', '—')
                 || ' × ยาว ' || coalesce(e.value->>'length_cm', '—') || ' ซม.' as specification,
               1::numeric as planned_qty,
               'remnant'::text as source_type,
               coalesce(e.value->>'note', '') as note
          from jsonb_array_elements(
                 case when jsonb_typeof(v_plan->'remnants') = 'array' then v_plan->'remnants' else '[]'::jsonb end
               ) with ordinality e(value, ordinality)
         where jsonb_typeof(e.value) = 'object'
      ) r
     order by r.grp, r.pos;
end;
$function$;

comment on function public.get_job_prep_list(text) is
  'ทางอ่านรายการของที่ต้องเตรียมของงานหนึ่งใบ ทางเดียว: ใช้ floor_work_order_items เป็นหลัก และถอยไป install_jobs.pick_plan (ยุคเดิม) เฉพาะเมื่อยังไม่มีบรรทัดจริง โดยติดป้าย source ทุกแถวว่ามาจากไหน อ่านอย่างเดียว ไม่แตะฝั่งเขียนของแหล่งใดเลย · P3-4 เปิดให้ service_role เรียกได้เพื่อให้งานเช็คสต็อกกลางคืนใช้ทางเดียวกัน';

revoke all on function public.get_job_prep_list(text) from public, anon;
grant execute on function public.get_job_prep_list(text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

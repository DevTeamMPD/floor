-- FloorNow P1: RPC จัดการ "แม่แบบประเภทงาน" (checklist ตรวจรับ + รายการเตรียมของ) + ทะเบียนเครื่องมือวัด
-- ตารางฐานสร้างไว้แล้วใน 20260901100000_job_templates_foundation.sql และปิดสิทธิ์เขียนของ
-- authenticated/anon ไว้ทั้งหมด (เขียนได้เฉพาะ service_role) — ไฟล์นี้เปิดช่องเขียนผ่าน RPC ที่เช็ค
-- role เท่านั้น เพื่อให้หัวหน้าช่าง (admin / head_technician) แก้แม่แบบเองได้โดยไม่ต้อง deploy โค้ด
-- ไฟล์นี้สร้างฟังก์ชันใหม่ทั้งหมด ไม่ drop/แก้ฟังก์ชันเดิมที่มีอยู่แล้ว
-- ห้าม apply จนกว่าจะได้รับการอนุมัติ

begin;

-- ============================================================================
-- 1) save_job_type — สร้าง/แก้ไขประเภทงาน (จุดยึดของแม่แบบทุกชนิด)
-- ============================================================================
create or replace function public.save_job_type(
  p_id uuid,
  p_code text,
  p_name text,
  p_task_field text,
  p_is_active boolean,
  p_sort_order integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_id uuid;
begin
  -- เฉพาะ admin / head_technician เท่านั้นที่แก้ทะเบียนประเภทงานได้
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะแก้ไขประเภทงานได้';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'ต้องระบุรหัสประเภทงาน (code)';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'ต้องระบุชื่อประเภทงาน (name)';
  end if;
  if p_task_field is not null and p_task_field not in ('ball_pit', 'workshop_set', 'gym', 'floor', 'other') then
    raise exception 'task_field ไม่ถูกต้อง: %', p_task_field;
  end if;

  if p_id is null then
    insert into public.job_types (code, name, task_field, is_active, sort_order, created_by, created_at, updated_at)
    values (btrim(p_code), btrim(p_name), p_task_field, coalesce(p_is_active, true), coalesce(p_sort_order, 0), v_actor.id, now(), now())
    returning id into v_id;
  else
    update public.job_types
    set code = btrim(p_code),
        name = btrim(p_name),
        task_field = p_task_field,
        is_active = coalesce(p_is_active, is_active),
        sort_order = coalesce(p_sort_order, sort_order),
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบประเภทงาน id=%', p_id;
    end if;
  end if;

  return v_id;
end;
$function$;

-- ============================================================================
-- 2) save_job_checklist_template — สร้าง/แก้แม่แบบเกณฑ์ตรวจรับ (มีเวอร์ชัน)
-- ============================================================================
create or replace function public.save_job_checklist_template(
  p_template_id uuid,
  p_job_type_id uuid,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_tpl public.job_checklist_templates%rowtype;
  v_job_type public.job_types%rowtype;
  v_new_id uuid;
  v_version integer;
  v_effective_job_type_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_action text;
  v_item_count integer;
  v_dup_codes text;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะแก้ไขแม่แบบเกณฑ์ตรวจรับได้';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ต้องมีรายการเกณฑ์ตรวจรับอย่างน้อย 1 รายการ';
  end if;

  -- กัน code ซ้ำกันเองใน p_items ก่อนชน unique constraint (template_id, code) ของ DB ตรง ๆ
  -- เพราะ error ดิบของ Postgres อ่านไม่รู้เรื่องบนมือถือ ขัดกับเป้าหมายที่หัวหน้าช่างต้องแก้แม่แบบเองได้
  select string_agg(distinct dup.code_val, ', ') into v_dup_codes
  from (
    select btrim(coalesce(elem->>'code', '')) as code_val
    from jsonb_array_elements(p_items) as elem
    group by btrim(coalesce(elem->>'code', ''))
    having count(*) > 1
  ) dup;
  if v_dup_codes is not null then
    raise exception 'มี code ซ้ำกันในรายการที่ส่งมา: %', v_dup_codes;
  end if;

  if p_template_id is null then
    -- สร้างแม่แบบใหม่ทั้งชุด: version = max(version ของ job_type นั้น) + 1 (ถ้ายังไม่มีเลยใช้ 1)
    if p_job_type_id is null then
      raise exception 'ต้องระบุ job_type_id เมื่อสร้างแม่แบบใหม่';
    end if;
    if not exists (select 1 from public.job_types where id = p_job_type_id) then
      raise exception 'ไม่พบประเภทงาน id=%', p_job_type_id;
    end if;
    v_effective_job_type_id := p_job_type_id;

    -- ล็อกระดับ job_type กันสองคนกดบันทึกพร้อมกันแล้วคำนวณ version ชนกัน (unique (job_type_id, version))
    -- ใช้ key เดียวกับสาขา active->new_version ด้านล่างและ copy_job_template เพื่อให้ล็อกกันเองทั้งหมด
    perform pg_advisory_xact_lock(hashtextextended('job_checklist_template_version:' || v_effective_job_type_id::text, 0));

    select coalesce(max(version), 0) + 1 into v_version
    from public.job_checklist_templates where job_type_id = v_effective_job_type_id;

    insert into public.job_checklist_templates (job_type_id, version, status, notes, created_by, created_at, updated_at)
    values (v_effective_job_type_id, v_version, 'draft', p_notes, v_actor.id, now(), now())
    returning id into v_new_id;

    v_action := 'create';
  else
    select * into v_tpl from public.job_checklist_templates where id = p_template_id for update;
    if v_tpl.id is null then
      raise exception 'ไม่พบแม่แบบเกณฑ์ตรวจรับ id=%', p_template_id;
    end if;
    -- job_type ของแม่แบบที่มีอยู่แล้วเปลี่ยนไม่ได้ผ่าน RPC นี้ (version ผูกกับ job_type เดิมเสมอ)
    if p_job_type_id is not null and p_job_type_id <> v_tpl.job_type_id then
      raise exception 'ไม่สามารถเปลี่ยนประเภทงานของแม่แบบที่มีอยู่แล้วได้';
    end if;
    v_effective_job_type_id := v_tpl.job_type_id;

    if v_tpl.status = 'retired' then
      raise exception 'แม่แบบนี้ถูกปลดระวางแล้ว ไม่สามารถแก้ไขได้';
    elsif v_tpl.status = 'draft' then
      -- แม่แบบยังไม่ถูกใช้งานจริง แก้ในที่ได้ทันที
      update public.job_checklist_templates
      set notes = p_notes, updated_at = now()
      where id = p_template_id;
      v_new_id := p_template_id;
      v_version := v_tpl.version;
      v_action := 'update';
    elsif v_tpl.status = 'active' then
      -- ห้ามแก้แม่แบบ active ในที่: ใบสั่งงานที่ตรวจรับไปแล้วต้องยึดเกณฑ์ "รุ่นที่ใช้ ณ ตอนนั้น"
      -- การแก้แม่แบบวันนี้ต้องไม่ย้อนไปเปลี่ยนเกณฑ์ของงานที่ตรวจไปแล้ว (ISO 7.5 การควบคุมเอกสาร)
      -- จึงต้องสร้าง version ใหม่เป็น draft แทน แล้วให้หัวหน้าช่าง activate เองอีกครั้งเมื่อพร้อม
      -- ล็อกระดับ job_type กันชนกับอีกคนที่กำลังบันทึก/คัดลอกแม่แบบของ job_type เดียวกันพร้อมกัน
      perform pg_advisory_xact_lock(hashtextextended('job_checklist_template_version:' || v_effective_job_type_id::text, 0));

      select coalesce(max(version), 0) + 1 into v_version
      from public.job_checklist_templates where job_type_id = v_effective_job_type_id;

      insert into public.job_checklist_templates (job_type_id, version, status, notes, created_by, created_at, updated_at)
      values (v_effective_job_type_id, v_version, 'draft', p_notes, v_actor.id, now(), now())
      returning id into v_new_id;

      v_action := 'new_version';
    else
      raise exception 'สถานะแม่แบบไม่ถูกต้อง: %', v_tpl.status;
    end if;
  end if;

  -- ลบ items เดิมทั้งหมดแล้วใส่ชุดใหม่ (ใช้ได้ทั้งกรณีสร้างแม่แบบใหม่และแก้ draft ในที่ เพราะ v_new_id
  -- เป็นแม่แบบที่เพิ่งสร้าง/เป็น draft เดิมที่ยังไม่ผูกกับงานที่ตรวจรับไปแล้วเท่านั้น)
  delete from public.job_checklist_template_items where template_id = v_new_id;

  v_idx := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    if nullif(btrim(coalesce(v_item->>'code', '')), '') is null then
      raise exception 'รายการที่ % : ต้องระบุ code', v_idx;
    end if;
    if nullif(btrim(coalesce(v_item->>'label', '')), '') is null then
      raise exception 'รายการที่ % : ต้องระบุ label', v_idx;
    end if;

    insert into public.job_checklist_template_items (
      template_id, code, label, spec_text, requires_photo, is_critical,
      measuring_device_kind, sort_order, is_active, created_at, updated_at
    ) values (
      v_new_id,
      btrim(v_item->>'code'),
      btrim(v_item->>'label'),
      nullif(btrim(coalesce(v_item->>'spec_text', '')), ''),
      coalesce((v_item->>'requires_photo')::boolean, false),
      coalesce((v_item->>'is_critical')::boolean, true),
      nullif(btrim(coalesce(v_item->>'measuring_device_kind', '')), ''),
      coalesce((v_item->>'sort_order')::integer, v_idx - 1),
      coalesce((v_item->>'is_active')::boolean, true),
      now(), now()
    );
  end loop;

  select * into v_job_type from public.job_types where id = v_effective_job_type_id;
  select count(*) into v_item_count from public.job_checklist_template_items where template_id = v_new_id;

  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  values (
    'checklist', v_new_id, v_version, v_action, v_actor.id, now(),
    jsonb_build_object('item_count', v_item_count, 'job_type_name', v_job_type.name, 'notes', p_notes)
  );

  return v_new_id;
end;
$function$;

-- ============================================================================
-- 3) activate_job_checklist_template — เปิดใช้งานแม่แบบ draft เป็น active
-- ============================================================================
create or replace function public.activate_job_checklist_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_tpl public.job_checklist_templates%rowtype;
  v_item_count integer;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะเปิดใช้งานแม่แบบได้';
  end if;

  select * into v_tpl from public.job_checklist_templates where id = p_template_id for update;
  if v_tpl.id is null then
    raise exception 'ไม่พบแม่แบบเกณฑ์ตรวจรับ id=%', p_template_id;
  end if;
  if v_tpl.status <> 'draft' then
    raise exception 'เปิดใช้งานได้เฉพาะแม่แบบสถานะ draft เท่านั้น (สถานะปัจจุบัน: %)', v_tpl.status;
  end if;

  -- นับเฉพาะ item ที่ is_active = true เท่านั้น เพราะถ้านับ item ที่ปิดใช้งานด้วยจะเปิดใช้งานแม่แบบที่
  -- ออกมาว่างเปล่าได้ ทำให้ด่านบังคับติ๊กครบก่อนปิดงาน (ISO 8.6) กลายเป็นด่านที่ผ่านฟรีโดยไม่มีใครรู้ตัว
  select count(*) into v_item_count from public.job_checklist_template_items
  where template_id = p_template_id and is_active;
  if v_item_count = 0 then
    raise exception 'แม่แบบต้องมีรายการเกณฑ์ตรวจรับที่เปิดใช้งาน (is_active) อย่างน้อย 1 รายการก่อนเปิดใช้งาน';
  end if;

  -- ปลดระวางแม่แบบ active เดิมของ job_type เดียวกัน — ให้มี active ได้ทีละ 1 เวอร์ชันต่อ job_type เสมอ
  update public.job_checklist_templates
  set status = 'retired', updated_at = now()
  where job_type_id = v_tpl.job_type_id and status = 'active';

  update public.job_checklist_templates
  set status = 'active', effective_from = now(), updated_at = now()
  where id = p_template_id;

  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  values ('checklist', p_template_id, v_tpl.version, 'activate', v_actor.id, now(), jsonb_build_object('item_count', v_item_count));
end;
$function$;

-- ============================================================================
-- 4) save_job_prep_template — สร้าง/แก้แม่แบบรายการเตรียมของ (กติกาเวอร์ชันเหมือนข้อ 2)
-- ============================================================================
create or replace function public.save_job_prep_template(
  p_template_id uuid,
  p_job_type_id uuid,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_tpl public.job_prep_templates%rowtype;
  v_job_type public.job_types%rowtype;
  v_new_id uuid;
  v_version integer;
  v_effective_job_type_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_action text;
  v_item_count integer;
  v_material_id uuid;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะแก้ไขแม่แบบรายการเตรียมของได้';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ต้องมีรายการเตรียมของอย่างน้อย 1 รายการ';
  end if;

  if p_template_id is null then
    if p_job_type_id is null then
      raise exception 'ต้องระบุ job_type_id เมื่อสร้างแม่แบบใหม่';
    end if;
    if not exists (select 1 from public.job_types where id = p_job_type_id) then
      raise exception 'ไม่พบประเภทงาน id=%', p_job_type_id;
    end if;
    v_effective_job_type_id := p_job_type_id;

    -- ล็อกระดับ job_type กันสองคนกดบันทึกพร้อมกันแล้วคำนวณ version ชนกัน (unique (job_type_id, version))
    -- ใช้ key เดียวกับสาขา active->new_version ด้านล่างและ copy_job_template เพื่อให้ล็อกกันเองทั้งหมด
    perform pg_advisory_xact_lock(hashtextextended('job_prep_template_version:' || v_effective_job_type_id::text, 0));

    select coalesce(max(version), 0) + 1 into v_version
    from public.job_prep_templates where job_type_id = v_effective_job_type_id;

    insert into public.job_prep_templates (job_type_id, version, status, notes, created_by, created_at, updated_at)
    values (v_effective_job_type_id, v_version, 'draft', p_notes, v_actor.id, now(), now())
    returning id into v_new_id;

    v_action := 'create';
  else
    select * into v_tpl from public.job_prep_templates where id = p_template_id for update;
    if v_tpl.id is null then
      raise exception 'ไม่พบแม่แบบรายการเตรียมของ id=%', p_template_id;
    end if;
    if p_job_type_id is not null and p_job_type_id <> v_tpl.job_type_id then
      raise exception 'ไม่สามารถเปลี่ยนประเภทงานของแม่แบบที่มีอยู่แล้วได้';
    end if;
    v_effective_job_type_id := v_tpl.job_type_id;

    if v_tpl.status = 'retired' then
      raise exception 'แม่แบบนี้ถูกปลดระวางแล้ว ไม่สามารถแก้ไขได้';
    elsif v_tpl.status = 'draft' then
      update public.job_prep_templates
      set notes = p_notes, updated_at = now()
      where id = p_template_id;
      v_new_id := p_template_id;
      v_version := v_tpl.version;
      v_action := 'update';
    elsif v_tpl.status = 'active' then
      -- ห้ามแก้แม่แบบ active ในที่ ด้วยเหตุผลเดียวกับแม่แบบเกณฑ์ตรวจรับ (ISO 7.5 การควบคุมเอกสาร):
      -- งานที่เตรียมของไปแล้วต้องยึดรายการเตรียมของ "รุ่นที่ใช้ ณ ตอนนั้น" จึงต้องสร้าง version ใหม่เป็น draft
      -- ล็อกระดับ job_type กันชนกับอีกคนที่กำลังบันทึก/คัดลอกแม่แบบของ job_type เดียวกันพร้อมกัน
      perform pg_advisory_xact_lock(hashtextextended('job_prep_template_version:' || v_effective_job_type_id::text, 0));

      select coalesce(max(version), 0) + 1 into v_version
      from public.job_prep_templates where job_type_id = v_effective_job_type_id;

      insert into public.job_prep_templates (job_type_id, version, status, notes, created_by, created_at, updated_at)
      values (v_effective_job_type_id, v_version, 'draft', p_notes, v_actor.id, now(), now())
      returning id into v_new_id;

      v_action := 'new_version';
    else
      raise exception 'สถานะแม่แบบไม่ถูกต้อง: %', v_tpl.status;
    end if;
  end if;

  delete from public.job_prep_template_items where template_id = v_new_id;

  v_idx := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    if nullif(btrim(coalesce(v_item->>'item_name', '')), '') is null then
      raise exception 'รายการที่ % : ต้องระบุ item_name', v_idx;
    end if;
    if coalesce(v_item->>'item_kind', '') not in ('consumable', 'tool') then
      raise exception 'รายการที่ % : item_kind ต้องเป็น consumable หรือ tool', v_idx;
    end if;
    if coalesce(v_item->>'calc_mode', '') not in ('fixed', 'per_sqm', 'per_unit') then
      raise exception 'รายการที่ % : calc_mode ต้องเป็น fixed, per_sqm หรือ per_unit', v_idx;
    end if;
    if coalesce((v_item->>'calc_qty')::numeric, 0) <= 0 then
      raise exception 'รายการที่ % : calc_qty ต้องมากกว่า 0', v_idx;
    end if;
    if coalesce((v_item->>'waste_pct')::numeric, 0) < 0 or coalesce((v_item->>'waste_pct')::numeric, 0) > 100 then
      raise exception 'รายการที่ % : waste_pct ต้องอยู่ระหว่าง 0-100', v_idx;
    end if;

    v_material_id := nullif(v_item->>'material_id', '')::uuid;

    insert into public.job_prep_template_items (
      template_id, material_id, item_name, unit, item_kind, calc_mode, calc_qty,
      waste_pct, is_required, note, sort_order, created_at, updated_at
    ) values (
      v_new_id,
      v_material_id,
      btrim(v_item->>'item_name'),
      nullif(btrim(coalesce(v_item->>'unit', '')), ''),
      v_item->>'item_kind',
      v_item->>'calc_mode',
      (v_item->>'calc_qty')::numeric,
      coalesce((v_item->>'waste_pct')::numeric, 0),
      coalesce((v_item->>'is_required')::boolean, true),
      nullif(btrim(coalesce(v_item->>'note', '')), ''),
      coalesce((v_item->>'sort_order')::integer, v_idx - 1),
      now(), now()
    );
  end loop;

  select * into v_job_type from public.job_types where id = v_effective_job_type_id;
  select count(*) into v_item_count from public.job_prep_template_items where template_id = v_new_id;

  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  values (
    'prep', v_new_id, v_version, v_action, v_actor.id, now(),
    jsonb_build_object('item_count', v_item_count, 'job_type_name', v_job_type.name, 'notes', p_notes)
  );

  return v_new_id;
end;
$function$;

-- ============================================================================
-- 5) activate_job_prep_template — เปิดใช้งานแม่แบบ draft เป็น active (เหมือนข้อ 3)
-- ============================================================================
create or replace function public.activate_job_prep_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_tpl public.job_prep_templates%rowtype;
  v_item_count integer;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะเปิดใช้งานแม่แบบได้';
  end if;

  select * into v_tpl from public.job_prep_templates where id = p_template_id for update;
  if v_tpl.id is null then
    raise exception 'ไม่พบแม่แบบรายการเตรียมของ id=%', p_template_id;
  end if;
  if v_tpl.status <> 'draft' then
    raise exception 'เปิดใช้งานได้เฉพาะแม่แบบสถานะ draft เท่านั้น (สถานะปัจจุบัน: %)', v_tpl.status;
  end if;

  select count(*) into v_item_count from public.job_prep_template_items where template_id = p_template_id;
  if v_item_count = 0 then
    raise exception 'แม่แบบต้องมีรายการเตรียมของอย่างน้อย 1 รายการก่อนเปิดใช้งาน';
  end if;

  update public.job_prep_templates
  set status = 'retired', updated_at = now()
  where job_type_id = v_tpl.job_type_id and status = 'active';

  update public.job_prep_templates
  set status = 'active', effective_from = now(), updated_at = now()
  where id = p_template_id;

  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  values ('prep', p_template_id, v_tpl.version, 'activate', v_actor.id, now(), jsonb_build_object('item_count', v_item_count));
end;
$function$;

-- ============================================================================
-- 6) copy_job_template — คัดลอกแม่แบบ (พร้อม items) เป็น draft เวอร์ชันใหม่ของ job_type ปลายทาง
--    p_target_job_type_id เป็น null = คัดลอกไปที่ job_type เดิม (ทำสำเนาไว้แก้)
-- ============================================================================
create or replace function public.copy_job_template(
  p_kind text,
  p_source_template_id uuid,
  p_target_job_type_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_target_job_type_id uuid;
  v_version integer;
  v_new_id uuid;
  v_item_count integer;
  v_source_checklist public.job_checklist_templates%rowtype;
  v_source_prep public.job_prep_templates%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะคัดลอกแม่แบบได้';
  end if;

  if p_kind not in ('checklist', 'prep') then
    raise exception 'p_kind ต้องเป็น checklist หรือ prep';
  end if;

  if p_kind = 'checklist' then
    select * into v_source_checklist from public.job_checklist_templates where id = p_source_template_id;
    if v_source_checklist.id is null then
      raise exception 'ไม่พบแม่แบบต้นทาง id=%', p_source_template_id;
    end if;
    v_target_job_type_id := coalesce(p_target_job_type_id, v_source_checklist.job_type_id);
    if not exists (select 1 from public.job_types where id = v_target_job_type_id) then
      raise exception 'ไม่พบประเภทงานปลายทาง id=%', v_target_job_type_id;
    end if;

    -- ล็อกด้วย key เดียวกับ save_job_checklist_template กันชนกับการบันทึก/คัดลอกพร้อมกันของ job_type เดียวกัน
    perform pg_advisory_xact_lock(hashtextextended('job_checklist_template_version:' || v_target_job_type_id::text, 0));

    select coalesce(max(version), 0) + 1 into v_version
    from public.job_checklist_templates where job_type_id = v_target_job_type_id;

    insert into public.job_checklist_templates (job_type_id, version, status, notes, created_by, created_at, updated_at)
    values (v_target_job_type_id, v_version, 'draft', v_source_checklist.notes, v_actor.id, now(), now())
    returning id into v_new_id;

    insert into public.job_checklist_template_items (
      template_id, code, label, spec_text, requires_photo, is_critical,
      measuring_device_kind, sort_order, is_active, created_at, updated_at
    )
    select v_new_id, code, label, spec_text, requires_photo, is_critical,
      measuring_device_kind, sort_order, is_active, now(), now()
    from public.job_checklist_template_items
    where template_id = p_source_template_id;

    select count(*) into v_item_count from public.job_checklist_template_items where template_id = v_new_id;

    insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
    values ('checklist', v_new_id, v_version, 'copy', v_actor.id, now(),
      jsonb_build_object('source_template_id', p_source_template_id, 'item_count', v_item_count));
  else
    select * into v_source_prep from public.job_prep_templates where id = p_source_template_id;
    if v_source_prep.id is null then
      raise exception 'ไม่พบแม่แบบต้นทาง id=%', p_source_template_id;
    end if;
    v_target_job_type_id := coalesce(p_target_job_type_id, v_source_prep.job_type_id);
    if not exists (select 1 from public.job_types where id = v_target_job_type_id) then
      raise exception 'ไม่พบประเภทงานปลายทาง id=%', v_target_job_type_id;
    end if;

    -- ล็อกด้วย key เดียวกับ save_job_prep_template กันชนกับการบันทึก/คัดลอกพร้อมกันของ job_type เดียวกัน
    perform pg_advisory_xact_lock(hashtextextended('job_prep_template_version:' || v_target_job_type_id::text, 0));

    select coalesce(max(version), 0) + 1 into v_version
    from public.job_prep_templates where job_type_id = v_target_job_type_id;

    insert into public.job_prep_templates (job_type_id, version, status, notes, created_by, created_at, updated_at)
    values (v_target_job_type_id, v_version, 'draft', v_source_prep.notes, v_actor.id, now(), now())
    returning id into v_new_id;

    insert into public.job_prep_template_items (
      template_id, material_id, item_name, unit, item_kind, calc_mode, calc_qty,
      waste_pct, is_required, note, sort_order, created_at, updated_at
    )
    select v_new_id, material_id, item_name, unit, item_kind, calc_mode, calc_qty,
      waste_pct, is_required, note, sort_order, now(), now()
    from public.job_prep_template_items
    where template_id = p_source_template_id;

    select count(*) into v_item_count from public.job_prep_template_items where template_id = v_new_id;

    insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
    values ('prep', v_new_id, v_version, 'copy', v_actor.id, now(),
      jsonb_build_object('source_template_id', p_source_template_id, 'item_count', v_item_count));
  end if;

  return v_new_id;
end;
$function$;

-- ============================================================================
-- 7) save_measuring_device — สร้าง/แก้ทะเบียนเครื่องมือวัด (ISO 7.1.5)
--    next_due_at คำนวณจาก last_calibrated_at + calibration_interval_days (ถ้าค่าใดว่าง = null)
--    status: 'due' ถ้าเลยกำหนด · 'ok' ถ้ายังไม่เลยกำหนด · ไม่แตะ 'out_of_service' เพราะตั้งด้วยมือ
-- ============================================================================
create or replace function public.save_measuring_device(
  p_id uuid,
  p_code text,
  p_kind text,
  p_owner_team_id uuid,
  p_range_text text,
  p_resolution_text text,
  p_last_calibrated_at date,
  p_calibration_interval_days integer,
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_existing public.measuring_devices%rowtype;
  v_id uuid;
  v_next_due_at date;
  v_status text;
begin
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะแก้ไขทะเบียนเครื่องมือวัดได้';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'ต้องระบุรหัสเครื่องมือวัด (code)';
  end if;
  if p_kind is null or btrim(p_kind) = '' then
    raise exception 'ต้องระบุชนิดเครื่องมือวัด (kind)';
  end if;

  if p_last_calibrated_at is not null and p_calibration_interval_days is not null then
    v_next_due_at := p_last_calibrated_at + p_calibration_interval_days;
  else
    v_next_due_at := null;
  end if;

  if p_id is not null then
    select * into v_existing from public.measuring_devices where id = p_id;
    if v_existing.id is null then
      raise exception 'ไม่พบเครื่องมือวัด id=%', p_id;
    end if;
  end if;

  -- out_of_service ตั้งด้วยมือเท่านั้น หากของเดิมเป็น out_of_service ให้คงไว้ ไม่คำนวณทับ
  if v_existing.status = 'out_of_service' then
    v_status := 'out_of_service';
  elsif v_next_due_at is not null and v_next_due_at < current_date then
    v_status := 'due';
  else
    v_status := 'ok';
  end if;

  if p_id is null then
    insert into public.measuring_devices (
      code, kind, owner_team_id, range_text, resolution_text,
      last_calibrated_at, calibration_interval_days, next_due_at, status, note,
      created_at, updated_at
    ) values (
      btrim(p_code), btrim(p_kind), p_owner_team_id, p_range_text, p_resolution_text,
      p_last_calibrated_at, p_calibration_interval_days, v_next_due_at, v_status, p_note,
      now(), now()
    ) returning id into v_id;
  else
    update public.measuring_devices
    set code = btrim(p_code),
        kind = btrim(p_kind),
        owner_team_id = p_owner_team_id,
        range_text = p_range_text,
        resolution_text = p_resolution_text,
        last_calibrated_at = p_last_calibrated_at,
        calibration_interval_days = p_calibration_interval_days,
        next_due_at = v_next_due_at,
        status = v_status,
        note = p_note,
        updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$function$;

-- ============================================================================
-- สิทธิ์การเรียกใช้: authenticated เท่านั้น (การเช็ค role จริงอยู่ในตัวฟังก์ชันแต่ละอัน)
-- ============================================================================
revoke all on function public.save_job_type(uuid, text, text, text, boolean, integer) from public, anon;
revoke all on function public.save_job_checklist_template(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.activate_job_checklist_template(uuid) from public, anon;
revoke all on function public.save_job_prep_template(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.activate_job_prep_template(uuid) from public, anon;
revoke all on function public.copy_job_template(text, uuid, uuid) from public, anon;
revoke all on function public.save_measuring_device(uuid, text, text, uuid, text, text, date, integer, text) from public, anon;

grant execute on function public.save_job_type(uuid, text, text, text, boolean, integer) to authenticated;
grant execute on function public.save_job_checklist_template(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.activate_job_checklist_template(uuid) to authenticated;
grant execute on function public.save_job_prep_template(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.activate_job_prep_template(uuid) to authenticated;
grant execute on function public.copy_job_template(text, uuid, uuid) to authenticated;
grant execute on function public.save_measuring_device(uuid, text, text, uuid, text, text, date, integer, text) to authenticated;

commit;

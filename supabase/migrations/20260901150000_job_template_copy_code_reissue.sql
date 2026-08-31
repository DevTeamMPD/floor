-- FloorNow P1: แก้ copy_job_template ไม่ให้คัดลอก code ของเกณฑ์ตรวจรับข้ามประเภทงานแบบดิบ ๆ
--
-- ที่มา: final review ข้อ 1 (Critical) — copy_job_template สาขา checklist ทำ
-- `insert ... select v_new_id, code, ... from job_checklist_template_items` คือยก code ต้นทางมาทั้งดุ้น
-- โดยไม่สนว่าประเภทงานปลายทางเคยใช้ code เหล่านั้นกับเกณฑ์คนละข้อไปแล้วหรือยัง
-- ผลคือประเภทงานปลายทางมี QC01 ที่หมายถึงเกณฑ์สองข้อคนละเรื่องพร้อมกัน (unique (template_id, code)
-- เป็นระดับแม่แบบ จึงไม่ดักให้) แล้ว job_acceptance_results.item_code ที่ใช้ตอบว่า
-- "เกณฑ์ข้อไหนตกบ่อยที่สุด" (ISO 9.1.3) จะรวมข้อมูลคนละเกณฑ์เข้าด้วยกันเงียบ ๆ
--
-- กติกาใหม่: คัดลอกภายในประเภทงานเดิม = คง code เดิมทุกข้อ (เป็นเกณฑ์ข้อเดียวกัน ต้องต่อเนื่องข้ามเวอร์ชัน)
--            คัดลอกข้ามประเภทงาน = ออก code ใหม่ทุกข้อ ต่อจาก max ของประเภทงานปลายทาง
--            ด้วยตรรกะเดียวกับ save_job_checklist_template และเก็บตารางแปลง code เดิม->ใหม่ ไว้ใน
--            job_template_revisions.diff.code_map เพื่อสืบย้อนได้
--
-- คัดลอกฟังก์ชัน copy_job_template ทั้งตัวมาจาก 20260901120000_job_template_rpcs.sql (ลายเซ็นเดิมเป๊ะ)
-- แล้วแก้เฉพาะสาขา checklist ตามข้างบน — สาขา prep ไม่เปลี่ยน (job_prep_template_items ไม่มีคอลัมน์ code)
-- ไม่แก้ไฟล์ migration เดิมที่ apply ไปแล้ว

begin;

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
  v_max_code_seq integer;
  v_code_map jsonb;
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

    if v_target_job_type_id = v_source_checklist.job_type_id then
      -- คัดลอกภายในประเภทงานเดิม (ทำสำเนาไว้แก้เป็นเวอร์ชันใหม่) — ต้องคง code เดิมไว้ทุกข้อ
      -- เพราะเป็นเกณฑ์ข้อเดียวกันของประเภทงานเดียวกัน สถิติ job_acceptance_results.item_code
      -- ต้องต่อเนื่องข้ามเวอร์ชัน (ISO 9.1.3)
      v_code_map := null;

      insert into public.job_checklist_template_items (
        template_id, code, label, spec_text, requires_photo, is_critical,
        measuring_device_kind, sort_order, is_active, created_at, updated_at
      )
      select v_new_id, code, label, spec_text, requires_photo, is_critical,
        measuring_device_kind, sort_order, is_active, now(), now()
      from public.job_checklist_template_items
      where template_id = p_source_template_id;
    else
      -- คัดลอกข้ามประเภทงาน — ห้ามคัดลอก code มาตรง ๆ เด็ดขาด เพราะ code เป็นตัวระบุถาวร
      -- "ภายในประเภทงานหนึ่ง" ถ้าประเภทงานปลายทางเคยใช้ QC01 กับเกณฑ์คนละข้อไปแล้ว การคัดลอกดิบ ๆ
      -- จะทำให้ QC01 ของประเภทงานนั้นมีสองความหมายพร้อมกัน แล้วรายงาน "เกณฑ์ข้อไหนตกบ่อยที่สุด"
      -- จะรวมข้อมูลคนละเรื่องเข้าด้วยกันเงียบ ๆ โดยไม่มีสัญญาณเตือน (ตรวจพบใน review รอบสุดท้าย)
      -- จึงต้องออก code ใหม่ต่อจากเลขสูงสุดของประเภทงานปลายทาง ด้วยตรรกะเดียวกับ
      -- save_job_checklist_template (20260901140000_job_template_code_assignment.sql)
      -- คือดูจากทุก item ของทุกเวอร์ชันของประเภทงานปลายทาง ไม่ใช่แค่แม่แบบใดแม่แบบหนึ่ง
      -- และเดินหน้าต่อเสมอ ไม่นำเลขที่เคยใช้แล้วกลับมาใช้ซ้ำ
      -- (advisory lock ด้านบนเป็น key เดียวกับที่ save_job_checklist_template ใช้ จึงกัน race ได้จริง)
      select coalesce(max((regexp_match(i.code, '^QC(\d+)$'))[1]::integer), 0) into v_max_code_seq
      from public.job_checklist_template_items i
      join public.job_checklist_templates t on t.id = i.template_id
      where t.job_type_id = v_target_job_type_id;

      -- ทำตารางแปลง code เดิม -> code ใหม่ก่อน แล้วใช้ตารางเดียวกันนี้ทั้งตอน insert และตอนบันทึกประวัติ
      -- เพื่อให้สองที่ตรงกันเสมอ และสืบย้อนได้ว่าเกณฑ์ข้อไหนของต้นทางกลายเป็น code ใหม่ตัวไหน
      select jsonb_object_agg(s.code, 'QC' || lpad((v_max_code_seq + s.rn)::text, 2, '0'))
      into v_code_map
      from (
        select code, row_number() over (order by sort_order, code, id) as rn
        from public.job_checklist_template_items
        where template_id = p_source_template_id
      ) s;

      insert into public.job_checklist_template_items (
        template_id, code, label, spec_text, requires_photo, is_critical,
        measuring_device_kind, sort_order, is_active, created_at, updated_at
      )
      select v_new_id, v_code_map->>code, label, spec_text, requires_photo, is_critical,
        measuring_device_kind, sort_order, is_active, now(), now()
      from public.job_checklist_template_items
      where template_id = p_source_template_id;
    end if;

    select count(*) into v_item_count from public.job_checklist_template_items where template_id = v_new_id;

    insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
    values ('checklist', v_new_id, v_version, 'copy', v_actor.id, now(),
      jsonb_build_object(
        'source_template_id', p_source_template_id,
        'item_count', v_item_count,
        'code_reissued', (v_code_map is not null),
        'code_map', v_code_map
      ));
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

commit;

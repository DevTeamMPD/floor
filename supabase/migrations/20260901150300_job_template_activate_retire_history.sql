-- FloorNow P1: บันทึก "การปลดระวางเวอร์ชันเดิม" ลงประวัติแม่แบบด้วย ไม่ใช่บันทึกเฉพาะการเปิดใช้งาน
--
-- ที่มา: final review ข้อ 11 (Minor) — activate_job_checklist_template / activate_job_prep_template
-- สั่ง update สถานะแม่แบบ active เดิมเป็น retired แล้วบันทึก job_template_revisions ให้เฉพาะแม่แบบที่
-- เพิ่ง activate ประวัติจึงตอบไม่ได้ว่า "v1 ถูกปลดระวางเมื่อไหร่ โดยใคร" ทั้งที่ตาม ISO 7.5
-- การปลดระวางเอกสารเป็นเหตุการณ์ที่ต้องมีหลักฐานเท่ากับการประกาศใช้
--
-- คัดลอกทั้งสองฟังก์ชันมาจาก 20260901120000_job_template_rpcs.sql (ลายเซ็นเดิมเป๊ะ) แล้วแก้จุดเดียว
-- คือเปลี่ยนคำสั่ง update ...set status='retired' ให้เป็น CTE ที่ returning แถวที่ถูกปลดระวางออกมา
-- แล้ว insert เป็น revision action='retire' ในคำสั่งเดียวกัน — พฤติกรรมอื่นทั้งหมดไม่เปลี่ยน
-- ไม่แก้ไฟล์ migration เดิมที่ apply ไปแล้ว

begin;

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

  -- ปลดระวางแม่แบบ active เดิมของ job_type เดียวกัน แล้ว "บันทึกการปลดระวางลงประวัติด้วย"
  -- ตาม ISO 7.5 การปลดระวางเอกสารเป็นเหตุการณ์ที่ต้องมีหลักฐานเท่ากับการประกาศใช้ ต้องตอบได้ว่า
  -- v1 ถูกปลดระวางเมื่อไหร่ โดยใคร และเพราะเวอร์ชันไหนมาแทน — ใช้ CTE เพื่อให้การอัปเดตสถานะกับ
  -- การบันทึกประวัติเป็นคำสั่งเดียวกัน ไม่มีทางที่อย่างหนึ่งสำเร็จแล้วอีกอย่างไม่เกิด
  with retired as (
    update public.job_checklist_templates
    set status = 'retired', updated_at = now()
    where job_type_id = v_tpl.job_type_id and status = 'active'
    returning id, version
  )
  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  select 'checklist', r.id, r.version, 'retire', v_actor.id, now(),
    jsonb_build_object('replaced_by_template_id', p_template_id, 'replaced_by_version', v_tpl.version)
  from retired r;

  update public.job_checklist_templates
  set status = 'active', effective_from = now(), updated_at = now()
  where id = p_template_id;

  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  values ('checklist', p_template_id, v_tpl.version, 'activate', v_actor.id, now(), jsonb_build_object('item_count', v_item_count));
end;
$function$;

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

  -- ปลดระวางแม่แบบ active เดิมของ job_type เดียวกัน แล้ว "บันทึกการปลดระวางลงประวัติด้วย"
  -- ตาม ISO 7.5 การปลดระวางเอกสารเป็นเหตุการณ์ที่ต้องมีหลักฐานเท่ากับการประกาศใช้ ต้องตอบได้ว่า
  -- v1 ถูกปลดระวางเมื่อไหร่ โดยใคร และเพราะเวอร์ชันไหนมาแทน — ใช้ CTE เพื่อให้การอัปเดตสถานะกับ
  -- การบันทึกประวัติเป็นคำสั่งเดียวกัน ไม่มีทางที่อย่างหนึ่งสำเร็จแล้วอีกอย่างไม่เกิด
  with retired as (
    update public.job_prep_templates
    set status = 'retired', updated_at = now()
    where job_type_id = v_tpl.job_type_id and status = 'active'
    returning id, version
  )
  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  select 'prep', r.id, r.version, 'retire', v_actor.id, now(),
    jsonb_build_object('replaced_by_template_id', p_template_id, 'replaced_by_version', v_tpl.version)
  from retired r;

  update public.job_prep_templates
  set status = 'active', effective_from = now(), updated_at = now()
  where id = p_template_id;

  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, changed_at, diff)
  values ('prep', p_template_id, v_tpl.version, 'activate', v_actor.id, now(), jsonb_build_object('item_count', v_item_count));
end;
$function$;

commit;

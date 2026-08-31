-- FloorNow P1: แก้ save_job_checklist_template ให้ฝั่งฐานข้อมูลเป็นผู้กำหนด code ของข้อเกณฑ์
-- ตรวจรับที่ไม่ได้ส่ง code มา แทนที่จะให้ฝั่งหน้าจอ generate เอง
--
-- ที่มา: review รอบ 2 ของ T4b (app/(admin)/job-templates/page.tsx) พบว่า code ต้องเป็นตัวระบุคงที่
-- ข้ามเวลา/เวอร์ชัน เพราะผูกกับ job_acceptance_results.item_code สำหรับสถิติ "เกณฑ์ข้อไหนตกบ่อยที่สุด"
-- (ISO 9.1.3) ฝั่งหน้าจอมองเห็นแค่ item ของเวอร์ชันที่เปิดอยู่ ไม่เห็นเวอร์ชันอื่นของ job_type เดียวกัน
-- และไม่เห็น job_acceptance_results เลย ต่อให้แก้ให้ query เพิ่มก็ยังมีช่องที่สองคนกดบันทึกพร้อมกัน
-- แล้วได้ code ซ้ำกัน (เช่น ลบ QC15 แล้วเพิ่มข้อใหม่ในการแก้ครั้งเดียวกัน) จึงย้ายการตัดสินใจนี้มาไว้
-- ที่ฝั่งฐานข้อมูลซึ่งมองเห็นข้อมูลครบและล็อกกันการชนกันได้จริง
--
-- คัดลอกฟังก์ชัน save_job_checklist_template ทั้งตัวมาจาก 20260901120000_job_template_rpcs.sql
-- (ลายเซ็นเดิมเป๊ะ ไม่เปลี่ยน) แล้วแก้เฉพาะ 3 จุด: (1) เพิ่มตัวแปร local 2 ตัว (2) เช็ค code ซ้ำกันเอง
-- ใน p_items เฉพาะ item ที่ส่ง code มา (3) คำนวณ+กำหนด code อัตโนมัติให้ item ที่ไม่ได้ส่ง code มา
-- โดยดูจากทุก item ของทุกเวอร์ชันของ job_type เดียวกัน ไม่ใช่แค่แม่แบบที่กำลังแก้ — พฤติกรรมอื่นทั้งหมด
-- ของฟังก์ชัน (การเช็คสิทธิ์, การคำนวณ version, การ fork เมื่อแก้แม่แบบ active, การบันทึกประวัติ ฯลฯ)
-- ไม่เปลี่ยนแปลง ไม่แก้ไฟล์ 20260901120000_job_template_rpcs.sql เดิม (apply ไปแล้ว)
--
-- ห้าม apply จนกว่าจะได้รับการอนุมัติ

begin;

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
  v_max_code_seq integer;
  v_item_code text;
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
  -- เช็คเฉพาะ item ที่ส่ง code มาเอง (ไม่ว่าง) เท่านั้น — item ที่ไม่ได้ส่ง code (ข้อใหม่จากฟอร์ม)
  -- จะถูกกำหนด code ให้อัตโนมัติด้านล่าง จึงไม่มีทางซ้ำกันเองอยู่แล้ว
  select string_agg(distinct dup.code_val, ', ') into v_dup_codes
  from (
    select btrim(elem->>'code') as code_val
    from jsonb_array_elements(p_items) as elem
    where nullif(btrim(coalesce(elem->>'code', '')), '') is not null
    group by btrim(elem->>'code')
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

  -- ล็อกระดับ job_type ก่อนคำนวณ code อัตโนมัติด้านล่าง กันสองคนกดบันทึกพร้อมกันแล้วได้เลขเดียวกัน
  -- (key เดียวกับตอนคำนวณ version ด้านบน — เรียกซ้ำในทรานแซกชันเดียวกันได้ ไม่ block ตัวเอง และครอบคลุม
  -- สาขา "แก้ draft ในที่" ด้านบนที่เดิมไม่มีการล็อกนี้มาก่อนด้วย)
  perform pg_advisory_xact_lock(hashtextextended('job_checklist_template_version:' || v_effective_job_type_id::text, 0));

  -- หาเลขต่อท้ายสูงสุดของ code รูปแบบ QC<ตัวเลข> จาก "ทุก item ของทุกแม่แบบ (ทุกเวอร์ชัน) ของ job_type
  -- นี้" ไม่ใช่แค่แม่แบบที่กำลังแก้อยู่ — เพราะ code ต้องเป็นตัวระบุที่ไม่ถูกใช้ซ้ำข้ามเวลา/ข้ามเวอร์ชัน
  -- ผูกกับ job_acceptance_results.item_code ที่ใช้ตอบคำถามว่าเกณฑ์ข้อไหนตกบ่อยที่สุด (ISO 9.1.3)
  -- เวอร์ชันเก่าไม่เคยถูกลบจริง item ของมันจึงยังอยู่ในตารางเสมอ ดังนั้น code ที่เคยถูกใช้ในเวอร์ชัน
  -- ก่อนหน้าจะยังปรากฏอยู่ในผลลัพธ์นี้ และจะไม่ถูกนำกลับมาใช้ซ้ำ แม้ item ที่มี code นั้นจะถูกลบออกจาก
  -- ฉบับร่างที่กำลังแก้อยู่ในการบันทึกครั้งนี้ก็ตาม — จุดที่ตัดสินใจเรื่องนี้ได้ถูกต้องต้องเป็นฐานข้อมูล
  -- เท่านั้น เพราะฝั่งหน้าจอมองเห็นแค่ item ของเวอร์ชันที่เปิดอยู่ ไม่เห็นเวอร์ชันอื่นของ job_type เดียวกัน
  select coalesce(max((regexp_match(i.code, '^QC(\d+)$'))[1]::integer), 0) into v_max_code_seq
  from public.job_checklist_template_items i
  join public.job_checklist_templates t on t.id = i.template_id
  where t.job_type_id = v_effective_job_type_id;

  -- ลบ items เดิมทั้งหมดแล้วใส่ชุดใหม่ (ใช้ได้ทั้งกรณีสร้างแม่แบบใหม่และแก้ draft ในที่ เพราะ v_new_id
  -- เป็นแม่แบบที่เพิ่งสร้าง/เป็น draft เดิมที่ยังไม่ผูกกับงานที่ตรวจรับไปแล้วเท่านั้น)
  delete from public.job_checklist_template_items where template_id = v_new_id;

  v_idx := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    if nullif(btrim(coalesce(v_item->>'label', '')), '') is null then
      raise exception 'รายการที่ % : ต้องระบุ label', v_idx;
    end if;

    -- ถ้า item ส่ง code มา (ไม่ว่าง) ใช้ค่านั้นตามเดิมเสมอ — เป็นข้อที่มีอยู่แล้วใน DB, code ต้องคงที่
    -- ข้ามเวลา/เวอร์ชัน ไม่ว่าจะถูกเลื่อนลำดับหรือย้ายตำแหน่งในฟอร์มแค่ไหนก็ตาม
    -- ถ้าไม่ได้ส่ง code มา (ข้อใหม่ที่เพิ่งเพิ่มในฟอร์ม) กำหนดให้อัตโนมัติ เดินหน้าต่อจากเลขสูงสุดที่
    -- คำนวณไว้ข้างบน ห้ามให้ฝั่งหน้าจอเป็นคนกำหนดเลขเองเด็ดขาด
    v_item_code := nullif(btrim(coalesce(v_item->>'code', '')), '');
    if v_item_code is null then
      v_max_code_seq := v_max_code_seq + 1;
      v_item_code := 'QC' || lpad(v_max_code_seq::text, 2, '0');
    end if;

    insert into public.job_checklist_template_items (
      template_id, code, label, spec_text, requires_photo, is_critical,
      measuring_device_kind, sort_order, is_active, created_at, updated_at
    ) values (
      v_new_id,
      v_item_code,
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

commit;

-- T4a: ย้ายเกณฑ์ QC 15 ข้อจาก components/pipeline/job-drawer.tsx (const QC_ITEMS)
-- เข้าตารางแม่แบบ job_types / job_checklist_templates / job_checklist_template_items
-- เป้าหมาย: ให้หัวหน้าช่างแก้เกณฑ์เองได้ในภายหลังโดยไม่ต้องแก้โค้ด/deploy
-- ไม่แตะไฟล์ TSX เดิม เป็นการทำสำเนาข้อมูลเข้าตารางเท่านั้น
-- รันซ้ำได้ปลอดภัย: ถ้ามี job_types.code='FLOOR_INSTALL' อยู่แล้ว จะข้ามทั้งชุด

do $$
declare
  v_job_type_id uuid;
  v_template_id uuid;
begin
  -- กันรันซ้ำ: ถ้ามี job_types.code='FLOOR_INSTALL' อยู่แล้ว ข้ามทั้งชุด (idempotent)
  if exists (select 1 from public.job_types where code = 'FLOOR_INSTALL') then
    return;
  end if;

  -- 1) ประเภทงาน: ปูพื้น
  insert into public.job_types (code, name, task_field, is_active, sort_order, created_by)
  values ('FLOOR_INSTALL', 'ปูพื้น', 'floor', true, 1, null)
  on conflict (code) do nothing
  returning id into v_job_type_id;

  -- กันกรณี race condition ที่ on conflict do nothing ทำให้ v_job_type_id เป็น null
  if v_job_type_id is null then
    return;
  end if;

  -- 2) แม่แบบเกณฑ์ตรวจรับงานปูพื้น เวอร์ชัน 1
  insert into public.job_checklist_templates (job_type_id, version, status, effective_from, notes, created_by)
  values (
    v_job_type_id,
    1,
    'active',
    now(),
    'seed เริ่มต้นจาก QC_ITEMS ในไฟล์ components/pipeline/job-drawer.tsx (T4a) — ค่าเดิมที่ทีมใช้อยู่ ยังไม่ได้ให้หัวหน้าช่างทบทวน',
    null
  )
  on conflict (job_type_id, version) do nothing
  returning id into v_template_id;

  if v_template_id is null then
    return;
  end if;

  -- 3) รายการเกณฑ์ 15 ข้อ (คัดลอกตรงตัวอักษรจาก QC_ITEMS ในไฟล์ต้นทาง)
  -- หมายเหตุ: requires_photo=false ทุกข้อ (ของเดิมไม่ได้บังคับถ่ายรูป ให้หัวหน้าช่างเปิดเองภายหลัง)
  -- หมายเหตุ: is_critical=true ทุกข้อ ตามพฤติกรรมเดิมของหน้าจอ QC
  -- หมายเหตุ: measuring_device_kind เป็นค่าตั้งต้นที่ผู้ seed ใส่ให้ตามสเปกที่เป็นตัวเลข
  --           ยังไม่ใช่ค่าที่หัวหน้าช่างยืนยัน ต้องให้หัวหน้าช่างมาตรวจสอบ/แก้ไขอีกครั้ง
  insert into public.job_checklist_template_items
    (template_id, code, label, spec_text, requires_photo, is_critical, measuring_device_kind, sort_order, is_active)
  values
    (v_template_id, 'QC01', 'ช่องว่างขอบแผ่นกับผนัง/บัว/เสา/เฟอร์นิเจอร์', '≤ 1 mm', false, true, 'ฟีลเลอร์เกจ', 1, true),
    (v_template_id, 'QC02', 'รอยต่อชนก่อนเชื่อม', '≤ 0.3 mm', false, true, 'ฟีลเลอร์เกจ', 2, true),
    (v_template_id, 'QC03', 'ความตรงของแนวตัด', 'เบี่ยง ≤ 1 mm/1 m', false, true, 'ตลับเมตร/ไม้บรรทัดเหล็ก', 3, true),
    (v_template_id, 'QC04', 'ขอบแผ่นเผยอ / กระดก', '= 0 mm', false, true, 'ฟีลเลอร์เกจ', 4, true),
    (v_template_id, 'QC05', 'รอยตัดไหม้ / บิ่น / ฉีก', 'ต้องไม่มี', false, true, null, 5, true),
    (v_template_id, 'QC06', 'ความลึกร่องกรีด', '~2/3 ความหนาแผ่น', false, true, 'ตลับเมตร/ไม้บรรทัดเหล็ก', 6, true),
    (v_template_id, 'QC07', 'ความสมบูรณ์แนวเชื่อม', 'เต็มแนว เรียบเสมอผิว', false, true, null, 7, true),
    (v_template_id, 'QC08', 'ความแข็งแรงรอยเชื่อม', 'ดึงเบาไม่แยก', false, true, null, 8, true),
    (v_template_id, 'QC09', 'เวลาบ่ม', '≥ 24 ชม.', false, true, 'นาฬิกา/ตัวจับเวลา', 9, true),
    (v_template_id, 'QC10', 'บัว / ตัวจบแนบสนิท', '0 mm', false, true, 'ฟีลเลอร์เกจ', 10, true),
    (v_template_id, 'QC11', 'แนวซิลิโคนต่อเนื่อง', 'ไม่ขาดช่วง', false, true, null, 11, true),
    (v_template_id, 'QC12', 'โซนเปียก — น้ำไม่ซึมใต้แผ่น', 'ผ่านทดสอบ', false, true, null, 12, true),
    (v_template_id, 'QC13', 'ความลาดตัวจบ', 'เดินผ่านไม่สะดุ้ง', false, true, null, 13, true),
    (v_template_id, 'QC14', 'ความสะอาดผิวงาน', 'ไม่มีคราบ', false, true, null, 14, true),
    (v_template_id, 'QC15', 'สภาพพื้นก่อนติดตั้ง', 'แห้งสะอาด', false, true, null, 15, true)
  on conflict (template_id, code) do nothing;

  -- 4) บันทึกประวัติแม่แบบ: การ seed ครั้งนี้
  insert into public.job_template_revisions (template_kind, template_id, version, action, changed_by, note)
  values (
    'checklist',
    v_template_id,
    1,
    'seed',
    null,
    'seed เกณฑ์ตรวจรับงานปูพื้น 15 ข้อ จาก QC_ITEMS ในไฟล์ components/pipeline/job-drawer.tsx (T4a)'
  );
end $$;

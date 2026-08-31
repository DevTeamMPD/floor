-- T8 แก้ตาม review: ปิดช่องให้ผู้เรียกเลือก "ประเภทงาน" เองใน get_technician_job_checklist
--
-- ปัญหาของรุ่นก่อน (20260901200000): p_job_type_code เป็นพารามิเตอร์ที่ผู้เรียกกำหนดได้ผ่าน PostgREST
-- ช่างที่มี token+PIN ถูกต้องจึงยิงรหัสประเภทงานอะไรก็ได้เข้ามา แล้วดูผลต่างระหว่าง
-- 'job_type_not_found' กับ 'no_active_template' เพื่อไล่เดาว่ารหัสประเภทงานใดมีอยู่จริงในระบบ
-- (enumeration oracle เล็ก ๆ) ทั้งที่หน้าจอไม่เคยส่งพารามิเตอร์นี้มาเลยสักครั้ง
--
-- วิธีแก้: คงลายเซ็นเดิมไว้ (client เดิมยังเรียกได้เหมือนเดิม ไม่ต้อง deploy พร้อมกัน) แต่ "เมินค่าที่ส่งมา"
-- แล้วให้ฝั่งเซิร์ฟเวอร์ตัดสินประเภทงานเอง จากงานของใบมอบหมายที่ช่างคนนั้นถืออยู่
-- ระบบนี้มีประเภทงานเดียวคือ FLOOR_INSTALL และ install_jobs ยังไม่มีคอลัมน์ประเภทงาน
-- จึงผูกไว้เป็นค่าคงที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ค่าที่ผู้เรียกป้อน
--
-- เรื่อง reason: reason ที่คืนกลับตอนนี้พูดถึง "งานของผู้เรียกเอง" เท่านั้น เพราะไม่มีทางถามถึงประเภทงานอื่น
-- ได้อีกแล้ว การแยก job_type_not_found ออกจาก no_active_template จึงไม่ใช่ช่องรั่วอีกต่อไป
-- และยังจำเป็นกับหน้าจอ เพราะสองกรณีนี้คนละคนแก้ (ผู้ดูแลระบบ vs หัวหน้าช่าง)
--
-- ขอบเขต: อ่านอย่างเดียว (stable) · security definer + search_path = '' · ไม่เปิดสิทธิ์ตารางใด ๆ ให้ anon เพิ่ม

begin;

create or replace function public.get_technician_job_checklist(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_job_type_code text default 'FLOOR_INSTALL'
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_assignment public.appointment_technicians%rowtype;
  v_job_type public.job_types%rowtype;
  v_template public.job_checklist_templates%rowtype;
  v_items jsonb;
begin
  -- ด่านเดิมทุกประการ: ต้องเป็นเจ้าของ token, PIN ถูก, และใบมอบหมายยัง active จริง
  select a.* into v_assignment
  from public.appointment_technicians a
  join public.floor_technicians t on t.id = a.technician_id
  where a.id = p_assignment_id
    and a.is_active
    and t.is_active
    and t.personal_token = p_token
    and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin, ''), '\s+', '', 'g'), t.pin_hash) = t.pin_hash;
  if v_assignment.id is null then
    raise exception 'assignment not found';
  end if;

  -- p_job_type_code ถูกเมินโดยตั้งใจ: ประเภทงานมาจากฝั่งเซิร์ฟเวอร์เท่านั้น
  -- (คงพารามิเตอร์ไว้เพื่อไม่ให้ client รุ่นเดิมพัง — ค่าที่ส่งมาไม่ถูกอ่านที่ใดในฟังก์ชันนี้อีกเลย)

  select * into v_job_type
  from public.job_types
  where code = 'FLOOR_INSTALL'
    and is_active;
  if v_job_type.id is null then
    -- ไม่ raise: หน้าจอมีชุดสำรองอยู่แล้ว การล้มทั้งหน้าเพราะยังไม่ได้ตั้งประเภทงานไม่ช่วยช่างที่หน้างาน
    return jsonb_build_object('found', false, 'reason', 'job_type_not_found');
  end if;

  select * into v_template
  from public.job_checklist_templates
  where job_type_id = v_job_type.id and status = 'active'
  order by version desc
  limit 1;
  if v_template.id is null then
    return jsonb_build_object('found', false, 'reason', 'no_active_template');
  end if;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', i.code,
      'label', i.label,
      'spec_text', i.spec_text,
      'requires_photo', i.requires_photo,
      'is_critical', i.is_critical,
      'measuring_device_kind', i.measuring_device_kind,
      'sort_order', i.sort_order,
      'is_active', i.is_active
    ) order by i.sort_order, i.code)
    from public.job_checklist_template_items i
    where i.template_id = v_template.id and i.is_active
  ), '[]'::jsonb) into v_items;

  if jsonb_array_length(v_items) = 0 then
    -- แม่แบบเปิดใช้งานอยู่จริงแต่ไม่มีเกณฑ์สักข้อ — บอกเหตุผลนี้ให้ตรง ไม่ยุบไปรวมกับ "ไม่มีแม่แบบ"
    -- เพราะคนที่ต้องลงมือแก้และสิ่งที่ต้องแก้คนละอย่างกัน
    return jsonb_build_object('found', false, 'reason', 'template_has_no_active_items');
  end if;

  return jsonb_build_object(
    'found', true,
    'templateId', v_template.id,
    'version', v_template.version,
    'jobTypeName', v_job_type.name,
    'items', v_items
  );
end;
$function$;

comment on function public.get_technician_job_checklist(uuid, text, uuid, text) is
  'อ่านเกณฑ์ตรวจรับของแม่แบบที่เปิดใช้งานอยู่ ให้หน้าช่างที่ยืนยันตัวตนด้วย token+PIN — อ่านอย่างเดียว '
  'ประเภทงานตัดสินฝั่งเซิร์ฟเวอร์เสมอ (p_job_type_code ถูกเมิน คงไว้เพื่อความเข้ากันได้ของ client เดิม) '
  'ไม่คืนข้อมูลของงานอื่น และไม่ต้องเปิดสิทธิ์ตารางแม่แบบให้ anon';

-- least privilege เท่าเดิม: ปิด public แล้วเปิดเฉพาะบทบาทที่ต้องเรียกจริง (หน้าช่างวิ่งเป็น anon)
revoke all on function public.get_technician_job_checklist(uuid, text, uuid, text) from public;
grant execute on function public.get_technician_job_checklist(uuid, text, uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

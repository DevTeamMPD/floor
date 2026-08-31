-- T8: ให้หน้าช่างหน้างาน (app/work/[token]/page.tsx) อ่าน "เกณฑ์ตรวจรับ" จากแม่แบบที่เปิดใช้งานจริง
--
-- ที่มา: สาขานี้สร้างหน้าจอให้หัวหน้าช่างแก้เกณฑ์ตรวจรับเองได้ แต่ยังไม่มีใครนอกหน้าแอดมินอ่านตารางนั้นเลย
-- หน้าจอที่คนใช้งานเห็นจริงยังยึดรายการที่ hardcode ไว้ในโค้ด การแก้แม่แบบจึงไม่มีผลกับใครทั้งสิ้น
-- ซึ่งขัดกับสิ่งที่หน้าแอดมินสื่อสารกับหัวหน้าช่างตรง ๆ
--
-- หน้าช่างยืนยันตัวตนด้วย token + PIN ไม่ได้ล็อกอินเป็น authenticated จึงอ่านตารางแม่แบบตรง ๆ ไม่ได้
-- (ตารางชุดนี้ revoke สิทธิ์ anon ไว้ตั้งแต่ migration 20260901100000 และต้องคงไว้แบบนั้น)
-- ทางที่ถูกคือทำ RPC security definer แบบเดียวกับ get_technician_work_order_v2 / get_technician_remnant_report
-- ที่หน้านั้นใช้อยู่แล้ว: ตรวจ token+PIN กับใบมอบหมายงานก่อน แล้วจึงคืนข้อมูล
--
-- ขอบเขตของฟังก์ชันนี้: อ่านอย่างเดียว (stable) ไม่เขียนอะไรทั้งสิ้น และไม่เปิดสิทธิ์ตารางใด ๆ ให้ anon เพิ่ม
-- สิ่งที่คืนกลับคือ "เกณฑ์ตรวจรับของประเภทงาน" ซึ่งเป็นเอกสารมาตรฐานการทำงานที่ช่างคนนั้นต้องใช้กับงานที่
-- ได้รับมอบหมายอยู่แล้ว ไม่มีข้อมูลของงานอื่นหรือของลูกค้าปนออกไป

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
begin
  -- ด่านเดียวกับ RPC อื่นของหน้าช่าง: ต้องเป็นเจ้าของ token, PIN ถูก, และใบมอบหมายยัง active จริง
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

  select * into v_job_type
  from public.job_types
  where code = coalesce(nullif(btrim(p_job_type_code), ''), 'FLOOR_INSTALL')
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

  return jsonb_build_object(
    'found', true,
    'templateId', v_template.id,
    'version', v_template.version,
    'jobTypeName', v_job_type.name,
    'items', coalesce((
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
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function public.get_technician_job_checklist(uuid, text, uuid, text) is
  'อ่านเกณฑ์ตรวจรับของแม่แบบที่เปิดใช้งานอยู่ ให้หน้าช่างที่ยืนยันตัวตนด้วย token+PIN — อ่านอย่างเดียว '
  'ไม่คืนข้อมูลของงานอื่น และไม่ต้องเปิดสิทธิ์ตารางแม่แบบให้ anon';

-- least privilege: ปิดสิทธิ์ public แล้วเปิดเฉพาะบทบาทที่ต้องเรียกจริง (หน้าช่างวิ่งเป็น anon)
revoke all on function public.get_technician_job_checklist(uuid, text, uuid, text) from public;
grant execute on function public.get_technician_job_checklist(uuid, text, uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

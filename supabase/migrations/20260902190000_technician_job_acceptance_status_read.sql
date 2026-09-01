-- ============================================================================
-- technician_job_acceptance_status_read
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   หน้าจอช่างหน้างาน (app/work/[token]) แสดงเกณฑ์ตรวจรับให้อ่านได้แล้ว แต่ตอบไม่ได้
--   ว่า "ตอนนี้งานของฉันติดอะไรอยู่บ้าง" ช่างจึงรู้ว่างานปิดไม่ได้ก็ต่อเมื่อออฟฟิศโทรมาบอก
--   ซึ่งมักเป็นวันถัดไป หลังจากรถออกจากหน้างานไปแล้ว การกลับไปแก้จึงแพงกว่าเดิมหลายเท่า
--
--   ไฟล์นี้เปิด "ทางอ่าน" ทางเดียว ไม่ใช่ทางเขียน
--
-- ทำไมไม่เปิดทางให้ช่างบันทึกผลตรวจรับเองด้วย (ตัดสินใจไว้ตรงนี้ ไม่ใช่ลืม)
--   save_job_acceptance_results จำกัดผู้บันทึกไว้ที่ admin / head_technician โดยตั้งใจ
--   ถ้าเปิดให้หน้าจอ token+PIN เขียนผลได้ ด่าน job_acceptance_gate จะถูกทำให้ครบได้
--   ด้วยมือของช่างคนเดียวโดยไม่มีใครฝั่งบริษัทดูเลย ซึ่งทำลายเหตุผลทั้งหมดของการมีด่าน
--   (ตาราง job_acceptance_results มีคอลัมน์ performed_technician_id เตรียมไว้สำหรับกรณีนี้
--    ในอนาคต — แต่การเปิดใช้ต้องมาพร้อมการตัดสินใจว่าผลที่ช่างกรอกเองนับเป็นหลักฐานได้แค่ไหน
--    ซึ่งเป็นการตัดสินใจเชิงนโยบาย ไม่ใช่การต่อสายไฟให้ครบ)
--
-- ด่านตรวจสิทธิ์: คัดลอกจาก get_technician_job_checklist ทุกตัวอักษร
--   ต้องเป็นเจ้าของ token, PIN ถูก, ใบมอบหมายยัง active, และช่างยัง active
--   ไม่ลดด่านลงแม้แต่ข้อเดียวเพื่อให้เรียกง่ายขึ้น
--
-- ไฟล์นี้รันซ้ำได้ (create or replace)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_technician_job_acceptance_status(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assignment public.appointment_technicians%rowtype;
  v_job_no text;
  v_appointment_id uuid;
  v_gate jsonb;
  v_results jsonb;
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

  select ap.id, ap.job_id into v_appointment_id, v_job_no
  from public.appointments ap
  where ap.id = v_assignment.appointment_id;

  if v_job_no is null then
    -- งานที่ยังไม่ผูกเลขงาน ตอบว่า "ยังบอกไม่ได้" ตรง ๆ ดีกว่าตอบว่าไม่มีอะไรค้าง
    return jsonb_build_object('found', false, 'reason', 'job_not_linked');
  end if;

  v_gate := public.job_acceptance_gate(v_job_no, v_appointment_id);

  -- ผลล่าสุดต่อข้อ ใช้เกณฑ์เดียวกับที่ด่านใช้ (distinct on + performed_at desc)
  -- ไม่ส่งชื่อผู้บันทึกหรือรหัสภายในออกไปหน้าจอ token: ช่างต้องรู้ว่า "ข้อนี้ผ่านหรือยัง"
  -- ไม่ใช่ "ใครเป็นคนตัดสิน" ซึ่งเป็นข้อมูลของฝั่งออฟฟิศ
  select coalesce(jsonb_object_agg(x.item_code, jsonb_build_object(
           'result', x.result,
           'photoCount', coalesce(array_length(x.photo_paths, 1), 0),
           'verified', x.verified_at is not null
         )), '{}'::jsonb)
  into v_results
  from (
    select distinct on (r.item_code) r.item_code, r.result, r.photo_paths, r.verified_at
    from public.job_acceptance_results r
    where r.job_no = v_job_no
    order by r.item_code, r.performed_at desc nulls last, r.updated_at desc
  ) x;

  return jsonb_build_object(
    'found', true,
    'jobNo', v_job_no,
    'gate', v_gate,
    'results', v_results
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- สิทธิ์ — หน้าจอช่างวิ่งเป็น anon จึงต้องให้ anon เรียกได้ ตามรูปแบบเดียวกับ
-- get_technician_job_checklist / get_technician_work_progress ที่มีอยู่แล้ว
-- ด่านจริงอยู่ในตัวฟังก์ชัน (token + PIN + ใบมอบหมาย) ไม่ใช่ที่ GRANT
-- เป็นทางอ่านอย่างเดียว ไม่มี insert/update/delete ในฟังก์ชันนี้เลย
-- ----------------------------------------------------------------------------
revoke all on function public.get_technician_job_acceptance_status(uuid, text, uuid) from public;
grant execute on function public.get_technician_job_acceptance_status(uuid, text, uuid) to anon, authenticated, service_role;

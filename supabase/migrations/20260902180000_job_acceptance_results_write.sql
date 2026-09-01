-- ============================================================================
-- job_acceptance_results_write
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   ตาราง public.job_acceptance_results มีอยู่ก่อนแล้ว (สร้างพร้อมชุดแม่แบบเกณฑ์
--   ตรวจรับ job_checklist_templates / job_checklist_template_items) แต่ยังไม่มี
--   "ทางเขียน" ที่ตรวจกฎให้ — ฝั่งแอปเขียนตรงเข้าตารางไม่ได้เพราะ GRANT ให้
--   authenticated แค่ select เท่านั้น (ดู relacl: authenticated=r)
--
--   ไฟล์นี้เปิดทางเขียนผ่าน RPC แบบ security definer และย้ายกฎที่ "ต้องเชื่อถือได้"
--   ลงไปอยู่ที่ฐานข้อมูล ไม่ฝากไว้กับหน้าจอ เพราะผลตรวจรับคือหลักฐานที่ใช้ปิดงาน
--   และใช้ตอบลูกค้า/ผู้ตรวจ ถ้ากฎอยู่แค่ที่หน้าจอ ใครยิง API ตรงก็ข้ามได้ทั้งชุด
--
-- สิ่งที่เพิ่มในไฟล์นี้ (ยืนยันจากลำดับ OID ในฐานข้อมูลจริง 138677-138683)
--   1) คอลัมน์ verified_role — เก็บว่า "ผู้รับรองชั้นที่สองสวมบทบาทอะไรตอนเซ็น"
--      ต้องเก็บไว้ ณ เวลาที่เซ็น เพราะบทบาทของพนักงานเปลี่ยนได้ในอนาคต
--      แต่หลักฐานการรับรองต้องอ่านย้อนหลังได้ว่าตอนนั้นใครมีอำนาจเซ็น
--   2) job_acceptance_results_photo_required
--      requires_photo และผลเป็น 'pass' -> ต้องมีรูปใน photo_paths อย่างน้อย 1 รูป
--      กฎนี้อยู่ที่ตารางไม่ใช่แค่ในฟังก์ชัน เพราะ "ผ่านโดยไม่มีหลักฐาน" คือสิ่งที่
--      ต้องเป็นไปไม่ได้ในทางฟิสิกส์ของข้อมูล ไม่ใช่แค่สิ่งที่แอปไม่ควรทำ
--   3) job_acceptance_results_verification_pair
--      verified_by กับ verified_at ต้องมีหรือไม่มีพร้อมกัน — กันสถานะกำกวมว่า
--      "มีคนเซ็นแต่ไม่รู้เมื่อไร" หรือ "มีเวลาเซ็นแต่ไม่รู้ใคร"
--   4) job_acceptance_results_verifier_is_not_performer
--      คนบันทึกผลเซ็นรับรองให้ตัวเองไม่ได้ — หัวใจของการตรวจสองชั้น
--      ถ้าคนเดียวทำได้ทั้งสองบทบาท การตรวจชั้นที่สองก็ไม่มีความหมายเลย
--   5) job_acceptance_results_verified_role_check — จำกัดบทบาทที่รับรองได้
--   6) job_acceptance_results_device_used_idx
--      ดัชนีบางส่วนตาม (measuring_device_id, performed_at desc)
--      รองรับคำถาม "เครื่องมือตัวนี้ถูกใช้กับงานไหนบ้างหลังสอบเทียบครั้งล่าสุด"
--   7) active_job_checklist_template() — จุดเดียวที่ตอบว่า "แม่แบบรุ่นไหนกำลังใช้อยู่"
--      ทุกทางเขียน/ทางอ่านต้องถามที่นี่ ไม่ใช่ต่างคนต่าง query เอง
--   8) save_job_acceptance_results() — ทางเขียนหลัก
--
-- ไฟล์นี้รันซ้ำได้: ใช้ if not exists / drop ... if exists ทุกจุด
-- ฟังก์ชันคัดลอกจาก pg_get_functiondef ของฐานข้อมูลจริงแบบตัวอักษรต่อตัวอักษร
-- ============================================================================

-- 1) คอลัมน์บทบาทผู้รับรอง
alter table public.job_acceptance_results
  add column if not exists verified_role text;

-- 2-5) กฎระดับตาราง — drop ก่อน add เพื่อให้รันซ้ำได้และให้นิยามล่าสุดชนะ
alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_photo_required;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_photo_required
  check (not (requires_photo and (result = 'pass'::text) and (coalesce(array_length(photo_paths, 1), 0) = 0)));

alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_verification_pair;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_verification_pair
  check ((verified_by is null) = (verified_at is null));

alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_verifier_is_not_performer;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_verifier_is_not_performer
  check ((verified_by is null) or (performed_by is null) or (verified_by <> performed_by));

alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_verified_role_check;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_verified_role_check
  check ((verified_role is null) or (verified_role = any (array['admin'::text, 'head_technician'::text, 'cs'::text])));

-- 6) ดัชนีสำหรับสายอ่าน "เครื่องมือวัดตัวนี้ใช้กับงานอะไรบ้าง"
create index if not exists job_acceptance_results_device_used_idx
  on public.job_acceptance_results using btree (measuring_device_id, performed_at desc)
  where (measuring_device_id is not null);

-- 7) แม่แบบที่เปิดใช้งานอยู่ — จุดเดียวในระบบ
CREATE OR REPLACE FUNCTION public.active_job_checklist_template()
 RETURNS job_checklist_templates
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.*
  from public.job_checklist_templates t
  join public.job_types jt on jt.id = t.job_type_id
  where jt.code = 'FLOOR_INSTALL'
    and jt.is_active
    and t.status = 'active'
  order by t.version desc
  limit 1
$function$;

-- 8) ทางเขียนผลตรวจรับ
CREATE OR REPLACE FUNCTION public.save_job_acceptance_results(p_job_no text, p_inspector text, p_notes text, p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_template public.job_checklist_templates%rowtype;
  v_item public.job_checklist_template_items%rowtype;
  v_device public.measuring_devices%rowtype;
  v_row jsonb;
  v_code text;
  v_result text;
  v_photos text[];
  v_device_id uuid;
  v_work_order_id uuid;
  v_saved integer := 0;
  v_cleared integer := 0;
  v_removed text[] := array[]::text[];
  v_qc jsonb := '{}'::jsonb;
  v_qc_results jsonb := '{}'::jsonb;
  v_map jsonb;
begin
  select * into v_actor
  from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'บันทึกผลตรวจรับได้เฉพาะผู้ดูแลระบบและหัวหน้าช่างเท่านั้น';
  end if;

  if not exists (select 1 from public.install_jobs where job_no = p_job_no) then
    raise exception 'ไม่พบงานเลขที่ %', p_job_no;
  end if;

  v_template := public.active_job_checklist_template();
  if v_template.id is null then
    raise exception 'ยังไม่มีแม่แบบเกณฑ์ตรวจรับรุ่นใดเปิดใช้งานอยู่ จึงยังบันทึกผลตรวจรับไม่ได้ — ให้หัวหน้าช่างกดเปิดใช้งานแม่แบบก่อน';
  end if;

  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'รูปแบบผลตรวจรับที่ส่งมาไม่ถูกต้อง (ต้องเป็นรายการ)';
  end if;

  select id into v_work_order_id
  from public.install_job_work_orders
  where job_no = p_job_no
  order by seq nulls last, created_at
  limit 1;

  for v_row in select value from jsonb_array_elements(p_results) as t(value) loop
    v_code := nullif(btrim(coalesce(v_row->>'code', '')), '');
    if v_code is null then
      raise exception 'ผลตรวจรับมีรายการที่ไม่ได้ระบุรหัสเกณฑ์';
    end if;

    select * into v_item
    from public.job_checklist_template_items
    where template_id = v_template.id and code = v_code and is_active;
    if v_item.id is null then
      raise exception 'ไม่พบเกณฑ์รหัส % ในแม่แบบที่เปิดใช้งานอยู่ (รุ่น v%)', v_code, v_template.version;
    end if;

    v_result := nullif(btrim(coalesce(v_row->>'result', '')), '');
    if v_result is not null and v_result not in ('pass', 'fail', 'na') then
      raise exception 'ผลของเกณฑ์ % ต้องเป็น ผ่าน / ไม่ผ่าน / ไม่เกี่ยวข้อง เท่านั้น', v_code;
    end if;

    if v_result is null then
      delete from public.job_acceptance_results
      where job_no = p_job_no and template_id = v_template.id and item_code = v_code;
      if found then
        v_cleared := v_cleared + 1;
      end if;
      v_removed := array_append(v_removed, v_code);
      continue;
    end if;

    select coalesce(array_agg(btrim(value)) filter (where btrim(value) <> ''), array[]::text[])
    into v_photos
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_row->'photoPaths') = 'array' then v_row->'photoPaths' else '[]'::jsonb end
    ) as t(value);

    if v_item.requires_photo and v_result = 'pass' and coalesce(array_length(v_photos, 1), 0) = 0 then
      raise exception 'เกณฑ์ % (%) ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป ก่อนจึงจะบันทึกว่า "ผ่าน" ได้', v_code, v_item.label;
    end if;

    v_device_id := nullif(btrim(coalesce(v_row->>'measuringDeviceId', '')), '')::uuid;
    if v_device_id is not null then
      if v_item.measuring_device_kind is null then
        raise exception 'เกณฑ์ % (%) ไม่ได้กำหนดชนิดเครื่องมือวัดไว้ในแม่แบบ จึงระบุเครื่องมือที่ใช้ไม่ได้', v_code, v_item.label;
      end if;
      select * into v_device from public.measuring_devices where id = v_device_id;
      if v_device.id is null then
        raise exception 'ไม่พบเครื่องมือวัดที่เลือกไว้สำหรับเกณฑ์ %', v_code;
      end if;
      if v_device.status = 'out_of_service' then
        raise exception 'เครื่องมือ % (%) ถูกปลดจากการใช้งานแล้ว ใช้อ้างอิงผลตรวจรับไม่ได้', v_device.code, v_device.kind;
      end if;
    end if;

    insert into public.job_acceptance_results (
      job_no, work_order_id, template_id, template_version, item_code, item_label_snapshot,
      requires_photo, is_critical, result, measured_value, measuring_device_id, photo_paths,
      performed_by, performed_at, note, updated_at
    ) values (
      p_job_no, v_work_order_id, v_template.id, v_template.version, v_code, v_item.label,
      v_item.requires_photo, v_item.is_critical, v_result,
      nullif(btrim(coalesce(v_row->>'measuredValue', '')), ''), v_device_id, v_photos,
      v_actor.id, now(), nullif(btrim(coalesce(v_row->>'note', '')), ''), now()
    )
    on conflict (job_no, template_id, item_code) do update set
      work_order_id = excluded.work_order_id,
      template_version = excluded.template_version,
      item_label_snapshot = excluded.item_label_snapshot,
      requires_photo = excluded.requires_photo,
      is_critical = excluded.is_critical,
      result = excluded.result,
      measured_value = excluded.measured_value,
      measuring_device_id = excluded.measuring_device_id,
      photo_paths = excluded.photo_paths,
      performed_by = excluded.performed_by,
      performed_at = excluded.performed_at,
      note = excluded.note,
      verified_by = null,
      verified_at = null,
      verified_role = null,
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  begin
    select case when jsonb_typeof(parsed) = 'object' then parsed else '{}'::jsonb end
    into v_qc
    from (
      select nullif(btrim(coalesce(qc_data, '')), '')::jsonb as parsed
      from public.install_jobs where job_no = p_job_no
    ) s;
  exception when others then
    v_qc := '{}'::jsonb;
  end;
  v_qc := coalesce(v_qc, '{}'::jsonb);

  v_qc_results := coalesce(v_qc->'results', '{}'::jsonb);
  if jsonb_typeof(v_qc_results) <> 'object' then
    v_qc_results := '{}'::jsonb;
  end if;
  foreach v_code in array v_removed loop
    v_qc_results := v_qc_results - v_code;
  end loop;

  select coalesce(jsonb_object_agg(item_code, result), '{}'::jsonb)
  into v_map
  from public.job_acceptance_results
  where job_no = p_job_no and template_id = v_template.id;

  v_qc := v_qc || jsonb_build_object(
    'results', v_qc_results || v_map,
    'inspector', coalesce(p_inspector, ''),
    'notes', coalesce(p_notes, ''),
    'savedAt', to_jsonb(now()),
    'templateId', v_template.id,
    'templateVersion', v_template.version
  );

  update public.install_jobs
  set qc_data = v_qc::text, updated_at = now()
  where job_no = p_job_no;

  return jsonb_build_object(
    'saved', v_saved,
    'cleared', v_cleared,
    'templateId', v_template.id,
    'templateVersion', v_template.version
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- สิทธิ์ — ตรงตามสถานะจริงในฐานข้อมูล
--   active_job_checklist_template : {postgres, service_role}          <- ไม่เปิดให้ authenticated
--        เพราะเป็นตัวช่วยภายในที่ถูกเรียกจากฟังก์ชัน definer อื่นเท่านั้น
--   save_job_acceptance_results   : {postgres, service_role, authenticated}
--   ตาราง job_acceptance_results  : authenticated = select เท่านั้น (เขียนผ่าน RPC)
-- ----------------------------------------------------------------------------
revoke all on function public.active_job_checklist_template() from public;
revoke all on function public.active_job_checklist_template() from anon;
revoke all on function public.active_job_checklist_template() from authenticated;
grant execute on function public.active_job_checklist_template() to service_role;

revoke all on function public.save_job_acceptance_results(text, text, text, jsonb) from public;
revoke all on function public.save_job_acceptance_results(text, text, text, jsonb) from anon;
grant execute on function public.save_job_acceptance_results(text, text, text, jsonb) to authenticated, service_role;

revoke all on table public.job_acceptance_results from anon;
revoke all on table public.job_acceptance_results from public;
grant select on table public.job_acceptance_results to authenticated;
grant all on table public.job_acceptance_results to service_role;
alter table public.job_acceptance_results enable row level security;

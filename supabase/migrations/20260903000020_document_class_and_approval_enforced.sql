-- P5-8 — ด่านอนุมัติเอกสารควบคุม (ISO 9001:2015 ข้อ 7.5.2) ต้องอยู่ในที่ที่ข้ามไม่ได้
--
-- สภาพเดิมและช่องที่เปิดอยู่:
--   กฎทั้งข้ออยู่ใน TypeScript ที่ lib/documents/generation-worker.ts:89 เท่านั้น
--   ฐานข้อมูลไม่มีอะไรห้ามการสร้างแถว controlled_document ที่ status = 'approved' ตั้งแต่แรก
--   และ floor_job_documents.document_class มีค่าเริ่มต้นเป็น 'quality_record'
--   ซึ่งเป็นฝั่งที่ "อนุมัติอัตโนมัติ" — ลืมใส่ค่า = ได้ทางที่หลวมที่สุดโดยอัตโนมัติ
--
--   ไม่ใช่ความเสี่ยงเชิงทฤษฎี: ในฐานข้อมูลวันนี้มีแถว document_type = 'work_order'
--   ที่ document_class = 'quality_record' อยู่จริงหนึ่งแถว (สถานะ draft)
--   มาจาก app/api/job-documents/route.ts ที่ใส่ 'quality_record' ตายตัวให้ทุกการอัปโหลด
--   โดยไม่ดูว่าเป็นเอกสารชนิดไหน ถ้าแถวแบบนี้ถูกอนุมัติ มันจะข้ามคิวคนอนุมัติไปเงียบ ๆ
--   แถวนั้น "ไม่ถูกแก้" ใน migration นี้ — ข้อมูลของเดิมเป็นของคนตัดสินใจ ไม่ใช่ของ migration
--   (รายงานไว้แล้วให้เจ้าของระบบตัดสินใจเอง)
--
-- สิ่งที่บังคับใหม่ สองข้อ ทั้งคู่เป็นด่านระดับตาราง จึงข้ามด้วยโค้ดฝั่งไหนก็ไม่ได้:
--   1) document_class ต้องตรงกับชนิดเอกสารตามตารางกลางเสมอ (เฉพาะชนิดที่ระบบรู้จัก)
--      work_order / boq / ncr = controlled_document
--      pick_confirmation / installation_report / customer_acceptance /
--      remnant_report / handover / csat = quality_record
--   2) เอกสารที่ต้องมีคนอนุมัติ จะเข้าสถานะ approved ได้ต่อเมื่อมี approved_by
--      "อนุมัติ" ต้องแปลว่ามีคนอ่านและรับผิดชอบ ไม่ใช่แปลว่าไฟล์อัปโหลดสำเร็จ
--
-- และค่าเริ่มต้นของคอลัมน์ถูกพลิกไปทางปลอดภัย: quality_record -> controlled_document
--   การลืมระบุชนิดต้องพาไปสู่ "ต้องมีคนอนุมัติ" ไม่ใช่ "อนุมัติอัตโนมัติ"
--
-- ของเดิมต้องไม่พัง — สองข้อนี้ยิงเฉพาะตอนที่ค่านั้นเปลี่ยนจริงเท่านั้น:
--   ข้อ 1 ยิงตอน insert หรือตอนที่ document_class/document_type ถูกแก้
--   ข้อ 2 ยิงตอน insert หรือตอนที่สถานะเพิ่งเปลี่ยนเข้าเป็น approved
--   เอกสาร 20 ใบที่วันนี้เป็น approved โดยไม่มี approved_by (อนุมัติอัตโนมัติเฟส 1)
--   จึงยัง update, supersede และ reject ได้ตามปกติ ไม่มีแถวไหนถูกแตะ

begin;

-- ---------------------------------------------------------------------------
-- 1) ตารางกลาง: ชนิดเอกสาร -> ชั้นเอกสาร
--    แหล่งความจริงเดียวที่ trigger, RPC และฝั่ง TypeScript อ่านตรงกัน
--    (lib/documents/approval-policy.ts มีเทสอ่านไฟล์นี้มาเทียบ กัน drift สองฝั่ง)
-- ---------------------------------------------------------------------------
create or replace function public.document_class_for_type(p_document_type text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case coalesce(p_document_type, '')
    when 'work_order'          then 'controlled_document'
    when 'boq'                 then 'controlled_document'
    when 'ncr'                 then 'controlled_document'
    when 'pick_confirmation'   then 'quality_record'
    when 'installation_report' then 'quality_record'
    when 'customer_acceptance' then 'quality_record'
    when 'remnant_report'      then 'quality_record'
    when 'handover'            then 'quality_record'
    when 'csat'                then 'quality_record'
    else null
  end;
$function$;

comment on function public.document_class_for_type(text) is
  'ชั้นเอกสารที่ถูกต้องของชนิดเอกสารหนึ่ง ๆ (null = ชนิดที่ระบบยังไม่รู้จัก จึงไม่บังคับ) '
  'แหล่งความจริงเดียวของการจับคู่ document_type -> document_class';

revoke all on function public.document_class_for_type(text) from public, anon, authenticated;
grant execute on function public.document_class_for_type(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) ด่านระดับตาราง
-- ---------------------------------------------------------------------------
create or replace function public.floor_job_documents_class_approval_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected text;
begin
  -- (1) ชั้นเอกสารต้องตรงกับชนิด — ตรวจเฉพาะตอนที่ค่าถูกตั้งหรือถูกแก้จริง
  --     แถวเดิมที่ค่าเพี้ยนอยู่แล้วจึงยัง update เรื่องอื่นได้ ไม่ถูกล็อกตาย
  if tg_op = 'INSERT'
     or new.document_class is distinct from old.document_class
     or new.document_type  is distinct from old.document_type then
    v_expected := public.document_class_for_type(new.document_type);
    if v_expected is not null and new.document_class is distinct from v_expected then
      raise exception 'เอกสารชนิด "%" ต้องเป็นชั้น "%" ไม่ใช่ "%" — ชั้นเอกสารเป็นตัวตัดสินว่าต้องมีคนอนุมัติก่อนใช้หรือไม่ (ISO 9001:2015 ข้อ 7.5.2) จึงตั้งเองตามใจไม่ได้',
        new.document_type, v_expected, new.document_class;
    end if;
  end if;

  -- (2) เอกสารควบคุมเข้าสถานะ approved ได้ต่อเมื่อมีคนอนุมัติจริง
  --     ยิงเฉพาะตอนที่สถานะ "เพิ่งเปลี่ยนเข้าเป็น approved" เท่านั้น
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved')
     and public.document_requires_human_approval(new.document_class)
     and new.approved_by is null then
    raise exception 'เอกสาร "%" เป็นเอกสารควบคุม จึงเข้าสถานะอนุมัติเองไม่ได้ ต้องผ่านการกดอนุมัติโดยผู้มีสิทธิ์ที่หน้าอนุมัติเอกสาร (ISO 9001:2015 ข้อ 7.5.2 — "อนุมัติ" ต้องแปลว่ามีคนอ่านและรับผิดชอบ ไม่ใช่แปลว่าไฟล์อัปโหลดสำเร็จ)',
      coalesce(new.document_code, new.document_type);
  end if;

  return new;
end;
$function$;

comment on function public.floor_job_documents_class_approval_guard() is
  'ด่านระดับตารางของ floor_job_documents: (1) document_class ต้องตรงกับ document_type '
  'ตาม document_class_for_type() (2) เอกสารควบคุมเข้าสถานะ approved ได้ต่อเมื่อมี approved_by '
  'ยิงเฉพาะตอนค่าที่เกี่ยวข้องเปลี่ยนจริง แถวเดิมจึงไม่ถูกล็อกตาย';

revoke all on function public.floor_job_documents_class_approval_guard() from public, anon, authenticated;

drop trigger if exists floor_job_documents_class_approval_guard_ins on public.floor_job_documents;
create trigger floor_job_documents_class_approval_guard_ins
  before insert on public.floor_job_documents
  for each row execute function public.floor_job_documents_class_approval_guard();

drop trigger if exists floor_job_documents_class_approval_guard_upd on public.floor_job_documents;
create trigger floor_job_documents_class_approval_guard_upd
  before update on public.floor_job_documents
  for each row execute function public.floor_job_documents_class_approval_guard();

-- ---------------------------------------------------------------------------
-- 3) ค่าเริ่มต้นของคอลัมน์ต้องพลาดไปทางปลอดภัย
--    เปลี่ยนเฉพาะ default ของแถวใหม่ ไม่แตะค่าในแถวเดิมสักแถว
-- ---------------------------------------------------------------------------
alter table public.floor_job_documents alter column document_class set default 'controlled_document';

comment on column public.floor_job_documents.document_class is
  'ชั้นเอกสาร: controlled_document = ต้องมีคนอนุมัติก่อนใช้ (ISO 9001:2015 ข้อ 7.5.2), '
  'quality_record = บันทึกหลักฐานว่าเกิดอะไรขึ้นไปแล้ว อนุมัติอัตโนมัติได้. '
  'ค่าเริ่มต้นคือ controlled_document โดยตั้งใจ — การลืมระบุต้องพาไปทางที่ต้องมีคนอ่าน '
  'ไม่ใช่ทางที่ปล่อยผ่าน. ค่าถูกบังคับให้ตรงกับ document_type ด้วย trigger';

-- ---------------------------------------------------------------------------
-- 4) ด่านของ appointments_provider_suspension_guard() (P5-8 ข้อย่อย)
--    ของเดิมเป็น security invoker จึงอ่านตาราง suppliers ผ่าน RLS ของผู้เรียก
--    ถ้าวันหนึ่ง policy ของ suppliers ถูกทำให้แคบลง ด่านนี้จะ "หาไม่เจอ" แล้วปล่อยผ่าน
--    = ด่านที่พังแบบเงียบและเปิดทาง ซึ่งเป็นทิศทางที่ผิดสำหรับด่าน
--    เปลี่ยนเป็น security definer + set search_path = '' ให้เหมือนฟังก์ชันอื่นทั้งชุด
--    ตรรกะข้างในไม่เปลี่ยนแม้แต่บรรทัดเดียว
-- ---------------------------------------------------------------------------
create or replace function public.appointments_provider_suspension_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v record;
begin
  select tt.name as team_name, s.name as provider_name, s.approval_status,
         s.suspended_at, s.suspended_by_name, s.suspension_reason
    into v
  from public.tech_teams tt
  join public.suppliers s on s.id = tt.provider_id
  where tt.id = new.tech_id;

  if found and v.approval_status = 'suspended' then
    raise exception 'ทีม "%" สังกัดบริษัท "%" ซึ่งถูกระงับการรับงานใหม่ตั้งแต่ % โดย % (เหตุผล: %) จึงมอบงานใหม่ให้ไม่ได้ — ถ้าจะมอบงานต้องคืนสิทธิ์บริษัทนี้ก่อน',
      v.team_name, v.provider_name,
      to_char(v.suspended_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY'),
      coalesce(v.suspended_by_name, 'ไม่ระบุ'),
      coalesce(v.suspension_reason, 'ไม่ระบุ');
  end if;

  return new;
end;
$function$;

comment on function public.appointments_provider_suspension_guard() is
  'ด่านระดับตาราง: มอบนัดใหม่ให้ทีมที่สังกัดบริษัทซึ่งถูกระงับไม่ได้ ไม่ว่าจะเขียนมาจากหน้าจอไหน '
  'ยิงเฉพาะตอนผูกทีมเข้ากับนัด — นัดเดิมยังปิด เลื่อน หรือยกเลิกได้ตามปกติ. '
  'P5-8: security definer เพื่อไม่ให้ด่านพังเงียบเมื่อ RLS ของ suppliers ถูกทำให้แคบลง';

revoke all on function public.appointments_provider_suspension_guard() from public, anon, authenticated;

commit;

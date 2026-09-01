-- P5-8 (ตาม) — document_class_for_type() ต้องเป็น security definer เหมือนฟังก์ชันอื่นทั้งชุด
--
-- ฟังก์ชันนี้เป็น select case ล้วน ๆ ไม่แตะตารางไหนเลย จึงไม่มีช่องโหว่ในทางปฏิบัติวันนี้
-- แต่มาตรฐานของชุดนี้คือ "ฟังก์ชันใหม่ทุกตัว = security definer + set search_path = ''"
-- เหตุผลไม่ใช่พิธีกรรม: trigger ที่บังคับกฎ 7.5.2 เรียกฟังก์ชันนี้เป็นตัวตัดสิน
-- ถ้าวันหนึ่งมันถูกแก้ให้ไปอ่านตารางแมป (ซึ่งเป็นทิศทางที่มีเหตุผล) แล้วยังเป็น invoker อยู่
-- ด่านจะกลายเป็น "อ่านไม่เห็นแล้วปล่อยผ่าน" แบบเดียวกับที่เพิ่งแก้ใน
-- appointments_provider_suspension_guard() — ตั้งให้ถูกตั้งแต่ตอนที่ยังไม่มีผลจะถูกกว่า
--
-- ตัวฟังก์ชันไม่เปลี่ยนแม้แต่บรรทัดเดียว เปลี่ยนแค่โหมดการทำงาน

begin;

create or replace function public.document_class_for_type(p_document_type text)
returns text
language sql
immutable
security definer
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

commit;

-- P4-4 + P4-10 — NC ต้องบอกได้ว่า "ทำไมถึงเกิด" และ "ใครข้างนอกเกี่ยว"
--
-- ปัญหาที่แก้:
--   ncr_reports.type วันนี้ตอบได้แค่ "อาการ" (ของขาด ของเสียหาย ของผิดรุ่น คุณภาพ อื่น ๆ)
--   แต่คนที่ต้องแก้ต้นตอต้องการอีกแกนหนึ่งคือ "สาเหตุ" (วัสดุ ผลิต ติดตั้ง แบบ ขนส่ง หน้างาน)
--   สองแกนนี้ตัดกัน ไม่ใช่แกนเดียวกัน — ของขาดเพราะขนส่งตกหล่น กับ ของขาดเพราะคลังไม่มีของ
--   เป็นอาการเดียวกันแต่คนละสาเหตุ และแก้คนละที่ จึงต้องเก็บแยกคอลัมน์
--   *** ห้ามยุ่งกับ ncr_reports_type_check เด็ดขาด *** ค่าเดิม 5 ค่ายังเป็นค่าที่ถูกต้องของแกน "อาการ"
--
--   ทางรับของหน้างาน (P3-6) เคยต้องพา "logistics" ไปกับ description เพราะไม่มีที่เก็บ
--   (ดู 20260902140010_technician_receipt_and_logistics_ncr.sql:458 ที่เขียนไว้ตรง ๆ ว่า
--    "ncr_reports.type ยังไม่มีค่านี้ จึงบันทึกไว้ในคำอธิบายจนกว่าจะมีคอลัมน์ cause_code")
--   migration นี้คือคอลัมน์นั้น
--
--   และ NC ที่เกิดจากผู้ให้บริการภายนอก (ทีมรับเหมา/ซัพพลายเออร์) วันนี้ระบุตัวไม่ได้เลย
--   supplier_claims มีแต่ supplier_name เป็น free text — ผูกกลับไปหาใบสั่งซื้อหรือทีมไม่ได้
--   จึงเพิ่ม ncr_reports.provider_id เป็น FK จริงไปที่ suppliers
--
-- ขอบเขตที่ตั้งใจไม่ทำ:
--   ไม่แก้ข้อความ description ของแถวเดิม — เขียนทับข้อมูลที่คนอื่นพิมพ์ไว้ไม่ใช่งานของ migration
--   ทำแค่ "อ่านแท็กที่อยู่ในข้อความของแถวนั้นเอง แล้วเติม cause_code ให้" เท่านั้น

begin;

-- ---------------------------------------------------------------------------
-- 1) แหล่งความจริงเดียวของรหัสสาเหตุ — ทั้ง constraint, RPC และหน้าจออ่านจากที่นี่
-- ---------------------------------------------------------------------------
create or replace function public.ncr_cause_code_catalog()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object('code', 'MATERIAL',   'label', 'วัสดุ/สินค้า',        'help', 'ตัวสินค้าหรือวัสดุเองไม่ได้มาตรฐานตั้งแต่ต้นทาง'),
    jsonb_build_object('code', 'PRODUCTION', 'label', 'การผลิต',             'help', 'ผลิต ตัด หรือประกอบผิดไปจากแบบ'),
    jsonb_build_object('code', 'INSTALL',    'label', 'การติดตั้ง',           'help', 'วิธีทำงานหน้างานของทีมติดตั้ง'),
    jsonb_build_object('code', 'DESIGN',     'label', 'แบบ/ออกแบบ',          'help', 'แบบผิด วัดผิด หรือสเปกไม่ตรงหน้างานจริง'),
    jsonb_build_object('code', 'LOGISTICS',  'label', 'ขนส่ง/คลัง',          'help', 'ของหาย ตกหล่น จ่ายไม่ครบ หรือไม่ได้โหลดขึ้นรถ'),
    jsonb_build_object('code', 'SITE',       'label', 'หน้างาน/ลูกค้า',       'help', 'สภาพหน้างานหรือเงื่อนไขฝั่งลูกค้าทำให้งานไม่เป็นไปตามข้อกำหนด'),
    jsonb_build_object('code', 'OTHER',      'label', 'อื่น ๆ',              'help', 'ยังจัดกลุ่มไม่ได้ ต้องอธิบายในรายละเอียด')
  );
$function$;

comment on function public.ncr_cause_code_catalog() is
  'รหัสสาเหตุของ NC (แกน "ทำไมถึงเกิด") พร้อมป้ายภาษาไทย — แหล่งความจริงเดียว '
  'ncr_reports_cause_code_check, create_floor_ncr และหน้าจอ /ncr อ่านชุดเดียวกันนี้ทั้งหมด';

revoke all on function public.ncr_cause_code_catalog() from public, anon, authenticated;
grant execute on function public.ncr_cause_code_catalog() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) คอลัมน์ใหม่บน ncr_reports — เพิ่มอย่างเดียว ไม่แตะของเดิม
-- ---------------------------------------------------------------------------
alter table public.ncr_reports add column if not exists cause_code text;
alter table public.ncr_reports add column if not exists provider_id uuid;

-- nullable โดยตั้งใจ: NC เก่าทุกใบไม่มีสาเหตุ และการบังคับให้เดาย้อนหลังจะได้ข้อมูลขยะ
-- "ยังไม่ระบุ" เป็นคำตอบที่ซื่อสัตย์กว่า "OTHER" ที่ถูกใส่เพราะระบบบังคับ
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ncr_reports_cause_code_check'
      and conrelid = 'public.ncr_reports'::regclass
  ) then
    alter table public.ncr_reports add constraint ncr_reports_cause_code_check
      check (
        cause_code is null
        or cause_code in ('MATERIAL', 'PRODUCTION', 'INSTALL', 'DESIGN', 'LOGISTICS', 'SITE', 'OTHER')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ncr_reports_provider_id_fkey'
      and conrelid = 'public.ncr_reports'::regclass
  ) then
    -- ไม่มี on delete: ลบซัพพลายเออร์ที่ยังมี NC ค้างอยู่ไม่ได้ ต้องปิด NC ก่อน
    -- (แบบเดียวกับ floor_technicians_provider_id_fkey ที่ branch นี้เพิ่งเพิ่ม)
    alter table public.ncr_reports add constraint ncr_reports_provider_id_fkey
      foreign key (provider_id) references public.suppliers(id);
  end if;
end $$;

create index if not exists ncr_reports_cause_code_idx on public.ncr_reports(cause_code) where cause_code is not null;
create index if not exists ncr_reports_provider_id_idx on public.ncr_reports(provider_id) where provider_id is not null;

comment on column public.ncr_reports.cause_code is
  'สาเหตุที่ทำให้เกิด NC (ทำไม) — คนละแกนกับ type ที่บอกอาการ (อะไร) '
  'ค่าที่อนุญาตมาจาก public.ncr_cause_code_catalog(); null = ยังไม่ระบุสาเหตุ';
comment on column public.ncr_reports.provider_id is
  'ผู้ให้บริการภายนอกที่เกี่ยวข้องกับ NC ใบนี้ (suppliers.id) — null = งานภายในหรือยังไม่ระบุ '
  'หน้าจอจะโชว์ช่องนี้เฉพาะงานที่ทีมช่างเป็น tech_teams.provider_type = subcontract เท่านั้น';

-- ---------------------------------------------------------------------------
-- 3) ย้ายแท็กข้อความเดิมให้เป็นข้อมูลจริง
--    เฉพาะแถวที่ description ของตัวเองมีแท็ก [logistics] ที่ทางรับของเขียนไว้
--    ไม่แตะ description และไม่เดาสาเหตุให้แถวอื่นเลย
-- ---------------------------------------------------------------------------
update public.ncr_reports
set cause_code = 'LOGISTICS', updated_at = now()
where cause_code is null
  and description is not null
  and position('[logistics]' in description) > 0;

commit;

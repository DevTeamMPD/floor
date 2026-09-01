-- P5-7 — ทะเบียนผู้ให้บริการภายนอก (ISO 9001:2015 ข้อ 8.4.1)
--
-- ความจริงของบริษัทวันนี้ (คำของเจ้าของกิจการ): งานติดตั้ง "ราวครึ่งหนึ่ง" ทำโดยช่างภายนอก
-- แต่ในระบบไม่มีร่องรอยของคนกลุ่มนี้เลย — ทีม A และทีม B ที่อยู่ในระบบคือพนักงานประจำทั้งคู่
-- suppliers มี 0 แถว, purchase_orders/po_items มี 0 แถว และ supplier_claims 11 แถว
-- ระบุซัพพลายเออร์ด้วยข้อความอิสระในคอลัมน์ supplier_name โดยไม่มี id ผูกกลับไปหาใคร
--
-- 8.4.1 ต้องการสองอย่างที่ตารางเดิมตอบไม่ได้:
--   ก) "อนุมัติเพราะอะไร" — เกณฑ์ที่ใช้คัดเลือกและผลของแต่ละเกณฑ์
--   ข) "อนุมัติให้ทำอะไร" — ขอบเขตงาน/สินค้าที่ผู้ให้บริการรายนี้ได้รับอนุมัติ
-- ทั้งสองอย่างนี้ต้องเป็น "ข้อมูล" ที่ค้นได้และตรวจได้ ไม่ใช่ไฟล์ Word ในเครื่องใครสักคน
--
-- ผู้ให้บริการภายนอกของบริษัทนี้มีสองพันธุ์ที่ต่างกันคนละเรื่อง และต้องแยกกันให้ออก:
--   material = ขายของให้เรา (วัสดุ/สินค้า)         -> มีใบสั่งซื้อ มีการตรวจรับของ
--   labor    = ทำงานติดตั้งแทนเรา (ทีมรับเหมา)     -> มีทีมช่าง มีคนหน้างาน มีงานที่ต้องรับรอง
--   both     = ทำทั้งสองอย่าง
-- คอลัมน์ suppliers.provider_kind (branch นี้เพิ่มไว้แล้วที่ 20260901100000:193) คือแกนนั้น
-- ไฟล์นี้ "ใช้" คอลัมน์เดิม ไม่สร้างคอลัมน์คู่ขนานขึ้นมาใหม่ และบังคับให้ทุกแถวที่อนุมัติต้องมีค่านี้
--
-- additive ล้วน: suppliers มี 0 แถว การเพิ่มคอลัมน์/ข้อจำกัดจึงไม่กระทบข้อมูลใคร
-- tech_teams ได้คอลัมน์ nullable เพิ่มหนึ่งตัว (provider_id) — ทีมเดิมสองทีมยังเป็น null ทั้งคู่
-- ไม่มีการลบ เปลี่ยนชื่อ หรือแก้ความหมายของคอลัมน์ใดที่มีอยู่ก่อน branch นี้

begin;

-- ---------------------------------------------------------------------------
-- 1) เกณฑ์การคัดเลือก — แหล่งความจริงเดียว ทั้ง RPC และหน้าจออ่านจากที่นี่
--    (แพตเทิร์นเดียวกับ ncr_cause_code_catalog() ที่งานก่อนหน้าวางไว้)
--
--    แยกตามพันธุ์ของผู้ให้บริการโดยตั้งใจ: "กำลังการผลิตและสต็อกสำรอง" ไม่ใช่คำถามที่ถามทีมช่าง
--    และ "ความปลอดภัยหน้างาน" ไม่ใช่คำถามที่ถามโรงงานที่ส่งของมาให้เรา
--    การยัดเกณฑ์ชุดเดียวให้ทั้งสองพันธุ์จะได้ช่องติ๊กที่ไม่มีความหมาย ซึ่งแย่กว่าไม่มีช่อง
-- ---------------------------------------------------------------------------
create or replace function public.provider_selection_criteria_catalog()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object('code','QUALITY_RECORD','appliesTo','both','label','ผลงานคุณภาพที่ผ่านมา',
      'help','เคยส่งของหรือทำงานให้เราหรือที่อื่นแล้วผลเป็นอย่างไร มีหลักฐานอะไร'),
    jsonb_build_object('code','PRICE_TERMS','appliesTo','both','label','ราคาและเงื่อนไขการชำระเงิน',
      'help','ราคาที่ตกลง เงื่อนไขเครดิต และความชัดเจนของใบเสนอราคา'),
    jsonb_build_object('code','ON_TIME','appliesTo','both','label','ความตรงเวลา',
      'help','ส่งของตามกำหนดหรือเข้างานตามนัดได้จริงแค่ไหน'),
    jsonb_build_object('code','DOCUMENTS','appliesTo','both','label','เอกสารบริษัทและใบรับรอง',
      'help','หนังสือรับรองบริษัท เลขผู้เสียภาษี ใบรับรองมาตรฐาน หรือกรมธรรม์ประกันภัย'),
    jsonb_build_object('code','CAPACITY','appliesTo','material','label','กำลังจัดหาและสต็อกสำรอง',
      'help','รับปริมาณที่เราสั่งไหวไหม ของขาดแล้วมีทางเลือกอะไร'),
    jsonb_build_object('code','WARRANTY','appliesTo','material','label','การรับประกันและการเปลี่ยนคืน',
      'help','ของไม่ผ่านตรวจรับแล้วเปลี่ยนคืนได้ภายในกี่วัน ใครออกค่าขนส่ง'),
    jsonb_build_object('code','CREW_SKILL','appliesTo','labor','label','ฝีมือและประสบการณ์ของทีมช่าง',
      'help','เคยติดตั้งพื้นชนิดไหนมาบ้าง ทีมมีกี่คน หัวหน้าทีมคือใคร'),
    jsonb_build_object('code','SAFETY','appliesTo','labor','label','ความปลอดภัยหน้างาน',
      'help','อุปกรณ์ป้องกัน การดูแลพื้นที่ของลูกค้า และประวัติอุบัติเหตุ'),
    jsonb_build_object('code','REWORK','appliesTo','labor','label','ข้อตกลงเรื่องการแก้งาน',
      'help','งานไม่ผ่านแล้วใครกลับไปแก้ ภายในกี่วัน และใครรับผิดชอบค่าใช้จ่าย')
  );
$function$;

comment on function public.provider_selection_criteria_catalog() is
  'เกณฑ์คัดเลือกผู้ให้บริการตาม ISO 8.4.1 พร้อมป้ายภาษาไทย — appliesTo บอกว่าเกณฑ์นั้นใช้กับ '
  'ผู้ขายวัสดุ (material) ทีมรับเหมาติดตั้ง (labor) หรือทั้งคู่ (both)';

revoke all on function public.provider_selection_criteria_catalog() from public, anon, authenticated;
grant execute on function public.provider_selection_criteria_catalog() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) คอลัมน์ที่ทำให้ suppliers เป็น "ทะเบียน" ได้จริง ไม่ใช่แค่สมุดชื่อ
-- ---------------------------------------------------------------------------
alter table public.suppliers
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_scope text,
  add column if not exists selection_criteria jsonb not null default '[]'::jsonb,
  add column if not exists selection_notes text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists approved_by_name text,
  add column if not exists decision_note text,
  add column if not exists email text,
  add column if not exists tax_id text,
  add column if not exists address text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  -- สถานะ "ระงับ" (P5-10) เก็บหลักฐานไว้บนทะเบียนเอง เพราะทุกด่านที่ต้องบังคับใช้อ่านจากที่นี่
  -- ส่วนประวัติการระงับ/คืนสิทธิ์ทั้งหมดอยู่ในตารางแยก (ดู 20260902220030)
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists suspended_by uuid,
  add column if not exists suspended_by_name text,
  add column if not exists suspended_score numeric,
  add column if not exists suspended_threshold numeric,
  add column if not exists reinstated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='suppliers_approved_by_fkey' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_approved_by_fkey
      foreign key (approved_by) references public.floor_staff_profiles(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='suppliers_suspended_by_fkey' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_suspended_by_fkey
      foreign key (suspended_by) references public.floor_staff_profiles(id);
  end if;

  if not exists (select 1 from pg_constraint where conname='suppliers_approval_status_check' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_approval_status_check
      check (approval_status in ('pending','approved','rejected','suspended'));
  end if;

  if not exists (select 1 from pg_constraint where conname='suppliers_name_not_blank' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_name_not_blank check (btrim(name) <> '');
  end if;

  if not exists (select 1 from pg_constraint where conname='suppliers_selection_criteria_is_array' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_selection_criteria_is_array
      check (jsonb_typeof(selection_criteria) = 'array');
  end if;

  -- หัวใจของ 8.4.1 ในระดับโครงสร้าง: "อนุมัติแล้ว" โดยไม่มีเหตุผลและไม่มีขอบเขต เป็นไปไม่ได้
  -- ไม่ว่าจะเขียนเข้ามาทางไหน (RPC, service_role, psql) ก็ผ่านด่านนี้ไม่ได้
  if not exists (select 1 from pg_constraint where conname='suppliers_approved_needs_evidence' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_approved_needs_evidence
      check (
        approval_status <> 'approved'
        or (
          provider_kind is not null
          and btrim(coalesce(approved_scope,'')) <> ''
          and jsonb_array_length(selection_criteria) > 0
          and approved_by is not null
          and approved_at is not null
        )
      );
  end if;

  -- และ "ระงับ" ต้องมีคนเซ็นและมีเหตุผลเสมอ — ห้ามเป็นแฟล็กที่ระบบตั้งเองเงียบ ๆ (P5-10)
  if not exists (select 1 from pg_constraint where conname='suppliers_suspended_needs_record' and conrelid='public.suppliers'::regclass) then
    alter table public.suppliers add constraint suppliers_suspended_needs_record
      check (
        approval_status <> 'suspended'
        or (
          suspended_at is not null
          and btrim(coalesce(suspension_reason,'')) <> ''
          and suspended_by is not null
          and btrim(coalesce(suspended_by_name,'')) <> ''
        )
      );
  end if;
end $$;

-- ชื่อซ้ำเป๊ะ ๆ ในทะเบียนไม่ควรมี — สองแถวชื่อเดียวกันแปลว่ามีคนกรอกซ้ำ ไม่ใช่มีสองบริษัท
-- (สังเกตว่าเป็น unique บนชื่อดิบ ไม่ใช่ชื่อที่ normalize แล้ว จึงยังเป็นไปได้ที่จะมี
--  "Super Safety" กับ "super safety" อยู่พร้อมกัน ซึ่งเป็น "กำกวม" ที่ตัวจับคู่ใบเคลมต้องยอมแพ้
--  ดู 20260902220020 — การจับคู่จะไม่เดาเมื่อชื่อชี้ไปหาได้มากกว่าหนึ่งบริษัท)
create unique index if not exists suppliers_name_unique on public.suppliers(name);
create index if not exists suppliers_provider_kind_idx on public.suppliers(provider_kind) where provider_kind is not null;
create index if not exists suppliers_approval_status_idx on public.suppliers(approval_status);

comment on column public.suppliers.provider_kind is
  'พันธุ์ของผู้ให้บริการ: material = ขายวัสดุ/สินค้าให้เรา, labor = ทีมรับเหมาที่ทำงานติดตั้งแทนเรา, both = ทั้งสองอย่าง '
  '— ตัวตัดสินว่ารายนี้ออกใบสั่งซื้อให้ได้ไหม (material/both) และผูกทีมช่าง/ช่างเข้ามาได้ไหม (labor/both)';
comment on column public.suppliers.approval_status is
  'pending = รับเข้าทะเบียนแล้วแต่ยังไม่อนุมัติ, approved = อนุมัติแล้วใช้งานได้, rejected = ไม่ผ่านการคัดเลือก, '
  'suspended = ถูกระงับการรับงานใหม่โดยมีผู้อนุมัติและเหตุผลบันทึกไว้ (P5-10)';
comment on column public.suppliers.approved_scope is
  'ขอบเขตที่ได้รับอนุมัติตาม ISO 8.4.1 — อนุมัติให้ส่งของอะไร หรือรับงานติดตั้งชนิดไหน พื้นที่ไหน '
  'ว่างไม่ได้ถ้า approval_status = approved (บังคับด้วย suppliers_approved_needs_evidence)';
comment on column public.suppliers.selection_criteria is
  'เกณฑ์ที่ใช้ตัดสินและผลของแต่ละเกณฑ์ เป็น array ของ {code,label,met,note} '
  'รหัสมาจาก public.provider_selection_criteria_catalog() — ตอบคำถาม 8.4.1 ว่า "อนุมัติเพราะอะไร"';
comment on column public.suppliers.inspection_sample_pct is
  'สัดส่วนที่ต้องสุ่มตรวจตอนรับของจากรายนี้ (%) — ใบรับของจะคัดลอกค่านี้ไปเก็บ ณ เวลาที่รับ (P5-9) '
  'null = ยังไม่กำหนด ให้ผู้รับของตัดสินใจเองและบันทึกไว้ในใบรับ';

-- ---------------------------------------------------------------------------
-- 3) ทีมช่างภายนอกต้องสังกัดบริษัทที่มีตัวตนในทะเบียน
--    floor_technicians.provider_id มีอยู่แล้ว (branch นี้เพิ่มไว้) — เพิ่มฝั่งทีมให้ครบคู่
-- ---------------------------------------------------------------------------
alter table public.tech_teams add column if not exists provider_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='tech_teams_provider_id_fkey' and conrelid='public.tech_teams'::regclass) then
    -- ไม่มี on delete: ลบบริษัทที่ยังมีทีมสังกัดอยู่ไม่ได้ ต้องย้ายทีมออกก่อน
    alter table public.tech_teams add constraint tech_teams_provider_id_fkey
      foreign key (provider_id) references public.suppliers(id);
  end if;

  -- ทีมภายในห้ามมีบริษัทต้นสังกัด และทีมภายนอกต้องมี — ไม่งั้นคำว่า "ทีมภายนอก" ก็ยังลอยเหมือนเดิม
  -- ทีมเดิมสองทีมมี provider_type = null ทั้งคู่ จึงผ่านด่านนี้โดยไม่ต้องแก้ข้อมูลใด
  if not exists (select 1 from pg_constraint where conname='tech_teams_provider_link_consistent' and conrelid='public.tech_teams'::regclass) then
    alter table public.tech_teams add constraint tech_teams_provider_link_consistent
      check (
        (provider_type = 'subcontract' and provider_id is not null)
        or (provider_type is distinct from 'subcontract' and provider_id is null)
      );
  end if;
end $$;

create index if not exists tech_teams_provider_id_idx on public.tech_teams(provider_id) where provider_id is not null;
create index if not exists floor_technicians_provider_id_idx on public.floor_technicians(provider_id) where provider_id is not null;

comment on column public.tech_teams.provider_id is
  'บริษัทผู้รับเหมาที่ทีมนี้สังกัด (suppliers.id) — บังคับให้มีค่าเมื่อ provider_type = subcontract '
  'และต้องเป็น null เมื่อเป็นทีมภายใน';
comment on column public.floor_technicians.provider_id is
  'บริษัทผู้รับเหมาที่ช่างคนนี้สังกัด (suppliers.id) — null = ช่างของบริษัทเราเอง';

-- ---------------------------------------------------------------------------
-- 4) ด่านสิทธิ์ร่วมของงานทะเบียนผู้ให้บริการ
-- ---------------------------------------------------------------------------
create or replace function public.provider_registry_guard(p_roles text[], p_action text)
returns public.floor_staff_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.floor_staff_profiles where id = (select auth.uid()) and is_active;
  if v_actor.id is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงานที่ยังใช้งานอยู่ จึงจะ%ได้', p_action;
  end if;
  if not (v_actor.role = any(p_roles)) then
    raise exception 'บัญชีของคุณไม่มีสิทธิ์%  — ต้องเป็นตำแหน่ง %', p_action, array_to_string(p_roles, ' หรือ ');
  end if;
  return v_actor;
end;
$function$;

comment on function public.provider_registry_guard(text[], text) is
  'ด่านสิทธิ์ร่วมของ RPC ทะเบียนผู้ให้บริการ — คืนแถวพนักงานที่ทำรายการ พร้อมข้อความไทยที่บอกว่า '
  'ต้องเป็นตำแหน่งไหนถึงจะทำสิ่งนี้ได้ เรียกได้จากฟังก์ชัน security definer ตัวอื่นเท่านั้น';

revoke all on function public.provider_registry_guard(text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) ตรวจรูปแบบของ selection_criteria — โครงสร้างเดียวที่ทั้งระบบยอมรับ
-- ---------------------------------------------------------------------------
create or replace function public.normalize_provider_criteria(p_criteria jsonb, p_kind text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_row jsonb;
  v_code text;
  v_cat jsonb := public.provider_selection_criteria_catalog();
  v_entry jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
begin
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_row in select value from jsonb_array_elements(p_criteria) loop
    v_code := nullif(btrim(upper(coalesce(v_row->>'code',''))), '');
    if v_code is null then
      raise exception 'เกณฑ์คัดเลือกบางข้อไม่มีรหัส (code)';
    end if;

    select e.value into v_entry from jsonb_array_elements(v_cat) as e(value) where e.value->>'code' = v_code;
    if v_entry is null then
      raise exception 'ไม่รู้จักเกณฑ์คัดเลือก "%" — เลือกจากรายการที่ระบบให้มาเท่านั้น', v_code;
    end if;

    -- เกณฑ์ของทีมช่างไปโผล่ในใบผู้ขายวัสดุไม่ได้ และกลับกัน
    if v_entry->>'appliesTo' <> 'both' and p_kind is not null and p_kind <> 'both'
       and v_entry->>'appliesTo' <> p_kind then
      raise exception 'เกณฑ์ "%" ใช้กับผู้ให้บริการชนิด % เท่านั้น จึงใช้กับรายนี้ไม่ได้',
        v_entry->>'label', v_entry->>'appliesTo';
    end if;

    if v_code = any(v_seen) then
      raise exception 'เกณฑ์ "%" ถูกส่งมาซ้ำ', v_entry->>'label';
    end if;
    v_seen := v_seen || v_code;

    v_out := v_out || jsonb_build_object(
      'code', v_code,
      'label', v_entry->>'label',
      'met', coalesce((v_row->>'met')::boolean, false),
      'note', nullif(btrim(coalesce(v_row->>'note','')), '')
    );
  end loop;

  return v_out;
end;
$function$;

comment on function public.normalize_provider_criteria(jsonb, text) is
  'ตรวจและจัดรูปเกณฑ์คัดเลือกก่อนบันทึก — รหัสต้องมีในแคตตาล็อก ห้ามซ้ำ และต้องตรงพันธุ์ของผู้ให้บริการ '
  'ป้ายภาษาไทยถูกเติมจากแคตตาล็อกเสมอ หน้าจอจึงส่งมาผิดป้ายไม่ได้';

revoke all on function public.normalize_provider_criteria(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) เพิ่ม/แก้ผู้ให้บริการ — ทางเขียนเดียวของทะเบียน
--    p_id = null -> สร้างใหม่ (สถานะ pending เสมอ) / มีค่า -> แก้ของเดิม
--    *** การอนุมัติไม่ได้อยู่ในฟังก์ชันนี้ *** คนกรอกข้อมูลกับคนอนุมัติต้องแยกกัน
-- ---------------------------------------------------------------------------
create or replace function public.upsert_provider(
  p_id uuid,
  p_name text,
  p_provider_kind text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_tax_id text default null,
  p_address text default null,
  p_lead_time_days integer default null,
  p_payment_terms text default null,
  p_inspection_sample_pct numeric default null,
  p_approved_scope text default null,
  p_selection_criteria jsonb default '[]'::jsonb,
  p_selection_notes text default null,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_name text := nullif(btrim(coalesce(p_name,'')), '');
  v_kind text := nullif(btrim(lower(coalesce(p_provider_kind,''))), '');
  v_criteria jsonb;
  v_id uuid;
  v_existing public.suppliers%rowtype;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'จัดการทะเบียนผู้ให้บริการ');

  if v_name is null then
    raise exception 'ต้องระบุชื่อผู้ให้บริการ';
  end if;
  if v_kind is null or v_kind not in ('material','labor','both') then
    raise exception 'ต้องเลือกชนิดของผู้ให้บริการ: ผู้ขายวัสดุ (material) ทีมรับเหมาติดตั้ง (labor) หรือทั้งสองอย่าง (both)';
  end if;
  if p_inspection_sample_pct is not null and (p_inspection_sample_pct < 0 or p_inspection_sample_pct > 100) then
    raise exception 'สัดส่วนการสุ่มตรวจต้องอยู่ระหว่าง 0 ถึง 100 เปอร์เซ็นต์';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'ระยะเวลารอของ (วัน) ติดลบไม่ได้';
  end if;

  v_criteria := public.normalize_provider_criteria(p_selection_criteria, v_kind);

  if p_id is null then
    insert into public.suppliers(
      name, provider_kind, contact_name, phone, email, tax_id, address,
      lead_time_days, payment_terms, inspection_sample_pct,
      approved_scope, selection_criteria, selection_notes,
      approval_status, is_active, updated_at
    ) values (
      v_name, v_kind,
      nullif(btrim(coalesce(p_contact_name,'')),''), nullif(btrim(coalesce(p_phone,'')),''),
      nullif(btrim(coalesce(p_email,'')),''), nullif(btrim(coalesce(p_tax_id,'')),''),
      nullif(btrim(coalesce(p_address,'')),''),
      p_lead_time_days, nullif(btrim(coalesce(p_payment_terms,'')),''), p_inspection_sample_pct,
      nullif(btrim(coalesce(p_approved_scope,'')),''), v_criteria,
      nullif(btrim(coalesce(p_selection_notes,'')),''),
      'pending', coalesce(p_is_active, true), now()
    ) returning id into v_id;
  else
    select * into v_existing from public.suppliers where id = p_id for update;
    if v_existing.id is null then
      raise exception 'ไม่พบผู้ให้บริการที่ต้องการแก้ไข — อาจถูกลบไปแล้ว';
    end if;

    -- เปลี่ยนพันธุ์ทิ้งความผูกพันที่มีอยู่ไม่ได้: บริษัทที่มีทีมช่างสังกัดอยู่ จะกลายเป็น "ขายของอย่างเดียว" ไม่ได้
    if v_kind = 'material' and exists (
      select 1 from public.tech_teams t where t.provider_id = p_id
      union all select 1 from public.floor_technicians f where f.provider_id = p_id
    ) then
      raise exception 'รายนี้ยังมีทีมช่างหรือช่างสังกัดอยู่ จึงเปลี่ยนเป็น "ผู้ขายวัสดุอย่างเดียว" ไม่ได้ — ย้ายทีม/ช่างออกก่อน';
    end if;
    if v_kind = 'labor' and exists (select 1 from public.purchase_orders po where po.supplier_id = p_id) then
      raise exception 'รายนี้มีใบสั่งซื้ออยู่แล้ว จึงเปลี่ยนเป็น "ทีมรับเหมาอย่างเดียว" ไม่ได้';
    end if;

    update public.suppliers set
      name = v_name,
      provider_kind = v_kind,
      contact_name = nullif(btrim(coalesce(p_contact_name,'')),''),
      phone = nullif(btrim(coalesce(p_phone,'')),''),
      email = nullif(btrim(coalesce(p_email,'')),''),
      tax_id = nullif(btrim(coalesce(p_tax_id,'')),''),
      address = nullif(btrim(coalesce(p_address,'')),''),
      lead_time_days = p_lead_time_days,
      payment_terms = nullif(btrim(coalesce(p_payment_terms,'')),''),
      inspection_sample_pct = p_inspection_sample_pct,
      approved_scope = nullif(btrim(coalesce(p_approved_scope,'')),''),
      selection_criteria = v_criteria,
      selection_notes = nullif(btrim(coalesce(p_selection_notes,'')),''),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'name', v_name,
    'providerKind', v_kind,
    'created', p_id is null,
    'actorName', v_actor.full_name
  );
end;
$function$;

comment on function public.upsert_provider(uuid, text, text, text, text, text, text, text, integer, text, numeric, text, jsonb, text, boolean) is
  'สร้าง/แก้ผู้ให้บริการในทะเบียน (ISO 8.4.1) — role admin หรือ warehouse '
  'ของใหม่เกิดเป็น pending เสมอ การอนุมัติแยกไปที่ decide_provider_approval() คนละคนละขั้นตอน';

-- ---------------------------------------------------------------------------
-- 7) อนุมัติ/ไม่อนุมัติ — ต้องมีคนเซ็นชื่อ มีขอบเขต และมีเกณฑ์อย่างน้อยหนึ่งข้อ
-- ---------------------------------------------------------------------------
create or replace function public.decide_provider_approval(
  p_provider_id uuid,
  p_decision text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_row public.suppliers%rowtype;
  v_decision text := nullif(btrim(lower(coalesce(p_decision,''))), '');
begin
  v_actor := public.provider_registry_guard(array['admin'], 'อนุมัติผู้ให้บริการ');

  if v_decision not in ('approved','rejected') then
    raise exception 'ผลการพิจารณาต้องเป็น "อนุมัติ" (approved) หรือ "ไม่อนุมัติ" (rejected) เท่านั้น';
  end if;

  select * into v_row from public.suppliers where id = p_provider_id for update;
  if v_row.id is null then
    raise exception 'ไม่พบผู้ให้บริการที่ต้องการพิจารณา';
  end if;
  if v_row.approval_status = 'suspended' then
    raise exception 'รายนี้ถูกระงับอยู่ ต้องคืนสิทธิ์ก่อนจึงจะพิจารณาอนุมัติใหม่ได้';
  end if;

  if v_decision = 'approved' then
    if v_row.provider_kind is null then
      raise exception 'ยังไม่ได้ระบุชนิดของผู้ให้บริการ จึงอนุมัติไม่ได้';
    end if;
    if nullif(btrim(coalesce(v_row.approved_scope,'')), '') is null then
      raise exception 'ต้องระบุขอบเขตที่อนุมัติก่อน (อนุมัติให้ส่งของอะไร หรือรับงานติดตั้งชนิดไหน) — ISO 8.4.1 บังคับให้บอกได้ว่าอนุมัติให้ทำอะไร';
    end if;
    if jsonb_array_length(v_row.selection_criteria) = 0 then
      raise exception 'ต้องบันทึกเกณฑ์ที่ใช้ตัดสินอย่างน้อยหนึ่งข้อก่อน — ISO 8.4.1 บังคับให้บอกได้ว่าอนุมัติเพราะอะไร';
    end if;

    update public.suppliers set
      approval_status = 'approved',
      approved_at = now(),
      approved_by = v_actor.id,
      approved_by_name = v_actor.full_name,
      decision_note = nullif(btrim(coalesce(p_note,'')),''),
      updated_at = now()
    where id = p_provider_id;
  else
    if nullif(btrim(coalesce(p_note,'')), '') is null then
      raise exception 'การไม่อนุมัติต้องระบุเหตุผล';
    end if;
    update public.suppliers set
      approval_status = 'rejected',
      approved_at = null,
      approved_by = v_actor.id,
      approved_by_name = v_actor.full_name,
      decision_note = btrim(p_note),
      updated_at = now()
    where id = p_provider_id;
  end if;

  return jsonb_build_object(
    'id', p_provider_id,
    'decision', v_decision,
    'decidedByName', v_actor.full_name,
    'decidedAt', now()
  );
end;
$function$;

comment on function public.decide_provider_approval(uuid, text, text) is
  'อนุมัติหรือไม่อนุมัติผู้ให้บริการ (role admin) — อนุมัติได้ต่อเมื่อมีชนิด ขอบเขต และเกณฑ์อย่างน้อยหนึ่งข้อ '
  'และบันทึกชื่อผู้อนุมัติกับเวลาไว้เสมอ (ISO 8.4.1)';

-- ---------------------------------------------------------------------------
-- 8) ผูกทีมช่างและช่างเข้ากับบริษัทต้นสังกัด
-- ---------------------------------------------------------------------------
create or replace function public.set_tech_team_provider(
  p_team_id uuid,
  p_provider_type text,
  p_provider_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_team public.tech_teams%rowtype;
  v_provider public.suppliers%rowtype;
  v_type text := nullif(btrim(lower(coalesce(p_provider_type,''))), '');
begin
  v_actor := public.provider_registry_guard(array['admin','head_technician'], 'ผูกทีมช่างกับบริษัทผู้รับเหมา');

  if v_type is null or v_type not in ('in_house','subcontract') then
    raise exception 'ชนิดของทีมต้องเป็น "ทีมภายใน" (in_house) หรือ "ทีมรับเหมาภายนอก" (subcontract)';
  end if;

  select * into v_team from public.tech_teams where id = p_team_id for update;
  if v_team.id is null then
    raise exception 'ไม่พบทีมช่างที่เลือก';
  end if;

  if v_type = 'in_house' then
    if p_provider_id is not null then
      raise exception 'ทีมภายในไม่มีบริษัทต้นสังกัด — ถ้าเป็นทีมของผู้รับเหมาให้เลือกชนิดเป็นทีมภายนอก';
    end if;
    if exists (select 1 from public.floor_technicians f where f.team_id = p_team_id and f.provider_id is not null) then
      raise exception 'ทีมนี้ยังมีช่างที่สังกัดบริษัทภายนอกอยู่ จึงเปลี่ยนเป็นทีมภายในไม่ได้ — ย้ายช่างออกหรือปลดสังกัดก่อน';
    end if;
    update public.tech_teams set provider_type = 'in_house', provider_id = null where id = p_team_id;
  else
    if p_provider_id is null then
      raise exception 'ทีมรับเหมาภายนอกต้องระบุว่าสังกัดบริษัทใดในทะเบียนผู้ให้บริการ';
    end if;
    select * into v_provider from public.suppliers where id = p_provider_id;
    if v_provider.id is null then
      raise exception 'ไม่พบบริษัทผู้ให้บริการที่เลือก';
    end if;
    if coalesce(v_provider.provider_kind,'') not in ('labor','both') then
      raise exception 'บริษัท "%" ขึ้นทะเบียนไว้เป็นผู้ขายวัสดุ ไม่ใช่ทีมรับเหมาติดตั้ง จึงผูกทีมช่างเข้ากับรายนี้ไม่ได้', v_provider.name;
    end if;
    if v_provider.approval_status <> 'approved' then
      raise exception 'บริษัท "%" ยังไม่ผ่านการอนุมัติ (สถานะ: %) จึงยังผูกทีมช่างเข้ามาไม่ได้', v_provider.name, v_provider.approval_status;
    end if;
    update public.tech_teams set provider_type = 'subcontract', provider_id = p_provider_id where id = p_team_id;
  end if;

  return jsonb_build_object('teamId', p_team_id, 'providerType', v_type, 'providerId', p_provider_id, 'actorName', v_actor.full_name);
end;
$function$;

comment on function public.set_tech_team_provider(uuid, text, uuid) is
  'ตั้งว่าทีมช่างเป็นทีมภายในหรือทีมรับเหมาภายนอก และผูกกับบริษัทในทะเบียน (role admin/head_technician) '
  'ทีมภายนอกต้องสังกัดบริษัทที่อนุมัติแล้วและเป็นชนิด labor/both เท่านั้น';

create or replace function public.set_technician_provider(
  p_technician_id uuid,
  p_provider_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_tech public.floor_technicians%rowtype;
  v_provider public.suppliers%rowtype;
begin
  v_actor := public.provider_registry_guard(array['admin','head_technician'], 'ผูกช่างกับบริษัทผู้รับเหมา');

  select * into v_tech from public.floor_technicians where id = p_technician_id for update;
  if v_tech.id is null then
    raise exception 'ไม่พบช่างที่เลือก';
  end if;

  if p_provider_id is null then
    update public.floor_technicians set provider_id = null, updated_at = now() where id = p_technician_id;
    return jsonb_build_object('technicianId', p_technician_id, 'providerId', null, 'actorName', v_actor.full_name);
  end if;

  select * into v_provider from public.suppliers where id = p_provider_id;
  if v_provider.id is null then
    raise exception 'ไม่พบบริษัทผู้ให้บริการที่เลือก';
  end if;
  if coalesce(v_provider.provider_kind,'') not in ('labor','both') then
    raise exception 'บริษัท "%" ขึ้นทะเบียนไว้เป็นผู้ขายวัสดุ ไม่ใช่ทีมรับเหมาติดตั้ง จึงผูกช่างเข้ากับรายนี้ไม่ได้', v_provider.name;
  end if;
  if v_provider.approval_status <> 'approved' then
    raise exception 'บริษัท "%" ยังไม่ผ่านการอนุมัติ (สถานะ: %) จึงยังผูกช่างเข้ามาไม่ได้', v_provider.name, v_provider.approval_status;
  end if;

  update public.floor_technicians set provider_id = p_provider_id, updated_at = now() where id = p_technician_id;

  return jsonb_build_object('technicianId', p_technician_id, 'providerId', p_provider_id, 'actorName', v_actor.full_name);
end;
$function$;

comment on function public.set_technician_provider(uuid, uuid) is
  'ผูกช่างหนึ่งคนเข้ากับบริษัทผู้รับเหมาในทะเบียน หรือปลดสังกัด (ส่ง null) — role admin/head_technician';

-- ---------------------------------------------------------------------------
-- 9) ข้อมูลทั้งหน้าจอในคำขอเดียว — รวมความจริงที่ว่า "วันนี้ยังว่าง"
-- ---------------------------------------------------------------------------
create or replace function public.provider_register_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_providers jsonb;
  v_teams jsonb;
  v_techs jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะเปิดทะเบียนผู้ให้บริการได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p."name"), '[]'::jsonb) into v_providers
  from (
    select s.id, s.name, s.provider_kind as "providerKind", s.approval_status as "approvalStatus",
           s.approved_scope as "approvedScope", s.selection_criteria as "selectionCriteria",
           s.selection_notes as "selectionNotes", s.approved_at as "approvedAt",
           s.approved_by_name as "approvedByName", s.decision_note as "decisionNote",
           s.contact_name as "contactName", s.phone, s.email, s.tax_id as "taxId", s.address,
           s.lead_time_days as "leadTimeDays", s.payment_terms as "paymentTerms",
           s.inspection_sample_pct as "inspectionSamplePct", s.is_active as "isActive",
           s.created_at as "createdAt",
           s.suspended_at as "suspendedAt", s.suspension_reason as "suspensionReason",
           s.suspended_by_name as "suspendedByName", s.suspended_score as "suspendedScore",
           s.suspended_threshold as "suspendedThreshold", s.reinstated_at as "reinstatedAt",
           (select count(*) from public.tech_teams t where t.provider_id = s.id)::int as "teamCount",
           (select count(*) from public.floor_technicians f where f.provider_id = s.id)::int as "technicianCount",
           (select count(*) from public.purchase_orders po where po.supplier_id = s.id)::int as "poCount",
           (select count(*) from public.ncr_reports n where n.provider_id = s.id)::int as "ncrCount"
    from public.suppliers s
  ) p;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t."name"), '[]'::jsonb) into v_teams
  from (
    select tt.id, tt.name, tt.provider_type as "providerType", tt.provider_id as "providerId",
           coalesce(tt.is_active, true) as "isActive", tt.eval_avg as "evalAvg",
           (select count(*) from public.floor_technicians f where f.team_id = tt.id and f.is_active)::int as "memberCount"
    from public.tech_teams tt
  ) t;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."name"), '[]'::jsonb) into v_techs
  from (
    select f.id, f.name, f.team_id as "teamId", f.provider_id as "providerId",
           f.is_active as "isActive", f.is_team_lead as "isTeamLead",
           (select tt.name from public.tech_teams tt where tt.id = f.team_id) as "teamName"
    from public.floor_technicians f
  ) x;

  return jsonb_build_object(
    'providers', v_providers,
    'teams', v_teams,
    'technicians', v_techs,
    'criteria', public.provider_selection_criteria_catalog(),
    'summary', jsonb_build_object(
      'providerCount', jsonb_array_length(v_providers),
      'teamCount', jsonb_array_length(v_teams),
      'technicianCount', jsonb_array_length(v_techs)
    )
  );
end;
$function$;

comment on function public.provider_register_snapshot() is
  'ข้อมูลทั้งหน้าทะเบียนผู้ให้บริการในคำขอเดียว — รายชื่อผู้ให้บริการพร้อมจำนวนทีม/ช่าง/ใบสั่งซื้อ/NC ที่ผูกอยู่ '
  'บวกรายชื่อทีมช่างและช่างทั้งหมดเพื่อให้ผูกสังกัดได้จากหน้าเดียว';

-- ---------------------------------------------------------------------------
-- 10) สิทธิ์ — anon ต้องไม่เหลืออะไรเลย และ client เขียนตารางตรง ๆ ไม่ได้
--     policy เดิม suppliers.authenticated_all ไม่ถูกลบ (ห้ามลบของเดิม) แต่ grant ระดับตาราง
--     ถูกถอนจนเหลือ select อย่างเดียว — แพตเทิร์นเดียวกับที่ P3-6 ทำกับ ncr_reports
--     ผลคือทางเขียนเดียวที่เหลือคือ RPC ข้างบนนี้ ซึ่งตรวจตำแหน่งงานทุกครั้ง
-- ---------------------------------------------------------------------------
revoke all on public.suppliers from anon;
revoke insert, update, delete, truncate on public.suppliers from authenticated;
grant select on public.suppliers to authenticated;

revoke all on function public.upsert_provider(uuid, text, text, text, text, text, text, text, integer, text, numeric, text, jsonb, text, boolean) from public, anon;
grant execute on function public.upsert_provider(uuid, text, text, text, text, text, text, text, integer, text, numeric, text, jsonb, text, boolean) to authenticated, service_role;

revoke all on function public.decide_provider_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_provider_approval(uuid, text, text) to authenticated, service_role;

revoke all on function public.set_tech_team_provider(uuid, text, uuid) from public, anon;
grant execute on function public.set_tech_team_provider(uuid, text, uuid) to authenticated, service_role;

revoke all on function public.set_technician_provider(uuid, uuid) from public, anon;
grant execute on function public.set_technician_provider(uuid, uuid) to authenticated, service_role;

revoke all on function public.provider_register_snapshot() from public, anon;
grant execute on function public.provider_register_snapshot() to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

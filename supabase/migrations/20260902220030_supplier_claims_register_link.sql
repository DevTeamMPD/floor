-- P5-9 (ต่อ) — ผูกใบเคลมผู้ขายเข้ากับทะเบียนผู้ให้บริการ โดยไม่แตะข้อความที่คนอื่นพิมพ์ไว้
--
-- สภาพจริงของ supplier_claims วันนี้ (11 แถว, สำรวจไว้ใน recon C15):
--   ระบุผู้ขายด้วยข้อความอิสระในคอลัมน์ supplier_name เท่านั้น ไม่มี id ไม่มี FK
--   และมีเพียง 1 ใน 11 แถวที่ supplier_name มีค่า อีก 10 แถวเป็น NULL
--   ไม่มีไฟล์ไหนใน repo เขียนตารางนี้เลย — ข้อมูลมาจากเครื่องมืออื่น
--
-- สิ่งที่ไฟล์นี้ทำ และสิ่งที่ตั้งใจไม่ทำ:
--   ทำ:    เพิ่มคอลัมน์ supplier_id (nullable, FK -> suppliers) และฟังก์ชันจับคู่ที่เรียกซ้ำได้
--   ไม่ทำ: ไม่แก้ ไม่ล้าง ไม่ normalize คอลัมน์ supplier_name ของแถวใดเลยแม้แต่แถวเดียว
--          ข้อความที่คนพิมพ์ไว้คือหลักฐาน การเขียนทับมันคือการทำลายหลักฐาน
--
-- กติกาการจับคู่ — ตั้งใจให้ "ขี้ขลาด" ไว้ก่อน:
--   เทียบชื่อแบบ normalize เบา ๆ เท่านั้น (ตัดช่องว่างหัวท้าย ยุบช่องว่างซ้ำ ไม่สนตัวพิมพ์เล็กใหญ่)
--   ไม่ตัดเครื่องหมายวรรคตอน ไม่ตัดคำว่า "บริษัท/จำกัด" ไม่เทียบแบบมีคำใดคำหนึ่งตรงกัน
--   เพราะการเทียบหลวมกว่านี้คือการ "เดา" และการเดาผิดหนึ่งครั้งจะทำให้ใบเคลมไปเกาะบริษัทที่ไม่ผิด
--   ซึ่งกระทบคะแนนและอาจนำไปสู่การระงับผู้ให้บริการที่ไม่ได้ทำอะไรผิด (P5-10)
--
--   ชื่อที่ normalize แล้วต้องชี้ไปหาบริษัทเดียวเท่านั้นจึงจะจับคู่:
--     ชี้ไปหา 0 บริษัท  -> ปล่อยว่างไว้ (ยังไม่รู้จักบริษัทนี้ในทะเบียน)
--     ชี้ไปหา >1 บริษัท -> ปล่อยว่างไว้ และรายงานว่ากำกวม (เช่นทะเบียนมีทั้ง "Super Safety"
--                          และ "super safety" ซึ่ง unique index บนชื่อดิบไม่ได้ห้ามไว้)
--     supplier_name ว่าง/NULL -> ปล่อยว่างไว้ ไม่มีอะไรให้เทียบ
--   แถวที่มี supplier_id อยู่แล้วจะไม่ถูกแตะซ้ำ คนที่ผูกมือไว้ชนะเครื่องเสมอ
--
-- ผลวันนี้: suppliers มี 0 แถว การจับคู่จึงได้ 0 คู่และไม่มีแถวใดเปลี่ยน — ถูกต้องและว่างเปล่า
-- เมื่อเจ้าของกิจการลงทะเบียนบริษัทจริงแล้วเรียกซ้ำ แถวที่ชื่อตรงชัดเจนจะถูกผูกให้เอง

begin;

alter table public.supplier_claims add column if not exists supplier_id uuid;
alter table public.supplier_claims add column if not exists supplier_matched_at timestamptz;
alter table public.supplier_claims add column if not exists supplier_match_method text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='supplier_claims_supplier_id_fkey' and conrelid='public.supplier_claims'::regclass) then
    alter table public.supplier_claims add constraint supplier_claims_supplier_id_fkey
      foreign key (supplier_id) references public.suppliers(id);
  end if;
  if not exists (select 1 from pg_constraint where conname='supplier_claims_match_method_check' and conrelid='public.supplier_claims'::regclass) then
    alter table public.supplier_claims add constraint supplier_claims_match_method_check
      check (supplier_match_method is null or supplier_match_method in ('auto_exact_name','manual'));
  end if;
end $$;

create index if not exists supplier_claims_supplier_id_idx on public.supplier_claims(supplier_id) where supplier_id is not null;

comment on column public.supplier_claims.supplier_id is
  'บริษัทในทะเบียนผู้ให้บริการที่ใบเคลมนี้อ้างถึง (suppliers.id) — null = ยังจับคู่ไม่ได้ '
  'คอลัมน์ supplier_name เดิมยังเป็นข้อความที่คนพิมพ์ไว้ตามเดิมทุกตัวอักษร ไม่เคยถูกเขียนทับ';
comment on column public.supplier_claims.supplier_match_method is
  'auto_exact_name = ระบบจับคู่ให้เพราะชื่อตรงกันแบบไม่กำกวม, manual = คนเลือกเอง';

-- ---------------------------------------------------------------------------
-- วิธี normalize ชื่อ — ที่เดียวในระบบ ทั้งการจับคู่และการรายงานใช้ตัวเดียวกัน
-- ---------------------------------------------------------------------------
create or replace function public.normalize_provider_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(lower(btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g'))), '');
$function$;

comment on function public.normalize_provider_name(text) is
  'ปรับชื่อบริษัทให้เทียบกันได้แบบระมัดระวัง: ตัดช่องว่างหัวท้าย ยุบช่องว่างซ้ำ ไม่สนตัวพิมพ์ '
  'ไม่ตัดเครื่องหมายวรรคตอนและไม่ตัดคำว่า บริษัท/จำกัด เพราะนั่นคือการเดา';

revoke all on function public.normalize_provider_name(text) from public, anon, authenticated;
grant execute on function public.normalize_provider_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- จับคู่ใบเคลมกับทะเบียน — เรียกซ้ำได้ ผลเท่าเดิม และรายงานเหตุผลของทุกแถวที่ไม่จับคู่
-- ---------------------------------------------------------------------------
create or replace function public.match_supplier_claims_to_register(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_claim record;
  v_hits int;
  v_supplier_id uuid;
  v_matched int := 0;
  v_ambiguous int := 0;
  v_unknown int := 0;
  v_blank int := 0;
  v_already int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'จับคู่ใบเคลมกับทะเบียนผู้ให้บริการ');

  for v_claim in
    select c.id, c.supplier_name, c.supplier_id,
           public.normalize_provider_name(c.supplier_name) as norm
    from public.supplier_claims c
    order by c.created_at
  loop
    if v_claim.supplier_id is not null then
      v_already := v_already + 1;
      continue;
    end if;

    if v_claim.norm is null then
      v_blank := v_blank + 1;
      v_details := v_details || jsonb_build_object('claimId', v_claim.id, 'outcome', 'blank',
        'reason', 'ใบนี้ไม่ได้ระบุชื่อผู้ขายไว้เลย จึงไม่มีอะไรให้เทียบ');
      continue;
    end if;

    select count(*), min(s.id) into v_hits, v_supplier_id
    from public.suppliers s
    where public.normalize_provider_name(s.name) = v_claim.norm;

    if v_hits = 1 then
      if not p_dry_run then
        update public.supplier_claims
        set supplier_id = v_supplier_id,
            supplier_matched_at = now(),
            supplier_match_method = 'auto_exact_name'
        where id = v_claim.id;
      end if;
      v_matched := v_matched + 1;
      v_details := v_details || jsonb_build_object('claimId', v_claim.id, 'outcome', 'matched', 'supplierId', v_supplier_id);
    elsif v_hits > 1 then
      v_ambiguous := v_ambiguous + 1;
      v_details := v_details || jsonb_build_object('claimId', v_claim.id, 'outcome', 'ambiguous', 'candidates', v_hits,
        'reason', format('ชื่อนี้ตรงกับบริษัทในทะเบียน %s ราย จึงไม่เดาให้ — กรุณาเลือกเอง', v_hits));
    else
      v_unknown := v_unknown + 1;
      v_details := v_details || jsonb_build_object('claimId', v_claim.id, 'outcome', 'unknown',
        'reason', 'ยังไม่มีบริษัทชื่อนี้ในทะเบียนผู้ให้บริการ');
    end if;
  end loop;

  return jsonb_build_object(
    'dryRun', p_dry_run,
    'total', (select count(*) from public.supplier_claims)::int,
    'matched', v_matched,
    'alreadyLinked', v_already,
    'ambiguous', v_ambiguous,
    'unknownName', v_unknown,
    'noName', v_blank,
    'details', v_details,
    'actorName', v_actor.full_name
  );
end;
$function$;

comment on function public.match_supplier_claims_to_register(boolean) is
  'จับคู่ supplier_claims กับ suppliers ด้วยชื่อที่ normalize แล้วแบบตรงเป๊ะเท่านั้น '
  'ชื่อที่ชี้ไปหาบริษัทมากกว่าหนึ่งราย หรือไม่ชี้ไปหาใครเลย จะถูกปล่อยว่างไว้ ไม่เดา '
  'ไม่แก้ supplier_name ของแถวใด และเรียกซ้ำได้โดยผลไม่เปลี่ยน (p_dry_run = ดูผลโดยไม่เขียน)';

revoke all on function public.match_supplier_claims_to_register(boolean) from public, anon;
grant execute on function public.match_supplier_claims_to_register(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ผูกด้วยมือ เมื่อเครื่องไม่กล้าเดา
-- ---------------------------------------------------------------------------
create or replace function public.link_supplier_claim(p_claim_id uuid, p_supplier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_claim public.supplier_claims%rowtype;
begin
  v_actor := public.provider_registry_guard(array['admin','warehouse'], 'ผูกใบเคลมกับผู้ให้บริการ');

  select * into v_claim from public.supplier_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'ไม่พบใบเคลมที่เลือก'; end if;

  if p_supplier_id is null then
    update public.supplier_claims
    set supplier_id = null, supplier_matched_at = null, supplier_match_method = null
    where id = p_claim_id;
    return jsonb_build_object('claimId', p_claim_id, 'supplierId', null);
  end if;

  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'ไม่พบผู้ให้บริการที่เลือกในทะเบียน';
  end if;

  update public.supplier_claims
  set supplier_id = p_supplier_id, supplier_matched_at = now(), supplier_match_method = 'manual'
  where id = p_claim_id;

  return jsonb_build_object('claimId', p_claim_id, 'supplierId', p_supplier_id, 'actorName', v_actor.full_name);
end;
$function$;

comment on function public.link_supplier_claim(uuid, uuid) is
  'ผูกใบเคลมหนึ่งใบเข้ากับผู้ให้บริการด้วยมือ หรือปลดการผูก (ส่ง null) — ไม่แตะ supplier_name เช่นกัน';

revoke all on function public.link_supplier_claim(uuid, uuid) from public, anon;
grant execute on function public.link_supplier_claim(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- รายการใบเคลมสำหรับหน้าจอ (อ่านอย่างเดียว)
-- ---------------------------------------------------------------------------
create or replace function public.supplier_claims_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
begin
  if not (select public.is_floor_staff_active()) then
    raise exception 'ต้องเป็นพนักงานที่ยังใช้งานอยู่จึงจะดูใบเคลมผู้ขายได้';
  end if;

  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c."createdAt" desc), '[]'::jsonb) into v_rows
  from (
    select cl.id, cl.status, cl.supplier_name as "supplierName", cl.supplier_id as "supplierId",
           cl.supplier_match_method as "matchMethod", cl.product_name as "productName",
           cl.order_number as "orderNumber", cl.ticket_id as "ticketId",
           cl.claim_amount as "claimAmount", cl.created_at as "createdAt",
           s.name as "registeredName"
    from public.supplier_claims cl
    left join public.suppliers s on s.id = cl.supplier_id
  ) c;

  return jsonb_build_object(
    'claims', v_rows,
    'unlinked', (select count(*) from public.supplier_claims where supplier_id is null)::int,
    'withName', (select count(*) from public.supplier_claims where public.normalize_provider_name(supplier_name) is not null)::int
  );
end;
$function$;

comment on function public.supplier_claims_snapshot() is
  'ใบเคลมผู้ขายทั้งหมดพร้อมสถานะการจับคู่กับทะเบียน — โชว์ทั้งชื่อที่พิมพ์ไว้เดิมและชื่อในทะเบียน '
  'เพื่อให้คนตรวจได้ว่าจับคู่ถูกหรือไม่';

revoke all on function public.supplier_claims_snapshot() from public, anon;
grant execute on function public.supplier_claims_snapshot() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- สิทธิ์ระดับตาราง: anon ถือสิทธิ์ครบทุกอย่างบน supplier_claims รวม TRUNCATE มาตั้งแต่ก่อน branch นี้
-- ซึ่ง TRUNCATE ไม่ผ่าน RLS — ถอนทิ้งทั้งหมด ตารางนี้มีข้อมูลจริง 11 แถวของบริษัท
-- policy เดิมทั้งสี่ตัวไม่ถูกแตะ (อ่าน/เขียนของ authenticated ยังเป็นไปตามที่เคยตั้งไว้)
-- ---------------------------------------------------------------------------
revoke all on public.supplier_claims from anon;
revoke truncate on public.supplier_claims from authenticated;

-- เรียกจับคู่หนึ่งครั้งทันทีในฐานะ migration (service_role) — วันนี้ทะเบียนว่าง ผลจึงเป็น 0 คู่
-- เขียนไว้ตรงนี้เพื่อให้เห็นชัดว่าการจับคู่เป็นการกระทำที่บันทึกได้ ไม่ใช่เวทมนตร์ตอน deploy
do $$
declare
  v_updated int := 0;
begin
  update public.supplier_claims c
  set supplier_id = s.id, supplier_matched_at = now(), supplier_match_method = 'auto_exact_name'
  from public.suppliers s
  where c.supplier_id is null
    and public.normalize_provider_name(c.supplier_name) is not null
    and public.normalize_provider_name(s.name) = public.normalize_provider_name(c.supplier_name)
    and (select count(*) from public.suppliers s2
         where public.normalize_provider_name(s2.name) = public.normalize_provider_name(c.supplier_name)) = 1;
  get diagnostics v_updated = row_count;
  raise notice 'จับคู่ใบเคลมกับทะเบียนผู้ให้บริการได้ % แถว (ทะเบียนมี % ราย)',
    v_updated, (select count(*) from public.suppliers);
end $$;

notify pgrst, 'reload schema';

commit;

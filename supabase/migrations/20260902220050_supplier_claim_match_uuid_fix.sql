-- P5-9 (แก้) — match_supplier_claims_to_register เรียกไม่ผ่านเลยเพราะ min(uuid) ไม่มีใน postgres
--
-- พบจากโพรบจริง ไม่ใช่จากการอ่านโค้ด: การเรียกฟังก์ชันล้มทันทีด้วย
--   ERROR: 42883 function min(uuid) does not exist
-- ต้นเหตุ: 20260902220030 ใช้ `select count(*), min(s.id) into v_hits, v_supplier_id`
-- เพื่อ "นับผู้เข้าข่ายและหยิบตัวเดียวมาในคำสั่งเดียว" ซึ่ง postgres ไม่มี aggregate min สำหรับ uuid
--
-- เหตุผลที่แก้ด้วยการแยกเป็นสองขั้นแทนการ cast เป็น text แล้ว min:
--   min(uuid::text) จะ "เลือกตัวที่ชื่อ id เรียงน้อยที่สุด" ซึ่งเป็นการเลือกโดยพลการ
--   และจะทำงานเงียบ ๆ แม้ในกรณีที่มีผู้เข้าข่ายหลายราย ซึ่งตรงข้ามกับเจตนาทั้งหมดของฟังก์ชันนี้
--   การนับก่อนแล้วค่อยหยิบเมื่อนับได้ 1 เท่านั้น ทำให้ "ไม่เดา" เป็นสิ่งที่โครงสร้างของโค้ดบังคับ
--   ไม่ใช่สิ่งที่ต้องอาศัยความระวังของคนอ่าน
--
-- ลายเซ็นเดิมทุกตัวอักษร (create or replace) พฤติกรรมที่ตั้งใจไม่เปลี่ยน:
--   ชี้ไปหา 1 ราย = จับคู่, ชี้ไปหา 0 หรือ >1 ราย = ปล่อยว่าง, ไม่แตะ supplier_name เหมือนเดิม

begin;

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

    -- นับก่อนเสมอ แล้วค่อยหยิบ "เมื่อมีรายเดียวเท่านั้น"
    select count(*) into v_hits
    from public.suppliers s
    where public.normalize_provider_name(s.name) = v_claim.norm;

    if v_hits = 1 then
      select s.id into v_supplier_id
      from public.suppliers s
      where public.normalize_provider_name(s.name) = v_claim.norm;

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

revoke all on function public.match_supplier_claims_to_register(boolean) from public, anon;
grant execute on function public.match_supplier_claims_to_register(boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

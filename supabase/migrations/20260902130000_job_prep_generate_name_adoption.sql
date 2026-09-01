-- FloorNow P3-2 (แก้ตามรีวิว C1): ทำให้ "ทางสำรองที่ผูกบรรทัดเดิมกลับเข้าแม่แบบด้วยชื่อ" ปลอดภัย
--
-- ของเดิมทำอะไรผิด:
--   ตัวสร้างรายการ (20260902110010) มีทางสำรองว่า ถ้าหาบรรทัดที่ template_item_id = บรรทัดแม่แบบไม่เจอ
--   ให้มองหาบรรทัดที่ "ชื่อตรงกัน" แทน แล้วถือว่ามีบรรทัดนี้อยู่แล้ว → ข้ามไป
--   เงื่อนไขมีแค่ template_item_id is null + ชื่อตรงกัน จึงเกิดกรณีนี้ได้:
--     หัวหน้าช่างกด "เพิ่มรายการนอกแม่แบบ" ชื่อ "กาว" จำนวน 1 หลอด (เพราะจำได้ว่าต้องใช้)
--     แล้วกด "สร้างรายการจากแม่แบบ" → แม่แบบสั่ง "กาว" 6 หลอด แต่ระบบเห็นว่ามีบรรทัดชื่อ "กาว" แล้ว
--     จึงข้ามเงียบ ๆ ตลอดไป · ช่างออกหน้างานพร้อมกาว 1 หลอดแทนที่จะเป็น 6
--   ผู้ใช้เห็นแค่คำว่า "มีบรรทัดชื่อเดียวกันอยู่แล้ว" ซึ่งไม่ได้บอกว่าจำนวนผิด
--
-- กฎใหม่ — ทางสำรองนี้มีไว้ "รับบรรทัดที่ถูก confirm_floor_work_order_v2 ล้าง template_item_id ทิ้ง"
-- กลับเข้าแม่แบบเท่านั้น จึงรับได้เฉพาะบรรทัดที่ผ่านครบทั้งสี่ข้อ:
--   1) ยังไม่ผูกกับบรรทัดแม่แบบใด (template_item_id is null)
--   2) ไม่ใช่บรรทัดที่คนแก้เอง (is_manual_override = false — add_job_prep_item ตั้ง true เสมอ)
--   3) ไม่มีบันทึกใน job_prep_item_overrides ว่าเป็นบรรทัดที่คนเพิ่มนอกแม่แบบ (change_kind = 'added')
--   4) ชื่อนี้ต้องชี้บรรทัดเดียวชัดเจน — ทั้งฝั่งใบสั่งงาน (เจอ 1 บรรทัด) และฝั่งแม่แบบ
--      (บรรทัดแม่แบบสองบรรทัดชื่อซ้ำกัน = ผูกด้วยชื่อไม่ได้เลย)
-- และเมื่อรับกลับได้จริง ต้อง "เขียน template_item_id กลับลงไป" ด้วย ไม่ใช่แค่ข้าม
-- ครั้งต่อไปจะได้ผูกด้วย id ตรง ๆ ไม่ต้องพึ่งชื่ออีก
--
-- เมื่อรับกลับไม่ได้ ห้ามข้ามเด็ดขาด: ต้องสร้างบรรทัดของแม่แบบตามจำนวนที่คำนวณได้เสมอ
-- แล้วรายงานกลับเป็น name_conflicts ให้หน้าจอเตือนเป็นภาษาไทยว่า "มีสองบรรทัดชื่อเดียวกัน ให้ไปดู"
-- ยอมให้ผู้ใช้เห็นบรรทัดซ้ำแล้วตัดสินใจเอง ดีกว่าปล่อยให้ของขาดโดยไม่มีใครรู้
--
-- additive ล้วน: ไม่แตะโครงตาราง ไม่แตะข้อมูลแถวเดิม แทนที่เฉพาะตัวฟังก์ชัน
-- v2 ของ confirm ไม่ถูกแตะในไฟล์นี้ (ดู 20260902130020_confirm_floor_work_order_v3.sql)

begin;

create or replace function public.generate_job_prep_items(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.floor_staff_profiles%rowtype;
  v_order public.floor_work_orders%rowtype;
  v_job public.install_jobs%rowtype;
  v_job_type public.job_types%rowtype;
  v_template public.job_prep_templates%rowtype;
  v_item public.job_prep_template_items%rowtype;
  v_area numeric;
  v_units numeric;
  v_needs_area boolean := false;
  v_needs_units boolean := false;
  v_base numeric;
  v_qty numeric;
  v_unit text;
  v_category text;
  v_sort integer;
  v_line public.floor_work_order_items%rowtype;
  v_key text;
  v_ambiguous text[];
  v_adopt_ids uuid[];
  v_same_name_count integer;
  v_conflict_reason text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_adopted integer := 0;
  v_kept_manual integer := 0;
  v_kept_picked integer := 0;
  v_kept_removed integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  -- ด่านสิทธิ์ — ชุดเดียวกับที่แก้แม่แบบและยืนยันใบสั่งงานได้
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะสร้างรายการของที่ต้องเตรียมได้';
  end if;

  -- ล็อกแถวใบสั่งงาน — ล็อกตัวเดียวกับที่ job_prep_edit_guard ใช้ (20260902130010)
  -- ทั้งสี่ทางเขียนจึงเข้าคิวกัน กด "สร้างรายการจากแม่แบบ" พร้อม "แก้จำนวน" ไม่ทับกันอีก
  select * into v_order from public.floor_work_orders where id = p_work_order_id for update;
  if v_order.id is null then
    raise exception 'ไม่พบใบสั่งงาน id=%', p_work_order_id;
  end if;
  -- "ก่อนส่งให้คลัง" เท่านั้น หลังคลังรับงานแล้วรายการต้องนิ่ง
  if v_order.status not in ('head_review', 'returned_sales') then
    raise exception 'สร้างรายการจากแม่แบบได้เฉพาะใบสั่งงานที่ยังไม่ส่งคลัง (สถานะปัจจุบัน: %)', v_order.status;
  end if;

  select * into v_job from public.install_jobs where job_no = v_order.job_no;
  if v_job.job_no is null then
    raise exception 'ไม่พบงาน job_no=%', v_order.job_no;
  end if;

  -- ประเภทงานตัดสินฝั่งเซิร์ฟเวอร์ ไม่รับจากผู้เรียก (ดูหัวไฟล์ 20260902110010)
  select * into v_job_type from public.job_types where code = 'FLOOR_INSTALL' and is_active;
  if v_job_type.id is null then
    raise exception 'ยังไม่ได้ตั้งประเภทงาน FLOOR_INSTALL ในระบบ จึงยังไม่มีแม่แบบให้ใช้';
  end if;

  select * into v_template from public.job_prep_templates
  where job_type_id = v_job_type.id and status = 'active'
  order by version desc limit 1;
  if v_template.id is null then
    raise exception 'ยังไม่มีแม่แบบรายการเตรียมของที่เปิดใช้งานอยู่สำหรับงานปูพื้น — ให้หัวหน้าช่างเปิดใช้งานแม่แบบก่อน';
  end if;

  select
    bool_or(calc_mode = 'per_sqm'),
    bool_or(calc_mode = 'per_unit')
  into v_needs_area, v_needs_units
  from public.job_prep_template_items where template_id = v_template.id;
  if v_needs_area is null then
    raise exception 'แม่แบบที่เปิดใช้งานอยู่ไม่มีรายการใดเลย';
  end if;

  -- ชื่อบรรทัดแม่แบบที่ซ้ำกันเองภายในแม่แบบเดียวกัน — ชื่อพวกนี้ใช้ผูกกลับไม่ได้ เพราะชี้ได้หลายบรรทัด
  select coalesce(array_agg(d.n), array[]::text[]) into v_ambiguous
  from (
    select lower(btrim(item_name)) as n
    from public.job_prep_template_items
    where template_id = v_template.id
    group by 1 having count(*) > 1
  ) d;

  -- พื้นที่: จากข้อมูลสำรวจของฝ่ายขาย
  v_area := public.job_prep_area_sqm(v_job.survey_data);

  -- จำนวนชิ้น/ชุด: ใช้นิยามเดียวกับที่ confirm_floor_work_order_v2 ใช้คิด planned_sheet_count อยู่แล้ว
  select nullif(sum(planned_qty), 0) into v_units
  from public.floor_work_order_items
  where work_order_id = v_order.id
    and category in ('floor_material', 'remnant')
    and unit in ('แผ่น', 'sheet', 'sheets');
  if v_units is null then
    select nullif(planned_sheet_count, 0) into v_units
    from public.floor_job_materials where appointment_id = v_order.appointment_id;
  end if;

  -- ค่าตั้งต้นหาย = บอกให้รู้ ไม่ใช่สร้างรายการที่ทุกบรรทัดเป็น 0
  if v_needs_area and (v_area is null or v_area <= 0) then
    raise exception 'งานนี้ยังไม่มีพื้นที่ติดตั้ง (ตร.ม.) ที่ใช้คำนวณได้ จึงคำนวณรายการที่คิดต่อ ตร.ม. ไม่ได้ — ให้ฝ่ายขายกรอกพื้นที่ในข้อมูลสำรวจก่อน';
  end if;
  if v_needs_units and (v_units is null or v_units <= 0) then
    raise exception 'งานนี้ยังไม่มีจำนวนแผ่นที่ใช้คำนวณได้ จึงคำนวณรายการที่คิดต่อชิ้นงานไม่ได้ — ให้หัวหน้าช่างกรอกบรรทัดวัสดุปูพื้นและจำนวนก่อน';
  end if;

  select coalesce(max(sort_order), -1) into v_sort
  from public.floor_work_order_items where work_order_id = v_order.id;

  for v_item in
    select * from public.job_prep_template_items
    where template_id = v_template.id
    order by sort_order, created_at
  loop
    v_base := case v_item.calc_mode
      when 'per_sqm' then v_item.calc_qty * v_area
      when 'per_unit' then v_item.calc_qty * v_units
      else v_item.calc_qty
    end;
    v_unit := coalesce(nullif(btrim(coalesce(v_item.unit, '')), ''), 'ชิ้น');
    v_qty := public.job_prep_round_qty(v_base * (1 + v_item.waste_pct / 100), v_unit);
    -- item_kind ของแม่แบบใช้คำเดียวกับ category ของ floor_work_order_items ได้ตรงตัว
    v_category := v_item.item_kind;

    -- คนสั่งลบบรรทัดนี้ไปแล้ว ห้ามปลุกกลับมา (บันทึกอยู่ใน job_prep_item_overrides)
    if exists (
      select 1 from public.job_prep_item_overrides o
      where o.work_order_id = v_order.id
        and o.template_item_id = v_item.id
        and o.change_kind = 'removed'
    ) then
      v_kept_removed := v_kept_removed + 1;
      continue;
    end if;

    select * into v_line from public.floor_work_order_items
    where work_order_id = v_order.id and template_item_id = v_item.id
    limit 1;

    if v_line.id is null then
      -- ทางสำรอง: ผูกกลับด้วยชื่อ ตามกฎสี่ข้อในหัวไฟล์
      v_key := lower(btrim(v_item.item_name));

      -- มีบรรทัดชื่อเดียวกันอยู่ในใบนี้กี่บรรทัด (ไม่ว่าจะของใคร) — ใช้บอกผู้ใช้เมื่อผูกกลับไม่ได้
      select count(*) into v_same_name_count
      from public.floor_work_order_items fi
      where fi.work_order_id = v_order.id
        and lower(btrim(fi.item_name)) = v_key;

      if v_key = any (v_ambiguous) then
        -- แม่แบบเองมีสองบรรทัดชื่อนี้ → ชื่อไม่ใช่กุญแจอีกต่อไป ห้ามผูกกลับ
        v_adopt_ids := array[]::uuid[];
      else
        select coalesce(array_agg(fi.id), array[]::uuid[]) into v_adopt_ids
        from public.floor_work_order_items fi
        where fi.work_order_id = v_order.id
          and fi.template_item_id is null
          and fi.is_manual_override = false
          and lower(btrim(fi.item_name)) = v_key
          and not exists (
            select 1 from public.job_prep_item_overrides o
            where o.item_id = fi.id and o.change_kind = 'added'
          );
      end if;

      if array_length(v_adopt_ids, 1) = 1 then
        -- ผูกกลับจริง: เขียน template_item_id ลงไป ครั้งหน้าจะได้ไม่ต้องพึ่งชื่ออีก
        update public.floor_work_order_items
        set template_item_id = v_item.id, updated_at = now()
        where id = v_adopt_ids[1];
        select * into v_line from public.floor_work_order_items where id = v_adopt_ids[1];
        v_adopted := v_adopted + 1;
      elsif v_same_name_count > 0 then
        -- ผูกกลับไม่ได้ แต่มีบรรทัดชื่อชนอยู่ → ไม่ข้าม สร้างบรรทัดของแม่แบบต่อไปด้านล่าง
        -- และรายงานให้ผู้ใช้ไปตรวจเองว่าบรรทัดไหนคือของจริง
        v_conflict_reason := case
          when v_key = any (v_ambiguous) then 'template_duplicate_name'
          when coalesce(array_length(v_adopt_ids, 1), 0) > 1 then 'ambiguous'
          else 'human_line'
        end;
        v_conflicts := v_conflicts || jsonb_build_object(
          'item_name', v_item.item_name,
          'reason', v_conflict_reason
        );
      end if;
    end if;

    if v_line.id is null then
      v_sort := v_sort + 1;
      insert into public.floor_work_order_items(
        work_order_id, category, item_name, sku, specification, planned_qty, unit,
        source_type, note, sort_order, material_id, item_kind, template_item_id, is_manual_override
      ) values (
        v_order.id, v_category, v_item.item_name,
        (select m.sku from public.materials m where m.id = v_item.material_id),
        null, v_qty, v_unit,
        'warehouse',
        case when v_item.is_required then v_item.note
             else btrim(coalesce(v_item.note || ' · ', '') || '(ไม่บังคับตามแม่แบบ)') end,
        v_sort, v_item.material_id, v_item.item_kind, v_item.id, false
      );
      v_inserted := v_inserted + 1;
    elsif v_line.is_manual_override then
      -- คนแก้บรรทัดนี้แล้ว ห้ามทับ
      v_kept_manual := v_kept_manual + 1;
    elsif v_line.picked_qty is not null then
      -- คลังหยิบออกไปแล้ว ห้ามทับ
      v_kept_picked := v_kept_picked + 1;
    elsif v_line.planned_qty is distinct from v_qty
       or v_line.item_name is distinct from v_item.item_name
       or v_line.unit is distinct from v_unit then
      update public.floor_work_order_items
      set planned_qty = v_qty,
          item_name = v_item.item_name,
          unit = v_unit,
          material_id = v_item.material_id,
          item_kind = v_item.item_kind,
          category = v_category,
          updated_at = now()
      where id = v_line.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'template_id', v_template.id,
    'template_version', v_template.version,
    'area_sqm', v_area,
    'unit_count', v_units,
    'inserted', v_inserted,
    'updated', v_updated,
    'adopted', v_adopted,
    'kept_manual', v_kept_manual,
    'kept_picked', v_kept_picked,
    'kept_removed', v_kept_removed,
    'name_conflicts', v_conflicts
  );
end;
$function$;

comment on function public.generate_job_prep_items(uuid) is
  'กางรายการของที่ต้องเตรียมจากแม่แบบ FLOOR_INSTALL ที่เปิดใช้งานอยู่ ลง floor_work_order_items '
  'idempotent: ผูกด้วย template_item_id + partial unique index จึงเรียกซ้ำได้ไม่เกิดบรรทัดซ้ำ '
  'ผูกกลับด้วยชื่อได้เฉพาะบรรทัดที่ไม่ใช่ของคน (is_manual_override = false และไม่มีบันทึก added) '
  'และชื่อต้องชี้บรรทัดเดียวชัดเจน ผูกกลับแล้วเขียน template_item_id กลับลงไปเสมอ '
  'ผูกกลับไม่ได้ = สร้างบรรทัดของแม่แบบตามปกติ แล้วรายงาน name_conflicts ไม่ข้ามเงียบ ๆ '
  'ไม่ทับบรรทัดที่คนแก้ (is_manual_override) หรือคลังหยิบแล้ว (picked_qty) และไม่ปลุกบรรทัดที่คนลบทิ้ง';

revoke all on function public.generate_job_prep_items(uuid) from public, anon;
grant execute on function public.generate_job_prep_items(uuid) to authenticated;

commit;

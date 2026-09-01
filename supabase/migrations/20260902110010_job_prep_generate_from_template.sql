-- FloorNow P3-2: กางรายการของที่ต้องเตรียมออกจากแม่แบบที่เปิดใช้งานอยู่ โดยอัตโนมัติ
--
-- วันนี้หัวหน้าช่างต้องพิมพ์ทุกบรรทัดเองทุกใบ ทั้งที่ของสิ้นเปลืองและเครื่องมือชุดเดิม
-- ซ้ำกันเกือบทุกงาน ผลคือลืมของ แล้วช่างไปถึงหน้างานแล้วของไม่พอ
-- ไฟล์นี้ให้ระบบคำนวณบรรทัดเหล่านั้นจาก job_prep_templates ที่สถานะ active ให้แทน
--
-- ประเภทงาน: ระบบนี้มีประเภทงานเดียวคือ FLOOR_INSTALL และ install_jobs ยังไม่มีคอลัมน์ประเภทงาน
-- จึงผูกเป็นค่าคงที่ฝั่งเซิร์ฟเวอร์ ตามแบบเดียวกับ 20260901200100_technician_job_checklist_server_side_job_type.sql
-- (ไม่รับเป็นพารามิเตอร์ เพื่อไม่ให้ผู้เรียกไล่เดารหัสประเภทงานที่มีอยู่ในระบบ)
--
-- สิทธิ์: admin / head_technician เท่านั้น — ชุดเดียวกับที่เขียนแม่แบบได้
-- (save_job_prep_template, activate_job_prep_template) และชุดเดียวกับที่ยืนยันใบสั่งงานได้
-- (confirm_floor_work_order_v2) เพราะรายการเตรียมของคือเอกสารของหัวหน้าช่าง
-- คลัง (warehouse) และ CS ต้องไม่กดสร้างใหม่ทับรายการที่หัวหน้าช่างตรวจแล้ว
--
-- หน้าต่างเวลา: ทำได้เฉพาะใบสั่งงานสถานะ head_review / returned_sales เท่านั้น
-- คือ "ก่อนส่งให้คลัง" หลังจากคลังรับงานแล้วรายการต้องนิ่ง

begin;

-- ---------------------------------------------------------------------------
-- 1) กฎการปัดเศษ — ปัดขึ้นเสมอ
-- ---------------------------------------------------------------------------
-- รายการนี้คือของที่คลังต้องหยิบใส่รถให้ช่างก่อนออกหน้างาน
-- ปัดลงแปลว่าช่างไปถึงหน้างานแล้วของไม่พอ ต้องหยุดงานแล้ววิ่งกลับคลัง
-- ซึ่งแพงกว่าการเผื่อเกินหนึ่งหน่วยมาก และหยิบกาว 3.7 หลอดก็ทำไม่ได้อยู่ดี
--   * หน่วยที่นับเป็นชิ้น (หลอด ม้วน แผ่น ชุด …) → ปัดขึ้นเป็นจำนวนเต็ม
--   * หน่วยที่แบ่งย่อยได้ (เมตร ตร.ม. ลิตร กก. …) → ปัดขึ้นที่ทศนิยม 2 ตำแหน่ง
--     เพราะปัด 12.03 เมตรขึ้นเป็น 13 เมตรคือสั่งของเกินจริงโดยไม่จำเป็น
-- ตรรกะเดียวกันอยู่ฝั่ง TypeScript ที่ lib/job-prep-calc.ts (roundPrepQty)
create or replace function public.job_prep_round_qty(p_value numeric, p_unit text)
returns numeric
language sql
immutable
security definer
set search_path = ''
as $function$
  select case
    when p_value is null or p_value <= 0 then 0::numeric
    when lower(btrim(coalesce(p_unit, ''))) = any (array[
      'ม.','ม','เมตร','ตร.ม.','ตร.ม','ตรม.','ตรม','ตารางเมตร',
      'ซม.','ซม','เซนติเมตร','ลิตร','ล.','มล.','กก.','กก','กิโลกรัม',
      'กรัม','ก.','m','m2','sqm','cm','mm','l','ml','kg','g'
    ]) then ceil(p_value * 100) / 100
    else ceil(p_value)
  end;
$function$;

comment on function public.job_prep_round_qty(numeric, text) is
  'กฎการปัดเศษของรายการเตรียมของ: ปัดขึ้นเสมอ — หน่วยนับชิ้นปัดขึ้นเป็นจำนวนเต็ม '
  'หน่วยที่แบ่งย่อยได้ปัดขึ้นที่ทศนิยม 2 ตำแหน่ง ตรงกับ roundPrepQty ใน lib/job-prep-calc.ts';

-- ---------------------------------------------------------------------------
-- 2) พื้นที่ติดตั้งเป็น ตร.ม.
-- ---------------------------------------------------------------------------
-- ตรวจข้อมูลจริงแล้ว install_jobs.area_w / area_l ใช้ไม่ได้:
-- 116 แถวมีค่าเพียง 2 แถว และค่าที่มี (100×20, 10×20) แปลว่า 2,000 และ 200 ตร.ม.
-- ซึ่งเป็นไปไม่ได้สำหรับงานปูพื้น ทั้งสองคอลัมน์ไม่มีโค้ดใดในแอปเขียนลงไปเลย
-- ค่าที่ใช้จริงคือ install_jobs.survey_data (คอลัมน์ text ที่บรรจุ JSON) คีย์ areaSqm
-- ซึ่งฝ่ายขายกรอกเองและหน้าจออื่นอ่านอยู่แล้ว (operations, work/[token], share/queue)
-- ค่านั้นเป็นข้อความอิสระ เช่น '32 ตรม' หรือ 'ปิดขอบ' จึงอ่านเฉพาะตัวเลขที่นำหน้า
-- ไม่มีตัวเลขนำหน้า = "ไม่รู้พื้นที่" ไม่ใช่ 0
create or replace function public.job_prep_area_sqm(p_survey_data text)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  v_raw text := btrim(coalesce(p_survey_data, ''));
  v_json jsonb;
  v_area text;
  v_num text;
begin
  if v_raw = '' then return null; end if;
  begin
    v_json := v_raw::jsonb;
  exception when others then
    return null;
  end;
  if jsonb_typeof(v_json) <> 'object' then return null; end if;
  v_area := v_json ->> 'areaSqm';
  if v_area is null then return null; end if;
  v_num := substring(btrim(v_area) from '^([0-9]+(?:\.[0-9]+)?)');
  if v_num is null then return null; end if;
  if v_num::numeric <= 0 then return null; end if;
  return v_num::numeric;
end;
$function$;

comment on function public.job_prep_area_sqm(text) is
  'อ่านพื้นที่ติดตั้ง (ตร.ม.) จาก install_jobs.survey_data — คืน null เมื่ออ่านไม่ได้ ไม่ใช่ 0 '
  'ไม่ใช้ area_w × area_l เพราะข้อมูลจริงมีเพียง 2/116 แถวและค่าที่มีเป็นไปไม่ได้';

-- ---------------------------------------------------------------------------
-- 3) กันบรรทัดซ้ำระดับฐานข้อมูล
-- ---------------------------------------------------------------------------
-- ต่อ 1 ใบสั่งงาน 1 บรรทัดแม่แบบ ต้องมีได้ไม่เกิน 1 บรรทัด
-- ไม่คลุมบรรทัดที่คนเพิ่มเอง (template_item_id เป็น null) จึง partial index
create unique index if not exists floor_work_order_items_template_once_idx
  on public.floor_work_order_items(work_order_id, template_item_id)
  where template_item_id is not null;

comment on index public.floor_work_order_items_template_once_idx is
  'หลักประกันความ idempotent ของ generate_job_prep_items ระดับฐานข้อมูล: '
  'บรรทัดแม่แบบเดียวกันจะโผล่ซ้ำในใบสั่งงานเดียวกันไม่ได้ แม้จะมีการเรียกซ้อนกัน';

-- ---------------------------------------------------------------------------
-- 4) RPC สร้างรายการจากแม่แบบ
-- ---------------------------------------------------------------------------
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
  v_inserted integer := 0;
  v_updated integer := 0;
  v_kept_manual integer := 0;
  v_kept_picked integer := 0;
  v_kept_removed integer := 0;
  v_kept_untracked integer := 0;
begin
  -- ด่านสิทธิ์ — ชุดเดียวกับที่แก้แม่แบบและยืนยันใบสั่งงานได้
  select * into v_actor from public.floor_staff_profiles
  where id = (select auth.uid()) and is_active and role in ('admin', 'head_technician');
  if v_actor.id is null then
    raise exception 'ต้องเป็น admin หรือ head_technician เท่านั้นจึงจะสร้างรายการของที่ต้องเตรียมได้';
  end if;

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

  -- ประเภทงานตัดสินฝั่งเซิร์ฟเวอร์ ไม่รับจากผู้เรียก (ดูหัวไฟล์)
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

  -- พื้นที่: จากข้อมูลสำรวจของฝ่ายขาย
  v_area := public.job_prep_area_sqm(v_job.survey_data);

  -- จำนวนชิ้น/ชุด: ใช้นิยามเดียวกับที่ confirm_floor_work_order_v2 ใช้คิด planned_sheet_count อยู่แล้ว
  -- (บรรทัดวัสดุปูพื้น/เศษที่หน่วยเป็นแผ่น) เพื่อไม่ให้เกิดนิยาม "จำนวนชิ้นงาน" ชุดที่สอง
  select nullif(sum(planned_qty), 0) into v_units
  from public.floor_work_order_items
  where work_order_id = v_order.id
    and category in ('floor_material', 'remnant')
    and unit in ('แผ่น', 'sheet', 'sheets');
  if v_units is null then
    -- ทางสำรอง: ตัวเลขแผ่นรวมทั้งใบที่หัวหน้าช่างเคยวางแผนไว้ต่อ 1 นัดหมาย
    select nullif(planned_sheet_count, 0) into v_units
    from public.floor_job_materials where appointment_id = v_order.appointment_id;
  end if;

  -- ค่าตั้งต้นหาย = บอกให้รู้ ไม่ใช่สร้างรายการที่ทุกบรรทัดเป็น 0
  -- เพราะรายการที่เป็น 0 ทั้งใบ หน้าตาเหมือน "งานนี้ไม่ต้องเตรียมอะไร" ซึ่งอันตรายกว่าไม่สร้างเลย
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
      -- กันซ้ำอีกชั้นสำหรับกรณีที่ template_item_id หลุดไปแล้ว:
      -- confirm_floor_work_order_v2 ลบบรรทัดทั้งหมดแล้วเขียนใหม่จาก payload ของหน้าจอ
      -- ซึ่งไม่ได้ส่งคอลัมน์แม่แบบกลับมา บรรทัดเดิมจึงเหลือแต่ชื่อ
      select * into v_line from public.floor_work_order_items
      where work_order_id = v_order.id
        and template_item_id is null
        and lower(btrim(item_name)) = lower(btrim(v_item.item_name))
      limit 1;
      if v_line.id is not null then
        v_kept_untracked := v_kept_untracked + 1;
        continue;
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
    'kept_manual', v_kept_manual,
    'kept_picked', v_kept_picked,
    'kept_removed', v_kept_removed,
    'kept_untracked', v_kept_untracked
  );
end;
$function$;

comment on function public.generate_job_prep_items(uuid) is
  'กางรายการของที่ต้องเตรียมจากแม่แบบ FLOOR_INSTALL ที่เปิดใช้งานอยู่ ลง floor_work_order_items '
  'idempotent: ผูกด้วย template_item_id + partial unique index จึงเรียกซ้ำได้ไม่เกิดบรรทัดซ้ำ '
  'ไม่ทับบรรทัดที่คนแก้ (is_manual_override) หรือคลังหยิบแล้ว (picked_qty) และไม่ปลุกบรรทัดที่คนลบทิ้ง';

revoke all on function public.job_prep_round_qty(numeric, text) from public, anon;
revoke all on function public.job_prep_area_sqm(text) from public, anon;
revoke all on function public.generate_job_prep_items(uuid) from public, anon;
grant execute on function public.job_prep_round_qty(numeric, text) to authenticated;
grant execute on function public.job_prep_area_sqm(text) to authenticated;
grant execute on function public.generate_job_prep_items(uuid) to authenticated;

commit;

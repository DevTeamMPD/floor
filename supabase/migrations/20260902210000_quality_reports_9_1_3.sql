-- ============================================================================
-- P4-6 — รายงานคุณภาพตาม ISO 9001 ข้อ 9.1.3 (การวิเคราะห์และประเมินผล)
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   วันนี้บริษัทตอบสามคำถามนี้ไม่ได้เลย ทั้งที่ข้อมูลถูกเก็บอยู่แล้ว:
--     1) "เกณฑ์ตรวจรับข้อไหนตกบ่อยที่สุด"  — job_acceptance_results
--     2) "ของขาดบ่อยที่สุดคือตัวไหน"        — floor_work_order_item_receipts
--     3) "เบิกไป vs ใช้จริง ต่างกันแค่ไหน"  — floor_work_order_items
--   ข้อ 9.1.3 ไม่ได้ขอกราฟสวย แต่ขอ "หลักฐานว่าเอาข้อมูลมาวิเคราะห์แล้วจริง"
--
-- ตัดสินใจสำคัญ 1 — ทำไมฟังก์ชันคืน jsonb ที่มี "แถวดิบ" ไม่ใช่ตัวเลขที่รวมมาแล้ว
--   การจัดกลุ่ม (group by) คือจุดที่รายงานพังได้เงียบที่สุด — โดยเฉพาะข้อ 1 ที่ต้องรวม
--   ข้าม template_id ให้ได้ ถ้ารวมผิดจะกลายเป็น "QC07 ตก 3 ครั้ง" กับ "QC07 ตก 2 ครั้ง"
--   สองแถวแยกกันโดยไม่มีใครสังเกต โปรเจกต์นี้ไม่มี supabase local stack ใน vitest
--   ตรรกะที่อยู่ใน SQL จึงทดสอบอัตโนมัติไม่ได้เลย
--   จึงย้าย "การรวม" ไปไว้ที่ lib/quality-reports.ts ซึ่งเป็นฟังก์ชันบริสุทธิ์
--   และมีเทสครอบขอบเขตครบ (ไม่มีข้อมูล / งานเดียว / ข้อที่เปลี่ยนชื่อข้ามเวอร์ชัน /
--   วัสดุตัวเดียวที่โผล่สองงาน) — ดู lib/quality-reports.test.ts
--   SQL ในไฟล์นี้จึงทำแค่สามอย่าง: ด่านสิทธิ์ / กรองช่วงวันที่ / join ป้ายชื่อปัจจุบัน
--
-- ตัดสินใจสำคัญ 2 — แหล่งข้อมูลของ "ของขาดบ่อยที่สุด" เลือก receipts ไม่ใช่คำเตือนสต็อก
--   คำเตือน "ของไม่พอ" (raise_job_stock_shortage_warning → floor_notifications)
--   เป็น "คำทำนายล่วงหน้า" ต่อ 1 งาน ต่อ 1 วัน ไม่ใช่ข้อเท็จจริงต่อวัสดุ:
--     * ไม่มีคอลัมน์วัสดุเลย ชื่อของอยู่ในข้อความอิสระเท่านั้น จึงนับรายตัวไม่ได้จริง
--     * เตือนแล้วของมาทันวันติดตั้ง = ไม่เคยขาดจริง แต่แถวคำเตือนยังอยู่ตลอดไป
--     * งานเดียวถูกเตือนซ้ำได้ทุกวันจนถึงวันติดตั้ง (dedupe_key มีวันที่อยู่ด้วย)
--       ถ้านับแถวคำเตือน งานที่เตือนล่วงหน้า 7 วันจะหนักกว่างานที่เตือนวันเดียว 7 เท่า
--   ส่วน floor_work_order_item_receipts คือ "ช่างยืนอยู่หน้างานแล้วบอกว่าของไม่มา"
--   มี item_id → floor_work_order_items → material_id/sku จึงนับรายวัสดุได้จริง
--   มี shortage_qty เป็นจำนวน และมี reason_code แยกได้ว่าขาดที่คลังหรือหายระหว่างทาง
--   NC โลจิสติกส์ (ncr_reports.cause_code = 'LOGISTICS') เป็น "ผลพวง" ของแถว receipt
--   เดียวกัน ไม่ใช่แหล่งที่สอง — นับ NC ด้วยจะกลายเป็นนับซ้ำ และจะตกหล่นกรณีของขาด
--   ที่ยังไม่ถึงเกณฑ์เปิด NC จึงส่ง ncrOpened ไปเป็น "ตัวเลขประกอบ" ไม่ใช่ตัวตั้ง
--
-- ตัดสินใจสำคัญ 3 — envelope มี totalAllTime และ context เพื่อให้ "จอว่าง" พูดความจริงได้
--   วันนี้ทุกรายงานจะว่าง (job_acceptance_results = 0, receipts ≈ 0) การเขียนว่า
--   "ยังไม่มีข้อมูล" เฉย ๆ ทำให้คนอ่านคิดว่าระบบพัง หน้าจอต้องแยกให้ออกระหว่าง
--   "ไม่มีข้อมูลเลยทั้งระบบ" กับ "มีข้อมูล แต่ไม่มีในช่วงวันที่ที่เลือก"
--   ฐานข้อมูลจึงส่งตัวนับที่ไม่ขึ้นกับช่วงวันที่กลับไปด้วยเสมอ
--
-- ขอบเขตที่ตั้งใจไม่ทำ: ทุกฟังก์ชันในไฟล์นี้อ่านอย่างเดียว ไม่มี insert/update/delete
-- ไม่มีตารางใหม่ ไม่มีการแก้ตารางเดิมแม้แต่คอลัมน์เดียว
--
-- ไฟล์นี้รันซ้ำได้ (create or replace ทั้งหมด)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) ด่านสิทธิ์ของรายงานคุณภาพ — ที่เดียวสำหรับทั้งสามรายงาน
--    ใครควรอ่านได้: admin / executive (ผู้รับผิดชอบ 9.1.3), head_technician
--    (คนที่ต้องแก้เกณฑ์และแม่แบบ), warehouse (คนที่ต้องแก้เรื่องของขาด), cs
--    (คนที่ต้องตอบลูกค้าว่าทำไมงานไม่ผ่าน)
--    ใครไม่ควร: sales และ staff — ส่วนต่างการเบิกของกับสถิติเกณฑ์ตกไม่ใช่ข้อมูลที่
--    ใช้ทำงานขาย และเป็นข้อมูลที่ตีความผิดง่ายที่สุดถ้าไม่มีบริบทการผลิต
--    แพตเทิร์นรองรับงานเบื้องหลัง/โพรบ คัดลอกจาก public.is_floor_stock_reader()
-- ----------------------------------------------------------------------------
create or replace function public.is_floor_quality_report_reader()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null then
    return exists (
      select 1 from public.floor_staff_profiles p
      where p.id = (select auth.uid())
        and p.is_active
        and p.role in ('admin', 'executive', 'head_technician', 'warehouse', 'cs')
    );
  end if;
  return coalesce((select auth.jwt()->>'role'), '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin');
end;
$function$;

comment on function public.is_floor_quality_report_reader() is
  'ด่านสิทธิ์เดียวของรายงานคุณภาพ ISO 9.1.3 — พนักงานที่ยัง active และมี role admin/executive/head_technician/warehouse/cs เท่านั้น (sales และ staff อ่านไม่ได้โดยตั้งใจ)';

revoke all on function public.is_floor_quality_report_reader() from public;
revoke all on function public.is_floor_quality_report_reader() from anon;
grant execute on function public.is_floor_quality_report_reader() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) รายงานที่ 1 — "เกณฑ์ตรวจรับข้อไหนตกบ่อยที่สุด"
--    หัวใจอยู่ที่ item_code: รหัสถาวรที่ไม่เปลี่ยนแม้แม่แบบจะถูกแก้และขึ้นเวอร์ชันใหม่
--    ฟังก์ชันนี้จึง "ไม่" จัดกลุ่มให้ แต่ส่งแถวดิบพร้อม templateId/templateVersion
--    ติดไปด้วย เพื่อให้ฝั่ง TS รวมตาม item_code แล้วพิสูจน์ได้ด้วยเทสว่ารวมข้ามเวอร์ชันจริง
--    currentLabel = ป้ายชื่อของข้อนี้ใน "แม่แบบรุ่นที่เปิดใช้งานอยู่ตอนนี้"
--    เป็น null ได้ แปลว่าข้อนี้ถูกถอดออกจากแม่แบบไปแล้ว ซึ่งเป็นข้อเท็จจริงที่ต้องเห็น
--    ไม่ใช่ข้อผิดพลาด — หน้าจอจะบอกตรง ๆ ว่า "ไม่มีในแม่แบบรุ่นปัจจุบันแล้ว"
-- ----------------------------------------------------------------------------
create or replace function public.report_acceptance_failures(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_cap constant integer := 20000;
  v_from timestamptz;
  v_to timestamptz;
  v_tpl public.job_checklist_templates%rowtype;
  v_rows jsonb;
  v_count integer := 0;
  v_total integer := 0;
  v_jobs integer := 0;
  v_items integer := 0;
begin
  if not (select public.is_floor_quality_report_reader()) then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์ดูรายงานคุณภาพ — เปิดให้เฉพาะผู้ดูแลระบบ ผู้บริหาร หัวหน้าช่าง คลัง และ CS';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง — วันเริ่มต้น (%) อยู่หลังวันสิ้นสุด (%)', p_from, p_to;
  end if;

  v_from := case when p_from is null then null else (p_from::timestamp at time zone 'Asia/Bangkok') end;
  v_to := case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Asia/Bangkok') end;

  v_tpl := public.active_job_checklist_template();

  -- ตัวนับที่ไม่ขึ้นกับช่วงวันที่ — ใช้เขียนข้อความ "ทำไมจอถึงว่าง" ให้ตรงความจริง
  select count(*), count(distinct r.job_no)
    into v_total, v_jobs
    from public.job_acceptance_results r
   where r.result is not null;

  select count(*) into v_items
    from public.job_checklist_template_items i
   where v_tpl.id is not null and i.template_id = v_tpl.id and i.is_active;

  with scoped as (
    select r.job_no,
           r.template_id,
           r.template_version,
           r.item_code,
           r.item_label_snapshot,
           r.is_critical,
           r.result,
           coalesce(r.performed_at, r.created_at) as recorded_at
      from public.job_acceptance_results r
     where r.result is not null
       and (v_from is null or coalesce(r.performed_at, r.created_at) >= v_from)
       and (v_to is null or coalesce(r.performed_at, r.created_at) < v_to)
     order by coalesce(r.performed_at, r.created_at) desc
     limit v_cap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jobNo', s.job_no,
           'templateId', s.template_id,
           'templateVersion', s.template_version,
           'itemCode', s.item_code,
           'labelSnapshot', s.item_label_snapshot,
           'currentLabel', ai.label,
           'isCritical', s.is_critical,
           'currentIsCritical', ai.is_critical,
           'result', s.result,
           'recordedAt', s.recorded_at
         ) order by s.recorded_at desc), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from scoped s
    left join public.job_checklist_template_items ai
      on v_tpl.id is not null and ai.template_id = v_tpl.id and ai.code = s.item_code and ai.is_active;

  return jsonb_build_object(
    'report', 'acceptance_failures',
    'from', p_from,
    'to', p_to,
    'generatedAt', now(),
    'rows', v_rows,
    'rowCount', v_count,
    'truncated', v_count >= v_cap,
    'rowCap', v_cap,
    'totalAllTime', v_total,
    'context', jsonb_build_object(
      'jobsWithResultsAllTime', v_jobs,
      'activeTemplateId', v_tpl.id,
      'activeTemplateVersion', v_tpl.version,
      'activeTemplateItemCount', v_items
    )
  );
end;
$function$;

comment on function public.report_acceptance_failures(date, date) is
  'ISO 9.1.3 รายงานที่ 1 — แถวผลตรวจรับดิบพร้อมป้ายชื่อปัจจุบันของแต่ละ item_code สำหรับให้ฝั่งแอปรวมข้ามเวอร์ชันแม่แบบ (อ่านอย่างเดียว)';

revoke all on function public.report_acceptance_failures(date, date) from public;
revoke all on function public.report_acceptance_failures(date, date) from anon;
grant execute on function public.report_acceptance_failures(date, date) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) รายงานที่ 2 — "ของขาดบ่อยที่สุด"
--    แหล่งเดียว: floor_work_order_item_receipts ที่ shortage_qty > 0
--    (เหตุผลของการเลือกอยู่ในหัวไฟล์ — ไม่ใช้คำเตือนสต็อกเพราะไม่มีคอลัมน์วัสดุ
--     และเป็นคำทำนายที่แก้ตัวเองได้ ไม่ใช่ข้อเท็จจริงว่าของไม่มาถึงหน้างาน)
--    materialKey คือกุญแจการรวม: sku ก่อน ถ้าไม่มีจึงใช้ชื่อของ — ตั้งใจให้บรรทัดที่
--    ยังไม่ผูก material_id (ซึ่งวันนี้คือส่วนใหญ่ เพราะ materials มีไม่กี่แถว) ยังนับได้
--    ไม่ใช่หายไปจากรายงานเงียบ ๆ
-- ----------------------------------------------------------------------------
create or replace function public.report_material_shortages(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_cap constant integer := 20000;
  v_from timestamptz;
  v_to timestamptz;
  v_rows jsonb;
  v_count integer := 0;
  v_total integer := 0;
  v_receipts integer := 0;
  v_jobs integer := 0;
  v_ncr integer := 0;
begin
  if not (select public.is_floor_quality_report_reader()) then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์ดูรายงานคุณภาพ — เปิดให้เฉพาะผู้ดูแลระบบ ผู้บริหาร หัวหน้าช่าง คลัง และ CS';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง — วันเริ่มต้น (%) อยู่หลังวันสิ้นสุด (%)', p_from, p_to;
  end if;

  v_from := case when p_from is null then null else (p_from::timestamp at time zone 'Asia/Bangkok') end;
  v_to := case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Asia/Bangkok') end;

  select count(*) into v_receipts from public.floor_work_order_item_receipts;
  select count(*), count(distinct r.job_no)
    into v_total, v_jobs
    from public.floor_work_order_item_receipts r
   where r.shortage_qty > 0;
  select count(*) into v_ncr
    from public.ncr_reports n
   where n.cause_code = 'LOGISTICS';

  with scoped as (
    select r.job_no,
           r.work_order_id,
           r.receipt_status,
           r.expected_qty,
           r.received_qty,
           r.shortage_qty,
           r.reason_code,
           r.ncr_id,
           r.confirmed_at,
           i.material_id,
           nullif(btrim(coalesce(i.sku, '')), '') as sku,
           i.item_name,
           i.unit,
           i.item_kind
      from public.floor_work_order_item_receipts r
      join public.floor_work_order_items i on i.id = r.item_id
     where r.shortage_qty > 0
       and (v_from is null or r.confirmed_at >= v_from)
       and (v_to is null or r.confirmed_at < v_to)
     order by r.confirmed_at desc
     limit v_cap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jobNo', s.job_no,
           'workOrderId', s.work_order_id,
           'materialKey', coalesce(s.sku, nullif(btrim(coalesce(s.item_name, '')), ''), 'ไม่ระบุชื่อของ'),
           'materialId', s.material_id,
           'sku', s.sku,
           'itemName', s.item_name,
           'unit', s.unit,
           'itemKind', s.item_kind,
           'receiptStatus', s.receipt_status,
           'expectedQty', s.expected_qty,
           'receivedQty', s.received_qty,
           'shortageQty', s.shortage_qty,
           'reasonCode', s.reason_code,
           'hasNcr', s.ncr_id is not null,
           'confirmedAt', s.confirmed_at
         ) order by s.confirmed_at desc), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from scoped s;

  return jsonb_build_object(
    'report', 'material_shortages',
    'from', p_from,
    'to', p_to,
    'generatedAt', now(),
    'rows', v_rows,
    'rowCount', v_count,
    'truncated', v_count >= v_cap,
    'rowCap', v_cap,
    'totalAllTime', v_total,
    'context', jsonb_build_object(
      'receiptRowsAllTime', v_receipts,
      'jobsWithShortageAllTime', v_jobs,
      'logisticsNcrAllTime', v_ncr
    )
  );
end;
$function$;

comment on function public.report_material_shortages(date, date) is
  'ISO 9.1.3 รายงานที่ 2 — แถว "ของมาไม่ครบตอนช่างรับของหน้างาน" รายบรรทัด (แหล่งเดียว: floor_work_order_item_receipts ไม่ใช่คำเตือนสต็อก) อ่านอย่างเดียว';

revoke all on function public.report_material_shortages(date, date) from public;
revoke all on function public.report_material_shortages(date, date) from anon;
grant execute on function public.report_material_shortages(date, date) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) รายงานที่ 3 — "เบิกไป vs ใช้จริง"
--    planned_qty คือ "ค่าประมาณ" ที่มาจากสูตรในแม่แบบ (หรือจากมือหัวหน้าช่างเมื่อ
--    is_manual_override) ไม่ใช่ความจริง ความจริงคือ picked/used/returned
--    ช่องว่างระหว่างสองอย่างนี้คือวัตถุดิบของการปรับสูตรแม่แบบรอบหน้า
--    จึงส่ง fromTemplate/manualOverride ติดไปทุกแถว เพื่อให้แยกได้ว่าค่าประมาณที่พลาด
--    มาจากสูตรหรือมาจากคนกรอกเอง — ถ้าไม่แยก การ "ปรับสูตร" จะปรับตามความผิดของคน
--
--    ขอบเขต: เฉพาะบรรทัดที่เป็นของสิ้นเปลือง (consumable) ตามกฎเดียวของระบบ
--    public.derive_floor_work_order_item_kind() เพราะ used_qty ถูกห้ามบนเครื่องมือ
--    ที่ระดับตารางอยู่แล้ว (ทริกเกอร์ usage guard) การเอาเครื่องมือมารวมจะทำให้
--    "ใช้จริง" เป็นศูนย์ทั้งคอลัมน์และแปลผลผิดทันที และกฎเดียวกันนี้ตัดบรรทัด
--    "โน้ต Freeform จากหัวหน้าช่าง" ออกให้เองอยู่แล้ว
--    วันที่ที่ใช้กรอง = วันที่บรรทัดขยับล่าสุด (ปิดยอด > หยิบของ > สร้างบรรทัด)
-- ----------------------------------------------------------------------------
create or replace function public.report_pick_vs_use(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_cap constant integer := 20000;
  v_from timestamptz;
  v_to timestamptz;
  v_rows jsonb;
  v_count integer := 0;
  v_total integer := 0;
  v_picked integer := 0;
  v_used integer := 0;
begin
  if not (select public.is_floor_quality_report_reader()) then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์ดูรายงานคุณภาพ — เปิดให้เฉพาะผู้ดูแลระบบ ผู้บริหาร หัวหน้าช่าง คลัง และ CS';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง — วันเริ่มต้น (%) อยู่หลังวันสิ้นสุด (%)', p_from, p_to;
  end if;

  v_from := case when p_from is null then null else (p_from::timestamp at time zone 'Asia/Bangkok') end;
  v_to := case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Asia/Bangkok') end;

  select count(*),
         count(*) filter (where i.picked_qty is not null),
         count(*) filter (where i.used_qty is not null)
    into v_total, v_picked, v_used
    from public.floor_work_order_items i
   where coalesce(i.item_kind, public.derive_floor_work_order_item_kind(
           i.category, i.source_type, i.sku, i.item_name, i.unit, i.planned_qty)) = 'consumable';

  with scoped as (
    select i.id as item_id,
           i.work_order_id,
           w.job_no,
           nullif(btrim(coalesce(i.sku, '')), '') as sku,
           i.item_name,
           i.unit,
           i.material_id,
           i.planned_qty,
           i.actual_qty,
           i.picked_qty,
           i.used_qty,
           i.returned_qty,
           i.template_item_id,
           i.is_manual_override,
           coalesce(i.usage_recorded_at, i.picked_at, i.created_at) as activity_at
      from public.floor_work_order_items i
      join public.floor_work_orders w on w.id = i.work_order_id
     where coalesce(i.item_kind, public.derive_floor_work_order_item_kind(
             i.category, i.source_type, i.sku, i.item_name, i.unit, i.planned_qty)) = 'consumable'
       and (v_from is null or coalesce(i.usage_recorded_at, i.picked_at, i.created_at) >= v_from)
       and (v_to is null or coalesce(i.usage_recorded_at, i.picked_at, i.created_at) < v_to)
     order by coalesce(i.usage_recorded_at, i.picked_at, i.created_at) desc
     limit v_cap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'itemId', s.item_id,
           'jobNo', s.job_no,
           'workOrderId', s.work_order_id,
           'materialKey', coalesce(s.sku, nullif(btrim(coalesce(s.item_name, '')), ''), 'ไม่ระบุชื่อของ'),
           'materialId', s.material_id,
           'sku', s.sku,
           'itemName', s.item_name,
           'unit', s.unit,
           'plannedQty', s.planned_qty,
           'actualQty', s.actual_qty,
           'pickedQty', s.picked_qty,
           'usedQty', s.used_qty,
           'returnedQty', s.returned_qty,
           'fromTemplate', s.template_item_id is not null,
           'manualOverride', s.is_manual_override,
           'activityAt', s.activity_at
         ) order by s.activity_at desc), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from scoped s;

  return jsonb_build_object(
    'report', 'pick_vs_use',
    'from', p_from,
    'to', p_to,
    'generatedAt', now(),
    'rows', v_rows,
    'rowCount', v_count,
    'truncated', v_count >= v_cap,
    'rowCap', v_cap,
    'totalAllTime', v_total,
    'context', jsonb_build_object(
      'pickedLinesAllTime', v_picked,
      'usageLinesAllTime', v_used
    )
  );
end;
$function$;

comment on function public.report_pick_vs_use(date, date) is
  'ISO 9.1.3 รายงานที่ 3 — บรรทัดของสิ้นเปลืองพร้อม planned/picked/used/returned สำหรับเทียบ "ค่าประมาณจากแม่แบบ" กับของจริง (อ่านอย่างเดียว)';

revoke all on function public.report_pick_vs_use(date, date) from public;
revoke all on function public.report_pick_vs_use(date, date) from anon;
grant execute on function public.report_pick_vs_use(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

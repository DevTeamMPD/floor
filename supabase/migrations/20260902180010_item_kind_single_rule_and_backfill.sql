-- ============================================================================
-- item_kind_single_rule_and_backfill
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   คำว่า item_kind ในระบบนี้มีความหมายทางกายภาพชัดเจนเพียงสองอย่าง
--     consumable = ของที่ใช้แล้วหมดไป ไม่ต้องเดินทางกลับคลัง
--     tool       = ของที่ต้องคืนคลัง ถ้าไม่คืนคือของหาย
--   รายงาน "เครื่องมือค้างคืน" (get_outstanding_tools) ยืนอยู่บนค่านี้ค่าเดียว
--   ถ้ากติกาการเดา item_kind กระจายอยู่หลายที่ (หน้าจอที่หนึ่ง ฟังก์ชันยืนยันใบสั่งงาน
--   ที่หนึ่ง สคริปต์เติมย้อนหลังอีกที่หนึ่ง) แถวเก่ากับแถวใหม่ที่หน้าตาเหมือนกันเป๊ะ
--   จะได้คำตอบต่างกัน แล้วรายงานของหายก็เชื่อถือไม่ได้ทั้งใบ
--
--   ไฟล์นี้จึงยกกติกาการเดาออกมาเป็นฟังก์ชันเดียวของระบบ
--   public.derive_floor_work_order_item_kind() แล้วให้ทุกทางเรียกตัวนี้
--     * confirm_floor_work_order_v3  -> migration 20260901105632
--     * การเติมย้อนหลัง (backfill)    -> migration 20260901105657
--
-- หมายเหตุเรื่องชื่อไฟล์
--   ชื่อ migration มีคำว่า "and_backfill" แต่ตัว UPDATE เติมย้อนหลังจริง ๆ
--   ถูกแยกออกไปเป็น migration 20260901105657 ต่างหาก ไฟล์นี้มีแต่ตัวกติกา
--
-- เหตุผลของแต่ละกิ่งอยู่ในคอมเมนต์ในตัวฟังก์ชันแล้ว (คัดจากฐานข้อมูลจริง)
-- ไฟล์นี้รันซ้ำได้ เพราะเป็น create or replace function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.derive_floor_work_order_item_kind(p_category text, p_source_type text, p_sku text, p_item_name text, p_unit text, p_planned_qty numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    -- 1) บรรทัด "โน้ต Freeform จากหัวหน้าช่าง" ไม่ใช่ของ — ครบทั้ง 6 เงื่อนไขเดียวกับ lib/freeform-work-note.ts
    when coalesce(btrim(p_category), '') = 'tool'
         and coalesce(btrim(p_source_type), '') = 'other'
         and nullif(btrim(coalesce(p_sku, '')), '') is null
         and coalesce(p_planned_qty, -1) = 0
         and btrim(coalesce(p_unit, '')) = 'รายการ'
         and btrim(coalesce(p_item_name, '')) = 'โน้ต Freeform จากหัวหน้าช่าง'
      then null
    -- 2) เครื่องมือที่มีจำนวนตามแผนจริง (เงื่อนไข planned > 0 ของ D6 คงไว้ทุกตัวอักษร)
    when coalesce(btrim(p_category), '') = 'tool' and coalesce(p_planned_qty, 0) > 0
      then 'tool'
    -- 3) ของสิ้นเปลืองตรงตัว
    when coalesce(btrim(p_category), '') = 'consumable'
      then 'consumable'
    -- 4) วัสดุปูพื้นคือของที่ถูกติดตั้งลงพื้นบ้านลูกค้า ไม่มีวันเดินทางกลับคลัง
    --    ในคำศัพท์คู่นี้ (consumable = ใช้แล้วหมด / tool = ต้องคืน) จึงเป็น consumable อย่างไม่กำกวม
    when coalesce(btrim(p_category), '') = 'floor_material'
      then 'consumable'
    -- 5) remnant / accessory / equipment และเครื่องมือที่ planned = 0 -> ปล่อย null ไว้ดีกว่าเดาผิด
    else null
  end;
$function$;

-- ----------------------------------------------------------------------------
-- สิทธิ์ — ตรงตามสถานะจริง: {postgres, authenticated, service_role}
-- เปิดให้ authenticated เรียกได้เพราะหน้าจอใช้พรีวิวว่าบรรทัดนี้จะถูกจัดเป็นอะไร
-- (ฟังก์ชันเป็น immutable ไม่แตะข้อมูลใด ๆ จึงไม่มีความเสี่ยงจากการเปิด)
-- ----------------------------------------------------------------------------
revoke all on function public.derive_floor_work_order_item_kind(text, text, text, text, text, numeric) from public;
revoke all on function public.derive_floor_work_order_item_kind(text, text, text, text, text, numeric) from anon;
grant execute on function public.derive_floor_work_order_item_kind(text, text, text, text, text, numeric) to authenticated, service_role;

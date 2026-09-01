-- ============================================================================
-- backfill_floor_work_order_items_item_kind
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   คอลัมน์ floor_work_order_items.item_kind ถูกเพิ่มเข้ามาหลังจากที่ระบบมีข้อมูลจริง
--   อยู่แล้ว แถวที่ถูกสร้างก่อนหน้านั้นจึงเป็น null ทั้งหมด
--   ปัญหาคือรายงาน "เครื่องมือค้างคืน" (get_outstanding_tools) กรองด้วย item_kind = 'tool'
--   แถว null จึงหายไปจากรายงานอย่างเงียบ ๆ — ของที่ยังไม่ได้คืนคลังจะไม่มีใครเห็น
--   ซึ่งเป็นความล้มเหลวแบบที่แย่ที่สุด คือระบบบอกว่า "ไม่มีของค้าง" ทั้งที่มี
--
--   ไฟล์นี้เติมค่าย้อนหลังด้วยกติกากลางตัวเดียวกับที่ทางเขียนปัจจุบันใช้
--   (public.derive_floor_work_order_item_kind — migration 20260901105536)
--   เพื่อให้แถวเก่ากับแถวใหม่ที่หน้าตาเหมือนกันได้คำตอบเดียวกันเป๊ะ
--
-- ผลลัพธ์ที่บันทึกไว้ตอนรันครั้งแรก และยืนยันจากฐานข้อมูลจริงแล้ว
--   ก่อนรัน : 13 แถว item_kind = null
--   หลังรัน : 3 null / 10 consumable / 0 tool
--   3 แถวที่ยังเป็น null คือบรรทัด "โน้ต Freeform จากหัวหน้าช่าง"
--   (category = tool, source_type = other, sku = null, planned_qty = 0, unit = 'รายการ')
--   ซึ่งกติกากลางตั้งใจคืน null เพราะบรรทัดนั้นไม่ใช่ "ของ" — เป็นข้อความสั่งงาน
--   ปล่อยเป็น null ถูกต้องแล้ว ไม่ใช่งานที่ค้างทำ
--
-- ทำไมเขียนแบบนี้ (เงื่อนไขความปลอดภัยของการรันซ้ำ)
--   * where item_kind is null
--       แตะเฉพาะแถวที่ยังว่าง — ค่าที่มีอยู่แล้วไม่ถูกเขียนทับเด็ดขาด
--       ถ้าคนแก้ค่าเป็น 'tool' ด้วยมือเพราะรู้ของจริง การรันซ้ำจะไม่ลบความรู้นั้นทิ้ง
--   * and derive(...) is not null
--       ไม่เขียน null ทับ null — ทำให้จำนวนแถวที่ถูกแตะเป็น 0 เมื่อรันซ้ำ
--       (ไม่ปั่น updated_at ของแถวที่ไม่ได้เปลี่ยนอะไร)
--   * and coalesce(is_manual_override, false) = false
--       แถวที่คนกดแก้ด้วยมือแล้วตั้งใจปล่อย item_kind ว่างไว้ ถือว่าเป็นการตัดสินใจของคน
--       สคริปต์เติมย้อนหลังไม่มีสิทธิ์เดาทับ — นี่คือด่านที่กันไม่ให้ไฟล์นี้
--       ย้อนกลับไปทับงานที่คนทำหลังจาก migration นี้ถูกรันครั้งแรก
--   ผลรวม: รันกี่ครั้งก็ได้ ครั้งที่สองขึ้นไปจะแตะ 0 แถว
--
-- ต้องรันหลัง 20260901105536 (ต้องมี derive_floor_work_order_item_kind ก่อน)
-- ============================================================================

do $$
declare
  v_before_null integer;
  v_updated integer;
  v_after_null integer;
  v_after_consumable integer;
  v_after_tool integer;
begin
  select count(*) into v_before_null
  from public.floor_work_order_items
  where item_kind is null;

  update public.floor_work_order_items i
  set item_kind = public.derive_floor_work_order_item_kind(
        i.category, i.source_type, i.sku, i.item_name, i.unit, i.planned_qty
      ),
      updated_at = now()
  where i.item_kind is null
    and coalesce(i.is_manual_override, false) = false
    and public.derive_floor_work_order_item_kind(
          i.category, i.source_type, i.sku, i.item_name, i.unit, i.planned_qty
        ) is not null;

  get diagnostics v_updated = row_count;

  select count(*) filter (where item_kind is null),
         count(*) filter (where item_kind = 'consumable'),
         count(*) filter (where item_kind = 'tool')
    into v_after_null, v_after_consumable, v_after_tool
  from public.floor_work_order_items;

  raise notice 'เติม item_kind ย้อนหลัง: ก่อนรันว่าง % แถว, เติมได้ % แถว, ผลลัพธ์ null=% consumable=% tool=%',
    v_before_null, v_updated, v_after_null, v_after_consumable, v_after_tool;
end
$$;

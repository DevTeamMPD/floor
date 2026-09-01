-- ============================================================================
-- materials_grant_cleanup
-- ----------------------------------------------------------------------------
-- ทำไมต้องมีไฟล์นี้
--   ตาราง public.materials คือทะเบียนวัสดุกลาง ราคาทุนและ SKU ทั้งหมดอยู่ในนี้
--   ก่อนหน้านี้สิทธิ์บนตารางถูกแจกกว้างเกินไป (ติดมาถึง role `anon` และ `PUBLIC`)
--   ซึ่งหมายความว่าใครก็อ่านต้นทุนวัสดุทั้งบริษัทได้โดยไม่ต้องล็อกอิน
--   RLS เปิดอยู่จริง แต่ GRANT ที่กว้างเกินไปคือชั้นที่ไม่ควรพึ่ง RLS อย่างเดียว
--   จึงตัดสิทธิ์ที่ระดับ GRANT ให้เหลือเท่าที่แอปใช้จริง
--
-- ตัดอะไรออกจากใคร (บันทึกไว้เพื่อให้ย้อนดูได้ว่าเคยมีอะไรอยู่)
--   * revoke all on public.materials from anon    -> anon ไม่เหลือสิทธิ์ใด ๆ เลย
--   * revoke all on public.materials from public  -> ไม่มีสิทธิ์แจกผ่าน PUBLIC อีก
--   * revoke delete, truncate on public.materials from authenticated
--       เพราะวัสดุไม่เคยถูกลบจริงในกระบวนการทำงาน — ของที่เลิกใช้จะถูกปิดสถานะ
--       ไม่ใช่ลบทิ้ง การลบแถวจะทำให้ stock_movements และ BOM ที่อ้างถึงกลายเป็นกำพร้า
--   * service_role ยังคงสิทธิ์เต็ม (งานหลังบ้าน/สคริปต์นำเข้ายังต้องใช้)
--
-- สถานะสิทธิ์ปลายทางที่ยืนยันจากฐานข้อมูลจริง (pg_class.relacl):
--   postgres      = arwdDxtm
--   service_role  = arwdDxtm
--   authenticated = arwxtm   (select, insert, update, references, trigger, maintain)
--                            *** ไม่มี d (delete) และไม่มี D (truncate) ***
--   anon          = ไม่ปรากฏใน ACL เลย
--
-- ไฟล์นี้รันซ้ำได้ (revoke/grant เป็น idempotent โดยธรรมชาติ)
-- ============================================================================

-- 1) ตัดสิทธิ์ที่กว้างเกินไปออกก่อน
revoke all on table public.materials from anon;
revoke all on table public.materials from public;

-- 2) แจกคืนเฉพาะที่แอปฝั่งผู้ใช้ที่ล็อกอินแล้วต้องใช้จริง
grant select, insert, update on table public.materials to authenticated;
-- references/trigger/maintain ยังคงอยู่ตามสถานะจริงของฐานข้อมูล (ติดมาจาก grant เดิม)
-- คงไว้ให้ตรงกับของจริง ไม่ใช่ของใหม่ที่เพิ่มในไฟล์นี้
grant references, trigger on table public.materials to authenticated;
do $$
begin
  -- MAINTAIN มีตั้งแต่ PostgreSQL 17 เท่านั้น กัน error บนเครื่อง dev ที่เวอร์ชันต่ำกว่า
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on table public.materials to authenticated';
  end if;
end
$$;

-- 3) ปิดประตูลบทิ้งสำหรับผู้ใช้ทั่วไป
revoke delete, truncate on table public.materials from authenticated;

-- 4) service_role ยังต้องเต็ม (สคริปต์นำเข้า/งานหลังบ้าน)
grant all on table public.materials to service_role;

-- ยืนยันว่า RLS ยังเปิดอยู่ (ชั้นที่สองหลัง GRANT)
alter table public.materials enable row level security;

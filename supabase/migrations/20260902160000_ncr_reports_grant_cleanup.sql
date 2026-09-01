-- FloorNow (แก้ตามรีวิว D1): ncr_reports — เก็บกวาด grant ค้างของ anon ให้ครบ ไม่ใช่ครึ่งเดียว
--
-- ของเดิมพลาดตรงไหน: 20260902140020_ncr_reports_read_policy.sql ตั้งใจ "เก็บกวาดกับดัก" แต่ทำแค่
--   revoke select on public.ncr_reports from anon;
-- ตรวจกับฐานข้อมูลจริงด้วย has_table_privilege พบว่า anon ยังถือ
--   INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER อยู่ครบ
-- และ authenticated ยังถือ TRUNCATE, REFERENCES, TRIGGER ที่ไม่มีใครใช้
--
-- ทำไมเรื่องนี้ไม่ใช่เรื่องเล็ก: RLS **ไม่คุม TRUNCATE** — policy กี่ข้อก็ไม่ห้าม truncate
-- สิทธิ์ TRUNCATE ที่ค้างอยู่กับ anon จึงไม่ใช่ "กับดักรอวันหน้า" แต่เป็นทางที่เปิดอยู่วันนี้
-- ส่วน insert/update/delete วันนี้ยังไม่ทะลุเพราะไม่มี write policy (RLS ปฏิเสธทุกแถว)
-- แต่นั่นคือสิ่งที่คอมเมนต์ของไฟล์เดิมบอกเองว่าอันตราย และตั้งใจจะปิด
--
-- ทุกตารางอื่นในสาขานี้ใช้ประโยคเดียวกันหมดคือ revoke all ... from anon, authenticated
-- แล้วค่อย grant select กลับให้ authenticated เท่านั้น ไฟล์นี้ทำให้ ncr_reports เหมือนกันทั้งหมด
--
-- ขอบเขต: แตะเฉพาะ grant ของตาราง ncr_reports ตามข้อยกเว้นที่รีวิวอนุญาตไว้
-- ไม่แตะโครงตาราง ไม่แตะ policy ที่เพิ่งเพิ่ม (ncr_reports_active_staff_read ยังอยู่เหมือนเดิม)
-- ไม่แตะข้อมูลแถวใด และไม่แตะ service_role ซึ่งเป็นทางที่ฝั่งเซิร์ฟเวอร์ใช้อ่าน/เขียนจริง
--
-- สิ่งที่แอปยังต้องทำได้หลังไฟล์นี้ (พิสูจน์ด้วยโพรบ D1-a ถึง D1-d ใน sdd-jobtpl/p35fix-probes.sql):
--   app/(admin)/ncr/page.tsx และ components/pipeline/ncr-tab.tsx  select ผ่าน authenticated -> ยังอ่านได้
--   การเขียนทั้งหมดยังผ่าน RPC (create_floor_ncr / advance_floor_ncr / record_technician_item_receipt)
--   ซึ่งเป็น security definer จึงไม่ได้พึ่ง grant ของ authenticated เลยแม้แต่นิดเดียว

begin;

revoke all on public.ncr_reports from anon;
revoke all on public.ncr_reports from authenticated;
revoke all on public.ncr_reports from public;

-- คืนเฉพาะสิ่งที่แอปใช้จริง: อ่านอย่างเดียว และยังต้องผ่าน policy is_floor_staff_active() อีกชั้น
grant select on public.ncr_reports to authenticated;

comment on table public.ncr_reports is
  'ใบ NC ของงานหน้างาน — client อ่านได้อย่างเดียวผ่าน authenticated + policy ncr_reports_active_staff_read '
  'ทางเขียนทุกเส้นผ่าน RPC security definer เท่านั้น และ anon ไม่มีสิทธิ์ใด ๆ บนตารางนี้ (รวมถึง truncate ที่ RLS ไม่คุม)';

notify pgrst, 'reload schema';

commit;

-- FloorNow P3-6 (ตามหลัง): ทำให้ NC ที่ระบบเปิดให้อัตโนมัติ "มีคนเห็น" ได้จริง
--
-- สิ่งที่โพรบเจอระหว่างทำงานนี้ (ยืนยันด้วยการรันจริง ดู p35-probes.sql โพรบ R):
--   public.ncr_reports เปิด row level security ไว้ แต่ "ไม่มี policy สักข้อ"
--   RLS ที่ไม่มี policy = ปฏิเสธทุกแถว ผลคือ
--     * app/(admin)/ncr/page.tsx:166  select * from ncr_reports  ได้ 0 แถวเสมอ
--     * components/pipeline/ncr-tab.tsx:49 แท็บ NCR ในไดรเวอร์งาน ว่างเปล่าเสมอ
--   ตารางนี้มี 0 แถวมาตลอด จึงไม่มีใครสังเกตว่าหน้าจอว่างเพราะ RLS ไม่ใช่เพราะไม่มีข้อมูล
--
-- ทำไมต้องแก้ในงานนี้ ไม่ใช่งานหน้า: P3-6 สั่งให้ "เปิด NC อัตโนมัติเมื่อของมาไม่ครบ"
-- NC ที่ไม่มีใครอ่านเห็นไม่ใช่การเปิด NC มันคือการเขียนลงถังขยะที่มีดัชนี
-- ฟีเจอร์ทั้งฟีเจอร์จะไม่มีผลต่อใครเลยถ้าไม่แก้บรรทัดนี้
--
-- ขอบเขตที่ยอมทำ (แคบที่สุดเท่าที่ทำให้ฟีเจอร์มีความหมาย):
--   1) เพิ่ม policy อ่านอย่างเดียว ให้พนักงานที่ยัง active — แพตเทิร์นเดียวกับทุกตารางในโปรเจกต์นี้
--      (floor_ncr_events, floor_close_exceptions, floor_work_order_items ใช้ประโยคเดียวกันเป๊ะ)
--      ไม่แตะสิทธิ์ insert/update/delete ที่ถูก revoke ไว้ — การเขียนยังผ่าน RPC เท่านั้นเหมือนเดิม
--   2) revoke select ของ anon ทิ้ง — grant นี้มีมาแต่เดิมและ "ไม่เคยมีผล" เพราะ RLS ปฏิเสธทุกแถวอยู่แล้ว
--      แต่เมื่อวันนี้ตารางมี policy เป็นครั้งแรก grant ค้างของ anon กลายเป็นกับดักรอวันที่ใครสักคน
--      เผลอเขียน policy ที่กว้างกว่านี้ จึงเก็บกวาดตอนที่ยังไม่มีผลกระทบ (ยืนยันด้วยโพรบ 6f)
--
-- ไม่ลบ ไม่เปลี่ยนชื่อ ไม่แตะข้อมูลแถวใดในตารางนี้ (ตารางมี 0 แถวจริงก่อนงานนี้)
--
-- ของแถมในไฟล์เดียวกัน: floor_receipt_reason_catalog() เพิ่ม security definer ให้ครบตามกติกาของโปรเจกต์
-- (ฟังก์ชันนี้คืนค่าคงที่ ไม่อ่านตารางใดเลย จึงไม่มีผลด้านสิทธิ์ แต่ให้ทุกฟังก์ชันใหม่หน้าตาเหมือนกันหมด)

begin;

alter table public.ncr_reports enable row level security;

drop policy if exists ncr_reports_active_staff_read on public.ncr_reports;
create policy ncr_reports_active_staff_read on public.ncr_reports
  for select to authenticated using ((select public.is_floor_staff_active()));

revoke select on public.ncr_reports from anon;

create or replace function public.floor_receipt_reason_catalog()
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object('code', 'stock_short',   'label', 'ของไม่พอในคลัง',      'ncrType', 'missing'),
    jsonb_build_object('code', 'not_loaded',    'label', 'ลืมโหลดขึ้นรถ',        'ncrType', 'missing'),
    jsonb_build_object('code', 'lost_on_route', 'label', 'ตกหล่นระหว่างทาง',    'ncrType', 'missing'),
    jsonb_build_object('code', 'damaged',       'label', 'ของเสียหาย',          'ncrType', 'damage'),
    jsonb_build_object('code', 'wrong_item',    'label', 'ผิดรุ่น/ผิดสี',         'ncrType', 'wrong'),
    jsonb_build_object('code', 'other',         'label', 'อื่น ๆ (ระบุเอง)',      'ncrType', 'missing')
  );
$function$;

revoke all on function public.floor_receipt_reason_catalog() from public;
grant execute on function public.floor_receipt_reason_catalog() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

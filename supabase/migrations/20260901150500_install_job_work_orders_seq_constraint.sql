-- FloorNow P1: ถอด unique (job_no, seq) ของ install_job_work_orders ที่ทำให้ sync ค้างถาวรแบบเงียบ
--
-- ที่มา: final review ข้อ 5 (Important) — syncWorkOrders upsert ด้วย conflict target เดียวคือ
-- external_work_order_id (natural key จริงฝั่ง BBPS) แต่ตารางมี unique (job_no, seq) อีกตัวคอยดักอยู่
-- สถานการณ์ที่เกิดได้จริง: BBPS ลบใบสั่งงาน seq=1 แล้วสร้างใบใหม่ seq=1 (id ใหม่)
-- → แถวเก่ายังค้างอยู่ → insert ใบใหม่ชน unique (job_no, seq) ซึ่งไม่ใช่ conflict target
-- จึงไม่ถูก do update แต่ throw 23505 ออกมา → syncWorkOrders จับไว้แล้ว console.warn เฉย ๆ
-- (ห้าม throw โดยตั้งใจ) → ใบสั่งงานทั้งชุดของงานนั้นหยุดอัปเดตตลอดไปโดยไม่มีใครรู้
--
-- seq เป็นเพียง "ลำดับที่ใช้แสดงผล" ที่ BBPS ส่งมา ไม่ใช่กุญแจธรรมชาติ และไม่มีอะไรรับประกันว่า
-- BBPS จะไม่ส่ง seq ซ้ำ/ข้าม/เรียงใหม่ กุญแจธรรมชาติตัวจริงคือ external_work_order_id ซึ่งมี unique อยู่แล้ว
-- การบังคับ unique บน seq จึงเป็นการเอากติกาที่ระบบต้นทางไม่ได้รับประกันมาเป็นเงื่อนไขให้ sync ตาย
--
-- อีกด้านหนึ่ง (ให้ sync ลู่เข้าหาค่าจริงเสมอ) แก้ที่ lib/bbps-sync.ts: ลบใบสั่งงานของงานนั้นที่ไม่มีใน
-- payload อีกแล้วก่อน upsert ทุกครั้ง — สองอย่างนี้ต้องทำคู่กัน อย่างเดียวยังไม่พอ
--
-- ตารางนี้ถูกสร้างโดยสาขานี้เอง การถอด constraint จึงไม่กระทบตารางเดิมของระบบ
-- (ข้อมูลจริง ณ ตอนแก้: 14 แถว ไม่มี (job_no, seq) ซ้ำ การถอด unique จึงไม่ทำให้ข้อมูลเดิมผิดกติกา)

begin;

alter table public.install_job_work_orders
  drop constraint if exists install_job_work_orders_job_no_seq_key;

-- ยังต้องเรียงตาม seq ในการแสดงผล จึงเก็บ index ไว้ แต่เป็นแบบไม่ unique
create index if not exists install_job_work_orders_job_no_seq_idx
  on public.install_job_work_orders(job_no, seq);

comment on column public.install_job_work_orders.seq is
  'ลำดับใบสั่งงานที่ BBPS ส่งมา ใช้สำหรับเรียงแสดงผลเท่านั้น ไม่ใช่กุญแจธรรมชาติและไม่บังคับ unique '
  'เพราะ BBPS ลบใบสั่งงานแล้วสร้างใบใหม่ด้วย seq เดิมได้ ถ้าบังคับ unique การ sync ครั้งถัดไปจะชน 23505 '
  'แล้วหยุดอัปเดตใบสั่งงานของงานนั้นถาวร — กุญแจธรรมชาติคือ external_work_order_id';

commit;

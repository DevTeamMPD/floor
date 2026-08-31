-- FloorNow P1: ปิดช่องโหว่ระดับ constraint ของตารางแม่แบบ/ผลตรวจรับ
--
-- ที่มา: final review ข้อ 4 และ ข้อ 7 (Important)
--
-- (ก) กติกา "มี active ได้ทีละ 1 เวอร์ชันต่อ 1 ประเภทงาน" เดิมอยู่ในโค้ด activate_* เท่านั้น
--     ไม่มี constraint รองรับ และ seed ของ T4a เขียน status='active' ลงตารางตรง ๆ ไม่ผ่าน RPC
--     ถ้ามี seed แบบนั้นอีกไฟล์ หรือมีใครแก้ข้อมูลด้วย service role จะได้แม่แบบ active สองตัวพร้อมกัน
--     แล้วคำถามว่า "งานนี้ต้องใช้เกณฑ์ชุดไหน" จะตอบไม่ได้ทันที
--     ตรวจข้อมูลจริงก่อนแล้ว: ไม่มีประเภทงานไหนมีแม่แบบ active เกิน 1 ตัว (checklist 1 แถว, prep 0 แถว)
--     activate_* ปลดระวางตัวเดิมด้วยคำสั่ง update แยกก่อนเสมอ index นี้จึงไม่ขวางการทำงานปกติ
--
-- (ข) job_acceptance_results เป็นตารางหลักฐานการตรวจรับ (ISO 8.6) แต่ผูก FK น้อยที่สุดในบรรดาตารางใหม่
--     ทั้งหมด และ unique (job_no, item_code, template_version) ใช้งานไม่ได้จริงเพราะ template_version
--     เป็น nullable (NULL ไม่เท่ากับ NULL ใน unique index) ผลตรวจข้อเดียวกันของงานเดียวกันจึงซ้ำได้ไม่จำกัด
--     ตารางนี้ยังไม่มีโค้ดไหนเขียนและมี 0 แถว (ตรวจแล้ว) จึงปิดช่องได้ก่อนมีคนเริ่มเขียนจริง
--     คีย์ที่ถูกต้องคือ (job_no, template_id, item_code) — ผูกกับ "แม่แบบเวอร์ชันที่ใช้ตรวจ" ตัวจริง
--     ซึ่งเป็น uuid not null ไม่ใช่เลขเวอร์ชันที่ว่างได้
--
-- ตารางทั้งหมดในไฟล์นี้ถูกสร้างโดยสาขานี้เอง (ยังไม่เคยมีข้อมูลจริงของระบบ) การเพิ่ม/แก้ constraint
-- จึงไม่กระทบตารางเดิมของระบบแม้แต่ตารางเดียว

begin;

-- (ก) หนึ่งแม่แบบ active ต่อหนึ่งประเภทงาน — บังคับที่ฐานข้อมูล ไม่ใช่แค่ในโค้ด RPC
create unique index if not exists job_checklist_templates_one_active_per_job_type_idx
  on public.job_checklist_templates (job_type_id) where status = 'active';
create unique index if not exists job_prep_templates_one_active_per_job_type_idx
  on public.job_prep_templates (job_type_id) where status = 'active';

-- (ข) FK ของ job_acceptance_results — แพตเทิร์นเดียวกับ install_job_work_orders.job_no
do $$
begin
  if exists (select 1 from public.job_acceptance_results) then
    raise exception 'job_acceptance_results มีข้อมูลอยู่แล้ว ต้องตรวจสอบด้วยมือก่อนเปลี่ยน constraint';
  end if;
end $$;

alter table public.job_acceptance_results
  alter column template_id set not null;

alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_job_no_fkey;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_job_no_fkey
  foreign key (job_no) references public.install_jobs(job_no) on delete cascade;

alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_work_order_id_fkey;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_work_order_id_fkey
  foreign key (work_order_id) references public.install_job_work_orders(id) on delete set null;

alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_template_id_fkey;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_template_id_fkey
  foreign key (template_id) references public.job_checklist_templates(id);

-- unique เดิมพึ่ง template_version ที่เป็น nullable จึงไม่เคยกันอะไรได้จริง เปลี่ยนมาใช้ template_id
alter table public.job_acceptance_results
  drop constraint if exists job_acceptance_results_job_no_item_code_template_version_key;
alter table public.job_acceptance_results
  add constraint job_acceptance_results_job_no_template_item_key
  unique (job_no, template_id, item_code);

create index if not exists job_acceptance_results_template_idx
  on public.job_acceptance_results(template_id);

comment on column public.job_acceptance_results.template_id is
  'แม่แบบเกณฑ์ตรวจรับ "เวอร์ชันที่ใช้ตรวจจริง" ของผลข้อนี้ — not null และเป็นส่วนหนึ่งของคีย์เอกลักษณ์ '
  '(job_no, template_id, item_code) เพราะการตอบว่า "งานนี้ตรวจด้วยเกณฑ์รุ่นไหน" ต้องชี้ไปที่แถวจริงได้เสมอ';
comment on column public.job_acceptance_results.template_version is
  'เลขเวอร์ชันของแม่แบบ ณ ตอนตรวจ เก็บไว้อ่านง่ายเท่านั้น ไม่ใช่ส่วนหนึ่งของคีย์เอกลักษณ์ '
  '(เคยเป็น แต่ nullable ทำให้ unique ใช้งานไม่ได้จริง) ตัวชี้ที่เชื่อถือได้คือ template_id';

commit;

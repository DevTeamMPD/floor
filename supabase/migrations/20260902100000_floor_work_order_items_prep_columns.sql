-- FloorNow P3-1: ต่อยอด floor_work_order_items ให้รองรับ "ใบเตรียมของที่มาจากแม่แบบ" และวงจรหยิบ–คืน–ใช้จริง
--
-- ทำไมต้องต่อที่ตารางนี้ ไม่สร้างตารางใหม่:
--   floor_work_order_items คือตารางเดียวที่หน้าจอจริงใช้อยู่ทุกวันนี้
--   (app/(admin)/warehouse/page.tsx และ app/(admin)/orders/[jobNo]/page.tsx)
--   ส่วน floor_job_materials เข้าถึงผ่าน RPC เท่านั้น และ install_jobs.pick_plan เป็น jsonb ยุคเดิม
--   การสร้างตารางที่สี่จะยิ่งทำให้ "ใบเบิกของ" กระจัดกระจาย จึงเลือกต่อยอดตารางที่เป็นความจริงอยู่แล้ว
--
-- ข้อบังคับของงานนี้: additive อย่างเดียว — ไม่แก้ ไม่ลบ ไม่เปลี่ยนความหมายคอลัมน์เดิม
-- และไม่แตะข้อมูลในแถวเดิม ทุกคอลัมน์ใหม่จึง nullable หรือมี default เพื่อให้ 12 แถวที่มีอยู่ยังใช้ได้ตามเดิม

begin;

alter table public.floor_work_order_items
  add column if not exists material_id uuid,
  add column if not exists item_kind text,
  add column if not exists template_item_id uuid,
  add column if not exists is_manual_override boolean not null default false,
  add column if not exists picked_qty numeric,
  add column if not exists returned_qty numeric,
  add column if not exists used_qty numeric;

-- FK: ผูกทะเบียนวัสดุได้ แต่ไม่บังคับ (ทะเบียน materials วันนี้มีแค่ 2 แถว)
-- on delete set null เพราะการลบวัสดุออกจากทะเบียนต้องไม่ทำให้บรรทัดในใบสั่งงานเก่าหายไป
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_material_id_fkey'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_material_id_fkey
      foreign key (material_id) references public.materials(id) on delete set null;
  end if;

  -- ชี้กลับไปยังบรรทัดแม่แบบที่ "คำนวณ" บรรทัดนี้ออกมา ใช้ตรวจย้อนหลังว่าของชิ้นนี้มาจากแม่แบบรุ่นไหน
  -- on delete set null เพราะแม่แบบถูกแก้/ลบได้ แต่ใบสั่งงานที่ออกไปแล้วต้องอยู่ครบ
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_template_item_id_fkey'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_template_item_id_fkey
      foreign key (template_item_id) references public.job_prep_template_items(id) on delete set null;
  end if;

  -- ใช้คำเดียวกับ job_prep_template_items.item_kind ('consumable','tool') เพื่อไม่ให้เกิดคำศัพท์ที่สองในระบบ
  -- nullable เพราะบรรทัดเดิม 12 แถวไม่เคยระบุ และบรรทัดวัสดุปูพื้นก็ไม่ใช่ทั้งสองอย่าง
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_item_kind_check'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_item_kind_check
      check (item_kind is null or item_kind in ('consumable', 'tool'));
  end if;

  -- จำนวนติดลบไม่มีความหมายในใบเบิกของ ตรวจแบบเดียวกับ floor_work_order_items_qty_check เดิม
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.floor_work_order_items'::regclass
      and conname = 'floor_work_order_items_pick_qty_check'
  ) then
    alter table public.floor_work_order_items
      add constraint floor_work_order_items_pick_qty_check
      check (
        (picked_qty is null or picked_qty >= 0)
        and (returned_qty is null or returned_qty >= 0)
        and (used_qty is null or used_qty >= 0)
      );
  end if;
end
$$;

create index if not exists floor_work_order_items_material_idx
  on public.floor_work_order_items(material_id);
create index if not exists floor_work_order_items_template_item_idx
  on public.floor_work_order_items(template_item_id);

comment on column public.floor_work_order_items.material_id is
  'ผูกกับทะเบียน materials เมื่อผูกได้ — nullable เพราะบรรทัดอาจเป็นชื่ออิสระที่ยังไม่มีในทะเบียน (ทะเบียนวันนี้มี 2 แถว)';
comment on column public.floor_work_order_items.item_kind is
  'ชนิดของที่ต้องเตรียม ใช้คำเดียวกับ job_prep_template_items.item_kind: consumable = ใช้แล้วหมด, tool = เครื่องมือที่ต้องคืน';
comment on column public.floor_work_order_items.template_item_id is
  'บรรทัดแม่แบบที่คำนวณบรรทัดนี้ออกมา — null แปลว่าคนกรอกเอง ไม่ได้มาจากแม่แบบ';
comment on column public.floor_work_order_items.is_manual_override is
  'true = มีคนแก้ตัวเลข/รายละเอียดต่างไปจากที่แม่แบบคำนวณให้ ใช้ตรวจว่าแม่แบบยังตรงกับหน้างานหรือไม่';
comment on column public.floor_work_order_items.picked_qty is
  'จำนวนที่คลังหยิบออกจากคลังจริง (ต่างจาก actual_qty เดิมที่หมายถึงจำนวนที่คลังจัดตามใบ)';
comment on column public.floor_work_order_items.returned_qty is
  'จำนวนที่ส่งคืนคลังหลังจบงาน — สำคัญกับ item_kind = tool';
comment on column public.floor_work_order_items.used_qty is
  'จำนวนที่ถูกใช้ไปจริงหน้างาน ใช้กระทบยอด picked_qty - returned_qty';

notify pgrst, 'reload schema';

commit;

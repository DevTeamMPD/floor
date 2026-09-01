-- FloorNow P3-3: บันทึกว่า "คนแก้รายการเตรียมของต่างจากแม่แบบอย่างไร"
--
-- ปัญหา: เมื่อระบบคำนวณรายการจากแม่แบบให้แล้ว หัวหน้าช่างย่อมต้องแก้ตามหน้างานจริง
-- แต่ถ้าแก้แล้วตัวเลขเดิมหายไปเลย จะไม่มีใครตอบได้ว่า
--   แม่แบบว่าเท่าไร · คนแก้เป็นเท่าไร · ใครแก้ · แก้เมื่อไร · แก้เพราะอะไร
-- ซึ่งเป็นข้อมูลที่ต้องมีทั้งเพื่อปรับปรุงแม่แบบ (ถ้าแก้ซ้ำ ๆ แปลว่าแม่แบบผิด)
-- และเพื่อการตรวจสอบย้อนกลับตาม ISO 7.5
--
-- ทำไม "ตารางใหม่" ไม่ใช่ "เพิ่มคอลัมน์ใน floor_work_order_items":
--   1) ต้องบันทึกการ "ลบบรรทัดแม่แบบทิ้ง" ด้วย ซึ่งไม่มีแถวให้เก็บคอลัมน์อีกต่อไป
--   2) แก้ได้หลายครั้ง ต้องเก็บได้หลายแถวต่อหนึ่งบรรทัด คอลัมน์เก็บได้ค่าเดียว
--   3) floor_work_order_items ถูก confirm_floor_work_order_v2 ลบทิ้งแล้วเขียนใหม่ทุกครั้งที่ยืนยันใบสั่งงาน
--      ประวัติที่ฝากไว้ในแถวนั้นจะหายทุกครั้ง แต่ตารางแยกอยู่รอด
--   4) เป็นการเพิ่มของใหม่ล้วน ๆ ไม่แตะความหมายของตารางเดิม
--
-- ไม่มีใครเขียนตารางนี้ตรง ๆ ได้ — เขียนผ่าน RPC ที่เช็ค role เท่านั้น
-- (supabase/migrations/20260902110020_job_prep_item_override_rpcs.sql)

begin;

create table if not exists public.job_prep_item_overrides (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.floor_work_orders(id) on delete cascade,
  -- บรรทัดที่ถูกแก้ ณ ตอนบันทึก — set null เมื่อบรรทัดถูกลบภายหลัง ประวัติต้องไม่หายตามไปด้วย
  item_id uuid references public.floor_work_order_items(id) on delete set null,
  -- บรรทัดแม่แบบต้นทาง — null เมื่อเป็นรายการที่คนเพิ่มเองนอกแม่แบบ
  template_item_id uuid references public.job_prep_template_items(id) on delete set null,
  template_id uuid references public.job_prep_templates(id) on delete set null,
  change_kind text not null check (change_kind in ('qty_changed', 'added', 'removed')),
  -- "แม่แบบว่าอะไร" — เก็บเป็น snapshot ไม่ใช่ join เพราะแม่แบบเปลี่ยนเวอร์ชันได้
  template_item_name text,
  template_unit text,
  template_qty numeric check (template_qty is null or template_qty >= 0),
  -- "คนทำให้เป็นอะไร"
  human_item_name text,
  human_unit text,
  human_qty numeric check (human_qty is null or human_qty >= 0),
  -- "คิดมาจากอะไร" — พื้นที่ จำนวนแผ่น calc_mode calc_qty waste_pct ณ เวลานั้น
  calc_basis jsonb,
  -- "ทำไม" — ภาษาไทย บังคับกรอก
  reason text not null check (btrim(reason) <> ''),
  -- "ใคร" และ "เมื่อไร"
  changed_by uuid references public.floor_staff_profiles(id) on delete set null,
  changed_by_name text,
  changed_at timestamptz not null default now(),
  -- แก้และเพิ่ม ต้องมีตัวเลขที่คนทำให้เป็นเสมอ · ลบไม่ต้องมี เพราะบรรทัดหายไปแล้ว
  constraint job_prep_item_overrides_shape_check check (
    (change_kind in ('qty_changed', 'added') and human_qty is not null)
    or change_kind = 'removed'
  )
);

create index if not exists job_prep_item_overrides_work_order_idx
  on public.job_prep_item_overrides(work_order_id, changed_at desc);
create index if not exists job_prep_item_overrides_template_item_idx
  on public.job_prep_item_overrides(work_order_id, template_item_id)
  where template_item_id is not null;
create index if not exists job_prep_item_overrides_item_idx
  on public.job_prep_item_overrides(item_id) where item_id is not null;

comment on table public.job_prep_item_overrides is
  'ส่วนต่างระหว่างรายการที่แม่แบบคำนวณกับรายการที่คนทำจริง — ตอบได้ว่าแม่แบบว่าเท่าไร '
  'คนแก้เป็นเท่าไร ใครแก้ เมื่อไร และเพราะอะไร เขียนได้ผ่าน RPC ที่เช็ค role เท่านั้น';
comment on column public.job_prep_item_overrides.change_kind is
  'qty_changed = แก้จำนวน/ชื่อ/หน่วยของบรรทัดที่มาจากแม่แบบ · added = เพิ่มบรรทัดที่ไม่มีในแม่แบบ · removed = ลบบรรทัดของแม่แบบทิ้ง';
comment on column public.job_prep_item_overrides.calc_basis is
  'ค่าตั้งต้นที่ใช้คำนวณ ณ เวลานั้น (area_sqm, unit_count, calc_mode, calc_qty, waste_pct, template_version) '
  'เก็บเป็น snapshot เพื่อให้ยังอธิบายตัวเลขเดิมได้แม้แม่แบบจะถูกแก้ไปแล้ว';

-- สิทธิ์: เหมือนตารางแม่แบบทุกตัวในสาขานี้ — อ่านได้เฉพาะพนักงานที่ยัง active เขียนผ่าน RPC เท่านั้น
alter table public.job_prep_item_overrides enable row level security;
revoke all on public.job_prep_item_overrides from anon, authenticated;
grant select on public.job_prep_item_overrides to authenticated;

drop policy if exists job_prep_item_overrides_active_staff_read on public.job_prep_item_overrides;
create policy job_prep_item_overrides_active_staff_read on public.job_prep_item_overrides
  for select to authenticated using ((select public.is_floor_staff_active()));

commit;

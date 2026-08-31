-- T2: อ่านข้อมูลใบสั่งงาน 37 ฟิลด์ที่ BBPS ส่งมาแล้ว (เฟส 1)
-- BBPS ส่งใบสั่งงานย่อยมาครบทุกฟิลด์อยู่แล้วใน install_jobs.raw_payload->'workOrders'
-- (trigger ฝั่ง BBPS ใช้ to_jsonb(w) ยัดทั้งแถวลง payload) แต่ฝั่ง LENDI อ่านไปใช้แค่ 3 ฟิลด์
-- (seq, start, end) อีก 34 ฟิลด์ถูกทิ้งดิบไว้ไม่มีใครอ่าน งานนี้แยกฟิลด์ที่เหลือออกมาเป็นตาราง
-- ลูกของ install_jobs เพื่อให้ใช้งานได้จริง โดยไม่ต้องแก้อะไรฝั่ง BBPS เลย
--
-- งานนี้เป็น DDL + backfill ล้วน (additive only) — ห้าม apply จนกว่าจะได้รับการอนุมัติ

begin;

create table if not exists public.install_job_work_orders (
  id uuid primary key default gen_random_uuid(),
  job_no text not null references public.install_jobs(job_no) on delete cascade,
  -- id ของแถวฝั่ง BBPS — ใช้เป็น natural key สำหรับ upsert แบบ idempotent เวลา sync ซ้ำ
  external_work_order_id uuid,
  seq integer,
  install_start date,
  install_end date,
  location_address text,
  location_map_link text,
  contact_name text,
  contact_phone text,
  manpower text,
  materials text,
  -- รายละเอียดงาน 5 หมวด + รวม
  task_details text,
  task_ball_pit text,
  task_workshop_set text,
  task_gym text,
  task_floor text,
  task_other text,
  -- ข้อจำกัดหน้างาน 9 ข้อ ตามที่ BBPS ส่งมา
  constraint_access_time text,
  constraint_logistics text,
  constraint_work_area text,
  constraint_obstacles text,
  constraint_ground text,
  constraint_utilities text,
  constraint_noise_dust text,
  constraint_weather text,
  constraint_site_authority text,
  -- เกณฑ์ตรวจรับที่ BBPS เขียนไว้ (ข้อความอิสระ ไม่ใช่ checklist แบบ job_checklist_templates)
  acceptance_criteria text,
  acceptance_photos text,
  acceptance_quality_check text,
  acceptance_documents text,
  acceptance_signoff text,
  acceptance_followup text,
  design_images jsonb not null default '[]'::jsonb,
  site_photos jsonb not null default '[]'::jsonb,
  -- เก็บ work order ดิบไว้ทั้งชิ้นเผื่อ BBPS เพิ่มฟิลด์ใหม่ในอนาคตที่คอลัมน์ข้างบนยังไม่รองรับ
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_no, seq),
  unique (external_work_order_id)
);

create index if not exists install_job_work_orders_job_no_idx
  on public.install_job_work_orders(job_no);

comment on table public.install_job_work_orders is
  'ใบสั่งงานย่อยของ install_jobs หนึ่งงานติดตั้งอาจมีหลายใบสั่งงาน (เช่น ส่งของก่อน แล้วติดตั้งทีหลัง) '
  'ข้อมูลทั้งหมดมาจาก BBPS ผ่าน install_jobs.raw_payload->''workOrders'' ตารางนี้แยกออกมาเพื่อให้ query/แสดงผลได้ '
  'โดยไม่ต้อง parse jsonb ทุกครั้ง';
comment on column public.install_job_work_orders.external_work_order_id is
  'uuid ของแถวใบสั่งงานฝั่ง BBPS — ใช้เป็นกุญแจ upsert (onConflict) เพื่อให้ sync ซ้ำแล้วไม่สร้างซ้ำ '
  'nullable เพราะทางทฤษฎี BBPS อาจส่งใบสั่งงานที่ไม่มี id มา (ยังไม่เคยพบในข้อมูลจริง) — รายการแบบนั้นถูกข้าม '
  'ตั้งแต่ชั้นโค้ด (parseBbpsWorkOrders) ไม่ถูกเขียนลงตารางนี้';
comment on column public.install_job_work_orders.raw is
  'work order ดิบทั้งชิ้นตามที่ BBPS ส่งมา เผื่อ BBPS เพิ่มฟิลด์ใหม่ในอนาคตที่คอลัมน์ข้างบนยังไม่มี '
  'จะได้ไม่ต้อง migration ใหม่ทันทีที่ BBPS เพิ่มฟิลด์';

-- RLS: แพตเทิร์นเดียวกับ supabase/migrations/20260901100000_job_templates_foundation.sql
-- อ่านได้เฉพาะ staff ที่ active เขียนได้เฉพาะ service_role (sync มาจาก webhook ที่ใช้ service role)
alter table public.install_job_work_orders enable row level security;

revoke all on public.install_job_work_orders from anon, authenticated;

grant select on public.install_job_work_orders to authenticated;

drop policy if exists install_job_work_orders_active_staff_read on public.install_job_work_orders;
create policy install_job_work_orders_active_staff_read on public.install_job_work_orders
  for select to authenticated using ((select public.is_floor_staff_active()));

-- Backfill: เติมข้อมูลจาก install_jobs.raw_payload->'workOrders' ของงานที่มีอยู่แล้ว (13 งาน ณ วันที่เขียน)
-- ใช้ jsonb_array_elements + on conflict do nothing เพื่อให้รันซ้ำได้ไม่พัง
-- ข้ามใบสั่งงานที่ไม่มี id (ไม่มี natural key ให้ upsert อ้างอิงในอนาคต) และไม่เก็บวันที่ปี พ.ศ. (> 2100) ตรง ๆ
-- เพื่อไม่ให้ค่าเพี้ยนเข้าไปในคอลัมน์ date (ตามแพตเทิร์น isCEDate ใน lib/bbps-sync.ts)
insert into public.install_job_work_orders (
  job_no, external_work_order_id, seq, install_start, install_end,
  location_address, location_map_link, contact_name, contact_phone, manpower, materials,
  task_details, task_ball_pit, task_workshop_set, task_gym, task_floor, task_other,
  constraint_access_time, constraint_logistics, constraint_work_area, constraint_obstacles,
  constraint_ground, constraint_utilities, constraint_noise_dust, constraint_weather, constraint_site_authority,
  acceptance_criteria, acceptance_photos, acceptance_quality_check, acceptance_documents, acceptance_signoff, acceptance_followup,
  design_images, site_photos, raw
)
select
  j.job_no,
  (wo->>'id')::uuid,
  nullif(wo->>'seq', '')::integer,
  case
    when (wo->>'install_start') ~ '^\d{4}-\d{2}-\d{2}'
      and split_part(wo->>'install_start', '-', 1)::integer <= 2100
    then (wo->>'install_start')::date
    else null
  end,
  case
    when (wo->>'install_end') ~ '^\d{4}-\d{2}-\d{2}'
      and split_part(wo->>'install_end', '-', 1)::integer <= 2100
    then (wo->>'install_end')::date
    else null
  end,
  wo->>'location_address',
  wo->>'location_map_link',
  wo->>'contact_name',
  wo->>'contact_phone',
  wo->>'manpower',
  wo->>'materials',
  wo->>'task_details',
  wo->>'task_ball_pit',
  wo->>'task_workshop_set',
  wo->>'task_gym',
  wo->>'task_floor',
  wo->>'task_other',
  wo->>'constraint_access_time',
  wo->>'constraint_logistics',
  wo->>'constraint_work_area',
  wo->>'constraint_obstacles',
  wo->>'constraint_ground',
  wo->>'constraint_utilities',
  wo->>'constraint_noise_dust',
  wo->>'constraint_weather',
  wo->>'constraint_site_authority',
  wo->>'acceptance_criteria',
  wo->>'acceptance_photos',
  wo->>'acceptance_quality_check',
  wo->>'acceptance_documents',
  wo->>'acceptance_signoff',
  wo->>'acceptance_followup',
  -- design_images/site_photos ในต้นทางอาจเป็น array หรือ null — ทนทั้งสองแบบ, ไม่ใช่ array ให้ถือเป็น []
  case when jsonb_typeof(wo->'design_images') = 'array' then wo->'design_images' else '[]'::jsonb end,
  case when jsonb_typeof(wo->'site_photos') = 'array' then wo->'site_photos' else '[]'::jsonb end,
  wo
from public.install_jobs j,
  lateral jsonb_array_elements(j.raw_payload -> 'workOrders') as wo
where j.source = 'bbps'
  and jsonb_typeof(j.raw_payload -> 'workOrders') = 'array'
  and (wo->>'id') is not null
  and (wo->>'id') ~ '^[0-9a-fA-F-]{36}$'
on conflict (external_work_order_id) do nothing;

notify pgrst, 'reload schema';

commit;

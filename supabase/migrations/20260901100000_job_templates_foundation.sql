-- FloorNow P1: รากฐานตาราง "แม่แบบประเภทงาน" (checklist ตรวจรับ + รายการเตรียมของ)
-- ให้หัวหน้าช่างแก้แม่แบบเองได้โดยไม่ต้องแก้โค้ด พร้อมเก็บประวัติการแก้ตาม ISO 7.5
-- งานนี้เป็น DDL ล้วน (additive only) — ไม่มี RPC/business logic ในไฟล์นี้ การเขียนข้อมูล
-- ทั้งหมดต้องผ่าน RPC ที่เช็ค role ในงานถัดไป จึงเปิด RLS และไม่ให้สิทธิ์เขียนแก่ authenticated/anon
-- ห้าม apply จนกว่าจะได้รับการอนุมัติ

begin;

-- 1) ทะเบียนประเภทงาน — จุดยึด (anchor) ให้ทุกแม่แบบผูกกับประเภทงานเดียวกัน
create table if not exists public.job_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- ผูกกับหมวดงานในใบสั่งงาน BBPS เพื่อ auto-match แม่แบบตามประเภทงานที่ตั้งเวลาไว้แล้ว
  task_field text check (task_field is null or task_field in ('ball_pit', 'workshop_set', 'gym', 'floor', 'other')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.floor_staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) แม่แบบเกณฑ์ตรวจรับ — มีเวอร์ชัน เพื่อแก้ไขได้โดยไม่กระทบงานที่ตรวจรับไปแล้ว (ISO 7.5)
create table if not exists public.job_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  job_type_id uuid not null references public.job_types(id),
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  effective_from timestamptz,
  notes text,
  created_by uuid references public.floor_staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type_id, version)
);
create index if not exists job_checklist_templates_job_type_status_idx
  on public.job_checklist_templates(job_type_id, status);

-- 3) รายการเกณฑ์ตรวจรับในแต่ละแม่แบบ
create table if not exists public.job_checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.job_checklist_templates(id) on delete cascade,
  code text not null,
  label text not null,
  spec_text text,
  requires_photo boolean not null default false,
  is_critical boolean not null default true,
  -- ชนิดเครื่องมือที่ต้องใช้วัดข้อนี้ (ISO 7.1.5) — nullable เพราะบางข้อตรวจด้วยสายตา ไม่ต้องใช้เครื่องมือวัด
  measuring_device_kind text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, code)
);
create index if not exists job_checklist_template_items_template_sort_idx
  on public.job_checklist_template_items(template_id, sort_order);

-- 4) แม่แบบรายการเตรียมของ — โครงเดียวกับแม่แบบเกณฑ์ตรวจรับ เพื่อให้หัวหน้าช่างคุ้นรูปแบบการแก้ทั้งสองชนิด
create table if not exists public.job_prep_templates (
  id uuid primary key default gen_random_uuid(),
  job_type_id uuid not null references public.job_types(id),
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  effective_from timestamptz,
  notes text,
  created_by uuid references public.floor_staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type_id, version)
);
create index if not exists job_prep_templates_job_type_status_idx
  on public.job_prep_templates(job_type_id, status);

-- 5) รายการของที่ต้องเตรียมในแต่ละแม่แบบ
create table if not exists public.job_prep_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.job_prep_templates(id) on delete cascade,
  material_id uuid references public.materials(id),
  item_name text not null,
  unit text,
  item_kind text not null check (item_kind in ('consumable', 'tool')),
  calc_mode text not null check (calc_mode in ('fixed', 'per_sqm', 'per_unit')),
  calc_qty numeric not null check (calc_qty > 0),
  waste_pct numeric not null default 0 check (waste_pct >= 0 and waste_pct <= 100),
  is_required boolean not null default true,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_prep_template_items_template_sort_idx
  on public.job_prep_template_items(template_id, sort_order);

comment on column public.job_prep_template_items.material_id is
  'ต้อง nullable เพราะทะเบียน materials วันนี้มีข้อมูลเพียง 2 แถว หากบังคับผูกกับทะเบียนตั้งแต่ต้น '
  'ระบบจะล็อกตัวเองจนกว่าจะกรอกทะเบียนให้ครบ ซึ่งเป็นงานที่ใช้เวลานาน จึงต้องรองรับรายการที่ยังเป็นชื่ออิสระ '
  '(item_name) ไปก่อน แล้วค่อยผูกกับทะเบียนจริงภายหลัง';

-- 6) ประวัติการแก้แม่แบบ (ISO 7.5 document control) — ไม่มี FK เพราะ template_id ชี้ได้ทั้งแม่แบบตรวจรับและแม่แบบเตรียมของ
create table if not exists public.job_template_revisions (
  id uuid primary key default gen_random_uuid(),
  template_kind text not null check (template_kind in ('checklist', 'prep')),
  template_id uuid not null,
  version integer not null,
  action text not null,
  changed_by uuid references public.floor_staff_profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  diff jsonb,
  note text
);
create index if not exists job_template_revisions_kind_template_idx
  on public.job_template_revisions(template_kind, template_id);

-- 7) ทะเบียนเครื่องมือวัด (ISO 7.1.5)
create table if not exists public.measuring_devices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null,
  owner_team_id uuid references public.tech_teams(id),
  range_text text,
  resolution_text text,
  last_calibrated_at date,
  calibration_interval_days integer,
  next_due_at date,
  status text not null default 'ok' check (status in ('ok', 'due', 'out_of_service')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.measuring_devices.next_due_at is
  'เป็นคอลัมน์ธรรมดา ไม่ใช่ generated column เพราะการคำนวณจาก last_calibrated_at บวก '
  'calibration_interval_days ไม่ใช่ immutable expression ที่ Postgres ยอมรับใน generated column '
  '(ต้องปัดตามวันหยุด/นโยบายจริง) ให้ RPC เป็นผู้คำนวณและอัปเดตค่านี้แทน';

-- 8) ผลตรวจรับรายข้อ — เก็บ snapshot ของเกณฑ์ ณ ตอนตรวจ ไม่อ้างอิงสดไปยังแม่แบบ
create table if not exists public.job_acceptance_results (
  id uuid primary key default gen_random_uuid(),
  job_no text not null,
  work_order_id uuid,
  template_id uuid,
  template_version integer,
  item_code text not null,
  item_label_snapshot text not null,
  requires_photo boolean not null default false,
  is_critical boolean not null default true,
  result text check (result in ('pass', 'fail', 'na')),
  measured_value text,
  measuring_device_id uuid references public.measuring_devices(id),
  photo_paths text[] not null default '{}'::text[],
  performed_by uuid references public.floor_staff_profiles(id) on delete set null,
  performed_technician_id uuid references public.floor_technicians(id),
  performed_at timestamptz,
  verified_by uuid references public.floor_staff_profiles(id) on delete set null,
  verified_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_no, item_code, template_version)
);
create index if not exists job_acceptance_results_job_no_idx
  on public.job_acceptance_results(job_no);
create index if not exists job_acceptance_results_work_order_idx
  on public.job_acceptance_results(work_order_id);

comment on table public.job_acceptance_results is
  'ผลตรวจรับรายข้อของงานติดตั้ง — performed_* (ผู้ปฏิบัติงาน) กับ verified_* (ผู้ตรวจรับ) ต้องแยกฟิลด์กัน '
  'ตั้งแต่ออกแบบ เพราะเมื่องานทำโดยผู้รับเหมา ผู้ปฏิบัติงานกับผู้ตรวจรับต้องไม่ใช่คนเดียวกัน '
  'หากออกแบบเป็นช่องเดียวแล้วมาแยกภายหลัง ข้อมูลเก่าจะแยกไม่ได้ว่าใครทำใครตรวจ';
comment on column public.job_acceptance_results.item_label_snapshot is
  'เก็บข้อความของเกณฑ์ ณ ตอนตรวจรับจริง ไม่ใช่การอ้างอิงสดไปยังแม่แบบ เพราะการแก้แม่แบบภายหลังต้องไม่ย้อนไป '
  'เปลี่ยนเกณฑ์ของงานที่ตรวจรับไปแล้ว (ISO 7.5 การควบคุมเอกสาร)';
comment on column public.job_acceptance_results.performed_by is
  'ต้องผูก FK ไปยัง floor_staff_profiles(id) เพราะระบบนี้ต้องตอบคำถาม "ใครเป็นคนตรวจรับงานนี้" '
  'ได้เสมอตาม ISO 8.6 ถ้าเป็น uuid ลอย ๆ ไม่มี FK เมื่อพนักงานถูกลบออกจากระบบ ค่าที่เหลือจะชี้ไปหาคนที่ไม่มีอยู่แล้ว '
  'ทำให้หลักฐานการตรวจรับใช้ไม่ได้ ใช้ on delete set null เพื่อให้บันทึกยังอยู่แต่บอกตรง ๆ ว่าอ้างอิงคนไม่ได้แล้ว '
  'ซึ่งซื่อสัตย์กว่า id ที่ชี้ไปที่ว่างเปล่า';
comment on column public.job_acceptance_results.verified_by is
  'เหตุผลเดียวกับ performed_by — ต้องผูก FK ไปยัง floor_staff_profiles(id) เพื่อสืบย้อนผู้ตรวจรับได้ตาม ISO 8.6 '
  'และใช้ on delete set null ด้วยเหตุผลเดียวกัน';

-- คอลัมน์เพิ่มในตารางเดิม (nullable ทั้งหมด — additive only) รองรับช่างของผู้รับเหมานอกเหนือจากพนักงานเอง
alter table public.floor_technicians add column if not exists provider_id uuid references public.suppliers(id);
comment on column public.floor_technicians.provider_id is
  'null = พนักงานบริษัท · มีค่า = ช่างของผู้รับเหมารายนี้ ใช้แยกสิทธิ์และการสุ่มตรวจงานผู้รับเหมา';

alter table public.tech_teams add column if not exists provider_type text check (provider_type in ('in_house', 'subcontract'));
comment on column public.tech_teams.provider_type is
  'ระบุว่าทีมนี้เป็นทีมช่างของบริษัทเอง (in_house) หรือทีมผู้รับเหมา (subcontract) '
  'เพื่อใช้แยกกฎการตรวจรับงานและการคำนวณค่าตอบแทนในอนาคต';

alter table public.suppliers add column if not exists provider_kind text check (provider_kind in ('material', 'labor', 'both'));
comment on column public.suppliers.provider_kind is
  'ระบุประเภทที่ผู้จำหน่ายรายนี้ให้บริการ — วัสดุ (material) แรงงาน/ทีมช่าง (labor) หรือทั้งสองอย่าง (both) '
  'เพื่อใช้กรองเมื่อค้นหาผู้รับเหมาแรงงาน';

alter table public.suppliers add column if not exists inspection_sample_pct numeric check (inspection_sample_pct >= 0 and inspection_sample_pct <= 100);
comment on column public.suppliers.inspection_sample_pct is
  '% ของงานที่ต้องสุ่มตรวจหน้างานสำหรับผู้รับเหมารายนี้ ตั้งค่าได้ต่อราย ไม่ผูกเป็นค่าคงที่ในโค้ด '
  'เพราะแต่ละรายมีความน่าเชื่อถือไม่เท่ากัน';

create index if not exists floor_technicians_provider_id_idx
  on public.floor_technicians(provider_id);

-- RLS: ทุกตารางใหม่อ่านได้เฉพาะ staff ที่ active เขียนได้เฉพาะ service_role (ผ่าน RPC ในงานถัดไป)
alter table public.job_types enable row level security;
alter table public.job_checklist_templates enable row level security;
alter table public.job_checklist_template_items enable row level security;
alter table public.job_prep_templates enable row level security;
alter table public.job_prep_template_items enable row level security;
alter table public.job_template_revisions enable row level security;
alter table public.measuring_devices enable row level security;
alter table public.job_acceptance_results enable row level security;

revoke all on public.job_types from anon, authenticated;
revoke all on public.job_checklist_templates from anon, authenticated;
revoke all on public.job_checklist_template_items from anon, authenticated;
revoke all on public.job_prep_templates from anon, authenticated;
revoke all on public.job_prep_template_items from anon, authenticated;
revoke all on public.job_template_revisions from anon, authenticated;
revoke all on public.measuring_devices from anon, authenticated;
revoke all on public.job_acceptance_results from anon, authenticated;

grant select on
  public.job_types,
  public.job_checklist_templates,
  public.job_checklist_template_items,
  public.job_prep_templates,
  public.job_prep_template_items,
  public.job_template_revisions,
  public.measuring_devices,
  public.job_acceptance_results
to authenticated;

drop policy if exists job_types_active_staff_read on public.job_types;
create policy job_types_active_staff_read on public.job_types
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists job_checklist_templates_active_staff_read on public.job_checklist_templates;
create policy job_checklist_templates_active_staff_read on public.job_checklist_templates
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists job_checklist_template_items_active_staff_read on public.job_checklist_template_items;
create policy job_checklist_template_items_active_staff_read on public.job_checklist_template_items
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists job_prep_templates_active_staff_read on public.job_prep_templates;
create policy job_prep_templates_active_staff_read on public.job_prep_templates
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists job_prep_template_items_active_staff_read on public.job_prep_template_items;
create policy job_prep_template_items_active_staff_read on public.job_prep_template_items
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists job_template_revisions_active_staff_read on public.job_template_revisions;
create policy job_template_revisions_active_staff_read on public.job_template_revisions
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists measuring_devices_active_staff_read on public.measuring_devices;
create policy measuring_devices_active_staff_read on public.measuring_devices
  for select to authenticated using ((select public.is_floor_staff_active()));

drop policy if exists job_acceptance_results_active_staff_read on public.job_acceptance_results;
create policy job_acceptance_results_active_staff_read on public.job_acceptance_results
  for select to authenticated using ((select public.is_floor_staff_active()));

notify pgrst, 'reload schema';

commit;

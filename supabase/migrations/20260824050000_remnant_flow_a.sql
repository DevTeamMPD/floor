-- FloorNow Remnant Flow A
-- Lead technician reports material movement after completion. Warehouse review
-- is required before any remnant becomes available in remnant_stock.

create table if not exists public.floor_remnant_reports (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  work_order_id uuid references public.floor_work_orders(id) on delete set null,
  assignment_id uuid not null references public.appointment_technicians(id) on delete restrict,
  technician_id uuid not null references public.floor_technicians(id) on delete restrict,
  job_no text not null,
  no_remnant boolean not null default false,
  materials jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'pending_review',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.floor_staff_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint floor_remnant_reports_appointment_unique unique (appointment_id),
  constraint floor_remnant_reports_status_check check (status in ('pending_review','accepted','rejected')),
  constraint floor_remnant_reports_materials_array check (jsonb_typeof(materials) = 'array')
);

create table if not exists public.floor_remnant_report_pieces (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.floor_remnant_reports(id) on delete cascade,
  width_bin smallint not null,
  length_cm numeric not null,
  qty integer not null default 1,
  thickness text not null,
  color text not null,
  mat_type text not null,
  note text,
  photo_paths text[] not null default '{}',
  stock_remnant_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint floor_remnant_piece_width_check check (width_bin in (110,140)),
  constraint floor_remnant_piece_length_check check (length_cm > 0),
  constraint floor_remnant_piece_qty_check check (qty > 0 and qty <= 100),
  constraint floor_remnant_piece_thickness_check check (thickness in ('6','16')),
  constraint floor_remnant_piece_color_check check (color in ('B','W')),
  constraint floor_remnant_piece_type_check check (mat_type in ('16B','16W','6B','6W'))
);

create index if not exists floor_remnant_reports_status_time_idx
  on public.floor_remnant_reports(status, submitted_at desc);
create index if not exists floor_remnant_pieces_report_idx
  on public.floor_remnant_report_pieces(report_id, created_at);

alter table public.floor_remnant_reports enable row level security;
alter table public.floor_remnant_report_pieces enable row level security;
revoke all on public.floor_remnant_reports from anon, authenticated;
revoke all on public.floor_remnant_report_pieces from anon, authenticated;

create or replace function public.get_technician_remnant_report(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_assignment public.appointment_technicians%rowtype; v_report public.floor_remnant_reports%rowtype;
begin
  select a.* into v_assignment
  from public.appointment_technicians a
  join public.floor_technicians t on t.id=a.technician_id
  where a.id=p_assignment_id and a.is_active and t.is_active and t.personal_token=p_token
    and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;

  select * into v_report from public.floor_remnant_reports where appointment_id=v_assignment.appointment_id;
  if v_report.id is null then
    return jsonb_build_object('exists',false,'isLead',v_assignment.is_lead,'status',null,'materials','[]'::jsonb,'pieces','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'exists',true,'isLead',v_assignment.is_lead,'id',v_report.id,'status',v_report.status,
    'noRemnant',v_report.no_remnant,'materials',v_report.materials,'notes',v_report.notes,
    'submittedAt',v_report.submitted_at,'reviewNote',v_report.review_note,
    'pieces',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'widthCm',p.width_bin::text,'lengthCm',p.length_cm::text,'qty',p.qty::text,
      'thickness',p.thickness,'color',p.color,'note',p.note,'photoPaths',p.photo_paths
    ) order by p.created_at) from public.floor_remnant_report_pieces p where p.report_id=v_report.id),'[]'::jsonb)
  );
end;
$$;

create or replace function public.save_technician_remnant_report(
  p_token uuid,
  p_pin text,
  p_assignment_id uuid,
  p_no_remnant boolean,
  p_materials jsonb,
  p_pieces jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.appointment_technicians%rowtype;
  v_order public.floor_work_orders%rowtype;
  v_report public.floor_remnant_reports%rowtype;
  v_piece jsonb; v_width int; v_length numeric; v_qty int; v_thickness text; v_color text; v_photos text[];
  v_materials jsonb := coalesce(p_materials,'[]'::jsonb);
  v_pieces jsonb := coalesce(p_pieces,'[]'::jsonb);
  v_handover jsonb;
begin
  if jsonb_typeof(v_materials) <> 'array' or jsonb_typeof(v_pieces) <> 'array' then raise exception 'materials and pieces must be arrays'; end if;
  select a.* into v_assignment
  from public.appointment_technicians a
  join public.floor_technicians t on t.id=a.technician_id
  where a.id=p_assignment_id and a.is_active and t.is_active and t.personal_token=p_token
    and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;
  if not v_assignment.is_lead then raise exception 'lead technician permission required'; end if;
  if not exists (select 1 from public.floor_work_progress_events e where e.assignment_id=v_assignment.id and e.status='completed') then
    raise exception 'complete installation before remnant report';
  end if;
  if not coalesce(p_no_remnant,false) and jsonb_array_length(v_pieces)=0 then raise exception 'add remnant pieces or select no remnant'; end if;
  if coalesce(p_no_remnant,false) and jsonb_array_length(v_pieces)>0 then raise exception 'no remnant report cannot contain pieces'; end if;

  for v_piece in select value from jsonb_array_elements(v_pieces) loop
    begin
      v_width := (v_piece->>'widthCm')::int; v_length := (v_piece->>'lengthCm')::numeric;
      v_qty := coalesce(nullif(v_piece->>'qty','')::int,1); v_thickness := v_piece->>'thickness'; v_color := v_piece->>'color';
    exception when others then raise exception 'invalid remnant dimensions'; end;
    if v_width not in (110,140) or v_length <= 0 or v_qty <= 0 or v_qty > 100
       or v_thickness not in ('6','16') or v_color not in ('B','W') then raise exception 'invalid remnant piece'; end if;
    select coalesce(array_agg(x),array[]::text[]) into v_photos from jsonb_array_elements_text(coalesce(v_piece->'photoPaths','[]'::jsonb)) x;
    if cardinality(v_photos)=0 then raise exception 'remnant photo is required'; end if;
  end loop;

  select * into v_order from public.floor_work_orders where appointment_id=v_assignment.appointment_id;
  select * into v_report from public.floor_remnant_reports where appointment_id=v_assignment.appointment_id for update;
  if v_report.status='accepted' then raise exception 'accepted remnant report cannot be changed'; end if;

  insert into public.floor_remnant_reports(appointment_id,work_order_id,assignment_id,technician_id,job_no,no_remnant,materials,notes,status,submitted_at,reviewed_by,reviewed_at,review_note,updated_at)
  select v_assignment.appointment_id,v_order.id,v_assignment.id,v_assignment.technician_id,ap.job_id,coalesce(p_no_remnant,false),v_materials,
    nullif(left(btrim(coalesce(p_notes,'')),2000),''),'pending_review',now(),null,null,null,now()
  from public.appointments ap where ap.id=v_assignment.appointment_id
  on conflict (appointment_id) do update set work_order_id=excluded.work_order_id,assignment_id=excluded.assignment_id,
    technician_id=excluded.technician_id,job_no=excluded.job_no,no_remnant=excluded.no_remnant,materials=excluded.materials,
    notes=excluded.notes,status='pending_review',submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null,updated_at=now()
  returning * into v_report;

  delete from public.floor_remnant_report_pieces where report_id=v_report.id;
  for v_piece in select value from jsonb_array_elements(v_pieces) loop
    v_width := (v_piece->>'widthCm')::int; v_length := (v_piece->>'lengthCm')::numeric;
    v_qty := coalesce(nullif(v_piece->>'qty','')::int,1); v_thickness := v_piece->>'thickness'; v_color := v_piece->>'color';
    select coalesce(array_agg(x),array[]::text[]) into v_photos from jsonb_array_elements_text(coalesce(v_piece->'photoPaths','[]'::jsonb)) x;
    insert into public.floor_remnant_report_pieces(report_id,width_bin,length_cm,qty,thickness,color,mat_type,note,photo_paths)
    values(v_report.id,v_width,v_length,v_qty,v_thickness,v_color,v_thickness||v_color,
      nullif(left(btrim(coalesce(v_piece->>'note','')),500),''),v_photos);
  end loop;

  v_handover := jsonb_build_object('materials',v_materials,'returnItems',v_pieces,'notes',coalesce(p_notes,''),'savedAt',now());
  update public.install_jobs set handover_data=v_handover::text,updated_at=now() where job_no=v_report.job_no;
  if v_order.id is not null then
    insert into public.floor_work_order_events(work_order_id,event_type,from_status,to_status,actor_technician_id,actor_name,note,metadata)
    select v_order.id,'remnants_submitted',v_order.status,v_order.status,v_assignment.technician_id,t.name,
      case when p_no_remnant then 'ช่างยืนยันว่าไม่มีเศษเหลือ' else 'ส่งเศษให้คลังตรวจรับ '||jsonb_array_length(v_pieces)||' รายการ' end,
      jsonb_build_object('reportId',v_report.id,'noRemnant',p_no_remnant)
    from public.floor_technicians t where t.id=v_assignment.technician_id;
  end if;
  return jsonb_build_object('id',v_report.id,'status','pending_review','noRemnant',p_no_remnant);
end;
$$;

create or replace function public.list_remnant_reports_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.floor_staff_profiles p where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','warehouse')) then
    raise exception 'warehouse permission required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'jobNo',r.job_no,'status',r.status,'noRemnant',r.no_remnant,'notes',r.notes,
    'technicianName',t.name,'submittedAt',r.submitted_at,'reviewNote',r.review_note,
    'pieces',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'widthCm',x.width_bin,'lengthCm',x.length_cm,'qty',x.qty,
      'matType',x.mat_type,'note',x.note,'photoPaths',x.photo_paths) order by x.created_at) from public.floor_remnant_report_pieces x where x.report_id=r.id),'[]'::jsonb)
  ) order by case r.status when 'pending_review' then 0 when 'rejected' then 1 else 2 end,r.submitted_at desc)
  from public.floor_remnant_reports r join public.floor_technicians t on t.id=r.technician_id),'[]'::jsonb);
end;
$$;

create or replace function public.review_remnant_report_staff(p_report_id uuid,p_decision text,p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype; v_report public.floor_remnant_reports%rowtype; v_piece public.floor_remnant_report_pieces%rowtype; v_ids uuid[]; v_id uuid; i int;
begin
  select * into v_actor from public.floor_staff_profiles where id=(select auth.uid()) and is_active and role in ('admin','warehouse');
  if v_actor.id is null then raise exception 'warehouse permission required'; end if;
  if p_decision not in ('accept','reject') then raise exception 'invalid review decision'; end if;
  select * into v_report from public.floor_remnant_reports where id=p_report_id for update;
  if v_report.id is null then raise exception 'remnant report not found'; end if;
  if v_report.status='accepted' then return true; end if;
  if p_decision='reject' then
    if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'rejection reason is required'; end if;
    update public.floor_remnant_reports set status='rejected',reviewed_by=v_actor.id,reviewed_at=now(),review_note=left(btrim(p_note),1000),updated_at=now() where id=v_report.id;
    return true;
  end if;
  for v_piece in select * from public.floor_remnant_report_pieces where report_id=v_report.id order by created_at loop
    v_ids := array[]::uuid[];
    for i in 1..v_piece.qty loop
      insert into public.remnant_stock(width_bin,length_cm,mat_type,status,source_job,note)
      values(v_piece.width_bin,v_piece.length_cm,v_piece.mat_type,'available',v_report.job_no,
        concat_ws(' · ','รับจากใบงาน FloorNow',nullif(v_piece.note,''))) returning id into v_id;
      v_ids := array_append(v_ids,v_id);
    end loop;
    update public.floor_remnant_report_pieces set stock_remnant_ids=v_ids,updated_at=now() where id=v_piece.id;
  end loop;
  update public.floor_remnant_reports set status='accepted',reviewed_by=v_actor.id,reviewed_at=now(),review_note=nullif(left(btrim(coalesce(p_note,'')),1000),''),updated_at=now() where id=v_report.id;
  return true;
end;
$$;

-- Customer signature is allowed only after the lead technician has submitted a
-- valid remnant/no-remnant report. Warehouse acceptance may happen afterwards.
create or replace function public.record_technician_customer_signature(
  p_token uuid,p_pin text,p_assignment_id uuid,p_customer_name text,p_signature_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_assignment public.appointment_technicians%rowtype; v_latest text;
begin
  if nullif(btrim(coalesce(p_customer_name,'')),'') is null or nullif(btrim(coalesce(p_signature_path,'')),'') is null then raise exception 'customer name and signature are required'; end if;
  select a.* into v_assignment from public.appointment_technicians a join public.floor_technicians t on t.id=a.technician_id
  where a.id=p_assignment_id and a.is_active and t.is_active and t.personal_token=p_token and t.pin_hash is not null
    and extensions.crypt(regexp_replace(coalesce(p_pin,''),'\s+','','g'),t.pin_hash)=t.pin_hash;
  if v_assignment.id is null then raise exception 'assignment not found'; end if;
  if not v_assignment.is_lead then raise exception 'lead technician permission required'; end if;
  select status into v_latest from public.floor_work_progress_events where assignment_id=v_assignment.id order by occurred_at desc limit 1;
  if v_latest <> 'completed' then raise exception 'complete installation before customer signature'; end if;
  if not exists (select 1 from public.floor_remnant_reports r where r.appointment_id=v_assignment.appointment_id and r.status in ('pending_review','accepted')) then
    raise exception 'remnant report is required before customer signature';
  end if;
  insert into public.floor_work_progress_events(appointment_id,assignment_id,technician_id,status,customer_signed_name,customer_signature_path)
  values(v_assignment.appointment_id,v_assignment.id,v_assignment.technician_id,'customer_signed',left(btrim(p_customer_name),200),p_signature_path);
  return true;
end;
$$;

revoke all on function public.get_technician_remnant_report(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.save_technician_remnant_report(uuid,text,uuid,boolean,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.list_remnant_reports_staff() from public,anon,authenticated;
revoke all on function public.review_remnant_report_staff(uuid,text,text) from public,anon,authenticated;
revoke all on function public.record_technician_customer_signature(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_technician_remnant_report(uuid,text,uuid) to anon,authenticated;
grant execute on function public.save_technician_remnant_report(uuid,text,uuid,boolean,jsonb,jsonb,text) to anon,authenticated;
grant execute on function public.list_remnant_reports_staff() to authenticated;
grant execute on function public.review_remnant_report_staff(uuid,text,text) to authenticated;
grant execute on function public.record_technician_customer_signature(uuid,text,uuid,text,text) to anon,authenticated;

notify pgrst, 'reload schema';

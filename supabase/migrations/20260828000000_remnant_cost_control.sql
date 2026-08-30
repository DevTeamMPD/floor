-- Remnant cost control: preserve each accepted remnant's value through reuse or disposal.

alter table public.remnant_stock
  add column if not exists unit_cost_per_sqm numeric(12,2) not null default 0 check (unit_cost_per_sqm >= 0),
  add column if not exists received_report_id uuid references public.floor_remnant_reports(id) on delete set null,
  add column if not exists used_for_job text references public.install_jobs(job_no) on delete set null,
  add column if not exists used_at timestamptz,
  add column if not exists disposed_at timestamptz,
  add column if not exists disposal_reason text;

alter table public.remnant_stock drop constraint if exists remnant_stock_status_check;
alter table public.remnant_stock add constraint remnant_stock_status_check
  check (status in ('available','reserved','used','disposed'));

create or replace function public.remnant_stock_estimated_cost(p_width_cm numeric, p_length_cm numeric, p_cost_per_sqm numeric)
returns numeric language sql immutable set search_path = public
as $$ select round((p_width_cm * p_length_cm / 10000) * p_cost_per_sqm, 2) $$;

create table if not exists public.floor_remnant_cost_rates (
  mat_type text primary key check (mat_type in ('16B','16W','6B','6W')),
  cost_per_sqm numeric(12,2) not null default 0 check (cost_per_sqm >= 0),
  updated_by uuid references public.floor_staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.floor_remnant_cost_rates(mat_type,cost_per_sqm)
values ('16B',0),('16W',0),('6B',0),('6W',0)
on conflict (mat_type) do nothing;

create table if not exists public.floor_remnant_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  remnant_id uuid not null references public.remnant_stock(id) on delete restrict,
  event_type text not null check (event_type in ('received','used','disposed','adjusted')),
  job_no text references public.install_jobs(job_no) on delete set null,
  area_sqm numeric(12,4) not null check (area_sqm >= 0),
  value_amount numeric(12,2) not null check (value_amount >= 0),
  note text,
  actor_staff_id uuid references public.floor_staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists floor_remnant_cost_ledger_remnant_idx on public.floor_remnant_cost_ledger(remnant_id, created_at desc);
create index if not exists floor_remnant_cost_ledger_job_idx on public.floor_remnant_cost_ledger(job_no, created_at desc);

alter table public.floor_remnant_cost_rates enable row level security;
alter table public.floor_remnant_cost_ledger enable row level security;
revoke all on public.floor_remnant_cost_rates from anon, authenticated;
revoke all on public.floor_remnant_cost_ledger from anon, authenticated;

create or replace function public.remnant_cost_actor()
returns public.floor_staff_profiles language sql stable security definer set search_path = public
as $$
  select p from public.floor_staff_profiles p
  where p.id=(select auth.uid()) and p.is_active and p.role in ('admin','warehouse')
$$;

create or replace function public.set_remnant_cost_rate(p_mat_type text, p_cost_per_sqm numeric)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype;
begin
  select * into v_actor from public.remnant_cost_actor();
  if v_actor.id is null then raise exception 'warehouse permission required'; end if;
  if p_mat_type not in ('16B','16W','6B','6W') or coalesce(p_cost_per_sqm,-1) < 0 then raise exception 'invalid remnant cost rate'; end if;
  insert into public.floor_remnant_cost_rates(mat_type,cost_per_sqm,updated_by,updated_at)
  values(p_mat_type,round(p_cost_per_sqm,2),v_actor.id,now())
  on conflict(mat_type) do update set cost_per_sqm=excluded.cost_per_sqm,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return true;
end;
$$;

create or replace function public.mark_remnant_used_with_cost(p_remnant_id uuid, p_job_no text default null)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype; v_stock public.remnant_stock%rowtype; v_job text;
begin
  select * into v_actor from public.remnant_cost_actor();
  if v_actor.id is null then raise exception 'warehouse permission required'; end if;
  select * into v_stock from public.remnant_stock where id=p_remnant_id for update;
  if v_stock.id is null then raise exception 'remnant not found'; end if;
  if v_stock.status not in ('available','reserved') then raise exception 'only available or reserved remnant can be used'; end if;
  v_job := nullif(btrim(coalesce(p_job_no,'')), '');
  if v_job is not null and not exists(select 1 from public.install_jobs where job_no=v_job) then raise exception 'destination job not found'; end if;
  update public.remnant_stock set status='used',used_for_job=coalesce(v_job,reserved_for),used_at=now(),updated_at=now() where id=v_stock.id;
  insert into public.floor_remnant_cost_ledger(remnant_id,event_type,job_no,area_sqm,value_amount,note,actor_staff_id)
  values(v_stock.id,'used',coalesce(v_job,v_stock.reserved_for),v_stock.width_bin::numeric*v_stock.length_cm/10000,
    public.remnant_stock_estimated_cost(v_stock.width_bin,v_stock.length_cm,v_stock.unit_cost_per_sqm),'นำเศษกลับใช้',v_actor.id);
  return true;
end;
$$;

create or replace function public.dispose_remnant_with_cost(p_remnant_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype; v_stock public.remnant_stock%rowtype;
begin
  select * into v_actor from public.remnant_cost_actor();
  if v_actor.id is null then raise exception 'warehouse permission required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'disposal reason is required'; end if;
  select * into v_stock from public.remnant_stock where id=p_remnant_id for update;
  if v_stock.id is null then raise exception 'remnant not found'; end if;
  if v_stock.status not in ('available','reserved') then raise exception 'only available or reserved remnant can be disposed'; end if;
  update public.remnant_stock set status='disposed',disposed_at=now(),disposal_reason=left(btrim(p_reason),500),updated_at=now() where id=v_stock.id;
  insert into public.floor_remnant_cost_ledger(remnant_id,event_type,area_sqm,value_amount,note,actor_staff_id)
  values(v_stock.id,'disposed',v_stock.width_bin::numeric*v_stock.length_cm/10000,
    public.remnant_stock_estimated_cost(v_stock.width_bin,v_stock.length_cm,v_stock.unit_cost_per_sqm),left(btrim(p_reason),500),v_actor.id);
  return true;
end;
$$;

create or replace function public.create_manual_remnant_with_cost(
  p_width_bin smallint, p_length_cm numeric, p_mat_type text, p_source_job text default null, p_note text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype; v_rate numeric; v_id uuid; v_job text;
begin
  select * into v_actor from public.remnant_cost_actor();
  if v_actor.id is null then raise exception 'warehouse permission required'; end if;
  if p_width_bin not in (30,40,50,60,70,80,90,110,140) or coalesce(p_length_cm,0) <= 0 or p_mat_type not in ('16B','16W','6B','6W') then raise exception 'invalid remnant'; end if;
  v_job := nullif(btrim(coalesce(p_source_job,'')), '');
  if v_job is not null and not exists(select 1 from public.install_jobs where job_no=v_job) then raise exception 'source job not found'; end if;
  select cost_per_sqm into v_rate from public.floor_remnant_cost_rates where mat_type=p_mat_type;
  v_rate := coalesce(v_rate,0);
  insert into public.remnant_stock(width_bin,length_cm,mat_type,status,source_job,note,unit_cost_per_sqm)
  values(p_width_bin,p_length_cm,p_mat_type,'available',v_job,nullif(left(btrim(coalesce(p_note,'')),500),''),v_rate) returning id into v_id;
  insert into public.floor_remnant_cost_ledger(remnant_id,event_type,job_no,area_sqm,value_amount,note,actor_staff_id)
  values(v_id,'received',v_job,p_width_bin::numeric*p_length_cm/10000,public.remnant_stock_estimated_cost(p_width_bin,p_length_cm,v_rate),'รับเศษโดยคลัง',v_actor.id);
  return v_id;
end;
$$;

-- Preserve staff review semantics but price every accepted piece at the rate active on acceptance.
create or replace function public.review_remnant_report_staff(p_report_id uuid,p_decision text,p_note text default null)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_actor public.floor_staff_profiles%rowtype; v_report public.floor_remnant_reports%rowtype; v_piece public.floor_remnant_report_pieces%rowtype; v_ids uuid[]; v_id uuid; v_rate numeric; i int;
begin
  select * into v_actor from public.remnant_cost_actor();
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
    select cost_per_sqm into v_rate from public.floor_remnant_cost_rates where mat_type=v_piece.mat_type;
    v_rate := coalesce(v_rate,0); v_ids := array[]::uuid[];
    for i in 1..v_piece.qty loop
      insert into public.remnant_stock(width_bin,length_cm,mat_type,status,source_job,note,unit_cost_per_sqm,received_report_id)
      values(v_piece.width_bin,v_piece.length_cm,v_piece.mat_type,'available',v_report.job_no,
        concat_ws(' · ','รับจากใบงาน FloorNow',nullif(v_piece.note,'')),v_rate,v_report.id) returning id into v_id;
      insert into public.floor_remnant_cost_ledger(remnant_id,event_type,job_no,area_sqm,value_amount,note,actor_staff_id)
      values(v_id,'received',v_report.job_no,v_piece.width_bin::numeric*v_piece.length_cm/10000,
        public.remnant_stock_estimated_cost(v_piece.width_bin,v_piece.length_cm,v_rate),'ตรวจรับเข้าคลังเศษ',v_actor.id);
      v_ids := array_append(v_ids,v_id);
    end loop;
    update public.floor_remnant_report_pieces set stock_remnant_ids=v_ids,updated_at=now() where id=v_piece.id;
  end loop;
  update public.floor_remnant_reports set status='accepted',reviewed_by=v_actor.id,reviewed_at=now(),review_note=nullif(left(btrim(coalesce(p_note,'')),1000),''),updated_at=now() where id=v_report.id;
  return true;
end;
$$;

create or replace function public.get_remnant_cost_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists(select 1 from public.remnant_cost_actor()) then raise exception 'warehouse permission required'; end if;
  return jsonb_build_object(
    'rates',coalesce((select jsonb_agg(jsonb_build_object('matType',mat_type,'costPerSqm',cost_per_sqm) order by mat_type) from public.floor_remnant_cost_rates),'[]'::jsonb),
    'summary',jsonb_build_object(
      'availableValue',coalesce((select sum(public.remnant_stock_estimated_cost(width_bin,length_cm,unit_cost_per_sqm)) from public.remnant_stock where status='available'),0),
      'reservedValue',coalesce((select sum(public.remnant_stock_estimated_cost(width_bin,length_cm,unit_cost_per_sqm)) from public.remnant_stock where status='reserved'),0),
      'reusedValue',coalesce((select sum(value_amount) from public.floor_remnant_cost_ledger where event_type='used'),0),
      'disposedValue',coalesce((select sum(value_amount) from public.floor_remnant_cost_ledger where event_type='disposed'),0)
    )
  );
end;
$$;

revoke all on function public.remnant_cost_actor() from public,anon,authenticated;
revoke all on function public.set_remnant_cost_rate(text,numeric) from public,anon,authenticated;
revoke all on function public.mark_remnant_used_with_cost(uuid,text) from public,anon,authenticated;
revoke all on function public.dispose_remnant_with_cost(uuid,text) from public,anon,authenticated;
revoke all on function public.create_manual_remnant_with_cost(smallint,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.review_remnant_report_staff(uuid,text,text) from public,anon,authenticated;
revoke all on function public.get_remnant_cost_dashboard() from public,anon,authenticated;
grant execute on function public.set_remnant_cost_rate(text,numeric) to authenticated;
grant execute on function public.mark_remnant_used_with_cost(uuid,text) to authenticated;
grant execute on function public.dispose_remnant_with_cost(uuid,text) to authenticated;
grant execute on function public.create_manual_remnant_with_cost(smallint,numeric,text,text,text) to authenticated;
grant execute on function public.review_remnant_report_staff(uuid,text,text) to authenticated;
grant execute on function public.get_remnant_cost_dashboard() to authenticated;

notify pgrst, 'reload schema';

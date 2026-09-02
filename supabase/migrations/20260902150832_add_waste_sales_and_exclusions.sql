-- Waste-cost sales linkage and reversible exclusions.
--
-- Sales lookup rules:
--   1. Match the normalized Floor bill reference to sales_transaction.bill_no.
--   2. Only when no bill match exists, fall back to sales_transaction.order_no.
--
-- Exclusions do not delete or mutate the job. They only remove it from the
-- waste-cost analysis and can be reversed by deleting the exclusion row.

create table if not exists public.floor_waste_analysis_exclusions (
  job_no text primary key references public.install_jobs(job_no) on delete cascade,
  reason text not null default 'ไม่ต้องการนำมาวิเคราะห์',
  excluded_by uuid default auth.uid() references auth.users(id) on delete set null,
  excluded_at timestamptz not null default now(),
  constraint floor_waste_analysis_exclusions_reason_length
    check (char_length(btrim(reason)) between 1 and 500)
);

comment on table public.floor_waste_analysis_exclusions is
  'Reversible list of jobs intentionally excluded from waste-cost analysis.';
comment on column public.floor_waste_analysis_exclusions.reason is
  'Human-readable reason retained for audit and review.';

create index if not exists floor_waste_analysis_exclusions_excluded_at_idx
  on public.floor_waste_analysis_exclusions (excluded_at desc);

-- Initial business decision supplied with this feature request.
insert into public.floor_waste_analysis_exclusions (job_no, reason, excluded_by)
select
  job_no,
  'ผู้ใช้ระบุว่าบิล QT-20260827-002 ไม่ต้องนำมาวิเคราะห์',
  null
from public.install_jobs
where btrim(bill_no) = 'QT-20260827-002'
on conflict (job_no) do nothing;

alter table public.floor_waste_analysis_exclusions enable row level security;

revoke all on table public.floor_waste_analysis_exclusions from anon;
grant select, insert, delete on table public.floor_waste_analysis_exclusions to authenticated;

create policy floor_waste_analysis_exclusions_staff_read
  on public.floor_waste_analysis_exclusions
  for select
  to authenticated
  using ((select public.is_floor_staff_active()));

create policy floor_waste_analysis_exclusions_admin_warehouse_insert
  on public.floor_waste_analysis_exclusions
  for insert
  to authenticated
  with check (
    (select public.floor_staff_has_role(array['admin', 'warehouse']))
    and excluded_by = (select auth.uid())
  );

create policy floor_waste_analysis_exclusions_admin_warehouse_delete
  on public.floor_waste_analysis_exclusions
  for delete
  to authenticated
  using ((select public.floor_staff_has_role(array['admin', 'warehouse'])));

-- The order reference already has a normalized expression index. Add the
-- equivalent bill index so both lookup branches avoid scanning 250k+ rows.
create index if not exists ix_sales_transaction_bill_no_btrim
  on public.sales_transaction (btrim(bill_no))
  where nullif(btrim(bill_no), '') is not null;

create or replace function public.get_floor_waste_sales_summaries(p_bill_refs text[])
returns table (
  bill_ref text,
  matched_via text,
  sales_amount numeric,
  net_amount numeric,
  shipping_cost numeric,
  transaction_lines bigint,
  source_bill_nos text[],
  source_order_nos text[],
  order_statuses text[],
  latest_txn_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  with requested as (
    select distinct btrim(value) as bill_ref
    from unnest(coalesce(p_bill_refs, array[]::text[])) as refs(value)
    where nullif(btrim(value), '') is not null
  ),
  bill_matches as (
    select
      btrim(st.bill_no) as bill_ref,
      sum(coalesce(st.sell_price, st.amount, 0)) as sales_amount,
      sum(coalesce(st.amount, st.sell_price, 0)) as net_amount,
      max(coalesce(st.shipping_cost, 0)) as shipping_cost,
      count(*)::bigint as transaction_lines,
      array_agg(distinct st.bill_no order by st.bill_no) as source_bill_nos,
      array_agg(distinct st.order_no order by st.order_no)
        filter (where st.order_no is not null) as source_order_nos,
      array_agg(distinct st.order_status order by st.order_status)
        filter (where st.order_status is not null) as order_statuses,
      max(st.txn_date) as latest_txn_date
    from public.sales_transaction st
    join requested r on r.bill_ref = btrim(st.bill_no)
    group by btrim(st.bill_no)
  ),
  order_matches as (
    select
      btrim(st.order_no) as bill_ref,
      sum(coalesce(st.sell_price, st.amount, 0)) as sales_amount,
      sum(coalesce(st.amount, st.sell_price, 0)) as net_amount,
      max(coalesce(st.shipping_cost, 0)) as shipping_cost,
      count(*)::bigint as transaction_lines,
      array_agg(distinct st.bill_no order by st.bill_no)
        filter (where st.bill_no is not null) as source_bill_nos,
      array_agg(distinct st.order_no order by st.order_no) as source_order_nos,
      array_agg(distinct st.order_status order by st.order_status)
        filter (where st.order_status is not null) as order_statuses,
      max(st.txn_date) as latest_txn_date
    from public.sales_transaction st
    join requested r on r.bill_ref = btrim(st.order_no)
    group by btrim(st.order_no)
  )
  select
    r.bill_ref,
    case
      when bm.bill_ref is not null then 'bill_no'
      when om.bill_ref is not null then 'order_no'
      else 'not_found'
    end as matched_via,
    coalesce(bm.sales_amount, om.sales_amount),
    coalesce(bm.net_amount, om.net_amount),
    coalesce(bm.shipping_cost, om.shipping_cost),
    coalesce(bm.transaction_lines, om.transaction_lines, 0),
    coalesce(bm.source_bill_nos, om.source_bill_nos, array[]::text[]),
    coalesce(bm.source_order_nos, om.source_order_nos, array[]::text[]),
    coalesce(bm.order_statuses, om.order_statuses, array[]::text[]),
    coalesce(bm.latest_txn_date, om.latest_txn_date)
  from requested r
  left join bill_matches bm using (bill_ref)
  left join order_matches om using (bill_ref)
  order by r.bill_ref;
$$;

comment on function public.get_floor_waste_sales_summaries(text[]) is
  'Returns one sales summary per normalized Floor bill reference; bill_no match takes precedence over order_no fallback.';

revoke all on function public.get_floor_waste_sales_summaries(text[]) from public, anon;
grant execute on function public.get_floor_waste_sales_summaries(text[]) to authenticated;

-- Reconcile returns made from the legacy appointments screen before Flow V3.
-- install_jobs is the evidence of the user's completed return action; V3 work orders
-- must reflect the same state so the job leaves the head-technician decision inbox.

with legacy_returns as (
  select distinct on (wo.id)
    wo.id as work_order_id,
    wo.status as from_status,
    j.job_no,
    j.source,
    j.status as job_status,
    coalesce(nullif(btrim(j.flag_note), ''), 'ส่งกลับแก้ไขจากหน้าตารางนัดหมายเดิม') as reason
  from public.floor_work_orders wo
  join public.appointments a on a.id = wo.appointment_id
  join public.install_jobs j on j.job_no = a.job_id
  where wo.status = 'head_review'
    and j.status in ('ส่งกลับฝ่ายขายแก้ไข', 'ส่งกลับ BBPS แก้ไข')
  order by wo.id, wo.updated_at desc
), normalized_jobs as (
  update public.install_jobs j
  set status = case when r.source = 'bbps' then 'ส่งกลับ BBPS แก้ไข' else 'ส่งกลับฝ่ายขายแก้ไข' end,
      waiting_on = case when r.source = 'bbps' then 'BBPS' else 'ฝ่ายขาย' end,
      waiting_since = coalesce(j.waiting_since, now()),
      updated_at = now()
  from legacy_returns r
  where j.job_no = r.job_no
  returning j.job_no
), updated as (
  update public.floor_work_orders wo
  set status = 'returned_sales',
      returned_reason = r.reason,
      returned_at = coalesce(wo.returned_at, now()),
      updated_at = now()
  from legacy_returns r
  where wo.id = r.work_order_id
  returning wo.id, r.from_status, r.reason
)
insert into public.floor_work_order_events(
  work_order_id, event_type, from_status, to_status, actor_name, note
)
select id, 'returned_for_correction', from_status, 'returned_sales',
       'FloorNow migration', reason
from updated;

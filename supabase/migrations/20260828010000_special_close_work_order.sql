-- Exceptional close control: only the named, active staff account may use it.
-- This remains server-side enforced; hiding/showing the UI is not relied on for access.
create or replace function public.close_floor_work_order_special(
  p_work_order_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.floor_work_orders%rowtype;
  v_actor public.floor_staff_profiles%rowtype;
  v_reason text;
begin
  select * into v_actor
  from public.floor_staff_profiles
  where id = (select auth.uid())
    and is_active
    and lower(email) = 'supakrit.k@mpdgroup.co';

  if v_actor.id is null then
    raise exception 'special work closure permission required';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'closure reason is required';
  end if;

  select * into v_order
  from public.floor_work_orders
  where id = p_work_order_id
    and status not in ('closed', 'cancelled')
  for update;

  if v_order.id is null then
    raise exception 'work order is already closed, cancelled, or unavailable';
  end if;

  update public.floor_work_orders
  set status = 'closed', closed_at = now(), updated_at = now()
  where id = v_order.id;

  update public.install_jobs
  set stage = 6,
      status = 'เสร็จสิ้น',
      waiting_on = 'ไม่ได้ค้าง',
      waiting_since = null,
      closed_at = coalesce(closed_at, now()),
      flag_note = left(v_reason, 1000),
      updated_at = now()
  where job_no = v_order.job_no;

  insert into public.floor_work_order_events(
    work_order_id, event_type, from_status, to_status,
    actor_staff_id, actor_name, note
  ) values (
    v_order.id, 'special_closed', v_order.status, 'closed',
    v_actor.id, v_actor.full_name, left(v_reason, 1000)
  );

  return true;
end;
$$;

revoke all on function public.close_floor_work_order_special(uuid, text) from public, anon, authenticated;
grant execute on function public.close_floor_work_order_special(uuid, text) to authenticated;

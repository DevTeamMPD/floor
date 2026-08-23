-- UAT tickets may be exercised before their scheduled date.
-- Production jobs keep the scheduled-date protection.

create or replace function public.sync_floor_work_order_from_progress_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.floor_work_orders%rowtype;
  v_assignment public.appointment_technicians%rowtype;
  v_name text;
  v_slot_start timestamptz;
  v_is_test_ticket boolean;
begin
  select * into v_order
  from public.floor_work_orders
  where appointment_id = new.appointment_id
  for update;

  if v_order.id is null then return new; end if;

  select * into v_assignment
  from public.appointment_technicians
  where id = new.assignment_id;

  select name into v_name
  from public.floor_technicians
  where id = new.technician_id;

  v_is_test_ticket := coalesce(v_order.job_no, '') ~* '^TEST-';

  if new.status = 'travelling' and v_order.status = 'ready_to_install' then
    if not v_assignment.is_lead then
      raise exception 'ยังเริ่มงานไม่ได้: หัวหน้าช่างที่ได้รับมอบหมายต้องกดรับงานติดตั้งก่อน';
    end if;

    select slot_start into v_slot_start
    from public.appointments
    where id = v_order.appointment_id;

    if not v_is_test_ticket
      and timezone('Asia/Bangkok', now())::date < timezone('Asia/Bangkok', v_slot_start)::date then
      raise exception 'ยังเริ่มงานไม่ได้: งานจริงเริ่มได้เฉพาะวันนัดติดตั้ง วันที่ % หากวันนัดไม่ถูกต้อง กรุณาให้หัวหน้าช่างแก้ไขตารางงาน',
        to_char(timezone('Asia/Bangkok', v_slot_start), 'DD/MM/YYYY');
    end if;

    update public.floor_work_orders
    set status = 'installing',
        installation_lead_assignment_id = new.assignment_id,
        installation_accepted_at = now(),
        updated_at = now()
    where id = v_order.id;

    update public.install_jobs
    set status = 'กำลังติดตั้ง',
        waiting_on = v_name,
        waiting_since = now(),
        updated_at = now()
    where job_no = v_order.job_no;

    insert into public.floor_work_order_events(
      work_order_id, event_type, from_status, to_status,
      actor_technician_id, actor_name, note, photo_paths, metadata
    ) values (
      v_order.id, 'installation_accepted', 'ready_to_install', 'installing',
      new.technician_id, coalesce(v_name, 'หัวหน้าทีมช่าง'), new.note, new.photo_paths,
      jsonb_build_object('pickedSheetCount', new.picked_sheet_count, 'testMode', v_is_test_ticket)
    );
  elsif new.status in ('arrived', 'installing', 'completed') then
    insert into public.floor_work_order_events(
      work_order_id, event_type, from_status, to_status,
      actor_technician_id, actor_name, note, photo_paths
    ) values (
      v_order.id, 'field_' || new.status, v_order.status, v_order.status,
      new.technician_id, coalesce(v_name, 'ช่าง'), new.note, new.photo_paths
    );
  elsif new.status = 'customer_signed' then
    if v_order.status <> 'installing' then
      raise exception 'ยังให้ลูกค้าเซ็นไม่ได้: ต้องเริ่มงานติดตั้งก่อน';
    end if;

    update public.floor_work_orders
    set status = 'waiting_cs', waiting_cs_at = now(), updated_at = now()
    where id = v_order.id;

    update public.appointments
    set status = 'completed'
    where id = v_order.appointment_id;

    update public.install_jobs
    set stage = greatest(stage, 5), status = 'รอ CS โทรประเมิน',
        waiting_on = 'CS', waiting_since = now(), updated_at = now()
    where job_no = v_order.job_no;

    insert into public.floor_work_order_events(
      work_order_id, event_type, from_status, to_status,
      actor_technician_id, actor_name, note, photo_paths, metadata
    ) values (
      v_order.id, 'customer_signed', 'installing', 'waiting_cs',
      new.technician_id, coalesce(v_name, 'ช่าง'), new.note, new.photo_paths,
      jsonb_build_object('customerName', new.customer_signed_name, 'signaturePath', new.customer_signature_path)
    );
  end if;

  return new;
end;
$$;

comment on function public.sync_floor_work_order_from_progress_v2() is
  'Sync field progress to the central work order. TEST-* jobs may start before the scheduled date for UAT.';

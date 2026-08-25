-- Allow every active FloorNow employee to book and amend installation slots.
-- Cancellation stays restricted to admin/sales under the existing delete policy.
-- This changes FloorNow-owned RLS only; HR Master remains read-only.

drop policy if exists install_jobs_sales_insert on public.install_jobs;
create policy install_jobs_active_staff_insert on public.install_jobs
  for insert to authenticated
  with check ((select public.is_floor_staff_active()));

drop policy if exists install_jobs_staff_update on public.install_jobs;
create policy install_jobs_active_staff_update on public.install_jobs
  for update to authenticated
  using ((select public.is_floor_staff_active()))
  with check ((select public.is_floor_staff_active()));

drop policy if exists appointments_operational_insert on public.appointments;
create policy appointments_active_staff_insert on public.appointments
  for insert to authenticated
  with check ((select public.is_floor_staff_active()));

drop policy if exists appointments_operational_update on public.appointments;
create policy appointments_active_staff_update on public.appointments
  for update to authenticated
  using ((select public.is_floor_staff_active()))
  with check ((select public.is_floor_staff_active()));

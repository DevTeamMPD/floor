-- Remove legacy open-table policies only after the notification/RPC release is deployed.
drop policy if exists install_jobs_anon on public.install_jobs;
drop policy if exists install_jobs_rw on public.install_jobs;
drop policy if exists appointments_anon on public.appointments;
drop policy if exists authenticated_all on public.appointments;
drop policy if exists tech_teams_anon_all on public.tech_teams;
drop policy if exists tech_teams_auth_all on public.tech_teams;
drop policy if exists authenticated_all on public.tech_teams;
drop policy if exists job_activity_anon on public.job_activity;
drop policy if exists job_activity_rw on public.job_activity;
drop policy if exists dispatch_notes_anon_all on public.dispatch_notes;
drop policy if exists dispatch_notes_auth_all on public.dispatch_notes;
drop policy if exists floor_technicians_anon_select on public.floor_technicians;
drop policy if exists floor_technicians_anon_insert on public.floor_technicians;
drop policy if exists floor_technicians_anon_update on public.floor_technicians;
drop policy if exists floor_technicians_auth_all on public.floor_technicians;
drop policy if exists appointment_technicians_anon_select on public.appointment_technicians;
drop policy if exists appointment_technicians_anon_insert on public.appointment_technicians;
drop policy if exists appointment_technicians_anon_update on public.appointment_technicians;
drop policy if exists appointment_technicians_auth_all on public.appointment_technicians;
drop policy if exists technician_work_events_auth_all on public.technician_work_events;

revoke all on public.install_jobs, public.appointments, public.tech_teams,
  public.job_activity, public.dispatch_notes, public.floor_technicians,
  public.appointment_technicians, public.technician_work_events from anon;

grant select, insert, update, delete on public.install_jobs to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.tech_teams to authenticated;
grant select, insert on public.job_activity to authenticated;
grant select, insert, update, delete on public.dispatch_notes to authenticated;
grant select, insert, update, delete on public.floor_technicians to authenticated;
grant select, insert, update, delete on public.appointment_technicians to authenticated;
grant select on public.technician_work_events to authenticated;

create policy install_jobs_staff_read on public.install_jobs for select to authenticated using (public.is_floor_staff_active());
create policy install_jobs_sales_insert on public.install_jobs for insert to authenticated with check (public.floor_staff_has_role(array['admin','sales']));
create policy install_jobs_staff_update on public.install_jobs for update to authenticated using (public.floor_staff_has_role(array['admin','sales','head_technician','warehouse','cs'])) with check (public.floor_staff_has_role(array['admin','sales','head_technician','warehouse','cs']));
create policy install_jobs_admin_delete on public.install_jobs for delete to authenticated using (public.floor_staff_has_role(array['admin']));

create policy appointments_staff_read on public.appointments for select to authenticated using (public.is_floor_staff_active());
create policy appointments_operational_insert on public.appointments for insert to authenticated with check (public.floor_staff_has_role(array['admin','sales','head_technician']));
create policy appointments_operational_update on public.appointments for update to authenticated using (public.floor_staff_has_role(array['admin','sales','head_technician'])) with check (public.floor_staff_has_role(array['admin','sales','head_technician']));
create policy appointments_admin_delete on public.appointments for delete to authenticated using (public.floor_staff_has_role(array['admin']));

create policy tech_teams_staff_read on public.tech_teams for select to authenticated using (public.is_floor_staff_active());
create policy tech_teams_head_manage on public.tech_teams for all to authenticated using (public.floor_staff_has_role(array['admin','head_technician'])) with check (public.floor_staff_has_role(array['admin','head_technician']));
create policy job_activity_staff_read on public.job_activity for select to authenticated using (public.is_floor_staff_active());
create policy job_activity_staff_insert on public.job_activity for insert to authenticated with check (public.is_floor_staff_active());
create policy dispatch_notes_staff_read on public.dispatch_notes for select to authenticated using (public.is_floor_staff_active());
create policy dispatch_notes_head_manage on public.dispatch_notes for all to authenticated using (public.floor_staff_has_role(array['admin','head_technician'])) with check (public.floor_staff_has_role(array['admin','head_technician']));
create policy floor_technicians_staff_read on public.floor_technicians for select to authenticated using (public.is_floor_staff_active());
create policy floor_technicians_head_manage on public.floor_technicians for all to authenticated using (public.floor_staff_has_role(array['admin','head_technician'])) with check (public.floor_staff_has_role(array['admin','head_technician']));
create policy appointment_technicians_staff_read on public.appointment_technicians for select to authenticated using (public.is_floor_staff_active());
create policy appointment_technicians_head_manage on public.appointment_technicians for all to authenticated using (public.floor_staff_has_role(array['admin','head_technician'])) with check (public.floor_staff_has_role(array['admin','head_technician']));
create policy technician_work_events_head_read on public.technician_work_events for select to authenticated using (public.floor_staff_has_role(array['admin','head_technician']));

notify pgrst, 'reload schema';

-- The project has default function privileges for anon. Remove them explicitly
-- from every employee/mobile RPC; retain anon only for the customer-safe RPC.

revoke all on function public.register_floor_technician_device(uuid, text, text, text) from public, anon;
revoke all on function public.update_floor_device_permission(uuid, text, text) from public, anon;
revoke all on function public.get_floor_mobile_workspace(uuid) from public, anon;
revoke all on function public.set_floor_job_material_plan(uuid, integer, text) from public, anon;
revoke all on function public.start_floor_tracking(uuid, uuid, integer, double precision, double precision, text[]) from public, anon;
revoke all on function public.record_floor_location_batch(uuid, uuid, jsonb) from public, anon;
revoke all on function public.record_floor_job_status(uuid, uuid, text, text[], text) from public, anon;
revoke all on function public.record_floor_customer_signature(uuid, uuid, text, text) from public, anon;
revoke all on function public.set_floor_tracking_eta(uuid, uuid, integer, integer) from public, anon;

grant execute on function public.register_floor_technician_device(uuid, text, text, text) to authenticated;
grant execute on function public.update_floor_device_permission(uuid, text, text) to authenticated;
grant execute on function public.get_floor_mobile_workspace(uuid) to authenticated;
grant execute on function public.set_floor_job_material_plan(uuid, integer, text) to authenticated;
grant execute on function public.start_floor_tracking(uuid, uuid, integer, double precision, double precision, text[]) to authenticated;
grant execute on function public.record_floor_location_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.record_floor_job_status(uuid, uuid, text, text[], text) to authenticated;
grant execute on function public.record_floor_customer_signature(uuid, uuid, text, text) to authenticated;
grant execute on function public.set_floor_tracking_eta(uuid, uuid, integer, integer) to authenticated;

revoke all on function public.get_floor_customer_tracking(uuid) from public, anon, authenticated;
grant execute on function public.get_floor_customer_tracking(uuid) to anon, authenticated;

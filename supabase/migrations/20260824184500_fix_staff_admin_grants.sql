-- RLS policies already restrict these actions to active FloorNow admins.
-- The original staff migration revoked table privileges but did not restore
-- the privileges required by the admin UI.
grant update on public.floor_staff_profiles to authenticated;
grant select on public.floor_staff_invites to authenticated;

notify pgrst, 'reload schema';

-- Realtime events for the sales scheduling board.  RLS remains the source of
-- truth for which active staff may receive rows; this only publishes changes.
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.install_jobs;
alter publication supabase_realtime add table public.tech_teams;

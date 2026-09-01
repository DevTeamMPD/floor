-- FloorNow P4 follow-up: covering indexes reported by Supabase Advisor.

begin;

create index if not exists floor_csat_automation_jobs_evaluation_idx
  on public.floor_csat_automation_jobs(evaluation_id);
create index if not exists floor_csat_automation_jobs_requested_by_idx
  on public.floor_csat_automation_jobs(requested_by)
  where requested_by is not null;
create index if not exists floor_csat_automation_jobs_result_case_idx
  on public.floor_csat_automation_jobs(result_case_id)
  where result_case_id is not null;

commit;

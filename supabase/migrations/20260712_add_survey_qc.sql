-- Sprint 4: SOP-based site survey + QC acceptance checklist
-- Run in Supabase Dashboard > SQL Editor

ALTER TABLE install_jobs
  ADD COLUMN IF NOT EXISTS survey_data TEXT,
  ADD COLUMN IF NOT EXISTS qc_data    TEXT;

COMMENT ON COLUMN install_jobs.survey_data IS
  'JSON: site survey data collected before installation '
  '(cutTypes[], weldType, finishTypes[], floorCondition, wetZone, areaSqm, notes, savedAt)';

COMMENT ON COLUMN install_jobs.qc_data IS
  'JSON: QC acceptance checklist results per SOP เกณฑ์ตรวจรับงาน 15 criteria '
  '(results: Record<id,pass|fail|na|null>, inspector, notes, savedAt)';

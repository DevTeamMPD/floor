-- Webhook receiver for BBPS CRM -> floor: work_order.queued.v1 (SYSTEM_INTEGRATION_SPEC.md v2.1, D9)
-- Run in Supabase Dashboard > SQL Editor (or applied via Supabase MCP)
--
-- Two tables/changes in this file:
--   1. inbound_events   -- audit + dedup layer 1 (UNIQUE event_id)
--   2. install_jobs_external_id_key -- dedup layer 2 (UNIQUE external_id), the
--      conflict target for the install_jobs upsert (D9: production_id, not order_no)

CREATE TABLE IF NOT EXISTS inbound_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          text NOT NULL UNIQUE,
  event_type        text,
  idempotency_key   text, -- = production.production_id per D9 (X-Idempotency-Key header)
  signature_key_id  text,
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received', 'processed', 'failed')),
  error             text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

-- RLS on, no policies: only service_role (used by the receiver) can read/write.
-- Same pattern as app_secrets / iim_updater_checkpoint per CLAUDE.md rule 5.
ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_inbound_events_status_received_at
  ON inbound_events (status, received_at);

-- D9: dedup/conflict key for install_jobs is production_id (external_id column),
-- not order_no -- a single quotation_number can legitimately belong to many
-- production_tracking_bbps rows (up to 9 seen in production data).
CREATE UNIQUE INDEX IF NOT EXISTS install_jobs_external_id_key
  ON install_jobs (external_id)
  WHERE external_id IS NOT NULL;

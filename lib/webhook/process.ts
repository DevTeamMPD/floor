import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkOrderQueuedV1 } from "./schema";

/** D2: jobs from CRM always land on stage 1 'Active' -- CS confirms the
 * appointment even when CRM already sent a date. */
const DEFAULT_STAGE = 1;
const ACTIVE_STATUS = "Active";

export interface UpsertResult {
  job_no: string;
  created: boolean;
}

/**
 * Data Mapping v2 -> install_jobs, SYSTEM_INTEGRATION_SPEC.md §5.
 *
 * Conflict target is `external_id` (= production.production_id, D9) --
 * NOT `order_no`. `order_no`/`job_no` keep their own UNIQUE constraint for
 * backward-compat with the existing floor UI, but which string they hold is
 * decided by resolveOrderNo() below, only on first insert.
 */
async function resolveOrderNo(
  supabase: SupabaseClient,
  quotationNumber: string,
  productionId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("install_jobs")
    .select("external_id")
    .eq("order_no", quotationNumber)
    .maybeSingle();

  if (error) throw error;

  // Free, or (defensively) already ours -- use the quotation number as-is.
  // Otherwise another production_id already holds this quotation_number
  // (confirmed in production: one QT-... can back up to 9 separate tickets)
  // so disambiguate with a slice of the production_id. The install_jobs
  // UNIQUE(order_no) constraint is still the final backstop against a race
  // between two concurrent inserts picking the same candidate string.
  if (!data || data.external_id === productionId) {
    return quotationNumber;
  }
  return `${quotationNumber}-${productionId.slice(0, 4)}`;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (v != null && v !== "") return v;
  }
  return null;
}

export async function upsertInstallJob(
  supabase: SupabaseClient,
  payload: WorkOrderQueuedV1
): Promise<UpsertResult> {
  const productionId = payload.production.production_id;

  const { data: existing, error: lookupError } = await supabase
    .from("install_jobs")
    .select("job_no, order_no, status")
    .eq("external_id", productionId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const firstWorkOrder = payload.work_orders[0];

  // G1: customer.phone first, falling back to the on-site contact number.
  const customerPhone = firstNonEmpty(payload.customer.phone, firstWorkOrder?.contact_phone);
  // G2: on-site address, falling back to the billing/customer address.
  const address = firstNonEmpty(firstWorkOrder?.location_address, payload.customer.address);
  const locationUrl = firstNonEmpty(firstWorkOrder?.location_map_link);
  const productName = firstNonEmpty(
    payload.quotation.line_items.map((li) => li.description).join(", ") || null
  );
  const taskName = firstNonEmpty(firstWorkOrder?.task_details);

  // G4: summary is already min(start)/max(end) across every work order on
  // the ticket (D6: 1 ticket = 1 floor job) -- computed by the CRM trigger,
  // usable as-is.
  const apptDate = payload.summary.install_start ?? null;
  const dueDate = payload.summary.install_end ?? null;

  const sharedFields: Record<string, unknown> = {
    external_id: productionId,
    customer_name: payload.customer.name ?? null,
    customer_phone: customerPhone,
    address,
    location_url: locationUrl,
    product_name: productName,
    task_name: taskName,
    appt_date: apptDate,
    due_date: dueDate,
    order_source: "bbps-crm",
    source: "bbps_webhook",
    // Full envelope for audit + everything not modeled as a column yet
    // (constraints 8-ด้าน, design/site photos, money breakdown, supplier
    // /assignee shown via raw_payload -- floor uses its own assignees[]).
    raw_payload: payload,
  };

  let jobNo: string;
  let orderNo: string;
  if (existing) {
    jobNo = existing.job_no;
    orderNo = existing.order_no;
  } else {
    orderNo = await resolveOrderNo(supabase, payload.quotation.quotation_number, productionId);
    jobNo = orderNo;
  }

  const row: Record<string, unknown> = {
    job_no: jobNo,
    order_no: orderNo,
    ...sharedFields,
  };

  if (!existing) {
    row.created_via = "auto";
    row.order_date = payload.quotation.quote_date ?? payload.event.occurred_at.slice(0, 10);
    row.stage = DEFAULT_STAGE;
    row.status = ACTIVE_STATUS;
    // `assignees` intentionally omitted: brand new row, floor hasn't
    // assigned anyone yet, DB default (if any) applies.
  } else if (existing.status === ACTIVE_STATUS) {
    // Row is still sitting untouched at the CRM's own defaults -- safe to
    // re-apply them (no-op in practice, keeps behavior explicit).
    row.stage = DEFAULT_STAGE;
    row.status = ACTIVE_STATUS;
  }
  // else: floor has already moved this job past stage 1 / away from
  // 'Active'. A duplicate or retried webhook delivery for the same
  // production_id (test case 6; real-world dispatcher retry) must not
  // snap it back. `stage` and `status` are simply omitted from `row` in
  // that branch -- Supabase/PostgREST upsert only writes columns present
  // in the payload, so the existing values are left exactly as floor set
  // them. Same reasoning is why `assignees` is never included here at all:
  // it is a floor-only field this receiver must never touch, ever.

  const { error: upsertError } = await supabase
    .from("install_jobs")
    .upsert(row, { onConflict: "external_id" });
  if (upsertError) throw upsertError;

  return { job_no: jobNo, created: !existing };
}

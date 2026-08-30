import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { DocumentItem, DocumentSourceSnapshot } from "@/lib/documents/types";

type UnknownRecord = Record<string, unknown>;

function requiredServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("document generator server environment is not configured");
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function asRecord(value: unknown): UnknownRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as UnknownRecord;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as UnknownRecord : {};
    } catch { return {}; }
  }
  return {};
}

function asText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function evidence(row: UnknownRecord | null): DocumentSourceSnapshot["evidence"]["warehouseCompletion"] {
  if (!row) return null;
  return {
    actorName: asText(row.actor_name),
    note: asText(row.note),
    photoPaths: Array.isArray(row.photo_paths) ? row.photo_paths.filter((value): value is string => typeof value === "string") : [],
    occurredAt: asText(row.occurred_at),
  };
}

function snapshotItems(rows: UnknownRecord[]): DocumentItem[] {
  return rows.map((row) => ({
    category: asText(row.category) ?? "other",
    itemName: asText(row.item_name) ?? "ไม่ระบุรายการ",
    sku: asText(row.sku),
    specification: asText(row.specification),
    plannedQty: asNumber(row.planned_qty) ?? 0,
    actualQty: asNumber(row.actual_qty),
    unit: asText(row.unit) ?? "รายการ",
    sourceType: asText(row.source_type) ?? "new",
    note: asText(row.note),
  }));
}

/**
 * Loads the smallest immutable input required to render controlled documents.
 * This function is server-only and deliberately has no write, queue, or SharePoint side effect.
 */
export async function loadWorkOrderDocumentSnapshot(jobNo: string): Promise<DocumentSourceSnapshot> {
  const normalizedJobNo = jobNo.trim();
  if (!normalizedJobNo) throw new Error("job number is required");
  const supabase = requiredServiceClient();
  const { data: workOrder, error: workOrderError } = await supabase
    .from("floor_work_orders")
    .select("id,job_no,appointment_id,status,revision,note,confirmed_at,updated_at")
    .eq("job_no", normalizedJobNo)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (workOrderError) throw new Error(`unable to load work order: ${workOrderError.message}`);
  if (!workOrder) throw new Error("work order not found");

  const [jobResult, itemResult, appointmentResult, eventResult, remnantResult, evaluationResult, ncrResult] = await Promise.all([
    supabase.from("install_jobs").select("job_no,bill_no,customer_name,customer_phone,address,location_url,product_name,survey_data").eq("job_no", normalizedJobNo).maybeSingle(),
    supabase.from("floor_work_order_items").select("category,item_name,sku,specification,planned_qty,actual_qty,unit,source_type,note,sort_order").eq("work_order_id", workOrder.id).order("sort_order"),
    supabase.from("appointments").select("id,slot_start,slot_end,tech_id").eq("id", workOrder.appointment_id).maybeSingle(),
    supabase.from("floor_work_order_events").select("event_type,actor_name,note,photo_paths,metadata,occurred_at").eq("work_order_id", workOrder.id).in("event_type", ["warehouse_completed", "field_completed", "customer_signed", "remnants_submitted", "cs_closed"]).order("occurred_at", { ascending: false }),
    supabase.from("floor_remnant_reports").select("id,status,no_remnant,notes,submitted_at").eq("job_no", normalizedJobNo).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("job_evaluations").select("id,cs_name,call_date,satisfaction_score,issues_text,needs_followup,answers,updated_at").eq("job_no", normalizedJobNo).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ncr_reports").select("id,title,type,status,severity,due_at,description,created_at").eq("job_no", normalizedJobNo).order("created_at", { ascending: false }),
  ]);
  if (jobResult.error) throw new Error(`unable to load job: ${jobResult.error.message}`);
  if (itemResult.error) throw new Error(`unable to load work order items: ${itemResult.error.message}`);
  if (appointmentResult.error) throw new Error(`unable to load appointment: ${appointmentResult.error.message}`);
  if (eventResult.error) throw new Error(`unable to load document evidence: ${eventResult.error.message}`);
  if (remnantResult.error) throw new Error(`unable to load remnant report: ${remnantResult.error.message}`);
  if (evaluationResult.error) throw new Error(`unable to load evaluation: ${evaluationResult.error.message}`);
  if (ncrResult.error) throw new Error(`unable to load NCR records: ${ncrResult.error.message}`);
  if (!jobResult.data) throw new Error("job not found");

  const appointment = appointmentResult.data as UnknownRecord | null;
  const teamResult = appointment?.tech_id
    ? await supabase.from("tech_teams").select("name").eq("id", appointment.tech_id as string).maybeSingle()
    : { data: null, error: null };
  if (teamResult.error) throw new Error(`unable to load team: ${teamResult.error.message}`);

  const job = jobResult.data as UnknownRecord;
  const survey = asRecord(job.survey_data);
  const photos = Array.isArray(survey.photos) ? survey.photos : [];
  const events = (eventResult.data ?? []) as UnknownRecord[];
  const warehouseCompletion = events.find((row) => row.event_type === "warehouse_completed") ?? null;
  const fieldCompletion = events.find((row) => row.event_type === "field_completed") ?? null;
  const customerSigned = events.find((row) => row.event_type === "customer_signed") ?? null;
  const remnantsSubmitted = events.find((row) => row.event_type === "remnants_submitted") ?? null;
  const csClosed = events.find((row) => row.event_type === "cs_closed") ?? null;
  const customerMetadata = asRecord(customerSigned?.metadata);
  const remnant = remnantResult.data as UnknownRecord | null;
  const pieceResult = remnant?.id
    ? await supabase.from("floor_remnant_report_pieces").select("width_bin,length_cm,qty,thickness,color,mat_type,note,photo_paths").eq("report_id", remnant.id as string).order("created_at")
    : { data: [], error: null };
  if (pieceResult.error) throw new Error(`unable to load remnant pieces: ${pieceResult.error.message}`);
  const evaluation = evaluationResult.data as UnknownRecord | null;
  return {
    jobNo: normalizedJobNo,
    sourceUpdatedAt: String(workOrder.updated_at),
    workOrder: { id: String(workOrder.id), status: String(workOrder.status), revision: Number(workOrder.revision ?? 1), note: asText(workOrder.note), confirmedAt: asText(workOrder.confirmed_at) },
    job: { billNo: asText(job.bill_no), customerName: asText(job.customer_name), customerPhone: asText(job.customer_phone), address: asText(job.address), locationUrl: asText(job.location_url), productName: asText(job.product_name) },
    appointment: { startsAt: asText(appointment?.slot_start), endsAt: asText(appointment?.slot_end), teamName: asText((teamResult.data as UnknownRecord | null)?.name) },
    survey: { areaSqm: asNumber(survey.areaSqm), floorCondition: asText(survey.floorCondition), wetZone: asText(survey.wetZone), notes: asText(survey.notes), photoCount: photos.length },
    evidence: {
      warehouseCompletion: evidence(warehouseCompletion),
      fieldCompletion: evidence(fieldCompletion),
      customerSigned: customerSigned ? { ...evidence(customerSigned)!, customerName: asText(customerMetadata.customerName), signaturePath: asText(customerMetadata.signaturePath) } : null,
      remnantsSubmitted: evidence(remnantsSubmitted),
      csClosed: evidence(csClosed),
    },
    remnant: remnant ? {
      status: String(remnant.status ?? "ไม่ระบุ"), noRemnant: Boolean(remnant.no_remnant), notes: asText(remnant.notes), submittedAt: asText(remnant.submitted_at),
      pieces: ((pieceResult.data ?? []) as UnknownRecord[]).map((piece) => ({ widthCm: asNumber(piece.width_bin) ?? 0, lengthCm: asNumber(piece.length_cm) ?? 0, qty: asNumber(piece.qty) ?? 0, thickness: asText(piece.thickness) ?? "", color: asText(piece.color) ?? "", materialType: asText(piece.mat_type) ?? "", note: asText(piece.note), photoCount: Array.isArray(piece.photo_paths) ? piece.photo_paths.length : 0 })),
    } : null,
    evaluation: evaluation ? { id: String(evaluation.id), csName: asText(evaluation.cs_name), callDate: asText(evaluation.call_date), satisfactionScore: asNumber(evaluation.satisfaction_score), issuesText: asText(evaluation.issues_text), needsFollowup: Boolean(evaluation.needs_followup), answers: asRecord(evaluation.answers), updatedAt: String(evaluation.updated_at) } : null,
    ncrs: ((ncrResult.data ?? []) as UnknownRecord[]).map((ncr) => ({ id: String(ncr.id), title: asText(ncr.title) ?? "NCR", type: asText(ncr.type) ?? "other", status: asText(ncr.status) ?? "open", severity: asText(ncr.severity) ?? "medium", dueAt: asText(ncr.due_at), description: asText(ncr.description), createdAt: String(ncr.created_at) })),
    items: snapshotItems((itemResult.data ?? []) as UnknownRecord[]),
  };
}

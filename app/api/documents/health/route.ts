import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentStaff } from "@/lib/staff-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("server environment is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const EVENT_DOCUMENTS: Record<string, string[]> = {
  head_confirmed: ["work_order", "boq"],
  warehouse_completed: ["pick_confirmation"],
  field_completed: ["installation_report"],
  customer_signed: ["customer_acceptance"],
  remnants_submitted: ["remnant_report"],
  cs_closed: ["handover"],
};

export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  try {
    const admin = adminClient();
    const [ordersResult, queueResult, failedResult, followupResult, evaluationResult, ncrResult] = await Promise.all([
      admin.from("floor_work_orders").select("id,job_no,status,updated_at").order("updated_at", { ascending: false }).limit(200),
      admin.from("floor_document_generation_jobs").select("status"),
      admin.from("floor_document_generation_jobs").select("id,job_no,document_type,status,attempt_count,max_attempts,last_error,updated_at").in("status", ["failed", "retrying"]).order("updated_at", { ascending: false }).limit(30),
      admin.from("floor_csat_followups").select("job_no,due_at,completed_at").is("completed_at", null).order("due_at", { ascending: true }).limit(50),
      admin.from("job_evaluations").select("job_no").not("satisfaction_score", "is", null),
      admin.from("ncr_reports").select("job_no").not("job_no", "is", null),
    ]);
    const firstError = [ordersResult, queueResult, failedResult, followupResult, evaluationResult, ncrResult].find((result) => result.error)?.error;
    if (firstError) throw firstError;
    const orders = ordersResult.data ?? [];
    const orderIds = orders.map((order) => order.id);
    const jobNos = orders.map((order) => order.job_no);
    const [eventsResult, documentsResult] = await Promise.all([
      orderIds.length ? admin.from("floor_work_order_events").select("work_order_id,event_type").in("work_order_id", orderIds) : Promise.resolve({ data: [], error: null }),
      jobNos.length ? admin.from("floor_job_documents").select("job_no,document_type,status").in("job_no", jobNos).neq("status", "archived") : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsResult.error) throw eventsResult.error;
    if (documentsResult.error) throw documentsResult.error;
    const evaluationJobs = new Set((evaluationResult.data ?? []).map((row) => row.job_no));
    const ncrJobs = new Set((ncrResult.data ?? []).map((row) => row.job_no));
    const eventsByOrder = new Map<string, Set<string>>();
    for (const event of eventsResult.data ?? []) {
      const set = eventsByOrder.get(event.work_order_id) ?? new Set<string>(); set.add(event.event_type); eventsByOrder.set(event.work_order_id, set);
    }
    const docsByJob = new Map<string, Set<string>>();
    for (const document of documentsResult.data ?? []) {
      const set = docsByJob.get(document.job_no) ?? new Set<string>(); set.add(document.document_type); docsByJob.set(document.job_no, set);
    }
    const missing = orders.flatMap((order) => {
      const required = new Set<string>();
      for (const event of eventsByOrder.get(order.id) ?? []) for (const type of EVENT_DOCUMENTS[event] ?? []) required.add(type);
      if (evaluationJobs.has(order.job_no)) required.add("csat");
      if (ncrJobs.has(order.job_no)) required.add("ncr");
      const existing = docsByJob.get(order.job_no) ?? new Set<string>();
      return [...required].filter((type) => !existing.has(type)).map((documentType) => ({ jobNo: order.job_no, workOrderStatus: order.status, documentType, updatedAt: order.updated_at }));
    }).slice(0, 100);
    const queue = Object.fromEntries(["pending", "processing", "retrying", "succeeded", "failed", "skipped_unchanged"].map((status) => [status, (queueResult.data ?? []).filter((row) => row.status === status).length]));
    return NextResponse.json({ queue, missing, failed: failedResult.data ?? [], csatDue: followupResult.data ?? [], generatedAt: new Date().toISOString() });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "โหลดสุขภาพเอกสารไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || !["admin", "head_technician"].includes(staff.role)) return NextResponse.json({ error: "ไม่มีสิทธิ์นำงานกลับเข้าคิว" }, { status: 403 });
  try {
    const payload = await request.json() as { id?: string };
    if (!payload.id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    const { data, error } = await adminClient().from("floor_document_generation_jobs").update({ status: "retrying", next_attempt_at: new Date().toISOString(), last_error: null }).eq("id", payload.id).in("status", ["failed", "retrying"]).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "ไม่พบคิวที่นำกลับมาทำใหม่ได้" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "นำงานกลับเข้าคิวไม่สำเร็จ" }, { status: 500 });
  }
}

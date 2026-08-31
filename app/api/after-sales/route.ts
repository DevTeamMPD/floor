import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CASE_STATUSES = new Set(["new", "triaging", "scheduled", "in_progress", "waiting_customer", "resolved", "closed", "reopened"]);
const CASE_SOURCES = new Set(["csat", "customer_call", "technician", "sales", "manual"]);
const CASE_CATEGORIES = new Set(["service_request", "complaint", "warranty", "installation_adjustment", "information"]);
const CASE_PRIORITIES = new Set(["urgent", "high", "normal", "low"]);

function text(value: unknown, limit: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length <= limit ? normalized : normalized.slice(0, limit);
}

function asUuid(value: unknown) {
  const normalized = text(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized) ? normalized : null;
}

export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const jobNo = text(searchParams.get("jobNo"), 120);
  const status = text(searchParams.get("status"), 40);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 200);
  const supabase = await createClient();
  let query = supabase
    .from("floor_after_sales_cases")
    .select("id,case_no,job_no,source,category,priority,status,summary,customer_impact,owner_staff_id,assigned_team,due_at,opened_at,resolved_at,closed_at,resolution,linked_ncr_id,created_at,updated_at")
    .order("due_at", { ascending: true })
    .limit(limit);
  if (jobNo) query = query.eq("job_no", jobNo);
  if (status && CASE_STATUSES.has(status)) query = query.eq("status", status);
  const { data: cases, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const caseIds = (cases ?? []).map((entry) => entry.id);
  const [{ data: events, error: eventsError }, { data: actions, error: actionsError }] = await Promise.all([
    caseIds.length ? supabase.from("floor_after_sales_events").select("id,case_id,event_type,from_status,to_status,actor_id,detail,occurred_at").in("case_id", caseIds).order("occurred_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    caseIds.length ? supabase.from("floor_after_sales_actions").select("id,case_id,title,description,acceptance_criteria,owner_staff_id,due_at,status,outcome,completed_at,completed_by,created_at,updated_at").in("case_id", caseIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventsError || actionsError) return NextResponse.json({ error: eventsError?.message ?? actionsError?.message }, { status: 500 });
  return NextResponse.json({ cases: cases ?? [], events: events ?? [], actions: actions ?? [] });
}

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const action = text(payload.action, 60);
    const supabase = await createClient();

    if (action === "create_case") {
      const jobNo = text(payload.jobNo, 120);
      const source = text(payload.source, 40);
      const category = text(payload.category, 60);
      const priority = text(payload.priority, 20);
      const summary = text(payload.summary, 500);
      const ownerStaffId = payload.ownerStaffId == null ? null : asUuid(payload.ownerStaffId);
      const dueAt = payload.dueAt == null ? null : text(payload.dueAt, 50);
      if (!jobNo || !CASE_SOURCES.has(source) || !CASE_CATEGORIES.has(category) || !CASE_PRIORITIES.has(priority) || !summary || (payload.ownerStaffId != null && !ownerStaffId)) {
        return NextResponse.json({ error: "ข้อมูลเคสไม่ครบหรือไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("create_floor_after_sales_case", {
        p_job_no: jobNo,
        p_source: source,
        p_category: category,
        p_priority: priority,
        p_summary: summary,
        p_customer_impact: text(payload.customerImpact, 3000) || null,
        p_owner_staff_id: ownerStaffId,
        p_assigned_team: text(payload.assignedTeam, 100) || null,
        p_due_at: dueAt || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ caseId: data }, { status: 201 });
    }

    if (action === "advance_case") {
      const caseId = asUuid(payload.caseId);
      const nextStatus = text(payload.nextStatus, 40);
      if (!caseId || !CASE_STATUSES.has(nextStatus)) return NextResponse.json({ error: "ข้อมูลสถานะไม่ถูกต้อง" }, { status: 400 });
      const { error } = await supabase.rpc("advance_floor_after_sales_case", { p_case_id: caseId, p_next_status: nextStatus, p_resolution: text(payload.resolution, 3000) || null });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign_case") {
      const caseId = asUuid(payload.caseId);
      const ownerStaffId = asUuid(payload.ownerStaffId);
      if (!caseId || !ownerStaffId) return NextResponse.json({ error: "ข้อมูลผู้รับผิดชอบไม่ถูกต้อง" }, { status: 400 });
      const { error } = await supabase.rpc("assign_floor_after_sales_case", { p_case_id: caseId, p_owner_staff_id: ownerStaffId, p_assigned_team: text(payload.assignedTeam, 100) || null });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (action === "add_action") {
      const caseId = asUuid(payload.caseId);
      const title = text(payload.title, 300);
      const ownerStaffId = payload.ownerStaffId == null ? null : asUuid(payload.ownerStaffId);
      if (!caseId || !title || (payload.ownerStaffId != null && !ownerStaffId)) return NextResponse.json({ error: "ข้อมูล action ไม่ครบหรือไม่ถูกต้อง" }, { status: 400 });
      const { data, error } = await supabase.rpc("add_floor_after_sales_action", {
        p_case_id: caseId,
        p_title: title,
        p_description: text(payload.description, 3000) || null,
        p_acceptance_criteria: text(payload.acceptanceCriteria, 3000) || null,
        p_owner_staff_id: ownerStaffId,
        p_due_at: text(payload.dueAt, 50) || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ actionId: data }, { status: 201 });
    }

    if (action === "complete_action") {
      const actionId = asUuid(payload.actionId);
      const outcome = text(payload.outcome, 3000);
      if (!actionId || !outcome) return NextResponse.json({ error: "ข้อมูลผลการดำเนินการไม่ครบ" }, { status: 400 });
      const { error } = await supabase.rpc("complete_floor_after_sales_action", { p_action_id: actionId, p_outcome: outcome });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "ไม่รู้จักคำสั่ง" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { evaluateCsat } from "@/lib/csat/policy";

type AutomationJob = {
  id: string;
  evaluation_id: string;
  job_no: string;
  requested_by: string | null;
  attempt_count: number;
  max_attempts: number;
};

type Evaluation = {
  id: string;
  job_no: string;
  satisfaction_score: number | null;
  issues_text: string | null;
  needs_followup: boolean;
  cs_name: string | null;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("CSAT automation environment is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function retryAt(attempt: number) {
  const minutes = Math.min(60, 2 ** Math.max(1, attempt));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function findActor(client: SupabaseClient, requestedBy: string | null) {
  if (requestedBy) {
    const { data } = await client.from("floor_staff_profiles").select("id").eq("id", requestedBy).eq("is_active", true).maybeSingle();
    if (data?.id) return data.id as string;
  }
  const { data } = await client.from("floor_staff_profiles").select("id").eq("is_active", true).in("role", ["cs", "admin"]).order("created_at").limit(1).maybeSingle();
  if (!data?.id) throw new Error("ไม่พบผู้ใช้งาน CS/Admin สำหรับเป็นเจ้าของเคสอัตโนมัติ");
  return data.id as string;
}

async function processOne(client: SupabaseClient, job: AutomationJob) {
  const attempt = job.attempt_count + 1;
  const { data: claimed } = await client.from("floor_csat_automation_jobs")
    .update({ status: "processing", attempt_count: attempt, updated_at: new Date().toISOString() })
    .eq("id", job.id).in("status", ["pending", "retrying"])
    .select("id").maybeSingle();
  if (!claimed) return "ignored" as const;

  try {
    const { data: evaluation, error: evaluationError } = await client.from("job_evaluations")
      .select("id,job_no,satisfaction_score,issues_text,needs_followup,cs_name")
      .eq("id", job.evaluation_id).single();
    if (evaluationError) throw evaluationError;
    const current = evaluation as Evaluation;
    if (evaluateCsat(current.satisfaction_score).action !== "open_case") {
      await client.from("floor_csat_automation_jobs").update({ status: "skipped", completed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return "skipped" as const;
    }

    const { data: existing } = await client.from("floor_after_sales_cases")
      .select("id").eq("source_evaluation_id", current.id).maybeSingle();
    let caseId = existing?.id as string | undefined;
    if (!caseId) {
      const actorId = await findActor(client, job.requested_by);
      const { data: created, error: createError } = await client.rpc("create_floor_after_sales_case_from_csat", {
        p_evaluation_id: current.id,
        p_actor_id: actorId,
      });
      if (createError) throw createError;
      caseId = created as string;
    }

    await client.from("floor_csat_automation_jobs").update({ status: "succeeded", result_case_id: caseId, completed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    return existing ? "duplicate" as const : "created" as const;
  } catch (cause) {
    const terminal = attempt >= job.max_attempts;
    await client.from("floor_csat_automation_jobs").update({
      status: terminal ? "failed" : "retrying",
      next_attempt_at: retryAt(attempt),
      last_error: (cause instanceof Error ? cause.message : "CSAT automation failed").slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return terminal ? "failed" as const : "retrying" as const;
  }
}

export async function processCsatAutomationJobs(limit = 25) {
  const client = adminClient();
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await client.from("floor_csat_automation_jobs").update({
    status: "retrying",
    next_attempt_at: new Date().toISOString(),
    last_error: "worker lease expired; queued for retry",
    updated_at: new Date().toISOString(),
  }).eq("status", "processing").lt("updated_at", staleBefore);
  const { data, error } = await client.from("floor_csat_automation_jobs")
    .select("id,evaluation_id,job_no,requested_by,attempt_count,max_attempts")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true }).limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw error;
  const totals: Record<string, number> = { created: 0, duplicate: 0, skipped: 0, retrying: 0, failed: 0, ignored: 0 };
  for (const row of (data ?? []) as AutomationJob[]) totals[await processOne(client, row)] += 1;
  return { processed: data?.length ?? 0, ...totals };
}

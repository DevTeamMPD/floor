import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchGoogleSurvey } from "@/lib/evaluations/google-survey";

export const dynamic = "force-dynamic";

async function runSync() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return { error: "Supabase server env missing", surveyed: 0, updated: 0 };
  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const survey = await fetchGoogleSurvey();

  // Keep the latest response for each bill. The form is the source for quality scores,
  // but it must not advance the operational stage of an installation job.
  const latestByBill = new Map<string, { overall: number; timestamp: string }>();
  for (const response of survey.responses) {
    if (!response.bill || response.overall === null) continue;
    const existing = latestByBill.get(response.bill);
    const responseTime = new Date(response.timestamp).getTime();
    const existingTime = existing ? new Date(existing.timestamp).getTime() : Number.NEGATIVE_INFINITY;
    if (!existing || !Number.isFinite(existingTime) || responseTime >= existingTime) {
      latestByBill.set(response.bill, { overall: response.overall, timestamp: response.timestamp });
    }
  }

  let updated = 0;
  for (const [bill, response] of latestByBill) {
    const { data, error } = await supabase
      .from("install_jobs")
      .update({ eval_score: response.overall, eval_sent_at: new Date().toISOString() })
      .or(`order_no.eq.${bill},bill_no.eq.${bill}`)
      .select("job_no");
    if (!error) updated += (data ?? []).length;
  }
  return { surveyed: latestByBill.size, updated, questionCount: survey.questions.length };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ...(await runSync()), at: new Date().toISOString() }); }
  catch (error) { return NextResponse.json({ error: String(error) }, { status: 500 }); }
}

export const POST = GET;

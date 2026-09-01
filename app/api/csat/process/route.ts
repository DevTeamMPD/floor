import { NextResponse } from "next/server";
import { processCsatAutomationJobs } from "@/lib/csat/automation-worker";
import { getCurrentStaff } from "@/lib/staff-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorized(request: Request) {
  const secret = process.env.CSAT_AUTOMATION_CRON_SECRET ?? process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function run() {
  try {
    return NextResponse.json(await processCsatAutomationJobs());
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "CSAT automation failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return run();
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    const staff = await getCurrentStaff();
    if (!staff || !["admin", "cs", "head_technician"].includes(staff.role)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return run();
}

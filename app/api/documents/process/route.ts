import { NextResponse } from "next/server";
import { processDocumentGenerationJobs } from "@/lib/documents/generation-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.DOCUMENT_GENERATION_CRON_SECRET ?? process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function runWorker(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await processDocumentGenerationJobs());
  } catch (cause) {
    // Do not return configuration values, credentials, or source records from a background endpoint.
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "document generation worker failed" }, { status: 500 });
  }
}

export const GET = runWorker;
export const POST = runWorker;

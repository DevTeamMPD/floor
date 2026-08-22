import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSecretForKeyId, verifyPayload } from "@/lib/webhook/verify";
import { WorkOrderQueuedV1Schema } from "@/lib/webhook/schema";
import { upsertInstallJob } from "@/lib/webhook/process";

export const dynamic = "force-dynamic";

/**
 * Service-role client, created straight from env -- never the
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (that key is what made the old
 * /api/webhook/order route a wide-open write hole, per CLAUDE.md).
 */
function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  // Raw body FIRST, before any JSON parsing: the HMAC in X-Signature was
  // computed by the CRM dispatcher over these exact bytes. Parsing first
  // and re-serializing later would silently break every signature check
  // (key order, whitespace, number formatting can all change on a round-trip).
  const rawBody = await req.text();

  const eventId = req.headers.get("x-event-id");
  const timestamp = req.headers.get("x-timestamp");
  const signature = req.headers.get("x-signature");
  const keyId = req.headers.get("x-signature-key-id");
  const idempotencyKey = req.headers.get("x-idempotency-key");

  if (!eventId || !timestamp || !signature || !keyId) {
    return NextResponse.json({ error: "missing_required_headers" }, { status: 401 });
  }

  const secret = getSecretForKeyId(keyId);
  if (!secret) {
    return NextResponse.json({ error: "unknown_signature_key_id" }, { status: 401 });
  }

  const verified = verifyPayload(secret, timestamp, rawBody, signature);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = WorkOrderQueuedV1Schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema_validation_failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const payload = parsed.data;

  let supabase;
  try {
    supabase = serviceRoleClient();
  } catch (e) {
    console.error("[webhook/bbps] service role client init failed:", e);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Dedup layer 1: INSERT inbound_events, UNIQUE(event_id). A conflict here
  // means the dispatcher already delivered (and we already processed) this
  // exact event before -- ack immediately without touching install_jobs again.
  const { error: insertError } = await supabase.from("inbound_events").insert({
    event_id: eventId,
    event_type: payload.event.event_type,
    idempotency_key: idempotencyKey,
    signature_key_id: keyId,
    payload: json,
    status: "received",
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ duplicate: true }, { status: 202 });
    }
    console.error("[webhook/bbps] inbound_events insert failed:", insertError);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // Dedup layer 2: upsert install_jobs on external_id (production_id, D9).
  // A retried/duplicate delivery for a production_id already on the board
  // updates the same row instead of creating a second one.
  try {
    const result = await upsertInstallJob(supabase, payload);
    await supabase
      .from("inbound_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
    return NextResponse.json(
      { accepted: true, job_no: result.job_no, created: result.created },
      { status: 202 }
    );
  } catch (e) {
    console.error("[webhook/bbps] install_jobs upsert failed:", e);
    await supabase
      .from("inbound_events")
      .update({ status: "failed", error: String(e) })
      .eq("event_id", eventId);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}

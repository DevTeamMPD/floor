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

/**
 * `String(e)` on a PostgrestError/PostgrestError-shaped object collapses to
 * the useless "[object Object]" (fix round 1, Minor finding) -- pull out
 * the fields that actually matter for debugging instead.
 */
function serializeError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts: Record<string, unknown> = {};
    if (err.message) parts.message = err.message;
    if (err.code) parts.code = err.code;
    if (err.details) parts.details = err.details;
    if (err.hint) parts.hint = err.hint;
    if (Object.keys(parts).length > 0) return JSON.stringify(parts);
  }
  if (e instanceof Error) return e.message;
  return String(e);
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

  // Dedup layer 1: INSERT inbound_events, UNIQUE(event_id).
  const { error: insertError } = await supabase.from("inbound_events").insert({
    event_id: eventId,
    event_type: payload.event.event_type,
    idempotency_key: idempotencyKey,
    signature_key_id: keyId,
    payload: json,
    status: "received",
  });

  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("[webhook/bbps] inbound_events insert failed:", insertError);
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }

    // fix round 1, Critical #2: a 23505 on event_id only means *this exact
    // event was recorded before* -- it does NOT mean it was ever actually
    // processed. If the first attempt crashed between this insert and the
    // install_jobs upsert (status stuck at 'received'), or the upsert
    // itself failed (status='failed'), answering "202 duplicate" here
    // would make the dispatcher mark the event delivered and never retry
    // it again -- the job silently never reaches install_jobs. So: look at
    // the recorded status and only short-circuit when it is genuinely
    // 'processed'; otherwise fall through and retry the upsert for real.
    const { data: existingEvent, error: lookupError } = await supabase
      .from("inbound_events")
      .select("status")
      .eq("event_id", eventId)
      .maybeSingle();

    if (lookupError) {
      console.error("[webhook/bbps] inbound_events status lookup failed:", lookupError);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    if (existingEvent?.status === "processed") {
      return NextResponse.json({ duplicate: true }, { status: 202 });
    }
    // status is 'received' or 'failed' (or the row vanished between the
    // insert attempt and this lookup) -- retry processing below instead of
    // acking a job that never actually landed.
  }

  // Dedup layer 2: upsert install_jobs on external_id (production_id, D9).
  // A retried/duplicate delivery for a production_id already on the board
  // updates the same row instead of creating a second one.
  try {
    const result = await upsertInstallJob(supabase, payload);
    await supabase
      .from("inbound_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("event_id", eventId);
    return NextResponse.json(
      { accepted: true, job_no: result.job_no, created: result.created },
      { status: 202 }
    );
  } catch (e) {
    console.error("[webhook/bbps] install_jobs upsert failed:", e);
    await supabase
      .from("inbound_events")
      .update({ status: "failed", error: serializeError(e) })
      .eq("event_id", eventId);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}

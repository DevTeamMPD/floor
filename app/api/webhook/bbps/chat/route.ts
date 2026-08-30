import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyBbpsSignature } from "@/lib/webhook/verify-bbps";
import { BBPS_CHAT_SOURCE, safeEqualUtf8 } from "@/lib/integrations/bbps-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ขาเข้า — BBPS CRM ส่งข้อความใหม่ในตั๋วมาที่ LENDI
 * POST /api/webhook/bbps/chat   (API_CONTRACT_TICKET_CHAT_SYNC.md §2)
 *
 * ลำดับการตรวจ (ห้ามสลับ):
 *   1) อ่าน raw body ก่อน parse — HMAC เซ็นบนไบต์ดิบ
 *   2) Bearer token
 *   3) หน้าต่างเวลา 300 วินาที (กัน replay)
 *   4) HMAC-SHA256 constant-time
 *   5) กันข้อความซ้ำด้วย unique index (external_source, external_message_id)
 *
 * ยังไม่ตั้ง env => 503 "ยังไม่ได้ตั้งค่า integration" (deploy ขึ้นไปก่อนได้อย่างปลอดภัย)
 */

interface ChatEventBody {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: {
    message_id?: string;
    ticket_id?: string;
    quote_number?: string | null;
    work_order_seq?: number | null;
    sender_name?: string;
    sender_role?: string;
    body?: string;
    attachments?: unknown;
    created_at?: string;
    in_reply_to?: string | null;
  };
}

/** LENDI เก็บ sender_kind ได้เฉพาะ 5 ค่าตาม check constraint เดิม — บทบาทจริงเก็บไว้ที่ external_sender_role */
function toSenderKind(role: string | undefined): string {
  switch (role) {
    case "technician": return "technician";
    case "foreman":
    case "head_technician": return "head_technician";
    case "sales": return "sales";
    case "warehouse": return "warehouse";
    default: return "staff";
  }
}

function normalizeAttachments(raw: unknown): { url: string; type: string; name: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { url: string; type: string; name: string }[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (!url) continue;
    // URL พวกนี้ถูกเอาไปใส่ href/src ในเบราว์เซอร์ของพนักงานโดยตรง
    // ปล่อย javascript:/data: ผ่านคือเปิดช่อง XSS ให้ใครก็ตามที่เขียนข้อความใน BBPS ได้
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.protocol !== "https:") continue;
    const name = typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 200) : (url.split("/").pop() || "ไฟล์แนบ");
    const type = typeof value.type === "string" && value.type.trim() ? value.type.trim().slice(0, 40) : "file";
    out.push({ url, type, name });
  }
  return out;
}

export async function POST(req: Request) {
  const secret = process.env.BBPS_CHAT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "integration_not_configured", message: "ยังไม่ได้ตั้งค่า BBPS_CHAT_WEBHOOK_SECRET" },
      { status: 503 },
    );
  }

  const raw = await req.text();

  // BBPS dispatcher ส่ง Authorization: Bearer <secret เดียวกับที่ใช้เซ็น>
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expectedToken = process.env.BBPS_CHAT_INBOUND_TOKEN ?? secret;
  if (!bearer || !safeEqualUtf8(bearer, expectedToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // รองรับ rotate กุญแจ: ระหว่างเปลี่ยนผ่านรับได้ทั้งกุญแจปัจจุบันและกุญแจก่อนหน้า
  const timestamp = req.headers.get("x-timestamp");
  const signature = req.headers.get("x-signature");
  const secrets = [secret, process.env.BBPS_CHAT_WEBHOOK_SECRET_PREVIOUS].filter(Boolean) as string[];
  const tolerance = parseInt(process.env.BBPS_WEBHOOK_TOLERANCE_SEC ?? "300", 10);
  let verified = false;
  let reason = "missing_signature_headers";
  for (const candidate of secrets) {
    const result = verifyBbpsSignature({ rawBody: raw, signature, timestamp, secret: candidate, toleranceSec: tolerance });
    if (result.ok) { verified = true; break; }
    reason = result.reason ?? reason;
  }
  if (!verified) {
    console.warn(`[bbps-chat] signature rejected: ${reason} keyId=${req.headers.get("x-signature-key-id") ?? "-"}`);
    return NextResponse.json({ error: "unauthorized", reason }, { status: 401 });
  }

  let payload: ChatEventBody;
  try { payload = JSON.parse(raw) as ChatEventBody; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const eventType = req.headers.get("x-event-type") || payload.event_type || "";
  if (eventType && !eventType.startsWith("ticket.message.")) {
    // ไม่ใช่ event ของแชท — ตอบ 200 เพื่อไม่ให้ dispatcher retry ไม่จบ
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  const data = payload.data ?? {};
  const externalMessageId = (data.message_id || req.headers.get("x-idempotency-key") || "").trim();
  if (!externalMessageId) return NextResponse.json({ error: "message_id_required" }, { status: 422 });

  const ticketId = (data.ticket_id || "").trim();
  const quoteNumber = (data.quote_number || "").trim();
  if (!ticketId && !quoteNumber) return NextResponse.json({ error: "ticket_reference_required" }, { status: 422 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "supabase_server_env_missing" }, { status: 500 });
  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // หา ticket ของ LENDI: ทางหลักคือ external_id ที่ผูกไว้ตอน floor.job.sync.v1
  // ทางสำรองคือ order_no ซึ่ง bbps-sync เขียนเป็น quoteNumber
  let jobNo: string | null = null;
  if (ticketId) {
    const { data: row } = await supabase.from("install_jobs").select("job_no").eq("source", "bbps").eq("external_id", ticketId).maybeSingle();
    jobNo = row?.job_no ?? null;
  }
  if (!jobNo && quoteNumber) {
    const { data: row } = await supabase.from("install_jobs").select("job_no").eq("source", "bbps").eq("order_no", quoteNumber)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    jobNo = row?.job_no ?? null;
  }
  if (!jobNo) {
    console.warn(`[bbps-chat] ticket not found ticket_id=${ticketId || "-"} quote=${quoteNumber || "-"}`);
    return NextResponse.json({ error: "ticket_not_found" }, { status: 404 });
  }

  const attachments = normalizeAttachments(data.attachments);
  const body = typeof data.body === "string" ? data.body : "";
  if (!body.trim() && attachments.length === 0) return NextResponse.json({ error: "empty_message" }, { status: 422 });

  const { data: inserted, error } = await supabase.from("floor_ticket_messages").insert({
    job_no: jobNo,
    sender_kind: toSenderKind(data.sender_role),
    sender_name: (data.sender_name || "ทีม BBPS").slice(0, 200),
    body,
    attachment_paths: [],
    external_attachments: attachments,
    external_source: BBPS_CHAT_SOURCE,
    external_message_id: externalMessageId,
    external_ticket_id: ticketId || null,
    external_sender_role: data.sender_role ?? null,
    ...(data.created_at && !Number.isNaN(Date.parse(data.created_at)) ? { created_at: new Date(data.created_at).toISOString() } : {}),
  }).select("id").single();

  if (error) {
    // 23505 = เคยรับข้อความนี้แล้ว — ตอบ 409 ตาม contract, BBPS ถือว่าสำเร็จและหยุด retry
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, status: "duplicate" }, { status: 409 });
    }
    console.error("[bbps-chat] insert failed", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  console.log(`[bbps-chat] stored message ${externalMessageId} -> job ${jobNo}`);
  return NextResponse.json({ ok: true, id: inserted.id, job_no: jobNo }, { status: 201 });
}

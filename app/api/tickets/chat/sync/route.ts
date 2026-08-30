import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  outboundConfig, sendMessageToBbps, buildAttachmentUrl, attachmentKind, mapSenderRole,
} from "@/lib/integrations/bbps-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ขาออก — ส่งข้อความที่ค้างอยู่ของตั๋วหนึ่งไป BBPS
 * POST /api/tickets/chat/sync  { jobNo, messageId? }
 *
 * ข้อความถูกบันทึกลง LENDI ไปแล้วเสมอ (trigger ตั้ง sync_status='pending' ให้เอง
 * เฉพาะงานที่ source='bbps') route นี้แค่ผลักออกไปและอัปเดตสถานะ
 * ตั๋วที่ไม่ใช่ BBPS จะไม่มีข้อความไหนอยู่สถานะ pending เลย — พฤติกรรมเดิมไม่เปลี่ยน
 *
 * เรียกได้ทั้งตอนเปิดแชท (ผลักของค้างอัตโนมัติ) และตอนกดปุ่ม "ลองส่งใหม่"
 * external_message_id คงที่ทุก retry จึงส่งซ้ำกี่รอบก็ได้ข้อความเดียวที่ปลายทาง
 */

const MAX_PER_CALL = 20;
const MAX_ATTEMPTS = 6;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนเซิร์ฟเวอร์");
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** ต้องเป็นพนักงานที่ยัง active หรือช่างที่ถูกจ่ายงานนี้จริง ไม่งั้นจะกลายเป็นช่องยิงข้อความออกนอกระบบ */
async function assertAccess(jobNo: string, token?: string, pin?: string) {
  if (token && pin) {
    const admin = serviceClient();
    const { error } = await admin.rpc("get_technician_ticket_messages", { p_token: token, p_pin: pin, p_job_no: jobNo });
    if (error) throw new Error("ไม่มีสิทธิ์เข้าถึงงานนี้");
    return;
  }
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("กรุณาเข้าสู่ระบบก่อน");
  const { data: active, error } = await client.rpc("is_floor_staff_active");
  if (error || !active) throw new Error("ไม่มีสิทธิ์เข้าถึงงานนี้");
}

interface PendingRow {
  id: string;
  job_no: string;
  sender_kind: string;
  sender_name: string;
  body: string;
  attachment_paths: string[];
  created_at: string;
  external_message_id: string | null;
  external_ticket_id: string | null;
  sync_attempts: number;
}

export async function POST(request: Request) {
  let payload: { jobNo?: string; messageId?: string; token?: string; pin?: string };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const jobNo = String(payload.jobNo ?? "").trim();
  if (!jobNo) return NextResponse.json({ error: "jobNo_required" }, { status: 400 });

  try {
    await assertAccess(jobNo, payload.token, payload.pin);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unauthorized" }, { status: 403 });
  }

  const config = outboundConfig();
  if (!config) {
    // ปล่อยข้อความค้างสถานะ pending ไว้ตามเดิม ยังไม่ mark failed
    // เพราะพอตั้ง env ครบแล้วมันควรไหลต่อได้เองโดยไม่ต้องให้ใครมากดใหม่
    return NextResponse.json({
      configured: false,
      message: "ยังไม่ได้ตั้งค่า integration กับ BBPS (BBPS_CHAT_API_URL / BBPS_CHAT_OUTBOUND_TOKEN / BBPS_CHAT_OUTBOUND_SECRET)",
    });
  }

  const admin = serviceClient();

  let query = admin.from("floor_ticket_messages")
    .select("id,job_no,sender_kind,sender_name,body,attachment_paths,created_at,external_message_id,external_ticket_id,sync_attempts")
    .eq("job_no", jobNo)
    .is("external_source", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_CALL);

  // ปุ่ม "ลองส่งใหม่" ส่ง messageId มา และต้องส่งได้แม้สถานะเป็น failed แล้ว
  query = payload.messageId
    ? query.eq("id", payload.messageId).in("sync_status", ["pending", "failed"])
    : query.eq("sync_status", "pending");

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pending = (rows ?? []) as PendingRow[];
  if (!pending.length) return NextResponse.json({ configured: true, sent: 0, failed: 0, retrying: 0 });

  // quote_number สำรองไว้ให้ BBPS resolve ตั๋วเผื่อ external_id ไม่ตรง
  const { data: job } = await admin.from("install_jobs").select("order_no,external_id").eq("job_no", jobNo).maybeSingle();

  const result = { configured: true, sent: 0, failed: 0, retrying: 0 };
  const fileSecretMissing = !process.env.BBPS_CHAT_FILE_SECRET || !process.env.LENDI_PUBLIC_BASE_URL;

  for (const row of pending) {
    const attachments = fileSecretMissing ? [] : row.attachment_paths
      .map((path) => {
        const url = buildAttachmentUrl(path, row.job_no);
        if (!url) return null;
        const name = path.split("/").at(-1) || "ไฟล์แนบ";
        return { url, type: attachmentKind(name), name };
      })
      .filter((item): item is { url: string; type: "image" | "file"; name: string } => item !== null);

    const droppedFiles = row.attachment_paths.length > 0 && attachments.length === 0;

    const outcome = await sendMessageToBbps({
      externalMessageId: row.external_message_id ?? `lendi-${row.id}`,
      ticketId: row.external_ticket_id ?? job?.external_id ?? null,
      quoteNumber: job?.order_no ?? null,
      senderName: row.sender_name,
      senderRole: mapSenderRole(row.sender_kind),
      body: droppedFiles && !row.body.trim()
        ? "(ส่งไฟล์แนบ แต่ระบบยังตั้งค่าลิงก์ไฟล์ข้ามระบบไม่ครบ — เปิดดูได้ที่ตั๋วฝั่ง LENDI)"
        : row.body,
      attachments,
      createdAt: row.created_at,
    }, config);

    const attempts = (row.sync_attempts ?? 0) + 1;

    if (outcome.kind === "delivered") {
      await admin.from("floor_ticket_messages").update({
        sync_status: "delivered",
        external_provider_message_id: outcome.providerMessageId,
        sync_error: null,
        sync_attempts: attempts,
        synced_at: new Date().toISOString(),
      }).eq("id", row.id);
      result.sent++;
      continue;
    }

    if (outcome.kind === "failed") {
      await admin.from("floor_ticket_messages").update({
        sync_status: "failed", sync_error: outcome.message, sync_attempts: attempts,
      }).eq("id", row.id);
      result.failed++;
      continue;
    }

    // retryable — ลองครบโควตาแล้วค่อยยอมแพ้ ไม่งั้นข้อความจะค้าง pending ตลอดกาลโดยไม่มีใครเห็น
    const exhausted = attempts >= MAX_ATTEMPTS;
    await admin.from("floor_ticket_messages").update({
      sync_status: exhausted ? "failed" : "pending",
      sync_error: outcome.message,
      sync_attempts: attempts,
    }).eq("id", row.id);
    if (exhausted) result.failed++; else result.retrying++;
  }

  return NextResponse.json(result);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendMessageToBbps, buildAttachmentUrl, attachmentKind, mapSenderRole,
  type OutboundConfig,
} from "@/lib/integrations/bbps-chat";

/**
 * ตรรกะผลักข้อความค้างของตั๋วหนึ่งไป BBPS
 *
 * ย้ายออกมาจาก app/api/tickets/chat/sync/route.ts แบบไม่เปลี่ยนพฤติกรรม
 * เพื่อให้ cron (/api/cron/flush-pending-chat) เรียกใช้ตรรกะเดียวกันได้
 *
 * ที่มา: ตรวจ 5 ก.ย. 2569 พบว่าขากลับ FloorNow → BBPS ถูกผลักเฉพาะตอนมีคนเปิด
 * หน้าแชทหรือกดปุ่มลองส่งใหม่ ไม่มี cron ตัวไหนไล่ผลักของค้าง ปัจจุบันยังค้าง
 * 0 จาก 60 ข้อความ จึงเป็นงานป้องกัน ไม่ใช่การซ่อมของที่พังแล้ว
 */

export const MAX_PER_CALL = 20;
export const MAX_ATTEMPTS = 6;

export interface FlushResult {
  sent: number;
  failed: number;
  retrying: number;
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

/**
 * ผลักข้อความที่ค้างของงานหนึ่งออกไป
 * messageId ที่ระบุมาจะถูกส่งแม้สถานะเป็น failed แล้ว (ปุ่ม "ลองส่งใหม่")
 */
export async function flushJobMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  jobNo: string,
  config: OutboundConfig,
  messageId?: string,
): Promise<FlushResult | { error: string }> {
  let query = admin.from("floor_ticket_messages")
    .select("id,job_no,sender_kind,sender_name,body,attachment_paths,created_at,external_message_id,external_ticket_id,sync_attempts")
    .eq("job_no", jobNo)
    .is("external_source", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_CALL);

  query = messageId
    ? query.eq("id", messageId).in("sync_status", ["pending", "failed"])
    : query.eq("sync_status", "pending");

  const { data: rows, error } = await query;
  if (error) return { error: error.message };

  const pending = (rows ?? []) as PendingRow[];
  const result: FlushResult = { sent: 0, failed: 0, retrying: 0 };
  if (!pending.length) return result;

  // quote_number สำรองไว้ให้ BBPS resolve ตั๋วเผื่อ external_id ไม่ตรง
  const { data: job } = await admin.from("install_jobs")
    .select("order_no,external_id").eq("job_no", jobNo).maybeSingle();

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
      ticketId: row.external_ticket_id ?? (job?.external_id as string | null) ?? null,
      quoteNumber: (job?.order_no as string | null) ?? null,
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

  return result;
}

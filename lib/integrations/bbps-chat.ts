import { createHmac, timingSafeEqual, randomUUID } from "crypto";

/**
 * Ticket Chat Sync — ฝั่ง LENDI Engineering
 * ตัวช่วยฝั่งเซิร์ฟเวอร์ล้วน ห้าม import จาก client component
 * ทุก secret อ่านจาก env ที่ไม่ใช่ NEXT_PUBLIC_ จึงไม่มีทางหลุดลง bundle ของเบราว์เซอร์
 *
 * อ้างอิง API_CONTRACT_TICKET_CHAT_SYNC.md
 */

export const BBPS_CHAT_SOURCE = "bbps";
export const CHAT_EVENT_MESSAGE_CREATED = "ticket.message.created.v1";

/** ผลการส่งหนึ่งครั้ง — retryable แยกจาก failed ชัดเจน เพื่อไม่ให้ UI บอกผู้ใช้ผิด */
export type SendOutcome =
  | { kind: "delivered"; providerMessageId: string; duplicate: boolean }
  | { kind: "failed"; message: string }          // 401/404/422 — ลองใหม่ก็ไม่หาย ต้องแก้ config หรือข้อมูล
  | { kind: "retry"; message: string };          // 429/5xx/timeout — ลองใหม่ได้

export interface OutboundConfig {
  url: string;
  token: string;
  secret: string;
  keyId: string;
}

/** คืน null เมื่อยังตั้ง env ไม่ครบ — ให้ปลายทางเรียกใช้ตัดสินใจว่าจะตอบผู้ใช้ยังไง */
export function outboundConfig(): OutboundConfig | null {
  const url = process.env.BBPS_CHAT_API_URL;
  const token = process.env.BBPS_CHAT_OUTBOUND_TOKEN;
  const secret = process.env.BBPS_CHAT_OUTBOUND_SECRET;
  if (!url || !token || !secret) return null;
  return { url, token, secret, keyId: process.env.BBPS_CHAT_OUTBOUND_KEY_ID ?? "lendi-k1" };
}

/** ตรงกับ signPayload ของ BBPS: v1= + hex(HMAC_SHA256(secret, `${ts}.${rawBody}`)) */
export function signBody(secret: string, timestamp: number, rawBody: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function safeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// ไฟล์แนบ: capability URL อายุยาว แทนการเปิด bucket เป็น public
//
// bucket ticket-chat-files เป็น private และ signed URL ที่ใช้ในเว็บมีอายุ 300 วินาที
// ซึ่งสั้นเกินกว่าที่ contract ขอ (>= 90 วัน) แต่การเปลี่ยน bucket เป็น public
// จะเปิดไฟล์ของทุกงานให้ใครก็ได้ที่เดา path เจอ จึงไม่ทำ
//
// ทางออก: ออก URL ที่เซ็นด้วย secret ฝั่งเซิร์ฟเวอร์ ผูกกับ "ไฟล์เดียว" และมีวันหมดอายุ
// ในตัว ปลายทางเอาไปแสดงในเบราว์เซอร์ได้ตรงๆ โดยไม่ต้องแนบ header
// route /api/integrations/bbps/file เป็นคนตรวจลายเซ็นแล้ว proxy ไฟล์ออกมา
// ---------------------------------------------------------------------------

const ATTACHMENT_TTL_DAYS = Number(process.env.BBPS_CHAT_FILE_TTL_DAYS ?? "180");

function b64url(input: Buffer | string): string {
  return Buffer.from(input as never).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface AttachmentGrant { path: string; jobNo: string; exp: number }

export function signAttachmentGrant(grant: AttachmentGrant, secret: string): string {
  const data = b64url(JSON.stringify(grant));
  const sig = b64url(createHmac("sha256", secret).update(data, "utf8").digest());
  return `${data}.${sig}`;
}

export function verifyAttachmentGrant(token: string, secret: string): AttachmentGrant | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(data, "utf8").digest());
  if (!safeEqualUtf8(expected, sig)) return null;
  let grant: AttachmentGrant;
  try { grant = JSON.parse(unb64url(data).toString("utf8")) as AttachmentGrant; } catch { return null; }
  if (!grant?.path || typeof grant.exp !== "number") return null;
  if (Date.now() / 1000 > grant.exp) return null;
  return grant;
}

/** คืน null เมื่อยังไม่ได้ตั้ง BBPS_CHAT_FILE_SECRET หรือ LENDI_PUBLIC_BASE_URL — ผู้เรียกต้องรายงานข้อจำกัดนี้ */
export function buildAttachmentUrl(path: string, jobNo: string): string | null {
  const secret = process.env.BBPS_CHAT_FILE_SECRET;
  const base = process.env.LENDI_PUBLIC_BASE_URL;
  if (!secret || !base) return null;
  const exp = Math.floor(Date.now() / 1000) + ATTACHMENT_TTL_DAYS * 86400;
  const token = signAttachmentGrant({ path, jobNo, exp }, secret);
  return `${base.replace(/\/+$/, "")}/api/integrations/bbps/file?t=${encodeURIComponent(token)}`;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|heic|heif)$/i;
export function attachmentKind(name: string): "image" | "file" {
  return IMAGE_RE.test(name) ? "image" : "file";
}

// ---------------------------------------------------------------------------
// แปลงบทบาทผู้ส่งของ LENDI ให้เป็นบทบาทที่ BBPS เข้าใจ
// ---------------------------------------------------------------------------
export function mapSenderRole(senderKind: string): string {
  switch (senderKind) {
    case "technician": return "technician";
    case "head_technician": return "foreman";
    case "sales": return "sales";
    case "warehouse": return "warehouse";
    default: return "staff";
  }
}

/** บทบาทฝั่ง BBPS -> ป้ายภาษาไทยที่แสดงในกล่องแชท */
export const BBPS_ROLE_LABEL: Record<string, string> = {
  sales: "ฝ่ายขาย",
  coordinator: "ผู้ประสานงาน",
  admin: "แอดมิน",
  technician: "ช่าง",
  foreman: "หัวหน้าช่าง",
  head_technician: "หัวหน้าช่าง",
  warehouse: "คลัง",
  staff: "ทีมงาน",
  system: "ระบบ",
};

// ---------------------------------------------------------------------------
// ส่งข้อความหนึ่งข้อความไป BBPS
// ---------------------------------------------------------------------------
export interface OutboundMessage {
  externalMessageId: string;   // คงที่ตลอดอายุข้อความ retry กี่รอบก็ค่าเดิม
  ticketId: string | null;
  quoteNumber: string | null;
  senderName: string;
  senderRole: string;
  body: string;
  attachments: { url: string; type: string; name: string }[];
  createdAt: string;
}

const HTTP_TIMEOUT_MS = 10_000;

export async function sendMessageToBbps(message: OutboundMessage, config: OutboundConfig): Promise<SendOutcome> {
  const payload = {
    external_message_id: message.externalMessageId,
    ticket: {
      ticket_id: message.ticketId,
      quote_number: message.quoteNumber,
    },
    sender_name: message.senderName,
    sender_role: message.senderRole,
    body: message.body,
    attachments: message.attachments,
    created_at: message.createdAt,
  };

  // สร้าง raw body ครั้งเดียวแล้วใช้ทั้งเซ็นและส่ง — stringify สองรอบเสี่ยงลำดับ key ต่างจนลายเซ็นไม่ตรง
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  let res: Response;
  try {
    res = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${config.token}`,
        "User-Agent": "LENDI-Chat/1.0",
        "X-Event-Id": randomUUID(),
        "X-Timestamp": String(timestamp),
        "X-Signature": signBody(config.secret, timestamp, rawBody),
        "X-Signature-Key-Id": config.keyId,
        "X-Idempotency-Key": message.externalMessageId,
      },
      body: rawBody,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    return { kind: "retry", message: e instanceof Error ? e.message : "network error" };
  }

  if (res.status === 201 || res.status === 200) {
    const data = await res.json().catch(() => ({})) as { message_id?: string; status?: string };
    if (!data.message_id) return { kind: "retry", message: "BBPS ตอบกลับโดยไม่มี message_id" };
    return { kind: "delivered", providerMessageId: data.message_id, duplicate: data.status === "duplicate" };
  }

  // 401 / 404 / 422 = ลองใหม่กี่ครั้งก็ผลเดิม ต้องมีคนแก้ config หรือข้อมูลก่อน
  if (res.status === 401) return { kind: "failed", message: "BBPS ปฏิเสธการยืนยันตัวตน (ตรวจ token/secret ทั้งสองฝั่ง)" };
  if (res.status === 404) return { kind: "failed", message: "BBPS ไม่พบตั๋วปลายทางของงานนี้" };
  if (res.status === 422) {
    const detail = await res.text().catch(() => "");
    return { kind: "failed", message: `BBPS ปฏิเสธรูปแบบข้อความ${detail ? ` (${detail.slice(0, 200)})` : ""}` };
  }
  if (res.status === 503) return { kind: "retry", message: "ฝั่ง BBPS ยังไม่ได้ตั้งค่า integration" };

  const text = await res.text().catch(() => "");
  return { kind: "retry", message: `BBPS ตอบ HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}` };
}

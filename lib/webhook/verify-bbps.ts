import { createHmac, timingSafeEqual } from "crypto";

// ตรวจ HMAC-SHA256 + กัน replay ด้วย timestamp (เปิดใช้เมื่อมี BBPS_WEBHOOK_SECRET เท่านั้น)
// รูปแบบการเซ็นที่คาดหวังจากฝั่ง BBPS:
//   signedPayload = `${X-Timestamp}.${rawBody}`
//   X-Signature   = "v1=" + hex( HMAC_SHA256(secret, signedPayload) )
//
// BBPS ส่งมาด้วยคำนำหน้า "v1=" (ดู src/lib/webhook-signature.ts ฝั่งนั้น) แต่โค้ดเดิม
// ตัดเฉพาะ "sha256=" ทำให้ลายเซ็นจริงถูกปฏิเสธทุกครั้งถ้าเปิดใช้ BBPS_WEBHOOK_SECRET
// จึงรับทั้งสองคำนำหน้า (และ hex เปล่า) เพื่อไม่ให้ integration ที่ตั้งค่าถูกต้องพัง
export interface VerifyResult { ok: boolean; reason?: string }

function parseTs(ts: string): number | null {
  if (/^\d+$/.test(ts)) { const n = parseInt(ts, 10); return ts.length <= 10 ? n * 1000 : n; }
  const d = Date.parse(ts);
  return Number.isNaN(d) ? null : d;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyBbpsSignature(params: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  toleranceSec?: number;
  now?: number; // สำหรับเทส
}): VerifyResult {
  const { rawBody, signature, timestamp, secret } = params;
  const toleranceSec = params.toleranceSec ?? 300; // 5 นาที
  const now = params.now ?? Date.now();

  if (!signature || !timestamp) return { ok: false, reason: "missing_signature_headers" };

  const tsMs = parseTs(timestamp);
  if (tsMs === null) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(now - tsMs) / 1000 > toleranceSec) return { ok: false, reason: "timestamp_expired" };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const provided = signature.includes("=") ? signature.slice(signature.indexOf("=") + 1) : signature;
  if (!safeEqualHex(expected, provided)) return { ok: false, reason: "invalid_signature" };

  return { ok: true };
}

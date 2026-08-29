import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyBbpsJob, closeBbpsJob, jobHasYearWarning, type BbpsJob } from "@/lib/bbps-sync";
import { verifyBbpsSignature } from "@/lib/webhook/verify-bbps";

export const dynamic = "force-dynamic";

// รับ push จาก BBPS: POST /api/webhook/bbps
// Auth: Authorization: Bearer <BBPS_INGEST_TOKEN>
//   (option) + HMAC-SHA256 signature เมื่อมี BBPS_WEBHOOK_SECRET: header X-Signature, X-Timestamp
// Body: { event?: "upsert"|"completed"|"deleted", jobs: BbpsJob[] }  หรือ job เดี่ยว { id, ... }
async function handle(req: Request) {
  const token = process.env.BBPS_INGEST_TOKEN;
  if (!token) { console.error("[webhook-bbps] BBPS_INGEST_TOKEN missing"); return NextResponse.json({ error: "server_not_configured" }, { status: 500 }); }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Webhook นี้ต้องอ่านและเขียนตารางภายในหลายตาราง จึงต้องใช้ key ฝั่ง server
  // เท่านั้น ห้ามใช้ anon key หรือเปิดสิทธิ์ anon ให้ข้อมูลใบงาน.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "supabase_server_env_missing" }, { status: 500 });
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // อ่าน raw body ครั้งเดียว (ต้องใช้ bytes ดิบสำหรับ HMAC)
  const raw = await req.text();

  // ชั้นความปลอดภัยเสริม (backward-compatible): เปิดใช้เมื่อ set BBPS_WEBHOOK_SECRET เท่านั้น
  // ถ้าไม่ได้ set -> ข้ามการตรวจลายเซ็น พฤติกรรมเดิมทุกอย่าง (ไม่ทำ integration ที่ใช้อยู่พัง)
  const secret = process.env.BBPS_WEBHOOK_SECRET;
  if (secret) {
    const v = verifyBbpsSignature({
      rawBody: raw,
      signature: req.headers.get("x-signature"),
      timestamp: req.headers.get("x-timestamp"),
      secret,
      toleranceSec: parseInt(process.env.BBPS_WEBHOOK_TOLERANCE_SEC ?? "300", 10),
    });
    if (!v.ok) { console.warn(`[webhook-bbps] signature rejected: ${v.reason}`); return NextResponse.json({ error: "unauthorized", reason: v.reason }, { status: 401 }); }
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const p = payload as { event?: unknown; action?: string; jobs?: BbpsJob[] } & Partial<BbpsJob>;

  // BBPS outbox ใส่ metadata object ไว้ที่ event; action คือคำสั่งธุรกิจที่ Floor ใช้จริง
  const event = (typeof p.event === "string" ? p.event : p.action || "upsert").toLowerCase();
  const jobs: BbpsJob[] = Array.isArray(p.jobs) ? p.jobs : (p.id ? [p as BbpsJob] : []);
  if (!jobs.length) return NextResponse.json({ error: "no_jobs" }, { status: 400 });

  try {
    let added = 0, removed = 0, warnings = 0, skipped = 0;
    const isRemoveEvent = event === "completed" || event === "deleted" || event === "cancelled";
    for (const j of jobs) {
      if (!j.id) continue;
      if (jobHasYearWarning(j)) { warnings++; console.warn(`[webhook-bbps] date year > 2100 (possible BE) job=${j.id} quote=${j.quoteNumber ?? "-"} — needs human review, skip block`); }
      // ปิดงาน/ลบ หรือ สถานะไม่ active -> ลบบล็อก ; ไม่งั้นอัปเดตบล็อกตามวันที่
      if (isRemoveEvent || (j.statusCode !== "queued" && j.statusCode !== "installing")) {
        removed += await closeBbpsJob(supabase, j, event);
      } else {
        const r = await applyBbpsJob(supabase, j);
        added += r.added; removed += r.removed;
        if (r.skipped) skipped++;
      }
    }
    console.log(`[webhook-bbps] event=${event} jobs=${jobs.length} added=${added} removed=${removed} skipped=${skipped} warnings=${warnings}`);
    return NextResponse.json({ ok: true, event, jobs: jobs.length, added, removed, skipped, warnings, at: new Date().toISOString() });
  } catch (e) {
    console.error("[webhook-bbps] error", e);
    const message = e instanceof Error
      ? e.message
      : (typeof e === "object" && e && "message" in e ? String(e.message) : String(e));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = handle;
export const PUT = handle;

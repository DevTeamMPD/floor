import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { outboundConfig } from "@/lib/integrations/bbps-chat";
import { flushJobMessages } from "@/lib/integrations/bbps-chat-flush";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * C4 — ไล่ผลักข้อความที่ค้างส่งไป BBPS ทุก 15 นาที
 *
 * ที่มา: ตรวจ 5 ก.ย. 2569 พบว่าขากลับ FloorNow → BBPS ผลักเฉพาะตอนมีคนเปิดหน้าแชท
 * หรือกดปุ่ม "ลองส่งใหม่" ทั้งสอง repo ไม่มี cron ตัวไหนไล่ผลักของค้างเลย
 * ถ้าไม่มีใครเปิดตั๋วนั้นอีก ข้อความจะอยู่สถานะ pending ไปเรื่อย ๆ โดยไม่มีใครรู้
 *
 * ตอนเขียนยังค้าง 0 จาก 60 ข้อความ — งานนี้จึงเป็นการป้องกัน ไม่ใช่การซ่อม
 *
 * ไม่ต้อง assertAccess เหมือน route ฝั่งผู้ใช้ เพราะ cron ไม่ได้รับ jobNo จากใคร
 * แต่ไล่จากข้อความที่ระบบเองบันทึกไว้ว่าค้าง
 */

/** กันไม่ให้รอบเดียวยาวเกิน maxDuration */
const MAX_JOBS_PER_RUN = 25;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Vercel ส่ง Authorization: Bearer $CRON_SECRET มาให้เมื่อมีการตั้งค่าไว้ */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // ยังไม่ได้ตั้ง secret — คงพฤติกรรมเดิมของ cron ตัวอื่นในโปรเจกต์นี้
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = outboundConfig();
  if (!config) {
    // ปล่อยข้อความค้างไว้ตามเดิม ไม่ mark failed — พอตั้ง env ครบแล้วต้องไหลต่อได้เอง
    return NextResponse.json({ configured: false, jobs: 0, sent: 0, failed: 0, retrying: 0 });
  }

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json({ error: "supabase_env_missing" }, { status: 500 });
  }

  const { data: rows, error } = await admin
    .from("floor_ticket_messages")
    .select("job_no")
    .eq("sync_status", "pending")
    .is("external_source", null)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobNos = [...new Set((rows ?? []).map((r) => r.job_no as string))].slice(0, MAX_JOBS_PER_RUN);

  const total = { configured: true, jobs: jobNos.length, sent: 0, failed: 0, retrying: 0, errors: 0 };
  for (const jobNo of jobNos) {
    const result = await flushJobMessages(admin, jobNo, config);
    if ("error" in result) { total.errors++; continue; }
    total.sent += result.sent;
    total.failed += result.failed;
    total.retrying += result.retrying;
  }

  return NextResponse.json(total);
}

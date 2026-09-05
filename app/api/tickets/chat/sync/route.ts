import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { outboundConfig } from "@/lib/integrations/bbps-chat";
import { flushJobMessages } from "@/lib/integrations/bbps-chat-flush";

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

  const result = await flushJobMessages(admin, jobNo, config, payload.messageId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ configured: true, ...result });
}

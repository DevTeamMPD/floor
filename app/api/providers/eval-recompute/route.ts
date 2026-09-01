/**
 * งานตามกำหนดเวลา: คำนวณคะแนนประเมินทีมช่าง/ผู้ให้บริการใหม่ทั้งหมด (P4-9)
 *
 * ทำไมเป็น "คำนวณใหม่ทั้งชุดตามเวลา" ไม่ใช่ "อัปเดตตอนเกิดเหตุการณ์":
 *   คะแนนหนึ่งตัวกินข้อมูลจากสี่ที่ (job_evaluations, ncr_reports, appointments+install_jobs,
 *   job_acceptance_results) และค่ากลางของทั้งบริษัทเป็นตัวหารร่วมของทุกทีม
 *   แปลว่างานของทีม A ที่เพิ่งจบ ทำให้คะแนนของทีม B เปลี่ยนด้วย — ถ้าใช้ทริกเกอร์รายเหตุการณ์
 *   จะต้องมีทริกเกอร์อย่างน้อยสี่ตัวที่ทุกตัวต้องคำนวณใหม่ทั้งระบบอยู่ดี และเงียบหายเมื่อไรก็ไม่มีใครรู้
 *   ปริมาณงานจริงคือหลักร้อยแถว การคำนวณใหม่ทั้งชุดคืนละครั้งจึงถูกกว่าและ "เพี้ยนสะสมไม่ได้"
 *   เพราะทุกคืนเริ่มจากศูนย์ใหม่เสมอ
 *
 * ตารางเวลา: ประกาศที่ vercel.json เหมือน route cron ตัวอื่น วันละครั้ง (แผน Hobby ยิงได้วันละครั้ง)
 * 19:00 UTC = 02:00 น. เวลาไทย — หลัง /api/documents/process (18:15 UTC) ที่ปิดงานเอกสารของวัน
 * และก่อน /api/stock/shortage-check (00:00 UTC) คนที่เปิดจอตอนเช้าจึงเห็นคะแนนของเมื่อวานครบแล้ว
 *
 * การป้องกัน: แพตเทิร์นเดียวกับ /api/documents/process และ /api/stock/shortage-check ทุกประการ
 *   GET  ต้องมี Bearer secret เท่านั้น (สำหรับ Vercel Cron)
 *   POST ถ้าไม่มี secret จะถอยไปตรวจว่ามีพนักงานล็อกอินอยู่ (สั่งคำนวณใหม่เองได้จากในแอป)
 * ชื่อ env var: PROVIDER_EVAL_CRON_SECRET แล้วถอยไป CRON_SECRET เหมือน route เดิม
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runProviderEvalRecompute } from "@/lib/provider-eval-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.PROVIDER_EVAL_CRON_SECRET ?? process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function executeWorker() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูลฝั่งเซิร์ฟเวอร์" }, { status: 503 });
  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return NextResponse.json(await runProviderEvalRecompute(supabase));
  } catch (cause) {
    // ห้ามคืนค่าคอนฟิก คีย์ หรือข้อมูลดิบออกจาก endpoint เบื้องหลัง
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "คำนวณคะแนนผู้ให้บริการไม่สำเร็จ" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return executeWorker();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    // โหลดตอนใช้จริงเท่านั้น เพราะ lib/staff-server ผูกกับ runtime ฝั่งเซิร์ฟเวอร์ของ Next
    const { getCurrentStaff } = await import("@/lib/staff-server");
    const staff = await getCurrentStaff();
    if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return executeWorker();
}

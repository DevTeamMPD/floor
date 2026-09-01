/**
 * งานตามกำหนดเวลา: ตรวจสต็อกของงานที่ใกล้ถึงวันติดตั้ง แล้วเตือนเมื่อของไม่พอ
 *
 * ประกาศตารางเวลาไว้ที่ vercel.json เหมือน /api/sync-evaluations และ /api/documents/process
 * ตารางเป็น "วันละครั้ง" เพราะโปรเจกต์อยู่บนแผน Hobby ของ Vercel ซึ่งยิง cron ได้วันละครั้งเท่านั้น
 * (ดู docs/P2_2_TO_P2_6_IMPLEMENTATION.md ที่บันทึกข้อจำกัดเดียวกันไว้แล้ว)
 * เวลา 00:00 UTC = 07:00 น. เวลาไทย ตั้งใจให้อยู่หลัง snapshot ของคลังที่เข้ามาราว 23:05 UTC ทุกคืน
 * และก่อนคลังเริ่มงาน คนที่ต้องหาของจึงเห็นคำเตือนตั้งแต่ต้นวัน
 *
 * การป้องกัน: ใช้แพตเทิร์นเดียวกับ /api/documents/process ทุกประการ ไม่คิดสคีมใหม่
 *   GET  ต้องมี Bearer secret เท่านั้น (สำหรับ Vercel Cron)
 *   POST ถ้าไม่มี secret จะถอยไปตรวจว่ามีพนักงานล็อกอินอยู่ (สั่งรันเองได้จากในแอป)
 * ชื่อ env var: STOCK_SHORTAGE_CRON_SECRET แล้วถอยไป CRON_SECRET เหมือน route เดิม
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readStockShortageLookaheadDays } from "@/lib/stock-shortage";
import { runStockShortageCheck } from "@/lib/stock-shortage-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.STOCK_SHORTAGE_CRON_SECRET ?? process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function executeWorker() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูลฝั่งเซิร์ฟเวอร์" }, { status: 503 });
  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const daysAhead = readStockShortageLookaheadDays(process.env);
    return NextResponse.json(await runStockShortageCheck(supabase, { daysAhead }));
  } catch (cause) {
    // ห้ามคืนค่าคอนฟิก คีย์ หรือข้อมูลดิบออกจาก endpoint เบื้องหลัง
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "ตรวจสอบสต็อกล่วงหน้าไม่สำเร็จ" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return executeWorker();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    // โหลดตอนใช้จริงเท่านั้น เพราะ lib/staff-server ผูกกับ runtime ฝั่งเซิร์ฟเวอร์ของ Next
    // ทางเดิน GET (ซึ่งเป็นทางที่ cron ใช้) จึงไม่ต้องแตะโมดูลนั้นเลย
    const { getCurrentStaff } = await import("@/lib/staff-server");
    const staff = await getCurrentStaff();
    if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return executeWorker();
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAttachmentGrant } from "@/lib/integrations/bbps-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ตัวกลางเปิดไฟล์แนบข้ามระบบ
 * GET /api/integrations/bbps/file?t=<token>
 *
 * ทำไมต้องมี route นี้:
 *   bucket ticket-chat-files เป็น private และ signed URL ที่หน้าเว็บใช้มีอายุแค่ 300 วินาที
 *   ซึ่งสั้นกว่าที่ contract ขอ (>= 90 วัน) มาก แต่การเปลี่ยน bucket เป็น public
 *   จะเปิดไฟล์ของทุกงานให้ใครก็ตามที่เดา path เจอ จึงไม่ทำ
 *
 *   token ที่นี่คือ "capability URL": เซ็นด้วย BBPS_CHAT_FILE_SECRET ฝั่งเซิร์ฟเวอร์
 *   ผูกกับไฟล์เดียวและมีวันหมดอายุอยู่ในตัว ใครถือ URL ก็เปิดได้เฉพาะไฟล์นั้นไฟล์เดียว
 *   ถ้าหลุด เพิกถอนได้ด้วยการหมุน BBPS_CHAT_FILE_SECRET (ลิงก์เก่าตายทั้งชุดทันที)
 *
 * ไฟล์ถูก proxy ออกมาเป็นไบต์ ไม่ redirect ไปยัง signed URL ของ storage
 * เพื่อไม่ให้ URL ภายในของ storage หลุดออกไปอยู่ใน history/referrer ของปลายทาง
 */

const BUCKET = "ticket-chat-files";
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(request: Request) {
  const secret = process.env.BBPS_CHAT_FILE_SECRET;
  if (!secret) return new NextResponse("integration not configured", { status: 503 });

  const token = new URL(request.url).searchParams.get("t");
  if (!token) return new NextResponse("missing token", { status: 400 });

  const grant = verifyAttachmentGrant(token, secret);
  if (!grant) return new NextResponse("link expired or invalid", { status: 403 });

  // กัน path traversal ก่อนส่งต่อให้ storage
  if (grant.path.includes("..") || grant.path.startsWith("/")) return new NextResponse("invalid path", { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse("server not configured", { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await admin.storage.from(BUCKET).download(grant.path);
  if (error || !data) return new NextResponse("file not found", { status: 404 });

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) return new NextResponse("file too large", { status: 413 });

  const name = grant.path.split("/").at(-1) || "file";
  const contentType = data.type || "application/octet-stream";
  // inline เฉพาะรูปกับ PDF เพื่อให้แสดงในกล่องแชทได้ · ชนิดอื่นบังคับดาวน์โหลด
  // ไฟล์ข้อความที่เสิร์ฟ inline จากโดเมนของ LENDI คือช่อง stored XSS ถ้าเบราว์เซอร์เดาชนิดผิด
  const inline = contentType.startsWith("image/") || contentType === "application/pdf";
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

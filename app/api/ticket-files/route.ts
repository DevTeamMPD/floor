import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const bucket = "ticket-chat-files";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนเซิร์ฟเวอร์");
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function assertAccess(jobNo: string, token?: string, pin?: string) {
  if (token && pin) {
    const admin = serviceClient();
    const { error } = await admin.rpc("get_technician_ticket_messages", { p_token: token, p_pin: pin, p_job_no: jobNo });
    if (error) throw new Error("ไม่มีสิทธิ์เข้าถึงไฟล์ของงานนี้");
    return;
  }
  const host = (await headers()).get("host") || "";
  const localDemo = (await cookies()).get("floor_local_demo")?.value === "1";
  if (process.env.NODE_ENV !== "production" && /^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host) && localDemo) return;
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("กรุณาเข้าสู่ระบบก่อนเข้าถึงไฟล์");
  const { data: active, error } = await client.rpc("is_floor_staff_active");
  if (error || !active) throw new Error("ไม่มีสิทธิ์เข้าถึงไฟล์ของงานนี้");
}

function safeSegment(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, "-"); }

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const action = String(form.get("action") || "upload");
    const jobNo = String(form.get("jobNo") || "").trim();
    const token = String(form.get("token") || "").trim();
    const pin = String(form.get("pin") || "").trim();
    if (!jobNo) return NextResponse.json({ error: "ไม่พบเลขงาน" }, { status: 400 });
    await assertAccess(jobNo, token || undefined, pin || undefined);
    const admin = serviceClient();

    if (action === "sign") {
      const paths = form.getAll("path").map(String).filter((path) => path.startsWith(`ticket-chat/${safeSegment(jobNo)}/`));
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, 300);
      if (error) throw error;
      return NextResponse.json({ files: (data ?? []).map((item) => ({ path: item.path, url: item.signedUrl })) });
    }

    const files = form.getAll("file").filter((value): value is File => value instanceof File);
    if (!files.length) return NextResponse.json({ error: "ไม่พบไฟล์แนบ" }, { status: 400 });
    if (files.some((file) => file.size > 10 * 1024 * 1024)) return NextResponse.json({ error: "ไฟล์ต้องมีขนาดไม่เกิน 10 MB" }, { status: 400 });
    const paths: string[] = [];
    for (const [index, file] of files.entries()) {
      const path = `ticket-chat/${safeSegment(jobNo)}/${crypto.randomUUID()}-${index}-${safeSegment(file.name)}`;
      const { error } = await admin.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (error) { if (paths.length) await admin.storage.from(bucket).remove(paths); throw error; }
      paths.push(path);
    }
    return NextResponse.json({ paths });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "จัดการไฟล์ไม่สำเร็จ" }, { status: 403 });
  }
}

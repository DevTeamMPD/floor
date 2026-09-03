import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PIN_DOMAIN = "pin.floor.local";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { fullName?: string; username?: string; pin?: string };
  const fullName = body.fullName?.trim() ?? "";
  const username = body.username?.trim().toLowerCase() ?? "";
  const pin = body.pin?.trim() ?? "";
  if (fullName.length < 2) return NextResponse.json({ error: "กรุณาระบุชื่อผู้ใช้" }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) return NextResponse.json({ error: "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด ขีด หรือขีดล่าง จำนวน 3–32 ตัว" }, { status: 400 });
  if (!/^\d{6}$/.test(pin)) return NextResponse.json({ error: "PIN ต้องเป็นตัวเลข 6 หลัก" }, { status: 400 });

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return NextResponse.json({ username, fullName, localPreview: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: actor } = await supabase.from("floor_staff_profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!actor?.is_active || actor.role !== "admin") return NextResponse.json({ error: "admin_required" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "server_configuration_missing" }, { status: 500 });
  const service = createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${username}@${PIN_DOMAIN}`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password: pin, email_confirm: true, user_metadata: { full_name: fullName, login_type: "warehouse_pin" } });
  if (createError || !created.user) return NextResponse.json({ error: createError?.message?.includes("registered") ? "ชื่อผู้ใช้นี้มีอยู่แล้ว" : "สร้างบัญชี PIN ไม่สำเร็จ" }, { status: 400 });
  const { error: profileError } = await service.from("floor_staff_profiles").insert({ id: created.user.id, email, full_name: fullName, role: "warehouse", is_active: true, role_source: "manual", access_scope: "warehouse_prep_only", pin_username: username });
  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.code === "23505" ? "ชื่อผู้ใช้นี้มีอยู่แล้ว" : "สร้างโปรไฟล์คลังไม่สำเร็จ" }, { status: 400 });
  }
  return NextResponse.json({ username, fullName });
}

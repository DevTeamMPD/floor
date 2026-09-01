import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER, canRoleAccessPath } from "@/lib/page-access";
import type { StaffRole } from "@/lib/staff";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/work",
  "/dispatch",
  "/track",
  "/status",
  "/eval",
  "/api",
  "/manifest.webmanifest",
  "/floor-sw.js",
];
// Active FloorNow staff share visibility of operational data.  Access to state
// transitions and administration remains enforced by RLS/RPC capability checks.
const ADMIN_ONLY_PREFIXES = ["/staff"];
// หน้าปฏิเสธสิทธิ์เองต้องเข้าได้เสมอ ไม่งั้นจะ rewrite วนไม่รู้จบ
const ACCESS_DENIED_PATH = "/access-denied";
const ACCESS_EXEMPT_PREFIXES = [ACCESS_DENIED_PATH];

export async function middleware(request: NextRequest) {
  request.headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // Local is a safe, isolated preview environment.  Let the team review every
  // screen there without first creating a Supabase session; production keeps
  // the normal sign-in and profile checks below.
  const isLocalDevelopment = request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1";
  if (isLocalDevelopment) {
    request.cookies.set("floor_local_demo", "1");
    response = NextResponse.next({ request });
    response.cookies.set("floor_local_demo", "1", { httpOnly: true, sameSite: "lax", path: "/" });
  } else if (request.cookies.has("floor_local_demo")) {
    response.cookies.delete("floor_local_demo");
  }
  const isPublic = isLocalDevelopment || PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  let profile: { role: string; is_active: boolean } | null = null;
  if (user) {
    const { data } = await supabase.from("floor_staff_profiles").select("role,is_active").eq("id", user.id).maybeSingle();
    profile = data;
  }
  if (user && path === "/login" && profile?.is_active) {
    const home = request.nextUrl.clone();
    home.pathname = "/home";
    home.search = "";
    return NextResponse.redirect(home);
  }
  if (user && !isPublic) {
    if (!profile?.is_active) {
      const login = request.nextUrl.clone(); login.pathname = "/login"; login.search = "";
      return NextResponse.redirect(login);
    }
    const isAdminOnly = ADMIN_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
    if (profile.role !== "admin" && isAdminOnly) {
      const home = request.nextUrl.clone(); home.pathname = "/home"; home.search = "";
      return NextResponse.redirect(home);
    }
    // ด่านสิทธิ์ระดับหน้า (P5-6) — ก่อนหน้านี้มีแค่ /staff ที่ถูกกันจริง หน้าที่เหลือ
    // พึ่ง "เมนูไม่โชว์" ซึ่งไม่ได้กันใครเลยเมื่อพิมพ์ URL ตรง ๆ
    //
    // ใช้ rewrite ไม่ใช่ redirect ด้วยเหตุผลสองข้อ:
    //   1) rewrite ทำให้โค้ดของหน้าที่ถูกกันไม่ถูกรันเลยแม้แต่ฝั่งเซิร์ฟเวอร์
    //      (redirect ก็ได้ผลเหมือนกัน แต่ผู้ใช้จะเด้งไปหน้าอื่นโดยไม่รู้ว่าเพราะอะไร)
    //   2) URL เดิมยังอยู่บนแถบที่อยู่ ผู้ใช้จึงเห็นว่าตัวเองพยายามเข้าหน้าไหน
    //      และหน้าปฏิเสธอ่านค่านั้นไปแสดงพร้อมบอกว่าต้องเป็นตำแหน่งไหนถึงเข้าได้
    if (!ACCESS_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"))
        && !canRoleAccessPath(profile.role as StaffRole, path)) {
      const denied = request.nextUrl.clone();
      denied.pathname = ACCESS_DENIED_PATH;
      denied.search = "";
      return NextResponse.rewrite(denied, { request });
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

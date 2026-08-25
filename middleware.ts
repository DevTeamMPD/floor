import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
const ADMIN_ONLY_PREFIXES = ["/staff", "/service", "/documents"];

// Route protection ตาม role (allow-list) — เฉพาะหน้าที่เป็นของฝ่ายใดฝ่ายหนึ่งชัดเจน
// admin + staff เข้าได้ทุกหน้าเสมอ (staff = ยังไม่ระบุหน้าที่ กัน lockout)
// หน้าที่ไม่อยู่ในแมพ (เช่น /home, /orders, /tech-queue) = เข้าได้ทุก role ที่ login
// สำคัญ: ห้ามใส่ /home เพราะเป็นปลายทาง redirect (จะวน loop)
const ROUTE_ROLES: Record<string, string[]> = {
  "/sales-queue": ["sales"],
  "/operations": ["head_technician"],
  "/appointments": ["head_technician"],
  "/technicians": ["head_technician"],
  "/pipeline": ["head_technician"],
  "/ncr": ["head_technician"],
  "/warehouse": ["warehouse"],
  "/remnants": ["warehouse"],
  "/inventory": ["warehouse"],
  "/waste-cost": ["warehouse"],
  "/bom": ["warehouse"],
  "/purchase-orders": ["warehouse"],
  "/cs-tracking": ["cs"],
  "/exec": ["executive"],
  "/dashboard": ["cs", "executive"],
};

export async function middleware(request: NextRequest) {
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
  const isPublic = PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
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
    // Role-based route protection (defense-in-depth เพิ่มจากการซ่อนเมนู)
    // admin/staff ผ่านทุกหน้า; หน้าที่อยู่ในแมพต้องมี role ตรง ไม่งั้น redirect /home
    if (profile.role !== "admin" && profile.role !== "staff") {
      const matched = Object.keys(ROUTE_ROLES).find((prefix) => path === prefix || path.startsWith(prefix + "/"));
      if (matched && !ROUTE_ROLES[matched].includes(profile.role)) {
        const home = request.nextUrl.clone(); home.pathname = "/home"; home.search = "";
        return NextResponse.redirect(home);
      }
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

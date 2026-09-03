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
  "/lendi-engineering-logo.png",
  "/lendi-space-logo.png",
];
// Active FloorNow staff share visibility of operational data.  Access to state
// transitions and administration remains enforced by RLS/RPC capability checks.
const ADMIN_ONLY_PREFIXES = ["/staff"];

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
  // Local is a safe, isolated preview environment.  Let the team review every
  // screen there without first creating a Supabase session; production keeps
  // the normal sign-in and profile checks below.
  const isLocalDevelopment = request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1";
  const isLocalWarehousePin = isLocalDevelopment && request.cookies.get("floor_local_warehouse_pin")?.value === "1";
  if (isLocalWarehousePin && !(path === "/warehouse" || path.startsWith("/warehouse/") || path === "/login")) {
    const warehouse = request.nextUrl.clone(); warehouse.pathname = "/warehouse"; warehouse.search = "";
    return NextResponse.redirect(warehouse);
  }
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
  let profile: { role: string; is_active: boolean; access_scope?: string | null } | null = null;
  if (user) {
    const { data } = await supabase.from("floor_staff_profiles").select("role,is_active,access_scope").eq("id", user.id).maybeSingle();
    profile = data;
  }
  if (user && path === "/login" && profile?.is_active) {
    const home = request.nextUrl.clone();
    home.pathname = profile.access_scope === "warehouse_prep_only" ? "/warehouse" : "/home";
    home.search = "";
    return NextResponse.redirect(home);
  }
  if (user && !isPublic) {
    if (!profile?.is_active) {
      const login = request.nextUrl.clone(); login.pathname = "/login"; login.search = "";
      return NextResponse.redirect(login);
    }
    if (profile.access_scope === "warehouse_prep_only" && !(path === "/warehouse" || path.startsWith("/warehouse/"))) {
      const warehouse = request.nextUrl.clone(); warehouse.pathname = "/warehouse"; warehouse.search = "";
      return NextResponse.redirect(warehouse);
    }
    const isAdminOnly = ADMIN_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
    if (profile.role !== "admin" && isAdminOnly) {
      const home = request.nextUrl.clone(); home.pathname = "/home"; home.search = "";
      return NextResponse.redirect(home);
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

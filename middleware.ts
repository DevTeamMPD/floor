import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/auth", "/work", "/dispatch", "/track", "/eval", "/api"];
const ROLE_ACCESS: Record<string, string[]> = {
  sales: ["/", "/sales-queue", "/share/queue", "/tech-queue"],
  head_technician: ["/", "/operations", "/appointments", "/pipeline", "/technicians", "/ncr"],
  cs: ["/", "/cs-tracking", "/dashboard"],
  executive: ["/", "/exec", "/dashboard"],
  warehouse: ["/", "/inventory", "/remnants", "/waste-cost", "/bom", "/purchase-orders"],
};
const ROLE_HOME: Record<string, string> = { sales: "/sales-queue", head_technician: "/operations", cs: "/cs-tracking", executive: "/exec", warehouse: "/inventory" };

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
    home.pathname = ROLE_HOME[profile.role] ?? "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  if (user && !isPublic) {
    if (!profile?.is_active) {
      const login = request.nextUrl.clone(); login.pathname = "/login"; login.search = "";
      return NextResponse.redirect(login);
    }
    if (profile.role !== "admin") {
      const allowed = ROLE_ACCESS[profile.role] ?? ["/"];
      const canAccess = allowed.some((prefix) => path === prefix || (prefix !== "/" && path.startsWith(prefix + "/")));
      if (!canAccess) {
        const home = request.nextUrl.clone(); home.pathname = ROLE_HOME[profile.role] ?? "/"; home.search = "";
        return NextResponse.redirect(home);
      }
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

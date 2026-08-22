import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  deviceToken: z.string().uuid(),
  sessionId: z.string().uuid(),
  origin: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  destination: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
});

interface GoogleRouteResponse {
  routes?: Array<{ duration?: string; distanceMeters?: number }>;
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "routes_not_configured" }, { status: 503 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { origin, destination, deviceToken, sessionId } = parsed.data;
  const { data: allowed, error: authorizationError } = await supabase.rpc("can_request_floor_tracking_eta", {
    p_device_token: deviceToken,
    p_session_id: sessionId,
  });
  if (authorizationError || !allowed) {
    return NextResponse.json({ error: "tracking_session_not_found_or_throttled" }, { status: 403 });
  }

  let routeResponse: Response;
  try {
    routeResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: origin } },
        destination: { location: { latLng: destination } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "th",
        units: "METRIC",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return NextResponse.json({ error: "route_lookup_timeout" }, { status: 504 });
  }
  if (!routeResponse.ok) {
    return NextResponse.json({ error: "route_lookup_failed" }, { status: 502 });
  }

  const routeData = (await routeResponse.json()) as GoogleRouteResponse;
  const route = routeData.routes?.[0];
  const durationSeconds = Number(route?.duration?.replace(/s$/, ""));
  if (!route || !Number.isFinite(durationSeconds) || typeof route.distanceMeters !== "number") {
    return NextResponse.json({ error: "route_not_found" }, { status: 404 });
  }

  const etaMinutes = Math.max(0, Math.ceil(durationSeconds / 60));
  const { data: saved, error: saveError } = await supabase.rpc("set_floor_tracking_eta", {
    p_device_token: deviceToken,
    p_session_id: sessionId,
    p_distance_meters: Math.max(0, Math.round(route.distanceMeters)),
    p_eta_minutes: etaMinutes,
  });
  if (saveError || !saved) {
    return NextResponse.json({ error: "tracking_session_not_found" }, { status: 403 });
  }

  return NextResponse.json({ distanceMeters: route.distanceMeters, etaMinutes });
}

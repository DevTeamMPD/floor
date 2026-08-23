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

const EARTH_RADIUS_METERS = 6_371_000;
const ROAD_DISTANCE_FACTOR = 1.35;
const MIN_CITY_SPEED_KPH = 12;
const DEFAULT_CITY_SPEED_KPH = 28;
const MAX_CITY_SPEED_KPH = 60;

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function haversineMeters(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLng = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateEta(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  const straightLineMeters = haversineMeters(origin, destination);
  const distanceMeters = Math.round(straightLineMeters * ROAD_DISTANCE_FACTOR);
  if (distanceMeters < 50) return { distanceMeters: 0, etaMinutes: 0 };

  const distanceKm = distanceMeters / 1000;
  const speedKph = Math.min(
    MAX_CITY_SPEED_KPH,
    Math.max(MIN_CITY_SPEED_KPH, DEFAULT_CITY_SPEED_KPH - Math.min(8, distanceKm * 0.25)),
  );
  const etaMinutes = Math.max(1, Math.ceil((distanceKm / speedKph) * 60));
  return { distanceMeters, etaMinutes };
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { origin, destination, deviceToken, sessionId } = parsed.data;
  const { data: allowed, error: authorizationError } = await supabase.rpc("can_request_floor_tracking_eta", {
    p_device_token: deviceToken,
    p_session_id: sessionId,
  });
  if (authorizationError || !allowed) {
    return NextResponse.json({ error: "tracking_session_not_found_or_throttled" }, { status: 403 });
  }

  const estimate = estimateEta(origin, destination);
  const { data: saved, error: saveError } = await supabase.rpc("set_floor_tracking_eta", {
    p_device_token: deviceToken,
    p_session_id: sessionId,
    p_distance_meters: estimate.distanceMeters,
    p_eta_minutes: estimate.etaMinutes,
  });
  if (saveError || !saved) {
    return NextResponse.json({ error: "tracking_session_not_found" }, { status: 403 });
  }

  return NextResponse.json({ ...estimate, provider: "local_estimate" });
}

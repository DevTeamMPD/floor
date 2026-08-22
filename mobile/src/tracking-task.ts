import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACTIVE_SESSION_KEY, DEVICE_TOKEN_KEY, secureStorage } from "./secure-store";
import { supabase } from "./supabase";
import type { ActiveTrackingSession } from "./types";
import { config } from "./config";

export const LOCATION_TASK_NAME = "floornow-background-location";

interface QueuedLocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  capturedAt: string;
}

function outboxKey(sessionId: string) {
  return `floornow-location-outbox:${sessionId}`;
}

async function loadOutbox(sessionId: string): Promise<QueuedLocationPoint[]> {
  const raw = await AsyncStorage.getItem(outboxKey(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.slice(-500) as QueuedLocationPoint[] : [];
  } catch {
    return [];
  }
}

async function saveOutbox(sessionId: string, points: QueuedLocationPoint[]) {
  const key = outboxKey(sessionId);
  if (!points.length) return AsyncStorage.removeItem(key);
  return AsyncStorage.setItem(key, JSON.stringify(points.slice(-500)));
}

async function ensureFreshSession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  if ((session.expires_at ?? 0) * 1000 > Date.now() + 2 * 60_000) return session;
  const refreshed = await supabase.auth.refreshSession();
  return refreshed.data.session;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;

    const [deviceToken, activeRaw] = await Promise.all([
      secureStorage.getItem(DEVICE_TOKEN_KEY),
      secureStorage.getItem(ACTIVE_SESSION_KEY),
    ]);
    if (!deviceToken || !activeRaw) return;

    let active: ActiveTrackingSession;
    try {
      active = JSON.parse(activeRaw) as ActiveTrackingSession;
    } catch {
      return;
    }

    const points: QueuedLocationPoint[] = data.locations.map((location) => ({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
      speed: location.coords.speed,
      heading: location.coords.heading,
      capturedAt: new Date(location.timestamp).toISOString(),
    }));

    let outbox = [...await loadOutbox(active.sessionId), ...points].slice(-500);
    await saveOutbox(active.sessionId, outbox);

    const session = await ensureFreshSession();
    if (!session) return;

    for (let attempt = 0; attempt < 3 && outbox.length; attempt += 1) {
      const batch = outbox.slice(0, 50);
      const { error: locationError } = await supabase.rpc("record_floor_location_batch", {
        p_device_token: deviceToken,
        p_session_id: active.sessionId,
        p_points: batch,
      });
      if (locationError) return;
      outbox = outbox.slice(batch.length);
      await saveOutbox(active.sessionId, outbox);
    }

    const lastEtaAt = active.lastEtaAt ? new Date(active.lastEtaAt).getTime() : 0;
    if (Date.now() - lastEtaAt < 5 * 60_000) return;
    const latest = points[points.length - 1];
    if (!latest) return;

    const response = await fetch(`${config.floorNowApiUrl}/api/tracking/eta`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceToken,
        sessionId: active.sessionId,
        origin: { latitude: latest.latitude, longitude: latest.longitude },
        destination: {
          latitude: active.destinationLatitude,
          longitude: active.destinationLongitude,
        },
      }),
    });
    if (response.ok) {
      active.lastEtaAt = new Date().toISOString();
      await secureStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(active));
    }
  },
);

export async function startBackgroundTracking(active: ActiveTrackingSession) {
  await secureStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(active));
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 60_000,
    distanceInterval: 250,
    deferredUpdatesDistance: 250,
    deferredUpdatesInterval: 60_000,
    activityType: Location.LocationActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "FloorNow กำลังแชร์ตำแหน่งงาน",
      notificationBody: "แตะเพื่อเปิดงานปัจจุบัน ตำแหน่งจะหยุดเมื่อปิดงาน",
      notificationColor: "#1559C9",
      killServiceOnDestroy: false,
    },
  });
}

export async function stopBackgroundTracking() {
  const activeRaw = await secureStorage.getItem(ACTIVE_SESSION_KEY);
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (activeRaw) {
    try {
      const active = JSON.parse(activeRaw) as ActiveTrackingSession;
      await AsyncStorage.removeItem(outboxKey(active.sessionId));
    } catch {
      // Ignore a corrupt local session marker; SecureStore is cleared below.
    }
  }
  await secureStorage.removeItem(ACTIVE_SESSION_KEY);
}

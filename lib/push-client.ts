export interface BrowserPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushAvailability = "supported" | "ios-install-required" | "permission-denied" | "unsupported";

export function getPushAvailability(): PushAvailability {
  if (typeof window === "undefined") return "unsupported";
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (isIOS && !isStandalone) return "ios-install-required";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "permission-denied";
  return "supported";
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(Array.from(raw).map((character) => character.charCodeAt(0)));
}

export function canUseWebPush() {
  return getPushAvailability() === "supported";
}

export async function subscribeBrowserToPush(): Promise<BrowserPushSubscription> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error("ระบบ Push ยังไม่ได้ตั้งค่า VAPID key");
  const availability = getPushAvailability();
  if (availability === "ios-install-required") throw new Error("iPhone ต้องเพิ่ม FloorNow ไปยังหน้าจอโฮม แล้วเปิดจากไอคอน FloorNow ก่อนเปิดแจ้งเตือน");
  if (availability === "permission-denied") throw new Error("สิทธิ์แจ้งเตือนถูกปิด กรุณาเปิดที่ Settings > Notifications > FloorNow");
  if (availability !== "supported") throw new Error("เบราว์เซอร์เครื่องนี้ไม่รองรับการแจ้งเตือน");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("กรุณาอนุญาตการแจ้งเตือนในเบราว์เซอร์");
  const registration = await navigator.serviceWorker.register("/floor-sw.js", { scope: "/" });
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("สร้าง Push subscription ไม่สำเร็จ");
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

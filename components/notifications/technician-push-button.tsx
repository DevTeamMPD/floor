"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getPushAvailability, subscribeBrowserToPush } from "@/lib/push-client";

export default function TechnicianPushButton({ token, pin }: { token: string; pin: string }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function enable() {
    const availability = getPushAvailability();
    if (availability === "ios-install-required") { setMessage("iPhone: แตะปุ่มแชร์ > เพิ่มไปยังหน้าจอโฮม แล้วเปิด FloorNow จากไอคอนก่อนเปิดแจ้งเตือน"); return; }
    if (availability === "permission-denied") { setMessage("สิทธิ์ถูกปิด กรุณาเปิดที่ Settings > Notifications > FloorNow"); return; }
    if (availability === "unsupported") { setMessage("เบราว์เซอร์เครื่องนี้ไม่รองรับ Web Push"); return; }
    setBusy(true); setMessage(null);
    try {
      const subscription = await subscribeBrowserToPush();
      const supabase = createClient();
      const { error } = await supabase.rpc("register_technician_push_subscription", {
        p_token: token, p_pin: pin.trim(), p_endpoint: subscription.endpoint,
        p_p256dh: subscription.p256dh, p_auth_secret: subscription.auth,
        p_platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "ios-web" : /Android/i.test(navigator.userAgent) ? "android-web" : "web",
        p_user_agent: navigator.userAgent,
      });
      if (error) throw error;
      setReady(true); setMessage("มือถือเครื่องนี้พร้อมรับแจ้งเตือนงานใหม่แล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เปิดการแจ้งเตือนไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  return <div className="mt-3">
    <button type="button" onClick={() => void enable()} disabled={busy || ready} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-60">
      <BellRing className="h-4 w-4" />{ready ? "เปิดแจ้งเตือนแล้ว" : busy ? "กำลังเปิด…" : "รับแจ้งเตือนงานบนมือถือเครื่องนี้"}
    </button>
    {message ? <div className={`mt-2 text-xs ${ready ? "text-emerald-300" : "text-amber-300"}`}>{message}</div> : null}
  </div>;
}

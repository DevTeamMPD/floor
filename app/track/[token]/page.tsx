"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Status = "travelling" | "arrived" | "installing" | "completed" | "cancelled";

interface TrackingEvent {
  status: Status | "customer_signed";
  note: string | null;
  photoPaths: string[];
  occurredAt: string;
}

interface CustomerTracking {
  jobNo: string | null;
  customerName: string | null;
  appointmentStart: string;
  appointmentEnd: string;
  teamName: string | null;
  technicianName: string;
  status: Status;
  distanceMeters: number | null;
  etaMinutes: number | null;
  etaUpdatedAt: string | null;
  locationUpdatedAt: string | null;
  sharingEndedAt: string | null;
  customerSignedAt: string | null;
  events: TrackingEvent[];
}

const STATUS_LABELS: Record<TrackingEvent["status"], string> = {
  travelling: "กำลังเดินทาง",
  arrived: "ถึงบ้านลูกค้าแล้ว",
  installing: "กำลังติดตั้ง",
  completed: "ติดตั้งเสร็จสมบูรณ์",
  customer_signed: "ลูกค้าเซ็นรับงานแล้ว",
  cancelled: "ยกเลิกการแชร์สถานะ",
};

function thaiDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("th-TH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  });
}

function distanceLabel(meters: number | null) {
  if (meters === null) return "กำลังคำนวณ";
  if (meters < 1000) return `${meters.toLocaleString("th-TH")} เมตร`;
  return `${(meters / 1000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} กม.`;
}

export default function CustomerTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [tracking, setTracking] = useState<CustomerTracking | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_floor_customer_tracking", { p_customer_token: token });
    if (!error && data) setTracking(data as CustomerTracking);
    else setTracking(null);
    setLoading(false);
  }, [supabase, token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">กำลังโหลดสถานะทีมช่าง…</main>;
  if (!tracking) return <main className="min-h-screen bg-slate-50 grid place-items-center p-6 text-center"><div><div className="text-4xl mb-3">🔒</div><h1 className="font-semibold">ลิงก์หมดอายุหรือไม่ถูกต้อง</h1><p className="text-sm text-slate-500 mt-1">กรุณาติดต่อฝ่ายขายเพื่อขอลิงก์สถานะล่าสุด</p></div></main>;

  return <main className="min-h-screen bg-slate-50 pb-12">
    <header className="bg-slate-950 text-white px-4 py-5">
      <div className="max-w-2xl mx-auto"><div className="text-xs text-slate-400">MPD FloorNow · ติดตามทีมติดตั้ง</div><h1 className="text-xl font-semibold mt-1">{tracking.customerName ?? "งานติดตั้งของคุณ"}</h1><div className="text-sm text-slate-300">{tracking.teamName ?? "ทีมช่าง"} · {tracking.technicianName}</div></div>
    </header>
    <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <section className="rounded-2xl bg-blue-600 p-5 text-white shadow-sm">
        <div className="text-sm text-blue-100">สถานะล่าสุด</div>
        <div className="mt-1 text-2xl font-semibold">{STATUS_LABELS[tracking.status]}</div>
        {tracking.status === "travelling" ? <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/15 p-3"><div className="text-xs text-blue-100">เวลาถึงโดยประมาณ</div><div className="mt-1 text-xl font-semibold">{tracking.etaMinutes === null ? "กำลังคำนวณ" : `อีก ${tracking.etaMinutes} นาที`}</div></div><div className="rounded-xl bg-white/15 p-3"><div className="text-xs text-blue-100">ระยะทางคงเหลือ</div><div className="mt-1 text-xl font-semibold">{distanceLabel(tracking.distanceMeters)}</div></div></div> : null}
        <div className="mt-4 text-xs text-blue-100">ตำแหน่งอัปเดตล่าสุด {thaiDateTime(tracking.locationUpdatedAt)}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">กำหนดการ</h2>
        <div className="mt-3 text-sm text-slate-700">{thaiDateTime(tracking.appointmentStart)} – {thaiDateTime(tracking.appointmentEnd)}</div>
        <div className="mt-1 text-xs text-slate-400">เลขงาน {tracking.jobNo ?? "—"}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">ลำดับสถานะและภาพหลักฐาน</h2>
        <div className="mt-4 space-y-5">
          {tracking.events.map((event, index) => <article key={`${event.status}-${event.occurredAt}-${index}`} className="relative border-l-2 border-emerald-300 pl-4">
            <div className="absolute -left-[7px] top-0 h-3 w-3 rounded-full bg-emerald-500" />
            <div className="font-medium text-slate-900">{STATUS_LABELS[event.status]}</div>
            <div className="text-xs text-slate-400">{thaiDateTime(event.occurredAt)}</div>
            {event.note ? <div className="mt-2 text-sm text-slate-600">{event.note}</div> : null}
            {event.photoPaths.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{event.photoPaths.map((path) => {
              const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
              return <a key={path} href={data.publicUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><Image src={data.publicUrl} alt={`ภาพหลักฐาน ${STATUS_LABELS[event.status]}`} width={640} height={360} sizes="(max-width: 640px) 50vw, 210px" unoptimized className="aspect-video h-full w-full object-cover" /></a>;
            })}</div> : null}
          </article>)}
        </div>
      </section>

      <p className="px-1 text-xs leading-relaxed text-slate-400">เพื่อความปลอดภัย หน้านี้แสดงเฉพาะสถานะ ระยะทาง และเวลาถึงโดยประมาณ ไม่แสดงตำแหน่ง GPS ที่แน่นอนของพนักงาน</p>
    </div>
  </main>;
}

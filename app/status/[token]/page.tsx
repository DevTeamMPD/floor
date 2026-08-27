"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/work-orders";

interface Technician { name: string; isLead: boolean }
interface Milestone { type: string; occurredAt: string; photoPaths: string[] }
interface CustomerSummary { caption: string; photoPaths: string[]; updatedAt: string | null }
interface ExternalOrder {
  jobNo: string; status: WorkOrderStatus; updatedAt: string; customerName: string | null; productName: string | null;
  appointmentStart: string; appointmentEnd: string; address: string | null; locationUrl: string | null; teamName: string | null;
  trackingToken: string | null; customerSummary?: CustomerSummary; technicians: Technician[]; milestones: Milestone[];
}

const EVENT_LABELS: Record<string, string> = {
  created: "สร้างใบสั่งงาน", returned_for_correction: "ส่งกลับแก้ไข", sales_resubmitted: "ส่งตรวจใหม่",
  bbps_resubmitted: "BBPS ส่งข้อมูลใหม่", head_confirmed: "หัวหน้าช่างอนุมัติ", warehouse_accepted: "คลังรับงาน",
  warehouse_completed: "เตรียมสินค้าเสร็จ", installation_accepted: "ทีมช่างรับงานติดตั้ง", progress: "อัปเดตหน้างาน",
  customer_signed: "ลูกค้าเซ็นรับงาน", cs_closed: "ปิดงานแล้ว",
};
function thaiDate(value: string) { return new Date(value).toLocaleString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }

export default function ExternalWorkOrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params); const supabase = useMemo(() => createClient(), []); const [order, setOrder] = useState<ExternalOrder | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { const { data, error } = await supabase.rpc("get_floor_external_work_order_v3", { p_token: token }); setOrder(!error && data ? data as ExternalOrder : null); setLoading(false); }, [supabase, token]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(timer); }, [load]);
  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">กำลังโหลดสถานะงาน…</main>;
  if (!order) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center"><div><div className="text-4xl">🔒</div><h1 className="mt-3 font-semibold">ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว</h1><p className="mt-1 text-sm text-slate-500">กรุณาติดต่อผู้ประสานงานเพื่อขอลิงก์ใหม่</p></div></main>;
  return <main className="min-h-screen bg-slate-50 pb-12"><header className="bg-slate-950 px-4 py-6 text-white"><div className="mx-auto max-w-2xl"><div className="text-xs text-slate-400">MPD FloorNow · หน้าติดตามสำหรับลูกค้า</div><h1 className="mt-1 text-xl font-semibold">{order.customerName || "งานติดตั้งของคุณ"}</h1><p className="mt-1 text-sm text-slate-300">เลขงาน {order.jobNo}</p></div></header>
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="font-semibold">หน้านี้เป็นลิงก์ติดตามสำหรับลูกค้า ไม่ใช่ใบงานช่าง</div><p className="mt-1 text-xs text-amber-700">ใบงานช่างจะเป็นลิงก์ /work/ และต้องเปิดด้วย PIN ของช่างที่ได้รับมอบหมาย</p></section>
      <section className="rounded-2xl bg-blue-600 p-5 text-white shadow-sm"><div className="text-sm text-blue-100">สถานะล่าสุด</div><div className="mt-1 text-2xl font-semibold">{WORK_ORDER_STATUS_LABELS[order.status] || order.status}</div><div className="mt-3 text-xs text-blue-100">อัปเดต {thaiDate(order.updatedAt)}</div>{order.trackingToken ? <Link href={`/track/${order.trackingToken}`} className="mt-4 block rounded-xl bg-white px-4 py-3 text-center text-sm font-semibold text-blue-700">ดูตำแหน่งและ ETA ของทีมช่าง</Link> : null}</section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">วันนัดและข้อมูลสำหรับลูกค้า</h2><div className="mt-3 space-y-3 text-sm text-slate-700"><div><div className="text-xs text-slate-400">วันเวลา</div>{thaiDate(order.appointmentStart)} – {new Date(order.appointmentEnd).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น.</div><div><div className="text-xs text-slate-400">ขอบเขตงาน</div>{order.productName || "ยังไม่มีข้อมูลขอบเขตงานจากต้นทาง"}</div><div><div className="text-xs text-slate-400">สถานที่</div>{order.address || "ยังไม่มีข้อมูลสถานที่จากต้นทาง"}</div>{order.locationUrl ? <a href={order.locationUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-lg bg-blue-50 px-3 py-2 font-medium text-blue-700">📍 เปิดแผนที่</a> : null}</div></section>
      {(order.customerSummary?.caption || order.customerSummary?.photoPaths?.length) ? <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-violet-950">🖼️ ภาพสรุปจากฝ่ายขาย</h2>{order.customerSummary?.updatedAt ? <span className="text-xs text-violet-600">อัปเดต {thaiDate(order.customerSummary.updatedAt)}</span> : null}</div>{order.customerSummary?.caption ? <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{order.customerSummary.caption}</p> : null}{order.customerSummary?.photoPaths?.length ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{order.customerSummary.photoPaths.map((path, index) => { const url = path.startsWith("http") ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl; return <a key={path} href={url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-xl border border-violet-200 bg-white"><img src={url} alt={`ภาพสรุป ${index + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" /><span className="absolute bottom-2 right-2 rounded bg-black/65 px-2 py-1 text-xs text-white">ดูรูป {index + 1}</span></a>; })}</div> : null}</section> : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">ทีมผู้รับผิดชอบ</h2><p className="mt-1 text-sm text-slate-500">{order.teamName || "ทีมติดตั้ง"}</p><div className="mt-3 flex flex-wrap gap-2">{order.technicians.map((tech) => <span key={`${tech.name}-${tech.isLead}`} className={`rounded-full px-3 py-1.5 text-sm ${tech.isLead ? "bg-violet-100 font-medium text-violet-700" : "bg-slate-100 text-slate-600"}`}>{tech.name}{tech.isLead ? " · หัวหน้าทีม" : ""}</span>)}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">ประวัติความคืบหน้า</h2><div className="mt-4 space-y-4">{order.milestones.map((event, index) => <div key={`${event.type}-${event.occurredAt}-${index}`} className="border-l-2 border-blue-200 pl-3"><div className="text-sm font-medium text-slate-800">{EVENT_LABELS[event.type] || "อัปเดตสถานะงาน"}</div><div className="text-xs text-slate-400">{thaiDate(event.occurredAt)}</div>{event.photoPaths?.length ? <div className="mt-2 grid grid-cols-3 gap-2">{event.photoPaths.map((path) => { const url = path.startsWith("http") ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl; return <a key={path} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg border bg-slate-100"><img src={url} alt="ภาพความคืบหน้า" className="h-full w-full object-cover" /></a>; })}</div> : null}</div>)}{!order.milestones.length ? <p className="text-sm text-slate-400">ยังไม่มีการอัปเดต</p> : null}</div></section>
    </div>
  </main>;
}

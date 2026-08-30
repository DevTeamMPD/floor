"use client";

import { useCallback, useEffect, useState } from "react";

type Health = {
  queue: Record<string, number>;
  missing: { jobNo: string; workOrderStatus: string; documentType: string; updatedAt: string }[];
  failed: { id: string; job_no: string; document_type: string; status: string; attempt_count: number; max_attempts: number; last_error: string | null; updated_at: string }[];
  csatDue: { job_no: string; due_at: string }[];
  generatedAt: string;
};

const LABEL: Record<string, string> = { work_order: "ใบสั่งงาน", boq: "BOQ", pick_confirmation: "ใบยืนยันการหยิบ", installation_report: "รายงานติดตั้ง", customer_acceptance: "ใบรับมอบ", remnant_report: "รายงานเศษ", handover: "ใบส่งมอบ", csat: "ประเมินหลังการขาย", ncr: "NCR" };
function dateTime(value: string) { return new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }); }

export default function DocumentControlPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch("/api/documents/health", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setData(payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);
  async function retry(id: string) { const response = await fetch("/api/documents/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); const payload = await response.json(); if (!response.ok) { setError(payload.error || "นำกลับเข้าคิวไม่สำเร็จ"); return; } await load(); }
  useEffect(() => { void load(); }, [load]);
  return <main className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-blue-600">ISO DOCUMENT CONTROL</p><h1 className="mt-1 text-2xl font-bold text-slate-950">ศูนย์ควบคุมเอกสารงาน</h1><p className="mt-1 text-sm text-slate-600">เห็นคิวสร้างเอกสาร เอกสารขาด และรายการที่ต้องแก้จากหน้าเดียว</p></div><button onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">รีเฟรช</button></header>
    {loading ? <div className="rounded-2xl border bg-white p-10 text-center text-slate-500">กำลังตรวจเอกสาร…</div> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div> : data ? <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="รอสร้าง" value={(data.queue.pending ?? 0) + (data.queue.processing ?? 0)} tone="blue"/><Metric label="กำลัง retry" value={data.queue.retrying ?? 0} tone="amber"/><Metric label="สร้างไม่สำเร็จ" value={data.queue.failed ?? 0} tone="red"/><Metric label="เอกสารขาด" value={data.missing.length} tone="violet"/></section>
      <section className="grid gap-5 lg:grid-cols-2"><Panel title="เอกสารที่ยังขาด" count={data.missing.length}>{data.missing.length ? data.missing.map((item) => <a key={`${item.jobNo}-${item.documentType}`} href={`/orders/${encodeURIComponent(item.jobNo)}`} className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm hover:bg-slate-50"><span><b>{item.jobNo}</b><span className="ml-2 text-slate-500">{LABEL[item.documentType] ?? item.documentType}</span></span><span className="text-blue-600">เปิดงาน →</span></a>) : <Empty text="เอกสารตามเหตุการณ์ครบแล้ว"/>}</Panel>
      <Panel title="คิวที่ต้องตรวจ" count={data.failed.length}>{data.failed.length ? data.failed.map((item) => <div key={item.id} className="border-t px-4 py-3 text-sm"><div className="flex justify-between gap-3"><b>{item.job_no} · {LABEL[item.document_type] ?? item.document_type}</b><span className={item.status === "failed" ? "text-red-600" : "text-amber-600"}>{item.status}</span></div><p className="mt-1 text-xs text-slate-500">ลองแล้ว {item.attempt_count}/{item.max_attempts} · {item.last_error || "รอรอบถัดไป"}</p><button onClick={() => void retry(item.id)} className="mt-2 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700">ลองสร้างใหม่</button></div>) : <Empty text="ไม่มีคิวผิดพลาด"/>}</Panel></section>
      <Panel title="ติดตามประเมินหลังการขายภายใน 3 วัน" count={data.csatDue.length}>{data.csatDue.length ? data.csatDue.map((item) => <div key={item.job_no} className="flex justify-between border-t px-4 py-3 text-sm"><b>{item.job_no}</b><span className={new Date(item.due_at) < new Date() ? "font-semibold text-red-600" : "text-slate-600"}>ครบกำหนด {dateTime(item.due_at)}</span></div>) : <Empty text="ไม่มีรายการรอประเมิน"/>}</Panel>
      <p className="text-right text-xs text-slate-400">ตรวจล่าสุด {dateTime(data.generatedAt)}</p>
    </> : null}
  </main>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { const color: Record<string,string>={blue:"border-blue-200 bg-blue-50 text-blue-700",amber:"border-amber-200 bg-amber-50 text-amber-700",red:"border-red-200 bg-red-50 text-red-700",violet:"border-violet-200 bg-violet-50 text-violet-700"}; return <div className={`rounded-2xl border p-4 ${color[tone]}`}><div className="text-3xl font-bold">{value}</div><div className="mt-1 text-xs font-semibold">{label}</div></div>; }
function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex justify-between p-4"><h2 className="font-bold text-slate-900">{title}</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{count}</span></div>{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="border-t px-4 py-8 text-center text-sm text-emerald-700">✓ {text}</div>; }

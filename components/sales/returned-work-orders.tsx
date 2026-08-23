"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { WorkOrder } from "@/lib/work-orders";

interface Job {
  job_no: string; source: string | null; bill_no: string | null; customer_name: string | null;
  customer_phone: string | null; address: string | null; location_url: string | null; product_name: string | null; flag_note: string | null;
}
interface Draft { bill_no: string; customer_name: string; customer_phone: string; address: string; location_url: string; product_name: string }

function draftOf(job: Job): Draft {
  return { bill_no: job.bill_no ?? "", customer_name: job.customer_name ?? "", customer_phone: job.customer_phone ?? "", address: job.address ?? "", location_url: job.location_url ?? "", product_name: job.product_name ?? "" };
}

export default function ReturnedWorkOrders() {
  const supabase = useMemo(() => createClient(), []); const [orders, setOrders] = useState<WorkOrder[]>([]); const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [openId, setOpenId] = useState<string | null>(null); const [saving, setSaving] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); const { data: orderRows, error } = await supabase.from("floor_work_orders").select("*").eq("status", "returned_sales").order("returned_at", { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const rows = (orderRows ?? []) as WorkOrder[]; setOrders(rows);
    const { data: jobRows, error: jobError } = rows.length ? await supabase.from("install_jobs").select("job_no,source,bill_no,customer_name,customer_phone,address,location_url,product_name,flag_note").in("job_no", rows.map((row) => row.job_no)) : { data: [], error: null };
    if (jobError) toast.error(jobError.message); const list = (jobRows ?? []) as Job[]; setJobs(Object.fromEntries(list.map((row) => [row.job_no, row]))); setDrafts(Object.fromEntries(list.map((row) => [row.job_no, draftOf(row)]))); setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  function patch(jobNo: string, value: Partial<Draft>) { setDrafts((current) => ({ ...current, [jobNo]: { ...current[jobNo], ...value } })); }
  async function saveAndResubmit(order: WorkOrder) {
    const draft = drafts[order.job_no]; if (!draft) return;
    const missing = [!draft.bill_no.trim() ? "เลขบิล" : null, !draft.customer_name.trim() ? "ชื่อลูกค้า" : null, !draft.customer_phone.trim() ? "เบอร์โทร" : null, !draft.address.trim() && !draft.location_url.trim() ? "ที่อยู่หรือแผนที่" : null, !draft.product_name.trim() ? "สินค้า/ขอบเขตงาน" : null].filter(Boolean);
    if (missing.length) { toast.error(`กรอกให้ครบ: ${missing.join(", ")}`); return; }
    setSaving(order.id); const { error } = await supabase.from("install_jobs").update({ ...draft, updated_at: new Date().toISOString() }).eq("job_no", order.job_no);
    if (error) { toast.error(error.message); setSaving(null); return; }
    const { error: rpcError } = await supabase.rpc("resubmit_floor_work_order_v3", { p_work_order_id: order.id }); setSaving(null);
    if (rpcError) toast.error(rpcError.message); else { toast.success("แก้ข้อมูลและส่งให้หัวหน้าช่างตรวจใหม่แล้ว"); setOpenId(null); void load(); }
  }
  if (loading) return <div className="mb-5 rounded-2xl border bg-white p-5 text-sm text-slate-400">กำลังตรวจงานที่ถูกส่งกลับ…</div>;
  if (!orders.length) return null;
  return <section className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-amber-700">Inbox ฝ่ายขาย</div><h2 className="mt-1 text-lg font-bold text-amber-950">ต้องแก้ไข {orders.length} งาน</h2><p className="mt-1 text-sm text-amber-800">แก้ตามเหตุผลแล้วส่งกลับให้หัวหน้าช่างตรวจใหม่</p></div><span className="rounded-full bg-amber-600 px-3 py-1 text-sm font-bold text-white">{orders.length}</span></div>
    <div className="mt-4 space-y-3">{orders.map((order) => { const job = jobs[order.job_no]; const draft = drafts[order.job_no]; if (!job || !draft) return null; const isBbps = job.source === "bbps"; return <article key={order.id} className="rounded-xl border border-amber-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{job.customer_name || order.job_no}</h3>{isBbps ? <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">BBPS</span> : <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">ขายตรง</span>}</div><p className="mt-1 text-xs text-slate-400">#{order.job_no}{job.bill_no ? ` · บิล ${job.bill_no}` : ""}</p><div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">เหตุผล:</span> {order.returned_reason || job.flag_note || "ไม่ระบุ"}</div></div><div className="flex shrink-0 gap-2"><Link href={`/orders/${encodeURIComponent(order.job_no)}`} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600">ดูใบงาน</Link>{!isBbps ? <button onClick={() => setOpenId(openId === order.id ? null : order.id)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">{openId === order.id ? "ปิดฟอร์ม" : "แก้ไขข้อมูล"}</button> : null}</div></div>
      {isBbps ? <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800"><div className="font-semibold">แก้ข้อมูลที่ BBPS CRM</div><p className="mt-1 text-xs">FloorNow ล็อกข้อมูลต้นทางไว้ เมื่อ BBPS ส่ง revision ใหม่กลับมา งานจะออกจาก Inbox นี้อัตโนมัติ</p></div> : null}
      {!isBbps && openId === order.id ? <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><label className="text-xs text-slate-500">เลขบิล *<input value={draft.bill_no} onChange={(event) => patch(order.job_no, { bill_no: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500">ชื่อลูกค้า *<input value={draft.customer_name} onChange={(event) => patch(order.job_no, { customer_name: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500">เบอร์โทร *<input value={draft.customer_phone} onChange={(event) => patch(order.job_no, { customer_phone: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500">Google Maps<input value={draft.location_url} onChange={(event) => patch(order.job_no, { location_url: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500 sm:col-span-2">ที่อยู่หน้างาน *<textarea value={draft.address} onChange={(event) => patch(order.job_no, { address: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500 sm:col-span-2">สินค้า/ขอบเขตงาน *<textarea value={draft.product_name} onChange={(event) => patch(order.job_no, { product_name: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label><button onClick={() => void saveAndResubmit(order)} disabled={saving === order.id} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving === order.id ? "กำลังบันทึก…" : "บันทึกและส่งตรวจใหม่"}</button></div> : null}
    </article>; })}</div>
  </section>;
}

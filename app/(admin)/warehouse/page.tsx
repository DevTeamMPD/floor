"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import { WORK_ORDER_STATUS_LABELS, type WorkOrder, type WorkOrderItem, workOrderStatusClass } from "@/lib/work-orders";

interface Job { job_no: string; customer_name: string | null; product_name: string | null; address: string | null; bill_no: string | null }
interface Appointment { id: string; slot_start: string; slot_end: string; tech_id: string | null }
interface Staff { id: string; full_name: string }

function thaiDate(iso: string) { return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }

export default function WarehouseWorkspacePage() {
  const supabase = useMemo(() => createClient(), []); const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({}); const [appointments, setAppointments] = useState<Record<string, Appointment>>({});
  const [staff, setStaff] = useState<Record<string, Staff>>({}); const [items, setItems] = useState<WorkOrderItem[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState<string | null>(null); const [canAct, setCanAct] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); const { data: orderRows, error } = await supabase.from("floor_work_orders").select("*").in("status", ["warehouse_waiting", "warehouse_preparing", "ready_to_install"]).order("updated_at");
    if (error) { toast.error(floorErrorMessage(error)); setLoading(false); return; }
    const rows = (orderRows ?? []) as WorkOrder[]; setOrders(rows);
    const { data: { user } } = await supabase.auth.getUser();
    const [jobResult, apptResult, staffResult, itemResult, profileResult] = await Promise.all([
      rows.length ? supabase.from("install_jobs").select("job_no,customer_name,product_name,address,bill_no").in("job_no", Array.from(new Set(rows.map((row) => row.job_no)))) : Promise.resolve({ data: [] }),
      rows.length ? supabase.from("appointments").select("id,slot_start,slot_end,tech_id").in("id", rows.map((row) => row.appointment_id)) : Promise.resolve({ data: [] }),
      supabase.from("floor_staff_profiles").select("id,full_name"),
      rows.length ? supabase.from("floor_work_order_items").select("*").in("work_order_id", rows.map((row) => row.id)).order("sort_order") : Promise.resolve({ data: [] }),
      user ? supabase.from("floor_staff_profiles").select("id").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setCanAct(Boolean(profileResult.data));
    setJobs(Object.fromEntries(((jobResult.data ?? []) as Job[]).map((row) => [row.job_no, row]))); setAppointments(Object.fromEntries(((apptResult.data ?? []) as Appointment[]).map((row) => [row.id, row]))); setStaff(Object.fromEntries(((staffResult.data ?? []) as Staff[]).map((row) => [row.id, row]))); setItems((itemResult.data ?? []) as WorkOrderItem[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  async function accept(id: string) { if (!canAct) { toast.error("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานที่ Active"); return; } setSaving(id); const { error } = await supabase.rpc("accept_floor_warehouse_order_v2", { p_work_order_id: id }); setSaving(null); if (error) toast.error(floorErrorMessage(error)); else { toast.success("รับงานแล้ว"); void load(); } }
  const columns = ["warehouse_waiting", "warehouse_preparing", "ready_to_install"] as const;
  return <div className="mx-auto max-w-7xl"><div><div className="text-xs font-semibold uppercase tracking-wider text-blue-600">คลังสินค้า</div><h1 className="mt-1 text-2xl font-bold text-slate-950">เตรียมสินค้าสำหรับติดตั้ง</h1><p className="mt-1 text-sm text-slate-500">รับงาน → ตรวจรายการ → บันทึกจำนวนจริงและรูป → ส่งไปรอติดตั้ง</p></div>
    {!canAct && !loading ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">กรุณาเข้าสู่ระบบด้วยบัญชีพนักงาน Active เพื่อดำเนินการ</div> : null}
    {loading ? <div className="mt-6 rounded-2xl border bg-white p-12 text-center text-slate-400">กำลังโหลด…</div> : <div className="mt-6 grid gap-5 lg:grid-cols-3">{columns.map((status) => <section key={status} className="rounded-2xl bg-slate-100 p-3"><div className="flex items-center justify-between px-2 py-2"><h2 className="font-semibold text-slate-800">{WORK_ORDER_STATUS_LABELS[status]}</h2><span className="rounded-full bg-white px-2 py-1 text-xs text-slate-500">{orders.filter((row) => row.status === status).length}</span></div><div className="space-y-3">{orders.filter((row) => row.status === status).map((order) => { const job = jobs[order.job_no]; const appt = appointments[order.appointment_id]; const orderItems = items.filter((item) => item.work_order_id === order.id); return <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-950">{job?.customer_name || order.job_no}</h3><p className="mt-1 text-xs text-slate-400">#{order.job_no}{job?.bill_no ? ` · ${job.bill_no}` : ""}</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${workOrderStatusClass(order.status)}`}>{WORK_ORDER_STATUS_LABELS[order.status]}</span></div><div className="mt-3 space-y-1 text-xs text-slate-600"><div>📅 {appt ? thaiDate(appt.slot_start) : "—"}</div><div>🧱 {job?.product_name || "ยังไม่ระบุสินค้า"}</div><div>📦 {orderItems.length} รายการ · {orderItems.reduce((sum, item) => sum + Number(item.planned_qty), 0).toLocaleString()} หน่วยตามแผน</div>{order.warehouse_assignee_id ? <div>👤 ผู้รับงาน: {staff[order.warehouse_assignee_id]?.full_name || "—"}</div> : null}</div><div className="mt-4 flex gap-2"><Link href={`/orders/${encodeURIComponent(order.job_no)}`} className="flex-1 rounded-lg border border-blue-200 py-2 text-center text-xs font-medium text-blue-700">เปิดใบสั่งงาน</Link>{status === "warehouse_waiting" ? <button onClick={() => void accept(order.id)} disabled={saving === order.id} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white disabled:opacity-50">รับงาน</button> : null}</div></article>; })}{!orders.some((row) => row.status === status) ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">ไม่มีงาน</div> : null}</div></section>)}</div>}
  </div>;
}

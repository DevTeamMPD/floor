"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import { WORK_ORDER_STATUS_LABELS, type WorkOrder, type WorkOrderItem, workOrderStatusClass } from "@/lib/work-orders";
import TicketChatMock from "@/components/tickets/ticket-chat-mock";

interface Job { job_no: string; customer_name: string | null; product_name: string | null; address: string | null; bill_no: string | null }
interface Appointment { id: string; slot_start: string; slot_end: string; tech_id: string | null }
interface Staff { id: string; full_name: string }
interface WarehouseFilePreview { id: string; file: File; url: string }

function thaiDate(iso: string) { return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }

export default function WarehouseWorkspacePage() {
  const supabase = useMemo(() => createClient(), []); const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({}); const [appointments, setAppointments] = useState<Record<string, Appointment>>({});
  const [staff, setStaff] = useState<Record<string, Staff>>({}); const [items, setItems] = useState<WorkOrderItem[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState<string | null>(null); const [canAct, setCanAct] = useState(false); const [planOrderId, setPlanOrderId] = useState<string | null>(null);
  const [actualQty, setActualQty] = useState<Record<string, string>>({}); const [warehouseNote, setWarehouseNote] = useState(""); const [warehouseFiles, setWarehouseFiles] = useState<WarehouseFilePreview[]>([]); const warehouseFilesRef = useRef<WarehouseFilePreview[]>([]);
  const isLocalDemo = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).get("demo") === "1";
  const load = useCallback(async () => {
    const isLocalDemo = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).get("demo") === "1";
    if (isLocalDemo) {
      const now = new Date().toISOString(); const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(9, 0, 0, 0);
      const orderId = "00000000-0000-4000-8000-000000000010"; const appointmentId = "00000000-0000-4000-8000-000000000011";
      setOrders([{ id: orderId, appointment_id: appointmentId, job_no: "DEMO-LOCAL-001", status: "warehouse_waiting", revision: 1, confirmed_by: null, confirmed_at: now, warehouse_assignee_id: null, warehouse_accepted_at: null, warehouse_completed_at: null, installation_lead_assignment_id: null, installation_accepted_at: null, waiting_cs_at: null, closed_at: null, note: "ข้อมูลจำลองจากหัวหน้าช่าง: เตรียมสินค้าให้ครบก่อนวันนัด", created_at: now, updated_at: now, external_share_token: "demo", external_share_enabled: false, returned_reason: null, returned_by: null, returned_at: null, resubmitted_at: null }]);
      setJobs({ "DEMO-LOCAL-001": { job_no: "DEMO-LOCAL-001", customer_name: "ลูกค้าทดสอบ Local", product_name: "Safespace 0.6 cm", address: "123 ถนนทดสอบ กรุงเทพมหานคร", bill_no: "DEMO-260827" } });
      setAppointments({ [appointmentId]: { id: appointmentId, slot_start: start.toISOString(), slot_end: new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString(), tech_id: null } });
      setStaff({}); setItems([{ id: "00000000-0000-4000-8000-000000000012", work_order_id: orderId, category: "floor_material", item_name: "กระเบื้องยาง Safespace", sku: "LDSSF004", specification: "0.6 cm", planned_qty: 10, actual_qty: null, unit: "แผ่น", source_type: "new", note: "หัวหน้าช่างกำหนด", sort_order: 0 }]);
      setCanAct(true); setLoading(false); return;
    }
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
  useEffect(() => { warehouseFilesRef.current = warehouseFiles; }, [warehouseFiles]);
  useEffect(() => () => { warehouseFilesRef.current.forEach((item) => URL.revokeObjectURL(item.url)); }, []);
  async function accept(id: string) { if (!canAct) { toast.error("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานที่ Active"); return; } if (isLocalDemo) { setOrders((rows) => rows.map((order) => order.id === id ? { ...order, status: "warehouse_preparing", warehouse_assignee_id: "demo-warehouse", warehouse_accepted_at: new Date().toISOString() } : order)); toast.success("รับงานแล้ว (ข้อมูลจำลอง)"); return; } setSaving(id); const { error } = await supabase.rpc("accept_floor_warehouse_order_v2", { p_work_order_id: id }); setSaving(null); if (error) toast.error(floorErrorMessage(error)); else { toast.success("รับงานแล้ว"); void load(); } }
  function openPlan(id: string) {
    const orderItems = items.filter((item) => item.work_order_id === id);
    setActualQty(Object.fromEntries(orderItems.map((item) => [item.id, String(item.actual_qty ?? item.planned_qty)])));
    setWarehouseNote(""); setPlanOrderId(id);
  }
  function addWarehouseFiles(files: FileList | null) {
    const added = Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    if (!added.length) { toast.error("เลือกได้เฉพาะไฟล์รูปภาพ"); return; }
    setWarehouseFiles((current) => [...current, ...added]);
  }
  function removeWarehouseFile(id: string) { setWarehouseFiles((current) => { const target = current.find((item) => item.id === id); if (target) URL.revokeObjectURL(target.url); return current.filter((item) => item.id !== id); }); }
  function clearWarehouseFiles() { warehouseFilesRef.current.forEach((item) => URL.revokeObjectURL(item.url)); setWarehouseFiles([]); }
  async function completeWarehouse() {
    if (!planOrder) return;
    if (!canAct) { toast.error("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานที่ Active"); return; }
    if (planItems.some((item) => actualQty[item.id] === "" || !Number.isFinite(Number(actualQty[item.id])) || Number(actualQty[item.id]) < 0)) { toast.error("กรอกจำนวนที่คลังจัดจริงให้ครบทุกรายการ"); return; }
    if (!warehouseFiles.length) { toast.error("ต้องแนบภาพสินค้าที่คลังเตรียมอย่างน้อย 1 รูป"); return; }
    if (isLocalDemo) {
      setItems((rows) => rows.map((item) => item.work_order_id === planOrder.id ? { ...item, actual_qty: Number(actualQty[item.id]) } : item));
      setOrders((rows) => rows.map((order) => order.id === planOrder.id ? { ...order, status: "ready_to_install", warehouse_completed_at: new Date().toISOString(), note: [order.note, warehouseNote.trim() ? `คลัง: ${warehouseNote.trim()}` : ""].filter(Boolean).join("\n") } : order));
      clearWarehouseFiles(); setPlanOrderId(null); toast.success("บันทึกจำนวนและรูปแล้ว · ย้ายงานไปรอติดตั้ง (ข้อมูลจำลอง)"); return;
    }
    setSaving(planOrder.id); const paths: string[] = [];
    for (let index = 0; index < warehouseFiles.length; index++) { const file = warehouseFiles[index].file; const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const path = `work-orders/${planOrder.id}/warehouse/${Date.now()}-${index}-${safe}`; const { error } = await supabase.storage.from("job-photos").upload(path, file); if (error) { toast.error(floorErrorMessage(error)); setSaving(null); return; } paths.push(path); }
    const { error } = await supabase.rpc("complete_floor_warehouse_order_v2", { p_work_order_id: planOrder.id, p_actual_items: planItems.map((item) => ({ id: item.id, actualQty: Number(actualQty[item.id]) })), p_photo_paths: paths, p_note: warehouseNote.trim() || null });
    setSaving(null);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success("บันทึกจำนวนและรูปแล้ว · ย้ายงานไปรอติดตั้ง"); clearWarehouseFiles(); setPlanOrderId(null); void load();
  }
  const columns = ["warehouse_waiting", "warehouse_preparing", "ready_to_install"] as const;
  const planOrder = orders.find((order) => order.id === planOrderId) ?? null;
  const planJob = planOrder ? jobs[planOrder.job_no] : null;
  const planAppointment = planOrder ? appointments[planOrder.appointment_id] : null;
  const planItems = planOrder ? items.filter((item) => item.work_order_id === planOrder.id) : [];
  return <div className="mx-auto max-w-7xl"><div><div className="text-xs font-semibold uppercase tracking-wider text-blue-600">คลังสินค้า</div><h1 className="mt-1 text-2xl font-bold text-slate-950">เตรียมสินค้าสำหรับติดตั้ง</h1><p className="mt-1 text-sm text-slate-500">รับงาน → ตรวจรายการ → บันทึกจำนวนจริงและรูป → ส่งไปรอติดตั้ง</p></div>
    {isLocalDemo ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">🧪 โหมดข้อมูลจำลองบน local — การกดปุ่มจะไม่เชื่อมกับฐานข้อมูลจริง</div> : null}{!canAct && !loading ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">กรุณาเข้าสู่ระบบด้วยบัญชีพนักงาน Active เพื่อดำเนินการ</div> : null}
    {loading ? <div className="mt-6 rounded-2xl border bg-white p-12 text-center text-slate-400">กำลังโหลด…</div> : <div className="mt-6 grid gap-5 lg:grid-cols-3">{columns.map((status) => <section key={status} className="rounded-2xl bg-slate-100 p-3"><div className="flex items-center justify-between px-2 py-2"><h2 className="font-semibold text-slate-800">{WORK_ORDER_STATUS_LABELS[status]}</h2><span className="rounded-full bg-white px-2 py-1 text-xs text-slate-500">{orders.filter((row) => row.status === status).length}</span></div><div className="space-y-3">{orders.filter((row) => row.status === status).map((order) => { const job = jobs[order.job_no]; const appt = appointments[order.appointment_id]; const orderItems = items.filter((item) => item.work_order_id === order.id); return <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-950">{job?.customer_name || order.job_no}</h3><p className="mt-1 text-xs text-slate-400">#{order.job_no}{job?.bill_no ? ` · ${job.bill_no}` : ""}</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${workOrderStatusClass(order.status)}`}>{WORK_ORDER_STATUS_LABELS[order.status]}</span></div><div className="mt-3 space-y-1 text-xs text-slate-600"><div>📅 {appt ? thaiDate(appt.slot_start) : "—"}</div><div>🧱 {job?.product_name || "ยังไม่ระบุสินค้า"}</div><div>📦 {orderItems.length} รายการ · {orderItems.reduce((sum, item) => sum + Number(item.planned_qty), 0).toLocaleString()} หน่วยตามแผน</div>{order.warehouse_assignee_id ? <div>👤 ผู้รับงาน: {staff[order.warehouse_assignee_id]?.full_name || "—"}</div> : null}</div><div className="mt-4 flex gap-2"><button type="button" onClick={() => openPlan(order.id)} className="flex-1 rounded-lg border border-blue-200 py-2 text-center text-xs font-medium text-blue-700">{status === "warehouse_preparing" ? "บันทึกคลัง" : "ดูแผนสินค้า"}</button>{status === "warehouse_waiting" ? <button onClick={() => void accept(order.id)} disabled={saving === order.id} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white disabled:opacity-50">รับงาน</button> : null}</div></article>; })}{!orders.some((row) => row.status === status) ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">ไม่มีงาน</div> : null}</div></section>)}</div>}
    {planOrder ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 flex items-start justify-between border-b border-slate-100 bg-white p-5"><div><div className="text-xs font-medium text-blue-600">ใบสั่งงานจากหัวหน้าช่าง · Revision {planOrder.revision}</div><h2 className="mt-1 text-xl font-bold text-slate-950">{planJob?.customer_name || planOrder.job_no}</h2><p className="mt-1 text-sm text-slate-500">#{planOrder.job_no} · {planJob?.bill_no || "ไม่มีเลขบิล"}</p></div><button type="button" onClick={() => setPlanOrderId(null)} className="rounded-lg px-3 py-2 text-xl text-slate-400 hover:bg-slate-100">×</button></div><div className="space-y-4 p-5"><section className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><div className="text-xs text-slate-400">วันและเวลานัดติดตั้ง</div><div className="mt-1 font-medium">{planAppointment ? thaiDate(planAppointment.slot_start) : "—"}</div></div><div><div className="text-xs text-slate-400">สถานที่</div><div className="mt-1 font-medium">{planJob?.address || "—"}</div></div></section><TicketChatMock jobNo={planOrder.job_no} viewer="warehouse" viewerName="คลังสินค้า" /><section><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold text-slate-900">📦 รายการที่คลังต้องเตรียม</h3><span className="text-xs text-slate-500">{planItems.length} รายการ</span></div><div className="space-y-2">{planItems.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-medium text-slate-900">{item.item_name}{item.sku ? ` · ${item.sku}` : ""}</div><div className="mt-1 text-xs text-slate-500">{item.specification || "ไม่ระบุสเปก"}{item.note ? ` · ${item.note}` : ""}</div></div><div className="rounded-lg bg-violet-50 px-3 py-2 text-right"><div className="text-[10px] text-violet-700">ตามแผน</div><div className="text-sm font-bold text-violet-950">{item.planned_qty} {item.unit}</div></div></div>{planOrder.status === "warehouse_preparing" ? <label className="mt-3 block text-xs font-medium text-slate-600">จำนวนที่คลังจัดจริง<input type="number" min="0" step="any" value={actualQty[item.id] ?? ""} onChange={(event) => setActualQty((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-blue-200 px-3 py-2 text-sm text-slate-900" /></label> : item.actual_qty != null ? <div className="mt-3 text-sm font-medium text-emerald-700">คลังจัดจริง {item.actual_qty} {item.unit}</div> : null}</div>)}</div></section>{planOrder.note ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-sm font-semibold text-amber-950">หมายเหตุจากหัวหน้าช่าง</div><p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{planOrder.note}</p></section> : null}{planOrder.status === "warehouse_preparing" ? <section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold text-blue-950">📷 หลักฐานการเตรียมสินค้า</h3><p className="mt-1 text-xs text-blue-700">แนบภาพได้หลายรูป และต้องมีอย่างน้อย 1 รูปก่อนส่งไปรอติดตั้ง</p><label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-blue-300 bg-white px-4 py-3 text-center text-sm font-medium text-blue-700">ถ่ายรูป / เพิ่มรูป<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => { addWarehouseFiles(event.target.files); event.currentTarget.value = ""; }} /></label>{warehouseFiles.length ? <div className="mt-3 grid grid-cols-3 gap-2">{warehouseFiles.map((item, index) => <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-blue-200"><img src={item.url} alt={`ภาพสินค้า ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => removeWarehouseFile(item.id)} className="absolute right-1 top-1 rounded bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-white">ลบ</button></div>)}</div> : null}<textarea value={warehouseNote} onChange={(event) => setWarehouseNote(event.target.value)} rows={2} placeholder="หมายเหตุจากคลัง (ถ้ามี)" className="mt-3 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900" /></section> : null}{planOrder.status === "warehouse_preparing" ? <button type="button" onClick={() => void completeWarehouse()} disabled={saving === planOrder.id} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving === planOrder.id ? "กำลังบันทึก…" : "ยืนยันเตรียมเสร็จและส่งไปรอติดตั้ง"}</button> : <button type="button" onClick={() => setPlanOrderId(null)} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white">ปิดแผนสินค้า</button>}</div></div></div> : null}
  </div>;
}

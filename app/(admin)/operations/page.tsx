"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import TechnicianAssignmentButton from "@/components/appointments/technician-assignment";
import CentralWorkOrderPage from "@/app/(admin)/orders/[jobNo]/page";
import { InlineWorkOrderJobContext } from "@/components/work-orders/inline-work-order-context";
import TicketChat from "@/components/tickets/ticket-chat";
import { chatButtonLabel, chatDialogTitle, requestActionLabel, requestTarget } from "@/lib/ticket-chat-entry";
import LendiSkeleton from "@/components/brand/lendi-skeleton";
import type { FloorTechnician, TechnicianAssignment } from "@/lib/technicians";
import { WORK_ITEM_CATEGORY_LABELS, WORK_ORDER_STATUS_LABELS, type WorkOrder, type WorkOrderItem, workOrderStatusClass } from "@/lib/work-orders";
import { notifyError } from "@/lib/notify-error";

interface Team { id: string; name: string }
interface Job { job_no: string; source: string | null; bill_no: string | null; customer_name: string | null; customer_phone: string | null; address: string | null; location_url: string | null; product_name: string | null; status: string | null; flag_note: string | null; survey_data: string | null; site_photos: string[] | null }
interface Appointment { id: string; job_id: string | null; tech_id: string | null; slot_start: string; slot_end: string; status: string; notes: string | null; requirement: string | null; job: Job | Job[] | null }
type TechWithToken = FloorTechnician & { personal_token: string };

function dateTime(iso: string) { return new Date(iso).toLocaleString("th-TH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
function jobOf(appointment: Appointment) { return Array.isArray(appointment.job) ? appointment.job[0] ?? null : appointment.job; }
function surveySummary(value: string | null) { try { const data = value ? JSON.parse(value) : {}; return [data.areaSqm ? `${data.areaSqm} ตร.ม.` : "", data.floorCondition || "", Array.isArray(data.cutTypes) ? data.cutTypes.join(", ") : ""].filter(Boolean).join(" · "); } catch { return ""; } }

export default function OperationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const hasShownUnassignedWorkerAlert = useRef(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]); const [teams, setTeams] = useState<Team[]>([]); const [technicians, setTechnicians] = useState<TechWithToken[]>([]);
  const [assignments, setAssignments] = useState<TechnicianAssignment[]>([]); const [orders, setOrders] = useState<WorkOrder[]>([]); const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null); const [tab, setTab] = useState<"decision" | "returned" | "active">("decision"); const [canAct, setCanAct] = useState(false); const [canCloseWork, setCanCloseWork] = useState(false); const [expandedJobNo, setExpandedJobNo] = useState<string | null>(null); const [salesChat, setSalesChat] = useState<{ workOrder: WorkOrder; jobNo: string; customerName: string | null; source: string | null; allowRequest: boolean } | null>(null); const [showUnassignedWorkerAlert, setShowUnassignedWorkerAlert] = useState(false); const [closeWorkDialog, setCloseWorkDialog] = useState<{ workOrder: WorkOrder; customerName: string | null } | null>(null); const [closeReason, setCloseReason] = useState(""); const [closingWork, setClosingWork] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: { user } } = await Promise.race([supabase.auth.getUser(), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("ตรวจสอบสิทธิ์ใช้งานไม่สำเร็จ")), 10000))]);
    const requests = Promise.all([
      supabase.from("appointments").select("id,job_id,tech_id,slot_start,slot_end,status,notes,requirement,job:install_jobs(job_no,source,bill_no,customer_name,customer_phone,address,location_url,product_name,status,flag_note,survey_data,site_photos)").neq("status", "cancelled").gte("slot_end", since).order("slot_start"),
      supabase.from("tech_teams").select("id,name").eq("is_active", true).order("name"),
      // Keep inactive technicians in the lookup so historical assignments still show the real name.
      // The assignment dialog itself only offers technicians whose is_active flag is true.
      supabase.from("floor_technicians").select("id,team_id,name,phone,is_team_lead,is_active,created_at,updated_at,personal_token").order("name"),
      supabase.from("appointment_technicians").select("*").eq("is_active", true).order("assigned_at"),
      supabase.from("floor_work_orders").select("*").neq("status", "cancelled").order("updated_at", { ascending: false }),
      user ? supabase.from("floor_staff_profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const [appointmentResult, teamResult, technicianResult, assignmentResult, orderResult, profileResult] = await Promise.race([requests, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("การเชื่อมต่อข้อมูลใช้เวลานานเกินไป")), 15000))]);
    // FloorNow is temporarily shared-operation mode: any active signed-in staff can act.
    setCanAct(Boolean(profileResult.data));
    setCanCloseWork(user?.email?.trim().toLowerCase() === "supakrit.k@mpdgroup.co");
    const error = appointmentResult.error ?? teamResult.error ?? technicianResult.error ?? assignmentResult.error ?? orderResult.error; if (error) notifyError(`โหลดงานไม่ครบ: ${floorErrorMessage(error)}`);
    const orderRows = (orderResult.data ?? []) as WorkOrder[]; setAppointments((appointmentResult.data ?? []) as unknown as Appointment[]); setTeams((teamResult.data ?? []) as Team[]); setTechnicians((technicianResult.data ?? []) as TechWithToken[]); setAssignments((assignmentResult.data ?? []) as TechnicianAssignment[]); setOrders(orderRows);
    if (orderRows.length) { const { data } = await supabase.from("floor_work_order_items").select("*").in("work_order_id", orderRows.map((row) => row.id)).order("sort_order"); setItems((data ?? []) as WorkOrderItem[]); } else setItems([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ไม่สามารถโหลดข้อมูลได้";
      setLoadError(message);
      notifyError(`โหลดข้อมูลไม่สำเร็จ: ${message}`);
    } finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  async function copyLink(token: string) { if (!canAct) { notifyError("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานที่ Active"); return; } await navigator.clipboard.writeText(`${window.location.origin}/work/${token}`); toast.success("คัดลอกลิงก์ช่างแล้ว"); }
  async function returnToSales(workOrderId: string, source: string | null | undefined, suppliedReason?: string) {
    if (!canAct) { notifyError("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานที่ Active"); return; }
    const reason = suppliedReason?.trim() || window.prompt(source === "bbps" ? "ระบุข้อมูลที่ต้องการให้ BBPS แก้ไข" : "ระบุข้อมูลที่ต้องการให้ฝ่ายขายแก้ไข");
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("return_floor_work_order_v3", { p_work_order_id: workOrderId, p_reason: reason.trim() });
    if (error) notifyError(error); else {
      // The work order deliberately remains in returned_sales until its source
      // supplies corrected data.  Switch tabs immediately so the same card and
      // its reason remain visible instead of appearing to disappear.
      setTab("returned");
      toast.success(source === "bbps" ? "ส่งกลับ BBPS แล้ว · งานอยู่ในแท็บส่งกลับแล้ว" : "ส่งกลับฝ่ายขายแล้ว · งานอยู่ในแท็บส่งกลับแล้ว");
      void load();
    }
  }
  async function closeWork(workOrder: WorkOrder, reason: string, acknowledgeAcceptance = false) {
    if (!canCloseWork) return;
    if (!reason?.trim()) return;
    setClosingWork(true);
    // v2 บังคับเกณฑ์ตรวจรับ (job_acceptance_gate) ก่อนสิ้นสุดงาน — ถ้ายังไม่ครบจะปฏิเสธ
    // จนกดรับทราบรายการที่ขาด แล้วระบบบันทึกการรับทราบไว้ในประวัติงาน
    const { error } = await supabase.rpc("close_floor_work_order_special_v2", {
      p_work_order_id: workOrder.id,
      p_reason: reason.trim(),
      p_acknowledge_incomplete_acceptance: acknowledgeAcceptance,
    });
    if (error) {
      const message = floorErrorMessage(error);
      if (!acknowledgeAcceptance && message.includes("เกณฑ์ตรวจรับยังไม่ครบ")) {
        setClosingWork(false);
        const confirmed = window.confirm(`${message}\n\nยืนยันสิ้นสุดงานทั้งที่เกณฑ์ตรวจรับยังไม่ครบหรือไม่? การรับทราบจะถูกบันทึกไว้ในประวัติงาน`);
        if (confirmed) await closeWork(workOrder, reason, true);
        return;
      }
      notifyError(`สิ้นสุดงานไม่สำเร็จ: ${message}`);
      setClosingWork(false);
      return;
    }
    toast.success("สิ้นสุดงานแล้ว · ตรวจสอบย้อนหลังได้จากใบสั่งงาน");
    setCloseWorkDialog(null); setCloseReason(""); setClosingWork(false);
    void load();
  }
  const filtered = appointments.filter((appointment) => {
    const order = orders.find((row) => row.appointment_id === appointment.id);
    if (!order) return false;
    if (tab === "decision") return order.status === "head_review";
    if (tab === "returned") return order.status === "returned_sales";
    return !["head_review", "returned_sales", "closed"].includes(order.status);
  });
  const decisionCount = orders.filter((order) => order.status === "head_review").length; const returnedCount = orders.filter((order) => order.status === "returned_sales").length;
  const reviewedWithoutWorkers = appointments.flatMap((appointment) => {
    const order = orders.find((row) => row.appointment_id === appointment.id);
    const hasWorker = assignments.some((assignment) => assignment.appointment_id === appointment.id && assignment.is_active);
    const isReviewedAndActive = Boolean(order && !["head_review", "returned_sales", "closed", "cancelled"].includes(order.status));
    return isReviewedAndActive && !hasWorker && appointment.job_id ? [{ appointment, order: order!, job: jobOf(appointment) }] : [];
  });
  const operationGroups = filtered.reduce<{ key: string; appointments: Appointment[] }[]>((groups, appointment) => {
    const job = jobOf(appointment);
    const key = job?.source === "bbps" && job.job_no ? `bbps:${job.job_no}` : `appointment:${appointment.id}`;
    const current = groups.find((group) => group.key === key);
    if (current) current.appointments.push(appointment); else groups.push({ key, appointments: [appointment] });
    return groups;
  }, []);
  useEffect(() => {
    if (!loading && reviewedWithoutWorkers.length > 0 && !hasShownUnassignedWorkerAlert.current) {
      hasShownUnassignedWorkerAlert.current = true;
      setShowUnassignedWorkerAlert(true);
    }
  }, [loading, reviewedWithoutWorkers.length]);

  return <div className="mx-auto max-w-7xl"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-wider text-blue-600">หัวหน้าช่าง</div><h1 className="mt-1 text-2xl font-bold text-slate-950">ศูนย์ตัดสินใจและใบสั่งงาน</h1><p className="mt-1 text-sm text-slate-500">ตรวจข้อมูลเต็ม → จ่ายช่าง → สร้างรายการวัสดุ/อุปกรณ์ → ส่งให้คลัง</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowUnassignedWorkerAlert(true)} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${reviewedWithoutWorkers.length ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-slate-200 bg-white text-slate-500"}`}>🔔 รอระบุผู้ทำงาน{reviewedWithoutWorkers.length ? ` (${reviewedWithoutWorkers.length})` : ""}</button><button onClick={() => void load()} className="rounded-xl border bg-white px-4 py-2 text-sm">รีเฟรช</button></div></div>
    {!canAct && !loading ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">กรุณาเข้าสู่ระบบด้วยบัญชีพนักงาน Active เพื่อดำเนินการ</div> : null}
    {loadError ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><span>โหลดข้อมูลไม่สำเร็จ: {loadError}</span><button type="button" onClick={() => void load()} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">ลองโหลดใหม่</button></div> : null}
    <div className="mt-6 flex flex-wrap rounded-xl bg-slate-100 p-1 sm:w-fit"><button onClick={() => setTab("decision")} className={`flex-1 rounded-lg px-4 py-2 text-sm ${tab === "decision" ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>รอตรวจ ({decisionCount})</button><button onClick={() => setTab("returned")} className={`flex-1 rounded-lg px-4 py-2 text-sm ${tab === "returned" ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>ส่งกลับแล้ว ({returnedCount})</button><button onClick={() => setTab("active")} className={`flex-1 rounded-lg px-4 py-2 text-sm ${tab === "active" ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>กำลังดำเนินงาน</button></div>
    <div className="mt-5 space-y-4">{loading ? <LendiSkeleton label="กำลังโหลดคิวที่ต้องตรวจและการมอบหมายช่าง…" cards={3} /> : null}{!loading && !filtered.length ? <div className="rounded-2xl border bg-white p-10 text-center text-slate-400">ไม่มีงานในรายการนี้</div> : null}{operationGroups.map((group) => {
      const appointment = group.appointments[0]; const job = jobOf(appointment); const order = orders.find((row) => row.appointment_id === appointment.id); const orderItems = items.filter((row) => row.work_order_id === order?.id); const activeAssignments = assignments.filter((row) => row.appointment_id === appointment.id && row.is_active); const survey = surveySummary(job?.survey_data ?? null); const readyData = Boolean(job?.customer_name && job.customer_phone && (job.address || job.location_url) && (job.product_name || appointment.requirement)); const multiDay = group.appointments.length > 1;
      return <article key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b bg-slate-50/60 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-slate-950">{job?.customer_name || appointment.job_id || "งานติดตั้ง"}</h2><Badge tone={job?.source === "bbps" ? "orange" : "blue"}>{job?.source === "bbps" ? "BBPS" : "ขายตรง"}</Badge>{multiDay ? <span className="rounded bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">งานหลายวัน · {group.appointments.length} วัน</span> : null}</div><p className="mt-1 text-sm text-slate-500">{dateTime(appointment.slot_start)}–{new Date(appointment.slot_end).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} · {teams.find((team) => team.id === appointment.tech_id)?.name || "ยังไม่ระบุทีม"}</p>{multiDay ? <div className="mt-2 flex flex-wrap gap-1.5">{group.appointments.map((slot) => <span key={slot.id} className="rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px] font-medium text-violet-700">{dateTime(slot.slot_start)}–{new Date(slot.slot_end).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}</span>)}</div> : null}<p className="mt-1 text-xs text-slate-400">#{job?.job_no || "—"}{job?.bill_no ? ` · บิล ${job.bill_no}` : ""}</p></div>{order ? <span className={`h-fit rounded-full px-3 py-1.5 text-xs font-medium ${workOrderStatusClass(order.status)}`}>{order.status === "returned_sales" ? `ส่งกลับ${job?.source === "bbps" ? " BBPS" : "ฝ่ายขาย"} · รอแก้ไข` : WORK_ORDER_STATUS_LABELS[order.status]}</span> : null}</div></div>
        <div className="grid gap-4 p-5 lg:grid-cols-[1.25fr_1fr]"><div className="space-y-3"><div className={`rounded-xl border p-4 ${readyData ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50"}`}><div className="flex justify-between"><h3 className="font-semibold text-slate-900">ข้อมูลที่ต้องตัดสินใจ</h3><span className="text-xs">{readyData ? "✓ ข้อมูลหลักครบ" : "! ข้อมูลไม่ครบ"}</span></div><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><span className="text-slate-400">โทร:</span> {job?.customer_phone || "—"}</div><div><span className="text-slate-400">สถานที่:</span> {job?.address || job?.location_url || "—"}</div><div><span className="text-slate-400">สินค้า:</span> {job?.product_name || appointment.requirement || "—"}</div><div><span className="text-slate-400">สำรวจ:</span> {survey || "ยังไม่มีรายละเอียด"}</div><div><span className="text-slate-400">รูปหน้างาน:</span> {job?.site_photos?.length || 0} รูป</div><div><span className="text-slate-400">หมายเหตุ:</span> {appointment.notes || "—"}</div></div></div>{orderItems.length ? <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"><h3 className="text-sm font-semibold text-blue-950">วัสดุและอุปกรณ์ {orderItems.length} รายการ</h3><div className="mt-2 space-y-1 text-xs text-blue-800">{orderItems.slice(0, 5).map((item) => <div key={item.id}>{WORK_ITEM_CATEGORY_LABELS[item.category]} · {item.item_name} · {item.planned_qty} {item.unit}{item.actual_qty != null ? ` (หยิบจริง ${item.actual_qty})` : ""}</div>)}{orderItems.length > 5 ? <div>และอีก {orderItems.length - 5} รายการ</div> : null}</div></div> : null}</div>
          <div className="space-y-3"><div className="rounded-xl border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-sm font-semibold">ช่างรายบุคคล</h3><p className="mt-1 text-xs text-slate-500">กำหนดหัวหน้าทีมก่อนยืนยัน จากนั้นส่ง “ใบงานช่าง” ให้แต่ละคนเปิดรายละเอียดและกดรับทราบ</p></div><TechnicianAssignmentButton appointmentId={appointment.id} appointmentTeamId={appointment.tech_id} jobNo={appointment.job_id} teams={teams} technicians={technicians} assignments={assignments} onChanged={() => void load()} /></div><div className="mt-3 space-y-2">{activeAssignments.map((assignment) => { const tech = technicians.find((row) => row.id === assignment.technician_id); return <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-xs"><span>{tech?.name || "ช่าง"}{assignment.is_lead ? " ★ หัวหน้า" : ""} · {assignment.acknowledged_at ? "รับทราบแล้ว" : assignment.first_opened_at ? "เปิดแล้ว" : "ยังไม่เปิด"}</span>{tech?.personal_token ? <button onClick={() => void copyLink(tech.personal_token)} className="rounded bg-blue-600 px-2 py-1 text-white">คัดลอกใบงานช่าง</button> : null}</div>; })}{!activeAssignments.length ? <p className="text-xs text-amber-600">ยังไม่ได้จ่ายงานรายบุคคล</p> : null}</div></div>
            {tab === "decision" ? <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold text-blue-950">การตัดสินใจของหัวหน้าช่าง</h3><p className="mt-1 text-xs text-blue-700">เปิด Popup ใบสั่งงานเพื่อจัดช่าง วัสดุ/โน้ต และอนุมัติส่งคลัง โดยไม่ออกจากหน้านี้</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><button onClick={() => { if (order && (job?.job_no || appointment.job_id)) setSalesChat({ workOrder: order, jobNo: job?.job_no || appointment.job_id!, customerName: job?.customer_name ?? null, source: job?.source ?? null, allowRequest: true }); }} className="rounded-xl border border-cyan-300 bg-white px-3 py-3 text-sm font-semibold text-cyan-800">{chatButtonLabel(job?.source)}</button><button onClick={() => setExpandedJobNo((value) => value === (job?.job_no || appointment.job_id) ? null : (job?.job_no || appointment.job_id || null))} className="rounded-xl bg-blue-600 px-3 py-3 text-center text-sm font-semibold text-white">{expandedJobNo === (job?.job_no || appointment.job_id) ? "ปิด Popup ใบสั่งงาน" : readyData && activeAssignments.some((row) => row.is_lead) ? "ตรวจและอนุมัติใน Popup" : "เปิด Popup ใบสั่งงาน"}</button></div></div> : tab === "returned" ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4"><div className="font-semibold text-amber-900">{job?.source === "bbps" ? "รอ BBPS แก้ไข" : "รอฝ่ายขายแก้ไข"}</div><p className="mt-1 whitespace-pre-wrap text-sm text-amber-800">{order?.returned_reason || job?.flag_note || "ไม่ระบุเหตุผล"}</p><p className="mt-2 text-xs text-amber-700">งานนี้จะกลับมาที่แท็บ "รอตรวจ" เองอัตโนมัติทันทีที่{job?.source === "bbps" ? "BBPS ส่งข้อมูลที่แก้แล้วกลับมา" : "ฝ่ายขายบันทึกข้อมูลที่แก้แล้ว"} — ระหว่างนี้ยังคุยตามความคืบหน้าได้ในแชท</p><button onClick={() => { if (order && (job?.job_no || appointment.job_id)) setSalesChat({ workOrder: order, jobNo: job?.job_no || appointment.job_id!, customerName: job?.customer_name ?? null, source: job?.source ?? null, allowRequest: false }); }} className="mt-3 w-full rounded-xl border border-cyan-300 bg-white px-3 py-3 text-sm font-semibold text-cyan-800">{chatButtonLabel(job?.source)}</button></div> : <button onClick={() => setExpandedJobNo((value) => value === (job?.job_no || appointment.job_id) ? null : (job?.job_no || appointment.job_id || null))} className="block w-full rounded-xl bg-blue-600 py-3 text-center text-sm font-semibold text-white">{expandedJobNo === (job?.job_no || appointment.job_id) ? "ปิด Popup ใบสั่งงาน" : "เปิด Popup ดูรายละเอียดงาน"}</button>}
            {canCloseWork && order ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-rose-950">สิ้นสุดงาน (สิทธิ์พิเศษ)</h3><p className="mt-1 text-xs text-rose-700">ใช้เมื่อยืนยันแล้วว่างานนี้ไม่ต้องดำเนินการต่อ ระบบจะเก็บเหตุผลไว้ในประวัติ</p></div><button onClick={() => { setCloseReason(""); setCloseWorkDialog({ workOrder: order, customerName: job?.customer_name ?? null }); }} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700">สิ้นสุดงาน</button></div></div> : null}
          </div></div>
        {expandedJobNo === (job?.job_no || appointment.job_id) && (job?.job_no || appointment.job_id) ? <div role="dialog" aria-modal="true" aria-label="ใบสั่งงานหัวหน้าช่าง" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedJobNo(null); }}><div className="flex max-h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl"><div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6"><div><div className="text-sm font-semibold text-slate-950">ใบสั่งงาน · พื้นที่ทำงานหัวหน้าช่าง</div><div className="mt-0.5 text-xs text-slate-500">ตรวจข้อมูล จ่ายช่าง ระบุวัสดุ และส่งคลังในหน้าต่างเดียว</div></div><button type="button" aria-label="ปิดใบสั่งงาน" onClick={() => setExpandedJobNo(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">ปิด ×</button></div><div className="overflow-y-auto p-4 sm:p-6"><InlineWorkOrderJobContext.Provider value={{ jobNo: job?.job_no || appointment.job_id!, onChanged: () => { setExpandedJobNo(null); void load(); } }}><CentralWorkOrderPage /></InlineWorkOrderJobContext.Provider></div></div></div> : null}
      </article>;
    })}</div>
    {closeWorkDialog ? <div role="dialog" aria-modal="true" aria-label="ยืนยันสิ้นสุดงาน" className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !closingWork) setCloseWorkDialog(null); }}><section className="w-full max-w-lg rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"><header className="border-b border-rose-200 bg-rose-50 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Special action</p><h2 className="mt-1 text-lg font-bold text-rose-950">ยืนยันสิ้นสุดงาน</h2><p className="mt-1 text-sm text-rose-800">{closeWorkDialog.customerName || closeWorkDialog.workOrder.job_no} · งานจะถูกปิดและไม่แสดงในรายการดำเนินงานอีก</p></header><div className="p-5"><label className="text-sm font-semibold text-slate-800">เหตุผลที่สิ้นสุดงาน <span className="text-rose-600">*</span></label><textarea value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="เช่น ลูกค้ายกเลิกงาน / งานไม่ต้องดำเนินการต่อ" rows={4} className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" autoFocus /></div><footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3"><button type="button" disabled={closingWork} onClick={() => setCloseWorkDialog(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">ยกเลิก</button><button type="button" disabled={closingWork || !closeReason.trim()} onClick={() => void closeWork(closeWorkDialog.workOrder, closeReason)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{closingWork ? "กำลังบันทึก…" : "ยืนยันสิ้นสุดงาน"}</button></footer></section></div> : null}
    {showUnassignedWorkerAlert ? <div role="dialog" aria-modal="true" aria-label="งานที่ยังไม่ระบุผู้ทำงาน" className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowUnassignedWorkerAlert(false); }}><section className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"><header className="flex items-start justify-between gap-4 border-b border-amber-200 bg-amber-50 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Assignment alert</p><h2 className="mt-1 text-lg font-bold text-slate-900">ยังไม่ได้ระบุผู้ทำงาน {reviewedWithoutWorkers.length} งาน</h2><p className="mt-1 text-xs text-amber-800">เฉพาะงานที่หัวหน้าช่างตรวจเสร็จแล้วและอยู่ระหว่างดำเนินงาน</p></div><button type="button" onClick={() => setShowUnassignedWorkerAlert(false)} className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-500 hover:bg-white" aria-label="ปิดแจ้งเตือน">×</button></header><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">{reviewedWithoutWorkers.length ? reviewedWithoutWorkers.map(({ appointment, order, job }) => <article key={appointment.id} className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{job?.customer_name || appointment.job_id}</h3><span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{WORK_ORDER_STATUS_LABELS[order.status]}</span></div><p className="mt-1 text-xs text-slate-500">{dateTime(appointment.slot_start)} · {teams.find((team) => team.id === appointment.tech_id)?.name || "ยังไม่ระบุทีม"}</p><p className="mt-1 text-xs text-amber-700">ยังไม่ได้มอบหมายช่างรายบุคคล</p></div><div className="flex shrink-0 flex-wrap gap-2"><TechnicianAssignmentButton appointmentId={appointment.id} appointmentTeamId={appointment.tech_id} jobNo={appointment.job_id!} teams={teams} technicians={technicians} assignments={assignments} onChanged={() => void load()} /><button type="button" onClick={() => { setShowUnassignedWorkerAlert(false); setExpandedJobNo(job?.job_no || appointment.job_id); }} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">เปิดใบสั่งงาน</button></div></div></article>) : <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center text-sm font-medium text-emerald-700">✓ งานที่ตรวจเสร็จแล้วระบุผู้ทำงานครบทั้งหมด</div>}</div><footer className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-right"><button type="button" onClick={() => setShowUnassignedWorkerAlert(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">ปิด</button></footer></section></div> : null}
    {salesChat ? <div role="dialog" aria-modal="true" aria-label={chatDialogTitle(salesChat.source)} className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSalesChat(null); }}><div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">{chatDialogTitle(salesChat.source)}</h2><p className="mt-1 text-sm text-slate-500">{salesChat.customerName || salesChat.jobNo} · ระบุสิ่งที่ต้องการในแชท แล้วส่งคำขอแก้ไข</p></div><button type="button" onClick={() => setSalesChat(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">ปิด ×</button></div><TicketChat jobNo={salesChat.jobNo} viewer="staff" viewerName="หัวหน้าช่าง" {...(salesChat.allowRequest ? { requestActionLabel: requestActionLabel(salesChat.source), onRequestData: async (reason: string) => { await returnToSales(salesChat.workOrder.id, requestTarget(salesChat.source), reason); setSalesChat(null); } } : {})} /></div></div> : null}
  </div>;
}

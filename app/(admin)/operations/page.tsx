"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import TechnicianAssignmentButton from "@/components/appointments/technician-assignment";
import type { FloorTechnician, TechnicianAssignment } from "@/lib/technicians";

interface Team { id: string; name: string }
interface Job {
  job_no: string; source: string | null; bill_no: string | null; customer_name: string | null;
  customer_phone: string | null; address: string | null; location_url: string | null;
  product_name: string | null; status: string | null; flag_note: string | null;
}
interface Appointment {
  id: string; job_id: string | null; tech_id: string | null; slot_start: string; slot_end: string;
  status: string; notes: string | null; requirement: string | null; job: Job | Job[] | null;
}
interface MaterialPlan { appointment_id: string; planned_sheet_count: number; picked_sheet_count: number | null }
interface ProgressSummary { appointment_id: string; latest_status: string; latest_at: string; customer_signed_at: string | null }

function dateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}
function jobOf(appointment: Appointment) { return Array.isArray(appointment.job) ? appointment.job[0] ?? null : appointment.job; }

export default function OperationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [technicians, setTechnicians] = useState<FloorTechnician[]>([]);
  const [assignments, setAssignments] = useState<TechnicianAssignment[]>([]);
  const [plans, setPlans] = useState<MaterialPlan[]>([]);
  const [progressRows, setProgressRows] = useState<ProgressSummary[]>([]);
  const [planDrafts, setPlanDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"decision" | "released">("decision");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [appointmentResult, teamResult, technicianResult, assignmentResult, planResult, progressResult] = await Promise.all([
      supabase.from("appointments").select("id,job_id,tech_id,slot_start,slot_end,status,notes,requirement,job:install_jobs(job_no,source,bill_no,customer_name,customer_phone,address,location_url,product_name,status,flag_note)").neq("status", "cancelled").gte("slot_end", since).order("slot_start"),
      supabase.from("tech_teams").select("id,name").eq("is_active", true).order("name"),
      supabase.from("floor_technicians").select("id,team_id,name,phone,is_team_lead,is_active,created_at,updated_at").eq("is_active", true).order("name"),
      supabase.from("appointment_technicians").select("*").eq("is_active", true).order("assigned_at"),
      supabase.rpc("list_floor_material_plans_staff"),
      supabase.rpc("list_floor_work_progress_staff"),
    ]);
    const error = appointmentResult.error ?? teamResult.error ?? technicianResult.error ?? assignmentResult.error ?? planResult.error ?? progressResult.error;
    if (error) toast.error(`โหลดงานไม่ครบ: ${error.message}`);
    setAppointments((appointmentResult.data ?? []) as unknown as Appointment[]);
    setTeams((teamResult.data ?? []) as Team[]);
    setTechnicians((technicianResult.data ?? []) as FloorTechnician[]);
    setAssignments((assignmentResult.data ?? []) as TechnicianAssignment[]);
    setPlans((planResult.data ?? []) as MaterialPlan[]);
    setProgressRows((progressResult.data ?? []) as ProgressSummary[]);
    setPlanDrafts(Object.fromEntries(((planResult.data ?? []) as MaterialPlan[]).map((plan) => [plan.appointment_id, String(plan.planned_sheet_count)])));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function savePlan(appointmentId: string) {
    const value = Number(planDrafts[appointmentId]);
    if (!Number.isInteger(value) || value < 0) { toast.error("จำนวนแผ่นต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป"); return; }
    setSavingId(appointmentId);
    const { error } = await supabase.rpc("set_floor_job_material_plan_staff", { p_appointment_id: appointmentId, p_planned_sheet_count: value });
    setSavingId(null);
    if (error) toast.error(error.message); else { toast.success("บันทึกจำนวนแผ่นแล้ว"); void load(); }
  }

  async function release(appointmentId: string) {
    setSavingId(appointmentId);
    const { error } = await supabase.rpc("release_floor_appointment_staff", { p_appointment_id: appointmentId });
    setSavingId(null);
    if (error) toast.error(error.message); else { toast.success("ปล่อยใบงานให้ทีมช่างแล้ว"); void load(); }
  }

  async function returnToSales(appointmentId: string) {
    const reason = window.prompt("ระบุข้อมูลที่ฝ่ายขายต้องแก้ไข");
    if (!reason?.trim()) return;
    setSavingId(appointmentId);
    const { error } = await supabase.rpc("return_floor_appointment_staff", { p_appointment_id: appointmentId, p_reason: reason.trim() });
    setSavingId(null);
    if (error) toast.error(error.message); else { toast.success("ส่งกลับฝ่ายขายแล้ว"); void load(); }
  }

  async function closeInstallation(appointmentId: string) {
    setSavingId(appointmentId);
    const { error } = await supabase.rpc("close_floor_appointment_staff", { p_appointment_id: appointmentId });
    setSavingId(null);
    if (error) toast.error(error.message); else { toast.success("ตรวจหลักฐานและส่งงานเข้า CS แล้ว"); void load(); }
  }

  const filtered = appointments.filter((appointment) => tab === "decision" ? appointment.status === "proposed" : appointment.status === "confirmed");
  const decisionCount = appointments.filter((appointment) => appointment.status === "proposed").length;

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="text-xs font-semibold uppercase tracking-wider text-blue-600">หัวหน้าช่าง</div><h1 className="mt-1 text-2xl font-bold text-slate-950">งานที่ต้องตัดสินใจ</h1><p className="mt-1 text-sm text-slate-500">ตรวจข้อมูล → จ่ายช่าง → ระบุจำนวนแผ่น → ปล่อยใบงาน</p></div>
      <button onClick={() => void load()} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">รีเฟรช</button>
    </div>

    <div className="mt-6 flex gap-2 rounded-xl bg-slate-100 p-1 sm:w-fit">
      <button onClick={() => setTab("decision")} className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium sm:flex-none ${tab === "decision" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>ต้องตัดสินใจ ({decisionCount})</button>
      <button onClick={() => setTab("released")} className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium sm:flex-none ${tab === "released" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>ปล่อยงานแล้ว</button>
    </div>

    <div className="mt-5 space-y-4">
      {loading ? <div className="rounded-2xl border bg-white p-8 text-center text-slate-400">กำลังโหลดงาน…</div> : null}
      {!loading && !filtered.length ? <div className="rounded-2xl border bg-white p-10 text-center text-slate-400">ไม่มีงานในรายการนี้</div> : null}
      {filtered.map((appointment) => {
        const job = jobOf(appointment);
        const activeAssignments = assignments.filter((assignment) => assignment.appointment_id === appointment.id && assignment.is_active);
        const hasPlan = plans.some((plan) => plan.appointment_id === appointment.id);
        const progress = progressRows.find((row) => row.appointment_id === appointment.id);
        const dataReady = Boolean(job?.customer_name && job.customer_phone && (job.address || job.location_url) && (job.product_name || appointment.requirement));
        const ready = dataReady && activeAssignments.length > 0 && hasPlan;
        return <article key={appointment.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-950">{job?.customer_name ?? appointment.job_id ?? "งานติดตั้ง"}</h2>{job?.source === "bbps" ? <span className="rounded bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">BBPS</span> : <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">ขายตรง</span>}</div><div className="mt-1 text-sm text-slate-500">{dateTime(appointment.slot_start)}–{new Date(appointment.slot_end).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} · {teams.find((team) => team.id === appointment.tech_id)?.name ?? "ยังไม่ระบุทีม"}</div><div className="mt-1 text-xs text-slate-400">งาน #{job?.job_no ?? "—"}{job?.bill_no ? ` · บิล ${job.bill_no}` : ""}</div></div>
              <div className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${progress?.latest_status === "customer_signed" ? "bg-emerald-100 text-emerald-700" : ready ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{progress?.latest_status === "customer_signed" ? "ลูกค้าเซ็นแล้ว · รอตรวจปิด" : progress?.latest_status === "completed" ? "ติดตั้งเสร็จ · รอลูกค้าเซ็น" : progress?.latest_status === "installing" ? "กำลังติดตั้ง" : progress?.latest_status === "arrived" ? "ถึงหน้างานแล้ว" : progress?.latest_status === "travelling" ? "กำลังเดินทาง" : ready ? "พร้อมปล่อยงาน" : "ยังไม่พร้อม"}</div>
            </div>
            {job?.flag_note ? <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">ฝ่ายขายต้องแก้: {job.flag_note}</div> : null}
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-3">
            <section className={`rounded-xl border p-4 ${dataReady ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60"}`}><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">1. ข้อมูลงาน</h3><span>{dataReady ? "✓" : "!"}</span></div><div className="mt-3 space-y-1 text-xs text-slate-600"><div>ลูกค้า: {job?.customer_name || "—"}</div><div>โทร: {job?.customer_phone || "—"}</div><div className="line-clamp-2">สถานที่: {job?.address || job?.location_url || "—"}</div><div className="line-clamp-2">สเปก: {job?.product_name || appointment.requirement || "—"}</div></div></section>
            <section className={`rounded-xl border p-4 ${activeAssignments.length ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60"}`}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">2. จ่ายช่างรายบุคคล</h3><TechnicianAssignmentButton appointmentId={appointment.id} appointmentTeamId={appointment.tech_id} jobNo={appointment.job_id} teams={teams} technicians={technicians} assignments={assignments} onChanged={() => void load()} /></div><div className="mt-3 text-xs text-slate-600">{activeAssignments.length ? `${activeAssignments.length} คน · ${activeAssignments.some((item) => item.acknowledged_at) ? "มีผู้รับทราบแล้ว" : "ยังไม่มีผู้รับทราบ"}` : "ยังไม่ได้เลือกผู้ปฏิบัติงาน"}</div></section>
            <section className={`rounded-xl border p-4 ${hasPlan ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60"}`}><h3 className="text-sm font-semibold">3. จำนวนแผ่นที่ให้หยิบ</h3><div className="mt-3 flex gap-2"><input type="number" min={0} step={1} value={planDrafts[appointment.id] ?? ""} onChange={(e) => setPlanDrafts((current) => ({ ...current, [appointment.id]: e.target.value }))} placeholder="จำนวนแผ่น" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><button onClick={() => void savePlan(appointment.id)} disabled={savingId === appointment.id} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">บันทึก</button></div><div className="mt-2 text-xs text-slate-500">ช่างต้องกรอกจำนวนที่หยิบจริงก่อนเริ่มเดินทาง</div></section>
          </div>

          {tab === "decision" ? <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 p-4 sm:flex-row sm:justify-end"><button onClick={() => void returnToSales(appointment.id)} disabled={savingId === appointment.id} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700">ส่งกลับฝ่ายขาย</button><button onClick={() => void release(appointment.id)} disabled={!ready || savingId === appointment.id} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">{savingId === appointment.id ? "กำลังบันทึก…" : ready ? "ยืนยันและปล่อยใบงาน" : "ทำข้อมูล 3 ขั้นให้ครบ"}</button></div> : <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm text-slate-600">{progress ? `สถานะล่าสุด: ${progress.latest_status}` : "ทีมช่างยังไม่เริ่มอัปเดตสถานะ"}</div><button onClick={() => void closeInstallation(appointment.id)} disabled={!progress?.customer_signed_at || savingId === appointment.id} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">{progress?.customer_signed_at ? "ตรวจหลักฐานและส่งเข้า CS" : "รอรูปครบและลูกค้าเซ็น"}</button></div>}
        </article>;
      })}
    </div>
  </div>;
}

"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import TechnicianManager from "@/components/appointments/technician-manager";
import TechnicianAssignmentButton from "@/components/appointments/technician-assignment";
import type { FloorTechnician, TechnicianAssignment } from "@/lib/technicians";

interface TechTeam {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  eval_avg: number;
  notes: string | null;
}

interface Job {
  job_no: string;
  customer_name: string | null;
  product_name: string | null;
  stage: number;
  status: string | null;
  source: string | null;
  waiting_on: string | null;
  flag_note: string | null;
  bill_no: string | null;
  customer_phone: string | null;
  address: string | null;
  location_url: string | null;
  survey_data: string | null;
}

interface Appointment {
  id: string;
  job_id: string | null;
  tech_id: string | null;
  slot_start: string;
  slot_end: string;
  status: 'proposed' | 'confirmed' | 'completed' | 'cancelled';
  notes: string | null;
  confirm_token: string;
  tech?: TechTeam;
  job?: Job;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  proposed:  { label: 'รอยืนยัน',   cls: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'ยืนยันแล้ว', cls: 'bg-blue-100 text-blue-700' },
  completed: { label: 'เสร็จสิ้น',  cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'ยกเลิก',     cls: 'bg-slate-100 text-slate-500' },
};

const STATUS_NEXT: Record<string, string> = {
  proposed:  'confirmed',
  confirmed: 'completed',
  completed: 'completed',
  cancelled: 'cancelled',
};

const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function getWeekDays(offset: number): Date[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

function hoursBetween(start: string, end: string) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

function sameDay(d1: Date, iso: string) {
  const d2 = new Date(iso);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function isToday(d: Date) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function missingJobFields(job: Job): string[] {
  const missing: string[] = [];
  if (!job.bill_no) missing.push(job.source === 'bbps' ? 'เลขอ้างอิง BBPS' : 'เลขบิล');
  if (!job.customer_name) missing.push('ชื่อลูกค้า');
  if (!job.customer_phone) missing.push('เบอร์โทร');
  if (!job.address && !job.location_url) missing.push('ที่อยู่หรือแผนที่');
  if (job.source !== 'bbps') {
    if (!job.product_name) missing.push('Requirement/สเปก');
    let area = '';
    try { area = job.survey_data ? String(JSON.parse(job.survey_data).areaSqm ?? '') : ''; } catch {}
    if (!area) missing.push('พื้นที่ติดตั้ง');
  }
  return missing;
}

export default function AppointmentsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [techs, setTechs] = useState<TechTeam[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [technicians, setTechnicians] = useState<FloorTechnician[]>([]);
  const [assignments, setAssignments] = useState<TechnicianAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [staffRole, setStaffRole] = useState<string | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showTechs, setShowTechs] = useState(false);
  const [showIndividuals, setShowIndividuals] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create appointment form
  const emptyForm = { job_id: '', tech_id: '', date: '', start_time: '09:00', end_time: '12:00', notes: '' };
  const [form, setForm] = useState(emptyForm);

  // Tech team form
  const emptyTechForm = { name: '', phone: '', notes: '' };
  const [techForm, setTechForm] = useState(emptyTechForm);
  const [editTech, setEditTech] = useState<TechTeam | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: apptData, error: apptError }, { data: techData, error: techError }, { data: jobData, error: jobError }, { data: personData, error: personError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, tech:tech_teams(*), job:install_jobs(job_no,bill_no,customer_name,customer_phone,address,location_url,product_name,survey_data,stage,status,source,waiting_on,flag_note)')
        .order('slot_start'),
      supabase.from('tech_teams').select('*').order('name'),
      supabase.from('install_jobs').select('job_no,bill_no,customer_name,customer_phone,address,location_url,product_name,survey_data,stage,status,source,waiting_on,flag_note').order('job_no', { ascending: false }).limit(200),
      supabase.from('floor_technicians').select('id,team_id,name,phone,is_team_lead,is_active,created_at,updated_at').order('name'),
      supabase.from('appointment_technicians').select('*').order('assigned_at'),
    ]);
    const loadError = apptError ?? techError ?? jobError ?? personError ?? assignmentError;
    if (loadError) toast.error(`โหลดข้อมูลนัดหมายไม่ครบ: ${loadError.message}`);
    setAppointments((apptData ?? []) as Appointment[]);
    setTechs((techData ?? []) as TechTeam[]);
    setJobs((jobData ?? []) as Job[]);
    setTechnicians((personData ?? []) as FloorTechnician[]);
    setAssignments((assignmentData ?? []) as TechnicianAssignment[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    let active = true;
    supabase.rpc('get_my_floor_staff_profile').then(({ data }) => {
      if (active) setStaffRole((data as { role?: string } | null)?.role ?? null);
    });
    return () => { active = false; };
  }, [supabase]);
  const canManage = Boolean(staffRole);

  const weekDays = getWeekDays(weekOffset);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];

  // Stats
  const todayAppts = appointments.filter((a) => isToday(new Date(a.slot_start)) && a.status !== 'cancelled');
  const pendingAppts = appointments.filter((a) => a.status === 'proposed'
    && !['ส่งกลับฝ่ายขายแก้ไข', 'ส่งกลับ BBPS แก้ไข'].includes(a.job?.status ?? ''));
  const weekAppts = appointments.filter((a) => {
    const d = new Date(a.slot_start);
    return d >= weekStart && d <= weekEnd && a.status !== 'cancelled';
  });
  const activeAssignments = assignments.filter((assignment) => assignment.is_active);
  const assignedAppointmentIds = new Set(activeAssignments.map((assignment) => assignment.appointment_id));
  const unassignedWeekAppts = weekAppts.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id));
  const weeklyTechnicians = technicians.filter((technician) => technician.is_active);
  const conflictAppointmentIds = new Set<string>();
  weeklyTechnicians.forEach((technician) => {
    const assigned = activeAssignments.filter((assignment) => assignment.technician_id === technician.id)
      .map((assignment) => appointments.find((appointment) => appointment.id === assignment.appointment_id))
      .filter((appointment): appointment is Appointment => Boolean(appointment && appointment.status !== 'cancelled'))
      .sort((a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime());
    assigned.forEach((appointment, index) => {
      const previous = assigned[index - 1];
      if (previous && new Date(appointment.slot_start) < new Date(previous.slot_end)) {
        conflictAppointmentIds.add(previous.id);
        conflictAppointmentIds.add(appointment.id);
      }
    });
  });

  // --- Create Appointment ---
  async function createAppointment() {
    if (!canManage) { toast.error('เฉพาะหัวหน้าช่างหรือผู้ดูแลระบบเท่านั้นที่สร้างนัดหมายได้'); return; }
    if (!form.date || !form.start_time || !form.end_time) { toast.error('กรุณาระบุวันและเวลา'); return; }
    setSaving(true);
    const slotStart = new Date(`${form.date}T${form.start_time}:00+07:00`).toISOString();
    const slotEnd = new Date(`${form.date}T${form.end_time}:00+07:00`).toISOString();
    const { error } = await supabase.from('appointments').insert({
      job_id: form.job_id || null,
      tech_id: form.tech_id || null,
      slot_start: slotStart,
      slot_end: slotEnd,
      notes: form.notes.trim() || null,
      status: 'proposed',
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('สร้างนัดหมายเรียบร้อย');
    setShowCreate(false);
    setForm(emptyForm);
    loadData();
  }

  // --- Update Status ---
  async function updateStatus(appt: Appointment, newStatus: string) {
    if (!canManage) { toast.error('บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์เปลี่ยนสถานะคิว'); return; }
    if (newStatus === 'confirmed' && appt.job_id) {
      const missing = appt.job ? missingJobFields(appt.job) : ['ข้อมูล Ticket'];
      if (missing.length) {
        toast.error(`ข้อมูลยังไม่ครบ: ${missing.join(', ')}`);
        return;
      }
      const assigned = assignments.some((a) => a.appointment_id === appt.id && a.is_active);
      if (!assigned) {
        toast.error('กรุณาจ่ายงานให้ช่างรายบุคคลอย่างน้อย 1 คนก่อนยืนยัน');
        return;
      }
    }
    const confirmedAt = newStatus === 'confirmed' ? new Date().toISOString() : null;
    const update = supabase.from('appointments').update({ status: newStatus, confirmed_at: confirmedAt });
    const { error } = appt.job_id && newStatus === 'confirmed'
      ? await update.eq('job_id', appt.job_id).neq('status', 'cancelled')
      : await update.eq('id', appt.id);
    if (error) { toast.error(error.message); return; }
    if (appt.job_id && newStatus === 'confirmed') {
      const { error: jobError } = await supabase.from('install_jobs').update({
        status: 'ยืนยันคิวแล้ว', waiting_on: 'ไม่ได้ค้าง', waiting_since: null,
        flag_note: null, updated_at: new Date().toISOString(),
      }).eq('job_no', appt.job_id);
      if (jobError) { toast.error(jobError.message); return; }
      await supabase.from('job_activity').insert({
        job_no: appt.job_id, actor: 'หัวหน้าช่าง', action: 'confirm', field: 'status',
        old_value: appt.job?.status ?? null, new_value: 'ยืนยันคิวแล้ว',
      });
    }
    toast.success(`อัปเดตสถานะเป็น ${STATUS_CONFIG[newStatus]?.label ?? newStatus}`);
    loadData();
  }

  async function cancelAppointment(appt: Appointment) {
    if (!canManage) { toast.error('บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์ยกเลิกคิว'); return; }
    const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
    if (error) { toast.error(error.message); return; }
    if (appt.job_id) {
      const { count } = await supabase.from('appointments')
        .select('id', { count: 'exact', head: true }).eq('job_id', appt.job_id).neq('status', 'cancelled');
      if (!count) {
        await supabase.from('install_jobs').update({
          status: 'ยกเลิกคิว', waiting_on: 'ไม่ได้ค้าง', waiting_since: null, updated_at: new Date().toISOString(),
        }).eq('job_no', appt.job_id);
        await supabase.from('job_activity').insert({
          job_no: appt.job_id, actor: 'หัวหน้าช่าง', action: 'cancel', field: 'status',
          old_value: appt.job?.status ?? null, new_value: 'ยกเลิกคิว',
        });
      }
    }
    toast.success('ยกเลิกคิวและเก็บประวัติไว้แล้ว');
    loadData();
  }

  async function reassignTeam(appt: Appointment, techId: string) {
    if (!canManage) { toast.error('เฉพาะหัวหน้าช่างหรือผู้ดูแลระบบเท่านั้นที่ย้ายทีมได้'); return; }
    if (!techId || techId === appt.tech_id) return;
    const { data: clashes, error: clashError } = await supabase.from('appointments')
      .select('id').eq('tech_id', techId).neq('status', 'cancelled').neq('id', appt.id)
      .lt('slot_start', appt.slot_end).gt('slot_end', appt.slot_start).limit(1);
    if (clashError) { toast.error(clashError.message); return; }
    if (clashes?.length) { toast.error('ทีมที่เลือกมีคิวชนในช่วงเวลานี้'); return; }

    const { error } = await supabase.from('appointments').update({
      tech_id: techId, status: 'proposed', confirmed_at: null,
    }).eq('id', appt.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from('appointment_technicians').update({
      is_active: false, is_lead: false, revoked_at: new Date().toISOString(),
    }).eq('appointment_id', appt.id).eq('is_active', true);
    if (appt.job_id) {
      await supabase.from('install_jobs').update({
        status: 'รอหัวหน้าช่างยืนยัน', waiting_on: 'หัวหน้าช่าง',
        waiting_since: new Date().toISOString(), assignees: [], updated_at: new Date().toISOString(),
      }).eq('job_no', appt.job_id);
      await supabase.from('job_activity').insert({
        job_no: appt.job_id, actor: 'หัวหน้าช่าง', action: 'reassign', field: 'tech_id',
        old_value: appt.tech_id, new_value: techId,
      });
    }
    toast.success('ย้ายทีมแล้วและนำคิวกลับไปรอยืนยัน');
    loadData();
  }

  // --- Tech CRUD ---
  async function saveTech() {
    if (!techForm.name.trim()) { toast.error('กรุณาระบุชื่อ'); return; }
    setSaving(true);
    if (editTech) {
      const { error } = await supabase.from('tech_teams').update({
        name: techForm.name.trim(),
        phone: techForm.phone.trim() || null,
        notes: techForm.notes.trim() || null,
      }).eq('id', editTech.id);
      if (error) { setSaving(false); toast.error(error.message); return; }
      toast.success('แก้ไขทีมช่างเรียบร้อย');
    } else {
      const { error } = await supabase.from('tech_teams').insert({
        name: techForm.name.trim(),
        phone: techForm.phone.trim() || null,
        notes: techForm.notes.trim() || null,
      });
      if (error) { setSaving(false); toast.error(error.message); return; }
      toast.success('เพิ่มทีมช่างเรียบร้อย');
    }
    setSaving(false);
    setEditTech(null);
    setTechForm(emptyTechForm);
    loadData();
  }

  async function toggleTechActive(tech: TechTeam) {
    const { error } = await supabase.from('tech_teams').update({ is_active: !tech.is_active }).eq('id', tech.id);
    if (error) { toast.error(error.message); return; }
    loadData();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">จัดคิวและโหลดงานช่าง</h1>
          <p className="text-slate-500 text-sm mt-0.5">ดูงานรายบุคคล คิวชน และเวลางานรวมก่อนยืนยันคิว</p>
        </div>
        {canManage ? <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowIndividuals(true)}
            className="px-3 py-1.5 text-sm border border-violet-200 rounded-lg text-violet-700 hover:bg-violet-50">
            👤 ช่าง / PIN
          </button>
          <button onClick={() => setShowTechs(true)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
            👷 ทีมช่าง
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            + นัดหมายใหม่
          </button>
        </div> : <span className="ml-auto rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">โหมดดูข้อมูล</span>}
      </div>

      {/* Stats */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="font-semibold">ลำดับทำงานที่ชัดเจน</div>
        <p className="mt-1 text-blue-700">1) เลือกวัน/ทีม 2) จ่ายช่างรายบุคคล 3) ตรวจโหลดและคิวชนด้านล่าง 4) เปิดใบสั่งงานเพื่อยืนยันส่งคลัง ส่วนการรับทราบอยู่ในลิงก์ส่วนตัวของช่าง</p>
        <Link href="/operations" className="mt-3 inline-flex rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">ไปหน้าต้องตัดสินใจ →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        {[
          { label: 'วันนี้', value: todayAppts.length, icon: '📅', color: 'text-blue-600' },
          { label: 'รอยืนยัน', value: pendingAppts.length, icon: '⏳', color: 'text-amber-600' },
          { label: 'สัปดาห์นี้', value: weekAppts.length, icon: '📆', color: 'text-emerald-600' },
          { label: 'ยังไม่จ่ายช่าง', value: unassignedWeekAppts.length, icon: '👤', color: unassignedWeekAppts.length ? 'text-amber-600' : 'text-slate-400' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Pending confirmation */}
      {pendingAppts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="text-sm font-medium text-amber-800 mb-3">⏳ รอยืนยัน ({pendingAppts.length} รายการ)</div>
          <div className="space-y-2">
            {pendingAppts.map((appt) => (
              <div key={appt.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2.5 border border-amber-100">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {appt.job?.customer_name ?? 'ไม่ระบุลูกค้า'}
                    {appt.job && <span className="text-xs text-slate-400 ml-2">{appt.job.job_no}</span>}
                    {appt.job && <span className={`text-[10px] px-1.5 py-0.5 rounded ml-2 ${appt.job.source === 'bbps' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{appt.job.source === 'bbps' ? 'BBPS' : 'ขายตรง'}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtTime(appt.slot_start)} – {fmtTime(appt.slot_end)} · {appt.tech?.name ?? 'ไม่ระบุช่าง'}
                  </div>
                  {appt.job_id ? <TechnicianAssignmentButton
                    appointmentId={appt.id} appointmentTeamId={appt.tech_id} jobNo={appt.job_id}
                    teams={techs} technicians={technicians} assignments={assignments} onChanged={loadData}
                  /> : null}
                </div>
                <select value={appt.tech_id ?? ''} onChange={(e) => reassignTeam(appt, e.target.value)}
                  aria-label={`ย้ายทีมสำหรับ ${appt.job?.customer_name ?? appt.job_id ?? 'นัดหมาย'}`}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white max-w-32">
                  <option value="">เลือกทีม</option>
                  {techs.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {appt.job_id ? <Link href={`/orders/${encodeURIComponent(appt.job_id)}`}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shrink-0">
                  เปิดใบสั่งงาน
                </Link> : <button onClick={() => updateStatus(appt, 'confirmed')}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shrink-0">
                  ✓ ยืนยันคิว
                </button>}
                <button onClick={() => cancelAppointment(appt)}
                  className="px-3 py-1 text-xs bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200 shrink-0">
                  ยกเลิก
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Individual technician load board */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <button onClick={() => setWeekOffset((o) => o - 1)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            ←
          </button>
          <div><div className="font-semibold text-sm">ตารางโหลดงานช่างรายบุคคล</div><div className="text-xs text-slate-500">{fmtDate(weekStart)} – {fmtDate(weekEnd)} · แสดงชั่วโมงตามเวลานัดหมาย</div></div>
          <button onClick={() => setWeekOffset((o) => o + 1)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            →
          </button>
          <button onClick={() => setWeekOffset(0)}
            className="ml-1 px-2.5 py-1 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
            วันนี้
          </button>
        </div>

        {!loading && (unassignedWeekAppts.length || conflictAppointmentIds.size) ? <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-amber-50 px-5 py-3 text-xs text-amber-900">
          {unassignedWeekAppts.length ? <span className="rounded-full bg-white px-3 py-1 font-medium">👤 ยังไม่จ่ายช่าง {unassignedWeekAppts.length} งาน</span> : null}
          {conflictAppointmentIds.size ? <span className="rounded-full bg-white px-3 py-1 font-medium">⚠️ พบคิวช่างชน {conflictAppointmentIds.size} งาน</span> : null}
          <span className="self-center text-amber-700">เปิดการ์ดงานเพื่อดูรายละเอียดหรือปรับทีม/จ่ายช่าง</span>
        </div> : null}
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm animate-pulse">โหลดข้อมูล…</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1050px]">
              <div className="grid grid-cols-[190px_repeat(7,minmax(122px,1fr))] border-b border-slate-200 bg-slate-50">
                <div className="px-4 py-3 text-xs font-semibold text-slate-500">ช่าง / ทีม</div>
                {weekDays.map((day) => <div key={day.toISOString()} className={`border-l border-slate-200 px-2 py-2 text-center ${isToday(day) ? 'bg-blue-600 text-white' : ''}`}><div className="text-xs font-medium">{DAY_TH[day.getDay()]}</div><div className="text-lg font-bold leading-tight">{day.getDate()}</div></div>)}
              </div>
              {weeklyTechnicians.map((technician) => {
                const personAssignments = activeAssignments.filter((assignment) => assignment.technician_id === technician.id);
                const personWeekAppointments = personAssignments.map((assignment) => appointments.find((appointment) => appointment.id === assignment.appointment_id)).filter((appointment): appointment is Appointment => Boolean(appointment && weekAppts.some((weekAppointment) => weekAppointment.id === appointment.id)));
                const totalHours = personWeekAppointments.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0);
                return <div key={technician.id} className="grid grid-cols-[190px_repeat(7,minmax(122px,1fr))] border-b border-slate-100 last:border-b-0">
                  <div className="bg-slate-50/70 px-4 py-3"><div className="font-medium text-sm text-slate-900">{technician.name}{technician.is_team_lead ? ' ★' : ''}</div><div className="mt-0.5 text-xs text-slate-500">{techs.find((team) => team.id === technician.team_id)?.name || 'ไม่ระบุทีม'} · {totalHours.toFixed(totalHours % 1 ? 1 : 0)} ชม. / {personWeekAppointments.length} งาน</div></div>
                  {weekDays.map((day) => {
                    const dayAppointments = personWeekAppointments.filter((appointment) => sameDay(day, appointment.slot_start));
                    const hours = dayAppointments.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0);
                    return <div key={day.toISOString()} className={`min-h-28 border-l border-slate-100 p-1.5 ${isToday(day) ? 'bg-blue-50/30' : ''}`}>
                      <div className={`mb-1 text-right text-[10px] font-medium ${hours ? 'text-slate-500' : 'text-slate-300'}`}>{hours ? `${hours.toFixed(hours % 1 ? 1 : 0)} ชม.` : 'ว่าง'}</div>
                      <div className="space-y-1">{dayAppointments.map((appointment) => { const cfg = STATUS_CONFIG[appointment.status] ?? STATUS_CONFIG.proposed; const conflict = conflictAppointmentIds.has(appointment.id); return <Link key={appointment.id} href={appointment.job_id ? `/orders/${encodeURIComponent(appointment.job_id)}` : '#'} className={`block rounded-lg border px-2 py-1.5 text-[11px] transition hover:brightness-95 ${cfg.cls} ${conflict ? 'border-red-400 ring-1 ring-red-200' : 'border-transparent'}`} title={appointment.job_id ? 'เปิดใบสั่งงาน' : 'ยังไม่มีใบสั่งงาน'}><div className="flex items-center justify-between gap-1"><span className="font-semibold">{fmtTime(appointment.slot_start)}</span>{conflict ? <span title="คิวชน">⚠️</span> : null}</div><div className="mt-0.5 line-clamp-2 font-medium">{appointment.job?.customer_name || appointment.job_id || 'นัดหมาย'}</div><div className="mt-0.5 text-[10px] opacity-75">{hoursBetween(appointment.slot_start, appointment.slot_end).toFixed(hoursBetween(appointment.slot_start, appointment.slot_end) % 1 ? 1 : 0)} ชม. · {STATUS_CONFIG[appointment.status]?.label}</div></Link>; })}</div>
                    </div>;
                  })}
                </div>;
              })}
              {!weeklyTechnicians.length ? <div className="p-10 text-center text-sm text-slate-400">ยังไม่มีรายชื่อช่าง Active · กด “ช่าง / PIN” เพื่อเพิ่มช่างก่อน</div> : null}
            </div>
          </div>
        )}
      </section>

      {/* All appointments list (below calendar) */}
      {!loading && appointments.filter((a) => a.status !== 'cancelled').length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100"><div><div className="font-semibold text-sm">รายการคิวทั้งหมด</div><div className="mt-0.5 text-xs text-slate-500">ใช้จัดทีม จ่ายช่าง และเปิดใบสั่งงานเมื่อจำเป็น</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{appointments.filter((a) => a.status !== 'cancelled').length} งาน</span></div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['วันที่', 'เวลา', 'ช่าง', 'งาน / ลูกค้า', 'สถานะ', 'หมายเหตุ', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-medium text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {appointments
                .filter((a) => a.status !== 'cancelled')
                .map((appt) => {
                  const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.proposed;
                  return (
                    <tr key={appt.id}>
                      <td className="px-4 py-2 text-slate-600">
                        {new Date(appt.slot_start).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })}
                      </td>
                      <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                        {fmtTime(appt.slot_start)} – {fmtTime(appt.slot_end)}
                      </td>
                      <td className="px-4 py-2">{appt.tech?.name ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-2">
                        {appt.job ? (
                          <div>
                            <div className="font-medium">{appt.job.customer_name ?? appt.job.job_no}</div>
                            <div className="text-xs text-slate-400 flex items-center gap-1.5">
                              <span>{appt.job.job_no}</span>
                              <span className={appt.job.source === 'bbps' ? 'text-amber-600' : 'text-blue-600'}>{appt.job.source === 'bbps' ? 'BBPS' : 'ขายตรง'}</span>
                            </div>
                            {appt.job.flag_note && <div className="text-xs text-amber-700 mt-0.5">แก้ไข: {appt.job.flag_note}</div>}
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400">{appt.notes ?? '—'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          {appt.job_id ? <TechnicianAssignmentButton
                            appointmentId={appt.id} appointmentTeamId={appt.tech_id} jobNo={appt.job_id}
                            teams={techs} technicians={technicians} assignments={assignments} onChanged={loadData}
                          /> : null}
                          <select value={appt.tech_id ?? ''} onChange={(e) => reassignTeam(appt, e.target.value)}
                            aria-label={`ย้ายทีมสำหรับ ${appt.job?.customer_name ?? appt.job_id ?? 'นัดหมาย'}`}
                            className="border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white max-w-24">
                            <option value="">ทีม</option>
                            {techs.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          {appt.status === 'proposed' && (appt.job_id ?
                            <Link href={`/orders/${encodeURIComponent(appt.job_id)}`}
                              aria-label="เปิดใบสั่งงานกลาง"
                              className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">📋</Link>
                            : <button onClick={() => updateStatus(appt, 'confirmed')}
                              className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">✓</button>)}
                          {appt.status === 'confirmed' && (
                            <button onClick={() => updateStatus(appt, 'completed')}
                              className="px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">
                              ✓
                            </button>
                          )}
                          <button onClick={() => cancelAppointment(appt)}
                            className="px-2 py-0.5 text-xs bg-slate-50 text-slate-400 rounded hover:bg-slate-100">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <TechnicianManager
        open={showIndividuals}
        teams={techs}
        technicians={technicians}
        onClose={() => setShowIndividuals(false)}
        onChanged={loadData}
      />

      {/* ===== CREATE APPOINTMENT MODAL ===== */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">📅 นัดหมายใหม่</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">งาน (ไม่บังคับ)</label>
                  <select value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— ไม่ระบุงาน —</option>
                    {jobs.map((j) => (
                      <option key={j.job_no} value={j.job_no}>{j.job_no} {j.customer_name ? `· ${j.customer_name}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ทีมช่าง (ไม่บังคับ)</label>
                  <select value={form.tech_id} onChange={(e) => setForm({ ...form, tech_id: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— ไม่ระบุช่าง —</option>
                    {techs.filter((t) => t.is_active).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่ *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">เริ่ม *</label>
                    <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">สิ้นสุด *</label>
                    <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                <button onClick={createAppointment} disabled={saving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                  {saving ? 'กำลังบันทึก…' : 'สร้างนัดหมาย'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TECH TEAMS MODAL ===== */}
      {showTechs && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setShowTechs(false); setEditTech(null); setTechForm(emptyTechForm); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-semibold">👷 จัดการทีมช่าง</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {/* Add / Edit form */}
              <div className="bg-slate-50 rounded-xl p-4 mb-4">
                <div className="text-sm font-medium mb-3">{editTech ? 'แก้ไขทีมช่าง' : 'เพิ่มทีมช่างใหม่'}</div>
                <div className="space-y-2">
                  <input value={techForm.name} onChange={(e) => setTechForm({ ...techForm, name: e.target.value })}
                    placeholder="ชื่อทีม / ช่าง *" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={techForm.phone} onChange={(e) => setTechForm({ ...techForm, phone: e.target.value })}
                    placeholder="เบอร์โทร" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={techForm.notes} onChange={(e) => setTechForm({ ...techForm, notes: e.target.value })}
                    placeholder="หมายเหตุ" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-2 mt-3">
                  {editTech && (
                    <button onClick={() => { setEditTech(null); setTechForm(emptyTechForm); }}
                      className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">
                      ยกเลิก
                    </button>
                  )}
                  <button onClick={saveTech} disabled={saving}
                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                    {saving ? '…' : editTech ? 'บันทึก' : 'เพิ่ม'}
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="space-y-2">
                {techs.map((tech) => (
                  <div key={tech.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                    tech.is_active ? 'border-slate-100 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{tech.name}</div>
                      {tech.phone && <div className="text-xs text-slate-400">{tech.phone}</div>}
                      {tech.notes && <div className="text-xs text-slate-400">{tech.notes}</div>}
                      {tech.eval_avg > 0 && (
                        <div className="text-xs text-amber-500">★ {tech.eval_avg.toFixed(1)}</div>
                      )}
                    </div>
                    <button onClick={() => { setEditTech(tech); setTechForm({ name: tech.name, phone: tech.phone ?? '', notes: tech.notes ?? '' }); }}
                      className="p-1.5 text-slate-400 hover:text-slate-600">
                      ✏️
                    </button>
                    <button onClick={() => toggleTechActive(tech)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium ${
                        tech.is_active ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600 border border-blue-200'
                      }`}>
                      {tech.is_active ? 'ปิด' : 'เปิด'}
                    </button>
                  </div>
                ))}
                {techs.length === 0 && (
                  <div className="text-center text-slate-300 py-6 text-sm">ยังไม่มีทีมช่าง</div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end">
              <button onClick={() => { setShowTechs(false); setEditTech(null); setTechForm(emptyTechForm); }}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

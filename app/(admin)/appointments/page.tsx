"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import TechnicianManager from "@/components/appointments/technician-manager";
import TechnicianAssignmentButton from "@/components/appointments/technician-assignment";
import type { FloorTechnician, TechnicianAssignment } from "@/lib/technicians";
import { notifyError } from "@/lib/notify-error";

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

function getMonthCalendarDays(month: Date): Date[] {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());
  const end = new Date(lastDay);
  end.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
  const days: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) days.push(new Date(cursor));
  return days;
}

function hoursBetween(start: string, end: string) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

function sameDay(d1: Date, iso: string) {
  const d2 = new Date(iso);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isToday(d: Date) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isPastDay(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(d);
  candidate.setHours(0, 0, 0, 0);
  return candidate < today;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedLoadDate, setSelectedLoadDate] = useState(() => new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [loadView, setLoadView] = useState<'day' | 'month'>('month');
  const [staffRole, setStaffRole] = useState<string | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showTechs, setShowTechs] = useState(false);
  const [showIndividuals, setShowIndividuals] = useState(false);
  const [showPendingAlerts, setShowPendingAlerts] = useState(false);
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
    setLoadError(null);
    try {
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
      const error = apptError ?? techError ?? jobError ?? personError ?? assignmentError;
      if (error) throw error;
      setAppointments((apptData ?? []) as Appointment[]);
      setTechs((techData ?? []) as TechTeam[]);
      setJobs((jobData ?? []) as Job[]);
      setTechnicians((personData ?? []) as FloorTechnician[]);
      setAssignments((assignmentData ?? []) as TechnicianAssignment[]);
      setLastUpdatedAt(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถเชื่อมต่อข้อมูลได้';
      setLoadError(message);
      notifyError(`โหลดข้อมูลนัดหมายไม่สำเร็จ: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("manage") === "teams") setShowTechs(true);
  }, []);
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
  const teamWorkloads = useMemo(() => techs.filter((team) => team.is_active).map((team) => {
    const teamAppointments = weekAppts.filter((appointment) => appointment.tech_id === team.id);
    const teamTechnicians = weeklyTechnicians.filter((technician) => technician.team_id === team.id);
    const assignedTechnicianIds = new Set(activeAssignments
      .filter((assignment) => teamAppointments.some((appointment) => appointment.id === assignment.appointment_id))
      .map((assignment) => assignment.technician_id));
    const hours = teamAppointments.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0);
    const capacityHours = teamTechnicians.length * 5 * 8;
    const unassigned = teamAppointments.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id));
    const conflicts = teamAppointments.filter((appointment) => conflictAppointmentIds.has(appointment.id));
    return {
      team,
      jobs: teamAppointments.length,
      hours,
      capacityHours,
      utilization: capacityHours ? Math.round((hours / capacityHours) * 100) : null,
      members: teamTechnicians.length,
      assignedMembers: assignedTechnicianIds.size,
      unassigned: unassigned.length,
      conflicts: conflicts.length,
    };
  }).sort((a, b) => b.hours - a.hours), [activeAssignments, assignedAppointmentIds, conflictAppointmentIds, techs, weekAppts, weeklyTechnicians]);
  const selectedDayAppointments = appointments.filter((appointment) => appointment.status !== 'cancelled' && sameDay(selectedLoadDate, appointment.slot_start));
  const selectedDayUnassigned = selectedDayAppointments.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id));
  const selectedDayLoads = weeklyTechnicians.map((technician) => {
    const technicianAppointmentIds = new Set(activeAssignments.filter((assignment) => assignment.technician_id === technician.id).map((assignment) => assignment.appointment_id));
    const jobsForDay = selectedDayAppointments.filter((appointment) => technicianAppointmentIds.has(appointment.id));
    const hours = jobsForDay.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0);
    return { technician, jobs: jobsForDay, hours };
  }).sort((a, b) => b.hours - a.hours || a.technician.name.localeCompare(b.technician.name, 'th'));
  const selectedMonthAppointments = appointments.filter((appointment) => {
    if (appointment.status === 'cancelled') return false;
    const date = new Date(appointment.slot_start);
    return date.getFullYear() === selectedLoadDate.getFullYear() && date.getMonth() === selectedLoadDate.getMonth();
  });
  const selectedMonthUnassigned = selectedMonthAppointments.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id));
  const selectedMonthLoads = weeklyTechnicians.map((technician) => {
    const technicianAppointmentIds = new Set(activeAssignments.filter((assignment) => assignment.technician_id === technician.id).map((assignment) => assignment.appointment_id));
    const jobsForMonth = selectedMonthAppointments.filter((appointment) => technicianAppointmentIds.has(appointment.id));
    const hours = jobsForMonth.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0);
    const days = new Set(jobsForMonth.map((appointment) => new Date(appointment.slot_start).toLocaleDateString('en-CA'))).size;
    return { technician, jobs: jobsForMonth, hours, days };
  }).sort((a, b) => b.hours - a.hours || a.technician.name.localeCompare(b.technician.name, 'th'));
  const selectedMonthTeamLoads = techs.filter((team) => team.is_active).map((team) => {
    const teamAppointments = selectedMonthAppointments.filter((appointment) => appointment.tech_id === team.id);
    const members = weeklyTechnicians.filter((technician) => technician.team_id === team.id).length;
    const hours = teamAppointments.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0);
    const unassigned = teamAppointments.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id)).length;
    return { team, jobs: teamAppointments.length, hours, members, unassigned };
  }).sort((a, b) => b.hours - a.hours);
  const monthCalendarDays = useMemo(() => getMonthCalendarDays(selectedLoadDate), [selectedLoadDate]);
  const monthAvailability = useMemo(() => monthCalendarDays
    .filter((date) => date.getMonth() === selectedLoadDate.getMonth())
    .map((date) => {
      const jobsForDate = selectedMonthAppointments.filter((appointment) => sameDay(date, appointment.slot_start));
      const appointmentIds = new Set(jobsForDate.map((appointment) => appointment.id));
      const hoursByTechnician = new Map<string, number>();
      activeAssignments.filter((assignment) => appointmentIds.has(assignment.appointment_id)).forEach((assignment) => {
        const appointment = jobsForDate.find((item) => item.id === assignment.appointment_id);
        if (!appointment) return;
        hoursByTechnician.set(assignment.technician_id, (hoursByTechnician.get(assignment.technician_id) ?? 0) + hoursBetween(appointment.slot_start, appointment.slot_end));
      });
      const fullDayAvailable = weeklyTechnicians.filter((technician) => (hoursByTechnician.get(technician.id) ?? 0) < 0.5);
      const partiallyAvailable = weeklyTechnicians.filter((technician) => {
        const bookedHours = hoursByTechnician.get(technician.id) ?? 0;
        return bookedHours >= 0.5 && bookedHours <= 5;
      });
      const availableTechnicians = [...fullDayAvailable, ...partiallyAvailable];
      return { date, jobs: jobsForDate.length, fullDay: fullDayAvailable.length, partial: partiallyAvailable.length, available: availableTechnicians.length, fullNames: fullDayAvailable.map((technician) => technician.name), partialNames: partiallyAvailable.map((technician) => technician.name) };
    }), [activeAssignments, monthCalendarDays, selectedLoadDate, selectedMonthAppointments, weeklyTechnicians]);

  function moveSelectedLoadDate(days: number) {
    setSelectedLoadDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + days);
      return next;
    });
  }

  function moveSelectedLoadMonth(months: number) {
    setSelectedLoadDate((current) => new Date(current.getFullYear(), current.getMonth() + months, 1));
  }

  // --- Create Appointment ---
  async function createAppointment() {
    if (!canManage) { notifyError('เฉพาะหัวหน้าช่างหรือผู้ดูแลระบบเท่านั้นที่สร้างนัดหมายได้'); return; }
    if (!form.date || !form.start_time || !form.end_time) { notifyError('กรุณาระบุวันและเวลา'); return; }
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
    if (error) { notifyError(error); return; }
    toast.success('สร้างนัดหมายเรียบร้อย');
    setShowCreate(false);
    setForm(emptyForm);
    loadData();
  }

  // --- Update Status ---
  async function updateStatus(appt: Appointment, newStatus: string) {
    if (!canManage) { notifyError('บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์เปลี่ยนสถานะคิว'); return; }
    if (newStatus === 'confirmed' && appt.job_id) {
      const missing = appt.job ? missingJobFields(appt.job) : ['ข้อมูล Ticket'];
      if (missing.length) {
        notifyError(`ข้อมูลยังไม่ครบ: ${missing.join(', ')}`);
        return;
      }
      const assigned = assignments.some((a) => a.appointment_id === appt.id && a.is_active);
      if (!assigned) {
        notifyError('กรุณาจ่ายงานให้ช่างรายบุคคลอย่างน้อย 1 คนก่อนยืนยัน');
        return;
      }
    }
    const confirmedAt = newStatus === 'confirmed' ? new Date().toISOString() : null;
    const update = supabase.from('appointments').update({ status: newStatus, confirmed_at: confirmedAt });
    const { error } = appt.job_id && newStatus === 'confirmed'
      ? await update.eq('job_id', appt.job_id).neq('status', 'cancelled')
      : await update.eq('id', appt.id);
    if (error) { notifyError(error); return; }
    if (appt.job_id && newStatus === 'confirmed') {
      const { error: jobError } = await supabase.from('install_jobs').update({
        status: 'ยืนยันคิวแล้ว', waiting_on: 'ไม่ได้ค้าง', waiting_since: null,
        flag_note: null, updated_at: new Date().toISOString(),
      }).eq('job_no', appt.job_id);
      if (jobError) { notifyError(`อัปเดตสถานะคิวแล้ว แต่ปรับข้อมูลใบงานไม่สำเร็จ: ${floorErrorMessage(jobError)}`); void loadData(); return; }
      await supabase.from('job_activity').insert({
        job_no: appt.job_id, actor: 'หัวหน้าช่าง', action: 'confirm', field: 'status',
        old_value: appt.job?.status ?? null, new_value: 'ยืนยันคิวแล้ว',
      });
    }
    toast.success(`อัปเดตสถานะเป็น ${STATUS_CONFIG[newStatus]?.label ?? newStatus}`);
    loadData();
  }

  async function cancelAppointment(appt: Appointment) {
    if (!canManage) { notifyError('บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์ยกเลิกคิว'); return; }
    const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
    if (error) { notifyError(error); return; }
    if (appt.job_id) {
      const { count } = await supabase.from('appointments')
        .select('id', { count: 'exact', head: true }).eq('job_id', appt.job_id).neq('status', 'cancelled');
      if (!count) {
        const { error: jobError } = await supabase.from('install_jobs').update({
          status: 'ยกเลิกคิว', waiting_on: 'ไม่ได้ค้าง', waiting_since: null, updated_at: new Date().toISOString(),
        }).eq('job_no', appt.job_id);
        if (jobError) { notifyError(`ยกเลิกคิวแล้ว แต่ปรับสถานะใบงานไม่สำเร็จ: ${floorErrorMessage(jobError)}`); void loadData(); return; }
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
    if (!canManage) { notifyError('เฉพาะหัวหน้าช่างหรือผู้ดูแลระบบเท่านั้นที่ย้ายทีมได้'); return; }
    if (!techId || techId === appt.tech_id) return;
    const { data: clashes, error: clashError } = await supabase.from('appointments')
      .select('id').eq('tech_id', techId).neq('status', 'cancelled').neq('id', appt.id)
      .lt('slot_start', appt.slot_end).gt('slot_end', appt.slot_start).limit(1);
    if (clashError) { notifyError(clashError); return; }
    if (clashes?.length) { notifyError('ทีมที่เลือกมีคิวชนในช่วงเวลานี้'); return; }

    const { error } = await supabase.from('appointments').update({
      tech_id: techId, status: 'proposed', confirmed_at: null,
    }).eq('id', appt.id);
    if (error) { notifyError(error); return; }
    const { error: revokeError } = await supabase.from('appointment_technicians').update({
      is_active: false, is_lead: false, revoked_at: new Date().toISOString(),
    }).eq('appointment_id', appt.id).eq('is_active', true);
    if (revokeError) { notifyError(`ย้ายทีมแล้ว แต่ปิดการมอบหมายช่างเดิมไม่สำเร็จ: ${floorErrorMessage(revokeError)}`); void loadData(); return; }
    if (appt.job_id) {
      const { error: jobError } = await supabase.from('install_jobs').update({
        status: 'รอหัวหน้าช่างยืนยัน', waiting_on: 'หัวหน้าช่าง',
        waiting_since: new Date().toISOString(), assignees: [], updated_at: new Date().toISOString(),
      }).eq('job_no', appt.job_id);
      if (jobError) { notifyError(`ย้ายทีมแล้ว แต่ปรับข้อมูลใบงานไม่สำเร็จ: ${floorErrorMessage(jobError)}`); void loadData(); return; }
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
    if (!techForm.name.trim()) { notifyError('กรุณาระบุชื่อ'); return; }
    setSaving(true);
    if (editTech) {
      const { error } = await supabase.from('tech_teams').update({
        name: techForm.name.trim(),
        phone: techForm.phone.trim() || null,
        notes: techForm.notes.trim() || null,
      }).eq('id', editTech.id);
      if (error) { setSaving(false); notifyError(error); return; }
      toast.success('แก้ไขทีมช่างเรียบร้อย');
    } else {
      const { error } = await supabase.from('tech_teams').insert({
        name: techForm.name.trim(),
        phone: techForm.phone.trim() || null,
        notes: techForm.notes.trim() || null,
      });
      if (error) { setSaving(false); notifyError(error); return; }
      toast.success('เพิ่มทีมช่างเรียบร้อย');
    }
    setSaving(false);
    setEditTech(null);
    setTechForm(emptyTechForm);
    loadData();
  }

  async function toggleTechActive(tech: TechTeam) {
    const { error } = await supabase.from('tech_teams').update({ is_active: !tech.is_active }).eq('id', tech.id);
    if (error) { notifyError(error); return; }
    loadData();
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">จัดคิวและโหลดงานช่าง</h1>
          <p className="text-slate-500 text-sm mt-0.5">ดูงานรายบุคคล คิวชน และเวลางานรวมก่อนยืนยันคิว</p>
        </div>
        {canManage ? <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:flex-wrap sm:justify-end">
          {pendingAppts.length ? <button onClick={() => setShowPendingAlerts(true)} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100">
            🔔 รอยืนยัน ({pendingAppts.length})
          </button> : null}
          <button onClick={() => setShowIndividuals(true)}
            className="px-3 py-1.5 text-sm border border-violet-200 rounded-lg text-violet-700 hover:bg-violet-50">
            👤 ช่าง / PIN
          </button>
          <button onClick={() => setShowTechs(true)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
            👷 ทีมช่าง
          </button>
          <button onClick={() => setShowCreate(true)}
            className="col-span-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:col-span-1">
            + นัดหมายใหม่
          </button>
        </div> : <span className="ml-auto rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">โหมดดูข้อมูล</span>}
        <button type="button" onClick={loadData} disabled={loading} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 sm:shrink-0">{loading ? 'กำลังโหลด…' : '↻ รีเฟรช'}</button>
      </div>

      {loadError ? <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><div><strong>ข้อมูลอาจไม่ครบ</strong><p className="mt-0.5 text-xs text-red-700">{loadError}</p></div><button type="button" onClick={loadData} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">ลองโหลดใหม่</button></div> : null}

      {/* Stats */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="font-semibold">ทำงานตามลำดับนี้</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg bg-white px-3 py-2"><strong className="text-blue-700">1. เลือกวัน</strong><p className="mt-0.5 text-xs text-slate-600">ดูวันที่ทีมยังรับงานได้</p></div>
          <div className="rounded-lg bg-white px-3 py-2"><strong className="text-blue-700">2. ตรวจโหลด</strong><p className="mt-0.5 text-xs text-slate-600">ดูช่างและงานของวันนั้น</p></div>
          <div className="rounded-lg bg-white px-3 py-2"><strong className="text-blue-700">3. จัดช่าง</strong><p className="mt-0.5 text-xs text-slate-600">เปิดรายการรอยืนยันเพื่อมอบหมาย</p></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-blue-600">{lastUpdatedAt ? `อัปเดตล่าสุด ${lastUpdatedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.` : 'กำลังเชื่อมต่อข้อมูล…'}</p><Link href="/operations" className="inline-flex rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">ดูงานที่ต้องตัดสินใจ →</Link></div>
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

      <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-base font-bold text-slate-900">โหลดงานช่าง</h2><p className="mt-0.5 text-xs text-slate-500">ดูโหลดของช่างรายวัน หรือภาพรวมตลอดทั้งเดือน</p></div>
          <div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg bg-slate-100 p-1"><button type="button" onClick={() => setLoadView('day')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${loadView === 'day' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>รายวัน</button><button type="button" onClick={() => setLoadView('month')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${loadView === 'month' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>รายเดือน</button></div><button type="button" onClick={() => loadView === 'day' ? moveSelectedLoadDate(-1) : moveSelectedLoadMonth(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="ช่วงก่อนหน้า">←</button><button type="button" onClick={() => setSelectedLoadDate(new Date())} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">{loadView === 'day' ? 'วันนี้' : 'เดือนนี้'}</button><button type="button" onClick={() => loadView === 'day' ? moveSelectedLoadDate(1) : moveSelectedLoadMonth(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="ช่วงถัดไป">→</button></div>
        </div>
        <div className="border-b border-blue-100 bg-blue-50 px-5 py-3"><p className="font-semibold text-blue-950">{loadView === 'day' ? selectedLoadDate.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : selectedLoadDate.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</p><p className="mt-0.5 text-xs text-blue-700">{loadView === 'day' ? `มีคิว ${selectedDayAppointments.length} งาน · ยังไม่จ่ายช่าง ${selectedDayUnassigned.length} งาน` : `มีคิว ${selectedMonthAppointments.length} งาน · รวม ${selectedMonthAppointments.reduce((sum, appointment) => sum + hoursBetween(appointment.slot_start, appointment.slot_end), 0).toFixed(0)} ชม. · ยังไม่จ่ายช่าง ${selectedMonthUnassigned.length} งาน`}</p></div>
        {loading ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((key) => <div key={key} className="h-36 animate-pulse rounded-xl bg-slate-100" />)}</div> : loadView === 'day' && selectedDayLoads.length ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {selectedDayLoads.map(({ technician, jobs: technicianJobs, hours }) => {
            const overloaded = hours > 8;
            const busy = hours > 0;
            const state = overloaded ? "เกินกำลัง" : busy ? "มีงาน" : "ว่าง";
            const stateClass = overloaded ? "bg-red-100 text-red-700" : busy ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700";
            return <article key={technician.id} className={`rounded-xl border p-4 ${overloaded ? "border-red-200 bg-red-50" : busy ? "border-blue-200 bg-blue-50/50" : "border-emerald-200 bg-emerald-50/50"}`}>
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{technician.name}{technician.is_team_lead ? " ★" : ""}</h3><p className="mt-0.5 text-xs text-slate-500">{techs.find((team) => team.id === technician.team_id)?.name || "ไม่ระบุทีม"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stateClass}`}>{state}</span></div>
              <div className="mt-3 flex items-baseline gap-2"><span className="text-2xl font-bold text-slate-900">{hours.toFixed(hours % 1 ? 1 : 0)} ชม.</span><span className="text-xs text-slate-500">{technicianJobs.length} งาน</span></div>
              {technicianJobs.length ? <div className="mt-3 space-y-1.5 border-t border-slate-200/70 pt-3">{technicianJobs.map((appointment) => <Link key={appointment.id} href={appointment.job_id ? `/orders/${encodeURIComponent(appointment.job_id)}` : '#'} className="block rounded-lg bg-white px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-50"><span className="font-semibold text-slate-900">{fmtTime(appointment.slot_start)} – {fmtTime(appointment.slot_end)}</span><span className="ml-2">{appointment.job?.customer_name || appointment.job_id || "นัดหมาย"}</span></Link>)}</div> : <p className="mt-3 border-t border-emerald-200 pt-3 text-xs text-emerald-700">พร้อมรับงานในวันดังกล่าว</p>}
            </article>;
          })}
        </div> : loadView === 'month' ? <div className="grid gap-4 p-5 lg:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-amber-800">ต้องจัดการก่อน</p><h3 className="mt-1 text-2xl font-bold text-amber-950">{selectedMonthUnassigned.length} งานรอจ่ายช่าง</h3><p className="mt-1 text-xs text-amber-800">รวมงานที่ยังไม่มีรายชื่อช่างรับผิดชอบในเดือนนี้</p></div><span className="grid h-10 w-10 place-items-center rounded-full bg-white text-xl">⚠️</span></div>{selectedMonthUnassigned.length ? <div className="mt-4 space-y-2">{selectedMonthUnassigned.slice(0, 3).map((appointment) => <button type="button" key={appointment.id} onClick={() => setShowPendingAlerts(true)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-left text-xs text-slate-700 hover:bg-amber-100"><span className="min-w-0 truncate"><strong>{fmtDate(new Date(appointment.slot_start))}</strong> · {appointment.job?.customer_name || appointment.job_id || 'นัดหมาย'}</span><span className="shrink-0 font-semibold text-amber-700">จัดช่าง →</span></button>)}{selectedMonthUnassigned.length > 3 ? <button type="button" onClick={() => setShowPendingAlerts(true)} className="text-xs font-semibold text-amber-800 hover:underline">ดูอีก {selectedMonthUnassigned.length - 3} งาน</button> : null}</div> : <div className="mt-4 rounded-lg bg-white px-3 py-3 text-sm font-medium text-emerald-700">✓ จ่ายช่างครบทุกงานในเดือนนี้</div>}</article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-600">ภาพรวมทีม</p><div className="mt-3 space-y-3">{selectedMonthTeamLoads.map((workload) => { const attention = workload.unassigned > 0 || workload.members === 0; return <div key={workload.team.id} className="rounded-lg bg-white px-3 py-2.5"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-slate-900">{workload.team.name}</p><p className="mt-0.5 text-xs text-slate-500">{workload.jobs} งาน · {workload.hours.toFixed(0)} ชม. · ช่าง {workload.members} คน</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${attention ? 'bg-amber-100 text-amber-800' : workload.jobs ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{attention ? 'ต้องจัดการ' : workload.jobs ? 'มีงาน' : 'พร้อม'}</span></div></div>; })}{!selectedMonthTeamLoads.length ? <p className="text-sm text-slate-400">ยังไม่มีทีมช่าง Active</p> : null}</div></article>
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-800">วันพร้อมรับงานเพิ่ม</p><h3 className="mt-1 text-2xl font-bold text-emerald-950">{monthAvailability.filter((day) => day.available > 0).length} วัน</h3><p className="mt-1 text-xs text-emerald-800">ว่างเต็มวัน {monthAvailability.filter((day) => day.fullDay > 0).length} วัน · ว่างบางช่วงรวม {monthAvailability.filter((day) => day.partial > 0).length} วัน</p><div className="mt-4 space-y-2">{monthAvailability.filter((day) => day.available > 0).sort((a, b) => b.fullDay - a.fullDay || b.partial - a.partial || a.date.getTime() - b.date.getTime()).slice(0, 4).map((day) => <button type="button" key={dayKey(day.date)} onClick={() => setSelectedCalendarDay(day.date)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left hover:bg-emerald-100"><span className="text-xs font-semibold text-slate-800">{fmtDate(day.date)} · มีคิว {day.jobs} งาน</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">เต็มวัน {day.fullDay} · ช่วงว่าง {day.partial}</span></button>)}{!monthAvailability.length ? <p className="text-sm text-slate-400">ยังไม่มีรายชื่อช่าง Active</p> : null}</div></article>
        </div> : <div className="px-5 py-10 text-center text-sm text-slate-400">ยังไม่มีรายชื่อช่าง Active</div>}
        {(loadView === 'day' ? selectedDayUnassigned.length : selectedMonthUnassigned.length) ? <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">⚠️ มี {loadView === 'day' ? selectedDayUnassigned.length : selectedMonthUnassigned.length} งานที่ยังไม่จ่ายช่าง — เปิด popup “รอยืนยัน” เพื่อจัดทีมและมอบหมายช่าง</div> : null}
      </section>

      {loadView === 'month' ? <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-bold text-slate-900">ปฏิทินกำลังคน</h2><p className="mt-0.5 text-xs text-slate-500">ใช้หาวันรับงานเพิ่ม — กดวันที่เพื่อดูรายชื่อช่างและคิวละเอียด</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{selectedMonthAppointments.length} งานในเดือนนี้</span></div>
        <div className="space-y-2 p-3 sm:hidden">{monthCalendarDays.filter((date) => date.getMonth() === selectedLoadDate.getMonth() && !isPastDay(date)).map((date) => {
          const jobsForDate = selectedMonthAppointments.filter((appointment) => sameDay(date, appointment.slot_start));
          const unassigned = jobsForDate.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id)).length;
          const availability = monthAvailability.find((day) => dayKey(day.date) === dayKey(date));
          const tone = unassigned ? 'border-amber-200 bg-amber-50' : availability?.fullDay ? 'border-emerald-200 bg-emerald-50' : availability?.partial ? 'border-cyan-200 bg-cyan-50' : 'border-slate-200 bg-white';
          const status = unassigned ? `รอจัดช่าง ${unassigned} งาน` : availability?.fullDay ? `ว่างเต็มวัน ${availability.fullDay} คน` : availability?.partial ? `มีช่วงว่าง ${availability.partial} คน` : 'ทีมเต็มแล้ว';
          return <button type="button" key={`mobile-${date.toISOString()}`} onClick={() => setSelectedCalendarDay(date)} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left ${tone} ${isToday(date) ? 'ring-2 ring-blue-500' : ''}`}><div><div className="font-semibold text-slate-900">{date.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}</div><div className="mt-0.5 text-xs text-slate-500">มีคิว {jobsForDate.length} งาน</div></div><span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{status}</span></button>;
        })}</div>
        <div className="hidden overflow-x-auto sm:block"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{DAY_TH.map((day, index) => <div key={`${day}-${index}`} className={`px-3 py-2 text-center text-xs font-semibold ${index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-600' : 'text-slate-600'}`}>{day}</div>)}</div><div className="grid grid-cols-7">{monthCalendarDays.map((date) => {
          const jobsForDate = selectedMonthAppointments.filter((appointment) => sameDay(date, appointment.slot_start));
          const outsideMonth = date.getMonth() !== selectedLoadDate.getMonth();
          const unassigned = jobsForDate.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id)).length;
          const availability = monthAvailability.find((day) => dayKey(day.date) === dayKey(date));
          const past = isPastDay(date);
          const cellTone = outsideMonth || past ? 'bg-slate-50/70 text-slate-400' : unassigned ? 'bg-amber-50' : jobsForDate.length ? 'bg-blue-50/40' : 'bg-emerald-50/40';
          return <button type="button" key={date.toISOString()} onClick={() => !outsideMonth && setSelectedCalendarDay(date)} className={`min-h-32 border-b border-r border-slate-100 p-3 text-left transition hover:bg-blue-50 ${cellTone} ${isToday(date) ? 'ring-2 ring-inset ring-blue-500' : ''}`}><div className="flex items-center justify-between"><span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${isToday(date) ? 'bg-blue-600 text-white' : ''}`}>{date.getDate()}</span>{past ? <span className="text-[10px] font-medium">ผ่านมาแล้ว</span> : null}</div>{!outsideMonth && !past ? <div className="mt-4"><div className="flex gap-1.5"><span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">งาน {jobsForDate.length}</span>{unassigned ? <span className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">รอจัด {unassigned}</span> : null}</div><div className={`mt-3 rounded-lg px-2.5 py-2 ${unassigned ? 'bg-amber-100 text-amber-900' : availability?.fullDay ? 'bg-emerald-100 text-emerald-800' : availability?.partial ? 'bg-cyan-100 text-cyan-800' : 'bg-red-100 text-red-800'}`}><p className="text-[10px] font-medium">{unassigned ? 'ต้องจ่ายช่างก่อน' : availability?.fullDay ? 'ช่างว่างเต็มวัน' : availability?.partial ? 'ยังมีช่วงว่าง' : 'ช่างเต็มแล้ว'}</p><p className="mt-0.5 text-lg font-bold leading-none">{unassigned ? `${unassigned} งาน` : availability?.fullDay ? `${availability.fullDay} คน` : availability?.partial ? `${availability.partial} คน` : '—'}</p></div></div> : null}</button>;
        })}</div></div></div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-600"><strong>วิธีอ่าน:</strong> เขียว = รับงานเพิ่มได้เต็มวัน · ฟ้า = ยังมีช่วงว่าง · เหลือง = ต้องจ่ายช่างก่อนจึงสรุปความว่างได้ · กดวันเพื่อดูช่างและคิวรายบุคคล</div>
      </section> : null}

      {/* The operational overview is deliberately team-based, not a dense person-by-day calendar. */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">สรุปทีมช่างสัปดาห์นี้</h2>
            <p className="mt-0.5 text-xs text-slate-500">{fmtDate(weekStart)} – {fmtDate(weekEnd)} · ดูเฉพาะว่าทีมไหนพร้อม และทีมไหนต้องจัดการ</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">กำลังการทำงาน = ช่าง Active × 8 ชม. × 5 วัน</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">ต้องจัดการ: {unassignedWeekAppts.length + conflictAppointmentIds.size} จุด</span>
          </div>
        </div>
        {loading ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((key) => <div key={key} className="h-40 animate-pulse rounded-xl bg-slate-100" />)}</div> : teamWorkloads.length ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {teamWorkloads.map((workload) => {
            const overloaded = workload.utilization !== null && workload.utilization > 85;
            const needsAttention = workload.unassigned > 0 || workload.conflicts > 0 || workload.members === 0;
            const tone = workload.members === 0 ? "border-red-200 bg-red-50" : needsAttention ? "border-amber-200 bg-amber-50" : overloaded ? "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50";
            const label = workload.members === 0 ? "ยังไม่มีช่าง Active" : workload.conflicts ? "มีคิวชน" : workload.unassigned ? "รอจ่ายช่าง" : overloaded ? "โหลดค่อนข้างสูง" : "พร้อมรับงาน";
            const labelTone = workload.members === 0 || workload.conflicts ? "bg-red-100 text-red-700" : needsAttention || overloaded ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700";
            return <article key={workload.team.id} className={`rounded-xl border p-4 ${tone}`}>
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{workload.team.name}</h3><p className="mt-0.5 text-xs text-slate-500">ช่าง Active {workload.members} คน · ถูกจ่ายงานแล้ว {workload.assignedMembers} คน</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${labelTone}`}>{label}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2"><div><div className="text-xl font-bold text-slate-900">{workload.jobs}</div><div className="text-[11px] text-slate-500">งานในสัปดาห์นี้</div></div><div><div className="text-xl font-bold text-slate-900">{workload.hours.toFixed(workload.hours % 1 ? 1 : 0)} ชม.</div><div className="text-[11px] text-slate-500">เวลางานรวม</div></div></div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">{workload.unassigned ? <span className="rounded bg-white px-2 py-1 font-medium text-amber-800">👤 รอจ่ายช่าง {workload.unassigned} งาน</span> : null}{workload.conflicts ? <span className="rounded bg-white px-2 py-1 font-medium text-red-700">⚠️ คิวชน {workload.conflicts} งาน</span> : null}{!workload.unassigned && !workload.conflicts && workload.members > 0 ? <span className="rounded bg-white px-2 py-1 text-emerald-700">✓ จ่ายช่างครบแล้ว</span> : null}</div>
            </article>;
          })}
        </div> : <div className="px-5 py-10 text-center text-sm text-slate-400">ยังไม่มีทีมช่าง Active สำหรับคำนวณ Workload</div>}
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-600"><strong>วิธีอ่าน:</strong> การ์ดสีเขียว = พร้อม, สีเหลือง = ต้องจัดช่าง, สีแดง = ต้องแก้คิวชนหรือยังไม่มีช่าง</div>
      </section>

      {/* Retained in source only while the team validates the simpler workload view. */}
      {false && <details className="group mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          <span>ดูตารางละเอียดรายช่าง (ใช้เมื่อจำเป็นต้องเทียบเวลาในแต่ละวัน)</span>
          <span className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 group-open:hidden">เปิดตาราง</span>
          <span className="hidden rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 group-open:inline">ซ่อนตาราง</span>
        </summary>
      <section className="border-t border-slate-200">
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
      </details>}

      <TechnicianManager
        open={showIndividuals}
        teams={techs}
        technicians={technicians}
        onClose={() => setShowIndividuals(false)}
        onChanged={loadData}
      />

      {selectedCalendarDay ? (() => {
        const dayAppointments = appointments.filter((appointment) => appointment.status !== 'cancelled' && sameDay(selectedCalendarDay, appointment.slot_start));
        const dayAvailability = monthAvailability.find((day) => dayKey(day.date) === dayKey(selectedCalendarDay));
        const dayAppointmentIds = new Set(dayAppointments.map((appointment) => appointment.id));
        const unassignedCount = dayAppointments.filter((appointment) => appointment.job_id && !assignedAppointmentIds.has(appointment.id)).length;
        return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-5" onClick={() => setSelectedCalendarDay(null)}>
          <section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="รายละเอียดกำลังคนรายวัน" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-blue-100 bg-blue-50 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Daily capacity</p><h2 className="mt-1 text-lg font-bold text-slate-900">{selectedCalendarDay.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2><p className="mt-1 text-xs text-blue-700">มีคิว {dayAppointments.length} งาน · {unassignedCount ? `รอจ่ายช่าง ${unassignedCount} งาน` : 'จ่ายช่างครบแล้ว'}</p></div><button type="button" onClick={() => setSelectedCalendarDay(null)} className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-500 hover:bg-white" aria-label="ปิดรายละเอียด">×</button></header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2"><article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-800">ว่างเต็มวัน</p><p className="mt-1 text-2xl font-bold text-emerald-950">{dayAvailability?.fullDay ?? 0} คน</p><p className="mt-2 text-xs text-emerald-800">{dayAvailability?.fullNames.length ? dayAvailability.fullNames.join(', ') : 'ไม่มีช่างว่างเต็มวัน'}</p></article><article className="rounded-xl border border-cyan-200 bg-cyan-50 p-4"><p className="text-xs font-semibold text-cyan-800">ยังมีช่วงว่าง</p><p className="mt-1 text-2xl font-bold text-cyan-950">{dayAvailability?.partial ?? 0} คน</p><p className="mt-2 text-xs text-cyan-800">{dayAvailability?.partialNames.length ? dayAvailability.partialNames.join(', ') : 'ไม่มีช่างที่ว่างบางช่วง'}</p></article></div><div className="mt-5"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-slate-900">คิวงานของวัน</h3>{unassignedCount ? <button type="button" onClick={() => { setSelectedCalendarDay(null); setShowPendingAlerts(true); }} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600">จัดช่าง {unassignedCount} งาน</button> : null}</div><div className="space-y-3">{dayAppointments.length ? dayAppointments.map((appointment) => { const assignedNames = activeAssignments.filter((assignment) => assignment.appointment_id === appointment.id && dayAppointmentIds.has(assignment.appointment_id)).map((assignment) => technicians.find((technician) => technician.id === assignment.technician_id)?.name).filter((name): name is string => Boolean(name)); return <article key={appointment.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-slate-900">{fmtTime(appointment.slot_start)} – {fmtTime(appointment.slot_end)} · {appointment.job?.customer_name || appointment.job_id || 'นัดหมาย'}</p><p className="mt-1 text-xs text-slate-500">ทีม: {appointment.tech?.name || 'ยังไม่ระบุ'} · ช่าง: {assignedNames.length ? assignedNames.join(', ') : 'ยังไม่จ่ายช่าง'}</p></div><div className="flex flex-wrap gap-2">{appointment.job_id ? <TechnicianAssignmentButton appointmentId={appointment.id} appointmentTeamId={appointment.tech_id} jobNo={appointment.job_id} teams={techs} technicians={technicians} assignments={assignments} onChanged={loadData} /> : null}{appointment.job_id ? <Link href={`/orders/${encodeURIComponent(appointment.job_id)}`} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">เปิดใบงาน</Link> : null}</div></div></article>; }) : <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">ยังไม่มีคิวในวันนี้ — เลือกวันดังกล่าวเพื่อรับงานเพิ่มได้</div>}</div></div></div>
            <footer className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-right"><button type="button" onClick={() => setSelectedCalendarDay(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">ปิด</button></footer>
          </section>
        </div>;
      })() : null}

      {showPendingAlerts && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-5" onClick={() => setShowPendingAlerts(false)}>
          <section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="คิวที่รอยืนยัน" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-amber-200 bg-amber-50 px-5 py-4">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Workload alerts</p><h2 className="mt-1 text-lg font-bold text-slate-900">รอยืนยัน {pendingAppts.length} รายการ</h2><p className="mt-1 text-xs text-amber-800">จัดช่างให้ครบ แล้วเปิดใบสั่งงานเพื่อยืนยันส่งต่อ</p></div>
              <button type="button" onClick={() => setShowPendingAlerts(false)} className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-500 hover:bg-white" aria-label="ปิดรายการแจ้งเตือน">×</button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
              {pendingAppts.map((appt) => <article key={appt.id} className="rounded-xl border border-amber-200 bg-white p-3 sm:p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{appt.job?.customer_name ?? "ไม่ระบุลูกค้า"}</h3>{appt.job && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${appt.job.source === "bbps" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{appt.job.source === "bbps" ? "BBPS" : "ขายตรง"}</span>}</div><p className="mt-1 text-xs text-slate-500">{appt.job?.job_no ?? "ไม่มีเลขใบงาน"} · {fmtTime(appt.slot_start)} – {fmtTime(appt.slot_end)} · {appt.tech?.name ?? "ยังไม่ระบุทีม"}</p>{appt.job_id ? <div className="mt-2"><TechnicianAssignmentButton appointmentId={appt.id} appointmentTeamId={appt.tech_id} jobNo={appt.job_id} teams={techs} technicians={technicians} assignments={assignments} onChanged={loadData} /></div> : null}</div>
                  <div className="flex shrink-0 gap-2"><select value={appt.tech_id ?? ""} onChange={(event) => reassignTeam(appt, event.target.value)} aria-label={`ย้ายทีมสำหรับ ${appt.job?.customer_name ?? appt.job_id ?? "นัดหมาย"}`} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"><option value="">เลือกทีม</option>{techs.filter((team) => team.is_active).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>{appt.job_id ? <Link href={`/orders/${encodeURIComponent(appt.job_id)}`} onClick={() => setShowPendingAlerts(false)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">เปิดใบสั่งงาน</Link> : <button onClick={() => updateStatus(appt, "confirmed")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">ยืนยันคิว</button>}</div>
                </div>
              </article>)}
            </div>
            <footer className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-right"><button type="button" onClick={() => setShowPendingAlerts(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">ปิด</button></footer>
          </section>
        </div>
      )}

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

"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

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

function sameDay(d1: Date, iso: string) {
  const d2 = new Date(iso);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function isToday(d: Date) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function AppointmentsPage() {
  const supabase = createClient();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [techs, setTechs] = useState<TechTeam[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showTechs, setShowTechs] = useState(false);
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
    const [{ data: apptData }, { data: techData }, { data: jobData }] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, tech:tech_teams(*), job:install_jobs(job_no,customer_name,product_name,stage)')
        .order('slot_start'),
      supabase.from('tech_teams').select('*').order('name'),
      supabase.from('install_jobs').select('job_no,customer_name,product_name,stage').order('job_no', { ascending: false }).limit(200),
    ]);
    setAppointments((apptData ?? []) as Appointment[]);
    setTechs((techData ?? []) as TechTeam[]);
    setJobs((jobData ?? []) as Job[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const weekDays = getWeekDays(weekOffset);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];

  // Stats
  const todayAppts = appointments.filter((a) => isToday(new Date(a.slot_start)) && a.status !== 'cancelled');
  const pendingAppts = appointments.filter((a) => a.status === 'proposed');
  const weekAppts = appointments.filter((a) => {
    const d = new Date(a.slot_start);
    return d >= weekStart && d <= weekEnd && a.status !== 'cancelled';
  });

  // --- Create Appointment ---
  async function createAppointment() {
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
    const { error } = await supabase.from('appointments').update({ status: newStatus }).eq('id', appt.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`อัปเดตสถานะเป็น ${STATUS_CONFIG[newStatus]?.label ?? newStatus}`);
    loadData();
  }

  async function cancelAppointment(appt: Appointment) {
    await updateStatus(appt, 'cancelled');
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
          <h1 className="text-2xl font-semibold">นัดหมาย</h1>
          <p className="text-slate-500 text-sm mt-0.5">ตารางนัดหมายทีมช่าง</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowTechs(true)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
            👷 ทีมช่าง
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            + นัดหมายใหม่
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'วันนี้', value: todayAppts.length, icon: '📅', color: 'text-blue-600' },
          { label: 'รอยืนยัน', value: pendingAppts.length, icon: '⏳', color: 'text-amber-600' },
          { label: 'สัปดาห์นี้', value: weekAppts.length, icon: '📆', color: 'text-emerald-600' },
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
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtTime(appt.slot_start)} – {fmtTime(appt.slot_end)} · {appt.tech?.name ?? 'ไม่ระบุช่าง'}
                  </div>
                </div>
                <button onClick={() => updateStatus(appt, 'confirmed')}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shrink-0">
                  ✓ ยืนยัน
                </button>
                <button onClick={() => cancelAppointment(appt)}
                  className="px-3 py-1 text-xs bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200 shrink-0">
                  ยกเลิก
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week Calendar */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <button onClick={() => setWeekOffset((o) => o - 1)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            ←
          </button>
          <div className="font-medium text-sm">
            {fmtDate(weekStart)} – {fmtDate(weekEnd)}
          </div>
          <button onClick={() => setWeekOffset((o) => o + 1)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            →
          </button>
          <button onClick={() => setWeekOffset(0)}
            className="ml-1 px-2.5 py-1 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
            วันนี้
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm animate-pulse">โหลดข้อมูล…</div>
        ) : (
          <div className="grid grid-cols-7 divide-x divide-slate-100">
            {weekDays.map((day) => {
              const dayAppts = appointments.filter(
                (a) => sameDay(day, a.slot_start) && a.status !== 'cancelled'
              );
              return (
                <div key={day.toISOString()} className={`min-h-32 ${
                  isToday(day) ? 'bg-blue-50/50' : ''
                }`}>
                  <div className={`text-center py-2 border-b border-slate-100 ${
                    isToday(day) ? 'bg-blue-600 text-white' : 'text-slate-500'
                  }`}>
                    <div className="text-xs font-medium">{DAY_TH[day.getDay()]}</div>
                    <div className={`text-lg font-semibold leading-none mt-0.5 ${
                      isToday(day) ? 'text-white' : 'text-slate-700'
                    }`}>{day.getDate()}</div>
                  </div>
                  <div className="p-1 space-y-1">
                    {dayAppts.map((appt) => {
                      const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.proposed;
                      return (
                        <div key={appt.id}
                          className={`rounded px-1.5 py-1 text-xs cursor-pointer ${cfg.cls} hover:opacity-80`}
                          onClick={() => updateStatus(appt, STATUS_NEXT[appt.status])}
                          title={`คลิกเพื่ออัปเดตสถานะ → ${STATUS_CONFIG[STATUS_NEXT[appt.status]]?.label}`}
                        >
                          <div className="font-medium truncate">{appt.tech?.name ?? '—'}</div>
                          <div className="opacity-75 truncate">{fmtTime(appt.slot_start)}</div>
                          {appt.job?.customer_name && (
                            <div className="opacity-60 truncate">{appt.job.customer_name}</div>
                          )}
                        </div>
                      );
                    })}
                    {dayAppts.length === 0 && (
                      <div className="text-xs text-slate-200 text-center pt-2">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* All appointments list (below calendar) */}
      {!loading && appointments.filter((a) => a.status !== 'cancelled').length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 font-medium text-sm">รายการนัดหมายทั้งหมด</div>
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
                            <div className="text-xs text-slate-400">{appt.job.job_no}</div>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400">{appt.notes ?? '—'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          {appt.status === 'proposed' && (
                            <button onClick={() => updateStatus(appt, 'confirmed')}
                              className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
                              ✓
                            </button>
                          )}
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

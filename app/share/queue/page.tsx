"use client";
export const dynamic = "force-dynamic";
import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Team { id: string; name: string }
interface Appt {
  id: string;
  job_id: string | null;
  tech_id: string | null;
  slot_start: string;
  slot_end: string;
  status: string;
  notes: string | null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  proposed: { label: "รอยืนยัน", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "ยืนยันแล้ว", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "เสร็จสิ้น", cls: "bg-emerald-100 text-emerald-700" },
};
const DAY_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function getWeekDays(offset: number): Date[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}
function fmtDate(d: Date) { return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function sameDay(d: Date, iso: string) { const x = new Date(iso); return d.getFullYear() === x.getFullYear() && d.getMonth() === x.getMonth() && d.getDate() === x.getDate(); }
function isToday(d: Date) { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }

interface FormState { id: string | null; tech_id: string; date: string; start: string; end: string; notes: string }
const EMPTY_FORM: FormState = { id: null, tech_id: "", date: "", start: "09:00", end: "12:00", notes: "" };

export default function ShareQueuePage() {
  const supabase = createClient();
  const [offset, setOffset] = useState(0);
  const [teams, setTeams] = useState<Team[]>([]);
  const [jobs, setJobs] = useState<Record<string, string>>({});
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const week = useMemo(() => getWeekDays(offset), [offset]);
  const teamName = useCallback((id: string | null) => teams.find((t) => t.id === id)?.name ?? "ทีม", [teams]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = new Date(week[0]); start.setHours(0, 0, 0, 0);
    const end = new Date(week[6]); end.setHours(23, 59, 59, 999);
    const [{ data: tt }, { data: ap }] = await Promise.all([
      supabase.from("tech_teams").select("id, name").eq("is_active", true).order("name"),
      supabase.from("appointments").select("id, job_id, tech_id, slot_start, slot_end, status, notes")
        .gte("slot_start", start.toISOString()).lte("slot_start", end.toISOString())
        .neq("status", "cancelled").order("slot_start"),
    ]);
    setTeams((tt as Team[]) ?? []);
    const apps = (ap as Appt[]) ?? [];
    setAppts(apps);
    const jobIds = Array.from(new Set(apps.map((a) => a.job_id).filter(Boolean))) as string[];
    if (jobIds.length) {
      const { data: js } = await supabase.from("install_jobs").select("job_no, customer_name").in("job_no", jobIds);
      const jm: Record<string, string> = {};
      (js ?? []).forEach((j: { job_no: string; customer_name: string | null }) => { jm[j.job_no] = j.customer_name ?? ""; });
      setJobs(jm);
    } else setJobs({});
    setLoading(false);
  }, [week, supabase]);

  useEffect(() => { load(); }, [load]);

  function openAdd(date: Date) { setForm({ ...EMPTY_FORM, date: ymd(date), tech_id: teams[0]?.id ?? "" }); }
  function openEdit(a: Appt) {
    const s = new Date(a.slot_start), e = new Date(a.slot_end);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setForm({ id: a.id, tech_id: a.tech_id ?? "", date: ymd(s), start: hhmm(s), end: hhmm(e), notes: a.notes ?? "" });
  }

  async function save() {
    if (!form) return;
    if (!form.tech_id) { alert("กรุณาเลือกทีมช่าง"); return; }
    if (!form.date) { alert("กรุณาเลือกวันที่"); return; }
    setSaving(true);
    try {
      const slotStart = new Date(`${form.date}T${form.start || "09:00"}:00`).toISOString();
      const slotEnd = new Date(`${form.date}T${form.end || "12:00"}:00`).toISOString();
      if (form.id) {
        const { error } = await supabase.from("appointments")
          .update({ tech_id: form.tech_id, slot_start: slotStart, slot_end: slotEnd, notes: form.notes || null })
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("appointments")
          .insert({ tech_id: form.tech_id, slot_start: slotStart, slot_end: slotEnd, notes: form.notes || null, status: "proposed" });
        if (error) throw error;
      }
      setForm(null);
      await load();
    } catch (e: unknown) {
      alert("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : ""));
    }
    setSaving(false);
  }

  async function setStatus(a: Appt, status: string) {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", a.id);
    if (error) { alert("อัปเดตไม่สำเร็จ"); return; }
    load();
  }
  async function remove(a: Appt) {
    if (!window.confirm("ลบคิวนี้?")) return;
    const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", a.id);
    if (error) { alert("ลบไม่สำเร็จ"); return; }
    load();
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">🗓️ ตารางคิวช่าง — MPD</h1>
            <p className="text-xs text-slate-500">แชร์สำหรับทีมช่าง · ลงคิว/แก้ไขได้</p>
          </div>
          <button onClick={() => openAdd(new Date())} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700">+ ลงคิว</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setOffset((o) => o - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">←</button>
          <span className="text-sm font-medium text-slate-700">{fmtDate(week[0])} – {fmtDate(week[6])}</span>
          <button onClick={() => setOffset((o) => o + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">→</button>
          <button onClick={() => setOffset(0)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">สัปดาห์นี้</button>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">กำลังโหลด…</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {week.map((d) => {
              const dayAppts = appts.filter((a) => sameDay(d, a.slot_start));
              return (
                <div key={d.toISOString()} className={`bg-white rounded-xl border ${isToday(d) ? "border-blue-400 ring-1 ring-blue-300" : "border-slate-200"} overflow-hidden flex flex-col min-h-[140px]`}>
                  <div className={`px-2 py-1.5 text-center border-b ${isToday(d) ? "bg-blue-50" : "bg-slate-50"}`}>
                    <div className="text-[11px] text-slate-500">{DAY_TH[d.getDay()]}</div>
                    <div className="text-sm font-semibold text-slate-800">{d.getDate()}/{d.getMonth() + 1}</div>
                  </div>
                  <div className="p-1.5 space-y-1.5 flex-1">
                    {dayAppts.map((a) => {
                      const st = STATUS[a.status] ?? STATUS.proposed;
                      const who = a.job_id ? (jobs[a.job_id] || a.job_id) : (a.notes || "—");
                      return (
                        <div key={a.id} className="rounded-lg bg-slate-50 border border-slate-200 p-1.5">
                          <div className="text-xs font-semibold text-slate-800">{teamName(a.tech_id)}</div>
                          <div className="text-[11px] text-slate-500">{fmtTime(a.slot_start)}–{fmtTime(a.slot_end)}</div>
                          <div className="text-[11px] text-slate-600 truncate">{who}</div>
                          <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                          <div className="flex gap-1 mt-1">
                            {a.status === "proposed" && <button onClick={() => setStatus(a, "confirmed")} className="text-[10px] text-blue-600 hover:underline">ยืนยัน</button>}
                            <button onClick={() => openEdit(a)} className="text-[10px] text-slate-500 hover:underline">แก้ไข</button>
                            <button onClick={() => remove(a)} className="text-[10px] text-red-500 hover:underline">ลบ</button>
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={() => openAdd(d)} className="w-full text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded py-1">+ ลงคิว</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-4">ตารางนี้เชื่อมกับระบบ MPD แบบเรียลไทม์</p>
      </main>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 z-10" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold mb-3">{form.id ? "แก้ไขคิวช่าง" : "ลงคิวช่างใหม่"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">ทีมช่าง</label>
                <select value={form.tech_id} onChange={(e) => setForm({ ...form, tech_id: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">— เลือกทีมช่าง —</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">วันที่</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">เริ่ม</label>
                  <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">ถึง</label>
                  <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">งาน / ลูกค้า / หมายเหตุ</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} placeholder="เช่น ชื่อลูกค้า ที่อยู่ เลขงาน หรือรายละเอียดเพิ่มเติม (กด Enter ขึ้นบรรทัดใหม่ได้)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[96px]" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setForm(null)} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm hover:bg-slate-50">ยกเลิก</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
export const dynamic = "force-dynamic";
import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ipGenOrderNo } from "@/lib/utils";
import { CUT_TYPES, WELD_TYPES, FINISH_TYPES, FLOOR_CONDITIONS, EMPTY_SURVEY, surveyHasData, type SurveyData } from "@/lib/survey";

interface Team { id: string; name: string }
interface Appt {
  id: string;
  job_id: string | null;
  tech_id: string | null;
  slot_start: string;
  slot_end: string;
  status: string;
  notes: string | null;
  requirement: string | null;
  ext_ref: string | null;
}
interface JobDetail {
  bill_no: string | null; customer_name: string | null; customer_phone: string | null;
  address: string | null; location_url: string | null; product_name: string | null; survey_data: string | null;
  status: string | null; source: string | null; flag_note: string | null;
}
const STATUS: Record<string, { label: string; cls: string }> = {
  proposed: { label: "รอยืนยัน", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "ยืนยันแล้ว", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "เสร็จสิ้น", cls: "bg-emerald-100 text-emerald-700" },
};
const TEAM_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-300",
  "bg-emerald-100 text-emerald-800 border-emerald-300",
  "bg-purple-100 text-purple-800 border-purple-300",
  "bg-orange-100 text-orange-800 border-orange-300",
  "bg-pink-100 text-pink-800 border-pink-300",
  "bg-cyan-100 text-cyan-800 border-cyan-300",
  "bg-lime-100 text-lime-800 border-lime-300",
];
const HOLIDAY_COLOR = "bg-slate-200 text-slate-500 border-slate-300";
function isHoliday(a: { job_id: string | null; notes: string | null }) {
  return !a.job_id && /วันหยุด|หยุด|ลาพัก|ไม่รับงาน/.test(a.notes || "");
}
const DAY_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const DOW_HEAD = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const MONTH_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function getWeekDays(offset: number): Date[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}
function getMonthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const lead = startDow === 0 ? 6 : startDow - 1;
  const start = new Date(year, month, 1 - lead);
  start.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  while (days.length > 35 && days.slice(days.length - 7).every((d) => d.getMonth() !== month)) days.length -= 7;
  return days;
}
function fmtDate(d: Date) { return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
function fmtFullDate(iso: string) { return new Date(iso).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" }); }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function sameDay(d: Date, iso: string) { const x = new Date(iso); return d.getFullYear() === x.getFullYear() && d.getMonth() === x.getMonth() && d.getDate() === x.getDate(); }
function isToday(d: Date) { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }

function linkify(text: string): { t: string; href?: string }[] {
  const parts: { t: string; href?: string }[] = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index) });
    parts.push({ t: m[0], href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  return parts;
}
function labelOf(list: { id: string; label: string }[], id: string) { return list.find((x) => x.id === id)?.label ?? id; }

interface FormState {
  id: string | null; tech_id: string; date: string; endDate: string; start: string; end: string;
  notes: string; requirement: string;
  jobNo: string; bill_no: string; customer_name: string; customer_phone: string; address: string; location_url: string;
  survey: SurveyData;
}
const WORK_START = "09:00";
const WORK_END = "17:00";
function emptyForm(): FormState {
  return { id: null, tech_id: "", date: "", endDate: "", start: WORK_START, end: WORK_END, notes: "", requirement: "",
    jobNo: "", bill_no: "", customer_name: "", customer_phone: "", address: "", location_url: "", survey: { ...EMPTY_SURVEY, photos: [] } };
}

function eachDay(a: string, b: string): string[] {
  if (!a) return [];
  if (!b || b < a) return [a];
  const out: string[] = [];
  const cur = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  for (let i = 0; i < 60 && cur <= end; i++) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function ShareQueuePage() {
  const supabase = createClient();
  const [view, setView] = useState<"month" | "week">("month");
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const [mYear, setMYear] = useState(now.getFullYear());
  const [mMonth, setMMonth] = useState(now.getMonth());
  const [teams, setTeams] = useState<Team[]>([]);
  const [jobs, setJobs] = useState<Record<string, string>>({});
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [detail, setDetail] = useState<Appt | null>(null);
  const [detailJob, setDetailJob] = useState<JobDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const week = useMemo(() => getWeekDays(offset), [offset]);
  const monthDays = useMemo(() => getMonthDays(mYear, mMonth), [mYear, mMonth]);
  const days = view === "month" ? monthDays : week;
  const teamName = useCallback((id: string | null) => teams.find((t) => t.id === id)?.name ?? "ทีม", [teams]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = new Date(days[0]); start.setHours(0, 0, 0, 0);
    const end = new Date(days[days.length - 1]); end.setHours(23, 59, 59, 999);
    const [{ data: tt }, { data: ap }] = await Promise.all([
      supabase.from("tech_teams").select("id, name").eq("is_active", true).order("name"),
      supabase.from("appointments").select("id, job_id, tech_id, slot_start, slot_end, status, notes, requirement, ext_ref")
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
  }, [days, supabase]);

  useEffect(() => { load(); }, [load]);

  const chipLabel = useCallback((a: Appt) => {
    if (a.job_id) return jobs[a.job_id] || a.job_id;
    const n = (a.notes || "").trim();
    if (!n) return "—";
    return n.split(/[·\n/]/)[0].trim() || n;
  }, [jobs]);

  const teamColor = useCallback((id: string | null) => {
    const idx = teams.findIndex((t) => t.id === id);
    return idx >= 0 ? TEAM_COLORS[idx % TEAM_COLORS.length] : "bg-slate-100 text-slate-700 border-slate-300";
  }, [teams]);
  const chipCls = useCallback((a: Appt) => {
    const base = isHoliday(a) ? HOLIDAY_COLOR : teamColor(a.tech_id);
    const dashed = a.status === "proposed" ? "border border-dashed" : "border border-transparent";
    return `${base} ${dashed}`;
  }, [teamColor]);

  async function openDetail(a: Appt) {
    setDetail(a); setDetailJob(null);
    if (a.job_id) {
      const { data: j } = await supabase.from("install_jobs")
        .select("bill_no, customer_name, customer_phone, address, location_url, product_name, survey_data, status, source, flag_note")
        .eq("job_no", a.job_id).maybeSingle();
      if (j) setDetailJob(j as JobDetail);
    }
  }

  function openAdd(date: Date) {
    setDetail(null);
    setForm({ ...emptyForm(), date: ymd(date), endDate: ymd(date), tech_id: teams[0]?.id ?? "", jobNo: ipGenOrderNo() });
  }
  async function openEdit(a: Appt) {
    const s = new Date(a.slot_start), e = new Date(a.slot_end);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setDetail(null);
    const base: FormState = { ...emptyForm(), id: a.id, tech_id: a.tech_id ?? "", date: ymd(s), endDate: ymd(s),
      start: hhmm(s), end: hhmm(e), notes: a.notes ?? "", requirement: a.requirement ?? "", jobNo: a.job_id || ipGenOrderNo() };
    if (a.job_id) {
      const { data: j } = await supabase.from("install_jobs")
        .select("bill_no, customer_name, customer_phone, address, location_url, survey_data")
        .eq("job_no", a.job_id).maybeSingle();
      if (j) {
        base.bill_no = j.bill_no ?? ""; base.customer_name = j.customer_name ?? ""; base.customer_phone = j.customer_phone ?? "";
        base.address = j.address ?? ""; base.location_url = j.location_url ?? "";
        if (j.survey_data) { try { base.survey = { ...EMPTY_SURVEY, ...JSON.parse(j.survey_data) }; } catch {} }
      }
    }
    setForm(base);
  }

  // อัปโหลดรูปสำรวจ -> bucket job-photos (public)
  function photoUrl(path: string) { return supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl; }
  async function uploadPhotos(files: File[]) {
    if (!form || !files.length) return;
    setUploading(true);
    const added: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `survey/${form.jobNo}/${Date.now()}-${i}-${safe}`;
        const { error } = await supabase.storage.from("job-photos").upload(path, f, { upsert: false, contentType: f.type || "image/jpeg" });
        if (error) throw error;
        added.push(path);
      }
      setForm((f) => f ? { ...f, survey: { ...f.survey, photos: [...(f.survey.photos ?? []), ...added] } } : f);
    } catch (e: unknown) {
      alert("อัปโหลดรูปไม่สำเร็จ: " + (e instanceof Error ? e.message : ""));
    }
    setUploading(false);
  }
  function removePhoto(path: string) {
    setForm((f) => f ? { ...f, survey: { ...f.survey, photos: (f.survey.photos ?? []).filter((p) => p !== path) } } : f);
  }

  // helpers to toggle survey multi-select
  function toggleCut(id: string) {
    setForm((f) => { if (!f) return f; const has = f.survey.cutTypes.includes(id); return { ...f, survey: { ...f.survey, cutTypes: has ? f.survey.cutTypes.filter((x) => x !== id) : [...f.survey.cutTypes, id] } }; });
  }
  function toggleFinish(id: string) {
    setForm((f) => { if (!f) return f; const has = f.survey.finishTypes.includes(id); return { ...f, survey: { ...f.survey, finishTypes: has ? f.survey.finishTypes.filter((x) => x !== id) : [...f.survey.finishTypes, id] } }; });
  }
  function setSurvey(patch: Partial<SurveyData>) { setForm((f) => f ? { ...f, survey: { ...f.survey, ...patch } } : f); }

  async function save() {
    if (!form) return;
    if (!form.tech_id) { alert("กรุณาเลือกทีมช่าง"); return; }
    if (!form.date) { alert("กรุณาเลือกวันที่"); return; }
    if ((form.end || "12:00") <= (form.start || "09:00")) { alert("เวลาสิ้นสุดต้องหลังเวลาเริ่ม"); return; }
    const holidayMode = /วันหยุด|หยุด|ลาพัก|ไม่รับงาน/.test(form.notes) && !form.bill_no.trim() && !form.customer_name.trim();
    if (!holidayMode) {
      const missing: string[] = [];
      if (!form.bill_no.trim()) missing.push("เลขบิล");
      if (!form.customer_name.trim()) missing.push("ชื่อลูกค้า");
      if (!form.customer_phone.trim()) missing.push("เบอร์โทร");
      if (!form.address.trim() && !form.location_url.trim()) missing.push("ที่อยู่หรือ Google Maps");
      if (!form.requirement.trim()) missing.push("Requirement/สเปก");
      if (!form.survey.areaSqm.trim()) missing.push("พื้นที่ติดตั้ง");
      if (missing.length) { alert(`กรุณากรอกข้อมูลสำคัญให้ครบ:\n• ${missing.join("\n• ")}`); return; }
    }
    const endDate = form.endDate && form.endDate >= form.date ? form.endDate : form.date;
    const dates = eachDay(form.date, endDate);
    setSaving(true);
    try {
      // กันคิวชนกัน
      const rangeStart = new Date(`${dates[0]}T00:00:00`).toISOString();
      const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59`).toISOString();
      const { data: existRows } = await supabase.from("appointments")
        .select("id, slot_start, slot_end, notes, job_id")
        .eq("tech_id", form.tech_id).neq("status", "cancelled")
        .gte("slot_start", rangeStart).lte("slot_start", rangeEnd);
      const existing = (existRows as { id: string; slot_start: string; slot_end: string; notes: string | null; job_id: string | null }[] | null) ?? [];
      const clashes: string[] = [];
      for (const d of dates) {
        const s = new Date(`${d}T${form.start || "09:00"}:00`);
        const e = new Date(`${d}T${form.end || "12:00"}:00`);
        const c = existing.find((r) => r.id !== form.id && s < new Date(r.slot_end) && e > new Date(r.slot_start));
        if (c) {
          const who = c.job_id ? (jobs[c.job_id] || c.job_id) : ((c.notes || "").split(/[·\n/]/)[0].trim() || "งานอื่น");
          clashes.push(`${new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short" })} — ชนกับ ${fmtTime(c.slot_start)}–${fmtTime(c.slot_end)} น. · ${who}`);
        }
      }
      if (clashes.length) { setSaving(false); alert(`⚠️ ทีมนี้มีคิวชนกัน:\n${clashes.join("\n")}\n\nกรุณาเลือกทีม/เวลาอื่น`); return; }

      // เปิดบิล = สร้าง ticket (install_jobs) เมื่อมีเลขบิลหรือชื่อลูกค้า และไม่ใช่วันหยุด
      const isCustomerJob = !!(form.bill_no.trim() || form.customer_name.trim());
      const jobId = isCustomerJob ? form.jobNo : null;

      if (isCustomerJob) {
        const payload: Record<string, unknown> = {
          job_no: form.jobNo, order_no: form.jobNo,
          bill_no: form.bill_no || null,
          customer_name: form.customer_name || null,
          customer_phone: form.customer_phone || null,
          address: form.address || null,
          location_url: form.location_url || null,
          appt_date: dates[0],
          appt_shift: (form.start < "12:00") ? "ช่วงเช้า" : "ช่วงบ่าย",
          due_date: dates[0],
          stage: 2,
          status: "รอหัวหน้าช่างยืนยัน",
          created_via: "share",
          source: "floor_direct",
          order_source: "floor_direct",
          external_id: `floor:${form.jobNo}`,
          linked: false,
          waiting_on: "หัวหน้าช่าง",
          waiting_since: new Date().toISOString(),
          flag_note: null,
          updated_at: new Date().toISOString(),
        };
        if (form.requirement.trim()) payload.product_name = form.requirement;
        if (surveyHasData(form.survey)) {
          payload.survey_data = JSON.stringify({ ...form.survey, savedAt: form.survey.savedAt || new Date().toISOString() });
        }
        const { error: je } = await supabase.from("install_jobs").upsert(payload, { onConflict: "job_no" });
        if (je) throw je;
      }

      const mkRow = (d: string, status: string) => ({
        tech_id: form.tech_id,
        slot_start: new Date(`${d}T${form.start || "09:00"}:00`).toISOString(),
        slot_end: new Date(`${d}T${form.end || "17:00"}:00`).toISOString(),
        notes: form.notes || null,
        requirement: form.requirement || null,
        job_id: jobId,
        status,
      });

      if (form.id) {
        const first = mkRow(dates[0], "proposed");
        const { error } = await supabase.from("appointments")
          .update({ tech_id: first.tech_id, slot_start: first.slot_start, slot_end: first.slot_end, notes: first.notes, requirement: first.requirement, job_id: first.job_id, status: "proposed", confirmed_at: null })
          .eq("id", form.id);
        if (error) throw error;
        const extra = dates.slice(1).map((d) => mkRow(d, "proposed"));
        if (extra.length) { const { error: e2 } = await supabase.from("appointments").insert(extra); if (e2) throw e2; }
      } else {
        const rows = dates.map((d) => mkRow(d, "proposed"));
        const { error } = await supabase.from("appointments").insert(rows);
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
    const confirmedAt = status === "confirmed" ? new Date().toISOString() : null;
    const query = supabase.from("appointments").update({ status, confirmed_at: confirmedAt });
    const { error } = a.job_id
      ? await query.eq("job_id", a.job_id).neq("status", "cancelled")
      : await query.eq("id", a.id);
    if (error) { alert("อัปเดตไม่สำเร็จ"); return; }
    if (a.job_id) {
      const nextJobStatus = status === "confirmed" ? "ยืนยันคิวแล้ว" : "รอหัวหน้าช่างยืนยัน";
      const { error: jobError } = await supabase.from("install_jobs").update({
        status: nextJobStatus,
        waiting_on: status === "confirmed" ? "ไม่ได้ค้าง" : "หัวหน้าช่าง",
        waiting_since: status === "confirmed" ? null : new Date().toISOString(),
        flag_note: null,
        updated_at: new Date().toISOString(),
      }).eq("job_no", a.job_id);
      if (jobError) { alert("อัปเดต Ticket ไม่สำเร็จ"); return; }
      await supabase.from("job_activity").insert({
        job_no: a.job_id, actor: "หัวหน้าช่าง", action: "confirm",
        field: "status", old_value: detailJob?.status ?? null, new_value: nextJobStatus,
      });
    }
    setDetail((d) => (d && d.id === a.id ? { ...d, status } : d));
    load();
  }

  async function sendBack(a: Appt) {
    if (!a.job_id) return;
    const reason = window.prompt("ระบุข้อมูลที่ต้องให้ฝ่ายขายแก้ไข");
    if (!reason?.trim()) return;
    const [{ error: apptError }, { error: jobError }] = await Promise.all([
      supabase.from("appointments").update({ status: "proposed", confirmed_at: null })
        .eq("job_id", a.job_id).neq("status", "cancelled"),
      supabase.from("install_jobs").update({
        status: "ส่งกลับฝ่ายขายแก้ไข", waiting_on: "ฝ่ายขาย",
        waiting_since: new Date().toISOString(), flag_note: reason.trim(), updated_at: new Date().toISOString(),
      }).eq("job_no", a.job_id),
    ]);
    if (apptError || jobError) { alert("ส่งกลับไม่สำเร็จ"); return; }
    await supabase.from("job_activity").insert({
      job_no: a.job_id, actor: "หัวหน้าช่าง", action: "return",
      field: "status", old_value: detailJob?.status ?? null, new_value: `ส่งกลับฝ่ายขายแก้ไข: ${reason.trim()}`,
    });
    setDetail(null);
    load();
  }

  async function remove(a: Appt) {
    if (!window.confirm("ยกเลิกคิวนี้? ประวัติรายการจะยังถูกเก็บไว้")) return;
    const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", a.id);
    if (error) { alert("ลบไม่สำเร็จ"); return; }
    if (a.job_id) {
      const { count } = await supabase.from("appointments")
        .select("id", { count: "exact", head: true }).eq("job_id", a.job_id).neq("status", "cancelled");
      if (!count) {
        await supabase.from("install_jobs").update({
          status: "ยกเลิกคิว", waiting_on: "ไม่ได้ค้าง", waiting_since: null, updated_at: new Date().toISOString(),
        }).eq("job_no", a.job_id);
        await supabase.from("job_activity").insert({
          job_no: a.job_id, actor: "ผู้ดูแลคิว", action: "cancel", field: "status",
          old_value: detailJob?.status ?? null, new_value: "ยกเลิกคิว",
        });
      }
    }
    setDetail(null);
    load();
  }

  const rangeLabel = view === "month" ? `${MONTH_TH[mMonth]} ${mYear + 543}` : `${fmtDate(week[0])} – ${fmtDate(week[6])}`;
  function goPrev() { if (view === "month") { const d = new Date(mYear, mMonth - 1, 1); setMYear(d.getFullYear()); setMMonth(d.getMonth()); } else setOffset((o) => o - 1); }
  function goNext() { if (view === "month") { const d = new Date(mYear, mMonth + 1, 1); setMYear(d.getFullYear()); setMMonth(d.getMonth()); } else setOffset((o) => o + 1); }
  function goToday() { const t = new Date(); setMYear(t.getFullYear()); setMMonth(t.getMonth()); setOffset(0); }

  const isHol = form ? (/วันหยุด|หยุด|ลาพัก|ไม่รับงาน/.test(form.notes) && !form.bill_no.trim() && !form.customer_name.trim()) : false;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">🗓️ ตารางคิวช่าง — MPD</h1>
            <p className="text-xs text-slate-500">แชร์สำหรับทีมช่าง · จิ้มวันว่างเพื่อเปิดบิล/ลงคิว · กดที่งานเพื่อดูรายละเอียด</p>
          </div>
          <button onClick={() => openAdd(new Date())} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700">+ ลงคิว</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={goPrev} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">←</button>
          <span className="text-sm font-semibold text-slate-700 min-w-[120px] text-center">{rangeLabel}</span>
          <button onClick={goNext} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">→</button>
          <button onClick={goToday} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">วันนี้</button>
          <div className="ml-auto inline-flex rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button onClick={() => setView("month")} className={`px-3 py-1.5 text-sm ${view === "month" ? "bg-blue-600 text-white" : "hover:bg-slate-50 text-slate-600"}`}>เดือน</button>
            <button onClick={() => setView("week")} className={`px-3 py-1.5 text-sm ${view === "week" ? "bg-blue-600 text-white" : "hover:bg-slate-50 text-slate-600"}`}>สัปดาห์</button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3 flex-wrap text-[11px] text-slate-600">
          {teams.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <span className={`inline-block w-3 h-3 rounded ${teamColor(t.id).split(" ")[0]}`} />{t.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-slate-200" />🏖️ วันหยุด</span>
          <span className="inline-flex items-center gap-1 text-slate-400"><span className="inline-block w-3 h-3 rounded border border-dashed border-slate-400" />รอยืนยัน (เส้นประ)</span>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">กำลังโหลด…</p>
        ) : view === "month" ? (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-7 border-b bg-slate-50">
              {DOW_HEAD.map((d) => <div key={d} className="px-2 py-1.5 text-center text-[11px] font-medium text-slate-500">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((d) => {
                const inMonth = d.getMonth() === mMonth;
                const dayAppts = appts.filter((a) => sameDay(d, a.slot_start));
                return (
                  <div key={d.toISOString()} onClick={() => openAdd(d)} title="จิ้มเพื่อลงคิว" className={`group min-h-[96px] border-b border-r border-slate-100 p-1 flex flex-col cursor-pointer hover:bg-blue-50/40 ${inMonth ? "" : "bg-slate-50/60"}`}>
                    <div className="flex items-center justify-between px-0.5">
                      <span className={`text-[11px] ${isToday(d) ? "bg-blue-600 text-white rounded-full w-5 h-5 inline-flex items-center justify-center font-semibold" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{d.getDate()}</span>
                      <span className="text-[11px] text-slate-300 group-hover:text-blue-600 leading-none px-1">＋</span>
                    </div>
                    <div className="mt-0.5 space-y-0.5 flex-1">
                      {dayAppts.map((a) => (
                        <button key={a.id} onClick={(ev) => { ev.stopPropagation(); openDetail(a); }} className={`w-full text-left rounded px-1 py-0.5 text-[10px] leading-tight ${chipCls(a)} hover:brightness-95`}>
                          <span className="font-semibold">{isHoliday(a) ? "🏖️" : fmtTime(a.slot_start)}</span> {teamName(a.tech_id)}
                          <span className="block truncate opacity-80">{chipLabel(a)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
                      return (
                        <button key={a.id} onClick={() => openDetail(a)} className={`w-full text-left rounded-lg p-1.5 hover:brightness-95 ${chipCls(a)}`}>
                          <div className="text-xs font-semibold">{teamName(a.tech_id)}{isHoliday(a) ? " · 🏖️ วันหยุด" : ""}</div>
                          {!isHoliday(a) && <div className="text-[11px] opacity-70">{fmtTime(a.slot_start)}–{fmtTime(a.slot_end)}</div>}
                          <div className="text-[11px] opacity-80 truncate">{chipLabel(a)}</div>
                          <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/60">{st.label}</span>
                        </button>
                      );
                    })}
                    <button onClick={() => openAdd(d)} className="w-full text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded py-1">+ ลงคิว</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-4">ตารางนี้เชื่อมกับระบบ MPD แบบเรียลไทม์ · เปิดบิลที่นี่ = สร้างงานเข้า Pipeline</p>
      </main>

      {/* Detail modal */}
      {detail && (() => {
        const st = STATUS[detail.status] ?? STATUS.proposed;
        let sv: SurveyData | null = null;
        if (detailJob?.survey_data) { try { sv = JSON.parse(detailJob.survey_data); } catch {} }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">{teamName(detail.tech_id)}</h2>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    {detail.job_id && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">🎫 มีบิล</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{fmtFullDate(detail.slot_start)}</p>
                  <p className="text-sm text-slate-700 font-medium">{fmtTime(detail.slot_start)} – {fmtTime(detail.slot_end)} น.</p>
                </div>
                <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>
              <div className="p-5 overflow-y-auto space-y-4">
                {detailJob && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2 pb-1">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-200">{detailJob.source === "bbps" ? "BBPS" : "ขายตรง"}</span>
                      {detailJob.status && <span className="text-xs font-medium text-slate-600">{detailJob.status}</span>}
                    </div>
                    {detailJob.bill_no && <div><span className="text-slate-400 text-xs">เลขบิล: </span>{detailJob.bill_no}</div>}
                    {detailJob.customer_name && <div><span className="text-slate-400 text-xs">ลูกค้า: </span>{detailJob.customer_name}</div>}
                    {detailJob.customer_phone && <div><span className="text-slate-400 text-xs">โทร: </span><a href={`tel:${detailJob.customer_phone}`} className="text-blue-600">{detailJob.customer_phone}</a></div>}
                    {detailJob.address && <div><span className="text-slate-400 text-xs">ที่อยู่: </span>{detailJob.address}</div>}
                    {detailJob.location_url && <div><a href={detailJob.location_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">📍 เปิดแผนที่</a></div>}
                    {detailJob.flag_note && <div className="mt-2 rounded bg-amber-50 border border-amber-200 p-2 text-amber-800"><span className="text-xs font-medium">ต้องแก้ไข: </span>{detailJob.flag_note}</div>}
                  </div>
                )}
                <div>
                  <div className="text-xs text-slate-400 mb-1">รายละเอียด / หมายเหตุ</div>
                  {detail.notes ? (
                    <p className="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">
                      {linkify(detail.notes).map((p, i) => p.href
                        ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">{p.t}</a>
                        : <span key={i}>{p.t}</span>)}
                    </p>
                  ) : <p className="text-sm text-slate-400">— ไม่มีหมายเหตุ —</p>}
                </div>
                {detail.requirement && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <div className="text-xs text-amber-700 font-medium mb-1">📋 Requirement งาน</div>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{detail.requirement}</p>
                  </div>
                )}
                {sv && surveyHasData(sv) && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm space-y-1">
                    <div className="text-xs text-blue-700 font-medium mb-1">🔎 ข้อมูลสำรวจ</div>
                    {sv.areaSqm && <div><span className="text-slate-400 text-xs">พื้นที่: </span>{sv.areaSqm} ตร.ม.</div>}
                    {sv.weldType && <div><span className="text-slate-400 text-xs">วิธีเชื่อม: </span>{labelOf(WELD_TYPES, sv.weldType)}</div>}
                    {sv.floorCondition && <div><span className="text-slate-400 text-xs">สภาพพื้น: </span>{labelOf(FLOOR_CONDITIONS, sv.floorCondition)}</div>}
                    {sv.finishTypes?.length > 0 && <div><span className="text-slate-400 text-xs">การจบงาน: </span>{sv.finishTypes.map((x) => labelOf(FINISH_TYPES, x)).join(", ")}</div>}
                    {sv.cutTypes?.length > 0 && <div><span className="text-slate-400 text-xs">งานตัด: </span>{sv.cutTypes.map((x) => labelOf(CUT_TYPES, x)).join(", ")}</div>}
                    <div><span className="text-slate-400 text-xs">โซนเปียก: </span>{sv.wetZone ? "มี" : "ไม่มี"}</div>
                    {sv.notes && <div className="whitespace-pre-wrap"><span className="text-slate-400 text-xs">หมายเหตุสำรวจ: </span>{sv.notes}</div>}
                    {sv.photos && sv.photos.length > 0 && (
                      <div className="flex gap-1 flex-wrap pt-1">
                        {sv.photos.map((p) => <a key={p} href={photoUrl(p)} target="_blank" rel="noopener noreferrer"><img src={photoUrl(p)} alt="" className="w-14 h-14 object-cover rounded border" /></a>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="p-4 border-t flex gap-2">
                {detail.status === "proposed" && <button onClick={() => setStatus(detail, "confirmed")} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700">ยืนยันนัด</button>}
                {detail.status === "proposed" && detail.job_id && <button onClick={() => sendBack(detail)} className="flex-1 border border-amber-300 text-amber-700 rounded-lg py-2 text-sm hover:bg-amber-50">ส่งกลับแก้ไข</button>}
                {!detail.ext_ref?.startsWith("bbps:") && <button onClick={() => openEdit(detail)} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm hover:bg-slate-50">แก้ไข</button>}
                <button onClick={() => remove(detail)} className="px-4 border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">ยกเลิก</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add / edit form */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-base font-semibold">{form.id ? "แก้ไขคิว/บิล" : "ลงคิว / เปิดบิลใหม่"}</h2>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {/* นัด/ทีม */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">ทีมช่าง</label>
                  <select value={form.tech_id} onChange={(e) => setForm({ ...form, tech_id: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— เลือกทีมช่าง —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 block mb-1">วันที่เริ่ม</label>
                    <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value, endDate: (!form.endDate || form.endDate < e.target.value) ? e.target.value : form.endDate })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 block mb-1">ถึงวันที่</label>
                    <input type="date" value={form.endDate} min={form.date} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                {form.endDate && form.endDate > form.date && (
                  <p className="text-[11px] text-blue-600 -mt-1">📅 งานหลายวัน: จะสร้างคิว {eachDay(form.date, form.endDate).length} วัน (เวลาเดียวกันทุกวัน)</p>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-slate-500">เวลาทำงาน</label>
                    <button type="button" onClick={() => setForm({ ...form, start: WORK_START, end: WORK_END })} className="text-[11px] text-blue-600 hover:underline">🕘 เต็มวัน 09:00–17:00</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                    <span className="text-slate-400 text-sm">ถึง</span>
                    <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                  </div>
                </div>
              </div>

              {/* ข้อมูลลูกค้า / บิล */}
              <div className="border-t pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">🧾 ข้อมูลลูกค้า / บิล</p>
                  <button type="button" onClick={() => setForm({ ...form, notes: /วันหยุด/.test(form.notes) ? "" : "วันหยุด" })} className={`text-[11px] px-2 py-0.5 rounded-full border ${/วันหยุด/.test(form.notes) ? "bg-slate-200 text-slate-600 border-slate-300" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>🏖️ ตั้งเป็นวันหยุด</button>
                </div>
                {isHol ? (
                  <p className="text-[11px] text-slate-400">โหมดวันหยุด — จะลงเป็นวันหยุดของทีม ไม่เปิดบิล</p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 block mb-1">เลขบิล *</label>
                        <input value={form.bill_no} onChange={(e) => setForm({ ...form, bill_no: e.target.value })} placeholder="เช่น 285739" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 block mb-1">ชื่อลูกค้า *</label>
                        <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="ชื่อ-นามสกุล" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">เบอร์โทร *</label>
                      <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} placeholder="0xx-xxxxxxx" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">โลเคชั่น / ที่อยู่ *</label>
                      <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="ที่อยู่หน้างาน" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">ลิงก์แผนที่ (Google Map)</label>
                      <input value={form.location_url} onChange={(e) => setForm({ ...form, location_url: e.target.value })} placeholder="https://maps.app.goo.gl/..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <p className="text-[11px] text-slate-400">💡 กรอกเลขบิลหรือชื่อลูกค้า = เปิดเป็นบิล/ticket เข้า Pipeline อัตโนมัติ (สเตจ 2)</p>
                  </>
                )}
              </div>

              {/* หมายเหตุ + requirement */}
              <div className="border-t pt-3 space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">หมายเหตุ</label>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="รายละเอียดเพิ่มเติม (กด Enter ขึ้นบรรทัดใหม่ได้)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[72px]" />
                </div>
                {!isHol && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">📋 Requirement งาน (สเปก) *</label>
                    <textarea value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} rows={2} placeholder="เช่น สี Whitebuzz · รุ่น Rollsafe 1.6cm · พื้นที่ 15 ตรม · จำนวนโซน" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[56px]" />
                  </div>
                )}
              </div>

              {/* สำรวจหน้างาน */}
              {!isHol && (
                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-semibold text-slate-700">🔎 ข้อมูลสำรวจหน้างาน <span className="text-slate-400 font-normal">(ไม่บังคับ — กรอกเท่าที่มี)</span></p>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">พื้นที่ติดตั้ง (ตร.ม.) *</label>
                    <input value={form.survey.areaSqm} onChange={(e) => setSurvey({ areaSqm: e.target.value })} placeholder="เช่น 24.5" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">วิธีการเชื่อม</p>
                    <div className="flex flex-wrap gap-1.5">
                      {WELD_TYPES.map((o) => (
                        <button key={o.id} type="button" onClick={() => setSurvey({ weldType: form.survey.weldType === o.id ? "" : o.id })} className={`text-xs px-2.5 py-1 rounded-full border ${form.survey.weldType === o.id ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">การจบงาน</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FINISH_TYPES.map((o) => (
                        <button key={o.id} type="button" onClick={() => toggleFinish(o.id)} className={`text-xs px-2.5 py-1 rounded-full border ${form.survey.finishTypes.includes(o.id) ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">งานตัด/เก็บขอบ</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CUT_TYPES.map((o) => (
                        <button key={o.id} type="button" onClick={() => toggleCut(o.id)} className={`text-xs px-2.5 py-1 rounded-full border ${form.survey.cutTypes.includes(o.id) ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">สภาพพื้น</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FLOOR_CONDITIONS.map((o) => (
                        <button key={o.id} type="button" onClick={() => setSurvey({ floorCondition: form.survey.floorCondition === o.id ? "" : o.id })} className={`text-xs px-2.5 py-1 rounded-full border ${form.survey.floorCondition === o.id ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">มีโซนเปียก?</span>
                    <button type="button" onClick={() => setSurvey({ wetZone: !form.survey.wetZone })} className={`relative w-11 h-6 rounded-full transition ${form.survey.wetZone ? "bg-blue-600" : "bg-slate-200"}`}>
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition ${form.survey.wetZone ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                    <span className="text-xs text-slate-500">{form.survey.wetZone ? "มี" : "ไม่มี"}</span>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">หมายเหตุสำรวจ</label>
                    <textarea value={form.survey.notes} onChange={(e) => setSurvey({ notes: e.target.value })} rows={2} placeholder="รายละเอียดหน้างานเพิ่มเติม" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-slate-500">รูปหน้างาน</label>
                      <label className="text-[11px] text-blue-600 hover:underline cursor-pointer">
                        {uploading ? "กำลังอัปโหลด…" : "📷 เพิ่มรูป"}
                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; uploadPhotos(fs); }} />
                      </label>
                    </div>
                    {form.survey.photos && form.survey.photos.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {form.survey.photos.map((p) => (
                          <div key={p} className="relative">
                            <img src={photoUrl(p)} alt="" className="w-16 h-16 object-cover rounded border" />
                            <button type="button" onClick={() => removePhoto(p)} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t flex gap-2">
              <button onClick={() => setForm(null)} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm hover:bg-slate-50">ยกเลิก</button>
              <button onClick={save} disabled={saving || uploading} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? "กำลังบันทึก…" : (isHol ? "บันทึกวันหยุด" : "บันทึก / เปิดบิล")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

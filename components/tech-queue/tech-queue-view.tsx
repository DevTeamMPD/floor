"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Team { id: string; name: string; phone: string | null }
interface Appt {
  id: string;
  job_id: string | null;
  tech_id: string | null;
  slot_start: string;
  slot_end: string;
  status: string;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  proposed: { label: "รอยืนยัน", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  confirmed: { label: "ยืนยันแล้ว", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  completed: { label: "เสร็จสิ้น", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  cancelled: { label: "ยกเลิก", cls: "bg-slate-100 text-slate-400 border-slate-200" },
};
const DAY_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const DAYS_AHEAD = 14;

function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function ymd(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function apptDayKey(iso: string): string { return ymd(new Date(iso)); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }

export default function TechQueueView({ highlightDate, reloadKey }: { highlightDate?: string; reloadKey?: number }) {
  const supabase = createClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [jobs, setJobs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const start = startOfToday();
    const end = new Date(start); end.setDate(start.getDate() + DAYS_AHEAD);
    const [{ data: tt }, { data: ap }] = await Promise.all([
      supabase.from("tech_teams").select("id, name, phone").eq("is_active", true).order("name"),
      supabase.from("appointments").select("id, job_id, tech_id, slot_start, slot_end, status")
        .gte("slot_start", start.toISOString()).lt("slot_start", end.toISOString())
        .neq("status", "cancelled").order("slot_start"),
    ]);
    setTeams((tt as Team[]) ?? []);
    const apps = (ap as Appt[]) ?? [];
    setAppts(apps);
    const jobIds = Array.from(new Set(apps.map((a) => a.job_id).filter(Boolean))) as string[];
    if (jobIds.length) {
      const { data: js } = await supabase.from("install_jobs").select("job_no, customer_name").in("job_no", jobIds);
      const m: Record<string, string> = {};
      (js ?? []).forEach((j: { job_no: string; customer_name: string | null }) => { m[j.job_no] = j.customer_name ?? ""; });
      setJobs(m);
    } else setJobs({});
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadKey]);

  const days = useMemo(() => {
    const s = startOfToday();
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });
  }, []);

  const byTeamDay = useMemo(() => {
    const m: Record<string, Record<string, Appt[]>> = {};
    for (const a of appts) {
      const tid = a.tech_id ?? "—";
      const k = apptDayKey(a.slot_start);
      (m[tid] ??= {});
      (m[tid][k] ??= []).push(a);
    }
    return m;
  }, [appts]);

  const todayKey = ymd(startOfToday());

  if (loading) return <p className="text-slate-400 text-sm p-2">กำลังโหลด…</p>;
  if (teams.length === 0) return <p className="text-slate-400 text-sm p-2">ยังไม่มีทีมช่าง — เพิ่มได้ที่หน้า นัดหมาย</p>;

  return (
    <div className="space-y-3">
      {teams.map((t) => {
        const dayMap = byTeamDay[t.id] ?? {};
        const upcoming = appts.filter((a) => a.tech_id === t.id).sort((x, y) => x.slot_start.localeCompare(y.slot_start));
        return (
          <div key={t.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
              <div className="font-semibold text-slate-800 text-sm">{t.name}{t.phone ? <span className="text-xs text-slate-400 font-normal"> · {t.phone}</span> : null}</div>
              <span className="text-xs text-slate-500">{upcoming.length} งาน/14 วัน</span>
            </div>
            <div className="grid grid-cols-7 gap-1 p-2 border-b bg-white">
              {days.map((d) => {
                const k = ymd(d);
                const cnt = (dayMap[k] ?? []).length;
                const isToday = k === todayKey;
                const isSel = highlightDate === k;
                return (
                  <div key={k} className={`rounded-lg text-center py-1 border ${cnt > 0 ? "bg-cyan-50 border-cyan-200" : "bg-emerald-50 border-emerald-100"} ${isToday ? "ring-2 ring-blue-400" : ""} ${isSel ? "ring-2 ring-amber-500" : ""}`}>
                    <div className="text-[10px] text-slate-500">{DAY_TH[d.getDay()]} {d.getDate()}</div>
                    <div className={`text-[11px] font-semibold ${cnt > 0 ? "text-cyan-700" : "text-emerald-600"}`}>{cnt > 0 ? `${cnt} งาน` : "ว่าง"}</div>
                  </div>
                );
              })}
            </div>
            <div className="divide-y">
              {upcoming.length === 0 ? (
                <p className="text-sm text-emerald-600 px-3 py-2">✓ ว่างทั้ง 14 วัน</p>
              ) : (
                upcoming.map((a) => {
                  const d = new Date(a.slot_start);
                  const st = STATUS[a.status] ?? STATUS.proposed;
                  return (
                    <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <div className="w-14 shrink-0 text-slate-600 font-medium">{DAY_TH[d.getDay()]} {d.getDate()}/{d.getMonth() + 1}</div>
                      <div className="w-24 shrink-0 text-slate-500 text-xs">{fmtTime(a.slot_start)}–{fmtTime(a.slot_end)}</div>
                      <div className="flex-1 truncate text-slate-800 text-xs">{a.job_id ? (jobs[a.job_id] || a.job_id) : "—"}</div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${st.cls}`}>{st.label}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

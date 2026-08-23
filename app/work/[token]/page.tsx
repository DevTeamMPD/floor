"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface WorkAssignment {
  assignmentId: string; isLead: boolean; firstOpenedAt: string | null; lastOpenedAt: string | null;
  openCount: number; acknowledgedAt: string | null; appointmentId: string; slotStart: string; slotEnd: string;
  appointmentStatus: string; teamName: string | null; notes: string | null; requirement: string | null;
  jobNo: string | null; source: string | null; billNo: string | null; customerName: string | null;
  customerPhone: string | null; address: string | null; locationUrl: string | null; productName: string | null;
  surveyData: string | null;
}
interface Workspace {
  technician: { id: string; name: string; phone: string | null; teamId: string | null; teamName: string | null; isTeamLead: boolean };
  assignments: WorkAssignment[];
}

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}
function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export default function TechnicianWorkspacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkAssignment | null>(null);
  const [saving, setSaving] = useState(false);
  const pinStorageKey = `floor-work-pin:${token}`;

  const load = useCallback(async (pinValue: string) => {
    const normalized = pinValue.trim();
    if (!normalized) {
      setWorkspace(null);
      setLoading(false);
      return false;
    }
    const { data, error } = await supabase.rpc("get_technician_workspace", { p_token: token, p_pin: normalized });
    if (!error && data) {
      setWorkspace(data as Workspace);
      setAuthError(null);
      setLoading(false);
      if (typeof window !== "undefined") window.sessionStorage.setItem(pinStorageKey, normalized);
      return true;
    }
    setWorkspace(null);
    setLoading(false);
    return false;
  }, [pinStorageKey, supabase, token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(pinStorageKey);
    if (saved) {
      setPin(saved);
      void load(saved);
      return;
    }
    setLoading(false);
  }, [load, pinStorageKey]);

  const upcoming = useMemo(() => {
    const now = Date.now() - 12 * 60 * 60 * 1000;
    return (workspace?.assignments ?? []).filter((a) => new Date(a.slotEnd).getTime() >= now);
  }, [workspace]);
  const grouped = useMemo(() => {
    const groups = new Map<string, WorkAssignment[]>();
    for (const a of upcoming) groups.set(dateKey(a.slotStart), [...(groups.get(dateKey(a.slotStart)) ?? []), a]);
    return Array.from(groups.entries());
  }, [upcoming]);

  async function openWork(a: WorkAssignment) {
    setSelected(a);
    await supabase.rpc("record_technician_work_event", {
      p_token: token,
      p_pin: pin.trim(),
      p_assignment_id: a.assignmentId,
      p_event_type: "opened",
      p_user_agent: navigator.userAgent,
    });
    void load(pin);
  }

  async function acknowledge() {
    if (!selected) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("record_technician_work_event", {
      p_token: token,
      p_pin: pin.trim(),
      p_assignment_id: selected.assignmentId,
      p_event_type: "acknowledged",
      p_user_agent: navigator.userAgent,
    });
    if (!error && data) {
      setSelected({ ...selected, acknowledgedAt: new Date().toISOString() });
      await load(pin);
    }
    setSaving(false);
  }

  async function unlock() {
    setLoading(true);
    setAuthError(null);
    const ok = await load(pin);
    if (!ok) {
      setAuthError("PIN ไม่ถูกต้อง หรือยังไม่ได้ตั้ง PIN ให้ลิงก์นี้");
      setLoading(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-slate-50 grid place-items-center text-slate-500">กำลังโหลดตารางงาน…</main>;
  if (!workspace) return <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">FloorNow · หน้างานของฉัน</div>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">ใส่ PIN เพื่อเปิดตารางงาน</h1>
      <p className="mt-1 text-sm text-slate-500">ใช้รหัสจากหัวหน้าช่างร่วมกับลิงก์ประจำตัวนี้</p>
      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">PIN 4-6 หลัก</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500"
          />
        </div>
        {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
        <button
          onClick={() => void unlock()}
          disabled={!pin.trim()}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          เปิดตารางงาน
        </button>
      </div>
    </div>
  </main>;

  return <main className="min-h-screen bg-slate-50 pb-12">
    <header className="bg-slate-950 text-white px-4 py-5">
      <div className="max-w-2xl mx-auto"><div className="text-xs text-slate-400">MPD FloorNow · หน้างานของฉัน</div><h1 className="text-xl font-semibold mt-1">{workspace.technician.name}</h1><div className="text-sm text-slate-300">{workspace.technician.teamName ?? "ไม่ระบุทีม"}{workspace.technician.isTeamLead ? " · หัวหน้าทีม" : ""}</div></div>
    </header>
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="flex items-end justify-between mb-4"><div><h2 className="font-semibold text-slate-900">ตารางงานของฉัน</h2><p className="text-xs text-slate-500">กดงานเพื่อเปิดรายละเอียดและบันทึกการเปิดใบงาน</p></div><span className="text-xs text-slate-500">{upcoming.length} งาน</span></div>
      <div className="space-y-5">
        {grouped.map(([day, jobs]) => <section key={day}>
          <div className="text-sm font-medium text-slate-700 mb-2">{thaiDate(jobs[0].slotStart)}{day === dateKey(new Date().toISOString()) ? <span className="ml-2 text-xs text-blue-600">วันนี้</span> : null}</div>
          <div className="space-y-2">{jobs.map((a) => <button key={a.assignmentId} onClick={() => openWork(a)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300">
            <div className="flex gap-3"><div className="font-semibold text-blue-700 shrink-0">{time(a.slotStart)}–{time(a.slotEnd)}</div><div className="flex-1 min-w-0"><div className="font-medium truncate">{a.customerName ?? a.jobNo ?? "งานติดตั้ง"}</div><div className="text-xs text-slate-500 truncate">{a.productName ?? a.requirement ?? "ยังไม่ระบุสเปก"}</div></div></div>
            <div className="mt-2 flex gap-1.5 flex-wrap"><span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">{a.teamName ?? "ทีมช่าง"}</span>{a.isLead ? <span className="text-[11px] px-2 py-0.5 rounded bg-violet-100 text-violet-700">ผู้รับผิดชอบหลัก</span> : null}<span className={`text-[11px] px-2 py-0.5 rounded ${a.acknowledgedAt ? "bg-emerald-100 text-emerald-700" : a.firstOpenedAt ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{a.acknowledgedAt ? "รับทราบแล้ว" : a.firstOpenedAt ? "เปิดแล้ว" : "ยังไม่เปิด"}</span></div>
          </button>)}</div>
        </section>)}
        {!grouped.length ? <div className="bg-white border rounded-xl p-8 text-center text-slate-400">ยังไม่มีงานที่ได้รับมอบหมาย</div> : null}
      </div>
    </div>

    {selected ? <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setSelected(null)}>
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b flex justify-between"><div><div className="text-xs text-slate-500">{thaiDate(selected.slotStart)}</div><h2 className="font-semibold mt-1">{selected.customerName ?? selected.jobNo ?? "งานติดตั้ง"}</h2><div className="text-sm text-blue-700">{time(selected.slotStart)}–{time(selected.slotEnd)} น.</div></div><button onClick={() => setSelected(null)} aria-label="ปิด" className="text-xl text-slate-400">×</button></div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3"><div><div className="text-xs text-slate-400">ทีม</div>{selected.teamName ?? "—"}</div><div><div className="text-xs text-slate-400">เลขบิล</div>{selected.billNo ?? "—"}</div></div>
          {selected.customerPhone ? <div><div className="text-xs text-slate-400">เบอร์ลูกค้า</div><a className="text-blue-600" href={`tel:${selected.customerPhone}`}>{selected.customerPhone}</a></div> : null}
          {selected.address ? <div><div className="text-xs text-slate-400">ที่อยู่หน้างาน</div><div className="whitespace-pre-wrap">{selected.address}</div></div> : null}
          {selected.locationUrl ? <a href={selected.locationUrl} target="_blank" rel="noopener noreferrer" className="block text-center border border-blue-200 text-blue-700 rounded-lg py-2">📍 เปิด Google Maps</a> : null}
          <div><div className="text-xs text-slate-400">สเปก / Requirement</div><div className="whitespace-pre-wrap">{selected.productName ?? selected.requirement ?? "—"}</div></div>
          {selected.notes ? <div><div className="text-xs text-slate-400">หมายเหตุ</div><div className="whitespace-pre-wrap">{selected.notes}</div></div> : null}
        </div>
        <div className="p-4 border-t"><button onClick={acknowledge} disabled={saving || Boolean(selected.acknowledgedAt)} className="w-full rounded-xl py-3 bg-emerald-600 text-white font-medium disabled:bg-emerald-100 disabled:text-emerald-700">{selected.acknowledgedAt ? "✓ รับทราบงานแล้ว" : saving ? "กำลังบันทึก…" : "รับทราบงาน"}</button></div>
      </div>
    </div> : null}
  </main>;
}

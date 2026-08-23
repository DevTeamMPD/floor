"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BbpsWorkOrderDetails from "@/components/tech-queue/bbps-work-order-details";

interface WorkAssignment {
  assignmentId: string; isLead: boolean; firstOpenedAt: string | null; lastOpenedAt: string | null;
  openCount: number; acknowledgedAt: string | null; appointmentId: string; slotStart: string; slotEnd: string;
  appointmentStatus: string; teamName: string | null; notes: string | null; requirement: string | null;
  jobNo: string | null; source: string | null; billNo: string | null; customerName: string | null;
  customerPhone: string | null; address: string | null; locationUrl: string | null; productName: string | null;
  surveyData: string | null; pickPlan: unknown;
}
interface ResponsibleTechnician {
  id: string;
  is_lead: boolean;
  first_opened_at: string | null;
  acknowledged_at: string | null;
  technician: { name: string | null; phone: string | null; is_team_lead: boolean | null } | null;
}
interface DetailJob { raw_payload: unknown; site_photos: string[] | null; survey_data: string | null }
interface Workspace {
  technician: { id: string; name: string; phone: string | null; teamId: string | null; teamName: string | null; isTeamLead: boolean };
  assignments: WorkAssignment[];
}
interface PickNewItem { width?: string | null; length_cm?: string | null; qty?: string | null; note?: string | null }
interface PickRemnant { mat_type?: string | null; width_bin?: string | null; length_cm?: string | null; note?: string | null }
interface PickPlan { newItems?: PickNewItem[]; remnants?: PickRemnant[]; note?: string | null }

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}
function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
function parsePickPlan(value: unknown): PickPlan | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed as PickPlan : null;
  } catch {
    return null;
  }
}
function hasPickPlan(plan: PickPlan | null) {
  return Boolean(plan && ((plan.newItems?.length ?? 0) > 0 || (plan.remnants?.length ?? 0) > 0 || (typeof plan.note === "string" && plan.note.trim())));
}
function PickPlanDetails({ value }: { value: unknown }) {
  const plan = parsePickPlan(value);
  if (!hasPickPlan(plan)) return null;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
    <div className="font-semibold text-amber-950">ใบสั่งงาน — ของที่ต้องหยิบ</div>
    {plan?.newItems?.length ? <div className="mt-3">
      <div className="text-xs font-medium text-amber-700">ของใหม่ที่ต้องเบิก</div>
      <div className="mt-1 space-y-1.5">{plan.newItems.map((item, index) => <div key={index} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
        หน้ากว้าง {item.width || "—"} ซม. · ยาว {item.length_cm || "—"} ซม. · จำนวน {item.qty || "—"}{item.note ? ` · ${item.note}` : ""}
      </div>)}</div>
    </div> : null}
    {plan?.remnants?.length ? <div className="mt-3">
      <div className="text-xs font-medium text-amber-700">เศษที่ให้หยิบไปใช้</div>
      <div className="mt-1 space-y-1.5">{plan.remnants.map((item, index) => <div key={index} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
        {item.mat_type || "เศษวัสดุ"} · กว้าง {item.width_bin || "—"} · ยาว {item.length_cm || "—"} ซม.{item.note ? ` · ${item.note}` : ""}
      </div>)}</div>
    </div> : null}
    {plan?.note ? <div className="mt-3 whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-xs text-slate-700">{plan.note}</div> : null}
  </section>;
}
function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
function textOf(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs font-medium text-slate-400">{label}</div><div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{children || "—"}</div></div>;
}
function WorkSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}</div>
    </div>
    {children}
  </section>;
}

export default function TechnicianWorkspacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkAssignment | null>(null);
  const [responsibles, setResponsibles] = useState<ResponsibleTechnician[]>([]);
  const [detailJob, setDetailJob] = useState<DetailJob | null>(null);
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
    setResponsibles([]);
    setDetailJob(null);
    await supabase.rpc("record_technician_work_event", {
      p_token: token,
      p_pin: pin.trim(),
      p_assignment_id: a.assignmentId,
      p_event_type: "opened",
      p_user_agent: navigator.userAgent,
    });
    const detailTasks: PromiseLike<unknown>[] = [
      supabase
        .from("appointment_technicians")
        .select("id,is_lead,first_opened_at,acknowledged_at,technician:floor_technicians(name,phone,is_team_lead)")
        .eq("appointment_id", a.appointmentId)
        .eq("is_active", true)
        .then(({ data }) => setResponsibles((data ?? []) as unknown as ResponsibleTechnician[])),
    ];
    if (a.jobNo) {
      detailTasks.push(
        supabase
          .from("install_jobs")
          .select("raw_payload,site_photos,survey_data")
          .eq("job_no", a.jobNo)
          .maybeSingle()
          .then(({ data }) => setDetailJob((data ?? null) as DetailJob | null))
      );
    }
    await Promise.all(detailTasks.map((task) => Promise.resolve(task)));
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

    {selected ? <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelected(null)}>
      <div className="bg-slate-50 w-full sm:max-w-4xl max-h-[96vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-blue-600">FloorNow · ใบสั่งงานกลาง</div>
              <h2 className="mt-1 truncate text-xl font-semibold text-slate-950">{selected.customerName ?? selected.jobNo ?? "งานติดตั้ง"}</h2>
              <div className="mt-1 text-sm text-slate-500">
                งาน #{selected.jobNo ?? "—"} · {thaiDate(selected.slotStart)} · {time(selected.slotStart)}–{time(selected.slotEnd)} น.
              </div>
            </div>
            <button onClick={() => setSelected(null)} aria-label="ปิด" className="rounded-full p-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">×</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">ฝ่ายขาย: กรอกข้อมูล</span>
            <span className="rounded-full border border-blue-200 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">หัวหน้าช่าง: ตรวจ/จ่ายงาน</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">ทีมช่าง: รับทราบ/อัปเดต</span>
            <span className={`ml-auto rounded-full px-3 py-1.5 text-xs font-medium ${selected.acknowledgedAt ? "bg-emerald-100 text-emerald-700" : selected.firstOpenedAt ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
              {selected.acknowledgedAt ? "รับทราบแล้ว" : selected.firstOpenedAt ? "เปิดใบงานแล้ว" : "ยังไม่รับทราบ"}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[1.35fr_0.85fr] sm:p-5">
          <WorkSection title="📍 ข้อมูลงานที่ฝ่ายขายยืนยันแล้ว" subtitle="ข้อมูลหลักที่ช่างต้องใช้ก่อนออกงาน">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ลูกค้า">{selected.customerName}</Field>
              <Field label="เบอร์โทร">{selected.customerPhone ? <a href={`tel:${selected.customerPhone}`} className="text-blue-600 hover:underline">{selected.customerPhone}</a> : "—"}</Field>
              <Field label="สินค้า / สเปก">{selected.productName ?? selected.requirement}</Field>
              <Field label="เลขบิล / แหล่งที่มา">{[selected.billNo, selected.source === "bbps" ? "งาน BBPS" : selected.source].filter(Boolean).join(" · ")}</Field>
              <div className="sm:col-span-2"><Field label="ที่อยู่หน้างาน">{selected.address}</Field></div>
              {selected.locationUrl ? <div className="sm:col-span-2"><a href={selected.locationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">📍 เปิด Google Maps</a></div> : null}
              {selected.notes ? <div className="sm:col-span-2"><Field label="หมายเหตุคิว / หัวหน้าช่าง">{selected.notes}</Field></div> : null}
            </div>
          </WorkSection>

          <WorkSection title="👥 ผู้รับผิดชอบ" subtitle="หลักฐานเปิดใบงานและรับทราบงาน">
            <div className="space-y-2">
              {(responsibles.length ? responsibles : [{
                id: selected.assignmentId,
                is_lead: selected.isLead,
                first_opened_at: selected.firstOpenedAt,
                acknowledged_at: selected.acknowledgedAt,
                technician: { name: workspace.technician.name, phone: workspace.technician.phone, is_team_lead: workspace.technician.isTeamLead },
              }]).map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">{(r.technician?.name ?? "ช").slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{r.technician?.name ?? "ไม่ระบุชื่อ"}{r.is_lead ? " · ผู้รับผิดชอบหลัก" : ""}</div>
                    <div className="text-xs text-slate-500">{r.technician?.is_team_lead ? "หัวหน้าทีม" : "ช่างติดตั้ง"}{r.technician?.phone ? ` · ${r.technician.phone}` : ""}</div>
                  </div>
                  <div className={`rounded-lg px-2 py-1 text-xs ${r.acknowledged_at ? "bg-emerald-100 text-emerald-700" : r.first_opened_at ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                    {r.acknowledged_at ? "รับทราบ" : r.first_opened_at ? "เปิดแล้ว" : "ยังไม่เปิด"}
                  </div>
                </div>
              ))}
            </div>
          </WorkSection>

          <div className="space-y-4">
            <PickPlanDetails value={selected.pickPlan} />
            {(() => {
              const survey = parseJsonObject(detailJob?.survey_data ?? selected.surveyData);
              const photos = Array.isArray(survey?.photos) ? survey.photos.map(textOf).filter(Boolean) : [];
              if (!survey && !photos.length) return null;
              return <WorkSection title="🖼 ภาพหน้างานและข้อมูลที่ฝ่ายขายกรอก">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="พื้นที่ติดตั้ง">{textOf(survey?.areaSqm) ? `${textOf(survey?.areaSqm)} ตร.ม.` : "—"}</Field>
                  <Field label="สภาพพื้น">{textOf(survey?.floorCondition) || "—"}</Field>
                  <div className="sm:col-span-2"><Field label="หมายเหตุสำรวจ">{textOf(survey?.notes) || "—"}</Field></div>
                </div>
                {photos.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((path, index) => {
                    const url = path.startsWith("http") ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl;
                    return <a key={path} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`ภาพหน้างาน ${index + 1}`} className="h-full w-full object-cover" />
                    </a>;
                  })}
                </div> : null}
              </WorkSection>;
            })()}
            {selected.source === "bbps" ? <BbpsWorkOrderDetails rawPayload={detailJob?.raw_payload} /> : null}
          </div>

          <div className="space-y-4">
            <WorkSection title="✅ ตรวจรับและปิดงาน" subtitle="เกณฑ์ที่ต้องเคลียร์ก่อนส่งมอบ">
              <div className="space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.acknowledgedAt)} /> ทีมช่างรับทราบงานแล้ว</label>
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.locationUrl || selected.address)} /> มีพิกัด/ที่อยู่สำหรับเดินทาง</label>
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.productName || selected.requirement)} /> มีสเปกงานติดตั้ง</label>
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.pickPlan)} /> มีใบสั่งหยิบของ/วัสดุ</label>
              </div>
            </WorkSection>

            <WorkSection title="📸 อัปเดตหน้างานวันนี้" subtitle="สถานะเต็มจะไปต่อในแอปพนักงาน background GPS">
              <div className="space-y-2 text-sm text-slate-700">
                {["กำลังเดินทาง", "ถึงบ้านลูกค้าแล้ว", "กำลังติดตั้ง", "ติดตั้งงานเสร็จสมบูรณ์", "ลูกค้าเซ็นรับงาน"].map((label) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500">{label}</div>
                ))}
              </div>
            </WorkSection>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4">
          <button onClick={acknowledge} disabled={saving || Boolean(selected.acknowledgedAt)} className="w-full rounded-xl bg-emerald-600 py-3 font-medium text-white disabled:bg-emerald-100 disabled:text-emerald-700">
            {selected.acknowledgedAt ? "✓ รับทราบงานแล้ว" : saving ? "กำลังบันทึก…" : "รับทราบงาน"}
          </button>
        </div>
      </div>
    </div> : null}
  </main>;
}

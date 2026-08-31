"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CaseStatus = "new" | "triaging" | "scheduled" | "in_progress" | "waiting_customer" | "resolved" | "closed" | "reopened";
type Priority = "urgent" | "high" | "normal" | "low";

interface AfterSalesCase {
  id: string;
  case_no: string;
  job_no: string;
  source: string;
  category: string;
  priority: Priority;
  status: CaseStatus;
  summary: string;
  customer_impact: string | null;
  owner_staff_id: string | null;
  assigned_team: string | null;
  due_at: string;
  opened_at: string;
  resolution: string | null;
  linked_ncr_id: string | null;
}

interface CaseEvent {
  id: number;
  case_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
  occurred_at: string;
}

interface CaseAction {
  id: string;
  case_id: string;
  title: string;
  acceptance_criteria: string | null;
  due_at: string | null;
  status: string;
  outcome: string | null;
}

const NOW = Date.now();
const hoursFromNow = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const DEMO_CASES: AfterSalesCase[] = [
  { id: "demo-1", case_no: "ASC-202609-000014", job_no: "ORD-202608-8137", source: "csat", category: "complaint", priority: "high", status: "triaging", summary: "ลูกค้าแจ้งพื้นมีเสียงหลังติดตั้ง", customer_impact: "รบกวนการใช้งานบริเวณห้องนั่งเล่น", owner_staff_id: "cs-a", assigned_team: "ทีม A", due_at: hoursFromNow(-3), opened_at: hoursFromNow(-29), resolution: null, linked_ncr_id: null },
  { id: "demo-2", case_no: "ASC-202609-000015", job_no: "ORD-202608-8293", source: "customer_call", category: "installation_adjustment", priority: "urgent", status: "scheduled", summary: "ขอบงานยก ต้องเข้าตรวจวันนี้", customer_impact: "เสี่ยงสะดุดบริเวณทางเดิน", owner_staff_id: "cs-b", assigned_team: "ทีม B", due_at: hoursFromNow(2), opened_at: hoursFromNow(-2), resolution: null, linked_ncr_id: "ncr-demo-1" },
  { id: "demo-3", case_no: "ASC-202609-000012", job_no: "ORD-202608-8064", source: "technician", category: "warranty", priority: "normal", status: "waiting_customer", summary: "รอยต่อมีช่องว่าง รอลูกค้ายืนยันวันนัด", customer_impact: "ใช้งานได้ตามปกติ", owner_staff_id: "cs-a", assigned_team: "ทีม A", due_at: hoursFromNow(28), opened_at: hoursFromNow(-42), resolution: null, linked_ncr_id: null },
  { id: "demo-4", case_no: "ASC-202609-000009", job_no: "ORD-202608-7991", source: "csat", category: "service_request", priority: "low", status: "resolved", summary: "ขอคำแนะนำการดูแลพื้นหลังติดตั้ง", customer_impact: null, owner_staff_id: "cs-c", assigned_team: null, due_at: hoursFromNow(72), opened_at: hoursFromNow(-80), resolution: "โทรแนะนำและส่งคู่มือการดูแลให้ลูกค้าแล้ว", linked_ncr_id: null },
];

const DEMO_EVENTS: CaseEvent[] = [
  { id: 1, case_id: "demo-1", event_type: "created", from_status: null, to_status: "new", detail: { note: "เปิดอัตโนมัติจาก CSAT 2 ดาว" }, occurred_at: hoursFromNow(-29) },
  { id: 2, case_id: "demo-1", event_type: "status_changed", from_status: "new", to_status: "triaging", detail: { note: "CS โทรรับเรื่องและแจ้ง SLA แล้ว" }, occurred_at: hoursFromNow(-26) },
  { id: 3, case_id: "demo-1", event_type: "action_added", from_status: null, to_status: null, detail: { note: "ขอหัวหน้าช่างตรวจรูปหน้างาน" }, occurred_at: hoursFromNow(-25) },
  { id: 4, case_id: "demo-2", event_type: "created", from_status: null, to_status: "new", detail: { note: "รับสายลูกค้าโดยทีม CS" }, occurred_at: hoursFromNow(-2) },
  { id: 5, case_id: "demo-2", event_type: "ncr_linked", from_status: null, to_status: null, detail: { note: "ยกระดับเป็น NCR เนื่องจากมีความเสี่ยงต่อความปลอดภัย" }, occurred_at: hoursFromNow(-1) },
];

const DEMO_ACTIONS: CaseAction[] = [
  { id: "a-1", case_id: "demo-1", title: "ตรวจรูปและวิเคราะห์สาเหตุเบื้องต้น", acceptance_criteria: "ระบุสาเหตุและแผนเข้าหน้างาน", due_at: hoursFromNow(-1), status: "in_progress", outcome: null },
  { id: "a-2", case_id: "demo-2", title: "นัดช่างเข้าควบคุมความเสี่ยง", acceptance_criteria: "ขอบงานปลอดภัยและมีรูปหลังแก้ไข", due_at: hoursFromNow(2), status: "open", outcome: null },
];

const STATUS: Record<CaseStatus, { label: string; className: string }> = {
  new: { label: "รับเรื่องใหม่", className: "bg-slate-100 text-slate-700" },
  triaging: { label: "กำลังคัดกรอง", className: "bg-amber-100 text-amber-800" },
  scheduled: { label: "นัดหมายแล้ว", className: "bg-indigo-100 text-indigo-700" },
  in_progress: { label: "กำลังดำเนินการ", className: "bg-blue-100 text-blue-700" },
  waiting_customer: { label: "รอลูกค้าตอบ", className: "bg-violet-100 text-violet-700" },
  resolved: { label: "แก้ไขแล้ว", className: "bg-emerald-100 text-emerald-700" },
  closed: { label: "ปิดเคส", className: "bg-emerald-100 text-emerald-700" },
  reopened: { label: "เปิดซ้ำ", className: "bg-rose-100 text-rose-700" },
};

const PRIORITY: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "เร่งด่วน", className: "bg-rose-600 text-white" },
  high: { label: "สูง", className: "bg-orange-100 text-orange-800" },
  normal: { label: "ปกติ", className: "bg-blue-50 text-blue-700" },
  low: { label: "ต่ำ", className: "bg-slate-100 text-slate-600" },
};

const CATEGORY: Record<string, string> = { service_request: "ขอบริการ", complaint: "ข้อร้องเรียน", warranty: "รับประกัน", installation_adjustment: "ปรับแก้งานติดตั้ง", information: "ขอข้อมูล" };

function isLocalDemo() {
  return typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function fmtDate(value: string) {
  return new Date(value).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function sla(caseItem: AfterSalesCase) {
  if (["resolved", "closed"].includes(caseItem.status)) return { label: "เสร็จแล้ว", className: "text-emerald-700 bg-emerald-50" };
  const hours = Math.ceil((new Date(caseItem.due_at).getTime() - Date.now()) / 3_600_000);
  if (hours < 0) return { label: `เกิน SLA ${Math.abs(hours)} ชม.`, className: "text-rose-700 bg-rose-50" };
  if (hours <= 4) return { label: `เหลือ ${hours} ชม.`, className: "text-orange-800 bg-orange-50" };
  return { label: `ครบกำหนด ${fmtDate(caseItem.due_at)}`, className: "text-slate-600 bg-slate-50" };
}

export default function AfterSalesPage() {
  const [cases, setCases] = useState<AfterSalesCase[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [actions, setActions] = useState<CaseAction[]>([]);
  const [selected, setSelected] = useState<AfterSalesCase | null>(null);
  const [filter, setFilter] = useState<"open" | "overdue" | "ncr" | "all">("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    if (isLocalDemo()) {
      setDemo(true); setCases(DEMO_CASES); setEvents(DEMO_EVENTS); setActions(DEMO_ACTIONS); setLoading(false); return;
    }
    try {
      const response = await fetch("/api/after-sales", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "โหลดเคสไม่สำเร็จ");
      setCases(payload.cases ?? []); setEvents(payload.events ?? []); setActions(payload.actions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดเคสไม่สำเร็จ");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCases = cases.filter((item) => !["closed", "resolved"].includes(item.status));
  const overdueCases = openCases.filter((item) => new Date(item.due_at).getTime() < Date.now());
  const ncrCases = cases.filter((item) => item.linked_ncr_id);
  const visible = useMemo(() => cases.filter((item) => {
    if (filter === "open" && ["closed", "resolved"].includes(item.status)) return false;
    if (filter === "overdue" && !(new Date(item.due_at).getTime() < Date.now() && !["closed", "resolved"].includes(item.status))) return false;
    if (filter === "ncr" && !item.linked_ncr_id) return false;
    const query = search.trim().toLowerCase();
    return !query || [item.case_no, item.job_no, item.summary, item.assigned_team ?? ""].some((value) => value.toLowerCase().includes(query));
  }), [cases, filter, search]);

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Customer Care & Quality</p><h1 className="mt-1 text-2xl font-bold text-slate-950">ศูนย์บริการหลังการขาย</h1><p className="mt-1 text-sm text-slate-500">รับเรื่อง ติดตาม SLA วางแผนแก้ไข และยกระดับเป็น NCR ใน flow เดียว</p></div>
      <div className="flex gap-2"><button onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">รีเฟรช</button><button disabled={demo} title={demo ? "โหมด local preview ไม่บันทึกข้อมูล" : undefined} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">+ เปิดเคสใหม่</button></div>
    </header>

    {demo ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><b>Local preview</b> — ข้อมูลบนหน้านี้เป็นตัวอย่างและจะไม่ถูกบันทึก</div> : null}
    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{ label: "เคสที่ต้องดูแล", value: openCases.length, accent: "text-blue-700", note: "ยังไม่ resolved/closed" }, { label: "เกิน SLA", value: overdueCases.length, accent: "text-rose-700", note: "ต้องจัดการก่อน" }, { label: "นัดหมาย/กำลังทำ", value: openCases.filter((item) => ["scheduled", "in_progress"].includes(item.status)).length, accent: "text-indigo-700", note: "อยู่ระหว่างปฏิบัติ" }, { label: "เชื่อม NCR", value: ncrCases.length, accent: "text-orange-700", note: "ต้องควบคุมคุณภาพ" }].map((card) => <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{card.label}</p><p className={`mt-1 text-3xl font-bold ${card.accent}`}>{loading ? "…" : card.value}</p><p className="mt-1 text-xs text-slate-400">{card.note}</p></article>)}
    </section>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div className="flex flex-wrap gap-2">{([{ key: "open", label: `กำลังดูแล ${openCases.length}` }, { key: "overdue", label: `เกิน SLA ${overdueCases.length}` }, { key: "ncr", label: `NCR ${ncrCases.length}` }, { key: "all", label: `ทั้งหมด ${cases.length}` }] as const).map((tab) => <button key={tab.key} onClick={() => setFilter(tab.key)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === tab.key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{tab.label}</button>)}</div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเลขเคส / เลขงาน / ปัญหา" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 sm:w-72" />
      </div>
      {loading ? <div className="p-14 text-center text-slate-400">กำลังโหลดคิวบริการ…</div> : visible.length === 0 ? <div className="p-14 text-center"><p className="text-lg font-semibold text-slate-700">ไม่มีเคสในมุมมองนี้</p><p className="mt-1 text-sm text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหา</p></div> : <div className="divide-y divide-slate-100">{visible.map((item) => { const currentSla = sla(item); return <button key={item.id} onClick={() => setSelected(item)} className="grid w-full gap-3 p-4 text-left hover:bg-slate-50 md:grid-cols-[1.2fr_2.2fr_1fr_1fr_auto] md:items-center">
        <div><p className="font-semibold text-slate-900">{item.case_no}</p><p className="mt-0.5 text-xs text-blue-700">{item.job_no}</p></div>
        <div className="min-w-0"><p className="truncate font-medium text-slate-800">{item.summary}</p><p className="mt-1 text-xs text-slate-500">{CATEGORY[item.category] ?? item.category}{item.assigned_team ? ` · ${item.assigned_team}` : ""}</p></div>
        <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY[item.priority].className}`}>{PRIORITY[item.priority].label}</span></div>
        <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[item.status].className}`}>{STATUS[item.status].label}</span></div>
        <div className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${currentSla.className}`}>{currentSla.label}</div>
      </button>; })}</div>}
    </section>

    {selected ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3" onClick={() => setSelected(null)}><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-slate-950">{selected.case_no}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY[selected.priority].className}`}>{PRIORITY[selected.priority].label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[selected.status].className}`}>{STATUS[selected.status].label}</span></div><p className="mt-1 text-sm text-blue-700">ใบงาน {selected.job_no}</p></div><button onClick={() => setSelected(null)} className="rounded-lg p-2 text-xl text-slate-400 hover:bg-slate-100">×</button></div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-5"><section><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">ปัญหาที่รับเรื่อง</p><h3 className="mt-2 text-lg font-semibold text-slate-900">{selected.summary}</h3>{selected.customer_impact ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><b>ผลกระทบ:</b> {selected.customer_impact}</p> : null}</section>
          <section><div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">Action plan</h3><button disabled={demo} className="text-sm font-semibold text-blue-700 disabled:text-slate-300">+ เพิ่ม action</button></div><div className="mt-2 space-y-2">{actions.filter((action) => action.case_id === selected.id).length ? actions.filter((action) => action.case_id === selected.id).map((action) => <div key={action.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><p className="font-medium text-slate-800">{action.title}</p><span className={`rounded-full px-2 py-0.5 text-xs ${action.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{action.status === "completed" ? "เสร็จแล้ว" : "กำลังทำ"}</span></div>{action.acceptance_criteria ? <p className="mt-2 text-xs text-slate-500">เกณฑ์ยืนยัน: {action.acceptance_criteria}</p> : null}{action.due_at ? <p className="mt-1 text-xs text-slate-400">กำหนด {fmtDate(action.due_at)}</p> : null}</div>) : <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">ยังไม่มี action plan</div>}</div></section>
        </div>
        <div className="space-y-5"><section className="rounded-xl bg-slate-50 p-4"><h3 className="font-semibold text-slate-900">การดำเนินการถัดไป</h3><div className="mt-3 grid gap-2"><button disabled={demo} className="rounded-xl bg-blue-700 px-3 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">อัปเดตสถานะ</button><button disabled={demo} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:text-slate-300">สร้างนัดหมายแก้ไข</button><button disabled={demo || Boolean(selected.linked_ncr_id)} className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2.5 text-sm font-semibold text-orange-800 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">{selected.linked_ncr_id ? "เชื่อม NCR แล้ว" : "ยกระดับเป็น NCR"}</button></div></section>
          <section><h3 className="font-semibold text-slate-900">Timeline</h3><div className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">{events.filter((event) => event.case_id === selected.id).map((event) => <div key={event.id} className="relative"><span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-600 ring-4 ring-white"/><p className="text-sm font-medium text-slate-800">{event.event_type === "created" ? "เปิดเคส" : event.event_type === "ncr_linked" ? "ยกระดับเป็น NCR" : event.event_type === "action_added" ? "เพิ่ม action plan" : "เปลี่ยนสถานะ"}</p><p className="mt-0.5 text-xs text-slate-500">{String(event.detail.note ?? "บันทึกโดยระบบ")}</p><p className="mt-1 text-[11px] text-slate-400">{fmtDate(event.occurred_at)}</p></div>)}</div></section>
        </div>
      </div>
    </div></div> : null}
  </div>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type QueueState = "waiting" | "due_today" | "overdue" | "completed" | "case_opened";
type Priority = "urgent" | "high" | "normal";

interface CsatQueueItem {
  id: string;
  jobNo: string;
  customer: string;
  signedAt: string;
  dueAt: string;
  state: QueueState;
  phone: string;
  owner: string;
  score: number | null;
  issue: string | null;
  priority: Priority;
  afterSalesCase: string | null;
  ncrNo: string | null;
}

const FLOW = [
  { no: "1", title: "ลูกค้าเซ็นรับงาน", detail: "Event: customer_signed" },
  { no: "2", title: "ตั้ง SLA +3 วัน", detail: "สร้าง follow-up อัตโนมัติ" },
  { no: "3", title: "CS ประเมิน", detail: "โทรหรือบันทึกแบบประเมิน" },
  { no: "4", title: "ประมวลผลคะแนน", detail: "4–5 ผ่าน · 3 ติดตาม · 1–2 เปิดเคส" },
  { no: "5", title: "After-sales / NCR", detail: "เปิดตามกฎความเสี่ยง" },
];

const CSAT_QUESTIONS = [
  "ความพึงพอใจในการให้บริการ",
  "คุณภาพของงานติดตั้ง",
  "ความเรียบร้อยและความสะอาดหลังติดตั้ง",
  "การตรงต่อเวลาของทีมงาน",
  "ความสุภาพและการให้คำแนะนำจากทีมติดตั้ง",
];

const DEMO_ANCHOR = Date.UTC(2026, 7, 31, 18, 0, 0);
const offset = (hours: number) => new Date(DEMO_ANCHOR + hours * 60 * 60 * 1000).toISOString();

const DEMO_ROWS: CsatQueueItem[] = [
  { id: "csat-1", jobNo: "ORD-202608-8331", customer: "คุณสุภาวดี พรหมรักษา", signedAt: offset(-79), dueAt: offset(-7), state: "overdue", phone: "08X-XXX-9142", owner: "ยังไม่รับงาน", score: null, issue: null, priority: "urgent", afterSalesCase: null, ncrNo: null },
  { id: "csat-2", jobNo: "ORD-202608-8293", customer: "คุณปริญญาพร อัตตพงษ์", signedAt: offset(-66), dueAt: offset(6), state: "due_today", phone: "09X-XXX-7021", owner: "คุณอร · CS", score: null, issue: null, priority: "high", afterSalesCase: null, ncrNo: null },
  { id: "csat-3", jobNo: "ORD-202608-8278", customer: "บริษัท โฮมแอนด์โค จำกัด", signedAt: offset(-26), dueAt: offset(46), state: "waiting", phone: "02-XXX-8851", owner: "CS Queue", score: null, issue: null, priority: "normal", afterSalesCase: null, ncrNo: null },
  { id: "csat-4", jobNo: "ORD-202608-8137", customer: "คุณนัชชา playspace", signedAt: offset(-120), dueAt: offset(-48), state: "case_opened", phone: "08X-XXX-1288", owner: "คุณเมย์ · CS", score: 2, issue: "พื้นมีเสียงและรอยต่อเปิด", priority: "high", afterSalesCase: "ASC-202609-000014", ncrNo: null },
  { id: "csat-5", jobNo: "ORD-202608-8064", customer: "คุณศิริพร วัฒนะ", signedAt: offset(-148), dueAt: offset(-76), state: "completed", phone: "06X-XXX-4407", owner: "คุณเมย์ · CS", score: 5, issue: null, priority: "normal", afterSalesCase: null, ncrNo: null },
  { id: "csat-6", jobNo: "ORD-202608-7970", customer: "บริษัท สยามเวิร์ค จำกัด", signedAt: offset(-218), dueAt: offset(-146), state: "case_opened", phone: "02-XXX-2070", owner: "คุณอร · CS", score: 1, issue: "สินค้าเฉดสีต่างกันหลายกล่อง", priority: "urgent", afterSalesCase: "ASC-202609-000011", ncrNo: "NCR-2569-0017" },
];

const STATE_LABEL: Record<QueueState, { label: string; cls: string }> = {
  waiting: { label: "รอถึงกำหนด", cls: "bg-slate-100 text-slate-700" },
  due_today: { label: "ครบกำหนดวันนี้", cls: "bg-amber-100 text-amber-800" },
  overdue: { label: "เกิน SLA", cls: "bg-red-100 text-red-800" },
  completed: { label: "ประเมินแล้ว", cls: "bg-emerald-100 text-emerald-800" },
  case_opened: { label: "เปิดเคสอัตโนมัติ", cls: "bg-violet-100 text-violet-800" },
};

function fmt(value: string) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function remaining(row: CsatQueueItem) {
  if (["completed", "case_opened"].includes(row.state)) return row.score ? `${row.score}/5 ดาว` : "เสร็จแล้ว";
  const hours = Math.ceil((new Date(row.dueAt).getTime() - Date.now()) / 3600000);
  if (hours < 0) return `เกิน ${Math.abs(hours)} ชม.`;
  if (hours <= 24) return `เหลือ ${hours} ชม.`;
  return `เหลือ ${Math.ceil(hours / 24)} วัน`;
}

function Stars({ score }: { score: number }) {
  return <span aria-label={`${score} ดาว`} className="tracking-wide text-amber-400">{"★★★★★".split("").map((star, index) => <span key={index} className={index < score ? "text-amber-400" : "text-slate-200"}>{star}</span>)}</span>;
}

export default function CsatAutomationPage() {
  const supabase = useMemo(() => createClient(), []);
  const [filter, setFilter] = useState<"action" | "low_score" | "all">("action");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CsatQueueItem | null>(null);
  const [queueRows, setQueueRows] = useState<CsatQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [localPreview, setLocalPreview] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      if (isLocal) {
        if (active) { setLocalPreview(true); setQueueRows(DEMO_ROWS); setLoading(false); }
        return;
      }

      const { data: followups, error } = await supabase
        .from("floor_csat_followups")
        .select("job_no,work_order_id,customer_signed_at,due_at,completed_at,evaluation_id")
        .order("due_at", { ascending: true });
      if (error) { if (active) setLoading(false); return; }
      const jobNos = [...new Set((followups ?? []).map((row) => row.job_no))];
      if (!jobNos.length) { if (active) { setQueueRows([]); setLoading(false); } return; }

      const [jobsResult, evaluationsResult, casesResult, ncrResult] = await Promise.all([
        supabase.from("install_jobs").select("job_no,customer_name,customer_phone").in("job_no", jobNos),
        supabase.from("job_evaluations").select("id,job_no,satisfaction_score,issues_text").in("job_no", jobNos),
        supabase.from("floor_after_sales_cases").select("case_no,job_no").in("job_no", jobNos).not("status", "eq", "closed"),
        supabase.from("ncr_reports").select("id,job_no").in("job_no", jobNos).not("status", "eq", "closed"),
      ]);
      const jobs = new Map((jobsResult.data ?? []).map((row) => [row.job_no, row]));
      const evaluations = new Map((evaluationsResult.data ?? []).map((row) => [row.job_no, row]));
      const cases = new Map((casesResult.data ?? []).map((row) => [row.job_no, row.case_no]));
      const ncrs = new Map((ncrResult.data ?? []).map((row) => [row.job_no, row.id]));
      const nowMs = Date.now();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
      const mapped: CsatQueueItem[] = (followups ?? []).map((followup) => {
        const job = jobs.get(followup.job_no);
        const evaluation = evaluations.get(followup.job_no);
        const caseNo = cases.get(followup.job_no) ?? null;
        const score = evaluation?.satisfaction_score ?? null;
        const dueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(followup.due_at));
        const state: QueueState = followup.completed_at
          ? (caseNo ? "case_opened" : "completed")
          : new Date(followup.due_at).getTime() < nowMs ? "overdue"
          : dueDate === today ? "due_today" : "waiting";
        return {
          id: followup.work_order_id, jobNo: followup.job_no, customer: job?.customer_name ?? "ไม่ระบุชื่อลูกค้า",
          signedAt: followup.customer_signed_at, dueAt: followup.due_at, state,
          phone: job?.customer_phone ?? "—", owner: "CS Queue", score,
          issue: evaluation?.issues_text ?? null, priority: state === "overdue" || (score !== null && score <= 2) ? "urgent" : state === "due_today" ? "high" : "normal",
          afterSalesCase: caseNo, ncrNo: ncrs.get(followup.job_no) ?? null,
        };
      });
      if (active) { setQueueRows(mapped); setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [supabase]);

  const metrics = useMemo(() => ({
    waiting: queueRows.filter((row) => ["waiting", "due_today", "overdue"].includes(row.state)).length,
    dueToday: queueRows.filter((row) => row.state === "due_today").length,
    overdue: queueRows.filter((row) => row.state === "overdue").length,
    lowScore: queueRows.filter((row) => row.score !== null && row.score <= 2).length,
    autoCases: queueRows.filter((row) => row.afterSalesCase).length,
  }), [queueRows]);

  const rows = useMemo(() => queueRows.filter((row) => {
    if (filter === "action" && !["due_today", "overdue"].includes(row.state)) return false;
    if (filter === "low_score" && !(row.score !== null && row.score <= 2)) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [row.jobNo, row.customer, row.owner, row.afterSalesCase, row.ncrNo].some((value) => value?.toLowerCase().includes(needle));
  }), [filter, query, queueRows]);

  return <div className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Customer Experience Automation</p><h1 className="mt-1 text-2xl font-black text-slate-950">ศูนย์ติดตาม CSAT อัตโนมัติ</h1><p className="mt-1 text-sm text-slate-500">เริ่มนับ 3 วันหลังลูกค้าเซ็น ติดตามทุกงาน และเปิดเคสจากคะแนนต่ำโดยไม่กรอกข้อมูลซ้ำ</p></div>
        <div className="flex flex-wrap gap-2"><a href="/after-sales" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">บริการหลังการขาย</a><a href="/ncr" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">NCR</a><button disabled className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white opacity-40">บันทึก CSAT</button></div>
      </header>

      {localPreview ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">Local preview — ใช้ข้อมูลจำลองและปิดการบันทึกทั้งหมด จึงไม่กระทบงานจริง</div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Production — แสดงคิวจริงจากลูกค้าที่เซ็นรับงานและครบกำหนดติดตามภายใน 3 วัน</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["รอติดตาม", metrics.waiting, "อยู่ใน CS Queue", "text-slate-950"], ["ครบกำหนดวันนี้", metrics.dueToday, "ต้องโทรภายในวันนี้", "text-amber-700"],
          ["เกิน SLA", metrics.overdue, "ต้องรับผิดชอบทันที", "text-red-700"], ["คะแนน 1–2 ดาว", metrics.lowScore, "ต้องเปิดเคสดูแล", "text-violet-700"],
          ["เปิดเคสอัตโนมัติ", metrics.autoCases, "เชื่อม After-sales แล้ว", "text-blue-700"],
        ].map(([label, value, detail, color]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></article>)}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4"><p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">Automation flow</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-5">{FLOW.map((step, index) => <div key={step.no} className="relative rounded-xl border border-slate-200 bg-white p-3"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">{step.no}</div><p className="mt-2 text-xs font-black text-slate-900">{step.title}</p><p className="mt-1 text-[10px] leading-relaxed text-slate-400">{step.detail}</p>{index < FLOW.length - 1 && <span className="absolute -right-2 top-1/2 z-10 hidden text-slate-300 sm:block">›</span>}</div>)}</div></div>

        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-2">
          <button onClick={() => setFilter("action")} className={`rounded-lg px-3 py-2 text-xs font-black ${filter === "action" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>ต้องทำวันนี้ {metrics.dueToday + metrics.overdue}</button>
          <button onClick={() => setFilter("low_score")} className={`rounded-lg px-3 py-2 text-xs font-black ${filter === "low_score" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>คะแนนต่ำ {metrics.lowScore}</button>
          <button onClick={() => setFilter("all")} className={`rounded-lg px-3 py-2 text-xs font-black ${filter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>ทั้งหมด {queueRows.length}</button>
        </div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาใบงาน / ลูกค้า / เคส" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 lg:w-80" /></div>

        <div className="divide-y divide-slate-100">{loading ? <div className="p-12 text-center text-sm text-slate-400">กำลังโหลดคิว CSAT…</div> : rows.map((row) => <button key={row.id} onClick={() => setSelected(row)} className="grid w-full gap-3 px-4 py-4 text-left hover:bg-slate-50 lg:grid-cols-[1.2fr_.9fr_.65fr_.65fr_auto] lg:items-center">
          <div><p className="font-black text-slate-900">{row.customer}</p><p className="mt-1 text-xs text-slate-500">{row.jobNo} · เซ็น {fmt(row.signedAt)}</p></div>
          <div><p className="text-xs font-bold text-slate-500">ผู้รับผิดชอบ</p><p className={`mt-1 text-sm font-bold ${row.owner === "ยังไม่รับงาน" ? "text-red-700" : "text-slate-800"}`}>{row.owner}</p></div>
          <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${STATE_LABEL[row.state].cls}`}>{STATE_LABEL[row.state].label}</span>{row.score !== null && <div className="mt-1 text-xs"><Stars score={row.score} /></div>}</div>
          <div><p className={`text-sm font-black ${row.state === "overdue" ? "text-red-700" : "text-slate-800"}`}>{remaining(row)}</p><p className="mt-1 text-xs text-slate-400">Due {fmt(row.dueAt)}</p></div>
          <div className="flex items-center justify-between gap-4 lg:justify-end"><span className="text-xs font-bold text-blue-600">{row.afterSalesCase || row.ncrNo || "ดูรายละเอียด"}</span><span className="text-xl text-slate-300">›</span></div>
        </button>)}{!loading && rows.length === 0 && <div className="p-12 text-center text-sm text-slate-400">ไม่พบรายการตามตัวกรอง</div>}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-blue-600">CS Call Questionnaire</p><h2 className="mt-1 text-lg font-black text-slate-950">ชุดคำถามเดียวกับ Google Form</h2><p className="mt-1 text-sm text-slate-500">CS อ่านตามลำดับและบันทึกคะแนน 1–5 เพื่อให้รายงานคุณภาพใช้มาตรฐานเดียวกัน</p></div><a href="https://docs.google.com/spreadsheets/d/1xTJeN6HAhqX8wZ1RKFjm1yzrHaIPCnUpas7E_W2I50I/edit" target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600">เปิดแหล่งข้อมูล ↗</a></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{CSAT_QUESTIONS.map((question, index) => <article key={question} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">{index + 1}</span><p className="mt-2 text-xs font-bold leading-relaxed text-slate-800">{question}</p><p className="mt-2 text-[10px] text-slate-400">คำตอบ 1–5 คะแนน</p></article>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black uppercase tracking-wider text-slate-400">กฎคะแนน</p><div className="mt-4 space-y-3"><p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">4–5 ดาว · ผ่านและสร้างเอกสาร CSAT</p><p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">3 ดาว · CS ต้องตรวจ comment และติดตาม</p><p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-800">1–2 ดาว · เปิด After-sales case อัตโนมัติ</p></div></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black uppercase tracking-wider text-slate-400">เงื่อนไข NCR</p><p className="mt-4 text-sm font-semibold leading-relaxed text-slate-700">ไม่เปิด NCR จากคะแนนต่ำทุกกรณี ระบบจะยกระดับเมื่อเป็นความเสี่ยงด้านความปลอดภัย, ปัญหาซ้ำ, กระทบหลายงาน/ล็อต หรือ Quality Manager ยืนยันว่าเป็น nonconformity</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Fail-safe</p><p className="mt-4 text-sm font-semibold leading-relaxed text-slate-700">การเซ็นรับงานต้องสำเร็จแม้ automation ล้ม งาน follow-up และการเปิดเคสทำผ่าน background queue พร้อม idempotency เพื่อไม่สร้างรายการซ้ำ</p></article>
      </section>
    </div>

    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[1px] sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><div role="dialog" aria-modal="true" aria-label={`CSAT ${selected.jobNo}`} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black text-slate-950">{selected.jobNo}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-black ${STATE_LABEL[selected.state].cls}`}>{STATE_LABEL[selected.state].label}</span></div><p className="mt-1 text-sm font-bold text-slate-700">{selected.customer}</p><p className="mt-1 text-xs text-slate-400">{selected.phone} · ผู้ดูแล {selected.owner}</p></div><button aria-label="ปิดรายละเอียด" onClick={() => setSelected(null)} className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-100">×</button></div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_.8fr]">
        <div className="space-y-4"><section className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-bold text-slate-400">ลูกค้าเซ็นรับงาน</p><p className="mt-1 text-sm font-black text-slate-800">{fmt(selected.signedAt)}</p></div><div className={`rounded-xl border p-4 ${selected.state === "overdue" ? "border-red-200 bg-red-50" : "border-slate-200"}`}><p className="text-xs font-bold text-slate-400">กำหนด CSAT (+3 วัน)</p><p className={`mt-1 text-sm font-black ${selected.state === "overdue" ? "text-red-800" : "text-slate-800"}`}>{fmt(selected.dueAt)} · {remaining(selected)}</p></div></section>
          {selected.score !== null ? <section className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">ผลประเมิน</h3><span className="text-lg"><Stars score={selected.score} /></span></div><p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{selected.issue || "ลูกค้าพึงพอใจและไม่มีปัญหาเพิ่มเติม"}</p></section> : <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="text-sm font-black text-amber-900">งานที่ CS ต้องทำ</h3><ol className="mt-3 space-y-2 text-sm font-semibold text-amber-900"><li>1. โทรยืนยันความพึงพอใจและปัญหาหลังใช้งาน</li><li>2. ถามครบ 5 หัวข้อและเลือกคะแนน 1–5</li><li>3. บันทึก comment เพียงครั้งเดียว ระบบเปิดเคสให้ตามกฎ</li></ol></section>}
          <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4"><h3 className="text-sm font-black text-slate-900">แบบสอบถามสำหรับการโทร</h3><div className="mt-3 space-y-2">{CSAT_QUESTIONS.map((question, index) => <div key={question} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">{index + 1}</span><p className="flex-1 text-xs font-bold leading-relaxed text-slate-700">{question}</p><span className="text-[10px] font-bold text-slate-400">1–5</span></div>)}</div></section>
          <section className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-black text-slate-900">ข้อมูลที่ระบบนำไปใช้ต่อ</h3><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600"><p className="rounded-lg bg-slate-50 p-2.5">เลขงานและลูกค้า</p><p className="rounded-lg bg-slate-50 p-2.5">คะแนนและ comment</p><p className="rounded-lg bg-slate-50 p-2.5">หลักฐาน/ผู้บันทึก</p><p className="rounded-lg bg-slate-50 p-2.5">เคสและ NCR ที่เชื่อมโยง</p></div></section>
        </div>
        <aside className="space-y-4"><section className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-black text-slate-900">Automation timeline</h3><div className="mt-4 space-y-4">{[
          ["ลูกค้าเซ็นรับงาน", fmt(selected.signedAt), true], ["สร้าง CSAT follow-up", "ตั้ง due อัตโนมัติ +3 วัน", true],
          ["บันทึกคะแนน", selected.score !== null ? `${selected.score}/5 ดาว` : "ยังรอ CS", selected.score !== null],
          ["เปิด After-sales case", selected.afterSalesCase || "ยังไม่เข้าเงื่อนไข", !!selected.afterSalesCase], ["ยกระดับ NCR", selected.ncrNo || "ยังไม่เข้าเงื่อนไข", !!selected.ncrNo],
        ].map(([title, detail, done]) => <div key={String(title)} className="flex gap-3"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{done ? "✓" : "·"}</span><div><p className="text-xs font-black text-slate-800">{title}</p><p className="mt-0.5 text-xs text-slate-500">{detail}</p></div></div>)}</div></section>
          {selected.afterSalesCase && <a href="/after-sales" className="block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white">เปิดเคส {selected.afterSalesCase}</a>}
          {selected.ncrNo && <a href="/ncr" className="block rounded-xl bg-red-600 px-4 py-3 text-center text-sm font-black text-white">เปิด {selected.ncrNo}</a>}
          {!selected.afterSalesCase && <button disabled className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white opacity-35">{localPreview ? "Local preview — ปิดการบันทึก" : "บันทึกผ่านหน้าคิว CS"}</button>}
        </aside>
      </div>
    </div></div>}
  </div>;
}

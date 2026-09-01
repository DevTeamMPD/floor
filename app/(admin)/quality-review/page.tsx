"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateQualityMetrics, filterQualityDataset, type QualityDataset, type QualityNcr } from "@/lib/quality/metrics";

type DocumentRow = { id: string; job_no: string; document_type: string; document_code: string | null; status: string; provider_web_url: string | null };
type EventRow = { id: number; case_id: string; event_type: string; detail: Record<string, unknown>; occurred_at: string };
type Period = "30" | "90" | "365" | "all";

const nowIso = "2026-09-01T09:00:00+07:00";
const DEMO: QualityDataset = {
  ncrs: [
    { id: "n1", job_no: "ORD-202608-8293", title: "พื้นยกตัวหลังติดตั้ง", type: "installation", status: "investigating", severity: "critical", due_at: "2026-08-31T12:00:00+07:00", product_sku: "RS-WB-18", created_at: "2026-08-28T09:00:00+07:00", updated_at: nowIso, closed_at: null },
    { id: "n2", job_no: "ORD-202608-8137", title: "เฉดสีสินค้าไม่สม่ำเสมอ", type: "quality", status: "corrective_action", severity: "high", due_at: "2026-09-02T12:00:00+07:00", product_sku: "RS-WB-18", created_at: "2026-08-18T09:00:00+07:00", updated_at: nowIso, closed_at: null },
    { id: "n3", job_no: "ORD-202607-7844", title: "สีต่างในล็อตก่อนหน้า", type: "quality", status: "closed", severity: "medium", due_at: null, product_sku: "RS-WB-18", created_at: "2026-07-20T09:00:00+07:00", updated_at: "2026-08-10T09:00:00+07:00", closed_at: "2026-08-10T09:00:00+07:00" },
  ],
  cases: [
    { id: "c1", case_no: "ASC-202608-000015", job_no: "ORD-202608-8293", source: "csat", category: "complaint", priority: "urgent", status: "in_progress", summary: "ลูกค้าแจ้งพื้นยกตัว", assigned_team: "ทีม B", due_at: "2026-08-31T12:00:00+07:00", opened_at: "2026-08-30T08:00:00+07:00", resolved_at: null, closed_at: null, linked_ncr_id: "n1" },
    { id: "c2", case_no: "ASC-202608-000011", job_no: "ORD-202608-8137", source: "customer_call", category: "warranty", priority: "high", status: "resolved", summary: "เปลี่ยนสินค้าเฉดสีต่าง", assigned_team: "ทีม A", due_at: "2026-08-25T12:00:00+07:00", opened_at: "2026-08-22T08:00:00+07:00", resolved_at: "2026-08-24T08:00:00+07:00", closed_at: null, linked_ncr_id: "n2" },
  ],
  actions: [
    { id: "a1", case_id: "c1", title: "วิเคราะห์สาเหตุด้วย 5 Why", status: "in_progress", due_at: "2026-08-31T12:00:00+07:00", completed_at: null, acceptance_criteria: "พบสาเหตุรากและยืนยันด้วยหลักฐาน", outcome: null },
    { id: "a2", case_id: "c2", title: "เปลี่ยนสินค้าและติดตามผล", status: "completed", due_at: "2026-08-24T12:00:00+07:00", completed_at: "2026-08-24T08:00:00+07:00", acceptance_criteria: "ลูกค้ายืนยันไม่พบปัญหาซ้ำ", outcome: "ผ่าน" },
  ],
  evaluations: [
    { id: "e1", job_no: "ORD-202608-8293", satisfaction_score: 2, call_date: "2026-08-30", created_at: "2026-08-30T09:00:00+07:00", updated_at: "2026-08-30T09:00:00+07:00" },
    { id: "e2", job_no: "ORD-202608-8137", satisfaction_score: 4, call_date: "2026-08-24", created_at: "2026-08-24T09:00:00+07:00", updated_at: "2026-08-24T09:00:00+07:00" },
    { id: "e3", job_no: "ORD-202607-7844", satisfaction_score: 5, call_date: "2026-07-25", created_at: "2026-07-25T09:00:00+07:00", updated_at: "2026-07-25T09:00:00+07:00" },
  ],
  jobs: [{ job_no: "ORD-202608-8293", customer: "ลูกค้า A", team: "ทีม B" }, { job_no: "ORD-202608-8137", customer: "ลูกค้า B", team: "ทีม A" }, { job_no: "ORD-202607-7844", customer: "ลูกค้า C", team: "ทีม B" }],
};

const TYPE_LABEL: Record<string, string> = { quality: "คุณภาพสินค้า", installation: "การติดตั้ง", process: "กระบวนการ", damage: "เสียหาย", missing: "ขาด", wrong: "ผิดรายการ", other: "อื่น ๆ" };
const SEVERITY_LABEL: Record<string, string> = { critical: "Critical", high: "สูง", medium: "กลาง", low: "ต่ำ" };

function esc(value: unknown) { return String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(new Date(value)) : "—"; }
function downloadHtml(name: string, html: string) { const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
function reportShell(title: string, body: string) { return `<!doctype html><html lang="th"><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:16mm}body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#172033;font-size:12px}header{border-bottom:3px solid #164e9b;padding-bottom:12px;margin-bottom:18px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 8px}.meta{color:#64748b;margin-top:5px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi{border:1px solid #cbd5e1;border-radius:8px;padding:10px}.kpi b{font-size:20px;color:#164e9b}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left;vertical-align:top}th{background:#eff6ff}.stamp{margin-top:30px;border-top:1px solid #94a3b8;padding-top:10px;color:#475569}@media print{button{display:none}}</style><body><header><h1>${esc(title)}</h1><div class="meta">บริษัท เล่นดี สเปซ จำกัด · เอกสารควบคุมจาก FloorNow · สร้าง ${esc(new Date().toLocaleString("th-TH"))}</div></header>${body}<div class="stamp">ผู้จัดทำ ____________________ ผู้ทบทวน ____________________ วันที่ ____________________</div></body></html>`; }

export default function QualityReviewPage() {
  const [data, setData] = useState<QualityDataset | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [period, setPeriod] = useState<Period>("90");
  const [focus, setFocus] = useState<"ncr" | "cases" | "capa" | "recurrence">("ncr");
  const [selected, setSelected] = useState<QualityNcr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [local, setLocal] = useState(false);

  useEffect(() => { void (async () => {
    const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname); setLocal(localPreview);
    if (localPreview) { setData(DEMO); setLoading(false); return; }
    try {
      const supabase = createClient();
      const [ncrs, cases, actions, evaluations, jobs, docs, caseEvents] = await Promise.all([
        supabase.from("ncr_reports").select("id,job_no,title,type,status,severity,due_at,product_sku,created_at,updated_at,closed_at").order("created_at", { ascending: false }),
        supabase.from("floor_after_sales_cases").select("id,case_no,job_no,source,category,priority,status,summary,assigned_team,due_at,opened_at,resolved_at,closed_at,linked_ncr_id").order("opened_at", { ascending: false }),
        supabase.from("floor_after_sales_actions").select("id,case_id,title,status,due_at,completed_at,acceptance_criteria,outcome"),
        supabase.from("job_evaluations").select("id,job_no,satisfaction_score,call_date,created_at,updated_at").not("satisfaction_score", "is", null),
        supabase.from("install_jobs").select("job_no,customer,team"),
        supabase.from("floor_job_documents").select("id,job_no,document_type,document_code,status,provider_web_url").eq("status", "approved"),
        supabase.from("floor_after_sales_events").select("id,case_id,event_type,detail,occurred_at").order("occurred_at", { ascending: true }),
      ]);
      const failed = [ncrs, cases, actions, evaluations, jobs, docs, caseEvents].find((result) => result.error);
      if (failed?.error) throw failed.error;
      setData({ ncrs: ncrs.data || [], cases: cases.data || [], actions: actions.data || [], evaluations: evaluations.data || [], jobs: jobs.data || [] } as QualityDataset);
      setDocuments((docs.data || []) as DocumentRow[]); setEvents((caseEvents.data || []) as EventRow[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลคุณภาพไม่สำเร็จ"); }
    finally { setLoading(false); }
  })(); }, []);

  const filtered = useMemo(() => { if (!data) return null; const days = period === "all" ? null : Number(period); const from = days ? new Date(Date.now() - days * 86_400_000) : null; return filterQualityDataset(data, from, new Date()); }, [data, period]);
  const metrics = useMemo(() => filtered ? calculateQualityMetrics(filtered) : null, [filtered]);
  const jobs = useMemo(() => new Map((data?.jobs || []).map((item) => [item.job_no, item])), [data]);

  function exportManagementReview() {
    if (!filtered || !metrics) return;
    const rows = metrics.byType.slice(0, 8).map(([type, count]) => `<tr><td>${esc(TYPE_LABEL[type] || type)}</td><td>${count}</td></tr>`).join("");
    const decisions = [...metrics.overdueNcrs.map((item) => `เร่งปิด NCR ${item.title}`), ...metrics.overdueActions.map((item) => `เร่ง CAPA ${item.title}`)].slice(0, 10);
    const body = `<div class="grid"><div class="kpi">NCR เปิด<br><b>${metrics.openNcrs.length}</b></div><div class="kpi">เกิน SLA<br><b>${metrics.overdueNcrs.length + metrics.overdueCases.length}</b></div><div class="kpi">CSAT<br><b>${metrics.csatAverage.toFixed(2)}</b></div><div class="kpi">Recovery<br><b>${metrics.averageRecoveryHours.toFixed(1)} ชม.</b></div></div><h2>ปัญหาหลัก</h2><table><tr><th>ประเภท</th><th>จำนวน</th></tr>${rows || "<tr><td colspan=2>ไม่มีข้อมูล</td></tr>"}</table><h2>ประเด็นต้องตัดสินใจ</h2><ol>${decisions.map((item) => `<li>${esc(item)}</li>`).join("") || "<li>ไม่มีรายการเกินกำหนด</li>"}</ol><h2>แนวโน้ม CSAT</h2><table><tr><th>เดือน</th><th>คะแนนเฉลี่ย</th><th>จำนวน</th></tr>${metrics.csatTrend.map((item) => `<tr><td>${item.month}</td><td>${item.average.toFixed(2)}</td><td>${item.count}</td></tr>`).join("")}</table>`;
    downloadHtml(`management-review-${new Date().toISOString().slice(0, 7)}.html`, reportShell("รายงานทบทวนฝ่ายบริหารด้านคุณภาพ", body));
  }

  function exportAudit(ncr: QualityNcr) {
    const linkedCases = (data?.cases || []).filter((item) => item.linked_ncr_id === ncr.id);
    const caseIds = new Set(linkedCases.map((item) => item.id));
    const relatedActions = (data?.actions || []).filter((item) => caseIds.has(item.case_id));
    const relatedEvents = events.filter((item) => caseIds.has(item.case_id));
    const relatedDocs = documents.filter((item) => item.job_no === ncr.job_no);
    const body = `<div class="grid"><div class="kpi">เลข NCR<br><b>${esc(ncr.id.slice(0, 8).toUpperCase())}</b></div><div class="kpi">Severity<br><b>${esc(SEVERITY_LABEL[ncr.severity] || ncr.severity)}</b></div><div class="kpi">ใบงาน<br><b>${esc(ncr.job_no)}</b></div><div class="kpi">สถานะ<br><b>${esc(ncr.status)}</b></div></div><h2>รายละเอียดความไม่เป็นไปตามข้อกำหนด</h2><table><tr><th>หัวข้อ</th><td>${esc(ncr.title)}</td></tr><tr><th>ประเภท</th><td>${esc(TYPE_LABEL[ncr.type] || ncr.type)}</td></tr><tr><th>SKU</th><td>${esc(ncr.product_sku)}</td></tr><tr><th>วันที่เปิด / SLA</th><td>${esc(formatDate(ncr.created_at))} / ${esc(formatDate(ncr.due_at))}</td></tr></table><h2>เคสและ CAPA</h2><table><tr><th>รายการ</th><th>สถานะ</th><th>เกณฑ์/ผล</th></tr>${relatedActions.map((item) => `<tr><td>${esc(item.title)}</td><td>${esc(item.status)}</td><td>${esc(item.acceptance_criteria)} / ${esc(item.outcome)}</td></tr>`).join("") || "<tr><td colspan=3>ยังไม่มี CAPA ที่เชื่อมโยง</td></tr>"}</table><h2>Audit trail</h2><table><tr><th>เวลา</th><th>เหตุการณ์</th><th>รายละเอียด</th></tr>${relatedEvents.map((item) => `<tr><td>${esc(formatDate(item.occurred_at))}</td><td>${esc(item.event_type)}</td><td>${esc(JSON.stringify(item.detail))}</td></tr>`).join("") || "<tr><td colspan=3>ไม่พบ event จากเคสที่เชื่อมโยง</td></tr>"}</table><h2>หลักฐานและเอกสาร</h2><ul>${relatedDocs.map((item) => `<li>${esc(item.document_code || item.document_type)} — ${item.provider_web_url ? `<a href="${esc(item.provider_web_url)}">เปิด SharePoint</a>` : "จัดเก็บในทะเบียนเอกสาร"}</li>`).join("") || "<li>ยังไม่มีเอกสารอนุมัติที่เชื่อมโยง</li>"}</ul>`;
    downloadHtml(`audit-ncr-${ncr.id.slice(0, 8)}.html`, reportShell("รายงานตรวจสอบย้อนกลับ NCR", body));
  }

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center text-slate-500">กำลังรวบรวมข้อมูล NCR · After-sales · CSAT…</div>;
  if (error || !filtered || !metrics) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">โหลดรายงานไม่สำเร็จ: {error || "ไม่พบข้อมูล"}</div>;

  return <div className="mx-auto max-w-7xl space-y-5 pb-10">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-blue-700">ISO 9001 · Management Review</p><h1 className="mt-1 text-2xl font-black text-slate-950">ทบทวนคุณภาพและการปรับปรุงต่อเนื่อง</h1><p className="mt-1 text-sm text-slate-500">เห็นปัญหาซ้ำ งานเกิน SLA ประสิทธิผล CAPA และเสียงลูกค้าในหน้าเดียว</p></div><div className="flex flex-wrap gap-2"><select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold"><option value="30">30 วัน</option><option value="90">90 วัน</option><option value="365">12 เดือน</option><option value="all">ทั้งหมด</option></select><button onClick={exportManagementReview} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">ส่งออกรายงานผู้บริหาร</button></div></header>
    {local ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">Local preview — ใช้ข้อมูลจำลองเพื่อรีวิวหน้าตาและ flow</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {[["NCR เปิด", metrics.openNcrs.length, "text-red-700"], ["NCR เกิน SLA", metrics.overdueNcrs.length, "text-red-700"], ["เคสเปิด", metrics.openCases.length, "text-blue-700"], ["CAPA ค้าง", metrics.pendingActions.length, "text-amber-700"], ["ประสิทธิผล", `${metrics.effectivenessRate}%`, "text-emerald-700"], ["CSAT", metrics.csatAverage ? metrics.csatAverage.toFixed(2) : "—", "text-violet-700"]].map(([label, value, color]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p></article>)}
    </section>
    <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><article className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-black text-slate-900">จุดที่ต้องตัดสินใจ</h2><p className="text-xs text-slate-500">เรียงจากความเสี่ยงและ SLA</p></div><span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">{metrics.overdueNcrs.length + metrics.overdueCases.length + metrics.overdueActions.length} เกินกำหนด</span></div><div className="mt-4 space-y-2">{[...metrics.overdueNcrs.map((item) => ({ title: item.title, meta: `NCR · ${SEVERITY_LABEL[item.severity] || item.severity}`, href: `/ncr?id=${item.id}` })), ...metrics.overdueCases.map((item) => ({ title: item.summary, meta: `${item.case_no} · After-sales`, href: "/after-sales" })), ...metrics.overdueActions.map((item) => ({ title: item.title, meta: "CAPA เกินกำหนด", href: "/after-sales" }))].slice(0, 8).map((item) => <a key={`${item.meta}-${item.title}`} href={item.href} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50"><span className="h-2.5 w-2.5 rounded-full bg-red-500"/><span className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-900">{item.title}</b><span className="text-xs text-slate-500">{item.meta}</span></span><span>›</span></a>)}{metrics.overdueNcrs.length + metrics.overdueCases.length + metrics.overdueActions.length === 0 ? <p className="rounded-xl bg-emerald-50 p-5 text-center text-sm text-emerald-700">ไม่มีรายการเกินกำหนด</p> : null}</div></article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black text-slate-900">แนวโน้ม CSAT</h2><p className="text-xs text-slate-500">คะแนนเฉลี่ยรายเดือน · {metrics.scoredCount} แบบประเมิน</p><div className="mt-5 flex h-44 items-end gap-3 border-b border-slate-200 px-2">{metrics.csatTrend.slice(-12).map((item) => <div key={item.month} className="flex min-w-0 flex-1 flex-col items-center gap-2"><span className="text-xs font-bold text-violet-700">{item.average.toFixed(1)}</span><div className="w-full rounded-t-lg bg-violet-500" style={{height:`${Math.max(8,item.average/5*120)}px`}}/><span className="text-[10px] text-slate-500">{item.month.slice(5)}</span></div>)}</div></article></section>
    <section className="grid gap-4 lg:grid-cols-3"><Breakdown title="NCR ตามประเภท" rows={metrics.byType.map(([key, value]) => [TYPE_LABEL[key] || key, value])}/><Breakdown title="NCR ตามทีม" rows={metrics.byTeam}/><Breakdown title="NCR ตาม SKU" rows={metrics.bySku.slice(0, 6)}/></section>
    <section className="rounded-2xl border border-slate-200 bg-white"><div className="flex flex-wrap gap-2 border-b border-slate-200 p-4">{(["ncr","cases","capa","recurrence"] as const).map((key) => <button key={key} onClick={() => setFocus(key)} className={`rounded-xl px-4 py-2 text-sm font-bold ${focus===key?"bg-blue-600 text-white":"bg-slate-100 text-slate-600"}`}>{key === "ncr" ? `NCR เปิด ${metrics.openNcrs.length}` : key === "cases" ? `เคสเปิด ${metrics.openCases.length}` : key === "capa" ? `CAPA ค้าง ${metrics.pendingActions.length}` : `ปัญหาซ้ำ 90 วัน ${metrics.recurrenceGroups.length}`}</button>)}</div><div className="divide-y divide-slate-100">
      {focus === "ncr" ? metrics.openNcrs.map((item) => <button key={item.id} onClick={() => setSelected(item)} className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 md:grid-cols-[1fr_150px_130px_100px]"><span><b className="block text-slate-900">{item.title}</b><small className="text-slate-500">{item.job_no} · {jobs.get(item.job_no || "")?.customer || "ไม่ระบุลูกค้า"}</small></span><span className="text-sm text-slate-600">{TYPE_LABEL[item.type] || item.type}</span><span className="text-sm font-bold text-red-700">{SEVERITY_LABEL[item.severity] || item.severity}</span><span className="text-sm text-blue-700">ดู Audit ›</span></button>) : null}
      {focus === "cases" ? metrics.openCases.map((item) => <a key={item.id} href="/after-sales" className="grid gap-2 p-4 hover:bg-slate-50 md:grid-cols-[1fr_150px_130px]"><span><b className="block text-slate-900">{item.summary}</b><small className="text-slate-500">{item.case_no} · {item.job_no}</small></span><span className="text-sm text-slate-600">{item.assigned_team || "ยังไม่ระบุทีม"}</span><span className="text-sm font-bold text-blue-700">{item.status} ›</span></a>) : null}
      {focus === "capa" ? metrics.pendingActions.map((item) => <a key={item.id} href="/after-sales" className="grid gap-2 p-4 hover:bg-slate-50 md:grid-cols-[1fr_170px_130px]"><span><b className="block text-slate-900">{item.title}</b><small className="text-slate-500">เกณฑ์: {item.acceptance_criteria || "ยังไม่กำหนด"}</small></span><span className="text-sm text-slate-600">ครบกำหนด {formatDate(item.due_at)}</span><span className="text-sm font-bold text-amber-700">{item.status} ›</span></a>) : null}
      {focus === "recurrence" ? metrics.recurrenceGroups.map((group) => <button key={group.key} onClick={() => setSelected(group.items[0])} className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 md:grid-cols-[1fr_140px_120px]"><span><b className="block text-slate-900">{TYPE_LABEL[group.type] || group.type}</b><small className="text-slate-500">SKU {group.sku} · พบซ้ำภายใน 90 วัน</small></span><span className="text-sm font-bold text-red-700">{group.count} NCR</span><span className="text-sm text-blue-700">Trace NCR ›</span></button>) : null}
      {((focus === "ncr" && metrics.openNcrs.length === 0) || (focus === "cases" && metrics.openCases.length === 0) || (focus === "capa" && metrics.pendingActions.length === 0) || (focus === "recurrence" && metrics.recurrenceGroups.length === 0)) ? <p className="p-8 text-center text-sm text-slate-400">ไม่มีรายการในช่วงเวลานี้</p> : null}
    </div></section>
    {selected ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-red-700">NCR AUDIT TRACE</p><h2 className="mt-1 text-xl font-black">{selected.title}</h2><p className="mt-1 text-sm text-slate-500">{selected.job_no} · {selected.product_sku || "ไม่ระบุ SKU"}</p></div><button onClick={() => setSelected(null)} className="p-2 text-xl">×</button></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Mini label="Severity" value={SEVERITY_LABEL[selected.severity] || selected.severity}/><Mini label="เปิดเมื่อ" value={formatDate(selected.created_at)}/><Mini label="SLA" value={formatDate(selected.due_at)}/></div><div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">รายงาน Audit จะรวม NCR, เคสบริการหลังการขาย, CAPA, timeline และลิงก์เอกสาร SharePoint ของใบงานนี้</div><div className="mt-5 flex justify-end gap-2"><a href={`/ncr?id=${selected.id}`} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">เปิด NCR</a><button onClick={() => exportAudit(selected)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">ส่งออก Audit Report</button></div></div></div> : null}
  </div>;
}

function Mini({label,value}:{label:string;value:string}) { return <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{value}</p></div>; }
function Breakdown({title,rows}:{title:string;rows:Array<[string,number]>}) { const max=Math.max(1,...rows.map(([,value])=>value)); return <article className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black text-slate-900">{title}</h2><div className="mt-4 space-y-3">{rows.slice(0,6).map(([label,value])=><div key={label}><div className="flex justify-between text-xs"><span className="truncate text-slate-600">{label}</span><b>{value}</b></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{width:`${value/max*100}%`}}/></div></div>)}{rows.length===0?<p className="text-sm text-slate-400">ยังไม่มีข้อมูล</p>:null}</div></article>; }

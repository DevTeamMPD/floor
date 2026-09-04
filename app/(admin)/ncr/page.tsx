"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify-error";

type Severity = "critical" | "high" | "medium" | "low";
type IsoStage = "containment" | "root_cause" | "capa_plan" | "implementation" | "effectiveness" | "closed";

interface NcrReport {
  id: string; job_no: string | null; title: string; type: string; status: string; severity: Severity;
  due_at: string | null; product_sku: string | null; quantity: number | null; description: string | null;
  estimated_value_thb: number | null; created_by: string | null; created_at: string; updated_at: string; closed_at: string | null;
}

interface IsoDetail {
  ncrNo: string; source: string; owner: string; affectedLot: string; customerImpact: string;
  immediateControl: string; rootCause: string; correctiveAction: string; effectivenessCriteria: string; isoStage: IsoStage;
  evidence: Array<{ label: string; complete: boolean }>;
  timeline: Array<{ title: string; detail: string; at: string }>;
}

interface JobOption { job_no: string; customer: string | null }

const ISO_STAGES: Array<{ key: IsoStage; short: string; label: string; clause: string }> = [
  { key: "containment", short: "1", label: "ควบคุมทันที", clause: "ISO 8.7" },
  { key: "root_cause", short: "2", label: "วิเคราะห์สาเหตุ", clause: "ISO 10.2" },
  { key: "capa_plan", short: "3", label: "อนุมัติ CAPA", clause: "ISO 10.2" },
  { key: "implementation", short: "4", label: "ดำเนินการ", clause: "ISO 10.2" },
  { key: "effectiveness", short: "5", label: "ตรวจประสิทธิผล", clause: "ISO 10.2" },
  { key: "closed", short: "6", label: "ปิด NCR", clause: "Controlled" },
];

const TYPE_LABELS: Record<string, string> = {
  quality: "คุณภาพสินค้า", damage: "สินค้าเสียหาย", missing: "สินค้าขาดหาย", wrong: "สินค้าผิดรายการ",
  installation: "การติดตั้ง", process: "กระบวนการ", other: "อื่น ๆ",
};

const SEVERITY_STYLE: Record<Severity, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-600" },
  high: { label: "สูง", cls: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  medium: { label: "กลาง", cls: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-400" },
  low: { label: "ต่ำ", cls: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
};

const STAGE_STYLE: Record<IsoStage, { label: string; cls: string }> = {
  containment: { label: "ควบคุมทันที", cls: "bg-red-50 text-red-700" },
  root_cause: { label: "วิเคราะห์สาเหตุ", cls: "bg-amber-50 text-amber-700" },
  capa_plan: { label: "รออนุมัติ CAPA", cls: "bg-violet-50 text-violet-700" },
  implementation: { label: "ดำเนินการแก้ไข", cls: "bg-blue-50 text-blue-700" },
  effectiveness: { label: "ตรวจประสิทธิผล", cls: "bg-cyan-50 text-cyan-700" },
  closed: { label: "ปิดแล้ว", cls: "bg-emerald-50 text-emerald-700" },
};

const LEGACY_STAGE: Record<string, IsoStage> = {
  open: "containment", investigating: "root_cause", corrective_action: "implementation", verified: "effectiveness", closed: "closed",
};
const NEXT_LEGACY_STAGE: Record<string, string> = { open: "investigating", investigating: "corrective_action", corrective_action: "verified", verified: "closed" };
const NEXT_LEGACY_LABEL: Record<string, string> = { open: "เริ่มวิเคราะห์สาเหตุ", investigating: "เริ่มดำเนินการแก้ไข", corrective_action: "ส่งตรวจประสิทธิผล", verified: "ปิด NCR" };

const previewNow = new Date();
const hoursFromNow = (hours: number) => new Date(previewNow.getTime() + hours * 60 * 60 * 1000).toISOString();
const daysAgo = (days: number) => new Date(previewNow.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const DEMO_NCRS: NcrReport[] = [
  { id: "demo-ncr-001", job_no: "ORD-202608-8293", title: "พื้นยกตัวหลังติดตั้งบริเวณทางเดิน", type: "installation", status: "root_cause", severity: "critical", due_at: hoursFromNow(-5), product_sku: "RS-WB-18", quantity: 18, description: "ลูกค้าแจ้งว่าพื้นยกตัวหลายจุดหลังส่งมอบ 7 วัน มีความเสี่ยงสะดุดล้ม", estimated_value_thb: 42000, created_by: "ฝ่ายบริการลูกค้า", created_at: daysAgo(2), updated_at: hoursFromNow(-2), closed_at: null },
  { id: "demo-ncr-002", job_no: "ORD-202608-8137", title: "สีสินค้าในล็อตเดียวกันไม่สม่ำเสมอ", type: "quality", status: "capa_plan", severity: "high", due_at: hoursFromNow(8), product_sku: "RL-160-OAK", quantity: 26, description: "พบความต่างของเฉดสีระหว่างกล่องในล็อตเดียวกัน ต้องกักกันสต็อกคงเหลือ", estimated_value_thb: 68500, created_by: "หัวหน้าช่าง", created_at: daysAgo(4), updated_at: hoursFromNow(-6), closed_at: null },
  { id: "demo-ncr-003", job_no: "ORD-202608-8064", title: "อุปกรณ์จบงานจัดส่งไม่ครบตาม BOQ", type: "missing", status: "implementation", severity: "medium", due_at: hoursFromNow(46), product_sku: "ACC-END-08", quantity: 4, description: "ทีมติดตั้งได้รับตัวจบไม่ครบ ทำให้งานส่งมอบเลื่อน 1 วัน", estimated_value_thb: 7200, created_by: "คลังสินค้า", created_at: daysAgo(6), updated_at: hoursFromNow(-12), closed_at: null },
  { id: "demo-ncr-004", job_no: "ORD-202608-7970", title: "วิธีตรวจรับความชื้นก่อนติดตั้งไม่ครบ", type: "process", status: "effectiveness", severity: "medium", due_at: hoursFromNow(70), product_sku: null, quantity: null, description: "ทบทวน checklist และอบรมทีมแล้ว รอตรวจติดตามงานตัวอย่าง 3 งาน", estimated_value_thb: 0, created_by: "Quality Manager", created_at: daysAgo(14), updated_at: daysAgo(1), closed_at: null },
  { id: "demo-ncr-005", job_no: "ORD-202608-7844", title: "บรรจุภัณฑ์เสียหายระหว่างขนส่ง", type: "damage", status: "closed", severity: "low", due_at: daysAgo(3), product_sku: "RL-180-WB", quantity: 2, description: "เปลี่ยนสินค้าและเพิ่มมาตรฐานการรัดพาเลต ปิดหลังติดตาม 14 วันไม่เกิดซ้ำ", estimated_value_thb: 4100, created_by: "คลังสินค้า", created_at: daysAgo(30), updated_at: daysAgo(3), closed_at: daysAgo(3) },
];

const DEMO_DETAILS: Record<string, IsoDetail> = {
  "demo-ncr-001": {
    ncrNo: "NCR-2569-0018", source: "After-sales ASC-202609-000015", owner: "คุณธีรพล · Quality Manager",
    affectedLot: "LOT-260821-A · คงเหลือ 64 กล่อง", customerImpact: "เสี่ยงสะดุดล้มและไม่สามารถใช้งานทางเดินได้ตามปกติ",
    immediateControl: "กั้นพื้นที่, นัดทีมเข้าตรวจภายใน 4 ชั่วโมง และ hold การติดตั้งสินค้าล็อตเดียวกันทั้งหมด",
    rootCause: "อยู่ระหว่าง 5 Why — พบค่าความชื้นพื้นเดิมสูงกว่ามาตรฐาน แต่หลักฐานหน้างานยังไม่ครบ",
    correctiveAction: "รอผล root cause ก่อนอนุมัติแผนแก้ไขถาวร",
    effectivenessCriteria: "ไม่พบการยกตัวซ้ำภายใน 30 วัน และ moisture checklist ครบ 100% ใน 5 งานถัดไป",
    isoStage: "root_cause",
    evidence: [
      { label: "รูปสภาพปัญหาและพื้นที่กักกัน", complete: true }, { label: "บันทึกการควบคุมผลิตภัณฑ์ไม่เป็นไปตามข้อกำหนด", complete: true },
      { label: "ผลวัดความชื้นและ 5 Why", complete: false }, { label: "CAPA พร้อมผู้รับผิดชอบและกำหนดเสร็จ", complete: false }, { label: "หลักฐานตรวจประสิทธิผล", complete: false },
    ],
    timeline: [
      { title: "เปิด NCR", detail: "ยกระดับจากเคสบริการหลังการขาย", at: "30 ส.ค. 09:15" },
      { title: "Containment สำเร็จ", detail: "กั้นพื้นที่และ hold ล็อตสินค้าแล้ว", at: "30 ส.ค. 10:05" },
      { title: "เริ่มวิเคราะห์สาเหตุ", detail: "Quality Manager รับผิดชอบ 5 Why", at: "30 ส.ค. 11:20" },
    ],
  },
  "demo-ncr-002": {
    ncrNo: "NCR-2569-0017", source: "ตรวจรับคลังสินค้า", owner: "คุณสุภาวดี · หัวหน้าคลัง",
    affectedLot: "LOT-260819-C · กักกัน 112 กล่อง", customerImpact: "ลูกค้ารอเปลี่ยนสินค้าและกำหนดติดตั้งอาจเลื่อน",
    immediateControl: "แยกล็อตและติดป้าย HOLD ในคลัง พร้อมหยุดเบิกจ่ายผ่านระบบ",
    rootCause: "Supplier เปลี่ยนช่วงการเคลือบผิวโดยไม่ได้แจ้ง change control",
    correctiveAction: "เพิ่ม incoming color sampling ทุกล็อต และให้ supplier ส่ง CoA ก่อนรับสินค้า",
    effectivenessCriteria: "3 ล็อตต่อเนื่องผ่าน sampling และไม่พบ complaint สีต่างภายใน 60 วัน",
    isoStage: "capa_plan",
    evidence: [
      { label: "รูปสินค้าและเลขล็อต", complete: true }, { label: "รายงานกักกันสินค้า", complete: true },
      { label: "Fishbone / 5 Why", complete: true }, { label: "CAPA รอ Quality Manager อนุมัติ", complete: false }, { label: "ผลตรวจประสิทธิผล", complete: false },
    ],
    timeline: [
      { title: "เปิด NCR", detail: "พบระหว่างสุ่มตรวจรับ", at: "27 ส.ค. 13:10" },
      { title: "ยืนยัน Root cause", detail: "Supplier ตอบ CAR และแนบ process change", at: "30 ส.ค. 15:45" },
      { title: "เสนอ CAPA", detail: "รอ Quality Manager อนุมัติ", at: "31 ส.ค. 09:30" },
    ],
  },
};

const EMPTY_FORM = { job_no: "", title: "", type: "quality", severity: "medium", description: "", created_by: "" };

function stageOf(ncr: NcrReport): IsoStage {
  if (ncr.status in STAGE_STYLE) return ncr.status as IsoStage;
  return LEGACY_STAGE[ncr.status] ?? "containment";
}

function formatMoney(value: number | null) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatDate(value: string | null) {
  if (!value) return "ยังไม่กำหนด";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isOverdue(ncr: NcrReport) {
  return stageOf(ncr) !== "closed" && !!ncr.due_at && new Date(ncr.due_at).getTime() < Date.now();
}

function defaultDetail(ncr: NcrReport): IsoDetail {
  return {
    ncrNo: `NCR-${ncr.id.slice(0, 8).toUpperCase()}`, source: "NCR เดิมในระบบ", owner: ncr.created_by || "ยังไม่ระบุผู้รับผิดชอบ",
    affectedLot: ncr.product_sku ? `SKU ${ncr.product_sku}${ncr.quantity ? ` · ${ncr.quantity} หน่วย` : ""}` : "ยังไม่ระบุล็อต/ขอบเขต",
    customerImpact: ncr.description || "ยังไม่บันทึกผลกระทบ", immediateControl: "ยังไม่บันทึกมาตรการควบคุมทันที",
    rootCause: "ยังไม่บันทึกการวิเคราะห์สาเหตุ", correctiveAction: "ยังไม่บันทึกแผน Corrective Action",
    effectivenessCriteria: "ยังไม่กำหนดเกณฑ์ตรวจประสิทธิผล", isoStage: stageOf(ncr),
    evidence: [
      { label: "หลักฐานปัญหาและขอบเขตที่ได้รับผลกระทบ", complete: false }, { label: "Containment / Correction", complete: false },
      { label: "Root cause analysis", complete: false }, { label: "CAPA และผู้รับผิดชอบ", complete: false }, { label: "Effectiveness verification", complete: false },
    ],
    timeline: [{ title: "เปิด NCR", detail: ncr.title, at: formatDate(ncr.created_at) }],
  };
}

function NcrPageInner() {
  const params = useSearchParams();
  const highlightId = params.get("id") ?? "";
  const prefillJobNo = params.get("job_no") ?? "";
  const supabase = useMemo(() => createClient(), []);
  const [ncrs, setNcrs] = useState<NcrReport[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selected, setSelected] = useState<NcrReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [localPreview, setLocalPreview] = useState(false);
  const [filter, setFilter] = useState<"active" | "overdue" | "critical" | "all">("active");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, job_no: prefillJobNo });
  const [saving, setSaving] = useState(false);

  async function loadNcrs() {
    const { data, error } = await supabase.from("ncr_reports").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    setNcrs((data ?? []) as NcrReport[]);
    if (highlightId) setSelected(((data ?? []) as NcrReport[]).find((item) => item.id === highlightId) ?? null);
  }

  useEffect(() => {
    async function init() {
      const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      setLocalPreview(isLocal);
      if (isLocal) {
        setNcrs(DEMO_NCRS);
        setJobs(DEMO_NCRS.filter((item) => item.job_no).map((item) => ({ job_no: item.job_no!, customer: item.title })));
        if (highlightId) setSelected(DEMO_NCRS.find((item) => item.id === highlightId) ?? null);
        setLoading(false);
        return;
      }
      try {
        const [{ data: jobData }] = await Promise.all([
          supabase.from("install_jobs").select("job_no, customer").order("job_no", { ascending: false }), loadNcrs(),
        ]);
        setJobs((jobData ?? []) as JobOption[]);
      } catch (error) {
        notifyError(error, "โหลด NCR");
      } finally { setLoading(false); }
    }
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = useMemo(() => {
    const active = ncrs.filter((ncr) => stageOf(ncr) !== "closed");
    return {
      active: active.length, overdue: active.filter(isOverdue).length,
      critical: active.filter((ncr) => ["critical", "high"].includes(ncr.severity)).length,
      exposure: active.reduce((sum, ncr) => sum + (ncr.estimated_value_thb ?? 0), 0),
      effectiveness: active.filter((ncr) => stageOf(ncr) === "effectiveness").length,
    };
  }, [ncrs]);

  const visibleNcrs = useMemo(() => ncrs.filter((ncr) => {
    if (filter === "active" && stageOf(ncr) === "closed") return false;
    if (filter === "overdue" && !isOverdue(ncr)) return false;
    if (filter === "critical" && !["critical", "high"].includes(ncr.severity)) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [ncr.title, ncr.job_no, ncr.product_sku, TYPE_LABELS[ncr.type]].some((value) => value?.toLowerCase().includes(needle));
  }), [filter, ncrs, query]);

  async function createNcr() {
    if (localPreview) return;
    if (!form.title.trim() || !form.job_no) { notifyError("กรุณาเลือกใบงานและระบุปัญหา"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("create_floor_ncr", {
        p_job_no: form.job_no, p_title: form.title.trim(), p_type: form.type, p_product_sku: null, p_quantity: null,
        p_description: form.description.trim() || null, p_estimated_value_thb: null, p_created_by: form.created_by.trim() || null, p_severity: form.severity,
      });
      if (error) throw error;
      toast.success("สร้าง NCR แล้ว"); setShowForm(false); setForm(EMPTY_FORM); await loadNcrs();
    } catch (error) { notifyError(error, "สร้าง NCR"); }
    finally { setSaving(false); }
  }

  async function advanceSelected() {
    if (!selected || localPreview) return;
    const next = NEXT_LEGACY_STAGE[selected.status];
    if (!next) return;
    const { error } = await supabase.rpc("advance_floor_ncr", { p_ncr_id: selected.id, p_next_status: next });
    if (error) { notifyError(error, "เลื่อนสถานะ"); return; }
    toast.success(NEXT_LEGACY_LABEL[selected.status]); setSelected(null); await loadNcrs();
  }

  const selectedDetail = selected ? (DEMO_DETAILS[selected.id] ?? defaultDetail(selected)) : null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-red-600">Quality Management · ISO 9001</p><h1 className="mt-1 text-2xl font-bold text-slate-950">ศูนย์ควบคุม NCR</h1><p className="mt-1 text-sm text-slate-500">ควบคุมสิ่งที่ไม่เป็นไปตามข้อกำหนด วิเคราะห์สาเหตุ และป้องกันการเกิดซ้ำ</p></div>
          <div className="flex flex-wrap gap-2"><a href="/after-sales" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">← บริการหลังการขาย</a><button disabled={localPreview} onClick={() => setShowForm(true)} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">+ เปิด NCR</button></div>
        </header>

        {localPreview && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">Local preview — ข้อมูลจำลองสำหรับรีวิว flow เท่านั้น ไม่บันทึกหรือเปลี่ยนข้อมูลจริง</div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["NCR ที่ยังเปิด", metrics.active, "รายการที่ต้องควบคุม", "text-slate-950"], ["เกิน SLA", metrics.overdue, "ต้องเร่งดำเนินการ", "text-red-700"],
            ["Critical / High", metrics.critical, "ความเสี่ยงสูง", "text-orange-700"], ["มูลค่าความเสี่ยง", formatMoney(metrics.exposure), "รายการที่ยังเปิด", "text-violet-700"],
            ["รอตรวจประสิทธิผล", metrics.effectiveness, "ก่อนอนุมัติปิด", "text-cyan-700"],
          ].map(([label, value, help, color]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p><p className="mt-1 text-xs text-slate-400">{help}</p></article>)}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4"><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ISO_STAGES.map((stage, index) => { const count = ncrs.filter((ncr) => stageOf(ncr) === stage.key).length; return <div key={stage.key} className="relative rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{stage.short}</span><span className="text-xs font-bold text-slate-500">{count}</span></div><p className="mt-2 text-xs font-bold text-slate-800">{stage.label}</p><p className="mt-0.5 text-[10px] text-slate-400">{stage.clause}</p>{index < ISO_STAGES.length - 1 && <span className="absolute -right-2 top-1/2 z-10 hidden text-slate-300 sm:block">›</span>}</div>; })}
          </div></div>

          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">{([ ["active", `กำลังดำเนินการ ${metrics.active}`], ["overdue", `เกิน SLA ${metrics.overdue}`], ["critical", `ความเสี่ยงสูง ${metrics.critical}`], ["all", `ทั้งหมด ${ncrs.length}`] ] as const).map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>)}</div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา NCR / ใบงาน / SKU / ปัญหา" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 lg:w-80" />
          </div>

          {loading ? <div className="p-12 text-center text-sm text-slate-400">กำลังโหลด NCR...</div> : <div className="divide-y divide-slate-100">
            {visibleNcrs.map((ncr) => { const stage = stageOf(ncr); const severity = SEVERITY_STYLE[ncr.severity]; return <button key={ncr.id} onClick={() => setSelected(ncr)} className="grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition hover:bg-slate-50 lg:grid-cols-[1.5fr_.7fr_.7fr_.6fr_auto] lg:items-center">
              <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${severity.dot}`} /><p className="truncate font-bold text-slate-900">{ncr.title}</p></div><p className="mt-1 truncate pl-[18px] text-xs text-slate-500">{ncr.job_no || "ไม่ผูกใบงาน"} · {TYPE_LABELS[ncr.type] ?? ncr.type}</p></div>
              <div><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${severity.cls}`}>{severity.label}</span></div><div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${STAGE_STYLE[stage].cls}`}>{STAGE_STYLE[stage].label}</span></div>
              <div><p className={`text-xs font-bold ${isOverdue(ncr) ? "text-red-700" : "text-slate-700"}`}>{isOverdue(ncr) ? "เกิน SLA" : stage === "closed" ? "ปิดแล้ว" : "ครบกำหนด"}</p><p className="mt-0.5 text-xs text-slate-400">{formatDate(stage === "closed" ? ncr.closed_at : ncr.due_at)}</p></div><div className="flex items-center justify-between gap-4 lg:justify-end"><span className="text-xs font-semibold text-slate-500">{formatMoney(ncr.estimated_value_thb)}</span><span className="text-xl text-slate-300">›</span></div>
            </button>; })}
            {visibleNcrs.length === 0 && <div className="p-12 text-center"><p className="font-semibold text-slate-600">ไม่พบ NCR ตามตัวกรอง</p><p className="mt-1 text-sm text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหา</p></div>}
          </div>}
        </section>
      </div>

      {selected && selectedDetail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[1px] sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
        <div role="dialog" aria-modal="true" aria-label={`รายละเอียด ${selectedDetail.ncrNo}`} className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black text-slate-950">{selectedDetail.ncrNo}</h2><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${SEVERITY_STYLE[selected.severity].cls}`}>{SEVERITY_STYLE[selected.severity].label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STAGE_STYLE[selectedDetail.isoStage].cls}`}>{STAGE_STYLE[selectedDetail.isoStage].label}</span></div><p className="mt-1 text-sm font-semibold text-slate-700">{selected.title}</p><p className="mt-1 text-xs text-slate-400">ใบงาน {selected.job_no || "—"} · {selectedDetail.source}</p></div><button aria-label="ปิดรายละเอียด" onClick={() => setSelected(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button></div>
          <div className="overflow-y-auto">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6"><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{ISO_STAGES.map((stage, index) => { const current = ISO_STAGES.findIndex((item) => item.key === selectedDetail.isoStage); const done = index < current || selectedDetail.isoStage === "closed"; const active = index === current && selectedDetail.isoStage !== "closed"; return <div key={stage.key} className="text-center"><div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${done ? "bg-emerald-500 text-white" : active ? "bg-red-600 text-white ring-4 ring-red-100" : "bg-slate-200 text-slate-500"}`}>{done ? "✓" : stage.short}</div><p className={`mt-1.5 text-[11px] font-bold ${active ? "text-red-700" : "text-slate-600"}`}>{stage.label}</p></div>; })}</div></div>
            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.45fr_.8fr]">
              <div className="space-y-5">
                <section className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-bold text-slate-400">ผู้รับผิดชอบ NCR</p><p className="mt-1 text-sm font-bold text-slate-800">{selectedDetail.owner}</p></div><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-bold text-slate-400">ขอบเขต / ล็อตที่ได้รับผลกระทบ</p><p className="mt-1 text-sm font-bold text-slate-800">{selectedDetail.affectedLot}</p></div></section>
                <section className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-red-500">Customer / Business impact</p><p className="mt-1 text-sm font-semibold leading-relaxed text-red-900">{selectedDetail.customerImpact}</p></section>
                {[
                  ["Containment / Correction", selectedDetail.immediateControl, "ควบคุมปัญหาทันที ไม่ให้ผลกระทบขยาย", "border-orange-200 bg-orange-50/40"], ["Root cause analysis", selectedDetail.rootCause, "ต้องตอบว่าทำไมระบบจึงปล่อยให้เกิด ไม่หยุดที่อาการ", "border-amber-200 bg-amber-50/40"],
                  ["Corrective Action (CAPA)", selectedDetail.correctiveAction, "ระบุ owner, due date และการเปลี่ยนแปลงเชิงระบบ", "border-blue-200 bg-blue-50/40"], ["Effectiveness criteria", selectedDetail.effectivenessCriteria, "ต้องวัดได้ก่อน Quality Manager อนุมัติปิด", "border-cyan-200 bg-cyan-50/40"],
                ].map(([title, body, help, cls]) => <section key={title} className={`rounded-xl border p-4 ${cls}`}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-black text-slate-900">{title}</h3><button disabled className="text-xs font-bold text-blue-500 disabled:opacity-40">แก้ไข</button></div><p className="mt-2 text-sm leading-relaxed text-slate-700">{body}</p><p className="mt-2 text-xs text-slate-400">{help}</p></section>)}
              </div>
              <aside className="space-y-5">
                <section className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">หลักฐาน ISO</h3><span className="text-xs font-bold text-slate-500">{selectedDetail.evidence.filter((item) => item.complete).length}/{selectedDetail.evidence.length} ครบ</span></div><div className="mt-3 space-y-2">{selectedDetail.evidence.map((item) => <div key={item.label} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{item.complete ? "✓" : "!"}</span><span className="text-xs font-medium leading-relaxed text-slate-700">{item.label}</span></div>)}</div></section>
                <section className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-black text-slate-900">Audit trail</h3><div className="mt-4 space-y-4">{selectedDetail.timeline.map((event, index) => <div key={`${event.title}-${event.at}`} className="relative pl-5"><span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />{index < selectedDetail.timeline.length - 1 && <span className="absolute left-[4px] top-4 h-[calc(100%+8px)] w-px bg-slate-200" />}<p className="text-xs font-bold text-slate-800">{event.title}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-500">{event.detail}</p><p className="mt-1 text-[10px] text-slate-400">{event.at}</p></div>)}</div></section>
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">Quality gate ถัดไป</p><p className="mt-1 text-sm font-black text-slate-900">{selectedDetail.isoStage === "root_cause" ? "ยืนยัน Root cause และเสนอ CAPA" : selectedDetail.isoStage === "capa_plan" ? "Quality Manager อนุมัติ CAPA" : selectedDetail.isoStage === "effectiveness" ? "บันทึกผลตรวจและอนุมัติปิด" : "ดำเนินการตามขั้นตอน ISO"}</p><button disabled={localPreview || selected.status === "closed"} onClick={() => void advanceSelected()} className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35">{localPreview ? "Local preview — ปิดการบันทึก" : NEXT_LEGACY_LABEL[selected.status] || "รอข้อมูลขั้นถัดไป"}</button></section>
              </aside>
            </div>
          </div>
        </div>
      </div>}

      {showForm && !localPreview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-lg font-black">เปิด NCR ใหม่</h2><button onClick={() => setShowForm(false)} className="text-xl text-slate-400">×</button></div><div className="space-y-4 p-5">
        <label className="block text-sm font-bold text-slate-700">ใบงาน<select value={form.job_no} onChange={(event) => setForm({ ...form, job_no: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"><option value="">เลือกใบงาน</option>{jobs.map((job) => <option key={job.job_no} value={job.job_no}>{job.job_no} · {job.customer}</option>)}</select></label>
        <label className="block text-sm font-bold text-slate-700">ปัญหา<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold text-slate-700">ประเภท<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm">{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm font-bold text-slate-700">ความรุนแรง<select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"><option value="critical">Critical · 4 ชม.</option><option value="high">High · 24 ชม.</option><option value="medium">Medium · 7 วัน</option><option value="low">Low · 14 วัน</option></select></label></div>
        <label className="block text-sm font-bold text-slate-700">รายละเอียด<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 w-full resize-none rounded-xl border px-3 py-2.5 text-sm" /></label>
      </div><div className="flex gap-3 border-t p-5"><button onClick={() => setShowForm(false)} className="flex-1 rounded-xl border py-2.5 text-sm font-bold text-slate-600">ยกเลิก</button><button disabled={saving} onClick={() => void createNcr()} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "กำลังบันทึก..." : "สร้าง NCR"}</button></div></div></div>}
    </div>
  );
}

export default function NcrPage() {
  return <Suspense fallback={<div className="p-12 text-center text-sm text-slate-400">กำลังโหลด NCR...</div>}><NcrPageInner /></Suspense>;
}

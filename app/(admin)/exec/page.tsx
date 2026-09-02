"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ---------- types ---------- */
type StageN = { id: number; name: string; n: number };
type NamedJob = { customer: string; product: string; due: string; stage: number };
type WasteTop = { customer: string; bill: string | null; zoneM2: number; actM2: number | null; pct: number | null };
type WasteStats = { count: number; avgPct: number | null; medianPct: number | null; normal: number; heavy: number; abnormal: number };
type WasteMonthly = { month: string; jobs: number; cost: number; avgPct: number | null };
type Exec = {
  jobs: { total: number; byStage: StageN[]; bySource: Record<string, number>; byMonth: { month: string; n: number }[]; completedByMonth: { month: string; n: number }[]; done: number; active: number; overdue: number; evaluated: number };
  workOrders: { status: string; n: number; avgDays: number; maxDays: number }[];
  leadTime: { n: number; avgDays: number | null; medianDays: number | null; p90Days: number | null };
  pipeline: { aging: { id: number; name: string; n: number; avgDays: number; maxDays: number }[]; stuck: { customer: string; product: string; stage: number; stageName: string; days: number }[] };
  upcoming: NamedJob[];
  overdueList: NamedJob[];
  waste: { withZones: number; withData: number; costSetup: boolean; totalWasteCost: number; top: WasteTop[]; monthly: WasteMonthly[]; stats: WasteStats };
  updatedAt: string;
};
type SResp = { timestamp: string; scores: (number | null)[]; overall: number | null; customer: string; comment: string; bill: string };
type Survey = { responses: SResp[] };

/* ---------- tokens (premium + alive) ---------- */
const INK = "#0b1220", SUB = "#3f4756", MUT = "#94a3b8", FAINT = "#cbd5e1", HAIR = "#e9ecf1", TRACK = "#eef1f6";
const GOOD = "#0f9d6b", WARN = "#c2801a", BAD = "#d33d54", ACCENT = "#4f46e5", ACCENT_2 = "#818cf8", ACCENT_L = "#c7d2fe";
const SHADOW = "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)";
const HEADER_BG = "linear-gradient(100deg,#0b1220 0%,#182338 60%,#1f2b47 100%)";
const tint = (c: string) => (c === BAD ? "rgba(211,61,84,0.06)" : c === WARN ? "rgba(194,128,26,0.06)" : "#ffffff");
const CHANNEL: Record<string, string> = { sales_txn: ACCENT, manual: "#94a3b8", shopee: "#ea580c", lazada: "#7c3aed", tiktok: BAD, web: GOOD };
const SOURCE_LABEL: Record<string, string> = { sales_txn: "ระบบขาย", manual: "สร้างเอง", shopee: "Shopee", lazada: "Lazada", tiktok: "TikTok", web: "เว็บ" };
const DIMS = ["บริการ", "คุณภาพงาน", "ความเรียบร้อย", "ตรงเวลา", "ความสุภาพ"];
const TARGET_CSAT = 4.5, TARGET_SATISFIED = 90, TARGET_DONE = 80;
const TARGET_LEAD_DAYS = 60;
const NUM: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const WORK_ORDER_PIPELINE = [
  { status: "head_review", label: "รอหัวหน้าช่างตรวจ", short: "ตรวจงาน", href: "/operations", color: WARN },
  { status: "returned_sales", label: "ส่งกลับฝ่ายขาย", short: "แก้ข้อมูล", href: "/operations", color: BAD },
  { status: "warehouse_waiting", label: "รอคลังรับงาน", short: "รอคลัง", href: "/warehouse", color: WARN },
  { status: "warehouse_preparing", label: "กำลังเตรียมสินค้า", short: "เตรียมสินค้า", href: "/warehouse", color: "#d97706" },
  { status: "ready_to_install", label: "รอติดตั้ง", short: "รอติดตั้ง", href: "/appointments", color: ACCENT },
  { status: "installing", label: "กำลังติดตั้ง", short: "ติดตั้ง", href: "/appointments", color: "#0891b2" },
  { status: "waiting_cs", label: "รอ CS โทรประเมิน", short: "รอ CS", href: "/cs-tracking", color: "#7c3aed" },
  { status: "closed", label: "ปิดงานแล้ว", short: "ปิดงาน", href: "/orders", color: GOOD },
] as const;

const THEMES: { key: string; re: RegExp }[] = [
  { key: "กลิ่นกาว / กลิ่นแผ่น", re: /กลิ่น/ },
  { key: "แผ่นขาด / ไม่ทน", re: /ขาด|ถลอก|บอบบาง|เปื่อย|ฉีก|หลุด/ },
  { key: "ตรงเวลา / มาสาย", re: /สาย|เลท|ตรงเวลา|เกินเวลา|ช้า/ },
  { key: "การเก็บงาน / ความสะอาด", re: /เก็บ|สะอาด|คัตเตอร์|เรียบร้อย|ขยะ|เศษ/ },
  { key: "รอยต่อ / การเชื่อมแผ่น", re: /รอยต่อ|สมาน|ซึม|เชื่อม|ต่อแผ่น|ช่องที่ตัด/ },
  { key: "การสื่อสาร / ราคา", re: /สื่อสาร|ราคา|แจ้ง|โทร|คอนเฟิม|ข้อมูล/ },
];

/* ---------- helpers ---------- */
function baht(n: number): string { return "฿" + Math.round(n).toLocaleString("th-TH"); }
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const names = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${names[Number(m)] || m}${String(Number(y) + 543).slice(-2)}`;
}
function avgColor(v: number): string { if (v >= 4.5) return GOOD; if (v >= 4) return ACCENT; if (v >= 3) return WARN; return BAD; }
function wasteColor(pct: number): string { return pct > 50 ? BAD : pct > 20 ? WARN : GOOD; }
function pctDelta(cur: number, prev: number | null): number | null { if (prev === null || prev === 0) return null; return ((cur - prev) / prev) * 100; }
function isoMonth(ts: string): string | null { const d = new Date(ts); if (isNaN(d.getTime())) return null; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

/* ---------- SVG charts ---------- */
function LineChart({ points, max = 5, target }: { points: { label: string; value: number }[]; max?: number; target?: number }) {
  const W = 340, H = 110, padL = 6, padR = 6, padT = 14, padB = 18;
  const n = points.length, iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => (n <= 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (Math.max(0, Math.min(max, v)) / max) * ih;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 106 }}>
      <defs><linearGradient id="csatFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity="0.16" /><stop offset="100%" stopColor={ACCENT} stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((g) => <line key={g} x1={padL} x2={W - padR} y1={padT + ih * g} y2={padT + ih * g} stroke={TRACK} strokeWidth="1" />)}
      {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={FAINT} strokeWidth="1" strokeDasharray="3 3" />}
      {area && <path d={area} fill="url(#csatFill)" />}
      <path d={line} fill="none" stroke={ACCENT} strokeWidth="2.25" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3.2" fill="#fff" stroke={ACCENT} strokeWidth="2" />
          <text x={x(i)} y={y(p.value) - 6} textAnchor="middle" fontSize="9" fontWeight="700" fill={ACCENT} style={NUM}>{p.value.toFixed(2)}</text>
          <text x={x(i)} y={H - 5} textAnchor="middle" fontSize="8" fill={MUT}>{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 41, cx = 52, cy = 52, sw = 13, Ci = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 104 104" width="82" height="82" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={TRACK} strokeWidth={sw} />
        {segments.map((s, i) => { const len = (s.value / total) * Ci; const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${len} ${Ci - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${cx} ${cy})`} />; acc += len; return el; })}
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize="21" fontWeight="800" fill={INK} style={NUM}>{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill={MUT}>งาน</text>
      </svg>
      <div className="space-y-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            <span style={{ color: SUB }}>{s.label}</span>
            <strong style={{ color: INK, ...NUM }}>{s.value}</strong>
            <span style={{ color: MUT, ...NUM }}>({Math.round((s.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function VBars({ bars, max, color = ACCENT, area = 60 }: { bars: { label: string; value: number }[]; max: number; color?: string; area?: number }) {
  return (
    <div className="flex items-end gap-2.5">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end">
          <span className="text-[10px] font-bold mb-1" style={{ color: SUB, ...NUM }}>{b.value}</span>
          <div className="w-full rounded-t-[3px]" style={{ height: Math.max(4, Math.round((b.value / max) * area)), background: color }} />
          <span className="text-[8.5px] mt-1.5" style={{ color: MUT }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- page ---------- */
export default function ExecPage() {
  const [ex, setEx] = useState<Exec | null>(null);
  const [sv, setSv] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const getJson = async <T,>(url: string): Promise<T> => {
        const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error(`${url} (${response.status})`);
        return response.json() as Promise<T>;
      };
      // A just-refreshed Supabase session can take one request to reach the
      // server. Retry once so the dashboard never silently turns real data
      // into a row of zeroes during that hand-off.
      let executive: Exec;
      try { executive = await getJson<Exec>("/api/exec-overview"); }
      catch {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        executive = await getJson<Exec>("/api/exec-overview");
      }
      const survey = await getJson<Survey>("/api/satisfaction-survey").catch(() => null);
      setEx(executive); setSv(survey);
    } catch {
      setEx(null);
      setLoadError("ไม่สามารถเชื่อมข้อมูลภาพรวมงานได้ กรุณากด “โหลดใหม่” อีกครั้ง");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const responses = useMemo(() => sv?.responses ?? [], [sv]);
  const allScores = useMemo(() => responses.flatMap((r) => r.scores.filter((x): x is number => x !== null)), [responses]);
  const csatAvg = useMemo(() => (allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0), [allScores]);
  const satisfied = useMemo(() => (allScores.length ? Math.round((allScores.filter((s) => s >= 4).length / allScores.length) * 100) : 0), [allScores]);
  const dimAvg = useMemo(() => DIMS.map((_, i) => { const v = responses.map((r) => r.scores[i]).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }), [responses]);
  const dimLow = useMemo(() => DIMS.map((_, i) => responses.filter((r) => { const s = r.scores[i]; return s !== null && s <= 3; }).length), [responses]);
  const lowList = useMemo(() => responses.filter((r) => r.scores.some((s) => s !== null && s <= 2) || (r.overall !== null && r.overall < 3)), [responses]);
  const csatMonthly = useMemo(() => {
    const agg: Record<string, { sum: number; n: number; responses: number }> = {};
    responses.forEach((r) => {
      const m = isoMonth(r.timestamp);
      const scores = r.scores.filter((score): score is number => score !== null);
      if (!m || !scores.length) return;
      agg[m] = agg[m] ?? { sum: 0, n: 0, responses: 0 };
      agg[m].responses++;
      scores.forEach((score) => { agg[m].sum += score; agg[m].n++; });
    });
    return Object.keys(agg).sort().map((m) => ({ month: m, avg: agg[m].sum / agg[m].n, n: agg[m].n, responses: agg[m].responses }));
  }, [responses]);
  const monthlySummary = useMemo(() => {
    const wasteByMonth = new Map((ex?.waste.monthly ?? []).map((row) => [row.month, row]));
    const csatByMonth = new Map(csatMonthly.map((row) => [row.month, row]));
    const now = new Date();
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const waste = wasteByMonth.get(month);
      const csat = csatByMonth.get(month);
      return { month, wasteJobs: waste?.jobs ?? 0, wasteCost: waste?.cost ?? 0, wastePct: waste?.avgPct ?? null, csat: csat?.avg ?? null, responses: csat?.responses ?? 0 };
    });
  }, [ex, csatMonthly]);
  const themeDetail = useMemo(() => {
    const real = responses.filter((r) => r.comment && r.comment !== "-" && r.comment !== "ไม่มี" && r.comment.length > 2);
    const out: { key: string; n: number }[] = [];
    for (const t of THEMES) { const m = real.filter((r) => t.re.test(r.comment)); if (m.length) out.push({ key: t.key, n: m.length }); }
    return out.sort((a, b) => b.n - a.n);
  }, [responses]);

  const maxStageN = useMemo(() => Math.max(1, ...(ex?.jobs.byStage ?? []).map((r) => r.n)), [ex]);
  const cbm = ex?.jobs.completedByMonth ?? [];
  const maxCbm = Math.max(1, ...cbm.map((r) => r.n));
  const evaluated = ex?.jobs.evaluated ?? 0;

  if (loading && !ex) return <div className="py-20 text-center" style={{ color: MUT }}>กำลังโหลด…</div>;

  const j = ex?.jobs;
  const donePct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;
  const flagCount = (ex?.jobs.overdue ?? 0) + lowList.length;
  const bm = ex?.jobs.byMonth ?? [];
  const lastJobs = bm.length ? bm[bm.length - 1] : null;
  const prevJobs = bm.length > 1 ? bm[bm.length - 2] : null;
  const jobDelta = lastJobs ? pctDelta(lastJobs.n, prevJobs?.n ?? null) : null;
  const lastCsat = csatMonthly.length ? csatMonthly[csatMonthly.length - 1] : null;
  const prevCsat = csatMonthly.length > 1 ? csatMonthly[csatMonthly.length - 2] : null;
  const csatDelta = lastCsat ? pctDelta(lastCsat.avg, prevCsat?.avg ?? null) : null;
  const maxMonthN = Math.max(1, ...bm.map((r) => r.n));
  const closingPct = j && j.total ? Math.round(((ex?.waste.withData ?? 0) / j.total) * 100) : 0;
  const worstIdx = dimAvg.length ? dimAvg.indexOf(Math.min(...dimAvg)) : 0;
  const bestIdx = dimAvg.length ? dimAvg.indexOf(Math.max(...dimAvg)) : 0;
  const ws = ex?.waste.stats;
  const wsTotal = ws ? Math.max(1, ws.count) : 1;
  const stuckN = ex?.pipeline?.stuck?.length ?? 0;
  const leadMed = ex?.leadTime?.medianDays ?? null;
  const leadHit = leadMed !== null && leadMed <= TARGET_LEAD_DAYS;
  const evalCoverage = j?.done ? Math.round((evaluated / j.done) * 100) : 0;
  const workOrders = ex?.workOrders ?? [];
  const workOrderByStatus = new Map(workOrders.map((row) => [row.status, row]));
  const maxWorkOrderN = Math.max(1, ...workOrders.map((row) => row.n));
  const latestMonthly = monthlySummary[monthlySummary.length - 1];

  const insight = (() => {
    if (!j) return "";
    const parts: string[] = [];
    if (lastJobs) { const d = jobDelta === null ? "" : ` (${jobDelta > 0 ? "▲" : jobDelta < 0 ? "▼" : "→"}${Math.abs(Math.round(jobDelta))}%)`; parts.push(`เดือน${monthLabel(lastJobs.month)} งานเข้า ${lastJobs.n}${d}`); }
    if (responses.length) parts.push(`CSAT ${csatAvg.toFixed(2)}${csatDelta === null ? "" : ` (${csatDelta > 0 ? "▲" : csatDelta < 0 ? "▼" : "→"})`}`);
    parts.push(`งานเสร็จ ${donePct}%`);
    if (leadMed != null) parts.push(`Lead time ${leadMed} วัน`);
    if (flagCount > 0) parts.push(`${flagCount} เคสต้องตาม`);
    if (themeDetail.length) parts.push(`ปัญหาเด่น ${themeDetail[0].key} (${themeDetail[0].n})`);
    return parts.join("   ·   ");
  })();

  const channelSegs = Object.entries(ex?.jobs.bySource ?? {}).map(([s, n]) => ({ label: SOURCE_LABEL[s] || s, value: n, color: CHANNEL[s] || MUT }));

  const heroes = [
    { label: "งานเสร็จสิ้น", value: `${donePct}`, unit: "%", color: donePct >= TARGET_DONE ? GOOD : WARN, note: `เป้า ${TARGET_DONE}%${donePct >= TARGET_DONE ? " · ผ่าน" : ""}` },
    { label: "ความพึงพอใจ CSAT", value: responses.length ? csatAvg.toFixed(2) : "—", unit: "/5", color: csatAvg >= TARGET_CSAT ? GOOD : csatAvg >= 4 ? WARN : BAD, note: `เป้า ${TARGET_CSAT}${csatAvg >= TARGET_CSAT ? " · ผ่าน" : ""}`, delta: csatDelta },
    { label: "Lead time มัธยฐาน", value: leadMed != null ? `${leadMed}` : "—", unit: "วัน", color: leadHit ? GOOD : BAD, note: leadHit ? `ในเป้า ${TARGET_LEAD_DAYS} วัน` : `เกินเป้า ${TARGET_LEAD_DAYS} วัน` },
    { label: "คอขวด ค้าง 30 วัน+", value: `${stuckN}`, unit: "งาน", color: stuckN === 0 ? GOOD : BAD, note: stuckN === 0 ? "ไม่มีงานค้าง" : "ต้องเร่งจัดการ" },
    { label: "เคสต้องติดตาม", value: `${flagCount}`, unit: "", color: flagCount === 0 ? GOOD : WARN, note: flagCount === 0 ? "ไม่มี" : "เกินกำหนด + คะแนนต่ำ" },
  ] as { label: string; value: string; unit: string; color: string; note: string; delta?: number | null }[];

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body { background: #fff !important; }
          .exec-card { box-shadow: none !important; border: 1px solid ${HAIR} !important; }
          .no-print { display: none !important; }
        }
      ` }} />
      <div className="exec-board flex flex-col p-3 sm:p-5 lg:p-[22px]"
        style={{ background: "#e9edf3", fontFamily: 'system-ui,-apple-system,"Segoe UI",sans-serif' }}>

        {/* header — dark anchor */}
        <div className="rounded-2xl px-5 py-3.5 flex items-center gap-3 shrink-0" style={{ background: HEADER_BG, boxShadow: SHADOW }}>
          <div className="w-1 h-8 rounded-full" style={{ background: ACCENT }} />
          <div>
            <h1 className="text-[18px] font-bold tracking-tight text-white leading-tight">ภาพรวมผู้บริหาร<span className="font-normal text-white/55">&nbsp;&nbsp;งานติดตั้ง MPD</span></h1>
            <div className="text-[10.5px] text-white/45" style={NUM}>อัปเดต {ex?.updatedAt ? new Date(ex.updatedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "-"}</div>
          </div>
          <div className="ml-auto flex gap-2 no-print">
            <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs text-white/85" style={{ border: "1px solid rgba(255,255,255,0.18)" }}>โหลดใหม่</button>
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: ACCENT }}>บันทึกเป็นสไลด์</button>
          </div>
        </div>

        {/* summary */}
        {loadError && <div className="exec-card mt-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>}
        {insight && (
          <div className="exec-card bg-white rounded-xl mt-2.5 shrink-0 flex items-center gap-3 px-4 py-2" style={{ boxShadow: SHADOW }}>
            <span className="text-[10px] font-bold uppercase shrink-0 px-2 py-0.5 rounded-md" style={{ color: "#fff", background: ACCENT, letterSpacing: "0.06em" }}>สรุปวันนี้</span>
            <span className="text-[12.5px]" style={{ color: SUB, ...NUM }}>{insight}</span>
          </div>
        )}

        {/* hero — 5 cards, top accent + selective tint on problems */}
        <div className="grid grid-cols-1 gap-2.5 mt-2.5 sm:grid-cols-2 xl:grid-cols-5 shrink-0">
          {heroes.map((h, i) => {
            let d = null;
            if (h.delta !== undefined && h.delta !== null && Math.round(h.delta) !== 0) { const up = h.delta > 0; d = <span className="text-[10px] font-bold" style={{ color: up ? GOOD : BAD, ...NUM }}>{up ? "▲" : "▼"}{Math.abs(Math.round(h.delta))}%</span>; }
            return (
              <div key={i} className="exec-card rounded-2xl px-4 pt-3 pb-3.5 relative overflow-hidden" style={{ background: tint(h.color), boxShadow: SHADOW }}>
                <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: h.color }} />
                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] uppercase" style={{ color: MUT, letterSpacing: "0.03em" }}>{h.label}</div>
                  {d}
                </div>
                <div className="mt-2 leading-none flex items-baseline gap-1"><span className="text-[36px] font-extrabold tracking-tight" style={{ color: h.color, ...NUM }}>{h.value}</span>{h.unit && <span className="text-sm font-bold" style={{ color: h.color }}>{h.unit}</span>}</div>
                <div className="text-[10.5px] mt-2 font-medium" style={{ color: SUB }}>{h.note}</div>
              </div>
            );
          })}
        </div>

        {/* context micro row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2.5 shrink-0 text-[11px] px-1" style={{ color: MUT }}>
          <Micro label="งานเข้าเดือนนี้" value={`${lastJobs?.n ?? 0}`} delta={jobDelta} />
          <Micro label="งานเข้าสะสม" value={`${j?.total ?? 0}`} />
          <Micro label="กำลังดำเนินงาน" value={`${j?.active ?? 0}`} />
          <Micro label="ประเมินแล้ว" value={`${evaluated}/${j?.done ?? 0} (${evalCoverage}%)`} />
          <Micro label="พึงพอใจ 4-5" value={`${satisfied}%`} />
        </div>

        {/* detail — 3 columns */}
        <div className="grid grid-cols-1 gap-3 mt-2.5 lg:grid-cols-3 flex-1 min-h-0">

          {/* col 1 */}
          <div className="flex flex-col gap-3 min-h-0">
            <Panel title="สถานะงานใน Pipeline" grow>
              <div className="space-y-2">
                {(ex?.jobs.byStage ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-2.5 text-[10.5px]">
                    <span className="w-[78px] shrink-0 truncate" style={{ color: SUB }}>{s.id}. {s.name}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: TRACK }}><div className="h-full rounded-full" style={{ width: `${(s.n / maxStageN) * 100}%`, background: s.id === 6 ? GOOD : ACCENT_2 }} /></div>
                    <span className="w-6 shrink-0 text-right font-semibold" style={{ color: INK, ...NUM }}>{s.n}</span>
                  </div>
                ))}
              </div>
              {stuckN > 0 && (
                <div className="mt-3 rounded-xl px-3 py-2" style={{ background: tint(BAD) }}>
                  <div className="text-[10.5px] font-bold mb-1.5" style={{ color: BAD }}>คอขวด · {stuckN} งานค้างเกิน 30 วัน</div>
                  {ex!.pipeline.stuck.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-[10px] mb-1">
                      <span className="shrink-0" style={{ color: MUT }}>{s.stage}. {s.stageName}</span>
                      <span className="font-medium truncate" style={{ color: SUB }}>{s.customer}</span>
                      <span className="ml-auto font-bold" style={{ color: BAD, ...NUM }}>{s.days} วัน</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Lead time · รับออเดอร์ ถึง ปิดงาน">
              {ex?.leadTime && ex.leadTime.n > 0 ? (
                <div className="grid grid-cols-3 text-center">
                  <div style={{ borderRight: `1px solid ${HAIR}` }}><div className="text-[25px] font-extrabold" style={{ color: leadHit ? GOOD : BAD, ...NUM }}>{ex.leadTime.medianDays}</div><div className="text-[9.5px] mt-0.5" style={{ color: MUT }}>มัธยฐาน</div></div>
                  <div style={{ borderRight: `1px solid ${HAIR}` }}><div className="text-[25px] font-extrabold" style={{ color: SUB, ...NUM }}>{ex.leadTime.avgDays}</div><div className="text-[9.5px] mt-0.5" style={{ color: MUT }}>เฉลี่ย</div></div>
                  <div><div className="text-[25px] font-extrabold" style={{ color: WARN, ...NUM }}>{ex.leadTime.p90Days}</div><div className="text-[9.5px] mt-0.5" style={{ color: MUT }}>ช้าสุด 10%</div></div>
                </div>
              ) : <p className="text-xs" style={{ color: MUT }}>ไม่มีข้อมูลวันปิดงาน</p>}
              <div className="text-[9.5px] mt-2.5" style={{ color: MUT }}>หน่วยเป็นวัน · จาก {ex?.leadTime?.n ?? 0}/{j?.total ?? 0} งาน · ยิ่งน้อยยิ่งดี</div>
            </Panel>
          </div>

          {/* col 2 */}
          <div className="flex flex-col gap-3 min-h-0">
            <Panel title="งานเข้าใหม่รายเดือน">
              {bm.length ? <VBars bars={bm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxMonthN} color={ACCENT} area={62} /> : <p className="text-xs" style={{ color: MUT }}>ไม่มีข้อมูล</p>}
              <div className="text-[9.5px] mt-3 pt-2.5" style={{ color: MUT, borderTop: `1px solid ${HAIR}` }}>งานปิดจบต่อเดือน — {cbm.length ? cbm.map((r) => `${monthLabel(r.month)} ${r.n}`).join("  ·  ") : "—"}</div>
            </Panel>
            <Panel title="ช่องทางที่มา">
              {channelSegs.length ? <Donut segments={channelSegs} /> : <p className="text-xs" style={{ color: MUT }}>ไม่มีข้อมูล</p>}
            </Panel>
            <Panel title="แนวโน้ม CSAT รายเดือน" grow>
              <div className="text-[9.5px] mb-1" style={{ color: MUT }}>คะแนนเฉลี่ยต่อเดือน · เส้นประคือเป้า {TARGET_CSAT}</div>
              {csatMonthly.length ? <LineChart points={csatMonthly.map((c) => ({ label: monthLabel(c.month), value: c.avg }))} max={5} target={TARGET_CSAT} /> : <p className="text-[10px]" style={{ color: MUT }}>ไม่มีข้อมูล</p>}
            </Panel>
          </div>

          {/* col 3 */}
          <div className="flex flex-col gap-3 min-h-0">
            <Panel title="ความพึงพอใจรายด้าน">
              <div className="space-y-1.5">
                {DIMS.map((d, i) => (
                  <div key={d} className="flex items-center gap-2.5 text-[10.5px]">
                    <span className="w-16 shrink-0" style={{ color: SUB }}>{d}</span>
                    <div className="relative flex-1 h-2 rounded-full overflow-hidden" style={{ background: TRACK }}>
                      <div className="h-full rounded-full" style={{ width: `${(dimAvg[i] / 5) * 100}%`, background: avgColor(dimAvg[i]) }} />
                      <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${(TARGET_CSAT / 5) * 100}%`, background: FAINT }} />
                    </div>
                    <span className="w-7 shrink-0 text-right font-semibold" style={{ color: INK, ...NUM }}>{dimAvg[i].toFixed(2)}</span>
                    <span className="w-3 shrink-0 text-right text-[9px] font-semibold" style={{ color: dimLow[i] ? BAD : "transparent", ...NUM }}>{dimLow[i] || "0"}</span>
                  </div>
                ))}
              </div>
              <div className="text-[9.5px] mt-2" style={{ color: MUT }}>อ่อนสุด <b style={{ color: SUB }}>{DIMS[worstIdx]}</b> ({dimAvg[worstIdx]?.toFixed(2)}) · เด่นสุด {DIMS[bestIdx]} ({dimAvg[bestIdx]?.toFixed(2)})</div>
            </Panel>

            <Panel title="ต้นทุนเศษ">
              {ws && ws.count > 0 ? (
                <>
                  <div className="flex justify-between items-baseline text-[10.5px] mb-2"><span style={{ color: SUB, ...NUM }}>{ws.count} งาน · เฉลี่ย {ws.avgPct}% · กลาง {ws.medianPct}%</span><span className="font-bold" style={{ color: ex?.waste.costSetup ? BAD : MUT, ...NUM }}>{ex?.waste.costSetup ? baht(ex.waste.totalWasteCost) : "ยังไม่ตั้งราคา"}</span></div>
                  <div className="flex h-2 rounded-full overflow-hidden" style={{ background: TRACK }}>
                    {ws.normal > 0 && <div style={{ width: `${(ws.normal / wsTotal) * 100}%`, background: GOOD }} />}
                    {ws.heavy > 0 && <div style={{ width: `${(ws.heavy / wsTotal) * 100}%`, background: WARN }} />}
                    {ws.abnormal > 0 && <div style={{ width: `${(ws.abnormal / wsTotal) * 100}%`, background: BAD }} />}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[9.5px]">
                    <Legend color={GOOD} label={`ปกติ ≤20% (${ws.normal})`} />
                    <Legend color={WARN} label={`เปลือง 20-50% (${ws.heavy})`} />
                    <Legend color={BAD} label={`ผิดปกติ >50% (${ws.abnormal})`} />
                  </div>
                </>
              ) : <p className="text-xs" style={{ color: MUT }}>ยังไม่มีข้อมูล %เศษ</p>}
            </Panel>

            <Panel title="ต้องดูวันนี้" grow>
              {flagCount === 0 ? <p className="text-xs" style={{ color: MUT }}>ไม่มีรายการเร่งด่วน</p> : (
                <div className="space-y-1.5">
                  {(ex?.overdueList ?? []).slice(0, 2).map((o, i) => (
                    <div key={`o${i}`} className="flex items-center gap-2 text-[10.5px]"><span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: BAD, background: tint(BAD) }}>เกินกำหนด</span><span className="font-medium truncate" style={{ color: INK }}>{o.customer}</span><span className="ml-auto" style={{ color: MUT, ...NUM }}>นัด {o.due}</span></div>
                  ))}
                  {lowList.slice(0, 4).map((r, i) => (
                    <div key={`c${i}`} className="flex items-center gap-2 text-[10.5px]"><span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: WARN, background: tint(WARN) }}>คะแนนต่ำ</span><span className="font-medium shrink-0" style={{ color: INK }}>{r.customer || "-"}</span><span className="truncate" style={{ color: MUT }}>{r.comment}</span>{r.overall !== null && <span className="ml-auto font-bold shrink-0" style={{ color: avgColor(r.overall), ...NUM }}>{r.overall.toFixed(1)}</span>}</div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>

        {/* Monthly management summary: waste cost and customer satisfaction in one comparable view. */}
        <section className="exec-card mt-3 rounded-2xl bg-white p-4" style={{ boxShadow: SHADOW }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 h-4 w-1 rounded-full" style={{ background: ACCENT }} />
              <div>
                <h2 className="text-sm font-bold" style={{ color: INK }}>ต้นทุนเศษและความพึงพอใจรายเดือน</h2>
                <p className="text-[11px]" style={{ color: MUT }}>สรุป 6 เดือนล่าสุด · ต้นทุนเศษ = ต้นทุนใช้จริง − ต้นทุนตามพื้นที่</p>
              </div>
            </div>
            <div className="flex gap-2 no-print">
              <Link href="/waste-cost" className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold" style={{ borderColor: HAIR, color: SUB }}>ดูต้นทุนเศษ</Link>
              <Link href="/dashboard" className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold" style={{ borderColor: HAIR, color: SUB }}>ดู Dashboard</Link>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl px-3 py-2.5" style={{ background: "#f8fafc" }}><div className="text-[9.5px]" style={{ color: MUT }}>เดือนล่าสุด</div><div className="mt-1 text-sm font-bold" style={{ color: INK }}>{monthLabel(latestMonthly.month)}</div></div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: tint(BAD) }}><div className="text-[9.5px]" style={{ color: MUT }}>ต้นทุนเศษ</div><div className="mt-1 text-sm font-extrabold" style={{ color: ex?.waste.costSetup ? (latestMonthly.wasteCost > 0 ? BAD : GOOD) : MUT, ...NUM }}>{ex?.waste.costSetup ? baht(latestMonthly.wasteCost) : "ยังไม่ตั้งราคา"}</div></div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(79,70,229,0.06)" }}><div className="text-[9.5px]" style={{ color: MUT }}>CSAT เฉลี่ย</div><div className="mt-1 text-sm font-extrabold" style={{ color: latestMonthly.csat === null ? MUT : avgColor(latestMonthly.csat), ...NUM }}>{latestMonthly.csat === null ? "—" : `${latestMonthly.csat.toFixed(2)}/5`}</div></div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: "#f8fafc" }}><div className="text-[9.5px]" style={{ color: MUT }}>ข้อมูลเดือนนี้</div><div className="mt-1 text-sm font-bold" style={{ color: INK, ...NUM }}>{latestMonthly.wasteJobs} งาน · {latestMonthly.responses} แบบประเมิน</div></div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: HAIR }}>
            <table className="w-full min-w-[680px] border-collapse text-left text-[11px]">
              <thead style={{ background: "#f8fafc", color: MUT }}>
                <tr><th className="px-3 py-2 font-semibold">เดือน</th><th className="px-3 py-2 text-right font-semibold">งานมีข้อมูลเศษ</th><th className="px-3 py-2 text-right font-semibold">ต้นทุนเศษ</th><th className="px-3 py-2 text-right font-semibold">เศษเฉลี่ย</th><th className="px-3 py-2 text-right font-semibold">CSAT เฉลี่ย</th><th className="px-3 py-2 text-right font-semibold">แบบประเมิน</th></tr>
              </thead>
              <tbody>
                {monthlySummary.map((row) => (
                  <tr key={row.month} style={{ borderTop: `1px solid ${HAIR}` }}>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: INK }}>{monthLabel(row.month)}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: SUB, ...NUM }}>{row.wasteJobs}</td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: !ex?.waste.costSetup ? MUT : row.wasteCost > 0 ? BAD : GOOD, ...NUM }}>{ex?.waste.costSetup ? baht(row.wasteCost) : "รอตั้งราคา"}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: row.wastePct === null ? MUT : wasteColor(row.wastePct), ...NUM }}>{row.wastePct === null ? "—" : `${row.wastePct.toFixed(1)}%`}</td>
                    <td className="px-3 py-2.5 text-right font-bold" style={{ color: row.csat === null ? MUT : avgColor(row.csat), ...NUM }}>{row.csat === null ? "—" : row.csat.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: SUB, ...NUM }}>{row.responses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Full-width operational pipeline: one executive view, with direct entry to the team that owns each state. */}
        <section className="exec-card mt-3 rounded-2xl bg-white p-4" style={{ boxShadow: SHADOW }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-full" style={{ background: ACCENT }} />
              <div>
                <h2 className="text-sm font-bold" style={{ color: INK }}>Pipeline สถานะงานติดตั้ง</h2>
                <p className="text-[11px]" style={{ color: MUT }}>นับจากใบสั่งงานกลางจริง · กดแต่ละสถานะเพื่อไปทำงานต่อ</p>
              </div>
            </div>
            <span className="text-xs font-medium" style={{ color: SUB, ...NUM }}>งานในระบบ {workOrders.reduce((sum, row) => sum + row.n, 0)} งาน</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {WORK_ORDER_PIPELINE.map((stage, index) => {
              const row = workOrderByStatus.get(stage.status) ?? { n: 0, avgDays: 0, maxDays: 0 };
              const isClosed = stage.status === "closed";
              return (
                <Link key={stage.status} href={stage.href} className="group rounded-xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: HAIR, background: index % 2 ? "#fbfcfe" : "#fff" }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-bold" style={{ color: stage.color }}>{index + 1}. {stage.short}</span>
                    <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ color: stage.color, background: tint(stage.color), ...NUM }}>{row.n}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: TRACK }}><div className="h-full rounded-full" style={{ width: `${(row.n / maxWorkOrderN) * 100}%`, background: stage.color }} /></div>
                  <p className="mt-2 min-h-8 text-[10px] leading-4" style={{ color: SUB }}>{stage.label}</p>
                  {!isClosed && row.n > 0 ? <p className="text-[10px]" style={{ color: row.maxDays > 2 ? WARN : MUT, ...NUM }}>เฉลี่ย {row.avgDays} วัน · นานสุด {row.maxDays} วัน</p> : <p className="text-[10px]" style={{ color: MUT }}>{isClosed ? "งานจบแล้ว" : "ไม่มีงานค้าง"}</p>}
                </Link>
              );
            })}
          </div>
        </section>

        {/* footer */}
        <div className="text-[9.5px] mt-2.5 shrink-0 flex flex-wrap gap-x-4 px-1" style={{ color: MUT, ...NUM }}>
          <span>ความครบข้อมูล — Lead time {ex?.leadTime?.n ?? 0}/{j?.total ?? 0}</span>
          <span>ปิดงาน {ex?.waste.withData ?? 0}/{j?.total ?? 0} ({closingPct}%)</span>
          <span>โซน {ex?.waste.withZones ?? 0}/{j?.total ?? 0}</span>
          <span>ประเมินแล้ว {evaluated}/{j?.done ?? 0} ({evalCoverage}%)</span>
          <span>CSAT {responses.length} รายการ</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- components ---------- */
function Micro({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  let d = null;
  if (delta !== undefined && delta !== null && Math.round(delta) !== 0) { const up = delta > 0; d = <span className="font-bold" style={{ color: up ? GOOD : BAD, ...NUM }}>{up ? "▲" : "▼"}{Math.abs(Math.round(delta))}%</span>; }
  return <span className="flex items-center gap-1.5"><span>{label}</span><b style={{ color: SUB, ...NUM }}>{value}</b>{d}</span>;
}
function Panel({ title, grow, children }: { title: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div className={`exec-card bg-white rounded-2xl px-4 py-3.5 ${grow ? "flex-1 min-h-0 overflow-hidden" : ""} flex flex-col`} style={{ boxShadow: SHADOW }}>
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className="w-1 h-3.5 rounded-full" style={{ background: ACCENT }} />
        <h2 className="text-[10.5px] font-bold uppercase" style={{ color: SUB, letterSpacing: "0.05em" }}>{title}</h2>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5" style={{ color: SUB, ...NUM }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{label}</span>; }

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------- types ---------- */
type StageN = { id: number; name: string; n: number };
type NamedJob = { customer: string; product: string; due: string; stage: number };
type WasteTop = { customer: string; bill: string | null; zoneM2: number; actM2: number | null; pct: number | null };
type WasteStats = { count: number; avgPct: number | null; medianPct: number | null; normal: number; heavy: number; abnormal: number };
type Exec = {
  jobs: { total: number; byStage: StageN[]; bySource: Record<string, number>; byMonth: { month: string; n: number }[]; completedByMonth: { month: string; n: number }[]; done: number; active: number; overdue: number; evaluated: number };
  leadTime: { n: number; avgDays: number | null; medianDays: number | null; p90Days: number | null };
  pipeline: { aging: { id: number; name: string; n: number; avgDays: number; maxDays: number }[]; stuck: { customer: string; product: string; stage: number; stageName: string; days: number }[] };
  upcoming: NamedJob[];
  overdueList: NamedJob[];
  waste: { withZones: number; withData: number; costSetup: boolean; totalWasteCost: number; top: WasteTop[]; stats: WasteStats };
  updatedAt: string;
};
type SResp = { timestamp: string; scores: (number | null)[]; overall: number | null; customer: string; comment: string; bill: string };
type Survey = { responses: SResp[] };

/* ---------- palette (dataviz reference) ---------- */
const C = {
  blue: "#2a78d6", aqua: "#1baf7a", violet: "#4a3aa7", orange: "#eb6834", magenta: "#e87ba4", yellow: "#eda100",
  ink: "#0b0b0b", sub: "#52514e", muted: "#898781", line: "#e1e0d9",
  good: "#0ca30c", warn: "#fab219", serious: "#ec835a", crit: "#d03b3b",
};
/* status skin: text / tint bg / border — reserved for good/watch/bad states */
const ST = {
  good: { fg: "#0b7a0b", bg: "rgba(12,163,12,0.10)", bd: "rgba(12,163,12,0.38)" },
  warn: { fg: "#8a5d00", bg: "rgba(250,178,25,0.16)", bd: "rgba(230,150,0,0.48)" },
  bad: { fg: "#b3312f", bg: "rgba(208,59,59,0.10)", bd: "rgba(208,59,59,0.42)" },
  neutral: { fg: "#334155", bg: "rgba(100,116,139,0.08)", bd: "rgba(100,116,139,0.28)" },
} as const;
type Status = keyof typeof ST;

const DIMS = ["บริการ", "คุณภาพงาน", "ความเรียบร้อย", "ตรงเวลา", "ความสุภาพ"];
const SOURCE_LABEL: Record<string, string> = { sales_txn: "ระบบขาย", manual: "สร้างเอง", shopee: "Shopee", lazada: "Lazada", tiktok: "TikTok", web: "เว็บ" };
const SOURCE_COLOR: Record<string, string> = { sales_txn: C.blue, manual: C.yellow, shopee: C.orange, lazada: C.violet, tiktok: C.crit, web: C.aqua };
const TARGET_CSAT = 4.5, TARGET_SATISFIED = 90, TARGET_DONE = 80;
const TARGET_LEAD_DAYS = 60; // เป้า: รับออเดอร์ -> ปิดงาน ภายในกี่วัน (ปรับได้)

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
function avgColor(v: number): string { if (v >= 4.5) return C.good; if (v >= 4) return C.blue; if (v >= 3) return C.warn; return C.crit; }
function wasteColor(pct: number): string { return pct > 50 ? C.crit : pct > 20 ? C.warn : C.good; }
function pctDelta(cur: number, prev: number | null): number | null { if (prev === null || prev === 0) return null; return ((cur - prev) / prev) * 100; }
function isoMonth(ts: string): string | null { const d = new Date(ts); if (isNaN(d.getTime())) return null; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

/* ---------- SVG charts ---------- */
function LineChart({ points, max = 5, target }: { points: { label: string; value: number }[]; max?: number; target?: number }) {
  const W = 340, H = 116, padL = 6, padR = 6, padT = 14, padB = 18;
  const n = points.length, iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => (n <= 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (Math.max(0, Math.min(max, v)) / max) * ih;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 112 }}>
      {[0, 0.5, 1].map((g) => <line key={g} x1={padL} x2={W - padR} y1={padT + ih * g} y2={padT + ih * g} stroke={C.line} strokeWidth="1" />)}
      {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={C.muted} strokeWidth="1" strokeDasharray="3 3" />}
      {area && <path d={area} fill={C.blue} opacity="0.10" />}
      <path d={line} fill="none" stroke={C.blue} strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3.2" fill={avgColor(p.value)} />
          <text x={x(i)} y={y(p.value) - 5} textAnchor="middle" fontSize="9" fontWeight="700" fill={avgColor(p.value)}>{p.value.toFixed(2)}</text>
          <text x={x(i)} y={H - 5} textAnchor="middle" fontSize="8" fill={C.muted}>{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 40, cx = 52, cy = 52, sw = 15, Ci = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 104 104" width="86" height="86" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth={sw} />
        {segments.map((s, i) => { const len = (s.value / total) * Ci; const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${len} ${Ci - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />; acc += len; return el; })}
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize="20" fontWeight="800" fill={C.ink}>{total}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="8" fill={C.muted}>งาน</text>
      </svg>
      <div className="space-y-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span style={{ color: C.sub }}>{s.label}</span>
            <strong style={{ color: C.ink }}>{s.value}</strong>
            <span style={{ color: C.muted }}>({Math.round((s.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function VBars({ bars, max, color = C.blue }: { bars: { label: string; value: number }[]; max: number; color?: string }) {
  return (
    <div className="flex items-end gap-1.5 h-[70px]">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
          <span className="text-[9px] font-bold" style={{ color: C.sub }}>{b.value}</span>
          <div className="w-full rounded-t-[3px]" style={{ height: `${(b.value / max) * 100}%`, minHeight: 2, background: color }} />
          <span className="text-[8px]" style={{ color: C.muted }}>{b.label}</span>
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/exec-overview", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/satisfaction-survey", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setEx(a); setSv(b);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // fit the 1280x720 (16:9) board to the available area
  const wrapRef = useRef<HTMLDivElement>(null);
  const [boxfit, setBoxfit] = useState({ s: 1, left: 0 });
  useEffect(() => {
    function fit() {
      const el = wrapRef.current; if (!el) return;
      const availW = el.clientWidth;
      const availH = window.innerHeight - el.getBoundingClientRect().top - 16;
      const s = Math.min(availW / 1280, availH / 720);
      const use = s > 0 && isFinite(s) ? s : 1;
      setBoxfit({ s: use, left: Math.max(0, (availW - 1280 * use) / 2) });
    }
    fit();
    const t = setTimeout(fit, 120);
    window.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); clearTimeout(t); };
  }, [loading, ex, sv]);

  const responses = useMemo(() => sv?.responses ?? [], [sv]);
  const allScores = useMemo(() => responses.flatMap((r) => r.scores.filter((x): x is number => x !== null)), [responses]);
  const csatAvg = useMemo(() => (allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0), [allScores]);
  const satisfied = useMemo(() => (allScores.length ? Math.round((allScores.filter((s) => s >= 4).length / allScores.length) * 100) : 0), [allScores]);
  const dimAvg = useMemo(() => DIMS.map((_, i) => { const v = responses.map((r) => r.scores[i]).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }), [responses]);
  const dimLow = useMemo(() => DIMS.map((_, i) => responses.filter((r) => { const s = r.scores[i]; return s !== null && s <= 3; }).length), [responses]);
  const lowList = useMemo(() => responses.filter((r) => r.scores.some((s) => s !== null && s <= 2) || (r.overall !== null && r.overall < 3)), [responses]);
  const csatMonthly = useMemo(() => {
    const agg: Record<string, { sum: number; n: number }> = {};
    responses.forEach((r) => { const m = isoMonth(r.timestamp); if (!m) return; r.scores.forEach((s) => { if (s !== null) { agg[m] = agg[m] ?? { sum: 0, n: 0 }; agg[m].sum += s; agg[m].n++; } }); });
    return Object.keys(agg).sort().map((m) => ({ month: m, avg: agg[m].sum / agg[m].n, n: agg[m].n }));
  }, [responses]);
  const themeDetail = useMemo(() => {
    const real = responses.filter((r) => r.comment && r.comment !== "-" && r.comment !== "ไม่มี" && r.comment.length > 2);
    const out: { key: string; n: number; example: string; who: string }[] = [];
    for (const t of THEMES) {
      const matches = real.filter((r) => t.re.test(r.comment));
      if (!matches.length) continue;
      const worst = [...matches].sort((a, b) => (a.overall ?? 5) - (b.overall ?? 5))[0];
      out.push({ key: t.key, n: matches.length, example: worst.comment, who: worst.customer || "-" });
    }
    return out.sort((a, b) => b.n - a.n);
  }, [responses]);

  const maxStageN = useMemo(() => Math.max(1, ...(ex?.jobs.byStage ?? []).map((r) => r.n)), [ex]);
  const cbm = ex?.jobs.completedByMonth ?? [];
  const maxCbm = Math.max(1, ...cbm.map((r) => r.n));
  const evaluated = ex?.jobs.evaluated ?? 0;

  if (loading && !ex) return <div className="py-20 text-center" style={{ color: C.muted }}>⏳ กำลังโหลด...</div>;

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

  const insight = (() => {
    if (!j) return "";
    const parts: string[] = [];
    if (lastJobs) { const d = jobDelta === null ? "" : ` (${jobDelta > 0 ? "▲" : jobDelta < 0 ? "▼" : "→"}${Math.abs(Math.round(jobDelta))}%)`; parts.push(`เดือน${monthLabel(lastJobs.month)} งานเข้า ${lastJobs.n}${d}`); }
    if (responses.length) parts.push(`CSAT ${csatAvg.toFixed(2)}${csatDelta === null ? "" : ` (${csatDelta > 0 ? "▲" : csatDelta < 0 ? "▼" : "→"})`}`);
    parts.push(`งานเสร็จ ${donePct}%`);
    if (leadMed != null) parts.push(`Lead time ${leadMed} วัน`);
    if (flagCount > 0) parts.push(`${flagCount} เคสต้องตาม`);
    if (themeDetail.length) parts.push(`ปัญหาเด่น: ${themeDetail[0].key} (${themeDetail[0].n})`);
    return parts.join("   ·   ");
  })();

  const channelSegs = Object.entries(ex?.jobs.bySource ?? {}).map(([s, n]) => ({ label: SOURCE_LABEL[s] || s, value: n, color: SOURCE_COLOR[s] || C.muted }));

  return (
    <div ref={wrapRef} className="w-full relative" style={{ height: 720 * boxfit.s }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: 1280px 720px; margin: 0; }
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .exec-board, .exec-board * { visibility: visible !important; }
          .exec-board { position: fixed !important; left: 0 !important; top: 0 !important; margin: 0 !important; transform: none !important; box-shadow: none !important; }
          .no-print { display: none !important; }
        }
      ` }} />
      <div className="exec-board absolute top-0 rounded-2xl overflow-hidden flex flex-col"
        style={{ width: 1280, height: 720, transform: `scale(${boxfit.s})`, transformOrigin: "top left", marginLeft: boxfit.left, padding: 16, background: "#eef1f6", boxShadow: "0 10px 40px rgba(15,23,42,0.12)" }}>

        {/* ===== HEADER (mood band) ===== */}
        <div className="rounded-xl px-4 py-2.5 flex items-center gap-3 shrink-0 text-white" style={{ background: "linear-gradient(100deg,#4f46e5,#2563eb 55%,#0ea5e9)" }}>
          <span className="text-2xl">📈</span>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">ภาพรวมผู้บริหาร — งานติดตั้ง MPD</h1>
            <div className="text-[11px] text-white/80">อัปเดต {ex?.updatedAt ? new Date(ex.updatedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "-"}</div>
          </div>
          <div className="ml-auto flex gap-2 no-print">
            <button onClick={load} className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium">🔄 โหลดใหม่</button>
            <button onClick={() => window.print()} className="px-2.5 py-1 rounded-lg bg-white text-blue-700 text-xs font-bold hover:bg-blue-50">🖨️ บันทึกเป็นสไลด์</button>
          </div>
        </div>

        {/* ===== SUMMARY (สรุป) ===== */}
        {insight && (
          <div className="mt-2 rounded-xl px-3.5 py-2 flex items-center gap-2 shrink-0" style={{ background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.20)" }}>
            <span className="text-xs font-extrabold px-2 py-0.5 rounded-md text-white shrink-0" style={{ background: "#4f46e5" }}>สรุปวันนี้</span>
            <span className="text-[13px] font-medium" style={{ color: "#312e81" }}>{insight}</span>
          </div>
        )}

        {/* ===== HERO (จุดสำคัญ) — big, status-colored ===== */}
        <div className="grid grid-cols-5 gap-2.5 mt-2.5 shrink-0">
          <Hero icon="✅" label="งานเสร็จสิ้น" value={`${donePct}`} unit="%" status={donePct >= TARGET_DONE ? "good" : "warn"} chip={donePct >= TARGET_DONE ? `ผ่านเป้า ${TARGET_DONE}% ✓` : `เป้า ${TARGET_DONE}%`} />
          <Hero icon="⭐" label="ความพึงพอใจ CSAT" value={responses.length ? csatAvg.toFixed(2) : "—"} unit="/5" status={csatAvg >= TARGET_CSAT ? "good" : csatAvg >= 4 ? "warn" : "bad"} chip={csatAvg >= TARGET_CSAT ? `ผ่านเป้า ${TARGET_CSAT} ✓` : `เป้า ${TARGET_CSAT}`} delta={csatDelta} />
          <Hero icon="⏱️" label="Lead time (มัธยฐาน)" value={leadMed != null ? `${leadMed}` : "—"} unit="วัน" status={leadHit ? "good" : "bad"} chip={leadHit ? `≤ เป้า ${TARGET_LEAD_DAYS} วัน ✓` : `เกินเป้า ${TARGET_LEAD_DAYS} วัน ✕`} />
          <Hero icon="🐢" label="คอขวด (ค้าง >30 วัน)" value={`${stuckN}`} unit="งาน" status={stuckN === 0 ? "good" : "bad"} chip={stuckN === 0 ? "ไม่มีงานค้าง ✓" : "ต้องเร่งจัดการ"} />
          <Hero icon="🚩" label="เคสต้องติดตาม" value={`${flagCount}`} unit="เคส" status={flagCount === 0 ? "good" : "warn"} chip={flagCount === 0 ? "ไม่มี ✓" : "เกินกำหนด + คะแนนต่ำ"} />
        </div>

        {/* context micro-stats */}
        <div className="flex items-center gap-4 mt-1.5 px-1 shrink-0 text-[11px]" style={{ color: C.muted }}>
          <Micro label="งานเข้าเดือนนี้" value={`${lastJobs?.n ?? 0}`} delta={jobDelta} />
          <Micro label="งานเข้าสะสม" value={`${j?.total ?? 0}`} />
          <Micro label="กำลังดำเนินงาน" value={`${j?.active ?? 0}`} />
          <Micro label="ประเมินแล้ว" value={`${evaluated}/${j?.done ?? 0} (${evalCoverage}%)`} />
          <Micro label="พึงพอใจ 4-5 ดาว" value={`${satisfied}%`} />
        </div>

        {/* ===== DETAIL (รายละเอียด) — 3 columns ===== */}
        <div className="grid grid-cols-3 gap-2.5 mt-2.5 flex-1 min-h-0">

          {/* col 1 */}
          <div className="flex flex-col gap-2.5 min-h-0">
            <Panel title="สถานะงานใน Pipeline" accent={C.violet} grow>
              <div className="space-y-1">
                {(ex?.jobs.byStage ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-[74px] shrink-0 truncate" style={{ color: C.sub }}>{s.id}.{s.name}</span>
                    <div className="flex-1 h-3 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${(s.n / maxStageN) * 100}%`, background: s.id === 7 ? C.good : C.violet }} /></div>
                    <span className="w-6 shrink-0 text-right font-bold" style={{ color: C.ink }}>{s.n}</span>
                  </div>
                ))}
              </div>
              {stuckN > 0 && (
                <div className="mt-2 rounded-lg p-1.5" style={{ background: ST.bad.bg, border: `1px solid ${ST.bad.bd}` }}>
                  <div className="text-[10px] font-bold mb-1" style={{ color: ST.bad.fg }}>🐢 คอขวด {stuckN} งานค้าง &gt;30 วัน — ต้องเร่ง</div>
                  {ex!.pipeline.stuck.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: "rgba(208,59,59,0.14)", color: ST.bad.fg }}>{s.stage}.{s.stageName}</span>
                      <span className="font-medium truncate" style={{ color: C.ink }}>{s.customer}</span>
                      <span className="ml-auto font-extrabold" style={{ color: ST.bad.fg }}>{s.days} วัน</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="⏱️ รายละเอียด Lead time" accent={C.blue}>
              {ex?.leadTime && ex.leadTime.n > 0 ? (
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div><div className="text-xl font-extrabold" style={{ color: leadHit ? C.good : C.crit }}>{ex.leadTime.medianDays}</div><div className="text-[9px]" style={{ color: C.muted }}>มัธยฐาน</div></div>
                  <div><div className="text-xl font-extrabold" style={{ color: C.sub }}>{ex.leadTime.avgDays}</div><div className="text-[9px]" style={{ color: C.muted }}>เฉลี่ย</div></div>
                  <div><div className="text-xl font-extrabold" style={{ color: C.serious }}>{ex.leadTime.p90Days}</div><div className="text-[9px]" style={{ color: C.muted }}>ช้าสุด 10%</div></div>
                </div>
              ) : <p className="text-xs" style={{ color: C.muted }}>ไม่มีข้อมูลวันปิดงาน</p>}
              <div className="text-[9px] mt-1.5" style={{ color: C.muted }}>นับจากรับออเดอร์ถึงปิดงาน · จาก {ex?.leadTime?.n ?? 0}/{j?.total ?? 0} งาน · ยิ่งน้อยยิ่งดี</div>
            </Panel>
          </div>

          {/* col 2 */}
          <div className="flex flex-col gap-2.5 min-h-0">
            <Panel title="งานเข้า / เสร็จ รายเดือน" accent={C.blue}>
              {bm.length ? <VBars bars={bm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxMonthN} color={C.blue} /> : <p className="text-xs" style={{ color: C.muted }}>ไม่มีข้อมูล</p>}
              <div className="text-[9px] mt-1" style={{ color: C.muted }}>งานเสร็จรายเดือน (completed_date)</div>
              {cbm.length ? <VBars bars={cbm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxCbm} color={C.aqua} /> : <p className="text-[10px]" style={{ color: C.muted }}>ยังไม่มีวันเสร็จงาน</p>}
            </Panel>
            <Panel title="ช่องทางที่มา + แนวโน้ม CSAT" accent={C.orange} grow>
              {channelSegs.length ? <Donut segments={channelSegs} /> : <p className="text-xs" style={{ color: C.muted }}>ไม่มีข้อมูล</p>}
              <div className="text-[9px] mt-1.5" style={{ color: C.muted }}>แนวโน้ม CSAT (เส้นประ = เป้า {TARGET_CSAT})</div>
              {csatMonthly.length ? <LineChart points={csatMonthly.map((c) => ({ label: monthLabel(c.month), value: c.avg }))} max={5} target={TARGET_CSAT} /> : <p className="text-[10px]" style={{ color: C.muted }}>ไม่มีข้อมูล</p>}
            </Panel>
          </div>

          {/* col 3 */}
          <div className="flex flex-col gap-2.5 min-h-0">
            <Panel title="⭐ ความพึงพอใจรายด้าน" accent={C.good}>
              <div className="space-y-0.5">
                {DIMS.map((d, i) => (
                  <div key={d} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-16 shrink-0" style={{ color: C.sub }}>{d}</span>
                    <div className="relative flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(dimAvg[i] / 5) * 100}%`, background: avgColor(dimAvg[i]) }} />
                      <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${(TARGET_CSAT / 5) * 100}%`, background: C.muted }} />
                    </div>
                    <span className="w-7 shrink-0 text-right font-bold" style={{ color: avgColor(dimAvg[i]) }}>{dimAvg[i].toFixed(2)}</span>
                    <span className="w-5 shrink-0 text-right text-[9px]" style={{ color: dimLow[i] ? C.crit : "#cbd5e1" }}>{dimLow[i] || "-"}</span>
                  </div>
                ))}
              </div>
              <div className="text-[9px] mt-1" style={{ color: C.muted }}>อ่อนสุด: <b style={{ color: C.crit }}>{DIMS[worstIdx]}</b> ({dimAvg[worstIdx]?.toFixed(2)}) · เด่นสุด: {DIMS[bestIdx]} ({dimAvg[bestIdx]?.toFixed(2)})</div>
            </Panel>

            <Panel title="♻️ ต้นทุนเศษ" accent={C.warn}>
              {ws && ws.count > 0 ? (
                <>
                  <div className="flex justify-between text-[10px] mb-1"><span style={{ color: C.sub }}>{ws.count} งาน · เฉลี่ย {ws.avgPct}% · กลาง {ws.medianPct}%</span><span className="font-extrabold" style={{ color: ex?.waste.costSetup ? C.crit : C.muted }}>{ex?.waste.costSetup ? baht(ex.waste.totalWasteCost) : "ยังไม่ตั้งราคา"}</span></div>
                  <div className="flex h-3 rounded overflow-hidden" style={{ background: "#eef1f6" }}>
                    {ws.normal > 0 && <div style={{ width: `${(ws.normal / wsTotal) * 100}%`, background: C.good }} />}
                    {ws.heavy > 0 && <div style={{ width: `${(ws.heavy / wsTotal) * 100}%`, background: C.warn }} />}
                    {ws.abnormal > 0 && <div style={{ width: `${(ws.abnormal / wsTotal) * 100}%`, background: C.crit }} />}
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[9px]">
                    <Legend color={C.good} label={`ปกติ ≤20% (${ws.normal})`} />
                    <Legend color={C.warn} label={`เปลือง 20-50% (${ws.heavy})`} />
                    <Legend color={C.crit} label={`ผิดปกติ >50% (${ws.abnormal})`} />
                  </div>
                </>
              ) : <p className="text-xs" style={{ color: C.muted }}>ยังไม่มีข้อมูล %เศษ</p>}
            </Panel>

            <Panel title="🚨 ต้องดูวันนี้" accent={C.crit} grow>
              {flagCount === 0 ? <p className="text-xs" style={{ color: C.muted }}>ไม่มีรายการเร่งด่วน ✅</p> : (
                <div className="space-y-1">
                  {(ex?.overdueList ?? []).slice(0, 2).map((o, i) => (
                    <div key={`o${i}`} className="flex items-center gap-1.5 text-[10px]"><span className="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: ST.bad.bg, color: ST.bad.fg }}>เกินกำหนด</span><span className="font-medium truncate" style={{ color: C.ink }}>{o.customer}</span><span className="ml-auto" style={{ color: C.muted }}>นัด {o.due}</span></div>
                  ))}
                  {lowList.slice(0, 4).map((r, i) => (
                    <div key={`c${i}`} className="flex items-center gap-1.5 text-[10px]"><span className="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: ST.warn.bg, color: ST.warn.fg }}>คะแนนต่ำ</span><span className="font-medium shrink-0" style={{ color: C.ink }}>{r.customer || "-"}</span><span className="truncate" style={{ color: C.muted }}>{r.comment}</span>{r.overall !== null && <span className="ml-auto font-extrabold shrink-0" style={{ color: avgColor(r.overall) }}>{r.overall.toFixed(1)}</span>}</div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>

        {/* footer */}
        <div className="text-[9px] mt-2 shrink-0 flex flex-wrap gap-x-3" style={{ color: C.muted }}>
          <span>ความครบข้อมูล — Lead time {ex?.leadTime?.n ?? 0}/{j?.total ?? 0}</span>
          <span>· ปิดงาน {ex?.waste.withData ?? 0}/{j?.total ?? 0} ({closingPct}%)</span>
          <span>· โซน {ex?.waste.withZones ?? 0}/{j?.total ?? 0}</span>
          <span>· ประเมินแล้ว {evaluated}/{j?.done ?? 0} ({evalCoverage}%)</span>
          <span>· CSAT {responses.length} รายการ</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- components ---------- */
function Hero({ icon, label, value, unit, chip, status, delta }: { icon: string; label: string; value: string; unit?: string; chip?: string; status: Status; delta?: number | null }) {
  const s = ST[status];
  let d = null;
  if (delta !== undefined && delta !== null && Math.round(delta) !== 0) { const up = delta > 0; d = <span className="text-[10px] font-bold" style={{ color: up ? C.good : C.crit }}>{up ? "▲" : "▼"}{Math.abs(Math.round(delta))}%</span>; }
  return (
    <div className="rounded-xl px-3 py-2 border flex flex-col justify-between" style={{ background: s.bg, borderColor: s.bd, minHeight: 88 }}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold" style={{ color: C.sub }}>{icon} {label}</span>
        {d}
      </div>
      <div className="leading-none mt-0.5">
        <span className="text-[34px] font-extrabold tracking-tight" style={{ color: s.fg }}>{value}</span>
        {unit && <span className="text-base font-bold ml-1" style={{ color: s.fg }}>{unit}</span>}
      </div>
      {chip && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md self-start mt-0.5" style={{ color: s.fg, background: "rgba(255,255,255,0.65)" }}>{chip}</span>}
    </div>
  );
}
function Micro({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  let d = null;
  if (delta !== undefined && delta !== null && Math.round(delta) !== 0) { const up = delta > 0; d = <span className="font-bold" style={{ color: up ? C.good : C.crit }}>{up ? "▲" : "▼"}{Math.abs(Math.round(delta))}%</span>; }
  return <span className="flex items-center gap-1"><span>{label}</span><b style={{ color: C.sub }}>{value}</b>{d}</span>;
}
function Panel({ title, accent, grow, children }: { title: string; accent: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-xl p-2.5 shadow-sm ${grow ? "flex-1 min-h-0 overflow-hidden" : ""} flex flex-col`} style={{ borderTop: `3px solid ${accent}` }}>
      <h2 className="text-[12px] font-bold mb-1.5 shrink-0" style={{ color: C.ink }}>{title}</h2>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1" style={{ color: C.sub }}><span className="w-2 h-2 rounded-sm" style={{ background: color }} />{label}</span>; }

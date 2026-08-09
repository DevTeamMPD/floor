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

/* ---------- palette ---------- */
const C = { blue: "#2563EB", green: "#15935E", amber: "#C2820E", orange: "#E8833A", red: "#C0392B", purple: "#7C3AED", slate: "#64748B", line: "#E2E8F0" };
const DIMS = ["บริการ", "คุณภาพงาน", "ความเรียบร้อย", "ตรงเวลา", "ความสุภาพ"];
const SOURCE_LABEL: Record<string, string> = { sales_txn: "ระบบขาย", manual: "สร้างเอง", shopee: "Shopee", lazada: "Lazada", tiktok: "TikTok", web: "เว็บ" };
const SOURCE_COLOR: Record<string, string> = { sales_txn: C.blue, manual: C.amber, shopee: C.orange, lazada: C.purple, tiktok: C.red, web: C.green };
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
function avgColor(v: number): string { if (v >= 4.5) return C.green; if (v >= 4) return C.blue; if (v >= 3) return C.amber; return C.red; }
function wasteColor(pct: number): string { return pct > 50 ? C.red : pct > 20 ? C.amber : C.green; }
function pctDelta(cur: number, prev: number | null): number | null { if (prev === null || prev === 0) return null; return ((cur - prev) / prev) * 100; }
function isoMonth(ts: string): string | null { const d = new Date(ts); if (isNaN(d.getTime())) return null; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

/* ---------- SVG charts ---------- */
function LineChart({ points, max = 5, target }: { points: { label: string; value: number }[]; max?: number; target?: number }) {
  const W = 340, H = 120, padL = 6, padR = 6, padT = 14, padB = 18;
  const n = points.length, iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => (n <= 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (Math.max(0, Math.min(max, v)) / max) * ih;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 118 }}>
      {[0, 0.5, 1].map((g) => <line key={g} x1={padL} x2={W - padR} y1={padT + ih * g} y2={padT + ih * g} stroke={C.line} strokeWidth="1" />)}
      {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={C.slate} strokeWidth="1" strokeDasharray="3 3" />}
      {area && <path d={area} fill={C.blue} opacity="0.08" />}
      <path d={line} fill="none" stroke={C.blue} strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill={avgColor(p.value)} />
          <text x={x(i)} y={y(p.value) - 5} textAnchor="middle" fontSize="9" fontWeight="700" fill={avgColor(p.value)}>{p.value.toFixed(2)}</text>
          <text x={x(i)} y={H - 5} textAnchor="middle" fontSize="8" fill={C.slate}>{p.label}</text>
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
      <svg viewBox="0 0 104 104" width="88" height="88" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth={sw} />
        {segments.map((s, i) => { const len = (s.value / total) * Ci; const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${len} ${Ci - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${cx} ${cy})`} />; acc += len; return el; })}
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize="20" fontWeight="800" fill="#0F172A">{total}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="8" fill={C.slate}>งาน</text>
      </svg>
      <div className="space-y-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-600">{s.label}</span>
            <strong className="text-slate-800">{s.value}</strong>
            <span className="text-slate-400">({Math.round((s.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function VBars({ bars, max }: { bars: { label: string; value: number }[]; max: number }) {
  return (
    <div className="flex items-end gap-1.5 h-20">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
          <span className="text-[9px] font-bold text-slate-700">{b.value}</span>
          <div className="w-full rounded-t" style={{ height: `${(b.value / max) * 100}%`, minHeight: 2, background: C.blue }} />
          <span className="text-[8px] text-slate-400">{b.label}</span>
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

  // ---- fit the 1280x720 (16:9) board to the available area ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ s: 1, left: 0 });
  useEffect(() => {
    function fit() {
      const el = wrapRef.current; if (!el) return;
      const availW = el.clientWidth;
      const availH = window.innerHeight - el.getBoundingClientRect().top - 16;
      const s = Math.min(availW / 1280, availH / 720);
      const use = s > 0 && isFinite(s) ? s : 1;
      setBox({ s: use, left: Math.max(0, (availW - 1280 * use) / 2) });
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

  if (loading && !ex) return <div className="text-slate-400 py-20 text-center">⏳ กำลังโหลด...</div>;

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
  const leadHit = (ex?.leadTime?.medianDays ?? 0) <= TARGET_LEAD_DAYS;
  const evalCoverage = j?.done ? Math.round((evaluated / j.done) * 100) : 0;

  const insight = (() => {
    if (!j) return "";
    const parts: string[] = [];
    if (lastJobs) { const d = jobDelta === null ? "" : ` (${jobDelta > 0 ? "▲" : jobDelta < 0 ? "▼" : "→"}${Math.abs(Math.round(jobDelta))}%)`; parts.push(`เดือน${monthLabel(lastJobs.month)} งานเข้า ${lastJobs.n}${d}`); }
    if (responses.length) parts.push(`CSAT ${csatAvg.toFixed(2)}${csatDelta === null ? "" : ` (${csatDelta > 0 ? "▲" : csatDelta < 0 ? "▼" : "→"})`}`);
    parts.push(`งานเสร็จ ${donePct}%`);
    if (ex?.leadTime?.medianDays != null) parts.push(`Lead time ${ex.leadTime.medianDays} วัน`);
    if (flagCount > 0) parts.push(`${flagCount} เคสต้องตาม`);
    if (themeDetail.length) parts.push(`ปัญหาเด่น: ${themeDetail[0].key} (${themeDetail[0].n})`);
    return parts.join("  ·  ");
  })();

  const channelSegs = Object.entries(ex?.jobs.bySource ?? {}).map(([s, n]) => ({ label: SOURCE_LABEL[s] || s, value: n, color: SOURCE_COLOR[s] || C.slate }));

  return (
    <div ref={wrapRef} className="w-full relative" style={{ height: 720 * box.s }}>
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
      <div className="exec-board absolute top-0 bg-white text-slate-800 rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
        style={{ width: 1280, height: 720, transform: `scale(${box.s})`, transformOrigin: "top left", marginLeft: box.left, padding: 18 }}>

        {/* header */}
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-bold">📈 ภาพรวมผู้บริหาร — งานติดตั้ง MPD</h1>
          <span className="text-[11px] text-slate-400">อัปเดต {ex?.updatedAt ? new Date(ex.updatedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "-"}</span>
          <div className="ml-auto flex gap-2 no-print">
            <button onClick={load} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200">🔄 โหลดใหม่</button>
            <button onClick={() => window.print()} className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">🖨️ บันทึกเป็นสไลด์</button>
          </div>
        </div>

        {/* insight */}
        {insight && <div className="mt-2 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 text-indigo-900 rounded-lg px-3 py-1.5 text-[12px] shrink-0"><span className="font-semibold">สรุปวันนี้</span> — {insight}</div>}

        {/* KPI strip */}
        <div className="grid grid-cols-6 gap-2 mt-2 shrink-0">
          <Kpi icon="🆕" label="งานเข้าเดือนนี้" value={String(lastJobs?.n ?? 0)} color={C.blue} delta={jobDelta} />
          <Kpi icon="📦" label="งานเข้าสะสม" value={String(j?.total ?? 0)} color="#334155" />
          <Kpi icon="🔧" label="กำลังดำเนินงาน" value={String(j?.active ?? 0)} color={C.amber} />
          <Kpi icon="✅" label="เสร็จสิ้น" value={`${donePct}%`} color={C.green} />
          <Kpi icon="⭐" label="CSAT เฉลี่ย" value={responses.length ? csatAvg.toFixed(2) : "—"} color={avgColor(csatAvg)} delta={csatDelta} />
          <Kpi icon="🚩" label="ต้องติดตาม" value={String(flagCount)} color={flagCount > 0 ? C.red : C.green} />
        </div>

        {/* body: 3 columns */}
        <div className="grid grid-cols-3 gap-3 mt-3 flex-1 min-h-0">

          {/* col 1 — งานติดตั้ง */}
          <div className="flex flex-col gap-3 min-h-0">
            <Panel title="⏱️ Lead time: รับออเดอร์ → ปิดงาน" right={`${ex?.leadTime?.n ?? 0}/${j?.total ?? 0} งาน`}>
              {ex?.leadTime && ex.leadTime.n > 0 ? (
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div><div className="text-2xl font-bold" style={{ color: leadHit ? C.green : C.red }}>{ex.leadTime.medianDays}</div><div className="text-[10px] text-slate-500">มัธยฐาน {leadHit ? "✓" : ""}<br />(เป้า ≤{TARGET_LEAD_DAYS})</div></div>
                  <div><div className="text-2xl font-bold text-slate-700">{ex.leadTime.avgDays}</div><div className="text-[10px] text-slate-500">เฉลี่ย (วัน)</div></div>
                  <div><div className="text-2xl font-bold" style={{ color: C.amber }}>{ex.leadTime.p90Days}</div><div className="text-[10px] text-slate-500">ช้าสุด 10%<br />(p90)</div></div>
                </div>
              ) : <p className="text-xs text-slate-400">ไม่มีข้อมูลวันปิดงาน</p>}
            </Panel>
            <Panel title="สถานะงานใน Pipeline" grow>
              <div className="space-y-1">
                {(ex?.jobs.byStage ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-20 shrink-0 text-slate-600 truncate">{s.id}.{s.name}</span>
                    <div className="flex-1 h-3 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${(s.n / maxStageN) * 100}%`, background: s.id === 7 ? C.green : C.purple }} /></div>
                    <span className="w-6 shrink-0 text-right font-medium text-slate-700">{s.n}</span>
                  </div>
                ))}
              </div>
              {(ex?.pipeline?.stuck?.length ?? 0) > 0 && (
                <div className="mt-2 rounded-md bg-red-50 border border-red-100 p-1.5">
                  <div className="text-[10px] font-semibold text-red-700 mb-1">🐢 คอขวด {ex!.pipeline.stuck.length} งานค้าง &gt;30 วัน</div>
                  {ex!.pipeline.stuck.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="tag s-red shrink-0 text-[9px]">{s.stage}.{s.stageName}</span>
                      <span className="font-medium text-slate-800 truncate">{s.customer}</span>
                      <span className="ml-auto font-bold text-red-600">{s.days} วัน</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* col 2 — รายเดือน / ช่องทาง / เทรนด์ */}
          <div className="flex flex-col gap-3 min-h-0">
            <Panel title="งานเข้า / เสร็จ รายเดือน">
              {bm.length ? <VBars bars={bm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxMonthN} /> : <p className="text-xs text-slate-400">ไม่มีข้อมูล</p>}
              <div className="text-[10px] text-slate-400 mt-1">เสร็จรายเดือน (completed_date):</div>
              {cbm.length ? <VBars bars={cbm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxCbm} /> : <p className="text-[10px] text-slate-400">ยังไม่มีวันเสร็จงาน</p>}
            </Panel>
            <Panel title="ช่องทางที่มา" grow>
              {channelSegs.length ? <Donut segments={channelSegs} /> : <p className="text-xs text-slate-400">ไม่มีข้อมูล</p>}
              <div className="text-[10px] text-slate-400 mt-2">แนวโน้ม CSAT (เส้นประ = เป้า {TARGET_CSAT})</div>
              {csatMonthly.length ? <LineChart points={csatMonthly.map((c) => ({ label: monthLabel(c.month), value: c.avg }))} max={5} target={TARGET_CSAT} /> : <p className="text-[10px] text-slate-400">ไม่มีข้อมูล</p>}
            </Panel>
          </div>

          {/* col 3 — CSAT / เศษ / ต้องดูวันนี้ */}
          <div className="flex flex-col gap-3 min-h-0">
            <Panel title="⭐ ความพึงพอใจ (CSAT)">
              <div className="grid grid-cols-3 gap-1 mb-1.5 text-center">
                <div><div className="text-lg font-bold" style={{ color: avgColor(csatAvg) }}>{responses.length ? csatAvg.toFixed(2) : "—"}</div><div className="text-[9px] text-slate-500">เฉลี่ย /5</div></div>
                <div><div className="text-lg font-bold" style={{ color: C.green }}>{satisfied}%</div><div className="text-[9px] text-slate-500">พึงพอใจ 4-5</div></div>
                <div><div className="text-lg font-bold" style={{ color: lowList.length ? C.red : C.green }}>{lowList.length}</div><div className="text-[9px] text-slate-500">เคสคะแนนต่ำ</div></div>
              </div>
              <div className="space-y-0.5">
                {DIMS.map((d, i) => (
                  <div key={d} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-16 shrink-0 text-slate-600">{d}</span>
                    <div className="relative flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(dimAvg[i] / 5) * 100}%`, background: avgColor(dimAvg[i]) }} />
                      <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400" style={{ left: `${(TARGET_CSAT / 5) * 100}%` }} />
                    </div>
                    <span className="w-7 shrink-0 text-right font-bold" style={{ color: avgColor(dimAvg[i]) }}>{dimAvg[i].toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="text-[9px] text-slate-400 mt-1">ด้านอ่อนสุด: {DIMS[worstIdx]} ({dimAvg[worstIdx]?.toFixed(2)}) · เด่นสุด: {DIMS[bestIdx]} ({dimAvg[bestIdx]?.toFixed(2)})</div>
            </Panel>

            <Panel title="♻️ ต้นทุนเศษ">
              {ws && ws.count > 0 ? (
                <>
                  <div className="flex justify-between text-[10px] mb-1"><span className="text-slate-500">{ws.count} งาน · เฉลี่ย {ws.avgPct}% · กลาง {ws.medianPct}%</span><span className="font-bold" style={{ color: ex?.waste.costSetup ? C.red : "#94A3B8" }}>{ex?.waste.costSetup ? baht(ex.waste.totalWasteCost) : "ยังไม่ตั้งราคา"}</span></div>
                  <div className="flex h-3 rounded overflow-hidden bg-slate-100">
                    {ws.normal > 0 && <div style={{ width: `${(ws.normal / wsTotal) * 100}%`, background: C.green }} />}
                    {ws.heavy > 0 && <div style={{ width: `${(ws.heavy / wsTotal) * 100}%`, background: C.amber }} />}
                    {ws.abnormal > 0 && <div style={{ width: `${(ws.abnormal / wsTotal) * 100}%`, background: C.red }} />}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[9px]">
                    <Legend color={C.green} label={`ปกติ ≤20% (${ws.normal})`} />
                    <Legend color={C.amber} label={`เปลือง 20-50% (${ws.heavy})`} />
                    <Legend color={C.red} label={`ผิดปกติ >50% (${ws.abnormal})`} />
                  </div>
                </>
              ) : <p className="text-xs text-slate-400">ยังไม่มีข้อมูล %เศษ</p>}
            </Panel>

            <Panel title="🚨 ต้องดูวันนี้" grow>
              {flagCount === 0 ? <p className="text-xs text-slate-400">ไม่มีรายการเร่งด่วน ✅</p> : (
                <div className="space-y-1">
                  {(ex?.overdueList ?? []).slice(0, 3).map((o, i) => (
                    <div key={`o${i}`} className="flex items-center gap-1.5 text-[10px]"><span className="tag s-red shrink-0 text-[9px]">เกินกำหนด</span><span className="font-medium text-slate-800 truncate">{o.customer}</span><span className="ml-auto text-slate-400">นัด {o.due}</span></div>
                  ))}
                  {lowList.slice(0, 5).map((r, i) => (
                    <div key={`c${i}`} className="flex items-center gap-1.5 text-[10px]"><span className="tag s-amber shrink-0 text-[9px]">คะแนนต่ำ</span><span className="font-medium text-slate-800 shrink-0">{r.customer || "-"}</span><span className="text-slate-500 truncate">{r.comment}</span>{r.overall !== null && <span className="ml-auto font-bold shrink-0" style={{ color: avgColor(r.overall) }}>{r.overall.toFixed(1)}</span>}</div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>

        {/* footer coverage */}
        <div className="text-[9px] text-slate-400 mt-2 shrink-0 flex flex-wrap gap-x-3">
          <span>ความครบข้อมูล: Lead time {ex?.leadTime?.n ?? 0}/{j?.total ?? 0}</span>
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
function Panel({ title, right, grow, children }: { title: string; right?: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div className={`bg-white border border-slate-100 rounded-lg p-2.5 ${grow ? "flex-1 min-h-0 overflow-hidden" : ""} flex flex-col`}>
      <div className="flex items-center justify-between mb-1.5 shrink-0"><h2 className="text-[12px] font-semibold text-slate-700">{title}</h2>{right && <span className="text-[10px] text-slate-400">{right}</span>}</div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background: color }} />{label}</span>; }
function Kpi({ icon, label, value, color, delta }: { icon: string; label: string; value: string; color: string; delta?: number | null }) {
  let d = null;
  if (delta !== undefined && delta !== null) { const up = delta > 0, flat = Math.round(delta) === 0; const c = flat ? "#94A3B8" : up ? C.green : C.red; d = <span className="text-[10px] font-semibold" style={{ color: c }}>{flat ? "→" : up ? "▲" : "▼"}{Math.abs(Math.round(delta))}%</span>; }
  return <div className="bg-white border border-slate-100 rounded-lg px-2.5 py-1.5"><div className="flex items-center justify-between"><span className="text-xs">{icon}</span>{d}</div><div className="text-xl font-bold leading-tight" style={{ color }}>{value}</div><div className="text-[10px] text-slate-500 leading-tight">{label}</div></div>;
}

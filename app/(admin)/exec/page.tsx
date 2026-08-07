"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ---------- types ---------- */
type StageN = { id: number; name: string; n: number };
type NamedJob = { customer: string; product: string; due: string; stage: number };
type WasteTop = { customer: string; bill: string | null; zoneM2: number; actM2: number | null; pct: number | null };
type WasteStats = { count: number; avgPct: number | null; medianPct: number | null; normal: number; heavy: number; abnormal: number };
type Exec = {
  jobs: { total: number; byStage: StageN[]; bySource: Record<string, number>; byMonth: { month: string; n: number }[]; completedByMonth: { month: string; n: number }[]; done: number; active: number; overdue: number; evaluated: number };
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
  const W = 340, H = 130, padL = 6, padR = 6, padT = 16, padB = 20;
  const n = points.length, iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => (n <= 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (Math.max(0, Math.min(max, v)) / max) * ih;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 150 }}>
      {[0, 0.5, 1].map((g) => <line key={g} x1={padL} x2={W - padR} y1={padT + ih * g} y2={padT + ih * g} stroke={C.line} strokeWidth="1" />)}
      {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={C.slate} strokeWidth="1" strokeDasharray="3 3" />}
      {area && <path d={area} fill={C.blue} opacity="0.08" />}
      <path d={line} fill="none" stroke={C.blue} strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3.5" fill={avgColor(p.value)} />
          <text x={x(i)} y={y(p.value) - 6} textAnchor="middle" fontSize="9" fontWeight="700" fill={avgColor(p.value)}>{p.value.toFixed(2)}</text>
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="8" fill={C.slate}>{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 42, cx = 60, cy = 60, sw = 16, Ci = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" width="110" height="110" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.line} strokeWidth={sw} />
        {segments.map((s, i) => { const len = (s.value / total) * Ci; const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${len} ${Ci - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${cx} ${cy})`} />; acc += len; return el; })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="800" fill="#0F172A">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill={C.slate}>งาน</text>
      </svg>
      <div className="space-y-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
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
    <div className="flex items-end gap-2 h-32">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
          <span className="text-[10px] font-bold text-slate-700">{b.value}</span>
          <div className="w-full rounded-t" style={{ height: `${(b.value / max) * 100}%`, minHeight: 2, background: C.blue }} />
          <span className="text-[9px] text-slate-400">{b.label}</span>
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

  const insight = (() => {
    if (!j) return "";
    const parts: string[] = [];
    if (lastJobs) { const d = jobDelta === null ? "" : ` (${jobDelta > 0 ? "▲" : jobDelta < 0 ? "▼" : "→"}${Math.abs(Math.round(jobDelta))}% จากเดือนก่อน)`; parts.push(`เดือน${monthLabel(lastJobs.month)} งานเข้า ${lastJobs.n} งาน${d}`); }
    if (responses.length) parts.push(`CSAT ${csatAvg.toFixed(2)}${csatDelta === null ? "" : ` (${csatDelta > 0 ? "▲" : csatDelta < 0 ? "▼" : "→"})`}`);
    parts.push(`งานเสร็จ ${donePct}%`);
    if (flagCount > 0) parts.push(`${flagCount} เคสต้องตาม`);
    if (themeDetail.length) parts.push(`ปัญหาเด่น: ${themeDetail[0].key} (${themeDetail[0].n})`);
    return parts.join("  ·  ");
  })();

  const channelSegs = Object.entries(ex?.jobs.bySource ?? {}).map(([s, n]) => ({ label: SOURCE_LABEL[s] || s, value: n, color: SOURCE_COLOR[s] || C.slate }));

  // CSAT analysis bullets
  const csatAnalysis: string[] = [];
  if (responses.length) {
    csatAnalysis.push(csatAvg >= TARGET_CSAT ? `คะแนนรวม ${csatAvg.toFixed(2)} ผ่านเป้า ${TARGET_CSAT} — ระดับดีมาก (${satisfied}% ให้ 4–5 ดาว)` : `คะแนนรวม ${csatAvg.toFixed(2)} ยังไม่ถึงเป้า ${TARGET_CSAT}`);
    if (csatDelta !== null && Math.round(csatDelta) !== 0) csatAnalysis.push(`เดือนล่าสุด CSAT ${csatDelta > 0 ? "ดีขึ้น ▲" : "ลดลง ▼"} จากเดือนก่อน — ${csatDelta > 0 ? "รักษาระดับไว้" : "ควรหาสาเหตุที่ตกลง"}`);
    csatAnalysis.push(`ด้านแข็งสุด: ${DIMS[bestIdx]} (${dimAvg[bestIdx].toFixed(2)}) · ด้านอ่อนสุด: ${DIMS[worstIdx]} (${dimAvg[worstIdx].toFixed(2)}) — โฟกัสด้านอ่อนก่อน`);
    if (themeDetail.length) csatAnalysis.push(`คำติที่พบบ่อยสุด: ${themeDetail.slice(0, 3).map((t) => `${t.key} (${t.n})`).join(", ")} — แก้ 3 เรื่องนี้ช่วยดันคะแนนได้มากสุด`);
    if (lowList.length) csatAnalysis.push(`มี ${lowList.length} เคสให้คะแนนต่ำ — ตามแก้รายเคสได้จากโซน "ต้องดูวันนี้"`);
  }

  // Waste analysis bullets
  const wasteAnalysis: string[] = [];
  if (ws && ws.count > 0) {
    wasteAnalysis.push(`คำนวณ %เศษได้ ${ws.count} งาน (จาก ${j?.total ?? 0} งาน) — เฉลี่ย ${ws.avgPct}% · มัธยฐาน ${ws.medianPct}%`);
    wasteAnalysis.push(`แบ่งเป็น: ปกติ (ไม่เกิน 20%) ${ws.normal} งาน · เปลือง (20–50%) ${ws.heavy} งาน · สูงผิดปกติ (เกิน 50%) ${ws.abnormal} งาน`);
    if (ws.abnormal > 0) wasteAnalysis.push(`⚠️ ${ws.abnormal} งานที่เศษเกิน 50% สูงผิดปกติ — ควรตรวจก่อนว่าเป็นการกรอกข้อมูลผิด หรือเปลืองวัสดุจริง`);
    if (!ex?.waste.costSetup) wasteAnalysis.push(`ยังเป็นแค่ % พื้นที่ — ตั้งราคา unit_cost แล้วจะเห็นเป็นเงินบาทที่เสียไปจริง`);
  }
  const wsTotal = ws ? Math.max(1, ws.count) : 1;

  return (
    <div className="max-w-6xl mx-auto pb-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">📈 ภาพรวมผู้บริหาร</h1>
          <p className="text-sm text-slate-500 mt-0.5">งานติดตั้ง MPD{ex?.updatedAt ? ` · อัปเดต ${new Date(ex.updatedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}` : ""}</p>
        </div>
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">🔄 โหลดใหม่</button>
      </div>

      {insight && <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 text-indigo-900 rounded-xl px-4 py-3 text-sm mb-5 leading-relaxed"><span className="font-semibold">สรุปวันนี้</span> — {insight}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Kpi icon="🆕" label="งานเข้าเดือนนี้" value={String(lastJobs?.n ?? 0)} color={C.blue} delta={jobDelta} />
        <Kpi icon="📦" label="งานเข้าสะสม" value={String(j?.total ?? 0)} color="#334155" />
        <Kpi icon="🔧" label="กำลังดำเนินงาน" value={String(j?.active ?? 0)} color={C.amber} />
        <Kpi icon="✅" label="เสร็จสิ้น" value={`${donePct}%`} color={C.green} />
        <Kpi icon="⭐" label="CSAT เฉลี่ย" value={responses.length ? csatAvg.toFixed(2) : "—"} color={avgColor(csatAvg)} delta={csatDelta} />
        <Kpi icon="🚩" label="ต้องติดตาม" value={String(flagCount)} color={flagCount > 0 ? C.red : C.green} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <TargetBar label="CSAT เทียบเป้า" value={csatAvg} target={TARGET_CSAT} max={5} suffix="" />
        <TargetBar label="% พึงพอใจเทียบเป้า" value={satisfied} target={TARGET_SATISFIED} max={100} suffix="%" />
        <TargetBar label="งานเสร็จเทียบเป้า" value={donePct} target={TARGET_DONE} max={100} suffix="%" />
      </div>

      <Card>
        <H title="🚨 ต้องดูวันนี้" />
        {flagCount === 0 ? <p className="text-sm text-slate-400">ไม่มีรายการเร่งด่วน ✅</p> : (
          <div className="space-y-2">
            {(ex?.overdueList ?? []).map((o, i) => <Row key={`o${i}`} tag="เกินกำหนด" tagCls="s-red" name={o.customer} sub={o.product} right={`นัด ${o.due}`} />)}
            {lowList.slice(0, 8).map((r, i) => (
              <div key={`c${i}`} className="flex items-center gap-2 text-sm">
                <span className="tag s-amber shrink-0">คะแนนต่ำ</span>
                <span className="font-medium text-slate-800">{r.customer || "-"}</span>
                <span className="text-xs text-slate-500 truncate">{r.comment}</span>
                {r.overall !== null && <span className="text-xs font-bold ml-auto" style={{ color: avgColor(r.overall) }}>{r.overall.toFixed(1)}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle>งานติดตั้ง</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card><H title="งานเข้าใหม่รายเดือน" />{bm.length ? <VBars bars={bm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxMonthN} /> : <p className="text-sm text-slate-400">ไม่มีข้อมูล</p>}</Card>
        <Card><H title="ช่องทางที่มา" />{channelSegs.length ? <Donut segments={channelSegs} /> : <p className="text-sm text-slate-400">ไม่มีข้อมูล</p>}</Card>
      </div>
      <Card mb>
        <H title="สถานะงานใน Pipeline" right={<a href="/pipeline" className="text-xs text-blue-600 hover:underline">ไป Pipeline →</a>} />
        <div className="space-y-2">
          {(ex?.jobs.byStage ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-slate-600">{s.id}. {s.name}</span>
              <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${(s.n / maxStageN) * 100}%`, background: s.id === 7 ? C.green : C.purple }} /></div>
              <span className="w-10 shrink-0 text-right font-medium text-slate-700">{s.n}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card mb>
        <H title="งานติดตั้งเสร็จรายเดือน" right={<span className="text-[11px] text-slate-400">อิงวันเสร็จงาน (completed_date)</span>} />
        {cbm.length ? <VBars bars={cbm.map((r) => ({ label: monthLabel(r.month), value: r.n }))} max={maxCbm} /> : <p className="text-sm text-slate-400">ยังไม่มีข้อมูลวันเสร็จงาน</p>}
        <p className="text-[11px] text-slate-400 mt-2">มี {evaluated} งานถูกทำเครื่องหมาย “ประเมินแล้ว” ในระบบ (จากการ sync แบบประเมินเข้ากับเลขออเดอร์)</p>
      </Card>
      <SectionTitle>ความพึงพอใจลูกค้า</SectionTitle>
      <Card>
        <H title="⭐ ภาพรวม CSAT" right={<a href="/dashboard" className="text-xs text-blue-600 hover:underline">รายละเอียดเต็ม →</a>} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MiniStat label="แบบประเมิน" value={String(responses.length)} />
          <MiniStat label="คะแนนเฉลี่ย" value={responses.length ? csatAvg.toFixed(2) : "—"} color={avgColor(csatAvg)} />
          <MiniStat label="พึงพอใจ (4-5)" value={`${satisfied}%`} color={C.green} />
          <MiniStat label="เคสคะแนนต่ำ" value={String(lowList.length)} color={lowList.length ? C.red : C.green} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">แนวโน้ม CSAT รายเดือน (เส้นประ = เป้า {TARGET_CSAT})</div>
            {csatMonthly.length ? <LineChart points={csatMonthly.map((c) => ({ label: monthLabel(c.month), value: c.avg }))} max={5} target={TARGET_CSAT} /> : <p className="text-xs text-slate-400">ไม่มีข้อมูล</p>}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">คะแนนเฉลี่ยรายด้าน (แถบ = เฉลี่ย · ตัวเลขแดง = จำนวนรีวิว ≤3)</div>
            <div className="space-y-2">
              {DIMS.map((d, i) => (
                <div key={d} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-slate-600">{d}</span>
                  <div className="relative flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(dimAvg[i] / 5) * 100}%`, background: avgColor(dimAvg[i]) }} />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400" style={{ left: `${(TARGET_CSAT / 5) * 100}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right font-bold" style={{ color: avgColor(dimAvg[i]) }}>{dimAvg[i].toFixed(2)}</span>
                  <span className="w-6 shrink-0 text-right text-[11px]" style={{ color: dimLow[i] ? C.red : "#CBD5E1" }}>{dimLow[i] || "-"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {csatAnalysis.length > 0 && <AnalysisBox title="บทวิเคราะห์ความพึงพอใจ" lines={csatAnalysis} accent={C.green} />}
      </Card>

      {themeDetail.length > 0 && (
        <Card mb>
          <H title="ปัญหาที่ลูกค้าติบ่อย" right={<span className="text-[11px] text-slate-400">จัดกลุ่มอัตโนมัติ + ตัวอย่างจริง</span>} />
          <div className="space-y-3">
            {themeDetail.map((t) => {
              const maxT = Math.max(...themeDetail.map((x) => x.n));
              return (
                <div key={t.key}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 text-slate-700 font-medium">{t.key}</span>
                    <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden"><div className="h-full rounded" style={{ width: `${(t.n / maxT) * 100}%`, background: C.amber }} /></div>
                    <span className="w-8 shrink-0 text-right font-bold text-slate-700">{t.n}</span>
                  </div>
                  <div className="ml-0 sm:ml-[168px] mt-1 text-[11px] text-slate-500 italic">“{t.example}” — {t.who}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <SectionTitle>ต้นทุนเศษ</SectionTitle>
      <Card mb>
        <H title="♻️ ภาพรวมต้นทุนเศษ" right={<a href="/waste-cost" className="text-xs text-blue-600 hover:underline">รายละเอียดเต็ม →</a>} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MiniStat label="งานทั้งหมด" value={String(j?.total ?? 0)} color={C.blue} />
          <MiniStat label="มีข้อมูลโซน" value={String(ex?.waste.withZones ?? 0)} color={C.purple} />
          <MiniStat label="มีข้อมูลปิดงาน" value={String(ex?.waste.withData ?? 0)} color={C.green} />
          <MiniStat label="รวมต้นทุนเศษ" value={ex?.waste.costSetup ? baht(ex.waste.totalWasteCost) : "—"} color={ex?.waste.costSetup ? C.red : "#94A3B8"} />
        </div>

        {ws && ws.count > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">การกระจาย %เศษ ({ws.count} งาน) · เฉลี่ย {ws.avgPct}% · กลาง {ws.medianPct}%</span>
            </div>
            <div className="flex h-4 rounded overflow-hidden bg-slate-100">
              {ws.normal > 0 && <div style={{ width: `${(ws.normal / wsTotal) * 100}%`, background: C.green }} title="ปกติ" />}
              {ws.heavy > 0 && <div style={{ width: `${(ws.heavy / wsTotal) * 100}%`, background: C.amber }} title="เปลือง" />}
              {ws.abnormal > 0 && <div style={{ width: `${(ws.abnormal / wsTotal) * 100}%`, background: C.red }} title="สูงผิดปกติ" />}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
              <Legend color={C.green} label={`ปกติ ไม่เกิน 20% (${ws.normal})`} />
              <Legend color={C.amber} label={`เปลือง 20–50% (${ws.heavy})`} />
              <Legend color={C.red} label={`สูงผิดปกติ เกิน 50% (${ws.abnormal})`} />
            </div>
          </div>
        )}

        {!ex?.waste.costSetup && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs mb-3">💡 ยังไม่ได้ตั้งราคาต้นทุน — ตั้งค่า unit_cost ของ RS-140 / RS-110 ที่หน้า คลังวัสดุ เพื่อคำนวณเป็นบาท</div>}

        {(ex?.waste.top ?? []).length > 0 ? (
          <>
            <div className="text-xs font-medium text-slate-500 mb-2">งานที่ %เศษพื้นที่สูงสุด</div>
            <div className="space-y-2">
              {ex!.waste.top.map((r, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="font-medium text-slate-800 truncate max-w-[150px]">{r.customer}</span>
                  {(r.pct ?? 0) > 50 && <span className="tag s-red text-[10px] shrink-0">ตรวจข้อมูล</span>}
                  <span className="text-xs text-slate-500 ml-auto hidden sm:block">โซน {r.zoneM2.toFixed(1)} → จริง {r.actM2?.toFixed(1)} m²</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: wasteColor(r.pct ?? 0) }}>{(r.pct ?? 0) > 0 ? "+" : ""}{r.pct?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">%เศษพื้นที่ = (พื้นที่วัสดุจริง − พื้นที่โซน) ÷ พื้นที่โซน · บวกมาก = เปลืองวัสดุ</p>
          </>
        ) : <p className="text-sm text-slate-400">ยังไม่มีงานที่มีทั้งข้อมูลโซนและข้อมูลปิดงานให้คำนวณ %เศษ</p>}

        {wasteAnalysis.length > 0 && <AnalysisBox title="บทวิเคราะห์ต้นทุนเศษ" lines={wasteAnalysis} accent={C.amber} />}
      </Card>

      <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg px-3 py-2">ความครบของข้อมูล: มีข้อมูลปิดงาน {ex?.waste.withData ?? 0}/{j?.total ?? 0} งาน ({closingPct}%) · มีข้อมูลโซน {ex?.waste.withZones ?? 0}/{j?.total ?? 0} · แบบประเมิน CSAT {responses.length} รายการ — ตัวเลขบางส่วนคำนวณจากงานที่มีข้อมูลครบเท่านั้น</div>
    </div>
  );
}

/* ---------- components ---------- */
function Card({ children, mb }: { children: React.ReactNode; mb?: boolean }) { return <div className={`bg-white border border-slate-100 rounded-xl p-4 ${mb ? "mb-6" : "mb-4"}`}>{children}</div>; }
function H({ title, right }: { title: string; right?: React.ReactNode }) { return <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold">{title}</h2>{right}</div>; }
function SectionTitle({ children }: { children: React.ReactNode }) { return <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 mt-1">{children}</div>; }
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{label}</span>; }
function Row({ tag, tagCls, name, sub, right }: { tag: string; tagCls: string; name: string; sub: string; right: string }) {
  return <div className="flex items-center gap-2 text-sm"><span className={`tag ${tagCls} shrink-0`}>{tag}</span><span className="font-medium text-slate-800">{name}</span><span className="text-xs text-slate-400 truncate">{sub}</span><span className="text-xs text-slate-400 ml-auto">{right}</span></div>;
}
function AnalysisBox({ title, lines, accent }: { title: string; lines: string[]; accent: string }) {
  return (
    <div className="mt-4 rounded-lg bg-slate-50 border-l-4 p-3" style={{ borderColor: accent }}>
      <div className="text-xs font-semibold text-slate-700 mb-1.5">📊 {title}</div>
      <ul className="space-y-1">
        {lines.map((l, i) => <li key={i} className="text-xs text-slate-600 leading-relaxed flex gap-1.5"><span style={{ color: accent }}>•</span><span>{l}</span></li>)}
      </ul>
    </div>
  );
}
function Kpi({ icon, label, value, color, delta }: { icon: string; label: string; value: string; color: string; delta?: number | null }) {
  let d = null;
  if (delta !== undefined && delta !== null) { const up = delta > 0, flat = Math.round(delta) === 0; const c = flat ? "#94A3B8" : up ? C.green : C.red; d = <span className="text-[11px] font-semibold" style={{ color: c }}>{flat ? "→" : up ? "▲" : "▼"}{Math.abs(Math.round(delta))}%</span>; }
  return <div className="bg-white border border-slate-100 rounded-xl p-4"><div className="flex items-center justify-between"><span className="text-sm">{icon}</span>{d}</div><div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div><div className="text-xs text-slate-500 mt-0.5 leading-tight">{label}</div></div>;
}
function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) { return <div><div className="text-lg font-bold" style={{ color: color || "#0F172A" }}>{value}</div><div className="text-[11px] text-slate-500">{label}</div></div>; }
function TargetBar({ label, value, target, max, suffix }: { label: string; value: number; target: number; max: number; suffix: string }) {
  const hit = value >= target; const pct = Math.min(100, (value / max) * 100); const tPct = Math.min(100, (target / max) * 100);
  return <div className="bg-white border border-slate-100 rounded-xl p-4"><div className="flex justify-between items-baseline mb-2"><span className="text-xs text-slate-500">{label}</span><span className="text-sm font-bold" style={{ color: hit ? C.green : C.amber }}>{value.toFixed(suffix === "%" ? 0 : 2)}{suffix} {hit ? "✓" : ""}</span></div><div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: hit ? C.green : C.amber }} /><div className="absolute top-0 bottom-0 w-0.5 bg-slate-500" style={{ left: `${tPct}%` }} /></div><div className="text-[10px] text-slate-400 mt-1">เป้า {target}{suffix}</div></div>;
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ---------- types ---------- */
type StageN = { id: number; name: string; n: number };
type NamedJob = { customer: string; product: string; due: string; stage: number };
type WasteTop = { customer: string; bill: string | null; zoneM2: number; actM2: number | null; pct: number | null };
type Exec = {
  jobs: { total: number; byStage: StageN[]; bySource: Record<string, number>; byMonth: { month: string; n: number }[]; done: number; active: number; overdue: number };
  upcoming: NamedJob[];
  overdueList: NamedJob[];
  waste: { withZones: number; withData: number; costSetup: boolean; totalWasteCost: number; top: WasteTop[] };
  updatedAt: string;
};
type SResp = { timestamp: string; scores: (number | null)[]; overall: number | null; customer: string; comment: string; bill: string };
type Survey = { responses: SResp[] };

/* ---------- constants ---------- */
const DIMS = ["บริการ", "คุณภาพงาน", "ความเรียบร้อย", "ตรงเวลา", "ความสุภาพ"];
const SCORE_COLOR: Record<number, string> = { 5: "#15935E", 4: "#2563EB", 3: "#C2820E", 2: "#E8833A", 1: "#C0392B" };
const SOURCE_LABEL: Record<string, string> = { sales_txn: "ระบบขาย", manual: "สร้างเอง", shopee: "Shopee", lazada: "Lazada", tiktok: "TikTok", web: "เว็บ" };
const TARGET_CSAT = 4.5;
const TARGET_SATISFIED = 90;
const TARGET_DONE = 80;

// complaint themes (keyword rules)
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
  return `${names[Number(m)] || m} ${String(Number(y) + 543).slice(-2)}`;
}
function avgColor(v: number): string {
  if (v >= 4.5) return "#15935E";
  if (v >= 4) return "#2563EB";
  if (v >= 3) return "#C2820E";
  return "#C0392B";
}
function wasteColor(pct: number): string {
  if (pct > 15) return "#C0392B";
  if (pct > 0) return "#C2820E";
  return "#15935E";
}
function pctDelta(cur: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}
function isoMonth(ts: string): string | null {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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
      setEx(a);
      setSv(b);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const responses = useMemo(() => sv?.responses ?? [], [sv]);
  const allScores = useMemo(() => responses.flatMap((r) => r.scores.filter((x): x is number => x !== null)), [responses]);
  const csatAvg = useMemo(() => (allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0), [allScores]);
  const satisfied = useMemo(() => (allScores.length ? Math.round((allScores.filter((s) => s >= 4).length / allScores.length) * 100) : 0), [allScores]);
  const dimAvg = useMemo(
    () => DIMS.map((_, i) => {
      const v = responses.map((r) => r.scores[i]).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    }),
    [responses]
  );
  const dist = useMemo(() => {
    const d: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allScores.forEach((s) => { d[s]++; });
    return d;
  }, [allScores]);
  const lowList = useMemo(
    () => responses.filter((r) => r.scores.some((s) => s !== null && s <= 2) || (r.overall !== null && r.overall < 3)),
    [responses]
  );

  // CSAT by month
  const csatMonthly = useMemo(() => {
    const agg: Record<string, { sum: number; n: number }> = {};
    responses.forEach((r) => {
      const m = isoMonth(r.timestamp);
      if (!m) return;
      r.scores.forEach((s) => {
        if (s !== null) {
          agg[m] = agg[m] ?? { sum: 0, n: 0 };
          agg[m].sum += s;
          agg[m].n += 1;
        }
      });
    });
    return Object.keys(agg).sort().map((m) => ({ month: m, avg: agg[m].sum / agg[m].n, n: agg[m].n }));
  }, [responses]);

  // complaint themes
  const themes = useMemo(() => {
    const real = responses.filter((r) => r.comment && r.comment !== "-" && r.comment !== "ไม่มี" && r.comment.length > 2);
    const counts = THEMES.map((t) => ({ key: t.key, n: real.filter((r) => t.re.test(r.comment)).length }));
    return counts.filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  }, [responses]);

  const maxMonthN = useMemo(() => Math.max(1, ...(ex?.jobs.byMonth ?? []).map((r) => r.n)), [ex]);
  const maxStageN = useMemo(() => Math.max(1, ...(ex?.jobs.byStage ?? []).map((r) => r.n)), [ex]);

  if (loading && !ex) return <div className="text-slate-400 py-20 text-center">⏳ กำลังโหลด...</div>;

  const j = ex?.jobs;
  const donePct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;
  const flagCount = (ex?.jobs.overdue ?? 0) + lowList.length;

  // MoM: jobs
  const bm = ex?.jobs.byMonth ?? [];
  const lastJobs = bm.length ? bm[bm.length - 1] : null;
  const prevJobs = bm.length > 1 ? bm[bm.length - 2] : null;
  const jobDelta = lastJobs ? pctDelta(lastJobs.n, prevJobs?.n ?? null) : null;
  // MoM: CSAT
  const lastCsat = csatMonthly.length ? csatMonthly[csatMonthly.length - 1] : null;
  const prevCsat = csatMonthly.length > 1 ? csatMonthly[csatMonthly.length - 2] : null;
  const csatDelta = lastCsat ? pctDelta(lastCsat.avg, prevCsat?.avg ?? null) : null;
  const maxCsatN = Math.max(1, ...csatMonthly.map((c) => c.n));

  // data completeness
  const closingPct = j && j.total ? Math.round(((ex?.waste.withData ?? 0) / j.total) * 100) : 0;

  // auto insight sentence
  const insight = (() => {
    if (!j) return "";
    const parts: string[] = [];
    if (lastJobs) {
      const dtxt = jobDelta === null ? "" : ` (${jobDelta > 0 ? "▲" : jobDelta < 0 ? "▼" : "→"}${Math.abs(Math.round(jobDelta))}% จากเดือนก่อน)`;
      parts.push(`เดือน${monthLabel(lastJobs.month)} งานเข้า ${lastJobs.n} งาน${dtxt}`);
    }
    if (responses.length) {
      const ctxt = csatDelta === null ? "" : ` (${csatDelta > 0 ? "▲" : csatDelta < 0 ? "▼" : "→"})`;
      parts.push(`CSAT ${csatAvg.toFixed(2)}${ctxt}`);
    }
    parts.push(`งานเสร็จ ${donePct}%`);
    if (flagCount > 0) parts.push(`${flagCount} เคสต้องตาม`);
    if (themes.length) parts.push(`ปัญหาเด่น: ${themes[0].key} (${themes[0].n} ครั้ง)`);
    return parts.join(" · ");
  })();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">📈 ภาพรวมผู้บริหาร</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            งานติดตั้ง MPD
            {ex?.updatedAt ? ` · อัปเดต ${new Date(ex.updatedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}` : ""}
          </p>
        </div>
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">🔄 โหลดใหม่</button>
      </div>

      {/* auto-insight */}
      {insight && (
        <div className="bg-indigo-50 border border-indigo-100 text-indigo-900 rounded-xl px-4 py-3 text-sm mb-4">
          💡 {insight}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Kpi label="งานเข้าเดือนนี้" value={String(lastJobs?.n ?? 0)} color="#2563EB" delta={jobDelta} deltaGood="up" />
        <Kpi label="งานเข้าสะสม" value={String(j?.total ?? 0)} color="#334155" />
        <Kpi label="กำลังดำเนินงาน" value={String(j?.active ?? 0)} color="#C2820E" />
        <Kpi label="เสร็จสิ้น" value={`${donePct}%`} color="#15935E" />
        <Kpi label="CSAT เฉลี่ย" value={responses.length ? csatAvg.toFixed(2) : "—"} color={avgColor(csatAvg)} delta={csatDelta} deltaGood="up" />
        <Kpi label="ต้องติดตาม" value={String(flagCount)} color={flagCount > 0 ? "#C0392B" : "#15935E"} />
      </div>

      {/* vs targets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <TargetBar label="CSAT เทียบเป้า" value={csatAvg} target={TARGET_CSAT} max={5} suffix="" />
        <TargetBar label="% พึงพอใจเทียบเป้า" value={satisfied} target={TARGET_SATISFIED} max={100} suffix="%" />
        <TargetBar label="งานเสร็จเทียบเป้า" value={donePct} target={TARGET_DONE} max={100} suffix="%" />
      </div>

      {/* Red flags */}
      <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold mb-3">🚨 ต้องดูวันนี้</h2>
        {flagCount === 0 ? (
          <p className="text-sm text-slate-400">ไม่มีรายการเร่งด่วน ✅</p>
        ) : (
          <div className="space-y-2">
            {(ex?.overdueList ?? []).map((o, i) => (
              <div key={`o${i}`} className="flex items-center gap-2 text-sm">
                <span className="tag s-red shrink-0">เกินกำหนด</span>
                <span className="font-medium text-slate-800">{o.customer}</span>
                <span className="text-xs text-slate-400 truncate">{o.product}</span>
                <span className="text-xs text-slate-400 ml-auto">นัด {o.due}</span>
              </div>
            ))}
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
      </div>

      {/* New jobs by month */}
      <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold mb-3">งานเข้าใหม่รายเดือน</h2>
        <div className="space-y-2">
          {bm.map((r) => (
            <div key={r.month} className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 text-slate-500">{monthLabel(r.month)}</span>
              <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                <div className="h-full rounded" style={{ width: `${(r.n / maxMonthN) * 100}%`, background: "#2563EB" }} />
              </div>
              <span className="w-10 shrink-0 text-right font-medium text-slate-700">{r.n}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100">
          {Object.entries(ex?.jobs.bySource ?? {}).map(([s, n]) => (
            <span key={s} className="text-xs text-slate-500">{SOURCE_LABEL[s] || s}: <strong className="text-slate-700">{n}</strong></span>
          ))}
        </div>
      </div>

      {/* Pipeline funnel */}
      <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">สถานะงานใน Pipeline</h2>
          <a href="/pipeline" className="text-xs text-blue-600 hover:underline">ไป Pipeline →</a>
        </div>
        <div className="space-y-2">
          {(ex?.jobs.byStage ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-slate-600">{s.id}. {s.name}</span>
              <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                <div className="h-full rounded" style={{ width: `${(s.n / maxStageN) * 100}%`, background: s.id === 7 ? "#15935E" : "#7C3AED" }} />
              </div>
              <span className="w-10 shrink-0 text-right font-medium text-slate-700">{s.n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ===== CSAT detail ===== */}
      <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">⭐ คุณภาพ / ความพึงพอใจลูกค้า</h2>
          <a href="/dashboard" className="text-xs text-blue-600 hover:underline">รายละเอียดเต็ม →</a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MiniStat label="แบบประเมิน" value={String(responses.length)} />
          <MiniStat label="คะแนนเฉลี่ย" value={responses.length ? csatAvg.toFixed(2) : "—"} color={avgColor(csatAvg)} />
          <MiniStat label="พึงพอใจ (4-5)" value={`${satisfied}%`} color="#15935E" />
          <MiniStat label="เคสคะแนนต่ำ" value={String(lowList.length)} color={lowList.length ? "#C0392B" : "#15935E"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* dimension averages */}
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">คะแนนเฉลี่ยรายด้าน</div>
            <div className="space-y-2">
              {DIMS.map((d, i) => (
                <div key={d} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-slate-600">{d}</span>
                  <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(dimAvg[i] / 5) * 100}%`, background: avgColor(dimAvg[i]) }} />
                  </div>
                  <span className="w-8 shrink-0 text-right font-bold" style={{ color: avgColor(dimAvg[i]) }}>{dimAvg[i].toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          {/* CSAT monthly trend */}
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">แนวโน้ม CSAT รายเดือน</div>
            {csatMonthly.length === 0 ? (
              <p className="text-xs text-slate-400">ไม่มีข้อมูล</p>
            ) : (
              <div className="space-y-2">
                {csatMonthly.map((c) => (
                  <div key={c.month} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 text-slate-500">{monthLabel(c.month)}</span>
                    <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(c.avg / 5) * 100}%`, background: avgColor(c.avg) }} />
                    </div>
                    <span className="w-16 shrink-0 text-right font-bold" style={{ color: avgColor(c.avg) }}>
                      {c.avg.toFixed(2)}
                      <span className="text-slate-400 font-normal"> ({c.n})</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* complaint themes */}
        {themes.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 mb-2">ปัญหาที่ลูกค้าติบ่อย (จัดกลุ่มจากข้อเสนอแนะ)</div>
            <div className="space-y-2">
              {themes.map((t) => {
                const maxT = Math.max(...themes.map((x) => x.n));
                return (
                  <div key={t.key} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 text-slate-600">{t.key}</span>
                    <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(t.n / maxT) * 100}%`, background: "#C2820E" }} />
                    </div>
                    <span className="w-10 shrink-0 text-right font-bold text-slate-700">{t.n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {responses.length > 0 && (
          <div className="mt-4 text-xs text-slate-500 border-t border-slate-100 pt-3">
            ด้านที่คะแนนต่ำสุด: <strong className="text-slate-700">{DIMS[dimAvg.indexOf(Math.min(...dimAvg))]}</strong>{" "}
            ({Math.min(...dimAvg).toFixed(2)}) — โฟกัสปรับปรุงจุดนี้ก่อน
          </div>
        )}
      </div>

      {/* ===== Waste detail ===== */}
      <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">♻️ ต้นทุนเศษ</h2>
          <a href="/waste-cost" className="text-xs text-blue-600 hover:underline">รายละเอียดเต็ม →</a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MiniStat label="งานทั้งหมด" value={String(j?.total ?? 0)} color="#2563EB" />
          <MiniStat label="มีข้อมูลโซน" value={String(ex?.waste.withZones ?? 0)} color="#7C3AED" />
          <MiniStat label="มีข้อมูลปิดงาน" value={String(ex?.waste.withData ?? 0)} color="#15935E" />
          <MiniStat label="รวมต้นทุนเศษ" value={ex?.waste.costSetup ? baht(ex.waste.totalWasteCost) : "—"} color={ex?.waste.costSetup ? "#C0392B" : "#94A3B8"} />
        </div>
        {!ex?.waste.costSetup && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs mb-3">
            💡 ยังไม่ได้ตั้งราคาต้นทุน — ตั้งค่า unit_cost ของ RS-140 / RS-110 ที่หน้า คลังวัสดุ เพื่อคำนวณต้นทุนเศษเป็นบาท
          </div>
        )}
        {(ex?.waste.top ?? []).length > 0 ? (
          <>
            <div className="text-xs font-medium text-slate-500 mb-2">งานที่ %เศษพื้นที่สูงสุด</div>
            <div className="space-y-2">
              {ex!.waste.top.map((r, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="font-medium text-slate-800 truncate max-w-[150px]">{r.customer}</span>
                  {r.bill && <span className="text-xs text-slate-400 font-mono hidden sm:block">#{r.bill}</span>}
                  <span className="text-xs text-slate-500 ml-auto hidden sm:block">โซน {r.zoneM2.toFixed(1)} → จริง {r.actM2?.toFixed(1)} m²</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: wasteColor(r.pct ?? 0) }}>
                    {(r.pct ?? 0) > 0 ? "+" : ""}{r.pct?.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">%เศษพื้นที่ = (พื้นที่วัสดุจริง − พื้นที่โซน) ÷ พื้นที่โซน · บวกมาก = เปลืองวัสดุ</p>
          </>
        ) : (
          <p className="text-sm text-slate-400">ยังไม่มีงานที่มีทั้งข้อมูลโซนและข้อมูลปิดงานให้คำนวณ %เศษ</p>
        )}
      </div>

      {/* data completeness */}
      <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg px-3 py-2">
        ความครบของข้อมูล: มีข้อมูลปิดงาน {ex?.waste.withData ?? 0}/{j?.total ?? 0} งาน ({closingPct}%) · มีข้อมูลโซน {ex?.waste.withZones ?? 0}/{j?.total ?? 0} · แบบประเมิน CSAT {responses.length} รายการ — ตัวเลขบางส่วนคำนวณจากงานที่มีข้อมูลครบเท่านั้น
      </div>
    </div>
  );
}

function Kpi({ label, value, color, delta, deltaGood }: { label: string; value: string; color: string; delta?: number | null; deltaGood?: "up" | "down" }) {
  let dNode = null;
  if (delta !== undefined && delta !== null) {
    const up = delta > 0, flat = Math.round(delta) === 0;
    const good = deltaGood === "up" ? up : !up;
    const c = flat ? "#94A3B8" : good ? "#15935E" : "#C0392B";
    dNode = <span className="text-[11px] font-semibold" style={{ color: c }}>{flat ? "→" : up ? "▲" : "▼"}{Math.abs(Math.round(delta))}%</span>;
  }
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="flex items-baseline gap-1.5">
        <div className="text-xl font-bold" style={{ color }}>{value}</div>
        {dNode}
      </div>
      <div className="text-xs text-slate-500 mt-1 leading-tight">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-lg font-bold" style={{ color: color || "#0F172A" }}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function TargetBar({ label, value, target, max, suffix }: { label: string; value: number; target: number; max: number; suffix: string }) {
  const hit = value >= target;
  const pct = Math.min(100, (value / max) * 100);
  const tPct = Math.min(100, (target / max) * 100);
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-sm font-bold" style={{ color: hit ? "#15935E" : "#C2820E" }}>
          {value.toFixed(suffix === "%" ? 0 : 2)}{suffix} {hit ? "✓" : ""}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: hit ? "#15935E" : "#C2820E" }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-500" style={{ left: `${tPct}%` }} />
      </div>
      <div className="text-[10px] text-slate-400 mt-1">เป้า {target}{suffix}</div>
    </div>
  );
}

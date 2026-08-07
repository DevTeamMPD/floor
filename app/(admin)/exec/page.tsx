"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ---------- types ---------- */
type Rev = { month: string; orders: number; qty: number; revenue: number };
type StageN = { id: number; name: string; n: number };
type NamedJob = { customer: string; product: string; due: string; stage: number };
type WasteTop = { customer: string; bill: string | null; zoneM2: number; actM2: number | null; pct: number | null };
type Exec = {
  revenue: Rev[];
  jobs: { total: number; byStage: StageN[]; bySource: Record<string, number>; byMonth: { month: string; n: number }[]; done: number; active: number; overdue: number };
  upcoming: NamedJob[];
  overdueList: NamedJob[];
  waste: { withZones: number; withData: number; costSetup: boolean; totalWasteCost: number; top: WasteTop[] };
  updatedAt: string;
  error?: string;
};
type Survey = { responses: { scores: (number | null)[]; overall: number | null; customer: string; comment: string }[]; error?: string };

/* ---------- helpers ---------- */
const SOURCE_LABEL: Record<string, string> = { sales_txn: "ระบบขาย", manual: "สร้างเอง", shopee: "Shopee", lazada: "Lazada", tiktok: "TikTok", web: "เว็บ" };
function baht(n: number): string {
  return "฿" + Math.round(n).toLocaleString("th-TH");
}
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

  const csat = useMemo(() => {
    const rs = sv?.responses ?? [];
    const all = rs.flatMap((r) => r.scores.filter((x): x is number => x !== null));
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
    const satisfied = all.length ? Math.round((all.filter((s) => s >= 4).length / all.length) * 100) : 0;
    const low = rs.filter((r) => r.scores.some((s) => s !== null && s <= 2) || (r.overall !== null && r.overall < 3));
    return { count: rs.length, avg, satisfied, low };
  }, [sv]);

  const revTotal = useMemo(() => (ex?.revenue ?? []).reduce((s, r) => s + r.revenue, 0), [ex]);
  const maxRev = useMemo(() => Math.max(1, ...(ex?.revenue ?? []).map((r) => r.revenue)), [ex]);
  const maxMonthN = useMemo(() => Math.max(1, ...(ex?.jobs.byMonth ?? []).map((r) => r.n)), [ex]);
  const maxStageN = useMemo(() => Math.max(1, ...(ex?.jobs.byStage ?? []).map((r) => r.n)), [ex]);

  if (loading && !ex) {
    return <div className="text-slate-400 py-20 text-center">⏳ กำลังโหลด...</div>;
  }

  const j = ex?.jobs;
  const donePct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;
  const flagCount = (ex?.jobs.overdue ?? 0) + csat.low.length;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">📈 ภาพรวมผู้บริหาร</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            งานติดตั้ง MPD
            {ex?.updatedAt ? ` · อัปเดต ${new Date(ex.updatedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}` : ""}
          </p>
        </div>
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          🔄 โหลดใหม่
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <Kpi label="รายได้ (จับคู่ยอดขาย)" value={baht(revTotal)} color="#15935E" />
        <Kpi label="งานเข้าทั้งหมด" value={String(j?.total ?? 0)} color="#2563EB" />
        <Kpi label="กำลังดำเนินงาน" value={String(j?.active ?? 0)} color="#C2820E" />
        <Kpi label="เสร็จสิ้น" value={`${j?.done ?? 0} (${donePct}%)`} color="#15935E" />
        <Kpi label="CSAT เฉลี่ย" value={csat.count ? `${csat.avg.toFixed(2)}/5` : "—"} color={avgColor(csat.avg)} />
        <Kpi label="ต้องติดตาม" value={String(flagCount)} color={flagCount > 0 ? "#C0392B" : "#15935E"} />
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
            {csat.low.slice(0, 8).map((r, i) => (
              <div key={`c${i}`} className="flex items-center gap-2 text-sm">
                <span className="tag s-amber shrink-0">คะแนนต่ำ</span>
                <span className="font-medium text-slate-800">{r.customer || "-"}</span>
                <span className="text-xs text-slate-500 truncate">{r.comment}</span>
                {r.overall !== null && (
                  <span className="text-xs font-bold ml-auto" style={{ color: avgColor(r.overall) }}>{r.overall.toFixed(1)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {/* Revenue trend */}
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">รายได้รายเดือน</h2>
            <span className="text-[11px] text-slate-400">เฉพาะงานที่จับคู่รายการขายได้</span>
          </div>
          {(ex?.revenue ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">ไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-2">
              {ex!.revenue.map((r) => (
                <div key={r.month} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 text-slate-500">{monthLabel(r.month)}</span>
                  <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${(r.revenue / maxRev) * 100}%`, background: "#15935E" }} />
                  </div>
                  <span className="w-24 shrink-0 text-right font-medium text-slate-700">{baht(r.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New jobs by month */}
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">งานเข้าใหม่รายเดือน</h2>
          <div className="space-y-2">
            {(ex?.jobs.byMonth ?? []).map((r) => (
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
              <span key={s} className="text-xs text-slate-500">
                {SOURCE_LABEL[s] || s}: <strong className="text-slate-700">{n}</strong>
              </span>
            ))}
          </div>
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

      {/* Quality + Waste summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">คุณภาพ / ความพึงพอใจ</h2>
            <a href="/dashboard" className="text-xs text-blue-600 hover:underline">รายละเอียด →</a>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="แบบประเมิน" value={String(csat.count)} />
            <MiniStat label="เฉลี่ย" value={csat.count ? `${csat.avg.toFixed(2)}` : "—"} color={avgColor(csat.avg)} />
            <MiniStat label="พึงพอใจ" value={`${csat.satisfied}%`} color="#15935E" />
          </div>
          {csat.low.length > 0 && (
            <p className="text-xs text-amber-700 mt-3">⚠️ มี {csat.low.length} เคสที่ให้คะแนนต่ำ ควรตามแก้</p>
          )}
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">ต้นทุนเศษ</h2>
            <a href="/waste-cost" className="text-xs text-blue-600 hover:underline">รายละเอียด →</a>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="มีข้อมูลโซน" value={String(ex?.waste.withZones ?? 0)} />
            <MiniStat label="มีข้อมูลปิดงาน" value={String(ex?.waste.withData ?? 0)} />
            <MiniStat label="รวมต้นทุนเศษ" value={ex?.waste.costSetup ? baht(ex.waste.totalWasteCost) : "—"} color={ex?.waste.costSetup ? "#C0392B" : "#94A3B8"} />
          </div>
          {!ex?.waste.costSetup && (
            <p className="text-xs text-slate-400 mt-3">ตั้งราคา unit_cost RS-140/RS-110 ที่คลังวัสดุ เพื่อคำนวณเป็นบาท</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
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

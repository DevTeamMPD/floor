"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Zone { id: string; job_no: string; zone_name: string; width_cm: number; length_cm: number; }
interface Job { job_no: string; customer_name: string; product_name: string; stage: number; }
interface Material { id: string; sku: string; unit_cost: number | null; }
interface StockSummary { issued_140: number; returned_140: number; issued_110: number; returned_110: number; }
interface StripCalc { n140: number; n110: number; total140: number; total110: number; }

// ─── Algorithm ────────────────────────────────────────────────────────────────
function calcStripsForZone(dimA: number, dimB: number): StripCalc {
  function singleOrient(stripLen: number, cover: number): StripCalc {
    const nPairs = Math.floor(cover / 250);
    const rem = cover % 250;
    let n140 = nPairs, n110 = nPairs;
    if (rem > 0 && rem <= 110) n110 += 1;
    else if (rem > 110) { n140 += 1; n110 += 1; }
    return { n140, n110, total140: n140 * stripLen, total110: n110 * stripLen };
  }
  const optA = singleOrient(dimA, dimB);
  const optB = singleOrient(dimB, dimA);
  return optA.total140 + optA.total110 <= optB.total140 + optB.total110 ? optA : optB;
}

function sumZones(zones: Zone[]) {
  return zones.reduce(
    (acc, z) => {
      if (z.width_cm <= 0 || z.length_cm <= 0) return acc;
      const c = calcStripsForZone(z.width_cm, z.length_cm);
      return { total140: acc.total140 + c.total140, total110: acc.total110 + c.total110 };
    },
    { total140: 0, total110: 0 }
  );
}

function fmtCm(n: number) { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtBaht(n: number) { return "฿" + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// ─── Sub-components ───────────────────────────────────────────────────────────
function WasteBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] text-slate-300">—</span>;
  const abs = Math.abs(pct);
  const cls = abs <= 5 ? "text-green-700 bg-green-50 border-green-200"
    : abs <= 15 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function StatusDot({ hasZones, hasMov }: { hasZones: boolean; hasMov: boolean }) {
  if (hasZones && hasMov) return <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 inline-block" title="มีข้อมูลครบ" />;
  if (hasZones) return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 inline-block" title="มีโซน ยังไม่มีการเบิก" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-slate-200 flex-shrink-0 inline-block" title="ยังไม่มีข้อมูล" />;
}

function StatRow({ label, value, unit = "cm", bold = false }: { label: string; value: number | null; unit?: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1 ${bold ? "border-t border-slate-100 mt-1" : ""}`}>
      <span className={`text-xs ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>{label}</span>
      <span className={`text-xs font-mono ${bold ? "font-semibold" : ""}`}>
        {value === null ? "—" : `${fmtCm(value)} ${unit}`}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WasteCostPage() {
  const supabase = createClient();

  // Core data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mat140, setMat140] = useState<Material | null>(null);
  const [mat110, setMat110] = useState<Material | null>(null);
  const [search, setSearch] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Overview bulk data
  const [overviewZonesMap, setOverviewZonesMap] = useState<Record<string, Zone[]>>({});
  const [overviewMovMap, setOverviewMovMap] = useState<Record<string, StockSummary>>({});
  const [loadingOverview, setLoadingOverview] = useState(false);

  // View mode
  const [viewMode, setViewMode] = useState<"overview" | "detail">("overview");

  // Detail
  const [selectedJobNo, setSelectedJobNo] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);
  const [savingZone, setSavingZone] = useState<string | null>(null);
  const [addingZone, setAddingZone] = useState(false);

  // ── Load materials ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("materials").select("id,sku,unit_cost").in("sku", ["RS-140", "RS-110"]).then(({ data }) => {
      (data ?? []).forEach((m) => {
        if (m.sku === "RS-140") setMat140(m);
        if (m.sku === "RS-110") setMat110(m);
      });
    });
  }, []);

  // ── Load all jobs ─────────────────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    const { data } = await supabase.from("install_jobs").select("job_no,customer_name,product_name,stage").order("created_at", { ascending: false });
    setJobs(data ?? []);
    setLoadingJobs(false);
  }, [supabase]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ── Load overview (all zones + all movements) ─────────────────────────────
  const loadOverview = useCallback(async () => {
    if (!mat140 || !mat110) return;
    setLoadingOverview(true);
    const [zonesRes, movRes] = await Promise.all([
      supabase.from("install_job_zones").select("*"),
      supabase.from("stock_movements").select("ref_job_no,material_id,type,qty")
        .in("material_id", [mat140.id, mat110.id])
        .not("ref_job_no", "is", null),
    ]);

    const zonesMap: Record<string, Zone[]> = {};
    (zonesRes.data ?? []).forEach((z) => {
      if (!zonesMap[z.job_no]) zonesMap[z.job_no] = [];
      zonesMap[z.job_no].push(z);
    });
    setOverviewZonesMap(zonesMap);

    const movMap: Record<string, StockSummary> = {};
    (movRes.data ?? []).forEach((row) => {
      if (!row.ref_job_no) return;
      if (!movMap[row.ref_job_no]) movMap[row.ref_job_no] = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0 };
      const q = Number(row.qty);
      const s = movMap[row.ref_job_no];
      if (row.material_id === mat140.id) {
        if (row.type === "out") s.issued_140 += q;
        else if (row.type === "return") s.returned_140 += q;
      } else if (row.material_id === mat110.id) {
        if (row.type === "out") s.issued_110 += q;
        else if (row.type === "return") s.returned_110 += q;
      }
    });
    setOverviewMovMap(movMap);
    setLoadingOverview(false);
  }, [mat140, mat110, supabase]);

  useEffect(() => { if (mat140 && mat110) loadOverview(); }, [mat140, mat110, loadOverview]);

  // ── Load per-job detail ───────────────────────────────────────────────────
  const fetchZones = useCallback(async (jobNo: string) => {
    const { data, error } = await supabase.from("install_job_zones").select("*").eq("job_no", jobNo).order("created_at");
    if (error) toast.error("โหลด zone ไม่ได้: " + error.message);
    setZones(data ?? []);
  }, [supabase]);

  const fetchStock = useCallback(async (jobNo: string) => {
    if (!mat140 || !mat110) return;
    const { data } = await supabase.from("stock_movements").select("type,qty,material_id")
      .eq("ref_job_no", jobNo).in("material_id", [mat140.id, mat110.id]);
    const s: StockSummary = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0 };
    (data ?? []).forEach((row) => {
      const q = Number(row.qty);
      if (row.material_id === mat140.id) {
        if (row.type === "out") s.issued_140 += q;
        else if (row.type === "return") s.returned_140 += q;
      } else if (row.material_id === mat110.id) {
        if (row.type === "out") s.issued_110 += q;
        else if (row.type === "return") s.returned_110 += q;
      }
    });
    setStockSummary(s);
  }, [mat140, mat110, supabase]);

  useEffect(() => {
    if (!selectedJobNo) return;
    setStockSummary(null);
    fetchZones(selectedJobNo);
    fetchStock(selectedJobNo);
  }, [selectedJobNo, fetchZones, fetchStock]);

  // ── Zone CRUD ─────────────────────────────────────────────────────────────
  const addZone = async () => {
    if (!selectedJobNo || addingZone) return;
    setAddingZone(true);
    const idx = zones.length + 1;
    const { data, error } = await supabase.from("install_job_zones")
      .insert({ job_no: selectedJobNo, zone_name: `โซน ${idx}`, width_cm: 0, length_cm: 0 }).select().single();
    setAddingZone(false);
    if (error) { toast.error("เพิ่ม zone ไม่ได้: " + error.message); return; }
    if (data) setZones((prev) => [...prev, data]);
  };

  const patchZone = (id: string, field: keyof Zone, value: string | number) =>
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, [field]: value } : z)));

  const saveZone = async (zone: Zone) => {
    if (zone.width_cm < 0 || zone.length_cm < 0) return;
    setSavingZone(zone.id);
    const { error } = await supabase.from("install_job_zones")
      .update({ zone_name: zone.zone_name, width_cm: zone.width_cm, length_cm: zone.length_cm, updated_at: new Date().toISOString() })
      .eq("id", zone.id);
    setSavingZone(null);
    if (error) toast.error("บันทึกไม่ได้: " + error.message);
  };

  const deleteZone = async (id: string) => {
    const { error } = await supabase.from("install_job_zones").delete().eq("id", id);
    if (error) { toast.error("ลบไม่ได้: " + error.message); return; }
    setZones((prev) => prev.filter((z) => z.id !== id));
  };

  // ── Computed: detail ──────────────────────────────────────────────────────
  const expected = useMemo(() => sumZones(zones), [zones]);
  const wasteCalc = useMemo(() => {
    if (!stockSummary || (stockSummary.issued_140 === 0 && stockSummary.issued_110 === 0)) return null;
    const actual140 = stockSummary.issued_140 - stockSummary.returned_140;
    const actual110 = stockSummary.issued_110 - stockSummary.returned_110;
    return {
      actual140, actual110,
      waste140: expected.total140 > 0 ? ((actual140 - expected.total140) / expected.total140) * 100 : null,
      waste110: expected.total110 > 0 ? ((actual110 - expected.total110) / expected.total110) * 100 : null,
    };
  }, [stockSummary, expected]);

  // ── Computed: overview ────────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter((j) =>
      j.job_no?.toLowerCase().includes(q) || j.customer_name?.toLowerCase().includes(q) || j.product_name?.toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const overviewRows = useMemo(() => {
    const c140 = mat140?.unit_cost ?? 0;
    const c110 = mat110?.unit_cost ?? 0;
    return filteredJobs.map((j) => {
      const jzones = overviewZonesMap[j.job_no] ?? [];
      const mov = overviewMovMap[j.job_no] ?? null;
      const exp = sumZones(jzones);
      const actual140 = mov ? mov.issued_140 - mov.returned_140 : null;
      const actual110 = mov ? mov.issued_110 - mov.returned_110 : null;
      const waste140 = mov && exp.total140 > 0 && actual140 !== null ? ((actual140 - exp.total140) / exp.total140) * 100 : null;
      const waste110 = mov && exp.total110 > 0 && actual110 !== null ? ((actual110 - exp.total110) / exp.total110) * 100 : null;
      const expectedCost = exp.total140 * c140 + exp.total110 * c110;
      const actualCost = actual140 !== null && actual110 !== null ? actual140 * c140 + actual110 * c110 : null;
      const wasteCost = actualCost !== null ? actualCost - expectedCost : null;
      const hasMov = mov !== null && (mov.issued_140 > 0 || mov.issued_110 > 0);
      return { ...j, zoneCount: jzones.length, exp140: exp.total140, exp110: exp.total110, actual140, actual110, waste140, waste110, expectedCost: expectedCost > 0 ? expectedCost : null, actualCost, wasteCost, hasZones: jzones.length > 0, hasMov };
    });
  }, [filteredJobs, overviewZonesMap, overviewMovMap, mat140, mat110]);

  const stats = useMemo(() => {
    const withCostSetup = !!(mat140?.unit_cost && mat110?.unit_cost);
    const totalWasteCost = overviewRows.reduce((s, r) => s + (r.wasteCost ?? 0), 0);
    return {
      total: jobs.length,
      withZones: overviewRows.filter((r) => r.hasZones).length,
      withData: overviewRows.filter((r) => r.hasMov).length,
      totalWasteCost,
      withCostSetup,
    };
  }, [overviewRows, jobs.length, mat140, mat110]);

  const selectedJob = jobs.find((j) => j.job_no === selectedJobNo);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full gap-4 min-h-0">

      {/* ── Left: Job list ── */}
      <div className="w-64 flex-shrink-0 flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="p-3 border-b border-slate-100 bg-slate-50 space-y-2">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ต้นทุนเศษ</h2>
          <button
            onClick={() => { setViewMode("overview"); setSelectedJobNo(null); }}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              viewMode === "overview" ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            🏠 ภาพรวมทั้งหมด
          </button>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา…"
            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingJobs ? (
            <p className="text-xs text-slate-400 text-center py-8">⏳ กำลังโหลด…</p>
          ) : filteredJobs.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">ไม่พบงาน</p>
          ) : filteredJobs.map((j) => {
            const hasZones = (overviewZonesMap[j.job_no]?.length ?? 0) > 0;
            const mov = overviewMovMap[j.job_no];
            const hasMov = !!mov && (mov.issued_140 > 0 || mov.issued_110 > 0);
            return (
              <button key={j.job_no} onClick={() => { setSelectedJobNo(j.job_no); setViewMode("detail"); }}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition-colors ${
                  selectedJobNo === j.job_no && viewMode === "detail" ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <StatusDot hasZones={hasZones} hasMov={hasMov} />
                  <p className="text-[10px] font-mono text-blue-600 truncate">{j.job_no}</p>
                </div>
                <p className="text-xs font-medium text-slate-800 truncate">{j.customer_name || "—"}</p>
                <p className="text-[11px] text-slate-400 truncate">{j.product_name || "—"}</p>
              </button>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex gap-3 text-[9px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />ครบ</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />มีโซน</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-200 inline-block" />ยังไม่มี</span>
        </div>
      </div>

      {/* ── Right ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ===== OVERVIEW ===== */}
        {viewMode === "overview" && (
          <div className="space-y-4 pb-8">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-slate-800">📊 Dashboard ต้นทุนเศษ</h1>
                <p className="text-xs text-slate-400 mt-0.5">เปรียบเทียบวัสดุที่ควรใช้ vs เบิกจริง ทุกงาน</p>
              </div>
              <button onClick={loadOverview} disabled={loadingOverview}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 disabled:opacity-50">
                {loadingOverview ? "⏳" : "↻ รีเฟรช"}
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "งานทั้งหมด", val: stats.total.toString(), sub: "รายการ" },
                { label: "มีข้อมูลโซน", val: stats.withZones.toString(), sub: "งาน" },
                { label: "มีข้อมูลเบิก", val: stats.withData.toString(), sub: "งาน" },
                {
                  label: "รวมต้นทุนเศษ",
                  val: stats.withCostSetup ? (stats.totalWasteCost >= 0 ? "+" : "") + fmtBaht(stats.totalWasteCost) : "—",
                  sub: stats.withCostSetup ? (stats.totalWasteCost >= 0 ? "เกินประมาณ" : "ต่ำกว่าประมาณ") : "ยังไม่ตั้งราคา",
                  red: stats.totalWasteCost > 0,
                },
              ].map((c) => (
                <div key={c.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-[10px] text-slate-400 mb-1">{c.label}</p>
                  <p className={`text-xl font-bold ${(c as {red?: boolean}).red ? "text-red-600" : "text-slate-800"}`}>{c.val}</p>
                  <p className="text-[10px] text-slate-400">{c.sub}</p>
                </div>
              ))}
            </div>

            {/* Warning if no unit cost */}
            {!stats.withCostSetup && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
                💡 ยังไม่ได้ตั้งราคาต้นทุนวัสดุ — ไปที่ <strong>คลังวัสดุ</strong> แล้วแก้ไข unit_cost ของ <strong>RS-140</strong> / <strong>RS-110</strong> เพื่อให้คำนวณต้นทุนเป็น ฿ ได้
              </div>
            )}

            {/* Main table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {["Job No.", "ลูกค้า", "โซน", "ควรใช้ 140", "ควรใช้ 110", "เบิก 140", "เบิก 110", "%เศษ 140", "%เศษ 110", "ต้นทุนที่ควร", "ต้นทุนเศษ"].map((h, i) => (
                        <th key={h} className={`px-3 py-2.5 font-medium text-slate-500 ${i >= 2 ? "text-right" : "text-left"} ${i === 7 || i === 8 ? "text-center" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {loadingOverview ? (
                      <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">⏳ กำลังโหลด…</td></tr>
                    ) : overviewRows.length === 0 ? (
                      <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">ไม่มีข้อมูล</td></tr>
                    ) : overviewRows.map((r) => (
                      <tr key={r.job_no}
                        className={`cursor-pointer transition-colors ${r.hasZones ? "hover:bg-blue-50/40" : "opacity-40"}`}
                        onClick={() => { setSelectedJobNo(r.job_no); setViewMode("detail"); }}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <StatusDot hasZones={r.hasZones} hasMov={r.hasMov} />
                            <span className="font-mono text-blue-600">{r.job_no}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 max-w-[130px] truncate">{r.customer_name || "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          {r.zoneCount > 0 ? <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{r.zoneCount}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600">{r.exp140 > 0 ? fmtCm(r.exp140) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600">{r.exp110 > 0 ? fmtCm(r.exp110) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700">{r.actual140 !== null ? fmtCm(r.actual140) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700">{r.actual110 !== null ? fmtCm(r.actual110) : "—"}</td>
                        <td className="px-3 py-2.5 text-center"><WasteBadge pct={r.waste140} /></td>
                        <td className="px-3 py-2.5 text-center"><WasteBadge pct={r.waste110} /></td>
                        <td className="px-3 py-2.5 text-right text-slate-400">{r.expectedCost !== null ? fmtBaht(r.expectedCost) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {r.wasteCost !== null ? (
                            <span className={r.wasteCost > 0 ? "text-red-600" : "text-green-600"}>
                              {r.wasteCost > 0 ? "+" : "-"}{fmtBaht(r.wasteCost)}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===== DETAIL ===== */}
        {viewMode === "detail" && (
          !selectedJobNo ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
              <span className="text-4xl">♻️</span>
              <p className="text-sm">เลือกงานจากรายการซ้ายมือ</p>
            </div>
          ) : (
            <div className="space-y-4 pb-8">
              <button onClick={() => setViewMode("overview")} className="text-xs text-blue-500 hover:underline">
                ← กลับภาพรวม
              </button>

              {/* Job header */}
              <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
                <p className="text-[11px] font-mono text-blue-500 mb-0.5">{selectedJob?.job_no}</p>
                <h1 className="text-lg font-semibold text-slate-800">{selectedJob?.customer_name || "—"}</h1>
                <p className="text-sm text-slate-500 mt-0.5">{selectedJob?.product_name || "—"}</p>
              </div>

              {/* Zone editor */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-700">📐 ขนาดพื้นที่แต่ละโซน</h2>
                  <button onClick={addZone} disabled={addingZone}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60">
                    {addingZone ? "กำลังเพิ่ม…" : "+ เพิ่มโซน"}
                  </button>
                </div>

                {zones.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <p className="text-sm">ยังไม่มีข้อมูล Zone</p>
                    <p className="text-xs mt-1">กด &ldquo;+ เพิ่มโซน&rdquo; แล้วกรอกขนาดพื้นที่</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] text-slate-400 uppercase tracking-wide border-b border-slate-100">
                          <th className="pb-2 text-left font-medium">ชื่อโซน</th>
                          <th className="pb-2 text-right font-medium">กว้างสุด</th>
                          <th className="pb-2 text-right font-medium">ยาวสุด</th>
                          <th className="pb-2 text-right font-medium">ควรใช้ 140cm</th>
                          <th className="pb-2 text-right font-medium">ควรใช้ 110cm</th>
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {zones.map((z) => {
                          const calc = z.width_cm > 0 && z.length_cm > 0 ? calcStripsForZone(z.width_cm, z.length_cm) : null;
                          const saving = savingZone === z.id;
                          return (
                            <tr key={z.id}>
                              <td className="py-2 pr-2">
                                <input value={z.zone_name} onChange={(e) => patchZone(z.id, "zone_name", e.target.value)} onBlur={() => saveZone(z)}
                                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </td>
                              <td className="py-2 pr-2">
                                <div className="flex items-center justify-end gap-1">
                                  <input type="number" min={0} value={z.width_cm || ""} onChange={(e) => patchZone(z.id, "width_cm", Number(e.target.value))} onBlur={() => saveZone(z)} placeholder="0"
                                    className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                  <span className="text-[10px] text-slate-400">cm</span>
                                </div>
                              </td>
                              <td className="py-2 pr-2">
                                <div className="flex items-center justify-end gap-1">
                                  <input type="number" min={0} value={z.length_cm || ""} onChange={(e) => patchZone(z.id, "length_cm", Number(e.target.value))} onBlur={() => saveZone(z)} placeholder="0"
                                    className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                  <span className="text-[10px] text-slate-400">cm</span>
                                </div>
                              </td>
                              <td className="py-2 pr-2 text-right">
                                {calc ? <span className="text-xs font-mono text-slate-700">{fmtCm(calc.total140)} cm <span className="text-slate-400">×{calc.n140}</span></span> : <span className="text-xs text-slate-300">—</span>}
                              </td>
                              <td className="py-2 pr-2 text-right">
                                {calc ? <span className="text-xs font-mono text-slate-700">{fmtCm(calc.total110)} cm <span className="text-slate-400">×{calc.n110}</span></span> : <span className="text-xs text-slate-300">—</span>}
                              </td>
                              <td className="py-2 text-right">
                                {saving ? <span className="text-[10px] text-blue-400">💾</span>
                                  : <button onClick={() => deleteZone(z.id)} className="text-slate-300 hover:text-red-500 text-xs transition-colors">✕</button>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {zones.length > 1 && (
                        <tfoot>
                          <tr className="border-t-2 border-slate-200">
                            <td colSpan={3} className="pt-2 text-xs font-semibold text-slate-600">รวมทุกโซน</td>
                            <td className="pt-2 text-right text-xs font-semibold font-mono">{expected.total140 > 0 ? `${fmtCm(expected.total140)} cm` : "—"}</td>
                            <td className="pt-2 text-right text-xs font-semibold font-mono">{expected.total110 > 0 ? `${fmtCm(expected.total110)} cm` : "—"}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>

              {/* Waste analysis */}
              {(expected.total140 > 0 || expected.total110 > 0) && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">📊 วิเคราะห์ต้นทุนเศษ</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: "แผ่นกว้าง 140 cm", exp: expected.total140, issued: stockSummary?.issued_140 ?? null, ret: stockSummary?.returned_140 ?? null, actual: wasteCalc?.actual140 ?? null, waste: wasteCalc?.waste140 ?? null, uc: mat140?.unit_cost ?? 0 },
                      { label: "แผ่นกว้าง 110 cm", exp: expected.total110, issued: stockSummary?.issued_110 ?? null, ret: stockSummary?.returned_110 ?? null, actual: wasteCalc?.actual110 ?? null, waste: wasteCalc?.waste110 ?? null, uc: mat110?.unit_cost ?? 0 },
                    ].map((m) => {
                      const wasteCostVal = m.uc > 0 && m.actual !== null ? (m.actual - m.exp) * m.uc : null;
                      return (
                        <div key={m.label} className="border border-slate-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-slate-500 mb-1.5">{m.label}</p>
                          <StatRow label="ควรใช้" value={m.exp} />
                          <StatRow label="เบิกไป" value={m.issued} />
                          <StatRow label="คืนมา" value={m.ret} />
                          <StatRow label="ใช้จริง" value={m.actual} bold />
                          {wasteCostVal !== null && (
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs text-slate-500">ต้นทุนเศษ</span>
                              <span className={`text-xs font-semibold font-mono ${wasteCostVal > 0 ? "text-red-600" : "text-green-600"}`}>
                                {wasteCostVal > 0 ? "+" : "-"}{fmtBaht(wasteCostVal)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between items-center pt-2 border-t border-slate-100 mt-1">
                            <span className="text-xs font-semibold text-slate-700">% เศษ</span>
                            <WasteBadge pct={m.waste} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {stockSummary && stockSummary.issued_140 === 0 && stockSummary.issued_110 === 0 && (
                    <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ ยังไม่มีการบันทึกรายการเบิกวัสดุสำหรับงานนี้<br />
                      <span className="text-amber-600">→ ไปที่ <strong>คลังวัสดุ</strong> → จ่ายออก → RS-140/RS-110 → ระบุ Job No. <strong>{selectedJobNo}</strong></span>
                    </p>
                  )}

                  <div className="mt-3 pt-3 border-t border-slate-100 flex gap-4 text-[10px] text-slate-400">
                    <span className="text-green-600 font-medium">■ ≤5%</span>
                    <span className="text-amber-600 font-medium">■ 5–15%</span>
                    <span className="text-red-600 font-medium">■ &gt;15%</span>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

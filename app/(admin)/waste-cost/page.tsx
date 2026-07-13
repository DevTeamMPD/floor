"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Zone { id: string; job_no: string; zone_name: string; width_cm: number; length_cm: number; }

interface MaterialItem {
  thickness?: string; color?: string;
  widthCm?: "110" | "140" | "";
  lengthCm?: string; qty?: string;
}
interface ReturnItem {
  thickness?: string; color?: string;
  widthCm?: "110" | "140" | "";
  lengthCm?: string; qty?: string;
}
interface HandoverData {
  materials?: MaterialItem[];
  returnItems?: ReturnItem[];
  notes?: string;
  savedAt?: string;
}

interface Job {
  job_no: string;
  bill_no: string | null;
  order_no: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  product_name: string | null;
  appt_date: string | null;
  stage: number;
  // handover_data can be: null | JSON string (TEXT col) | parsed object (JSONB col)
  handover_data: unknown;
}

interface Material { id: string; sku: string; unit_cost: number | null; }

interface StockSummary {
  issued_140: number; returned_140: number;
  issued_110: number; returned_110: number;
}

interface Movement {
  id: string;
  material_id: string;
  type: string;
  qty: number;
  note: string | null;
  created_at: string;
}

interface StripCalc { n140: number; n110: number; total140: number; total110: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Parse handover_data → StockSummary
 * Handles:
 *   - null / undefined
 *   - JSON string  (Supabase TEXT column)
 *   - Already-parsed object (Supabase JSONB column)
 * qty defaults to 1 if empty — matches drawer's `(Number(mat.qty) || 1)` behavior
 */
function parseHandoverSummary(raw: unknown): StockSummary | null {
  if (!raw) return null;
  try {
    let h: HandoverData;
    if (typeof raw === "string") {
      h = JSON.parse(raw) as HandoverData;
    } else if (typeof raw === "object") {
      h = raw as HandoverData;
    } else {
      return null;
    }

    const s: StockSummary = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0 };
    let hasData = false;

    for (const m of h.materials ?? []) {
      const qty = Number(m.qty) || 1; // match drawer: empty qty = 1 roll
      const len = Number(m.lengthCm ?? 0);
      if (len > 0) {
        if (m.widthCm === "140") { s.issued_140 += qty * len; hasData = true; }
        if (m.widthCm === "110") { s.issued_110 += qty * len; hasData = true; }
      }
    }
    for (const r of h.returnItems ?? []) {
      const qty = Number(r.qty) || 1; // match drawer: empty qty = 1 roll
      const len = Number(r.lengthCm ?? 0);
      if (len > 0) {
        if (r.widthCm === "140") { s.returned_140 += qty * len; hasData = true; }
        if (r.widthCm === "110") { s.returned_110 += qty * len; hasData = true; }
      }
    }
    return hasData ? s : null;
  } catch {
    return null;
  }
}

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
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

const STAGE_LABEL: Record<number, { label: string; cls: string }> = {
  1: { label: "รับงาน", cls: "bg-slate-100 text-slate-600" },
  2: { label: "นัดงาน", cls: "bg-blue-100 text-blue-700" },
  3: { label: "กำลังดำเนิน", cls: "bg-amber-100 text-amber-700" },
  4: { label: "รอดำเนิน", cls: "bg-yellow-100 text-yellow-700" },
  5: { label: "ติดตั้งแล้ว", cls: "bg-emerald-100 text-emerald-700" },
  6: { label: "รอปิด", cls: "bg-purple-100 text-purple-700" },
  7: { label: "ปิดงาน", cls: "bg-green-100 text-green-700" },
};

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

function StageBadge({ stage }: { stage: number }) {
  const s = STAGE_LABEL[stage] ?? { label: `Stage ${stage}`, cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}

function SourceBadge({ source }: { source: "handover" | "manual" | "none" }) {
  if (source === "handover") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      ✓ จาก tab ปิดงาน
    </span>
  );
  if (source === "manual") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
      ✎ บันทึกด้วยตนเอง
    </span>
  );
  return null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WasteCostPage() {
  const supabase = createClient();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [mat140, setMat140] = useState<Material | null>(null);
  const [mat110, setMat110] = useState<Material | null>(null);
  const [search, setSearch] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);

  const [overviewZonesMap, setOverviewZonesMap] = useState<Record<string, Zone[]>>({});
  const [loadingOverview, setLoadingOverview] = useState(false);

  const [viewMode, setViewMode] = useState<"overview" | "detail">("overview");

  const [selectedJobNo, setSelectedJobNo] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);
  const [stockSource, setStockSource] = useState<"handover" | "manual" | "none">("none");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [savingZone, setSavingZone] = useState<string | null>(null);
  const [addingZone, setAddingZone] = useState(false);

  const [movType, setMovType] = useState<"out" | "return">("out");
  const [movMat, setMovMat] = useState<"140" | "110">("140");
  const [movQty, setMovQty] = useState("");
  const [movNote, setMovNote] = useState("");
  const [savingMov, setSavingMov] = useState(false);

  // ── Load materials ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("materials").select("id,sku,unit_cost").in("sku", ["RS-140", "RS-110"]).then(({ data }) => {
      (data ?? []).forEach((m) => {
        if (m.sku === "RS-140") setMat140(m);
        if (m.sku === "RS-110") setMat110(m);
      });
    });
  }, []);

  // ── Load all jobs (with handover_data) ───────────────────────────────────
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    const { data } = await supabase
      .from("install_jobs")
      .select("job_no,bill_no,order_no,customer_name,customer_phone,address,product_name,appt_date,stage,handover_data")
      .order("created_at", { ascending: false });
    setJobs((data ?? []) as Job[]);
    setLoadingJobs(false);
  }, [supabase]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ── Load overview zones ───────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    const { data: zonesData } = await supabase.from("install_job_zones").select("*");
    const zonesMap: Record<string, Zone[]> = {};
    (zonesData ?? []).forEach((z) => {
      if (!zonesMap[z.job_no]) zonesMap[z.job_no] = [];
      zonesMap[z.job_no].push(z);
    });
    setOverviewZonesMap(zonesMap);
    setLoadingOverview(false);
  }, [supabase]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // ── Load per-job detail ───────────────────────────────────────────────────
  const fetchZones = useCallback(async (jobNo: string) => {
    const { data, error } = await supabase.from("install_job_zones").select("*").eq("job_no", jobNo).order("created_at");
    if (error) toast.error("โหลด zone ไม่ได้: " + error.message);
    setZones(data ?? []);
  }, [supabase]);

  const fetchStock = useCallback(async (jobNo: string, job: Job) => {
    if (!mat140 || !mat110) return;

    // 1. Primary: handover_data (handles TEXT string OR JSONB object)
    const handoverSummary = parseHandoverSummary(job.handover_data);
    if (handoverSummary) {
      setStockSummary(handoverSummary);
      setStockSource("handover");
    }

    // 2. Always load stock_movements for manual override history
    const { data } = await supabase
      .from("stock_movements")
      .select("id,material_id,type,qty,note,created_at")
      .eq("ref_job_no", jobNo)
      .in("material_id", [mat140.id, mat110.id])
      .order("created_at", { ascending: false });
    setMovements(data ?? []);

    // 3. Fallback to stock_movements if no handover data
    if (!handoverSummary) {
      const s: StockSummary = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0 };
      let hasData = false;
      (data ?? []).forEach((row) => {
        const q = Number(row.qty);
        if (row.material_id === mat140.id) {
          if (row.type === "out") { s.issued_140 += q; hasData = true; }
          else if (row.type === "return") { s.returned_140 += q; hasData = true; }
        } else if (row.material_id === mat110.id) {
          if (row.type === "out") { s.issued_110 += q; hasData = true; }
          else if (row.type === "return") { s.returned_110 += q; hasData = true; }
        }
      });
      setStockSummary(hasData ? s : null);
      setStockSource(hasData ? "manual" : "none");
    }
  }, [mat140, mat110, supabase]);

  useEffect(() => {
    if (!selectedJobNo) return;
    const job = jobs.find((j) => j.job_no === selectedJobNo);
    if (!job) return;
    setStockSummary(null);
    setMovements([]);
    setStockSource("none");
    fetchZones(selectedJobNo);
    fetchStock(selectedJobNo, job);
  }, [selectedJobNo, jobs, fetchZones, fetchStock]);

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
      .update({ zone_name: zone.zone_name, width_cm: zone.width_cm, length_cm: zone.length_cm })
      .eq("id", zone.id);
    setSavingZone(null);
    if (error) toast.error("บันทึกไม่ได้: " + error.message);
  };

  const deleteZone = async (id: string) => {
    const { error } = await supabase.from("install_job_zones").delete().eq("id", id);
    if (error) { toast.error("ลบไม่ได้: " + error.message); return; }
    setZones((prev) => prev.filter((z) => z.id !== id));
  };

  // ── Manual stock movement ─────────────────────────────────────────────────
  const saveMovement = async () => {
    if (!selectedJobNo || !movQty || Number(movQty) <= 0) {
      toast.error("กรอกจำนวนให้ถูกต้อง (> 0)"); return;
    }
    const matId = movMat === "140" ? mat140?.id : mat110?.id;
    if (!matId) { toast.error("ไม่พบข้อมูลวัสดุ"); return; }
    setSavingMov(true);
    const { error } = await supabase.from("stock_movements").insert({
      material_id: matId, type: movType, qty: Number(movQty),
      ref_job_no: selectedJobNo, note: movNote.trim() || null,
    });
    setSavingMov(false);
    if (error) { toast.error("บันทึกไม่ได้: " + error.message); return; }
    toast.success(`บันทึก${movType === "out" ? "เบิก" : "คืน"} RS-${movMat} ${movQty} cm แล้ว`);
    setMovQty(""); setMovNote("");
    const job = jobs.find((j) => j.job_no === selectedJobNo);
    if (job && selectedJobNo) fetchStock(selectedJobNo, job);
  };

  const deleteMovement = async (id: string) => {
    const { error } = await supabase.from("stock_movements").delete().eq("id", id);
    if (error) { toast.error("ลบไม่ได้: " + error.message); return; }
    const job = jobs.find((j) => j.job_no === selectedJobNo);
    if (job && selectedJobNo) fetchStock(selectedJobNo, job);
    toast.success("ลบรายการแล้ว");
  };

  // ── Computed ──────────────────────────────────────────────────────────────
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

  const filteredJobs = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter((j) =>
      j.job_no?.toLowerCase().includes(q) ||
      (j.bill_no as string | null)?.toLowerCase().includes(q) ||
      (j.order_no as string | null)?.toLowerCase().includes(q) ||
      (j.customer_name as string | null)?.toLowerCase().includes(q) ||
      (j.product_name as string | null)?.toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const overviewRows = useMemo(() => {
    const c140 = mat140?.unit_cost ?? 0;
    const c110 = mat110?.unit_cost ?? 0;
    return filteredJobs.map((j) => {
      const jzones = overviewZonesMap[j.job_no] ?? [];
      const mov = parseHandoverSummary(j.handover_data);
      const exp = sumZones(jzones);
      const actual140 = mov ? mov.issued_140 - mov.returned_140 : null;
      const actual110 = mov ? mov.issued_110 - mov.returned_110 : null;
      const waste140 = mov && exp.total140 > 0 && actual140 !== null ? ((actual140 - exp.total140) / exp.total140) * 100 : null;
      const waste110 = mov && exp.total110 > 0 && actual110 !== null ? ((actual110 - exp.total110) / exp.total110) * 100 : null;
      const expectedCost = exp.total140 * c140 + exp.total110 * c110;
      const actualCost = actual140 !== null && actual110 !== null ? actual140 * c140 + actual110 * c110 : null;
      const wasteCost = actualCost !== null ? actualCost - expectedCost : null;
      return {
        ...j, zoneCount: jzones.length, exp140: exp.total140, exp110: exp.total110,
        actual140, actual110, waste140, waste110,
        expectedCost: expectedCost > 0 ? expectedCost : null,
        actualCost, wasteCost,
        hasZones: jzones.length > 0,
        hasMov: mov !== null,
      };
    });
  }, [filteredJobs, overviewZonesMap, mat140, mat110]);

  const stats = useMemo(() => {
    const withCostSetup = !!(mat140?.unit_cost && mat110?.unit_cost);
    const totalWasteCost = overviewRows.reduce((s, r) => s + (r.wasteCost ?? 0), 0);
    return {
      total: jobs.length,
      withZones: overviewRows.filter((r) => r.hasZones).length,
      withData: overviewRows.filter((r) => r.hasMov).length,
      totalWasteCost, withCostSetup,
    };
  }, [overviewRows, jobs.length, mat140, mat110]);

  const selectedJob = jobs.find((j) => j.job_no === selectedJobNo);

  // ─── Render ───────────────────────────────────────────────────────────────
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา บิล / ออเดอร์ / ลูกค้า…"
            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingJobs ? (
            <p className="text-xs text-slate-400 text-center py-8">⏳ กำลังโหลด…</p>
          ) : filteredJobs.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">ไม่พบงาน</p>
          ) : filteredJobs.map((j) => {
            const hasZones = (overviewZonesMap[j.job_no]?.length ?? 0) > 0;
            const hasMov = parseHandoverSummary(j.handover_data) !== null;
            return (
              <button key={j.job_no} onClick={() => { setSelectedJobNo(j.job_no); setViewMode("detail"); }}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition-colors ${
                  selectedJobNo === j.job_no && viewMode === "detail" ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <StatusDot hasZones={hasZones} hasMov={hasMov} />
                  <p className="text-xs font-semibold text-slate-800 truncate">
                    {(j.bill_no as string | null) || j.job_no}
                  </p>
                </div>
                <p className="text-[10px] font-mono text-blue-500 mb-0.5 pl-3">{j.job_no}</p>
                <p className="text-[11px] text-slate-500 truncate pl-3">{(j.customer_name as string | null) || "—"}</p>
                <p className="text-[10px] text-slate-400 truncate pl-3">{(j.product_name as string | null) || "—"}</p>
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

      {/* ── Right panel ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ===== OVERVIEW ===== */}
        {viewMode === "overview" && (
          <div className="space-y-4 pb-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-slate-800">📊 Dashboard ต้นทุนเศษ</h1>
                <p className="text-xs text-slate-400 mt-0.5">ข้อมูลเบิก-คืนดึงจาก tab ปิดงาน โดยอัตโนมัติ</p>
              </div>
              <button onClick={loadOverview} disabled={loadingOverview}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 disabled:opacity-50">
                {loadingOverview ? "⏳" : "↻ รีเฟรช"}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "งานทั้งหมด", val: stats.total.toString(), sub: "รายการ" },
                { label: "มีข้อมูลโซน", val: stats.withZones.toString(), sub: "งาน" },
                { label: "มีข้อมูลปิดงาน", val: stats.withData.toString(), sub: "งาน" },
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

            {!stats.withCostSetup && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
                💡 ยังไม่ได้ตั้งราคาต้นทุนวัสดุ — ไปที่ <strong>คลังวัสดุ</strong> แล้วแก้ไข unit_cost ของ <strong>RS-140</strong> / <strong>RS-110</strong>
              </div>
            )}

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-xs text-emerald-700">
              ✓ ข้อมูลเบิก-คืนดึงจาก <strong>tab ปิดงาน</strong> อัตโนมัติ — ไม่ต้องกรอกซ้ำ
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium text-slate-500">บิล / Job No.</th>
                      <th className="text-left px-3 py-2.5 font-medium text-slate-500">ลูกค้า</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">โซน</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ควรใช้ 140</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ควรใช้ 110</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">เบิก 140</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">เบิก 110</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">%เศษ 140</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">%เศษ 110</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ต้นทุนที่ควร</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ต้นทุนเศษ</th>
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
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">{(r.bill_no as string | null) || r.job_no}</p>
                              {r.bill_no && <p className="font-mono text-blue-500 text-[9px]">{r.job_no}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 max-w-[120px] truncate">{(r.customer_name as string | null) || "—"}</td>
                        <td className="px-3 py-2.5 text-center">
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

              {/* ── Job info card ── */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">เลขบิล</p>
                    <p className="text-xl font-bold text-slate-900 leading-tight">
                      {(selectedJob?.bill_no as string | null) || <span className="text-slate-400 text-sm font-normal">ไม่มีเลขบิล</span>}
                    </p>
                    <p className="text-[11px] font-mono text-blue-500 mt-0.5">{selectedJob?.job_no}</p>
                  </div>
                  {selectedJob && <StageBadge stage={selectedJob.stage} />}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className="text-slate-400 text-[10px] mb-0.5">ลูกค้า</p>
                    <p className="font-medium text-slate-800">{(selectedJob?.customer_name as string | null) || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] mb-0.5">เบอร์โทร</p>
                    <p className="font-medium text-slate-800">{(selectedJob?.customer_phone as string | null) || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] mb-0.5">ออเดอร์</p>
                    <p className="font-mono text-blue-600">{(selectedJob?.order_no as string | null) || "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] mb-0.5">วันนัด</p>
                    <p className="text-slate-800">{fmtDate((selectedJob?.appt_date as string | null) ?? null)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-400 text-[10px] mb-0.5">ที่อยู่</p>
                    <p className="text-slate-700 leading-snug">{(selectedJob?.address as string | null) || "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-400 text-[10px] mb-0.5">สินค้า</p>
                    <p className="text-slate-700">{(selectedJob?.product_name as string | null) || "—"}</p>
                  </div>
                </div>
              </div>

              {/* ── Zone editor ── */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-700">📐 ขนาดพื้นที่แต่ละโซน</h2>
                  <button onClick={addZone} disabled={addingZone}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60">
                    {addingZone ? "กำลังเพิ่ม…" : "+ เพิ่มโซน"}
                  </button>
                </div>

                {zones.length === 0 ? (
                  <div className="text-center py-6 text-slate-400">
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
                                {savingZone === z.id ? <span className="text-[10px] text-blue-400">💾</span>
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

              {/* ── Stock section ── */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-700">📦 ปริมาณเบิก-คืนวัสดุ</h2>
                  <SourceBadge source={stockSource} />
                </div>

                {stockSource === "handover" && (
                  <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">
                    ข้อมูลดึงจาก <strong>tab ปิดงาน</strong> อัตโนมัติ — แก้ไขได้ที่ tab ปิดงาน แล้วรีโหลดหน้านี้
                  </div>
                )}

                {!stockSummary ? (
                  <p className="text-xs text-slate-400 text-center py-4">
                    ยังไม่มีข้อมูลเบิก-คืน — บันทึกรายการส่งมอบใน <strong>tab ปิดงาน</strong> ก่อน
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {[
                      { label: "เบิก RS-140", val: stockSummary.issued_140, cls: "text-red-600" },
                      { label: "คืน RS-140", val: stockSummary.returned_140, cls: "text-blue-600" },
                      { label: "เบิก RS-110", val: stockSummary.issued_110, cls: "text-red-600" },
                      { label: "คืน RS-110", val: stockSummary.returned_110, cls: "text-blue-600" },
                    ].map((s) => (
                      <div key={s.label} className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                        <p className="text-[10px] text-slate-400">{s.label}</p>
                        <p className={`text-sm font-bold font-mono ${s.cls}`}>{fmtCm(s.val)} cm</p>
                      </div>
                    ))}
                  </div>
                )}

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600 select-none py-1">
                    ✎ บันทึกรายการเพิ่มเติมด้วยตนเอง (override)
                  </summary>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap gap-2 items-end mb-3">
                      <div>
                        <p className="text-[10px] text-slate-400 mb-1">ประเภท</p>
                        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                          <button onClick={() => setMovType("out")} className={`px-3 py-1.5 font-medium transition-colors ${movType === "out" ? "bg-red-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>▼ เบิก</button>
                          <button onClick={() => setMovType("return")} className={`px-3 py-1.5 font-medium transition-colors ${movType === "return" ? "bg-blue-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>↩ คืน</button>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 mb-1">วัสดุ</p>
                        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                          <button onClick={() => setMovMat("140")} className={`px-3 py-1.5 font-medium transition-colors ${movMat === "140" ? "bg-slate-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>RS-140</button>
                          <button onClick={() => setMovMat("110")} className={`px-3 py-1.5 font-medium transition-colors ${movMat === "110" ? "bg-slate-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>RS-110</button>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 mb-1">จำนวน (cm)</p>
                        <div className="flex items-center gap-1">
                          <input type="number" min={1} value={movQty} onChange={(e) => setMovQty(e.target.value)} placeholder="0"
                            className="w-24 px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          <span className="text-[10px] text-slate-400">cm</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-28">
                        <p className="text-[10px] text-slate-400 mb-1">หมายเหตุ</p>
                        <input value={movNote} onChange={(e) => setMovNote(e.target.value)} placeholder="เช่น แก้ไขเพิ่มเติม"
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </div>
                      <button onClick={saveMovement} disabled={savingMov || !movQty}
                        className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${movType === "out" ? "bg-red-500 hover:bg-red-600 text-white" : "bg-blue-500 hover:bg-blue-600 text-white"}`}>
                        {savingMov ? "บันทึก…" : movType === "out" ? "▼ บันทึกเบิก" : "↩ บันทึกคืน"}
                      </button>
                    </div>
                    {movements.length > 0 && (
                      <table className="w-full text-xs">
                        <thead><tr className="text-[10px] text-slate-400 border-b border-slate-100">
                          <th className="pb-1.5 text-left">วันที่</th><th className="pb-1.5 text-left">ประเภท</th>
                          <th className="pb-1.5 text-left">วัสดุ</th><th className="pb-1.5 text-right">จำนวน</th>
                          <th className="pb-1.5 text-left">หมายเหตุ</th><th></th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-50">
                          {movements.map((m) => (
                            <tr key={m.id} className="hover:bg-slate-50">
                              <td className="py-1.5 pr-3 text-slate-500 whitespace-nowrap">
                                {new Date(m.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                              </td>
                              <td className="py-1.5 pr-3">
                                {m.type === "out" ? <span className="text-red-600 font-medium">▼ เบิก</span> : <span className="text-blue-600 font-medium">↩ คืน</span>}
                              </td>
                              <td className="py-1.5 pr-3 font-mono text-slate-700">RS-{m.material_id === mat140?.id ? "140" : "110"}</td>
                              <td className="py-1.5 pr-3 text-right font-mono font-semibold">{fmtCm(Number(m.qty))} cm</td>
                              <td className="py-1.5 pr-3 text-slate-400">{m.note || "—"}</td>
                              <td className="py-1.5 text-right">
                                <button onClick={() => deleteMovement(m.id)} className="text-slate-300 hover:text-red-500 transition-colors text-xs">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </details>
              </div>

              {/* ── Waste analysis ── */}
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
                          {[
                            { label: "ควรใช้", val: m.exp },
                            { label: "เบิกไป", val: m.issued },
                            { label: "คืนมา", val: m.ret },
                          ].map((r) => (
                            <div key={r.label} className="flex justify-between items-center py-1">
                              <span className="text-xs text-slate-500">{r.label}</span>
                              <span className="text-xs font-mono">{r.val === null ? "—" : `${fmtCm(r.val)} cm`}</span>
                            </div>
                          ))}
                          <div className="flex justify-between items-center py-1 border-t border-slate-100 mt-1">
                            <span className="text-xs font-semibold text-slate-700">ใช้จริง</span>
                            <span className="text-xs font-semibold font-mono">{m.actual === null ? "—" : `${fmtCm(m.actual)} cm`}</span>
                          </div>
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

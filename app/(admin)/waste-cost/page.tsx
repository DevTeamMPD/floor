"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Obstacle { id: string; name: string; width_cm: number; length_cm: number; deduct: boolean; }
interface GridData { type: "grid"; cell_cm: number; rows: number; cols: number; blocked: number[]; }
interface Zone { id: string; job_no: string; zone_name: string; width_cm: number; length_cm: number; obstacles: (Obstacle | GridData)[]; }

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

interface EditRow {
  _localId: string;
  widthCm: "110" | "140" | "";
  lengthCm: string;
  qty: string;
  thickness: string;
  color: string;
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
interface RemnantPiece { id: string; width_bin: number; length_cm: number; mat_type: string; status: string; reserved_for: string | null; source_job: string | null; note: string | null; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseHandoverSummary(raw: unknown): StockSummary | null {
  if (!raw) return null;
  try {
    let h: HandoverData;
    if (typeof raw === "string") h = JSON.parse(raw) as HandoverData;
    else if (typeof raw === "object") h = raw as HandoverData;
    else return null;

    const s: StockSummary = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0 };
    let hasData = false;
    for (const m of h.materials ?? []) {
      const qty = Number(m.qty) || 1;
      const len = Number(m.lengthCm ?? 0);
      if (len > 0) {
        if (m.widthCm === "140") { s.issued_140 += qty * len; hasData = true; }
        if (m.widthCm === "110") { s.issued_110 += qty * len; hasData = true; }
      }
    }
    for (const r of h.returnItems ?? []) {
      const qty = Number(r.qty) || 1;
      const len = Number(r.lengthCm ?? 0);
      if (len > 0) {
        if (r.widthCm === "140") { s.returned_140 += qty * len; hasData = true; }
        if (r.widthCm === "110") { s.returned_110 += qty * len; hasData = true; }
      }
    }
    return hasData ? s : null;
  } catch { return null; }
}

function parseHandoverData(raw: unknown): HandoverData {
  if (!raw) return { materials: [], returnItems: [] };
  try {
    if (typeof raw === "string") return JSON.parse(raw) as HandoverData;
    if (typeof raw === "object") return raw as HandoverData;
  } catch { /* ignore */ }
  return { materials: [], returnItems: [] };
}

function makeEditRow(): EditRow {
  return { _localId: Math.random().toString(36).slice(2), widthCm: "140", lengthCm: "", qty: "1", thickness: "", color: "" };
}

function handoverToEditRows(items: (MaterialItem | ReturnItem)[]): EditRow[] {
  return items.map((m) => ({
    _localId: Math.random().toString(36).slice(2),
    widthCm: (m.widthCm ?? "") as "110" | "140" | "",
    lengthCm: m.lengthCm ?? "",
    qty: m.qty ?? "1",
    thickness: m.thickness ?? "",
    color: m.color ?? "",
  }));
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

function getStripLen(dimA: number, dimB: number): number {
  function singleOrient(sLen: number, cover: number) {
    const nP = Math.floor(cover / 250); const rem = cover % 250;
    let n140 = nP, n110 = nP;
    if (rem > 0 && rem <= 110) n110 += 1;
    else if (rem > 110) { n140 += 1; n110 += 1; }
    return n140 * sLen + n110 * sLen;
  }
  return singleOrient(dimA, dimB) <= singleOrient(dimB, dimA) ? dimA : dimB;
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

function getZoneNetArea(zone: Zone): number {
  const raw = zone.width_cm * zone.length_cm;
  if (!zone.obstacles?.length) return raw;
  const grid = zone.obstacles.find((o): o is GridData => (o as GridData).type === "grid");
  if (grid) return Math.max(0, raw - grid.blocked.length * grid.cell_cm * grid.cell_cm);
  const ded = (zone.obstacles as Obstacle[]).filter(o => o.deduct).reduce((s, o) => s + o.width_cm * o.length_cm, 0);
  return Math.max(0, raw - ded);
}

function fmtCm(n: number) { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtBaht(n: number) { return "฿" + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtM2(cm2: number) { return (cm2 / 10000).toFixed(2) + " m²"; }
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
  const [availableRemnants, setAvailableRemnants] = useState<RemnantPiece[]>([]);
  const [reservingRemnant, setReservingRemnant] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [savingObstacles, setSavingObstacles] = useState<string | null>(null);
  const [gridCellCm, setGridCellCm] = useState<Record<string, number>>({});

  // ── Handover editor state ─────────────────────────────────────────────────
  const [showHandoverEdit, setShowHandoverEdit] = useState(false);
  const [editMats, setEditMats] = useState<EditRow[]>([]);
  const [editRets, setEditRets] = useState<EditRow[]>([]);
  const [savingHandover, setSavingHandover] = useState(false);
  const [handoverTab, setHandoverTab] = useState<"mat" | "ret">("mat");

  // ── Manual movement state ─────────────────────────────────────────────────
  const [showMovForm, setShowMovForm] = useState(false);
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

  // ── Load all jobs ─────────────────────────────────────────────────────────
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
    setZones((data ?? []).map(z => ({ ...z, obstacles: (z.obstacles as Obstacle[]) ?? [] })));
  }, [supabase]);

  const fetchRemnants = useCallback(async () => {
    const { data } = await supabase.from("remnant_stock").select("*").eq("status", "available").order("width_bin").order("length_cm");
    setAvailableRemnants(data ?? []);
  }, [supabase]);

  const fetchStock = useCallback(async (jobNo: string, job: Job) => {
    const handoverSummary = parseHandoverSummary(job.handover_data);
    if (handoverSummary) {
      setStockSummary(handoverSummary);
      setStockSource("handover");
    }
    if (!mat140 || !mat110) return;
    const { data } = await supabase
      .from("stock_movements")
      .select("id,material_id,type,qty,note,created_at")
      .eq("ref_job_no", jobNo)
      .in("material_id", [mat140.id, mat110.id])
      .order("created_at", { ascending: false });
    setMovements(data ?? []);
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
    if (!selectedJobNo) { setShowHandoverEdit(false); return; }
    const job = jobs.find((j) => j.job_no === selectedJobNo);
    if (!job) return;
    setStockSummary(null);
    setMovements([]);
    setStockSource("none");
    setShowHandoverEdit(false);
    setExpandedZones(new Set());
    // Populate editor
    const h = parseHandoverData(job.handover_data);
    setEditMats(handoverToEditRows(h.materials ?? []));
    setEditRets(handoverToEditRows(h.returnItems ?? []));
    fetchZones(selectedJobNo);
    fetchStock(selectedJobNo, job);
    fetchRemnants();
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

  // ── Obstacle CRUD ─────────────────────────────────────────────────────────
  const addObstacle = (zoneId: string) =>
    setZones(prev => prev.map(z => z.id === zoneId ? {
      ...z, obstacles: [...z.obstacles, { id: Math.random().toString(36).slice(2), name: "", width_cm: 0, length_cm: 0, deduct: true }]
    } : z));

  const patchObstacle = (zoneId: string, obsId: string, field: keyof Obstacle, value: string | number | boolean) =>
    setZones(prev => prev.map(z => z.id === zoneId ? {
      ...z, obstacles: z.obstacles.map(o => o.id === obsId ? { ...o, [field]: value } : o)
    } : z));

  const deleteObstacle = (zoneId: string, obsId: string) =>
    setZones(prev => prev.map(z => z.id === zoneId ? {
      ...z, obstacles: z.obstacles.filter(o => o.id !== obsId)
    } : z));

  const saveObstacles = async (zone: Zone) => {
    setSavingObstacles(zone.id);
    const { error } = await supabase.from("install_job_zones")
      .update({ obstacles: zone.obstacles }).eq("id", zone.id);
    setSavingObstacles(null);
    if (error) toast.error("บันทึกไม่ได้: " + error.message);
    else toast.success("บันทึกตารางแล้ว");
  };

  const toggleGridCell = (zone: Zone, idx: number) => {
    const cellCm = gridCellCm[zone.id] ?? 50;
    const cols = Math.max(1, Math.ceil(zone.width_cm / cellCm));
    const rows = Math.max(1, Math.ceil(zone.length_cm / cellCm));
    setZones(prev => prev.map(z => {
      if (z.id !== zone.id) return z;
      const existing = z.obstacles?.find((o): o is GridData => (o as GridData).type === "grid");
      const newBlocked = existing
        ? (existing.blocked.includes(idx) ? existing.blocked.filter(i => i !== idx) : [...existing.blocked, idx])
        : [idx];
      return { ...z, obstacles: [{ type: "grid" as const, cell_cm: cellCm, rows, cols, blocked: newBlocked }] };
    }));
  };

  const changeCellSize = (zone: Zone, newCellCm: number) => {
    setGridCellCm(prev => ({ ...prev, [zone.id]: newCellCm }));
    setZones(prev => prev.map(z => {
      if (z.id !== zone.id) return z;
      const cols = Math.max(1, Math.ceil(z.width_cm / newCellCm));
      const rows = Math.max(1, Math.ceil(z.length_cm / newCellCm));
      return { ...z, obstacles: [{ type: "grid" as const, cell_cm: newCellCm, rows, cols, blocked: [] }] };
    }));
  };

  const clearGrid = (zone: Zone) => {
    const cellCm = gridCellCm[zone.id] ?? 50;
    const cols = Math.max(1, Math.ceil(zone.width_cm / cellCm));
    const rows = Math.max(1, Math.ceil(zone.length_cm / cellCm));
    setZones(prev => prev.map(z => z.id !== zone.id ? z : {
      ...z, obstacles: [{ type: "grid" as const, cell_cm: cellCm, rows, cols, blocked: [] }]
    }));
  };

  // ── Handover editor ───────────────────────────────────────────────────────
  const patchMat = (id: string, field: keyof EditRow, val: string) =>
    setEditMats((prev) => prev.map((r) => (r._localId === id ? { ...r, [field]: val } : r)));
  const patchRet = (id: string, field: keyof EditRow, val: string) =>
    setEditRets((prev) => prev.map((r) => (r._localId === id ? { ...r, [field]: val } : r)));

  const saveHandoverEdit = async () => {
    if (!selectedJobNo) return;
    setSavingHandover(true);
    const job = jobs.find((j) => j.job_no === selectedJobNo);
    const existing = parseHandoverData(job?.handover_data);
    const newHandover: HandoverData = {
      ...existing,
      materials: editMats.map((r) => ({
        widthCm: r.widthCm, lengthCm: r.lengthCm, qty: r.qty,
        thickness: r.thickness || undefined, color: r.color || undefined,
      })),
      returnItems: editRets.map((r) => ({
        widthCm: r.widthCm, lengthCm: r.lengthCm, qty: r.qty,
        thickness: r.thickness || undefined, color: r.color || undefined,
      })),
      savedAt: new Date().toISOString(),
    };
    const jsonStr = JSON.stringify(newHandover);
    const { error } = await supabase.from("install_jobs")
      .update({ handover_data: jsonStr }).eq("job_no", selectedJobNo);
    setSavingHandover(false);
    if (error) { toast.error("บันทึกไม่ได้: " + error.message); return; }
    setJobs((prev) => prev.map((j) => j.job_no === selectedJobNo ? { ...j, handover_data: jsonStr } : j));
    const summary = parseHandoverSummary(jsonStr);
    setStockSummary(summary);
    setStockSource(summary ? "handover" : "none");
    toast.success("บันทึกข้อมูลเบิก-คืนแล้ว");
    setShowHandoverEdit(false);
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

  const totalZoneArea = useMemo(() =>
    zones.reduce((s, z) => s + (z.width_cm > 0 && z.length_cm > 0 ? getZoneNetArea(z) : 0), 0),
    [zones]
  );
  const totalRawZoneArea = useMemo(() =>
    zones.reduce((s, z) => s + (z.width_cm > 0 && z.length_cm > 0 ? z.width_cm * z.length_cm : 0), 0),
    [zones]
  );
  const totalObstacleArea = totalRawZoneArea - totalZoneArea;

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

  const totalActualArea = useMemo(() => {
    if (!wasteCalc) return null;
    return wasteCalc.actual140 * 140 + wasteCalc.actual110 * 110;
  }, [wasteCalc]);

  const wasteAreaCm2 = totalActualArea !== null && totalZoneArea > 0
    ? totalActualArea - totalZoneArea : null;

  const wasteAreaPct = wasteAreaCm2 !== null && totalZoneArea > 0
    ? (wasteAreaCm2 / totalZoneArea) * 100 : null;

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
      // area
      const zoneArea = jzones.reduce((s, z) => s + (z.width_cm > 0 && z.length_cm > 0 ? z.width_cm * z.length_cm : 0), 0);
      const actArea = actual140 !== null && actual110 !== null ? actual140 * 140 + actual110 * 110 : null;
      const wasteArea = actArea !== null && zoneArea > 0 ? actArea - zoneArea : null;
      const wasteAreaPct = wasteArea !== null && zoneArea > 0 ? (wasteArea / zoneArea) * 100 : null;
      return {
        ...j, zoneCount: jzones.length, exp140: exp.total140, exp110: exp.total110,
        actual140, actual110, waste140, waste110,
        expectedCost: expectedCost > 0 ? expectedCost : null,
        actualCost, wasteCost,
        zoneArea, actArea, wasteArea, wasteAreaPct,
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
                💡 ยังไม่ได้ตั้งราคาต้นทุน — ไปที่ <strong>คลังวัสดุ</strong> แล้วแก้ไข unit_cost ของ <strong>RS-140</strong> / <strong>RS-110</strong>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium text-slate-500">บิล / Job No.</th>
                      <th className="text-left px-3 py-2.5 font-medium text-slate-500">ลูกค้า</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">โซน</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">พื้นที่โซน (m²)</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">พื้นที่จริง (m²)</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">%เศษพื้นที่</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">%เศษ 140</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">%เศษ 110</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ต้นทุนเศษ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {loadingOverview ? (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">⏳ กำลังโหลด…</td></tr>
                    ) : overviewRows.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">ไม่มีข้อมูล</td></tr>
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
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600">
                          {r.zoneArea > 0 ? fmtM2(r.zoneArea) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {r.actArea !== null ? fmtM2(r.actArea) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center"><WasteBadge pct={r.wasteAreaPct} /></td>
                        <td className="px-3 py-2.5 text-center"><WasteBadge pct={r.waste140} /></td>
                        <td className="px-3 py-2.5 text-center"><WasteBadge pct={r.waste110} /></td>
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

              {/* ── Job info ── */}
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
                          <th className="pb-2 text-right font-medium">พื้นที่</th>
                          <th className="pb-2 text-right font-medium">ควรใช้ 140cm</th>
                          <th className="pb-2 text-right font-medium">ควรใช้ 110cm</th>
                          <th className="pb-2 text-center font-medium">สิ่งกีดขวาง</th>
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {zones.map((z) => {
                          const calc = z.width_cm > 0 && z.length_cm > 0 ? calcStripsForZone(z.width_cm, z.length_cm) : null;
                          const netArea = z.width_cm > 0 && z.length_cm > 0 ? getZoneNetArea(z) : 0;
                          const rawArea = z.width_cm > 0 && z.length_cm > 0 ? z.width_cm * z.length_cm : 0;
                          const dedArea = rawArea - netArea;
                          const isExpanded = expandedZones.has(z.id);
                          return (
                            <>
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
                              <td className="py-2 pr-2 text-right text-xs font-mono text-slate-500">
                                {netArea > 0 ? (
                                  <span>
                                    {fmtM2(netArea)}
                                    {dedArea > 0 && <span className="text-[9px] text-orange-500 ml-1">-{fmtM2(dedArea)}</span>}
                                  </span>
                                ) : "—"}
                              </td>
                              <td className="py-2 pr-2 text-right">
                                {calc ? <span className="text-xs font-mono text-slate-700">{fmtCm(calc.total140)} cm <span className="text-slate-400">×{calc.n140}</span></span> : <span className="text-xs text-slate-300">—</span>}
                              </td>
                              <td className="py-2 pr-2 text-right">
                                {calc ? <span className="text-xs font-mono text-slate-700">{fmtCm(calc.total110)} cm <span className="text-slate-400">×{calc.n110}</span></span> : <span className="text-xs text-slate-300">—</span>}
                              </td>
                              <td className="py-2 text-center">
                                <button
                                  onClick={() => setExpandedZones(prev => {
                                    const next = new Set(prev);
                                    if (next.has(z.id)) next.delete(z.id); else next.add(z.id);
                                    return next;
                                  })}
                                  className={`px-2 py-0.5 text-xs rounded transition-colors ${isExpanded ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100"}`}
                                  title="ตีตารางพื้นที่ไม่ปู"
                                >
                                  {(() => {
                                    const g = z.obstacles?.find((o): o is GridData => (o as GridData).type === "grid");
                                    return g && g.blocked.length > 0 ? `🧱 ${g.blocked.length}` : "🧱";
                                  })()}
                                </button>
                              </td>
                              <td className="py-2 text-right">
                                {savingZone === z.id ? <span className="text-[10px] text-blue-400">💾</span>
                                  : <button onClick={() => deleteZone(z.id)} className="text-slate-300 hover:text-red-500 text-xs transition-colors">✕</button>}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={z.id + "-obs"} className="bg-orange-50/40">
                                <td colSpan={8} className="px-4 py-3">
                                  {z.width_cm <= 0 || z.length_cm <= 0 ? (
                                    <p className="text-[11px] text-slate-400">กรอกขนาดโซนก่อนเพื่อสร้างตาราง</p>
                                  ) : (() => {
                                    const cellCm = gridCellCm[z.id] ?? 50;
                                    const cols = Math.max(1, Math.ceil(z.width_cm / cellCm));
                                    const rows = Math.max(1, Math.ceil(z.length_cm / cellCm));
                                    const gridEntry = z.obstacles?.find((o): o is GridData => (o as GridData).type === "grid");
                                    const blocked = gridEntry?.blocked ?? [];
                                    const blockedArea = blocked.length * cellCm * cellCm;
                                    const maxPx = 360;
                                    const cellPx = Math.max(14, Math.min(32, Math.floor(maxPx / cols)));
                                    return (
                                      <div>
                                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                                          <span className="text-[11px] font-semibold text-orange-700">🧱 ตีตารางพื้นที่ไม่ปู</span>
                                          <span className="text-[10px] text-slate-400">ขนาดเซลล์:</span>
                                          {[25, 50, 100].map(sz => (
                                            <button key={sz} onClick={() => changeCellSize(z, sz)}
                                              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${cellCm === sz ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-500 border-slate-200 hover:bg-orange-50"}`}
                                            >{sz} cm</button>
                                          ))}
                                          <span className="text-[10px] text-slate-400 ml-1">{cols}×{rows} เซลล์</span>
                                        </div>

                                        <div className="flex gap-4 items-start">
                                          {/* Grid */}
                                          <div className="flex-shrink-0">
                                            <div className="text-[9px] text-slate-400 mb-1 flex justify-between" style={{width: cols * (cellPx + 2) + "px"}}>
                                              <span>← {z.width_cm} cm →</span>
                                            </div>
                                            <div className="inline-grid gap-0.5" style={{gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`}}>
                                              {Array.from({ length: rows * cols }).map((_, idx) => (
                                                <div
                                                  key={idx}
                                                  onClick={() => toggleGridCell(z, idx)}
                                                  style={{width: cellPx, height: cellPx}}
                                                  className={`border cursor-pointer rounded-[2px] transition-colors ${
                                                    blocked.includes(idx)
                                                      ? "bg-orange-400 border-orange-500 hover:bg-orange-500"
                                                      : "bg-slate-100 border-slate-200 hover:bg-blue-100 hover:border-blue-300"
                                                  }`}
                                                  title={`เซลล์ ${Math.floor(idx/cols)+1},${(idx%cols)+1} — ${blocked.includes(idx) ? "ไม่ปู (คลิกยกเลิก)" : "ปู (คลิกเพื่อทำเครื่องหมาย)"}`}
                                                />
                                              ))}
                                            </div>
                                            <div className="text-[9px] text-slate-400 mt-1">{z.length_cm} cm ↕</div>
                                          </div>

                                          {/* Legend + stats */}
                                          <div className="flex flex-col gap-2 text-[11px] min-w-[140px]">
                                            <div className="flex items-center gap-2">
                                              <span className="w-3 h-3 bg-slate-100 border border-slate-200 rounded-[2px] flex-shrink-0 inline-block"/>
                                              <span className="text-slate-600">ปู ({rows * cols - blocked.length} เซลล์)</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="w-3 h-3 bg-orange-400 rounded-[2px] flex-shrink-0 inline-block"/>
                                              <span className="text-orange-700">ไม่ปู ({blocked.length} เซลล์)</span>
                                            </div>
                                            <div className="border-t border-orange-100 pt-2 mt-1 space-y-1">
                                              <div className="flex justify-between gap-3">
                                                <span className="text-slate-500">พื้นที่โซน</span>
                                                <span className="font-mono text-slate-700">{fmtM2(z.width_cm * z.length_cm)}</span>
                                              </div>
                                              {blockedArea > 0 && (
                                                <div className="flex justify-between gap-3">
                                                  <span className="text-orange-600">หักออก</span>
                                                  <span className="font-mono text-orange-600">-{fmtM2(blockedArea)}</span>
                                                </div>
                                              )}
                                              <div className="flex justify-between gap-3 font-semibold border-t border-orange-200 pt-1">
                                                <span className="text-slate-700">สุทธิ</span>
                                                <span className="font-mono text-slate-800">{fmtM2(getZoneNetArea(z))}</span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        <div className="flex gap-2 mt-3">
                                          <button onClick={() => saveObstacles(z)} disabled={savingObstacles === z.id}
                                            className="px-3 py-1 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors">
                                            {savingObstacles === z.id ? "บันทึก…" : "💾 บันทึก"}
                                          </button>
                                          {blocked.length > 0 && (
                                            <button onClick={() => clearGrid(z)}
                                              className="px-3 py-1 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors">
                                              ล้างทั้งหมด
                                            </button>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-2">
                                          💡 คลิกเซลล์สีเทาเพื่อทำเครื่องหมายพื้นที่ไม่ปู (เสา / ผนัง) — เซลล์สีส้ม = ตัดออก
                                        </p>
                                      </div>
                                    );
                                  })()}
                                </td>
                              </tr>
                            )}
                            </>
                          );
                        })}
                      </tbody>
                      {zones.length > 0 && (
                        <tfoot>
                          <tr className="border-t-2 border-slate-200">
                            <td colSpan={3} className="pt-2 text-xs font-semibold text-slate-600">รวมทุกโซน</td>
                            <td className="pt-2 text-right text-xs font-semibold font-mono text-slate-700">
                              {totalZoneArea > 0 ? (
                                <span>
                                  {fmtM2(totalZoneArea)}
                                  {totalObstacleArea > 0 && <span className="text-[9px] text-orange-500 block">-{fmtM2(totalObstacleArea)} สิ่งกีดขวาง</span>}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="pt-2 text-right text-xs font-semibold font-mono">{expected.total140 > 0 ? `${fmtCm(expected.total140)} cm` : "—"}</td>
                            <td className="pt-2 text-right text-xs font-semibold font-mono">{expected.total110 > 0 ? `${fmtCm(expected.total110)} cm` : "—"}</td>
                            <td></td>
                            <td></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>

              {/* ── Remnant suggestions ── */}
              {(() => {
                const suggestions = zones
                  .filter((z) => z.width_cm > 0 && z.length_cm > 0)
                  .map((z) => {
                    const calc = calcStripsForZone(z.width_cm, z.length_cm);
                    const stripLen = getStripLen(z.width_cm, z.length_cm);
                    const matches140 = calc.n140 > 0
                      ? availableRemnants.filter((r) => r.width_bin >= 140 && r.length_cm >= stripLen)
                      : [];
                    const matches110 = calc.n110 > 0
                      ? availableRemnants.filter((r) => r.width_bin >= 110 && r.length_cm >= stripLen && !matches140.find((x) => x.id === r.id))
                      : [];
                    return { zone: z, stripLen, matches140, matches110 };
                  })
                  .filter((s) => s.matches140.length > 0 || s.matches110.length > 0);
                if (suggestions.length === 0) return null;
                return (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-teal-800 mb-3">💡 เศษที่ใช้แทนได้</h2>
                    <div className="space-y-3">
                      {suggestions.map(({ zone: z, stripLen, matches140, matches110 }) => (
                        <div key={z.id} className="bg-white rounded-lg border border-teal-100 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-semibold text-slate-700">{z.zone_name}</span>
                            <span className="text-[10px] text-slate-400">ต้องยาว ≥ {stripLen} cm</span>
                          </div>
                          {[...matches140.map((r) => ({ r, forWidth: 140 })), ...matches110.map((r) => ({ r, forWidth: 110 }))].map(({ r, forWidth }) => (
                            <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">{r.width_bin}cm</span>
                                <span className="text-xs font-mono text-slate-700">{r.length_cm} cm</span>
                                <span className="text-[10px] text-slate-400">{r.mat_type}</span>
                                <span className="text-[10px] text-teal-600">→ แทน {forWidth}cm strip</span>
                              </div>
                              <button
                                disabled={reservingRemnant === r.id}
                                onClick={async () => {
                                  setReservingRemnant(r.id);
                                  const { error } = await supabase.from("remnant_stock")
                                    .update({ status: "reserved", reserved_for: selectedJobNo })
                                    .eq("id", r.id);
                                  if (error) toast.error(error.message);
                                  else { toast.success("จองเศษสำหรับงานนี้แล้ว"); fetchRemnants(); }
                                  setReservingRemnant(null);
                                }}
                                className="px-3 py-1 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                              >
                                {reservingRemnant === r.id ? "..." : "จอง"}
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Stock / Handover edit section ── */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-700">📦 ข้อมูลเบิก-คืนวัสดุ</h2>
                    {stockSource === "handover" && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ จาก tab ปิดงาน
                      </span>
                    )}
                    {stockSource === "manual" && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        ✎ บันทึกด้วยตนเอง
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowHandoverEdit((v) => !v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                      showHandoverEdit
                        ? "bg-slate-100 border-slate-200 text-slate-600"
                        : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    {showHandoverEdit ? "✕ ปิด" : "✎ แก้ไขรายการ"}
                  </button>
                </div>

                {/* Summary 4-number grid */}
                {!stockSummary ? (
                  <p className="text-xs text-slate-400 text-center py-4">
                    ยังไม่มีข้อมูลเบิก-คืน — กด <strong>แก้ไขรายการ</strong> เพื่อกรอกข้อมูล หรือบันทึกใน tab ปิดงาน
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

                {/* ── Inline Handover Editor ── */}
                {showHandoverEdit && (
                  <div className="mt-3 border-t border-slate-100 pt-4">
                    <p className="text-xs text-slate-500 mb-3">
                      แก้ไขรายการเบิก-คืนโดยตรง — กดบันทึกเมื่อเสร็จแล้ว ข้อมูลจะ sync กับ tab ปิดงาน
                    </p>

                    {/* Tabs */}
                    <div className="flex gap-1 mb-3">
                      {(["mat", "ret"] as const).map((tab) => (
                        <button key={tab} onClick={() => setHandoverTab(tab)}
                          className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            handoverTab === tab ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}>
                          {tab === "mat" ? `▼ เบิกวัสดุ (${editMats.length})` : `↩ คืนวัสดุ (${editRets.length})`}
                        </button>
                      ))}
                    </div>

                    {/* Mat rows */}
                    {handoverTab === "mat" && (
                      <div>
                        <table className="w-full text-xs mb-2">
                          <thead>
                            <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                              <th className="pb-1.5 text-left font-medium">ความกว้าง</th>
                              <th className="pb-1.5 text-right font-medium">ความยาว (cm)</th>
                              <th className="pb-1.5 text-right font-medium">จำนวน (ม้วน)</th>
                              <th className="pb-1.5 text-left pl-2 font-medium">หนา / สี</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {editMats.length === 0 && (
                              <tr><td colSpan={5} className="py-3 text-center text-slate-300 text-[11px]">ยังไม่มีรายการ</td></tr>
                            )}
                            {editMats.map((r) => (
                              <tr key={r._localId}>
                                <td className="py-1.5 pr-2">
                                  <select value={r.widthCm}
                                    onChange={(e) => patchMat(r._localId, "widthCm", e.target.value as "110" | "140" | "")}
                                    className="px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    <option value="">—</option>
                                    <option value="140">RS-140</option>
                                    <option value="110">RS-110</option>
                                  </select>
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <input type="number" min={0} value={r.lengthCm} onChange={(e) => patchMat(r._localId, "lengthCm", e.target.value)} placeholder="0"
                                    className="w-20 px-2 py-1 border border-slate-200 rounded text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <input type="number" min={1} value={r.qty} onChange={(e) => patchMat(r._localId, "qty", e.target.value)} placeholder="1"
                                    className="w-16 px-2 py-1 border border-slate-200 rounded text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="py-1.5 pl-2">
                                  <div className="flex gap-1">
                                    <input value={r.thickness} onChange={(e) => patchMat(r._localId, "thickness", e.target.value)} placeholder="หนา"
                                      className="w-14 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                    <input value={r.color} onChange={(e) => patchMat(r._localId, "color", e.target.value)} placeholder="สี"
                                      className="w-16 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                  </div>
                                </td>
                                <td className="py-1.5 text-right">
                                  <button onClick={() => setEditMats((p) => p.filter((x) => x._localId !== r._localId))}
                                    className="text-slate-300 hover:text-red-500 transition-colors">✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button onClick={() => setEditMats((p) => [...p, makeEditRow()])}
                          className="text-xs text-blue-500 hover:underline">+ เพิ่มรายการ</button>
                      </div>
                    )}

                    {/* Ret rows */}
                    {handoverTab === "ret" && (
                      <div>
                        <table className="w-full text-xs mb-2">
                          <thead>
                            <tr className="text-[10px] text-slate-400 border-b border-slate-100">
                              <th className="pb-1.5 text-left font-medium">ความกว้าง</th>
                              <th className="pb-1.5 text-right font-medium">ความยาว (cm)</th>
                              <th className="pb-1.5 text-right font-medium">จำนวน (ม้วน)</th>
                              <th className="pb-1.5 text-left pl-2 font-medium">หนา / สี</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {editRets.length === 0 && (
                              <tr><td colSpan={5} className="py-3 text-center text-slate-300 text-[11px]">ยังไม่มีรายการ</td></tr>
                            )}
                            {editRets.map((r) => (
                              <tr key={r._localId}>
                                <td className="py-1.5 pr-2">
                                  <select value={r.widthCm}
                                    onChange={(e) => patchRet(r._localId, "widthCm", e.target.value as "110" | "140" | "")}
                                    className="px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    <option value="">—</option>
                                    <option value="140">RS-140</option>
                                    <option value="110">RS-110</option>
                                  </select>
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <input type="number" min={0} value={r.lengthCm} onChange={(e) => patchRet(r._localId, "lengthCm", e.target.value)} placeholder="0"
                                    className="w-20 px-2 py-1 border border-slate-200 rounded text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="py-1.5 pr-2 text-right">
                                  <input type="number" min={1} value={r.qty} onChange={(e) => patchRet(r._localId, "qty", e.target.value)} placeholder="1"
                                    className="w-16 px-2 py-1 border border-slate-200 rounded text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="py-1.5 pl-2">
                                  <div className="flex gap-1">
                                    <input value={r.thickness} onChange={(e) => patchRet(r._localId, "thickness", e.target.value)} placeholder="หนา"
                                      className="w-14 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                    <input value={r.color} onChange={(e) => patchRet(r._localId, "color", e.target.value)} placeholder="สี"
                                      className="w-16 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                  </div>
                                </td>
                                <td className="py-1.5 text-right">
                                  <button onClick={() => setEditRets((p) => p.filter((x) => x._localId !== r._localId))}
                                    className="text-slate-300 hover:text-red-500 transition-colors">✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button onClick={() => setEditRets((p) => [...p, makeEditRow()])}
                          className="text-xs text-blue-500 hover:underline">+ เพิ่มรายการ</button>
                      </div>
                    )}

                    <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                      <button onClick={saveHandoverEdit} disabled={savingHandover}
                        className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
                        {savingHandover ? "กำลังบันทึก…" : "💾 บันทึก"}
                      </button>
                      <button onClick={() => setShowHandoverEdit(false)}
                        className="px-4 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Manual movement (collapsed) ── */}
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <button onClick={() => setShowMovForm((v) => !v)}
                    className="text-xs text-slate-400 hover:text-slate-600 select-none">
                    {showMovForm ? "▲ ซ่อน" : "▼"} บันทึกรายการ stock_movements เพิ่มเติม
                  </button>
                  {showMovForm && (
                    <div className="mt-3">
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
                  )}
                </div>
              </div>

              {/* ── Area waste summary ── */}
              {totalZoneArea > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-0.5">📐 สรุปเศษพื้นที่โดยรวม</h2>
                  <p className="text-[11px] text-slate-400 mb-4">พื้นที่รวมทุกโซน เทียบกับพื้นที่แผ่นที่ใช้จริง</p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 mb-1">พื้นที่ทุกโซน</p>
                      <p className="text-base font-bold text-slate-700">{fmtM2(totalZoneArea)}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">ที่ควรใช้</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-slate-400 mb-1">พื้นที่แผ่นจริง</p>
                      {totalActualArea !== null ? (
                        <>
                          <p className="text-base font-bold text-slate-700">{fmtM2(totalActualArea)}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">ที่ใช้จริง</p>
                        </>
                      ) : (
                        <p className="text-base font-bold text-slate-300 mt-1">—</p>
                      )}
                    </div>
                    <div className={`rounded-xl p-3 text-center ${
                      wasteAreaCm2 === null ? "bg-slate-50"
                      : wasteAreaCm2 > 0 ? "bg-red-50 border border-red-100"
                      : "bg-green-50 border border-green-100"
                    }`}>
                      <p className="text-[10px] text-slate-400 mb-1">เศษพื้นที่</p>
                      {wasteAreaCm2 !== null ? (
                        <>
                          <p className={`text-base font-bold ${wasteAreaCm2 > 0 ? "text-red-600" : "text-green-600"}`}>
                            {wasteAreaCm2 >= 0 ? "+" : ""}{fmtM2(wasteAreaCm2)}
                          </p>
                          <p className={`text-[10px] mt-0.5 font-medium ${wasteAreaCm2 > 0 ? "text-red-400" : "text-green-400"}`}>
                            {wasteAreaCm2 > 0 ? "เกินความต้องการ" : "น้อยกว่าที่คำนวณ"}
                          </p>
                        </>
                      ) : (
                        <p className="text-base font-bold text-slate-300 mt-1">—</p>
                      )}
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 text-center flex flex-col items-center justify-center">
                      <p className="text-[10px] text-slate-400 mb-2">% เศษพื้นที่</p>
                      <WasteBadge pct={wasteAreaPct} />
                    </div>
                  </div>

                  {wasteAreaCm2 !== null && (
                    <p className="text-[10px] text-slate-300 mt-3">
                      พื้นที่แผ่นจริง = (เบิก RS-140 × 140) + (เบิก RS-110 × 110) หน่วย cm² — พื้นที่โซน = ผลรวม กว้าง × ยาว ทุกโซน
                    </p>
                  )}
                </div>
              )}

              {/* ── Per-strip waste analysis ── */}
              {(expected.total140 > 0 || expected.total110 > 0) && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">📊 วิเคราะห์ต้นทุนเศษ (แยกรายแผ่น)</h2>
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

                  {/* Total cost summary */}
                  {wasteCalc && (mat140?.unit_cost || mat110?.unit_cost) && (() => {
                    const uc140 = mat140?.unit_cost ?? 0;
                    const uc110 = mat110?.unit_cost ?? 0;
                    const expCost = expected.total140 * uc140 + expected.total110 * uc110;
                    const actCost = wasteCalc.actual140 * uc140 + wasteCalc.actual110 * uc110;
                    const totalWaste = actCost - expCost;
                    return (
                      <div className="mt-4 pt-4 border-t-2 border-slate-200">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">สรุปต้นทุน</p>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                            <p className="text-[10px] text-slate-400 mb-0.5">ต้นทุนที่ควร</p>
                            <p className="text-sm font-bold text-slate-700">{fmtBaht(expCost)}</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                            <p className="text-[10px] text-slate-400 mb-0.5">ต้นทุนจริง</p>
                            <p className="text-sm font-bold text-slate-700">{fmtBaht(actCost)}</p>
                          </div>
                          <div className={`rounded-lg px-3 py-2.5 ${totalWaste > 0 ? "bg-red-50" : totalWaste < 0 ? "bg-green-50" : "bg-slate-50"}`}>
                            <p className="text-[10px] text-slate-400 mb-0.5">ต้นทุนเศษสุทธิ์</p>
                            <p className={`text-sm font-bold ${totalWaste > 0 ? "text-red-600" : totalWaste < 0 ? "text-green-600" : "text-slate-500"}`}>
                              {totalWaste > 0 ? "+" : ""}{totalWaste < 0 ? "-" : ""}{fmtBaht(totalWaste)}
                            </p>
                            <p className={`text-[10px] font-medium ${totalWaste > 0 ? "text-red-500" : totalWaste < 0 ? "text-green-500" : "text-slate-400"}`}>
                              {totalWaste > 0 ? "เกินงบ" : totalWaste < 0 ? "ประหยัด" : "ตรงงบ"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

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

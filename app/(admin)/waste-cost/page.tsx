"use client";
import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import {
  normalizeBillReference,
  parseWasteSalesSummary,
  wasteCostToSalesPercent,
  type WasteSalesSummary,
} from "@/lib/waste-sales";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Obstacle { id: string; name: string; width_cm: number; length_cm: number; deduct: boolean; }
interface CellData { w?: number; l?: number; blocked?: boolean; }
  interface GridData { type: "grid"; cell_cm: number; rows: number; cols: number; blocked: number[]; cellData?: Record<string, CellData>; }
interface Zone { id: string; job_no: string; zone_name: string; width_cm: number; length_cm: number; obstacles: (Obstacle | GridData)[]; }

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

interface MaterialItem {
  thickness?: string; color?: string;
  widthCm?: string;
  lengthCm?: string; qty?: string;
}
interface ReturnItem {
  thickness?: string; color?: string;
  widthCm?: string;
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
  widthCm: string;
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

interface WasteAnalysisExclusion {
  job_no: string;
  reason: string;
  excluded_at: string;
}

interface Material { id: string; sku: string; unit_cost: number | null; }

interface StockSummary {
  issued_140: number; returned_140: number;
  issued_110: number; returned_110: number;
  byWidth: Record<string, { issued: number; returned: number }>;
}

interface SheetCostSummary {
  issued16: number;
  returned16: number;
  net16: number;
  issued06: number;
  returned06: number;
  net06: number;
  costExVat: number | null;
}

interface Movement {
  id: string;
  material_id: string;
  type: string;
  qty: number;
  note: string | null;
  created_at: string;
}

interface StripCalc { n140: number; n110: number; total140: number; total110: number; effStripLen: number; }
interface RemnantPiece { id: string; width_bin: number; length_cm: number; mat_type: string; status: string; reserved_for: string | null; source_job: string | null; note: string | null; }

const IS_LOCAL_PREVIEW = process.env.NODE_ENV !== "production";
const VAT_RATE = 0.07;
const SHEET_COST_EX_VAT = { "1.6": 750, "0.6": 550 } as const;

const LOCAL_PREVIEW_JOBS: Job[] = [
  {
    job_no: "ORD-LOCAL-287992", bill_no: "287992", order_no: "287992",
    customer_name: "ลูกค้าตัวอย่าง — เชื่อมด้วย order_no", customer_phone: "089-000-0001",
    address: "กรุงเทพมหานคร", product_name: "Rollsafe 1.6 cm — Whitebuzz",
    appt_date: "2026-09-03", stage: 5,
    handover_data: { materials: [{ thickness: "1.6", widthCm: "140", lengthCm: "1200", qty: "4" }], returnItems: [{ thickness: "1.6", widthCm: "140", lengthCm: "180", qty: "1" }] },
  },
  {
    job_no: "ORD-LOCAL-286099", bill_no: "286099", order_no: "SP-LOCAL-286099",
    customer_name: "ลูกค้าตัวอย่าง — เชื่อมด้วย bill_no", customer_phone: "089-000-0002",
    address: "สมุทรปราการ", product_name: "Safespace 0.6 cm — Barkley beige",
    appt_date: "2026-09-05", stage: 4,
    handover_data: { materials: [{ thickness: "0.6", widthCm: "110", lengthCm: "1000", qty: "6" }], returnItems: [{ thickness: "0.6", widthCm: "110", lengthCm: "120", qty: "1" }] },
  },
  {
    job_no: "BBPS-32cdf295-824c-4f2d-8562-57b368c186ce", bill_no: "QT-20260827-002", order_no: "QT-20260827-002",
    customer_name: "นายวัฒนชัย ดำรงกิตติกุล", customer_phone: "089-133-0101",
    address: null, product_name: null, appt_date: "2026-09-09", stage: 1, handover_data: null,
  },
];

const LOCAL_PREVIEW_SALES: Record<string, WasteSalesSummary> = {
  "287992": {
    billRef: "287992", matchedVia: "order_no", salesAmount: 1599, netAmount: 1445.4,
    shippingCost: 0, transactionLines: 1, sourceBillNos: ["SP-LOCAL-287992"],
    sourceOrderNos: ["287992"], orderStatuses: ["เสร็จสิ้น"], latestTxnDate: "2026-08-27",
  },
  "286099": {
    billRef: "286099", matchedVia: "bill_no", salesAmount: 36800, netAmount: 33294,
    shippingCost: 500, transactionLines: 3, sourceBillNos: ["286099"],
    sourceOrderNos: ["SP-LOCAL-286099"], orderStatuses: ["เสร็จสิ้น"], latestTxnDate: "2026-08-26",
  },
  "QT-20260827-002": {
    billRef: "QT-20260827-002", matchedVia: "not_found", salesAmount: null, netAmount: null,
    shippingCost: null, transactionLines: 0, sourceBillNos: [], sourceOrderNos: [], orderStatuses: [], latestTxnDate: null,
  },
};

const LOCAL_PREVIEW_ZONES: Record<string, Zone[]> = {
  "ORD-LOCAL-287992": [{ id: "zone-local-1", job_no: "ORD-LOCAL-287992", zone_name: "ห้องนั่งเล่น", width_cm: 420, length_cm: 530, obstacles: [] }],
  "ORD-LOCAL-286099": [{ id: "zone-local-2", job_no: "ORD-LOCAL-286099", zone_name: "ห้องนอน", width_cm: 360, length_cm: 410, obstacles: [] }],
};

const LOCAL_PREVIEW_EXCLUSIONS: Record<string, WasteAnalysisExclusion> = {
  "BBPS-32cdf295-824c-4f2d-8562-57b368c186ce": {
    job_no: "BBPS-32cdf295-824c-4f2d-8562-57b368c186ce",
    reason: "บิลนี้ไม่ต้องการนำมาวิเคราะห์",
    excluded_at: "2026-09-02T00:00:00+07:00",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseHandoverSummary(raw: unknown): StockSummary | null {
  if (!raw) return null;
  try {
    let h: HandoverData;
    if (typeof raw === "string") h = JSON.parse(raw) as HandoverData;
    else if (typeof raw === "object") h = raw as HandoverData;
    else return null;

    const s: StockSummary = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0, byWidth: {} };
    let hasData = false;
    for (const m of h.materials ?? []) {
      const qty = Number(m.qty) || 1;
      const len = Number(m.lengthCm ?? 0);
      const width = Number(m.widthCm ?? 0);
      if (len > 0 && width > 0) {
        const widthKey = String(width);
        s.byWidth[widthKey] ??= { issued: 0, returned: 0 };
        s.byWidth[widthKey].issued += qty * len;
        if (width === 140) s.issued_140 += qty * len;
        if (width === 110) s.issued_110 += qty * len;
        hasData = true;
      }
    }
    for (const r of h.returnItems ?? []) {
      const qty = Number(r.qty) || 1;
      const len = Number(r.lengthCm ?? 0);
      const width = Number(r.widthCm ?? 0);
      if (len > 0 && width > 0) {
        const widthKey = String(width);
        s.byWidth[widthKey] ??= { issued: 0, returned: 0 };
        s.byWidth[widthKey].returned += qty * len;
        if (width === 140) s.returned_140 += qty * len;
        if (width === 110) s.returned_110 += qty * len;
        hasData = true;
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

function materialThickness(value: string | undefined): keyof typeof SHEET_COST_EX_VAT | null {
  const normalized = value?.replace(",", ".").trim() ?? "";
  if (/\b1\.6\b/.test(normalized)) return "1.6";
  if (/\b0\.6\b/.test(normalized)) return "0.6";
  return null;
}

function itemQty(value: string | undefined): number {
  const qty = Number(value ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function calculateSheetCost(raw: unknown): SheetCostSummary {
  const handover = parseHandoverData(raw);
  let issued16 = 0;
  let returned16 = 0;
  let issued06 = 0;
  let returned06 = 0;

  for (const item of handover.materials ?? []) {
    const thickness = materialThickness(item.thickness);
    if (thickness === "1.6") issued16 += itemQty(item.qty);
    if (thickness === "0.6") issued06 += itemQty(item.qty);
  }
  for (const item of handover.returnItems ?? []) {
    const thickness = materialThickness(item.thickness);
    if (thickness === "1.6") returned16 += itemQty(item.qty);
    if (thickness === "0.6") returned06 += itemQty(item.qty);
  }

  const net16 = Math.max(0, issued16 - returned16);
  const net06 = Math.max(0, issued06 - returned06);
  const recognizedSheets = issued16 + returned16 + issued06 + returned06;
  return {
    issued16, returned16, net16, issued06, returned06, net06,
    costExVat: recognizedSheets > 0
      ? net16 * SHEET_COST_EX_VAT["1.6"] + net06 * SHEET_COST_EX_VAT["0.6"]
      : null,
  };
}

function revenueBeforeVat(grossRevenue: number | null): number | null {
  return grossRevenue === null ? null : grossRevenue / (1 + VAT_RATE);
}

function makeEditRow(): EditRow {
  return { _localId: Math.random().toString(36).slice(2), widthCm: "140", lengthCm: "", qty: "1", thickness: "", color: "" };
}

function handoverToEditRows(items: (MaterialItem | ReturnItem)[]): EditRow[] {
  return items.map((m) => ({
    _localId: Math.random().toString(36).slice(2),
    widthCm: m.widthCm ?? "",
    lengthCm: m.lengthCm ?? "",
    qty: m.qty ?? "1",
    thickness: m.thickness ?? "",
    color: m.color ?? "",
  }));
}

function actualAreaFromSummary(summary: StockSummary): number {
  return Object.entries(summary.byWidth).reduce((area, [width, totals]) =>
    area + (totals.issued - totals.returned) * Number(width), 0);
}

interface ObstacleReduction { alongWidth: number; alongLength: number; }

// เมื่อ "ทั้งคอลัมน์" (ตลอดความยาว) หรือ "ทั้งแถว" (ตลอดความกว้าง) ถูกขีดไม่ปูทั้งหมด
// แปลว่าตำแหน่งนั้นตัดแผ่นออกได้เต็มความยาว/กว้าง — ใช้ลดจำนวน cm ที่ต้องเบิกจริง
function getObstacleReduction(zone: Zone): ObstacleReduction {
  const grid = zone.obstacles?.find((o): o is GridData => (o as GridData).type === "grid");
  if (!grid || (!grid.blocked?.length && !grid.cellData)) return { alongWidth: 0, alongLength: 0 };
  const { cell_cm: cellCm, rows, cols, blocked, cellData } = grid;
  const isBlockedAt = (idx: number) => cellData?.[String(idx)]?.blocked ?? blocked.includes(idx);

  let blockedCols = 0;
  for (let c = 0; c < cols; c++) {
    let allBlocked = true;
    for (let r = 0; r < rows; r++) {
      if (!isBlockedAt(r * cols + c)) { allBlocked = false; break; }
    }
    if (allBlocked) blockedCols++;
  }

  let blockedRows = 0;
  for (let r = 0; r < rows; r++) {
    let allBlocked = true;
    for (let c = 0; c < cols; c++) {
      if (!isBlockedAt(r * cols + c)) { allBlocked = false; break; }
    }
    if (allBlocked) blockedRows++;
  }

  return { alongWidth: blockedCols * cellCm, alongLength: blockedRows * cellCm };
}

function calcStripsForZone(dimA: number, dimB: number, reduction?: ObstacleReduction): StripCalc {
  function singleOrient(stripLen: number, cover: number, reduceBy: number): StripCalc {
    const nPairs = Math.floor(cover / 250);
    const rem = cover % 250;
    let n140 = nPairs, n110 = nPairs;
    if (rem > 0 && rem <= 110) n110 += 1;
    else if (rem > 110) { n140 += 1; n110 += 1; }
    const effLen = Math.max(0, stripLen - reduceBy);
    return { n140, n110, total140: n140 * effLen, total110: n110 * effLen, effStripLen: effLen };
  }
  const alongWidth = reduction?.alongWidth ?? 0;
  const alongLength = reduction?.alongLength ?? 0;
  const optA = singleOrient(dimA, dimB, alongWidth);
  const optB = singleOrient(dimB, dimA, alongLength);
  return optA.total140 + optA.total110 <= optB.total140 + optB.total110 ? optA : optB;
}

function getStripLen(dimA: number, dimB: number, reduction?: ObstacleReduction): number {
  return calcStripsForZone(dimA, dimB, reduction).effStripLen;
}

function sumZones(zones: Zone[]) {
  return zones.reduce(
    (acc, z) => {
      if (z.width_cm <= 0 || z.length_cm <= 0) return acc;
      const c = calcStripsForZone(z.width_cm, z.length_cm, getObstacleReduction(z));
      return { total140: acc.total140 + c.total140, total110: acc.total110 + c.total110 };
    },
    { total140: 0, total110: 0 }
  );
}

function getZoneNetArea(zone: Zone): number {
  const raw = zone.width_cm * zone.length_cm;
  if (!zone.obstacles?.length) return raw;
  const grid = zone.obstacles.find((o): o is GridData => (o as GridData).type === "grid");
  if (grid) {
    if (grid.cellData && Object.keys(grid.cellData).length > 0) {
      const totalCells = grid.rows * grid.cols;
      let netArea = 0;
      for (let i = 0; i < totalCells; i++) {
        const cell = grid.cellData[String(i)];
        if (!cell?.blocked) netArea += (cell?.w ?? grid.cell_cm) * (cell?.l ?? grid.cell_cm);
      }
      return Math.max(0, netArea);
    }
    return Math.max(0, raw - grid.blocked.length * grid.cell_cm * grid.cell_cm);
  }
  const ded = (zone.obstacles as Obstacle[]).filter(o => o.deduct).reduce((s, o) => s + o.width_cm * o.length_cm, 0);
  return Math.max(0, raw - ded);
}

function fmtCm(n: number) { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtBaht(n: number) { return "฿" + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtSignedBaht(n: number) { return `${n < 0 ? "-" : ""}${fmtBaht(n)}`; }
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
  const supabase = useMemo(() => createClient(), []);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [salesByBillRef, setSalesByBillRef] = useState<Record<string, WasteSalesSummary>>({});
  const [exclusionsByJobNo, setExclusionsByJobNo] = useState<Record<string, WasteAnalysisExclusion>>({});
  const [showExcluded, setShowExcluded] = useState(false);
  const [exclusionReason, setExclusionReason] = useState("");
  const [savingExclusion, setSavingExclusion] = useState(false);
  const [mat140, setMat140] = useState<Material | null>(null);
  const [mat110, setMat110] = useState<Material | null>(null);
  const [search, setSearch] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [editingAppointment, setEditingAppointment] = useState(false);
  const [appointmentDateDraft, setAppointmentDateDraft] = useState("");
  const [savingAppointment, setSavingAppointment] = useState(false);

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
  const [selectedCell, setSelectedCell] = useState<{ zoneId: string; idx: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ w: string; l: string }>({ w: "50", l: "50" });
  const [dragStart, setDragStart] = useState<{ zoneId: string; idx: number; mode: "block" | "unblock" } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

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
    if (IS_LOCAL_PREVIEW) {
      setMat140({ id: "local-rs-140", sku: "RS-140", unit_cost: null });
      setMat110({ id: "local-rs-110", sku: "RS-110", unit_cost: null });
      return;
    }
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
    if (IS_LOCAL_PREVIEW) {
      setJobs(LOCAL_PREVIEW_JOBS);
      setSalesByBillRef(LOCAL_PREVIEW_SALES);
      setExclusionsByJobNo(LOCAL_PREVIEW_EXCLUSIONS);
      setLoadingJobs(false);
      return;
    }
    const { data, error: jobsError } = await supabase
      .from("install_jobs")
      .select("job_no,bill_no,order_no,customer_name,customer_phone,address,product_name,appt_date,stage,handover_data")
      .order("created_at", { ascending: false });
    if (jobsError) {
      toast.error("โหลดใบงานไม่ได้: " + floorErrorMessage(jobsError));
      setLoadingJobs(false);
      return;
    }

    const loadedJobs = (data ?? []) as Job[];
    setJobs(loadedJobs);

    const [{ data: exclusionRows, error: exclusionsError }, salesResult] = await Promise.all([
      supabase
        .from("floor_waste_analysis_exclusions")
        .select("job_no,reason,excluded_at"),
      (() => {
        const billRefs = Array.from(new Set(
          loadedJobs.map((job) => normalizeBillReference(job.bill_no)).filter(Boolean)
        ));
        return billRefs.length > 0
          ? supabase.rpc("get_floor_waste_sales_summaries", { p_bill_refs: billRefs })
          : Promise.resolve({ data: [], error: null });
      })(),
    ]);

    if (exclusionsError) {
      toast.error("โหลดรายการที่ซ่อนไม่ได้: " + floorErrorMessage(exclusionsError));
    } else {
      const nextExclusions: Record<string, WasteAnalysisExclusion> = {};
      ((exclusionRows ?? []) as WasteAnalysisExclusion[]).forEach((row) => {
        nextExclusions[row.job_no] = row;
      });
      setExclusionsByJobNo(nextExclusions);
    }

    if (salesResult.error) {
      toast.error("โหลดยอดขายไม่ได้: " + floorErrorMessage(salesResult.error));
    } else {
      const nextSales: Record<string, WasteSalesSummary> = {};
      ((salesResult.data ?? []) as Record<string, unknown>[]).forEach((row) => {
        const summary = parseWasteSalesSummary(row);
        if (summary) nextSales[summary.billRef] = summary;
      });
      setSalesByBillRef(nextSales);
    }
    setLoadingJobs(false);
  }, [supabase]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ── Load overview zones ───────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    if (IS_LOCAL_PREVIEW) {
      setOverviewZonesMap(LOCAL_PREVIEW_ZONES);
      setLoadingOverview(false);
      return;
    }
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
    if (IS_LOCAL_PREVIEW) {
      setZones(LOCAL_PREVIEW_ZONES[jobNo] ?? []);
      return;
    }
    const { data, error } = await supabase.from("install_job_zones").select("*").eq("job_no", jobNo).order("created_at");
    if (error) toast.error("โหลด zone ไม่ได้: " + error.message);
    setZones((data ?? []).map(z => ({ ...z, obstacles: (z.obstacles as Obstacle[]) ?? [] })));
  }, [supabase]);

  const fetchRemnants = useCallback(async () => {
    if (IS_LOCAL_PREVIEW) {
      setAvailableRemnants([]);
      return;
    }
    const { data } = await supabase.from("remnant_stock").select("*").eq("status", "available").order("width_bin").order("length_cm");
    setAvailableRemnants(data ?? []);
  }, [supabase]);

  const fetchStock = useCallback(async (jobNo: string, job: Job) => {
    const handoverSummary = parseHandoverSummary(job.handover_data);
    if (handoverSummary) {
      setStockSummary(handoverSummary);
      setStockSource("handover");
    }
    if (IS_LOCAL_PREVIEW) return;
    if (!mat140 || !mat110) return;
    const { data } = await supabase
      .from("stock_movements")
      .select("id,material_id,type,qty,note,created_at")
      .eq("ref_job_no", jobNo)
      .in("material_id", [mat140.id, mat110.id])
      .order("created_at", { ascending: false });
    setMovements(data ?? []);
    if (!handoverSummary) {
      const s: StockSummary = {
        issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0,
        byWidth: { "140": { issued: 0, returned: 0 }, "110": { issued: 0, returned: 0 } },
      };
      let hasData = false;
      (data ?? []).forEach((row) => {
        const q = Number(row.qty);
        if (row.material_id === mat140.id) {
          if (row.type === "out") { s.issued_140 += q; s.byWidth["140"].issued += q; hasData = true; }
          else if (row.type === "return") { s.returned_140 += q; s.byWidth["140"].returned += q; hasData = true; }
        } else if (row.material_id === mat110.id) {
          if (row.type === "out") { s.issued_110 += q; s.byWidth["110"].issued += q; hasData = true; }
          else if (row.type === "return") { s.returned_110 += q; s.byWidth["110"].returned += q; hasData = true; }
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
      ...z, obstacles: z.obstacles.map(o => (o as Obstacle).id === obsId ? { ...o, [field]: value } : o)
    } : z));

  const deleteObstacle = (zoneId: string, obsId: string) =>
    setZones(prev => prev.map(z => z.id === zoneId ? {
      ...z, obstacles: z.obstacles.filter(o => (o as Obstacle).id !== obsId)
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
      const existingCellData: Record<string, CellData> = existing?.cellData ?? {};
      const currentCell = existingCellData[String(idx)];
      const isNowBlocked = !currentCell?.blocked;
      const newCellData = { ...existingCellData, [String(idx)]: { w: currentCell?.w ?? cellCm, l: currentCell?.l ?? cellCm, blocked: isNowBlocked } };
      const newBlocked = Object.entries(newCellData).filter(([, c]) => c.blocked).map(([k]) => parseInt(k));
      return { ...z, obstacles: [{ type: "grid" as const, cell_cm: cellCm, rows, cols, blocked: newBlocked, cellData: newCellData }] };
    }));
  };

  const rectIndices = (startIdx: number, endIdx: number, cols: number) => {
    const sr = Math.floor(startIdx / cols), sc = startIdx % cols;
    const er = Math.floor(endIdx / cols), ec = endIdx % cols;
    const r0 = Math.min(sr, er), r1 = Math.max(sr, er);
    const c0 = Math.min(sc, ec), c1 = Math.max(sc, ec);
    const out: number[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * cols + c);
    return out;
  };

  const setBlockedRange = (zone: Zone, indices: number[], blockedValue: boolean) => {
    const cellCm = gridCellCm[zone.id] ?? 50;
    const cols = Math.max(1, Math.ceil(zone.width_cm / cellCm));
    const rows = Math.max(1, Math.ceil(zone.length_cm / cellCm));
    setZones(prev => prev.map(z => {
      if (z.id !== zone.id) return z;
      const existing = z.obstacles?.find((o): o is GridData => (o as GridData).type === "grid");
      const existingCellData: Record<string, CellData> = existing?.cellData ?? {};
      const newCellData = { ...existingCellData };
      indices.forEach(idx => {
        const current = newCellData[String(idx)];
        newCellData[String(idx)] = { w: current?.w ?? cellCm, l: current?.l ?? cellCm, blocked: blockedValue };
      });
      const newBlocked = Object.entries(newCellData).filter(([, c]) => c.blocked).map(([k]) => parseInt(k));
      return { ...z, obstacles: [{ type: "grid" as const, cell_cm: cellCm, rows, cols, blocked: newBlocked, cellData: newCellData }] };
    }));
  };

  const updateCellSize = (zone: Zone, idx: number, w: number, l: number) => {
    const cellCm = gridCellCm[zone.id] ?? 50;
    const cols = Math.max(1, Math.ceil(zone.width_cm / cellCm));
    const rows = Math.max(1, Math.ceil(zone.length_cm / cellCm));
    setZones(prev => prev.map(z => {
      if (z.id !== zone.id) return z;
      const existing = z.obstacles?.find((o): o is GridData => (o as GridData).type === "grid");
      const existingCellData: Record<string, CellData> = existing?.cellData ?? {};
      const currentCell = existingCellData[String(idx)];
      const newCellData = { ...existingCellData, [String(idx)]: { ...currentCell, w, l } };
      const newBlocked = Object.entries(newCellData).filter(([, c]) => c.blocked).map(([k]) => parseInt(k));
      return { ...z, obstacles: [{ type: "grid" as const, cell_cm: cellCm, rows, cols, blocked: newBlocked, cellData: newCellData }] };
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
      ...z, obstacles: [{ type: "grid" as const, cell_cm: cellCm, rows, cols, blocked: [], cellData: {} }]
    }));
    setSelectedCell(null);
  };

  // ── Handover editor ───────────────────────────────────────────────────────
  const patchMat = (id: string, field: keyof EditRow, val: string) =>
    setEditMats((prev) => prev.map((r) => (r._localId === id ? { ...r, [field]: val } : r)));
  const patchRet = (id: string, field: keyof EditRow, val: string) =>
    setEditRets((prev) => prev.map((r) => (r._localId === id ? { ...r, [field]: val } : r)));

  const saveHandoverEdit = async () => {
    if (!selectedJobNo) return;
    const invalidWidth = [...editMats, ...editRets].some((row) =>
      row.widthCm !== "" && (!Number.isFinite(Number(row.widthCm)) || Number(row.widthCm) <= 0));
    if (invalidWidth) {
      toast.error("ความกว้างต้องเป็นตัวเลขมากกว่า 0 ซม.");
      return;
    }
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

  useEffect(() => {
    if (!selectedJobNo) {
      setExclusionReason("");
      setEditingAppointment(false);
      setAppointmentDateDraft("");
      return;
    }
    setExclusionReason(exclusionsByJobNo[selectedJobNo]?.reason ?? "");
    const job = jobs.find((row) => row.job_no === selectedJobNo);
    setAppointmentDateDraft(job?.appt_date ?? "");
    setEditingAppointment(false);
  }, [selectedJobNo, exclusionsByJobNo, jobs]);

  const saveAppointmentDate = async () => {
    if (!selectedJobNo || savingAppointment) return;
    if (!appointmentDateDraft) {
      toast.error("กรุณาเลือกวันนัด");
      return;
    }

    setSavingAppointment(true);
    if (IS_LOCAL_PREVIEW) {
      setJobs((previous) => previous.map((job) =>
        job.job_no === selectedJobNo ? { ...job, appt_date: appointmentDateDraft } : job
      ));
      setSavingAppointment(false);
      setEditingAppointment(false);
      toast.success("บันทึกวันนัดแล้ว (ข้อมูลสาธิต Local)");
      return;
    }

    const { error } = await supabase
      .from("install_jobs")
      .update({ appt_date: appointmentDateDraft })
      .eq("job_no", selectedJobNo);
    setSavingAppointment(false);
    if (error) {
      toast.error("แก้ไขวันนัดไม่ได้: " + floorErrorMessage(error));
      return;
    }
    setJobs((previous) => previous.map((job) =>
      job.job_no === selectedJobNo ? { ...job, appt_date: appointmentDateDraft } : job
    ));
    setEditingAppointment(false);
    toast.success("บันทึกวันนัดในใบงานแล้ว");
  };

  const excludeSelectedJob = async () => {
    if (!selectedJobNo || savingExclusion || exclusionsByJobNo[selectedJobNo]) return;
    const reason = exclusionReason.trim() || "ไม่ต้องการนำมาวิเคราะห์";
    if (IS_LOCAL_PREVIEW) {
      setExclusionsByJobNo((previous) => ({
        ...previous,
        [selectedJobNo]: { job_no: selectedJobNo, reason, excluded_at: new Date().toISOString() },
      }));
      setShowExcluded(true);
      toast.success("ซ่อนบิลนี้จากการวิเคราะห์แล้ว (ข้อมูลสาธิต Local)");
      return;
    }
    setSavingExclusion(true);
    const { data, error } = await supabase
      .from("floor_waste_analysis_exclusions")
      .insert({ job_no: selectedJobNo, reason })
      .select("job_no,reason,excluded_at")
      .single();
    setSavingExclusion(false);
    if (error) {
      toast.error("ซ่อนจากการวิเคราะห์ไม่ได้: " + floorErrorMessage(error));
      return;
    }
    const row = data as WasteAnalysisExclusion;
    setExclusionsByJobNo((previous) => ({ ...previous, [row.job_no]: row }));
    setShowExcluded(true);
    toast.success("ซ่อนบิลนี้จากการวิเคราะห์แล้ว");
  };

  const restoreSelectedJob = async () => {
    if (!selectedJobNo || savingExclusion || !exclusionsByJobNo[selectedJobNo]) return;
    if (IS_LOCAL_PREVIEW) {
      setExclusionsByJobNo((previous) => {
        const next = { ...previous };
        delete next[selectedJobNo];
        return next;
      });
      setExclusionReason("");
      setShowExcluded(false);
      toast.success("นำบิลกลับมาวิเคราะห์แล้ว (ข้อมูลสาธิต Local)");
      return;
    }
    setSavingExclusion(true);
    const { error } = await supabase
      .from("floor_waste_analysis_exclusions")
      .delete()
      .eq("job_no", selectedJobNo);
    setSavingExclusion(false);
    if (error) {
      toast.error("นำกลับมาวิเคราะห์ไม่ได้: " + floorErrorMessage(error));
      return;
    }
    setExclusionsByJobNo((previous) => {
      const next = { ...previous };
      delete next[selectedJobNo];
      return next;
    });
    setExclusionReason("");
    setShowExcluded(false);
    toast.success("นำบิลกลับมาวิเคราะห์แล้ว");
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

  const totalActualArea = useMemo(() => stockSummary ? actualAreaFromSummary(stockSummary) : null, [stockSummary]);

  const wasteAreaCm2 = totalActualArea !== null && totalZoneArea > 0
    ? totalActualArea - totalZoneArea : null;

  const wasteAreaPct = wasteAreaCm2 !== null && totalZoneArea > 0
    ? (wasteAreaCm2 / totalZoneArea) * 100 : null;

  const filteredJobs = useMemo(() => {
    const q = search.toLowerCase();
    return jobs.filter((j) => {
      const isExcluded = Boolean(exclusionsByJobNo[j.job_no]);
      if (isExcluded !== showExcluded) return false;
      if (!q.trim()) return true;
      return j.job_no?.toLowerCase().includes(q) ||
        (j.bill_no as string | null)?.toLowerCase().includes(q) ||
        (j.order_no as string | null)?.toLowerCase().includes(q) ||
        (j.customer_name as string | null)?.toLowerCase().includes(q) ||
        (j.product_name as string | null)?.toLowerCase().includes(q);
    });
  }, [jobs, search, exclusionsByJobNo, showExcluded]);

  const overviewRows = useMemo(() => {
    const c140 = mat140?.unit_cost ?? 0;
    const c110 = mat110?.unit_cost ?? 0;
    return jobs.map((j) => {
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
      const actArea = mov ? actualAreaFromSummary(mov) : null;
      const wasteArea = actArea !== null && zoneArea > 0 ? actArea - zoneArea : null;
      const wasteAreaPct = wasteArea !== null && zoneArea > 0 ? (wasteArea / zoneArea) * 100 : null;
      const billRef = normalizeBillReference(j.bill_no);
      const sales = billRef ? salesByBillRef[billRef] ?? null : null;
      const grossRevenue = sales?.matchedVia !== "not_found" ? sales?.salesAmount ?? null : null;
      const netRevenueBeforeVat = revenueBeforeVat(grossRevenue);
      const vatAmount = grossRevenue !== null && netRevenueBeforeVat !== null ? grossRevenue - netRevenueBeforeVat : null;
      const sheetCost = calculateSheetCost(j.handover_data);
      const grossProfit = netRevenueBeforeVat !== null && sheetCost.costExVat !== null
        ? netRevenueBeforeVat - sheetCost.costExVat
        : null;
      const grossMarginPct = grossProfit !== null && netRevenueBeforeVat && netRevenueBeforeVat > 0
        ? (grossProfit / netRevenueBeforeVat) * 100
        : null;
      const costToRevenuePct = sheetCost.costExVat !== null && netRevenueBeforeVat && netRevenueBeforeVat > 0
        ? (sheetCost.costExVat / netRevenueBeforeVat) * 100
        : null;
      return {
        ...j, zoneCount: jzones.length, exp140: exp.total140, exp110: exp.total110,
        actual140, actual110, waste140, waste110,
        expectedCost: expectedCost > 0 ? expectedCost : null,
        actualCost, wasteCost,
        zoneArea, actArea, wasteArea, wasteAreaPct,
        sales, grossRevenue, netRevenueBeforeVat, vatAmount, sheetCost, grossProfit, grossMarginPct, costToRevenuePct,
        wasteToSalesPct: wasteCostToSalesPercent(wasteCost, netRevenueBeforeVat),
        hasZones: jzones.length > 0,
        hasMov: mov !== null,
        isExcluded: Boolean(exclusionsByJobNo[j.job_no]),
      };
    });
  }, [jobs, overviewZonesMap, mat140, mat110, salesByBillRef, exclusionsByJobNo]);

  const displayedOverviewRows = useMemo(() => {
    const visibleJobNos = new Set(filteredJobs.map((job) => job.job_no));
    return overviewRows.filter((row) => visibleJobNos.has(row.job_no));
  }, [filteredJobs, overviewRows]);

  const stats = useMemo(() => {
    const analyzedRows = overviewRows.filter((row) => !row.isExcluded);
    const withCostSetup = !!(mat140?.unit_cost && mat110?.unit_cost);
    const totalWasteCost = analyzedRows.reduce((s, r) => s + (r.wasteCost ?? 0), 0);
    const analyzedBillRefs = new Set(analyzedRows.map((row) => normalizeBillReference(row.bill_no)).filter(Boolean));
    const salesByDistinctBill = new Map<string, WasteSalesSummary>();
    const profitabilityByBill = new Map<string, { revenue: number; cost: number }>();
    analyzedRows.forEach((row) => {
      const billRef = normalizeBillReference(row.bill_no);
      if (billRef && row.sales && row.sales.matchedVia !== "not_found" && row.sales.salesAmount !== null) {
        salesByDistinctBill.set(billRef, row.sales);
        if (row.netRevenueBeforeVat !== null && row.sheetCost.costExVat !== null) {
          const previous = profitabilityByBill.get(billRef);
          profitabilityByBill.set(billRef, {
            revenue: row.netRevenueBeforeVat,
            cost: (previous?.cost ?? 0) + row.sheetCost.costExVat,
          });
        }
      }
    });
    const totalRevenueBeforeVat = Array.from(profitabilityByBill.values()).reduce((sum, item) => sum + item.revenue, 0);
    const totalProductCost = Array.from(profitabilityByBill.values()).reduce((sum, item) => sum + item.cost, 0);
    const totalGrossProfit = totalRevenueBeforeVat - totalProductCost;
    return {
      total: analyzedRows.length,
      excluded: overviewRows.length - analyzedRows.length,
      withZones: analyzedRows.filter((r) => r.hasZones).length,
      withData: analyzedRows.filter((r) => r.hasMov).length,
      totalWasteCost, withCostSetup,
      totalSales: Array.from(salesByDistinctBill.values()).reduce((sum, sales) => sum + (sales.salesAmount ?? 0), 0),
      totalRevenueBeforeVat,
      totalProductCost,
      totalGrossProfit,
      grossMarginPct: totalRevenueBeforeVat > 0 ? (totalGrossProfit / totalRevenueBeforeVat) * 100 : null,
      profitabilityBills: profitabilityByBill.size,
      salesFound: salesByDistinctBill.size,
      billRefs: analyzedBillRefs.size,
    };
  }, [overviewRows, mat140, mat110]);

  const selectedJob = jobs.find((j) => j.job_no === selectedJobNo);
  const selectedExclusion = selectedJobNo ? exclusionsByJobNo[selectedJobNo] ?? null : null;
  const selectedBillRef = normalizeBillReference(selectedJob?.bill_no);
  const selectedSales = selectedBillRef ? salesByBillRef[selectedBillRef] ?? null : null;
  const selectedSheetCost = calculateSheetCost(selectedJob?.handover_data);
  const selectedGrossRevenue = selectedSales?.matchedVia !== "not_found" ? selectedSales?.salesAmount ?? null : null;
  const selectedRevenueBeforeVat = revenueBeforeVat(selectedGrossRevenue);
  const selectedVatAmount = selectedGrossRevenue !== null && selectedRevenueBeforeVat !== null
    ? selectedGrossRevenue - selectedRevenueBeforeVat
    : null;
  const selectedGrossProfit = selectedRevenueBeforeVat !== null && selectedSheetCost.costExVat !== null
    ? selectedRevenueBeforeVat - selectedSheetCost.costExVat
    : null;
  const selectedGrossMarginPct = selectedGrossProfit !== null && selectedRevenueBeforeVat && selectedRevenueBeforeVat > 0
    ? (selectedGrossProfit / selectedRevenueBeforeVat) * 100
    : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 gap-4 md:h-[calc(100dvh-3rem)] md:overflow-hidden">

      {/* ── Left: Job list ── */}
      <div className="flex w-64 flex-shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white md:sticky md:top-6 md:h-full">
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
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setShowExcluded(false)}
              className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                !showExcluded ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"
              }`}
            >
              วิเคราะห์ {stats.total}
            </button>
            <button
              onClick={() => setShowExcluded(true)}
              className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                showExcluded ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"
              }`}
            >
              ซ่อนแล้ว {stats.excluded}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                  {exclusionsByJobNo[j.job_no] && (
                    <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">ซ่อน</span>
                  )}
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">

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

            {showExcluded && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                รายการด้านล่างถูกเก็บไว้เพื่อตรวจย้อนหลัง แต่ไม่รวมในจำนวนงาน ยอดขาย หรือต้นทุนเศษของ Dashboard
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {[
                { label: "งานที่วิเคราะห์", val: stats.total.toString(), sub: "รายการ" },
                { label: "เชื่อมยอดขาย", val: stats.salesFound.toString(), sub: `จาก ${stats.billRefs} บิล` },
                { label: "ยอดขายรวม VAT", val: fmtBaht(stats.totalSales), sub: "ยอดจาก transaction" },
                { label: "รายได้ก่อน VAT", val: fmtBaht(stats.totalRevenueBeforeVat), sub: `คำนวณจาก ${stats.profitabilityBills} บิล` },
                { label: "ต้นทุนสินค้า", val: fmtBaht(stats.totalProductCost), sub: "ก่อน VAT · หักแผ่นคืน" },
                { label: "กำไรขั้นต้น", val: fmtSignedBaht(stats.totalGrossProfit), sub: "รายได้ก่อน VAT − ต้นทุน", red: stats.totalGrossProfit < 0 },
                { label: "Gross margin", val: stats.grossMarginPct === null ? "—" : `${stats.grossMarginPct.toFixed(1)}%`, sub: "กำไรขั้นต้น ÷ รายได้ก่อน VAT", red: (stats.grossMarginPct ?? 0) < 0 },
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

            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
              <strong>ฐานคำนวณเดียวกัน:</strong> รายได้จาก transaction เป็นยอดรวม VAT จึงหาร 1.07 ก่อนเทียบต้นทุน
              · แผ่น 1.6 ซม. = {fmtBaht(SHEET_COST_EX_VAT["1.6"])} ก่อน VAT
              · แผ่น 0.6 ซม. = {fmtBaht(SHEET_COST_EX_VAT["0.6"])} ก่อน VAT
              · ต้นทุนสินค้า = (จำนวนเบิก − จำนวนคืน) × ราคาต่อแผ่น
            </div>

            {!stats.withCostSetup && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
                💡 ต้นทุนสินค้าใช้ราคาต่อแผ่นตามความหนาแล้ว ส่วน “ต้นทุนเศษตามความยาว” ยังต้องตั้ง unit_cost ของ <strong>RS-140</strong> / <strong>RS-110</strong> ในคลังวัสดุ
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
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ยอดขายรวม VAT</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">รายได้ก่อน VAT</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ต้นทุนสินค้า</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">กำไรขั้นต้น</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">Margin</th>
                      <th className="text-right px-3 py-2.5 font-medium text-slate-500">ต้นทุนเศษ</th>
                      <th className="text-center px-3 py-2.5 font-medium text-slate-500">เศษ/ยอดขาย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {loadingOverview ? (
                      <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-400">⏳ กำลังโหลด…</td></tr>
                    ) : displayedOverviewRows.length === 0 ? (
                      <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-400">ไม่มีข้อมูล</td></tr>
                    ) : displayedOverviewRows.map((r) => (
                      <tr key={r.job_no}
                        className={`cursor-pointer transition-colors ${r.hasZones ? "hover:bg-blue-50/40" : "opacity-60"} ${r.isExcluded ? "bg-amber-50/40" : ""}`}
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
                        <td className="px-3 py-2.5 text-right">
                          {r.sales && r.sales.matchedVia !== "not_found" && r.sales.salesAmount !== null ? (
                            <div>
                              <p className="font-semibold font-mono text-slate-800">{fmtBaht(r.sales.salesAmount)}</p>
                              <p className="text-[9px] text-slate-400">จาก {r.sales.matchedVia}</p>
                            </div>
                          ) : (
                            <span className="text-[10px] font-medium text-amber-600">ไม่พบข้อมูล</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {r.netRevenueBeforeVat !== null ? fmtBaht(r.netRevenueBeforeVat) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {r.sheetCost.costExVat !== null ? (
                            <div>
                              <p className="font-semibold font-mono text-slate-800">{fmtBaht(r.sheetCost.costExVat)}</p>
                              <p className="text-[9px] text-slate-400">1.6: {r.sheetCost.net16} · 0.6: {r.sheetCost.net06} แผ่น</p>
                            </div>
                          ) : "—"}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-semibold font-mono ${r.grossProfit !== null && r.grossProfit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                          {r.grossProfit !== null ? fmtSignedBaht(r.grossProfit) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r.grossMarginPct !== null ? <span className="font-semibold text-slate-700">{r.grossMarginPct.toFixed(1)}%</span> : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {r.wasteCost !== null ? (
                            <span className={r.wasteCost > 0 ? "text-red-600" : "text-green-600"}>
                              {r.wasteCost > 0 ? "+" : "-"}{fmtBaht(r.wasteCost)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center"><WasteBadge pct={r.wasteToSalesPct} /></td>
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
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <p className="text-[10px] text-slate-400">วันนัด · จากใบงาน</p>
                      {!editingAppointment && (
                        <button
                          type="button"
                          onClick={() => {
                            setAppointmentDateDraft(selectedJob?.appt_date ?? "");
                            setEditingAppointment(true);
                          }}
                          className="text-[10px] font-semibold text-blue-600 hover:underline"
                        >
                          ✎ แก้ไข
                        </button>
                      )}
                    </div>
                    {editingAppointment ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          value={appointmentDateDraft}
                          onInput={(event) => setAppointmentDateDraft(event.currentTarget.value)}
                          className="min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                          type="button"
                          onClick={saveAppointmentDate}
                          disabled={savingAppointment || !appointmentDateDraft}
                          className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingAppointment ? "กำลังบันทึก…" : "บันทึก"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAppointmentDateDraft(selectedJob?.appt_date ?? "");
                            setEditingAppointment(false);
                          }}
                          disabled={savingAppointment}
                          className="px-1 py-1.5 text-[10px] text-slate-500 hover:text-slate-800 disabled:opacity-50"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <p className="font-medium text-slate-800">{fmtDate(selectedJob?.appt_date ?? null)}</p>
                    )}
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

                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-2">
                  <div className={`rounded-xl border p-3 ${
                    selectedSales && selectedSales.matchedVia !== "not_found" && selectedSales.salesAmount !== null
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-amber-200 bg-amber-50"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">ยอดขายจาก sales_transaction</p>
                        {selectedSales && selectedSales.matchedVia !== "not_found" && selectedSales.salesAmount !== null ? (
                          <>
                            <p className="mt-1 text-2xl font-bold text-emerald-800">{fmtBaht(selectedSales.salesAmount)}</p>
                            <p className="text-[10px] font-medium text-emerald-700">ยอดขายรวม VAT</p>
                            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-white/70 p-2 text-[10px]">
                              <div><p className="text-slate-400">VAT 7%</p><p className="font-semibold text-slate-700">{selectedVatAmount !== null ? fmtBaht(selectedVatAmount) : "—"}</p></div>
                              <div><p className="text-slate-400">รายได้ก่อน VAT</p><p className="font-semibold text-slate-700">{selectedRevenueBeforeVat !== null ? fmtBaht(selectedRevenueBeforeVat) : "—"}</p></div>
                            </div>
                            <p className="mt-2 text-[10px] text-emerald-700">
                              ยอดสุทธิตามธุรกรรม {selectedSales.netAmount !== null ? fmtBaht(selectedSales.netAmount) : "—"}
                              {selectedSales.shippingCost ? ` · ค่าจัดส่ง ${fmtBaht(selectedSales.shippingCost)}` : ""}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="mt-1 text-sm font-semibold text-amber-800">ไม่พบข้อมูลยอดขาย</p>
                            <p className="mt-1 text-[10px] text-amber-700">ตรวจทั้ง bill_no และ order_no แล้ว ไม่แสดงเป็น 0 บาท</p>
                          </>
                        )}
                      </div>
                      {selectedSales?.matchedVia && selectedSales.matchedVia !== "not_found" && (
                        <span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-emerald-700 shadow-sm">
                          พบจาก {selectedSales.matchedVia}
                        </span>
                      )}
                    </div>
                    {selectedSales?.matchedVia !== "not_found" && selectedSales?.transactionLines ? (
                      <p className="mt-2 text-[10px] text-slate-500">
                        {selectedSales.transactionLines} รายการสินค้า
                        {selectedSales.orderStatuses.length ? ` · ${selectedSales.orderStatuses.join(", ")}` : ""}
                        {selectedSales.latestTxnDate ? ` · ${fmtDate(selectedSales.latestTxnDate)}` : ""}
                      </p>
                    ) : null}
                  </div>

                  <div className={`rounded-xl border p-3 ${selectedExclusion ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        id="exclude-from-waste-analysis"
                        type="checkbox"
                        checked={Boolean(selectedExclusion)}
                        disabled={savingExclusion}
                        onChange={(event) => {
                          if (event.target.checked) void excludeSelectedJob();
                          else void restoreSelectedJob();
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      <label htmlFor="exclude-from-waste-analysis" className="cursor-pointer">
                        <p className="text-xs font-semibold text-slate-800">ไม่นำบิลนี้มาวิเคราะห์</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                          ซ่อนจาก Dashboard และไม่นับยอดขาย/ต้นทุนเศษ แต่ใบงานและประวัติยังอยู่ครบ
                        </p>
                      </label>
                    </div>
                    {selectedExclusion ? (
                      <div className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-[10px] text-amber-800">
                        <p className="font-semibold">เหตุผล: {selectedExclusion.reason}</p>
                        <p className="mt-0.5 text-amber-600">ซ่อนเมื่อ {fmtDate(selectedExclusion.excluded_at)}</p>
                      </div>
                    ) : (
                      <label className="mt-3 block text-[10px] text-slate-500">
                        เหตุผล (ไม่บังคับ)
                        <input
                          value={exclusionReason}
                          onChange={(event) => setExclusionReason(event.target.value)}
                          maxLength={500}
                          placeholder="เช่น บิลทดสอบ / ไม่ใช่งานที่ต้องวิเคราะห์"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                        />
                      </label>
                    )}
                    {savingExclusion && <p className="mt-2 text-[10px] text-slate-400">กำลังบันทึก…</p>}
                  </div>

                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 lg:col-span-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-blue-900">วิเคราะห์รายได้เทียบต้นทุนสินค้า (ก่อน VAT)</p>
                        <p className="mt-1 text-[10px] text-blue-700">
                          1.6 ซม. {fmtBaht(SHEET_COST_EX_VAT["1.6"])} / แผ่น · 0.6 ซม. {fmtBaht(SHEET_COST_EX_VAT["0.6"])} / แผ่น · หักจำนวนแผ่นคืนแล้ว
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-700">ไม่รวม VAT ทั้งสองฝั่ง</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {[
                        { label: "รายได้ก่อน VAT", value: selectedRevenueBeforeVat !== null ? fmtBaht(selectedRevenueBeforeVat) : "—" },
                        { label: "ต้นทุนสินค้า", value: selectedSheetCost.costExVat !== null ? fmtBaht(selectedSheetCost.costExVat) : "—" },
                        { label: "กำไรขั้นต้น", value: selectedGrossProfit !== null ? fmtSignedBaht(selectedGrossProfit) : "—", negative: selectedGrossProfit !== null && selectedGrossProfit < 0 },
                        { label: "Gross margin", value: selectedGrossMarginPct !== null ? `${selectedGrossMarginPct.toFixed(1)}%` : "—", negative: selectedGrossMarginPct !== null && selectedGrossMarginPct < 0 },
                        { label: "แผ่นใช้สุทธิ", value: `1.6: ${selectedSheetCost.net16} · 0.6: ${selectedSheetCost.net06}` },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg bg-white px-3 py-2.5 shadow-sm">
                          <p className="text-[9px] text-slate-400">{item.label}</p>
                          <p className={`mt-0.5 text-sm font-bold ${item.negative ? "text-red-600" : "text-slate-800"}`}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    {selectedSheetCost.costExVat === null && (
                      <p className="mt-2 text-[10px] text-amber-700">ยังคำนวณต้นทุนไม่ได้ เพราะรายการเบิก-คืนยังไม่ได้ระบุความหนา 1.6 หรือ 0.6 ซม.</p>
                    )}
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
                          const calc = z.width_cm > 0 && z.length_cm > 0 ? calcStripsForZone(z.width_cm, z.length_cm, getObstacleReduction(z)) : null;
                          const netArea = z.width_cm > 0 && z.length_cm > 0 ? getZoneNetArea(z) : 0;
                          const rawArea = z.width_cm > 0 && z.length_cm > 0 ? z.width_cm * z.length_cm : 0;
                          const dedArea = rawArea - netArea;
                          const isExpanded = expandedZones.has(z.id);
                          return (
                            <Fragment key={z.id}>
                            <tr>
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
                                          <span className="text-[10px] text-blue-500 ml-1">🖱️ ลากคลุมหลายเซลล์เพื่อขวางทีเดียว</span>
                                        </div>

                                        <div className="flex gap-4 items-start">
                                          {/* Grid */}
                                          <div className="flex-shrink-0">
                                            <div className="text-[9px] text-slate-400 mb-1 flex justify-between" style={{width: cols * (cellPx + 2) + "px"}}>
                                              <span>← {z.width_cm} cm →</span>
                                            </div>
                                            {(() => {
                                              const dragRectSet = (dragStart && dragStart.zoneId === z.id && dragCurrent !== null)
                                                ? new Set(rectIndices(dragStart.idx, dragCurrent, cols))
                                                : null;
                                              const cancelDrag = () => { setDragStart(null); setDragCurrent(null); };
                                              const commitDrag = () => {
                                                if (!dragStart || dragStart.zoneId !== z.id) return;
                                                const endIdx = dragCurrent ?? dragStart.idx;
                                                if (endIdx !== dragStart.idx) {
                                                  setBlockedRange(z, rectIndices(dragStart.idx, endIdx, cols), dragStart.mode === "block");
                                                }
                                                cancelDrag();
                                              };
                                              return (
                                            <div
                                              className="inline-grid gap-0.5 select-none"
                                              style={{gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`}}
                                              onMouseUp={commitDrag}
                                              onMouseLeave={cancelDrag}
                                            >
                                              {Array.from({ length: rows * cols }, (_, i) => {
                                                const cellDatum = gridEntry?.cellData?.[String(i)];
                                                const isBlocked = cellDatum?.blocked ?? blocked.includes(i);
                                                const isSelected = selectedCell?.zoneId === z.id && selectedCell?.idx === i;
                                                const hasCustom = cellDatum?.w !== undefined || cellDatum?.l !== undefined;
                                                const cW = cellDatum?.w ?? gridEntry?.cell_cm ?? cellCm;
                                                const cL = cellDatum?.l ?? gridEntry?.cell_cm ?? cellCm;
                                                const inDragRect = dragRectSet?.has(i) ?? false;
                                                const dragPreviewClass = inDragRect
                                                  ? (dragStart?.mode === "block" ? "ring-2 ring-orange-500 bg-orange-200" : "ring-2 ring-blue-400 bg-blue-100")
                                                  : "";
                                                return (
                                                  <div
                                                    key={i}
                                                    onMouseDown={(e) => { e.preventDefault(); setDragStart({ zoneId: z.id, idx: i, mode: isBlocked ? "unblock" : "block" }); setDragCurrent(i); }}
                                                    onMouseEnter={() => { if (dragStart?.zoneId === z.id) setDragCurrent(i); }}
                                                    onClick={() => {
                                                      if (isBlocked) { toggleGridCell(z, i); }
                                                      else { setSelectedCell({ zoneId: z.id, idx: i }); setEditingCell({ w: String(cW), l: String(cL) }); }
                                                    }}
                                                    style={{ width: cellPx, height: cellPx }}
                                                    className={cx(
                                                      "border cursor-pointer rounded-[2px] flex items-center justify-center overflow-hidden transition-colors",
                                                      isBlocked ? "bg-orange-400 border-orange-500 text-white text-xs font-bold" : isSelected ? "bg-blue-100 border-blue-400" : hasCustom ? "bg-blue-50 hover:bg-blue-100 border-blue-200" : "bg-slate-100 border-slate-200 hover:bg-blue-100 hover:border-blue-300",
                                                      dragPreviewClass
                                                    )}
                                                    title={`เซลล์ ${Math.floor(i/cols)+1},${(i%cols)+1} — ${isBlocked ? "ไม่ปู (คลิกยกเลิก หรือลากคลุมเพื่อยกเลิกหลายเซลล์)" : "คลิกเพื่อตั้งขนาด หรือลากคลุมเพื่อขวางหลายเซลล์"}`}
                                                  >
                                                    {isBlocked ? "×" : hasCustom ? (
                                                      <span className="text-center leading-none text-blue-700" style={{ fontSize: Math.max(5, cellPx / 6) }}>
                                                        {cW}<br/>{cL}
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                              );
                                            })()}
                                            <div className="text-[9px] text-slate-400 mt-1">{z.length_cm} cm ↕</div>
                                          </div>

                                          {selectedCell?.zoneId === z.id && (() => {
                                            const colsN = Math.max(1, Math.ceil(z.width_cm / (gridCellCm[z.id] ?? 50)));
                                            return (
                                              <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200 w-full">
                                                <div className="flex items-center justify-between mb-2">
                                                  <span className="text-sm font-medium text-blue-800">
                                                    ✏️ แถว {Math.floor(selectedCell.idx / colsN) + 1} — คอล {(selectedCell.idx % colsN) + 1}
                                                  </span>
                                                  <button onClick={() => setSelectedCell(null)} className="text-gray-400 hover:text-gray-600 text-sm leading-none">✕</button>
                                                </div>
                                                <div className="flex gap-3 items-end flex-wrap">
                                                  <label className="text-xs text-gray-600">
                                                    กว้าง (ซม.)
                                                    <input type="number" value={editingCell.w}
                                                      onChange={e => setEditingCell(p => ({ ...p, w: e.target.value }))}
                                                      className="block mt-1 w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                                                      min="1" />
                                                  </label>
                                                  <label className="text-xs text-gray-600">
                                                    ยาว (ซม.)
                                                    <input type="number" value={editingCell.l}
                                                      onChange={e => setEditingCell(p => ({ ...p, l: e.target.value }))}
                                                      className="block mt-1 w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                                                      min="1" />
                                                  </label>
                                                  <button
                                                    onClick={() => {
                                                      const w = parseFloat(editingCell.w); const l = parseFloat(editingCell.l);
                                                      if (w > 0 && l > 0) { updateCellSize(z, selectedCell.idx, w, l); setSelectedCell(null); }
                                                    }}
                                                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                                                  >บันทึกขนาด</button>
                                                  <button
                                                    onClick={() => { toggleGridCell(z, selectedCell.idx); setSelectedCell(null); }}
                                                    className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded hover:bg-orange-600"
                                                  >🚫 ขวาง</button>
                                                  {(editingCell.w !== String(gridCellCm[z.id] ?? 50) || editingCell.l !== String(gridCellCm[z.id] ?? 50)) && (
                                                    <button
                                                      onClick={() => {
                                                        updateCellSize(z, selectedCell.idx, gridCellCm[z.id] ?? 50, gridCellCm[z.id] ?? 50);
                                                        setSelectedCell(null);
                                                      }}
                                                      className="px-3 py-1.5 bg-gray-400 text-white text-sm rounded hover:bg-gray-500"
                                                    >↩ ค่าเดิม</button>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })()}

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
                                        <p className="text-[10px] text-slate-400 mt-1">
                                          📏 ถ้าขีดไม่ปูเต็มแถวหรือเต็มคอลัมน์ ระบบจะลดจำนวน cm ที่ควรเบิก (140/110) ให้อัตโนมัติตามแนวที่ตัดจริง
                                        </p>
                                      </div>
                                    );
                                  })()}
                                </td>
                              </tr>
                            )}
                            </Fragment>
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
                const zoneInfo = zones
                  .filter((z) => z.width_cm > 0 && z.length_cm > 0)
                  .map((z) => {
                    const reduction = getObstacleReduction(z);
                    const calc = calcStripsForZone(z.width_cm, z.length_cm, reduction);
                    const stripLen = getStripLen(z.width_cm, z.length_cm, reduction);
                    const matches140 = calc.n140 > 0
                      ? availableRemnants.filter((r) => r.width_bin >= 140 && r.length_cm >= stripLen)
                      : [];
                    const matches110 = calc.n110 > 0
                      ? availableRemnants.filter((r) => r.width_bin >= 110 && r.length_cm >= stripLen && !matches140.find((x) => x.id === r.id))
                      : [];
                    const needed140 = calc.n140 > 0;
                    const needed110 = calc.n110 > 0;
                    return { zone: z, stripLen, calc, matches140, matches110, needed140, needed110 };
                  })
                  .filter((s) => s.needed140 || s.needed110);
                if (zoneInfo.length === 0) return null;
                return (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-teal-800 mb-1">💡 เศษที่ใช้แทนได้</h2>
                    <p className="text-[11px] text-teal-700 mb-3">
                      ระบบเทียบความยาวเศษที่มีในคลัง (หน้า &ldquo;เศษวัสดุ&rdquo;) กับความยาวที่ต้องใช้จริงต่อโซน
                      ถ้ายาวพอจะขึ้นให้เลือก — กด <strong>จอง</strong> เพื่อล็อกชิ้นนั้นไว้ให้งานนี้ แล้วแจ้งช่างไปหยิบตามหมายเลขที่หน้า &ldquo;เศษวัสดุ&rdquo;
                    </p>
                    <div className="space-y-3">
                      {zoneInfo.map(({ zone: z, stripLen, calc, matches140, matches110, needed140, needed110 }) => {
                        const allMatches = [...matches140.map((r) => ({ r, forWidth: 140 })), ...matches110.map((r) => ({ r, forWidth: 110 }))];
                        return (
                          <div key={z.id} className="bg-white rounded-lg border border-teal-100 p-3">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <span className="text-xs font-semibold text-slate-700">{z.zone_name}</span>
                              <span className="text-[10px] text-slate-400">ต้องการ</span>
                              {needed140 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">140cm ×{calc.n140} ยาว ≥ {stripLen}cm</span>}
                              {needed110 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">110cm ×{calc.n110} ยาว ≥ {stripLen}cm</span>}
                            </div>
                            {allMatches.length === 0 ? (
                              <p className="text-[11px] text-slate-400 italic">ยังไม่มีเศษในคลังที่ยาวพอสำหรับโซนนี้ — ต้องเบิกแผ่นใหม่ตามปกติ</p>
                            ) : allMatches.map(({ r, forWidth }) => (
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
                                    if (error) toast.error(floorErrorMessage(error));
                                    else { toast.success("จองเศษสำหรับงานนี้แล้ว — ไปหยิบได้ที่หน้า เศษวัสดุ"); fetchRemnants(); }
                                    setReservingRemnant(null);
                                  }}
                                  className="px-3 py-1 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                                >
                                  {reservingRemnant === r.id ? "..." : "จอง"}
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })}
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
                    {Object.entries(stockSummary.byWidth)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .flatMap(([width, totals]) => [
                        { label: `เบิก กว้าง ${width} ซม.`, val: totals.issued, cls: "text-red-600" },
                        { label: `คืน กว้าง ${width} ซม.`, val: totals.returned, cls: "text-blue-600" },
                      ]).map((s) => (
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
                                  <input type="number" min="0.1" step="0.1" list="material-width-presets" value={r.widthCm}
                                    onChange={(e) => patchMat(r._localId, "widthCm", e.target.value)} placeholder="เช่น 125"
                                    className="w-24 px-2 py-1 border border-slate-200 rounded text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
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
                                  <input type="number" min="0.1" step="0.1" list="material-width-presets" value={r.widthCm}
                                    onChange={(e) => patchRet(r._localId, "widthCm", e.target.value)} placeholder="เช่น 125"
                                    className="w-24 px-2 py-1 border border-slate-200 rounded text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
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

                    <datalist id="material-width-presets"><option value="110" /><option value="140" /></datalist>
                    <p className="mt-2 text-[10px] text-slate-400">ระบุความกว้างจริงเป็นเซนติเมตรได้ทุกค่า เช่น 90, 125 หรือ 152.5</p>
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
                      พื้นที่แผ่นจริง = ผลรวม (ความยาวสุทธิ × ความกว้างจริง) ของวัสดุทุกขนาด — พื้นที่โซน = ผลรวม กว้าง × ยาว ทุกโซน
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

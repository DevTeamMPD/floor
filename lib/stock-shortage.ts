/**
 * เช็คสต็อกและเตือนล่วงหน้า — ตรรกะการตัดสินทั้งหมดอยู่ในไฟล์นี้ที่เดียว
 *
 * ฝั่งฐานข้อมูล (supabase/migrations/20260902120000_stock_availability_view.sql และ
 * 20260902120020_job_stock_check.sql) ทำหน้าที่ "ส่งตัวเลขดิบ" เท่านั้น
 * ไม่ตัดสินว่าขาดหรือไม่ขาด เพราะตรรกะเดียวกันถูกใช้สองที่:
 *   1) หน้าใบสั่งงาน — ตอนคนเปิดดูก่อนอนุมัติ/ก่อนคลังจัดของ
 *   2) งาน cron ตอนกลางคืน — ตอนไม่มีคนเปิดหน้าจอ
 * ถ้าเขียนตรรกะไว้ทั้งใน SQL และใน TS วันหนึ่งตัวเลขบนหน้าจอกับในแจ้งเตือนจะไม่ตรงกัน
 * และไม่มีใครรู้ว่าฝั่งไหนถูก จึงยอมให้ SQL "โง่" แล้วให้ไฟล์นี้เป็นผู้ตัดสินที่เดียว
 *
 * หลักการสำคัญที่ตั้งใจให้เห็นชัดในผลลัพธ์: บรรทัดที่จับคู่กับสต็อกไม่ได้ ต้องเป็น "ตรวจสอบไม่ได้"
 * ห้ามนับเป็น "ของพอ" และห้ามนับเป็น "ของขาด" — วันนี้ทะเบียน materials มีแค่ 2 แถว
 * บรรทัดจริงส่วนใหญ่จึงจับคู่ไม่ได้ ถ้าเผลอตีความว่า "พอ" หน้าจอจะโกหกคนใช้ทุกวัน
 */

/** ชื่อ env var ที่กำหนดว่าจะเตือนล่วงหน้ากี่วันก่อนวันติดตั้ง — ไม่ใช่ตัวเลขฝังในโค้ด */
export const STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV = "STOCK_SHORTAGE_LOOKAHEAD_DAYS";
/** ค่าตั้งต้นเมื่อไม่ได้ตั้ง env var — ต้องตรงกับ default ของ list_upcoming_jobs_for_stock_check(integer) */
export const DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS = 7;
/** เพดานเดียวกับฝั่ง SQL กันการเผลอตั้งค่าจนงานกลางคืนไปกวาดทั้งปฏิทิน */
export const MAX_STOCK_SHORTAGE_LOOKAHEAD_DAYS = 60;

export type StockLineStatus = "enough" | "short" | "unknown" | "not_required";

export const STOCK_LINE_STATUS_LABELS: Record<StockLineStatus, string> = {
  enough: "ของพอ",
  short: "ของขาด",
  unknown: "ตรวจสอบไม่ได้",
  not_required: "ไม่ต้องเบิกเพิ่ม",
};

export const STOCK_SOURCE_LABELS: Record<string, string> = {
  warehouse: "สต็อกคลังจริง (snapshot ล่าสุด)",
  materials: "ทะเบียนวัสดุในระบบ",
};

/** แถวดิบจาก RPC get_job_stock_check — ตัวเลขมาเป็น string ได้ตามการ serialize ของ PostgREST */
export interface JobStockCheckRow {
  item_id: string | null;
  prep_source: string | null;
  category: string | null;
  item_name: string | null;
  line_sku: string | null;
  unit: string | null;
  planned_qty: number | string | null;
  actual_qty: number | string | null;
  picked_qty: number | string | null;
  stock_key: string | null;
  stock_source: string | null;
  registry_qty: number | string | null;
  warehouse_qty: number | string | null;
  available_qty: number | string | null;
  warehouse_name: string | null;
  snapshot_date: string | null;
}

export interface StockShortageGroup {
  /** SKU ที่ใช้จับคู่สต็อก — null คือบรรทัดที่ไม่มี SKU เลย */
  stockKey: string | null;
  itemIds: string[];
  itemNames: string[];
  unit: string;
  /** ต้องใช้ทั้งหมด = ผลรวมของ actual_qty ถ้ามี ไม่งั้น planned_qty */
  requiredQty: number;
  /** หยิบไปแล้ว */
  pickedQty: number;
  /** ยังต้องเบิกอีก = required - picked (ไม่ติดลบ) */
  outstandingQty: number;
  /** ของที่มีจริง — null คือไม่มีแหล่งสต็อกให้เทียบเลย */
  availableQty: number | null;
  shortageQty: number;
  status: StockLineStatus;
  stockSource: string | null;
  registryQty: number | null;
  warehouseQty: number | null;
  warehouseName: string | null;
  snapshotDate: string | null;
}

export interface JobStockShortageResult {
  groups: StockShortageGroup[];
  shortGroups: StockShortageGroup[];
  counts: { short: number; enough: number; unknown: number; notRequired: number };
  hasShortage: boolean;
  /** วันที่ของ snapshot ที่ใช้ตัดสิน — ให้หน้าจอบอกได้ว่าข้อมูลสดแค่ไหน */
  snapshotDate: string | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * ปัดที่ทศนิยม 4 ตำแหน่งก่อนเทียบ เพราะจำนวนเป็น numeric ที่แปลงมาเป็น float
 * 0.1 + 0.2 > 0.3 จะทำให้บรรทัดที่พอดีเป๊ะกลายเป็น "ขาด 0.0000000001 หน่วย"
 */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** คีย์รวมกลุ่ม: บรรทัดที่มี SKU เดียวกันต้องรวมกันก่อนเทียบกับของคงเหลือ ไม่งั้นของก้อนเดียวถูกนับให้หลายบรรทัด */
function groupKey(row: JobStockCheckRow, index: number): string {
  const key = text(row.stock_key);
  if (key) return `sku:${key}`;
  // บรรทัดที่ไม่มี SKU จับคู่กับใครไม่ได้ จึงแยกกลุ่มเป็นรายบรรทัด ไม่ยุบรวมกัน
  return `line:${row.item_id ?? index}`;
}

export function calculateJobStockShortage(rows: readonly JobStockCheckRow[] | null | undefined): JobStockShortageResult {
  const buckets = new Map<string, StockShortageGroup>();
  let snapshotDate: string | null = null;

  (rows ?? []).forEach((row, index) => {
    const key = groupKey(row, index);
    const planned = num(row.planned_qty) ?? 0;
    const actual = num(row.actual_qty);
    // actual_qty คือจำนวนที่คลังจัดจริง เมื่อคลังกรอกแล้วให้ถือว่าอันนั้นคือจำนวนที่งานนี้ต้องใช้
    const required = actual ?? planned;
    const picked = num(row.picked_qty) ?? 0;
    const outstanding = Math.max(0, round4(required - picked));
    const available = num(row.available_qty);
    if (row.snapshot_date && !snapshotDate) snapshotDate = row.snapshot_date;

    const existing = buckets.get(key);
    if (existing) {
      existing.requiredQty = round4(existing.requiredQty + required);
      existing.pickedQty = round4(existing.pickedQty + picked);
      existing.outstandingQty = round4(existing.outstandingQty + outstanding);
      if (row.item_id) existing.itemIds.push(row.item_id);
      const name = text(row.item_name);
      if (name && !existing.itemNames.includes(name)) existing.itemNames.push(name);
      // ของคงเหลือเป็นของ SKU ไม่ใช่ของบรรทัด ทุกบรรทัดในกลุ่มจึงเห็นตัวเลขเดียวกัน
      if (existing.availableQty === null && available !== null) existing.availableQty = available;
      if (!existing.stockSource && row.stock_source) existing.stockSource = row.stock_source;
      return;
    }
    buckets.set(key, {
      stockKey: text(row.stock_key) || null,
      itemIds: row.item_id ? [row.item_id] : [],
      itemNames: text(row.item_name) ? [text(row.item_name)] : [],
      unit: text(row.unit) || "หน่วย",
      requiredQty: round4(required),
      pickedQty: round4(picked),
      outstandingQty: outstanding,
      availableQty: available,
      shortageQty: 0,
      status: "unknown",
      stockSource: row.stock_source ?? null,
      registryQty: num(row.registry_qty),
      warehouseQty: num(row.warehouse_qty),
      warehouseName: row.warehouse_name ?? null,
      snapshotDate: row.snapshot_date ?? null,
    });
  });

  const groups = Array.from(buckets.values()).map((group) => {
    if (group.outstandingQty <= 0) return { ...group, shortageQty: 0, status: "not_required" as const };
    // ไม่มีแหล่งสต็อกให้เทียบ = ตรวจสอบไม่ได้ ห้ามเดาว่าพอหรือไม่พอ
    if (group.availableQty === null) return { ...group, shortageQty: 0, status: "unknown" as const };
    const shortage = round4(Math.max(0, group.outstandingQty - group.availableQty));
    return { ...group, shortageQty: shortage, status: (shortage > 0 ? "short" : "enough") as StockLineStatus };
  });

  const counts = {
    short: groups.filter((group) => group.status === "short").length,
    enough: groups.filter((group) => group.status === "enough").length,
    unknown: groups.filter((group) => group.status === "unknown").length,
    notRequired: groups.filter((group) => group.status === "not_required").length,
  };
  const shortGroups = groups.filter((group) => group.status === "short");
  return { groups, shortGroups, counts, hasShortage: shortGroups.length > 0, snapshotDate };
}

/**
 * วันที่ตามเวลาไทยในรูป YYYY-MM-DD
 * คิดด้วยการบวก 7 ชั่วโมงตรง ๆ เพราะประเทศไทยไม่มี daylight saving
 * จึงไม่ต้องพึ่ง Intl/ICU ซึ่งอาจไม่ครบใน runtime บางตัว
 */
export function bangkokDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * คีย์กันแจ้งเตือนซ้ำ — ต้องตรงกับที่ raise_job_stock_shortage_warning ประกอบฝั่งเซิร์ฟเวอร์
 * (supabase/migrations/20260902120030_stock_shortage_warning.sql)
 * ฝั่ง TS ใช้เพื่ออธิบาย/ทดสอบเท่านั้น ฐานข้อมูลไม่รับคีย์จากผู้เรียก
 */
export function stockShortageDedupeKey(jobNo: string, asOfDate: string): string {
  return `stock_shortage:${jobNo}:${asOfDate}`;
}

/** อ่านจำนวนวันเตือนล่วงหน้าจาก env — ค่าเพี้ยนให้ถอยไปค่าตั้งต้น ไม่ใช่ระเบิด */
export function readStockShortageLookaheadDays(env: Record<string, string | undefined>): number {
  const raw = env[STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV];
  if (raw === undefined || raw.trim() === "") return DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS;
  return Math.min(parsed, MAX_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
}

function qtyText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round4(value));
}

export function daysUntilLabel(daysUntil: number): string {
  if (daysUntil <= 0) return "วันนี้";
  if (daysUntil === 1) return "พรุ่งนี้";
  return `อีก ${daysUntil} วัน`;
}

export interface StockShortageMessageInput {
  jobNo: string;
  customerName?: string | null;
  daysUntil: number;
  installDate?: string | null;
  result: JobStockShortageResult;
}

/** ข้อความแจ้งเตือน (ไทย) — สั้นพอให้อ่านจบบนหน้าจอแจ้งเตือน แต่บอกให้ครบว่าขาดอะไรเท่าไหร่ */
export function stockShortageMessage(input: StockShortageMessageInput): { title: string; body: string } {
  const who = text(input.customerName) || input.jobNo;
  const title = `ของไม่พอ · ${who} · ติดตั้ง${daysUntilLabel(input.daysUntil)}`;
  const shown = input.result.shortGroups.slice(0, 5);
  const lines = shown.map((group) => {
    const name = group.itemNames[0] || group.stockKey || "รายการไม่ระบุชื่อ";
    const sku = group.stockKey ? ` (${group.stockKey})` : "";
    return `• ${name}${sku} ต้องใช้ ${qtyText(group.outstandingQty)} ${group.unit} · มี ${qtyText(group.availableQty ?? 0)} · ขาด ${qtyText(group.shortageQty)}`;
  });
  const rest = input.result.shortGroups.length - shown.length;
  if (rest > 0) lines.push(`• และอีก ${rest} รายการ`);
  if (input.result.counts.unknown > 0) {
    lines.push(`หมายเหตุ: อีก ${input.result.counts.unknown} รายการยังตรวจสอบไม่ได้ เพราะจับคู่กับสต็อกไม่ได้`);
  }
  const head = `งาน ${input.jobNo}${input.installDate ? ` · วันติดตั้ง ${input.installDate}` : ""} ขาดของ ${input.result.counts.short} รายการ`;
  return { title: title.slice(0, 200), body: [head, ...lines].join("\n").slice(0, 1000) };
}

type RpcResult = { data: unknown; error: unknown };
type StockCheckClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export const JOB_STOCK_CHECK_RPC = "get_job_stock_check";

export function toJobStockCheckRows(data: unknown): JobStockCheckRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is JobStockCheckRow => Boolean(row) && typeof row === "object");
}

/** ทางอ่านผลเช็คสต็อกของงานหนึ่งใบ — ผู้เรียกไม่ต้องรู้ว่ายอดคงเหลือมาจากแหล่งไหน */
export async function fetchJobStockCheck(
  client: StockCheckClient,
  jobNo: string,
): Promise<{ result: JobStockShortageResult; error: unknown }> {
  const { data, error } = await client.rpc(JOB_STOCK_CHECK_RPC, { p_job_no: jobNo });
  if (error) return { result: calculateJobStockShortage([]), error };
  return { result: calculateJobStockShortage(toJobStockCheckRows(data)), error: null };
}

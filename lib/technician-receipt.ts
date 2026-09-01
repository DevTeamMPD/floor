/**
 * P3-6 — ช่างยืนยันของที่มาถึงหน้างานรายบรรทัด: ป้ายภาษาไทย ชื่อ RPC และตรรกะบริสุทธิ์
 *
 * ผู้ตัดสินจริงคือ `public.record_technician_item_receipt` ฝั่งฐานข้อมูล
 * (supabase/migrations/20260902140010_technician_receipt_and_logistics_ncr.sql)
 * ไฟล์นี้เป็นด่านหน้าบนมือถือ เพื่อไม่ให้ช่างที่ยืนอยู่หน้างานต้องรอ round-trip
 * เพื่อรู้ว่า "ยังไม่ได้เลือกเหตุผล"
 *
 * เรื่องรายการเหตุผล — จุดที่ตั้งใจออกแบบให้ไม่มีทางเพี้ยน:
 *   รายการเหตุผลและการจับคู่ไปยัง ncr_reports.type เป็นของ `public.floor_receipt_reason_catalog()`
 *   ฝั่งเซิร์ฟเวอร์ **ที่เดียว** และ get_technician_receipt_lines ส่งรายการนั้นมาให้หน้าจอทุกครั้ง
 *   หน้าจอ render จาก payload ที่ได้มา ไม่ได้ render จากรายการที่ฝังในไฟล์นี้
 *   FALLBACK_RECEIPT_REASONS ด้านล่างใช้เฉพาะกรณีอ่าน payload ไม่ได้ (เน็ตหลุดกลางหน้างาน)
 *   จะได้ไม่เหลือหน้าจอที่มีปุ่ม "ได้ไม่ครบ" แต่ไม่มีเหตุผลให้เลือกเลย ซึ่งใช้งานไม่ได้จริง
 *   ถ้าฝั่งเซิร์ฟเวอร์เพิ่มเหตุผลใหม่ หน้าจอเห็นทันทีโดยไม่ต้องแก้ไฟล์นี้
 *
 * ข้อบังคับฝั่ง SQL ทั้งหมดถูกพิสูจน์ด้วย probe ที่รันจริง — ดู sdd-jobtpl/p35-probes.sql (P3, P4, P5)
 */

export const RECEIPT_STATUSES = ["received_full", "received_partial", "not_received"] as const;
export type ReceiptStatus = typeof RECEIPT_STATUSES[number];

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  received_full: "ได้ครบ",
  received_partial: "ได้ไม่ครบ",
  not_received: "ไม่ได้รับเลย",
};

export const TECHNICIAN_RECEIPT_LINES_RPC = "get_technician_receipt_lines";
export const RECORD_TECHNICIAN_RECEIPT_RPC = "record_technician_item_receipt";

/** เหตุผลที่ต้องพิมพ์อธิบายเพิ่มเสมอ — ตรงกับ constraint ..._other_note_check ฝั่งตาราง */
export const FREE_TEXT_REASON_CODE = "other";

export interface ReceiptReasonOption {
  code: string;
  label: string;
  /** ncr_reports.type ที่ระบบจะใช้ — มาจากเซิร์ฟเวอร์ ไม่ได้ตัดสินฝั่งนี้ */
  ncrType: string;
}

/**
 * ชุดสำรองสำหรับกรณีอ่านรายการจากเซิร์ฟเวอร์ไม่ได้เท่านั้น
 * ต้องตรงกับ public.floor_receipt_reason_catalog() — ถ้าไม่ตรง ตัวที่ถูกใช้จริงคือของเซิร์ฟเวอร์
 */
export const FALLBACK_RECEIPT_REASONS: ReceiptReasonOption[] = [
  { code: "stock_short", label: "ของไม่พอในคลัง", ncrType: "missing" },
  { code: "not_loaded", label: "ลืมโหลดขึ้นรถ", ncrType: "missing" },
  { code: "lost_on_route", label: "ตกหล่นระหว่างทาง", ncrType: "missing" },
  { code: "damaged", label: "ของเสียหาย", ncrType: "damage" },
  { code: "wrong_item", label: "ผิดรุ่น/ผิดสี", ncrType: "wrong" },
  { code: FREE_TEXT_REASON_CODE, label: "อื่น ๆ (ระบุเอง)", ncrType: "missing" },
];

export function parseReasonOptions(value: unknown): ReceiptReasonOption[] {
  if (!Array.isArray(value)) return FALLBACK_RECEIPT_REASONS;
  const parsed = value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!code || !label) return [];
    return [{ code, label, ncrType: typeof record.ncrType === "string" ? record.ncrType : "missing" }];
  });
  return parsed.length ? parsed : FALLBACK_RECEIPT_REASONS;
}

export function reasonLabel(options: readonly ReceiptReasonOption[], code: string | null | undefined): string {
  if (!code) return "—";
  return options.find((option) => option.code === code)?.label ?? code;
}

export interface TechnicianReceipt {
  status: string | null;
  receivedQty: number | string | null;
  expectedQty: number | string | null;
  shortageQty: number | string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  ncrId: string | null;
  technicianName: string | null;
  confirmedAt: string | null;
}

export interface TechnicianReceiptLine {
  itemId: string;
  category: string | null;
  itemName: string;
  sku: string | null;
  specification: string | null;
  unit: string;
  note: string | null;
  plannedQty: number | string | null;
  actualQty: number | string | null;
  pickedQty: number | string | null;
  pickStatus: string | null;
  pickNote: string | null;
  expectedQty: number | string | null;
  receipt: TechnicianReceipt | null;
}

export interface TechnicianReceiptPayload {
  found: boolean;
  reason?: string | null;
  workOrderId?: string | null;
  workOrderStatus?: string | null;
  jobNo?: string | null;
  canConfirm: boolean;
  reasonOptions: ReceiptReasonOption[];
  lines: TechnicianReceiptLine[];
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

export function qtyText(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value * 1e4) / 1e4;
  return String(rounded);
}

export function parseReceiptPayload(data: unknown): TechnicianReceiptPayload {
  const empty: TechnicianReceiptPayload = {
    found: false, reason: "invalid_payload", canConfirm: false,
    reasonOptions: FALLBACK_RECEIPT_REASONS, lines: [],
  };
  if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
  const record = data as Record<string, unknown>;
  const rawLines = Array.isArray(record.lines) ? record.lines : [];
  return {
    found: record.found === true,
    reason: typeof record.reason === "string" ? record.reason : null,
    workOrderId: typeof record.workOrderId === "string" ? record.workOrderId : null,
    workOrderStatus: typeof record.workOrderStatus === "string" ? record.workOrderStatus : null,
    jobNo: typeof record.jobNo === "string" ? record.jobNo : null,
    canConfirm: record.canConfirm === true,
    reasonOptions: parseReasonOptions(record.reasonOptions),
    lines: rawLines.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const line = row as Record<string, unknown>;
      if (typeof line.itemId !== "string") return [];
      return [{
        itemId: line.itemId,
        category: typeof line.category === "string" ? line.category : null,
        itemName: typeof line.itemName === "string" ? line.itemName : "ไม่ระบุชื่อ",
        sku: typeof line.sku === "string" ? line.sku : null,
        specification: typeof line.specification === "string" ? line.specification : null,
        unit: typeof line.unit === "string" && line.unit.trim() ? line.unit : "หน่วย",
        note: typeof line.note === "string" ? line.note : null,
        plannedQty: (line.plannedQty ?? null) as number | string | null,
        actualQty: (line.actualQty ?? null) as number | string | null,
        pickedQty: (line.pickedQty ?? null) as number | string | null,
        pickStatus: typeof line.pickStatus === "string" ? line.pickStatus : null,
        pickNote: typeof line.pickNote === "string" ? line.pickNote : null,
        expectedQty: (line.expectedQty ?? null) as number | string | null,
        receipt: line.receipt && typeof line.receipt === "object"
          ? line.receipt as unknown as TechnicianReceipt
          : null,
      }];
    }),
  };
}

/**
 * บรรทัด "โน้ต Freeform จากหัวหน้าช่าง" ไม่ใช่ของที่หยิบได้ จึงไม่ควรมีปุ่มตรวจรับ
 * เงื่อนไขเดียวกับ isFreeformWorkNote() ใน app/work/[token]/page.tsx (แหล่งเดียวกัน ตัวเลขเดียวกัน)
 */
export function isNoteOnlyLine(line: TechnicianReceiptLine): boolean {
  return line.category === "tool" && (num(line.plannedQty) ?? 0) === 0 && line.unit === "รายการ";
}

export function confirmableLines(lines: readonly TechnicianReceiptLine[]): TechnicianReceiptLine[] {
  return lines.filter((line) => !isNoteOnlyLine(line));
}

export type ReceiptQtyResult =
  | { ok: true; qty: number; shortage: number }
  | { ok: false; error: string };

/**
 * ด่านหน้าของ "ได้รับเท่าไหร่" — กติกาเดียวกับ record_technician_item_receipt
 *   received_full     -> เท่ากับที่คลังจ่ายมา (expected) เสมอ
 *   not_received      -> 0
 *   received_partial  -> ต้องเป็นตัวเลข > 0 และ < expected
 */
export function resolveReceivedQty(status: ReceiptStatus, rawQty: string, expectedQty: number | null): ReceiptQtyResult {
  const expected = expectedQty ?? 0;
  if (status === "received_full") return { ok: true, qty: expected, shortage: 0 };
  if (status === "not_received") return { ok: true, qty: 0, shortage: expected };

  const trimmed = rawQty.trim();
  if (trimmed === "") return { ok: false, error: "กรอกจำนวนที่ได้รับจริงก่อน" };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false, error: "จำนวนที่ได้รับต้องเป็นตัวเลข" };
  if (parsed <= 0) return { ok: false, error: `จำนวนที่ได้รับต้องมากกว่า 0 — ถ้าไม่ได้รับเลยให้เลือก “${RECEIPT_STATUS_LABELS.not_received}”` };
  if (parsed >= expected) {
    return { ok: false, error: `จำนวนที่ได้รับ (${qtyText(parsed)}) ไม่น้อยกว่าที่คลังจ่ายมา (${qtyText(expected)}) — ถ้าได้ครบให้เลือก “${RECEIPT_STATUS_LABELS.received_full}”` };
  }
  return { ok: true, qty: parsed, shortage: Math.round((expected - parsed) * 1e4) / 1e4 };
}

export function needsReason(status: ReceiptStatus): boolean {
  return status !== "received_full";
}

export function needsFreeText(reasonCode: string | null): boolean {
  return reasonCode === FREE_TEXT_REASON_CODE;
}

export interface ReceiptFormState {
  status: ReceiptStatus;
  rawQty: string;
  reasonCode: string | null;
  reasonNote: string;
  expectedQty: number | null;
}

/** ตรวจฟอร์มทั้งใบก่อนยิง RPC — คืน error แรกที่เจอเป็นภาษาไทย หรือ null ถ้าผ่าน */
export function receiptFormError(state: ReceiptFormState): string | null {
  const qty = resolveReceivedQty(state.status, state.rawQty, state.expectedQty);
  if (!qty.ok) return qty.error;
  if (!needsReason(state.status)) return null;
  if (!state.reasonCode) return "เลือกเหตุผลว่าทำไมของไม่ครบ";
  if (needsFreeText(state.reasonCode) && state.reasonNote.trim() === "") return "เลือก “อื่น ๆ” ต้องพิมพ์อธิบายด้วย";
  return null;
}

/** จะเปิด NC ให้อัตโนมัติหรือไม่ — ใช้บอกช่างล่วงหน้าว่ากดแล้วจะเกิดอะไร */
export function willOpenNcr(status: ReceiptStatus): boolean {
  return status !== "received_full";
}

export interface ReceiptProgress {
  total: number;
  confirmed: number;
  pending: number;
  shortLines: number;
  ncrCount: number;
  allConfirmed: boolean;
}

export function summariseReceipts(lines: readonly TechnicianReceiptLine[]): ReceiptProgress {
  const relevant = confirmableLines(lines);
  let confirmed = 0;
  let shortLines = 0;
  let ncrCount = 0;
  for (const line of relevant) {
    if (!line.receipt?.status) continue;
    confirmed += 1;
    if (line.receipt.status !== "received_full") shortLines += 1;
    if (line.receipt.ncrId) ncrCount += 1;
  }
  return {
    total: relevant.length,
    confirmed,
    pending: relevant.length - confirmed,
    shortLines,
    ncrCount,
    allConfirmed: relevant.length > 0 && confirmed === relevant.length,
  };
}

/** สิ่งที่คลังบันทึกไว้ตอนหยิบ แสดงข้างบรรทัดให้ช่างเห็นก่อนตอบ */
export function warehouseSaidLabel(line: TechnicianReceiptLine): string {
  const expected = num(line.expectedQty);
  const unit = line.unit;
  if (line.pickStatus === "unavailable") {
    return `คลังแจ้งว่าไม่มีของ${line.pickNote ? ` · ${line.pickNote}` : ""}`;
  }
  if (line.pickStatus === "picked_partial") {
    return `คลังหยิบได้ ${qtyText(expected)} ${unit} จากแผน ${qtyText(num(line.plannedQty))} ${unit}${line.pickNote ? ` · ${line.pickNote}` : ""}`;
  }
  if (line.pickStatus === "picked_full") {
    return `คลังหยิบครบ ${qtyText(expected)} ${unit}`;
  }
  return `คลังไม่ได้บันทึกรายบรรทัด · ใช้ตัวเลขตามใบ ${qtyText(expected)} ${unit}`;
}

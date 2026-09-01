/**
 * P3-5 — การหยิบของรายบรรทัดของคลัง: ป้ายภาษาไทย ชื่อ RPC และตรรกะบริสุทธิ์ที่หน้าจอใช้
 *
 * ใครเป็นผู้ตัดสินจริง: `public.record_warehouse_item_pick` ฝั่งฐานข้อมูล
 * (supabase/migrations/20260902140000_warehouse_line_picking.sql)
 * ไฟล์นี้ทำสองอย่างเท่านั้น
 *   1) ด่านหน้า — ตรวจค่าที่คนคลังกรอกก่อนยิง RPC เพื่อไม่ให้ต้องรอ round-trip
 *      เพื่อรู้ว่า "0 ใช้ไม่ได้" ทั้งที่ยืนอยู่หน้ากองของ
 *   2) คิดตัวเลขสำหรับ "แสดง" (สรุปความคืบหน้า, prefill ช่องของทางเดิมทั้งใบ)
 *
 * กติกาสำคัญ: ถ้าสองฝั่งเห็นไม่ตรงกัน **ฝั่ง SQL ชนะเสมอ** เพราะเป็นคนเขียนลงฐานข้อมูลจริง
 * ด่านหน้าในไฟล์นี้จึงต้อง "ไม่หลวมกว่า" SQL แต่ถ้าเข้มกว่าโดยไม่ตั้งใจก็ยังปลอดภัย
 * (คนกดไม่ได้ ดีกว่ากดได้แล้วเจอ error ที่อ่านไม่รู้เรื่อง)
 * ข้อบังคับฝั่ง SQL ถูกพิสูจน์ด้วย probe ที่รันจริง — ดู sdd-jobtpl/p35-probes.sql (P1, P2)
 *
 * เรื่องยอดคงเหลือ: ไฟล์นี้ **ไม่มี** สูตรคำนวณ "ของขาดเท่าไหร่" ของตัวเอง
 * get_warehouse_pick_lines ตั้งชื่อคอลัมน์ให้ตรงกับ get_job_stock_check โดยตั้งใจ
 * หน้าจอจึงส่งแถวเข้า calculateJobStockShortage() ใน lib/stock-shortage.ts ตัวเดิมได้เลย
 * ถ้าเขียนสูตรที่สองในไฟล์นี้ วันหนึ่งเลข "ของขาด" บนหน้าคลังกับบนหน้าใบสั่งงานจะไม่ตรงกัน
 */

import type { JobStockCheckRow } from "@/lib/stock-shortage";

export const PICK_STATUSES = ["picked_full", "picked_partial", "unavailable"] as const;
export type PickStatus = typeof PICK_STATUSES[number];

export const PICK_STATUS_LABELS: Record<PickStatus, string> = {
  picked_full: "หยิบครบ",
  picked_partial: "หยิบได้บางส่วน",
  unavailable: "ไม่มีของ",
};

/** ข้อความสั้นที่ใช้บนป้ายสถานะรายบรรทัด — สั้นกว่าปุ่ม เพราะต้องอยู่ในบรรทัดเดียวกับชื่อของ */
export const PICK_STATUS_BADGE: Record<PickStatus, string> = {
  picked_full: "ครบ",
  picked_partial: "บางส่วน",
  unavailable: "ไม่มีของ",
};

export const RECORD_ITEM_PICK_RPC = "record_warehouse_item_pick";
export const WAREHOUSE_PICK_LINES_RPC = "get_warehouse_pick_lines";

export function isPickStatus(value: unknown): value is PickStatus {
  return typeof value === "string" && (PICK_STATUSES as readonly string[]).includes(value);
}

/**
 * แถวจาก get_warehouse_pick_lines — ต่อยอดจาก JobStockCheckRow โดยตรง
 * ชื่อคอลัมน์ชุดสต็อกจึงเหมือนกันเป๊ะและใช้ calculateJobStockShortage() ได้ทันที
 */
export interface WarehousePickLine extends JobStockCheckRow {
  specification: string | null;
  note: string | null;
  sort_order: number | null;
  pick_status: string | null;
  pick_note: string | null;
  picked_at: string | null;
  picked_by_name: string | null;
}

export function toWarehousePickLines(data: unknown): WarehousePickLine[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is WarehousePickLine => Boolean(row) && typeof row === "object");
}

/** numeric ของ postgres มาเป็น string ได้ตามการ serialize ของ PostgREST */
export function num(value: unknown): number | null {
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

/** ตัดทศนิยมส่วนเกินก่อนแสดง เพื่อไม่ให้ 2.5000000001 ขึ้นหน้าจอ */
export function qtyText(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value * 1e4) / 1e4;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export type PickQtyResult =
  | { ok: true; qty: number }
  | { ok: false; error: string };

/**
 * ด่านหน้าของ "จะบันทึกจำนวนเท่าไหร่" — กติกาเดียวกับ record_warehouse_item_pick
 *   picked_full     -> ใช้ planned_qty เสมอ (ตัวเลขที่คนพิมพ์ถูกเมิน เหมือนฝั่ง SQL)
 *   unavailable     -> 0 เสมอ
 *   picked_partial  -> ต้องเป็นตัวเลข > 0 และ < planned_qty
 * ค่าที่ขอบ (0 หรือเท่ากับแผน) ไม่ใช่ "ผิด" แต่แปลว่าคนกดปุ่มผิด จึงบอกตรง ๆ ว่าให้กดปุ่มไหน
 */
export function resolvePickedQty(status: PickStatus, rawQty: string, plannedQty: number | null): PickQtyResult {
  const planned = plannedQty ?? 0;
  if (status === "picked_full") return { ok: true, qty: planned };
  if (status === "unavailable") return { ok: true, qty: 0 };

  const trimmed = rawQty.trim();
  if (trimmed === "") return { ok: false, error: "กรอกจำนวนที่หยิบได้ก่อน" };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false, error: "จำนวนที่หยิบได้ต้องเป็นตัวเลข" };
  if (parsed <= 0) return { ok: false, error: `หยิบได้บางส่วนต้องมากกว่า 0 — ถ้าหยิบไม่ได้เลยให้เลือก “${PICK_STATUS_LABELS.unavailable}”` };
  if (parsed >= planned) {
    return { ok: false, error: `จำนวนที่กรอก (${qtyText(parsed)}) ไม่น้อยกว่าจำนวนตามแผน (${qtyText(planned)}) — ถ้าหยิบได้ครบให้เลือก “${PICK_STATUS_LABELS.picked_full}”` };
  }
  return { ok: true, qty: parsed };
}

/** "ไม่มีของ" ต้องบอกเหตุผล — ข้อบังคับเดียวกับฝั่ง SQL */
export function pickNoteError(status: PickStatus, note: string): string | null {
  if (status !== "unavailable") return null;
  return note.trim() === "" ? "บอกเหตุผลด้วยว่าทำไมไม่มีของ เพื่อให้ช่างและหัวหน้าช่างหาของทดแทนได้" : null;
}

export interface PickProgress {
  total: number;
  full: number;
  partial: number;
  unavailable: number;
  pending: number;
  /** ทุกบรรทัดถูกแตะแล้ว (ไม่ได้แปลว่าหยิบได้ครบทุกบรรทัด) */
  allTouched: boolean;
  /** มีบรรทัดที่หยิบไม่ครบหรือไม่มีของ — ใช้เตือนก่อนส่งงานไปให้ช่าง */
  hasShortfall: boolean;
}

export function summarisePickProgress(lines: readonly WarehousePickLine[]): PickProgress {
  let full = 0;
  let partial = 0;
  let unavailable = 0;
  let pending = 0;
  for (const line of lines) {
    if (line.pick_status === "picked_full") full += 1;
    else if (line.pick_status === "picked_partial") partial += 1;
    else if (line.pick_status === "unavailable") unavailable += 1;
    else pending += 1;
  }
  return {
    total: lines.length,
    full,
    partial,
    unavailable,
    pending,
    allTouched: lines.length > 0 && pending === 0,
    hasShortfall: partial + unavailable > 0,
  };
}

/**
 * ข้อความ "คลังมี N" ที่ปิ๊กเกอร์เห็นข้างบรรทัด
 * null (จับคู่สต็อกไม่ได้) ต้องอ่านว่า "ตรวจสอบไม่ได้" ห้ามแสดงเป็น 0
 * เพราะ 0 แปลว่า "ของหมด" ซึ่งเป็นคำโกหกถ้าความจริงคือ "ไม่รู้"
 * (หลักการเดียวกับ lib/stock-shortage.ts ที่แยก unknown ออกจาก short/enough)
 */
export function stockBesideLineLabel(line: WarehousePickLine): string {
  const available = num(line.available_qty);
  if (available === null) return "คลังมี: ตรวจสอบไม่ได้";
  return `คลังมี ${qtyText(available)} ${line.unit?.trim() || "หน่วย"}`;
}

/**
 * สะพานไปทางเดิมทั้งใบ: prefill ช่อง "จำนวนที่คลังจัดจริง" (actual_qty) จากผลการหยิบรายบรรทัด
 * ลำดับความสำคัญ picked_qty -> actual_qty -> planned_qty
 * เจตนา: คลังที่หยิบทีละบรรทัดแล้วต้องไม่ต้องพิมพ์เลขเดิมซ้ำอีกรอบตอนปิดงานทั้งใบ
 * และบรรทัดที่ยังไม่ได้แตะก็ยังได้พฤติกรรมเดิมเป๊ะ ๆ (planned_qty) ไม่ได้เปลี่ยนอะไรให้ใคร
 */
export function prefillActualQtyFromPicks(
  lines: readonly { id: string; planned_qty: number; actual_qty?: number | null; picked_qty?: number | null }[],
): Record<string, string> {
  return Object.fromEntries(lines.map((line) => {
    const picked = num(line.picked_qty);
    const actual = num(line.actual_qty);
    const value = picked ?? actual ?? line.planned_qty;
    return [line.id, String(value)];
  }));
}

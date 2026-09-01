/**
 * P4-1 — ช่างปิดยอดหน้างาน: "ของนี้ใช้ไปเท่าไหร่ และเอากลับมาคืนเท่าไหร่"
 *
 * ผู้ตัดสินจริงคือฝั่งฐานข้อมูล:
 *   public.record_technician_line_usage  (supabase/migrations/20260902150010_...)
 *   trigger floor_work_order_items_usage_guard_trg บังคับ "ใช้ + คืน <= ที่เบิกออกไป"
 *   และห้ามบันทึก "ใช้ไป" บนเครื่องมือ (item_kind = 'tool') — บังคับที่ระดับตาราง
 * ไฟล์นี้เป็นด่านหน้าบนมือถือ เพื่อไม่ให้ช่างที่ยืนกลางหน้างานต้องรอ round-trip
 * เพื่อรู้ว่า "พิมพ์เกินไปแล้ว" — กติกาเหมือนกันทุกข้อ ข้อความไทยชุดเดียวกัน
 *
 * ข้อบังคับฝั่ง SQL ทุกข้อถูกพิสูจน์ด้วย probe ที่รันจริง — ดู sdd-jobtpl/p41-probes.sql (P1, P2, P3)
 */

import { isNoteOnlyLine } from "./technician-receipt";

export const TECHNICIAN_USAGE_LINES_RPC = "get_technician_usage_lines";
export const RECORD_TECHNICIAN_USAGE_RPC = "record_technician_line_usage";

export type JobItemKind = "consumable" | "tool";

export interface UsageLine {
  itemId: string;
  category: string | null;
  itemKind: JobItemKind | null;
  itemName: string;
  sku: string | null;
  /** ต้องมีเพื่อให้ใช้กฎ "บรรทัดไหนไม่ใช่ของ" ตัวเดียวกับทุกหน้าจอได้ (lib/freeform-work-note.ts) */
  sourceType: string | null;
  specification: string | null;
  unit: string;
  note: string | null;
  plannedQty: number | string | null;
  actualQty: number | string | null;
  pickedQty: number | string | null;
  pickStatus: string | null;
  expectedQty: number | string | null;
  usedQty: number | string | null;
  returnedQty: number | string | null;
  usageNote: string | null;
  usageRecordedAt: string | null;
  usageRecordedByName: string | null;
}

export interface UsagePayload {
  found: boolean;
  reason: string | null;
  workOrderId: string | null;
  workOrderStatus: string | null;
  jobNo: string | null;
  /** เขียนได้ไหม — ฝั่งเซิร์ฟเวอร์ตัดสินจากสถานะใบสั่งงาน หน้าจอแค่เชื่อ */
  canRecord: boolean;
  /** งานปิดแล้ว: คืนของได้ แต่แก้ยอดใช้ไม่ได้ */
  returnOnly: boolean;
  lines: UsageLine[];
}

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

export function qtyText(value: number | null): string {
  if (value === null) return "—";
  return String(Math.round(value * 1e4) / 1e4);
}

export function parseUsagePayload(data: unknown): UsagePayload {
  const empty: UsagePayload = {
    found: false, reason: "invalid_payload", workOrderId: null, workOrderStatus: null,
    jobNo: null, canRecord: false, returnOnly: false, lines: [],
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
    canRecord: record.canRecord === true,
    returnOnly: record.returnOnly === true,
    lines: rawLines.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const line = row as Record<string, unknown>;
      if (typeof line.itemId !== "string") return [];
      const kind = line.itemKind === "tool" || line.itemKind === "consumable" ? line.itemKind : null;
      return [{
        itemId: line.itemId,
        category: typeof line.category === "string" ? line.category : null,
        itemKind: kind,
        itemName: typeof line.itemName === "string" ? line.itemName : "ไม่ระบุชื่อ",
        sku: typeof line.sku === "string" ? line.sku : null,
        sourceType: typeof line.sourceType === "string" ? line.sourceType : null,
        specification: typeof line.specification === "string" ? line.specification : null,
        unit: typeof line.unit === "string" && line.unit.trim() ? line.unit : "หน่วย",
        note: typeof line.note === "string" ? line.note : null,
        plannedQty: (line.plannedQty ?? null) as number | string | null,
        actualQty: (line.actualQty ?? null) as number | string | null,
        pickedQty: (line.pickedQty ?? null) as number | string | null,
        pickStatus: typeof line.pickStatus === "string" ? line.pickStatus : null,
        expectedQty: (line.expectedQty ?? null) as number | string | null,
        usedQty: (line.usedQty ?? null) as number | string | null,
        returnedQty: (line.returnedQty ?? null) as number | string | null,
        usageNote: typeof line.usageNote === "string" ? line.usageNote : null,
        usageRecordedAt: typeof line.usageRecordedAt === "string" ? line.usageRecordedAt : null,
        usageRecordedByName: typeof line.usageRecordedByName === "string" ? line.usageRecordedByName : null,
      }];
    }),
  };
}

/** บรรทัดที่ปิดยอดได้จริง: ต้องมีของออกจากคลังไปแล้ว และไม่ใช่โน้ต Freeform ของหัวหน้าช่าง */
export function closableLines(lines: readonly UsageLine[]): UsageLine[] {
  return lines.filter((line) => !isNoteOnlyLine(line) && (num(line.expectedQty) ?? 0) > 0);
}

/** เครื่องมือไม่ใช่ของสิ้นเปลือง — หน้าจอจึงต้องไม่มีช่อง "ใช้ไป" ให้กรอกตั้งแต่แรก */
export function allowsUsedQty(line: UsageLine): boolean {
  return line.itemKind !== "tool";
}

/**
 * ของที่เบิกไปแล้วไม่ได้ใช้และไม่ได้คืน = ยังอยู่กับทีมช่าง หรือหายไป
 * ต้องเป็นตัวเลขที่มองเห็น ไม่ใช่ส่วนต่างที่ไม่มีใครคำนวณ
 */
export function unaccountedQty(expected: number | null, used: number | null, returned: number | null): number | null {
  if (expected === null) return null;
  return Math.round((expected - (used ?? 0) - (returned ?? 0)) * 1e4) / 1e4;
}

export interface UsageFormState {
  usedRaw: string;
  returnedRaw: string;
  expectedQty: number | null;
  line: UsageLine;
  /** งานปิดแล้ว แก้ได้เฉพาะยอดคืน */
  returnOnly: boolean;
}

export type UsageResolveResult =
  | { ok: true; used: number | null; returned: number | null; unaccounted: number | null }
  | { ok: false; error: string };

function parseField(raw: string, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { ok: false, error: `${label}ต้องเป็นตัวเลข` };
  if (parsed < 0) return { ok: false, error: `${label}ต้องไม่ติดลบ` };
  return { ok: true, value: parsed };
}

/**
 * กติกาเดียวกับ record_technician_line_usage + trigger ฝั่งตาราง:
 *   ต้องกรอกอย่างน้อยหนึ่งช่อง · ไม่ติดลบ · เครื่องมือกรอก "ใช้ไป" ไม่ได้
 *   ใช้ + คืน ต้องไม่เกินที่เบิกออกไป · งานปิดแล้วแก้ยอดใช้ไม่ได้
 * ช่องที่เว้นว่าง = "ไม่แตะค่าเดิม" (ส่ง null ไปให้ RPC) ไม่ใช่ "ตั้งเป็นศูนย์"
 */
export function resolveUsage(state: UsageFormState): UsageResolveResult {
  const { line, expectedQty, returnOnly } = state;
  const used = parseField(state.usedRaw, "จำนวนที่ใช้");
  if (!used.ok) return { ok: false, error: used.error };
  const returned = parseField(state.returnedRaw, "จำนวนที่คืน");
  if (!returned.ok) return { ok: false, error: returned.error };

  if (used.value === null && returned.value === null) {
    return { ok: false, error: "กรอกอย่างน้อยหนึ่งช่อง: ใช้ไปเท่าไหร่ หรือคืนเท่าไหร่" };
  }
  if (used.value !== null && !allowsUsedQty(line)) {
    return {
      ok: false,
      error: `“${line.itemName}” เป็นเครื่องมือที่ต้องคืน ไม่ใช่ของสิ้นเปลือง จึงบันทึก “ใช้ไป” ไม่ได้ — ถ้าเอากลับมาแล้วให้กรอกช่องจำนวนที่คืน`,
    };
  }

  const currentUsed = num(line.usedQty);
  const currentReturned = num(line.returnedQty);
  const nextUsed = used.value ?? currentUsed;
  const nextReturned = returned.value ?? currentReturned;

  if (returnOnly && (nextUsed ?? 0) !== (currentUsed ?? 0)) {
    return { ok: false, error: "งานนี้ปิดไปแล้ว แก้ยอดที่ใช้ไม่ได้ — บันทึกได้เฉพาะจำนวนที่เอากลับมาคืน" };
  }

  const expected = expectedQty ?? 0;
  const total = (nextUsed ?? 0) + (nextReturned ?? 0);
  if (total > expected) {
    return {
      ok: false,
      error: `ใช้ไป ${qtyText(nextUsed ?? 0)} + คืน ${qtyText(nextReturned ?? 0)} = ${qtyText(total)} ${line.unit} แต่เบิกออกไปแค่ ${qtyText(expected)} ${line.unit} — ยอดใช้บวกยอดคืนต้องไม่เกินของที่เบิกออกไป`,
    };
  }

  return {
    ok: true,
    used: used.value,
    returned: returned.value,
    unaccounted: unaccountedQty(expectedQty, nextUsed, nextReturned),
  };
}

export interface UsageProgress {
  total: number;
  closed: number;
  pending: number;
  outstandingTools: number;
  unaccountedLines: number;
}

/** บรรทัดถือว่า "ปิดยอดแล้ว" เมื่อช่างเคยบันทึกอย่างน้อยหนึ่งค่า */
export function isClosed(line: UsageLine): boolean {
  return num(line.usedQty) !== null || num(line.returnedQty) !== null;
}

/** เครื่องมือที่เบิกไปแล้วยังคืนไม่ครบ — กติกาเดียวกับ get_outstanding_tools ฝั่ง SQL */
export function isOutstandingTool(line: UsageLine): boolean {
  const picked = num(line.pickedQty) ?? 0;
  if (line.itemKind !== "tool" || picked <= 0) return false;
  return (num(line.returnedQty) ?? 0) < picked;
}

export function summariseUsage(lines: readonly UsageLine[]): UsageProgress {
  const relevant = closableLines(lines);
  let closed = 0;
  let outstandingTools = 0;
  let unaccountedLines = 0;
  for (const line of relevant) {
    if (isClosed(line)) closed += 1;
    if (isOutstandingTool(line)) outstandingTools += 1;
    const gap = unaccountedQty(num(line.expectedQty), num(line.usedQty), num(line.returnedQty));
    if (isClosed(line) && gap !== null && gap > 0) unaccountedLines += 1;
  }
  return {
    total: relevant.length,
    closed,
    pending: relevant.length - closed,
    outstandingTools,
    unaccountedLines,
  };
}

/** สิ่งที่คลังจ่ายมา แสดงข้างบรรทัดให้ช่างเห็นก่อนกรอก */
export function issuedLabel(line: UsageLine): string {
  const expected = num(line.expectedQty);
  if (line.pickStatus === "picked_partial") {
    return `คลังจ่ายมา ${qtyText(expected)} ${line.unit} (แผน ${qtyText(num(line.plannedQty))} ${line.unit})`;
  }
  if (line.pickStatus === "picked_full") return `คลังจ่ายมา ${qtyText(expected)} ${line.unit}`;
  return `ตามใบสั่งงาน ${qtyText(expected)} ${line.unit}`;
}

export function usageSummaryLabel(line: UsageLine): string {
  if (!isClosed(line)) return "ยังไม่ได้ปิดยอด";
  const used = num(line.usedQty);
  const returned = num(line.returnedQty);
  const gap = unaccountedQty(num(line.expectedQty), used, returned);
  const parts: string[] = [];
  if (line.itemKind !== "tool") parts.push(`ใช้ ${qtyText(used ?? 0)}`);
  parts.push(`คืน ${qtyText(returned ?? 0)}`);
  if (gap !== null && gap > 0) parts.push(`ยังไม่กลับ ${qtyText(gap)}`);
  return `${parts.join(" · ")} ${line.unit}`;
}

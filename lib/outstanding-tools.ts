/**
 * P4-2 — เครื่องมือที่เบิกออกไปแล้วยังไม่ได้คืน: การแปลงแถว การจัดลำดับ และป้ายภาษาไทย
 *
 * แหล่งความจริงคือ public.get_outstanding_tools() (supabase/migrations/20260902150020_...)
 * ซึ่งเป็นตัวตัดสินว่าอะไรคือ "ค้าง" ใครคือผู้รับผิดชอบ และค้างมากี่วัน
 * ไฟล์นี้ไม่ตัดสินใหม่ แค่จัดเรียง จัดกลุ่มความเร่งด่วน และแปลงเป็นข้อความที่คนอ่านออก
 *
 * "อยู่กับใคร" = ทีม เป็นคำตอบหลัก (appointments.tech_id -> tech_teams) เพราะงานถูกมอบหมายที่ระดับทีมเสมอ
 * ส่วนช่างรายคนเป็น "เบอร์ที่โทรได้" ไม่ใช่ตัวผู้รับผิดชอบ — เหตุผลเต็มอยู่ในหัวไฟล์ migration
 *
 * พฤติกรรมฝั่ง SQL ถูกพิสูจน์ด้วย probe ที่รันจริง — ดู sdd-jobtpl/p41-probes.sql (P5)
 */

export const OUTSTANDING_TOOLS_RPC = "get_outstanding_tools";

export interface OutstandingToolRow {
  itemId: string;
  workOrderId: string | null;
  workOrderStatus: string | null;
  jobNo: string;
  customerName: string | null;
  itemName: string;
  sku: string | null;
  unit: string;
  pickedQty: number;
  returnedQty: number;
  outstandingQty: number;
  outSince: string | null;
  outSinceSource: string | null;
  daysOut: number;
  appointmentStart: string | null;
  teamId: string | null;
  teamName: string;
  teamPhone: string | null;
  teamProviderType: string | null;
  holderTechnicianId: string | null;
  holderTechnicianName: string | null;
  holderTechnicianPhone: string | null;
  holderSource: string | null;
  providerId: string | null;
  providerName: string | null;
  usageRecordedAt: string | null;
  usageNote: string | null;
  pickNote: string | null;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function parseOutstandingTools(rows: unknown): OutstandingToolRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.item_id !== "string" || typeof r.job_no !== "string") return [];
    return [{
      itemId: r.item_id,
      workOrderId: str(r.work_order_id),
      workOrderStatus: str(r.work_order_status),
      jobNo: r.job_no,
      customerName: str(r.customer_name),
      itemName: str(r.item_name) ?? "ไม่ระบุชื่อ",
      sku: str(r.sku),
      unit: str(r.unit) ?? "หน่วย",
      pickedQty: num(r.picked_qty),
      returnedQty: num(r.returned_qty),
      outstandingQty: num(r.outstanding_qty),
      outSince: str(r.out_since),
      outSinceSource: str(r.out_since_source),
      daysOut: Math.max(0, Math.trunc(num(r.days_out))),
      appointmentStart: str(r.appointment_start),
      teamId: str(r.team_id),
      teamName: str(r.team_name) ?? "ยังไม่ระบุทีม",
      teamPhone: str(r.team_phone),
      teamProviderType: str(r.team_provider_type),
      holderTechnicianId: str(r.holder_technician_id),
      holderTechnicianName: str(r.holder_technician_name),
      holderTechnicianPhone: str(r.holder_technician_phone),
      holderSource: str(r.holder_source),
      providerId: str(r.provider_id),
      providerName: str(r.provider_name),
      usageRecordedAt: str(r.usage_recorded_at),
      usageNote: str(r.usage_note),
      pickNote: str(r.pick_note),
    }];
  });
}

/**
 * ระดับความเร่งด่วนจากจำนวนวันที่ค้าง
 * เครื่องมือควรกลับมาพร้อมรถในวันเดียวกันหรือวันรุ่งขึ้น เกิน 1 วันคือเริ่มผิดปกติ
 * เกิน 7 วันคือของหายจนต้องตามจริงจัง ไม่ใช่แค่ลืมคืน
 */
export type OverdueLevel = "fresh" | "warn" | "critical";

export function overdueLevel(daysOut: number): OverdueLevel {
  if (daysOut >= 7) return "critical";
  if (daysOut >= 2) return "warn";
  return "fresh";
}

export const OVERDUE_LEVEL_LABELS: Record<OverdueLevel, string> = {
  fresh: "เพิ่งเบิกออกไป",
  warn: "เริ่มค้าง",
  critical: "ค้างนาน ต้องตาม",
};

export function daysOutLabel(daysOut: number): string {
  if (daysOut <= 0) return "วันนี้";
  return `${daysOut} วัน`;
}

/** ทีมภายนอกคือกรณีที่ต้องเห็นชัดที่สุด: ของค้างอยู่กับบริษัทอื่น ไม่ใช่กับพนักงานเรา */
export function isExternalHolder(row: OutstandingToolRow): boolean {
  return row.teamProviderType === "subcontract" || row.providerId !== null;
}

export function holderLabel(row: OutstandingToolRow): string {
  const parts = [row.teamName];
  if (row.holderTechnicianName) parts.push(`ช่าง ${row.holderTechnicianName}`);
  if (row.providerName) parts.push(`ผู้รับเหมา ${row.providerName}`);
  else if (row.teamProviderType === "subcontract") parts.push("ทีมภายนอก (ยังไม่ผูกกับผู้รับเหมา)");
  return parts.join(" · ");
}

/** บอกตรง ๆ ว่ารู้ตัวคนได้อย่างไร เพราะ "หัวหน้าทีมของนัดหมาย" ไม่ได้แปลว่าเขาถือของอยู่จริง */
export const HOLDER_SOURCE_LABELS: Record<string, string> = {
  usage: "ช่างที่บันทึกยอดใช้/คืนล่าสุด",
  receipt: "ช่างที่ตรวจรับของบรรทัดนี้หน้างาน",
  team_lead: "หัวหน้าทีมของนัดหมายนี้ (ยังไม่มีใครบันทึกยอด)",
  unknown: "ยังไม่รู้ตัวช่าง — ติดต่อผ่านทีม",
};

export function holderSourceLabel(row: OutstandingToolRow): string {
  return HOLDER_SOURCE_LABELS[row.holderSource ?? "unknown"] ?? HOLDER_SOURCE_LABELS.unknown;
}

export function callablePhone(row: OutstandingToolRow): string | null {
  return row.holderTechnicianPhone ?? row.teamPhone;
}

export type OutstandingSortKey = "days" | "job" | "team" | "qty";

export interface OutstandingSort {
  key: OutstandingSortKey;
  desc: boolean;
}

/** ค่าเริ่มต้นคือค้างนานสุดก่อน — สิ่งที่ควรถูกตามก่อนต้องอยู่บนสุดโดยไม่ต้องกดอะไร */
export const DEFAULT_OUTSTANDING_SORT: OutstandingSort = { key: "days", desc: true };

export function sortOutstandingTools(
  rows: readonly OutstandingToolRow[],
  sort: OutstandingSort = DEFAULT_OUTSTANDING_SORT,
): OutstandingToolRow[] {
  const direction = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    let diff = 0;
    if (sort.key === "days") diff = a.daysOut - b.daysOut;
    else if (sort.key === "qty") diff = a.outstandingQty - b.outstandingQty;
    else if (sort.key === "team") diff = a.teamName.localeCompare(b.teamName, "th");
    else diff = a.jobNo.localeCompare(b.jobNo, "th");
    if (diff !== 0) return diff * direction;
    // ตัวตัดสินสุดท้ายคงที่เสมอ เพื่อไม่ให้ลำดับสลับไปมาระหว่างการรีเฟรช
    return a.itemId.localeCompare(b.itemId);
  });
}

export interface OutstandingSummary {
  lines: number;
  totalQty: number;
  teams: number;
  external: number;
  critical: number;
  oldestDays: number;
}

export function summariseOutstandingTools(rows: readonly OutstandingToolRow[]): OutstandingSummary {
  const teams = new Set<string>();
  let totalQty = 0;
  let external = 0;
  let critical = 0;
  let oldestDays = 0;
  for (const row of rows) {
    teams.add(row.teamId ?? row.teamName);
    totalQty += row.outstandingQty;
    if (isExternalHolder(row)) external += 1;
    if (overdueLevel(row.daysOut) === "critical") critical += 1;
    if (row.daysOut > oldestDays) oldestDays = row.daysOut;
  }
  return {
    lines: rows.length,
    totalQty: Math.round(totalQty * 1e4) / 1e4,
    teams: rows.length ? teams.size : 0,
    external,
    critical,
    oldestDays,
  };
}

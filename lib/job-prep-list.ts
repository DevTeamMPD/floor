import { WORK_ITEM_CATEGORIES, type WorkItemCategory } from "@/lib/work-orders";

/**
 * ทางอ่าน "รายการของที่ต้องเตรียมของงานหนึ่งใบ" ทางเดียวของแอป
 *
 * เดิมหน้าจอต้องรู้เองว่ารายการอยู่ได้หลายที่ แล้วเขียนตรรกะ fallback ซ้ำในทุกหน้า
 * ตอนนี้ตรรกะนั้นย้ายไปอยู่ใน RPC `get_job_prep_list` ฝั่งฐานข้อมูล
 * (supabase/migrations/20260902100100_job_prep_list_unified_read.sql)
 * ไฟล์นี้ทำหน้าที่แค่แปลงแถวที่ได้กลับมาให้เป็นรูปแบบที่ฟอร์มบนหน้าจอใช้ได้
 *
 * ฝั่งเขียนยังไม่ถูกแตะ: floor_work_order_items, floor_job_materials และ install_jobs.pick_plan
 * ยังถูกเขียนด้วยเส้นทางเดิมทุกประการ งานนี้รวมเฉพาะ "ฝั่งอ่าน"
 */

/** ที่มาของแต่ละบรรทัด — ต้องตรงกับค่าที่ RPC ติดป้ายมา บวกค่าที่เกิดขึ้นฝั่งหน้าจอเอง */
export type JobPrepSource =
  | "work_order_item" // บรรทัดจริงใน floor_work_order_items — แหล่งที่ถือว่าถูกต้อง
  | "pick_plan_legacy" // แผนหยิบของยุคเดิมใน install_jobs.pick_plan
  | "sku_catalog" // ร่างที่หน้าจอปั้นจาก product_skus ตอนยังไม่มีอะไรเลย ไม่ได้เก็บในฐานข้อมูล
  | "manual"; // บรรทัดที่ผู้ใช้เพิ่งกดเพิ่มเองบนหน้าจอ ยังไม่ได้บันทึก

export const JOB_PREP_SOURCE_LABELS: Record<JobPrepSource, string> = {
  work_order_item: "บันทึกไว้ในใบสั่งงาน",
  pick_plan_legacy: "แผนหยิบของยุคเดิม (ยังไม่ได้ยืนยันเป็นใบสั่งงาน)",
  sku_catalog: "ร่างจาก SKU ต้นทาง",
  manual: "เพิ่มใหม่บนหน้าจอ",
};

/** แถวดิบที่ RPC `get_job_prep_list` คืนมา ตัวเลขอาจมาเป็น string ได้ตามการ serialize ของ PostgREST */
export interface JobPrepListRow {
  source: string | null;
  item_id: string | null;
  work_order_id: string | null;
  category: string | null;
  item_name: string | null;
  sku: string | null;
  specification: string | null;
  planned_qty: number | string | null;
  actual_qty: number | string | null;
  unit: string | null;
  source_type: string | null;
  note: string | null;
  sort_order: number | string | null;
  material_id: string | null;
  item_kind: string | null;
  template_item_id: string | null;
  is_manual_override: boolean | null;
  picked_qty: number | string | null;
  returned_qty: number | string | null;
  used_qty: number | string | null;
}

/** รูปแบบที่ฟอร์มบนหน้าจอใช้ — ตัวเลขเป็น string เพราะผูกกับ <input> โดยตรง */
export interface JobPrepDraftItem {
  id?: string;
  source: JobPrepSource;
  category: WorkItemCategory;
  itemName: string;
  sku: string;
  specification: string;
  plannedQty: string;
  actualQty: string;
  unit: string;
  sourceType: string;
  note: string;
  materialId: string | null;
  itemKind: string | null;
  templateItemId: string | null;
  isManualOverride: boolean;
  pickedQty: string;
  returnedQty: string;
  usedQty: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * ช่องกรอกจำนวนบนหน้าจอเป็น string ค่าที่ยังไม่มีต้องเป็น "" ไม่ใช่ "null"
 * และตัวเลขที่มาเป็น string อยู่แล้ว (numeric ของ PostgREST) ต้องผ่านไปตามเดิม
 */
function qtyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return "";
}

function category(value: unknown): WorkItemCategory {
  return WORK_ITEM_CATEGORIES.includes(value as WorkItemCategory) ? (value as WorkItemCategory) : "floor_material";
}

function source(value: unknown): JobPrepSource {
  return value === "work_order_item" || value === "pick_plan_legacy" ? value : "pick_plan_legacy";
}

export function toJobPrepDraftItem(row: JobPrepListRow): JobPrepDraftItem {
  return {
    ...(row.item_id ? { id: row.item_id } : {}),
    source: source(row.source),
    category: category(row.category),
    itemName: text(row.item_name),
    sku: text(row.sku),
    specification: text(row.specification),
    plannedQty: qtyText(row.planned_qty),
    actualQty: qtyText(row.actual_qty),
    unit: text(row.unit),
    sourceType: text(row.source_type) || "new",
    note: text(row.note),
    materialId: row.material_id ?? null,
    itemKind: row.item_kind ?? null,
    templateItemId: row.template_item_id ?? null,
    isManualOverride: row.is_manual_override === true,
    pickedQty: qtyText(row.picked_qty),
    returnedQty: qtyText(row.returned_qty),
    usedQty: qtyText(row.used_qty),
  };
}

export function toJobPrepDraftItems(data: unknown): JobPrepDraftItem[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is JobPrepListRow => Boolean(row) && typeof row === "object")
    .map(toJobPrepDraftItem);
}

type RpcResult = { data: unknown; error: unknown };
type JobPrepListClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export const JOB_PREP_LIST_RPC = "get_job_prep_list";

/**
 * อ่านรายการของที่ต้องเตรียมของงานหนึ่งใบ ผ่านทางเดียวเท่านั้น
 * ผู้เรียกไม่ต้องรู้ว่าข้อมูลมาจาก floor_work_order_items หรือ install_jobs.pick_plan
 * แต่ยังบอกได้ผ่าน `source` ของแต่ละบรรทัดว่ามาจากไหน
 */
export async function fetchJobPrepList(
  client: JobPrepListClient,
  jobNo: string,
): Promise<{ items: JobPrepDraftItem[]; error: unknown }> {
  const { data, error } = await client.rpc(JOB_PREP_LIST_RPC, { p_job_no: jobNo });
  if (error) return { items: [], error };
  return { items: toJobPrepDraftItems(data), error: null };
}

/** true เมื่อรายการทั้งหมดมาจากแผนยุคเดิม — หน้าจอควรบอกผู้ใช้ว่ายังไม่ได้ยืนยันเป็นใบสั่งงาน */
export function isLegacyPrepList(items: JobPrepDraftItem[]): boolean {
  return items.length > 0 && items.every((item) => item.source === "pick_plan_legacy");
}

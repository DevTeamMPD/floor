/**
 * ส่วนต่างระหว่าง "รายการที่แม่แบบคำนวณ" กับ "รายการที่คนทำจริง" — P3-3 ฝั่งแอป
 *
 * ทั้งฝั่งอ่านและฝั่งเขียนเดินผ่าน RPC ทั้งหมด หน้าจอไม่แตะตาราง
 * job_prep_item_overrides หรือ floor_work_order_items ตรง ๆ เลย
 * (supabase/migrations/20260902110020_job_prep_item_override_rpcs.sql)
 */

export type PrepChangeKind = "qty_changed" | "added" | "removed";

export const PREP_CHANGE_LABELS: Record<PrepChangeKind, string> = {
  qty_changed: "แก้จากแม่แบบ",
  added: "เพิ่มนอกแม่แบบ",
  removed: "ลบออกจากแม่แบบ",
};

/** แถวดิบจาก RPC get_job_prep_overrides — numeric อาจมาเป็น string ตาม PostgREST */
export interface JobPrepOverrideRow {
  id: string;
  work_order_id: string | null;
  item_id: string | null;
  template_item_id: string | null;
  change_kind: string | null;
  template_item_name: string | null;
  template_unit: string | null;
  template_qty: number | string | null;
  human_item_name: string | null;
  human_unit: string | null;
  human_qty: number | string | null;
  calc_basis: unknown;
  reason: string | null;
  changed_by_name: string | null;
  changed_at: string | null;
}

export interface JobPrepOverride {
  id: string;
  itemId: string | null;
  templateItemId: string | null;
  changeKind: PrepChangeKind;
  templateItemName: string;
  templateUnit: string;
  templateQty: number | null;
  humanItemName: string;
  humanUnit: string;
  humanQty: number | null;
  reason: string;
  changedByName: string;
  changedAt: string;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function kind(value: unknown): PrepChangeKind {
  return value === "added" || value === "removed" ? value : "qty_changed";
}

export function toJobPrepOverride(row: JobPrepOverrideRow): JobPrepOverride {
  return {
    id: row.id,
    itemId: row.item_id ?? null,
    templateItemId: row.template_item_id ?? null,
    changeKind: kind(row.change_kind),
    templateItemName: str(row.template_item_name),
    templateUnit: str(row.template_unit),
    templateQty: num(row.template_qty),
    humanItemName: str(row.human_item_name),
    humanUnit: str(row.human_unit),
    humanQty: num(row.human_qty),
    reason: str(row.reason),
    changedByName: str(row.changed_by_name),
    changedAt: str(row.changed_at),
  };
}

export function toJobPrepOverrides(data: unknown): JobPrepOverride[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is JobPrepOverrideRow => Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string")
    .map(toJobPrepOverride);
}

/**
 * ส่วนต่างล่าสุดต่อหนึ่งบรรทัด — บรรทัดเดียวถูกแก้ได้หลายครั้ง
 * ป้ายบนหน้าจอต้องบอก "แม่แบบว่าเท่าไร" จากครั้ง**แรก**ที่แก้ (ตัวเลขของแม่แบบจริง)
 * และ "คนทำให้เป็นเท่าไร" จากครั้ง**ล่าสุด** ไม่อย่างนั้นจะกลายเป็นเทียบกับค่าที่คนแก้ไว้เอง
 */
export function latestOverrideByItem(overrides: JobPrepOverride[]): Map<string, JobPrepOverride> {
  const byItem = new Map<string, JobPrepOverride>();
  // RPC เรียงใหม่→เก่า จึงไล่จากท้ายมาหน้าเพื่อให้ได้ "ครั้งแรก" เป็นฐาน แล้วทับด้วยตัวเลขล่าสุด
  for (let index = overrides.length - 1; index >= 0; index--) {
    const row = overrides[index];
    if (!row.itemId || row.changeKind === "removed") continue;
    const existing = byItem.get(row.itemId);
    byItem.set(row.itemId, existing ? { ...row, templateQty: existing.templateQty, templateItemName: existing.templateItemName, templateUnit: existing.templateUnit } : row);
  }
  return byItem;
}

/** รายการที่คนลบทิ้ง — ต้องยังเห็นบนหน้าจอ ไม่อย่างนั้นจะไม่มีใครรู้ว่าแม่แบบเคยสั่งอะไรไว้ */
export function removedOverrides(overrides: JobPrepOverride[]): JobPrepOverride[] {
  return overrides.filter((row) => row.changeKind === "removed");
}

type RpcResult = { data: unknown; error: unknown };
type JobPrepClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export const JOB_PREP_OVERRIDES_RPC = "get_job_prep_overrides";
export const JOB_PREP_GENERATE_RPC = "generate_job_prep_items";
export const JOB_PREP_SAVE_OVERRIDE_RPC = "save_job_prep_item_override";
export const JOB_PREP_ADD_ITEM_RPC = "add_job_prep_item";
export const JOB_PREP_REMOVE_ITEM_RPC = "remove_job_prep_item";

export async function fetchJobPrepOverrides(
  client: JobPrepClient,
  jobNo: string,
): Promise<{ overrides: JobPrepOverride[]; error: unknown }> {
  const { data, error } = await client.rpc(JOB_PREP_OVERRIDES_RPC, { p_job_no: jobNo });
  if (error) return { overrides: [], error };
  return { overrides: toJobPrepOverrides(data), error: null };
}

/** ผลสรุปที่ RPC สร้างรายการคืนกลับมา ใช้บอกผู้ใช้เป็นภาษาไทยว่าเกิดอะไรขึ้น */
export interface PrepGenerateResult {
  areaSqm: number | null;
  unitCount: number | null;
  inserted: number;
  updated: number;
  keptManual: number;
  keptPicked: number;
  keptRemoved: number;
  keptUntracked: number;
}

export function toPrepGenerateResult(data: unknown): PrepGenerateResult {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const count = (value: unknown) => num(value) ?? 0;
  return {
    areaSqm: num(row.area_sqm),
    unitCount: num(row.unit_count),
    inserted: count(row.inserted),
    updated: count(row.updated),
    keptManual: count(row.kept_manual),
    keptPicked: count(row.kept_picked),
    keptRemoved: count(row.kept_removed),
    keptUntracked: count(row.kept_untracked),
  };
}

/** ข้อความไทยสรุปผลการสร้างรายการ — บอกทั้งที่ทำและที่จงใจไม่ทำ */
export function prepGenerateMessage(result: PrepGenerateResult): string {
  const parts: string[] = [];
  if (result.inserted) parts.push(`เพิ่ม ${result.inserted} รายการ`);
  if (result.updated) parts.push(`ปรับจำนวนตามแม่แบบ ${result.updated} รายการ`);
  if (!result.inserted && !result.updated) parts.push("ไม่มีอะไรต้องเปลี่ยน");
  const kept: string[] = [];
  if (result.keptManual) kept.push(`คนแก้ไว้ ${result.keptManual}`);
  if (result.keptPicked) kept.push(`คลังหยิบแล้ว ${result.keptPicked}`);
  if (result.keptRemoved) kept.push(`คนลบทิ้งแล้ว ${result.keptRemoved}`);
  if (result.keptUntracked) kept.push(`มีบรรทัดชื่อเดียวกันอยู่แล้ว ${result.keptUntracked}`);
  const basis = `พื้นที่ ${result.areaSqm ?? "—"} ตร.ม. · ${result.unitCount ?? "—"} แผ่น`;
  return `${parts.join(" · ")}${kept.length ? ` · คงไว้ไม่แตะ: ${kept.join(", ")}` : ""} (${basis})`;
}

export async function generateJobPrepItems(
  client: JobPrepClient,
  workOrderId: string,
): Promise<{ result: PrepGenerateResult | null; error: unknown }> {
  const { data, error } = await client.rpc(JOB_PREP_GENERATE_RPC, { p_work_order_id: workOrderId });
  if (error) return { result: null, error };
  return { result: toPrepGenerateResult(data), error: null };
}

export async function saveJobPrepItemOverride(
  client: JobPrepClient,
  args: { itemId: string; plannedQty: number; itemName?: string | null; unit?: string | null; reason: string },
): Promise<{ error: unknown }> {
  const { error } = await client.rpc(JOB_PREP_SAVE_OVERRIDE_RPC, {
    p_item_id: args.itemId,
    p_planned_qty: args.plannedQty,
    p_item_name: args.itemName ?? null,
    p_unit: args.unit ?? null,
    p_reason: args.reason,
  });
  return { error: error ?? null };
}

export async function addJobPrepItem(
  client: JobPrepClient,
  args: { workOrderId: string; itemName: string; unit: string; plannedQty: number; itemKind: string; reason: string },
): Promise<{ error: unknown }> {
  const { error } = await client.rpc(JOB_PREP_ADD_ITEM_RPC, {
    p_work_order_id: args.workOrderId,
    p_item_name: args.itemName,
    p_unit: args.unit,
    p_planned_qty: args.plannedQty,
    p_item_kind: args.itemKind,
    p_reason: args.reason,
  });
  return { error: error ?? null };
}

export async function removeJobPrepItem(
  client: JobPrepClient,
  args: { itemId: string; reason: string },
): Promise<{ error: unknown }> {
  const { error } = await client.rpc(JOB_PREP_REMOVE_ITEM_RPC, { p_item_id: args.itemId, p_reason: args.reason });
  return { error: error ?? null };
}

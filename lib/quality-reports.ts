/**
 * P4-6 — รายงานคุณภาพตาม ISO 9001 ข้อ 9.1.3 (การวิเคราะห์และประเมินผล)
 *
 * ทำไมการ "รวมข้อมูล" อยู่ที่ไฟล์นี้ ไม่ได้อยู่ใน SQL
 *   ฐานข้อมูล (supabase/migrations/20260902210000_quality_reports_9_1_3.sql) ทำแค่สามอย่าง:
 *   ด่านสิทธิ์ / กรองช่วงวันที่ / แนบป้ายชื่อปัจจุบันของเกณฑ์แต่ละข้อ แล้วส่ง "แถวดิบ" มา
 *   การจัดกลุ่มทั้งหมดอยู่ที่นี่ เพราะ group by คือจุดที่รายงานพังได้เงียบที่สุด
 *   และชุดเทสของโปรเจกต์นี้ (vitest, environment: node) ไม่ต่อฐานข้อมูลเลย
 *   ตรรกะที่ฝังใน SQL จึงไม่มีทางถูกทดสอบอัตโนมัติ ส่วนตรรกะที่อยู่ในไฟล์นี้ถูกทดสอบครบ
 *   ทุกขอบเขตใน lib/quality-reports.test.ts (ไม่มีข้อมูล / งานเดียว /
 *   เกณฑ์ที่เปลี่ยนชื่อข้ามเวอร์ชันแม่แบบ / วัสดุตัวเดียวที่โผล่สองงาน)
 *
 * กติกาเดียวที่ทั้งไฟล์ยึด: ไม่รู้ ≠ ศูนย์
 *   picked_qty/used_qty/returned_qty เป็น null ได้ และ null แปลว่า "ยังไม่มีใครบันทึก"
 *   ไม่ใช่ "บันทึกแล้วว่าเป็นศูนย์" การเผลอ coalesce เป็น 0 จะทำให้หน้าจอรายงานว่า
 *   "เบิกไป 0 ใช้จริง 0 ตรงเป๊ะ" ทั้งที่ยังไม่มีใครแตะบรรทัดนั้นเลย ซึ่งเป็นการโกหก
 *   ไฟล์นี้จึงนับ "จำนวนบรรทัดที่มีข้อมูลจริง" แยกจากผลรวมเสมอ
 */

import { FALLBACK_RECEIPT_REASONS, reasonLabel } from "./technician-receipt";

export const ACCEPTANCE_FAILURES_RPC = "report_acceptance_failures";
export const MATERIAL_SHORTAGES_RPC = "report_material_shortages";
export const PICK_VS_USE_RPC = "report_pick_vs_use";

/* ------------------------------------------------------------------ ชนิดข้อมูล */

export type AcceptanceResult = "pass" | "fail" | "na";

export interface AcceptanceRow {
  jobNo: string;
  templateId: string | null;
  templateVersion: number | null;
  itemCode: string;
  labelSnapshot: string;
  /** ป้ายชื่อในแม่แบบรุ่นที่เปิดใช้งานอยู่ตอนนี้ — null = ข้อนี้ถูกถอดออกจากแม่แบบแล้ว */
  currentLabel: string | null;
  isCritical: boolean;
  currentIsCritical: boolean | null;
  result: AcceptanceResult;
  recordedAt: string | null;
}

export interface ShortageRow {
  jobNo: string;
  workOrderId: string | null;
  materialKey: string;
  materialId: string | null;
  sku: string | null;
  itemName: string | null;
  unit: string | null;
  receiptStatus: string | null;
  expectedQty: number | null;
  receivedQty: number | null;
  shortageQty: number | null;
  reasonCode: string | null;
  hasNcr: boolean;
  confirmedAt: string | null;
}

export interface PickVsUseRow {
  itemId: string;
  jobNo: string;
  workOrderId: string | null;
  materialKey: string;
  materialId: string | null;
  sku: string | null;
  itemName: string | null;
  unit: string | null;
  plannedQty: number | null;
  actualQty: number | null;
  pickedQty: number | null;
  usedQty: number | null;
  returnedQty: number | null;
  fromTemplate: boolean;
  manualOverride: boolean;
  activityAt: string | null;
}

export interface ReportEnvelope<TRow> {
  report: string;
  from: string | null;
  to: string | null;
  generatedAt: string | null;
  rows: TRow[];
  rowCount: number;
  truncated: boolean;
  rowCap: number;
  /** จำนวนแถวทั้งหมดที่มีในระบบ โดยไม่สนช่วงวันที่ — ใช้แยก "ไม่มีเลย" ออกจาก "ไม่มีในช่วงนี้" */
  totalAllTime: number;
  context: Record<string, number | string | null>;
}

/* ------------------------------------------------------------------ ตัวช่วยแปลงค่า */

/** numeric ของ Postgres เดินทางมาเป็น string ผ่าน PostgREST — และ null ต้องอยู่เป็น null */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toBool(value: unknown): boolean {
  return value === true;
}

function toInt(value: unknown): number {
  const parsed = toNumber(value);
  return parsed === null ? 0 : Math.trunc(parsed);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseContext(value: unknown): Record<string, number | string | null> {
  const source = record(value);
  if (!source) return {};
  const out: Record<string, number | string | null> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined) out[key] = null;
    else if (typeof raw === "number" || typeof raw === "string") out[key] = raw;
  }
  return out;
}

function parseEnvelope<TRow>(raw: unknown, pickRow: (row: Record<string, unknown>) => TRow | null): ReportEnvelope<TRow> {
  const source = record(raw) ?? {};
  const rawRows = Array.isArray(source.rows) ? source.rows : [];
  const rows: TRow[] = [];
  for (const entry of rawRows) {
    const asRecord = record(entry);
    if (!asRecord) continue;
    const parsed = pickRow(asRecord);
    if (parsed) rows.push(parsed);
  }
  return {
    report: toText(source.report) ?? "",
    from: toText(source.from),
    to: toText(source.to),
    generatedAt: toText(source.generatedAt),
    rows,
    rowCount: toInt(source.rowCount),
    truncated: toBool(source.truncated),
    rowCap: toInt(source.rowCap),
    totalAllTime: toInt(source.totalAllTime),
    context: parseContext(source.context),
  };
}

export function parseAcceptanceEnvelope(raw: unknown): ReportEnvelope<AcceptanceRow> {
  return parseEnvelope(raw, (row) => {
    const itemCode = toText(row.itemCode);
    const jobNo = toText(row.jobNo);
    const result = toText(row.result);
    if (!itemCode || !jobNo) return null;
    if (result !== "pass" && result !== "fail" && result !== "na") return null;
    return {
      jobNo,
      templateId: toText(row.templateId),
      templateVersion: toNumber(row.templateVersion),
      itemCode,
      labelSnapshot: toText(row.labelSnapshot) ?? itemCode,
      currentLabel: toText(row.currentLabel),
      isCritical: toBool(row.isCritical),
      currentIsCritical: typeof row.currentIsCritical === "boolean" ? row.currentIsCritical : null,
      result,
      recordedAt: toText(row.recordedAt),
    };
  });
}

export function parseShortageEnvelope(raw: unknown): ReportEnvelope<ShortageRow> {
  return parseEnvelope(raw, (row) => {
    const jobNo = toText(row.jobNo);
    const materialKey = toText(row.materialKey);
    if (!jobNo || !materialKey) return null;
    return {
      jobNo,
      workOrderId: toText(row.workOrderId),
      materialKey,
      materialId: toText(row.materialId),
      sku: toText(row.sku),
      itemName: toText(row.itemName),
      unit: toText(row.unit),
      receiptStatus: toText(row.receiptStatus),
      expectedQty: toNumber(row.expectedQty),
      receivedQty: toNumber(row.receivedQty),
      shortageQty: toNumber(row.shortageQty),
      reasonCode: toText(row.reasonCode),
      hasNcr: toBool(row.hasNcr),
      confirmedAt: toText(row.confirmedAt),
    };
  });
}

export function parsePickVsUseEnvelope(raw: unknown): ReportEnvelope<PickVsUseRow> {
  return parseEnvelope(raw, (row) => {
    const itemId = toText(row.itemId);
    const jobNo = toText(row.jobNo);
    const materialKey = toText(row.materialKey);
    if (!itemId || !jobNo || !materialKey) return null;
    return {
      itemId,
      jobNo,
      workOrderId: toText(row.workOrderId),
      materialKey,
      materialId: toText(row.materialId),
      sku: toText(row.sku),
      itemName: toText(row.itemName),
      unit: toText(row.unit),
      plannedQty: toNumber(row.plannedQty),
      actualQty: toNumber(row.actualQty),
      pickedQty: toNumber(row.pickedQty),
      usedQty: toNumber(row.usedQty),
      returnedQty: toNumber(row.returnedQty),
      fromTemplate: toBool(row.fromTemplate),
      manualOverride: toBool(row.manualOverride),
      activityAt: toText(row.activityAt),
    };
  });
}

/* ------------------------------------------------- รายงานที่ 1: เกณฑ์ตรวจรับที่ตกบ่อย */

export interface AcceptanceCriterionStat {
  /** รหัสถาวร — กุญแจการรวม ไม่ใช่ template_id */
  itemCode: string;
  /** ป้ายชื่อในแม่แบบรุ่นปัจจุบัน — null = ข้อนี้ถูกถอดออกจากแม่แบบไปแล้ว */
  currentLabel: string | null;
  /** ป้ายชื่อที่บันทึกไว้ตอนตรวจครั้งล่าสุด */
  latestLabel: string;
  /** ป้ายที่หน้าจอควรแสดง: ของแม่แบบปัจจุบันก่อน ถ้าไม่มีแล้วจึงใช้ป้ายล่าสุดที่เคยใช้ */
  displayLabel: string;
  removedFromActiveTemplate: boolean;
  /** ป้ายทุกแบบที่ข้อนี้เคยใช้ เรียงจากใหม่ไปเก่า — มากกว่า 1 คือเคยเปลี่ยนชื่อ */
  labelHistory: string[];
  labelChanged: boolean;
  isCritical: boolean;
  templateIds: string[];
  templateVersions: number[];
  /** true เมื่อสถิติก้อนนี้รวมข้อมูลจากแม่แบบมากกว่าหนึ่งรุ่นเข้าด้วยกันจริง */
  spansTemplateVersions: boolean;
  recorded: number;
  pass: number;
  fail: number;
  na: number;
  /** ผ่าน + ไม่ผ่าน — ตัวหารของอัตราตก ไม่นับ "ไม่เกี่ยวข้อง" */
  judged: number;
  /** เปอร์เซ็นต์ ปัดทศนิยม 1 ตำแหน่ง — null เมื่อยังไม่มีการตัดสินสักครั้ง */
  failRate: number | null;
  jobs: number;
  jobsWithFail: number;
  lastFailAt: string | null;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function groupAcceptanceFailures(rows: readonly AcceptanceRow[]): AcceptanceCriterionStat[] {
  interface Bucket {
    itemCode: string;
    currentLabel: string | null;
    labelSeen: { label: string; at: string | null }[];
    isCritical: boolean;
    templateIds: Set<string>;
    templateVersions: Set<number>;
    jobs: Set<string>;
    jobsWithFail: Set<string>;
    pass: number;
    fail: number;
    na: number;
    lastFailAt: string | null;
  }
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    let bucket = buckets.get(row.itemCode);
    if (!bucket) {
      bucket = {
        itemCode: row.itemCode,
        currentLabel: null,
        labelSeen: [],
        isCritical: false,
        templateIds: new Set(),
        templateVersions: new Set(),
        jobs: new Set(),
        jobsWithFail: new Set(),
        pass: 0,
        fail: 0,
        na: 0,
        lastFailAt: null,
      };
      buckets.set(row.itemCode, bucket);
    }
    // ป้ายชื่อปัจจุบันมาจากแม่แบบ จึงเหมือนกันทุกแถวของรหัสเดียวกัน — แถวไหนมีก็ใช้แถวนั้น
    if (bucket.currentLabel === null && row.currentLabel !== null) bucket.currentLabel = row.currentLabel;
    bucket.labelSeen.push({ label: row.labelSnapshot, at: row.recordedAt });
    // "สำคัญ" แม้ข้อเดียวก็พอ — ถ้าเคยถูกประกาศว่าวิกฤตในรุ่นใดรุ่นหนึ่ง ต้องเห็นว่าวิกฤต
    if (row.isCritical || row.currentIsCritical === true) bucket.isCritical = true;
    if (row.templateId) bucket.templateIds.add(row.templateId);
    if (row.templateVersion !== null) bucket.templateVersions.add(row.templateVersion);
    bucket.jobs.add(row.jobNo);
    if (row.result === "pass") bucket.pass += 1;
    else if (row.result === "na") bucket.na += 1;
    else {
      bucket.fail += 1;
      bucket.jobsWithFail.add(row.jobNo);
      bucket.lastFailAt = laterOf(bucket.lastFailAt, row.recordedAt);
    }
  }

  const stats: AcceptanceCriterionStat[] = [];
  for (const bucket of buckets.values()) {
    // ป้ายเรียงจากใหม่ไปเก่า แถวที่ไม่มีเวลาถือว่าเก่าสุด
    const ordered = [...bucket.labelSeen].sort((a, b) => {
      if (a.at === b.at) return 0;
      if (!a.at) return 1;
      if (!b.at) return -1;
      return a.at > b.at ? -1 : 1;
    });
    const labelHistory: string[] = [];
    for (const entry of ordered) if (!labelHistory.includes(entry.label)) labelHistory.push(entry.label);
    const latestLabel = labelHistory[0] ?? bucket.itemCode;
    const judged = bucket.pass + bucket.fail;
    const currentLabel = bucket.currentLabel;
    stats.push({
      itemCode: bucket.itemCode,
      currentLabel,
      latestLabel,
      displayLabel: currentLabel ?? latestLabel,
      removedFromActiveTemplate: currentLabel === null,
      labelHistory,
      labelChanged: labelHistory.length > 1 || (currentLabel !== null && currentLabel !== latestLabel),
      isCritical: bucket.isCritical,
      templateIds: [...bucket.templateIds],
      templateVersions: [...bucket.templateVersions].sort((a, b) => a - b),
      spansTemplateVersions: bucket.templateIds.size > 1 || bucket.templateVersions.size > 1,
      recorded: bucket.pass + bucket.fail + bucket.na,
      pass: bucket.pass,
      fail: bucket.fail,
      na: bucket.na,
      judged,
      failRate: judged === 0 ? null : Math.round((bucket.fail / judged) * 1000) / 10,
      jobs: bucket.jobs.size,
      jobsWithFail: bucket.jobsWithFail.size,
      lastFailAt: bucket.lastFailAt,
    });
  }

  stats.sort((a, b) => {
    if (b.fail !== a.fail) return b.fail - a.fail;
    if ((b.failRate ?? -1) !== (a.failRate ?? -1)) return (b.failRate ?? -1) - (a.failRate ?? -1);
    return a.itemCode.localeCompare(b.itemCode);
  });
  return stats;
}

/* ------------------------------------------------------ รายงานที่ 2: ของขาดบ่อยที่สุด */

export interface MaterialShortageStat {
  materialKey: string;
  sku: string | null;
  itemName: string | null;
  unit: string | null;
  materialId: string | null;
  /** จำนวนครั้งที่ช่างแจ้งว่าของตัวนี้มาไม่ครบ */
  events: number;
  shortageQty: number;
  expectedQty: number;
  receivedQty: number;
  jobs: number;
  jobNos: string[];
  notReceivedEvents: number;
  partialEvents: number;
  /** จำนวนครั้งที่บานปลายจนเปิด NC — ตัวเลขประกอบ ไม่ใช่ตัวตั้งของรายงานนี้ */
  ncrOpened: number;
  reasonCounts: Record<string, number>;
  topReasonCode: string | null;
  topReasonLabel: string | null;
  lastAt: string | null;
}

export function groupMaterialShortages(rows: readonly ShortageRow[]): MaterialShortageStat[] {
  const buckets = new Map<string, MaterialShortageStat & { jobSet: Set<string> }>();
  for (const row of rows) {
    let bucket = buckets.get(row.materialKey);
    if (!bucket) {
      bucket = {
        materialKey: row.materialKey,
        sku: row.sku,
        itemName: row.itemName,
        unit: row.unit,
        materialId: row.materialId,
        events: 0,
        shortageQty: 0,
        expectedQty: 0,
        receivedQty: 0,
        jobs: 0,
        jobNos: [],
        notReceivedEvents: 0,
        partialEvents: 0,
        ncrOpened: 0,
        reasonCounts: {},
        topReasonCode: null,
        topReasonLabel: null,
        lastAt: null,
        jobSet: new Set<string>(),
      };
      buckets.set(row.materialKey, bucket);
    }
    if (bucket.sku === null && row.sku !== null) bucket.sku = row.sku;
    if (bucket.itemName === null && row.itemName !== null) bucket.itemName = row.itemName;
    if (bucket.unit === null && row.unit !== null) bucket.unit = row.unit;
    if (bucket.materialId === null && row.materialId !== null) bucket.materialId = row.materialId;
    bucket.events += 1;
    bucket.shortageQty += row.shortageQty ?? 0;
    bucket.expectedQty += row.expectedQty ?? 0;
    bucket.receivedQty += row.receivedQty ?? 0;
    bucket.jobSet.add(row.jobNo);
    if (row.receiptStatus === "not_received") bucket.notReceivedEvents += 1;
    if (row.receiptStatus === "received_partial") bucket.partialEvents += 1;
    if (row.hasNcr) bucket.ncrOpened += 1;
    const reason = row.reasonCode ?? "unspecified";
    bucket.reasonCounts[reason] = (bucket.reasonCounts[reason] ?? 0) + 1;
    bucket.lastAt = laterOf(bucket.lastAt, row.confirmedAt);
  }

  const stats: MaterialShortageStat[] = [];
  for (const bucket of buckets.values()) {
    const { jobSet, ...rest } = bucket;
    const entries = Object.entries(rest.reasonCounts).sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])));
    const topReasonCode = entries.length ? entries[0][0] : null;
    stats.push({
      ...rest,
      jobs: jobSet.size,
      jobNos: [...jobSet].sort(),
      topReasonCode,
      topReasonLabel:
        topReasonCode === null
          ? null
          : topReasonCode === "unspecified"
            ? "ไม่ได้ระบุเหตุผล"
            : reasonLabel(FALLBACK_RECEIPT_REASONS, topReasonCode),
    });
  }

  stats.sort((a, b) => {
    if (b.events !== a.events) return b.events - a.events;
    if (b.shortageQty !== a.shortageQty) return b.shortageQty - a.shortageQty;
    return a.materialKey.localeCompare(b.materialKey, "th");
  });
  return stats;
}

/* --------------------------------------------------- รายงานที่ 3: เบิกไป vs ใช้จริง */

export interface PickVsUseStat {
  /** กุญแจการรวม — SKU/ชื่อของ เมื่อรวมรายวัสดุ หรือเลขที่งาน เมื่อรวมรายงาน */
  key: string;
  label: string;
  unit: string | null;
  lines: number;
  /** จำนวนงานที่ของตัวนี้ถูกใช้ (มีความหมายเมื่อรวมรายวัสดุ) */
  jobs: number;
  jobNos: string[];
  /** ค่าประมาณจากแม่แบบ/จากมือคนกรอก — ไม่ใช่ความจริง */
  planned: number;
  picked: number;
  used: number;
  returned: number;
  /** ออกจากคลังแล้วไม่ได้กลับมา = หยิบไป - คืนกลับ */
  netOut: number;
  linesWithPick: number;
  linesWithUsage: number;
  linesWithReturn: number;
  templateLines: number;
  manualOverrideLines: number;
  /** ของจริงลบค่าประมาณ — null เมื่อยังไม่มีบรรทัดไหนถูกหยิบเลย จึงยังเทียบไม่ได้ */
  varianceVsPlan: number | null;
  variancePct: number | null;
  /** ใช้จริงลบที่หยิบไปสุทธิ — null เมื่อยังไม่มีใครปิดยอดการใช้ */
  usageVsNetOut: number | null;
  /** เทียบได้จริงไหม — ถ้า false หน้าจอต้องบอกว่า "ยังเทียบไม่ได้" ไม่ใช่แสดงเลข 0 */
  comparable: boolean;
}

interface PickBucket {
  key: string;
  label: string;
  unit: string | null;
  lines: number;
  jobSet: Set<string>;
  planned: number;
  picked: number;
  used: number;
  returned: number;
  linesWithPick: number;
  linesWithUsage: number;
  linesWithReturn: number;
  templateLines: number;
  manualOverrideLines: number;
}

function newBucket(key: string, label: string, unit: string | null): PickBucket {
  return {
    key,
    label,
    unit,
    lines: 0,
    jobSet: new Set<string>(),
    planned: 0,
    picked: 0,
    used: 0,
    returned: 0,
    linesWithPick: 0,
    linesWithUsage: 0,
    linesWithReturn: 0,
    templateLines: 0,
    manualOverrideLines: 0,
  };
}

function absorb(bucket: PickBucket, row: PickVsUseRow): void {
  bucket.lines += 1;
  bucket.jobSet.add(row.jobNo);
  bucket.planned += row.plannedQty ?? 0;
  // null คือ "ยังไม่มีใครบันทึก" ไม่ใช่ศูนย์ — จึงบวกเฉพาะที่มีค่า และนับบรรทัดแยก
  if (row.pickedQty !== null) {
    bucket.picked += row.pickedQty;
    bucket.linesWithPick += 1;
  }
  if (row.usedQty !== null) {
    bucket.used += row.usedQty;
    bucket.linesWithUsage += 1;
  }
  if (row.returnedQty !== null) {
    bucket.returned += row.returnedQty;
    bucket.linesWithReturn += 1;
  }
  if (row.fromTemplate) bucket.templateLines += 1;
  if (row.manualOverride) bucket.manualOverrideLines += 1;
  if (bucket.unit === null && row.unit !== null) bucket.unit = row.unit;
}

function finish(bucket: PickBucket): PickVsUseStat {
  const netOut = bucket.picked - bucket.returned;
  const comparable = bucket.linesWithPick > 0;
  const varianceVsPlan = comparable ? netOut - bucket.planned : null;
  return {
    key: bucket.key,
    label: bucket.label,
    unit: bucket.unit,
    lines: bucket.lines,
    jobs: bucket.jobSet.size,
    jobNos: [...bucket.jobSet].sort(),
    planned: bucket.planned,
    picked: bucket.picked,
    used: bucket.used,
    returned: bucket.returned,
    netOut,
    linesWithPick: bucket.linesWithPick,
    linesWithUsage: bucket.linesWithUsage,
    linesWithReturn: bucket.linesWithReturn,
    templateLines: bucket.templateLines,
    manualOverrideLines: bucket.manualOverrideLines,
    varianceVsPlan,
    variancePct:
      varianceVsPlan === null || bucket.planned === 0 ? null : Math.round((varianceVsPlan / bucket.planned) * 1000) / 10,
    usageVsNetOut: bucket.linesWithUsage > 0 ? bucket.used - netOut : null,
    comparable,
  };
}

function sortByGap(stats: PickVsUseStat[]): PickVsUseStat[] {
  stats.sort((a, b) => {
    const av = a.varianceVsPlan === null ? -1 : Math.abs(a.varianceVsPlan);
    const bv = b.varianceVsPlan === null ? -1 : Math.abs(b.varianceVsPlan);
    if (bv !== av) return bv - av;
    if (b.lines !== a.lines) return b.lines - a.lines;
    return a.key.localeCompare(b.key, "th");
  });
  return stats;
}

export function groupPickVsUseByMaterial(rows: readonly PickVsUseRow[]): PickVsUseStat[] {
  const buckets = new Map<string, PickBucket>();
  for (const row of rows) {
    let bucket = buckets.get(row.materialKey);
    if (!bucket) {
      bucket = newBucket(row.materialKey, row.itemName ?? row.sku ?? row.materialKey, row.unit);
      buckets.set(row.materialKey, bucket);
    }
    absorb(bucket, row);
  }
  return sortByGap([...buckets.values()].map(finish));
}

export function groupPickVsUseByJob(rows: readonly PickVsUseRow[]): PickVsUseStat[] {
  const buckets = new Map<string, PickBucket>();
  for (const row of rows) {
    let bucket = buckets.get(row.jobNo);
    if (!bucket) {
      // หน่วยของ "ทั้งงาน" ไม่มีความหมาย เพราะรวมของหลายหน่วยเข้าด้วยกัน จึงเป็น null เสมอ
      bucket = newBucket(row.jobNo, row.jobNo, null);
      buckets.set(row.jobNo, bucket);
    }
    absorb(bucket, row);
    bucket.unit = null;
  }
  return sortByGap([...buckets.values()].map(finish));
}

/* ------------------------------------------------------------ ข้อความ "ทำไมจอถึงว่าง"
 *
 * ข้อกำหนดของงานนี้ที่สำคัญกว่ากราฟ: จอว่างต้องบอกว่า "ทำไมถึงว่าง" และ "ต้องเกิดอะไรขึ้น
 * รายงานถึงจะมีข้อมูล" คำว่า "ยังไม่มีข้อมูล" เฉย ๆ ทำให้คนอ่านคิดว่าระบบพัง แล้วเลิกใช้
 * ทั้งสามฟังก์ชันนี้จึงแยกสามสถานะออกจากกันชัดเจน:
 *   empty    = ไม่มีข้อมูลเลยทั้งระบบ (ต้นทางยังไม่เดิน)
 *   filtered = มีข้อมูล แต่ไม่มีในช่วงวันที่ที่เลือก (คนใช้กรองแคบไปเอง)
 *   partial  = มีข้อมูลครึ่งเดียว จึงคำนวณตัวเลขหลักของรายงานยังไม่ได้
 * คืน null เมื่อรายงานมีข้อมูลพอจะอ่านได้จริง
 */

export type ReportNoticeTone = "empty" | "filtered" | "partial";

export interface ReportNotice {
  tone: ReportNoticeTone;
  title: string;
  why: string;
  /** สิ่งที่ต้องเกิดขึ้นก่อน รายงานถึงจะมีข้อมูล — เรียงตามลำดับที่เกิดจริง */
  steps: string[];
}

const RANGE_STEP = "ถ้าต้องการดูทั้งหมด ให้กดช่วงเวลา “ทั้งหมด” ด้านบน หรือขยายวันเริ่มต้นให้ย้อนไปไกลกว่านี้";

export function acceptanceNotice(envelope: ReportEnvelope<AcceptanceRow>): ReportNotice | null {
  const templateItems = Number(envelope.context.activeTemplateItemCount ?? 0);
  const templateVersion = envelope.context.activeTemplateVersion;
  if (envelope.totalAllTime === 0) {
    return {
      tone: "empty",
      title: "ยังไม่เคยมีการบันทึกผลตรวจรับสักข้อเดียวในระบบ",
      why:
        templateItems > 0
          ? `ตาราง job_acceptance_results ยังว่างอยู่ (0 แถว) ไม่ใช่รายงานพัง — แม่แบบเกณฑ์ตรวจรับรุ่น v${String(templateVersion ?? "?")} ที่เปิดใช้งานอยู่มี ${templateItems} ข้อ (QC01 เป็นต้นไป) รอรับผลอยู่แล้ว แต่ยังไม่มีใครกดบันทึกผลของงานไหนเลย`
          : "ตาราง job_acceptance_results ยังว่างอยู่ (0 แถว) และยังไม่มีแม่แบบเกณฑ์ตรวจรับรุ่นไหนถูกเปิดใช้งาน จึงยังบันทึกผลตรวจรับไม่ได้เลย",
      steps:
        templateItems > 0
          ? [
              "เปิดหน้าใบสั่งงานของงานที่ติดตั้งเสร็จแล้ว ไปที่แท็บ “ตรวจรับ”",
              "ผู้ดูแลระบบหรือหัวหน้าช่างติ๊ก ผ่าน / ไม่ผ่าน / ไม่เกี่ยวข้อง ทีละข้อ แล้วกดบันทึก",
              "เมื่อมีผลตรวจรับสะสมข้ามหลายงาน รายงานนี้จะเรียงให้เองว่าข้อไหนตกบ่อยที่สุด",
            ]
          : [
              "ไปที่หน้า “แม่แบบงาน” แล้วกดเปิดใช้งานแม่แบบเกณฑ์ตรวจรับหนึ่งรุ่น",
              "จากนั้นจึงบันทึกผลตรวจรับได้ที่แท็บ “ตรวจรับ” ของหน้าใบสั่งงาน",
            ],
    };
  }
  if (envelope.rowCount === 0) {
    return {
      tone: "filtered",
      title: "ไม่มีผลตรวจรับในช่วงวันที่ที่เลือก",
      why: `ระบบมีผลตรวจรับทั้งหมด ${envelope.totalAllTime} รายการ แต่ไม่มีรายการไหนถูกบันทึกในช่วงวันที่นี้`,
      steps: [RANGE_STEP],
    };
  }
  const judged = envelope.rows.filter((row) => row.result !== "na").length;
  if (judged === 0) {
    return {
      tone: "partial",
      title: "มีผลตรวจรับ แต่ทุกข้อถูกบันทึกว่า “ไม่เกี่ยวข้อง”",
      why: `ในช่วงนี้มี ${envelope.rowCount} รายการ และไม่มีข้อไหนถูกตัดสินว่าผ่านหรือไม่ผ่านเลย จึงยังคำนวณอัตราตกไม่ได้ (ตัวหารเป็นศูนย์)`,
      steps: ["ตรวจว่าเกณฑ์ในแม่แบบตรงกับงานจริงหรือไม่ — ถ้าเกณฑ์ส่วนใหญ่ “ไม่เกี่ยวข้อง” กับงานที่ทำ แปลว่าแม่แบบควรถูกแก้"],
    };
  }
  return null;
}

export function shortageNotice(envelope: ReportEnvelope<ShortageRow>): ReportNotice | null {
  const receipts = Number(envelope.context.receiptRowsAllTime ?? 0);
  if (receipts === 0) {
    return {
      tone: "empty",
      title: "ยังไม่มีช่างคนไหนกดยืนยันรับของหน้างานเลย",
      why: "รายงานนี้นับจากสิ่งที่ช่างยืนยันตอนรับของหน้างาน (floor_work_order_item_receipts) ซึ่งยังว่างอยู่ 0 แถว ไม่ใช่รายงานพัง แต่ต้นทางยังไม่เคยเดิน",
      steps: [
        "คลังจัดของแบบรายบรรทัดในหน้า “เตรียมสินค้า” ให้ครบก่อน บรรทัดที่ยังไม่ถูกหยิบจะไม่มีของให้รับ",
        "ช่างเปิดลิงก์งานส่วนตัวของตัวเอง แล้วกดรับของทีละบรรทัด",
        "บรรทัดไหนของมาไม่ครบ ให้เลือก “ได้ไม่ครบ” หรือ “ไม่ได้รับ” พร้อมเหตุผล — แถวนั้นคือข้อมูลของรายงานนี้",
      ],
    };
  }
  if (envelope.totalAllTime === 0) {
    return {
      tone: "empty",
      title: "มีการรับของหน้างานแล้ว แต่ยังไม่เคยมีของขาดเลย",
      why: `ช่างยืนยันรับของไปแล้ว ${receipts} บรรทัด และทุกบรรทัดได้ของครบตามที่ควรได้ — จอว่างนี้คือข่าวดี ไม่ใช่ข้อมูลหาย`,
      steps: ["ถ้าเชื่อว่าเคยมีของขาดจริงแต่ไม่ปรากฏที่นี่ แปลว่าช่างกด “ได้ครบ” ทั้งที่ของไม่ครบ ให้ย้อนดูที่หน้าใบสั่งงานของงานนั้น"],
    };
  }
  if (envelope.rowCount === 0) {
    return {
      tone: "filtered",
      title: "ไม่มีรายการของขาดในช่วงวันที่ที่เลือก",
      why: `ระบบมีรายการของขาดทั้งหมด ${envelope.totalAllTime} รายการ แต่ไม่มีรายการไหนเกิดขึ้นในช่วงวันที่นี้`,
      steps: [RANGE_STEP],
    };
  }
  return null;
}

export function pickVsUseNotice(envelope: ReportEnvelope<PickVsUseRow>): ReportNotice | null {
  const pickedLines = Number(envelope.context.pickedLinesAllTime ?? 0);
  const usageLines = Number(envelope.context.usageLinesAllTime ?? 0);
  if (envelope.totalAllTime === 0) {
    return {
      tone: "empty",
      title: "ยังไม่มีบรรทัดของสิ้นเปลืองในใบสั่งงานเลย",
      why: "รายงานนี้อ่านจากบรรทัดของในใบสั่งงาน (เฉพาะของสิ้นเปลือง ไม่รวมเครื่องมือที่ต้องคืน) ซึ่งยังไม่มีสักบรรทัด",
      steps: ["สร้างรายการของในใบสั่งงาน — จากแม่แบบงาน หรือกรอกเองที่หน้าใบสั่งงาน"],
    };
  }
  if (pickedLines === 0) {
    return {
      tone: "partial",
      title: "มีแต่ตัวเลขที่ประมาณไว้ ยังไม่มีตัวเลขของจริงให้เทียบ",
      why: `ระบบมีบรรทัดของสิ้นเปลือง ${envelope.totalAllTime} บรรทัด แต่ยังไม่มีบรรทัดไหนถูกบันทึกว่าหยิบไปเท่าไหร่ (picked_qty ว่างทั้งหมด) รายงานนี้จึงมีแต่ค่าประมาณจากแม่แบบ และยังเทียบกับความจริงไม่ได้`,
      steps: [
        "คลังกดหยิบของแบบรายบรรทัดในหน้า “เตรียมสินค้า” แทนการกดปิดทั้งใบรวดเดียว — ตรงนี้คือที่มาของคอลัมน์ “เบิกไป”",
        "ช่างกดปิดยอดหน้างานว่าใช้จริงเท่าไหร่ คืนคลังเท่าไหร่ — ตรงนี้คือที่มาของคอลัมน์ “ใช้จริง” และ “คืนคลัง”",
        "เมื่อมีทั้งสองฝั่ง ส่วนต่างที่เห็นคือสิ่งที่ใช้ปรับสูตรคำนวณของแม่แบบให้แม่นขึ้นในรอบถัดไป",
      ],
    };
  }
  if (envelope.rowCount === 0) {
    return {
      tone: "filtered",
      title: "ไม่มีบรรทัดของที่ขยับในช่วงวันที่ที่เลือก",
      why: `ระบบมีบรรทัดของสิ้นเปลืองทั้งหมด ${envelope.totalAllTime} บรรทัด แต่ไม่มีบรรทัดไหนถูกหยิบ ปิดยอด หรือสร้างขึ้นในช่วงวันที่นี้`,
      steps: [RANGE_STEP],
    };
  }
  if (usageLines === 0) {
    return {
      tone: "partial",
      title: "รู้ว่าเบิกไปเท่าไหร่ แต่ยังไม่รู้ว่าใช้จริงเท่าไหร่",
      why: `มีบรรทัดที่ถูกหยิบแล้ว ${pickedLines} บรรทัด แต่ยังไม่มีบรรทัดไหนถูกปิดยอดว่าใช้จริงเท่าไหร่ ส่วนต่าง “เบิกไป vs ใช้จริง” จึงยังคำนวณไม่ได้ ตัวเลขที่เห็นตอนนี้เทียบได้แค่ “ประมาณไว้ vs เบิกจริง”`,
      steps: ["ช่างกดปิดยอดหน้างานหลังติดตั้งเสร็จ ระบุว่าใช้จริงเท่าไหร่และคืนคลังเท่าไหร่"],
    };
  }
  return null;
}

// เกณฑ์ตรวจรับงาน (QC) — แหล่งข้อมูลเดียวของทั้งหน้า pipeline (แอดมิน/หัวหน้าช่าง) และหน้าช่างหน้างาน
//
// ทำไมต้องมีไฟล์นี้: ก่อนหน้านี้เกณฑ์ตรวจรับถูก hardcode ไว้ในไฟล์หน้าจอ (QC_ITEMS ใน
// components/pipeline/job-drawer.tsx) ทำให้หน้าจอ "แม่แบบประเภทงาน" ที่หัวหน้าช่างแก้ได้
// ไม่มีผลกับสิ่งที่คนใช้งานเห็นจริงเลย งานนี้ย้ายให้หน้าจออ่านเกณฑ์จากแม่แบบที่ active ในฐานข้อมูล
// โดยยังเก็บชุด hardcode เดิมไว้เป็น "ชุดสำรอง" เพื่อไม่ให้จอว่างเปล่าเมื่อโหลดแม่แบบไม่สำเร็จ

/** รหัสประเภทงานที่ระบบใช้กับงานปูพื้น (ตรงกับ job_types.code ที่ seed ไว้) */
export const FLOOR_JOB_TYPE_CODE = "FLOOR_INSTALL";

export type QCResult = "pass" | "fail" | "na" | null;

export interface JobChecklistItem {
  /** รหัสถาวรของเกณฑ์ข้อนี้ (QC01, QC02, …) — ใช้เป็นคีย์ของผลตรวจรับที่บันทึกไว้ */
  code: string;
  label: string;
  spec: string | null;
  requiresPhoto: boolean;
  isCritical: boolean;
  measuringDeviceKind: string | null;
}

export type ChecklistOrigin = "template" | "fallback";

export interface JobChecklistSource {
  items: JobChecklistItem[];
  origin: ChecklistOrigin;
  /** เวอร์ชันของแม่แบบที่กำลังแสดง (null เมื่อใช้ชุดสำรองในโค้ด) */
  version: number | null;
  templateId: string | null;
  jobTypeName: string | null;
  /** เหตุผลภาษาไทยว่าทำไมถึงตกมาใช้ชุดสำรอง (null เมื่ออ่านแม่แบบได้จริง) */
  fallbackReason: string | null;
}

/**
 * ชุดสำรอง: เกณฑ์ตรวจรับ 15 ข้อชุดเดิมที่เคย hardcode ไว้ในหน้า pipeline
 * รหัส QC01–QC15 ตรงกับที่ migration 20260901130000_seed_floor_qc_template.sql seed เข้าฐานข้อมูล
 * แบบข้อต่อข้อ และตรงกับเลขข้อเดิม (id 1–15) ที่ผลตรวจรับเก่าใน install_jobs.qc_data ใช้เป็นคีย์
 * ห้ามลบทิ้ง — เป็นตาข่ายกันจอว่างเมื่ออ่านแม่แบบจากฐานข้อมูลไม่สำเร็จ
 */
export const FALLBACK_QC_ITEMS: JobChecklistItem[] = [
  { code: "QC01", label: "ช่องว่างขอบแผ่นกับผนัง/บัว/เสา/เฟอร์นิเจอร์", spec: "≤ 1 mm", requiresPhoto: false, isCritical: true, measuringDeviceKind: "ฟีลเลอร์เกจ" },
  { code: "QC02", label: "รอยต่อชนก่อนเชื่อม", spec: "≤ 0.3 mm", requiresPhoto: false, isCritical: true, measuringDeviceKind: "ฟีลเลอร์เกจ" },
  { code: "QC03", label: "ความตรงของแนวตัด", spec: "เบี่ยง ≤ 1 mm/1 m", requiresPhoto: false, isCritical: true, measuringDeviceKind: "ตลับเมตร/ไม้บรรทัดเหล็ก" },
  { code: "QC04", label: "ขอบแผ่นเผยอ / กระดก", spec: "= 0 mm", requiresPhoto: false, isCritical: true, measuringDeviceKind: "ฟีลเลอร์เกจ" },
  { code: "QC05", label: "รอยตัดไหม้ / บิ่น / ฉีก", spec: "ต้องไม่มี", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC06", label: "ความลึกร่องกรีด", spec: "~2/3 ความหนาแผ่น", requiresPhoto: false, isCritical: true, measuringDeviceKind: "ตลับเมตร/ไม้บรรทัดเหล็ก" },
  { code: "QC07", label: "ความสมบูรณ์แนวเชื่อม", spec: "เต็มแนว เรียบเสมอผิว", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC08", label: "ความแข็งแรงรอยเชื่อม", spec: "ดึงเบาไม่แยก", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC09", label: "เวลาบ่ม", spec: "≥ 24 ชม.", requiresPhoto: false, isCritical: true, measuringDeviceKind: "นาฬิกา/ตัวจับเวลา" },
  { code: "QC10", label: "บัว / ตัวจบแนบสนิท", spec: "0 mm", requiresPhoto: false, isCritical: true, measuringDeviceKind: "ฟีลเลอร์เกจ" },
  { code: "QC11", label: "แนวซิลิโคนต่อเนื่อง", spec: "ไม่ขาดช่วง", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC12", label: "โซนเปียก — น้ำไม่ซึมใต้แผ่น", spec: "ผ่านทดสอบ", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC13", label: "ความลาดตัวจบ", spec: "เดินผ่านไม่สะดุ้ง", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC14", label: "ความสะอาดผิวงาน", spec: "ไม่มีคราบ", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
  { code: "QC15", label: "สภาพพื้นก่อนติดตั้ง", spec: "แห้งสะอาด", requiresPhoto: false, isCritical: true, measuringDeviceKind: null },
];

export function fallbackChecklist(reason: string): JobChecklistSource {
  return {
    items: FALLBACK_QC_ITEMS,
    origin: "fallback",
    version: null,
    templateId: null,
    jobTypeName: null,
    fallbackReason: reason,
  };
}

/** ข้อความบอกที่มาของเกณฑ์ที่กำลังแสดง เพื่อให้หัวหน้าช่างที่เพิ่งแก้แม่แบบรู้ว่าการแก้มีผลแล้วหรือยัง */
export function checklistProvenanceLabel(source: JobChecklistSource): string {
  if (source.origin === "template" && source.version != null) {
    return `เกณฑ์ตรวจรับ v${source.version}${source.jobTypeName ? ` · ${source.jobTypeName}` : ""}`;
  }
  return "เกณฑ์ตรวจรับ (ชุดสำรองในโค้ด)";
}

/**
 * เลขข้อเดิม (1–15) ที่ผลตรวจรับรุ่นเก่าใช้เป็นคีย์ ↔ รหัสเกณฑ์ (QC01–QC15)
 * seed ทำไว้ตรงกันข้อต่อข้อ การแปลงจึงไม่ทำให้ผลเก่าเพี้ยนหรือหาย
 */
export function legacyQcIdForCode(code: string): number | null {
  const matched = /^QC(\d+)$/.exec(code.trim());
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function codeForLegacyQcId(id: number): string {
  return `QC${String(id).padStart(2, "0")}`;
}

function asQcResult(value: unknown): QCResult {
  return value === "pass" || value === "fail" || value === "na" ? value : null;
}

/**
 * แปลงผลตรวจรับที่บันทึกไว้ให้เป็นคีย์รหัสเกณฑ์เสมอ
 * - ของเก่าใน install_jobs.qc_data ใช้คีย์เป็นเลขข้อ ("1".."15") -> แปลงเป็น QC01..QC15
 * - ของใหม่ใช้คีย์เป็นรหัสอยู่แล้ว -> คงไว้ตามเดิม
 * คีย์ที่แปลงแล้วชนกันจะยึดค่าที่เป็นรหัสอยู่แล้ว (ของใหม่กว่า) ไม่ให้ค่าที่แปลงมาทับ
 */
export function normalizeQcResults(raw: unknown): Record<string, QCResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const normalized: Record<string, QCResult> = {};
  const fromLegacy: Record<string, QCResult> = {};
  for (const [key, value] of Object.entries(source)) {
    const result = asQcResult(value);
    if (!result) continue;
    if (/^\d+$/.test(key.trim())) {
      fromLegacy[codeForLegacyQcId(Number(key.trim()))] = result;
    } else {
      normalized[key.trim()] = result;
    }
  }
  return { ...fromLegacy, ...normalized };
}

interface ChecklistItemRowLike {
  code?: unknown;
  label?: unknown;
  spec_text?: unknown;
  requires_photo?: unknown;
  is_critical?: unknown;
  measuring_device_kind?: unknown;
  is_active?: unknown;
  sort_order?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** แปลงแถวจากตาราง job_checklist_template_items เป็นรายการที่หน้าจอใช้ (เอาเฉพาะข้อที่เปิดใช้งาน) */
export function checklistItemsFromRows(rows: unknown): JobChecklistItem[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => row as ChecklistItemRowLike)
    .filter((row) => row.is_active !== false)
    .map((row, index) => ({
      row,
      order: typeof row.sort_order === "number" ? row.sort_order : index,
      index,
    }))
    .sort((a, b) => (a.order - b.order) || (a.index - b.index))
    .map(({ row }) => ({
      code: text(row.code) ?? "",
      label: text(row.label) ?? "",
      spec: text(row.spec_text),
      requiresPhoto: row.requires_photo === true,
      isCritical: row.is_critical !== false,
      measuringDeviceKind: text(row.measuring_device_kind),
    }))
    .filter((item) => item.code !== "" && item.label !== "");
}

interface ChecklistRpcPayload {
  templateId?: unknown;
  version?: unknown;
  jobTypeName?: unknown;
  items?: unknown;
}

/**
 * แปลงผลลัพธ์ของ RPC get_technician_job_checklist ให้เป็นชุดเกณฑ์ที่หน้าจอใช้
 * ถ้าเนื้อหาไม่ครบ (ไม่มีแม่แบบ active / ไม่มีข้อไหนเปิดใช้งาน) ให้ตกไปใช้ชุดสำรอง
 */
export function checklistFromRpcPayload(payload: unknown, fallbackReason: string): JobChecklistSource {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallbackChecklist(fallbackReason);
  const value = payload as ChecklistRpcPayload;
  const items = checklistItemsFromRows(value.items);
  if (items.length === 0) return fallbackChecklist(fallbackReason);
  return {
    items,
    origin: "template",
    version: typeof value.version === "number" ? value.version : null,
    templateId: text(value.templateId),
    jobTypeName: text(value.jobTypeName),
    fallbackReason: null,
  };
}

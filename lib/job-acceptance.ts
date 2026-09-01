/**
 * P4-3 — ผลตรวจรับงาน (job_acceptance_results) และทะเบียนเครื่องมือวัด: ตัวแปลงและข้อความภาษาไทย
 *
 * แหล่งความจริงคือฐานข้อมูล ไม่ใช่ไฟล์นี้:
 *   - public.save_job_acceptance_results()  เขียนผลตรวจรับ (แถวจริง) + sync install_jobs.qc_data
 *   - public.job_acceptance_gate()          ตัดสินว่างานผ่านเกณฑ์พอจะปิดได้หรือยัง
 *   - public.verify_job_acceptance_results() ลายเซ็นรับรองชั้นที่สองของทีมออฟฟิศ
 *   - public.get_measuring_devices() / upsert_measuring_device() / get_measuring_device_usage()
 * ไฟล์นี้ไม่ตัดสินกฎใหม่ หน้าที่เดียวคือแปลงข้อมูลให้หน้าจอใช้ และบอกกฎเป็นภาษาไทยให้ตรงกับที่ SQL ทำจริง
 *
 * ทำไมต้องมีข้อความกฎอยู่ในโค้ดฝั่งหน้าจอด้วย ทั้งที่ SQL ก็ raise exception เป็นไทยอยู่แล้ว:
 * เพราะ error ตอนกดปิดงานคือ "รู้ตอนสาย" — คนกรอกต้องรู้กฎตั้งแต่ตอนกรอก ไม่ใช่ตอนถูกปฏิเสธ
 */

import { floorErrorMessage } from "@/lib/floor-error-message";
import type { JobChecklistItem, QCResult } from "@/lib/job-checklist";

export const ACCEPTANCE_SAVE_RPC = "save_job_acceptance_results";
export const ACCEPTANCE_GATE_RPC = "job_acceptance_gate";
export const ACCEPTANCE_VERIFY_RPC = "verify_job_acceptance_results";
export const MEASURING_DEVICES_RPC = "get_measuring_devices";
export const MEASURING_DEVICE_USAGE_RPC = "get_measuring_device_usage";
export const MEASURING_DEVICE_UPSERT_RPC = "upsert_measuring_device";
export const CLOSE_CS_RPC = "close_floor_work_order_cs_v4";
export const CLOSE_SPECIAL_RPC = "close_floor_work_order_special_v2";

/**
 * กฎการปิดงานที่ job_acceptance_gate ใช้จริง เขียนเป็นภาษาคน
 *
 * หมายเหตุสำคัญเรื่อง "ข้อบังคับ": ตาราง job_checklist_template_items ไม่มีคอลัมน์ is_required
 * ความหมายของ "บังคับ" ในระบบนี้จึงไม่ใช่ธงต่อข้อ แต่คือ "ทุกข้อที่ยังเปิดใช้งานต้องมีคำตอบ"
 * (ตอบ ผ่าน / ไม่ผ่าน / ไม่เกี่ยวข้อง อย่างใดอย่างหนึ่ง) — ข้อที่ไม่ตอบ = ข้อที่ยังไม่ได้ตรวจ
 * ห้ามเขียนบนจอว่า "ข้อบังคับ N ข้อ" เพราะจะทำให้เข้าใจว่ามีข้อที่ข้ามได้ ทั้งที่ไม่มี
 */
export const ACCEPTANCE_RULE_NOTICE_LINES = [
  "ทุกข้อที่เปิดใช้งานอยู่ต้องมีคำตอบ (ผ่าน / ไม่ผ่าน / ไม่เกี่ยวข้อง) — ข้อที่เว้นว่างถือว่ายังไม่ได้ตรวจ และปิดงานไม่ได้",
  "ข้อที่ทำเครื่องหมาย “ข้อสำคัญ” ถ้าตอบว่าไม่ผ่าน จะปิดงานไม่ได้ ไม่มีข้อยกเว้นในตัวด่านตรวจรับ",
  "ข้อที่ระบุว่า “ต้องมีรูป” ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป ยกเว้นตอบว่าไม่เกี่ยวข้อง",
  "งานของทีมภายนอก (ผู้รับเหมาช่วง) ต้องมีคนฝั่งบริษัทเซ็นรับรองผลอีกชั้นก่อนปิดงาน",
];

export const ACCEPTANCE_RULE_HEADLINE = "กฎที่ใช้ตัดสินว่าปิดงานได้หรือยัง";

/** ผลตรวจรับของเกณฑ์หนึ่งข้อ ตามที่หน้าจอถือไว้ระหว่างกรอก */
export interface AcceptanceEntry {
  result: QCResult;
  measuredValue: string;
  measuringDeviceId: string | null;
  photoPaths: string[];
  note: string;
}

export type AcceptanceEntryMap = Record<string, AcceptanceEntry>;

export function emptyAcceptanceEntry(): AcceptanceEntry {
  return { result: null, measuredValue: "", measuringDeviceId: null, photoPaths: [], note: "" };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() !== "" ? [item.trim()] : []));
}

function asResult(value: unknown): QCResult {
  return value === "pass" || value === "fail" || value === "na" ? value : null;
}

/** แปลงแถวจากตาราง job_acceptance_results เป็นค่าที่ฟอร์มใช้ (คีย์ = รหัสเกณฑ์) */
export function parseAcceptanceRows(rows: unknown): AcceptanceEntryMap {
  if (!Array.isArray(rows)) return {};
  const map: AcceptanceEntryMap = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const code = str(r.item_code);
    if (!code) continue;
    map[code] = {
      result: asResult(r.result),
      measuredValue: str(r.measured_value) ?? "",
      measuringDeviceId: str(r.measuring_device_id),
      photoPaths: strArray(r.photo_paths),
      note: str(r.note) ?? "",
    };
  }
  return map;
}

/** ผู้รับรองชั้นที่สองของแต่ละข้อ (อ่านอย่างเดียว ใช้แสดงว่าข้อไหนเซ็นแล้ว) */
export interface AcceptanceVerification { code: string; verifiedAt: string | null; verifiedRole: string | null }

export function parseAcceptanceVerifications(rows: unknown): AcceptanceVerification[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const code = str(r.item_code);
    if (!code) return [];
    return [{ code, verifiedAt: str(r.verified_at), verifiedRole: str(r.verified_role) }];
  });
}

/**
 * แปลงค่าที่กรอกในฟอร์มเป็น payload ของ save_job_acceptance_results
 * ส่งครบทุกข้อที่แสดงอยู่ รวมข้อที่ยังไม่ตอบ (result = null) เพราะ RPC ใช้ null เป็นสัญญาณ "ลบผลข้อนี้ทิ้ง"
 * ถ้าไม่ส่งข้อที่ถูกล้างคำตอบไป ผลเก่าของข้อนั้นจะค้างอยู่ในฐานข้อมูลทั้งที่คนกรอกตั้งใจลบ
 */
export function buildAcceptanceResultsPayload(
  items: JobChecklistItem[],
  entries: AcceptanceEntryMap,
): Record<string, unknown>[] {
  return items.map((item) => {
    const entry = entries[item.code] ?? emptyAcceptanceEntry();
    return {
      code: item.code,
      result: entry.result,
      measuredValue: entry.measuredValue.trim() || null,
      measuringDeviceId: entry.result ? entry.measuringDeviceId : null,
      photoPaths: entry.photoPaths,
      note: entry.note.trim() || null,
    };
  });
}

/**
 * เหตุผลภาษาไทยว่าทำไมข้อนี้ยังบันทึกไม่ได้ (คืน null แปลว่าข้อนี้ผ่าน)
 * ต้องตรงกับ constraint job_acceptance_results_photo_required และเงื่อนไขใน save_job_acceptance_results
 */
export function acceptanceItemSaveBlock(item: JobChecklistItem, entry: AcceptanceEntry | undefined): string | null {
  const current = entry ?? emptyAcceptanceEntry();
  if (item.requiresPhoto && current.result === "pass" && current.photoPaths.length === 0) {
    return `${item.code} ${item.label} — ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป ก่อนจึงจะบันทึกว่า “ผ่าน” ได้`;
  }
  return null;
}

/** รวมเหตุผลที่ยังกดบันทึกไม่ได้ทั้งชุด (ว่าง = บันทึกได้) */
export function acceptanceSaveBlocks(items: JobChecklistItem[], entries: AcceptanceEntryMap): string[] {
  return items.flatMap((item) => {
    const reason = acceptanceItemSaveBlock(item, entries[item.code]);
    return reason ? [reason] : [];
  });
}

/**
 * เหตุผลภาษาไทยว่าข้อนี้จะทำให้ "ปิดงานไม่ได้" (ต่างจากบันทึกไม่ได้)
 * ใช้เตือนล่วงหน้าตอนกรอก ไม่ใช่ตัวตัดสิน — ตัวตัดสินจริงคือ job_acceptance_gate ในฐานข้อมูล
 */
export function acceptanceItemCloseWarning(item: JobChecklistItem, entry: AcceptanceEntry | undefined): string | null {
  const current = entry ?? emptyAcceptanceEntry();
  if (current.result === null) return "ยังไม่ได้บันทึกผล — ปิดงานไม่ได้จนกว่าจะตอบข้อนี้";
  if (item.requiresPhoto && current.result !== "na" && current.photoPaths.length === 0) {
    return "ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป — ปิดงานไม่ได้จนกว่าจะมีรูป";
  }
  if (item.isCritical && current.result === "fail") return "ข้อสำคัญที่ตอบว่าไม่ผ่าน — ปิดงานไม่ได้จนกว่าจะแก้และตรวจใหม่";
  return null;
}

export function acceptanceProgress(items: JobChecklistItem[], entries: AcceptanceEntryMap) {
  const answered = items.filter((item) => (entries[item.code]?.result ?? null) !== null).length;
  const pass = items.filter((item) => entries[item.code]?.result === "pass").length;
  const fail = items.filter((item) => entries[item.code]?.result === "fail").length;
  const na = items.filter((item) => entries[item.code]?.result === "na").length;
  const blocking = items.filter((item) => acceptanceItemCloseWarning(item, entries[item.code]) !== null).length;
  return { total: items.length, answered, pass, fail, na, blocking };
}

// ---------------------------------------------------------------------------
// ด่านตรวจรับ (job_acceptance_gate) — ตัวตัดสินจริงว่าปิดงานได้หรือยัง
// ---------------------------------------------------------------------------

export type AcceptanceMissingReason =
  | "no_active_template"
  | "not_recorded"
  | "missing_photo"
  | "critical_failed"
  | "not_verified"
  | "unknown";

export interface AcceptanceGateMissing {
  code: string;
  label: string;
  reason: AcceptanceMissingReason;
  text: string;
}

export interface AcceptanceGate {
  ok: boolean;
  templateId: string | null;
  templateVersion: number | null;
  /** งานนี้เป็นของทีมภายนอก (tech_teams.provider_type = 'subcontract') หรือไม่ */
  external: boolean;
  teamName: string | null;
  providerType: string | null;
  itemCount: number;
  recordedCount: number;
  missing: AcceptanceGateMissing[];
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const parsed = Number(value.trim()); if (Number.isFinite(parsed)) return parsed; }
  return 0;
}

const MISSING_REASONS: AcceptanceMissingReason[] = [
  "no_active_template", "not_recorded", "missing_photo", "critical_failed", "not_verified",
];

function asReason(value: unknown): AcceptanceMissingReason {
  return MISSING_REASONS.includes(value as AcceptanceMissingReason) ? (value as AcceptanceMissingReason) : "unknown";
}

/**
 * แปลงผลของ job_acceptance_gate — คืน null เมื่ออ่านไม่ออก
 *
 * "อ่านไม่ออก" ต้องไม่ถูกแปลว่า "ผ่าน" เด็ดขาด หน้าจอที่เรียกต้องปฏิบัติกับ null
 * เหมือนกับ "ยังไม่รู้ว่าผ่านหรือไม่" และห้ามเอาไปใช้เป็นเหตุผลเปิดปุ่มปิดงาน
 */
export function parseAcceptanceGate(payload: unknown): AcceptanceGate | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.ok !== "boolean") return null;
  const missingRaw = Array.isArray(value.missing) ? value.missing : [];
  return {
    ok: value.ok,
    templateId: str(value.templateId),
    templateVersion: typeof value.templateVersion === "number" ? value.templateVersion : null,
    external: value.external === true,
    teamName: str(value.teamName),
    providerType: str(value.providerType),
    itemCount: num(value.itemCount),
    recordedCount: num(value.recordedCount),
    missing: missingRaw.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      return [{
        code: str(r.code) ?? "-",
        label: str(r.label) ?? "",
        reason: asReason(r.reason),
        text: str(r.text) ?? "",
      }];
    }),
  };
}

/** บรรทัดเดียวต่อรายการที่ขาด — ใช้ทั้งใน dialog และใน toast */
export function gateMissingLine(missing: AcceptanceGateMissing): string {
  const head = [missing.code, missing.label].filter((part) => part && part !== "-").join(" ");
  return head ? `${head} — ${missing.text}` : missing.text;
}

export function gateMissingSummary(gate: AcceptanceGate): string {
  return gate.missing.map(gateMissingLine).join(" · ");
}

/** พาดหัวสั้น ๆ ว่าตอนนี้ด่านตรวจรับอยู่สถานะไหน */
export function gateHeadline(gate: AcceptanceGate | null): string {
  if (!gate) return "ยังตรวจสอบเกณฑ์ตรวจรับไม่ได้ — ถือว่ายังไม่ผ่าน จนกว่าจะอ่านผลได้";
  if (gate.ok) return `เกณฑ์ตรวจรับครบแล้ว ${gate.recordedCount}/${gate.itemCount} ข้อ`;
  return `เกณฑ์ตรวจรับยังไม่ครบ — ติดอยู่ ${gate.missing.length} รายการ (บันทึกแล้ว ${gate.recordedCount}/${gate.itemCount} ข้อ)`;
}

/**
 * ควรแสดงปุ่ม "รับรองชั้นที่สอง" หรือไม่
 *
 * ตอนนี้ทีมช่างทุกทีมมี provider_type = NULL (ทีมภายในทั้งหมด) ด่านจึงคืน external = false เสมอ
 * แปลว่าปุ่มนี้จะไม่โผล่บนงานจริงสักงานในวันนี้ — และนั่นคือพฤติกรรมที่ถูกต้อง
 * ถ้าโชว์ปุ่มบนงานทีมภายใน คนจะกดแล้วได้ผลลัพธ์ที่ไม่มีความหมาย (เซ็นรับรองสิ่งที่ไม่ต้องรับรอง)
 * และยังเสี่ยงถูกเข้าใจว่าเป็นด่านที่ค้างอยู่ทั้งที่ไม่ได้ค้าง
 */
export function shouldShowExternalVerification(gate: AcceptanceGate | null): boolean {
  return gate?.external === true;
}

/** ข้อความอธิบายสถานะการรับรองชั้นที่สอง (แสดงเฉพาะตอนที่เกี่ยวข้องจริง) */
export function externalVerificationNotice(gate: AcceptanceGate | null): string | null {
  if (!shouldShowExternalVerification(gate)) return null;
  const team = gate?.teamName ? `ทีม ${gate.teamName}` : "ทีมภายนอก";
  const pending = (gate?.missing ?? []).filter((row) => row.reason === "not_verified");
  if (!pending.length) return `${team} เป็นผู้รับเหมาช่วง — ผลตรวจรับได้รับการรับรองจากฝั่งบริษัทครบแล้ว`;
  return `${team} เป็นผู้รับเหมาช่วง จึงต้องมีคนฝั่งบริษัท (ผู้ดูแลระบบ / หัวหน้าช่าง / CS) เซ็นรับรองผลอีกชั้น · ยังไม่ได้รับรอง ${pending.length} ข้อ`;
}

/** เหตุผลที่ปุ่มปิดงานยังกดไม่ได้จากมุมของด่านตรวจรับ (null = ด่านนี้ไม่ขวาง) */
export function closeBlockedByAcceptance(gate: AcceptanceGate | null): string | null {
  if (!gate) return "ยังอ่านผลด่านตรวจรับไม่ได้ จึงยังยืนยันไม่ได้ว่างานนี้ผ่านเกณฑ์";
  if (gate.ok) return null;
  return `เกณฑ์ตรวจรับยังไม่ครบ: ${gateMissingSummary(gate)}`;
}

// ---------------------------------------------------------------------------
// ทะเบียนเครื่องมือวัด (measuring_devices)
// ---------------------------------------------------------------------------

export type MeasuringDeviceStatus = "ok" | "due" | "out_of_service";

export const MEASURING_DEVICE_STATUS_LABELS: Record<MeasuringDeviceStatus, string> = {
  ok: "ใช้งานได้",
  due: "ครบกำหนดสอบเทียบ",
  out_of_service: "ปลดจากการใช้งาน",
};

export interface MeasuringDevice {
  id: string;
  code: string;
  kind: string;
  status: MeasuringDeviceStatus;
  ownerTeamId: string | null;
  ownerTeamName: string | null;
  rangeText: string | null;
  resolutionText: string | null;
  lastCalibratedAt: string | null;
  calibrationIntervalDays: number | null;
  nextDueAt: string | null;
  /** ฐานข้อมูลบอกตรง ๆ ว่ารู้วันสอบเทียบล่าสุดหรือไม่ — "ไม่รู้" ต้องไม่หน้าตาเหมือน "ยังไม่ครบกำหนด" */
  calibrationKnown: boolean;
  isOverdue: boolean;
  jobsSinceCalibration: number;
  readingsSinceCalibration: number;
  lastUsedAt: string | null;
  note: string | null;
}

function asStatus(value: unknown): MeasuringDeviceStatus {
  return value === "due" || value === "out_of_service" ? value : "ok";
}

export function parseMeasuringDevices(rows: unknown): MeasuringDevice[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const code = str(r.code);
    if (!id || !code) return [];
    return [{
      id,
      code,
      kind: str(r.kind) ?? "ไม่ระบุชนิด",
      status: asStatus(r.status),
      ownerTeamId: str(r.owner_team_id),
      ownerTeamName: str(r.owner_team_name),
      rangeText: str(r.range_text),
      resolutionText: str(r.resolution_text),
      lastCalibratedAt: str(r.last_calibrated_at),
      calibrationIntervalDays: typeof r.calibration_interval_days === "number" ? r.calibration_interval_days : null,
      nextDueAt: str(r.next_due_at),
      calibrationKnown: r.calibration_known === true,
      isOverdue: r.is_overdue === true,
      jobsSinceCalibration: num(r.jobs_since_calibration),
      readingsSinceCalibration: num(r.readings_since_calibration),
      lastUsedAt: str(r.last_used_at),
      note: str(r.note),
    }];
  });
}

/**
 * ข้อความสถานะสอบเทียบ — แยก "ไม่รู้" ออกจาก "ยังไม่ครบกำหนด" อย่างเด็ดขาด
 * (เหตุผลเดียวกับที่ upsert_measuring_device ตั้ง next_due_at = null เมื่อข้อมูลไม่ครบ)
 */
export function deviceCalibrationLabel(device: MeasuringDevice): string {
  if (!device.calibrationKnown) return "ยังไม่รู้วันสอบเทียบล่าสุด";
  if (!device.nextDueAt) return `สอบเทียบล่าสุด ${device.lastCalibratedAt} · ยังไม่ได้ตั้งรอบสอบเทียบ`;
  if (device.isOverdue) return `เลยกำหนดสอบเทียบแล้ว (ครบกำหนด ${device.nextDueAt})`;
  return `ครบกำหนดสอบเทียบ ${device.nextDueAt}`;
}

/** ทะเบียนว่างเปล่า — ข้อความนี้ต้องขึ้นแทน dropdown ว่างที่ดูเหมือนระบบพัง */
export const NO_MEASURING_DEVICES_NOTICE = "ยังไม่มีเครื่องมือวัดในทะเบียน";
export const NO_MEASURING_DEVICES_HINT =
  "ยังไม่มีเครื่องมือวัดในทะเบียน — เพิ่มได้ที่หน้า “แม่แบบงาน” › ทะเบียนเครื่องมือวัด (ผู้ดูแลระบบ / หัวหน้าช่าง)";

/** เครื่องมือที่เลือกได้จริง: ตัดตัวที่ปลดจากการใช้งานออก เพราะฐานข้อมูลปฏิเสธอยู่แล้ว */
export function selectableDevices(devices: MeasuringDevice[]): MeasuringDevice[] {
  return devices.filter((device) => device.status !== "out_of_service");
}

/**
 * ทำให้ "ชนิดเครื่องมือ" สองฝั่งเทียบกันได้จริง
 *
 * ปัญหาที่แก้: measuring_device_kind ถูกพิมพ์มือที่หน้าแม่แบบเกณฑ์ตรวจรับ ส่วน
 * measuring_devices.kind ถูกพิมพ์มือที่ทะเบียนเครื่องมือ สองช่องนี้อยู่คนละที่ คนละเวลา
 * ถ้าเทียบด้วย === ตรง ๆ เคาะวรรคเกินมาหนึ่งที่ ก็พอให้เครื่องมือทั้งตัว "หายไป"
 * จาก dropdown ของเกณฑ์ข้อนั้น โดยไม่มีอะไรฟ้อง — ผู้ใช้เห็นแค่ช่องว่างเปล่า
 * และสรุปว่าโปรแกรมพัง ไม่ใช่ว่าตัวเองเคาะวรรคเกิน
 *
 * ที่ยุบทิ้ง: อักขระความกว้างศูนย์ (ติดมากับการคัดลอกวาง) · ช่องว่างซ้ำและช่องว่างหัวท้าย
 * (รวม non-breaking space ที่ \s ของ JS ครอบอยู่แล้ว) · ตัวพิมพ์ใหญ่-เล็กของอักษรละติน
 * แล้ว normalize เป็น NFC เพื่อให้สระ/วรรณยุกต์ไทยที่มาจากคีย์บอร์ดคนละตัวเทียบกันได้
 *
 * ที่ "ไม่" ยุบ: การสะกดที่ต่างกันจริง เช่น ฟีลเลอร์เกจ กับ ฟิลเลอร์เกจ
 * เพราะการเดาว่าสองคำนี้คือของเดียวกันเป็นการเดาแทนผู้ใช้ ทางแก้ที่ถูกคือกันที่ต้นทาง —
 * หน้าทะเบียนเครื่องมือจึงให้ "เลือก" จากชนิดที่แม่แบบใช้อยู่แล้วเป็นหลัก
 * และเปิดให้พิมพ์ชนิดใหม่ได้เมื่อจำเป็นจริง ๆ เท่านั้น
 */
export function normalizeDeviceKind(kind: string | null | undefined): string {
  if (!kind) return "";
  return kind
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * ตัวสะกดที่ควร "เก็บลงฐานข้อมูล" — เก็บรูปที่คนอ่านออกไว้ (ไม่ lowercase)
 * แต่ล้างสิ่งที่ไม่มีความหมายทิ้ง: อักขระความกว้างศูนย์ ช่องว่างซ้ำ ช่องว่างหัวท้าย
 * ใช้ที่ "ทุกทางเขียน" ของทั้งสองฝั่ง (แม่แบบเกณฑ์ และทะเบียนเครื่องมือ)
 * เพื่อไม่ให้ต้องพึ่ง normalizeDeviceKind ตอนอ่านเพียงอย่างเดียว
 */
export function tidyDeviceKind(kind: string | null | undefined): string {
  if (!kind) return "";
  return kind.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

/** ชนิดสองตัวนี้หมายถึงของเดียวกันหรือไม่ (ใช้ที่ไหนก็ตามที่เคยเทียบด้วย === ) */
export function sameDeviceKind(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDeviceKind(a) === normalizeDeviceKind(b);
}

/**
 * รวมชนิดที่ "รู้จัก" จากหลายแหล่งให้เหลือชุดเดียวสำหรับเอาไปเป็นตัวเลือกจริง
 * ตัวสะกดที่ normalise แล้วตรงกันจะถูกยุบเป็นตัวเดียว โดยเก็บตัวสะกดที่เจอก่อนไว้แสดง
 * (แหล่งแรกที่ส่งเข้ามาคือแม่แบบเกณฑ์ตรวจรับ ซึ่งเป็นฝ่ายที่ "ประกาศ" ว่าต้องใช้ชนิดอะไร
 *  จึงควรเป็นตัวสะกดที่ชนะ)
 */
export function mergeDeviceKinds(...groups: (string | null | undefined)[][]): string[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    for (const raw of group) {
      const key = normalizeDeviceKind(raw);
      if (!key || seen.has(key)) continue;
      seen.set(key, tidyDeviceKind(raw));
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "th"));
}

export function devicesForKind(devices: MeasuringDevice[], kind: string | null): MeasuringDevice[] {
  const usable = selectableDevices(devices);
  const wanted = normalizeDeviceKind(kind);
  if (!wanted) return usable;
  return usable.filter((device) => normalizeDeviceKind(device.kind) === wanted);
}

/**
 * ข้อความอธิบายช่องเลือกเครื่องมือ (null = มีตัวเลือกให้เลือกตามชนิดที่แม่แบบระบุ)
 *
 * สามสถานะที่ต้องแยกจากกันให้ขาด:
 *   1) ทะเบียนว่างทั้งทะเบียน   -> บอกว่ายังไม่มีเครื่องมือในทะเบียน + บอกที่เพิ่ม
 *   2) มีเครื่องมือ แต่ไม่มีชนิดนี้ -> บอกว่าชนิดนี้ยังไม่มี แล้วให้เลือกจากชนิดอื่นได้
 *   3) มีครบ                     -> ไม่ต้องมีข้อความ
 * ถ้ายุบสามสถานะนี้เป็น dropdown ว่างเปล่าเหมือนกันหมด คนใช้จะเดาว่าโปรแกรมพัง
 */
export function deviceSelectNotice(devices: MeasuringDevice[], kind: string | null): string | null {
  const usable = selectableDevices(devices);
  if (!usable.length) return NO_MEASURING_DEVICES_HINT;
  if (!kind) return null;
  if (devicesForKind(devices, kind).length > 0) return null;
  return `ยังไม่มีเครื่องมือชนิด “${kind}” ในทะเบียน (มีเครื่องมือชนิดอื่นอยู่ ${usable.length} รายการ) — เลือกจากรายการทั้งหมดได้ หรือเพิ่มเครื่องมือชนิดนี้ที่หน้า “แม่แบบงาน” › ทะเบียนเครื่องมือวัด`;
}

/** รายการที่ควรเอาขึ้น dropdown: ชนิดตรงก่อน ถ้าไม่มีชนิดตรงเลยจึงเปิดให้เลือกทั้งหมด */
export function deviceOptions(devices: MeasuringDevice[], kind: string | null): MeasuringDevice[] {
  const matched = devicesForKind(devices, kind);
  return matched.length ? matched : selectableDevices(devices);
}

export interface MeasuringDeviceUsageRow {
  deviceId: string;
  deviceCode: string;
  deviceKind: string;
  deviceStatus: MeasuringDeviceStatus;
  lastCalibratedAt: string | null;
  nextDueAt: string | null;
  calibrationKnown: boolean;
  jobNo: string;
  customerName: string | null;
  itemCodes: string[];
  readings: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
}

export function parseMeasuringDeviceUsage(rows: unknown): MeasuringDeviceUsageRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const deviceId = str(r.device_id);
    const jobNo = str(r.job_no);
    if (!deviceId || !jobNo) return [];
    return [{
      deviceId,
      deviceCode: str(r.device_code) ?? "-",
      deviceKind: str(r.device_kind) ?? "ไม่ระบุชนิด",
      deviceStatus: asStatus(r.device_status),
      lastCalibratedAt: str(r.last_calibrated_at),
      nextDueAt: str(r.next_due_at),
      calibrationKnown: r.calibration_known === true,
      jobNo,
      customerName: str(r.customer_name),
      itemCodes: strArray(r.item_codes),
      readings: num(r.readings),
      firstUsedAt: str(r.first_used_at),
      lastUsedAt: str(r.last_used_at),
    }];
  });
}

/** ข้อความว่างของรายงานการใช้งาน — ต้องบอกด้วยว่านับเฉพาะหลังสอบเทียบครั้งล่าสุด */
export const NO_DEVICE_USAGE_NOTICE =
  "ยังไม่มีงานที่บันทึกผลวัดด้วยเครื่องมือตัวนี้ (นับเฉพาะการใช้งานหลังการสอบเทียบครั้งล่าสุด)";

// ---------------------------------------------------------------------------
// สถานะตรวจรับที่หน้าจอช่างหน้างานอ่านได้ (RPC get_technician_job_acceptance_status)
//
// หน้าช่างเป็นทางอ่านอย่างเดียวโดยตั้งใจ — เหตุผลเต็มอยู่ในหัวไฟล์
// supabase/migrations/20260902190000_technician_job_acceptance_status_read.sql
// สรุปสั้น ๆ: ถ้าช่างบันทึกผลตรวจรับเองได้ ด่านตรวจรับจะถูกทำให้ครบด้วยมือคนเดียว
// โดยไม่มีใครฝั่งบริษัทดูเลย ซึ่งทำลายเหตุผลทั้งหมดของการมีด่าน
// ---------------------------------------------------------------------------

export interface TechnicianItemStatus { result: QCResult; photoCount: number; verified: boolean }

export interface TechnicianAcceptanceStatus {
  found: boolean;
  reason: string | null;
  jobNo: string | null;
  gate: AcceptanceGate | null;
  results: Record<string, TechnicianItemStatus>;
}

export function parseTechnicianAcceptanceStatus(payload: unknown): TechnicianAcceptanceStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.found !== "boolean") return null;
  const results: Record<string, TechnicianItemStatus> = {};
  const raw = value.results;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [code, row] of Object.entries(raw as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      results[code] = { result: asResult(r.result), photoCount: num(r.photoCount), verified: r.verified === true };
    }
  }
  return {
    found: value.found,
    reason: str(value.reason),
    jobNo: str(value.jobNo),
    gate: parseAcceptanceGate(value.gate),
    results,
  };
}

export const TECHNICIAN_ACCEPTANCE_READ_ONLY_NOTICE =
  "หน้านี้ดูสถานะได้อย่างเดียว การบันทึกผลผ่าน/ไม่ผ่านทำที่หน้าออฟฟิศ (แท็บ “ตรวจรับ” ในรายละเอียดงาน) — ผลตรวจรับต้องมีคนฝั่งบริษัทเป็นผู้บันทึก จึงจะใช้เป็นหลักฐานปิดงานได้";

export const TECHNICIAN_RESULT_LABELS: Record<"pass" | "fail" | "na", string> = {
  pass: "ผ่านแล้ว",
  fail: "ไม่ผ่าน",
  na: "ไม่เกี่ยวข้อง",
};

/** ป้ายสถานะรายข้อสำหรับหน้าช่าง — คืน null เมื่อยังไม่รู้สถานะ (อ่าน RPC ไม่ได้) */
export function technicianItemStatusLabel(
  status: TechnicianAcceptanceStatus | null,
  code: string,
): { tone: "pass" | "fail" | "na" | "pending"; text: string } | null {
  if (!status?.found) return null;
  const row = status.results[code];
  if (!row || row.result === null) return { tone: "pending", text: "ยังไม่ได้บันทึกผล" };
  return { tone: row.result, text: TECHNICIAN_RESULT_LABELS[row.result] };
}

// ---------------------------------------------------------------------------
// อัปโหลดรูปหลักฐานหลายไฟล์ — ผลลัพธ์ต้องเป็น "ไฟล์ต่อไฟล์" ไม่ใช่ "สำเร็จ/ล้มเหลว" ทั้งชุด
// ---------------------------------------------------------------------------

/**
 * ทำไมต้องแยกตรรกะนี้ออกมาจากหน้าจอ
 *
 * เดิมหน้าจอวนอัปโหลดแล้ว `throw` ทันทีที่ไฟล์ใดล้ม ผลคือไฟล์ที่ "ขึ้นไปแล้ว" ก่อนหน้านั้น
 * ไม่ถูกผูกเข้ากับผลตรวจรับเลย มันไปนอนอยู่ใน bucket job-photos (ซึ่งเป็น public)
 * โดยไม่มีอะไรในระบบอ้างถึง = รูปกำพร้าที่ลบก็ไม่มีใครลบ เจอก็ไม่มีใครเจอ
 * และผู้ใช้เห็นแค่ "อัปโหลดไม่สำเร็จ" ทั้งที่ครึ่งหนึ่งสำเร็จไปแล้ว
 *
 * กติกาที่ฟังก์ชันนี้บังคับ
 *   1) ไฟล์ที่สำเร็จต้องถูกคืนออกมาเสมอ แม้ไฟล์อื่นในชุดเดียวกันจะล้ม
 *      (คนเรียกมีหน้าที่เอาไปผูกกับ state ก่อนจะขึ้นข้อความ error)
 *   2) ล้มหนึ่งไฟล์ไม่หยุดทั้งชุด — ทำต่อจนครบ เพื่อให้ตอบผู้ใช้ได้ว่า
 *      "ไฟล์ไหนขึ้นแล้ว ไฟล์ไหนยังไม่ขึ้น" ครบทุกไฟล์ ไม่ใช่แค่ถึงไฟล์แรกที่พัง
 *   3) ไม่ลบไฟล์ที่อัปโหลดสำเร็จทิ้ง — เหตุผลเต็มอยู่ที่ ACCEPTANCE_UPLOAD_KEEP_RATIONALE
 */
export interface PhotoUploadFile {
  name: string;
  type?: string;
}

export interface PhotoUploadOk {
  name: string;
  path: string;
}

export interface PhotoUploadFail {
  name: string;
  reason: string;
}

export interface PhotoUploadOutcome {
  uploaded: PhotoUploadOk[];
  failed: PhotoUploadFail[];
}

/**
 * ทำไมถึง "ไม่" ลบไฟล์ที่ขึ้นไปแล้วเมื่อชุดนั้นมีไฟล์ล้ม
 *
 * ตัวเลือกมีสองทาง และทั้งคู่แย่คนละแบบ จึงต้องเลือกทางที่แย่น้อยกว่าอย่างมีเหตุผล
 *   ก) ลบทิ้ง  -> ไม่มีรูปกำพร้าใน bucket public แต่ระบบไป "ลบหลักฐานของผู้ใช้"
 *                 เอง โดยผู้ใช้ไม่ได้สั่ง รูปตรวจรับจำนวนมากถ่ายจากมือถือหน้างาน
 *                 ถ่ายซ้ำไม่ได้เพราะงานปิดไปแล้ว/ของถูกติดตั้งทับไปแล้ว
 *                 และการลบยังเป็นการเรียกเน็ตเวิร์กรอบใหม่ที่ล้มได้อีก
 *                 ถ้าลบไม่สำเร็จก็ได้ทั้งรูปกำพร้าและข้อความสับสน
 *   ข) เก็บไว้ -> เสี่ยงรูปกำพร้าเฉพาะกรณีที่ผู้ใช้ปิดลิ้นชักทิ้งโดยไม่กดบันทึก
 *                 เพราะไฟล์ที่สำเร็จถูกผูกเข้ากับรายการหลักฐานบนจอทันที
 *                 มันจึง "ไม่กำพร้า" ตั้งแต่วินาทีที่อัปโหลดเสร็จ และจะถูกบันทึกลง
 *                 job_acceptance_results เมื่อกดบันทึกผลตรวจรับตามปกติ
 *
 * เลือก (ข) เพราะการทำลายหลักฐานที่ผู้ใช้เพิ่งถ่ายมาเป็นความเสียหายที่กู้คืนไม่ได้
 * ส่วนรูปกำพร้าเป็นความเสียหายที่กู้คืนได้ (กวาดทีหลังได้) และเป็นความเสี่ยงที่มีอยู่
 * ก่อนหน้านี้แล้วในเส้นทางรูปสำรวจหน้างาน — ไม่ใช่ของใหม่ที่การแก้ครั้งนี้สร้างขึ้น
 * รากของปัญหาจริงคือ bucket job-photos เป็น public ซึ่งเป็นการตัดสินใจของผู้ใช้
 * ไม่ใช่ของโค้ด จึงถูกยกไปเป็นข้อบังคับใน MERGE_CHECKLIST.md แทนที่จะแก้เงียบ ๆ ที่นี่
 */
export const ACCEPTANCE_UPLOAD_KEEP_RATIONALE =
  "รูปที่อัปโหลดสำเร็จจะถูกเก็บไว้และผูกกับข้อนั้นให้แล้ว ระบบไม่ลบทิ้งเอง เพราะรูปหน้างานส่วนใหญ่ถ่ายซ้ำไม่ได้";

/** ชื่อไฟล์ที่ปลอดภัยพอจะเป็นส่วนหนึ่งของ path ใน storage */
export function safePhotoFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * อัปโหลดทีละไฟล์จนครบ แล้วคืนผลแยกเป็นสองกอง
 * ไม่ throw ไม่ว่ากรณีใด — การ throw คือสิ่งที่ทำให้ไฟล์ที่สำเร็จหายไปตั้งแต่แรก
 */
export async function uploadPhotoBatch<T extends PhotoUploadFile>(
  files: T[],
  makePath: (file: T, index: number) => string,
  upload: (path: string, file: T) => Promise<{ error?: unknown } | void>,
): Promise<PhotoUploadOutcome> {
  const uploaded: PhotoUploadOk[] = [];
  const failed: PhotoUploadFail[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const path = makePath(file, index);
    try {
      const result = await upload(path, file);
      const error = result && typeof result === "object" ? (result as { error?: unknown }).error : null;
      if (error) failed.push({ name: file.name, reason: floorErrorMessage(error) });
      else uploaded.push({ name: file.name, path });
    } catch (cause: unknown) {
      failed.push({ name: file.name, reason: floorErrorMessage(cause) });
    }
  }
  return { uploaded, failed };
}

export interface PhotoUploadReport {
  /** success = ขึ้นครบ · warning = ขึ้นบางส่วน · error = ไม่ขึ้นเลย */
  level: "success" | "warning" | "error";
  message: string;
}

function nameList(items: { name: string }[]): string {
  return items.map((item) => item.name).join(", ");
}

/** เหตุผลของไฟล์ที่ล้ม — ถ้าเหตุผลเดียวกันทุกไฟล์ (เช่น เซสชันหมดอายุ) ให้พูดครั้งเดียว */
function failureDetail(failed: PhotoUploadFail[]): string {
  const reasons = Array.from(new Set(failed.map((item) => item.reason)));
  if (reasons.length === 1) return `${nameList(failed)} (${reasons[0]})`;
  return failed.map((item) => `${item.name} (${item.reason})`).join(" · ");
}

/**
 * ข้อความรายงานผลอัปโหลด — ต้องบอกชื่อไฟล์ที่ขึ้นแล้วและที่ยังไม่ขึ้นแบบระบุตัวได้
 *
 * "อัปโหลดไม่สำเร็จ" เฉย ๆ เป็นคำตอบที่ผิดเมื่อบางไฟล์สำเร็จ เพราะผู้ใช้จะลากไฟล์
 * ทั้งชุดมาใหม่ แล้วได้รูปซ้ำใน bucket ทุกรอบที่ลอง — ต้องบอกให้ชัดว่าลองใหม่เฉพาะไฟล์ไหน
 */
export function photoUploadReport(code: string, outcome: PhotoUploadOutcome): PhotoUploadReport {
  const { uploaded, failed } = outcome;
  if (!failed.length) {
    return {
      level: "success",
      message: `แนบรูปหลักฐานข้อ ${code} แล้ว ${uploaded.length} รูป — อย่าลืมกดบันทึกผลตรวจรับ`,
    };
  }
  if (!uploaded.length) {
    return {
      level: "error",
      message: `แนบรูปหลักฐานข้อ ${code} ไม่สำเร็จทั้ง ${failed.length} รูป — ไม่มีไฟล์ใดขึ้นไปเลย\nไฟล์ที่ไม่สำเร็จ: ${failureDetail(failed)}`,
    };
  }
  const total = uploaded.length + failed.length;
  return {
    level: "warning",
    message: [
      `แนบรูปหลักฐานข้อ ${code} ได้ ${uploaded.length} จาก ${total} รูป`,
      `ขึ้นแล้วและแนบไว้ในข้อนี้ให้เรียบร้อย: ${nameList(uploaded)} — อย่าลืมกดบันทึกผลตรวจรับ`,
      `ยังไม่ขึ้น: ${failureDetail(failed)}`,
      `ลองใหม่เฉพาะไฟล์ที่ยังไม่ขึ้น อย่าเลือกทั้งชุดซ้ำ ไม่อย่างนั้นรูปที่ขึ้นแล้วจะซ้ำ · ${ACCEPTANCE_UPLOAD_KEEP_RATIONALE}`,
    ].join("\n"),
  };
}

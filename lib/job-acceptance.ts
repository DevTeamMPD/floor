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

export function devicesForKind(devices: MeasuringDevice[], kind: string | null): MeasuringDevice[] {
  const usable = selectableDevices(devices);
  if (!kind) return usable;
  const wanted = kind.trim();
  return usable.filter((device) => device.kind.trim() === wanted);
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

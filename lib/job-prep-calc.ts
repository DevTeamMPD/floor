/**
 * กฎการคำนวณ "จำนวนของที่ต้องเตรียม" จากแม่แบบ (job_prep_template_items) — P3-2
 *
 * ไฟล์นี้เป็นฟังก์ชันล้วน ๆ ไม่แตะฐานข้อมูลและไม่มี side effect
 * เพื่อให้กฎการคำนวณและกฎการปัดเศษ "ทดสอบได้โดยไม่ต้องมีฐานข้อมูล"
 *
 * ฝั่งฐานข้อมูลมีตรรกะเดียวกันอยู่ที่
 * supabase/migrations/20260902110000_job_prep_generate_from_template.sql
 * (public.job_prep_round_qty / public.generate_job_prep_items)
 * ถ้าแก้ที่ใดที่หนึ่งต้องแก้ทั้งสองที่ — มีเทสกันหลุด (drift) คุมไว้ใน lib/job-prep-calc.test.ts
 */

export type PrepCalcMode = "fixed" | "per_sqm" | "per_unit";

/** หน่วยที่ "แบ่งย่อยได้จริง" — ตัดเป็นเศษได้ จึงปัดขึ้นแค่ทศนิยม 2 ตำแหน่ง */
export const CONTINUOUS_PREP_UNITS = [
  "ม.", "ม", "เมตร", "ตร.ม.", "ตร.ม", "ตรม.", "ตรม", "ตารางเมตร",
  "ซม.", "ซม", "เซนติเมตร", "ลิตร", "ล.", "มล.", "กก.", "กก", "กิโลกรัม",
  "กรัม", "ก.", "m", "m2", "sqm", "cm", "mm", "l", "ml", "kg", "g",
] as const;

const CONTINUOUS_SET = new Set<string>(CONTINUOUS_PREP_UNITS.map((unit) => unit.toLowerCase()));

/**
 * เลขทศนิยมของ JavaScript ทำให้ 3 * 1.1 = 3.3000000000000003
 * ถ้าปัดขึ้นตรง ๆ จะได้ 4 ทั้งที่ควรได้ 4 พอดี... หรือ 3.3 → 3.31 ในโหมดทศนิยม
 * จึงต้องตัด noise ระดับ 1e-9 ทิ้งก่อนปัดขึ้นเสมอ
 * (ฝั่ง Postgres ใช้ numeric ซึ่งเป็นทศนิยมแบบ exact จึงไม่มีปัญหานี้ ผลลัพธ์จึงตรงกัน)
 */
const EPSILON = 1e-9;

/** true เมื่อหน่วยนี้แบ่งย่อยได้ (เมตร ลิตร กิโลกรัม …) — หน่วยว่างถือว่านับเป็นชิ้น */
export function isContinuousPrepUnit(unit: string | null | undefined): boolean {
  return CONTINUOUS_SET.has((unit ?? "").trim().toLowerCase());
}

/**
 * กฎการปัดเศษ: **ปัดขึ้นเสมอ ไม่ปัดลงและไม่ปัดครึ่ง**
 *
 * เหตุผล: รายการนี้คือของที่คลังต้องหยิบใส่รถให้ช่างก่อนออกหน้างาน
 * ปัดลงแปลว่าช่างไปถึงหน้างานแล้วของไม่พอ ต้องหยุดงานและวิ่งกลับคลัง
 * ซึ่งแพงกว่าการเผื่อเกินไปหนึ่งหน่วยมาก และหยิบกาว 3.7 หลอดก็ทำไม่ได้อยู่ดี
 *
 * - หน่วยที่นับเป็นชิ้น (หลอด ม้วน แผ่น ชุด ตัว …) → ปัดขึ้นเป็นจำนวนเต็ม
 * - หน่วยที่แบ่งย่อยได้ (เมตร ตร.ม. ลิตร กก. …) → ปัดขึ้นที่ทศนิยม 2 ตำแหน่ง
 *   เพราะปัด 12.03 เมตรขึ้นเป็น 13 เมตรคือการสั่งของเกินจริงโดยไม่จำเป็น
 */
export function roundPrepQty(value: number, unit: string | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (isContinuousPrepUnit(unit)) return Math.ceil(value * 100 - EPSILON) / 100;
  return Math.ceil(value - EPSILON);
}

export interface PrepTemplateItemInput {
  calcMode: PrepCalcMode;
  /** จำนวนต่อหน่วยฐานตามแม่แบบ — ต้องมากกว่า 0 (มี check constraint บังคับในฐานข้อมูลแล้ว) */
  calcQty: number;
  /** เผื่อเสียหาย 0–100 เปอร์เซ็นต์ */
  wastePct: number;
  unit: string | null;
}

export interface PrepJobBasis {
  /** พื้นที่ติดตั้งเป็นตารางเมตร — null เมื่ออ่านค่าที่ใช้คำนวณไม่ได้ */
  areaSqm: number | null;
  /** จำนวนชิ้น/ชุดที่ต้องปู (แผ่น) — null เมื่ออ่านค่าที่ใช้คำนวณไม่ได้ */
  unitCount: number | null;
}

/** เหตุผลที่คำนวณไม่ได้ — ใช้เป็นคีย์ ข้อความไทยอยู่ที่ PREP_CALC_ERRORS */
export type PrepCalcError = "missing_area" | "missing_unit_count" | "invalid_calc_qty" | "invalid_waste_pct";

export const PREP_CALC_ERRORS: Record<PrepCalcError, string> = {
  missing_area:
    "งานนี้ยังไม่มีพื้นที่ติดตั้ง (ตร.ม.) ที่ใช้คำนวณได้ จึงคำนวณรายการที่คิดต่อ ตร.ม. ไม่ได้ — ให้ฝ่ายขายกรอกพื้นที่ในข้อมูลสำรวจก่อน",
  missing_unit_count:
    "งานนี้ยังไม่มีจำนวนแผ่นที่ใช้คำนวณได้ จึงคำนวณรายการที่คิดต่อชิ้นงานไม่ได้ — ให้หัวหน้าช่างกรอกบรรทัดวัสดุปูพื้นและจำนวนก่อน",
  invalid_calc_qty: "จำนวนตามแม่แบบต้องมากกว่า 0",
  invalid_waste_pct: "เปอร์เซ็นต์เผื่อเสียหายต้องอยู่ระหว่าง 0 ถึง 100",
};

export interface PrepCalcResult {
  /** จำนวนก่อนเผื่อเสียหายและก่อนปัดเศษ */
  base: number;
  /** จำนวนหลังเผื่อเสียหาย ยังไม่ปัดเศษ */
  withWaste: number;
  /** จำนวนที่ใช้จริง — ผ่านกฎการปัดเศษแล้ว */
  qty: number;
}

/**
 * คำนวณจำนวนของหนึ่งบรรทัดในแม่แบบ
 *
 *   fixed    → calcQty
 *   per_sqm  → calcQty × พื้นที่ (ตร.ม.)
 *   per_unit → calcQty × จำนวนชิ้น/ชุด
 * แล้วคูณเผื่อเสียหาย (1 + wastePct/100) แล้วจึงปัดเศษตาม roundPrepQty
 *
 * คืน error แทนการเดาเป็น 0 เมื่อค่าตั้งต้นหาย เพราะรายการที่ทุกบรรทัดเป็น 0
 * หน้าตาเหมือน "งานนี้ไม่ต้องเตรียมอะไร" ซึ่งอันตรายกว่าการไม่สร้างรายการเลย
 */
export function computePrepQty(
  item: PrepTemplateItemInput,
  basis: PrepJobBasis,
): { ok: true; value: PrepCalcResult } | { ok: false; error: PrepCalcError } {
  if (!Number.isFinite(item.calcQty) || item.calcQty <= 0) return { ok: false, error: "invalid_calc_qty" };
  if (!Number.isFinite(item.wastePct) || item.wastePct < 0 || item.wastePct > 100) {
    return { ok: false, error: "invalid_waste_pct" };
  }

  let base: number;
  if (item.calcMode === "per_sqm") {
    const area = basis.areaSqm;
    if (area === null || !Number.isFinite(area) || area <= 0) return { ok: false, error: "missing_area" };
    base = item.calcQty * area;
  } else if (item.calcMode === "per_unit") {
    const units = basis.unitCount;
    if (units === null || !Number.isFinite(units) || units <= 0) return { ok: false, error: "missing_unit_count" };
    base = item.calcQty * units;
  } else {
    base = item.calcQty;
  }

  const withWaste = base * (1 + item.wastePct / 100);
  return { ok: true, value: { base, withWaste, qty: roundPrepQty(withWaste, item.unit) } };
}

/**
 * อ่านพื้นที่ติดตั้งเป็น ตร.ม. จากข้อมูลสำรวจ (install_jobs.survey_data เก็บ JSON ไว้ในคอลัมน์ text)
 *
 * ทำไมไม่ใช้ install_jobs.area_w × area_l:
 * ตรวจข้อมูลจริง 116 แถวแล้ว มีเพียง 2 แถวที่มีค่า และค่าที่มี (100×20, 10×20)
 * แปลว่า 2,000 และ 200 ตร.ม. ซึ่งเป็นไปไม่ได้สำหรับงานปูพื้นในบ้าน
 * ทั้งสองคอลัมน์ไม่มีโค้ดใดในแอปเขียนลงไปเลย (มีแต่ components/pipeline/board.tsx ที่อ่านไปโชว์)
 * ส่วน survey_data.areaSqm คือค่าที่ฝ่ายขายกรอกจริงและหน้าจออื่นใช้อยู่ทุกวัน
 *
 * ค่าที่กรอกมาเป็นข้อความอิสระ เช่น "32 ตรม" หรือ "ปิดขอบ" จึงอ่านเฉพาะตัวเลขที่นำหน้า
 * ถ้าไม่มีตัวเลขนำหน้าเลย ถือว่า "ไม่รู้พื้นที่" ไม่ใช่ 0
 */
export function areaSqmFromSurveyData(surveyData: unknown): number | null {
  let parsed: unknown = surveyData;
  if (typeof surveyData === "string") {
    const trimmed = surveyData.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = (parsed as Record<string, unknown>).areaSqm;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)/.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

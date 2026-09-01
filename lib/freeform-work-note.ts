/**
 * P3-5/P3-6 (แก้ตามรีวิว D2/D5) — "โน้ต Freeform จากหัวหน้าช่าง" คือกฎเดียวในระบบ
 * ว่าบรรทัดไหน "ไม่ใช่ของ" และจึงไม่ควรมีปุ่มหยิบ ปุ่มตรวจรับ หรือปุ่มปิดยอด
 *
 * ทำไมต้องมีไฟล์นี้: ก่อนหน้านี้กฎเดียวกันถูกเขียนไว้ "สามที่" และเพี้ยนจากกันแล้วจริง
 *   1) app/work/[token]/page.tsx  isFreeformWorkNote()   — ครบ 6 เงื่อนไข
 *   2) app/(admin)/orders/[jobNo]/page.tsx isFreeformNote() — ครบ 6 เงื่อนไข (คนละชนิดข้อมูล)
 *   3) lib/technician-receipt.ts isNoteOnlyLine()         — เหลือ 3 เงื่อนไข
 * ตัวที่ (3) อ้างในคอมเมนต์ว่า "เงื่อนไขเดียวกับ (1)" แต่ไม่ตรวจ sourceType, sku, itemName
 * ผลคือของจริงถูกกรองทิ้งโดยไม่ตั้งใจ: บรรทัด category = 'tool' ทุกบรรทัดที่บังเอิญ
 * planned = 0 และหน่วยเป็น "รายการ" (เช่น "ยืมเครื่องเจียร 1 ชุด" ที่ยังไม่ระบุจำนวน)
 * จะหายไปจากหน้าจอตรวจรับของช่างเงียบ ๆ
 *
 * ตั้งแต่ตอนนี้มีที่เดียว ทุกฝั่ง import จากไฟล์นี้ ถ้าจะเปลี่ยนกฎต้องเปลี่ยนที่นี่ที่เดียว
 * และเงื่อนไขต้องครบทั้ง 6 ข้อเสมอ — บรรทัดโน้ตถูกสร้างจาก emptyFreeformNote() เท่านั้น
 * จึงมีค่าเหล่านี้ครบทุกตัวทุกครั้ง การตรวจไม่ครบไม่ได้ทำให้ "หลวมกว่า" แต่ทำให้ "กว้างเกิน"
 * และไปกลืนของจริงของคนอื่น
 */

/** ชื่อบรรทัดที่หน้าจอสร้างให้อัตโนมัติ — ดู emptyFreeformNote() ใน app/(admin)/orders/[jobNo]/page.tsx */
export const FREEFORM_WORK_NOTE_ITEM_NAME = "โน้ต Freeform จากหัวหน้าช่าง";
/** หน่วยของบรรทัดโน้ต — ไม่ใช่หน่วยนับของจริง */
export const FREEFORM_WORK_NOTE_UNIT = "รายการ";
export const FREEFORM_WORK_NOTE_CATEGORY = "tool";
export const FREEFORM_WORK_NOTE_SOURCE_TYPE = "other";

/**
 * รูปร่างขั้นต่ำที่ตัดสินได้ — รับได้ทั้งชนิดที่มาจาก RPC (numeric เป็น string)
 * และชนิดที่มาจากฟอร์ม (ทุกช่องเป็น string)
 */
export interface FreeformWorkNoteShape {
  category: string | null | undefined;
  sourceType: string | null | undefined;
  sku: string | null | undefined;
  itemName: string | null | undefined;
  plannedQty: number | string | null | undefined;
  unit: string | null | undefined;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** planned ต้องเป็น "ศูนย์ที่รู้ค่าจริง" — null/ว่าง แปลว่าไม่รู้ ไม่ใช่ศูนย์ */
function isExactlyZero(value: number | string | null | undefined): boolean {
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return false;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed === 0;
  }
  return false;
}

/**
 * เงื่อนไขครบทั้ง 6 ข้อ ตรงกับ isFreeformWorkNote() ตัวเดิมของ app/work/[token]/page.tsx
 * ทุกข้อ ไม่มีข้อไหนถูกตัดออก
 */
export function isFreeformWorkNote(line: FreeformWorkNoteShape): boolean {
  return text(line.category) === FREEFORM_WORK_NOTE_CATEGORY
    && text(line.sourceType) === FREEFORM_WORK_NOTE_SOURCE_TYPE
    && text(line.sku) === ""
    && isExactlyZero(line.plannedQty)
    && text(line.unit) === FREEFORM_WORK_NOTE_UNIT
    && text(line.itemName) === FREEFORM_WORK_NOTE_ITEM_NAME;
}

/** ตรงข้ามกับ isFreeformWorkNote — ใช้กับ Array.prototype.filter ให้อ่านง่าย */
export function excludeFreeformWorkNotes<T extends FreeformWorkNoteShape>(lines: readonly T[]): T[] {
  return lines.filter((line) => !isFreeformWorkNote(line));
}

import { describe, expect, it } from "vitest";
import {
  FREEFORM_WORK_NOTE_ITEM_NAME,
  excludeFreeformWorkNotes,
  isFreeformWorkNote,
  type FreeformWorkNoteShape,
} from "@/lib/freeform-work-note";

/** ค่าของบรรทัดโน้ตจริง — ตรงกับ 3 แถวที่มีอยู่ใน floor_work_order_items วันนี้ */
function note(overrides: Partial<FreeformWorkNoteShape> = {}): FreeformWorkNoteShape {
  return {
    category: "tool", sourceType: "other", sku: null,
    itemName: FREEFORM_WORK_NOTE_ITEM_NAME, plannedQty: 0, unit: "รายการ",
    ...overrides,
  };
}

describe("isFreeformWorkNote — กฎเดียวของทั้งระบบว่าบรรทัดไหนไม่ใช่ของ", () => {
  it("บรรทัดโน้ตจริงต้องถูกระบุได้ ทั้งจาก RPC (numeric เป็น string) และจากฟอร์ม (ทุกช่องเป็น string)", () => {
    expect(isFreeformWorkNote(note())).toBe(true);
    expect(isFreeformWorkNote(note({ plannedQty: "0.00" }))).toBe(true);
    expect(isFreeformWorkNote(note({ sku: "", plannedQty: "0" }))).toBe(true);
  });

  it("เครื่องมือจริงที่บังเอิญ planned = 0 และหน่วยเป็น 'รายการ' ต้องไม่ใช่โน้ต (รีวิว D2)", () => {
    // นี่คือของจริงที่เงื่อนไขเก่า (ตรวจแค่ category + plannedQty + unit) กรองทิ้งผิด
    expect(isFreeformWorkNote(note({ itemName: "ยืมเครื่องเจียร 1 ชุด" }))).toBe(false);
    expect(isFreeformWorkNote(note({ itemName: "ยืมเครื่องเจียร", sku: "TOOL-01" }))).toBe(false);
  });

  it("ครบทั้ง 6 ข้อเท่านั้นถึงเป็นโน้ต ต่างข้อเดียวก็ไม่ใช่", () => {
    expect(isFreeformWorkNote(note({ category: "consumable" }))).toBe(false);
    expect(isFreeformWorkNote(note({ sourceType: "new" }))).toBe(false);
    expect(isFreeformWorkNote(note({ sku: "SKU-1" }))).toBe(false);
    expect(isFreeformWorkNote(note({ plannedQty: 1 }))).toBe(false);
    expect(isFreeformWorkNote(note({ unit: "ชิ้น" }))).toBe(false);
    expect(isFreeformWorkNote(note({ itemName: "อย่างอื่น" }))).toBe(false);
  });

  it("ค่าที่หายหรือไม่รู้ค่าต้องไม่ถูกเดาว่าเป็นโน้ต — null ไม่ใช่ศูนย์", () => {
    expect(isFreeformWorkNote(note({ plannedQty: null }))).toBe(false);
    expect(isFreeformWorkNote(note({ plannedQty: "" }))).toBe(false);
    expect(isFreeformWorkNote(note({ plannedQty: "ไม่ใช่ตัวเลข" }))).toBe(false);
    expect(isFreeformWorkNote(note({ sourceType: null }))).toBe(false);
    expect(isFreeformWorkNote(note({ sourceType: undefined }))).toBe(false);
  });

  it("ตัดช่องว่างหัวท้ายก่อนเทียบ เพราะข้อมูลจากฟอร์มมีช่องว่างติดมาได้", () => {
    expect(isFreeformWorkNote(note({ itemName: `  ${FREEFORM_WORK_NOTE_ITEM_NAME}  `, unit: " รายการ " }))).toBe(true);
    expect(isFreeformWorkNote(note({ sku: "   " }))).toBe(true);
  });

  it("excludeFreeformWorkNotes เก็บของจริงไว้ครบและคงลำดับเดิม", () => {
    const tool = note({ itemName: "ยืมเครื่องเจียร" });
    const goods = note({ category: "floor_material", sourceType: "new", sku: "SKU-1", itemName: "กระเบื้อง", plannedQty: 10, unit: "แผ่น" });
    expect(excludeFreeformWorkNotes([goods, note(), tool])).toEqual([goods, tool]);
  });
});

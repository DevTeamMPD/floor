import { describe, expect, it } from "vitest";
import {
  FALLBACK_RECEIPT_REASONS,
  RECEIPT_STATUS_LABELS,
  confirmableLines,
  isNoteOnlyLine,
  needsFreeText,
  needsReason,
  parseReasonOptions,
  parseReceiptPayload,
  reasonLabel,
  receiptFormError,
  resolveReceivedQty,
  summariseReceipts,
  warehouseSaidLabel,
  willOpenNcr,
  type TechnicianReceiptLine,
} from "@/lib/technician-receipt";

function line(overrides: Partial<TechnicianReceiptLine> = {}): TechnicianReceiptLine {
  return {
    itemId: "item-1", category: "floor_material", itemName: "กระเบื้องยาง", sku: "SKU-1",
    sourceType: "new", specification: null, unit: "แผ่น", note: null,
    plannedQty: 10, actualQty: null, pickedQty: 10, pickStatus: "picked_full",
    pickNote: null, expectedQty: 10, receipt: null,
    ...overrides,
  };
}

describe("resolveReceivedQty — คณิตศาสตร์การรับของหน้างาน", () => {
  it("ได้ครบ = เท่ากับที่คลังจ่ายมา และไม่ขาด", () => {
    expect(resolveReceivedQty("received_full", "", 10)).toEqual({ ok: true, qty: 10, shortage: 0 });
  });

  it("ไม่ได้รับเลย = 0 และขาดเท่ากับทั้งหมดที่คลังจ่าย", () => {
    expect(resolveReceivedQty("not_received", "", 10)).toEqual({ ok: true, qty: 0, shortage: 10 });
  });

  it("ได้ไม่ครบคิดส่วนที่ขาดจากที่คลังจ่ายมา ไม่ใช่จากแผน", () => {
    expect(resolveReceivedQty("received_partial", "7", 10)).toEqual({ ok: true, qty: 7, shortage: 3 });
    // คลังหยิบได้แค่ 2 จากแผน 4 -> ช่างได้ 1 ขาด 1 (ไม่ใช่ขาด 3)
    expect(resolveReceivedQty("received_partial", "1", 2)).toEqual({ ok: true, qty: 1, shortage: 1 });
  });

  it("ทศนิยมไม่ทิ้งเศษลอย", () => {
    expect(resolveReceivedQty("received_partial", "0.1", 0.3)).toEqual({ ok: true, qty: 0.1, shortage: 0.2 });
  });

  it("ค่าที่ขอบบอกให้กดปุ่มที่ถูกต้องแทน", () => {
    const atExpected = resolveReceivedQty("received_partial", "10", 10);
    expect(atExpected.ok).toBe(false);
    if (!atExpected.ok) expect(atExpected.error).toContain(RECEIPT_STATUS_LABELS.received_full);

    const zero = resolveReceivedQty("received_partial", "0", 10);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toContain(RECEIPT_STATUS_LABELS.not_received);
  });

  it("ค่าติดลบ ค่าว่าง และค่าที่ไม่ใช่ตัวเลข ต้องไม่ผ่าน", () => {
    expect(resolveReceivedQty("received_partial", "-2", 10).ok).toBe(false);
    expect(resolveReceivedQty("received_partial", "", 10).ok).toBe(false);
    expect(resolveReceivedQty("received_partial", "สาม", 10).ok).toBe(false);
  });

  it("คลังแจ้งว่าไม่มีของ (expected = 0) ได้ไม่ครบไม่มีความหมาย", () => {
    expect(resolveReceivedQty("received_partial", "1", 0).ok).toBe(false);
    expect(resolveReceivedQty("not_received", "", 0)).toEqual({ ok: true, qty: 0, shortage: 0 });
  });
});

describe("เหตุผลบังคับ และการเปิด NC", () => {
  it("ได้ครบไม่ต้องมีเหตุผลและไม่เปิด NC", () => {
    expect(needsReason("received_full")).toBe(false);
    expect(willOpenNcr("received_full")).toBe(false);
  });

  it("ได้ไม่ครบและไม่ได้รับ ต้องมีเหตุผล และเปิด NC ทั้งคู่", () => {
    expect(needsReason("received_partial")).toBe(true);
    expect(needsReason("not_received")).toBe(true);
    expect(willOpenNcr("received_partial")).toBe(true);
    expect(willOpenNcr("not_received")).toBe(true);
  });

  it("เหตุผล 'อื่น ๆ' เท่านั้นที่บังคับพิมพ์อธิบาย", () => {
    expect(needsFreeText("other")).toBe(true);
    expect(needsFreeText("stock_short")).toBe(false);
    expect(needsFreeText(null)).toBe(false);
  });
});

describe("receiptFormError — ด่านหน้าก่อนยิง RPC", () => {
  const base = { rawQty: "", reasonCode: null as string | null, reasonNote: "", expectedQty: 10 };

  it("ได้ครบผ่านโดยไม่ต้องมีเหตุผล", () => {
    expect(receiptFormError({ ...base, status: "received_full" })).toBeNull();
  });

  it("ได้ไม่ครบแต่ยังไม่เลือกเหตุผล ต้องถูกกั้น", () => {
    expect(receiptFormError({ ...base, status: "received_partial", rawQty: "5" }))
      .toBe("เลือกเหตุผลว่าทำไมของไม่ครบ");
  });

  it("เลือก 'อื่น ๆ' แต่ไม่พิมพ์อะไร ต้องถูกกั้น", () => {
    expect(receiptFormError({ ...base, status: "not_received", reasonCode: "other", reasonNote: "  " }))
      .toContain("ต้องพิมพ์อธิบาย");
  });

  it("ตัวเลขผิดถูกรายงานก่อนเรื่องเหตุผล เพราะเป็นสิ่งที่คนเพิ่งพิมพ์", () => {
    expect(receiptFormError({ ...base, status: "received_partial", rawQty: "20" }))
      .toContain("ไม่น้อยกว่าที่คลังจ่ายมา");
  });

  it("ครบทุกอย่างแล้วผ่าน", () => {
    expect(receiptFormError({ ...base, status: "received_partial", rawQty: "4", reasonCode: "not_loaded" })).toBeNull();
    expect(receiptFormError({ ...base, status: "not_received", reasonCode: "other", reasonNote: "รถเสียกลางทาง" })).toBeNull();
  });
});

describe("parseReasonOptions — รายการเหตุผลมาจากเซิร์ฟเวอร์เป็นหลัก", () => {
  it("ใช้รายการจากเซิร์ฟเวอร์เมื่ออ่านได้ รวมถึงเหตุผลใหม่ที่โค้ดฝั่งนี้ยังไม่รู้จัก", () => {
    const options = parseReasonOptions([
      { code: "stock_short", label: "ของไม่พอในคลัง", ncrType: "missing" },
      { code: "brand_new_reason", label: "เหตุผลใหม่จากเซิร์ฟเวอร์", ncrType: "other" },
    ]);
    expect(options).toHaveLength(2);
    expect(options[1].code).toBe("brand_new_reason");
  });

  it("อ่านไม่ได้จึงถอยไปชุดสำรอง เพื่อไม่ให้เหลือหน้าจอที่กดไม่ได้กลางหน้างาน", () => {
    expect(parseReasonOptions(null)).toEqual(FALLBACK_RECEIPT_REASONS);
    expect(parseReasonOptions([])).toEqual(FALLBACK_RECEIPT_REASONS);
    expect(parseReasonOptions([{ nope: 1 }, null, "x"])).toEqual(FALLBACK_RECEIPT_REASONS);
  });

  it("ชุดสำรองครบทุกเหตุผลที่คนหน้างานพูดจริง และจับคู่ type ที่ ncr_reports อนุญาต", () => {
    const allowed = new Set(["quality", "damage", "missing", "wrong", "other"]);
    expect(FALLBACK_RECEIPT_REASONS.map((option) => option.code)).toEqual([
      "stock_short", "not_loaded", "lost_on_route", "damaged", "wrong_item", "other",
    ]);
    for (const option of FALLBACK_RECEIPT_REASONS) expect(allowed.has(option.ncrType)).toBe(true);
    expect(FALLBACK_RECEIPT_REASONS.find((o) => o.code === "damaged")?.ncrType).toBe("damage");
    expect(FALLBACK_RECEIPT_REASONS.find((o) => o.code === "wrong_item")?.ncrType).toBe("wrong");
    expect(FALLBACK_RECEIPT_REASONS.find((o) => o.code === "not_loaded")?.ncrType).toBe("missing");
  });

  it("reasonLabel คืนป้ายไทย และไม่พังกับรหัสที่ไม่รู้จัก", () => {
    expect(reasonLabel(FALLBACK_RECEIPT_REASONS, "not_loaded")).toBe("ลืมโหลดขึ้นรถ");
    expect(reasonLabel(FALLBACK_RECEIPT_REASONS, "zzz")).toBe("zzz");
    expect(reasonLabel(FALLBACK_RECEIPT_REASONS, null)).toBe("—");
  });
});

describe("parseReceiptPayload", () => {
  it("แกะ payload ปกติได้ครบ", () => {
    const payload = parseReceiptPayload({
      found: true, canConfirm: true, jobNo: "ORD-1", workOrderStatus: "ready_to_install",
      reasonOptions: [{ code: "damaged", label: "ของเสียหาย", ncrType: "damage" }],
      lines: [{ itemId: "i1", itemName: "กระเบื้อง", unit: "แผ่น", plannedQty: 10, expectedQty: 8, pickStatus: "picked_partial" }],
    });
    expect(payload.found).toBe(true);
    expect(payload.canConfirm).toBe(true);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].expectedQty).toBe(8);
    expect(payload.reasonOptions[0].code).toBe("damaged");
  });

  it("payload พังหรือว่าง ต้องไม่ทำให้หน้าช่างพัง และต้องบอกว่ายืนยันไม่ได้", () => {
    for (const bad of [null, undefined, "x", 3, []]) {
      const payload = parseReceiptPayload(bad);
      expect(payload.found).toBe(false);
      expect(payload.canConfirm).toBe(false);
      expect(payload.lines).toEqual([]);
      expect(payload.reasonOptions.length).toBeGreaterThan(0);
    }
  });

  it("บรรทัดที่ไม่มี itemId ถูกทิ้ง ไม่ใช่ทำให้ทั้งใบพัง", () => {
    const payload = parseReceiptPayload({ found: true, canConfirm: true, lines: [{ itemName: "ไม่มี id" }, { itemId: "ok", itemName: "ดี", unit: "แผ่น" }] });
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].itemId).toBe("ok");
  });
});

describe("บรรทัดโน้ตของหัวหน้าช่างไม่ใช่ของที่ต้องตรวจรับ", () => {
  /** บรรทัดโน้ตจริง — ค่าทุกช่องตรงกับที่ emptyFreeformNote() สร้าง และตรงกับ 3 แถวในโปรดักชัน */
  const realNote = () => line({
    itemId: "note", category: "tool", sourceType: "other", sku: null,
    itemName: "โน้ต Freeform จากหัวหน้าช่าง", plannedQty: 0, unit: "รายการ",
  });

  it("ระบุบรรทัดโน้ตด้วยเงื่อนไขเดียวกับหน้าช่างเดิม ครบทั้ง 6 ข้อ", () => {
    expect(isNoteOnlyLine(realNote())).toBe(true);
    expect(isNoteOnlyLine(line())).toBe(false);
    expect(confirmableLines([realNote(), line()])).toHaveLength(1);
  });

  it("เครื่องมือจริงที่ planned = 0 และหน่วยเป็น 'รายการ' ต้องไม่ถูกกรองทิ้ง (รีวิว D2)", () => {
    // เงื่อนไขเก่าตรวจแค่ category + plannedQty + unit บรรทัดนี้จึงเข้าเงื่อนไขครบทั้งสามข้อ
    // และถูกกรองหายไปจากหน้าจอช่างโดยไม่มีใครรู้ ทั้งที่เป็นเครื่องมือจริงที่ต้องตรวจรับ
    const realTool = line({
      itemId: "tool-1", category: "tool", sourceType: "other", sku: null,
      itemName: "ยืมเครื่องเจียร 1 ชุด", plannedQty: 0, unit: "รายการ",
    });
    expect(isNoteOnlyLine(realTool)).toBe(false);
    expect(confirmableLines([realTool, realNote()]).map((row) => row.itemId)).toEqual(["tool-1"]);
  });

  it("ต่างจากบรรทัดโน้ตแค่ข้อเดียวก็ไม่ใช่โน้ตแล้ว — ทั้ง 6 ข้อต้องตรงพร้อมกัน", () => {
    expect(isNoteOnlyLine({ ...realNote(), sourceType: "new" })).toBe(false);
    expect(isNoteOnlyLine({ ...realNote(), sku: "SKU-9" })).toBe(false);
    expect(isNoteOnlyLine({ ...realNote(), itemName: "เครื่องมือช่าง" })).toBe(false);
    expect(isNoteOnlyLine({ ...realNote(), category: "consumable" })).toBe(false);
    expect(isNoteOnlyLine({ ...realNote(), plannedQty: 2 })).toBe(false);
    expect(isNoteOnlyLine({ ...realNote(), unit: "ชิ้น" })).toBe(false);
  });

  it("plannedQty ที่ไม่รู้ค่า (null) ไม่ใช่ศูนย์ จึงไม่ใช่บรรทัดโน้ต", () => {
    expect(isNoteOnlyLine({ ...realNote(), plannedQty: null })).toBe(false);
    expect(isNoteOnlyLine({ ...realNote(), plannedQty: "0" })).toBe(true);
  });
});

describe("summariseReceipts", () => {
  it("นับเฉพาะบรรทัดที่ต้องตรวจรับจริง และนับ NC ที่เปิดไปแล้ว", () => {
    const progress = summariseReceipts([
      line({ itemId: "a", receipt: { status: "received_full", receivedQty: 10, expectedQty: 10, shortageQty: 0, reasonCode: null, reasonNote: null, ncrId: null, technicianName: "ช่าง", confirmedAt: "x" } }),
      line({ itemId: "b", receipt: { status: "received_partial", receivedQty: 4, expectedQty: 6, shortageQty: 2, reasonCode: "not_loaded", reasonNote: null, ncrId: "ncr-1", technicianName: "ช่าง", confirmedAt: "x" } }),
      line({ itemId: "c", receipt: null }),
      // บรรทัดโน้ตจริงต้องครบทั้ง 6 เงื่อนไข ไม่ใช่แค่ category + plannedQty + unit (รีวิว D2)
      line({ itemId: "d", category: "tool", sourceType: "other", sku: null, itemName: "โน้ต Freeform จากหัวหน้าช่าง", plannedQty: 0, unit: "รายการ", receipt: null }),
    ]);
    expect(progress).toEqual({ total: 3, confirmed: 2, pending: 1, shortLines: 1, ncrCount: 1, allConfirmed: false });
  });

  it("ยืนยันครบทุกบรรทัดแล้วถึงจะบอกว่าครบ", () => {
    const done = summariseReceipts([
      line({ itemId: "a", receipt: { status: "received_full", receivedQty: 10, expectedQty: 10, shortageQty: 0, reasonCode: null, reasonNote: null, ncrId: null, technicianName: "ช่าง", confirmedAt: "x" } }),
    ]);
    expect(done.allConfirmed).toBe(true);
    expect(summariseReceipts([]).allConfirmed).toBe(false);
  });
});

describe("warehouseSaidLabel — ช่างต้องเห็นว่าคลังบอกอะไรไว้ก่อนตอบ", () => {
  it("แยกสามกรณีของคลัง และกรณีที่คลังไม่ได้บันทึกรายบรรทัด", () => {
    expect(warehouseSaidLabel(line({ pickStatus: "picked_full", expectedQty: 10 }))).toBe("คลังหยิบครบ 10 แผ่น");
    expect(warehouseSaidLabel(line({ pickStatus: "picked_partial", expectedQty: 2, plannedQty: 4, pickNote: "คลังเหลือ 2" })))
      .toBe("คลังหยิบได้ 2 แผ่น จากแผน 4 แผ่น · คลังเหลือ 2");
    expect(warehouseSaidLabel(line({ pickStatus: "unavailable", expectedQty: 0, pickNote: "ของหมด" })))
      .toBe("คลังแจ้งว่าไม่มีของ · ของหมด");
    expect(warehouseSaidLabel(line({ pickStatus: null, pickedQty: null, expectedQty: 10 })))
      .toContain("คลังไม่ได้บันทึกรายบรรทัด");
  });
});

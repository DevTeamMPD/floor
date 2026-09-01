import { describe, expect, it } from "vitest";
import {
  allowsUsedQty,
  closableLines,
  isClosed,
  isOutstandingTool,
  issuedLabel,
  parseUsagePayload,
  qtyText,
  resolveUsage,
  summariseUsage,
  unaccountedQty,
  usageSummaryLabel,
  type UsageLine,
} from "./job-usage";

function line(overrides: Partial<UsageLine> = {}): UsageLine {
  return {
    itemId: "item-1", category: "consumable", itemKind: "consumable", itemName: "กาว",
    sku: "SKU-1", specification: null, unit: "หลอด", note: null,
    plannedQty: 10, actualQty: null, pickedQty: 6, pickStatus: "picked_partial",
    expectedQty: 6, usedQty: null, returnedQty: null,
    usageNote: null, usageRecordedAt: null, usageRecordedByName: null,
    ...overrides,
  };
}

describe("parseUsagePayload", () => {
  it("อ่าน payload ปกติได้ครบ", () => {
    const parsed = parseUsagePayload({
      found: true, workOrderId: "wo-1", workOrderStatus: "installing", jobNo: "J-1",
      canRecord: true, returnOnly: false,
      lines: [{ itemId: "i1", itemName: "กาว", unit: "หลอด", itemKind: "consumable", expectedQty: "6.00", usedQty: "2.5" }],
    });
    expect(parsed.found).toBe(true);
    expect(parsed.canRecord).toBe(true);
    expect(parsed.returnOnly).toBe(false);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].itemKind).toBe("consumable");
  });

  it("payload ที่พังต้องไม่ทำให้หน้าจอพัง และต้องไม่เปิดให้เขียน", () => {
    for (const bad of [null, undefined, 42, "ข้อความ", []]) {
      const parsed = parseUsagePayload(bad);
      expect(parsed.found).toBe(false);
      expect(parsed.canRecord).toBe(false);
      expect(parsed.lines).toEqual([]);
    }
  });

  it("ทิ้งบรรทัดที่ไม่มี itemId และแทนค่าที่หายด้วยค่าที่ปลอดภัย", () => {
    const parsed = parseUsagePayload({ found: true, lines: [{ foo: 1 }, { itemId: "i1" }] });
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].itemName).toBe("ไม่ระบุชื่อ");
    expect(parsed.lines[0].unit).toBe("หน่วย");
    expect(parsed.lines[0].itemKind).toBeNull();
  });

  it("itemKind ที่ไม่รู้จักต้องกลายเป็น null ไม่ใช่ผ่านไปทั้งดิบ", () => {
    const parsed = parseUsagePayload({ found: true, lines: [{ itemId: "i1", itemKind: "vehicle" }] });
    expect(parsed.lines[0].itemKind).toBeNull();
  });
});

describe("closableLines", () => {
  it("ตัดโน้ต Freeform ของหัวหน้าช่างออก (กฎเดียวกับ isNoteOnlyLine)", () => {
    const note = line({ itemId: "note", category: "tool", plannedQty: 0, unit: "รายการ", expectedQty: 0 });
    expect(closableLines([line(), note])).toHaveLength(1);
  });

  it("ตัดบรรทัดที่ยังไม่มีของออกจากคลัง", () => {
    expect(closableLines([line({ expectedQty: 0 }), line({ itemId: "b", expectedQty: null })])).toHaveLength(0);
  });
});

describe("resolveUsage", () => {
  const base = { expectedQty: 6, returnOnly: false };

  it("ไม่กรอกอะไรเลยต้องถูกปฏิเสธ", () => {
    const result = resolveUsage({ ...base, usedRaw: "  ", returnedRaw: "", line: line() });
    expect(result).toEqual({ ok: false, error: "กรอกอย่างน้อยหนึ่งช่อง: ใช้ไปเท่าไหร่ หรือคืนเท่าไหร่" });
  });

  it("ใช้ + คืน เกินที่เบิก ต้องถูกปฏิเสธพร้อมตัวเลขทั้งสองฝั่ง", () => {
    const result = resolveUsage({ ...base, usedRaw: "4", returnedRaw: "3", line: line() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("7");
      expect(result.error).toContain("6");
      expect(result.error).toContain("ไม่เกินของที่เบิกออกไป");
    }
  });

  it("พอดีเป๊ะต้องผ่าน และของค้างเป็น 0", () => {
    const result = resolveUsage({ ...base, usedRaw: "4", returnedRaw: "2", line: line() });
    expect(result).toEqual({ ok: true, used: 4, returned: 2, unaccounted: 0 });
  });

  it("ช่องว่าง = ไม่แตะค่าเดิม ไม่ใช่ตั้งเป็นศูนย์", () => {
    const result = resolveUsage({ ...base, usedRaw: "", returnedRaw: "1", line: line({ usedQty: 4 }) });
    expect(result).toEqual({ ok: true, used: null, returned: 1, unaccounted: 1 });
  });

  it("ติดลบถูกปฏิเสธทั้งสองช่อง", () => {
    expect(resolveUsage({ ...base, usedRaw: "-1", returnedRaw: "", line: line() })).toEqual({ ok: false, error: "จำนวนที่ใช้ต้องไม่ติดลบ" });
    expect(resolveUsage({ ...base, usedRaw: "", returnedRaw: "-2", line: line() })).toEqual({ ok: false, error: "จำนวนที่คืนต้องไม่ติดลบ" });
  });

  it("ตัวเลขที่ไม่ใช่ตัวเลขถูกปฏิเสธ", () => {
    expect(resolveUsage({ ...base, usedRaw: "สอง", returnedRaw: "", line: line() })).toEqual({ ok: false, error: "จำนวนที่ใช้ต้องเป็นตัวเลข" });
  });

  it("เครื่องมือกรอก 'ใช้ไป' ไม่ได้ (กติกาเดียวกับ trigger ฝั่งตาราง)", () => {
    const tool = line({ itemKind: "tool", itemName: "เครื่องเจียร", unit: "เครื่อง", expectedQty: 2, pickedQty: 2 });
    const result = resolveUsage({ expectedQty: 2, returnOnly: false, usedRaw: "1", returnedRaw: "", line: tool });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("เครื่องมือที่ต้องคืน");
  });

  it("เครื่องมือคืนของได้ตามปกติ", () => {
    const tool = line({ itemKind: "tool", unit: "เครื่อง", expectedQty: 2, pickedQty: 2 });
    expect(resolveUsage({ expectedQty: 2, returnOnly: false, usedRaw: "", returnedRaw: "2", line: tool }))
      .toEqual({ ok: true, used: null, returned: 2, unaccounted: 0 });
  });

  it("งานปิดแล้ว: คืนของได้ แต่แก้ยอดใช้ไม่ได้", () => {
    const closed = line({ usedQty: 3, returnedQty: 1 });
    expect(resolveUsage({ expectedQty: 6, returnOnly: true, usedRaw: "", returnedRaw: "2", line: closed }).ok).toBe(true);
    const blocked = resolveUsage({ expectedQty: 6, returnOnly: true, usedRaw: "2", returnedRaw: "", line: closed });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("งานนี้ปิดไปแล้ว");
  });

  it("ส่งยอดใช้เท่าเดิมตอนงานปิดแล้ว ไม่ถือว่าเป็นการแก้", () => {
    const closed = line({ usedQty: 3, returnedQty: 0 });
    expect(resolveUsage({ expectedQty: 6, returnOnly: true, usedRaw: "3", returnedRaw: "1", line: closed }).ok).toBe(true);
  });

  it("ทศนิยมไม่เพี้ยน", () => {
    const result = resolveUsage({ expectedQty: 2.5, returnOnly: false, usedRaw: "1.1", returnedRaw: "1.2", line: line({ expectedQty: 2.5 }) });
    expect(result).toEqual({ ok: true, used: 1.1, returned: 1.2, unaccounted: 0.2 });
  });
});

describe("unaccountedQty", () => {
  it("ของที่ไม่ได้ใช้และไม่ได้คืนต้องเป็นตัวเลขที่มองเห็น", () => {
    expect(unaccountedQty(6, 3, 1)).toBe(2);
  });
  it("ไม่รู้ว่าเบิกเท่าไหร่ ต้องเป็น null ไม่ใช่ 0", () => {
    expect(unaccountedQty(null, 3, 1)).toBeNull();
  });
  it("ยังไม่บันทึกอะไรเลย = ค้างทั้งหมด", () => {
    expect(unaccountedQty(6, null, null)).toBe(6);
  });
});

describe("สรุปความคืบหน้าและสถานะบรรทัด", () => {
  it("นับบรรทัดที่ปิดยอดแล้ว เครื่องมือที่ยังไม่คืน และของที่หายไป", () => {
    const rows = [
      line({ itemId: "a", usedQty: 3, returnedQty: 1 }),
      line({ itemId: "b" }),
      line({ itemId: "c", itemKind: "tool", unit: "เครื่อง", pickedQty: 2, expectedQty: 2, returnedQty: 1 }),
    ];
    // a: เบิก 6 ใช้ 3 คืน 1 -> ค้าง 2 · c: เครื่องมือเบิก 2 คืน 1 -> ค้าง 1 · b: ยังไม่ปิดยอดจึงไม่นับ
    expect(summariseUsage(rows)).toEqual({ total: 3, closed: 2, pending: 1, outstandingTools: 1, unaccountedLines: 2 });
  });

  it("เครื่องมือที่คืนครบไม่ค้าง", () => {
    expect(isOutstandingTool(line({ itemKind: "tool", pickedQty: 2, returnedQty: 2 }))).toBe(false);
    expect(isOutstandingTool(line({ itemKind: "tool", pickedQty: 2, returnedQty: 1 }))).toBe(true);
    expect(isOutstandingTool(line({ itemKind: "consumable", pickedQty: 2, returnedQty: 0 }))).toBe(false);
    expect(isOutstandingTool(line({ itemKind: "tool", pickedQty: 0 }))).toBe(false);
  });

  it("ปิดยอดแล้วนับจากการมีค่าใดค่าหนึ่ง ไม่ใช่ทั้งคู่", () => {
    expect(isClosed(line())).toBe(false);
    expect(isClosed(line({ returnedQty: 0 }))).toBe(true);
    expect(isClosed(line({ usedQty: 0 }))).toBe(true);
  });

  it("เครื่องมือไม่มีช่อง 'ใช้ไป'", () => {
    expect(allowsUsedQty(line({ itemKind: "tool" }))).toBe(false);
    expect(allowsUsedQty(line({ itemKind: null }))).toBe(true);
  });

  it("ป้ายสรุปของเครื่องมือไม่พูดถึงยอดใช้", () => {
    const label = usageSummaryLabel(line({ itemKind: "tool", unit: "เครื่อง", expectedQty: 2, returnedQty: 1 }));
    expect(label).not.toContain("ใช้");
    expect(label).toContain("คืน 1");
    expect(label).toContain("ยังไม่กลับ 1");
  });

  it("ป้ายบอกสิ่งที่คลังจ่ายมาตามสถานะการหยิบ", () => {
    expect(issuedLabel(line({ pickStatus: "picked_full", expectedQty: 6 }))).toBe("คลังจ่ายมา 6 หลอด");
    expect(issuedLabel(line({ pickStatus: "picked_partial", expectedQty: 6, plannedQty: 10 }))).toContain("แผน 10");
    expect(issuedLabel(line({ pickStatus: null, expectedQty: 6 }))).toContain("ตามใบสั่งงาน");
  });

  it("qtyText ตัดทศนิยมยาวและบอก — เมื่อไม่รู้ค่า", () => {
    expect(qtyText(null)).toBe("—");
    expect(qtyText(1 / 3)).toBe("0.3333");
  });
});

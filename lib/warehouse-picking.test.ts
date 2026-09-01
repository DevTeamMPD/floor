import { describe, expect, it } from "vitest";
import {
  PICK_STATUS_LABELS,
  isPickStatus,
  isWarehouseNoteOnlyLine,
  pickNoteError,
  pickableLines,
  prefillActualQtyFromPicks,
  resolvePickedQty,
  stockBesideLineLabel,
  summarisePickProgress,
  toWarehousePickLines,
  type WarehousePickLine,
} from "@/lib/warehouse-picking";
import { calculateJobStockShortage } from "@/lib/stock-shortage";

function line(overrides: Partial<WarehousePickLine> = {}): WarehousePickLine {
  return {
    item_id: "item-1", prep_source: "work_order_item", category: "floor_material",
    item_name: "กระเบื้องยาง", line_sku: "SKU-1", specification: null, note: null,
    unit: "แผ่น", sort_order: 0, planned_qty: 10, actual_qty: null, picked_qty: null,
    pick_status: null, pick_note: null, picked_at: null, picked_by_name: null, source_type: "new",
    stock_key: "SKU-1", stock_source: "warehouse", registry_qty: null, warehouse_qty: 40,
    available_qty: 40, warehouse_name: "Samaedam_FG", snapshot_date: "2026-09-01",
    ...overrides,
  };
}

describe("resolvePickedQty — คณิตศาสตร์การหยิบรายบรรทัด", () => {
  it("หยิบครบใช้จำนวนตามแผน และเมินตัวเลขที่คนพิมพ์มา (กติกาเดียวกับฝั่ง SQL)", () => {
    expect(resolvePickedQty("picked_full", "999", 10)).toEqual({ ok: true, qty: 10 });
    expect(resolvePickedQty("picked_full", "", 6.5)).toEqual({ ok: true, qty: 6.5 });
  });

  it("ไม่มีของเป็น 0 เสมอ ไม่ว่าจะพิมพ์อะไรมา", () => {
    expect(resolvePickedQty("unavailable", "3", 10)).toEqual({ ok: true, qty: 0 });
  });

  it("หยิบได้บางส่วนรับเฉพาะค่าที่อยู่ระหว่าง 0 กับจำนวนตามแผน", () => {
    expect(resolvePickedQty("picked_partial", "2.5", 6)).toEqual({ ok: true, qty: 2.5 });
    expect(resolvePickedQty("picked_partial", " 4 ", 6)).toEqual({ ok: true, qty: 4 });
  });

  it("ค่าที่ขอบบอกให้กดปุ่มที่ถูกต้องแทน ไม่ใช่แค่บอกว่าผิด", () => {
    const atPlanned = resolvePickedQty("picked_partial", "6", 6);
    expect(atPlanned.ok).toBe(false);
    if (!atPlanned.ok) expect(atPlanned.error).toContain(PICK_STATUS_LABELS.picked_full);

    const zero = resolvePickedQty("picked_partial", "0", 6);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toContain(PICK_STATUS_LABELS.unavailable);

    const over = resolvePickedQty("picked_partial", "9", 6);
    expect(over.ok).toBe(false);
  });

  it("ค่าติดลบ ค่าว่าง และค่าที่ไม่ใช่ตัวเลข ต้องไม่ผ่าน", () => {
    expect(resolvePickedQty("picked_partial", "-1", 6).ok).toBe(false);
    expect(resolvePickedQty("picked_partial", "", 6).ok).toBe(false);
    expect(resolvePickedQty("picked_partial", "   ", 6).ok).toBe(false);
    expect(resolvePickedQty("picked_partial", "abc", 6).ok).toBe(false);
    expect(resolvePickedQty("picked_partial", "NaN", 6).ok).toBe(false);
  });

  it("บรรทัดที่แผนเป็น 0 หยิบบางส่วนไม่ได้เลย แต่หยิบครบได้ (ได้ 0)", () => {
    expect(resolvePickedQty("picked_full", "", 0)).toEqual({ ok: true, qty: 0 });
    expect(resolvePickedQty("picked_partial", "1", 0).ok).toBe(false);
  });

  it("planned เป็น null ถือเป็น 0 ไม่ระเบิด", () => {
    expect(resolvePickedQty("picked_full", "", null)).toEqual({ ok: true, qty: 0 });
  });
});

describe("pickNoteError — ไม่มีของต้องบอกเหตุผล", () => {
  it("บังคับเฉพาะ unavailable", () => {
    expect(pickNoteError("unavailable", "")).not.toBeNull();
    expect(pickNoteError("unavailable", "   ")).not.toBeNull();
    expect(pickNoteError("unavailable", "ของหมด")).toBeNull();
    expect(pickNoteError("picked_full", "")).toBeNull();
    expect(pickNoteError("picked_partial", "")).toBeNull();
  });
});

describe("isPickStatus", () => {
  it("รับเฉพาะสามค่าที่ constraint ฝั่งฐานข้อมูลอนุญาต", () => {
    expect(isPickStatus("picked_full")).toBe(true);
    expect(isPickStatus("picked_partial")).toBe(true);
    expect(isPickStatus("unavailable")).toBe(true);
    expect(isPickStatus("picked_everything")).toBe(false);
    expect(isPickStatus(null)).toBe(false);
    expect(isPickStatus(3)).toBe(false);
  });
});

describe("summarisePickProgress", () => {
  it("นับแยกตามสถานะ และบรรทัดที่ยังไม่ได้แตะไม่ใช่ 'ไม่มีของ'", () => {
    const progress = summarisePickProgress([
      line({ item_id: "a", pick_status: "picked_full" }),
      line({ item_id: "b", pick_status: "picked_partial" }),
      line({ item_id: "c", pick_status: "unavailable" }),
      line({ item_id: "d", pick_status: null }),
    ]);
    expect(progress).toEqual({
      total: 4, full: 1, partial: 1, unavailable: 1, pending: 1,
      allTouched: false, hasShortfall: true,
    });
  });

  it("แตะครบทุกบรรทัดแล้วแต่ยังขาดของ ต้องบอกว่าแตะครบและยังขาด", () => {
    const progress = summarisePickProgress([
      line({ item_id: "a", pick_status: "picked_full" }),
      line({ item_id: "b", pick_status: "unavailable" }),
    ]);
    expect(progress.allTouched).toBe(true);
    expect(progress.hasShortfall).toBe(true);
  });

  it("ไม่มีบรรทัดเลย ต้องไม่ถือว่าแตะครบ", () => {
    expect(summarisePickProgress([]).allTouched).toBe(false);
  });
});

describe("stockBesideLineLabel — ห้ามแสดง 'ไม่รู้' เป็น 'ของหมด'", () => {
  it("มีตัวเลขก็บอกตัวเลขพร้อมหน่วยของบรรทัด", () => {
    expect(stockBesideLineLabel(line({ available_qty: 40 }))).toBe("คลังมี 40 แผ่น");
    expect(stockBesideLineLabel(line({ available_qty: "15557.00" }))).toBe("คลังมี 15557 แผ่น");
  });

  it("จับคู่สต็อกไม่ได้ต้องเป็น 'ตรวจสอบไม่ได้' ไม่ใช่ 0", () => {
    const label = stockBesideLineLabel(line({ available_qty: null, stock_source: null, stock_key: null }));
    expect(label).toContain("ตรวจสอบไม่ได้");
    expect(label).not.toContain("0");
  });

  it("ของหมดจริง (0) ต้องแสดงเป็น 0 ไม่ใช่ 'ตรวจสอบไม่ได้'", () => {
    expect(stockBesideLineLabel(line({ available_qty: 0 }))).toBe("คลังมี 0 แผ่น");
  });
});

describe("prefillActualQtyFromPicks — สะพานไปทางเดิมทั้งใบ", () => {
  it("ใช้ picked_qty ก่อน แล้วถอยไป actual_qty แล้วจึง planned_qty", () => {
    expect(prefillActualQtyFromPicks([
      { id: "a", planned_qty: 10, actual_qty: 8, picked_qty: 7 },
      { id: "b", planned_qty: 10, actual_qty: 8, picked_qty: null },
      { id: "c", planned_qty: 10, actual_qty: null, picked_qty: null },
    ])).toEqual({ a: "7", b: "8", c: "10" });
  });

  it("บรรทัดที่คลังบอกว่าไม่มีของ (0) ต้อง prefill เป็น 0 ไม่ใช่ถอยไปตามแผน", () => {
    expect(prefillActualQtyFromPicks([{ id: "a", planned_qty: 10, actual_qty: null, picked_qty: 0 }]))
      .toEqual({ a: "0" });
  });

  it("แถวเดิมที่ไม่เคยมีคอลัมน์ใหม่ ต้องได้พฤติกรรมเดิมเป๊ะ ๆ", () => {
    expect(prefillActualQtyFromPicks([{ id: "a", planned_qty: 12 }])).toEqual({ a: "12" });
  });
});

describe("แถวจาก get_warehouse_pick_lines ใช้กับ calculateJobStockShortage ตัวเดิมได้", () => {
  it("ไม่ต้องมีสูตร 'ของขาดเท่าไหร่' ชุดที่สองในระบบ", () => {
    const rows = toWarehousePickLines([
      line({ item_id: "a", planned_qty: 10, picked_qty: 2, available_qty: 3, stock_key: "SKU-1" }),
      line({ item_id: "b", planned_qty: 5, picked_qty: null, available_qty: null, stock_key: null, line_sku: null }),
    ]);
    const result = calculateJobStockShortage(rows);
    // บรรทัด a: ต้องใช้ 10 หยิบไป 2 เหลือต้องเบิก 8 มีของ 3 -> ขาด 5
    const shortGroup = result.groups.find((group) => group.stockKey === "SKU-1");
    expect(shortGroup?.outstandingQty).toBe(8);
    expect(shortGroup?.shortageQty).toBe(5);
    expect(shortGroup?.status).toBe("short");
    // บรรทัด b: จับคู่สต็อกไม่ได้ -> ตรวจสอบไม่ได้ ห้ามเดาว่าพอหรือขาด
    expect(result.counts.unknown).toBe(1);
    expect(result.snapshotDate).toBe("2026-09-01");
  });
});

describe("toWarehousePickLines", () => {
  it("ข้อมูลที่ไม่ใช่ array หรือมีค่าขยะปน ต้องไม่ทำให้หน้าจอพัง", () => {
    expect(toWarehousePickLines(null)).toEqual([]);
    expect(toWarehousePickLines({ nope: true })).toEqual([]);
    expect(toWarehousePickLines([null, "x", 3])).toEqual([]);
    expect(toWarehousePickLines([line()])).toHaveLength(1);
  });
});

describe("บรรทัดโน้ตของหัวหน้าช่างต้องไม่มีปุ่มหยิบบนหน้าคลัง (รีวิว D5)", () => {
  /** ตรงกับ 3 แถวที่มีอยู่จริงในโปรดักชันวันนี้ */
  const note = () => line({
    item_id: "note", category: "tool", source_type: "other", line_sku: null,
    item_name: "โน้ต Freeform จากหัวหน้าช่าง", planned_qty: 0, unit: "รายการ",
  });

  it("กรองบรรทัดโน้ตออก แต่เก็บของจริงไว้ครบ", () => {
    expect(isWarehouseNoteOnlyLine(note())).toBe(true);
    expect(isWarehouseNoteOnlyLine(line())).toBe(false);
    expect(pickableLines([note(), line(), line({ item_id: "b" })]).map((row) => row.item_id))
      .toEqual(["item-1", "b"]);
  });

  it("ใช้กฎเดียวกับฝั่งช่าง — เครื่องมือจริงที่ planned = 0 ยังต้องหยิบได้", () => {
    const realTool = line({
      item_id: "tool-1", category: "tool", source_type: "other", line_sku: null,
      item_name: "ยืมเครื่องเจียร 1 ชุด", planned_qty: 0, unit: "รายการ",
    });
    expect(isWarehouseNoteOnlyLine(realTool)).toBe(false);
    expect(pickableLines([realTool, note()]).map((row) => row.item_id)).toEqual(["tool-1"]);
  });
});

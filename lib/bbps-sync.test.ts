import { describe, it, expect } from "vitest";
import { collectBlockDates, jobHasYearWarning, type BbpsJob } from "./bbps-sync";

describe("collectBlockDates", () => {
  it("วันเดียว → คืนวันนั้น (ไม่เลื่อนวันจาก timezone)", () => {
    // เคยมีบั๊ก: สร้าง Date ด้วย +07:00 แล้วอ่าน getDate() ใน UTC ทำให้เลื่อน -1 วัน
    expect(collectBlockDates({ id: "1", installStart: "2026-08-19", installEnd: "2026-08-19" })).toEqual(["2026-08-19"]);
  });

  it("หลายวัน → คืนทุกวันในช่วง (inclusive)", () => {
    expect(collectBlockDates({ id: "1", installStart: "2026-08-24", installEnd: "2026-08-25" }))
      .toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("ปี พ.ศ. (>2100) → ไม่ block (ไม่แปลง 543 อัตโนมัติ)", () => {
    expect(collectBlockDates({ id: "1", installStart: "2569-08-24", installEnd: "2569-08-24" })).toEqual([]);
  });

  it("วันที่เป็น null → ไม่พัง คืน []", () => {
    expect(collectBlockDates({ id: "1", installStart: null, installEnd: null })).toEqual([]);
  });

  it("มีแค่ installStart (end = null) → block วันเดียว", () => {
    expect(collectBlockDates({ id: "1", installStart: "2026-09-04", installEnd: null })).toEqual(["2026-09-04"]);
  });

  it("ดึงจาก workOrders ได้ + รวม/เรียง/ไม่ซ้ำ", () => {
    const j: BbpsJob = { id: "1", installStart: null, installEnd: null,
      workOrders: [{ start: "2026-08-20", end: "2026-08-20" }, { start: "2026-08-19", end: "2026-08-20" }] };
    expect(collectBlockDates(j)).toEqual(["2026-08-19", "2026-08-20"]);
  });

  it("ข้ามเดือน (สิ้นเดือน→ต้นเดือน) นับต่อเนื่องถูก", () => {
    expect(collectBlockDates({ id: "1", installStart: "2026-08-31", installEnd: "2026-09-02" }))
      .toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("jobHasYearWarning", () => {
  it("ค.ศ. ปกติ → false", () => {
    expect(jobHasYearWarning({ id: "1", installStart: "2026-08-19", installEnd: "2026-08-19" })).toBe(false);
  });
  it("พ.ศ. (>2100) → true", () => {
    expect(jobHasYearWarning({ id: "1", installStart: "2569-08-24" })).toBe(true);
  });
  it("null → false", () => {
    expect(jobHasYearWarning({ id: "1", installStart: null, installEnd: null })).toBe(false);
  });
  it("เจอปี พ.ศ. ใน workOrders ก็เตือน", () => {
    expect(jobHasYearWarning({ id: "1", workOrders: [{ start: "2569-01-01" }] })).toBe(true);
  });
});

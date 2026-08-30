import { describe, it, expect } from "vitest";
import {
  collectBlockDates,
  jobHasYearWarning,
  findClashes,
  formatClashNote,
  mergeClashFlag,
  CLASH_FLAG_PREFIX,
  type BbpsJob,
  type ClashRow,
} from "./bbps-sync";

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

// งาน BBPS ถูกจองให้ทีม B เต็มวัน 09:00-17:00 (+07) เสมอ
// เดิม lib/bbps-sync.ts insert ทับได้เลยโดยไม่เช็คอะไร — 20 ส.ค. 2026 จึงมีงาน BBPS
// ทับบล็อก "วันหยุด" ของทีม B ไปแล้วจริง
describe("findClashes", () => {
  const day = (d: string, start: string, end: string, notes: string | null = null): ClashRow =>
    ({ slot_start: `${d}T${start}:00+07:00`, slot_end: `${d}T${end}:00+07:00`, notes });

  it("ไม่มีคิวอื่น -> ไม่ชน", () => {
    expect(findClashes(["2026-09-10"], [])).toEqual([]);
  });

  it("มีคิวเต็มวันอยู่แล้ว -> ชน และบอกว่าชนกับอะไร", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-10", "09", "17", "วันหยุด")]))
      .toEqual([{ date: "2026-09-10", withLabel: "วันหยุด" }]);
  });

  it("ทับบางส่วนช่วงบ่าย -> ชน", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-10", "13", "15", "งานแก้ไข")]))
      .toEqual([{ date: "2026-09-10", withLabel: "งานแก้ไข" }]);
  });

  it("คนละวัน -> ไม่ชน", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-11", "09", "17", "งานอื่น")])).toEqual([]);
  });

  it("คิวข้ามวันที่เริ่มก่อนช่วงที่ขอ แล้วลากมาทับ -> ต้องชน", () => {
    // ช่องโหว่เดิมของการเช็คฝั่ง browser: กรองด้วย slot_start ในช่วงวันที่เลือกเท่านั้น
    // คิวที่เริ่มวันก่อนหน้าแต่ลากข้ามมา จึงไม่เคยถูกมองเห็น
    const spanning: ClashRow = { slot_start: "2026-09-09T09:00:00+07:00", slot_end: "2026-09-10T17:00:00+07:00", notes: "งานสองวัน" };
    expect(findClashes(["2026-09-10"], [spanning]))
      .toEqual([{ date: "2026-09-10", withLabel: "งานสองวัน" }]);
  });

  it("จบพอดีตอน 09:00 -> ต่อกันได้ ไม่ถือว่าชน", () => {
    expect(findClashes(["2026-09-10"], [day("2026-09-10", "07", "09", "งานเช้ามืด")])).toEqual([]);
  });

  it("หลายวัน -> รายงานเฉพาะวันที่ชนจริง", () => {
    const others = [day("2026-09-11", "09", "17", "🔒 BBPS · ลูกค้าอื่น")];
    expect(findClashes(["2026-09-10", "2026-09-11", "2026-09-12"], others))
      .toEqual([{ date: "2026-09-11", withLabel: "🔒 BBPS" }]);
  });

  it("ไม่มี notes -> ใช้ job_id, ไม่มีทั้งคู่ -> 'งานอื่น'", () => {
    const withJob: ClashRow = { slot_start: "2026-09-10T09:00:00+07:00", slot_end: "2026-09-10T17:00:00+07:00", notes: null, job_id: "BBPS-xyz" };
    const bare: ClashRow = { slot_start: "2026-09-10T09:00:00+07:00", slot_end: "2026-09-10T17:00:00+07:00" };
    expect(findClashes(["2026-09-10"], [withJob])[0].withLabel).toBe("BBPS-xyz");
    expect(findClashes(["2026-09-10"], [bare])[0].withLabel).toBe("งานอื่น");
  });
});

describe("mergeClashFlag", () => {
  const note = formatClashNote([{ date: "2026-09-10", withLabel: "วันหยุด" }])!;

  it("ยังไม่มี flag เดิม -> ได้ note ใหม่", () => {
    expect(mergeClashFlag(null, note)).toBe(note);
  });

  it("มี flag เดิมเรื่องอื่น -> ต่อท้าย ไม่ทับของเดิม", () => {
    expect(mergeClashFlag("ข้อมูลไม่ครบ: ชื่อลูกค้า", note))
      .toBe(`ข้อมูลไม่ครบ: ชื่อลูกค้า · ${note}`);
  });

  it("sync ซ้ำด้วย clash เดิม -> ไม่สะสมซ้ำ (idempotent)", () => {
    expect(mergeClashFlag(mergeClashFlag("ข้อมูลไม่ครบ: ชื่อลูกค้า", note), note))
      .toBe(`ข้อมูลไม่ครบ: ชื่อลูกค้า · ${note}`);
  });

  it("clash หายไปแล้ว -> ถอด note ออก เหลือแต่ flag อื่น", () => {
    expect(mergeClashFlag(`ข้อมูลไม่ครบ: ชื่อลูกค้า · ${note}`, null)).toBe("ข้อมูลไม่ครบ: ชื่อลูกค้า");
  });

  it("ไม่เหลืออะไรเลย -> null (ไม่ใช่ string ว่าง)", () => {
    expect(mergeClashFlag(note, null)).toBeNull();
    expect(mergeClashFlag(null, null)).toBeNull();
  });

  it("note ขึ้นต้นด้วย prefix ที่ระบุไว้ เพื่อให้ถอดออกได้ภายหลัง", () => {
    expect(note.startsWith(CLASH_FLAG_PREFIX)).toBe(true);
  });
});

describe("formatClashNote", () => {
  it("ไม่ชน -> null", () => {
    expect(formatClashNote([])).toBeNull();
  });
  it("ชนหลายวัน -> รวมเป็นบรรทัดเดียวอ่านออก", () => {
    expect(formatClashNote([
      { date: "2026-09-10", withLabel: "วันหยุด" },
      { date: "2026-09-11", withLabel: "งานคุณเอ" },
    ])).toBe(`${CLASH_FLAG_PREFIX} 2026-09-10 (วันหยุด), 2026-09-11 (งานคุณเอ)`);
  });
});

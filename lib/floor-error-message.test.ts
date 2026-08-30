import { describe, it, expect } from "vitest";
import { floorErrorMessage, floorActionError } from "./floor-error-message";

describe("floorErrorMessage — คิวชน (exclusion constraint)", () => {
  // ด่านสุดท้ายที่ฐานข้อมูล: ถ้าไม่แปลข้อความ ผู้ใช้จะเห็น SQL ดิบหรือข้อความที่ชวนเข้าใจผิด
  const pgError = {
    code: "23P01",
    message: 'conflicting key value violates exclusion constraint "appointments_no_overlap_per_team"',
    details: 'Key (tech_id, tstzrange(slot_start, slot_end, \'[)\'))=(...) conflicts with existing key (...).',
  };

  it("รู้จักจาก code 23P01", () => {
    expect(floorErrorMessage(pgError)).toContain("มีคิวอยู่ในช่วงเวลาที่เลือกแล้ว");
  });

  it("รู้จักจากข้อความ แม้ไม่มี code ติดมา", () => {
    expect(floorErrorMessage({ message: 'violates exclusion constraint "appointments_no_overlap_per_team"' }))
      .toContain("มีคิวอยู่ในช่วงเวลาที่เลือกแล้ว");
  });

  it("ต้องไม่ตกไปที่ข้อความ 'รูปแบบข้อมูลไม่ถูกต้อง' หรือ 'ข้อมูลซ้ำ'", () => {
    const out = floorErrorMessage(pgError);
    expect(out).not.toContain("รูปแบบข้อมูลไม่ถูกต้อง");
    expect(out).not.toContain("ข้อมูลซ้ำ");
  });

  it("ไม่กลืนข้อความจริงของ SQL ดิบให้ผู้ใช้เห็น", () => {
    expect(floorErrorMessage(pgError)).not.toContain("tstzrange");
  });

  it("floorActionError ประกอบข้อความกับชื่อการกระทำได้", () => {
    expect(floorActionError("บันทึกคิว", pgError)).toMatch(/^บันทึกคิวไม่สำเร็จ: /);
  });
});

describe("floorErrorMessage — ข้อผิดพลาดอื่นยังทำงานเหมือนเดิม", () => {
  it("สิทธิ์ไม่พอ", () => {
    expect(floorErrorMessage({ message: "new row violates row-level security policy" }))
      .toContain("ไม่มีสิทธิ์");
  });
  it("ข้อมูลซ้ำ (unique) ยังเป็นข้อความเดิม ไม่ถูกคิวชนแย่งไป", () => {
    expect(floorErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' }))
      .toContain("พบข้อมูลซ้ำในระบบ");
  });
  it("ไม่มีข้อความ -> fallback", () => {
    expect(floorErrorMessage({})).toContain("ไม่ทราบสาเหตุ");
  });
});

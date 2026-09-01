import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTINUOUS_PREP_UNITS,
  PREP_CALC_ERRORS,
  areaSqmFromSurveyData,
  computePrepQty,
  isContinuousPrepUnit,
  roundPrepQty,
  type PrepTemplateItemInput,
} from "@/lib/job-prep-calc";

const GENERATE_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260902110010_job_prep_generate_from_template.sql"),
  "utf8",
);

function item(patch: Partial<PrepTemplateItemInput> = {}): PrepTemplateItemInput {
  return { calcMode: "fixed", calcQty: 1, wastePct: 0, unit: "ชิ้น", ...patch };
}

describe("กฎการคำนวณจากแม่แบบ", () => {
  it("fixed ใช้ calc_qty ตรง ๆ ไม่สนใจพื้นที่หรือจำนวนแผ่น", () => {
    const result = computePrepQty(item({ calcMode: "fixed", calcQty: 2, unit: "ด้าม" }), { areaSqm: null, unitCount: null });
    expect(result).toEqual({ ok: true, value: { base: 2, withWaste: 2, qty: 2 } });
  });

  it("per_sqm คูณด้วยพื้นที่เป็นตารางเมตร", () => {
    const result = computePrepQty(item({ calcMode: "per_sqm", calcQty: 0.25, unit: "หลอด" }), { areaSqm: 14, unitCount: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value.base).toBeCloseTo(3.5, 9); expect(result.value.qty).toBe(4); }
  });

  it("per_unit คูณด้วยจำนวนชิ้น/ชุด", () => {
    const result = computePrepQty(item({ calcMode: "per_unit", calcQty: 3, unit: "ตัว" }), { areaSqm: 14, unitCount: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.qty).toBe(15);
  });

  it("เผื่อเสียหายคูณทับหลังคำนวณฐาน แล้วจึงค่อยปัดเศษ ไม่ใช่ปัดก่อน", () => {
    // 0.25 × 14 = 3.5 → ×1.10 = 3.85 → ปัดขึ้น = 4
    // ถ้าปัดก่อนจะได้ 4 × 1.10 = 4.4 → 5 ซึ่งเผื่อเกินไปหนึ่งหลอดโดยไม่มีเหตุผล
    const result = computePrepQty(item({ calcMode: "per_sqm", calcQty: 0.25, wastePct: 10, unit: "หลอด" }), { areaSqm: 14, unitCount: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value.withWaste).toBeCloseTo(3.85, 9); expect(result.value.qty).toBe(4); }
  });

  it("หน่วยที่แบ่งย่อยได้เก็บทศนิยมไว้ 2 ตำแหน่ง ไม่ปัดขึ้นเป็นจำนวนเต็ม", () => {
    // 0.8 × 14 = 11.2 → ×1.05 = 11.76 เมตร
    const result = computePrepQty(item({ calcMode: "per_sqm", calcQty: 0.8, wastePct: 5, unit: "เมตร" }), { areaSqm: 14, unitCount: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.qty).toBe(11.76);
  });

  it("ไม่มีพื้นที่ → ตอบว่าคำนวณไม่ได้ ไม่ใช่ตอบ 0", () => {
    for (const area of [null, 0, -3]) {
      const result = computePrepQty(item({ calcMode: "per_sqm", calcQty: 1 }), { areaSqm: area, unitCount: 5 });
      expect(result).toEqual({ ok: false, error: "missing_area" });
    }
    expect(PREP_CALC_ERRORS.missing_area).toContain("พื้นที่ติดตั้ง");
  });

  it("ไม่มีจำนวนแผ่น → ตอบว่าคำนวณไม่ได้ ไม่ใช่ตอบ 0", () => {
    for (const units of [null, 0]) {
      const result = computePrepQty(item({ calcMode: "per_unit", calcQty: 1 }), { areaSqm: 14, unitCount: units });
      expect(result).toEqual({ ok: false, error: "missing_unit_count" });
    }
    expect(PREP_CALC_ERRORS.missing_unit_count).toContain("จำนวนแผ่น");
  });

  it("ค่าตั้งต้นในแม่แบบที่ผิดกติกาต้องถูกปฏิเสธ ไม่ใช่คิดต่อ", () => {
    expect(computePrepQty(item({ calcQty: 0 }), { areaSqm: 14, unitCount: 5 })).toEqual({ ok: false, error: "invalid_calc_qty" });
    expect(computePrepQty(item({ calcQty: -1 }), { areaSqm: 14, unitCount: 5 })).toEqual({ ok: false, error: "invalid_calc_qty" });
    expect(computePrepQty(item({ wastePct: 101 }), { areaSqm: 14, unitCount: 5 })).toEqual({ ok: false, error: "invalid_waste_pct" });
    expect(computePrepQty(item({ wastePct: -1 }), { areaSqm: 14, unitCount: 5 })).toEqual({ ok: false, error: "invalid_waste_pct" });
  });
});

describe("กฎการปัดเศษ — ปัดขึ้นเสมอ", () => {
  it("หน่วยนับชิ้นปัดขึ้นเป็นจำนวนเต็ม เพราะหยิบของครึ่งชิ้นออกจากคลังไม่ได้", () => {
    expect(roundPrepQty(3.7, "หลอด")).toBe(4);
    expect(roundPrepQty(3.01, "ม้วน")).toBe(4);
    expect(roundPrepQty(0.05, "ชุด")).toBe(1);
  });

  it("ค่าที่ลงตัวอยู่แล้วต้องไม่ถูกดันขึ้นอีกหนึ่งหน่วยเพราะ noise ของเลขทศนิยม", () => {
    expect(roundPrepQty(3, "หลอด")).toBe(3);
    // 1.1 * 3 ในเลขทศนิยมของ JS = 3.3000000000000003
    expect(roundPrepQty(3 * 1.1, "เมตร")).toBe(3.3);
    expect(roundPrepQty(0.1 + 0.2, "เมตร")).toBe(0.3);
  });

  it("หน่วยที่แบ่งย่อยได้ปัดขึ้นที่ทศนิยม 2 ตำแหน่ง ไม่ใช่จำนวนเต็ม", () => {
    expect(roundPrepQty(12.031, "ม.")).toBe(12.04);
    expect(roundPrepQty(12.03, "เมตร")).toBe(12.03);
    expect(roundPrepQty(11.76, "เมตร")).toBe(11.76);
    expect(roundPrepQty(2.5, "ลิตร")).toBe(2.5);
  });

  it("หน่วยว่างหรือหน่วยที่ไม่รู้จักถือว่านับเป็นชิ้น จึงปัดขึ้นเป็นจำนวนเต็ม", () => {
    expect(roundPrepQty(2.1, "")).toBe(3);
    expect(roundPrepQty(2.1, null)).toBe(3);
    expect(roundPrepQty(2.1, "ตลับ")).toBe(3);
  });

  it("ไม่มีทางปัดลง — ผลลัพธ์ต้องไม่น้อยกว่าค่าที่คำนวณได้", () => {
    for (const value of [0.4, 1.2, 3.999, 10.001, 99.5]) {
      for (const unit of ["หลอด", "เมตร", "ชิ้น"]) {
        expect(roundPrepQty(value, unit)).toBeGreaterThanOrEqual(value);
      }
    }
  });

  it("0 และค่าติดลบคืน 0 ไม่ใช่ 1 — จะได้ไม่เสกของขึ้นมาจากรายการที่ว่าง", () => {
    expect(roundPrepQty(0, "หลอด")).toBe(0);
    expect(roundPrepQty(-2, "หลอด")).toBe(0);
    expect(roundPrepQty(Number.NaN, "หลอด")).toBe(0);
  });

  it("isContinuousPrepUnit ไม่สนใจช่องว่างและตัวพิมพ์", () => {
    expect(isContinuousPrepUnit(" เมตร ")).toBe(true);
    expect(isContinuousPrepUnit("KG")).toBe(true);
    expect(isContinuousPrepUnit("แผ่น")).toBe(false);
  });
});

describe("อ่านพื้นที่จากข้อมูลสำรวจ", () => {
  it("อ่านค่าปกติได้ ทั้งที่เก็บเป็น string และเป็นตัวเลข", () => {
    expect(areaSqmFromSurveyData(JSON.stringify({ areaSqm: "14" }))).toBe(14);
    expect(areaSqmFromSurveyData(JSON.stringify({ areaSqm: 22.5 }))).toBe(22.5);
    expect(areaSqmFromSurveyData({ areaSqm: "9" })).toBe(9);
  });

  it("ค่าที่คนพิมพ์หน่วยต่อท้ายมาด้วย ยังอ่านตัวเลขนำหน้าได้ (ข้อมูลจริงมีแบบนี้)", () => {
    expect(areaSqmFromSurveyData(JSON.stringify({ areaSqm: "32 ตรม" }))).toBe(32);
  });

  it("ค่าที่ไม่ใช่ตัวเลขเลยถือว่าไม่รู้พื้นที่ ไม่ใช่ 0 (ข้อมูลจริงมี 'ปิดขอบ' และค่าว่าง)", () => {
    expect(areaSqmFromSurveyData(JSON.stringify({ areaSqm: "ปิดขอบ" }))).toBeNull();
    expect(areaSqmFromSurveyData(JSON.stringify({ areaSqm: "" }))).toBeNull();
    expect(areaSqmFromSurveyData(JSON.stringify({ areaSqm: "0" }))).toBeNull();
    expect(areaSqmFromSurveyData(JSON.stringify({}))).toBeNull();
  });

  it("ข้อมูลพังต้องไม่ทำให้ระเบิด", () => {
    expect(areaSqmFromSurveyData("ไม่ใช่ json")).toBeNull();
    expect(areaSqmFromSurveyData("[1,2,3]")).toBeNull();
    expect(areaSqmFromSurveyData(null)).toBeNull();
    expect(areaSqmFromSurveyData("")).toBeNull();
  });
});

describe("โค้ดกับ migration ต้องไม่หลุดจากกัน", () => {
  it("รายชื่อหน่วยที่แบ่งย่อยได้ใน SQL ต้องตรงกับฝั่ง TypeScript ทุกตัว", () => {
    const block = /lower\(btrim\(coalesce\(p_unit, ''\)\)\) = any \(array\[([\s\S]*?)\]\)/.exec(GENERATE_SQL);
    expect(block).not.toBeNull();
    const sqlUnits = Array.from(block![1].matchAll(/'([^']*)'/g)).map((match) => match[1]);
    expect(new Set(sqlUnits)).toEqual(new Set(CONTINUOUS_PREP_UNITS.map((unit) => unit.toLowerCase())));
  });

  it("SQL ปัดขึ้น (ceil) ทั้งสองทาง ไม่มี round หรือ floor หลุดเข้ามา", () => {
    expect(GENERATE_SQL).toContain("ceil(p_value * 100) / 100");
    expect(GENERATE_SQL).toContain("else ceil(p_value)");
    expect(GENERATE_SQL).not.toMatch(/\bfloor\(/);
    expect(GENERATE_SQL).not.toMatch(/\bround\(p_value/);
  });

  it("SQL คำนวณสามโหมดเหมือนฝั่ง TypeScript และคูณเผื่อเสียหายก่อนปัดเศษ", () => {
    expect(GENERATE_SQL).toContain("when 'per_sqm' then v_item.calc_qty * v_area");
    expect(GENERATE_SQL).toContain("when 'per_unit' then v_item.calc_qty * v_units");
    expect(GENERATE_SQL).toContain("public.job_prep_round_qty(v_base * (1 + v_item.waste_pct / 100), v_unit)");
  });

  it("ค่าตั้งต้นหายต้อง raise เป็นภาษาไทย ไม่ใช่สร้างรายการที่ทุกบรรทัดเป็น 0", () => {
    expect(GENERATE_SQL).toContain("if v_needs_area and (v_area is null or v_area <= 0) then");
    expect(GENERATE_SQL).toContain("if v_needs_units and (v_units is null or v_units <= 0) then");
    expect(GENERATE_SQL).toContain(PREP_CALC_ERRORS.missing_area);
    expect(GENERATE_SQL).toContain(PREP_CALC_ERRORS.missing_unit_count);
  });

  it("พื้นที่มาจาก survey_data ไม่ใช่ area_w × area_l ที่ข้อมูลจริงใช้ไม่ได้", () => {
    expect(GENERATE_SQL).toContain("v_json ->> 'areaSqm'");
    expect(GENERATE_SQL).toContain("public.job_prep_area_sqm(v_job.survey_data)");
    expect(GENERATE_SQL).not.toMatch(/v_job\.area_w/);
    expect(GENERATE_SQL).not.toMatch(/v_job\.area_l/);
  });

  it("จำนวนชิ้นงานใช้นิยามเดียวกับ planned_sheet_count เดิม ไม่สร้างนิยามชุดที่สอง", () => {
    expect(GENERATE_SQL).toContain("category in ('floor_material', 'remnant')");
    expect(GENERATE_SQL).toContain("unit in ('แผ่น', 'sheet', 'sheets')");
    expect(GENERATE_SQL).toContain("from public.floor_job_materials where appointment_id = v_order.appointment_id");
  });
});

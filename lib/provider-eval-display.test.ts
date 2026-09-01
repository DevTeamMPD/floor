import { describe, expect, it } from "vitest";
import {
  evalComputedAtLabel,
  evalDisplayLines,
  evalEvidenceNote,
  evalHeadline,
  evalNcProcessNote,
  type StoredTeamEvalRow,
} from "@/lib/provider-eval-display";

function row(overrides: Partial<StoredTeamEvalRow> = {}): StoredTeamEvalRow {
  return {
    team_id: "t1", computed_at: null, method_version: "P4-9.1",
    eval_score: null, eval_avg: null, performance_score: null, direct_evidence: 0,
    has_data: false, is_provisional: true, job_count: 0,
    csat_score: null, csat_raw: null, csat_sample: 0,
    ncr_score: null, ncr_raw: null, ncr_sample: 0,
    ncr_weighted: 0, ncr_count: 0, ncr_credibility: 0,
    ontime_score: null, ontime_raw: null, ontime_sample: 0,
    ftp_score: null, ftp_raw: null, ftp_sample: 0,
    ...overrides,
  };
}

describe("บรรทัดสรุปคะแนน", () => {
  it("ยังไม่เคยคำนวณ ต้องบอกตรง ๆ ไม่ใช่โชว์ 0", () => {
    expect(evalHeadline(null)).toBe("ยังไม่ได้คำนวณคะแนน");
    expect(evalEvidenceNote(null)).toContain("คำนวณใหม่ทุกคืน");
  });

  it("คำนวณแล้วแต่ไม่มีข้อมูล ต้องบอกว่าไม่มีข้อมูลพอ ไม่ใช่ 0 คะแนน", () => {
    expect(evalHeadline(row())).toBe("ยังไม่มีข้อมูลพอให้คะแนน");
  });

  it("คะแนนที่ยังไม่นิ่ง ต้องติดป้ายไว้และไม่โชว์ดาว", () => {
    const headline = evalHeadline(row({ has_data: true, eval_score: 72.7, eval_avg: 3.64, is_provisional: true, job_count: 1 }));
    expect(headline).toContain("72.7");
    expect(headline).toContain("ยังไม่นิ่ง");
    expect(headline).not.toContain("★");
  });

  it("คะแนนที่นิ่งแล้วโชว์ทั้งคะแนนและดาว", () => {
    expect(evalHeadline(row({ has_data: true, eval_score: 85.7, eval_avg: 4.29, is_provisional: false, job_count: 50 })))
      .toBe("85.7 คะแนน · ★ 4.29");
  });

  it("บรรทัดหลักฐานบอกทั้งจำนวนงาน จุดหลักฐาน และคะแนนก่อนถ่วง", () => {
    const note = evalEvidenceNote(row({ job_count: 40, direct_evidence: 85, performance_score: 87.3 }));
    expect(note).toContain("งาน 40 ใบ");
    expect(note).toContain("85 จุด");
    expect(note).toContain("87.3");
  });
});

describe("ตารางคะแนนย่อย — ต้องกางให้เห็นทุกด้านเสมอ", () => {
  it("มีครบสี่ด้านพร้อมน้ำหนักและที่มาของตัวอย่าง", () => {
    const lines = evalDisplayLines(row({
      csat_score: 79.9, csat_raw: 80, csat_sample: 30,
      ncr_score: 95, ncr_raw: 96, ncr_sample: 40,
      ontime_score: 90, ontime_raw: 94, ontime_sample: 35,
      ftp_score: 80, ftp_raw: 85, ftp_sample: 20,
    }));
    expect(lines.map((line) => line.key)).toEqual(["csat", "ncr", "onTime", "firstTimePass"]);
    expect(lines[0]).toMatchObject({ label: "ความพอใจลูกค้า", score: "79.9", raw: "80.0", weight: "40%" });
    expect(lines[0].sample).toBe("30 งานที่ลูกค้าให้คะแนน");
    expect(lines[2].sample).toBe("35 งานที่มีทั้งวันนัดและวันจบจริง");
  });

  it("ด้านที่ไม่มีข้อมูลบอกว่าใช้ค่ากลาง ไม่ใช่ปล่อยว่างให้เดา", () => {
    const [csat] = evalDisplayLines(row({ csat_score: 78.7, csat_raw: null, csat_sample: 0 }));
    expect(csat.raw).toBe("ยังไม่มีข้อมูล ใช้ค่ากลาง");
    expect(csat.score).toBe("78.7");
    expect(csat.sample).toBe("0 งานที่ลูกค้าให้คะแนน");
  });

  it("*** ระบบ NC ที่ยังไม่มีใครใช้ ต้องถูกพูดออกมาบนจอ ไม่ใช่ปล่อยให้เดา ***", () => {
    const note = evalNcProcessNote(row({ job_count: 23, ncr_sample: 0, ncr_credibility: 0 }));
    expect(note).toContain("ยังไม่มีการเปิดใบ NC จริง");
    expect(note).toContain("ยังไม่ใช่ข่าวดี");
  });

  it("โลกที่บริษัทเปิด NC จริง บอกว่านับงานของทีมเป็นหลักฐานไปกี่ใบ", () => {
    const note = evalNcProcessNote(row({ job_count: 20, ncr_sample: 10, ncr_credibility: 0.545 }));
    expect(note).toContain("55%");
    expect(note).toContain("10 ใบ จาก 20 ใบ");
  });

  it("แถวเก่าที่ยังไม่มีค่าความน่าเชื่อ ไม่พูดอะไรมั่ว", () => {
    expect(evalNcProcessNote(row({ ncr_credibility: null }))).toBe("");
    expect(evalNcProcessNote(null)).toBe("");
  });

  it("เวลาที่คำนวณล่าสุดอ่านออกเป็นภาษาไทย และของเสียไม่ทำให้พัง", () => {
    expect(evalComputedAtLabel(row({ computed_at: "2026-09-02T19:00:00.000Z" }))).not.toBe("");
    expect(evalComputedAtLabel(row({ computed_at: "ไม่ใช่วันที่" }))).toBe("");
    expect(evalComputedAtLabel(null)).toBe("");
  });
});

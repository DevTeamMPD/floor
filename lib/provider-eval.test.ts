import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVAL_WEIGHTS,
  MIN_DIRECT_EVIDENCE,
  MIN_JOBS_FOR_STARS,
  NEUTRAL_PRIOR,
  NEUTRAL_PRIOR_WEIGHT,
  PROVIDER_EVAL_METHOD_VERSION,
  SHRINK_K,
  csatToScore,
  fleetPrior,
  ncrToScore,
  parseEvalInputs,
  scoreAllTeams,
  scoreTeam,
  shrink,
  toApplyPayload,
  type TeamEvalInput,
} from "@/lib/provider-eval";

function team(overrides: Partial<TeamEvalInput> = {}): TeamEvalInput {
  return {
    teamId: "team-1", teamName: "ทีมทดสอบ", providerType: null, isActive: true,
    jobCount: 0, csatSum: 0, csatCount: 0, ncrWeighted: 0, ncrCount: 0,
    onTimeCount: 0, onTimeBase: 0, firstPassCount: 0, firstPassBase: 0,
    ...overrides,
  };
}

function componentScore(input: TeamEvalInput, fleet: TeamEvalInput[], key: string) {
  return scoreTeam(input, fleet).components.find((component) => component.key === key);
}

describe("น้ำหนักและค่าคงที่ของนโยบาย", () => {
  it("น้ำหนักทั้งสี่ด้านรวมกันได้ 1 พอดี", () => {
    const total = Object.values(EVAL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("ความพอใจลูกค้าเป็นด้านที่หนักที่สุด เพราะเป็นเสียงเดียวจากนอกบริษัท", () => {
    expect(EVAL_WEIGHTS.csat).toBeGreaterThan(EVAL_WEIGHTS.ncr);
    expect(EVAL_WEIGHTS.csat).toBeGreaterThan(EVAL_WEIGHTS.onTime);
    expect(EVAL_WEIGHTS.csat).toBeGreaterThan(EVAL_WEIGHTS.firstTimePass);
  });
});

describe("แต่ละด้าน: การแปลงค่าดิบเป็นคะแนน 0-100", () => {
  it("CSAT: 1 ดาว = 0 คะแนน, 3 ดาว = 50, 5 ดาว = 100", () => {
    expect(csatToScore(1)).toBe(0);
    expect(csatToScore(3)).toBe(50);
    expect(csatToScore(5)).toBe(100);
  });

  it("CSAT ที่หลุดขอบถูกบีบกลับเข้า 0-100 ไม่ปล่อยค่าประหลาดออกไป", () => {
    expect(csatToScore(0)).toBe(0);
    expect(csatToScore(9)).toBe(100);
  });

  it("NC: ไม่มี NC เลย = 100, ถึงเพดาน 0.5 ต่องาน = 0, เกินเพดานก็ไม่ติดลบ", () => {
    expect(ncrToScore(0, 10)).toBe(100);
    expect(ncrToScore(5, 10)).toBe(0);
    expect(ncrToScore(50, 10)).toBe(0);
    expect(ncrToScore(1, 10)).toBeCloseTo(80, 6);
  });

  it("NC: ไม่มีงานเลย ให้ค่ากลางเฉย ๆ ไม่ใช่ 0 (ไม่มีข้อมูล ไม่ใช่ทำงานแย่)", () => {
    expect(ncrToScore(0, 0)).toBe(NEUTRAL_PRIOR);
  });

  it("ตรงนัด: อ่านจากจำนวนงานที่จบไม่เกินวันนัดล่าสุด", () => {
    const input = team({ jobCount: 4, onTimeBase: 4, onTimeCount: 3 });
    expect(componentScore(input, [input], "onTime")?.raw).toBe(75);
  });

  it("ผ่านตรวจรับครั้งแรก: อ่านจากงานที่มีผลตรวจรับเท่านั้น ไม่ใช่ทุกงาน", () => {
    const input = team({ jobCount: 10, firstPassBase: 4, firstPassCount: 1 });
    const component = componentScore(input, [input], "firstTimePass");
    expect(component?.raw).toBe(25);
    expect(component?.sample).toBe(4);
  });

  it("ด้านที่ไม่มีข้อมูลเลยได้ raw = null แต่คะแนนเป็นค่ากลาง ไม่ใช่ 0 และไม่ถูกตัดออก", () => {
    const input = team({ jobCount: 3, onTimeBase: 0, csatCount: 0, firstPassBase: 0 });
    const score = scoreTeam(input, [input]);
    const csat = componentScore(input, [input], "csat");
    expect(csat?.raw).toBeNull();
    expect(csat?.score).toBe(csat?.prior);
    // ทุกด้านถือน้ำหนักเต็มเสมอ ทีมจึงเลือกสนามที่ตัวเองเด่นไม่ได้
    expect(csat?.weight).toBe(EVAL_WEIGHTS.csat);
    expect(componentScore(input, [input], "ncr")?.weight).toBe(EVAL_WEIGHTS.ncr);
    expect(score.hasData).toBe(true);
  });

  it("น้ำหนักของทุกด้านรวมกันได้ 1 เสมอ ไม่ว่าจะมีข้อมูลกี่ด้าน", () => {
    const input = team({ jobCount: 3 });
    const total = scoreTeam(input, [input]).components.reduce((sum, component) => sum + component.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("กฎกลุ่มตัวอย่างเล็ก", () => {
  it("สูตรหด: ตัวอย่าง 0 = ได้ค่ากลางเต็ม ๆ, ตัวอย่างเท่ากับ K = ครึ่งทางพอดี", () => {
    expect(shrink(100, 0, 70)).toBe(70);
    expect(shrink(100, SHRINK_K, 70)).toBe(85);
    expect(shrink(0, SHRINK_K, 70)).toBe(35);
  });

  it("ยิ่งมีตัวอย่างมาก คะแนนยิ่งเข้าใกล้ค่าดิบของตัวเอง", () => {
    const few = shrink(100, 1, 70);
    const many = shrink(100, 100, 70);
    expect(few).toBeLessThan(many);
    expect(many).toBeGreaterThan(98);
  });

  it("ค่ากลางของบริษัทถูกหดเข้าหา 70 อีกชั้น จึงไม่เท่ากับทีมเดียวที่มีข้อมูล", () => {
    const lucky = team({ teamId: "lucky", jobCount: 1, csatSum: 5, csatCount: 1 });
    const prior = fleetPrior("csat", [lucky]);
    // ถ้าไม่มีชั้นที่สอง ค่ากลางจะเป็น 100 ซึ่งแปลว่าหดเข้าหาตัวเอง = ไม่ได้หดเลย
    expect(prior).toBeLessThan(100);
    expect(prior).toBeCloseTo((1 * 100 + NEUTRAL_PRIOR_WEIGHT * NEUTRAL_PRIOR) / (1 + NEUTRAL_PRIOR_WEIGHT), 6);
  });

  it("ไม่มีข้อมูลทั้งบริษัท ค่ากลางคือ 70 เฉย ๆ", () => {
    expect(fleetPrior("csat", [team()])).toBe(NEUTRAL_PRIOR);
    expect(fleetPrior("onTime", [])).toBe(NEUTRAL_PRIOR);
  });

  it("*** ทีม 1 งาน 5 ดาว ต้องไม่ขึ้นนำทีม 50 งานที่ทำได้จริง ***", () => {
    const lucky = team({ teamId: "lucky", teamName: "ทีมงานเดียว", jobCount: 1, csatSum: 5, csatCount: 1 });
    const proven = team({
      teamId: "proven", teamName: "ทีม 50 งาน", jobCount: 50,
      csatSum: 4.2 * 50, csatCount: 50,
      onTimeBase: 50, onTimeCount: 45,
      firstPassBase: 50, firstPassCount: 40,
    });
    const [luckyScore, provenScore] = scoreAllTeams([lucky, proven]);

    expect(luckyScore.evalScore).not.toBeNull();
    expect(provenScore.evalScore).not.toBeNull();
    // ต้องนำแบบมีระยะห่างชัดเจน ไม่ใช่ชนะเฉียดฉิวที่พลิกได้ด้วยข้อมูลเพียงจุดเดียว
    expect(provenScore.evalScore!).toBeGreaterThan(luckyScore.evalScore! + 10);
    // และคะแนนของทีมงานเดียวต้องไม่ใช่เต็ม 100 ตามดาวที่บังเอิญได้
    expect(luckyScore.evalScore!).toBeLessThan(80);
    // ทีมงานเดียวยังไม่ถูกประกาศดาวด้วย ซ้ำอีกชั้นหนึ่ง
    expect(luckyScore.isProvisional).toBe(true);
    expect(provenScore.isProvisional).toBe(false);
  });

  it("การหดชั้นที่ 3 ทำงานตามจำนวนงาน: ผลงานเท่ากันแต่งานมากกว่า ได้คะแนนสูงกว่า", () => {
    const small = team({ teamId: "s", jobCount: 3, csatSum: 4 * 3, csatCount: 3, onTimeBase: 3, onTimeCount: 3 });
    const big = team({ teamId: "b", jobCount: 60, csatSum: 4 * 60, csatCount: 60, onTimeBase: 60, onTimeCount: 60 });
    const [smallScore, bigScore] = scoreAllTeams([small, big]);
    expect(bigScore.evalScore!).toBeGreaterThan(smallScore.evalScore!);
  });

  it("คะแนนจากผลงานล้วน ๆ ถูกเก็บแยกไว้ให้คนตรวจได้ว่าการหดกินไปเท่าไร", () => {
    const input = team({ jobCount: 2, csatSum: 10, csatCount: 2 });
    const score = scoreTeam(input, [input]);
    expect(score.performanceScore).not.toBeNull();
    expect(score.evalScore).not.toBe(score.performanceScore);
  });

  it("ทีมที่งานน้อยกว่าเกณฑ์ถูกทำเครื่องหมายว่ายังไม่นิ่ง และบอกเหตุผลเป็นภาษาไทย", () => {
    const small = team({ jobCount: MIN_JOBS_FOR_STARS - 1, csatSum: 5, csatCount: 1 });
    const score = scoreTeam(small, [small]);
    expect(score.isProvisional).toBe(true);
    expect(score.reason).toContain("ยังไม่นิ่ง");
    expect(score.reason).toContain(String(MIN_JOBS_FOR_STARS));
  });

  it("*** งานเยอะแต่ไม่มีหลักฐานที่ใครบันทึกไว้จริง ก็ยังไม่ได้ดาว ***", () => {
    // ทีมที่มี 23 งาน แต่ไม่มีคะแนนลูกค้า ไม่มีงานที่เทียบวันนัดได้ ไม่มีผลตรวจรับ
    // ได้คะแนนด้าน NC เต็มเพราะ "ไม่มีใครเปิด NC ใส่" ซึ่งไม่ใช่หลักฐานว่าทำงานดี
    const silent = team({ jobCount: 23 });
    const score = scoreTeam(silent, [silent]);
    expect(score.directEvidence).toBe(0);
    expect(score.isProvisional).toBe(true);
    expect(score.reason).toContain("หลักฐานที่บันทึกไว้จริง");
  });

  it("ถึงเกณฑ์ทั้งจำนวนงานและหลักฐานที่บันทึกไว้จริงแล้วจึงเลิกเป็น provisional", () => {
    const enough = team({ jobCount: MIN_JOBS_FOR_STARS + 2, csatSum: 4 * MIN_DIRECT_EVIDENCE, csatCount: MIN_DIRECT_EVIDENCE });
    const score = scoreTeam(enough, [enough]);
    expect(score.directEvidence).toBe(MIN_DIRECT_EVIDENCE);
    expect(score.isProvisional).toBe(false);
  });

  it("หลักฐานที่นับได้มาจากสามด้านที่คนบันทึก ไม่นับด้าน NC", () => {
    const mixed = team({ jobCount: 40, csatCount: 2, csatSum: 8, onTimeBase: 2, onTimeCount: 1, firstPassBase: 1, firstPassCount: 1 });
    expect(scoreTeam(mixed, [mixed]).directEvidence).toBe(5);
  });
});

describe("สถานะไม่มีข้อมูล — ต้องเงียบอย่างซื่อสัตย์ ไม่ใช่ให้ 0", () => {
  it("ทีมที่ไม่มีงานเลยได้ evalScore = null และ hasData = false", () => {
    const empty = team({ teamId: "empty", jobCount: 0 });
    const score = scoreTeam(empty, [empty]);
    expect(score.hasData).toBe(false);
    expect(score.evalScore).toBeNull();
    expect(score.evalAvg).toBeNull();
    expect(score.isProvisional).toBe(true);
    expect(score.reason).toBe("ยังไม่มีข้อมูลสักด้าน จึงยังให้คะแนนไม่ได้");
  });

  it("ระบบที่ยังไม่มีทีมเลย คำนวณได้ปกติและคืนรายการว่าง ไม่พัง", () => {
    expect(scoreAllTeams([])).toEqual([]);
    expect(toApplyPayload([])).toEqual([]);
  });

  it("payload ของทีมที่ไม่มีข้อมูล ส่งค่าที่ผ่าน check ของตาราง (ไม่มีคะแนนคู่กับ hasData=false)", () => {
    const empty = team({ teamId: "empty" });
    const [payload] = toApplyPayload(scoreAllTeams([empty]));
    expect(payload.hasData).toBe(false);
    expect(payload.evalScore).toBeNull();
    expect(payload.evalAvg).toBeNull();
    expect(payload.isProvisional).toBe(true);
    expect(payload.methodVersion).toBe(PROVIDER_EVAL_METHOD_VERSION);
  });
});

describe("ดาวที่เขียนกลับไปที่ tech_teams", () => {
  it("ดาวคือคะแนน/20 เสมอ และไม่มีทางเกิน 5", () => {
    const perfect = team({ jobCount: 20, csatSum: 5 * 20, csatCount: 20, onTimeBase: 20, onTimeCount: 20, firstPassBase: 20, firstPassCount: 20 });
    const score = scoreTeam(perfect, [perfect]);
    expect(score.evalAvg).toBe(Math.round((score.evalScore! / 20) * 100) / 100);
    expect(score.evalAvg!).toBeLessThanOrEqual(5);
    expect(score.evalAvg!).toBeGreaterThanOrEqual(0);
  });

  it("ทีมที่แย่จริงก็ยังอยู่ในช่วง 0-5 ไม่ติดลบ", () => {
    const bad = team({ jobCount: 20, csatSum: 1 * 20, csatCount: 20, ncrWeighted: 40, ncrCount: 40, onTimeBase: 20, onTimeCount: 0, firstPassBase: 20, firstPassCount: 0 });
    const score = scoreTeam(bad, [bad]);
    expect(score.evalAvg!).toBeGreaterThanOrEqual(0);
    expect(score.evalScore!).toBeGreaterThanOrEqual(0);
  });
});

describe("การอ่าน payload จากเซิร์ฟเวอร์", () => {
  it("อ่านผลจาก tech_team_eval_inputs() ได้ครบทุกฟิลด์", () => {
    const parsed = parseEvalInputs([{
      teamId: "t1", teamName: "ทีม A", providerType: "subcontract", isActive: true,
      jobCount: 5, csatSum: 20, csatCount: 5, ncrWeighted: 1.5, ncrCount: 2,
      onTimeBase: 4, onTimeCount: 3, firstPassBase: 2, firstPassCount: 1,
    }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ teamId: "t1", providerType: "subcontract", jobCount: 5, ncrWeighted: 1.5 });
  });

  it("ของที่ไม่ใช่รายการ หรือแถวที่ไม่มี teamId ถูกทิ้ง ไม่ทำให้ทั้งรอบล้ม", () => {
    expect(parseEvalInputs(null)).toEqual([]);
    expect(parseEvalInputs([{ teamName: "ไม่มี id" }, "ขยะ", null])).toEqual([]);
  });

  it("ตัวเลขที่มาเป็นสตริง (numeric ของ postgres) ถูกแปลงเป็นตัวเลข", () => {
    const [parsed] = parseEvalInputs([{ teamId: "t1", jobCount: "7", csatSum: "21.5", csatCount: "5" }]);
    expect(parsed.jobCount).toBe(7);
    expect(parsed.csatSum).toBe(21.5);
  });
});

describe("กันเพี้ยนกับฝั่งฐานข้อมูล", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260902200030_tech_team_eval_scores.sql"),
    "utf8",
  );

  it("เกณฑ์งานขั้นต่ำใน TS ตรงกับ check constraint ของตาราง", () => {
    expect(migration).toContain(`check (job_count >= ${MIN_JOBS_FOR_STARS} or is_provisional)`);
  });

  it("ตารางบังคับว่าไม่มีข้อมูลต้องไม่มีคะแนน ตรงกับสิ่งที่ toApplyPayload ส่ง", () => {
    expect(migration).toContain("check (has_data or (eval_score is null and eval_avg is null))");
  });
});

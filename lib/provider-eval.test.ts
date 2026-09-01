import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVAL_WEIGHTS,
  MIN_DIRECT_EVIDENCE,
  MIN_JOBS_FOR_STARS,
  NC_PROCESS_FULL_RATE,
  NC_PROCESS_REPORTS_K,
  NEUTRAL_PRIOR,
  NEUTRAL_PRIOR_WEIGHT,
  PROVIDER_EVAL_METHOD_VERSION,
  SHRINK_K,
  csatToScore,
  fleetPrior,
  ncrProcessCredibility,
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
    // ต้องมีหลักฐานจริงอย่างน้อยหนึ่งด้าน (ตรงนัด) ไม่งั้นทีมนี้จะไม่มีข้อมูลเลยสักด้านตั้งแต่ต้น
    // เพราะด้าน NC ไม่ให้คะแนนจากความเงียบอีกแล้ว (P4-9.2)
    const input = team({ jobCount: 3, onTimeBase: 2, onTimeCount: 1, csatCount: 0, firstPassBase: 0 });
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
    // ระยะห่างที่รับประกันลดจาก 12.6 เหลือ 7.4 หลัง P4-9.2 โดยตั้งใจ: ในโลกที่ยังไม่มีใครเปิด NC
    // ทั้งสองทีมได้ค่ากลาง 70 เท่ากันบน 25% ของคะแนน ระยะห่างจึงถูกบีบลงราวหนึ่งในสี่
    // นั่นคือหน้าตาที่ถูกต้องของ "ด้านนี้เรายังไม่รู้" — ดูเทสคู่กันในโลกที่บริษัทเปิด NC จริง
    expect(provenScore.evalScore!).toBeGreaterThan(luckyScore.evalScore! + 7);
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

  it("*** งานเยอะแต่ไม่มีหลักฐานที่ใครบันทึกไว้จริง ไม่ได้ดาว และไม่มีคะแนนด้วย ***", () => {
    // ทีมที่มี 23 งาน แต่ไม่มีคะแนนลูกค้า ไม่มีงานที่เทียบวันนัดได้ ไม่มีผลตรวจรับ
    // ของเดิม: ได้คะแนนด้าน NC เกือบเต็มเพราะ "ไม่มีใครเปิด NC ใส่" แล้วมีคะแนนขึ้นจอ (provisional)
    // P4-9.2: ความเงียบไม่ใช่ข้อมูล ทีมนี้จึงไม่มีข้อมูลสักด้าน และไม่มีคะแนนให้แสดงเลย
    const silent = team({ jobCount: 23 });
    const score = scoreTeam(silent, [silent]);
    expect(score.directEvidence).toBe(0);
    expect(score.hasData).toBe(false);
    expect(score.evalScore).toBeNull();
    expect(score.isProvisional).toBe(true);
    expect(score.reason).toContain("ยังไม่มีใครบันทึกหลักฐานคุณภาพ");
    expect(score.reason).toContain("ยังไม่มีการเปิดใบ NC จริง");
  });

  it("ถึงเกณฑ์ทั้งจำนวนงานและหลักฐานที่บันทึกไว้จริงแล้วจึงเลิกเป็น provisional", () => {
    const enough = team({ jobCount: MIN_JOBS_FOR_STARS + 2, csatSum: 4 * MIN_DIRECT_EVIDENCE, csatCount: MIN_DIRECT_EVIDENCE });
    const score = scoreTeam(enough, [enough]);
    expect(score.directEvidence).toBe(MIN_DIRECT_EVIDENCE);
    expect(score.isProvisional).toBe(false);
  });

  it("โลกที่ยังไม่มีใครเปิด NC: หลักฐานนับจากสามด้านที่คนบันทึกเท่านั้น ด้าน NC บวก 0", () => {
    const mixed = team({ jobCount: 40, csatCount: 2, csatSum: 8, onTimeBase: 2, onTimeCount: 1, firstPassBase: 1, firstPassCount: 1 });
    const score = scoreTeam(mixed, [mixed]);
    expect(score.ncrCredibility).toBe(0);
    expect(score.ncrEvidenceJobs).toBe(0);
    expect(score.directEvidence).toBe(5);
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

describe("*** ความเงียบจากระบบ NC ไม่ใช่คุณภาพ (P4-9.2) ***", () => {
  const ncrOf = (score: ReturnType<typeof scoreTeam>) => score.components.find((c) => c.key === "ncr")!;

  const filer = () => team({
    teamId: "filer", teamName: "ทีมที่โดนเปิด NC เป็นปกติ", jobCount: 60,
    csatSum: 4 * 60, csatCount: 60, ncrWeighted: 8, ncrCount: 12,
    onTimeBase: 60, onTimeCount: 50, firstPassBase: 60, firstPassCount: 45,
  });
  const clean = () => team({
    teamId: "clean", teamName: "ทีมที่สะอาดจริง", jobCount: 20,
    csatSum: 4 * 20, csatCount: 20,
    onTimeBase: 20, onTimeCount: 17, firstPassBase: 20, firstPassCount: 15,
  });

  it("ไม่มีใครเปิดใบ NC เลยทั้งบริษัท = ความน่าเชื่อของระบบ NC เป็น 0", () => {
    expect(ncrProcessCredibility([])).toBe(0);
    expect(ncrProcessCredibility([team({ jobCount: 1000 })])).toBe(0);
    // มีใบ NC แต่ยังไม่มีงานเลย ก็ยังคำนวณอัตราไม่ได้
    expect(ncrProcessCredibility([team({ jobCount: 0, ncrCount: 3 })])).toBe(0);
  });

  it("ความน่าเชื่อ = ปริมาณ x อัตรา และไม่มีทางเกิน 1", () => {
    const one = ncrProcessCredibility([team({ jobCount: 40, ncrCount: 1 })]);
    expect(one).toBeCloseTo(
      (1 / (1 + NC_PROCESS_REPORTS_K)) * Math.min(1, 1 / 40 / NC_PROCESS_FULL_RATE), 8);
    // ใบเดียวทั้งบริษัท ยังเป็นแค่ "มีคนลองกด" — ต้องไม่ทำให้ความเงียบกลายเป็นคุณภาพในคืนเดียว
    expect(one).toBeLessThan(0.1);

    const busy = ncrProcessCredibility([team({ jobCount: 500, ncrCount: 60 })]);
    expect(busy).toBeGreaterThan(0.8);
    expect(busy).toBeLessThanOrEqual(1);
  });

  it("ใบ NC เยอะแต่เทียบกับงานแล้วน้อยมาก ก็ยังไม่ถือว่ากระบวนการเดินอยู่", () => {
    // 20 ใบฟังดูเยอะ แต่คือ 1 ใบต่อ 5,000 งาน = ยังไม่ได้มอง ไม่ใช่ไม่มีข้อบกพร่อง
    expect(ncrProcessCredibility([team({ jobCount: 100000, ncrCount: 20 })])).toBeLessThan(0.01);
  });

  it("*** เคสที่รีวิวประกอบขึ้น: CSAT 2 จาก 5 แต่ไม่มีใครเปิด NC ต้องไม่ได้คะแนนฟรีบน 25% ***", () => {
    const bad = team({ teamId: "bad", teamName: "ทีมที่ลูกค้าให้ 2 ดาว", jobCount: 5, csatSum: 2 * 5, csatCount: 5 });
    const good = team({
      teamId: "good", teamName: "ทีมที่ทำงานดีจริง", jobCount: 12, csatSum: 4.5 * 12, csatCount: 12,
      onTimeBase: 12, onTimeCount: 11, firstPassBase: 12, firstPassCount: 10,
    });
    const [badScore, goodScore] = scoreAllTeams([bad, good]);

    // ข้อสมมติของเคส: ทีมแย่ทีมนี้ผ่านประตูทั้งสองข้อจริง ๆ (งาน 5 ใบ, หลักฐาน 5 จุด) และได้ดาว
    expect(badScore.isProvisional).toBe(false);
    expect(badScore.directEvidence).toBe(5);

    // ของเดิมด้าน NC ให้ 94.4 กับทีมนี้ฟรี ๆ ตอนนี้ได้ค่ากลางเท่าด้านที่ไม่มีข้อมูล
    expect(badScore.ncrCredibility).toBe(0);
    expect(ncrOf(badScore).raw).toBeNull();
    expect(ncrOf(badScore).sample).toBe(0);
    expect(ncrOf(badScore).score).toBe(NEUTRAL_PRIOR);
    // แต่ยังถือน้ำหนักเต็ม 25% ไม่มีการเกลี่ยน้ำหนักไปให้ด้านอื่น (นโยบายเดิมของไฟล์นี้)
    expect(ncrOf(badScore).weight).toBe(EVAL_WEIGHTS.ncr);

    // สัญญาณที่ตรงที่สุดต้องเป็นตัวที่ฉุดคะแนน ไม่ใช่ถูกกลบด้วยความเงียบ
    expect(badScore.components.find((c) => c.key === "csat")!.score!).toBeLessThan(NEUTRAL_PRIOR);
    expect(badScore.evalAvg!).toBeLessThan(3.4);
    expect(goodScore.evalScore!).toBeGreaterThan(badScore.evalScore! + 10);
  });

  it("*** ทีมที่สะอาดจริงในบริษัทที่เปิด NC เป็นปกติ ต้องได้ประโยชน์จากความสะอาดนั้น ***", () => {
    const filing = scoreAllTeams([filer(), clean()]);
    const silent = scoreAllTeams([{ ...filer(), ncrWeighted: 0, ncrCount: 0 }, clean()]);
    const cleanFiling = filing.find((s) => s.teamId === "clean")!;
    const cleanSilent = silent.find((s) => s.teamId === "clean")!;

    expect(cleanFiling.ncrCredibility).toBeGreaterThan(0.5);
    expect(cleanFiling.ncrEvidenceJobs).toBe(Math.floor(20 * cleanFiling.ncrCredibility));
    // ศูนย์ NC ในบริษัทที่ตรวจจริง = หลักฐานคุณภาพ ต้องได้คะแนนสูงกว่าค่ากลางชัดเจน
    expect(ncrOf(cleanFiling).raw).toBe(100);
    expect(ncrOf(cleanFiling).score!).toBeGreaterThan(ncrOf(cleanSilent).score! + 20);
    expect(cleanFiling.evalScore!).toBeGreaterThan(cleanSilent.evalScore!);
    expect(cleanFiling.directEvidence).toBe(cleanSilent.directEvidence + cleanFiling.ncrEvidenceJobs);
    // และต้องนำทีมที่โดนเปิด NC บ่อยในบริษัทเดียวกัน
    expect(cleanFiling.evalScore!).toBeGreaterThan(filing.find((s) => s.teamId === "filer")!.evalScore!);
  });

  it("*** วันที่ใบ NC ใบแรกของบริษัทถูกเปิด คะแนนต้องไม่กระชากข้ามคืน ***", () => {
    const a = team({ teamId: "A", jobCount: 23, csatSum: 12, csatCount: 3, onTimeBase: 1, onTimeCount: 0 });
    const b = team({ teamId: "B", jobCount: 19, csatSum: 5, csatCount: 1, onTimeBase: 2, onTimeCount: 1 });
    const day0 = scoreAllTeams([a, b]);
    const day1 = scoreAllTeams([a, { ...b, ncrWeighted: 1, ncrCount: 1 }]);

    day0.forEach((before, index) => {
      const after = day1[index];
      expect(Math.abs(after.evalAvg! - before.evalAvg!)).toBeLessThan(0.1);
      // และต้องไม่มีทีมไหนข้ามประตูดาวได้เพราะใบเดียวนั้น (เหตุผลที่ปัดเศษลง ไม่ใช่ปัดใกล้)
      expect(after.isProvisional).toBe(before.isProvisional);
    });
  });

  it("งานที่ไม่มี NC นับเป็นหลักฐานได้เฉพาะในบริษัทที่เปิด NC จริง — ประตูดาวจึงขยับตามความจริง", () => {
    const thin = team({ teamId: "thin", jobCount: 20, csatSum: 16, csatCount: 4 });
    const silent = scoreTeam(thin, [thin]);
    expect(silent.directEvidence).toBe(4);
    expect(silent.isProvisional).toBe(true);

    const [thinFiling] = scoreAllTeams([thin, filer()]);
    expect(thinFiling.ncrEvidenceJobs).toBeGreaterThan(0);
    expect(thinFiling.directEvidence).toBe(4 + thinFiling.ncrEvidenceJobs);
    expect(thinFiling.isProvisional).toBe(false);
  });

  it("ค่ากลางด้าน NC ของทั้งบริษัทก็ต้องไม่ได้มาจากความเงียบ (รูรั่วที่ลึกกว่าตัวอย่างรายทีม)", () => {
    const silentFleet = [team({ teamId: "s1", jobCount: 40 }), team({ teamId: "s2", jobCount: 60 })];
    // ของเดิม: pooled = ncrToScore(0, 100) = 100 -> ค่ากลาง ~97 ทั้งที่ไม่มีใครเปิด NC เลยสักใบ
    expect(fleetPrior("ncr", silentFleet)).toBe(NEUTRAL_PRIOR);
    // พอบริษัทเปิด NC จริง ค่ากลางถึงจะเริ่มขยับตามของจริง
    const filingFleet = [{ ...silentFleet[0], ncrWeighted: 6, ncrCount: 9 }, silentFleet[1]];
    expect(fleetPrior("ncr", filingFleet)).toBeGreaterThan(NEUTRAL_PRIOR);
    expect(fleetPrior("ncr", filingFleet)).toBeLessThan(100);
  });

  it("payload ที่ส่งให้ apply_tech_team_eval_scores พาความน่าเชื่อไปด้วย เพื่อให้หน้าจอกางที่มาได้", () => {
    const [payload] = toApplyPayload(scoreAllTeams([clean(), filer()]));
    expect(payload.ncrCredibility).toBeGreaterThan(0);
    expect(payload.ncrSample).toBeGreaterThan(0);
    const [silentPayload] = toApplyPayload(scoreAllTeams([clean()]));
    expect(silentPayload.ncrCredibility).toBe(0);
    expect(silentPayload.ncrSample).toBe(0);
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

  const guardMigration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260902240000_eval_nc_silence_is_not_evidence.sql"),
    "utf8",
  );

  it("เกณฑ์หลักฐานขั้นต่ำใน TS ถูกย้ำเป็น check constraint ที่ตาราง เท่าระดับเดียวกับเกณฑ์งาน 3 ใบ", () => {
    expect(guardMigration).toContain(`check (direct_evidence >= ${MIN_DIRECT_EVIDENCE} or is_provisional)`);
  });

  it("ตารางบังคับเองว่า ถ้าระบบ NC ไม่น่าเชื่อ จะมีงานถูกนับเป็นตัวอย่างด้าน NC ไม่ได้", () => {
    expect(guardMigration).toContain("check (coalesce(ncr_credibility, 0) > 0 or ncr_sample = 0)");
    expect(guardMigration).toContain("check (ncr_credibility is null or (ncr_credibility >= 0 and ncr_credibility <= 1))");
  });
});

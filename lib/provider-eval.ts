/**
 * P4-9 — คะแนนประเมินทีมช่าง/ผู้ให้บริการ: คณิตศาสตร์ล้วน ไม่มี I/O
 *
 * ทำไมคณิตศาสตร์ต้องอยู่ที่นี่ ไม่ใช่ใน SQL:
 *   วิธี "นับ" ของจริง (มีกี่งาน กี่ NC ตรงนัดกี่ใบ) เปลี่ยนน้อยและต้องอยู่ใกล้ข้อมูล -> อยู่ใน
 *   public.tech_team_eval_inputs()  ส่วนวิธี "ให้คะแนน" (ถ่วงน้ำหนักเท่าไร ตัวอย่างน้อยทำยังไง)
 *   เป็นเรื่องนโยบายที่จะถูกเถียงและแก้บ่อย จึงต้องอยู่ในที่ที่เขียนเทสครอบได้ทุกกรณี
 *
 * ------------------------------------------------------------------------
 * น้ำหนักที่เลือก และเหตุผล
 * ------------------------------------------------------------------------
 *   ความพอใจลูกค้า (CSAT)      40%  = เสียงเดียวจากนอกบริษัท ปลอมยากที่สุด และเป็นผลลัพธ์ที่เราขาย
 *   ข้อบกพร่อง (NC)            25%  = สิ่งที่บริษัทตรวจเจอเอง มีหลักฐานเป็นใบ ไม่ใช่ความรู้สึก
 *   ตรงนัด                     25%  = ต้นทุนที่ลูกค้าจ่ายก่อนจะรู้ว่างานดีหรือไม่ดี และวัดจากเวลาจริง
 *   ผ่านตรวจรับครั้งแรก (FTP)  10%  = สัญญาณคุณภาพที่ละเอียดที่สุด แต่เพิ่งเริ่มเก็บ และซ้อนกับ NC อยู่แล้ว
 *   ด้านที่ยังไม่มีข้อมูลเลยจะถูก "ตัดออกแล้วเกลี่ยน้ำหนักที่เหลือ" ไม่ใช่คิดเป็นศูนย์
 *   เพราะการไม่มีข้อมูลไม่ใช่ผลงานที่แย่ และการให้ 0 จะลงโทษทีมใหม่โดยไม่มีเหตุผล
 *
 * ------------------------------------------------------------------------
 * กฎกลุ่มตัวอย่างเล็ก — หัวใจของงานนี้
 * ------------------------------------------------------------------------
 *   ปัญหาที่ต้องกันให้ได้: ทีมที่มีงานใบเดียวแล้วบังเอิญได้ 5 ดาว ต้องไม่ขึ้นนำทีมที่ทำมา 50 งาน
 *   วิธีที่ใช้คือการหดเข้าหาค่ากลาง (shrinkage) สองชั้น:
 *
 *   ชั้นที่ 1 — ค่ากลางของทั้งบริษัทเอง ก็ถูกหดเข้าหาค่ากลาง "เฉย ๆ" 70 ด้วยน้ำหนัก 10 งาน
 *       prior = (ตัวอย่างทั้งบริษัท x ค่าเฉลี่ยทั้งบริษัท + 10 x 70) / (ตัวอย่างทั้งบริษัท + 10)
 *       จำเป็น เพราะถ้าทั้งบริษัทมีข้อมูลอยู่ทีมเดียว ค่ากลาง "ของบริษัท" ก็คือทีมนั้นเอง
 *       การหดเข้าหาตัวเองไม่ได้แก้อะไรเลย ต้องมีจุดยึดที่ไม่ได้มาจากข้อมูลด้วย
 *
 *   ชั้นที่ 2 — คะแนนรายด้านของทีมถูกหดเข้าหา prior ด้วยน้ำหนัก 5 งาน
 *       score = (n x ค่าดิบของทีม + 5 x prior) / (n + 5)   โดย n = ตัวอย่างของ "ด้านนั้น"
 *       ตอบคำถามว่า "ตัวเลขด้านนี้เชื่อได้แค่ไหน" — ลูกค้าให้คะแนนมาใบเดียวไม่เท่ากับห้าสิบใบ
 *       ด้านที่ยังไม่มีข้อมูลเลย ได้ค่า prior ไปตรง ๆ (n = 0) ไม่ใช่ถูกตัดออกจากการคิด
 *       จุดนี้สำคัญ: ถ้าตัดออกแล้วเกลี่ยน้ำหนัก ทีมที่มีข้อมูลเฉพาะด้านที่ตัวเองเด่น
 *       จะถูกตัดสินจากด้านที่เด่นล้วน ๆ ซึ่งเป็นการเลือกสนามเอง
 *
 *   ชั้นที่ 3 — คะแนนรวมถูกหดเข้าหา 70 อีกครั้งด้วย "จำนวนงานทั้งหมดของทีม"
 *       evalScore = (jobCount x คะแนนรวม + 5 x 70) / (jobCount + 5)
 *       ชั้นที่ 2 ตอบว่า "เชื่อตัวเลขด้านนี้ได้แค่ไหน"  ชั้นที่ 3 ตอบคนละคำถามคือ
 *       "เรารู้จักทีมนี้ดีแค่ไหน" — ทีมที่ทำมา 1 งานต่อให้ทุกด้านสวย เราก็ยังไม่รู้จักเขา
 *       ผลจริงจากเทส: ทีม 1 งาน 5 ดาว ได้ราว 73  ส่วนทีม 50 งานที่ทำได้จริง ได้ราว 86
 *
 *   ประตูสุดท้าย — สองเงื่อนไขต้องผ่านพร้อมกันจึงจะประกาศดาว (ไม่งั้น is_provisional)
 *       ก) งานอย่างน้อย 3 ใบ — งานเดียวยังแยกไม่ออกว่าเป็นฝีมือหรือเป็นวันโชคดี
 *       ข) "หลักฐานที่ถูกบันทึกจริง" อย่างน้อย 5 จุด
 *          = คะแนนลูกค้า + งานที่เทียบวันนัดได้ + ผลตรวจรับ + งานที่นับเป็นหลักฐาน NC ได้จริง
 *          ก้อนสุดท้ายเป็น 0 ตราบใดที่ยังไม่มีใครเปิดใบ NC ในบริษัทนี้ (ดูหัวข้อถัดไป)
 *          ถ้าไม่มีข้อนี้ ทีมที่ไม่มีข้อมูลอะไรเลยจะได้ดาวราว 3.6 ดวงจากความว่างเปล่า
 *       คะแนนยังคำนวณและแสดงพร้อมคำว่า "ยังไม่นิ่ง" เพื่อความโปร่งใส แต่จะไม่ถูกเขียนกลับไปที่
 *       tech_teams.eval_avg ที่หน้าจอเอาไปโชว์เป็นดาว
 *       เงื่อนไขทั้ง (ก) และ (ข) ถูกย้ำเป็น check constraint ที่ตาราง จึงข้ามด้วยโค้ดฝั่งไหนก็ไม่ได้
 *       (ข้อ ก: tech_team_eval_scores_small_sample_is_provisional
 *        ข้อ ข: tech_team_eval_scores_thin_evidence_is_provisional — เพิ่มใน P4-9.2)
 *
 * ------------------------------------------------------------------------
 * ความเงียบจากระบบ NC ไม่ใช่คุณภาพ (P4-9.2 — แก้ตามผลรีวิว)
 * ------------------------------------------------------------------------
 *   ของเดิมพังตรงไหน: ด้าน NC ให้ค่าดิบ 100 ทันทีที่ ncrWeighted = 0 และยังส่ง "จำนวนงานทั้งหมด"
 *   เข้าไปเป็นจำนวนตัวอย่างด้วย ด้านนี้จึงแทบไม่ถูกหดเข้าหาค่ากลางเลย ทั้งที่วันนี้ ncr_reports
 *   มี 0 แถวทั้งระบบ — ไม่เคยมีใครเปิดใบ NC สักใบ แปลว่าทุกทีมได้คะแนนเกือบเต็มบน 25%
 *   ของคะแนนรวม จากข้อเท็จจริงที่ว่า "ฟีเจอร์หนึ่งยังไม่มีใครใช้" ไม่ใช่จากการทำงานที่ดี
 *   (ของจริงในฐานข้อมูลตอนพบปัญหา: ค่ากลางด้าน NC = 94.2 คะแนนด้าน NC ของทีม 23 งาน = 99.0)
 *
 *   กฎใหม่: "ไม่มีใครเปิด NC ใส่ทีมนี้" จะถูกนับเป็นข่าวดีก็ต่อเมื่อมีเหตุให้เชื่อว่าระบบ NC
 *   ถูกใช้จริง ความเชื่อนั้นวัดจากพฤติกรรม "ทั้งบริษัท" ไม่ใช่ของทีมใดทีมหนึ่ง (ทีมเลี่ยงเองไม่ได้):
 *
 *       ncrProcessCredibility = ปริมาณ x อัตรา   (0 ถึง 1)
 *         ปริมาณ = ใบ NC ทั้งบริษัท / (ใบ NC ทั้งบริษัท + 10)
 *                  หนึ่งสองใบยังเป็นแค่ "มีคนลองกดดู" ไม่ใช่กระบวนการที่เดินอยู่จริง
 *         อัตรา  = min(1, (ใบ NC ทั้งบริษัท / งานทั้งบริษัท) / 0.05)
 *                  บริษัทรับเหมาปูพื้นที่เจอข้อบกพร่องน้อยกว่า 1 ใน 20 งาน ไม่ใช่บริษัทที่ไม่มี
 *                  ข้อบกพร่อง แต่คือบริษัทที่ยังไม่ได้มอง — สองตัวนี้ตอบคนละคำถาม จึงคูณกัน
 *
 *   ตัวคูณนี้ถูกใช้สี่ที่ ไม่ใช่ที่เดียว เพราะแก้ที่เดียวรูรั่วยังอยู่ครบ:
 *     1) จำนวนตัวอย่างของด้าน NC = floor(จำนวนงานของทีม x ตัวคูณ) แทน "จำนวนงาน" เต็ม ๆ
 *        เป็น 0 ในโลกที่ยังไม่มีใครเปิด NC -> ด้านนี้ถูกหดเข้าหาค่ากลางเต็มที่ เท่ากับด้านที่ไม่มีข้อมูล
 *     2) ค่าดิบเป็น null เมื่อจำนวนตัวอย่างที่นับได้เป็น 0 -> หน้าจอพูดตรง ๆ ว่า "ยังไม่มีข้อมูล
 *        ใช้ค่ากลาง" และทีมที่ไม่มีอะไรเลยนอกจากจำนวนงาน กลายเป็น hasData = false ตามความจริง
 *        (ของเดิมทีมแบบนั้นมีคะแนนขึ้นจอ ทั้งที่ไม่มีใครบันทึกอะไรเกี่ยวกับคุณภาพของมันเลย)
 *     3) ค่ากลางของทั้งบริษัทด้าน NC ถูกถ่วงด้วย (ตัวอย่างทั้งบริษัท x ตัวคูณ) ด้วย
 *        ข้อนี้ขาดไม่ได้เด็ดขาด: ถ้าแก้แค่ข้อ 1-2 ค่ากลางจะยังเป็น ~100 (เพราะทั้งบริษัทไม่มี NC)
 *        แล้วด้านที่ "ไม่มีข้อมูล" ก็รับ ~100 ไปเต็ม ๆ อยู่ดี รูรั่วเดิมทุกประการแต่ซ่อนลึกกว่าเดิม
 *     4) directEvidence บวก floor(จำนวนงาน x ตัวคูณ) เข้าไปด้วย
 *        โลกที่ไม่มีใครเปิด NC = บวก 0 (เท่าเดิมทุกอย่าง) ส่วนโลกที่บริษัทเปิด NC เป็นปกติ
 *        "งานที่ผ่านไปโดยไม่มีใครเปิด NC" คือการสังเกตที่มีคนทำจริง จึงควรนับเป็นหลักฐาน
 *        และทีมที่สะอาดจริงในบริษัทที่ตรวจจริง ได้ประโยชน์จากข้อนี้เต็ม ๆ ตามที่ควรได้
 *
 *   ทำไมเป็นเส้นโค้งต่อเนื่อง ไม่ใช่สวิตช์เปิด/ปิด:
 *     วันที่ใบ NC ใบแรกของบริษัทถูกเปิด คะแนนของทุกทีมต้องไม่กระโดดข้ามคืน ตัวคูณจึงไต่ทีละน้อย
 *     (ใบแรกได้ตัวคูณราว 0.09) ผลต่อดาวของแต่ละทีมในคืนนั้นน้อยกว่า 0.1 ดวง
 *     ถ้าใช้เกณฑ์แบบ "ครบ 5 ใบแล้วเปิดเต็ม" คะแนนทั้งบริษัทจะกระชากในคืนเดียว ซึ่งแย่พอกัน
 *
 *   ราคาที่ยอมจ่าย: ในโลกที่ยังไม่มีใครเปิด NC ทุกทีมได้ค่ากลาง 70 บน 25% ของคะแนน
 *   ระยะห่างระหว่างทีมจึงถูกบีบให้แคบลงประมาณหนึ่งในสี่ นั่นคือหน้าตาที่ถูกต้องของ
 *   "เรายังไม่รู้" — ไม่ใช่ข้อบกพร่อง และดีกว่าการแกล้งรู้ด้วยเลข 100 ที่ไม่มีที่มา
 */

export const PROVIDER_EVAL_METHOD_VERSION = "P4-9.2";

/** น้ำหนักของแต่ละด้าน — รวมกันได้ 1 เมื่อมีข้อมูลครบทุกด้าน */
export const EVAL_WEIGHTS = { csat: 0.4, ncr: 0.25, onTime: 0.25, firstTimePass: 0.1 } as const;
export type EvalComponentKey = keyof typeof EVAL_WEIGHTS;

export const EVAL_COMPONENT_LABELS: Record<EvalComponentKey, string> = {
  csat: "ความพอใจลูกค้า",
  ncr: "ข้อบกพร่อง (NC)",
  onTime: "ตรงนัด",
  firstTimePass: "ผ่านตรวจรับครั้งแรก",
};

export const EVAL_COMPONENT_SAMPLE_LABELS: Record<EvalComponentKey, string> = {
  csat: "งานที่ลูกค้าให้คะแนน",
  ncr: "งานที่นับเป็นหลักฐาน NC ได้จริง",
  onTime: "งานที่มีทั้งวันนัดและวันจบจริง",
  firstTimePass: "งานที่มีผลตรวจรับ",
};

/** น้ำหนักที่ทีมต้องมีผลงานเท่าไรคะแนนตัวเองถึงจะมีน้ำหนักเท่าค่ากลาง (หน่วย: งาน) */
export const SHRINK_K = 5;
/** ค่ากลาง "เฉย ๆ" ของทีมที่ยังไม่มีอะไรพิสูจน์ — ไม่ดีไม่แย่ */
export const NEUTRAL_PRIOR = 70;
/** น้ำหนักของค่ากลางเฉย ๆ ที่ถ่วงค่าเฉลี่ยทั้งบริษัทอีกชั้น (หน่วย: งาน) */
export const NEUTRAL_PRIOR_WEIGHT = 10;
/** งานขั้นต่ำก่อนประกาศดาวบน tech_teams.eval_avg — ต่ำกว่านี้ = ยังไม่นิ่ง */
export const MIN_JOBS_FOR_STARS = 3;
/** น้ำหนักการหดคะแนนรวมตามจำนวนงานทั้งหมดของทีม (หน่วย: งาน) */
export const CONFIDENCE_K = 5;
/** จุดข้อมูลที่ "ถูกบันทึกจริง" ขั้นต่ำก่อนประกาศดาว — งานที่ไม่มี NC นับได้เท่าที่ระบบ NC น่าเชื่อ */
export const MIN_DIRECT_EVIDENCE = 5;

/** NC ถ่วงน้ำหนักต่อ 1 งาน ที่ทำให้คะแนนด้าน NC เหลือ 0 */
export const NCR_TOLERANCE_PER_JOB = 0.5;

/** จำนวนใบ NC ทั้งบริษัทที่ทำให้ "ปริมาณการใช้ระบบ NC" ขึ้นไปครึ่งทาง (หน่วย: ใบ) */
export const NC_PROCESS_REPORTS_K = 10;
/** อัตราการเปิด NC ต่องาน ที่ถือว่าระบบถูกใช้เต็มที่แล้ว — 1 ใบต่อ 20 งาน */
export const NC_PROCESS_FULL_RATE = 0.05;

export interface TeamEvalInput {
  teamId: string;
  teamName: string;
  providerType: string | null;
  isActive: boolean;
  jobCount: number;
  /** ผลรวมคะแนนความพอใจ (1-5) ต่อ "งาน" ไม่ใช่ต่อใบประเมิน */
  csatSum: number;
  csatCount: number;
  ncrWeighted: number;
  ncrCount: number;
  onTimeCount: number;
  onTimeBase: number;
  firstPassCount: number;
  firstPassBase: number;
}

export interface EvalComponentScore {
  key: EvalComponentKey;
  label: string;
  /** ค่าดิบก่อนหด 0-100 (null = ไม่มีข้อมูลด้านนี้) */
  raw: number | null;
  /** คะแนนหลังหดเข้าหาค่ากลาง 0-100 */
  score: number | null;
  /** จำนวนงานที่ด้านนี้ยืนอยู่บน */
  sample: number;
  /** ค่ากลางที่ใช้หดในรอบนี้ */
  prior: number;
  /** น้ำหนักที่ใช้จริงหลังเกลี่ย (0 = ด้านนี้ไม่มีข้อมูล จึงไม่ถูกนับ) */
  weight: number;
}

export interface TeamEvalScore {
  teamId: string;
  teamName: string;
  providerType: string | null;
  methodVersion: string;
  jobCount: number;
  hasData: boolean;
  isProvisional: boolean;
  /** คะแนนรวมจากผลงานล้วน ๆ ก่อนถ่วงด้วยปริมาณงาน 0-100 (null = ไม่มีข้อมูลสักด้าน) */
  performanceScore: number | null;
  /** คะแนนรวมที่ใช้จริง = performanceScore หดตามจำนวนงานทั้งหมด 0-100 */
  evalScore: number | null;
  /** ดาว 0-5 = evalScore/20 (null เมื่อไม่มีข้อมูล) */
  evalAvg: number | null;
  ncrWeighted: number;
  ncrCount: number;
  /** จำนวนจุดข้อมูลที่มีคนบันทึกไว้จริง (คะแนนลูกค้า + งานที่เทียบวันนัดได้ + ผลตรวจรับ + งานที่นับ NC ได้) */
  directEvidence: number;
  /** ระบบ NC ของทั้งบริษัทน่าเชื่อแค่ไหน 0-1 — 0 = ยังไม่มีใครเปิดใบ NC เลย ความเงียบจึงไม่มีความหมาย */
  ncrCredibility: number;
  /** จำนวนงานของทีมที่นับเป็นหลักฐานด้าน NC ได้จริง = floor(jobCount x ncrCredibility) */
  ncrEvidenceJobs: number;
  components: EvalComponentScore[];
  /** คำอธิบายภาษาไทยว่าทำไมคะแนนนี้ถึงแสดงแบบนี้ */
  reason: string;
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** คะแนนความพอใจ 1-5 -> 0-100 (1 ดาว = 0 คะแนน ไม่ใช่ 20 เพราะ 1 ดาวคือแย่ที่สุดที่ให้ได้) */
export function csatToScore(average: number): number {
  return clamp(((average - 1) / 4) * 100);
}

/** NC ถ่วงน้ำหนักต่องาน -> 0-100 */
export function ncrToScore(weighted: number, jobs: number): number {
  if (jobs <= 0) return NEUTRAL_PRIOR;
  return clamp(100 * (1 - weighted / jobs / NCR_TOLERANCE_PER_JOB));
}

/**
 * ระบบ NC ของ "ทั้งบริษัท" ถูกใช้จริงแค่ไหน — 0 ถึง 1
 *
 * นี่คือหัวใจของกฎ "ความเงียบไม่ใช่คุณภาพ": ตราบใดที่ยังไม่มีใครเปิดใบ NC เลย
 * การที่ทีมหนึ่งไม่มี NC ไม่ได้แปลว่าทีมนั้นทำงานดี แปลว่าเราไม่ได้มอง
 * ตัวเลขนี้จึงอ่านจากพฤติกรรมของทั้งบริษัทเท่านั้น ทีมใดทีมหนึ่งทำให้ตัวเองดูดีด้วยตัวนี้ไม่ได้
 *
 * สองปัจจัยตอบคนละคำถาม จึงคูณกัน ไม่ใช่เลือกอันใดอันหนึ่ง:
 *   ปริมาณ — "มีการใช้จริงหรือแค่มีคนลองกด" (หด: c / (c + 10))
 *   อัตรา  — "ใช้ในระดับที่สมเหตุสมผลกับปริมาณงานหรือไม่" (min(1, rate / 0.05))
 */
export function ncrProcessCredibility(fleet: TeamEvalInput[]): number {
  let reports = 0;
  let jobs = 0;
  for (const member of fleet) {
    reports += Math.max(0, num(member.ncrCount));
    jobs += Math.max(0, num(member.jobCount));
  }
  if (reports <= 0 || jobs <= 0) return 0;
  const volume = reports / (reports + NC_PROCESS_REPORTS_K);
  const rate = Math.min(1, reports / jobs / NC_PROCESS_FULL_RATE);
  return clamp(volume * rate, 0, 1);
}

interface RawComponent {
  raw: number | null;
  sample: number;
  /** ตัวตั้ง/ตัวหารสำหรับรวมเป็นค่ากลางทั้งบริษัท */
  poolNumerator: number;
  poolDenominator: number;
}

function rawComponents(input: TeamEvalInput): Record<EvalComponentKey, RawComponent> {
  const csatAvg = input.csatCount > 0 ? input.csatSum / input.csatCount : null;
  return {
    csat: {
      raw: csatAvg === null ? null : csatToScore(csatAvg),
      sample: input.csatCount,
      poolNumerator: input.csatSum,
      poolDenominator: input.csatCount,
    },
    ncr: {
      // ฐานของด้านนี้คือ "ทุกงานของทีม" เพราะงานที่ไม่มี NC คือข้อมูลที่ดี ไม่ใช่ข้อมูลที่ขาด
      raw: input.jobCount > 0 ? ncrToScore(input.ncrWeighted, input.jobCount) : null,
      sample: input.jobCount,
      poolNumerator: input.ncrWeighted,
      poolDenominator: input.jobCount,
    },
    onTime: {
      raw: input.onTimeBase > 0 ? clamp((input.onTimeCount / input.onTimeBase) * 100) : null,
      sample: input.onTimeBase,
      poolNumerator: input.onTimeCount,
      poolDenominator: input.onTimeBase,
    },
    firstTimePass: {
      raw: input.firstPassBase > 0 ? clamp((input.firstPassCount / input.firstPassBase) * 100) : null,
      sample: input.firstPassBase,
      poolNumerator: input.firstPassCount,
      poolDenominator: input.firstPassBase,
    },
  };
}

/**
 * ค่ากลางที่ใช้หด = ค่าเฉลี่ยรวมทั้งบริษัท ที่ถูกหดเข้าหา NEUTRAL_PRIOR อีกชั้นหนึ่ง
 * ชั้นที่สองคือสิ่งที่กันกรณี "ทั้งบริษัทมีข้อมูลอยู่ทีมเดียว" ไม่ให้ทีมนั้นหดเข้าหาตัวเอง
 */
export function fleetPrior(key: EvalComponentKey, inputs: TeamEvalInput[]): number {
  let numerator = 0;
  let denominator = 0;
  for (const input of inputs) {
    const component = rawComponents(input)[key];
    numerator += component.poolNumerator;
    denominator += component.poolDenominator;
  }
  if (denominator <= 0) return NEUTRAL_PRIOR;

  const pooledRaw =
    key === "csat" ? csatToScore(numerator / denominator)
    : key === "ncr" ? ncrToScore(numerator, denominator)
    : clamp((numerator / denominator) * 100);

  // ด้าน NC: น้ำหนักของ "ค่าเฉลี่ยทั้งบริษัท" ถูกลดตามความน่าเชื่อของระบบ NC
  // ถ้าไม่มีใครเปิดใบ NC เลย ค่ากลางด้านนี้คือ 70 เฉย ๆ ไม่ใช่ ~100 ที่ได้มาจากความเงียบ
  // (ขาดข้อนี้ การแก้ที่ตัวอย่างรายทีมจะไร้ผล เพราะทีมที่ไม่มีข้อมูลรับค่ากลางไปเต็ม ๆ อยู่ดี)
  const weight = key === "ncr" ? denominator * ncrProcessCredibility(inputs) : denominator;
  if (weight <= 0) return NEUTRAL_PRIOR;

  return (weight * pooledRaw + NEUTRAL_PRIOR_WEIGHT * NEUTRAL_PRIOR) / (weight + NEUTRAL_PRIOR_WEIGHT);
}

/** หดค่าดิบเข้าหาค่ากลางตามจำนวนตัวอย่าง — สูตรเดียวที่ใช้กับทุกด้าน */
export function shrink(raw: number, sample: number, prior: number): number {
  if (sample <= 0) return prior;
  return (sample * raw + SHRINK_K * prior) / (sample + SHRINK_K);
}

export function scoreTeam(input: TeamEvalInput, fleet: TeamEvalInput[]): TeamEvalScore {
  const raws = rawComponents(input);
  const keys = Object.keys(EVAL_WEIGHTS) as EvalComponentKey[];

  // ความเงียบจากระบบ NC ไม่ใช่คุณภาพ — งานของทีมจะถูกนับเป็นหลักฐานด้าน NC
  // ตามสัดส่วนที่ระบบ NC ของทั้งบริษัทถูกใช้จริงเท่านั้น (ดูหัวไฟล์ ข้อ 1 และ 2)
  const ncrCredibility = ncrProcessCredibility(fleet);
  // ปัดลง (floor) ไม่ใช่ปัดใกล้: เศษของงานไม่นับเป็นการสังเกต ต้องได้ครบหนึ่งงานเต็มก่อน
  // ผลข้างเคียงที่ตั้งใจ: วันที่ใบ NC ใบแรกถูกเปิด ไม่มีทีมไหนข้ามประตูหลักฐานเพราะเศษทศนิยม
  const ncrEvidenceJobs = Math.floor(Math.max(0, input.jobCount) * ncrCredibility);
  raws.ncr.sample = ncrEvidenceJobs;
  if (ncrEvidenceJobs <= 0) raws.ncr.raw = null;

  const withData = keys.filter((key) => raws[key].raw !== null);

  const components: EvalComponentScore[] = keys.map((key) => {
    const prior = fleetPrior(key, fleet);
    const rawValue = raws[key].raw;
    return {
      key,
      label: EVAL_COMPONENT_LABELS[key],
      raw: rawValue === null ? null : round(rawValue),
      // ด้านที่ไม่มีข้อมูล (sample = 0) ได้ค่ากลางไปตรง ๆ ไม่ใช่ 0 และไม่ใช่การถูกตัดออก
      score: round(shrink(rawValue ?? prior, raws[key].sample, prior)),
      sample: raws[key].sample,
      prior: round(prior),
      // ทุกด้านถือน้ำหนักเต็มเสมอ ไม่มีการเกลี่ย — ทีมจึงเลือกสนามที่ตัวเองเด่นไม่ได้
      weight: EVAL_WEIGHTS[key],
    };
  });

  const hasData = withData.length > 0;
  const performance = components.reduce((sum, component) => sum + (component.score ?? 0) * component.weight, 0);
  const performanceScore = hasData ? round(performance) : null;
  // ชั้นที่ 3 — หดตามจำนวนงานทั้งหมด: ตอบคำถาม "เรารู้จักทีมนี้ดีแค่ไหน"
  const evalScore = hasData
    ? round((input.jobCount * performance + CONFIDENCE_K * NEUTRAL_PRIOR) / (input.jobCount + CONFIDENCE_K))
    : null;
  // หลักฐานที่ "มีคนดูจริง" — งานที่ผ่านไปโดยไม่มีใครเปิด NC นับได้เท่าที่ระบบ NC น่าเชื่อ
  // (โลกที่ยังไม่มีใครเปิด NC บวก 0 เท่ากับพฤติกรรมเดิมทุกประการ)
  const directEvidence = input.csatCount + input.onTimeBase + input.firstPassBase + ncrEvidenceJobs;
  const isProvisional =
    !hasData || input.jobCount < MIN_JOBS_FOR_STARS || directEvidence < MIN_DIRECT_EVIDENCE;

  return {
    teamId: input.teamId,
    teamName: input.teamName,
    providerType: input.providerType,
    methodVersion: PROVIDER_EVAL_METHOD_VERSION,
    jobCount: input.jobCount,
    hasData,
    isProvisional,
    performanceScore,
    evalScore,
    evalAvg: evalScore === null ? null : round(evalScore / 20, 2),
    ncrWeighted: round(input.ncrWeighted, 2),
    ncrCount: input.ncrCount,
    directEvidence,
    ncrCredibility: round(ncrCredibility, 3),
    ncrEvidenceJobs,
    components,
    reason: evalReason(hasData, isProvisional, input.jobCount, directEvidence, withData.length, keys.length, ncrCredibility),
  };
}

export function evalReason(
  hasData: boolean,
  isProvisional: boolean,
  jobCount: number,
  directEvidence: number,
  componentsWithData: number,
  componentsTotal: number,
  ncrCredibility = 0,
): string {
  // ต้องพูดออกมาให้คนอ่านรู้ ไม่ใช่ให้เขาเดาว่าทำไมด้าน NC ถึงไม่มีคะแนนของตัวเอง
  const silentNc = ncrCredibility <= 0
    ? " · ด้าน NC ยังไม่นับเป็นหลักฐาน เพราะทั้งบริษัทยังไม่มีการเปิดใบ NC จริง — การไม่มีข่าวร้ายยังไม่ใช่ข่าวดี"
    : "";
  if (!hasData) {
    if (jobCount > 0) {
      return `มีงาน ${jobCount} ใบ แต่ยังไม่มีใครบันทึกหลักฐานคุณภาพไว้เลย จึงยังให้คะแนนไม่ได้${silentNc}`;
    }
    return "ยังไม่มีข้อมูลสักด้าน จึงยังให้คะแนนไม่ได้";
  }
  const coverage = `ใช้ข้อมูล ${componentsWithData} จาก ${componentsTotal} ด้าน`;
  if (!isProvisional) return `คิดจากงาน ${jobCount} ใบ (${coverage})${silentNc}`;
  if (jobCount < MIN_JOBS_FOR_STARS) {
    return `ยังไม่นิ่ง — มีงานที่นับได้ ${jobCount} ใบ ต้องมีอย่างน้อย ${MIN_JOBS_FOR_STARS} ใบจึงจะประกาศดาว (${coverage})${silentNc}`;
  }
  return `ยังไม่นิ่ง — มีหลักฐานที่บันทึกไว้จริง ${directEvidence} จุด ต้องมีอย่างน้อย ${MIN_DIRECT_EVIDENCE} จุด `
    + `(คะแนนลูกค้า/งานที่เทียบวันนัดได้/ผลตรวจรับ/งานที่นับ NC ได้) จึงจะประกาศดาว (${coverage})${silentNc}`;
}

export function scoreAllTeams(inputs: TeamEvalInput[]): TeamEvalScore[] {
  return inputs.map((input) => scoreTeam(input, inputs));
}

/** แปลง payload ที่ RPC tech_team_eval_inputs() ส่งมาให้เป็น input ที่คำนวณได้ — ทนของที่ขาด */
export function parseEvalInputs(value: unknown): TeamEvalInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const teamId = typeof raw.teamId === "string" ? raw.teamId : "";
    if (!teamId) return [];
    return [{
      teamId,
      teamName: typeof raw.teamName === "string" ? raw.teamName : "ไม่ทราบชื่อทีม",
      providerType: typeof raw.providerType === "string" ? raw.providerType : null,
      isActive: raw.isActive !== false,
      jobCount: num(raw.jobCount),
      csatSum: num(raw.csatSum),
      csatCount: num(raw.csatCount),
      ncrWeighted: num(raw.ncrWeighted),
      ncrCount: num(raw.ncrCount),
      onTimeCount: num(raw.onTimeCount),
      onTimeBase: num(raw.onTimeBase),
      firstPassCount: num(raw.firstPassCount),
      firstPassBase: num(raw.firstPassBase),
    }];
  });
}

function componentOf(score: TeamEvalScore, key: EvalComponentKey): EvalComponentScore | undefined {
  return score.components.find((component) => component.key === key);
}

/** แปลงผลคะแนนเป็นรูปที่ apply_tech_team_eval_scores(jsonb) รับ */
export function toApplyPayload(scores: TeamEvalScore[]): Record<string, unknown>[] {
  return scores.map((score) => ({
    teamId: score.teamId,
    methodVersion: score.methodVersion,
    evalScore: score.evalScore,
    evalAvg: score.evalAvg,
    hasData: score.hasData,
    isProvisional: score.isProvisional,
    jobCount: score.jobCount,
    performanceScore: score.performanceScore,
    directEvidence: score.directEvidence,
    csatScore: componentOf(score, "csat")?.score ?? null,
    csatRaw: componentOf(score, "csat")?.raw ?? null,
    csatSample: componentOf(score, "csat")?.sample ?? 0,
    ncrScore: componentOf(score, "ncr")?.score ?? null,
    ncrRaw: componentOf(score, "ncr")?.raw ?? null,
    ncrSample: componentOf(score, "ncr")?.sample ?? 0,
    ncrWeighted: score.ncrWeighted,
    ncrCount: score.ncrCount,
    ncrCredibility: score.ncrCredibility,
    onTimeScore: componentOf(score, "onTime")?.score ?? null,
    onTimeRaw: componentOf(score, "onTime")?.raw ?? null,
    onTimeSample: componentOf(score, "onTime")?.sample ?? 0,
    ftpScore: componentOf(score, "firstTimePass")?.score ?? null,
    ftpRaw: componentOf(score, "firstTimePass")?.raw ?? null,
    ftpSample: componentOf(score, "firstTimePass")?.sample ?? 0,
  }));
}

import { describe, expect, it } from "vitest";
import { extractSurveyQuestions, parseGoogleSurveyCsv } from "./google-survey";

describe("Google satisfaction survey mapping", () => {
  it("extracts the five CS call questions from headers", () => {
    const questions = extractSurveyQuestions([
      "Timestamp", "เลขบิล", "1. ความพึงพอใจ ในการให้บริการ", "2. คุณภาพ ของงานติดตั้ง",
      "3. ความเรียบร้อย และความสะอาด หลังติดตั้ง", "4. การตรงต่อเวลาของทีมงาน",
      "5. ความสุภาพและการให้คำแนะนำจากทีมติดตั้ง", "คำแนะนำเพิ่มเติม",
    ]);
    expect(questions.map((question) => question.id)).toEqual([
      "service", "installation_quality", "tidiness", "punctuality", "manner_guidance",
    ]);
  });

  it("maps metadata by header and calculates the average without fixed score columns", () => {
    const csv = [
      '"เลขบิล","ชื่อลูกค้า","Timestamp","1. ความพึงพอใจ ในการให้บริการ","คำแนะนำเพิ่มเติม","2. คุณภาพ ของงานติดตั้ง"',
      '"QT-001","ลูกค้าทดสอบ","9/1/2026 10:00:00","5 คะแนน ดีมาก","ติดตามรอยต่อ","3 คะแนน ปานกลาง"',
    ].join("\n");
    const parsed = parseGoogleSurveyCsv(csv);
    expect(parsed.responses).toHaveLength(1);
    expect(parsed.responses[0]).toMatchObject({ bill: "QT-001", customer: "ลูกค้าทดสอบ", scores: [5, 3], overall: 4, comment: "ติดตามรอยต่อ" });
  });
});

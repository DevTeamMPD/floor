export const GOOGLE_SURVEY_SHEET_ID = "1xTJeN6HAhqX8wZ1RKFjm1yzrHaIPCnUpas7E_W2I50I";
export const GOOGLE_SURVEY_SOURCE_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SURVEY_SHEET_ID}/edit`;
const GOOGLE_SURVEY_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SURVEY_SHEET_ID}/gviz/tq?tqx=out:csv`;

export type SurveyQuestion = {
  id: string;
  order: number;
  label: string;
  shortLabel: string;
  columnIndex: number;
};

export type SurveyResponse = {
  timestamp: string;
  bill: string;
  serviceDate: string;
  contactDate: string;
  customer: string;
  phone: string;
  area: string;
  scores: (number | null)[];
  answers: Record<string, number | null>;
  overall: number | null;
  comment: string;
};

export type GoogleSurveyData = {
  headers: string[];
  questions: SurveyQuestion[];
  responses: SurveyResponse[];
};

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("th-TH");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else inQuotes = false;
      } else field += character;
    } else if (character === '"') inQuotes = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseScore(value: string): number | null {
  const match = (value || "").match(/(?:^|\D)([1-5])(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function shortQuestion(label: string) {
  return label.replace(/^\s*\d+\.\s*/, "").replace(/\s+/g, " ").trim();
}

function questionId(order: number, label: string) {
  const normalized = normalize(label);
  if (normalized.includes("ให้บริการ")) return "service";
  if (normalized.includes("คุณภาพ") && normalized.includes("ติดตั้ง")) return "installation_quality";
  if (normalized.includes("เรียบร้อย") || normalized.includes("สะอาด")) return "tidiness";
  if (normalized.includes("ตรงต่อเวลา")) return "punctuality";
  if (normalized.includes("สุภาพ") || normalized.includes("แนะนํา") || normalized.includes("แนะนำ")) return "manner_guidance";
  return `question_${order}`;
}

export function extractSurveyQuestions(headers: string[]): SurveyQuestion[] {
  return headers
    .map((header, columnIndex) => {
      const match = header.match(/^\s*(\d+)\.\s*(.+)$/);
      if (!match) return null;
      const order = Number.parseInt(match[1], 10);
      return { id: questionId(order, header), order, label: header.trim(), shortLabel: shortQuestion(header), columnIndex };
    })
    .filter((question): question is SurveyQuestion => question !== null)
    .sort((left, right) => left.order - right.order);
}

function columnIndex(headers: string[], alternatives: string[], fallback: number) {
  const normalized = headers.map(normalize);
  const found = normalized.findIndex((header) => alternatives.some((alternative) => header.includes(normalize(alternative))));
  return found >= 0 ? found : fallback;
}

export function parseGoogleSurveyCsv(csv: string): GoogleSurveyData {
  const rows = parseCsv(csv);
  const headers = rows[0]?.map((value) => value.trim()) ?? [];
  const questions = extractSurveyQuestions(headers);
  const indexes = {
    timestamp: columnIndex(headers, ["timestamp", "ประทับเวลา"], 0),
    bill: columnIndex(headers, ["เลขบิล", "เลขที่บิล"], 1),
    serviceDate: columnIndex(headers, ["วันที่เข้ารับบริการ"], 2),
    contactDate: columnIndex(headers, ["วันที่ติดต่อลูกค้า"], 3),
    customer: columnIndex(headers, ["ชื่อลูกค้า"], 4),
    phone: columnIndex(headers, ["เบอร์ติดต่อ", "เบอร์โทร"], 5),
    area: columnIndex(headers, ["จำนวนพื้นที่", "พื้นที่ในการติดตั้ง"], 6),
    comment: columnIndex(headers, ["คำแนะนำเพิ่มเติม", "ข้อเสนอแนะ"], headers.length - 1),
  };

  const responses: SurveyResponse[] = [];
  for (const row of rows.slice(1)) {
    const timestamp = (row[indexes.timestamp] || "").trim();
    const bill = (row[indexes.bill] || "").trim();
    const customer = (row[indexes.customer] || "").trim();
    if (!timestamp && !bill && !customer) continue;
    const scores = questions.map((question) => parseScore(row[question.columnIndex] || ""));
    const answers = Object.fromEntries(questions.map((question, index) => [question.id, scores[index]]));
    const validScores = scores.filter((score): score is number => score !== null);
    const overall = validScores.length ? Math.round((validScores.reduce((sum, score) => sum + score, 0) / validScores.length) * 100) / 100 : null;
    responses.push({
      timestamp, bill, customer,
      serviceDate: (row[indexes.serviceDate] || "").trim(), contactDate: (row[indexes.contactDate] || "").trim(),
      phone: (row[indexes.phone] || "").trim(), area: (row[indexes.area] || "").trim(),
      scores, answers, overall, comment: (row[indexes.comment] || "").trim(),
    });
  }
  return { headers, questions, responses };
}

export async function fetchGoogleSurvey(): Promise<GoogleSurveyData> {
  const response = await fetch(GOOGLE_SURVEY_CSV_URL, { redirect: "follow", next: { revalidate: 120 } });
  if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);
  return parseGoogleSurveyCsv(await response.text());
}

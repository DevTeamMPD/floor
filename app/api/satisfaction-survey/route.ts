import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff-server";

// Always run fresh; the upstream Google fetch is lightly cached below.
export const dynamic = "force-dynamic";

const SHEET_ID = "1xTJeN6HAhqX8wZ1RKFjm1yzrHaIPCnUpas7E_W2I50I";
// gviz CSV endpoint returns the first sheet (the Form responses) as clean CSV.
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

export type SurveyResponse = {
  timestamp: string;
  bill: string;
  customer: string;
  phone: string;
  // scores in fixed order: service, quality, tidiness, punctuality, manner
  scores: (number | null)[];
  overall: number | null;
  comment: string;
};

// Minimal CSV parser: handles quoted fields, escaped quotes, and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// "5 คะแนน ดีมาก" -> 5 ; returns null if no 1-5 digit found.
function parseScore(s: string): number | null {
  const m = (s || "").match(/([1-5])/);
  return m ? parseInt(m[1], 10) : null;
}

export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff || !["admin", "cs", "executive"].includes(staff.role)) {
    return NextResponse.json({ error: "unauthorized", responses: [] }, { status: 401 });
  }
  try {
    const res = await fetch(CSV_URL, { redirect: "follow", next: { revalidate: 120 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Sheet fetch failed: ${res.status}`, responses: [] },
        { status: 502 }
      );
    }
    const csv = await res.text();
    const rows = parseCsv(csv);

    const responses: SurveyResponse[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const timestamp = (row[0] || "").trim();
      const bill = (row[1] || "").trim();
      const customer = (row[4] || "").trim();
      if (!timestamp && !bill && !customer) continue;

      const scores = [
        parseScore(row[7] || ""),
        parseScore(row[8] || ""),
        parseScore(row[9] || ""),
        parseScore(row[10] || ""),
        parseScore(row[11] || ""),
      ];
      const valid = scores.filter((x): x is number => x !== null);
      const overall = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;

      responses.push({
        timestamp,
        bill,
        customer,
        phone: (row[5] || "").trim(),
        scores,
        overall: overall === null ? null : Math.round(overall * 100) / 100,
        comment: (row[12] || "").trim(),
      });
    }

    return NextResponse.json({
      responses,
      updatedAt: new Date().toISOString(),
      sourceUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), responses: [] }, { status: 500 });
  }
}

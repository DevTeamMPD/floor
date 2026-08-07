import { NextResponse } from "next/server";

// Always run fresh; the upstream Google fetch is lightly cached below.
export const dynamic = "force-dynamic";

const SHEET_ID = "1D67fn7RZ57uXJz6BODXGauJtnXWinY0ztEZibOLhcJo";
const GID = "2123481736";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

export type Status = "scheduled" | "tentative" | "unscheduled" | "design_pending";

export type SoftplayJob = {
  customer: string;
  spec: string;
  installDateText: string;
  installDateISO: string | null;
  phone: string;
  mapUrl: string;
  siteNote: string;
  hours: string;
  apptNote: string;
  status: Status;
};

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and newlines inside quotes.
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

// Parse a Thai short date like "12/8/69" or a range "13-14/8/69" (Buddhist short year) -> ISO of the first day.
function parseThaiDate(s: string): string | null {
  const m = s.match(/(\d{1,2})(?:\s*-\s*\d{1,2})?\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const raw = parseInt(m[3], 10);
  let year: number;
  if (raw < 100) year = 2500 + raw - 543; // 2-digit BE short year, e.g. 69 -> 2569 BE -> 2026 CE
  else if (raw > 2400) year = raw - 543; // full BE year
  else year = raw; // already CE
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function classify(installDateText: string, designPending: boolean): Status {
  if (designPending) return "design_pending";
  const t = installDateText || "";
  if (/ยังไม่กำหนด/.test(t)) return "unscheduled";
  if (parseThaiDate(t)) return "scheduled";
  if (/อาจจะ|ภายใน|น่า|ประมาณ/.test(t)) return "tentative";
  if (t.trim() === "") return "unscheduled";
  return "tentative";
}

export async function GET() {
  try {
    const res = await fetch(CSV_URL, { redirect: "follow", next: { revalidate: 120 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Sheet fetch failed: ${res.status}`, jobs: [], stock: [] },
        { status: 502 }
      );
    }
    const csv = await res.text();
    const rows = parseCsv(csv);

    const jobs: SoftplayJob[] = [];
    const stock: string[] = [];
    let designPending = false;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = (row[0] || "").trim();
      const sectionCell = (row[1] || "").trim();

      if (!name) {
        if (/รอเคลียร์แบบ/.test(sectionCell)) designPending = true;
        else if (/สต็อค|สต๊อก|เหลือ/.test(sectionCell)) stock.push(sectionCell);
        continue;
      }

      const installDateText = (row[3] || "").trim();
      jobs.push({
        customer: name,
        spec: (row[2] || "").trim(),
        installDateText,
        installDateISO: parseThaiDate(installDateText),
        phone: (row[4] || "").trim(),
        mapUrl: (row[5] || "").trim(),
        siteNote: (row[8] || "").trim(),
        hours: (row[9] || "").trim(),
        apptNote: (row[10] || "").trim(),
        status: classify(installDateText, designPending),
      });
    }

    return NextResponse.json({
      jobs,
      stock,
      updatedAt: new Date().toISOString(),
      sourceUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${GID}`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), jobs: [], stock: [] }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SHEET_ID = "1xTJeN6HAhqX8wZ1RKFjm1yzrHaIPCnUpas7E_W2I50I";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function parseScore(s: string): number | null { const m = (s || "").match(/([1-5])/); return m ? parseInt(m[1], 10) : null; }

async function runSync() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { error: "Supabase env missing", surveyed: 0, updated: 0 };
  const supabase = createClient(url, key);

  const res = await fetch(CSV_URL, { redirect: "follow", cache: "no-store" });
  if (!res.ok) return { error: `Sheet fetch failed: ${res.status}`, surveyed: 0, updated: 0 };
  const rows = parseCsv(await res.text());

  // order_no -> average score (keep latest occurrence)
  const map = new Map<string, number>();
  for (let r = 1; r < rows.length; r++) {
    const order = (rows[r][1] || "").trim();
    if (!order) continue;
    const scores = [rows[r][7], rows[r][8], rows[r][9], rows[r][10], rows[r][11]].map((x) => parseScore(x || "")).filter((x): x is number => x !== null);
    if (!scores.length) continue;
    const overall = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
    map.set(order, overall);
  }

  const nowIso = new Date().toISOString();
  const results = await Promise.all(
    Array.from(map.entries()).map(async ([order, overall]) => {
      const { data, error } = await supabase
        .from("install_jobs")
        .update({ stage: 6, eval_score: overall, eval_sent_at: nowIso })
        .or(`order_no.eq.${order},bill_no.eq.${order}`)
        .select("job_no");
      if (error) return 0;
      return (data ?? []).length;
    })
  );

  return { surveyed: map.size, updated: results.reduce((a, b) => a + b, 0) };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const out = await runSync();
    return NextResponse.json({ ...out, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export const POST = GET;

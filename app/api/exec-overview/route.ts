import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STAGES: { id: number; name: string }[] = [
  { id: 1, name: "รับ order" },
  { id: 2, name: "ยืนยันนัด + ใบส่งงาน" },
  { id: 3, name: "ระหว่างติดตั้ง" },
  { id: 4, name: "ติดตั้งสำเร็จ" },
  { id: 5, name: "รอประเมินหลังการขาย" },
  { id: 6, name: "เสร็จสิ้น" },
];

type Mov = { i140: number; r140: number; i110: number; r110: number };
function parseHandover(raw: unknown): Mov | null {
  if (!raw) return null;
  let h: unknown;
  try { h = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!h || typeof h !== "object") return null;
  const obj = h as { materials?: unknown; returnItems?: unknown };
  const s: Mov = { i140: 0, r140: 0, i110: 0, r110: 0 };
  let has = false;
  const acc = (arr: unknown, issued: boolean) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const m = it as { qty?: unknown; lengthCm?: unknown; widthCm?: unknown };
      const q = Number(m.qty) || 1;
      const len = Number(m.lengthCm ?? 0);
      if (len <= 0) continue;
      const w = String(m.widthCm);
      if (w === "140") { if (issued) s.i140 += q * len; else s.r140 += q * len; has = true; }
      else if (w === "110") { if (issued) s.i110 += q * len; else s.r110 += q * len; has = true; }
    }
  };
  acc(obj.materials, true);
  acc(obj.returnItems, false);
  return has ? s : null;
}

interface JobRow {
  stage: number | null; order_source: string | null; order_date: string | null; due_date: string | null;
  customer_name: string | null; product_name: string | null; bill_no: string | null; handover_data: unknown; completed_date: string | null; eval_score: number | null; job_no: string; updated_at: string | null;
}
interface ZoneRow { job_no: string; width_cm: number | null; length_cm: number | null; }
interface WorkOrderRow { status: string | null; updated_at: string | null; }

const WORK_ORDER_STATUSES = [
  "head_review", "returned_sales", "warehouse_waiting", "warehouse_preparing",
  "ready_to_install", "installing", "waiting_cs", "closed",
] as const;

export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Preserve the signed-in employee session.  Work orders are intentionally
  // protected by RLS and must not be read through an anonymous API client.
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  let revenue: { month: string; orders: number; qty: number; revenue: number }[] = [];
  try {
    const { data } = await supabase.from("v_floor_install_kpis").select("month,orders,qty,revenue");
    revenue = (data ?? []).map((r) => ({ month: String(r.month).slice(0, 7), orders: Number(r.orders) || 0, qty: Number(r.qty) || 0, revenue: Number(r.revenue) || 0 })).sort((a, b) => (a.month < b.month ? -1 : 1));
  } catch { revenue = []; }

  const byStage = STAGES.map((s) => ({ ...s, n: 0 }));
  const bySource: Record<string, number> = {};
  const byMonthMap: Record<string, number> = {};
  let total = 0, done = 0, active = 0, overdue = 0;
  const upcoming: { customer: string; product: string; due: string; stage: number }[] = [];
  const overdueList: { customer: string; product: string; due: string; stage: number }[] = [];
  let jobs: JobRow[] = [];
  try {
    const { data } = await supabase.from("install_jobs").select("job_no,stage,order_source,order_date,due_date,customer_name,product_name,bill_no,handover_data,completed_date,eval_score,updated_at");
    jobs = (data ?? []) as JobRow[];
    total = jobs.length;
    for (const jb of jobs) {
      const st = Number(jb.stage) || 1;
      const row = byStage.find((x) => x.id === st);
      if (row) row.n++;
      const src = jb.order_source || "อื่นๆ";
      bySource[src] = (bySource[src] || 0) + 1;
      if (jb.order_date) { const ym = String(jb.order_date).slice(0, 7); byMonthMap[ym] = (byMonthMap[ym] || 0) + 1; }
      if (st === 6) done++;
      else {
        active++;
        if (jb.due_date && String(jb.due_date) < today) { overdue++; overdueList.push({ customer: jb.customer_name || "-", product: jb.product_name || "", due: String(jb.due_date), stage: st }); }
        else if (jb.due_date && String(jb.due_date) >= today) upcoming.push({ customer: jb.customer_name || "-", product: jb.product_name || "", due: String(jb.due_date), stage: st });
      }
    }
  } catch { /* defaults */ }
  const byMonth = Object.keys(byMonthMap).sort().map((m) => ({ month: m, n: byMonthMap[m] }));
  upcoming.sort((a, b) => (a.due < b.due ? -1 : 1));
  const completedMap: Record<string, number> = {};
  let evaluated = 0;
  for (const jb of jobs) {
    if (jb.completed_date) { const ym = String(jb.completed_date).slice(0, 7); completedMap[ym] = (completedMap[ym] || 0) + 1; }
    if (jb.eval_score !== null && jb.eval_score !== undefined) evaluated++;
  }
  const completedByMonth = Object.keys(completedMap).sort().map((m) => ({ month: m, n: completedMap[m] }));

  // This is the operational source of truth.  `install_jobs.stage` remains in
  // the response for the legacy KPI cards, while this aggregation drives the
  // Executive Pipeline so it matches the work that each department acts on.
  const workOrderMap: Record<string, { n: number; sum: number; max: number }> = {};
  for (const status of WORK_ORDER_STATUSES) workOrderMap[status] = { n: 0, sum: 0, max: 0 };
  try {
    const { data } = await supabase.from("floor_work_orders").select("status,updated_at").neq("status", "cancelled");
    for (const row of (data ?? []) as WorkOrderRow[]) {
      const status = row.status ?? "";
      const bucket = workOrderMap[status];
      if (!bucket) continue;
      bucket.n++;
      if (status !== "closed" && row.updated_at) {
        const updated = new Date(row.updated_at).getTime();
        if (!Number.isNaN(updated)) {
          const days = Math.max(0, Math.floor((Date.now() - updated) / 86400000));
          bucket.sum += days;
          bucket.max = Math.max(bucket.max, days);
        }
      }
    }
  } catch { /* the dashboard can still show legacy KPIs if this query is unavailable */ }
  const workOrders = WORK_ORDER_STATUSES.map((status) => {
    const bucket = workOrderMap[status];
    return { status, n: bucket.n, avgDays: bucket.n ? Math.round(bucket.sum / bucket.n) : 0, maxDays: bucket.max };
  });

  // ---- lead time (รับออเดอร์ -> ปิดงาน) + pipeline aging/bottleneck ----
  const nowMs = Date.now();
  const DAY = 86400000;
  const leadDays: number[] = [];
  const agingByStage: Record<number, { n: number; sum: number; max: number }> = {};
  const stuck: { customer: string; product: string; stage: number; stageName: string; days: number }[] = [];
  for (const jb of jobs) {
    const st = Number(jb.stage) || 1;
    if (jb.order_date && jb.completed_date) {
      const o = new Date(String(jb.order_date)).getTime();
      const c = new Date(String(jb.completed_date)).getTime();
      if (!isNaN(o) && !isNaN(c) && c >= o) leadDays.push(Math.round((c - o) / DAY));
    }
    if (st !== 6 && jb.updated_at) {
      const u = new Date(String(jb.updated_at)).getTime();
      if (!isNaN(u)) {
        const days = Math.floor((nowMs - u) / DAY);
        const a = agingByStage[st] ?? { n: 0, sum: 0, max: 0 };
        a.n++; a.sum += days; if (days > a.max) a.max = days;
        agingByStage[st] = a;
        if (days > 30) stuck.push({ customer: jb.customer_name || jb.job_no, product: jb.product_name || "", stage: st, stageName: STAGES.find((s) => s.id === st)?.name || String(st), days });
      }
    }
  }
  leadDays.sort((a, b) => a - b);
  const pctl = (arr: number[], p: number): number | null => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))] : null);
  const leadTime = {
    n: leadDays.length,
    avgDays: leadDays.length ? Math.round(leadDays.reduce((a, b) => a + b, 0) / leadDays.length) : null,
    medianDays: pctl(leadDays, 0.5),
    p90Days: pctl(leadDays, 0.9),
  };
  const pipelineAging = Object.keys(agingByStage).map((k) => { const id = Number(k); const a = agingByStage[id]; return { id, name: STAGES.find((s) => s.id === id)?.name || k, n: a.n, avgDays: Math.round(a.sum / a.n), maxDays: a.max }; }).sort((x, y) => x.id - y.id);
  stuck.sort((a, b) => b.days - a.days);

  type WRow = { customer: string; bill: string | null; zoneM2: number; actM2: number | null; pct: number | null };
  let waste: {
    withZones: number; withData: number; costSetup: boolean; totalWasteCost: number; top: WRow[];
    stats: { count: number; avgPct: number | null; medianPct: number | null; normal: number; heavy: number; abnormal: number };
  } = { withZones: 0, withData: 0, costSetup: false, totalWasteCost: 0, top: [], stats: { count: 0, avgPct: null, medianPct: null, normal: 0, heavy: 0, abnormal: 0 } };
  try {
    const [{ data: zones }, { data: mats }] = await Promise.all([
      supabase.from("install_job_zones").select("job_no,width_cm,length_cm"),
      supabase.from("materials").select("sku,unit_cost").in("sku", ["RS-140", "RS-110"]),
    ]);
    const c140 = Number((mats ?? []).find((m) => m.sku === "RS-140")?.unit_cost ?? 0);
    const c110 = Number((mats ?? []).find((m) => m.sku === "RS-110")?.unit_cost ?? 0);
    const zByJob: Record<string, ZoneRow[]> = {};
    for (const z of (zones ?? []) as ZoneRow[]) (zByJob[String(z.job_no)] = zByJob[String(z.job_no)] ?? []).push(z);
    let withZones = 0, withData = 0, totalWasteCost = 0;
    const rows: WRow[] = [];
    const pcts: number[] = [];
    for (const jb of jobs) {
      const jz = zByJob[String(jb.job_no)] ?? [];
      if (jz.length > 0) withZones++;
      const zoneCm2 = jz.reduce((s, z) => { const w = Number(z.width_cm) || 0, l = Number(z.length_cm) || 0; return s + (w > 0 && l > 0 ? w * l : 0); }, 0);
      const mov = parseHandover(jb.handover_data);
      if (mov) withData++;
      const a140 = mov ? mov.i140 - mov.r140 : null;
      const a110 = mov ? mov.i110 - mov.r110 : null;
      const actCm2 = a140 !== null && a110 !== null ? a140 * 140 + a110 * 110 : null;
      if (a140 !== null && a110 !== null) totalWasteCost += a140 * c140 + a110 * c110;
      const pct = actCm2 !== null && zoneCm2 > 0 ? ((actCm2 - zoneCm2) / zoneCm2) * 100 : null;
      if (pct !== null) {
        pcts.push(pct);
        rows.push({ customer: jb.customer_name || jb.bill_no || jb.job_no, bill: jb.bill_no, zoneM2: Math.round((zoneCm2 / 10000) * 10) / 10, actM2: actCm2 === null ? null : Math.round((actCm2 / 10000) * 10) / 10, pct: Math.round(pct * 10) / 10 });
      }
    }
    rows.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const sorted = [...pcts].sort((a, b) => a - b);
    const avgPct = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null;
    const medianPct = sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) / 2)] * 10) / 10 : null;
    waste = {
      withZones, withData, costSetup: c140 > 0 && c110 > 0, totalWasteCost, top: rows.slice(0, 6),
      stats: {
        count: pcts.length, avgPct, medianPct,
        normal: pcts.filter((p) => p <= 20).length,
        heavy: pcts.filter((p) => p > 20 && p <= 50).length,
        abnormal: pcts.filter((p) => p > 50).length,
      },
    };
  } catch { /* defaults */ }

  return NextResponse.json({ revenue, jobs: { total, byStage, bySource, byMonth, completedByMonth, done, active, overdue, evaluated }, workOrders, leadTime, pipeline: { aging: pipelineAging, stuck: stuck.slice(0, 8) }, upcoming: upcoming.slice(0, 8), overdueList, waste, updatedAt: new Date().toISOString() });
}

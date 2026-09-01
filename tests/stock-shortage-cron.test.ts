import { describe, expect, it, vi } from "vitest";
import { runStockShortageCheck, type StockShortageWorkerClient } from "@/lib/stock-shortage-worker";
import { stockShortageDedupeKey } from "@/lib/stock-shortage";

/**
 * เทสงาน cron ตรวจสต็อกล่วงหน้า
 * เน้นเรื่องเดียวที่พังแล้วเจ็บที่สุด: รันซ้ำในวันเดียวกันต้องไม่เกิดคำเตือนใบที่สอง
 */

interface Call { name: string; args: Record<string, unknown> }

/**
 * ฐานข้อมูลปลอมที่จำลองกลไกกันซ้ำจริง:
 * raise_job_stock_shortage_warning ประกอบ dedupe_key ฝั่งเซิร์ฟเวอร์จาก job_no + วันที่
 * แล้ว insert แบบ on conflict do nothing บน unique index (recipient_user_id, dedupe_key)
 * ที่นี่จึงจำลองด้วย Set ของคีย์ที่เคยส่งแล้ว และคืน inserted = 0 เมื่อคีย์ซ้ำ
 */
function fakeClient(options: {
  jobs?: unknown;
  linesByJob?: Record<string, unknown>;
  sent?: Set<string>;
  calls?: Call[];
  checkError?: Record<string, string>;
  recipientsPerJob?: number;
} = {}): StockShortageWorkerClient {
  const sent = options.sent ?? new Set<string>();
  const calls = options.calls ?? [];
  const recipients = options.recipientsPerJob ?? 7;
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "list_upcoming_jobs_for_stock_check") {
        return Promise.resolve({ data: options.jobs ?? [], error: null });
      }
      if (name === "get_job_stock_check") {
        const jobNo = String(args.p_job_no);
        const failure = options.checkError?.[jobNo];
        if (failure) return Promise.resolve({ data: null, error: { message: failure } });
        return Promise.resolve({ data: options.linesByJob?.[jobNo] ?? [], error: null });
      }
      if (name === "raise_job_stock_shortage_warning") {
        const key = stockShortageDedupeKey(String(args.p_job_no), String(args.p_as_of_date));
        const already = sent.has(key);
        sent.add(key);
        return Promise.resolve({
          data: { jobNo: args.p_job_no, asOfDate: args.p_as_of_date, dedupeKey: key, inserted: already ? 0 : recipients, alreadySent: already ? recipients : 0 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `ไม่รู้จัก rpc ${name}` } });
    },
  };
}

const JOBS = [
  { job_no: "ORD-202608-8594", customer_name: "คุณชมพู่", appointment_id: "appt-1", work_order_id: "wo-1", work_order_status: "warehouse_preparing", slot_start: "2026-09-05T02:00:00+00:00", install_date: "2026-09-05", days_until: 4 },
];
const LINES = {
  "ORD-202608-8594": [
    { item_id: "i1", prep_source: "work_order_item", category: "floor_material", item_name: "แผ่นรองกันลื่น", line_sku: "LDSSF002", unit: "แผ่น", planned_qty: "100.00", actual_qty: null, picked_qty: null, stock_key: "LDSSF002", stock_source: "warehouse", registry_qty: null, warehouse_qty: "63.00", available_qty: "63.00", warehouse_name: "Samaedam_FG", snapshot_date: "2026-09-01" },
    { item_id: "i2", prep_source: "work_order_item", category: "tool", item_name: "โน้ต Freeform จากหัวหน้าช่าง", line_sku: null, unit: "รายการ", planned_qty: "0.00", actual_qty: "0.00", picked_qty: null, stock_key: null, stock_source: null, registry_qty: null, warehouse_qty: null, available_qty: null, warehouse_name: null, snapshot_date: null },
    { item_id: "i3", prep_source: "work_order_item", category: "floor_material", item_name: "พื้น SPC รุ่น Oak 5 มม.", line_sku: "TEST-SPC05-OAK", unit: "แผ่น", planned_qty: "5.00", actual_qty: null, picked_qty: null, stock_key: "TEST-SPC05-OAK", stock_source: null, registry_qty: null, warehouse_qty: null, available_qty: null, warehouse_name: null, snapshot_date: null },
  ],
};

describe("งาน cron ตรวจสต็อกล่วงหน้า", () => {
  it("เจอของขาดแล้วส่งคำเตือนหนึ่งรอบ", async () => {
    const calls: Call[] = [];
    const summary = await runStockShortageCheck(fakeClient({ jobs: JOBS, linesByJob: LINES, calls }), {
      daysAhead: 7,
      now: new Date("2026-09-01T00:30:00Z"),
    });
    expect(summary.jobsChecked).toBe(1);
    expect(summary.jobsWithShortage).toBe(1);
    expect(summary.warningsCreated).toBe(7);
    expect(summary.warningsAlreadySent).toBe(0);
    expect(summary.asOfDate).toBe("2026-09-01");
    const raised = calls.filter((call) => call.name === "raise_job_stock_shortage_warning");
    expect(raised).toHaveLength(1);
    expect(raised[0].args.p_as_of_date).toBe("2026-09-01");
    expect(String(raised[0].args.p_body)).toContain("ขาด 37");
    // ผู้เรียกต้องไม่ได้ส่ง dedupe_key เอง ฐานข้อมูลประกอบเองทั้งหมด
    expect(Object.keys(raised[0].args)).not.toContain("p_dedupe_key");
  });

  it("รันซ้ำวันเดียวกันไม่เกิดคำเตือนใบที่สอง", async () => {
    const sent = new Set<string>();
    const calls: Call[] = [];
    const client = fakeClient({ jobs: JOBS, linesByJob: LINES, sent, calls });
    const first = await runStockShortageCheck(client, { daysAhead: 7, now: new Date("2026-09-01T00:30:00Z") });
    // รันรอบสองเวลาต่างกันแต่ยังเป็นวันเดียวกันตามเวลาไทย
    const second = await runStockShortageCheck(client, { daysAhead: 7, now: new Date("2026-09-01T14:00:00Z") });

    expect(first.warningsCreated).toBe(7);
    expect(second.warningsCreated).toBe(0);
    expect(second.warningsAlreadySent).toBe(7);
    expect(second.jobsWithShortage).toBe(1);
    expect(sent.size).toBe(1);
    const dates = calls.filter((call) => call.name === "raise_job_stock_shortage_warning").map((call) => call.args.p_as_of_date);
    expect(dates).toEqual(["2026-09-01", "2026-09-01"]);
  });

  it("ข้ามวันแล้วเตือนได้ใหม่ เพราะวันติดตั้งใกล้เข้ามาอีกวัน", async () => {
    const sent = new Set<string>();
    const client = fakeClient({ jobs: JOBS, linesByJob: LINES, sent });
    await runStockShortageCheck(client, { daysAhead: 7, now: new Date("2026-09-01T00:30:00Z") });
    const next = await runStockShortageCheck(client, { daysAhead: 7, now: new Date("2026-09-02T00:30:00Z") });
    expect(next.warningsCreated).toBe(7);
    expect(sent.size).toBe(2);
  });

  it("ไม่มีของขาดก็ไม่ยิงแจ้งเตือน แต่ยังนับบรรทัดที่ตรวจไม่ได้ไว้ในรายงาน", async () => {
    const calls: Call[] = [];
    const summary = await runStockShortageCheck(
      fakeClient({
        jobs: JOBS,
        linesByJob: { "ORD-202608-8594": [{ ...LINES["ORD-202608-8594"][0], planned_qty: "2.00" }, LINES["ORD-202608-8594"][1], LINES["ORD-202608-8594"][2]] },
        calls,
      }),
      { daysAhead: 7, now: new Date("2026-09-01T00:30:00Z") },
    );
    expect(summary.jobsWithShortage).toBe(0);
    expect(summary.warningsCreated).toBe(0);
    expect(summary.linesUncheckable).toBe(1);
    expect(calls.some((call) => call.name === "raise_job_stock_shortage_warning")).toBe(false);
  });

  it("งานหนึ่งใบอ่านไม่ได้ ต้องไม่ทำให้งานใบอื่นไม่ถูกตรวจ", async () => {
    const jobs = [{ ...JOBS[0], job_no: "ORD-พัง" }, JOBS[0]];
    const summary = await runStockShortageCheck(
      fakeClient({ jobs, linesByJob: LINES, checkError: { "ORD-พัง": "อ่านไม่ได้" } }),
      { daysAhead: 7, now: new Date("2026-09-01T00:30:00Z") },
    );
    expect(summary.errors).toEqual([{ jobNo: "ORD-พัง", message: "อ่านไม่ได้" }]);
    expect(summary.jobsChecked).toBe(1);
    expect(summary.warningsCreated).toBe(7);
  });

  it("อ่านรายการงานไม่สำเร็จต้องล้มทั้งรอบ ไม่ใช่รายงานว่าไม่มีงานต้องตรวจ", async () => {
    const client: StockShortageWorkerClient = {
      rpc: () => Promise.resolve({ data: null, error: { message: "ต่อฐานข้อมูลไม่ได้" } }),
    };
    await expect(runStockShortageCheck(client, { daysAhead: 7 })).rejects.toThrow("ต่อฐานข้อมูลไม่ได้");
  });
});

describe("การป้องกัน route ของ cron", () => {
  it("GET ที่ไม่มี secret ต้องถูกปฏิเสธ", async () => {
    vi.stubEnv("STOCK_SHORTAGE_CRON_SECRET", "secret-for-tests");
    const { GET } = await import("@/app/api/stock/shortage-check/route");
    const response = await GET(new Request("https://example.test/api/stock/shortage-check"));
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });
});

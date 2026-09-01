/**
 * งานเบื้องหลัง: เดินดูงานที่ใกล้ถึงวันติดตั้ง แล้วเตือนเมื่อของไม่พอ
 *
 * แยกออกจาก route handler เพื่อให้ทดสอบได้โดยไม่ต้องมี Next.js runtime
 * (แพตเทิร์นเดียวกับ lib/documents/generation-worker.ts ที่ /api/documents/process ใช้)
 *
 * ความ idempotent ไม่ได้อยู่ที่ไฟล์นี้ แต่อยู่ที่ฐานข้อมูล:
 * raise_job_stock_shortage_warning ประกอบ dedupe_key จาก job_no + วันที่ (เวลาไทย) เอง
 * แล้ว insert แบบ on conflict do nothing บน unique index (recipient_user_id, dedupe_key)
 * ไฟล์นี้จึงเรียกซ้ำได้ปลอดภัย และรายงานกลับมาว่ารอบนี้ "ส่งใหม่" กี่ใบ "ส่งไปแล้ว" กี่ใบ
 */

import {
  bangkokDateKey,
  calculateJobStockShortage,
  stockShortageMessage,
  toJobStockCheckRows,
} from "@/lib/stock-shortage";

type RpcResult = { data: unknown; error: unknown };
export type StockShortageWorkerClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export interface UpcomingJobRow {
  job_no: string;
  customer_name: string | null;
  appointment_id: string | null;
  work_order_id: string | null;
  work_order_status: string | null;
  slot_start: string | null;
  install_date: string | null;
  days_until: number | string | null;
}

export interface StockShortageRunSummary {
  asOfDate: string;
  daysAhead: number;
  jobsChecked: number;
  jobsWithShortage: number;
  warningsCreated: number;
  warningsAlreadySent: number;
  linesUncheckable: number;
  errors: { jobNo: string; message: string }[];
}

function errorMessage(error: unknown): string {
  if (!error) return "ไม่ทราบสาเหตุ";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function toUpcomingRows(data: unknown): UpcomingJobRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is UpcomingJobRow => Boolean(row) && typeof row === "object" && typeof (row as UpcomingJobRow).job_no === "string");
}

function daysUntil(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export async function runStockShortageCheck(
  client: StockShortageWorkerClient,
  options: { daysAhead: number; now?: Date },
): Promise<StockShortageRunSummary> {
  const asOfDate = bangkokDateKey(options.now ?? new Date());
  const summary: StockShortageRunSummary = {
    asOfDate,
    daysAhead: options.daysAhead,
    jobsChecked: 0,
    jobsWithShortage: 0,
    warningsCreated: 0,
    warningsAlreadySent: 0,
    linesUncheckable: 0,
    errors: [],
  };

  const listed = await client.rpc("list_upcoming_jobs_for_stock_check", { p_days_ahead: options.daysAhead });
  if (listed.error) throw new Error(`อ่านรายการงานที่ใกล้ถึงวันติดตั้งไม่สำเร็จ: ${errorMessage(listed.error)}`);

  for (const job of toUpcomingRows(listed.data)) {
    const checked = await client.rpc("get_job_stock_check", { p_job_no: job.job_no });
    if (checked.error) {
      summary.errors.push({ jobNo: job.job_no, message: errorMessage(checked.error) });
      continue;
    }
    summary.jobsChecked += 1;
    const result = calculateJobStockShortage(toJobStockCheckRows(checked.data));
    summary.linesUncheckable += result.counts.unknown;

    // เตือนเฉพาะเมื่อมีของขาดจริง — บรรทัดที่ "ตรวจสอบไม่ได้" ไม่ยิงแจ้งเตือนทุกคืน
    // เพราะวันนี้บรรทัดส่วนใหญ่จับคู่สต็อกไม่ได้ ถ้ายิงทุกใบ คำเตือนจะกลายเป็นเสียงรบกวนแล้วไม่มีใครอ่าน
    // แต่จำนวนที่ตรวจไม่ได้ถูกแนบไปในเนื้อความและรายงานผลรัน เพื่อไม่ให้ช่องโหว่นี้หายไปเงียบ ๆ
    if (!result.hasShortage) continue;
    summary.jobsWithShortage += 1;

    const message = stockShortageMessage({
      jobNo: job.job_no,
      customerName: job.customer_name,
      daysUntil: daysUntil(job.days_until),
      installDate: job.install_date,
      result,
    });
    const raised = await client.rpc("raise_job_stock_shortage_warning", {
      p_job_no: job.job_no,
      p_appointment_id: job.appointment_id,
      p_as_of_date: asOfDate,
      p_title: message.title,
      p_body: message.body,
    });
    if (raised.error) {
      summary.errors.push({ jobNo: job.job_no, message: errorMessage(raised.error) });
      continue;
    }
    const payload = (raised.data ?? {}) as { inserted?: number | string; alreadySent?: number | string };
    const inserted = Number(payload.inserted ?? 0);
    const already = Number(payload.alreadySent ?? 0);
    if (Number.isFinite(inserted) && inserted > 0) summary.warningsCreated += inserted;
    if (Number.isFinite(already) && already > 0) summary.warningsAlreadySent += already;
  }

  return summary;
}

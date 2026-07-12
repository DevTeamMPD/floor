"use server";

import { createClient } from "./server";
import type { InstallJob } from "../types";

function mapRow(row: Record<string, unknown>): InstallJob {
  return {
    id: String(row.id),
    ticket: row.ticket_no as string,
    order: row.order_no as string,
    bill: row.bill_no as string,
    sku: row.sku as string,
    product: row.product_name as string,
    customer: row.customer_name as string,
    stage: Number(row.stage) || 1,
    via: row.via as string,
    linked: row.linked_order as string,
    date: row.order_date as string,
    status: row.status as string,
    due: row.due_date as string,
    shift: row.shift as string,
    assignees: row.assignees as string[],
    callLogs: row.call_logs as InstallJob["callLogs"],
    docs: row.docs as string[],
    confirmations: row.confirmations as string[],
    sitePhotos: row.site_photos as string[],
    area: row.area as string,
    addr: row.address as string,
    loc: row.location as string,
    phone: row.phone as string,
    price: row.price != null ? Number(row.price) : undefined,
    jobNo: row.job_no as string,
    evalToken: row.eval_token as string,
    evalScore: row.eval_score != null ? Number(row.eval_score) : undefined,
    closedAt: row.closed_at as string,
    closedBy: row.closed_by as string,
    orderSource: row.order_source as InstallJob["orderSource"],
  };
}

export async function loadJobs(): Promise<InstallJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("install_jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

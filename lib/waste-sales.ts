export type WasteSalesMatch = "bill_no" | "order_no" | "not_found";

export interface WasteSalesSummary {
  billRef: string;
  matchedVia: WasteSalesMatch;
  salesAmount: number | null;
  netAmount: number | null;
  shippingCost: number | null;
  transactionLines: number;
  sourceBillNos: string[];
  sourceOrderNos: string[];
  orderStatuses: string[];
  latestTxnDate: string | null;
}

interface WasteSalesRpcRow {
  bill_ref?: unknown;
  matched_via?: unknown;
  sales_amount?: unknown;
  net_amount?: unknown;
  shipping_cost?: unknown;
  transaction_lines?: unknown;
  source_bill_nos?: unknown;
  source_order_nos?: unknown;
  order_statuses?: unknown;
  latest_txn_date?: unknown;
}

export function normalizeBillReference(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseWasteSalesSummary(row: WasteSalesRpcRow): WasteSalesSummary | null {
  const billRef = normalizeBillReference(typeof row.bill_ref === "string" ? row.bill_ref : null);
  if (!billRef) return null;

  const matchedVia: WasteSalesMatch = row.matched_via === "bill_no" || row.matched_via === "order_no"
    ? row.matched_via
    : "not_found";

  return {
    billRef,
    matchedVia,
    salesAmount: nullableNumber(row.sales_amount),
    netAmount: nullableNumber(row.net_amount),
    shippingCost: nullableNumber(row.shipping_cost),
    transactionLines: nullableNumber(row.transaction_lines) ?? 0,
    sourceBillNos: stringArray(row.source_bill_nos),
    sourceOrderNos: stringArray(row.source_order_nos),
    orderStatuses: stringArray(row.order_statuses),
    latestTxnDate: typeof row.latest_txn_date === "string" ? row.latest_txn_date : null,
  };
}

export function wasteCostToSalesPercent(wasteCost: number | null, salesAmount: number | null): number | null {
  if (wasteCost === null || salesAmount === null || salesAmount <= 0) return null;
  return (wasteCost / salesAmount) * 100;
}

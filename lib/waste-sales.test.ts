import { describe, expect, it } from "vitest";
import { normalizeBillReference, parseWasteSalesSummary, wasteCostToSalesPercent } from "./waste-sales";

describe("waste sales helpers", () => {
  it("normalizes bill references before matching", () => {
    expect(normalizeBillReference(" 287993 ")).toBe("287993");
    expect(normalizeBillReference(null)).toBe("");
  });

  it("parses numeric strings returned by Postgres", () => {
    expect(parseWasteSalesSummary({
      bill_ref: "287992",
      matched_via: "order_no",
      sales_amount: "1599.00",
      net_amount: "1445.40",
      shipping_cost: "0",
      transaction_lines: "1",
      source_bill_nos: ["585728462493222220"],
      source_order_nos: ["287992"],
      order_statuses: ["Shipped"],
      latest_txn_date: "2026-08-26",
    })).toEqual({
      billRef: "287992",
      matchedVia: "order_no",
      salesAmount: 1599,
      netAmount: 1445.4,
      shippingCost: 0,
      transactionLines: 1,
      sourceBillNos: ["585728462493222220"],
      sourceOrderNos: ["287992"],
      orderStatuses: ["Shipped"],
      latestTxnDate: "2026-08-26",
    });
  });

  it("keeps a missing transaction distinct from a zero sale", () => {
    const parsed = parseWasteSalesSummary({ bill_ref: "287993", matched_via: "not_found", transaction_lines: 0 });
    expect(parsed?.matchedVia).toBe("not_found");
    expect(parsed?.salesAmount).toBeNull();
  });

  it("calculates waste cost as a percentage of sales only for valid sales", () => {
    expect(wasteCostToSalesPercent(100, 2000)).toBe(5);
    expect(wasteCostToSalesPercent(100, 0)).toBeNull();
    expect(wasteCostToSalesPercent(null, 2000)).toBeNull();
  });
});

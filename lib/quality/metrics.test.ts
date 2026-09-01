import { describe, expect, it } from "vitest";
import { calculateQualityMetrics, filterQualityDataset, type QualityDataset } from "@/lib/quality/metrics";

const data: QualityDataset = {
  ncrs: [
    { id: "n1", job_no: "J1", title: "สีต่าง", type: "quality", status: "open", severity: "high", due_at: "2026-08-30T00:00:00Z", product_sku: "SKU-1", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", closed_at: null },
    { id: "n2", job_no: "J2", title: "สีต่างซ้ำ", type: "quality", status: "closed", severity: "medium", due_at: null, product_sku: "SKU-1", created_at: "2026-08-15T00:00:00Z", updated_at: "2026-08-20T00:00:00Z", closed_at: "2026-08-20T00:00:00Z" },
  ],
  cases: [{ id: "c1", case_no: "ASC-1", job_no: "J1", source: "csat", category: "complaint", priority: "high", status: "resolved", summary: "งานแก้", assigned_team: "ทีม A", due_at: "2026-08-04T00:00:00Z", opened_at: "2026-08-01T00:00:00Z", resolved_at: "2026-08-02T00:00:00Z", closed_at: null, linked_ncr_id: "n1" }],
  actions: [{ id: "a1", case_id: "c1", title: "แก้ไข", status: "completed", due_at: null, completed_at: "2026-08-02T00:00:00Z", acceptance_criteria: "ผ่าน", outcome: "ผ่าน" }],
  evaluations: [{ id: "e1", job_no: "J1", satisfaction_score: 2, call_date: "2026-08-03", created_at: "2026-08-03T00:00:00Z", updated_at: "2026-08-03T00:00:00Z" }, { id: "e2", job_no: "J2", satisfaction_score: 4, call_date: "2026-08-20", created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" }],
  jobs: [{ job_no: "J1", customer: "A", team: "ทีม A" }, { job_no: "J2", customer: "B", team: "ทีม B" }],
};

describe("quality metrics", () => {
  it("calculates overdue, recurrence, recovery and CSAT", () => {
    const result = calculateQualityMetrics(data, new Date("2026-09-01T00:00:00Z"));
    expect(result.overdueNcrs).toHaveLength(1);
    expect(result.recurrenceGroups[0].count).toBe(2);
    expect(result.averageRecoveryHours).toBe(24);
    expect(result.csatAverage).toBe(3);
  });
  it("filters all dependent records by period", () => {
    const result = filterQualityDataset(data, new Date("2026-08-10T00:00:00Z"), new Date("2026-08-31T23:59:59Z"));
    expect(result.ncrs.map((item) => item.id)).toEqual(["n2"]);
    expect(result.cases).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { renderBoq, renderCsat, renderCustomerAcceptance, renderHandover, renderInstallationReport, renderNcr, renderPickConfirmation, renderRemnantReport, renderWorkOrder } from "@/lib/documents/render";
import type { DocumentSourceSnapshot } from "@/lib/documents/types";

const snapshot: DocumentSourceSnapshot = { jobNo: "ORD-1", sourceUpdatedAt: "2026-08-30T08:00:00.000Z", workOrder: { id: "wo-1", status: "warehouse_waiting", revision: 2, note: "ตรวจ <script>", confirmedAt: null }, job: { billNo: "B-1", customerName: "คุณเอ", customerPhone: "000", address: "กรุงเทพฯ", locationUrl: null, productName: "Rollsafe" }, appointment: { startsAt: null, endsAt: null, teamName: "ทีม A" }, survey: { areaSqm: 10, floorCondition: null, wetZone: null, notes: null, photoCount: 0 }, evidence: { warehouseCompletion: { actorName: "คลัง", note: null, photoPaths: ["warehouse/a.jpg"], occurredAt: "2026-08-30T09:00:00Z" }, fieldCompletion: { actorName: "ช่าง", note: "เสร็จแล้ว", photoPaths: ["field/a.jpg"], occurredAt: "2026-08-30T15:00:00Z" }, customerSigned: { actorName: "ช่าง", note: null, photoPaths: [], occurredAt: "2026-08-30T15:10:00Z", customerName: "คุณเอ", signaturePath: "signatures/a.png" }, remnantsSubmitted: { actorName: "ช่าง", note: null, photoPaths: [], occurredAt: "2026-08-30T15:05:00Z" }, csClosed: { actorName: "CS", note: null, photoPaths: [], occurredAt: "2026-09-02T09:00:00Z" } }, remnant: { status: "accepted", noRemnant: false, notes: null, submittedAt: "2026-08-30T15:05:00Z", pieces: [{ widthCm: 20, lengthCm: 50, qty: 1, thickness: "1.6", color: "เทา", materialType: "Rollsafe", note: null, photoCount: 1 }] }, evaluation: { id: "ev-1", csName: "CS", callDate: "2026-09-01", satisfactionScore: 5, issuesText: null, needsFollowup: false, answers: { quality: 5 }, updatedAt: "2026-09-01T10:00:00Z" }, ncrs: [{ id: "ncr-1", title: "รอยขีด", type: "installation", status: "verified", severity: "low", dueAt: "2026-09-14T10:00:00Z", description: "แก้ไขแล้ว", createdAt: "2026-08-31T10:00:00Z" }], items: [{ category: "floor_material", itemName: "สินค้า <test>", sku: "SKU-1", specification: null, plannedQty: 3, actualQty: 3, unit: "แผ่น", sourceType: "new", note: null }] };

describe("document renderers", () => {
  it("renders work order with controlled document metadata and escapes source text", () => {
    const document = renderWorkOrder(snapshot);
    expect(document.documentCode).toBe("WO-ORD-1-R2");
    expect(document.documentClass).toBe("controlled_document");
    expect(document.html).toContain("&lt;script&gt;");
    expect(document.html).not.toContain("<script>");
  });
  it("renders BOQ from confirmed planned quantities", () => {
    const document = renderBoq(snapshot);
    expect(document.documentCode).toBe("BOQ-ORD-1-R2");
    expect(document.html).toContain("SKU-1");
    expect(document.html).toContain("ปริมาณแผน");
  });
  it("renders every evidence and closing document as Thai HTML", () => {
    const documents = [renderPickConfirmation(snapshot), renderInstallationReport(snapshot), renderCustomerAcceptance(snapshot), renderRemnantReport(snapshot), renderHandover(snapshot), renderCsat(snapshot), renderNcr(snapshot)];
    expect(documents).toHaveLength(7);
    for (const document of documents) {
      expect(document.html).toContain("บริษัท เล่นดี สเปซ จำกัด");
      expect(document.html).toMatch(/APPROVED|VERIFIED/);
      expect(document.fileName).toMatch(/\.html$/);
    }
  });
});

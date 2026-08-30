import type { DocumentSourceSnapshot, RenderedDocument } from "@/lib/documents/types";
import { renderBoqHtml } from "@/lib/documents/templates/boq";
import { renderInstallationReportHtml } from "@/lib/documents/templates/installation-report";
import { renderPickConfirmationHtml } from "@/lib/documents/templates/pick-confirmation";
import { renderWorkOrderHtml } from "@/lib/documents/templates/work-order";
import { renderCsatHtml, renderCustomerAcceptanceHtml, renderHandoverHtml, renderNcrHtml, renderRemnantReportHtml } from "@/lib/documents/templates/closing";

export function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return String(value ?? "").replace(/[&<>'"]/g, (character) => entities[character] ?? character);
}

export function displayText(value: string | number | null | undefined): string {
  return value === null || value === undefined || String(value).trim() === "" ? "ไม่ระบุ" : escapeHtml(value);
}

export function formatBkkDateTime(value: string | null): string {
  if (!value) return "ไม่ระบุ";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "ไม่ระบุ";
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function renderWorkOrder(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `WO-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "work_order", documentClass: "controlled_document", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderWorkOrderHtml(snapshot, documentCode) };
}

export function renderBoq(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `BOQ-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "boq", documentClass: "controlled_document", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderBoqHtml(snapshot, documentCode) };
}

export function renderPickConfirmation(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `PICK-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "pick_confirmation", documentClass: "quality_record", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderPickConfirmationHtml(snapshot, documentCode) };
}

export function renderInstallationReport(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `INST-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "installation_report", documentClass: "quality_record", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderInstallationReportHtml(snapshot, documentCode) };
}

export function renderCustomerAcceptance(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `ACC-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "customer_acceptance", documentClass: "quality_record", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderCustomerAcceptanceHtml(snapshot, documentCode) };
}
export function renderRemnantReport(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `REM-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "remnant_report", documentClass: "quality_record", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderRemnantReportHtml(snapshot, documentCode) };
}
export function renderHandover(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `HOV-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "handover", documentClass: "quality_record", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderHandoverHtml(snapshot, documentCode) };
}
export function renderCsat(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `CSAT-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "csat", documentClass: "quality_record", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderCsatHtml(snapshot, documentCode) };
}
export function renderNcr(snapshot: DocumentSourceSnapshot): RenderedDocument {
  const documentCode = `NCR-${snapshot.jobNo}-R${snapshot.workOrder.revision}`;
  return { documentType: "ncr", documentClass: "controlled_document", documentCode, sourceUpdatedAt: snapshot.sourceUpdatedAt, fileName: `${documentCode}.html`, html: renderNcrHtml(snapshot, documentCode) };
}

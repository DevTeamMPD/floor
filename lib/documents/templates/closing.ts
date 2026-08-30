import { documentShell, field } from "@/lib/documents/templates/layout";
import { displayText, formatBkkDateTime } from "@/lib/documents/render";
import type { DocumentSourceSnapshot } from "@/lib/documents/types";

function signatureRows(labels: string[]) { return `<section class="signatures">${labels.map((label) => `<div class="signature">${label}<br>__________________</div>`).join("")}</section>`; }
function base(snapshot: DocumentSourceSnapshot) { return `<section class="grid">${field("เลขงาน", snapshot.jobNo)}${field("เลขบิล", snapshot.job.billNo)}${field("ลูกค้า", snapshot.job.customerName)}${field("สินค้า/งาน", snapshot.job.productName)}${field("สถานที่", snapshot.job.address)}${field("ทีมช่าง", snapshot.appointment.teamName)}</section>`; }

export function renderCustomerAcceptanceHtml(snapshot: DocumentSourceSnapshot, documentCode: string) {
  const signed = snapshot.evidence.customerSigned;
  if (!signed) throw new Error("customer signature evidence is not available");
  const body = `${base(snapshot)}<h2>การรับมอบงาน</h2><section class="grid">${field("ชื่อผู้รับมอบ", signed.customerName)}${field("วัน–เวลาที่ลงนาม", formatBkkDateTime(signed.occurredAt))}${field("ผู้ดำเนินการ", signed.actorName)}${field("หลักฐานลายเซ็น", signed.signaturePath ? "จัดเก็บในระบบหลักฐานของใบงาน" : "ไม่พบ")}</section><div class="note">ผู้รับมอบยืนยันว่าได้รับทราบผลการติดตั้งและเงื่อนไขการส่งมอบที่แสดงในระบบ ณ เวลาลงนาม</div>${signatureRows(["ผู้รับมอบ", "หัวหน้าทีมช่าง", "ผู้ตรวจงาน", "ฝ่ายปฏิบัติการ"])}`;
  return documentShell({ title: "ใบยืนยันรับมอบงาน", documentCode, revision: snapshot.workOrder.revision, sourceUpdatedAt: signed.occurredAt ?? snapshot.sourceUpdatedAt, documentClass: "quality_record", body });
}

export function renderRemnantReportHtml(snapshot: DocumentSourceSnapshot, documentCode: string) {
  if (!snapshot.remnant) throw new Error("remnant report is not available");
  const rows = snapshot.remnant.pieces.map((piece, index) => `<tr><td>${index + 1}</td><td>${displayText(piece.materialType)}</td><td class="number">${piece.widthCm}</td><td class="number">${piece.lengthCm}</td><td class="number">${piece.qty}</td><td>${displayText(piece.thickness)}</td><td>${displayText(piece.color)}</td><td class="number">${piece.photoCount}</td></tr>`).join("") || `<tr><td colspan="8">ช่างยืนยันว่าไม่มีเศษวัสดุ</td></tr>`;
  const body = `${base(snapshot)}<section class="grid">${field("สถานะตรวจรับ", snapshot.remnant.status)}${field("วัน–เวลาส่งรายงาน", formatBkkDateTime(snapshot.remnant.submittedAt))}${field("ไม่มีเศษ", snapshot.remnant.noRemnant ? "ใช่" : "ไม่ใช่")}${field("หมายเหตุ", snapshot.remnant.notes)}</section><h2>รายการเศษวัสดุ</h2><table><thead><tr><th>#</th><th>ชนิด</th><th class="number">กว้าง (ซม.)</th><th class="number">ยาว (ซม.)</th><th class="number">จำนวน</th><th>ความหนา</th><th>สี</th><th class="number">รูป</th></tr></thead><tbody>${rows}</tbody></table>${signatureRows(["ผู้ส่งคืน", "ผู้ตรวจรับคลัง", "หัวหน้าทีม", "ผู้อนุมัติ"])}`;
  return documentShell({ title: "รายงานเศษวัสดุ", documentCode, revision: snapshot.workOrder.revision, sourceUpdatedAt: snapshot.remnant.submittedAt ?? snapshot.sourceUpdatedAt, documentClass: "quality_record", body });
}

export function renderCsatHtml(snapshot: DocumentSourceSnapshot, documentCode: string) {
  if (!snapshot.evaluation || snapshot.evaluation.satisfactionScore === null) throw new Error("customer evaluation is not available");
  const evaluation = snapshot.evaluation;
  const answerRows = Object.entries(evaluation.answers).map(([question, answer], index) => `<tr><td>${index + 1}</td><td>${displayText(question)}</td><td>${displayText(typeof answer === "object" ? JSON.stringify(answer) : String(answer))}</td></tr>`).join("") || `<tr><td colspan="3">ไม่มีคำตอบรายข้อ</td></tr>`;
  const body = `${base(snapshot)}<section class="grid">${field("ผู้ติดตาม CS", evaluation.csName)}${field("วันที่โทร", evaluation.callDate)}${field("คะแนนความพึงพอใจ", `${evaluation.satisfactionScore}/5`)}${field("ต้องติดตามต่อ", evaluation.needsFollowup ? "ใช่" : "ไม่ใช่")}</section><h2>ผลประเมินรายข้อ</h2><table><thead><tr><th>#</th><th>หัวข้อ</th><th>คำตอบ</th></tr></thead><tbody>${answerRows}</tbody></table><div class="note"><b>ประเด็นจากลูกค้า:</b> ${displayText(evaluation.issuesText)}</div>${signatureRows(["ผู้บันทึก CS", "ผู้ตรวจทาน", "หัวหน้าฝ่าย", "ผู้อนุมัติ"])}`;
  return documentShell({ title: "แบบประเมินความพึงพอใจหลังการขาย", documentCode, revision: snapshot.workOrder.revision, sourceUpdatedAt: evaluation.updatedAt, documentClass: "quality_record", body });
}

export function renderNcrHtml(snapshot: DocumentSourceSnapshot, documentCode: string) {
  if (!snapshot.ncrs.length) throw new Error("NCR data is not available");
  const rows = snapshot.ncrs.map((ncr, index) => `<tr><td>${index + 1}</td><td>${displayText(ncr.title)}</td><td>${displayText(ncr.type)}</td><td>${displayText(ncr.severity)}</td><td>${displayText(ncr.status)}</td><td>${formatBkkDateTime(ncr.dueAt)}</td><td>${displayText(ncr.description)}</td></tr>`).join("");
  const body = `${base(snapshot)}<h2>รายการความไม่สอดคล้อง</h2><table><thead><tr><th>#</th><th>หัวข้อ</th><th>ประเภท</th><th>Severity</th><th>สถานะ</th><th>กำหนด</th><th>รายละเอียด</th></tr></thead><tbody>${rows}</tbody></table>${signatureRows(["ผู้จัดทำ", "ผู้รับผิดชอบแก้ไข", "ผู้ตรวจยืนยัน", "ผู้อนุมัติ"])}`;
  return documentShell({ title: "รายงานความไม่สอดคล้อง (NCR)", documentCode, revision: snapshot.workOrder.revision, sourceUpdatedAt: snapshot.ncrs[0].createdAt, body });
}

export function renderHandoverHtml(snapshot: DocumentSourceSnapshot, documentCode: string) {
  const closed = snapshot.evidence.csClosed;
  if (!closed) throw new Error("closing evidence is not available");
  const openNcr = snapshot.ncrs.filter((ncr) => ncr.status !== "closed");
  const body = `${base(snapshot)}<h2>สรุปการส่งมอบ</h2><section class="grid">${field("ติดตั้งเสร็จ", formatBkkDateTime(snapshot.evidence.fieldCompletion?.occurredAt ?? null))}${field("ลูกค้าเซ็นรับ", formatBkkDateTime(snapshot.evidence.customerSigned?.occurredAt ?? null))}${field("รายงานเศษ", snapshot.remnant?.status)}${field("คะแนน CSAT", snapshot.evaluation?.satisfactionScore === null || snapshot.evaluation?.satisfactionScore === undefined ? null : `${snapshot.evaluation.satisfactionScore}/5`)}${field("NCR คงค้าง", `${openNcr.length} รายการ`)}${field("ปิดงานโดย", closed.actorName)}${field("เวลาปิดงาน", formatBkkDateTime(closed.occurredAt))}${field("หมายเหตุ", closed.note)}</section><div class="note">เอกสารนี้สรุปหลักฐานการส่งมอบจากข้อมูลที่ระบบบันทึกไว้ และสร้างอัตโนมัติเมื่อ CS ปิดงาน</div>${signatureRows(["ฝ่ายติดตั้ง", "ฝ่าย CS", "ผู้รับมอบ", "ผู้อนุมัติ"])}`;
  return documentShell({ title: "ใบส่งมอบและปิดงาน", documentCode, revision: snapshot.workOrder.revision, sourceUpdatedAt: closed.occurredAt ?? snapshot.sourceUpdatedAt, documentClass: "quality_record", body });
}

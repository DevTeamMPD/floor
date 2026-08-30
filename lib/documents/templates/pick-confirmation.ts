import { documentShell, field } from "@/lib/documents/templates/layout";
import { displayText, formatBkkDateTime } from "@/lib/documents/render";
import type { DocumentSourceSnapshot } from "@/lib/documents/types";

export function renderPickConfirmationHtml(snapshot: DocumentSourceSnapshot, documentCode: string): string {
  const evidence = snapshot.evidence.warehouseCompletion;
  const itemRows = snapshot.items.map((item, index) => {
    const actual = item.actualQty === null ? "ไม่ระบุ" : item.actualQty;
    const variance = item.actualQty === null ? "ไม่ระบุ" : item.actualQty - item.plannedQty;
    return `<tr><td>${index + 1}</td><td>${displayText(item.sku)}</td><td>${displayText(item.itemName)}</td><td class="number">${item.plannedQty}</td><td class="number">${actual}</td><td class="number">${variance}</td><td>${displayText(item.unit)}</td></tr>`;
  }).join("") || `<tr><td colspan="7">ไม่พบรายการที่คลังจัดเตรียม</td></tr>`;
  const body = `<section class="grid">${field("เลขงาน", snapshot.jobNo)}${field("เลขบิล", snapshot.job.billNo)}${field("ผู้ยืนยันคลัง", evidence?.actorName)}${field("เวลายืนยัน", formatBkkDateTime(evidence?.occurredAt ?? null))}${field("ทีมติดตั้ง", snapshot.appointment.teamName)}${field("นัดหมาย", formatBkkDateTime(snapshot.appointment.startsAt))}</section><h2>ผลการเตรียมสินค้า</h2><table><thead><tr><th>#</th><th>SKU</th><th>รายการ</th><th class="number">แผน</th><th class="number">จัดจริง</th><th class="number">ผลต่าง</th><th>หน่วย</th></tr></thead><tbody>${itemRows}</tbody></table><div class="note"><b>หมายเหตุคลัง:</b> ${displayText(evidence?.note)}<br><b>หลักฐานรูป:</b> ${evidence?.photoPaths.length ?? 0} รูป (จัดเก็บในระบบหลักฐานของใบงาน)</div><section class="signatures"><div class="signature">ผู้จัดเตรียม<br>__________________</div><div class="signature">ผู้ตรวจคลัง<br>__________________</div><div class="signature">ผู้รับมอบ<br>__________________</div><div class="signature">ผู้อนุมัติ<br>__________________</div></section>`;
  return documentShell({ title: "ใบยืนยันการจัดเตรียมสินค้า / Pick Confirmation", documentCode, revision: snapshot.workOrder.revision, sourceUpdatedAt: snapshot.sourceUpdatedAt, documentClass: "quality_record", body });
}

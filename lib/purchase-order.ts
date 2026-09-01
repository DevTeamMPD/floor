/**
 * P5-8 / P5-9 — ใบสั่งซื้อและการตรวจรับของ (ฝั่งหน้าจอ)
 *
 * สองสิ่งที่หน้าจอเดิมทำไม่ได้และไฟล์นี้มีไว้เพื่อทำให้ได้:
 *   1) ใบสั่งซื้อต้องบอกได้ว่า "ต้องได้ของเมื่อไร" และ "ของแบบไหนถึงจะรับ" (ISO 8.4.3)
 *      สองอย่างนี้เป็นข้อกำหนดที่ต้องสื่อสารกับผู้ขาย *ก่อน* สั่ง ไม่ใช่ไปเถียงกันตอนของมาถึง
 *   2) ตอนของมาถึง ต้องบันทึกได้ว่ารับกี่หน่วย ปฏิเสธกี่หน่วย และปฏิเสธเพราะอะไร
 *      ของที่ปฏิเสธจะกลายเป็นใบ NC โดยอัตโนมัติ ฝั่งเซิร์ฟเวอร์เป็นคนเปิดให้ ไม่ใช่หน้าจอ
 *
 * ทุกการเขียนผ่าน RPC ทั้งหมด — หน้าจอไม่มีสิทธิ์ insert/update ตารางเหล่านี้อีกต่อไป
 */

export const PO_SNAPSHOT_RPC = "purchase_orders_snapshot";
export const PO_FORM_OPTIONS_RPC = "purchase_order_form_options";
export const CREATE_PO_RPC = "create_purchase_order";
export const ISSUE_PO_RPC = "issue_purchase_order";
export const CANCEL_PO_RPC = "cancel_purchase_order";
export const RECORD_RECEIPT_RPC = "record_po_receipt";

export const PO_STATUS_LABELS: Record<string, string> = {
  draft: "ร่าง",
  ordered: "สั่งแล้ว",
  partial: "รับบางส่วน",
  received: "ปิดยอดแล้ว",
  cancelled: "ยกเลิก",
};

export const RECEIPT_RESULT_LABELS: Record<string, string> = {
  pass: "ผ่านทั้งหมด",
  partial_fail: "ไม่ผ่านบางส่วน",
  fail: "ไม่ผ่านทั้งหมด",
};

/** ชนิดของ NC ที่เปิดได้จากการตรวจรับ — ต้องตรงกับ ncr_reports_type_check */
export const RECEIPT_NCR_TYPES = [
  { code: "quality", label: "คุณภาพไม่ได้มาตรฐาน" },
  { code: "damage", label: "ของเสียหาย" },
  { code: "missing", label: "ของขาด/ไม่ครบ" },
  { code: "wrong", label: "ของผิดรุ่น/ผิดสเปก" },
  { code: "other", label: "อื่น ๆ" },
] as const;

export const NCR_SEVERITIES = [
  { code: "low", label: "ต่ำ" },
  { code: "medium", label: "ปานกลาง" },
  { code: "high", label: "สูง" },
  { code: "critical", label: "วิกฤต" },
] as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export interface PoItem {
  id: string;
  materialId: string | null;
  materialName: string | null;
  sku: string | null;
  unit: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  qtyRejected: number;
  unitPrice: number | null;
  note: string | null;
  acceptanceSpec: string | null;
}

export interface PoReceiptLine {
  poItemId: string;
  qtyAccepted: number;
  qtyRejected: number;
  defectNote: string | null;
}

export interface PoReceipt {
  id: string;
  receiptNo: string;
  receivedAt: string | null;
  receivedByName: string | null;
  inspectionResult: string;
  samplePct: number | null;
  note: string | null;
  defectSummary: string | null;
  ncrId: string | null;
  lines: PoReceiptLine[];
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  eta: string | null;
  requiredDate: string | null;
  acceptanceRequirements: string | null;
  jobNo: string | null;
  totalAmount: number | null;
  notes: string | null;
  createdAt: string | null;
  createdByName: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  cancelReason: string | null;
  inspectionSamplePct: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierKind: string | null;
  supplierApprovalStatus: string | null;
  items: PoItem[];
  receipts: PoReceipt[];
}

export interface MaterialOption {
  id: string; sku: string; name: string; unit: string | null; unitCost: number | null; qtyOnHand: number | null;
}
export interface ProviderOption {
  id: string; name: string; providerKind: string | null; leadTimeDays: number | null;
  paymentTerms: string | null; inspectionSamplePct: number | null;
}
export interface JobOption { jobNo: string; customer: string | null }

export interface PoFormOptions {
  providers: ProviderOption[];
  materials: MaterialOption[];
  jobs: JobOption[];
  providerTotal: number;
  materialProviderTotal: number;
}

export const EMPTY_PO_FORM_OPTIONS: PoFormOptions = {
  providers: [], materials: [], jobs: [], providerTotal: 0, materialProviderTotal: 0,
};

export function parsePoFormOptions(value: unknown): PoFormOptions {
  if (!value || typeof value !== "object") return EMPTY_PO_FORM_OPTIONS;
  const raw = value as Record<string, unknown>;
  const providers = Array.isArray(raw.providers)
    ? raw.providers.flatMap((row): ProviderOption[] => {
        if (!row || typeof row !== "object") return [];
        const p = row as Record<string, unknown>;
        const id = text(p.id); const name = text(p.name);
        if (!id || !name) return [];
        return [{ id, name, providerKind: text(p.providerKind), leadTimeDays: num(p.leadTimeDays),
          paymentTerms: text(p.paymentTerms), inspectionSamplePct: num(p.inspectionSamplePct) }];
      })
    : [];
  const materials = Array.isArray(raw.materials)
    ? raw.materials.flatMap((row): MaterialOption[] => {
        if (!row || typeof row !== "object") return [];
        const m = row as Record<string, unknown>;
        const id = text(m.id); const name = text(m.name);
        if (!id || !name) return [];
        return [{ id, name, sku: text(m.sku) ?? "", unit: text(m.unit), unitCost: num(m.unitCost), qtyOnHand: num(m.qtyOnHand) }];
      })
    : [];
  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.flatMap((row): JobOption[] => {
        if (!row || typeof row !== "object") return [];
        const j = row as Record<string, unknown>;
        const jobNo = text(j.jobNo);
        if (!jobNo) return [];
        return [{ jobNo, customer: text(j.customer) }];
      })
    : [];
  return {
    providers, materials, jobs,
    providerTotal: num(raw.providerTotal) ?? 0,
    materialProviderTotal: num(raw.materialProviderTotal) ?? 0,
  };
}

export function parsePurchaseOrders(value: unknown): PurchaseOrder[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.purchaseOrders)) return [];
  return raw.purchaseOrders.flatMap((row): PurchaseOrder[] => {
    if (!row || typeof row !== "object") return [];
    const po = row as Record<string, unknown>;
    const id = text(po.id); const poNumber = text(po.poNumber);
    if (!id || !poNumber) return [];
    const items = Array.isArray(po.items)
      ? po.items.flatMap((it): PoItem[] => {
          if (!it || typeof it !== "object") return [];
          const i = it as Record<string, unknown>;
          const itemId = text(i.id);
          if (!itemId) return [];
          return [{
            id: itemId,
            materialId: text(i.materialId),
            materialName: text(i.materialName),
            sku: text(i.sku),
            unit: text(i.unit),
            qtyOrdered: num(i.qtyOrdered) ?? 0,
            qtyReceived: num(i.qtyReceived) ?? 0,
            qtyRejected: num(i.qtyRejected) ?? 0,
            unitPrice: num(i.unitPrice),
            note: text(i.note),
            acceptanceSpec: text(i.acceptanceSpec),
          }];
        })
      : [];
    const receipts = Array.isArray(po.receipts)
      ? po.receipts.flatMap((r): PoReceipt[] => {
          if (!r || typeof r !== "object") return [];
          const rc = r as Record<string, unknown>;
          const rid = text(rc.id);
          if (!rid) return [];
          return [{
            id: rid,
            receiptNo: text(rc.receiptNo) ?? "",
            receivedAt: text(rc.receivedAt),
            receivedByName: text(rc.receivedByName),
            inspectionResult: text(rc.inspectionResult) ?? "pass",
            samplePct: num(rc.samplePct),
            note: text(rc.note),
            defectSummary: text(rc.defectSummary),
            ncrId: text(rc.ncrId),
            lines: Array.isArray(rc.lines)
              ? rc.lines.flatMap((l): PoReceiptLine[] => {
                  if (!l || typeof l !== "object") return [];
                  const ln = l as Record<string, unknown>;
                  const poItemId = text(ln.poItemId);
                  if (!poItemId) return [];
                  return [{ poItemId, qtyAccepted: num(ln.qtyAccepted) ?? 0,
                    qtyRejected: num(ln.qtyRejected) ?? 0, defectNote: text(ln.defectNote) }];
                })
              : [],
          }];
        })
      : [];
    return [{
      id, poNumber,
      status: text(po.status) ?? "draft",
      eta: text(po.eta),
      requiredDate: text(po.requiredDate),
      acceptanceRequirements: text(po.acceptanceRequirements),
      jobNo: text(po.jobNo),
      totalAmount: num(po.totalAmount),
      notes: text(po.notes),
      createdAt: text(po.createdAt),
      createdByName: text(po.createdByName),
      issuedAt: text(po.issuedAt),
      issuedByName: text(po.issuedByName),
      cancelReason: text(po.cancelReason),
      inspectionSamplePct: num(po.inspectionSamplePct),
      supplierId: text(po.supplierId),
      supplierName: text(po.supplierName),
      supplierKind: text(po.supplierKind),
      supplierApprovalStatus: text(po.supplierApprovalStatus),
      items, receipts,
    }];
  });
}

/** จำนวนที่ยังค้างรับของรายการหนึ่ง — ของที่ปฏิเสธถือว่าปิดยอดไปแล้วเช่นกัน */
export function remainingQty(item: PoItem): number {
  return Math.max(0, item.qtyOrdered - item.qtyReceived - item.qtyRejected);
}

export interface PoDraftItem { materialId: string; qty: string; unitPrice: string; acceptanceSpec: string; note: string }
export interface PoDraft {
  supplierId: string;
  requiredDate: string;
  acceptanceRequirements: string;
  eta: string;
  jobNo: string;
  notes: string;
  items: PoDraftItem[];
}

export function poDraftError(draft: PoDraft, today: string): string | null {
  if (!draft.supplierId) return "เลือกผู้ขายก่อน — ใบสั่งซื้อที่ไม่รู้ว่าส่งถึงใคร ไม่ใช่ข้อกำหนดที่สื่อสารได้";
  if (!draft.requiredDate) return "ระบุวันที่ต้องได้ของ";
  if (draft.requiredDate < today) return "วันที่ต้องได้ของเป็นวันในอดีตไม่ได้";
  if (!draft.acceptanceRequirements.trim()) {
    return "ระบุข้อกำหนดการตรวจรับ — ต้องบอกผู้ขายก่อนสั่งว่า \"ของแบบไหนถึงจะรับ\" (ISO 8.4.3)";
  }
  if (draft.items.length === 0) return "ใบสั่งซื้อต้องมีรายการอย่างน้อยหนึ่งรายการ";
  for (const [index, item] of draft.items.entries()) {
    if (!item.materialId) return `รายการที่ ${index + 1}: ยังไม่ได้เลือกวัสดุ`;
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) return `รายการที่ ${index + 1}: จำนวนที่สั่งต้องมากกว่า 0`;
    if (item.unitPrice.trim() !== "") {
      const price = Number(item.unitPrice);
      if (!Number.isFinite(price) || price < 0) return `รายการที่ ${index + 1}: ราคาต่อหน่วยติดลบไม่ได้`;
    }
  }
  return null;
}

export function poDraftTotal(draft: PoDraft): number {
  return draft.items.reduce((sum, item) => {
    const qty = Number(item.qty); const price = Number(item.unitPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum;
    return sum + qty * price;
  }, 0);
}

export interface ReceiptDraftLine { accepted: string; rejected: string; defectNote: string }
export type ReceiptDraft = Record<string, ReceiptDraftLine>;

export interface ReceiptCheck {
  error: string | null;
  totalAccepted: number;
  totalRejected: number;
  /** true = มีของถูกปฏิเสธ ระบบจะเปิด NC ให้หนึ่งใบ */
  willOpenNcr: boolean;
  /** true = ต้องให้คนเลือกเลขงาน เพราะใบสั่งซื้อไม่ได้ผูกกับงานใด */
  needsJobNo: boolean;
}

/**
 * ตรวจร่างการตรวจรับก่อนส่ง — ผู้ตัดสินจริงคือ record_po_receipt
 * needsJobNo คือจุดที่หน้าจอต้องซื่อสัตย์: ใบ NC ในระบบนี้ผูกกับเลขงานเสมอ
 * ถ้าใบสั่งซื้อไม่ได้ซื้อเพื่องานใดงานหนึ่ง คนต้องบอกว่าของล็อตนี้จะไปกระทบงานไหน
 */
export function receiptDraftCheck(po: PurchaseOrder, draft: ReceiptDraft, jobNo: string): ReceiptCheck {
  let totalAccepted = 0;
  let totalRejected = 0;
  let error: string | null = null;

  for (const item of po.items) {
    const line = draft[item.id];
    if (!line) continue;
    const accepted = line.accepted.trim() === "" ? 0 : Number(line.accepted);
    const rejected = line.rejected.trim() === "" ? 0 : Number(line.rejected);
    const name = item.materialName ?? "รายการนี้";
    if (!Number.isFinite(accepted) || !Number.isFinite(rejected) || accepted < 0 || rejected < 0) {
      error ??= `รายการ "${name}": จำนวนที่รับและที่ปฏิเสธติดลบไม่ได้`;
      continue;
    }
    if (accepted + rejected === 0) continue;
    if (rejected > 0 && !line.defectNote.trim()) {
      error ??= `รายการ "${name}": ของที่ปฏิเสธต้องระบุว่าเสียตรงไหน — ผู้ขายต้องแก้ตามคำอธิบายนี้`;
    }
    const remaining = remainingQty(item);
    if (accepted + rejected > remaining) {
      error ??= `รายการ "${name}": รับ ${accepted} + ปฏิเสธ ${rejected} เกินจำนวนที่ยังค้างรับ (${remaining} ${item.unit ?? "หน่วย"})`;
    }
    totalAccepted += accepted;
    totalRejected += rejected;
  }

  if (!error && totalAccepted + totalRejected === 0) {
    error = "ยังไม่ได้กรอกจำนวนที่รับหรือที่ปฏิเสธเลยสักรายการ";
  }

  const willOpenNcr = totalRejected > 0;
  const needsJobNo = willOpenNcr && !po.jobNo && !jobNo.trim();
  if (!error && needsJobNo) {
    error = "ของบางรายการไม่ผ่าน ระบบจะเปิดใบ NC ให้ — แต่ใบ NC ต้องผูกกับเลขงานเสมอ กรุณาเลือกว่าของล็อตนี้ซื้อมาเพื่องานใด";
  }

  return { error, totalAccepted, totalRejected, willOpenNcr, needsJobNo };
}

/** สรุปที่ต้องเห็นก่อนกดยืนยัน — บอกตรง ๆ ว่ากดแล้วจะเกิดอะไรขึ้น */
export function receiptOutcomeMessage(check: ReceiptCheck): string {
  if (check.error) return check.error;
  if (!check.willOpenNcr) {
    return `รับเข้าคลัง ${check.totalAccepted} หน่วย · ผ่านทั้งหมด จึงไม่มีใบ NC`;
  }
  return `รับเข้าคลัง ${check.totalAccepted} หน่วย · ปฏิเสธ ${check.totalRejected} หน่วย — ระบบจะเปิดใบ NC ให้ 1 ใบ (สาเหตุ: วัสดุ/สินค้า) และผูกกับผู้ขายรายนี้`;
}

export function poFormEmptyMessage(options: PoFormOptions): string | null {
  if (options.providerTotal === 0) {
    return "ยังไม่มีผู้ให้บริการในทะเบียนเลย — ไปเพิ่มที่หน้า \"ผู้ให้บริการภายนอก\" ก่อน จึงจะออกใบสั่งซื้อได้";
  }
  if (options.materialProviderTotal === 0) {
    return "ทะเบียนมีแต่ทีมรับเหมาติดตั้ง ยังไม่มีผู้ขายวัสดุ — ใบสั่งซื้อออกให้ได้เฉพาะผู้ขายวัสดุเท่านั้น";
  }
  if (options.providers.length === 0) {
    return "มีผู้ขายวัสดุในทะเบียนแล้ว แต่ยังไม่มีรายไหนผ่านการอนุมัติ (หรือถูกระงับอยู่) จึงยังออกใบสั่งซื้อให้ใครไม่ได้";
  }
  if (options.materials.length === 0) {
    return "ยังไม่มีวัสดุในคลัง — เพิ่มวัสดุที่หน้า \"คลังวัสดุ\" ก่อน จึงจะระบุรายการที่สั่งได้";
  }
  return null;
}

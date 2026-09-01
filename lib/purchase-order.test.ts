import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parsePurchaseOrders, parsePoFormOptions, poDraftError, poDraftTotal, remainingQty,
  receiptDraftCheck, receiptOutcomeMessage, poFormEmptyMessage, RECEIPT_NCR_TYPES,
  NCR_SEVERITIES, PO_STATUS_LABELS, RECEIPT_RESULT_LABELS,
  type PurchaseOrder, type PoItem, type PoDraft, type ReceiptDraft,
} from "./purchase-order";

const RECEIVING_SQL = path.join(process.cwd(), "supabase/migrations/20260902220020_receiving_inspection.sql");
const PO_SQL = path.join(process.cwd(), "supabase/migrations/20260902220010_purchase_order_requirements.sql");

function item(patch: Partial<PoItem> = {}): PoItem {
  return {
    id: "i1", materialId: "m1", materialName: "แผ่นยางปูพื้น", sku: "RS-140", unit: "ตร.ม.",
    qtyOrdered: 10, qtyReceived: 0, qtyRejected: 0, unitPrice: 100, note: null, acceptanceSpec: null, ...patch,
  };
}
function po(patch: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po1", poNumber: "PO-202609-0001", status: "ordered", eta: null, requiredDate: "2026-09-10",
    acceptanceRequirements: "ต้องแนบใบรับรอง", jobNo: null, totalAmount: 1000, notes: null,
    createdAt: null, createdByName: null, issuedAt: "2026-09-02", issuedByName: null, cancelReason: null,
    inspectionSamplePct: 20, supplierId: "s1", supplierName: "ผู้ขาย ก", supplierKind: "material",
    supplierApprovalStatus: "approved", items: [item()], receipts: [], ...patch,
  };
}

describe("ค่าคงที่ฝั่งหน้าจอต้องตรงกับที่ฐานข้อมูลยอมรับ", () => {
  it("ชนิด NC ที่ให้เลือกตอนตรวจรับ ต้องเป็นชุดเดียวกับที่ record_po_receipt ยอมรับ", () => {
    const sql = fs.readFileSync(RECEIVING_SQL, "utf8");
    const line = sql.match(/p_ncr_type not in \(([^)]*)\)/)?.[1] ?? "";
    for (const type of RECEIPT_NCR_TYPES) {
      expect(line, `ชนิด ${type.code} ไม่อยู่ในรายการที่ฐานข้อมูลยอมรับ`).toContain(`'${type.code}'`);
    }
    expect(line.split(",")).toHaveLength(RECEIPT_NCR_TYPES.length);
  });

  it("ระดับความรุนแรงตรงกับที่ฐานข้อมูลยอมรับ", () => {
    const sql = fs.readFileSync(RECEIVING_SQL, "utf8");
    const line = sql.match(/p_ncr_severity not in \(([^)]*)\)/)?.[1] ?? "";
    for (const severity of NCR_SEVERITIES) {
      expect(line).toContain(`'${severity.code}'`);
    }
  });

  it("สถานะใบสั่งซื้อที่หน้าจอมีป้ายให้ ครบตาม purchase_orders_status_check เดิม", () => {
    for (const status of ["draft", "ordered", "partial", "received", "cancelled"]) {
      expect(PO_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("ผลการตรวจรับที่หน้าจอมีป้ายให้ ครบตาม po_receipts_result_check", () => {
    const sql = fs.readFileSync(RECEIVING_SQL, "utf8");
    expect(sql).toContain("inspection_result in ('pass','partial_fail','fail')");
    for (const result of ["pass", "partial_fail", "fail"]) {
      expect(RECEIPT_RESULT_LABELS[result]).toBeTruthy();
    }
  });

  it("migration ของใบสั่งซื้อบังคับข้อกำหนดการตรวจรับจริง ไม่ใช่แค่หน้าจอเตือน", () => {
    const sql = fs.readFileSync(PO_SQL, "utf8");
    expect(sql).toContain("purchase_orders_issued_needs_requirements");
    expect(sql).toContain("btrim(coalesce(acceptance_requirements,'')) <> ''");
  });
});

describe("parsePurchaseOrders", () => {
  it("payload ว่างได้อาเรย์ว่าง ไม่ใช่ระเบิด", () => {
    expect(parsePurchaseOrders(null)).toEqual([]);
    expect(parsePurchaseOrders({})).toEqual([]);
    expect(parsePurchaseOrders({ purchaseOrders: "ไม่ใช่ array" })).toEqual([]);
  });

  it("อ่านใบพร้อมรายการและประวัติการตรวจรับ", () => {
    const parsed = parsePurchaseOrders({
      purchaseOrders: [{
        id: "po1", poNumber: "PO-202609-0001", status: "partial", requiredDate: "2026-09-09",
        acceptanceRequirements: "ตรวจความหนา", jobNo: "JOB-1", supplierName: "ผู้ขาย ก",
        items: [{ id: "i1", materialName: "แผ่นยาง", qtyOrdered: 10, qtyReceived: 6, qtyRejected: 4, unitPrice: 100 }],
        receipts: [{ id: "r1", receiptNo: "RC-202609-0001", inspectionResult: "partial_fail", ncrId: "n1",
          lines: [{ poItemId: "i1", qtyAccepted: 6, qtyRejected: 4, defectNote: "ขอบบิ่น" }] }],
      }],
    });
    expect(parsed[0].items[0].qtyRejected).toBe(4);
    expect(parsed[0].receipts[0].ncrId).toBe("n1");
    expect(parsed[0].receipts[0].lines[0].defectNote).toBe("ขอบบิ่น");
  });

  it("แถวที่ไม่มีเลขใบถูกทิ้ง", () => {
    expect(parsePurchaseOrders({ purchaseOrders: [{ id: "x" }, {}] })).toEqual([]);
  });
});

describe("parsePoFormOptions บอกความต่างระหว่าง 'ไม่มีใครเลย' กับ 'มีแต่ยังไม่อนุมัติ'", () => {
  it("ทะเบียนว่างจริง", () => {
    const message = poFormEmptyMessage(parsePoFormOptions({ providerTotal: 0, materialProviderTotal: 0 }));
    expect(message).toContain("ยังไม่มีผู้ให้บริการในทะเบียนเลย");
  });
  it("มีแต่ทีมรับเหมา ไม่มีผู้ขายวัสดุ", () => {
    const message = poFormEmptyMessage(parsePoFormOptions({ providerTotal: 3, materialProviderTotal: 0 }));
    expect(message).toContain("ยังไม่มีผู้ขายวัสดุ");
  });
  it("มีผู้ขายวัสดุแต่ยังไม่อนุมัติสักราย", () => {
    const message = poFormEmptyMessage(parsePoFormOptions({ providerTotal: 3, materialProviderTotal: 2, providers: [] }));
    expect(message).toContain("ยังไม่มีรายไหนผ่านการอนุมัติ");
  });
  it("มีผู้ขายพร้อมแต่ไม่มีวัสดุในคลัง", () => {
    const options = parsePoFormOptions({ providerTotal: 1, materialProviderTotal: 1,
      providers: [{ id: "s1", name: "ผู้ขาย" }], materials: [] });
    expect(poFormEmptyMessage(options)).toContain("ยังไม่มีวัสดุในคลัง");
  });
  it("พร้อมใช้งานแล้วไม่ต้องขึ้นข้อความ", () => {
    const options = parsePoFormOptions({ providerTotal: 1, materialProviderTotal: 1,
      providers: [{ id: "s1", name: "ผู้ขาย" }], materials: [{ id: "m1", name: "วัสดุ", sku: "X" }] });
    expect(poFormEmptyMessage(options)).toBeNull();
  });
});

describe("ISO 8.4.3 — ด่านของร่างใบสั่งซื้อ", () => {
  const today = "2026-09-02";
  const base: PoDraft = { supplierId: "s1", requiredDate: "2026-09-09", acceptanceRequirements: "ตรวจความหนา",
    eta: "", jobNo: "", notes: "", items: [{ materialId: "m1", qty: "10", unitPrice: "100", acceptanceSpec: "", note: "" }] };

  it("ไม่เลือกผู้ขายไม่ได้", () => expect(poDraftError({ ...base, supplierId: "" }, today)).toContain("ผู้ขาย"));
  it("ไม่ระบุวันที่ต้องได้ของไม่ได้", () => expect(poDraftError({ ...base, requiredDate: "" }, today)).toContain("วันที่ต้องได้ของ"));
  it("วันที่ในอดีตไม่ได้", () => expect(poDraftError({ ...base, requiredDate: "2026-09-01" }, today)).toContain("อดีต"));
  it("วันนี้ได้", () => expect(poDraftError({ ...base, requiredDate: today }, today)).toBeNull());
  it("ไม่มีข้อกำหนดการตรวจรับไม่ได้ และข้อความอ้าง 8.4.3", () => {
    const message = poDraftError({ ...base, acceptanceRequirements: "  " }, today);
    expect(message).toContain("ของแบบไหนถึงจะรับ");
    expect(message).toContain("8.4.3");
  });
  it("ไม่มีรายการไม่ได้", () => expect(poDraftError({ ...base, items: [] }, today)).toContain("อย่างน้อยหนึ่งรายการ"));
  it("จำนวนเป็นศูนย์หรือติดลบไม่ได้ และบอกว่ารายการที่เท่าไร", () => {
    expect(poDraftError({ ...base, items: [{ ...base.items[0], qty: "0" }] }, today)).toContain("รายการที่ 1");
    expect(poDraftError({ ...base, items: [{ ...base.items[0], qty: "-2" }] }, today)).toContain("มากกว่า 0");
  });
  it("ราคาติดลบไม่ได้", () => {
    expect(poDraftError({ ...base, items: [{ ...base.items[0], unitPrice: "-5" }] }, today)).toContain("ติดลบ");
  });
  it("ราคาว่างได้ (ใช้ราคาทุนของวัสดุ)", () => {
    expect(poDraftError({ ...base, items: [{ ...base.items[0], unitPrice: "" }] }, today)).toBeNull();
  });
  it("ยอดรวมคำนวณจากทุกรายการ", () => {
    expect(poDraftTotal({ ...base, items: [
      { materialId: "m1", qty: "10", unitPrice: "100", acceptanceSpec: "", note: "" },
      { materialId: "m2", qty: "2", unitPrice: "50", acceptanceSpec: "", note: "" }] })).toBe(1100);
  });
});

describe("remainingQty — ของที่ปฏิเสธถือว่าปิดยอดแล้ว", () => {
  it("รับ 6 ปฏิเสธ 4 จาก 10 = ค้าง 0", () => {
    expect(remainingQty(item({ qtyReceived: 6, qtyRejected: 4 }))).toBe(0);
  });
  it("ไม่ติดลบแม้ข้อมูลจะเพี้ยน", () => {
    expect(remainingQty(item({ qtyReceived: 20 }))).toBe(0);
  });
});

describe("ISO 8.4.2 — ด่านของการตรวจรับ", () => {
  const empty: ReceiptDraft = { i1: { accepted: "", rejected: "", defectNote: "" } };

  it("ไม่กรอกอะไรเลยไม่ได้", () => {
    expect(receiptDraftCheck(po(), empty, "").error).toContain("ยังไม่ได้กรอก");
  });

  it("ปฏิเสธของโดยไม่บอกว่าเสียตรงไหนไม่ได้", () => {
    const draft: ReceiptDraft = { i1: { accepted: "6", rejected: "4", defectNote: "  " } };
    expect(receiptDraftCheck(po({ jobNo: "JOB-1" }), draft, "").error).toContain("เสียตรงไหน");
  });

  it("รับเกินจำนวนที่ค้างไม่ได้ และบอกว่าค้างเท่าไร", () => {
    const draft: ReceiptDraft = { i1: { accepted: "12", rejected: "0", defectNote: "" } };
    expect(receiptDraftCheck(po(), draft, "").error).toContain("เกินจำนวนที่ยังค้างรับ");
  });

  it("ของไม่ผ่านแต่ใบสั่งซื้อไม่ผูกกับงาน -> ต้องถามหาเลขงาน", () => {
    const draft: ReceiptDraft = { i1: { accepted: "6", rejected: "4", defectNote: "ขอบบิ่น" } };
    const check = receiptDraftCheck(po({ jobNo: null }), draft, "");
    expect(check.needsJobNo).toBe(true);
    expect(check.error).toContain("ใบ NC ต้องผูกกับเลขงานเสมอ");
  });

  it("ใบสั่งซื้อที่ผูกกับงานอยู่แล้ว ไม่ต้องถามซ้ำ", () => {
    const draft: ReceiptDraft = { i1: { accepted: "6", rejected: "4", defectNote: "ขอบบิ่น" } };
    const check = receiptDraftCheck(po({ jobNo: "JOB-1" }), draft, "");
    expect(check.needsJobNo).toBe(false);
    expect(check.error).toBeNull();
    expect(check.willOpenNcr).toBe(true);
  });

  it("คนเลือกเลขงานเองก็ผ่าน", () => {
    const draft: ReceiptDraft = { i1: { accepted: "0", rejected: "4", defectNote: "ผิวลอก" } };
    const check = receiptDraftCheck(po({ jobNo: null }), draft, "JOB-9");
    expect(check.error).toBeNull();
    expect(check.totalRejected).toBe(4);
  });

  it("รับผ่านทั้งหมด ไม่ต้องมีเลขงานและไม่เปิด NC", () => {
    const draft: ReceiptDraft = { i1: { accepted: "10", rejected: "0", defectNote: "" } };
    const check = receiptDraftCheck(po({ jobNo: null }), draft, "");
    expect(check.error).toBeNull();
    expect(check.willOpenNcr).toBe(false);
    expect(receiptOutcomeMessage(check)).toContain("ไม่มีใบ NC");
  });

  it("สรุปก่อนกดยืนยันบอกตรง ๆ ว่าจะเปิด NC หนึ่งใบ", () => {
    const draft: ReceiptDraft = { i1: { accepted: "6", rejected: "4", defectNote: "ขอบบิ่น" } };
    const message = receiptOutcomeMessage(receiptDraftCheck(po({ jobNo: "JOB-1" }), draft, ""));
    expect(message).toContain("NC ให้ 1 ใบ");
    expect(message).toContain("วัสดุ/สินค้า");
  });

  it("จำนวนติดลบถูกปฏิเสธ", () => {
    const draft: ReceiptDraft = { i1: { accepted: "-1", rejected: "0", defectNote: "" } };
    expect(receiptDraftCheck(po(), draft, "").error).toContain("ติดลบ");
  });

  it("รายการที่ไม่ได้กรอกถูกข้าม ไม่ใช่ถูกนับเป็นศูนย์ที่ผิดพลาด", () => {
    const twoItems = po({ items: [item(), item({ id: "i2", materialName: "กาว" })] });
    const draft: ReceiptDraft = { i1: { accepted: "5", rejected: "0", defectNote: "" } };
    const check = receiptDraftCheck(twoItems, draft, "");
    expect(check.error).toBeNull();
    expect(check.totalAccepted).toBe(5);
  });
});

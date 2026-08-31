import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FALLBACK_QC_ITEMS,
  NO_ASSIGNMENT_FALLBACK_REASON,
  checklistFromRpcPayload,
  checklistItemsFromRows,
  checklistProvenanceLabel,
  checklistRpcReasonMessage,
  checklistWithoutAssignment,
  codeForLegacyQcId,
  fallbackChecklist,
  loadingChecklist,
  normalizeQcResults,
  qcSaveBlockReason,
} from "./job-checklist";

describe("ชุดสำรองต้องตรงกับที่ seed ไว้ในฐานข้อมูล", () => {
  const seed = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "migrations", "20260901130000_seed_floor_qc_template.sql"),
    "utf8",
  );

  it("มี 15 ข้อ รหัส QC01–QC15 เรียงตามลำดับ", () => {
    expect(FALLBACK_QC_ITEMS).toHaveLength(15);
    expect(FALLBACK_QC_ITEMS.map((item) => item.code)).toEqual(
      Array.from({ length: 15 }, (_, index) => codeForLegacyQcId(index + 1)),
    );
  });

  // เป็นตัวกันไม่ให้ชุดสำรองในโค้ดกับชุดที่ seed เข้าฐานข้อมูลเลื่อนออกจากกันเงียบ ๆ
  // ถ้าสองชุดไม่ตรงกัน ผลตรวจรับเก่าที่คีย์ด้วยเลขข้อจะถูกอ่านผิดข้อทันที
  it("ทุกข้อมี label และ spec ตรงกับไฟล์ seed แบบข้อต่อข้อ", () => {
    for (const item of FALLBACK_QC_ITEMS) {
      expect(seed).toContain(`'${item.code}', '${item.label}', '${item.spec}'`);
    }
  });
});

describe("codeForLegacyQcId", () => {
  it("เติมศูนย์นำหน้าให้เป็นรหัสสองหลักเสมอ", () => {
    expect(codeForLegacyQcId(1)).toBe("QC01");
    expect(codeForLegacyQcId(15)).toBe("QC15");
  });

  it("ครอบคลุมทุกข้อของชุดสำรองแบบข้อต่อข้อ", () => {
    FALLBACK_QC_ITEMS.forEach((item, index) => {
      expect(codeForLegacyQcId(index + 1)).toBe(item.code);
    });
  });
});

describe("normalizeQcResults — ผลตรวจรับเก่าต้องไม่หายและไม่เพี้ยนข้อ", () => {
  it("แปลงคีย์เลขข้อของข้อมูลเก่าเป็นรหัสเกณฑ์", () => {
    expect(normalizeQcResults({ 1: "pass", 2: "fail", 15: "na" })).toEqual({
      QC01: "pass", QC02: "fail", QC15: "na",
    });
  });

  it("คีย์ที่เป็นรหัสอยู่แล้วคงไว้ตามเดิม", () => {
    expect(normalizeQcResults({ QC03: "pass", QC04: "na" })).toEqual({ QC03: "pass", QC04: "na" });
  });

  it("ถ้ามีทั้งสองแบบชนกัน ให้ยึดคีย์ที่เป็นรหัส (ข้อมูลที่ใหม่กว่า)", () => {
    expect(normalizeQcResults({ 5: "fail", QC05: "pass" })).toEqual({ QC05: "pass" });
  });

  it("ทิ้งค่าที่ไม่ใช่ผลตรวจรับที่ระบบรู้จัก แทนที่จะแสดงค่ามั่ว", () => {
    expect(normalizeQcResults({ 1: null, 2: "unknown", 3: 42, QC04: "pass" })).toEqual({ QC04: "pass" });
  });

  it("ข้อมูลที่ไม่ใช่อ็อบเจ็กต์คืนค่าว่าง ไม่โยน error ใส่หน้าจอ", () => {
    expect(normalizeQcResults(null)).toEqual({});
    expect(normalizeQcResults("{}")).toEqual({});
    expect(normalizeQcResults([1, 2])).toEqual({});
  });
});

describe("checklistItemsFromRows", () => {
  const rows = [
    { code: "QC02", label: "ข้อสอง", spec_text: "≤ 1 mm", sort_order: 1, is_active: true, requires_photo: true, is_critical: false, measuring_device_kind: "ฟีลเลอร์เกจ" },
    { code: "QC01", label: "ข้อหนึ่ง", spec_text: null, sort_order: 0, is_active: true },
    { code: "QC03", label: "ข้อที่ปิดใช้งาน", sort_order: 2, is_active: false },
    { code: "", label: "ไม่มีรหัส", sort_order: 3, is_active: true },
  ];

  it("เรียงตาม sort_order และตัดข้อที่ปิดใช้งาน/ข้อมูลไม่ครบออก", () => {
    expect(checklistItemsFromRows(rows).map((item) => item.code)).toEqual(["QC01", "QC02"]);
  });

  it("อ่านค่าธงของแต่ละข้อได้ถูกต้อง และตั้งค่าตั้งต้นเมื่อไม่ได้ส่งมา", () => {
    const [first, second] = checklistItemsFromRows(rows);
    expect(first).toMatchObject({ spec: null, requiresPhoto: false, isCritical: true, measuringDeviceKind: null });
    expect(second).toMatchObject({ spec: "≤ 1 mm", requiresPhoto: true, isCritical: false, measuringDeviceKind: "ฟีลเลอร์เกจ" });
  });

  it("ข้อมูลที่ไม่ใช่อาร์เรย์คืนรายการว่าง", () => {
    expect(checklistItemsFromRows(null)).toEqual([]);
  });
});

describe("checklistFromRpcPayload — ต้องตกไปใช้ชุดสำรองแทนที่จะปล่อยจอว่าง", () => {
  it("อ่านแม่แบบได้ ใช้รายการจากแม่แบบพร้อมเลขเวอร์ชัน", () => {
    const source = checklistFromRpcPayload({
      found: true, templateId: "11111111-1111-1111-1111-111111111111", version: 2, jobTypeName: "ปูพื้น",
      items: [{ code: "QC01", label: "ข้อหนึ่ง", sort_order: 0, is_active: true }],
    }, "ไม่ควรถูกใช้");
    expect(source.origin).toBe("template");
    expect(source.version).toBe(2);
    expect(source.items).toHaveLength(1);
    expect(source.fallbackReason).toBeNull();
  });

  it("ไม่มีแม่แบบที่เปิดใช้งาน ใช้ชุดสำรองพร้อมบอกเหตุผลที่ RPC ส่งมา", () => {
    const source = checklistFromRpcPayload({ found: false, reason: "no_active_template" }, "ข้อความสำรองของหน้าจอ");
    expect(source.origin).toBe("fallback");
    expect(source.items).toHaveLength(15);
    expect(source.fallbackReason).toBe(checklistRpcReasonMessage("no_active_template"));
  });

  it("reason ที่ไม่รู้จักหรือไม่มี ตกกลับไปใช้ข้อความสำรองของหน้าจอ", () => {
    expect(checklistFromRpcPayload({ found: false, reason: "อะไรก็ไม่รู้" }, "ข้อความสำรอง").fallbackReason)
      .toBe("ข้อความสำรอง");
    expect(checklistFromRpcPayload({ found: false }, "ข้อความสำรอง").fallbackReason).toBe("ข้อความสำรอง");
  });

  it("แม่แบบมีอยู่แต่ไม่มีข้อที่เปิดใช้งานเลย ก็ยังต้องไม่ปล่อยจอว่าง", () => {
    const source = checklistFromRpcPayload({ found: true, version: 3, items: [] }, "แม่แบบไม่มีเกณฑ์ที่เปิดใช้งาน");
    expect(source.origin).toBe("fallback");
    expect(source.items).toHaveLength(15);
  });

  it("payload พังหรือเป็น null ก็ยังได้ชุดสำรอง", () => {
    expect(checklistFromRpcPayload(null, "อ่านไม่ได้").items).toHaveLength(15);
    expect(checklistFromRpcPayload("boom", "อ่านไม่ได้").origin).toBe("fallback");
  });
});



// A5: RPC แยกสองสาเหตุไว้แล้ว หน้าจอต้องไม่ยุบเป็นข้อความเดียว เพราะคนละคนต้องลงมือแก้
describe("checklistRpcReasonMessage — สาเหตุต่างกันต้องได้ข้อความต่างกัน", () => {
  it("job_type_not_found กับ no_active_template ต้องไม่ใช่ข้อความเดียวกัน", () => {
    const jobType = checklistRpcReasonMessage("job_type_not_found");
    const template = checklistRpcReasonMessage("no_active_template");
    expect(jobType).toBeTruthy();
    expect(template).toBeTruthy();
    expect(jobType).not.toBe(template);
  });

  it("แม่แบบเปิดใช้งานแต่ไม่มีเกณฑ์สักข้อ มีข้อความของตัวเอง", () => {
    const items = checklistRpcReasonMessage("template_has_no_active_items");
    expect(items).toBeTruthy();
    expect(items).not.toBe(checklistRpcReasonMessage("no_active_template"));
  });

  it("ค่าที่ไม่รู้จักคืน null ไม่แต่งข้อความขึ้นเอง", () => {
    expect(checklistRpcReasonMessage("boom")).toBeNull();
    expect(checklistRpcReasonMessage(null)).toBeNull();
    expect(checklistRpcReasonMessage(7)).toBeNull();
  });
});

// A3: ระหว่างโหลดต้องไม่เอาชุดสำรอง 15 ข้อขึ้นจอราวกับเป็นเกณฑ์จริง
describe("loadingChecklist — สถานะกำลังโหลดต้องแยกจากสถานะใช้ชุดสำรอง", () => {
  it("ไม่คืนรายการเกณฑ์ออกมาเลยระหว่างโหลด", () => {
    const source = loadingChecklist();
    expect(source.origin).toBe("loading");
    expect(source.items).toEqual([]);
    expect(source.fallbackReason).toBeNull();
  });

  it("ป้ายที่มาบอกว่ากำลังโหลด ไม่ใช่ป้ายชุดสำรอง", () => {
    const label = checklistProvenanceLabel(loadingChecklist());
    expect(label).toContain("กำลังโหลด");
    expect(label).not.toContain("ชุดสำรอง");
  });

  it("สถานะกำลังโหลดต่างจากชุดสำรองอย่างชัดเจน", () => {
    expect(loadingChecklist().origin).not.toBe(fallbackChecklist("เหตุผลใด ๆ").origin);
    expect(fallbackChecklist("เหตุผลใด ๆ").items).toHaveLength(15);
  });
});

// A1: งานคิวทีมที่ไม่มีใบมอบหมายรายบุคคล ต้อง "จบ" ไม่ใช่ค้างคำว่ากำลังโหลดตลอดกาล
describe("checklistWithoutAssignment — งานคิวทีมต้องได้สถานะที่จบแล้ว", () => {
  it("จบที่ชุดสำรองครบ 15 ข้อ ไม่ใช่จอว่าง", () => {
    const source = checklistWithoutAssignment();
    expect(source.origin).toBe("fallback");
    expect(source.items).toHaveLength(15);
  });

  it("เหตุผลบอกความจริงว่าเป็นคิวทีม ห้ามใช้คำว่ากำลังโหลด", () => {
    const source = checklistWithoutAssignment();
    expect(source.fallbackReason).toBe(NO_ASSIGNMENT_FALLBACK_REASON);
    expect(source.fallbackReason).not.toContain("กำลังโหลด");
    expect(source.fallbackReason).toContain("คิวทีม");
  });

  it("สถานะนี้ไม่ใช่ 'กำลังโหลด' จึงไม่ค้างจอ", () => {
    expect(checklistWithoutAssignment().origin).not.toBe("loading");
  });
});

// A2: ปุ่มบันทึกเขียนทับทั้งก้อน ถ้าโหลดของเดิมไม่สำเร็จแล้วยังบันทึกได้ ผลตรวจรับเดิมจะหายทั้งชุด
describe("qcSaveBlockReason — ห้ามบันทึกทับเมื่อยังไม่รู้ว่าของเดิมมีอะไร", () => {
  it("โหลดสำเร็จแล้วเท่านั้นถึงบันทึกได้", () => {
    expect(qcSaveBlockReason("ready")).toBeNull();
  });

  it("ยังโหลดไม่เสร็จ ต้องบล็อกพร้อมเหตุผลภาษาไทย", () => {
    const reason = qcSaveBlockReason("loading");
    expect(reason).toBeTruthy();
    expect(reason).toContain("ยังโหลด");
  });

  it("โหลดล้มเหลว ต้องบล็อกและบอกตรง ๆ ว่าจะทำให้ผลเดิมหาย", () => {
    const reason = qcSaveBlockReason("error");
    expect(reason).toBeTruthy();
    expect(reason).toContain("ทับ");
  });

  it("เหตุผลของสองสถานะที่บล็อกต้องไม่เหมือนกัน คนอ่านจะได้รู้ว่าต้องรอหรือต้องแจ้ง", () => {
    expect(qcSaveBlockReason("loading")).not.toBe(qcSaveBlockReason("error"));
  });
});

describe("checklistProvenanceLabel — ต้องบอกความจริงว่าเกณฑ์ที่เห็นมาจากไหน", () => {
  it("บอกเลขเวอร์ชันเมื่ออ่านแม่แบบได้", () => {
    const source = checklistFromRpcPayload({
      found: true, version: 4, jobTypeName: "ปูพื้น",
      items: [{ code: "QC01", label: "ข้อหนึ่ง", sort_order: 0, is_active: true }],
    }, "ไม่ควรถูกใช้");
    expect(checklistProvenanceLabel(source)).toBe("เกณฑ์ตรวจรับ v4 · ปูพื้น");
  });

  it("บอกตรง ๆ ว่าเป็นชุดสำรองเมื่ออ่านแม่แบบไม่ได้ — ห้ามแสร้งว่าเป็นเวอร์ชันจากระบบ", () => {
    expect(checklistProvenanceLabel(fallbackChecklist("เน็ตหลุด"))).toBe("เกณฑ์ตรวจรับ (ชุดสำรองในโค้ด)");
  });

  // A4: มาจากแม่แบบจริงแต่ payload ไม่ได้บอกเลขเวอร์ชัน ก็ห้ามป้ายว่าเป็นชุดสำรอง — ป้ายผิดคือโกหกคนอ่าน
  it("มาจากแม่แบบแต่ไม่รู้เลขเวอร์ชัน ต้องไม่ถูกป้ายว่าเป็นชุดสำรองในโค้ด", () => {
    const source = checklistFromRpcPayload({
      found: true, version: "4", jobTypeName: "ปูพื้น",
      items: [{ code: "QC01", label: "ข้อหนึ่ง", sort_order: 0, is_active: true }],
    }, "ไม่ควรถูกใช้");
    expect(source.origin).toBe("template");
    expect(source.version).toBeNull();
    const label = checklistProvenanceLabel(source);
    expect(label).not.toContain("ชุดสำรอง");
    expect(label).toContain("แม่แบบที่เปิดใช้งาน");
    expect(label).toContain("ปูพื้น");
  });
});

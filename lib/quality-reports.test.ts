/**
 * เทสของรายงานคุณภาพ ISO 9.1.3 — สิ่งที่ต้องพิสูจน์คือ "การรวมข้อมูล" ไม่ใช่การวาดกราฟ
 *
 * ขอบเขตที่งานนี้กำหนดให้ต้องมี ครบทั้งสี่:
 *   1) ไม่มีข้อมูลเลย                        — ทุก group ต้องคืน [] และ notice ต้องบอกเหตุผลจริง
 *   2) งานเดียว                              — ตัวเลขต้องไม่ถูกนับซ้ำ และ jobs ต้องเป็น 1
 *   3) เกณฑ์ที่เปลี่ยนชื่อข้ามเวอร์ชันแม่แบบ — ต้องรวมเป็นก้อนเดียวตาม item_code เท่านั้น
 *   4) วัสดุตัวเดียวที่โผล่สองงาน            — ต้องรวมเป็นแถวเดียว และนับงานเป็น 2
 *
 * ฝั่งฐานข้อมูล (ด่านสิทธิ์ การกรองวันที่ การ join ป้ายชื่อปัจจุบัน) ทดสอบที่นี่ไม่ได้
 * เพราะ vitest ของโปรเจกต์นี้ไม่ต่อฐานข้อมูล — พิสูจน์ด้วย probe ที่รันจริงแทน
 * ดู sdd-jobtpl/p46-probes.sql
 */

import { describe, expect, it } from "vitest";
import {
  acceptanceNotice,
  groupAcceptanceFailures,
  groupMaterialShortages,
  groupPickVsUseByJob,
  groupPickVsUseByMaterial,
  parseAcceptanceEnvelope,
  parsePickVsUseEnvelope,
  parseShortageEnvelope,
  pickVsUseNotice,
  shortageNotice,
  toNumber,
  type AcceptanceRow,
  type PickVsUseRow,
  type ShortageRow,
} from "./quality-reports";

/* ------------------------------------------------------------------ ตัวช่วยสร้างแถว */

function acceptanceRow(over: Partial<AcceptanceRow> = {}): AcceptanceRow {
  return {
    jobNo: "JOB-1",
    templateId: "tpl-v1",
    templateVersion: 1,
    itemCode: "QC07",
    labelSnapshot: "ความสมบูรณ์แนวเชื่อม",
    currentLabel: "ความสมบูรณ์แนวเชื่อม",
    isCritical: true,
    currentIsCritical: true,
    result: "fail",
    recordedAt: "2026-08-01T03:00:00+00:00",
    ...over,
  };
}

function shortageRow(over: Partial<ShortageRow> = {}): ShortageRow {
  return {
    jobNo: "JOB-1",
    workOrderId: "wo-1",
    materialKey: "RS-140",
    materialId: null,
    sku: "RS-140",
    itemName: "แผ่นกันลื่น RS-140",
    unit: "แผ่น",
    receiptStatus: "received_partial",
    expectedQty: 10,
    receivedQty: 7,
    shortageQty: 3,
    reasonCode: "stock_short",
    hasNcr: false,
    confirmedAt: "2026-08-01T03:00:00+00:00",
    ...over,
  };
}

function pickRow(over: Partial<PickVsUseRow> = {}): PickVsUseRow {
  return {
    itemId: "item-1",
    jobNo: "JOB-1",
    workOrderId: "wo-1",
    materialKey: "RS-140",
    materialId: null,
    sku: "RS-140",
    itemName: "แผ่นกันลื่น RS-140",
    unit: "แผ่น",
    plannedQty: 10,
    actualQty: null,
    pickedQty: 12,
    usedQty: 9,
    returnedQty: 2,
    fromTemplate: true,
    manualOverride: false,
    activityAt: "2026-08-01T03:00:00+00:00",
    ...over,
  };
}

/* ------------------------------------------------------------------ 1) ไม่มีข้อมูล */

describe("ขอบเขตที่ 1 — ไม่มีข้อมูลเลย", () => {
  it("ทุกฟังก์ชันรวมข้อมูลคืนรายการว่าง ไม่ระเบิดและไม่แต่งตัวเลขขึ้นมา", () => {
    expect(groupAcceptanceFailures([])).toEqual([]);
    expect(groupMaterialShortages([])).toEqual([]);
    expect(groupPickVsUseByMaterial([])).toEqual([]);
    expect(groupPickVsUseByJob([])).toEqual([]);
  });

  it("envelope ที่ไม่ใช่รูปร่างที่คาด ต้องกลายเป็น envelope ว่าง ไม่ใช่ throw", () => {
    const parsed = parseAcceptanceEnvelope(null);
    expect(parsed.rows).toEqual([]);
    expect(parsed.rowCount).toBe(0);
    expect(parsed.totalAllTime).toBe(0);
  });

  it("ข้อความจอว่างของรายงานเกณฑ์ตรวจรับ บอกทั้งเหตุผลและสิ่งที่ต้องทำต่อ", () => {
    const notice = acceptanceNotice(
      parseAcceptanceEnvelope({ rows: [], rowCount: 0, totalAllTime: 0, context: { activeTemplateVersion: 1, activeTemplateItemCount: 15 } })
    );
    expect(notice?.tone).toBe("empty");
    expect(notice?.why).toContain("job_acceptance_results");
    expect(notice?.why).toContain("15");
    expect(notice?.steps.length).toBeGreaterThan(0);
  });

  it("แยก “ไม่มีข้อมูลเลย” ออกจาก “ไม่มีในช่วงวันที่ที่เลือก” ได้", () => {
    const filtered = acceptanceNotice(
      parseAcceptanceEnvelope({ rows: [], rowCount: 0, totalAllTime: 42, context: {} })
    );
    expect(filtered?.tone).toBe("filtered");
    expect(filtered?.why).toContain("42");
  });

  it("ของขาด: ยังไม่เคยมีใครรับของ ต่างจาก รับของแล้วแต่ของครบทุกครั้ง", () => {
    const never = shortageNotice(parseShortageEnvelope({ rows: [], rowCount: 0, totalAllTime: 0, context: { receiptRowsAllTime: 0 } }));
    expect(never?.tone).toBe("empty");
    expect(never?.title).toContain("ยังไม่มีช่างคนไหน");

    const allGood = shortageNotice(parseShortageEnvelope({ rows: [], rowCount: 0, totalAllTime: 0, context: { receiptRowsAllTime: 8 } }));
    expect(allGood?.tone).toBe("empty");
    expect(allGood?.why).toContain("8");
    expect(allGood?.title).toContain("ยังไม่เคยมีของขาด");
    expect(allGood?.why).toContain("ข่าวดี");
  });

  it("เบิก vs ใช้: มีบรรทัดของแต่ยังไม่มีใครหยิบ ต้องเป็น partial ไม่ใช่ empty", () => {
    const notice = pickVsUseNotice(
      parsePickVsUseEnvelope({ rows: [], rowCount: 0, totalAllTime: 10, context: { pickedLinesAllTime: 0, usageLinesAllTime: 0 } })
    );
    expect(notice?.tone).toBe("partial");
    expect(notice?.why).toContain("10");
    expect(notice?.why).toContain("picked_qty");
  });

  it("เบิก vs ใช้: หยิบแล้วแต่ยังไม่ปิดยอด ต้องบอกว่าเทียบได้แค่ครึ่งเดียว", () => {
    const notice = pickVsUseNotice(
      parsePickVsUseEnvelope({
        rows: [pickRow({ usedQty: null, returnedQty: null })],
        rowCount: 1,
        totalAllTime: 10,
        context: { pickedLinesAllTime: 5, usageLinesAllTime: 0 },
      })
    );
    expect(notice?.tone).toBe("partial");
    expect(notice?.title).toContain("ยังไม่รู้ว่าใช้จริง");
  });
});

/* ------------------------------------------------------------------ 2) งานเดียว */

describe("ขอบเขตที่ 2 — งานเดียว", () => {
  it("เกณฑ์ตรวจรับของงานเดียว: นับตรงตัว ไม่คูณซ้ำ และอัตราตกไม่นับ “ไม่เกี่ยวข้อง” เป็นตัวหาร", () => {
    const stats = groupAcceptanceFailures([
      acceptanceRow({ itemCode: "QC01", result: "pass", labelSnapshot: "ช่องว่างขอบแผ่น", currentLabel: "ช่องว่างขอบแผ่น" }),
      acceptanceRow({ itemCode: "QC02", result: "fail", labelSnapshot: "รอยต่อชนก่อนเชื่อม", currentLabel: "รอยต่อชนก่อนเชื่อม" }),
      acceptanceRow({ itemCode: "QC03", result: "na", labelSnapshot: "ความตรงของแนวตัด", currentLabel: "ความตรงของแนวตัด" }),
    ]);
    expect(stats).toHaveLength(3);
    const qc02 = stats.find((s) => s.itemCode === "QC02");
    expect(qc02?.fail).toBe(1);
    expect(qc02?.judged).toBe(1);
    expect(qc02?.failRate).toBe(100);
    expect(qc02?.jobs).toBe(1);
    expect(qc02?.jobsWithFail).toBe(1);
    expect(qc02?.spansTemplateVersions).toBe(false);

    const qc03 = stats.find((s) => s.itemCode === "QC03");
    expect(qc03?.na).toBe(1);
    expect(qc03?.judged).toBe(0);
    expect(qc03?.failRate).toBeNull();
  });

  it("เบิก vs ใช้ ของงานเดียว: ออกจากคลังสุทธิ = หยิบ - คืน และส่วนต่างเทียบกับค่าประมาณ", () => {
    const [stat] = groupPickVsUseByJob([pickRow()]);
    expect(stat.key).toBe("JOB-1");
    expect(stat.planned).toBe(10);
    expect(stat.picked).toBe(12);
    expect(stat.returned).toBe(2);
    expect(stat.netOut).toBe(10);
    expect(stat.varianceVsPlan).toBe(0);
    expect(stat.variancePct).toBe(0);
    expect(stat.used).toBe(9);
    expect(stat.usageVsNetOut).toBe(-1);
    expect(stat.comparable).toBe(true);
    expect(stat.templateLines).toBe(1);
  });

  it("บรรทัดที่ยังไม่มีใครหยิบ ต้องเป็น “เทียบไม่ได้” ไม่ใช่ “ส่วนต่างเป็นศูนย์”", () => {
    const [stat] = groupPickVsUseByMaterial([pickRow({ pickedQty: null, usedQty: null, returnedQty: null })]);
    expect(stat.linesWithPick).toBe(0);
    expect(stat.picked).toBe(0);
    expect(stat.comparable).toBe(false);
    expect(stat.varianceVsPlan).toBeNull();
    expect(stat.variancePct).toBeNull();
    expect(stat.usageVsNetOut).toBeNull();
  });
});

/* ---------------------------------- 3) เกณฑ์ที่เปลี่ยนชื่อข้ามเวอร์ชันแม่แบบ (หัวใจของงาน) */

describe("ขอบเขตที่ 3 — เกณฑ์ข้อเดิมที่เปลี่ยนชื่อและเปลี่ยนเวอร์ชันแม่แบบ", () => {
  const rows: AcceptanceRow[] = [
    acceptanceRow({
      jobNo: "JOB-OLD",
      templateId: "tpl-v1",
      templateVersion: 1,
      itemCode: "QC07",
      labelSnapshot: "ความสมบูรณ์แนวเชื่อม",
      currentLabel: "ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)",
      result: "fail",
      recordedAt: "2026-07-01T03:00:00+00:00",
    }),
    acceptanceRow({
      jobNo: "JOB-NEW",
      templateId: "tpl-v2",
      templateVersion: 2,
      itemCode: "QC07",
      labelSnapshot: "ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)",
      currentLabel: "ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)",
      result: "fail",
      recordedAt: "2026-08-20T03:00:00+00:00",
    }),
    acceptanceRow({
      jobNo: "JOB-NEW2",
      templateId: "tpl-v2",
      templateVersion: 2,
      itemCode: "QC07",
      labelSnapshot: "ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)",
      currentLabel: "ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)",
      result: "pass",
      recordedAt: "2026-08-25T03:00:00+00:00",
    }),
  ];

  it("รวมเป็นก้อนเดียวตาม item_code ไม่แตกตาม template_id", () => {
    const stats = groupAcceptanceFailures(rows);
    expect(stats).toHaveLength(1);
    expect(stats[0].itemCode).toBe("QC07");
    expect(stats[0].fail).toBe(2);
    expect(stats[0].judged).toBe(3);
    expect(stats[0].failRate).toBeCloseTo(66.7, 1);
    expect(stats[0].jobs).toBe(3);
    expect(stats[0].jobsWithFail).toBe(2);
  });

  it("บอกได้ว่าสถิตินี้ข้ามแม่แบบมาแล้วกี่รุ่น — ไม่ใช่ซ่อนไว้", () => {
    const [stat] = groupAcceptanceFailures(rows);
    expect(stat.spansTemplateVersions).toBe(true);
    expect(stat.templateVersions).toEqual([1, 2]);
    expect(stat.templateIds).toHaveLength(2);
  });

  it("แสดงป้ายชื่อปัจจุบันคู่กับรหัส และเก็บป้ายเก่าไว้ให้เห็นว่าเคยเปลี่ยนชื่อ", () => {
    const [stat] = groupAcceptanceFailures(rows);
    expect(stat.currentLabel).toBe("ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)");
    expect(stat.displayLabel).toBe("ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)");
    expect(stat.labelChanged).toBe(true);
    expect(stat.labelHistory).toEqual(["ความสมบูรณ์แนวเชื่อม (วัดด้วยเกจ)", "ความสมบูรณ์แนวเชื่อม"]);
    expect(stat.removedFromActiveTemplate).toBe(false);
  });

  it("ข้อที่ถูกถอดออกจากแม่แบบปัจจุบันแล้ว ยังต้องอยู่ในรายงาน และถูกทำเครื่องหมายไว้", () => {
    const [stat] = groupAcceptanceFailures([
      acceptanceRow({ itemCode: "QC99", labelSnapshot: "ข้อที่เลิกใช้แล้ว", currentLabel: null, currentIsCritical: null }),
    ]);
    expect(stat.removedFromActiveTemplate).toBe(true);
    expect(stat.displayLabel).toBe("ข้อที่เลิกใช้แล้ว");
    expect(stat.currentLabel).toBeNull();
  });

  it("เรียงลำดับตามจำนวนครั้งที่ตกก่อน แล้วจึงตามอัตราตก", () => {
    const stats = groupAcceptanceFailures([
      ...rows,
      acceptanceRow({ itemCode: "QC01", result: "fail", jobNo: "JOB-OLD", labelSnapshot: "ช่องว่างขอบแผ่น", currentLabel: "ช่องว่างขอบแผ่น" }),
    ]);
    expect(stats.map((s) => s.itemCode)).toEqual(["QC07", "QC01"]);
  });
});

/* ------------------------------------------- 4) วัสดุตัวเดียวที่โผล่สองงาน */

describe("ขอบเขตที่ 4 — วัสดุตัวเดียวที่โผล่สองงาน", () => {
  it("ของขาด: รวมเป็นแถวเดียว นับครั้ง นับงาน และรวมจำนวนที่ขาดถูกต้อง", () => {
    const stats = groupMaterialShortages([
      shortageRow({ jobNo: "JOB-A", shortageQty: 3, reasonCode: "stock_short" }),
      shortageRow({ jobNo: "JOB-B", shortageQty: 2, reasonCode: "not_loaded", receiptStatus: "not_received", receivedQty: 0, expectedQty: 2, hasNcr: true }),
      shortageRow({ jobNo: "JOB-B", materialKey: "GLUE-01", sku: "GLUE-01", itemName: "กาว", shortageQty: 1, reasonCode: "damaged" }),
    ]);
    expect(stats).toHaveLength(2);
    const rs = stats.find((s) => s.materialKey === "RS-140");
    expect(rs?.events).toBe(2);
    expect(rs?.jobs).toBe(2);
    expect(rs?.jobNos).toEqual(["JOB-A", "JOB-B"]);
    expect(rs?.shortageQty).toBe(5);
    expect(rs?.notReceivedEvents).toBe(1);
    expect(rs?.partialEvents).toBe(1);
    expect(rs?.ncrOpened).toBe(1);
    expect(rs?.reasonCounts).toEqual({ stock_short: 1, not_loaded: 1 });
    expect(stats[0].materialKey).toBe("RS-140");
  });

  it("เหตุผลที่พบบ่อยที่สุดถูกแปลเป็นภาษาไทยจากแคตตาล็อกเดียวกับหน้าจอช่าง", () => {
    const [stat] = groupMaterialShortages([shortageRow({ reasonCode: "lost_on_route" })]);
    expect(stat.topReasonCode).toBe("lost_on_route");
    expect(stat.topReasonLabel).toBe("ตกหล่นระหว่างทาง");
  });

  it("แถวที่ไม่ได้ระบุเหตุผล ต้องบอกว่า “ไม่ได้ระบุ” ไม่ใช่เดาว่าเป็นเหตุผลใดเหตุผลหนึ่ง", () => {
    const [stat] = groupMaterialShortages([shortageRow({ reasonCode: null })]);
    expect(stat.reasonCounts).toEqual({ unspecified: 1 });
    expect(stat.topReasonLabel).toBe("ไม่ได้ระบุเหตุผล");
  });

  it("เบิก vs ใช้: วัสดุตัวเดียวในสองงาน รวมเป็นแถวเดียวและนับงานเป็น 2", () => {
    const stats = groupPickVsUseByMaterial([
      pickRow({ itemId: "i1", jobNo: "JOB-A", plannedQty: 10, pickedQty: 12, usedQty: 10, returnedQty: 1 }),
      pickRow({ itemId: "i2", jobNo: "JOB-B", plannedQty: 5, pickedQty: 8, usedQty: 6, returnedQty: 1 }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].jobs).toBe(2);
    expect(stats[0].lines).toBe(2);
    expect(stats[0].planned).toBe(15);
    expect(stats[0].picked).toBe(20);
    expect(stats[0].returned).toBe(2);
    expect(stats[0].netOut).toBe(18);
    expect(stats[0].varianceVsPlan).toBe(3);
    expect(stats[0].variancePct).toBe(20);
  });

  it("แยกรายงานเป็นรายงานได้ด้วย โดยไม่ปนกับการรวมรายวัสดุ", () => {
    const rows = [
      pickRow({ itemId: "i1", jobNo: "JOB-A", materialKey: "RS-140", plannedQty: 10, pickedQty: 12, usedQty: 10, returnedQty: 1 }),
      pickRow({ itemId: "i2", jobNo: "JOB-A", materialKey: "GLUE-01", sku: "GLUE-01", itemName: "กาว", unit: "หลอด", plannedQty: 2, pickedQty: 2, usedQty: 2, returnedQty: 0 }),
      pickRow({ itemId: "i3", jobNo: "JOB-B", materialKey: "RS-140", plannedQty: 5, pickedQty: 8, usedQty: 6, returnedQty: 1 }),
    ];
    const byJob = groupPickVsUseByJob(rows);
    expect(byJob).toHaveLength(2);
    const jobA = byJob.find((s) => s.key === "JOB-A");
    expect(jobA?.lines).toBe(2);
    expect(jobA?.planned).toBe(12);
    expect(jobA?.picked).toBe(14);
    // หน่วยของ "ทั้งงาน" ไม่มีความหมาย เพราะรวมของหลายหน่วย จึงต้องเป็น null เสมอ
    expect(jobA?.unit).toBeNull();
    expect(groupPickVsUseByMaterial(rows)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ การแปลงค่าดิบ */

describe("การแปลงค่าที่มาจาก PostgREST", () => {
  it("numeric ที่มาเป็น string ต้องกลายเป็นตัวเลข แต่ null ต้องอยู่เป็น null", () => {
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(null)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("ไม่ใช่ตัวเลข")).toBeNull();
  });

  it("envelope ของจริงที่ตัวเลขเป็น string ต้องรวมได้ถูกต้อง ไม่กลายเป็นการต่อ string", () => {
    const parsed = parsePickVsUseEnvelope({
      report: "pick_vs_use",
      rowCount: 2,
      totalAllTime: 2,
      rowCap: 20000,
      truncated: false,
      context: { pickedLinesAllTime: 2, usageLinesAllTime: 2 },
      rows: [
        { itemId: "i1", jobNo: "JOB-A", materialKey: "RS-140", plannedQty: "10.5", pickedQty: "12", usedQty: "9", returnedQty: "1.5", fromTemplate: true, manualOverride: false },
        { itemId: "i2", jobNo: "JOB-A", materialKey: "RS-140", plannedQty: "1.5", pickedQty: "2", usedQty: "2", returnedQty: "0", fromTemplate: true, manualOverride: true },
      ],
    });
    expect(parsed.rows).toHaveLength(2);
    const [stat] = groupPickVsUseByMaterial(parsed.rows);
    expect(stat.planned).toBe(12);
    expect(stat.picked).toBe(14);
    expect(stat.returned).toBe(1.5);
    expect(stat.manualOverrideLines).toBe(1);
  });

  it("แถวที่ผลตรวจรับไม่ใช่สามค่าที่ระบบรู้จัก ต้องถูกทิ้ง ไม่ใช่นับมั่ว", () => {
    const parsed = parseAcceptanceEnvelope({
      rows: [
        { jobNo: "JOB-A", itemCode: "QC01", result: "fail", labelSnapshot: "ก" },
        { jobNo: "JOB-A", itemCode: "QC02", result: "maybe", labelSnapshot: "ข" },
        { jobNo: "JOB-A", result: "fail", labelSnapshot: "ค" },
      ],
      rowCount: 3,
      totalAllTime: 3,
      context: {},
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].itemCode).toBe("QC01");
  });

  it("แถวของขาดที่ไม่มีเลขที่งาน ต้องถูกทิ้ง เพราะนับ “กี่งาน” ไม่ได้", () => {
    const parsed = parseShortageEnvelope({ rows: [{ materialKey: "RS-140", shortageQty: 1 }], rowCount: 1, totalAllTime: 1, context: {} });
    expect(parsed.rows).toEqual([]);
  });
});

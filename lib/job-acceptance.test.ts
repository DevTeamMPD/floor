import { describe, expect, it } from "vitest";
import type { JobChecklistItem } from "@/lib/job-checklist";
import {
  ACCEPTANCE_RULE_NOTICE_LINES,
  NO_MEASURING_DEVICES_HINT,
  acceptanceItemCloseWarning,
  acceptanceItemSaveBlock,
  acceptanceProgress,
  acceptanceSaveBlocks,
  buildAcceptanceResultsPayload,
  closeBlockedByAcceptance,
  deviceCalibrationLabel,
  deviceOptions,
  deviceSelectNotice,
  devicesForKind,
  emptyAcceptanceEntry,
  externalVerificationNotice,
  gateHeadline,
  gateMissingSummary,
  parseAcceptanceGate,
  parseAcceptanceRows,
  parseAcceptanceVerifications,
  parseMeasuringDeviceUsage,
  parseMeasuringDevices,
  selectableDevices,
  shouldShowExternalVerification,
  type AcceptanceEntryMap,
} from "@/lib/job-acceptance";

function item(over: Partial<JobChecklistItem> & { code: string }): JobChecklistItem {
  return {
    code: over.code,
    label: over.label ?? `เกณฑ์ ${over.code}`,
    spec: over.spec ?? null,
    requiresPhoto: over.requiresPhoto ?? false,
    isCritical: over.isCritical ?? true,
    measuringDeviceKind: over.measuringDeviceKind ?? null,
  };
}

describe("parseAcceptanceRows", () => {
  it("แปลงแถวจากฐานข้อมูลเป็นค่าที่ฟอร์มใช้ และคงรูปหลักฐานไว้ครบ", () => {
    const map = parseAcceptanceRows([
      { item_code: "QC01", result: "pass", measured_value: "0.8 mm", measuring_device_id: "dev-1", photo_paths: ["a.jpg", " b.jpg "], note: " ok " },
      { item_code: "QC02", result: "fail", measured_value: null, measuring_device_id: null, photo_paths: null, note: null },
    ]);
    expect(map.QC01).toEqual({ result: "pass", measuredValue: "0.8 mm", measuringDeviceId: "dev-1", photoPaths: ["a.jpg", "b.jpg"], note: "ok" });
    expect(map.QC02).toEqual({ result: "fail", measuredValue: "", measuringDeviceId: null, photoPaths: [], note: "" });
  });

  it("ทิ้งแถวที่ไม่มีรหัสเกณฑ์ และค่าผลที่ไม่รู้จักถือว่ายังไม่ตอบ", () => {
    const map = parseAcceptanceRows([{ item_code: "", result: "pass" }, { item_code: "QC03", result: "maybe" }, "ไม่ใช่แถว"]);
    expect(Object.keys(map)).toEqual(["QC03"]);
    expect(map.QC03.result).toBeNull();
  });

  it("ข้อมูลที่ไม่ใช่รายการคืนค่าว่าง ไม่ throw", () => {
    expect(parseAcceptanceRows(null)).toEqual({});
    expect(parseAcceptanceRows({ item_code: "QC01" })).toEqual({});
  });
});

describe("buildAcceptanceResultsPayload", () => {
  const items = [item({ code: "QC01" }), item({ code: "QC02" })];

  it("ส่งครบทุกข้อที่แสดงอยู่ รวมข้อที่ถูกล้างคำตอบ เพื่อให้ RPC ลบผลเก่าออกจริง", () => {
    const entries: AcceptanceEntryMap = { QC01: { result: "pass", measuredValue: " 1 mm ", measuringDeviceId: "dev-1", photoPaths: ["a.jpg"], note: " ดี " } };
    const payload = buildAcceptanceResultsPayload(items, entries);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toEqual({ code: "QC01", result: "pass", measuredValue: "1 mm", measuringDeviceId: "dev-1", photoPaths: ["a.jpg"], note: "ดี" });
    expect(payload[1]).toEqual({ code: "QC02", result: null, measuredValue: null, measuringDeviceId: null, photoPaths: [], note: null });
  });

  it("ข้อที่ยังไม่ตอบจะไม่ส่งเครื่องมือวัดไปด้วย เพราะผลที่ถูกลบไม่ควรพาเครื่องมือติดไป", () => {
    const entries: AcceptanceEntryMap = { QC01: { ...emptyAcceptanceEntry(), measuringDeviceId: "dev-9" } };
    expect(buildAcceptanceResultsPayload(items, entries)[0].measuringDeviceId).toBeNull();
  });
});

describe("กฎที่หน้าจอต้องบอกล่วงหน้า", () => {
  it("ข้อที่ต้องมีรูปและตอบว่าผ่าน แต่ยังไม่มีรูป -> บันทึกไม่ได้", () => {
    const photoItem = item({ code: "QC05", requiresPhoto: true });
    const entry = { ...emptyAcceptanceEntry(), result: "pass" as const };
    expect(acceptanceItemSaveBlock(photoItem, entry)).toContain("ต้องแนบรูปหลักฐาน");
    expect(acceptanceSaveBlocks([photoItem], { QC05: entry })).toHaveLength(1);
  });

  it("ข้อที่ต้องมีรูปแต่ตอบว่าไม่เกี่ยวข้อง -> บันทึกได้ และไม่ขวางการปิดงาน", () => {
    const photoItem = item({ code: "QC05", requiresPhoto: true });
    const entry = { ...emptyAcceptanceEntry(), result: "na" as const };
    expect(acceptanceItemSaveBlock(photoItem, entry)).toBeNull();
    expect(acceptanceItemCloseWarning(photoItem, entry)).toBeNull();
  });

  it("ข้อที่ต้องมีรูปและตอบว่าไม่ผ่าน -> บันทึกได้ แต่ยังขวางการปิดงานเพราะไม่มีรูป", () => {
    const photoItem = item({ code: "QC05", requiresPhoto: true, isCritical: false });
    const entry = { ...emptyAcceptanceEntry(), result: "fail" as const };
    expect(acceptanceItemSaveBlock(photoItem, entry)).toBeNull();
    expect(acceptanceItemCloseWarning(photoItem, entry)).toContain("ต้องแนบรูปหลักฐาน");
  });

  it("ข้อสำคัญที่ไม่ผ่านขวางการปิดงาน ส่วนข้อไม่สำคัญที่ไม่ผ่านไม่ขวาง", () => {
    expect(acceptanceItemCloseWarning(item({ code: "QC01", isCritical: true }), { ...emptyAcceptanceEntry(), result: "fail" })).toContain("ข้อสำคัญ");
    expect(acceptanceItemCloseWarning(item({ code: "QC01", isCritical: false }), { ...emptyAcceptanceEntry(), result: "fail" })).toBeNull();
  });

  it("ข้อที่ยังไม่ตอบขวางการปิดงานเสมอ — “ไม่มีคอลัมน์ is_required” จึงแปลว่าทุกข้อต้องตอบ", () => {
    expect(acceptanceItemCloseWarning(item({ code: "QC01" }), undefined)).toContain("ยังไม่ได้บันทึกผล");
    expect(ACCEPTANCE_RULE_NOTICE_LINES[0]).toContain("ทุกข้อที่เปิดใช้งานอยู่ต้องมีคำตอบ");
  });

  it("สรุปความคืบหน้านับเฉพาะข้อที่แสดงอยู่จริง", () => {
    const items = [item({ code: "QC01" }), item({ code: "QC02" }), item({ code: "QC03" })];
    const entries: AcceptanceEntryMap = {
      QC01: { ...emptyAcceptanceEntry(), result: "pass" },
      QC02: { ...emptyAcceptanceEntry(), result: "fail" },
      QC99: { ...emptyAcceptanceEntry(), result: "pass" },
    };
    expect(acceptanceProgress(items, entries)).toEqual({ total: 3, answered: 2, pass: 1, fail: 1, na: 0, blocking: 2 });
  });
});

describe("parseAcceptanceGate", () => {
  const raw = {
    ok: false, templateId: "tpl-1", templateVersion: 1, external: false,
    teamId: "t1", teamName: "ทีม A", providerType: null, itemCount: 15, recordedCount: 13,
    missing: [
      { code: "QC04", label: "ขอบแผ่นเผยอ", reason: "not_recorded", text: "ยังไม่ได้บันทึกผล" },
      { code: "QC12", label: "โซนเปียก", reason: "critical_failed", text: 'บันทึกว่า "ไม่ผ่าน" และเป็นข้อสำคัญ' },
    ],
  };

  it("แปลงผลด่านครบทุกช่อง", () => {
    const gate = parseAcceptanceGate(raw)!;
    expect(gate.ok).toBe(false);
    expect(gate.itemCount).toBe(15);
    expect(gate.recordedCount).toBe(13);
    expect(gate.missing.map((row) => row.reason)).toEqual(["not_recorded", "critical_failed"]);
  });

  it("อ่านไม่ออกคืน null — และ null ต้องแปลว่า “ยังไม่ผ่าน” ไม่ใช่ “ผ่าน”", () => {
    expect(parseAcceptanceGate(null)).toBeNull();
    expect(parseAcceptanceGate({ missing: [] })).toBeNull();
    expect(closeBlockedByAcceptance(null)).toContain("ยังอ่านผลด่านตรวจรับไม่ได้");
    expect(gateHeadline(null)).toContain("ถือว่ายังไม่ผ่าน");
  });

  it("สรุปรายการที่ขาดบอกทั้งรหัส ชื่อข้อ และเหตุผล ไม่ใช่แค่จำนวน", () => {
    const gate = parseAcceptanceGate(raw)!;
    const summary = gateMissingSummary(gate);
    expect(summary).toContain("QC04 ขอบแผ่นเผยอ — ยังไม่ได้บันทึกผล");
    expect(summary).toContain("QC12");
    expect(closeBlockedByAcceptance(gate)).toContain("เกณฑ์ตรวจรับยังไม่ครบ");
  });

  it("ด่านที่ผ่านแล้วไม่ขวางการปิดงาน", () => {
    const gate = parseAcceptanceGate({ ...raw, ok: true, missing: [] })!;
    expect(closeBlockedByAcceptance(gate)).toBeNull();
    expect(gateHeadline(gate)).toContain("ครบแล้ว");
  });

  it("เหตุผลที่ไม่รู้จักไม่ทำให้พัง แต่ถูกทำเครื่องหมายว่า unknown", () => {
    const gate = parseAcceptanceGate({ ...raw, missing: [{ code: "QC01", label: "x", reason: "อะไรสักอย่าง", text: "t" }] })!;
    expect(gate.missing[0].reason).toBe("unknown");
  });
});

describe("การรับรองชั้นที่สองของทีมภายนอก", () => {
  const base = { ok: false, templateId: "t", templateVersion: 1, itemCount: 2, recordedCount: 2, missing: [] };

  it("งานทีมภายใน (provider_type = NULL ทุกทีมในวันนี้) ไม่แสดงปุ่มรับรอง", () => {
    const gate = parseAcceptanceGate({ ...base, ok: true, external: false, teamName: "ทีม A", providerType: null })!;
    expect(shouldShowExternalVerification(gate)).toBe(false);
    expect(externalVerificationNotice(gate)).toBeNull();
  });

  it("อ่านด่านไม่ได้ก็ไม่แสดงปุ่มรับรอง — ห้ามเดาว่าเป็นทีมภายนอก", () => {
    expect(shouldShowExternalVerification(null)).toBe(false);
  });

  it("งานทีมภายนอกที่ยังไม่ถูกรับรอง บอกจำนวนข้อที่ค้างรับรอง", () => {
    const gate = parseAcceptanceGate({
      ...base, external: true, teamName: "ทีมรับเหมา ก", providerType: "subcontract",
      missing: [{ code: "QC01", label: "a", reason: "not_verified", text: "ยังไม่มีผู้รับรอง" }],
    })!;
    expect(shouldShowExternalVerification(gate)).toBe(true);
    expect(externalVerificationNotice(gate)).toContain("ยังไม่ได้รับรอง 1 ข้อ");
  });

  it("งานทีมภายนอกที่รับรองครบแล้ว บอกว่าครบแล้ว ไม่ใช่ซ่อนหายไปเฉย ๆ", () => {
    const gate = parseAcceptanceGate({ ...base, ok: true, external: true, teamName: "ทีมรับเหมา ก", providerType: "subcontract" })!;
    expect(externalVerificationNotice(gate)).toContain("รับรองจากฝั่งบริษัทครบแล้ว");
  });

  it("อ่านรายการผู้รับรองรายข้อได้", () => {
    const rows = parseAcceptanceVerifications([
      { item_code: "QC01", verified_at: "2026-09-02T00:00:00Z", verified_role: "cs" },
      { item_code: "QC02", verified_at: null, verified_role: null },
      { item_code: "" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].verifiedRole).toBe("cs");
    expect(rows[1].verifiedAt).toBeNull();
  });
});

describe("ทะเบียนเครื่องมือวัด", () => {
  const rows = [
    { id: "d1", code: "FG-01", kind: "ฟีลเลอร์เกจ", status: "ok", owner_team_id: null, owner_team_name: null, range_text: "0.05-1 mm", resolution_text: "0.05 mm", last_calibrated_at: "2026-01-10", calibration_interval_days: 365, next_due_at: "2027-01-10", calibration_known: true, is_overdue: false, jobs_since_calibration: 2, readings_since_calibration: 5, last_used_at: "2026-08-01T00:00:00Z", note: null },
    { id: "d2", code: "TM-01", kind: "ตลับเมตร/ไม้บรรทัดเหล็ก", status: "out_of_service", owner_team_id: null, owner_team_name: null, calibration_known: false, is_overdue: false, jobs_since_calibration: 0, readings_since_calibration: 0 },
    { id: "d3", code: "FG-02", kind: "ฟีลเลอร์เกจ", status: "due", calibration_known: true, last_calibrated_at: "2025-01-10", next_due_at: "2026-01-10", is_overdue: true },
  ];

  it("แปลงแถวและตัดแถวที่ไม่มีรหัสทิ้ง", () => {
    const devices = parseMeasuringDevices([...rows, { id: "x" }]);
    expect(devices.map((d) => d.code)).toEqual(["FG-01", "TM-01", "FG-02"]);
    expect(devices[0].jobsSinceCalibration).toBe(2);
  });

  it("เครื่องมือที่ปลดจากการใช้งานเลือกไม่ได้ เพราะฐานข้อมูลปฏิเสธอยู่แล้ว", () => {
    const devices = parseMeasuringDevices(rows);
    expect(selectableDevices(devices).map((d) => d.code)).toEqual(["FG-01", "FG-02"]);
    expect(devicesForKind(devices, "ตลับเมตร/ไม้บรรทัดเหล็ก")).toHaveLength(0);
  });

  it("ทะเบียนว่างต้องได้ข้อความไทย ไม่ใช่ dropdown ว่างที่ดูเหมือนพัง", () => {
    expect(deviceSelectNotice([], "ฟีลเลอร์เกจ")).toBe(NO_MEASURING_DEVICES_HINT);
    expect(NO_MEASURING_DEVICES_HINT).toContain("ยังไม่มีเครื่องมือวัดในทะเบียน");
    expect(deviceOptions([], "ฟีลเลอร์เกจ")).toEqual([]);
  });

  it("มีเครื่องมือแต่ไม่มีชนิดที่แม่แบบระบุ -> บอกให้ชัด แล้วเปิดให้เลือกจากทั้งหมด", () => {
    const devices = parseMeasuringDevices(rows);
    const notice = deviceSelectNotice(devices, "นาฬิกา/ตัวจับเวลา");
    expect(notice).toContain("ยังไม่มีเครื่องมือชนิด “นาฬิกา/ตัวจับเวลา”");
    expect(deviceOptions(devices, "นาฬิกา/ตัวจับเวลา").map((d) => d.code)).toEqual(["FG-01", "FG-02"]);
  });

  it("มีชนิดที่ตรง -> ไม่ต้องมีข้อความเตือน และเสนอเฉพาะชนิดที่ตรง", () => {
    const devices = parseMeasuringDevices(rows);
    expect(deviceSelectNotice(devices, "ฟีลเลอร์เกจ")).toBeNull();
    expect(deviceOptions(devices, "ฟีลเลอร์เกจ").map((d) => d.code)).toEqual(["FG-01", "FG-02"]);
  });

  it("“ไม่รู้วันสอบเทียบ” ต้องไม่หน้าตาเหมือน “ยังไม่ครบกำหนด”", () => {
    const devices = parseMeasuringDevices(rows);
    expect(deviceCalibrationLabel(devices[1])).toBe("ยังไม่รู้วันสอบเทียบล่าสุด");
    expect(deviceCalibrationLabel(devices[0])).toContain("ครบกำหนดสอบเทียบ 2027-01-10");
    expect(deviceCalibrationLabel(devices[2])).toContain("เลยกำหนดสอบเทียบแล้ว");
  });

  it("รายงานการใช้เครื่องมือแปลงรหัสเกณฑ์เป็นรายการได้", () => {
    const usage = parseMeasuringDeviceUsage([
      { device_id: "d1", device_code: "FG-01", device_kind: "ฟีลเลอร์เกจ", device_status: "ok", job_no: "J-1", customer_name: "ลูกค้า", item_codes: ["QC01", "QC02"], readings: 2, first_used_at: "2026-08-01T00:00:00Z", last_used_at: "2026-08-02T00:00:00Z", calibration_known: true },
      { device_id: "d1" },
    ]);
    expect(usage).toHaveLength(1);
    expect(usage[0].itemCodes).toEqual(["QC01", "QC02"]);
    expect(usage[0].readings).toBe(2);
  });
});

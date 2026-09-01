import { describe, expect, it } from "vitest";
import {
  CANCELLED_TOOL_BADGE,
  CANCELLED_TOOL_EXPLANATION,
  DEFAULT_OUTSTANDING_SORT,
  callablePhone,
  daysOutLabel,
  holderLabel,
  holderSourceLabel,
  isCancelledJobHolder,
  isExternalHolder,
  overdueLevel,
  parseOutstandingTools,
  sortOutstandingTools,
  summariseOutstandingTools,
  type OutstandingToolRow,
} from "./outstanding-tools";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "item-1", work_order_id: "wo-1", work_order_status: "installing",
    job_no: "JOB-1", customer_name: "ลูกค้า ก", item_name: "เครื่องตัดกระเบื้อง",
    sku: "TOOL-1", unit: "เครื่อง", picked_qty: "2", returned_qty: "0", outstanding_qty: "2",
    out_since: "2026-08-23T02:00:00+00:00", out_since_source: "picked_at", days_out: 9,
    appointment_start: "2026-08-23T02:00:00+00:00",
    team_id: "team-1", team_name: "ทีม ก", team_phone: "081-000-0000", team_provider_type: "in_house",
    holder_technician_id: "tech-1", holder_technician_name: "สมชาย", holder_technician_phone: "089-000-0000",
    holder_source: "team_lead", provider_id: null, provider_name: null,
    usage_recorded_at: null, usage_note: null, pick_note: null,
    ...overrides,
  };
}

function row(overrides: Partial<OutstandingToolRow> = {}): OutstandingToolRow {
  return { ...parseOutstandingTools([raw()])[0], ...overrides };
}

describe("parseOutstandingTools", () => {
  it("แปลงแถวจาก RPC ได้ครบ และแปลงตัวเลขที่มาเป็นข้อความ", () => {
    const rows = parseOutstandingTools([raw()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pickedQty).toBe(2);
    expect(rows[0].outstandingQty).toBe(2);
    expect(rows[0].daysOut).toBe(9);
    expect(rows[0].teamName).toBe("ทีม ก");
  });

  it("ข้อมูลที่ไม่ใช่อาร์เรย์หรือแถวที่ไม่มี id ต้องไม่ทำให้หน้าจอพัง", () => {
    expect(parseOutstandingTools(null)).toEqual([]);
    expect(parseOutstandingTools({ rows: [] })).toEqual([]);
    expect(parseOutstandingTools([null, 1, { item_id: "x" }, { job_no: "y" }])).toEqual([]);
  });

  it("ค่าที่หายไปแทนด้วยข้อความไทยที่อ่านออก ไม่ใช่ค่าว่าง", () => {
    const rows = parseOutstandingTools([raw({ team_name: null, item_name: null, unit: "  " })]);
    expect(rows[0].teamName).toBe("ยังไม่ระบุทีม");
    expect(rows[0].itemName).toBe("ไม่ระบุชื่อ");
    expect(rows[0].unit).toBe("หน่วย");
  });

  it("days_out ติดลบหรือเพี้ยนต้องกลายเป็น 0 ไม่ใช่ตัวเลขติดลบบนหน้าจอ", () => {
    expect(parseOutstandingTools([raw({ days_out: -3 })])[0].daysOut).toBe(0);
    expect(parseOutstandingTools([raw({ days_out: "ไม่ใช่ตัวเลข" })])[0].daysOut).toBe(0);
  });
});

describe("ระดับความเร่งด่วน", () => {
  it("เครื่องมือควรกลับวันเดียวกันหรือวันรุ่งขึ้น เกินนั้นคือเริ่มค้าง เกิน 7 วันคือต้องตาม", () => {
    expect(overdueLevel(0)).toBe("fresh");
    expect(overdueLevel(1)).toBe("fresh");
    expect(overdueLevel(2)).toBe("warn");
    expect(overdueLevel(6)).toBe("warn");
    expect(overdueLevel(7)).toBe("critical");
    expect(overdueLevel(60)).toBe("critical");
  });

  it("ป้ายจำนวนวัน", () => {
    expect(daysOutLabel(0)).toBe("วันนี้");
    expect(daysOutLabel(3)).toBe("3 วัน");
  });
});

describe("ใครถืออยู่", () => {
  it("ทีมมาก่อนเสมอ แล้วต่อด้วยช่างที่โทรได้", () => {
    expect(holderLabel(row())).toBe("ทีม ก · ช่าง สมชาย");
  });

  it("ทีมภายนอกต้องบอกชื่อผู้รับเหมา", () => {
    const external = row({ teamProviderType: "subcontract", providerId: "sup-1", providerName: "บริษัทรับเหมา ข" });
    expect(isExternalHolder(external)).toBe(true);
    expect(holderLabel(external)).toContain("ผู้รับเหมา บริษัทรับเหมา ข");
  });

  it("ทีมภายนอกที่ยังไม่ผูกกับผู้รับเหมาต้องพูดตรง ๆ ว่ายังไม่ผูก ไม่ใช่เงียบ", () => {
    const external = row({ teamProviderType: "subcontract", providerId: null, providerName: null });
    expect(holderLabel(external)).toContain("ยังไม่ผูกกับผู้รับเหมา");
  });

  it("ช่างที่มี provider_id ถือว่าเป็นคนภายนอกแม้ทีมยังไม่ได้ระบุชนิด", () => {
    expect(isExternalHolder(row({ teamProviderType: null, providerId: "sup-9" }))).toBe(true);
    expect(isExternalHolder(row())).toBe(false);
  });

  it("บอกตรง ๆ ว่ารู้ตัวคนได้อย่างไร", () => {
    expect(holderSourceLabel(row({ holderSource: "usage" }))).toContain("บันทึกยอดใช้/คืนล่าสุด");
    expect(holderSourceLabel(row({ holderSource: "receipt" }))).toContain("ตรวจรับของ");
    expect(holderSourceLabel(row({ holderSource: "team_lead" }))).toContain("หัวหน้าทีม");
    expect(holderSourceLabel(row({ holderSource: null }))).toContain("ยังไม่รู้ตัวช่าง");
    expect(holderSourceLabel(row({ holderSource: "อะไรก็ไม่รู้" }))).toContain("ยังไม่รู้ตัวช่าง");
  });

  it("ไม่มีเบอร์ช่างให้ถอยไปใช้เบอร์ทีม", () => {
    expect(callablePhone(row({ holderTechnicianPhone: null }))).toBe("081-000-0000");
    expect(callablePhone(row({ holderTechnicianPhone: null, teamPhone: null }))).toBeNull();
  });
});

describe("การจัดลำดับ", () => {
  const rows = [
    row({ itemId: "a", jobNo: "JOB-C", teamName: "ทีม ค", daysOut: 1, outstandingQty: 5 }),
    row({ itemId: "b", jobNo: "JOB-A", teamName: "ทีม ก", daysOut: 9, outstandingQty: 1 }),
    row({ itemId: "c", jobNo: "JOB-B", teamName: "ทีม ข", daysOut: 4, outstandingQty: 3 }),
  ];

  it("ค่าเริ่มต้นคือค้างนานสุดขึ้นก่อน", () => {
    expect(sortOutstandingTools(rows).map((r) => r.itemId)).toEqual(["b", "c", "a"]);
    expect(DEFAULT_OUTSTANDING_SORT).toEqual({ key: "days", desc: true });
  });

  it("กลับทิศได้", () => {
    expect(sortOutstandingTools(rows, { key: "days", desc: false }).map((r) => r.itemId)).toEqual(["a", "c", "b"]);
  });

  it("เรียงตามเลขงาน ทีม และจำนวนที่ค้างได้", () => {
    expect(sortOutstandingTools(rows, { key: "job", desc: false }).map((r) => r.jobNo)).toEqual(["JOB-A", "JOB-B", "JOB-C"]);
    expect(sortOutstandingTools(rows, { key: "team", desc: false }).map((r) => r.teamName)).toEqual(["ทีม ก", "ทีม ข", "ทีม ค"]);
    expect(sortOutstandingTools(rows, { key: "qty", desc: true }).map((r) => r.outstandingQty)).toEqual([5, 3, 1]);
  });

  it("ค่าเท่ากันต้องได้ลำดับคงที่ ไม่สลับไปมาระหว่างรีเฟรช", () => {
    const tied = [row({ itemId: "z", daysOut: 3 }), row({ itemId: "a", daysOut: 3 })];
    expect(sortOutstandingTools(tied).map((r) => r.itemId)).toEqual(["a", "z"]);
    expect(sortOutstandingTools([...tied].reverse()).map((r) => r.itemId)).toEqual(["a", "z"]);
  });

  it("ไม่แก้อาร์เรย์ต้นฉบับ", () => {
    const original = [...rows];
    sortOutstandingTools(rows, { key: "job", desc: true });
    expect(rows).toEqual(original);
  });
});

describe("สรุปยอดรวม", () => {
  it("นับบรรทัด จำนวนชิ้น ทีม ของภายนอก และรายการที่ค้างนาน", () => {
    const rows = [
      row({ itemId: "a", teamId: "t1", outstandingQty: 2, daysOut: 9 }),
      row({ itemId: "b", teamId: "t1", outstandingQty: 1, daysOut: 1 }),
      row({ itemId: "c", teamId: "t2", outstandingQty: 3, daysOut: 8, teamProviderType: "subcontract", providerId: "s1" }),
    ];
    expect(summariseOutstandingTools(rows)).toEqual({ lines: 3, totalQty: 6, teams: 2, external: 1, critical: 2, cancelled: 0, oldestDays: 9 });
  });

  it("ไม่มีของค้างเลย ต้องได้ศูนย์ทุกช่อง", () => {
    expect(summariseOutstandingTools([])).toEqual({ lines: 0, totalQty: 0, teams: 0, external: 0, critical: 0, cancelled: 0, oldestDays: 0 });
  });
});

describe("งานที่ถูกยกเลิกแล้วแต่ของยังไม่กลับคลัง", () => {
  const base = {
    item_id: "i1", job_no: "J-1", item_name: "สว่าน", unit: "ตัว",
    picked_qty: 1, returned_qty: 0, outstanding_qty: 1, days_out: 3, team_name: "ทีม A",
  };

  it("แถวบนใบสั่งงานที่ยกเลิกแล้วถูกทำเครื่องหมายไว้ ไม่ใช่ปะปนกับแถวปกติ", () => {
    const [cancelledRow, liveRow] = parseOutstandingTools([
      { ...base, item_id: "i1", work_order_status: "cancelled" },
      { ...base, item_id: "i2", work_order_status: "installing" },
    ]);
    expect(isCancelledJobHolder(cancelledRow)).toBe(true);
    expect(isCancelledJobHolder(liveRow)).toBe(false);
  });

  it("สรุปหัวตารางนับจำนวนแถวของงานที่ยกเลิกแยกออกมา", () => {
    const rows = parseOutstandingTools([
      { ...base, item_id: "i1", work_order_status: "cancelled" },
      { ...base, item_id: "i2", work_order_status: "cancelled" },
      { ...base, item_id: "i3", work_order_status: "closed" },
    ]);
    const summary = summariseOutstandingTools(rows);
    expect(summary.cancelled).toBe(2);
    expect(summary.lines).toBe(3);
  });

  it("ไม่มีงานยกเลิกเลย -> ตัวนับเป็นศูนย์ ไม่ใช่ undefined", () => {
    expect(summariseOutstandingTools([]).cancelled).toBe(0);
  });

  it("คำอธิบายบอกเหตุผลว่าทำไมยังอยู่ในรายการ ไม่ใช่แค่ป้ายว่า “ยกเลิก”", () => {
    expect(CANCELLED_TOOL_EXPLANATION).toContain("ยังไม่กลับคลัง");
    expect(CANCELLED_TOOL_BADGE).toContain("งานถูกยกเลิก");
  });
});

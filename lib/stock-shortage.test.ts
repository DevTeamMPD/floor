import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS,
  MAX_STOCK_SHORTAGE_LOOKAHEAD_DAYS,
  STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV,
  bangkokDateKey,
  calculateJobStockShortage,
  readStockShortageLookaheadDays,
  stockShortageDedupeKey,
  stockShortageMessage,
  type JobStockCheckRow,
} from "./stock-shortage";

const migrations = path.join(__dirname, "..", "supabase", "migrations");
function migration(file: string) {
  return fs.readFileSync(path.join(migrations, file), "utf8");
}

function line(overrides: Partial<JobStockCheckRow> = {}): JobStockCheckRow {
  return {
    item_id: "item-1",
    prep_source: "work_order_item",
    category: "floor_material",
    item_name: "แผ่นรองกันลื่น",
    line_sku: "LDSSF002",
    unit: "แผ่น",
    planned_qty: 10,
    actual_qty: null,
    picked_qty: null,
    stock_key: "LDSSF002",
    stock_source: "warehouse",
    registry_qty: null,
    warehouse_qty: 63,
    available_qty: 63,
    warehouse_name: "Samaedam_FG",
    snapshot_date: "2026-09-01",
    ...overrides,
  };
}

describe("คำนวณของขาดต่อหนึ่งงาน", () => {
  it("ของพอเมื่อยอดคงเหลือมากกว่าที่ต้องใช้", () => {
    const result = calculateJobStockShortage([line()]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].status).toBe("enough");
    expect(result.groups[0].shortageQty).toBe(0);
    expect(result.hasShortage).toBe(false);
    expect(result.snapshotDate).toBe("2026-09-01");
  });

  it("ของขาดและบอกได้ว่าขาดเท่าไหร่", () => {
    const result = calculateJobStockShortage([line({ planned_qty: 100, available_qty: 63 })]);
    expect(result.groups[0].status).toBe("short");
    expect(result.groups[0].shortageQty).toBe(37);
    expect(result.hasShortage).toBe(true);
    expect(result.counts.short).toBe(1);
  });

  // ถ้าไม่รวมกลุ่มก่อน ของก้อนเดียวจะถูกนับให้ทุกบรรทัดว่า "พอ" ทั้งที่รวมกันแล้วไม่พอ
  it("รวมบรรทัดที่ SKU เดียวกันก่อนเทียบกับของคงเหลือ ไม่นับของก้อนเดียวซ้ำ", () => {
    const result = calculateJobStockShortage([
      line({ item_id: "a", planned_qty: 40 }),
      line({ item_id: "b", planned_qty: 40 }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].itemIds).toEqual(["a", "b"]);
    expect(result.groups[0].requiredQty).toBe(80);
    expect(result.groups[0].availableQty).toBe(63);
    expect(result.groups[0].status).toBe("short");
    expect(result.groups[0].shortageQty).toBe(17);
  });

  it("หักจำนวนที่หยิบไปแล้วออกจากที่ต้องใช้", () => {
    const result = calculateJobStockShortage([line({ planned_qty: 100, picked_qty: 90, available_qty: 63 })]);
    expect(result.groups[0].outstandingQty).toBe(10);
    expect(result.groups[0].status).toBe("enough");
  });

  it("หยิบครบแล้วถือว่าไม่ต้องเบิกเพิ่ม แม้คลังจะไม่มีของเหลือเลย", () => {
    const result = calculateJobStockShortage([line({ planned_qty: 10, picked_qty: 10, available_qty: 0 })]);
    expect(result.groups[0].status).toBe("not_required");
    expect(result.hasShortage).toBe(false);
  });

  it("ใช้จำนวนที่คลังจัดจริง (actual_qty) แทนจำนวนตามแผนเมื่อคลังกรอกแล้ว", () => {
    const result = calculateJobStockShortage([line({ planned_qty: 10, actual_qty: 80, available_qty: 63 })]);
    expect(result.groups[0].requiredQty).toBe(80);
    expect(result.groups[0].status).toBe("short");
    expect(result.groups[0].shortageQty).toBe(17);
  });

  it("ตัวเลขที่มาเป็น string จาก PostgREST ต้องคิดได้เหมือนตัวเลข", () => {
    const result = calculateJobStockShortage([line({ planned_qty: "100.00", available_qty: "63.00" })]);
    expect(result.groups[0].shortageQty).toBe(37);
  });

  it("จำนวนทศนิยมที่พอดีเป๊ะต้องไม่กลายเป็นของขาดเพราะ floating point", () => {
    const result = calculateJobStockShortage([
      line({ item_id: "a", planned_qty: 0.1 }),
      line({ item_id: "b", planned_qty: 0.2 }),
    ].map((row) => ({ ...row, available_qty: 0.3 })));
    expect(result.groups[0].status).toBe("enough");
    expect(result.groups[0].shortageQty).toBe(0);
  });
});

// วันนี้ทะเบียน materials มีแค่ 2 แถว บรรทัดจริงส่วนใหญ่จึงจับคู่สต็อกไม่ได้
// ถ้าโค้ดเผลอตีความว่า "พอ" หรือ "ขาด" หน้าจอจะโกหกคนใช้ทุกวัน
describe("บรรทัดที่จับคู่กับสต็อกไม่ได้", () => {
  it("ไม่มีแหล่งสต็อกเลย ต้องเป็น ตรวจสอบไม่ได้ ไม่ใช่ ของพอ หรือ ของขาด", () => {
    const result = calculateJobStockShortage([
      line({ stock_key: "TEST-SPC05-OAK", stock_source: null, available_qty: null, warehouse_qty: null, registry_qty: null, snapshot_date: null }),
    ]);
    expect(result.groups[0].status).toBe("unknown");
    expect(result.groups[0].shortageQty).toBe(0);
    expect(result.counts.unknown).toBe(1);
    expect(result.counts.enough).toBe(0);
    expect(result.counts.short).toBe(0);
    expect(result.hasShortage).toBe(false);
  });

  it("บรรทัดที่ไม่มี SKU เลย (เช่นโน้ต Freeform) ไม่ถูกยุบรวมเข้าด้วยกัน", () => {
    const result = calculateJobStockShortage([
      line({ item_id: "n1", item_name: "โน้ต Freeform จากหัวหน้าช่าง", line_sku: null, stock_key: null, stock_source: null, available_qty: null, planned_qty: 5 }),
      line({ item_id: "n2", item_name: "รายการมือ", line_sku: null, stock_key: null, stock_source: null, available_qty: null, planned_qty: 5 }),
    ]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((group) => group.status === "unknown")).toBe(true);
  });

  it("ของขาดปนกับของที่ตรวจไม่ได้ ต้องนับแยกกันและบอกไว้ในข้อความแจ้งเตือน", () => {
    const result = calculateJobStockShortage([
      line({ item_id: "a", planned_qty: 100 }),
      line({ item_id: "b", item_name: "ของไม่มีในคลัง", stock_key: "TEST-X", stock_source: null, available_qty: null, planned_qty: 3 }),
    ]);
    expect(result.counts.short).toBe(1);
    expect(result.counts.unknown).toBe(1);
    const message = stockShortageMessage({ jobNo: "ORD-1", customerName: "คุณเอ", daysUntil: 2, installDate: "2026-09-03", result });
    expect(message.title).toContain("ของไม่พอ");
    expect(message.title).toContain("อีก 2 วัน");
    expect(message.body).toContain("ขาด 37");
    expect(message.body).toContain("ยังตรวจสอบไม่ได้");
    expect(message.title.length).toBeLessThanOrEqual(200);
    expect(message.body.length).toBeLessThanOrEqual(1000);
  });
});

// กับดักที่เคยพลาดมาแล้วครั้งหนึ่งในโปรเจกต์นี้: warehouseinventory เก็บ snapshot รายวัน
// ถ้าไม่กรองเอาเฉพาะวันล่าสุด ยอดคงเหลือทุกตัวจะถูกบวกซ้ำเท่าจำนวนวันที่มีในตาราง
describe("ตัวกรอง snapshot ล่าสุดของ warehouseinventory", () => {
  const view = migration("20260902120000_stock_availability_view.sql");

  it("view ต้องกรอง snapshot_date = max(snapshot_date) เสมอ", () => {
    expect(view).toContain("snapshot_date = (select max(snapshot_date) from public.warehouseinventory)");
  });

  it("มีการอ่านข้อมูลจาก warehouseinventory ทางเดียว และทางนั้นต้องมีตัวกรองวันที่", () => {
    const sql = view.replace(/--[^\n]*/g, "");
    const reads = sql.match(/from\s+public\.warehouseinventory/g) ?? [];
    const maxSubqueries = sql.match(/select\s+max\(snapshot_date\)\s+from\s+public\.warehouseinventory/g) ?? [];
    // ที่เหลือหลังหัก subquery หาวันล่าสุดออก คือการอ่านข้อมูลจริง ซึ่งต้องมีทางเดียว
    expect(reads.length - maxSubqueries.length).toBe(1);
    expect(sql).toContain("snapshot_date = (select max(snapshot_date) from public.warehouseinventory)");
  });

  it("ไฟล์อื่นของงานนี้ต้องไม่อ่าน warehouseinventory ตรง ๆ", () => {
    for (const file of [
      "20260902120020_job_stock_check.sql",
      "20260902120030_stock_shortage_warning.sql",
    ]) {
      expect(migration(file)).not.toContain("public.warehouseinventory");
    }
  });
});

describe("คีย์กันแจ้งเตือนซ้ำ", () => {
  const warning = migration("20260902120030_stock_shortage_warning.sql");

  it("รูปแบบคีย์ฝั่ง TypeScript ตรงกับที่ SQL ประกอบเอง", () => {
    expect(stockShortageDedupeKey("ORD-202608-8594", "2026-09-01")).toBe("stock_shortage:ORD-202608-8594:2026-09-01");
    expect(warning).toContain("'stock_shortage:' || v_job_no || ':' || v_as_of::text");
  });

  it("ฐานข้อมูลต้องไม่รับคีย์กันซ้ำจากผู้เรียก และต้องกันซ้ำด้วย on conflict", () => {
    expect(warning).not.toContain("p_dedupe_key");
    expect(migration("20260825020000_shared_visibility_event_notifications.sql")).toContain("on conflict do nothing");
  });

  it("วันเดียวกันตามเวลาไทยได้คีย์เดิม แม้เวลา UTC จะข้ามวันไปแล้ว", () => {
    // 2026-09-01 18:00 UTC = 2026-09-02 01:00 น. เวลาไทย
    expect(bangkokDateKey(new Date("2026-09-01T18:00:00Z"))).toBe("2026-09-02");
    expect(bangkokDateKey(new Date("2026-09-01T16:59:00Z"))).toBe("2026-09-01");
    expect(bangkokDateKey(new Date("2026-09-01T23:59:00Z"))).toBe(bangkokDateKey(new Date("2026-09-01T17:00:00Z")));
  });
});

describe("จำนวนวันเตือนล่วงหน้า ตั้งค่าผ่าน env ไม่ใช่ตัวเลขฝังในโค้ด", () => {
  it("ไม่ได้ตั้งค่า ใช้ค่าตั้งต้น", () => {
    expect(readStockShortageLookaheadDays({})).toBe(DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
    expect(readStockShortageLookaheadDays({ [STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV]: "  " })).toBe(DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
  });

  it("ตั้งค่าได้และค่าเพี้ยนต้องถอยไปค่าตั้งต้น ไม่ใช่ระเบิด", () => {
    expect(readStockShortageLookaheadDays({ [STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV]: "14" })).toBe(14);
    expect(readStockShortageLookaheadDays({ [STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV]: "-1" })).toBe(DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
    expect(readStockShortageLookaheadDays({ [STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV]: "สาม" })).toBe(DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
    expect(readStockShortageLookaheadDays({ [STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV]: "3.5" })).toBe(DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
    expect(readStockShortageLookaheadDays({ [STOCK_SHORTAGE_LOOKAHEAD_DAYS_ENV]: "999" })).toBe(MAX_STOCK_SHORTAGE_LOOKAHEAD_DAYS);
  });

  it("ค่าตั้งต้นและเพดานต้องตรงกับฝั่ง SQL", () => {
    const check = migration("20260902120020_job_stock_check.sql");
    expect(check).toContain(`p_days_ahead integer default ${DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS}`);
    expect(check).toContain(`least(greatest(coalesce(p_days_ahead, ${DEFAULT_STOCK_SHORTAGE_LOOKAHEAD_DAYS}), 0), ${MAX_STOCK_SHORTAGE_LOOKAHEAD_DAYS})`);
  });
});

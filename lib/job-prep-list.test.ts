import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOB_PREP_LIST_RPC,
  fetchJobPrepList,
  isLegacyPrepList,
  toJobPrepDraftItem,
  toJobPrepDraftItems,
  type JobPrepListRow,
} from "@/lib/job-prep-list";

function row(patch: Partial<JobPrepListRow> = {}): JobPrepListRow {
  return {
    source: "work_order_item",
    item_id: "11111111-1111-1111-1111-111111111111",
    work_order_id: "22222222-2222-2222-2222-222222222222",
    category: "floor_material",
    item_name: "แผ่นรองกันลื่น",
    sku: "RS-140",
    specification: "Whitebuzz",
    planned_qty: 10,
    actual_qty: null,
    unit: "แผ่น",
    source_type: "new",
    note: null,
    sort_order: 0,
    material_id: null,
    item_kind: null,
    template_item_id: null,
    is_manual_override: false,
    picked_qty: null,
    returned_qty: null,
    used_qty: null,
    ...patch,
  };
}

type Call = { name: string; args: Record<string, unknown> };

function fakeSupabase(calls: Call[], result: { data: unknown; error: unknown }) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

describe("toJobPrepDraftItem", () => {
  it("แปลงบรรทัดจริงเป็นค่าที่ฟอร์มใช้ได้ และคง id ไว้เพื่อให้คลังบันทึกจำนวนหยิบจริงกลับได้", () => {
    const item = toJobPrepDraftItem(row({ actual_qty: 8, note: "วางที่โถง" }));
    expect(item.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(item.source).toBe("work_order_item");
    expect(item.category).toBe("floor_material");
    expect(item.plannedQty).toBe("10");
    expect(item.actualQty).toBe("8");
    expect(item.note).toBe("วางที่โถง");
    expect(item.isManualOverride).toBe(false);
  });

  it("ค่าที่ยังไม่มีต้องเป็นสตริงว่าง ไม่ใช่ 'null' เพราะผูกกับ <input> โดยตรง", () => {
    const item = toJobPrepDraftItem(row({ sku: null, specification: null, note: null, actual_qty: null, planned_qty: null }));
    expect(item.sku).toBe("");
    expect(item.specification).toBe("");
    expect(item.note).toBe("");
    expect(item.actualQty).toBe("");
    expect(item.plannedQty).toBe("");
  });

  it("รับตัวเลขที่ PostgREST ส่งมาเป็น string ได้ (numeric)", () => {
    const item = toJobPrepDraftItem(row({ planned_qty: "12.50", picked_qty: "3", returned_qty: "1", used_qty: "2" }));
    expect(item.plannedQty).toBe("12.50");
    expect(item.pickedQty).toBe("3");
    expect(item.returnedQty).toBe("1");
    expect(item.usedQty).toBe("2");
  });

  it("แถวยุคเดิมไม่มี id และถูกติดป้ายว่ามาจาก pick_plan", () => {
    const item = toJobPrepDraftItem(row({
      source: "pick_plan_legacy",
      item_id: null,
      category: "remnant",
      item_name: "RS-140",
      sku: null,
      specification: "กว้าง 140 × ยาว 80 ซม.",
      planned_qty: 1,
      source_type: "remnant",
      unit: "แผ่น",
    }));
    expect(item.id).toBeUndefined();
    expect(item.source).toBe("pick_plan_legacy");
    expect(item.category).toBe("remnant");
    expect(item.sourceType).toBe("remnant");
  });

  it("category ที่ไม่รู้จักต้องไม่ทำให้ <select> พัง จึงถอยไปค่าที่ปลอดภัย", () => {
    expect(toJobPrepDraftItem(row({ category: "อะไรก็ไม่รู้" })).category).toBe("floor_material");
    expect(toJobPrepDraftItem(row({ source_type: null })).sourceType).toBe("new");
  });

  it("คอลัมน์ใหม่ของ P3-1 ถูกส่งต่อครบ", () => {
    const item = toJobPrepDraftItem(row({
      material_id: "33333333-3333-3333-3333-333333333333",
      item_kind: "tool",
      template_item_id: "44444444-4444-4444-4444-444444444444",
      is_manual_override: true,
      picked_qty: 5,
      returned_qty: 2,
      used_qty: 3,
    }));
    expect(item.materialId).toBe("33333333-3333-3333-3333-333333333333");
    expect(item.itemKind).toBe("tool");
    expect(item.templateItemId).toBe("44444444-4444-4444-4444-444444444444");
    expect(item.isManualOverride).toBe(true);
    expect([item.pickedQty, item.returnedQty, item.usedQty]).toEqual(["5", "2", "3"]);
  });
});

describe("toJobPrepDraftItems", () => {
  it("ข้อมูลที่ไม่ใช่อาเรย์ต้องได้รายการว่าง ไม่ใช่ throw", () => {
    expect(toJobPrepDraftItems(null)).toEqual([]);
    expect(toJobPrepDraftItems({})).toEqual([]);
    expect(toJobPrepDraftItems("[]")).toEqual([]);
  });

  it("รักษาลำดับที่ฐานข้อมูลส่งมา", () => {
    const items = toJobPrepDraftItems([row({ item_name: "ก" }), row({ item_name: "ข" }), row({ item_name: "ค" })]);
    expect(items.map((item) => item.itemName)).toEqual(["ก", "ข", "ค"]);
  });
});

describe("fetchJobPrepList", () => {
  it("เรียก RPC ทางเดียว ไม่แตะตารางไหนตรง ๆ", async () => {
    const calls: Call[] = [];
    const result = await fetchJobPrepList(fakeSupabase(calls, { data: [row()], error: null }), "ORD-202608-5900");
    expect(calls).toEqual([{ name: JOB_PREP_LIST_RPC, args: { p_job_no: "ORD-202608-5900" } }]);
    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe("work_order_item");
  });

  it("เมื่อ RPC ผิดพลาด ต้องคืน error ให้หน้าจอเตือน ไม่ใช่กลืนแล้วโชว์รายการว่าง", async () => {
    const calls: Call[] = [];
    const error = { message: "permission denied for function get_job_prep_list" };
    const result = await fetchJobPrepList(fakeSupabase(calls, { data: null, error }), "ORD-1");
    expect(result.items).toEqual([]);
    expect(result.error).toBe(error);
  });

  it("งานที่ยังไม่มีของต้องเตรียมเลย ได้รายการว่างและไม่มี error", async () => {
    const result = await fetchJobPrepList(fakeSupabase([], { data: [], error: null }), "ORD-2");
    expect(result.items).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("ผสมแหล่งไม่ได้: RPC เลือกแหล่งเดียวมาแล้ว หน้าจอจึงเห็น source เดียวกันทั้งชุด", async () => {
    const legacy = [row({ source: "pick_plan_legacy", item_id: null }), row({ source: "pick_plan_legacy", item_id: null })];
    const result = await fetchJobPrepList(fakeSupabase([], { data: legacy, error: null }), "ORD-3");
    expect(new Set(result.items.map((item) => item.source))).toEqual(new Set(["pick_plan_legacy"]));
  });
});

describe("isLegacyPrepList", () => {
  it("จริงเมื่อทุกบรรทัดมาจากแผนยุคเดิม", () => {
    expect(isLegacyPrepList(toJobPrepDraftItems([row({ source: "pick_plan_legacy", item_id: null })]))).toBe(true);
  });
  it("เท็จเมื่อมีบรรทัดจริงอยู่ด้วย และเท็จเมื่อไม่มีอะไรเลย", () => {
    expect(isLegacyPrepList(toJobPrepDraftItems([row()]))).toBe(false);
    expect(isLegacyPrepList([])).toBe(false);
  });
});

// แพตเทิร์นกัน drift ระหว่างโค้ดกับ DB โดยไม่ต้องต่อฐานข้อมูลจริง (แบบเดียวกับ lib/job-checklist.test.ts)
describe("โค้ดกับ migration ต้องไม่หลุดจากกัน", () => {
  const columnsSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260902100000_floor_work_order_items_prep_columns.sql"),
    "utf8",
  );
  const readSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260902100100_job_prep_list_unified_read.sql"),
    "utf8",
  );

  it("P3-1 เพิ่มคอลัมน์ครบทั้งเจ็ด และทุกตัวต้อง nullable หรือมี default", () => {
    for (const column of ["material_id uuid", "item_kind text", "template_item_id uuid", "picked_qty numeric", "returned_qty numeric", "used_qty numeric"]) {
      expect(columnsSql).toContain(`add column if not exists ${column}`);
    }
    expect(columnsSql).toContain("add column if not exists is_manual_override boolean not null default false");
  });

  it("item_kind ต้องใช้คำเดียวกับ job_prep_template_items ('consumable','tool')", () => {
    expect(columnsSql).toContain("check (item_kind is null or item_kind in ('consumable', 'tool'))");
    const foundation = readFileSync(join(process.cwd(), "supabase/migrations/20260901100000_job_templates_foundation.sql"), "utf8");
    expect(foundation).toContain("item_kind text not null check (item_kind in ('consumable', 'tool'))");
  });

  it("ห้ามมีจำนวนติดลบ และต้องมี index บน material_id กับ template_item_id", () => {
    expect(columnsSql).toContain("picked_qty is null or picked_qty >= 0");
    expect(columnsSql).toContain("returned_qty is null or returned_qty >= 0");
    expect(columnsSql).toContain("used_qty is null or used_qty >= 0");
    expect(columnsSql).toContain("floor_work_order_items_material_idx");
    expect(columnsSql).toContain("floor_work_order_items_template_item_idx");
  });

  it("P3-7 เป็นฟังก์ชันอ่านอย่างเดียว security definer + search_path ว่าง และ anon เรียกไม่ได้", () => {
    expect(readSql).toContain(`create or replace function public.${JOB_PREP_LIST_RPC}(p_job_no text)`);
    expect(readSql).toContain("security definer");
    expect(readSql).toContain("set search_path = ''");
    expect(readSql).toContain("stable");
    expect(readSql).toContain(`revoke all on function public.${JOB_PREP_LIST_RPC}(text) from public, anon;`);
    expect(readSql).toContain(`grant execute on function public.${JOB_PREP_LIST_RPC}(text) to authenticated;`);
    expect(readSql).not.toMatch(/\b(insert into|update |delete from)\b/i);
  });

  it("ชื่อคอลัมน์ที่ฟังก์ชันคืนมา ต้องตรงกับ JobPrepListRow ทุกตัว", () => {
    const returns = readSql.slice(readSql.indexOf("returns table ("), readSql.indexOf(")\nlanguage plpgsql"));
    for (const key of Object.keys(row())) {
      expect(returns).toContain(`  ${key} `);
    }
  });

  it("ยังต้องไม่มีการรื้อแหล่งเดิมทิ้ง — งานนี้รวมเฉพาะฝั่งอ่าน", () => {
    for (const sql of [columnsSql, readSql]) {
      expect(sql).not.toMatch(/drop table|drop column|rename column/i);
    }
    expect(readSql).toContain("public.install_jobs");
    expect(readSql).toContain("public.floor_work_order_items");
  });
});

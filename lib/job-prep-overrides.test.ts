import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOB_PREP_ADD_ITEM_RPC,
  JOB_PREP_GENERATE_RPC,
  JOB_PREP_OVERRIDES_RPC,
  JOB_PREP_REMOVE_ITEM_RPC,
  JOB_PREP_SAVE_OVERRIDE_RPC,
  PREP_CHANGE_LABELS,
  PREP_NAME_CONFLICT_LABELS,
  addJobPrepItem,
  fetchJobPrepOverrides,
  generateJobPrepItems,
  latestOverrideByItem,
  prepGenerateMessage,
  prepNameConflictMessage,
  removeJobPrepItem,
  removedOverrides,
  saveJobPrepItemOverride,
  toJobPrepOverrides,
  toPrepGenerateResult,
  toPrepNameConflicts,
  type JobPrepOverrideRow,
} from "@/lib/job-prep-overrides";

// ตัว generate_job_prep_items ที่ใช้อยู่จริง (แทนที่ตอนแก้รีวิว C1)
const GENERATE_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260902130000_job_prep_generate_name_adoption.sql"),
  "utf8",
);
const PAGE_TSX = readFileSync(
  join(process.cwd(), "app/(admin)/orders/[jobNo]/page.tsx"),
  "utf8",
);

function row(patch: Partial<JobPrepOverrideRow> = {}): JobPrepOverrideRow {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    work_order_id: "wo-1",
    item_id: "item-1",
    template_item_id: "tpl-1",
    change_kind: "qty_changed",
    template_item_name: "กาว",
    template_unit: "หลอด",
    template_qty: 4,
    human_item_name: "กาว",
    human_unit: "หลอด",
    human_qty: 7,
    calc_basis: { area_sqm: 14 },
    reason: "พื้นปูนขัดมัน กาวกินมากกว่าปกติ",
    changed_by_name: "หัวหน้าช่าง",
    changed_at: "2026-09-02T03:00:00Z",
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

describe("แปลงแถวส่วนต่าง", () => {
  it("อ่านตัวเลขที่ PostgREST ส่งมาเป็น string ได้", () => {
    const [item] = toJobPrepOverrides([row({ template_qty: "4.00", human_qty: "7.00" })]);
    expect(item.templateQty).toBe(4);
    expect(item.humanQty).toBe(7);
    expect(item.changeKind).toBe("qty_changed");
  });

  it("บรรทัดที่ลบไม่มี human_qty ต้องไม่กลายเป็น 0 (0 แปลว่า 'ให้เตรียม 0 ชิ้น' คนละความหมายกับ 'ไม่มีบรรทัดนี้แล้ว')", () => {
    const [item] = toJobPrepOverrides([row({ change_kind: "removed", human_qty: null, item_id: null })]);
    expect(item.humanQty).toBeNull();
    expect(item.templateQty).toBe(4);
  });

  it("ข้อมูลที่ไม่ใช่อาเรย์หรือไม่มี id ต้องไม่ทำให้ระเบิด", () => {
    expect(toJobPrepOverrides(null)).toEqual([]);
    expect(toJobPrepOverrides([null, 7, { id: 5 }])).toEqual([]);
  });

  it("change_kind ที่ไม่รู้จักต้องไม่ทำให้ป้ายบนหน้าจอพัง", () => {
    const [item] = toJobPrepOverrides([row({ change_kind: "อะไรก็ไม่รู้" })]);
    expect(PREP_CHANGE_LABELS[item.changeKind]).toBeTruthy();
  });
});

describe("เลือกส่วนต่างที่จะติดป้าย", () => {
  const overrides = toJobPrepOverrides([
    // RPC เรียงใหม่→เก่า
    row({ id: "o3", item_id: "item-1", template_qty: 6, human_qty: 9, reason: "แก้รอบสอง", changed_at: "2026-09-02T05:00:00Z" }),
    row({ id: "o2", item_id: "item-2", template_qty: 2, human_qty: 5, reason: "อีกบรรทัด" }),
    row({ id: "o1", item_id: "item-1", template_qty: 4, human_qty: 6, reason: "แก้รอบแรก", changed_at: "2026-09-02T01:00:00Z" }),
  ]);

  it("ตัวเลขแม่แบบต้องมาจากการแก้ครั้งแรก ไม่ใช่ค่าที่คนแก้ไว้เองรอบก่อน", () => {
    const latest = latestOverrideByItem(overrides);
    const item1 = latest.get("item-1");
    expect(item1?.templateQty).toBe(4); // แม่แบบจริง
    expect(item1?.humanQty).toBe(9); // ค่าล่าสุดที่คนทำ
    expect(item1?.reason).toBe("แก้รอบสอง");
  });

  it("บรรทัดที่ถูกลบไม่ควรถูกจับคู่กับบรรทัดที่ยังอยู่", () => {
    const withRemoved = toJobPrepOverrides([row({ id: "r1", change_kind: "removed", item_id: null, human_qty: null })]);
    expect(latestOverrideByItem(withRemoved).size).toBe(0);
    expect(removedOverrides(withRemoved)).toHaveLength(1);
  });
});

describe("สรุปผลการสร้างรายการเป็นภาษาไทย", () => {
  it("บอกทั้งที่ทำและที่จงใจไม่แตะ", () => {
    const message = prepGenerateMessage(toPrepGenerateResult({
      area_sqm: 14, unit_count: "5.00", inserted: 3, updated: 1, adopted: 2,
      kept_manual: 2, kept_picked: 1, kept_removed: 1,
    }));
    expect(message).toContain("เพิ่ม 3 รายการ");
    expect(message).toContain("ปรับจำนวนตามแม่แบบ 1 รายการ");
    expect(message).toContain("ผูกบรรทัดเดิมกลับเข้าแม่แบบ 2 รายการ");
    expect(message).toContain("คนแก้ไว้ 2");
    expect(message).toContain("คลังหยิบแล้ว 1");
    expect(message).toContain("คนลบทิ้งแล้ว 1");
    expect(message).toContain("พื้นที่ 14 ตร.ม. · 5 แผ่น");
  });

  it("เรียกซ้ำแล้วไม่มีอะไรเปลี่ยน ต้องบอกตรง ๆ ไม่ใช่เงียบ", () => {
    const message = prepGenerateMessage(toPrepGenerateResult({ inserted: 0, updated: 0, kept_manual: 1 }));
    expect(message).toContain("ไม่มีอะไรต้องเปลี่ยน");
    expect(message).toContain("คนแก้ไว้ 1");
  });
});

describe("คำเตือนเมื่อชื่อรายการชนกัน (C1)", () => {
  it("อ่าน name_conflicts จาก RPC ได้ และ reason ที่ไม่รู้จักต้องไม่ทำให้ป้ายพัง", () => {
    const conflicts = toPrepNameConflicts([
      { item_name: "กาว", reason: "human_line" },
      { item_name: "ใบมีด", reason: "template_duplicate_name" },
      { item_name: "ผ้าคลุม", reason: "อะไรก็ไม่รู้" },
    ]);
    expect(conflicts).toHaveLength(3);
    expect(conflicts[1].reason).toBe("template_duplicate_name");
    for (const row of conflicts) expect(PREP_NAME_CONFLICT_LABELS[row.reason]).toBeTruthy();
    expect(toPrepNameConflicts(null)).toEqual([]);
  });

  it("ไม่มีชื่อชน = ไม่ต้องเตือน", () => {
    expect(prepNameConflictMessage(toPrepGenerateResult({ inserted: 2 }))).toBeNull();
  });

  it("มีชื่อชน ต้องบอกว่า 'สร้างให้แล้ว ไม่ได้ข้าม' และบอกชื่อที่ชน — ไม่ใช่ข้อความกำกวมแบบเดิม", () => {
    const message = prepNameConflictMessage(toPrepGenerateResult({
      inserted: 1, name_conflicts: [{ item_name: "กาว", reason: "human_line" }],
    }));
    expect(message).toContain("กาว");
    expect(message).toContain(PREP_NAME_CONFLICT_LABELS.human_line);
    expect(message).toContain("ไม่ได้ข้าม");
    // ข้อความเดิมที่รีวิวชี้ว่ากำกวม ต้องไม่กลับมาอีก
    expect(message).not.toContain("มีบรรทัดชื่อเดียวกันอยู่แล้ว");
  });

  it("ข้อความสรุปผลหลักต้องไม่กลืนคำเตือน — สองข้อความแยกกัน", () => {
    const result = toPrepGenerateResult({
      inserted: 1, name_conflicts: [{ item_name: "กาว", reason: "human_line" }],
    });
    expect(prepGenerateMessage(result)).not.toContain("กาว");
    expect(prepNameConflictMessage(result)).toContain("กาว");
  });
});

describe("หน้าจอเขียนผ่าน RPC เท่านั้น", () => {
  it("อ่านส่วนต่างด้วย RPC ตัวเดียว ไม่ query ตารางตรง ๆ", async () => {
    const calls: Call[] = [];
    const result = await fetchJobPrepOverrides(fakeSupabase(calls, { data: [row()], error: null }), "ORD-1");
    expect(calls).toEqual([{ name: JOB_PREP_OVERRIDES_RPC, args: { p_job_no: "ORD-1" } }]);
    expect(result.overrides).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it("อ่านไม่สำเร็จต้องส่ง error กลับให้หน้าจอเตือน ไม่ใช่กลืนแล้วแสดงว่าไม่มีส่วนต่าง", async () => {
    const result = await fetchJobPrepOverrides(fakeSupabase([], { data: null, error: { message: "boom" } }), "ORD-1");
    expect(result.overrides).toEqual([]);
    expect(result.error).toEqual({ message: "boom" });
  });

  it("สร้างรายการเรียก RPC เดียว ด้วย work order id", async () => {
    const calls: Call[] = [];
    await generateJobPrepItems(fakeSupabase(calls, { data: { inserted: 2 }, error: null }), "wo-1");
    expect(calls).toEqual([{ name: JOB_PREP_GENERATE_RPC, args: { p_work_order_id: "wo-1" } }]);
  });

  it("แก้ เพิ่ม ลบ ส่งเหตุผลไปกับทุกครั้ง", async () => {
    const calls: Call[] = [];
    const client = fakeSupabase(calls, { data: null, error: null });
    await saveJobPrepItemOverride(client, { itemId: "i1", plannedQty: 7, reason: "กาวกินมาก" });
    await addJobPrepItem(client, { workOrderId: "wo-1", itemName: "ผ้าคลุม", unit: "ผืน", plannedQty: 3, itemKind: "consumable", reason: "ลูกค้าขอ" });
    await removeJobPrepItem(client, { itemId: "i2", reason: "ทีมพกไปเอง" });
    expect(calls.map((call) => call.name)).toEqual([JOB_PREP_SAVE_OVERRIDE_RPC, JOB_PREP_ADD_ITEM_RPC, JOB_PREP_REMOVE_ITEM_RPC]);
    for (const call of calls) expect(String(call.args.p_reason)).not.toBe("");
    expect(calls[0].args).toEqual({ p_item_id: "i1", p_planned_qty: 7, p_item_name: null, p_unit: null, p_reason: "กาวกินมาก" });
  });

  it("หน้าใบสั่งงานไม่มีการ insert/update/delete ตารางรายการเตรียมของตรง ๆ", () => {
    expect(PAGE_TSX).not.toMatch(/from\("floor_work_order_items"\)/);
    expect(PAGE_TSX).not.toMatch(/from\("job_prep_item_overrides"\)/);
  });
});

/**
 * ยามกันสัญญาระหว่าง TypeScript กับ SQL หลุดจากกัน (drift guard) — ไม่ใช่การทดสอบพฤติกรรม
 *
 * ยามชุดนี้ไม่ได้พิสูจน์ว่าฟังก์ชันฝั่งฐานข้อมูลทำงานถูก การพิสูจน์นั้นอยู่ใน
 * $HOME/sdd-jobtpl/p32-probes.sql ซึ่งเรียกฟังก์ชันจริงกับฐานข้อมูลจริงแล้ว rollback
 * สิ่งที่ยามชุดนี้กันได้จริงคือกรณี "แก้ฝั่งเดียว": เปลี่ยนชื่อคีย์ใน jsonb ที่ SQL ส่งกลับ
 * หรือเพิ่ม reason code ใหม่ แล้วลืมแก้ฝั่ง TypeScript — ผลคือหน้าจอเงียบ (อ่านได้ 0 หรือ undefined)
 * โดยที่ probe ฝั่งฐานข้อมูลยังผ่านหมด
 */
describe("ยามกันสัญญา TypeScript ↔ SQL หลุดจากกัน (drift guard ไม่ใช่การทดสอบพฤติกรรม)", () => {
  it("ทุกคีย์ที่ฝั่ง TypeScript อ่าน ต้องมีอยู่ใน jsonb ที่ generate_job_prep_items ส่งกลับ", () => {
    for (const key of ["area_sqm", "unit_count", "inserted", "updated", "adopted", "kept_manual", "kept_picked", "kept_removed", "name_conflicts"]) {
      expect(GENERATE_SQL).toContain(`'${key}',`);
    }
    // คีย์เดิมที่เลิกใช้แล้ว ต้องไม่หลงเหลืออยู่ทั้งสองฝั่ง
    expect(GENERATE_SQL).not.toContain("kept_untracked");
  });

  it("reason code ของชื่อชนใน SQL ต้องมีป้ายภาษาไทยครบทุกตัวฝั่ง TypeScript", () => {
    const block = /v_conflict_reason := case([\s\S]*?)end;/.exec(GENERATE_SQL);
    expect(block).not.toBeNull();
    const codes = Array.from(block![1].matchAll(/(?:then|else) '([a-z_]+)'/g)).map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes)).toEqual(new Set(Object.keys(PREP_NAME_CONFLICT_LABELS)));
  });

  it("หน้าจอยืนยันใบสั่งงานผ่าน v3 และส่ง id ของบรรทัดเดิมไปด้วย", () => {
    // v3 แก้ทับที่เดิมด้วย id ถ้าหน้าจอลืมส่ง id ทุกบรรทัดจะกลายเป็นบรรทัดใหม่
    // แล้ว template_item_id / is_manual_override / picked_qty จะหายทั้งใบเงียบ ๆ
    expect(PAGE_TSX).toContain('supabase.rpc("confirm_floor_work_order_v3"');
    expect(PAGE_TSX).not.toContain('supabase.rpc("confirm_floor_work_order_v2"');
    expect(PAGE_TSX).toMatch(/\.\.\.\(item\.id \? \{ id: item\.id \} : \{\}\)/);
  });

  it("หน้าจอไม่เหลือกล่อง prompt/confirm สำหรับรายการเตรียมของแล้ว", () => {
    expect(PAGE_TSX).not.toContain("เป็นเครื่องมือหรือไม่?");
    expect(PAGE_TSX).not.toContain("ชื่อรายการที่ไม่มีในแม่แบบ\"");
  });
});

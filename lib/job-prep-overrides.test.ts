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
  addJobPrepItem,
  fetchJobPrepOverrides,
  generateJobPrepItems,
  latestOverrideByItem,
  prepGenerateMessage,
  removeJobPrepItem,
  removedOverrides,
  saveJobPrepItemOverride,
  toJobPrepOverrides,
  toPrepGenerateResult,
  type JobPrepOverrideRow,
} from "@/lib/job-prep-overrides";

const GENERATE_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260902110010_job_prep_generate_from_template.sql"),
  "utf8",
);
const TABLE_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260902110000_job_prep_item_overrides.sql"),
  "utf8",
);
const RPC_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260902110020_job_prep_item_override_rpcs.sql"),
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
      area_sqm: 14, unit_count: "5.00", inserted: 3, updated: 1,
      kept_manual: 2, kept_picked: 1, kept_removed: 1, kept_untracked: 0,
    }));
    expect(message).toContain("เพิ่ม 3 รายการ");
    expect(message).toContain("ปรับจำนวนตามแม่แบบ 1 รายการ");
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

describe("หลักประกัน idempotent (คุมที่ migration)", () => {
  it("มี partial unique index กันบรรทัดแม่แบบซ้ำต่อหนึ่งใบสั่งงาน", () => {
    expect(GENERATE_SQL).toMatch(/create unique index if not exists floor_work_order_items_template_once_idx\s+on public\.floor_work_order_items\(work_order_id, template_item_id\)\s+where template_item_id is not null/);
  });

  it("ผูกบรรทัดเดิมด้วย template_item_id ก่อน แล้วค่อยกันซ้ำด้วยชื่อ เผื่อ confirm ลบคอลัมน์แม่แบบทิ้ง", () => {
    expect(GENERATE_SQL).toContain("where work_order_id = v_order.id and template_item_id = v_item.id");
    expect(GENERATE_SQL).toContain("and lower(btrim(item_name)) = lower(btrim(v_item.item_name))");
  });

  it("ไม่มี delete ใด ๆ ใน migration ของการสร้างรายการ — เป็น non-destructive", () => {
    expect(GENERATE_SQL).not.toMatch(/delete\s+from/i);
    expect(GENERATE_SQL).not.toMatch(/drop\s+(table|column)/i);
  });
});

describe("หลักประกันว่าของที่คนแก้จะไม่ถูกทับ (คุมที่ migration)", () => {
  it("บรรทัดที่คนแก้ต้องถูกข้าม", () => {
    expect(GENERATE_SQL).toMatch(/elsif v_line\.is_manual_override then[\s\S]{0,200}v_kept_manual := v_kept_manual \+ 1;/);
  });

  it("บรรทัดที่คลังหยิบไปแล้วต้องถูกข้าม", () => {
    expect(GENERATE_SQL).toMatch(/elsif v_line\.picked_qty is not null then[\s\S]{0,200}v_kept_picked := v_kept_picked \+ 1;/);
  });

  it("บรรทัดที่คนสั่งลบต้องไม่ถูกปลุกกลับมา", () => {
    expect(GENERATE_SQL).toContain("and o.change_kind = 'removed'");
    expect(GENERATE_SQL).toMatch(/v_kept_removed := v_kept_removed \+ 1;\s*continue;/);
  });

  it("update ของ generate ต้องอยู่หลังด่านทั้งสาม ไม่ใช่ก่อน", () => {
    const manual = GENERATE_SQL.indexOf("elsif v_line.is_manual_override then");
    const picked = GENERATE_SQL.indexOf("elsif v_line.picked_qty is not null then");
    const update = GENERATE_SQL.indexOf("update public.floor_work_order_items");
    expect(manual).toBeGreaterThan(0);
    expect(picked).toBeGreaterThan(manual);
    expect(update).toBeGreaterThan(picked);
  });
});

describe("สิทธิ์และรูปแบบของ migration ใหม่", () => {
  const all = [GENERATE_SQL, TABLE_SQL, RPC_SQL].join("\n");

  it("ทุกฟังก์ชันใหม่เป็น security definer + search_path = ''", () => {
    for (const sql of [GENERATE_SQL, RPC_SQL]) {
      const defs = sql.match(/create or replace function/g) ?? [];
      expect(defs.length).toBeGreaterThan(0);
      expect((sql.match(/security definer/g) ?? []).length).toBe(defs.length);
      expect((sql.match(/set search_path = ''/g) ?? []).length).toBe(defs.length);
    }
  });

  it("anon ต้องเรียกอะไรไม่ได้และอ่านตารางใหม่ไม่ได้", () => {
    expect(GENERATE_SQL).toContain("revoke all on function public.generate_job_prep_items(uuid) from public, anon;");
    expect(RPC_SQL).toContain("revoke all on function public.save_job_prep_item_override(uuid, numeric, text, text, text) from public, anon;");
    expect(TABLE_SQL).toContain("revoke all on public.job_prep_item_overrides from anon, authenticated;");
    expect(TABLE_SQL).toContain("grant select on public.job_prep_item_overrides to authenticated;");
    expect(all).not.toMatch(/grant[^;]*to[^;]*\banon\b/);
  });

  it("ทางเขียนทุกตัวเช็ค role เดียวกับที่แก้แม่แบบได้ (admin / head_technician)", () => {
    expect((GENERATE_SQL.match(/role in \('admin', 'head_technician'\)/g) ?? []).length).toBe(1);
    expect((RPC_SQL.match(/role in \('admin', 'head_technician'\)/g) ?? []).length).toBe(1);
    expect(RPC_SQL).toContain("v_actor := public.job_prep_edit_guard(");
  });

  it("แก้ได้เฉพาะก่อนส่งคลัง และห้ามแตะบรรทัดที่คลังหยิบไปแล้ว", () => {
    expect(GENERATE_SQL).toContain("if v_order.status not in ('head_review', 'returned_sales') then");
    expect(RPC_SQL).toContain("if v_status not in ('head_review', 'returned_sales') then");
    expect((RPC_SQL.match(/v_line\.picked_qty is not null/g) ?? []).length).toBe(2);
  });

  it("บังคับกรอกเหตุผลทั้งระดับตารางและระดับ RPC", () => {
    expect(TABLE_SQL).toContain("reason text not null check (btrim(reason) <> '')");
    expect((RPC_SQL.match(/if v_reason = '' then/g) ?? []).length).toBe(3);
  });

  it("ตารางส่วนต่างเก็บครบทั้งห้าคำถาม: แม่แบบว่าเท่าไร คนแก้เป็นเท่าไร ใคร เมื่อไร ทำไม", () => {
    for (const column of ["template_qty", "human_qty", "changed_by", "changed_at", "reason", "calc_basis"]) {
      expect(TABLE_SQL).toContain(column);
    }
    expect(TABLE_SQL).toContain("change_kind in ('qty_changed', 'added', 'removed')");
  });

  it("ไม่มี drop / rename ในทั้งสาม migration — additive อย่างเดียว", () => {
    expect(all).not.toMatch(/drop\s+table/i);
    expect(all).not.toMatch(/drop\s+column/i);
    expect(all).not.toMatch(/rename\s+(to|column)/i);
    expect(all).not.toMatch(/alter\s+table[^;]*alter\s+column/i);
  });
});

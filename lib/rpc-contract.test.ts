import { describe, expect, test } from "vitest";
import { extractRpcCalls, findMissingRpcs } from "./rpc-contract";

describe("extractRpcCalls", () => {
  test("พบชื่อ RPC พร้อมเลขบรรทัดจากโค้ดที่เรียก supabase.rpc", () => {
    const source = [
      'const a = 1;',
      'const { error } = await supabase.rpc("confirm_floor_work_order_v3", { p_id: id });',
    ].join("\n");

    expect(extractRpcCalls(source, "app/x/page.tsx")).toEqual([
      { name: "confirm_floor_work_order_v3", file: "app/x/page.tsx", line: 2 },
    ]);
  });
});

describe("findMissingRpcs", () => {
  test("รายงาน RPC ที่โค้ดเรียกแต่ไม่มีในฐานข้อมูล", () => {
    const calls = [
      { name: "confirm_floor_work_order_v3", file: "a.tsx", line: 10 },
      { name: "set_floor_work_order_no_material_required", file: "a.tsx", line: 12 },
    ];

    expect(findMissingRpcs(calls, new Set(["confirm_floor_work_order_v3"]))).toEqual([
      { name: "set_floor_work_order_no_material_required", file: "a.tsx", line: 12 },
    ]);
  });

  test("ไม่รายงานซ้ำเมื่อไฟล์เดียวเรียก RPC ที่หายตัวเดิมหลายบรรทัด", () => {
    const calls = [
      { name: "ghost_rpc", file: "a.tsx", line: 3 },
      { name: "ghost_rpc", file: "a.tsx", line: 9 },
    ];

    expect(findMissingRpcs(calls, new Set())).toHaveLength(2);
  });
});

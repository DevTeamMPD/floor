import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_NAV, CORE_NAV, EXPERIMENTAL_NAV, UNLISTED_NAV, DEFAULT_PAGE_ROLES } from "@/lib/nav";
import { canRoleAccessPath, matchNavItem, normalizePath, rolesForPath } from "@/lib/page-access";
import { STAFF_ROLES } from "@/lib/staff";

/** รายชื่อหน้า admin จริงจากดิสก์ — กัน drift ระหว่างไฟล์ที่มีอยู่กับสิทธิ์ที่ประกาศไว้ */
function adminPagePaths(): string[] {
  const root = path.join(process.cwd(), "app", "(admin)");
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      else if (entry.name === "page.tsx") out.push(prefix === "" ? "/" : prefix);
    }
  };
  walk(root, "");
  return out.sort();
}

describe("page access — แหล่งความจริงเดียว", () => {
  it("ทุกหน้า admin ที่มีไฟล์จริง ต้องมีสิทธิ์ประกาศไว้ใน lib/nav.ts", () => {
    const undeclared = adminPagePaths().filter((page) => {
      // หน้าที่มีพารามิเตอร์ ([jobNo]) ใช้สิทธิ์ของหน้าแม่ผ่านการจับคู่ prefix
      const concrete = page.replace(/\/\[[^\]]+\]/g, "/sample");
      return matchNavItem(concrete) === null;
    });
    expect(undeclared).toEqual([]);
  });

  it("จับคู่หน้าลูกกับหน้าแม่ และเลือกอันที่ตรงยาวที่สุด", () => {
    expect(matchNavItem("/orders/JOB-1")?.href).toBe("/orders");
    expect(matchNavItem("/orders")?.href).toBe("/orders");
    expect(normalizePath("/orders/")).toBe("/orders");
    expect(normalizePath("/orders?x=1")).toBe("/orders");
  });

  it("หน้าที่ไม่ได้ประกาศ ตกไปที่ admin เท่านั้น (พลาดไปทางปลอดภัย)", () => {
    expect(rolesForPath("/some-page-nobody-declared")).toEqual(DEFAULT_PAGE_ROLES);
    expect(canRoleAccessPath("staff", "/some-page-nobody-declared")).toBe(false);
    expect(canRoleAccessPath("admin", "/some-page-nobody-declared")).toBe(true);
  });

  it("ไม่มีสิทธิ์ = ปฏิเสธ, ไม่มี role = ปฏิเสธ", () => {
    expect(canRoleAccessPath(null, "/home")).toBe(false);
    expect(canRoleAccessPath(undefined, "/home")).toBe(false);
    expect(canRoleAccessPath("executive", "/warehouse")).toBe(false);
  });

  it("admin เข้าได้ทุกหน้าที่ประกาศไว้ — ไม่มีทางล็อกผู้ดูแลออกจากระบบตัวเอง", () => {
    for (const item of ALL_NAV) expect(canRoleAccessPath("admin", item.href)).toBe(true);
  });

  it("หน้าปฏิเสธสิทธิ์เปิดได้ทุกตำแหน่ง ไม่งั้น middleware จะ rewrite วนไม่จบ", () => {
    for (const role of STAFF_ROLES) expect(canRoleAccessPath(role, "/access-denied")).toBe(true);
  });

  it("ทุกตำแหน่งต้องเข้าหน้าแรกได้ เพราะ ROLE_HOME ส่งทุกคนมาที่นี่", () => {
    for (const role of STAFF_ROLES) expect(canRoleAccessPath(role, "/home")).toBe(true);
  });

  it("roles ที่ประกาศต้องเป็นค่าที่มีจริงใน STAFF_ROLES และห้ามซ้ำ", () => {
    for (const item of ALL_NAV) {
      expect(item.roles.length).toBeGreaterThan(0);
      expect(new Set(item.roles).size).toBe(item.roles.length);
      for (const role of item.roles) expect(STAFF_ROLES).toContain(role);
    }
  });

  it("href ห้ามซ้ำกันข้ามรายการเมนู", () => {
    const hrefs = ALL_NAV.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  /**
   * กันการถอยหลัง: งานคลังของจริงทำโดยคน role = 'staff' ไม่ใช่ 'warehouse'
   * (floor_work_orders.confirmed_by / returned_by ทุกแถวเป็น staff กับ admin)
   * ถ้าใครมาแก้ให้แคบลงตามชื่อตำแหน่ง คนที่ทำงานอยู่จริงจะเข้าไม่ได้ทันที
   */
  it("หน้าปฏิบัติงานต้องเปิดให้ role staff เสมอ", () => {
    for (const href of ["/warehouse", "/orders", "/operations", "/remnants", "/inventory", "/providers", "/purchase-orders"]) {
      expect(canRoleAccessPath("staff", href)).toBe(true);
    }
  });

  it("หน้าตั้งค่าระบบและข้อมูลเชิงพาณิชย์ยังต้องแคบอยู่", () => {
    expect(canRoleAccessPath("staff", "/staff")).toBe(false);
    expect(canRoleAccessPath("staff", "/evaluation-config")).toBe(false);
    expect(canRoleAccessPath("staff", "/exec")).toBe(false);
    expect(canRoleAccessPath("staff", "/waste-cost")).toBe(false);
    expect(canRoleAccessPath("warehouse", "/staff")).toBe(false);
  });

  it("เมนูหลัก/เมนูเสริม/หน้าที่ไม่อยู่ในเมนู รวมกันเป็น ALL_NAV", () => {
    expect(ALL_NAV.length).toBe(CORE_NAV.length + EXPERIMENTAL_NAV.length + UNLISTED_NAV.length);
    for (const item of UNLISTED_NAV) expect(item.hidden).toBe(true);
  });
});

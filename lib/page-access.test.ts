import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_NAV, CORE_NAV, EXPERIMENTAL_NAV, UNLISTED_NAV, DEFAULT_PAGE_ROLES, PAGE_ACTION_HREF, PAGE_ACTION_ROLES, canRoleDoAction, type PageAction } from "@/lib/nav";
import { PUBLIC_PREFIXES, canRoleAccessPath, isPublicPath, matchNavItem, normalizePath, rolesForPath } from "@/lib/page-access";
import { STAFF_ROLES } from "@/lib/staff";

/**
 * เส้นทางทั้งหมดที่มีไฟล์อยู่จริงในโฟลเดอร์ app/ — ไม่ใช่แค่ app/(admin)
 *
 * ทำไมต้องกวาดทั้ง app/: เทสรุ่นก่อนกวาดแค่ app/(admin) จึงมองไม่เห็นสองหน้าที่สำคัญที่สุด
 * คือ "/" (app/page.tsx — เป็น start_url ของ PWA ทุกคนเปิดแอปมาเจอหน้านี้ก่อน) กับ
 * /share/queue (app/share/queue/page.tsx) ทั้งสองหน้าถูกล็อกเหลือ admin โดยไม่มีใครตั้งใจ
 * และเทสก็ยังเขียวอยู่ตลอด — เทสที่มองไม่เห็นที่ที่ผิดพลาดจริง ไม่ได้กันอะไรเลย
 *
 * กติกาการแปลงชื่อโฟลเดอร์เป็น URL (ตาม App Router):
 *   (ชื่อ)   route group  ไม่ปรากฏใน URL — app/(admin)/home/page.tsx = /home
 *   [ชื่อ]   dynamic segment  แทนด้วยค่าตัวอย่างเพื่อทดสอบการจับคู่กับหน้าแม่
 *   @ชื่อ / _ชื่อ  parallel route กับโฟลเดอร์ส่วนตัว ไม่เป็นเส้นทางจริง
 */
function appRoutePaths(): { route: string; file: string }[] {
  const root = path.join(process.cwd(), "app");
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(full, isGroup ? prefix : `${prefix}/${entry.name}`);
      } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
        out.push({ route: prefix === "" ? "/" : prefix, file: path.relative(process.cwd(), full) });
      }
    }
  };
  walk(root, "");
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** แทน [param] ด้วยค่าตัวอย่าง เพื่อให้จับคู่กับหน้าแม่ผ่าน prefix ได้เหมือนของจริง */
function concreteRoute(route: string): string {
  return route.replace(/\/\[[^\]]+\]/g, "/sample");
}

/** เส้นทางที่ "ด่านสิทธิ์ระดับหน้า" เอื้อมถึงจริง = ทุกเส้นทางในแอป ลบเส้นทางสาธารณะออก */
function guardedRoutePaths(): { route: string; file: string }[] {
  return appRoutePaths().filter((entry) => !isPublicPath(concreteRoute(entry.route)));
}

describe("page access — แหล่งความจริงเดียว", () => {
  it("ทุกเส้นทางในแอปที่ด่านเอื้อมถึง ต้องมีสิทธิ์ประกาศไว้ใน lib/nav.ts", () => {
    const undeclared = guardedRoutePaths()
      .filter((entry) => matchNavItem(concreteRoute(entry.route)) === null)
      .map((entry) => `${entry.route}  (${entry.file})`);
    expect(undeclared).toEqual([]);
  });

  /**
   * ด่านนี้เอื้อมถึงมากกว่าหน้าใน app/(admin) — เทสจึงต้องพิสูจน์ว่ามันเห็นหน้านอกกลุ่มด้วย
   * ถ้าใครย้าย/ลบสองหน้านี้ เทสจะแดงทันทีแทนที่จะเงียบเหมือนรุ่นก่อน
   */
  it("รายการที่กวาดได้ต้องรวมหน้านอก app/(admin) ด้วย ไม่ใช่แค่ในกลุ่ม admin", () => {
    const routes = guardedRoutePaths().map((entry) => entry.route);
    expect(routes).toContain("/");
    expect(routes).toContain("/share/queue");
    expect(routes).toContain("/home");
    // และต้องไม่ลากเส้นทางสาธารณะเข้ามาให้ต้องประกาศสิทธิ์โดยไม่จำเป็น
    expect(routes).not.toContain("/login");
    expect(routes).not.toContain("/eval");
    expect(routes.some((route) => route.startsWith("/api/"))).toBe(false);
    expect(routes.some((route) => route.startsWith("/work/"))).toBe(false);
  });

  /**
   * *** ข้อที่ล็อกคนทั้งบริษัทออกจากแอปได้จริง ***
   * app/manifest.ts ตั้ง start_url: "/" ทุกคนที่กดไอคอนแอปบนมือถือจะมาที่นี่ก่อนเสมอ
   * ถ้า "/" ไม่ได้ประกาศไว้ 6 ใน 7 ตำแหน่งจะเจอ "ไม่มีสิทธิ์เข้าหน้านี้" ตั้งแต่วินาทีแรก
   */
  it("*** ทุกตำแหน่งต้องเปิด / ได้ เพราะเป็น start_url ของแอปที่ติดตั้งบนมือถือ ***", () => {
    for (const role of STAFF_ROLES) expect(canRoleAccessPath(role, "/")).toBe(true);
    const manifest = fs.readFileSync(path.join(process.cwd(), "app", "manifest.ts"), "utf8");
    // ถ้าใครเปลี่ยน start_url ไปหน้าอื่น เทสข้อนี้ต้องถูกอ่านใหม่ ไม่ใช่ผ่านไปเงียบ ๆ
    expect(manifest).toContain('start_url: "/"');
  });

  /**
   * /share/queue เคยเปิดให้พนักงานที่ยัง active ทุกคน (middleware เดิมกันเฉพาะ /staff)
   * การที่มันหล่นไป admin-only ตอนเพิ่มด่าน P5-6 เป็นผลข้างเคียงของการลืมประกาศ
   * ไม่ใช่การตัดสินใจของใคร — เทสข้อนี้กันไม่ให้มันหล่นอีก
   */
  it("*** จอแชร์คิวหน้างานต้องเปิดให้ทุกตำแหน่งเหมือนก่อนมีด่าน ***", () => {
    for (const role of STAFF_ROLES) expect(canRoleAccessPath(role, "/share/queue")).toBe(true);
  });

  it("รายการเส้นทางสาธารณะต้องตรงกับที่ middleware ใช้จริง", () => {
    const middleware = fs.readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
    // middleware ต้องอ่านรายการเดียวกันนี้ ไม่ใช่ถือรายการของตัวเองไว้อีกชุด
    expect(middleware).toContain("isPublicPath");
    expect(middleware).not.toContain("const PUBLIC_PREFIXES");
    for (const prefix of ["/login", "/auth", "/api"]) expect(PUBLIC_PREFIXES).toContain(prefix);
    expect(isPublicPath("/api/documents/process")).toBe(true);
    expect(isPublicPath("/work/abc123")).toBe(true);
    expect(isPublicPath("/workshop")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });

  /** ไฟล์ใน public/ ไม่ใช่ "หน้า" — ถ้ามันผ่านด่าน โลโก้บนทุกหน้าจะกลายเป็นรูปเสีย */
  it("ไฟล์ที่มีนามสกุลต้องถูกตัดออกจาก matcher ของ middleware", () => {
    const middleware = fs.readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
    // ไม่ประกอบ regex ใหม่จากไฟล์ (เปราะเกินไป) แต่ยืนยันว่ากติกาการตัดยังอยู่จริง
    expect(middleware).toContain("matcher:");
    expect(middleware).toContain("[a-zA-Z0-9]+$");
    // และไฟล์ทุกไฟล์ใน public/ ต้องมีนามสกุล ไม่งั้นกติกานี้ครอบไม่ถึงมัน
    for (const asset of fs.readdirSync(path.join(process.cwd(), "public"))) {
      expect(asset).toMatch(/\.[a-zA-Z0-9]+$/);
    }
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

  /** executive เคยยื่นใบเคลมซัพพลายเออร์จริง จึงต้องเข้าทะเบียนผู้ให้บริการได้ */
  it("executive เข้าทะเบียนผู้ให้บริการได้", () => {
    expect(canRoleAccessPath("executive", "/providers")).toBe(true);
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

  /**
   * *** เมนูสัญญาอะไรไว้ ปุ่มต้องทำได้อย่างนั้น ***
   * roles ของหน้า = "ใครเปิดหน้านี้ได้" ซึ่งกว้างกว่า "ใครกดปุ่มนี้ได้" เสมอ
   * เมื่อสองอย่างไม่ตรงกัน คนจะเห็นปุ่มที่กดแล้วเด้ง error ทุกครั้ง — คน role staff 37 คน
   * เจอแบบนั้นที่ /providers /capa และ /ncr มาตลอด
   */
  it("สิทธิ์ลงมือทำต้องไม่กว้างกว่าสิทธิ์เปิดหน้า", () => {
    for (const action of Object.keys(PAGE_ACTION_ROLES) as PageAction[]) {
      const pageRoles = rolesForPath(PAGE_ACTION_HREF[action]);
      for (const role of PAGE_ACTION_ROLES[action]) {
        expect(pageRoles, `${action} บนหน้า ${PAGE_ACTION_HREF[action]}`).toContain(role);
      }
    }
  });

  it("ตำแหน่งที่กดปุ่มได้ ต้องตรงกับ array ที่ RPC ใช้จริงในไฟล์ migration", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", file), "utf8");
    const providerRegister = read("20260902220000_provider_register.sql");
    const providerSuspension = read("20260902220040_provider_suspension.sql");
    const claimLink = read("20260902220030_supplier_claims_register_link.sql");
    const capa = read("20260902230010_capa_register_10_2.sql");
    const ncr = read("20260902200010_create_floor_ncr_cause_code.sql");

    const sqlArray = (roles: readonly string[]) => `array[${roles.map((r) => `'${r}'`).join(",")}]`;

    expect(providerRegister).toContain(`${sqlArray(PAGE_ACTION_ROLES["providers.upsert"])}, 'จัดการทะเบียนผู้ให้บริการ'`);
    expect(providerRegister).toContain(`${sqlArray(PAGE_ACTION_ROLES["providers.decide"])}, 'อนุมัติผู้ให้บริการ'`);
    expect(providerSuspension).toContain(`${sqlArray(PAGE_ACTION_ROLES["providers.suspend"])}, 'ระงับผู้ให้บริการ'`);
    expect(providerRegister).toContain(`${sqlArray(PAGE_ACTION_ROLES["providers.link"])}, 'ผูกทีมช่างกับบริษัทผู้รับเหมา'`);
    expect(claimLink).toContain(`${sqlArray(PAGE_ACTION_ROLES["providers.claims"])}, 'ผูกใบเคลมกับผู้ให้บริการ'`);

    // capa_guard ประกาศ role ไว้เป็นตัวแปร และ capa_snapshot ส่ง canEdit ด้วยชุดเดียวกัน
    const capaRoles = PAGE_ACTION_ROLES["capa.write"].map((r) => `'${r}'`).join(", ");
    expect(capa).toContain(`v_roles text[] := array[${capaRoles}]`);
    expect(capa).toContain(`p.role = any(array[${PAGE_ACTION_ROLES["capa.write"].map((r) => `'${r}'`).join(",")}])`);
    expect(ncr).toContain(`role in (${PAGE_ACTION_ROLES["ncr.create"].map((r) => `'${r}'`).join(", ")})`);
  });

  it("role staff เปิดสามหน้านี้อ่านได้ แต่กดปุ่มที่ RPC ปฏิเสธไม่ได้", () => {
    for (const href of ["/providers", "/capa", "/ncr"]) {
      expect(canRoleAccessPath("staff", href)).toBe(true);
    }
    expect(canRoleDoAction("staff", "providers.upsert")).toBe(false);
    expect(canRoleDoAction("staff", "capa.write")).toBe(false);
    expect(canRoleDoAction("staff", "ncr.create")).toBe(false);
    // executive เข้าทะเบียนผู้ให้บริการเพื่ออ่านได้ แต่ไม่มีปุ่มไหนกดได้เลย
    expect(canRoleAccessPath("executive", "/providers")).toBe(true);
    for (const action of Object.keys(PAGE_ACTION_ROLES) as PageAction[]) {
      if (PAGE_ACTION_HREF[action] === "/providers") {
        expect(canRoleDoAction("executive", action)).toBe(false);
      }
    }
    // และตำแหน่งที่ RPC ยอมรับจริง ต้องกดได้
    expect(canRoleDoAction("warehouse", "providers.upsert")).toBe(true);
    expect(canRoleDoAction("admin", "providers.suspend")).toBe(true);
    expect(canRoleDoAction("cs", "ncr.create")).toBe(true);
    expect(canRoleDoAction(null, "capa.write")).toBe(false);
  });

  it("หน้าจอต้องอ่านสิทธิ์ลงมือทำจากที่เดียวกัน ไม่ใช่เดาเอง", () => {
    const providers = fs.readFileSync(path.join(process.cwd(), "app", "(admin)", "providers", "page.tsx"), "utf8");
    const ncrPage = fs.readFileSync(path.join(process.cwd(), "app", "(admin)", "ncr", "page.tsx"), "utf8");
    for (const source of [providers, ncrPage]) expect(source).toContain("useCanDo(");
    expect(providers).toContain('useCanDo("providers.upsert")');
    expect(ncrPage).toContain('useCanDo("ncr.create")');
  });
});

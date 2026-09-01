import { ALL_NAV, DEFAULT_PAGE_ROLES, type NavItem } from "@/lib/nav";
import type { StaffRole } from "@/lib/staff";

/**
 * ด่านสิทธิ์ระดับหน้า — ตรรกะกลางที่ middleware, layout และ sidebar ใช้ร่วมกัน
 *
 * ย้ำว่านี่คือ "ชั้นป้องกันซ้อน" ไม่ใช่ด่านจริง
 * ด่านจริงคือการเช็ค role ใน RPC (security definer) และ RLS ของแต่ละตาราง
 * หน้าที่ของไฟล์นี้คือไม่ให้คนที่ไม่เกี่ยวข้องเปิดหน้าที่ไม่ใช่ของตัวเองขึ้นมาได้
 * โดยเฉพาะหน้าที่ยังอ่าน/เขียนตารางตรง ๆ ซึ่งด่าน RPC ไม่มีอยู่
 */

/** จับคู่ path กับรายการเมนู โดยเลือกอันที่ตรงยาวที่สุด (เช่น /orders/ABC → /orders) */
export function matchNavItem(pathname: string): NavItem | null {
  const path = normalizePath(pathname);
  let best: NavItem | null = null;
  for (const item of ALL_NAV) {
    if (path === item.href || path.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}

export function normalizePath(pathname: string): string {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  if (clean.length > 1 && clean.endsWith("/")) return clean.slice(0, -1);
  return clean;
}

/** ตำแหน่งที่เข้าหน้านี้ได้ — หน้าที่ไม่ได้ประกาศไว้จะได้ DEFAULT_PAGE_ROLES (admin) */
export function rolesForPath(pathname: string): StaffRole[] {
  return matchNavItem(pathname)?.roles ?? DEFAULT_PAGE_ROLES;
}

export function canRoleAccessPath(role: StaffRole | null | undefined, pathname: string): boolean {
  if (!role) return false;
  return rolesForPath(pathname).includes(role);
}

/**
 * เส้นทางที่ไม่ต้องมีเซสชันพนักงาน — ประกาศไว้ที่นี่ ไม่ใช่ใน middleware.ts
 *
 * ย้ายมาที่นี่เพราะเทสกันการถอยหลัง (lib/page-access.test.ts) ต้องรู้ให้ครบว่า
 * "ด่านกันหน้าเอื้อมถึงเส้นทางไหนบ้าง" ถ้ารายการนี้ยังซ่อนอยู่ใน middleware
 * เทสจะเห็นแค่ครึ่งเดียวของความจริง แล้วหน้าที่ถูกล็อกโดยไม่ตั้งใจก็จะรอดเทสไปได้
 * (เกิดขึ้นมาแล้วกับ "/" และ /share/queue ใน P5-6)
 *
 *   /login /auth   ทางเข้าระบบเอง — ถ้ากันไว้ก็เข้าสู่ระบบไม่ได้เลย
 *   /work /dispatch /track /status /eval  ลิงก์โทเคนสำหรับช่างหน้างานและลูกค้า
 *                  คนกลุ่มนี้ไม่มีบัญชีพนักงาน สิทธิ์ถูกกำกับด้วยโทเคนในลิงก์แทน
 *   /api           ทุกเส้นทางตรวจสิทธิ์ของตัวเองภายใน (service key / โทเคน / RLS)
 *   manifest + service worker  เบราว์เซอร์ขอไฟล์สองอันนี้ก่อนมีเซสชันเสมอ
 */
export const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/work",
  "/dispatch",
  "/track",
  "/status",
  "/eval",
  "/api",
  "/manifest.webmanifest",
  "/floor-sw.js",
] as const;

/** true = เส้นทางนี้ไม่ต้องมีเซสชันพนักงาน ด่านสิทธิ์ระดับหน้าจึงไม่เอื้อมถึง */
export function isPublicPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

/**
 * middleware ใส่ path ปัจจุบันไว้ใน header นี้ เพื่อให้ server component อ่านได้
 * (layout/page ฝั่งเซิร์ฟเวอร์ไม่มีทางรู้ pathname ได้เอง)
 */
export const PATHNAME_HEADER = "x-floor-pathname";

/** ข้อความไทยที่ผู้ใช้จะเห็นเมื่อถูกปฏิเสธ — ข้อความเดียวกันทุกทางเข้า */
export const ACCESS_DENIED_TITLE = "คุณไม่มีสิทธิ์เข้าหน้านี้";

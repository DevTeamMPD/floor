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
 * middleware ใส่ path ปัจจุบันไว้ใน header นี้ เพื่อให้ server component อ่านได้
 * (layout/page ฝั่งเซิร์ฟเวอร์ไม่มีทางรู้ pathname ได้เอง)
 */
export const PATHNAME_HEADER = "x-floor-pathname";

/** ข้อความไทยที่ผู้ใช้จะเห็นเมื่อถูกปฏิเสธ — ข้อความเดียวกันทุกทางเข้า */
export const ACCESS_DENIED_TITLE = "คุณไม่มีสิทธิ์เข้าหน้านี้";

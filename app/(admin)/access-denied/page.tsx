import { headers } from "next/headers";
import AccessDenied from "@/components/layout/access-denied";
import { getCurrentStaff } from "@/lib/staff-server";
import { PATHNAME_HEADER, rolesForPath } from "@/lib/page-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "ไม่มีสิทธิ์เข้าหน้านี้ — FloorNow" };

/**
 * middleware จะ rewrite มาที่หน้านี้เมื่อผู้ใช้เปิดหน้าที่ตำแหน่งของตัวเองไม่มีสิทธิ์
 * โค้ดของหน้าเดิมจะไม่ถูกรันเลย — ที่นี่แค่บอกว่าเข้าไม่ได้เพราะอะไร
 */
export default async function AccessDeniedPage() {
  const requested = (await headers()).get(PATHNAME_HEADER) ?? "/";
  const staff = await getCurrentStaff();
  const role = staff?.role ?? "staff";
  return <AccessDenied pathname={requested} role={role} allowedRoles={rolesForPath(requested)} />;
}

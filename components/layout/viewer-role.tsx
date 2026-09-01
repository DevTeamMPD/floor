"use client";

import { createContext, useContext } from "react";
import type { StaffRole } from "@/lib/staff";
import { canRoleDoAction, type PageAction } from "@/lib/nav";

/**
 * ตำแหน่งของคนที่กำลังดูหน้าอยู่ ส่งจาก layout ฝั่งเซิร์ฟเวอร์ลงมาให้หน้า client
 *
 * ทำไมต้องมี: หน้าอย่าง /providers /capa /ncr เป็น client component ที่ไม่รู้จัก role ของผู้ดูเลย
 * จึงวาดปุ่มทุกปุ่มให้ทุกคน ทั้งที่ RPC ปลายทางรับแค่บางตำแหน่ง คนกดแล้วเด้ง error ทุกครั้ง
 * ด่านจริงยังเป็น role check ใน RPC เหมือนเดิม — ตัวนี้แค่ไม่ยื่นปุ่มที่กดไม่ได้ให้คนกด
 */
const ViewerRoleContext = createContext<StaffRole | null>(null);

export function ViewerRoleProvider({ role, children }: { role: StaffRole; children: React.ReactNode }) {
  return <ViewerRoleContext.Provider value={role}>{children}</ViewerRoleContext.Provider>;
}

export function useViewerRole(): StaffRole | null {
  return useContext(ViewerRoleContext);
}

/** true = ผู้ดูคนนี้กดปุ่มของการกระทำนี้ได้จริง */
export function useCanDo(action: PageAction): boolean {
  return canRoleDoAction(useContext(ViewerRoleContext), action);
}

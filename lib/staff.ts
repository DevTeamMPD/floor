export const STAFF_ROLES = ["admin", "staff", "sales", "head_technician", "cs", "executive", "warehouse"] as const;
export type StaffRole = typeof STAFF_ROLES[number];

export interface StaffProfile {
  id: string;
  email: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  master_employee_id?: string | null;
  role_source?: "manual" | "master";
  master_synced_at?: string | null;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "ผู้ดูแลระบบ",
  staff: "พนักงาน",
  sales: "ฝ่ายขาย",
  head_technician: "หัวหน้าช่าง",
  cs: "CS ติดตามลูกค้า",
  executive: "ผู้บริหาร",
  warehouse: "คลัง / จัดซื้อ",
};

export const ROLE_HOME: Record<StaffRole, string> = {
  admin: "/home",
  staff: "/home",
  // ฝ่ายขายเริ่มต้นที่ตารางคิว เพื่อเห็นงานที่ต้องจัดการทันทีบนมือถือ
  sales: "/sales-queue",
  head_technician: "/home",
  cs: "/home",
  executive: "/home",
  warehouse: "/home",
};

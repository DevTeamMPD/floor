export const STAFF_ROLES = ["admin", "sales", "head_technician", "cs", "executive", "warehouse"] as const;
export type StaffRole = typeof STAFF_ROLES[number];

export interface StaffProfile {
  id: string;
  email: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "ผู้ดูแลระบบ",
  sales: "ฝ่ายขาย",
  head_technician: "หัวหน้าช่าง",
  cs: "CS ติดตามลูกค้า",
  executive: "ผู้บริหาร",
  warehouse: "คลัง / จัดซื้อ",
};

export const ROLE_HOME: Record<StaffRole, string> = {
  admin: "/home",
  sales: "/sales-queue",
  head_technician: "/operations",
  cs: "/cs-tracking",
  executive: "/exec",
  warehouse: "/warehouse",
};

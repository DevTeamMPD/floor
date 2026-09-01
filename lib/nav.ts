import type { StaffRole } from "@/lib/staff";

/**
 * แหล่งความจริงเดียวของ "ใครเข้าหน้าไหนได้"
 *
 * ก่อนหน้านี้ `NavItem.roles` ถูกประกาศไว้ใน sidebar.tsx แต่ไม่เคยถูกใช้กรองอะไรเลย
 * (sidebar กรองแค่ /staff ด้วย if พิเศษ) ทำให้เกิดสองปัญหาพร้อมกัน:
 *   1) เมนูโชว์ทุกหน้าให้ทุกตำแหน่ง — การ "ซ่อนเมนู" จึงไม่ได้ซ่อนอะไรจริง
 *   2) ไม่มีหน้าไหนกันคนที่พิมพ์ URL ตรง ๆ เข้ามา
 * ย้ายมาไว้ที่นี่เพื่อให้ทั้ง "เมนูที่เห็น" และ "ด่านกันหน้า" อ่านรายการเดียวกัน
 * เพิ่มหน้าใหม่ที่ไม่ใส่ในไฟล์นี้ = เข้าไม่ได้เลย (ดู DEFAULT_PAGE_ROLES) ซึ่งตั้งใจ
 * ให้พลาดไปทางปลอดภัย ไม่ใช่ทางเปิด
 */
export interface NavItem {
  href: string;
  icon: string;
  label: string;
  roles: StaffRole[];
  /** true = เป็นหน้าที่มีจริงแต่ไม่ขึ้นในเมนู (ยังต้องมีสิทธิ์กำกับ) */
  hidden?: boolean;
}

export const ALL_ROLES: StaffRole[] = ["admin", "staff", "sales", "head_technician", "cs", "executive", "warehouse"];

/**
 * ชุดสิทธิ์ด้านล่างอิงจาก "ใครใช้หน้านั้นจริงในวันนี้" ไม่ได้อิงจากชื่อตำแหน่ง
 *
 * เหตุผลสำคัญที่ต้องบันทึกไว้: งานคลังของจริงทำโดยคน role = 'staff' ไม่ใช่ 'warehouse'
 * (ยืนยันจากข้อมูล: floor_work_orders.confirmed_by และ returned_by ทุกแถวเป็น staff กับ admin
 *  ส่วนคน role = 'warehouse' 6 คนยังไม่เคยยืนยันหรือคืนใบงานเลยแม้แต่ใบเดียว)
 * ถ้ากั้น /warehouse ไว้ที่ ['admin','warehouse'] ตามชื่อตำแหน่ง คนที่ทำงานอยู่จริงจะเข้าไม่ได้ทันที
 * ดังนั้นหน้าปฏิบัติงานทุกหน้าจึงมี 'staff' อยู่ด้วยเสมอ
 *
 * หน้าที่ "แคบโดยตั้งใจ" คือหน้าตั้งค่าระบบและหน้าข้อมูลเชิงพาณิชย์เท่านั้น
 */
export const CORE_NAV: NavItem[] = [
  { href: "/home", icon: "🏠", label: "หน้าแรก", roles: ALL_ROLES },
  { href: "/sales-queue", icon: "🗓️", label: "จองคิว", roles: ["admin", "sales", "staff", "head_technician"] },
  { href: "/tech-queue", icon: "👷", label: "คิวทีมช่าง", roles: ["admin", "sales", "staff", "head_technician"] },
  { href: "/operations", icon: "📥", label: "ต้องตัดสินใจ", roles: ["admin", "head_technician", "staff"] },
  { href: "/orders", icon: "📋", label: "ใบสั่งงาน", roles: ["admin", "sales", "head_technician", "warehouse", "staff"] },
  { href: "/warehouse", icon: "📦", label: "เตรียมสินค้า", roles: ["admin", "warehouse", "staff"] },
  { href: "/appointments", icon: "📅", label: "ปฏิทินทีม", roles: ["admin", "head_technician", "sales", "staff"] },
  { href: "/document-control", icon: "🗂️", label: "ศูนย์เอกสาร", roles: ["admin", "head_technician", "cs", "staff"] },
  { href: "/document-approvals", icon: "✅", label: "อนุมัติเอกสาร", roles: ["admin", "head_technician", "cs"] },
  { href: "/capa", icon: "🛠️", label: "CAPA แก้ไข/ป้องกัน", roles: ["admin", "head_technician", "cs", "warehouse", "staff"] },
  { href: "/technicians", icon: "🔑", label: "ทีมช่าง / PIN", roles: ["admin", "head_technician"] },
  { href: "/job-templates", icon: "🧩", label: "แม่แบบงาน", roles: ["admin", "head_technician"] },
  { href: "/remnants", icon: "✂️", label: "ตรวจรับเศษ", roles: ["admin", "warehouse", "staff"] },
  { href: "/cs-tracking", icon: "📞", label: "CS รอติดตาม", roles: ["admin", "cs", "staff"] },
  { href: "/csat-automation", icon: "✨", label: "CSAT อัตโนมัติ", roles: ["admin", "cs"] },
  { href: "/after-sales", icon: "🛟", label: "บริการหลังการขาย", roles: ["admin", "cs", "head_technician", "staff"] },
  { href: "/dashboard", icon: "⭐", label: "คุณภาพและความพึงพอใจ", roles: ["admin", "cs", "executive"] },
  { href: "/exec", icon: "📈", label: "ภาพรวมผู้บริหาร", roles: ["admin", "executive"] },
  // คู่มือการทำงานต้องเปิดให้ทุกคนอ่าน — เป็นเอกสารวิธีทำงาน ไม่ใช่ข้อมูลลับ
  { href: "/docs", icon: "📘", label: "คู่มือการทำงาน", roles: ALL_ROLES },
  { href: "/staff", icon: "👥", label: "บัญชีพนักงาน", roles: ["admin"] },
];

export const EXPERIMENTAL_NAV: NavItem[] = [
  { href: "/pipeline", icon: "📌", label: "Pipeline แบบเดิม", roles: ["admin", "head_technician", "staff"] },
  { href: "/service", icon: "🛠", label: "บริการ / SKU", roles: ["admin"] },
  { href: "/inventory", icon: "📦", label: "คลังวัสดุ", roles: ["admin", "warehouse", "staff"] },
  // ต้นทุนเศษเปิดราคาทุนของวัสดุ จึงไม่เปิดกว้างเท่าหน้าคลัง
  { href: "/waste-cost", icon: "♻️", label: "ต้นทุนเศษ", roles: ["admin", "warehouse", "executive"] },
  { href: "/bom", icon: "📐", label: "BOQ / BOM", roles: ["admin", "warehouse"] },
  // executive อยู่ด้วยเพราะเคยเป็นผู้ยื่นใบเคลมซัพพลายเออร์ 3 ใบจากทั้งหมด 11 ใบ
  // หน้านี้เป็นทะเบียนอ่านเป็นหลัก ส่วนการอนุมัติ/ระงับผู้ให้บริการยังเป็น admin ที่ RPC
  { href: "/providers", icon: "🤝", label: "ผู้ให้บริการภายนอก", roles: ["admin", "warehouse", "head_technician", "staff", "executive"] },
  { href: "/purchase-orders", icon: "🛒", label: "ใบสั่งซื้อและตรวจรับ", roles: ["admin", "warehouse", "staff"] },
  { href: "/documents", icon: "📄", label: "เอกสารแบบเดิม", roles: ["admin"] },
  { href: "/ncr", icon: "🔴", label: "NCR", roles: ["admin", "head_technician", "warehouse", "cs", "staff"] },
];

/** หน้าที่มีอยู่จริงแต่ไม่เคยอยู่ในเมนู — ต้องประกาศสิทธิ์ไว้ ไม่งั้นจะตกไป DEFAULT_PAGE_ROLES */
export const UNLISTED_NAV: NavItem[] = [
  // แก้ชุดคำถามประเมินที่ลูกค้าจะได้เห็น และเขียน evaluation_questions ตรง ๆ โดยไม่ผ่าน RPC
  { href: "/evaluation-config", icon: "📝", label: "ตั้งค่าแบบประเมิน", roles: ["admin"], hidden: true },
  // หน้าแจ้งว่าไม่มีสิทธิ์ — ทุกตำแหน่งต้องเปิดได้ ไม่งั้น middleware จะ rewrite วนไม่จบ
  { href: "/access-denied", icon: "🔒", label: "ไม่มีสิทธิ์เข้าหน้านี้", roles: ALL_ROLES, hidden: true },
];

export const ALL_NAV: NavItem[] = [...CORE_NAV, ...EXPERIMENTAL_NAV, ...UNLISTED_NAV];

/** หน้าที่ไม่ได้ประกาศไว้เลย = admin เท่านั้น เพื่อให้การลืมประกาศพลาดไปทางปลอดภัย */
export const DEFAULT_PAGE_ROLES: StaffRole[] = ["admin"];

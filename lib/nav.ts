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
  // รากของเว็บ "/" — app/manifest.ts ตั้ง start_url: "/" ไว้ แปลว่าทุกคนที่เปิดแอปที่ติดตั้งบนมือถือ
  // จะมาโผล่ที่นี่ก่อนเสมอ ถ้าไม่ประกาศไว้ หน้านี้จะตกไป DEFAULT_PAGE_ROLES = admin
  // แล้ว 6 ใน 7 ตำแหน่งจะเจอ "ไม่มีสิทธิ์เข้าหน้านี้" ตั้งแต่วินาทีแรกที่กดไอคอนแอป
  // ตัวหน้าเองไม่มีข้อมูลอะไรเลย (app/page.tsx อ่าน role แล้ว redirect ไป ROLE_HOME เท่านั้น)
  // จึงไม่มีอะไรให้กัน — และการกันมันคือการล็อกคนทั้งบริษัทออกจากแอปตัวเอง
  { href: "/", icon: "🚪", label: "ทางเข้าแอป", roles: ALL_ROLES, hidden: true },
  // จอแชร์คิวหน้างาน — ก่อนด่าน P5-6 หน้านี้เปิดให้พนักงานที่ยัง active ทุกคน
  // (middleware เดิมกันเฉพาะ /staff เท่านั้น) การที่มันหล่นไป admin-only ตอนเพิ่มด่าน
  // เป็นผลข้างเคียงของการลืมประกาศ ไม่ใช่การตัดสินใจของใคร จึงคืนกลุ่มผู้ใช้เดิมทั้งหมด
  { href: "/share/queue", icon: "📺", label: "จอแชร์คิวหน้างาน", roles: ALL_ROLES, hidden: true },
  // แก้ชุดคำถามประเมินที่ลูกค้าจะได้เห็น และเขียน evaluation_questions ตรง ๆ โดยไม่ผ่าน RPC
  { href: "/evaluation-config", icon: "📝", label: "ตั้งค่าแบบประเมิน", roles: ["admin"], hidden: true },
  // หน้าแจ้งว่าไม่มีสิทธิ์ — ทุกตำแหน่งต้องเปิดได้ ไม่งั้น middleware จะ rewrite วนไม่จบ
  { href: "/access-denied", icon: "🔒", label: "ไม่มีสิทธิ์เข้าหน้านี้", roles: ALL_ROLES, hidden: true },
];

export const ALL_NAV: NavItem[] = [...CORE_NAV, ...EXPERIMENTAL_NAV, ...UNLISTED_NAV];

/**
 * สิทธิ์ "ลงมือทำ" ของแต่ละหน้า — ต้องตรงกับตำแหน่งที่ RPC ยอมรับจริงเสมอ
 *
 * ปัญหาที่แก้: roles ของหน้าเป็น "ใครเปิดหน้านี้ได้" ซึ่งกว้างกว่า "ใครกดปุ่มนี้ได้" เสมอ
 * เมื่อสองอย่างนี้ไม่ตรงกัน คนจะเห็นปุ่มที่กดแล้วเด้ง error ทุกครั้ง
 * ของจริงที่พบ: /providers เปิดให้ staff กับ executive แต่ upsert_provider รับแค่ admin/warehouse
 * และ decide/suspend รับแค่ admin — คน role staff 37 คนเห็นปุ่มที่ใช้ไม่ได้เลยสักปุ่ม
 * เช่นเดียวกับ /capa และ /ncr ที่เปิดให้ staff แต่ capa_guard กับ create_floor_ncr ไม่รับ staff
 *
 * ทำไมเลือก "แคบที่ปุ่ม" ไม่ใช่ "แคบที่หน้า" หรือ "ขยาย RPC":
 *   หน้าเหล่านี้เป็นทะเบียนที่คนหน้างานควรอ่านได้ — ช่างและคลังต้องรู้ว่าใบ NC ใบไหนเปิดค้างอยู่
 *   บนงานของตัวเอง และ CAPA ข้อไหนกำลังแก้เรื่องอะไร การปิดหน้าทิ้งจะเอาข้อมูลที่เขาต้องใช้ไปด้วย
 *   ส่วนการ "เปิดใบ" และ "อนุมัติ/ระงับผู้ให้บริการ" เป็นหน้าที่ควบคุมคุณภาพและงานจัดซื้อ
 *   ที่มีคนรับผิดชอบชัดเจนอยู่แล้ว การขยาย RPC ให้ staff ทั้ง 37 คนทำได้ คือการเปลี่ยนว่า
 *   ใครรับผิดชอบ ซึ่งไม่มีใครขอ และไม่มีหลักฐานว่ามีใครต้องการ
 *
 * ค่าในนี้ต้องตรงกับ array ใน migration ตัวจริง — มีเทสอ่านไฟล์ SQL มาเทียบ
 */
export const PAGE_ACTION_ROLES = {
  /** upsert_provider — provider_registry_guard(array['admin','warehouse']) */
  "providers.upsert": ["admin", "warehouse"],
  /** decide_provider_approval — provider_registry_guard(array['admin']) */
  "providers.decide": ["admin"],
  /** suspend_provider / reinstate_provider — provider_registry_guard(array['admin']) */
  "providers.suspend": ["admin"],
  /** set_tech_team_provider / set_technician_provider — array['admin','head_technician'] */
  "providers.link": ["admin", "head_technician"],
  /** match/link supplier claims — provider_registry_guard(array['admin','warehouse']) */
  "providers.claims": ["admin", "warehouse"],
  /** create_capa และ RPC อื่นในทะเบียน CAPA — capa_guard */
  "capa.write": ["admin", "head_technician", "warehouse", "cs"],
  /** create_floor_ncr */
  "ncr.create": ["admin", "head_technician", "warehouse", "cs"],
} satisfies Record<string, StaffRole[]>;

export type PageAction = keyof typeof PAGE_ACTION_ROLES;

/** หน้าที่แต่ละการกระทำอยู่ — ใช้ตรวจว่า "ใครกดได้" ต้องไม่กว้างกว่า "ใครเปิดหน้าได้" */
export const PAGE_ACTION_HREF: Record<PageAction, string> = {
  "providers.upsert": "/providers",
  "providers.decide": "/providers",
  "providers.suspend": "/providers",
  "providers.link": "/providers",
  "providers.claims": "/providers",
  "capa.write": "/capa",
  "ncr.create": "/ncr",
};

/** true = ตำแหน่งนี้กดปุ่มนั้นได้จริง (RPC จะไม่ปฏิเสธ) */
export function canRoleDoAction(role: StaffRole | null | undefined, action: PageAction): boolean {
  if (!role) return false;
  return (PAGE_ACTION_ROLES[action] as readonly StaffRole[]).includes(role);
}

/** หน้าที่ไม่ได้ประกาศไว้เลย = admin เท่านั้น เพื่อให้การลืมประกาศพลาดไปทางปลอดภัย */
export const DEFAULT_PAGE_ROLES: StaffRole[] = ["admin"];

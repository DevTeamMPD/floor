export const WORK_ORDER_STATUSES = [
  "head_review", "returned_sales", "warehouse_waiting", "warehouse_preparing",
  "ready_to_install", "installing", "waiting_cs", "closed", "cancelled",
] as const;
export type WorkOrderStatus = typeof WORK_ORDER_STATUSES[number];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  head_review: "รอหัวหน้าช่างตรวจ",
  returned_sales: "ส่งกลับฝ่ายขาย",
  warehouse_waiting: "รอคลังรับงาน",
  warehouse_preparing: "กำลังเตรียมสินค้า",
  ready_to_install: "รอติดตั้ง",
  installing: "กำลังติดตั้ง",
  waiting_cs: "รอ CS โทรประเมิน",
  closed: "ปิดงานแล้ว",
  cancelled: "ยกเลิก",
};

export const WORK_ITEM_CATEGORIES = ["floor_material", "remnant", "accessory", "consumable", "equipment", "tool"] as const;
export type WorkItemCategory = typeof WORK_ITEM_CATEGORIES[number];
export const WORK_ITEM_CATEGORY_LABELS: Record<WorkItemCategory, string> = {
  floor_material: "วัสดุปูพื้น",
  remnant: "เศษวัสดุ",
  accessory: "อุปกรณ์ประกอบ",
  consumable: "วัสดุสิ้นเปลือง",
  equipment: "เครื่องมือ/อุปกรณ์",
  tool: "เครื่องมือที่ต้องนำไป",
};

export interface WorkOrder {
  id: string; appointment_id: string; job_no: string; status: WorkOrderStatus; revision: number;
  confirmed_by: string | null; confirmed_at: string | null; warehouse_assignee_id: string | null;
  warehouse_accepted_at: string | null; warehouse_completed_at: string | null;
  installation_lead_assignment_id: string | null; installation_accepted_at: string | null;
  waiting_cs_at: string | null; closed_at: string | null; note: string | null; created_at: string; updated_at: string;
  external_share_token: string; external_share_enabled: boolean;
  returned_reason: string | null; returned_by: string | null; returned_at: string | null; resubmitted_at: string | null;
}

export interface WorkOrderItem {
  id: string; work_order_id: string; category: WorkItemCategory; item_name: string; sku: string | null;
  specification: string | null; planned_qty: number; actual_qty: number | null; unit: string;
  source_type: string; note: string | null; sort_order: number;
}

export interface WorkOrderEvent {
  id: number; work_order_id: string; event_type: string; from_status: string | null; to_status: string | null;
  actor_name: string; note: string | null; photo_paths: string[]; metadata: Record<string, unknown>; occurred_at: string;
}

export function workOrderStatusClass(status: WorkOrderStatus) {
  if (status === "warehouse_preparing" || status === "installing") return "bg-blue-100 text-blue-700";
  if (status === "ready_to_install" || status === "waiting_cs") return "bg-emerald-100 text-emerald-700";
  if (status === "returned_sales" || status === "cancelled") return "bg-red-100 text-red-700";
  if (status === "closed") return "bg-slate-200 text-slate-600";
  return "bg-amber-100 text-amber-700";
}

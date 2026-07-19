export type OrderSource = "manual" | "shopee" | "lazada" | "tiktok" | "jst" | "web";

export type StageStatus = "pending" | "active" | "done";

export interface Stage {
  id: number;
  name: string;
  icon: string;
  color: string;
}

export const IP_STAGES: Stage[] = [
  { id: 1, name: "รับออเดอร์", icon: "📥", color: "bg-slate-100 text-slate-700" },
  { id: 2, name: "ติดต่อลูกค้า", icon: "📞", color: "bg-blue-100 text-blue-700" },
  { id: 3, name: "ยืนยันนัดหมาย", icon: "📅", color: "bg-indigo-100 text-indigo-700" },
  { id: 4, name: "เตรียมงาน", icon: "🔧", color: "bg-amber-100 text-amber-700" },
  { id: 5, name: "ระหว่างติดตั้ง", icon: "🚧", color: "bg-orange-100 text-orange-700" },
  { id: 6, name: "ตรวจสอบงาน", icon: "🔍", color: "bg-purple-100 text-purple-700" },
  { id: 7, name: "เสร็จสิ้น", icon: "✅", color: "bg-green-100 text-green-700" },
];

export interface CallLog {
  date: string;
  note: string;
  by?: string;
}

/**
 * InstallJob -- mirrors install_jobs table.
 *
 * NOTE: The DB primary key is `job_no` (text). There is NO `id` column in the DB.
 * `id` here is set equal to `job_no` in mapRow() so React keys work correctly.
 * Always use `jobNo` (not `id`) when querying Supabase: .eq("job_no", job.jobNo)
 */
export interface InstallJob {
  /** Same as jobNo -- set by mapRow() for React key compatibility. */
  id: string;
  jobNo: string;
  ticket?: string;
  order?: string;
  bill?: string;
  sku?: string;
  product?: string;
  customer?: string;
  stage: number;
  via?: string;
  linked?: string;
  date?: string;
  status?: string;
  due?: string;
  shift?: string;
  assignees?: string[];
  callLogs?: CallLog[];
  callAttempts?: number;
  docs?: string[];
  confirmations?: string[];
  sitePhotos?: string[];
  completionPhotos?: string[];
  area?: string;
  addr?: string;
  loc?: string;
  phone?: string;
  price?: number;
  evalToken?: string;
  evalScore?: number;
  closedAt?: string;
  closedBy?: string;
  orderSource?: OrderSource;
  locationUrl?: string;
  apptShift?: "morning" | "afternoon" | "allday";
  apptDate?: string;
}

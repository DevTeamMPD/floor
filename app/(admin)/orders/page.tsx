"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { notifyError } from "@/lib/notify-error";
import { floorErrorMessage } from "@/lib/floor-error-message";
import {
  WORK_ORDER_STATUSES,
  WORK_ORDER_STATUS_LABELS,
  type WorkOrder,
  type WorkOrderItem,
  type WorkOrderStatus,
  workOrderStatusClass,
} from "@/lib/work-orders";

interface Job {
  job_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  product_name: string | null;
  bill_no: string | null;
  source: string | null;
}

interface Appointment {
  id: string;
  slot_start: string;
  slot_end: string;
  tech_id: string | null;
}

interface Team { id: string; name: string }
interface Staff { id: string; full_name: string }

function thaiDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

export default function WorkOrdersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [appointments, setAppointments] = useState<Record<string, Appointment>>({});
  const [teams, setTeams] = useState<Record<string, Team>>({});
  const [staff, setStaff] = useState<Record<string, Staff>>({});
  const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | WorkOrderStatus>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: orderRows, error } = await supabase
      .from("floor_work_orders")
      .select("*")
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false });

    if (error) {
      notifyError(`โหลดใบสั่งงานไม่สำเร็จ: ${floorErrorMessage(error)}`);
      setLoading(false);
      return;
    }

    const rows = (orderRows ?? []) as WorkOrder[];
    setOrders(rows);
    const jobNos = Array.from(new Set(rows.map((row) => row.job_no)));
    const appointmentIds = rows.map((row) => row.appointment_id);
    const [jobResult, appointmentResult, teamResult, staffResult, itemResult] = await Promise.all([
      jobNos.length
        ? supabase.from("install_jobs").select("job_no,customer_name,customer_phone,product_name,bill_no,source").in("job_no", jobNos)
        : Promise.resolve({ data: [], error: null }),
      appointmentIds.length
        ? supabase.from("appointments").select("id,slot_start,slot_end,tech_id").in("id", appointmentIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("tech_teams").select("id,name"),
      supabase.from("floor_staff_profiles").select("id,full_name"),
      rows.length
        ? supabase.from("floor_work_order_items").select("*").in("work_order_id", rows.map((row) => row.id))
        : Promise.resolve({ data: [], error: null }),
    ]);

    const relatedError = jobResult.error ?? appointmentResult.error ?? teamResult.error ?? staffResult.error ?? itemResult.error;
    if (relatedError) notifyError(`โหลดรายละเอียดบางส่วนไม่ครบ: ${floorErrorMessage(relatedError)}`);
    setJobs(Object.fromEntries(((jobResult.data ?? []) as Job[]).map((row) => [row.job_no, row])));
    setAppointments(Object.fromEntries(((appointmentResult.data ?? []) as Appointment[]).map((row) => [row.id, row])));
    setTeams(Object.fromEntries(((teamResult.data ?? []) as Team[]).map((row) => [row.id, row])));
    setStaff(Object.fromEntries(((staffResult.data ?? []) as Staff[]).map((row) => [row.id, row])));
    setItems((itemResult.data ?? []) as WorkOrderItem[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const filtered = orders.filter((order) => {
    if (status !== "all" && order.status !== status) return false;
    const job = jobs[order.job_no];
    const needle = search.trim().toLocaleLowerCase("th-TH");
    if (!needle) return true;
    return [order.job_no, job?.customer_name, job?.customer_phone, job?.product_name, job?.bill_no]
      .some((value) => value?.toLocaleLowerCase("th-TH").includes(needle));
  });

  return <div className="mx-auto max-w-7xl">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">FloorNow</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">ใบสั่งงานทั้งหมด</h1>
        <p className="mt-1 text-sm text-slate-500">ติดตามงานตั้งแต่หัวหน้าช่างตรวจ จนถึงส่งให้ CS ประเมินลูกค้า</p>
      </div>
      <button onClick={() => void load()} className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">รีเฟรช</button>
    </div>

    <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_240px]">
      <label>
        <span className="mb-1 block text-xs font-medium text-slate-500">ค้นหาใบงาน</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ชื่อลูกค้า เบอร์โทร เลขงาน เลขบิล หรือสินค้า" className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500" />
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-slate-500">สถานะ</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as "all" | WorkOrderStatus)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm">
          <option value="all">ทุกสถานะ</option>
          {WORK_ORDER_STATUSES.filter((value) => value !== "cancelled").map((value) => <option key={value} value={value}>{WORK_ORDER_STATUS_LABELS[value]}</option>)}
        </select>
      </label>
    </div>

    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>พบ {filtered.length} ใบงาน</span>
      {search || status !== "all" ? <button onClick={() => { setSearch(""); setStatus("all"); }} className="text-blue-600">ล้างตัวกรอง</button> : null}
    </div>

    {loading ? <div className="mt-4 rounded-2xl border bg-white p-12 text-center text-slate-400">กำลังโหลดใบสั่งงาน…</div> : null}
    {!loading && !filtered.length ? <div className="mt-4 rounded-2xl border bg-white p-12 text-center text-slate-400">ไม่พบใบสั่งงานที่ตรงกับตัวกรอง</div> : null}

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {filtered.map((order) => {
        const job = jobs[order.job_no];
        const appointment = appointments[order.appointment_id];
        const orderItems = items.filter((item) => item.work_order_id === order.id);
        const team = appointment?.tech_id ? teams[appointment.tech_id] : null;
        const warehouseAssignee = order.warehouse_assignee_id ? staff[order.warehouse_assignee_id] : null;
        return <article key={order.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-semibold text-slate-950">{job?.customer_name || order.job_no}</h2>
                {job?.source === "bbps" ? <Badge tone="orange">BBPS</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-slate-400">#{order.job_no}{job?.bill_no ? ` · บิล ${job.bill_no}` : ""}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${workOrderStatusClass(order.status)}`}>{WORK_ORDER_STATUS_LABELS[order.status]}</span>
          </div>

          <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
            <div><span className="block text-xs text-slate-400">วันติดตั้ง</span>{appointment ? thaiDate(appointment.slot_start) : "—"}</div>
            <div><span className="block text-xs text-slate-400">ทีมช่าง</span>{team?.name || "ยังไม่ระบุทีม"}</div>
            <div><span className="block text-xs text-slate-400">สินค้า / สเปก</span><span className="line-clamp-2">{job?.product_name || "ยังไม่ระบุ"}</span></div>
            <div><span className="block text-xs text-slate-400">รายการเตรียม</span>{orderItems.length} รายการ · {orderItems.reduce((sum, item) => sum + Number(item.planned_qty), 0).toLocaleString()} หน่วย</div>
          </div>
          {warehouseAssignee ? <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">ผู้รับงานคลัง: {warehouseAssignee.full_name}</div> : null}

          <div className="mt-auto pt-5">
            <Link href={`/orders/${encodeURIComponent(order.job_no)}`} className="block rounded-xl bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700">เปิดใบสั่งงานฉบับเต็ม</Link>
          </div>
        </article>;
      })}
    </div>
  </div>;
}

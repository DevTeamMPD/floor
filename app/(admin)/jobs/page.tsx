"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstallJob } from "@/lib/types";
import { IP_STAGES } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function mapRow(row: Record<string, unknown>): InstallJob {
  return {
    id: row.job_no as string,
    jobNo: row.job_no as string,
    ticket: row.ticket_no as string,
    order: row.order_no as string,
    product: row.product_name as string,
    customer: row.customer_name as string,
    stage: Number(row.stage) || 1,
    via: row.via as string,
    date: row.order_date as string,
    status: row.status as string,
    due: row.due_date as string,
    phone: row.phone as string,
    addr: row.address as string,
    evalScore: row.eval_score != null ? Number(row.eval_score) : undefined,
    orderSource: row.order_source as InstallJob["orderSource"],
  };
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<InstallJob[]>([]);
  const [search, setSearch] = useState("");
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from("install_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setJobs((data ?? []).map(mapRow)));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(
      (j) =>
        j.customer?.toLowerCase().includes(q) ||
        j.order?.toLowerCase().includes(q) ||
        j.product?.toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const total = jobs.length;
  const inProgress = jobs.filter((j) => j.stage >= 2 && j.stage <= 6).length;
  const done = jobs.filter((j) => j.stage === 7).length;
  const evald = jobs.filter((j) => j.evalScore != null).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">งานทั้งหมด</h1>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "งานทั้งหมด", value: total, color: "text-blue-600" },
          { label: "กำลังดำเนินงาน", value: inProgress, color: "text-amber-600" },
          { label: "เสร็จสิ้น", value: done, color: "text-green-600" },
          { label: "มีคะแนนประเมิน", value: evald, color: "text-purple-600" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-sm text-slate-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาลูกค้า, ออเดอร์, สินค้า…"
            className="w-full max-w-sm px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["ออเดอร์", "ลูกค้า", "สินค้า", "สเตจ", "วันที่สั่ง", "คะแนน"].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((j) => {
              const stg = IP_STAGES.find((s) => s.id === j.stage);
              return (
                <tr key={j.jobNo} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{j.order ?? "—"}</td>
                  <td className="px-4 py-3">{j.customer ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{j.product ?? "—"}</td>
                  <td className="px-4 py-3">
                    {stg && (
                      <span className={`tag ${stg.color}`}>{stg.icon} {stg.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(j.date)}</td>
                  <td className="px-4 py-3">
                    {j.evalScore != null ? (
                      <span className="tag s-purple">★ {j.evalScore}</span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

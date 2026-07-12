"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface JobRow {
  id: string;
  stage: number;
  eval_score: number | null;
  closed_at: string | null;
  order_date: string | null;
  customer_name: string | null;
  product_name: string | null;
  order_no: string | null;
  due_date: string | null;
  created_at: string;
}

export default function OverviewPage() {
  const supabase = createClient();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("install_jobs")
      .select("id,stage,eval_score,closed_at,order_date,customer_name,product_name,order_no,due_date,created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setJobs((data ?? []) as JobRow[]);
        setLoading(false);
      });
  }, []);

  const total = jobs.length;
  const active = jobs.filter((j) => j.stage >= 2 && j.stage <= 6).length;
  const done = jobs.filter((j) => j.stage === 7).length;
  const withEval = jobs.filter((j) => j.eval_score != null).length;
  const avgEval = withEval > 0
    ? (jobs.reduce((s, j) => s + (j.eval_score ?? 0), 0) / withEval).toFixed(1)
    : null;

  // This month completions
  const nowMonth = new Date().toISOString().slice(0, 7);
  const doneThisMonth = jobs.filter(
    (j) => j.stage === 7 && j.closed_at?.startsWith(nowMonth)
  ).length;

  // Stage breakdown
  const stageBreakdown = IP_STAGES.map((s) => ({
    stage: s,
    count: jobs.filter((j) => j.stage === s.id).length,
  }));

  // Recent completed jobs (last 8)
  const recentDone = jobs
    .filter((j) => j.stage === 7 && j.closed_at)
    .slice(0, 8);

  // Recently added jobs (last 8)
  const recentAdded = jobs.slice(0, 8);

  const KPI_CARDS = [
    { label: "งานทั้งหมด", value: total, color: "text-blue-600", bg: "bg-blue-50", icon: "💼" },
    { label: "กำลังดำเนินการ", value: active, color: "text-amber-600", bg: "bg-amber-50", icon: "🔄" },
    { label: "เสร็จเดือนนี้", value: doneThisMonth, color: "text-green-600", bg: "bg-green-50", icon: "✅" },
    {
      label: avgEval ? `คะแนน Eval เฉลี่ย` : "ยังไม่มีคะแนน Eval",
      value: avgEval ? `★ ${avgEval}` : "—",
      color: "text-purple-600",
      bg: "bg-purple-50",
      icon: "⭐",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">ภาพรวม</h1>
          <p className="text-slate-500 text-sm mt-0.5">สถิติงานติดตั้งทั้งหมด</p>
        </div>
        {loading && <span className="text-sm text-slate-400 animate-pulse">โหลดข้อมูล…</span>}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {KPI_CARDS.map((k) => (
          <div key={k.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <div className={`w-10 h-10 rounded-lg ${k.bg} flex items-center justify-center text-xl mb-3`}>
              {k.icon}
            </div>
            <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-sm text-slate-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Stage breakdown */}
        <div className="col-span-1 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-700">งานตามขั้นตอน</h2>
          </div>
          <div className="p-4 space-y-2">
            {stageBreakdown.map(({ stage, count }) => (
              <div key={stage.id} className="flex items-center gap-3">
                <div className={`px-2 py-0.5 rounded text-xs font-medium ${stage.color} w-36 truncate`}>
                  {stage.icon} {stage.name}
                </div>
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: total > 0 ? `${(count / total) * 100}%` : "0%" }}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-700 w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent jobs */}
        <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-700">งานล่าสุด</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["ลูกค้า", "สินค้า", "ขั้นตอน", "วันที่สั่ง"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentAdded.map((j) => {
                const stg = IP_STAGES.find((s) => s.id === j.stage);
                return (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{j.customer_name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate">{j.product_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {stg && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${stg.color}`}>
                          {stg.icon} {stg.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(j.order_date)}</td>
                  </tr>
                );
              })}
              {recentAdded.length === 0 && !loading && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-300">ยังไม่มีงาน</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

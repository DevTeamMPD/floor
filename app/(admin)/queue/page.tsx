"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import type { InstallJob } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function mapRow(row: Record<string, unknown>): InstallJob {
  return {
    id: String(row.id),
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
    assignees: row.assignees as string[],
    evalScore: row.eval_score != null ? Number(row.eval_score) : undefined,
    orderSource: row.order_source as InstallJob["orderSource"],
  };
}

type Group = { label: string; color: string; jobs: InstallJob[] };

export default function QueuePage() {
  const supabase = createClient();
  const [jobs, setJobs] = useState<InstallJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("install_jobs")
      .select("*")
      .in("stage", [2, 3, 4, 5, 6])
      .order("due_date", { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        setJobs((data ?? []).map(mapRow));
        setLoading(false);
      });
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(
    () => (stageFilter ? jobs.filter((j) => j.stage === stageFilter) : jobs),
    [jobs, stageFilter]
  );

  const groups: Group[] = useMemo(() => {
    const overdue = filtered.filter((j) => j.due && j.due < todayStr);
    const today  = filtered.filter((j) => j.due === todayStr);
    const upcoming = filtered.filter((j) => !j.due || j.due > todayStr);
    return [
      { label: "⚠️ เกินกำหนด", color: "border-red-300 bg-red-50", jobs: overdue },
      { label: "📅 วันนี้", color: "border-amber-300 bg-amber-50", jobs: today },
      { label: "📌 กำลังมา / ไม่มีกำหนด", color: "border-slate-200 bg-slate-50", jobs: upcoming },
    ].filter((g) => g.jobs.length > 0);
  }, [filtered, todayStr]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">คิวงาน</h1>
          <p className="text-slate-500 text-sm mt-0.5">งานที่กำลังดำเนินการ (ขั้นตอน 2–6)</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setStageFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              stageFilter === null ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            ทั้งหมด ({loading ? "…" : filtered.length})
          </button>
          {IP_STAGES.filter((s) => s.id >= 2 && s.id <= 6).map((s) => {
            const cnt = jobs.filter((j) => j.stage === s.id).length;
            return (
              <button
                key={s.id}
                onClick={() => setStageFilter(stageFilter === s.id ? null : s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  stageFilter === s.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {s.icon} {s.name} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm animate-pulse">โหลดข้อมูล…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-300">
          <div className="text-4xl mb-3">🎉</div>
          <div className="font-medium">ไม่มีงานค้างอยู่ในขั้นตอนนี้</div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="font-semibold text-slate-700">{g.label}</h2>
                <span className="text-xs text-slate-400 font-normal">{g.jobs.length} งาน</span>
              </div>
              <div className={`rounded-xl border overflow-hidden ${g.color}`}>
                <table className="w-full text-sm bg-white">
                  <thead className="bg-slate-50">
                    <tr>
                      {["ลูกค้า", "สินค้า", "ขั้นตอน", "เบอร์โทร", "กำหนด"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 font-medium text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.jobs.map((j) => {
                      const stg = IP_STAGES.find((s) => s.id === j.stage);
                      const overdue = j.due && j.due < todayStr;
                      return (
                        <tr key={j.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-4 py-3 font-medium">{j.customer ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{j.product ?? "—"}</td>
                          <td className="px-4 py-3">
                            {stg && (
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${stg.color}`}>
                                {stg.icon} {stg.name}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{j.phone ?? "—"}</td>
                          <td className={`px-4 py-3 text-xs ${overdue ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                            {j.due ? formatDate(j.due) : "ไม่ระบุ"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

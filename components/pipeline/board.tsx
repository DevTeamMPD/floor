"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import type { InstallJob } from "@/lib/types";
import JobCard from "./job-card";
import JobDrawer from "./job-drawer";
import CreateOrderModal from "./create-order-modal";

// install_jobs PK is job_no (text) — there is NO id column in the DB.
// id here is set to job_no so React keys and any legacy references still work.
function mapRow(row: Record<string, unknown>): InstallJob {
  return {
    id: row.job_no as string,
    ticket: row.ticket_no as string,
    order: row.order_no as string,
    bill: row.bill_no as string,
    sku: row.sku as string,
    product: row.product_name as string,
    customer: row.customer_name as string,
    stage: Number(row.stage) || 1,
    via: row.via as string,
    linked: row.linked_order as string,
    date: row.order_date as string,
    status: row.status as string,
    due: row.due_date as string,
    shift: row.shift as string,
    assignees: row.assignees as string[],
    callLogs: row.call_logs as InstallJob["callLogs"],
    docs: row.docs as string[],
    confirmations: row.confirmations as string[],
    sitePhotos: row.site_photos as string[],
    completionPhotos: row.completion_photos as string[],
    area: row.area as string,
    addr: row.address as string,
    loc: row.location as string,
    phone: row.phone as string,
    price: row.price != null ? Number(row.price) : undefined,
    jobNo: row.job_no as string,
    evalToken: row.eval_token as string,
    evalScore: row.eval_score != null ? Number(row.eval_score) : undefined,
    closedAt: row.closed_at as string,
    closedBy: row.closed_by as string,
    orderSource: row.order_source as InstallJob["orderSource"],
    locationUrl: row.location_url as string,
    apptShift: row.appt_shift as InstallJob["apptShift"],
  };
}

export default function PipelineBoard() {
  const supabase = createClient();
  const [jobs, setJobs] = useState<InstallJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState<InstallJob | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("install_jobs")
      .select("*")
      .order("created_at", { ascending: false });
    setJobs((data ?? []).map(mapRow));
    setLoading(false);
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const filtered = useMemo(() => {
    let j = jobs;
    if (search) {
      const q = search.toLowerCase();
      j = j.filter(
        (x) =>
          x.customer?.toLowerCase().includes(q) ||
          x.product?.toLowerCase().includes(q) ||
          x.order?.toLowerCase().includes(q)
      );
    }
    return j;
  }, [jobs, search]);

  const columns = useMemo(() =>
    IP_STAGES.map((s) => ({
      stage: s,
      items: filtered.filter((j) => j.stage === s.id),
    })),
    [filtered]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold mr-2">Pipeline</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา…"
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-52"
        />
        <div className="flex gap-1 ml-2">
          <button
            onClick={() => setStageFilter(null)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              stageFilter === null ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            ทั้งหมด
          </button>
          {IP_STAGES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStageFilter(stageFilter === s.id ? null : s.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                stageFilter === s.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.icon}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={fetchJobs}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
          >
            🔄 รีเซ็ต
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + สร้างออเดอร์
          </button>
        </div>
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">โหลดข้อมูล…</div>
      ) : (
        <div
          className="flex gap-3 overflow-x-auto pb-4"
          style={{ display: stageFilter ? "block" : "flex" }}
        >
          {columns
            .filter((c) => stageFilter === null || c.stage.id === stageFilter)
            .map((col) => (
              <div
                key={col.stage.id}
                className="flex-shrink-0 w-64"
              >
                <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${col.stage.color}`}>
                  <span className="text-sm font-medium">{col.stage.icon} {col.stage.name}</span>
                  <span className="text-xs font-bold opacity-70">{col.items.length}</span>
                </div>
                <div className="bg-slate-50 rounded-b-lg p-2 space-y-2 min-h-[120px]">
                  {col.items.map((job) => (
                    <JobCard
                      key={job.jobNo}
                      job={job}
                      onClick={() => setSelectedJob(job)}
                    />
                  ))}
                  {col.items.length === 0 && (
                    <div className="text-center text-xs text-slate-300 py-6">ไม่มีงาน</div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onRefresh={fetchJobs}
        />
      )}
      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchJobs(); }}
        />
      )}
    </div>
  );
}

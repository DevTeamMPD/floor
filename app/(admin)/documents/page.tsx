"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface JobDoc {
  id: string;
  order_no: string | null;
  ticket_no: string | null;
  customer_name: string | null;
  product_name: string | null;
  stage: number;
  order_date: string | null;
  due_date: string | null;
  phone: string | null;
  address: string | null;
  closed_at: string | null;
  created_at: string;
}

function PrintModal({ job, onClose }: { job: JobDoc; onClose: () => void }) {
  const stg = IP_STAGES.find((s) => s.id === job.stage);
  const isComplete = job.stage === 7;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-xs text-slate-400 mb-1">
              {isComplete ? "ใบส่งงาน" : "ใบสั่งงาน"}
            </div>
            <h2 className="text-xl font-bold text-slate-800">
              {job.order_no ?? job.ticket_no ?? job.id.slice(0, 8)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {stg && (
              <span className={`tag ${stg.color} text-xs`}>
                {stg.icon} {stg.name}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3 text-sm">
          {[
            ["ลูกค้า", job.customer_name],
            ["สินค้า", job.product_name],
            ["เบอร์โทร", job.phone],
            ["ที่อยู่", job.address],
            ["วันที่สั่ง", formatDate(job.order_date)],
            ["กำหนดส่ง", formatDate(job.due_date)],
            ...(isComplete ? [["วันปิดงาน", formatDate(job.closed_at)]] : []),
          ].map(([label, value]) =>
            value ? (
              <div key={label as string} className="flex gap-2">
                <span className="w-28 text-slate-400 shrink-0">{label}</span>
                <span className="text-slate-800 font-medium">{value}</span>
              </div>
            ) : null
          )}
        </div>

        <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            ปิด
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            🖨️ พิมพ์
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const supabase = createClient();
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [selected, setSelected] = useState<JobDoc | null>(null);

  useEffect(() => {
    supabase
      .from("install_jobs")
      .select("id,order_no,ticket_no,customer_name,product_name,stage,order_date,due_date,phone,address,closed_at,created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setJobs((data ?? []) as JobDoc[]);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    let list = jobs;
    if (filter === "active") list = list.filter((j) => j.stage >= 1 && j.stage <= 6);
    if (filter === "done") list = list.filter((j) => j.stage === 7);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) =>
          j.customer_name?.toLowerCase().includes(q) ||
          j.order_no?.toLowerCase().includes(q) ||
          j.product_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [jobs, filter, search]);

  const active = filtered.filter((j) => j.stage <= 6);
  const done = filtered.filter((j) => j.stage === 7);

  function DocRow({ job }: { job: JobDoc }) {
    const stg = IP_STAGES.find((s) => s.id === job.stage);
    const isComplete = job.stage === 7;
    return (
      <tr
        className="hover:bg-blue-50 cursor-pointer transition-colors"
        onClick={() => setSelected(job)}
      >
        <td className="px-4 py-3">
          <div className="font-mono text-xs text-blue-700">
            {job.order_no ?? job.ticket_no ?? job.id.slice(0, 8)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {isComplete ? "ใบส่งงาน" : "ใบสั่งงาน"}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-sm">{job.customer_name ?? "—"}</div>
          {job.phone && <div className="text-xs text-slate-400">{job.phone}</div>}
        </td>
        <td className="px-4 py-3 text-sm text-slate-600">{job.product_name ?? "—"}</td>
        <td className="px-4 py-3">
          {stg && (
            <span className={`tag ${stg.color} text-xs`}>
              {stg.icon} {stg.name}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-slate-400">
          {isComplete ? formatDate(job.closed_at) : formatDate(job.due_date ?? job.order_date)}
        </td>
        <td className="px-4 py-3">
          <button className="text-xs text-blue-600 hover:underline">ดูเอกสาร →</button>
        </td>
      </tr>
    );
  }

  function Section({ title, rows, emptyMsg }: { title: string; rows: JobDoc[]; emptyMsg: string }) {
    if (rows.length === 0) return null;
    return (
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          {title} <span className="text-slate-300 font-normal">({rows.length})</span>
        </h2>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["เลขเอกสาร", "ลูกค้า", "สินค้า", "สถานะ", "วันที่", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-slate-500 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((j) => <DocRow key={j.id} job={j} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">เอกสาร</h1>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาลูกค้า, ออเดอร์, สินค้า…"
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-64"
        />
        <div className="flex gap-1">
          {(["all", "active", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "all" ? "ทั้งหมด" : f === "active" ? "ใบสั่งงาน" : "ใบส่งงาน"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">กำลังโหลด…</div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-400 text-sm">ไม่พบเอกสาร</div>
      ) : (
        <>
          <Section title="ใบสั่งงาน — งานที่ยังดำเนินการ" rows={active} emptyMsg="ไม่มีใบสั่งงาน" />
          <Section title="ใบส่งงาน — งานเสร็จสิ้น" rows={done} emptyMsg="ไม่มีใบส่งงาน" />
        </>
      )}

      {selected && <PrintModal job={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

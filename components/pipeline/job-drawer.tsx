"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import type { InstallJob } from "@/lib/types";
import { formatDate, ipGenToken } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  job: InstallJob;
  onClose: () => void;
  onRefresh: () => void;
}

const FIELD_ROWS = [
  { label: "ลูกค้า", key: "customer" as const },
  { label: "เบอร์โทร", key: "phone" as const },
  { label: "ที่อยู่", key: "addr" as const },
  { label: "สินค้า", key: "product" as const },
  { label: "SKU", key: "sku" as const },
  { label: "ออเดอร์", key: "order" as const },
  { label: "บิล", key: "bill" as const },
  { label: "วันที่สั่ง", key: "date" as const, format: true },
  { label: "กำหนดเสร็จ", key: "due" as const, format: true },
];

export default function JobDrawer({ job, onClose, onRefresh }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<"info" | "stages" | "close">("info");
  const [loading, setLoading] = useState(false);

  async function advanceStage() {
    if (job.stage >= 7) return;
    setLoading(true);
    await supabase
      .from("install_jobs")
      .update({ stage: job.stage + 1 })
      .eq("id", job.id);
    setLoading(false);
    toast.success("เลื่อนสต้าเจอร์แล้ว");
    onRefresh();
    onClose();
  }

  async function closeJob() {
    setLoading(true);
    const token = ipGenToken();
    await supabase
      .from("install_jobs")
      .update({
        stage: 7,
        status: "Completed",
        closed_at: new Date().toISOString(),
        eval_token: token,
      })
      .eq("id", job.id);
    await supabase.from("job_evals").insert({
      install_job_id: job.id,
      token,
    });
    const link = `${window.location.origin}/eval?t=${token}`;
    await navigator.clipboard.writeText(link);
    toast.success("ปิดงานแล้ว — คัดลิงก์ประเมินผลให้ clipboard แล้ว");
    setLoading(false);
    onRefresh();
    onClose();
  }

  const stg = IP_STAGES.find((s) => s.id === job.stage);

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-screen w-[480px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="font-semibold text-slate-800">{job.product ?? "—"}</div>
            <div className="text-sm text-slate-500 mt-0.5">{job.customer}</div>
          </div>
          <div className="flex items-center gap-2">
            {stg && <span className={`tag ${stg.color}`}>{stg.icon} {stg.name}</span>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl ml-2">&times;</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {(["info", "stages", "close"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "info" ? "ข้อมูล" : t === "stages" ? "ขั้นตอน" : "ปิดงาน"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "info" && (
            <div className="space-y-3">
              {FIELD_ROWS.map((r) => {
                const raw = job[r.key];
                const val = r.format ? formatDate(raw as string) : (raw ?? "—");
                return (
                  <div key={r.label} className="flex">
                    <span className="w-28 text-sm text-slate-400 shrink-0">{r.label}</span>
                    <span className="text-sm text-slate-700">{String(val)}</span>
                  </div>
                );
              })}
              {job.evalScore != null && (
                <div className="flex">
                  <span className="w-28 text-sm text-slate-400 shrink-0">คะแนน Eval</span>
                  <span className="tag s-purple">★ {job.evalScore}</span>
                </div>
              )}
            </div>
          )}

          {tab === "stages" && (
            <div className="space-y-2">
              {IP_STAGES.map((s) => {
                const done = job.stage > s.id;
                const active = job.stage === s.id;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 p-3 rounded-lg ${
                      active ? "bg-blue-50 border border-blue-200" :
                      done ? "bg-green-50" : "bg-slate-50"
                    }`}
                  >
                    <span className="text-lg">{done ? "✅" : active ? s.icon : "⏳"}</span>
                    <span className={`text-sm font-medium ${
                      active ? "text-blue-700" : done ? "text-green-700" : "text-slate-400"
                    }`}>{s.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "close" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">การปิดงานจะเลื่อนสต้าเจอร์เป็น “เสร็จสิ้น” และสร้างลิงก์ประเมินผลสำหรับลูกค้า เพื่อคัดไปยัง clipboard</p>
              {job.stage === 7 ? (
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-700 font-medium">✅ งานนี้ปิดแล้ว</p>
                  {job.evalToken && (
                    <p className="text-xs text-slate-500 mt-1 break-all">/eval?t={job.evalToken}</p>
                  )}
                </div>
              ) : (
                <>
                  {job.stage < 7 && (
                    <button
                      onClick={advanceStage}
                      disabled={loading}
                      className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      เลื่อนไปสต้าเจอร์ถัดไป ({IP_STAGES.find((s) => s.id === job.stage + 1)?.name})
                    </button>
                  )}
                  <button
                    onClick={closeJob}
                    disabled={loading}
                    className="w-full bg-green-600 text-white rounded-lg py-3 font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    ✅ ปิดงาน + สร้างลิงก์ประเมินผล
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

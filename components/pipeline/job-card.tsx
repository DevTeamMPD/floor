import type { InstallJob } from "@/lib/types";
import { IP_STAGES } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface Props {
  job: InstallJob;
  onClick: () => void;
}

const SOURCE_COLORS: Record<string, string> = {
  shopee: "s-amber",
  lazada: "s-blue",
  tiktok: "s-red",
  manual: "s-gray",
  jst: "s-purple",
  web: "s-green",
  floor_direct: "s-blue",
  bbps: "s-amber",
};

const SOURCE_LABELS: Record<string, string> = {
  floor_direct: "ขายตรง",
  bbps: "BBPS",
};

export default function JobCard({ job, onClick }: Props) {
  const stg = IP_STAGES.find((s) => s.id === job.stage);
  const source = job.orderSource ?? job.via ?? "";
  const srcColor = SOURCE_COLORS[source] ?? "s-gray";

  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-100 rounded-xl p-3 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono text-slate-400">{job.ticket ?? job.order}</span>
        {(job.orderSource || job.via) && (
          <span className={`tag ${srcColor} text-[10px]`}>
            {SOURCE_LABELS[source] ?? source}
          </span>
        )}
      </div>

      <div className="text-sm font-medium text-slate-800 leading-snug mb-1">
        {job.product ?? "—"}
      </div>
      <div className="text-xs text-slate-500 mb-2">{job.customer}</div>

      {/* เฟส A: ค้างที่ใคร + ธง */}
      {job.waitingOn && job.waitingOn !== "ไม่ได้ค้าง" && (
        <div className="mb-1.5">
          <span className="tag s-amber text-[10px]">
            🕒 {job.waitingOn}
            {job.waitingSince ? ` · ${Math.max(0, Math.floor((Date.now() - new Date(job.waitingSince).getTime()) / 86400000))} วัน` : ""}
          </span>
        </div>
      )}
      {(job.needsSurvey || job.needsRedesign || job.hasDefect || job.isClaim) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {job.needsSurvey && <span className="tag s-red text-[10px]">ประเมินพื้นที่</span>}
          {job.needsRedesign && <span className="tag s-red text-[10px]">แก้แบบ</span>}
          {job.hasDefect && <span className="tag s-red text-[10px]">Defect</span>}
          {job.isClaim && <span className="tag s-red text-[10px]">เคลม</span>}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{formatDate(job.due) !== "—" ? `ด ${formatDate(job.due)}` : ""}</span>
        {job.evalScore != null && (
          <span className="tag s-purple text-[10px]">★ {job.evalScore}</span>
        )}
        {job.assignees && job.assignees.length > 0 && (
          <span className="text-[10px] text-slate-400">👤 {job.assignees.length}</span>
        )}
      </div>
    </div>
  );
}

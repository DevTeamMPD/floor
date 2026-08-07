"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Status = "scheduled" | "tentative" | "unscheduled" | "design_pending";

type Job = {
  customer: string;
  spec: string;
  installDateText: string;
  installDateISO: string | null;
  phone: string;
  mapUrl: string;
  siteNote: string;
  hours: string;
  apptNote: string;
  status: Status;
};

type ApiData = {
  jobs: Job[];
  stock: string[];
  updatedAt: string;
  sourceUrl: string;
  error?: string;
};

const STATUS_META: Record<Status, { label: string; cls: string; color: string }> = {
  scheduled: { label: "มีวันติดตั้ง", cls: "s-green", color: "#15935E" },
  tentative: { label: "วันคร่าวๆ", cls: "s-amber", color: "#C2820E" },
  unscheduled: { label: "ยังไม่กำหนดวัน", cls: "s-gray", color: "#64748B" },
  design_pending: { label: "รอเคลียร์แบบ", cls: "s-purple", color: "#7C3AED" },
};
const STATUS_ORDER: Status[] = ["scheduled", "tentative", "unscheduled", "design_pending"];

function firstLine(s: string): string {
  return (s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)[0] || "";
}

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 8 ? digits : null;
}

export default function DashboardPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/softplay-schedule", { cache: "no-store" });
      const json: ApiData = await res.json();
      if (json.error) setErr(json.error);
      setData(json);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { scheduled: 0, tentative: 0, unscheduled: 0, design_pending: 0 };
    jobs.forEach((j) => {
      c[j.status]++;
    });
    return c;
  }, [jobs]);

  const upcoming = useMemo(
    () =>
      jobs
        .filter((j) => j.installDateISO)
        .sort((a, b) => (a.installDateISO! < b.installDateISO! ? -1 : 1)),
    [jobs]
  );

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const oa = STATUS_ORDER.indexOf(a.status);
      const ob = STATUS_ORDER.indexOf(b.status);
      if (oa !== ob) return oa - ob;
      const da = a.installDateISO ?? "9999";
      const db = b.installDateISO ?? "9999";
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }, [jobs]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">🎪 คิวติดตั้งบ้านบอล</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            ดึงสดจาก Google Sheet
            {data?.updatedAt
              ? ` · อัปเดต ${new Date(data.updatedAt).toLocaleString("th-TH", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "short",
                })}`
              : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data?.sourceUrl && (
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
            >
              📄 เปิด Sheet
            </a>
          )}
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            🔄 โหลดใหม่
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-4">
          ⚠️ ดึงข้อมูลไม่สำเร็จ: {err} — ตรวจว่า Google Sheet เปิดสิทธิ์แบบทุกคนที่มีลิงก์แล้วหรือยัง
        </div>
      )}

      {loading && !data ? (
        <div className="text-slate-400 py-20 text-center">⏳ กำลังโหลด...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <StatTile label="งานทั้งหมด" value={jobs.length} color="#2563EB" />
            <StatTile label="มีวันติดตั้ง" value={counts.scheduled} color="#15935E" />
            <StatTile label="รอกำหนดวัน" value={counts.tentative + counts.unscheduled} color="#C2820E" />
            <StatTile label="รอเคลียร์แบบ" value={counts.design_pending} color="#7C3AED" />
          </div>

          {jobs.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
              <div className="text-xs font-medium text-slate-500 mb-2">สัดส่วนสถานะ</div>
              <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                {STATUS_ORDER.map((s) =>
                  counts[s] > 0 ? (
                    <div
                      key={s}
                      style={{ width: `${(counts[s] / jobs.length) * 100}%`, background: STATUS_META[s].color }}
                    />
                  ) : null
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                {STATUS_ORDER.map((s) => (
                  <span key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_META[s].color }} />
                    {STATUS_META[s].label} <strong>{counts[s]}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
              <h2 className="text-sm font-semibold mb-3">📅 คิวที่มีวันติดตั้ง</h2>
              <div className="space-y-2">
                {upcoming.map((j, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="tag s-green shrink-0">{j.installDateText}</span>
                    <span className="font-medium text-slate-800">{j.customer}</span>
                    <span className="text-slate-400 truncate hidden sm:block">{firstLine(j.spec)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data?.stock && data.stock.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
              <h2 className="text-sm font-semibold mb-1 text-amber-800">📦 สต็อกลูกบอล</h2>
              <div className="text-sm text-amber-900 space-y-0.5">
                {data.stock.map((s, i) => (
                  <div key={i}>{s}</div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sortedJobs.map((j, i) => (
              <JobCard key={i} job={j} />
            ))}
          </div>

          {jobs.length === 0 && !err && (
            <div className="text-slate-400 py-16 text-center text-sm">ไม่พบข้อมูลใน Sheet</div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const meta = STATUS_META[job.status];
  const tel = telHref(job.phone);
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-slate-800">{job.customer}</h3>
        <span className={`tag ${meta.cls} shrink-0`}>{meta.label}</span>
      </div>
      {job.installDateText && <div className="text-sm text-slate-600 mb-2">📅 {job.installDateText}</div>}
      {job.spec && (
        <div className="text-xs text-slate-600 whitespace-pre-line bg-slate-50 rounded-lg p-2.5 mb-2 leading-relaxed">
          {job.spec}
        </div>
      )}
      {job.siteNote && <div className="text-xs text-amber-700 whitespace-pre-line mb-2">📝 {job.siteNote}</div>}
      {(job.hours || job.apptNote) && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
          {job.hours && <span>⏱ {job.hours}</span>}
          {job.apptNote && <span>🕘 {job.apptNote}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-auto pt-1">
        {tel && (
          <a href={`tel:${tel}`} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-700">
            📞 {job.phone.split("\n")[0]}
          </a>
        )}
        {job.mapUrl && (
          <a
            href={job.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-xs text-blue-700"
          >
            📍 แผนที่
          </a>
        )}
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type SurveyResponse = {
  timestamp: string;
  bill: string;
  customer: string;
  phone: string;
  scores: (number | null)[];
  overall: number | null;
  comment: string;
};

type ApiData = {
  responses: SurveyResponse[];
  updatedAt: string;
  sourceUrl: string;
  error?: string;
};

const DIMS = [
  { label: "ความพึงพอใจในการให้บริการ", short: "บริการ" },
  { label: "คุณภาพของงานติดตั้ง", short: "คุณภาพงาน" },
  { label: "ความเรียบร้อย/สะอาดหลังติดตั้ง", short: "ความเรียบร้อย" },
  { label: "การตรงต่อเวลาของทีมงาน", short: "ตรงเวลา" },
  { label: "ความสุภาพ/การให้คำแนะนำ", short: "ความสุภาพ" },
];

const SCORE_COLOR: Record<number, string> = {
  5: "#15935E",
  4: "#2563EB",
  3: "#C2820E",
  2: "#E8833A",
  1: "#C0392B",
};

function avgColor(v: number): string {
  if (v >= 4.5) return "#15935E";
  if (v >= 4) return "#2563EB";
  if (v >= 3) return "#C2820E";
  return "#C0392B";
}

function fmtDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DashboardPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/satisfaction-survey", { cache: "no-store" });
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

  const responses = useMemo(() => data?.responses ?? [], [data]);

  const dimAvg = useMemo(() => {
    return DIMS.map((_, i) => {
      const vals = responses.map((r) => r.scores[i]).filter((x): x is number => x !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
  }, [responses]);

  const allScores = useMemo(
    () => responses.flatMap((r) => r.scores.filter((x): x is number => x !== null)),
    [responses]
  );

  const overallAvg = useMemo(
    () => (allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0),
    [allScores]
  );

  const dist = useMemo(() => {
    const d: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allScores.forEach((s) => {
      d[s]++;
    });
    return d;
  }, [allScores]);

  const satisfiedPct = useMemo(
    () => (allScores.length ? Math.round((allScores.filter((s) => s >= 4).length / allScores.length) * 100) : 0),
    [allScores]
  );

  const followUp = useMemo(
    () => responses.filter((r) => r.scores.some((s) => s !== null && s <= 3)),
    [responses]
  );

  const comments = useMemo(
    () =>
      responses
        .filter((r) => r.comment && r.comment !== "-" && r.comment !== "ไม่มี")
        .sort((a, b) => (a.overall ?? 5) - (b.overall ?? 5)),
    [responses]
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">⭐ ความพึงพอใจลูกค้า (หลังติดตั้ง)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            ดึงสดจาก Google Form
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
            <StatTile label="จำนวนแบบประเมิน" value={String(responses.length)} color="#2563EB" />
            <StatTile label="คะแนนเฉลี่ยรวม" value={`${overallAvg.toFixed(2)} / 5`} color={avgColor(overallAvg)} />
            <StatTile label="พึงพอใจ (4-5 ดาว)" value={`${satisfiedPct}%`} color="#15935E" />
            <StatTile label="ต้องติดตาม (มีคะแนน ≤3)" value={String(followUp.length)} color="#C0392B" />
          </div>

          {/* dimension averages */}
          <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
            <h2 className="text-sm font-semibold mb-3">คะแนนเฉลี่ยรายด้าน</h2>
            <div className="space-y-3">
              {DIMS.map((d, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">{d.label}</span>
                    <strong style={{ color: avgColor(dimAvg[i]) }}>{dimAvg[i].toFixed(2)}</strong>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(dimAvg[i] / 5) * 100}%`, background: avgColor(dimAvg[i]) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* distribution */}
          <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
            <h2 className="text-sm font-semibold mb-3">การกระจายคะแนน (ทุกด้านรวมกัน)</h2>
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map((s) => {
                const n = dist[s];
                const pct = allScores.length ? (n / allScores.length) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 text-slate-600">{s} ดาว</span>
                    <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                      <div className="h-full" style={{ width: `${pct}%`, background: SCORE_COLOR[s] }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-slate-500">
                      {n} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* follow-up list */}
          {followUp.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
              <h2 className="text-sm font-semibold mb-3 text-amber-800">
                🚩 รายการที่ควรติดตาม ({followUp.length})
              </h2>
              <div className="space-y-2">
                {followUp.map((r, i) => (
                  <div key={i} className="bg-white rounded-lg px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-slate-800">{r.customer || "-"}</span>
                      {r.bill && <span className="text-xs text-slate-400 font-mono">#{r.bill}</span>}
                      <span className="text-xs text-slate-400">{fmtDate(r.timestamp)}</span>
                      <span className="ml-auto flex gap-1">
                        {r.scores.map((s, j) =>
                          s === null ? null : (
                            <span
                              key={j}
                              title={DIMS[j].short}
                              className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white"
                              style={{ background: SCORE_COLOR[s] }}
                            >
                              {s}
                            </span>
                          )
                        )}
                      </span>
                    </div>
                    {r.comment && r.comment !== "-" && r.comment !== "ไม่มี" && (
                      <div className="text-xs text-slate-600 mt-1 whitespace-pre-line">💬 {r.comment}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* comments feed */}
          {comments.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
              <h2 className="text-sm font-semibold mb-3">💬 ข้อเสนอแนะจากลูกค้า ({comments.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {comments.map((r, i) => (
                  <div key={i} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-medium text-slate-800 text-sm">{r.customer || "-"}</span>
                      {r.overall !== null && (
                        <span
                          className="text-[11px] font-bold px-1.5 py-0.5 rounded text-white ml-auto"
                          style={{ background: avgColor(r.overall) }}
                        >
                          {r.overall.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{r.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* full table */}
          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">รายการทั้งหมด ({responses.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-slate-100">
                    <th className="py-2 pr-2 font-medium">วันที่</th>
                    <th className="py-2 pr-2 font-medium">เลขบิล</th>
                    <th className="py-2 pr-2 font-medium">ลูกค้า</th>
                    {DIMS.map((d, i) => (
                      <th key={i} className="py-2 px-1 font-medium text-center whitespace-nowrap">
                        {d.short}
                      </th>
                    ))}
                    <th className="py-2 pl-2 font-medium text-center">เฉลี่ย</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">{fmtDate(r.timestamp)}</td>
                      <td className="py-1.5 pr-2 text-slate-400 font-mono">{r.bill}</td>
                      <td className="py-1.5 pr-2 text-slate-700 max-w-[160px] truncate" title={r.customer}>
                        {r.customer}
                      </td>
                      {r.scores.map((s, j) => (
                        <td key={j} className="py-1.5 px-1 text-center">
                          {s === null ? (
                            <span className="text-slate-300">–</span>
                          ) : (
                            <span style={{ color: SCORE_COLOR[s], fontWeight: 700 }}>{s}</span>
                          )}
                        </td>
                      ))}
                      <td className="py-1.5 pl-2 text-center">
                        {r.overall !== null && (
                          <span style={{ color: avgColor(r.overall), fontWeight: 700 }}>{r.overall.toFixed(1)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {responses.length === 0 && !err && (
            <div className="text-slate-400 py-16 text-center text-sm">ไม่พบข้อมูลใน Sheet</div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

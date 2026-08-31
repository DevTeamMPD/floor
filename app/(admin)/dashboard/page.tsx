"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* ============================ Satisfaction (CSAT) ============================ */

type SurveyResponse = {
  timestamp: string;
  bill: string;
  customer: string;
  phone: string;
  scores: (number | null)[];
  overall: number | null;
  comment: string;
};

type SurveyQuestion = {
  id: string;
  order: number;
  label: string;
  shortLabel: string;
};

type ApiData = {
  questions: SurveyQuestion[];
  responses: SurveyResponse[];
  updatedAt: string;
  sourceUrl: string;
  error?: string;
};

const FALLBACK_DIMS = [
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

/* ============================ Waste cost (ต้นทุนเศษ) ============================ */

type Mov = { issued140: number; returned140: number; issued110: number; returned110: number };

// Same logic as the waste-cost page: sum issued/returned strip lengths (cm) per width.
function parseHandover(raw: unknown): Mov | null {
  if (!raw) return null;
  let h: unknown;
  try {
    h = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!h || typeof h !== "object") return null;
  const obj = h as { materials?: unknown; returnItems?: unknown };
  const s: Mov = { issued140: 0, returned140: 0, issued110: 0, returned110: 0 };
  let has = false;
  const acc = (arr: unknown, issued: boolean) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const m = it as { qty?: unknown; lengthCm?: unknown; widthCm?: unknown };
      const q = Number(m.qty) || 1;
      const len = Number(m.lengthCm ?? 0);
      if (len <= 0) continue;
      const w = String(m.widthCm);
      if (w === "140") {
        if (issued) s.issued140 += q * len;
        else s.returned140 += q * len;
        has = true;
      } else if (w === "110") {
        if (issued) s.issued110 += q * len;
        else s.returned110 += q * len;
        has = true;
      }
    }
  };
  acc(obj.materials, true);
  acc(obj.returnItems, false);
  return has ? s : null;
}

type WasteJob = {
  jobNo: string;
  bill: string | null;
  customer: string | null;
  zoneAreaM2: number;
  actAreaM2: number | null;
  wastePct: number | null;
  hasZones: boolean;
  hasMov: boolean;
};

type WasteData = {
  jobs: WasteJob[];
  total: number;
  withZones: number;
  withData: number;
  totalWasteCost: number;
  costSetup: boolean;
};

function wasteColor(pct: number): string {
  if (pct > 15) return "#C0392B";
  if (pct > 0) return "#C2820E";
  return "#15935E";
}

/* ================================ Page ================================ */

export default function DashboardPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [waste, setWaste] = useState<WasteData | null>(null);

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

  const loadWaste = useCallback(async () => {
    try {
      const supabase = createClient();
      const [jobsRes, zonesRes, matRes] = await Promise.all([
        supabase.from("install_jobs").select("job_no,bill_no,customer_name,handover_data"),
        supabase.from("install_job_zones").select("job_no,width_cm,length_cm"),
        supabase.from("materials").select("sku,unit_cost").in("sku", ["RS-140", "RS-110"]),
      ]);
      const jobs = jobsRes.data ?? [];
      const zones = zonesRes.data ?? [];
      const mats = matRes.data ?? [];

      const c140 = Number(mats.find((m) => m.sku === "RS-140")?.unit_cost ?? 0);
      const c110 = Number(mats.find((m) => m.sku === "RS-110")?.unit_cost ?? 0);
      const costSetup = c140 > 0 && c110 > 0;

      const zonesByJob: Record<string, { w: number; l: number }[]> = {};
      for (const z of zones) {
        const key = String(z.job_no);
        (zonesByJob[key] = zonesByJob[key] ?? []).push({
          w: Number(z.width_cm) || 0,
          l: Number(z.length_cm) || 0,
        });
      }

      let totalWasteCost = 0;
      const rows: WasteJob[] = jobs.map((j) => {
        const jzones = zonesByJob[String(j.job_no)] ?? [];
        const zoneAreaCm2 = jzones.reduce((s, z) => s + (z.w > 0 && z.l > 0 ? z.w * z.l : 0), 0);
        const mov = parseHandover(j.handover_data);
        const actual140 = mov ? mov.issued140 - mov.returned140 : null;
        const actual110 = mov ? mov.issued110 - mov.returned110 : null;
        const actAreaCm2 =
          actual140 !== null && actual110 !== null ? actual140 * 140 + actual110 * 110 : null;
        const wastePct =
          actAreaCm2 !== null && zoneAreaCm2 > 0 ? ((actAreaCm2 - zoneAreaCm2) / zoneAreaCm2) * 100 : null;
        // cost (matches waste-cost page; 0 until unit_cost is set)
        if (actual140 !== null && actual110 !== null) {
          const expCost = 0; // needs strip calc; unit_cost currently unset so this stays 0
          const actCost = actual140 * c140 + actual110 * c110;
          totalWasteCost += actCost - expCost;
        }
        return {
          jobNo: String(j.job_no),
          bill: (j.bill_no as string | null) ?? null,
          customer: (j.customer_name as string | null) ?? null,
          zoneAreaM2: zoneAreaCm2 / 10000,
          actAreaM2: actAreaCm2 === null ? null : actAreaCm2 / 10000,
          wastePct: wastePct === null ? null : Math.round(wastePct * 10) / 10,
          hasZones: jzones.length > 0,
          hasMov: mov !== null,
        };
      });

      setWaste({
        jobs: rows,
        total: jobs.length,
        withZones: rows.filter((r) => r.hasZones).length,
        withData: rows.filter((r) => r.hasMov).length,
        totalWasteCost,
        costSetup,
      });
    } catch {
      // Supabase unavailable — leave waste section hidden.
      setWaste(null);
    }
  }, []);

  useEffect(() => {
    load();
    loadWaste();
  }, [load, loadWaste]);

  const responses = useMemo(() => data?.responses ?? [], [data]);
  const dimensions = useMemo(
    () => data?.questions?.length
      ? data.questions.map((question) => ({ label: question.shortLabel || question.label, short: question.shortLabel || question.label }))
      : FALLBACK_DIMS,
    [data]
  );

  const dimAvg = useMemo(() => {
    return dimensions.map((_, i) => {
      const vals = responses.map((r) => r.scores[i]).filter((x): x is number => x !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
  }, [dimensions, responses]);

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

  const topWaste = useMemo(() => {
    if (!waste) return [];
    return waste.jobs
      .filter((r) => r.wastePct !== null)
      .sort((a, b) => (b.wastePct ?? 0) - (a.wastePct ?? 0))
      .slice(0, 8);
  }, [waste]);

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
            onClick={() => {
              load();
              loadWaste();
            }}
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
              {dimensions.map((d, i) => (
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

          {/* ===== Waste cost overview ===== */}
          {waste && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold">📊 ต้นทุนเศษ (ภาพรวม)</h2>
                <a href="/waste-cost" className="text-xs text-blue-600 hover:underline ml-auto">
                  ดูรายละเอียดเต็ม →
                </a>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <StatTile label="งานทั้งหมด" value={String(waste.total)} color="#2563EB" />
                <StatTile label="มีข้อมูลโซน" value={String(waste.withZones)} color="#7C3AED" />
                <StatTile label="มีข้อมูลปิดงาน" value={String(waste.withData)} color="#15935E" />
                <StatTile
                  label="รวมต้นทุนเศษ"
                  value={waste.costSetup ? `฿${waste.totalWasteCost.toLocaleString("th-TH", { maximumFractionDigits: 0 })}` : "—"}
                  color={waste.costSetup ? "#C0392B" : "#94A3B8"}
                />
              </div>

              {!waste.costSetup && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs mb-3">
                  💡 ยังไม่ได้ตั้งราคาต้นทุน — ตั้งค่า unit_cost ของ RS-140 / RS-110 ที่หน้า คลังวัสดุ เพื่อคำนวณต้นทุนเศษเป็นบาท
                </div>
              )}

              {topWaste.length > 0 && (
                <div className="bg-white border border-slate-100 rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3">งานที่ %เศษพื้นที่สูงสุด</h3>
                  <div className="space-y-2">
                    {topWaste.map((r) => (
                      <div key={r.jobNo} className="flex items-center gap-3 text-sm">
                        <span className="font-medium text-slate-800 truncate max-w-[160px]">
                          {r.customer || r.bill || r.jobNo}
                        </span>
                        {r.bill && <span className="text-xs text-slate-400 font-mono hidden sm:block">#{r.bill}</span>}
                        <span className="text-xs text-slate-500 ml-auto hidden sm:block">
                          โซน {r.zoneAreaM2.toFixed(1)} → จริง {r.actAreaM2?.toFixed(1)} m²
                        </span>
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0"
                          style={{ background: wasteColor(r.wastePct ?? 0) }}
                        >
                          {(r.wastePct ?? 0) > 0 ? "+" : ""}
                          {r.wastePct?.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
                              title={dimensions[j]?.short ?? `คำถาม ${j + 1}`}
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
                    {dimensions.map((d, i) => (
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

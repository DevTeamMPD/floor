"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Zone {
  id: string;
  job_no: string;
  zone_name: string;
  width_cm: number;
  length_cm: number;
}

interface Job {
  job_no: string;
  customer_name: string;
  product_name: string;
  stage: number;
}

interface StockSummary {
  issued_140: number;
  returned_140: number;
  issued_110: number;
  returned_110: number;
}

interface StripCalc {
  n140: number;
  n110: number;
  total140: number;
  total110: number;
  stripLen: number;
  coverDim: number;
}

// ─── Algorithm ───────────────────────────────────────────────────────────────
// Try both orientations; pick the one that uses less total material.
function calcStripsForZone(dimA: number, dimB: number): StripCalc {
  function singleOrient(stripLen: number, cover: number): StripCalc {
    const nPairs = Math.floor(cover / 250);
    const rem = cover % 250;
    let n140 = nPairs;
    let n110 = nPairs;
    if (rem > 0 && rem <= 110) {
      n110 += 1;
    } else if (rem > 110) {
      n140 += 1;
      n110 += 1;
    }
    return { n140, n110, total140: n140 * stripLen, total110: n110 * stripLen, stripLen, coverDim: cover };
  }
  const optA = singleOrient(dimA, dimB);
  const optB = singleOrient(dimB, dimA);
  return optA.total140 + optA.total110 <= optB.total140 + optB.total110 ? optA : optB;
}

function sumZones(zones: Zone[]) {
  return zones.reduce(
    (acc, z) => {
      if (z.width_cm <= 0 || z.length_cm <= 0) return acc;
      const c = calcStripsForZone(z.width_cm, z.length_cm);
      return { total140: acc.total140 + c.total140, total110: acc.total110 + c.total110 };
    },
    { total140: 0, total110: 0 }
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function WasteBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-slate-400">ยังไม่มีข้อมูลเบิก</span>;
  const abs = Math.abs(pct);
  const color =
    abs <= 5  ? "text-green-700 bg-green-50 border-green-200" :
    abs <= 15 ? "text-amber-700 bg-amber-50 border-amber-200" :
                "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function StatRow({ label, value, unit = "cm", bold = false }: { label: string; value: number | null; unit?: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1 ${bold ? "border-t border-slate-100 mt-1" : ""}`}>
      <span className={`text-xs ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>{label}</span>
      <span className={`text-xs font-mono ${bold ? "font-semibold" : ""}`}>
        {value === null ? "—" : `${value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${unit}`}
      </span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function WasteCostPage() {
  const supabase = createClient();
  const [jobs, setJobs]                     = useState<Job[]>([]);
  const [selectedJobNo, setSelectedJobNo]   = useState<string | null>(null);
  const [zones, setZones]                   = useState<Zone[]>([]);
  const [stockSummary, setStockSummary]     = useState<StockSummary | null>(null);
  const [mat140Id, setMat140Id]             = useState<string | null>(null);
  const [mat110Id, setMat110Id]             = useState<string | null>(null);
  const [search, setSearch]                 = useState("");
  const [loadingJobs, setLoadingJobs]       = useState(true);
  const [savingZone, setSavingZone]         = useState<string | null>(null);
  const [addingZone, setAddingZone]         = useState(false);

  // Load material IDs once
  useEffect(() => {
    supabase
      .from("materials")
      .select("id,sku")
      .in("sku", ["RS-140", "RS-110"])
      .then(({ data }) => {
        (data ?? []).forEach((m) => {
          if (m.sku === "RS-140") setMat140Id(m.id);
          if (m.sku === "RS-110") setMat110Id(m.id);
        });
      });
  }, []);

  // Load all jobs
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    const { data } = await supabase
      .from("install_jobs")
      .select("job_no, customer_name, product_name, stage")
      .order("created_at", { ascending: false });
    setJobs(data ?? []);
    setLoadingJobs(false);
  }, [supabase]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Load zones
  const fetchZones = useCallback(async (jobNo: string) => {
    const { data, error } = await supabase
      .from("install_job_zones")
      .select("*")
      .eq("job_no", jobNo)
      .order("created_at");
    if (error) toast.error("โหลด zone ไม่ได้: " + error.message);
    setZones(data ?? []);
  }, [supabase]);

  // Load stock
  const fetchStock = useCallback(async (jobNo: string, id140: string, id110: string) => {
    const { data } = await supabase
      .from("stock_movements")
      .select("type, qty, material_id")
      .eq("ref_job_no", jobNo)
      .in("material_id", [id140, id110]);

    const s: StockSummary = { issued_140: 0, returned_140: 0, issued_110: 0, returned_110: 0 };
    (data ?? []).forEach((row) => {
      const q = Number(row.qty);
      if (row.material_id === id140) {
        if (row.type === "เบิก") s.issued_140 += q;
        else if (row.type === "คืน") s.returned_140 += q;
      } else if (row.material_id === id110) {
        if (row.type === "เบิก") s.issued_110 += q;
        else if (row.type === "คืน") s.returned_110 += q;
      }
    });
    setStockSummary(s);
  }, [supabase]);

  // Reload when job selected
  useEffect(() => {
    if (!selectedJobNo) return;
    setStockSummary(null);
    fetchZones(selectedJobNo);
    if (mat140Id && mat110Id) fetchStock(selectedJobNo, mat140Id, mat110Id);
  }, [selectedJobNo, mat140Id, mat110Id, fetchZones, fetchStock]);

  // Reload stock when material IDs arrive (if job already selected)
  useEffect(() => {
    if (selectedJobNo && mat140Id && mat110Id) {
      fetchStock(selectedJobNo, mat140Id, mat110Id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mat140Id, mat110Id]);

  // Expected from zones
  const expected = useMemo(() => sumZones(zones), [zones]);

  // Waste calc
  const wasteCalc = useMemo(() => {
    if (!stockSummary || (stockSummary.issued_140 === 0 && stockSummary.issued_110 === 0)) return null;
    const actual140 = stockSummary.issued_140 - stockSummary.returned_140;
    const actual110 = stockSummary.issued_110 - stockSummary.returned_110;
    return {
      actual140,
      actual110,
      waste140: expected.total140 > 0 ? ((actual140 - expected.total140) / expected.total140) * 100 : null,
      waste110: expected.total110 > 0 ? ((actual110 - expected.total110) / expected.total110) * 100 : null,
    };
  }, [stockSummary, expected]);

  // ── Zone CRUD ─────────────────────────────────────────────────────────────
  const addZone = async () => {
    if (!selectedJobNo || addingZone) return;
    setAddingZone(true);
    const idx = zones.length + 1;
    const { data, error } = await supabase
      .from("install_job_zones")
      .insert({ job_no: selectedJobNo, zone_name: `โซน ${idx}`, width_cm: 0, length_cm: 0 })
      .select()
      .single();
    setAddingZone(false);
    if (error) {
      toast.error("เพิ่ม zone ไม่ได้: " + error.message);
      return;
    }
    if (data) setZones((prev) => [...prev, data]);
  };

  const patchZone = (id: string, field: keyof Zone, value: string | number) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, [field]: value } : z)));
  };

  const saveZone = async (zone: Zone) => {
    if (zone.width_cm < 0 || zone.length_cm < 0) return;
    setSavingZone(zone.id);
    const { error } = await supabase
      .from("install_job_zones")
      .update({ zone_name: zone.zone_name, width_cm: zone.width_cm, length_cm: zone.length_cm, updated_at: new Date().toISOString() })
      .eq("id", zone.id);
    setSavingZone(null);
    if (error) toast.error("บันทึกไม่ได้: " + error.message);
  };

  const deleteZone = async (id: string) => {
    const { error } = await supabase.from("install_job_zones").delete().eq("id", id);
    if (error) { toast.error("ลบไม่ได้: " + error.message); return; }
    setZones((prev) => prev.filter((z) => z.id !== id));
  };

  // ── Filter ────────────────────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(
      (j) =>
        j.job_no?.toLowerCase().includes(q) ||
        j.customer_name?.toLowerCase().includes(q) ||
        j.product_name?.toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const selectedJob = jobs.find((j) => j.job_no === selectedJobNo);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full gap-4 min-h-0">

      {/* ── Left: Job List ── */}
      <div className="w-64 flex-shrink-0 flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="p-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">เลือกงาน</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา…"
            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingJobs ? (
            <p className="text-xs text-slate-400 text-center py-8">⏳ กำลังโหลด…</p>
          ) : filteredJobs.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">ไม่พบงาน</p>
          ) : (
            filteredJobs.map((j) => (
              <button
                key={j.job_no}
                onClick={() => setSelectedJobNo(j.job_no)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition-colors ${
                  selectedJobNo === j.job_no
                    ? "bg-blue-50 border-l-2 border-l-blue-500"
                    : "hover:bg-slate-50"
                }`}
              >
                <p className="text-[10px] font-mono text-blue-600 mb-0.5">{j.job_no}</p>
                <p className="text-xs font-medium text-slate-800 truncate">{j.customer_name || "—"}</p>
                <p className="text-[11px] text-slate-400 truncate">{j.product_name || "—"}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Detail ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!selectedJobNo ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <span className="text-4xl">♻️</span>
            <p className="text-sm">เลือกงานจากรายการซ้ายมือเพื่อวิเคราะห์ต้นทุนเศษ</p>
          </div>
        ) : (
          <div className="space-y-4 pb-8">

            {/* Job header */}
            <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
              <p className="text-[11px] font-mono text-blue-500 mb-0.5">{selectedJob?.job_no}</p>
              <h1 className="text-lg font-semibold text-slate-800">{selectedJob?.customer_name || "—"}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{selectedJob?.product_name || "—"}</p>
            </div>

            {/* Zone editor */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700">📐 ขนาดพื้นที่แต่ละโซน</h2>
                <button
                  onClick={addZone}
                  disabled={addingZone}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {addingZone ? "กำลังเพิ่ม…" : "+ เพิ่มโซน"}
                </button>
              </div>

              {zones.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm">ยังไม่มีข้อมูล Zone</p>
                  <p className="text-xs mt-1">กด &ldquo;+ เพิ่มโซน&rdquo; แล้วกรอกขนาดพื้นที่</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-slate-400 uppercase tracking-wide border-b border-slate-100">
                        <th className="pb-2 text-left font-medium">ชื่อโซน</th>
                        <th className="pb-2 text-right font-medium">กว้างสุด</th>
                        <th className="pb-2 text-right font-medium">ยาวสุด</th>
                        <th className="pb-2 text-right font-medium">ควรใช้ 140cm</th>
                        <th className="pb-2 text-right font-medium">ควรใช้ 110cm</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {zones.map((z) => {
                        const calc =
                          z.width_cm > 0 && z.length_cm > 0
                            ? calcStripsForZone(z.width_cm, z.length_cm)
                            : null;
                        const saving = savingZone === z.id;
                        return (
                          <tr key={z.id}>
                            <td className="py-2 pr-2">
                              <input
                                value={z.zone_name}
                                onChange={(e) => patchZone(z.id, "zone_name", e.target.value)}
                                onBlur={() => saveZone(z)}
                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </td>
                            <td className="py-2 pr-2">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  value={z.width_cm || ""}
                                  onChange={(e) => patchZone(z.id, "width_cm", Number(e.target.value))}
                                  onBlur={() => saveZone(z)}
                                  placeholder="0"
                                  className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                                />
                                <span className="text-[10px] text-slate-400">cm</span>
                              </div>
                            </td>
                            <td className="py-2 pr-2">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  value={z.length_cm || ""}
                                  onChange={(e) => patchZone(z.id, "length_cm", Number(e.target.value))}
                                  onBlur={() => saveZone(z)}
                                  placeholder="0"
                                  className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                                />
                                <span className="text-[10px] text-slate-400">cm</span>
                              </div>
                            </td>
                            <td className="py-2 pr-2 text-right">
                              {calc ? (
                                <span className="text-xs font-mono text-slate-700">
                                  {calc.total140.toFixed(0)} cm
                                  <span className="text-slate-400 ml-1">×{calc.n140}</span>
                                </span>
                              ) : <span className="text-xs text-slate-300">—</span>}
                            </td>
                            <td className="py-2 pr-2 text-right">
                              {calc ? (
                                <span className="text-xs font-mono text-slate-700">
                                  {calc.total110.toFixed(0)} cm
                                  <span className="text-slate-400 ml-1">×{calc.n110}</span>
                                </span>
                              ) : <span className="text-xs text-slate-300">—</span>}
                            </td>
                            <td className="py-2 text-right">
                              {saving ? (
                                <span className="text-[10px] text-blue-400">💾</span>
                              ) : (
                                <button
                                  onClick={() => deleteZone(z.id)}
                                  className="text-slate-300 hover:text-red-500 text-xs transition-colors"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {zones.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-slate-200">
                          <td colSpan={3} className="pt-2 text-xs font-semibold text-slate-600">รวมทุกโซน</td>
                          <td className="pt-2 text-right text-xs font-semibold font-mono">
                            {expected.total140 > 0 ? `${expected.total140.toFixed(0)} cm` : "—"}
                          </td>
                          <td className="pt-2 text-right text-xs font-semibold font-mono">
                            {expected.total110 > 0 ? `${expected.total110.toFixed(0)} cm` : "—"}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* Waste analysis */}
            {(expected.total140 > 0 || expected.total110 > 0) && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">📊 วิเคราะห์ต้นทุนเศษ</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 140cm */}
                  <div className="border border-slate-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-500 mb-1.5">แผ่นกว้าง 140 cm</p>
                    <StatRow label="ควรใช้" value={expected.total140} />
                    <StatRow label="เบิกไป" value={stockSummary ? stockSummary.issued_140 : null} />
                    <StatRow label="คืนมา (เต็มแผ่น)" value={stockSummary ? stockSummary.returned_140 : null} />
                    <StatRow label="ใช้จริง" value={wasteCalc ? wasteCalc.actual140 : null} bold />
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-xs font-semibold text-slate-700">% เศษ</span>
                      <WasteBadge pct={wasteCalc?.waste140 ?? null} />
                    </div>
                  </div>

                  {/* 110cm */}
                  <div className="border border-slate-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-500 mb-1.5">แผ่นกว้าง 110 cm</p>
                    <StatRow label="ควรใช้" value={expected.total110} />
                    <StatRow label="เบิกไป" value={stockSummary ? stockSummary.issued_110 : null} />
                    <StatRow label="คืนมา (เต็มแผ่น)" value={stockSummary ? stockSummary.returned_110 : null} />
                    <StatRow label="ใช้จริง" value={wasteCalc ? wasteCalc.actual110 : null} bold />
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-xs font-semibold text-slate-700">% เศษ</span>
                      <WasteBadge pct={wasteCalc?.waste110 ?? null} />
                    </div>
                  </div>
                </div>

                {/* No stock yet */}
                {stockSummary && stockSummary.issued_140 === 0 && stockSummary.issued_110 === 0 && (
                  <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠️ ยังไม่มีการบันทึกรายการเบิกวัสดุสำหรับงานนี้ในระบบ Inventory<br />
                    <span className="text-amber-600">→ ไปที่ <strong>คลังวัสดุ</strong> แล้วเบิก RS-140 / RS-110 โดยอ้างถึงเลขงาน {selectedJobNo}</span>
                  </p>
                )}

                {/* Legend */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex gap-4 text-[10px] text-slate-400">
                  <span className="text-green-600 font-medium">■ ≤5%</span>
                  <span className="text-amber-600 font-medium">■ 5–15%</span>
                  <span className="text-red-600 font-medium">■ &gt;15%</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

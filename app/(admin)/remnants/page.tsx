"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify-error";

interface Remnant {
  id: string;
  width_bin: number;
  length_cm: number;
  mat_type: string;
  status: "available" | "reserved" | "used";
  reserved_for: string | null;
  source_job: string | null;
  note: string | null;
  unit_cost_per_sqm: number;
  used_for_job: string | null;
  disposal_reason: string | null;
  created_at: string;
}
interface PendingRemnantPiece { id: string; widthCm: number; lengthCm: number; qty: number; matType: string; note: string | null; photoPaths: string[] }
interface RemnantReport { id: string; jobNo: string; status: "pending_review" | "accepted" | "rejected"; noRemnant: boolean; notes: string | null; technicianName: string; submittedAt: string; reviewNote: string | null; pieces: PendingRemnantPiece[] }
interface CostRate { matType: string; costPerSqm: number }
interface CostSummary { availableValue: number; reservedValue: number; reusedValue: number; disposedValue: number }

const WIDTH_BINS = [30, 40, 50, 60, 70, 80, 90, 110, 140];
const MAT_TYPES = ["16B", "16W", "6B", "6W"];
const STATUS_STYLE: Record<string, string> = {
  available: "bg-green-100 text-green-700",
  reserved:  "bg-amber-100 text-amber-700",
  used:      "bg-slate-100 text-slate-400",
  disposed:  "bg-red-100 text-red-700",
};
const STATUS_TH: Record<string, string> = {
  available: "พร้อมใช้",
  reserved:  "จอง",
  used:      "ใช้แล้ว",
  disposed:  "ตัดจำหน่าย",
};

const EMPTY_FORM = { width_bin: "90", length_cm: "", mat_type: "16B", source_job: "", note: "" };

export default function RemnantsPage() {
  const supabase = createClient();
  const [items, setItems] = useState<Remnant[]>([]);
  const [loading, setLoading] = useState(true);
  const [binFilter, setBinFilter] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("available");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [reports, setReports] = useState<RemnantReport[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary>({ availableValue: 0, reservedValue: 0, reusedValue: 0, disposedValue: 0 });
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const fetch = useCallback(async () => {
    setLoading(true);
    const [stockResult, reportResult, costResult] = await Promise.all([
      supabase.from("remnant_stock").select("*").order("created_at", { ascending: false }),
      supabase.rpc("list_remnant_reports_staff"),
      supabase.rpc("get_remnant_cost_dashboard"),
    ]);
    if (stockResult.error) notifyError(stockResult.error.message); else setItems(stockResult.data ?? []);
    if (reportResult.error) notifyError(`โหลดคิวตรวจรับเศษไม่สำเร็จ: ${reportResult.error.message}`); else setReports((reportResult.data ?? []) as RemnantReport[]);
    if (costResult.error) notifyError(`โหลดต้นทุนเศษไม่สำเร็จ: ${costResult.error.message}`); else {
      const value = costResult.data as { rates?: CostRate[]; summary?: CostSummary };
      const rates = value?.rates ?? []; setRateDrafts(Object.fromEntries(rates.map((rate) => [rate.matType, String(rate.costPerSqm ?? 0)]))); setCostSummary(value?.summary ?? { availableValue: 0, reservedValue: 0, reusedValue: 0, disposedValue: 0 });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  // Per-bin counts (available only)
  const binCounts = useMemo(() => {
    const m: Record<number, number> = {};
    for (const r of items) {
      if (r.status === "available") m[r.width_bin] = (m[r.width_bin] ?? 0) + 1;
    }
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (binFilter !== null && r.width_bin !== binFilter) return false;
      if (typeFilter !== "all" && r.mat_type !== typeFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [items, binFilter, typeFilter, statusFilter]);

  const totals = useMemo(() => ({
    available: items.filter((r) => r.status === "available").length,
    reserved:  items.filter((r) => r.status === "reserved").length,
    used:      items.filter((r) => r.status === "used").length,
  }), [items]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.length_cm || Number(form.length_cm) <= 0) {
      notifyError("กรุณากรอกความยาว"); return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("create_manual_remnant_with_cost", {
      p_width_bin: Number(form.width_bin), p_length_cm: Number(form.length_cm), p_mat_type: form.mat_type,
      p_source_job: form.source_job.trim() || null, p_note: form.note.trim() || null,
    });
    if (error) notifyError(error);
    else {
      toast.success("บันทึกเศษแล้ว");
      setForm({ ...EMPTY_FORM });
      setShowAdd(false);
      fetch();
    }
    setSaving(false);
  }

  async function markUsed(id: string) {
    const jobNo = window.prompt("ระบุเลขงานที่นำเศษไปใช้ (เว้นว่างได้ หากยังไม่ทราบ)");
    if (jobNo === null) return;
    const { error } = await supabase.rpc("mark_remnant_used_with_cost", { p_remnant_id: id, p_job_no: jobNo.trim() || null });
    if (error) notifyError(error);
    else { toast.success("บันทึกการนำเศษกลับใช้และต้นทุนแล้ว"); fetch(); }
  }

  async function disposeRemnant(id: string) {
    const reason = window.prompt("ระบุเหตุผลการตัดจำหน่าย เช่น เสียหาย / เล็กเกินใช้");
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("dispose_remnant_with_cost", { p_remnant_id: id, p_reason: reason.trim() });
    if (error) notifyError(error); else { toast.success("ตัดจำหน่ายและบันทึกต้นทุนแล้ว"); fetch(); }
  }

  async function saveRate(matType: string) {
    const value = Number(rateDrafts[matType]);
    if (!Number.isFinite(value) || value < 0) { notifyError("กรุณาระบุต้นทุนต่อตารางเมตรเป็นศูนย์หรือจำนวนบวก"); return; }
    setSaving(true); const { error } = await supabase.rpc("set_remnant_cost_rate", { p_mat_type: matType, p_cost_per_sqm: value }); setSaving(false);
    if (error) notifyError(error); else { toast.success(`บันทึกต้นทุน ${matType} แล้ว`); fetch(); }
  }

  async function reviewReport(id: string, decision: "accept" | "reject") {
    let note: string | null = null;
    if (decision === "reject") {
      note = window.prompt("ระบุสิ่งที่ช่างต้องแก้ไข");
      if (!note?.trim()) return;
    } else if (!window.confirm("ยืนยันตรวจรับเศษรายการนี้เข้าสต็อกพร้อมใช้?")) return;
    setReviewingId(id);
    const { error } = await supabase.rpc("review_remnant_report_staff", { p_report_id: id, p_decision: decision, p_note: note });
    if (error) notifyError(error);
    else { toast.success(decision === "accept" ? "ตรวจรับและเพิ่มเศษเข้าสต็อกแล้ว" : "ส่งกลับให้ช่างแก้ไขแล้ว"); await fetch(); }
    setReviewingId(null);
  }

  const pendingReports = reports.filter((report) => report.status === "pending_review");

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">✂️ เศษวัสดุ</h1>
          <p className="text-sm text-slate-500 mt-0.5">สต็อกแผ่นเศษแยกตามหน้ากว้าง</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + รับเศษใหม่
        </button>
      </div>

      <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-semibold text-amber-950">คิวเศษรอคลังตรวจรับ</h2><p className="mt-0.5 text-xs text-amber-700">ตรวจขนาดและรูปก่อนเพิ่มเข้าสิ่งของพร้อมใช้</p></div>
          <span className="rounded-full bg-amber-600 px-3 py-1 text-xs font-bold text-white">{pendingReports.length} งาน</span>
        </div>
        {pendingReports.length ? <div className="mt-4 space-y-3">{pendingReports.map((report) => <article key={report.id} className="rounded-xl border border-amber-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">งาน {report.jobNo}</div><div className="mt-1 text-xs text-slate-500">ผู้ส่ง: {report.technicianName} · {new Date(report.submittedAt).toLocaleString("th-TH")}</div></div><span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">รอตรวจรับ</span></div>
          {report.noRemnant ? <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">ช่างยืนยันว่าไม่มีเศษเหลือ</div> : <div className="mt-3 grid gap-3 md:grid-cols-2">{report.pieces.map((piece,index)=><div key={piece.id} className="rounded-xl border border-slate-200 p-3"><div className="text-sm font-semibold text-slate-900">ชิ้นที่ {index+1} · {piece.matType} · RS-{piece.widthCm}</div><div className="mt-1 text-xs text-slate-600">ยาว {piece.lengthCm} ซม. · {piece.qty} ชิ้น{piece.note?` · ${piece.note}`:""}</div><div className="mt-2 grid grid-cols-4 gap-2">{piece.photoPaths.map((path,photoIndex)=>{const url=path.startsWith("http")?path:supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl;return <a key={path} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg border"><img src={url} alt={`เศษชิ้นที่ ${index+1} รูป ${photoIndex+1}`} className="h-full w-full object-cover" /></a>;})}</div></div>)}</div>}
          {report.notes?<div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">หมายเหตุ: {report.notes}</div>:null}
          <div className="mt-3 flex gap-2"><button disabled={reviewingId===report.id} onClick={()=>void reviewReport(report.id,"accept")} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">ตรวจรับเข้าสต็อก</button><button disabled={reviewingId===report.id} onClick={()=>void reviewReport(report.id,"reject")} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50">ส่งกลับแก้ไข</button></div>
        </article>)}</div>:<div className="mt-4 rounded-xl border border-dashed border-amber-200 bg-white/70 px-4 py-6 text-center text-sm text-amber-700">ไม่มีเศษรอตรวจรับ</div>}
      </section>

      <section className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-violet-950">💰 ควบคุมต้นทุนเศษ</h2><p className="mt-0.5 text-xs text-violet-700">มูลค่าคำนวณจากพื้นที่จริง × ต้นทุนต่อตารางเมตร ณ วันที่คลังตรวจรับ</p></div><div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4"><div><div className="text-[10px] text-violet-600">พร้อมใช้</div><div className="text-sm font-bold text-violet-950">฿{Number(costSummary.availableValue).toLocaleString(undefined,{maximumFractionDigits:2})}</div></div><div><div className="text-[10px] text-violet-600">จอง</div><div className="text-sm font-bold text-violet-950">฿{Number(costSummary.reservedValue).toLocaleString(undefined,{maximumFractionDigits:2})}</div></div><div><div className="text-[10px] text-violet-600">นำกลับใช้</div><div className="text-sm font-bold text-emerald-700">฿{Number(costSummary.reusedValue).toLocaleString(undefined,{maximumFractionDigits:2})}</div></div><div><div className="text-[10px] text-violet-600">ตัดจำหน่าย</div><div className="text-sm font-bold text-red-700">฿{Number(costSummary.disposedValue).toLocaleString(undefined,{maximumFractionDigits:2})}</div></div></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{MAT_TYPES.map((matType) => <label key={matType} className="rounded-xl border border-violet-200 bg-white p-3 text-xs font-medium text-slate-700">{matType}<span className="ml-1 text-slate-400">บาท/ตร.ม.</span><div className="mt-2 flex gap-2"><input type="number" min="0" step="0.01" value={rateDrafts[matType] ?? "0"} onChange={(event) => setRateDrafts((current) => ({ ...current, [matType]: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /><button type="button" disabled={saving} onClick={() => void saveRate(matType)} className="rounded-lg border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-700 disabled:opacity-50">บันทึก</button></div></label>)}</div>
      </section>

      {/* Summary chips */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-center">
          <div className="text-2xl font-bold text-green-700">{totals.available}</div>
          <div className="text-xs text-green-600">พร้อมใช้</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-center">
          <div className="text-2xl font-bold text-amber-700">{totals.reserved}</div>
          <div className="text-xs text-amber-600">จอง</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-center">
          <div className="text-2xl font-bold text-slate-500">{totals.used}</div>
          <div className="text-xs text-slate-400">ใช้แล้ว</div>
        </div>
      </div>

      {/* Width bin selector */}
      <div className="mb-4">
        <p className="text-xs text-slate-500 mb-2 font-medium">หน้ากว้าง (cm) — คลิกกรอง</p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setBinFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              binFilter === null
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
            }`}
          >
            ทั้งหมด
          </button>
          {WIDTH_BINS.map((w) => (
            <button
              key={w}
              onClick={() => setBinFilter(binFilter === w ? null : w)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                binFilter === w
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
              }`}
            >
              {w} cm
              {(binCounts[w] ?? 0) > 0 && (
                <span className="ml-1.5 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {binCounts[w]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Filters row */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">ทุกประเภท</option>
          {MAT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="available">พร้อมใช้</option>
          <option value="reserved">จอง</option>
          <option value="used">ใช้แล้ว</option>
          <option value="disposed">ตัดจำหน่าย</option>
          <option value="all">ทั้งหมด</option>
        </select>
        <button onClick={fetch} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">
          🔄 โหลดใหม่
        </button>
        <span className="self-center text-xs text-slate-400">{filtered.length} รายการ</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">⏳ กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-2">✂️</div>
          <div className="text-sm">ไม่พบเศษวัสดุในเงื่อนไขนี้</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600">กว้าง</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">ยาว (cm)</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">ประเภท</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">สถานะ</th>
                <th className="px-4 py-3 text-right font-medium text-slate-600">มูลค่า</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">จอง / งานต้นทาง</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">หมายเหตุ</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">วันที่</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className={`hover:bg-slate-50 ${
                  r.status === "used" ? "opacity-50" : ""
                }`}>
                  <td className="px-4 py-3 font-semibold">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold">
                      {r.width_bin} cm
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-800">{r.length_cm}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">{r.mat_type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                      {STATUS_TH[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-semibold text-violet-800">฿{((Number(r.width_bin) * Number(r.length_cm) / 10000) * Number(r.unit_cost_per_sqm ?? 0)).toLocaleString(undefined,{maximumFractionDigits:2})}<div className="mt-0.5 text-[10px] font-normal text-slate-400">฿{Number(r.unit_cost_per_sqm ?? 0).toLocaleString()}/ตร.ม.</div></td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {r.reserved_for && <div className="font-medium text-amber-700">🔒 {r.reserved_for}</div>}
                    {r.used_for_job && <div className="font-medium text-emerald-700">ใช้กับ: {r.used_for_job}</div>}
                    {r.source_job   && <div className="text-slate-400">จาก: {r.source_job}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">{r.note ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString("th-TH", { day:"2-digit", month:"short" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {r.status === "available" && (
                        <button
                          onClick={() => markUsed(r.id)}
                          className="px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 text-slate-600"
                        >
                          ✓ ใช้แล้ว
                        </button>
                      )}
                      {(r.status === "available" || r.status === "reserved") && <button onClick={() => void disposeRemnant(r.id)} className="px-2 py-1 rounded text-xs bg-red-50 hover:bg-red-100 text-red-500">ตัดจำหน่าย</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">รับเศษใหม่</h2>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">หน้ากว้าง (cm)</label>
                  <select
                    value={form.width_bin}
                    onChange={(e) => setForm((f) => ({ ...f, width_bin: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {WIDTH_BINS.map((w) => (
                      <option key={w} value={String(w)}>{w} cm</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">ใส่ช่องที่ ≤ ขนาดจริง</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">ความยาวจริง (cm) *</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={form.length_cm}
                    onChange={(e) => setForm((f) => ({ ...f, length_cm: e.target.value }))}
                    placeholder="เช่น 163"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">ประเภท</label>
                <div className="grid grid-cols-4 gap-2">
                  {MAT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, mat_type: t }))}
                      className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                        form.mat_type === t
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">16=หนา 16mm, 6=หนา 6mm | B=Beige, W=White</p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">งานต้นทาง (ถ้ามี)</label>
                <input
                  value={form.source_job}
                  onChange={(e) => setForm((f) => ({ ...f, source_job: e.target.value }))}
                  placeholder="เช่น INST-270084"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">หมายเหตุ</label>
                <input
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="เช่น มีรอยเล็กน้อยด้านหนึ่ง"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 disabled:opacity-50 mt-2"
              >
                {saving ? "กำลังบันทึก…" : "บันทึกเศษ"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

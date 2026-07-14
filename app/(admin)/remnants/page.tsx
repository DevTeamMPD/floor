"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Remnant {
  id: string;
  width_bin: number;
  length_cm: number;
  mat_type: string;
  status: "available" | "reserved" | "used";
  reserved_for: string | null;
  source_job: string | null;
  note: string | null;
  created_at: string;
}

const WIDTH_BINS = [30, 40, 50, 60, 70, 80, 90, 110, 140];
const MAT_TYPES = ["16B", "16W", "6B", "6W"];
const STATUS_STYLE: Record<string, string> = {
  available: "bg-green-100 text-green-700",
  reserved:  "bg-amber-100 text-amber-700",
  used:      "bg-slate-100 text-slate-400",
};
const STATUS_TH: Record<string, string> = {
  available: "พร้อมใช้",
  reserved:  "จอง",
  used:      "ใช้แล้ว",
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

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("remnant_stock")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems(data ?? []);
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
      toast.error("กรุณากรอกความยาว"); return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      width_bin: Number(form.width_bin),
      length_cm: Number(form.length_cm),
      mat_type:  form.mat_type,
    };
    if (form.source_job.trim()) payload.source_job = form.source_job.trim();
    if (form.note.trim())       payload.note = form.note.trim();

    const { error } = await supabase.from("remnant_stock").insert(payload);
    if (error) toast.error(error.message);
    else {
      toast.success("บันทึกเศษแล้ว");
      setForm({ ...EMPTY_FORM });
      setShowAdd(false);
      fetch();
    }
    setSaving(false);
  }

  async function markUsed(id: string) {
    const { error } = await supabase
      .from("remnant_stock")
      .update({ status: "used" })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("บันทึกว่าใช้แล้ว"); fetch(); }
  }

  async function deleteRemnant(id: string) {
    if (!confirm("ลบรายการนี้?")) return;
    const { error } = await supabase.from("remnant_stock").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("ลบแล้ว"); fetch(); }
  }

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
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {r.reserved_for && <div className="font-medium text-amber-700">🔒 {r.reserved_for}</div>}
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
                      {r.status !== "reserved" && (
                        <button
                          onClick={() => deleteRemnant(r.id)}
                          className="px-2 py-1 rounded text-xs bg-red-50 hover:bg-red-100 text-red-500"
                        >
                          ลบ
                        </button>
                      )}
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

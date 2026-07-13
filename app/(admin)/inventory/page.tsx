"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Material {
  id: string;
  sku: string;
  name: string;
  unit: string | null;
  unit_cost: number | null;
  qty_on_hand: number;
  reorder_point: number;
  updated_at: string;
}

interface StockMovement {
  id: string;
  material_id: string;
  type: string;
  qty: number;
  ref_job_no: string | null;
  ref_po_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

type ModalMode = 'add_material' | 'receive' | 'issue' | 'adjust' | 'history' | null;

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  in:      { label: '▲ รับเข้า',  color: 'text-emerald-600' },
  out:     { label: '▼ จ่ายออก', color: 'text-red-500' },
  reserve: { label: '⊖ จอง',     color: 'text-amber-500' },
  return:  { label: '↩ คืน',     color: 'text-blue-500' },
  adjust:  { label: '⟳ ปรับ',    color: 'text-purple-500' },
};

export default function InventoryPage() {
  const supabase = createClient();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterLow, setFilterLow] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedMat, setSelectedMat] = useState<Material | null>(null);
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const [form, setForm] = useState({
    sku: '', name: '', unit: '', unit_cost: '', qty_on_hand: '0', reorder_point: '0',
  });
  const [mvForm, setMvForm] = useState({ qty: '', note: '', ref_job_no: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('materials').select('*').order('name');
    setMaterials(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const displayed = materials.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch = !q || m.sku.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    const matchLow = !filterLow || m.qty_on_hand <= m.reorder_point;
    return matchSearch && matchLow;
  });
  const lowCount = materials.filter((m) => m.qty_on_hand <= m.reorder_point).length;

  function openAdd() {
    setForm({ sku: '', name: '', unit: '', unit_cost: '', qty_on_hand: '0', reorder_point: '0' });
    setModalMode('add_material');
  }

  function openMove(mat: Material, mode: 'receive' | 'issue' | 'adjust') {
    setSelectedMat(mat);
    setMvForm({ qty: '', note: '', ref_job_no: '' });
    setModalMode(mode);
  }

  async function openHistory(mat: Material) {
    setSelectedMat(mat);
    setModalMode('history');
    setHistLoading(true);
    const { data } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('material_id', mat.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setHistory(data ?? []);
    setHistLoading(false);
  }

  async function saveMaterial() {
    if (!form.sku.trim() || !form.name.trim()) {
      toast.error('กรุณากรอก SKU และชื่อวัสดุ');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('materials').insert({
      sku: form.sku.trim(),
      name: form.name.trim(),
      unit: form.unit.trim() || null,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      qty_on_hand: Number(form.qty_on_hand) || 0,
      reorder_point: Number(form.reorder_point) || 0,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('เพิ่มวัสดุเรียบร้อย');
    setModalMode(null);
    load();
  }

  async function saveMovement(type: 'in' | 'out' | 'adjust') {
    if (!selectedMat) return;
    const qty = Number(mvForm.qty);
    if (!qty || qty <= 0) { toast.error('กรุณาระบุจำนวน'); return; }
    setSaving(true);

    const { error: mvErr } = await supabase.from('stock_movements').insert({
      material_id: selectedMat.id,
      type,
      qty,
      ref_job_no: mvForm.ref_job_no.trim() || null,
      note: mvForm.note.trim() || null,
    });
    if (mvErr) { setSaving(false); toast.error(mvErr.message); return; }

    const delta = type === 'in' ? qty : type === 'out' ? -qty : 0;
    const newQty = type === 'adjust' ? qty : selectedMat.qty_on_hand + delta;
    await supabase.from('materials').update({ qty_on_hand: newQty }).eq('id', selectedMat.id);

    setSaving(false);
    toast.success(
      type === 'in' ? 'รับเข้าคลังเรียบร้อย' :
      type === 'out' ? 'จ่ายออกคลังเรียบร้อย' :
      'ปรับยอดสต็อกเรียบร้อย'
    );
    setModalMode(null);
    load();
  }

  function stockStatus(m: Material) {
    if (m.qty_on_hand <= 0) return { label: 'หมด', cls: 'bg-red-100 text-red-700' };
    if (m.qty_on_hand <= m.reorder_point) return { label: 'ต่ำ', cls: 'bg-amber-100 text-amber-700' };
    return { label: 'ปกติ', cls: 'bg-emerald-100 text-emerald-700' };
  }

  function refLabel(mv: StockMovement) {
    if (mv.ref_job_no) return mv.ref_job_no;
    if (mv.ref_po_id) return <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-mono text-[10px]">PO</span>;
    return <span className="text-slate-300">—</span>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">คลังวัสดุ</h1>
          <p className="text-slate-500 text-sm mt-0.5">Stock on-hand · รับเข้า/จ่ายออก/ปรับ</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {lowCount > 0 && (
            <button
              onClick={() => setFilterLow(!filterLow)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filterLow ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-300 text-amber-600 hover:bg-amber-50'
              }`}
            >
              ⚠️ วัสดุต่ำ {lowCount} รายการ
            </button>
          )}
          <button
            onClick={openAdd}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + เพิ่มวัสดุ
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา SKU หรือชื่อวัสดุ…"
          className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-slate-400 text-sm animate-pulse">กำลังโหลด…</div>
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-300">
          <div className="text-4xl mb-3">📦</div>
          <div className="font-medium">
            {search || filterLow ? 'ไม่พบวัสดุที่ค้นหา' : 'ยังไม่มีวัสดุ — กด + เพิ่มวัสดุ'}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['SKU', 'ชื่อวัสดุ', 'หน่วย', 'ราคาต่อหน่วย', 'คงเหลือ', 'จุดสั่งซื้อ', 'สถานะ', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map((m) => {
                const st = stockStatus(m);
                const isLow = m.qty_on_hand <= m.reorder_point;
                return (
                  <tr key={m.id} className={`hover:bg-slate-50/50 transition-colors ${isLow ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.sku}</td>
                    <td className="px-4 py-3 font-medium">{m.name}</td>
                    <td className="px-4 py-3 text-slate-500">{m.unit ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{m.unit_cost != null ? `฿${m.unit_cost.toLocaleString()}` : '—'}</td>
                    <td className={`px-4 py-3 font-semibold tabular-nums ${m.qty_on_hand <= 0 ? 'text-red-600' : m.qty_on_hand <= m.reorder_point ? 'text-amber-600' : 'text-slate-800'}`}>
                      {fmt(m.qty_on_hand)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 tabular-nums">{fmt(m.reorder_point)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openMove(m, 'receive')} title="รับเข้า" className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">▲ รับ</button>
                        <button onClick={() => openMove(m, 'issue')} title="จ่ายออก" className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">▼ จ่าย</button>
                        <button onClick={() => openMove(m, 'adjust')} title="ปรับยอด" className="px-2 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100">⟳</button>
                        <button onClick={() => openHistory(m)} title="ประวัติ" className="px-2 py-1 text-xs bg-slate-50 text-slate-500 rounded hover:bg-slate-100">📋</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== MODALS ===== */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModalMode(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>

            {/* ADD MATERIAL */}
            {modalMode === 'add_material' && (
              <div className="p-6">
                <h2 className="text-lg font-semibold mb-4">เพิ่มวัสดุใหม่</h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">SKU *</label>
                      <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">หน่วย</label>
                      <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">—</option>
                        <option value="sqm">sqm (ตร.ม.)</option>
                        <option value="pcs">pcs (ชิ้น)</option>
                        <option value="kg">kg (กก.)</option>
                        <option value="roll">roll (ม้วน)</option>
                        <option value="box">box (กล่อง)</option>
                        <option value="set">set (ชุด)</option>
                        <option value="cm">cm</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อวัสดุ *</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">ราคาต่อหน่วย (฿)</label>
                      <input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">คงเหลือเริ่มต้น</label>
                      <input type="number" step="0.001" value={form.qty_on_hand} onChange={(e) => setForm({ ...form, qty_on_hand: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">จุดสั่งซื้อ</label>
                      <input type="number" step="0.001" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={() => setModalMode(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                  <button onClick={saveMaterial} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                    {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                  </button>
                </div>
              </div>
            )}

            {/* RECEIVE / ISSUE / ADJUST */}
            {(modalMode === 'receive' || modalMode === 'issue' || modalMode === 'adjust') && selectedMat && (
              <div className="p-6">
                <h2 className="text-lg font-semibold mb-1">
                  {modalMode === 'receive' ? '▲ รับเข้าคลัง' : modalMode === 'issue' ? '▼ จ่ายออกคลัง' : '⟳ ปรับยอดสต็อก'}
                </h2>
                <p className="text-sm text-slate-500 mb-4">
                  {selectedMat.name} · คงเหลือ: <strong>{fmt(selectedMat.qty_on_hand)}</strong> {selectedMat.unit ?? ''}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">
                      {modalMode === 'adjust' ? 'ยอดที่ถูกต้อง (แทนที่ของเดิม)' : 'จำนวน'} {selectedMat.unit ? `(${selectedMat.unit})` : ''} *
                    </label>
                    <input type="number" step="0.001" value={mvForm.qty} onChange={(e) => setMvForm({ ...mvForm, qty: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0" />
                  </div>
                  {modalMode === 'issue' && (
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">อ้างอิง Job No.</label>
                      <input value={mvForm.ref_job_no} onChange={(e) => setMvForm({ ...mvForm, ref_job_no: e.target.value })}
                        placeholder="เช่น JB-2025-001" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                    <input value={mvForm.note} onChange={(e) => setMvForm({ ...mvForm, note: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={() => setModalMode(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                  <button
                    onClick={() => saveMovement(modalMode === 'receive' ? 'in' : modalMode === 'issue' ? 'out' : 'adjust')}
                    disabled={saving}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  >
                    {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                  </button>
                </div>
              </div>
            )}

            {/* HISTORY */}
            {modalMode === 'history' && selectedMat && (
              <div className="p-6">
                <h2 className="text-lg font-semibold mb-1">📋 ประวัติความเคลื่อนไหว</h2>
                <p className="text-sm text-slate-500 mb-4">{selectedMat.name}</p>
                {histLoading ? (
                  <div className="text-sm text-slate-400 animate-pulse py-4">กำลังโหลด…</div>
                ) : history.length === 0 ? (
                  <div className="text-sm text-slate-400 py-4 text-center">ยังไม่มีความเคลื่อนไหว</div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-100">
                          {['วันที่', 'ประเภท', 'จำนวน', 'อ้างอิง', 'หมายเหตุ'].map((h) => (
                            <th key={h} className="text-left py-2 px-2 font-medium text-slate-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {history.map((mv) => {
                          const t = TYPE_LABEL[mv.type] ?? { label: mv.type, color: 'text-slate-500' };
                          return (
                            <tr key={mv.id}>
                              <td className="py-2 px-2 text-slate-400">{new Date(mv.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                              <td className={`py-2 px-2 font-medium ${t.color}`}>{t.label}</td>
                              <td className="py-2 px-2 font-mono tabular-nums">{fmt(mv.qty)}</td>
                              <td className="py-2 px-2">{refLabel(mv)}</td>
                              <td className="py-2 px-2 text-slate-500">{mv.note ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-end mt-4">
                  <button onClick={() => setModalMode(null)} className="px-4 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">ปิด</button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

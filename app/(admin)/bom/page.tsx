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
}

interface BomItem {
  id?: string;
  material_id: string;
  qty_type: 'fixed' | 'per_sqm' | 'per_unit';
  qty: number;
  waste_factor: number;
  unit: string;
  sort_order: number;
  note: string;
  // joined
  material?: Material;
}

interface Bom {
  id: string;
  product_sku: string;
  name: string | null;
  version: number;
  bom_type: 'area' | 'quantity' | 'mixed';
  is_active: boolean;
  notes: string | null;
  bom_items?: BomItem[];
}

type Tab = 'manager' | 'simulator';
type SimMode = 'area' | 'quantity';

const QTY_TYPE_LABEL: Record<string, string> = {
  per_sqm:  'ต่อ ตร.ม.',
  per_unit: 'ต่อชิ้น',
  fixed:    'คงที่',
};

export default function BomPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('manager');
  const [boms, setBoms] = useState<Bom[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBom, setSelectedBom] = useState<Bom | null>(null);
  const [showAddBom, setShowAddBom] = useState(false);
  const [saving, setSaving] = useState(false);

  // BOM form
  const [bomForm, setBomForm] = useState({ product_sku: '', name: '', bom_type: 'area' as 'area' | 'quantity' | 'mixed', notes: '' });

  // BOM items draft (when editing)
  const [draftItems, setDraftItems] = useState<BomItem[]>([]);
  const [editingItems, setEditingItems] = useState(false);

  // Simulator
  const [simBomId, setSimBomId] = useState('');
  const [simMode, setSimMode] = useState<SimMode>('area');
  const [simValue, setSimValue] = useState('');
  const [simResult, setSimResult] = useState<Array<{ material: Material; needed: number; stock: number; short: number; cost: number }>>([]);
  const [simRan, setSimRan] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: bomData }, { data: matData }] = await Promise.all([
      supabase.from('boms').select('*, bom_items(*, material:materials(*))').eq('is_active', true).order('product_sku'),
      supabase.from('materials').select('*').order('name'),
    ]);
    setBoms(bomData ?? []);
    setMaterials(matData ?? []);
    if (bomData && bomData.length > 0 && !simBomId) setSimBomId(bomData[0].id);
    setLoading(false);
  }, [supabase, simBomId]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- Add BOM ---
  async function saveBom() {
    if (!bomForm.product_sku.trim()) { toast.error('กรุณาระบุ SKU สินค้า'); return; }
    setSaving(true);
    const { error } = await supabase.from('boms').insert({
      product_sku: bomForm.product_sku.trim(),
      name: bomForm.name.trim() || null,
      bom_type: bomForm.bom_type,
      notes: bomForm.notes.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('สร้าง BOM เรียบร้อย');
    setShowAddBom(false);
    setBomForm({ product_sku: '', name: '', bom_type: 'area', notes: '' });
    loadData();
  }

  // --- Edit items ---
  function startEditItems(bom: Bom) {
    setSelectedBom(bom);
    setDraftItems(bom.bom_items?.map((i) => ({ ...i, material_id: i.material_id ?? '', note: i.note ?? '' })) ?? []);
    setEditingItems(true);
  }

  function addDraftItem() {
    setDraftItems((prev) => [
      ...prev,
      { material_id: materials[0]?.id ?? '', qty_type: 'per_sqm', qty: 1, waste_factor: 0.1, unit: '', sort_order: prev.length, note: '' },
    ]);
  }

  function updateDraftItem(i: number, patch: Partial<BomItem>) {
    setDraftItems((prev) => prev.map((item, idx) => idx === i ? { ...item, ...patch } : item));
  }

  function removeDraftItem(i: number) {
    setDraftItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveItems() {
    if (!selectedBom) return;
    setSaving(true);
    // Delete all existing items, then reinsert
    await supabase.from('bom_items').delete().eq('bom_id', selectedBom.id);
    if (draftItems.length > 0) {
      const { error } = await supabase.from('bom_items').insert(
        draftItems.map((item, idx) => ({
          bom_id: selectedBom.id,
          material_id: item.material_id || null,
          qty_type: item.qty_type,
          qty: item.qty,
          waste_factor: item.waste_factor,
          unit: item.unit || null,
          sort_order: idx,
          note: item.note || null,
        }))
      );
      if (error) { setSaving(false); toast.error(error.message); return; }
    }
    setSaving(false);
    toast.success('บันทึก BOM items เรียบร้อย');
    setEditingItems(false);
    loadData();
  }

  // --- Simulator ---
  function runSimulator() {
    const bom = boms.find((b) => b.id === simBomId);
    if (!bom || !simValue) return;
    const inputVal = Number(simValue);
    const results = (bom.bom_items ?? []).map((item) => {
      const mat = materials.find((m) => m.id === item.material_id);
      if (!mat) return null;
      let base = 0;
      if (item.qty_type === 'per_sqm') base = item.qty * inputVal;
      else if (item.qty_type === 'per_unit') base = item.qty * inputVal;
      else base = item.qty; // fixed
      const needed = base * (1 + item.waste_factor);
      const stock = mat.qty_on_hand;
      const short = Math.max(0, needed - stock);
      const cost = needed * (mat.unit_cost ?? 0);
      return { material: mat, needed, stock, short, cost };
    }).filter(Boolean) as typeof simResult;
    setSimResult(results);
    setSimRan(true);
  }

  const simBom = boms.find((b) => b.id === simBomId);
  const totalCost = simResult.reduce((s, r) => s + r.cost, 0);
  const hasShortage = simResult.some((r) => r.short > 0);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">BOQ / BOM</h1>
          <p className="text-slate-500 text-sm mt-0.5">Bill of Materials · ประมาณวัสดุตามพื้นที่</p>
        </div>
        <div className="ml-auto flex rounded-lg overflow-hidden border border-slate-200">
          {(['manager', 'simulator'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm transition-colors ${
                tab === t ? 'bg-blue-600 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}>
              {t === 'manager' ? '📐 จัดการ BOM' : '🧮 จำลอง'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm animate-pulse">โหลดข้อมูล…</div>
      ) : tab === 'manager' ? (
        /* ===== MANAGER TAB ===== */
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowAddBom(true)} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              + สร้าง BOM ใหม่
            </button>
          </div>

          {boms.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-300">
              <div className="text-4xl mb-3">📐</div>
              <div className="font-medium">ยังไม่มี BOM — กด + สร้าง BOM ใหม่</div>
            </div>
          ) : (
            <div className="space-y-4">
              {boms.map((bom) => (
                <div key={bom.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-50">
                    <div>
                      <div className="font-semibold">{bom.name ?? bom.product_sku}</div>
                      <div className="text-xs text-slate-400">{bom.product_sku} · {bom.bom_type === 'area' ? 'คำนวณตามพื้นที่' : bom.bom_type === 'quantity' ? 'คำนวณตามจำนวน' : 'ผสม'} · v{bom.version}</div>
                    </div>
                    <div className="ml-auto">
                      <button onClick={() => startEditItems(bom)}
                        className="px-3 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-medium">
                        ✏️ แก้ไข Items
                      </button>
                    </div>
                  </div>
                  {(bom.bom_items?.length ?? 0) === 0 ? (
                    <div className="px-5 py-4 text-sm text-slate-400">ยังไม่มี items — กดแก้ไขเพื่อเพิ่มวัสดุ</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {['วัสดุ', 'ประเภท', 'ปริมาณ', 'Waste', 'หมายเหตุ'].map((h) => (
                            <th key={h} className="text-left px-4 py-2 text-xs font-medium text-slate-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {bom.bom_items?.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-2">{item.material?.name ?? '—'} <span className="text-xs text-slate-400">{item.material?.sku}</span></td>
                            <td className="px-4 py-2 text-slate-500 text-xs">{QTY_TYPE_LABEL[item.qty_type] ?? item.qty_type}</td>
                            <td className="px-4 py-2 font-mono tabular-nums">{item.qty} {item.unit || item.material?.unit || ''}</td>
                            <td className="px-4 py-2 text-slate-400 text-xs">{(item.waste_factor * 100).toFixed(0)}%</td>
                            <td className="px-4 py-2 text-slate-400 text-xs">{item.note || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ===== SIMULATOR TAB ===== */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <h2 className="font-semibold mb-4">ตั้งค่าการจำลอง</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">เลือก BOM</label>
                <select value={simBomId} onChange={(e) => { setSimBomId(e.target.value); setSimRan(false); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {boms.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.product_sku}</option>)}
                </select>
              </div>
              {simBom && (
                <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
                  {simBom.product_sku} · {simBom.bom_type === 'area' ? '📐 คำนวณตามพื้นที่ (ตร.ม.)' : '📦 คำนวณตามจำนวน'}
                  {(simBom.bom_items?.length ?? 0) > 0 && <> · {simBom.bom_items?.length} รายการวัสดุ</>}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">
                  {simBom?.bom_type === 'area' ? 'พื้นที่ (ตร.ม.)' : 'จำนวน (ชิ้น)'}
                </label>
                <input type="number" step="0.01" value={simValue} onChange={(e) => { setSimValue(e.target.value); setSimRan(false); }}
                  placeholder={simBom?.bom_type === 'area' ? 'เช่น 25.5' : 'เช่น 10'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={runSimulator} disabled={!simBomId || !simValue}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                🧮 คำนวณ
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <h2 className="font-semibold mb-4">ผลการจำลอง</h2>
            {!simRan ? (
              <div className="text-center text-slate-300 py-12">
                <div className="text-3xl mb-2">🧮</div>
                <div className="text-sm">กรอกข้อมูลและกดคำนวณ</div>
              </div>
            ) : simResult.length === 0 ? (
              <div className="text-sm text-slate-400">BOM นี้ยังไม่มีวัสดุ</div>
            ) : (
              <div>
                {hasShortage && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">
                    ⚠️ วัสดุบางรายการไม่เพียงพอ — ต้องสั่งซื้อเพิ่ม
                  </div>
                )}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['วัสดุ', 'ต้องการ', 'คงเหลือ', 'ขาด', 'ต้นทุน'].map((h) => (
                        <th key={h} className="text-left py-2 px-1 font-medium text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {simResult.map((r) => (
                      <tr key={r.material.id} className={r.short > 0 ? 'bg-red-50/50' : ''}>
                        <td className="py-2 px-1">{r.material.name}</td>
                        <td className="py-2 px-1 font-mono tabular-nums">{r.needed.toFixed(3).replace(/\.?0+$/, '')} {r.material.unit ?? ''}</td>
                        <td className={`py-2 px-1 font-mono tabular-nums ${r.stock < r.needed ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {r.stock.toFixed(3).replace(/\.?0+$/, '')}
                        </td>
                        <td className={`py-2 px-1 font-mono tabular-nums ${r.short > 0 ? 'text-red-600 font-semibold' : 'text-slate-300'}`}>
                          {r.short > 0 ? r.short.toFixed(3).replace(/\.?0+$/, '') : '—'}
                        </td>
                        <td className="py-2 px-1 text-slate-500">฿{r.cost.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200">
                      <td colSpan={4} className="py-2 px-1 font-medium text-slate-600">ต้นทุนรวม</td>
                      <td className="py-2 px-1 font-semibold">฿{totalCost.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== ADD BOM MODAL ===== */}
      {showAddBom && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddBom(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">สร้าง BOM ใหม่</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">SKU สินค้า *</label>
                  <input value={bomForm.product_sku} onChange={(e) => setBomForm({ ...bomForm, product_sku: e.target.value })}
                    placeholder="เช่น SPC-OAK-120" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อ BOM</label>
                  <input value={bomForm.name} onChange={(e) => setBomForm({ ...bomForm, name: e.target.value })}
                    placeholder="เช่น พื้นไม้ SPC Oak ติดตั้งมาตรฐาน" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ประเภทการคำนวณ</label>
                  <select value={bomForm.bom_type} onChange={(e) => setBomForm({ ...bomForm, bom_type: e.target.value as 'area' | 'quantity' | 'mixed' })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="area">📐 ตามพื้นที่ (ตร.ม.)</option>
                    <option value="quantity">📦 ตามจำนวนชิ้น</option>
                    <option value="mixed">🔀 ผสม</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                  <textarea value={bomForm.notes} onChange={(e) => setBomForm({ ...bomForm, notes: e.target.value })}
                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowAddBom(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                <button onClick={saveBom} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                  {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== EDIT ITEMS MODAL ===== */}
      {editingItems && selectedBom && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditingItems(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-semibold">✏️ แก้ไข BOM Items — {selectedBom.name ?? selectedBom.product_sku}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{selectedBom.product_sku}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {draftItems.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-6">ยังไม่มีรายการ — กดเพิ่มวัสดุ</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['วัสดุ', 'ประเภท', 'ปริมาณ', 'Waste %', 'หมายเหตุ', ''].map((h) => (
                        <th key={h} className="text-left py-2 px-2 text-xs font-medium text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {draftItems.map((item, i) => (
                      <tr key={i}>
                        <td className="py-2 px-1">
                          <select value={item.material_id} onChange={(e) => updateDraftItem(i, { material_id: e.target.value })}
                            className="w-40 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                        <td className="py-2 px-1">
                          <select value={item.qty_type} onChange={(e) => updateDraftItem(i, { qty_type: e.target.value as BomItem['qty_type'] })}
                            className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="per_sqm">ต่อ ตร.ม.</option>
                            <option value="per_unit">ต่อชิ้น</option>
                            <option value="fixed">คงที่</option>
                          </select>
                        </td>
                        <td className="py-2 px-1">
                          <input type="number" step="0.0001" value={item.qty}
                            onChange={(e) => updateDraftItem(i, { qty: Number(e.target.value) })}
                            className="w-20 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </td>
                        <td className="py-2 px-1">
                          <input type="number" step="1" min="0" max="100"
                            value={Math.round(item.waste_factor * 100)}
                            onChange={(e) => updateDraftItem(i, { waste_factor: Number(e.target.value) / 100 })}
                            className="w-14 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </td>
                        <td className="py-2 px-1">
                          <input value={item.note} onChange={(e) => updateDraftItem(i, { note: e.target.value })}
                            className="w-28 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </td>
                        <td className="py-2 px-1">
                          <button onClick={() => removeDraftItem(i)} className="text-red-400 hover:text-red-600">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button onClick={addDraftItem} disabled={materials.length === 0}
                className="mt-3 px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                + เพิ่มวัสดุ
              </button>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-100">
              <button onClick={() => setEditingItems(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
              <button onClick={saveItems} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

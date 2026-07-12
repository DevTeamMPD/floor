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

interface ChildBom {
  id: string;
  product_sku: string;
  name: string | null;
  version: number;
}

interface BomItem {
  id?: string;
  itemType: 'material' | 'sub';
  material_id: string;
  child_bom_id: string;
  qty_type: 'fixed' | 'per_sqm' | 'per_unit';
  qty: number;
  waste_factor: number;
  unit: string;
  sort_order: number;
  note: string;
  // joined
  material?: Material;
  child_bom?: ChildBom;
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

const QTY_TYPE_LABEL: Record<string, string> = {
  per_sqm:  'ต่อ ตร.ม.',
  per_unit: 'ต่อชิ้น',
  fixed:    'คงที่',
};

interface ExplodedRow {
  material: Material;
  needed: number;
  stock: number;
  short: number;
  cost: number;
  depth: number;
  sourceLabel: string;
}

export default function BomPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('manager');
  const [boms, setBoms] = useState<Bom[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBom, setSelectedBom] = useState<Bom | null>(null);
  const [showAddBom, setShowAddBom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // BOM form
  const [bomForm, setBomForm] = useState({ product_sku: '', name: '', bom_type: 'area' as 'area' | 'quantity' | 'mixed', notes: '' });

  // BOM items draft (when editing)
  const [draftItems, setDraftItems] = useState<BomItem[]>([]);
  const [editingItems, setEditingItems] = useState(false);

  // Simulator
  const [simBomId, setSimBomId] = useState('');
  const [simValue, setSimValue] = useState('');
  const [simResult, setSimResult] = useState<ExplodedRow[]>([]);
  const [simRan, setSimRan] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: bomData }, { data: matData }] = await Promise.all([
      supabase
        .from('boms')
        .select('*, bom_items(*, material:materials(*), child_bom:boms!bom_items_child_bom_id_fkey(id,product_sku,name,version))')
        .order('product_sku')
        .order('version'),
      supabase.from('materials').select('*').order('name'),
    ]);
    const allBoms = (bomData ?? []) as Bom[];
    setBoms(allBoms);
    setMaterials(matData ?? []);
    const activeBoms = allBoms.filter((b) => b.is_active);
    if (activeBoms.length > 0 && !simBomId) setSimBomId(activeBoms[0].id);
    setLoading(false);
  }, [supabase, simBomId]);

  useEffect(() => { loadData(); }, [loadData]);

  const displayBoms = showInactive ? boms : boms.filter((b) => b.is_active);

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

  // --- Create New Version ---
  async function createNewVersion(bom: Bom) {
    setSaving(true);
    // Find max version for this product_sku
    const maxVer = Math.max(...boms.filter((b) => b.product_sku === bom.product_sku).map((b) => b.version));
    // Deactivate all old versions of this SKU
    await supabase.from('boms').update({ is_active: false }).eq('product_sku', bom.product_sku);
    // Insert new version
    const { data: newBom, error } = await supabase.from('boms').insert({
      product_sku: bom.product_sku,
      name: bom.name,
      bom_type: bom.bom_type,
      notes: bom.notes,
      version: maxVer + 1,
      is_active: true,
    }).select().single();
    if (error || !newBom) { setSaving(false); toast.error(error?.message ?? 'เกิดข้อผิดพลาด'); return; }
    // Copy items from old version
    const items = bom.bom_items ?? [];
    if (items.length > 0) {
      await supabase.from('bom_items').insert(
        items.map((item, idx) => ({
          bom_id: newBom.id,
          material_id: item.material_id || null,
          child_bom_id: item.child_bom_id || null,
          qty_type: item.qty_type,
          qty: item.qty,
          waste_factor: item.waste_factor,
          unit: item.unit || null,
          sort_order: idx,
          note: item.note || null,
        }))
      );
    }
    setSaving(false);
    toast.success(`สร้าง v${maxVer + 1} เรียบร้อย`);
    loadData();
  }

  // --- Toggle Active ---
  async function toggleBomActive(bom: Bom) {
    const { error } = await supabase.from('boms').update({ is_active: !bom.is_active }).eq('id', bom.id);
    if (error) { toast.error(error.message); return; }
    toast.success(bom.is_active ? 'ปิดใช้งาน BOM แล้ว' : 'เปิดใช้งาน BOM แล้ว');
    loadData();
  }

  // --- Edit items ---
  function startEditItems(bom: Bom) {
    setSelectedBom(bom);
    setDraftItems(
      bom.bom_items?.map((i) => ({
        ...i,
        itemType: i.child_bom_id ? 'sub' : 'material',
        material_id: i.material_id ?? '',
        child_bom_id: i.child_bom_id ?? '',
        note: i.note ?? '',
      })) ?? []
    );
    setEditingItems(true);
  }

  function addDraftItem(type: 'material' | 'sub') {
    setDraftItems((prev) => [
      ...prev,
      {
        itemType: type,
        material_id: type === 'material' ? (materials[0]?.id ?? '') : '',
        child_bom_id: type === 'sub' ? (boms.find((b) => b.is_active && b.id !== selectedBom?.id)?.id ?? '') : '',
        qty_type: 'per_sqm',
        qty: 1,
        waste_factor: 0.1,
        unit: '',
        sort_order: prev.length,
        note: '',
      },
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
    await supabase.from('bom_items').delete().eq('bom_id', selectedBom.id);
    if (draftItems.length > 0) {
      const { error } = await supabase.from('bom_items').insert(
        draftItems.map((item, idx) => ({
          bom_id: selectedBom.id,
          material_id: item.itemType === 'material' ? (item.material_id || null) : null,
          child_bom_id: item.itemType === 'sub' ? (item.child_bom_id || null) : null,
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

  // --- Recursive Explode BOM ---
  function explodeBom(bomId: string, multiplier: number, depth: number, sourceLabel: string, rows: Map<string, ExplodedRow>) {
    if (depth > 5) return;
    const bom = boms.find((b) => b.id === bomId);
    if (!bom) return;
    const inputVal = Number(simValue) || 1;
    for (const item of bom.bom_items ?? []) {
      if (item.itemType === 'sub' && item.child_bom_id) {
        // sub-assembly: compute sub quantity, recurse
        let subQty = 0;
        if (item.qty_type === 'fixed') subQty = item.qty * multiplier;
        else if (item.qty_type === 'per_sqm') subQty = item.qty * inputVal * multiplier;
        else subQty = item.qty * inputVal * multiplier;
        const subWithWaste = subQty * (1 + item.waste_factor);
        explodeBom(item.child_bom_id, subWithWaste, depth + 1, item.child_bom?.name ?? item.child_bom?.product_sku ?? 'Sub', rows);
      } else if (item.itemType === 'material' && item.material_id) {
        const mat = materials.find((m) => m.id === item.material_id);
        if (!mat) continue;
        let base = 0;
        if (item.qty_type === 'per_sqm') base = item.qty * inputVal * multiplier;
        else if (item.qty_type === 'per_unit') base = item.qty * inputVal * multiplier;
        else base = item.qty * multiplier;
        const needed = base * (1 + item.waste_factor);
        const existing = rows.get(mat.id);
        if (existing) {
          existing.needed += needed;
          existing.short = Math.max(0, existing.needed - existing.stock);
          existing.cost = existing.needed * (mat.unit_cost ?? 0);
        } else {
          const stock = mat.qty_on_hand;
          rows.set(mat.id, {
            material: mat,
            needed,
            stock,
            short: Math.max(0, needed - stock),
            cost: needed * (mat.unit_cost ?? 0),
            depth,
            sourceLabel,
          });
        }
      }
    }
  }

  function runSimulator() {
    if (!simBomId || !simValue) return;
    const rows = new Map<string, ExplodedRow>();
    explodeBom(simBomId, 1, 0, 'root', rows);
    setSimResult(Array.from(rows.values()));
    setSimRan(true);
  }

  const activeBoms = boms.filter((b) => b.is_active);
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
          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded" />
              แสดง BOM ที่ปิดใช้งาน
            </label>
            <button onClick={() => setShowAddBom(true)} className="ml-auto px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              + สร้าง BOM ใหม่
            </button>
          </div>

          {displayBoms.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-300">
              <div className="text-4xl mb-3">📐</div>
              <div className="font-medium">ยังไม่มี BOM — กด + สร้าง BOM ใหม่</div>
            </div>
          ) : (
            <div className="space-y-4">
              {displayBoms.map((bom) => (
                <div key={bom.id} className={`bg-white rounded-xl border overflow-hidden ${
                  bom.is_active ? 'border-slate-100' : 'border-slate-200 opacity-60'
                }`}>
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-50">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {bom.name ?? bom.product_sku}
                        {!bom.is_active && <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded">ปิดใช้งาน</span>}
                      </div>
                      <div className="text-xs text-slate-400">
                        {bom.product_sku} · {bom.bom_type === 'area' ? 'คำนวณตามพื้นที่' : bom.bom_type === 'quantity' ? 'คำนวณตามจำนวน' : 'ผสม'} · v{bom.version}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <button onClick={() => createNewVersion(bom)} disabled={saving}
                        className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 font-medium">
                        🔀 New Version
                      </button>
                      <button onClick={() => toggleBomActive(bom)}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
                          bom.is_active
                            ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            : 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100'
                        }`}>
                        {bom.is_active ? '⏸ ปิดใช้' : '▶ เปิดใช้'}
                      </button>
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
                          {['ประเภท', 'วัสดุ / Sub-assembly', 'ประเภทปริมาณ', 'ปริมาณ', 'Waste', 'หมายเหตุ'].map((h) => (
                            <th key={h} className="text-left px-4 py-2 text-xs font-medium text-slate-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {bom.bom_items?.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                item.child_bom_id ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-600'
                              }`}>
                                {item.child_bom_id ? '🔗 Sub' : '🧱 Mat'}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              {item.child_bom_id
                                ? <span className="font-medium">{item.child_bom?.name ?? item.child_bom?.product_sku ?? '—'} <span className="text-xs text-slate-400">v{item.child_bom?.version}</span></span>
                                : <span>{item.material?.name ?? '—'} <span className="text-xs text-slate-400">{item.material?.sku}</span></span>
                              }
                            </td>
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
                <label className="text-xs font-medium text-slate-500 mb-1 block">เลือก BOM (เฉพาะ Active)</label>
                <select value={simBomId} onChange={(e) => { setSimBomId(e.target.value); setSimRan(false); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {activeBoms.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.product_sku} (v{b.version})</option>)}
                </select>
              </div>
              {simBom && (
                <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
                  {simBom.product_sku} · {simBom.bom_type === 'area' ? '📐 คำนวณตามพื้นที่ (ตร.ม.)' : '📦 คำนวณตามจำนวน'}
                  {(simBom.bom_items?.length ?? 0) > 0 && <> · {simBom.bom_items?.length} รายการ</>}
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
                🧮 คำนวณ (รวม Sub-assembly)
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-semibold">✏️ แก้ไข BOM Items — {selectedBom.name ?? selectedBom.product_sku} v{selectedBom.version}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{selectedBom.product_sku}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {draftItems.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-6">ยังไม่มีรายการ — กดเพิ่มวัสดุหรือ Sub-assembly</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['ประเภท', 'วัสดุ / Sub', 'ปริมาณ type', 'ปริมาณ', 'Waste %', 'หมายเหตุ', ''].map((h) => (
                        <th key={h} className="text-left py-2 px-2 text-xs font-medium text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {draftItems.map((item, i) => (
                      <tr key={i}>
                        <td className="py-2 px-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            item.itemType === 'sub' ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-600'
                          }`}>
                            {item.itemType === 'sub' ? '🔗 Sub' : '🧱 Mat'}
                          </span>
                        </td>
                        <td className="py-2 px-1">
                          {item.itemType === 'material' ? (
                            <select value={item.material_id} onChange={(e) => updateDraftItem(i, { material_id: e.target.value })}
                              className="w-40 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          ) : (
                            <select value={item.child_bom_id} onChange={(e) => updateDraftItem(i, { child_bom_id: e.target.value })}
                              className="w-40 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500">
                              {boms.filter((b) => b.id !== selectedBom?.id && b.is_active).map((b) => (
                                <option key={b.id} value={b.id}>{b.name ?? b.product_sku} v{b.version}</option>
                              ))}
                            </select>
                          )}
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
              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => addDraftItem('material')} disabled={materials.length === 0}
                  className="px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                  + เพิ่มวัสดุ
                </button>
                <button onClick={() => addDraftItem('sub')}
                  disabled={boms.filter((b) => b.id !== selectedBom?.id && b.is_active).length === 0}
                  className="px-3 py-1.5 text-sm text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50">
                  + เพิ่ม Sub-assembly
                </button>
              </div>
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

"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  payment_terms: string | null;
  lead_time_days: number | null;
}

interface Material {
  id: string;
  sku: string;
  name: string;
  unit: string | null;
  unit_cost: number | null;
}

interface PoItem {
  id?: string;
  material_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_price: number;
  note: string;
  material?: Material;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  status: string;
  eta: string | null;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  supplier?: Supplier;
  po_items?: PoItem[];
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft', cls: 'bg-slate-100 text-slate-600' },
  ordered:   { label: 'สั่งแล้ว', cls: 'bg-blue-100 text-blue-700' },
  partial:   { label: 'รับบางส่วน', cls: 'bg-amber-100 text-amber-700' },
  received:  { label: 'รับครบ', cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-red-100 text-red-600' },
};

export default function PurchaseOrdersPage() {
  const supabase = createClient();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [saving, setSaving] = useState(false);

  // PO form
  const [poForm, setPoForm] = useState({ supplier_id: '', eta: '', notes: '' });
  const [poItems, setPoItems] = useState<PoItem[]>([]);

  // Supplier form
  const [supForm, setSupForm] = useState({ name: '', contact_name: '', phone: '', lead_time_days: '', payment_terms: '' });

  // Receive modal
  const [showReceive, setShowReceive] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: poData }, { data: supData }, { data: matData }] = await Promise.all([
      supabase.from('purchase_orders').select('*, supplier:suppliers(*), po_items(*, material:materials(*))').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('materials').select('*').order('name'),
    ]);
    setPos(poData ?? []);
    setSuppliers(supData ?? []);
    setMaterials(matData ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // auto-generate PO number
  function genPoNumber() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 900) + 100);
    return `PO${yy}${mm}${dd}-${rand}`;
  }

  function openCreate() {
    setPoForm({ supplier_id: suppliers[0]?.id ?? '', eta: '', notes: '' });
    setPoItems([{ material_id: materials[0]?.id ?? '', qty_ordered: 1, qty_received: 0, unit_price: materials[0]?.unit_cost ?? 0, note: '' }]);
    setShowCreate(true);
  }

  function addPoItem() {
    setPoItems((prev) => [...prev, { material_id: materials[0]?.id ?? '', qty_ordered: 1, qty_received: 0, unit_price: materials[0]?.unit_cost ?? 0, note: '' }]);
  }

  function updatePoItem(i: number, patch: Partial<PoItem>) {
    setPoItems((prev) => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, ...patch };
      // Auto-fill price when material changes
      if (patch.material_id) {
        const mat = materials.find((m) => m.id === patch.material_id);
        if (mat?.unit_cost) updated.unit_price = mat.unit_cost;
      }
      return updated;
    }));
  }

  async function savePo() {
    if (poItems.length === 0) { toast.error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return; }
    setSaving(true);
    const total = poItems.reduce((s, it) => s + it.qty_ordered * it.unit_price, 0);
    const { data: poData, error: poErr } = await supabase.from('purchase_orders').insert({
      po_number: genPoNumber(),
      supplier_id: poForm.supplier_id || null,
      status: 'draft',
      eta: poForm.eta || null,
      total_amount: total,
      notes: poForm.notes || null,
    }).select().single();
    if (poErr || !poData) { setSaving(false); toast.error(poErr?.message ?? 'Error'); return; }

    const { error: itemErr } = await supabase.from('po_items').insert(
      poItems.map((it) => ({ po_id: poData.id, material_id: it.material_id, qty_ordered: it.qty_ordered, qty_received: 0, unit_price: it.unit_price, note: it.note || null }))
    );
    setSaving(false);
    if (itemErr) { toast.error(itemErr.message); return; }
    toast.success(`สร้าง ${poData.po_number} เรียบร้อย`);
    setShowCreate(false);
    load();
  }

  async function saveSupplier() {
    if (!supForm.name.trim()) { toast.error('กรุณาระบุชื่อ Supplier'); return; }
    setSaving(true);
    const { error } = await supabase.from('suppliers').insert({
      name: supForm.name.trim(),
      contact_name: supForm.contact_name.trim() || null,
      phone: supForm.phone.trim() || null,
      lead_time_days: supForm.lead_time_days ? Number(supForm.lead_time_days) : null,
      payment_terms: supForm.payment_terms.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('เพิ่ม Supplier เรียบร้อย');
    setShowAddSupplier(false);
    setSupForm({ name: '', contact_name: '', phone: '', lead_time_days: '', payment_terms: '' });
    load();
  }

  function openReceive(po: PurchaseOrder) {
    setSelectedPo(po);
    const init: Record<string, number> = {};
    po.po_items?.forEach((it) => { if (it.id) init[it.id] = 0; });
    setReceiveQtys(init);
    setShowReceive(true);
  }

  async function saveReceive() {
    if (!selectedPo) return;
    setSaving(true);
    for (const item of selectedPo.po_items ?? []) {
      if (!item.id) continue;
      const received = receiveQtys[item.id] ?? 0;
      if (received <= 0) continue;
      const newReceived = item.qty_received + received;
      await supabase.from('po_items').update({ qty_received: newReceived }).eq('id', item.id);
      // Update material stock
      const { data: mat } = await supabase.from('materials').select('qty_on_hand').eq('id', item.material_id).single();
      if (mat) {
        await supabase.from('materials').update({ qty_on_hand: mat.qty_on_hand + received }).eq('id', item.material_id);
        await supabase.from('stock_movements').insert({ material_id: item.material_id, type: 'in', qty: received, ref_po_id: selectedPo.id, note: `รับจาก ${selectedPo.po_number}` });
      }
    }
    // Update PO status
    const { data: freshItems } = await supabase.from('po_items').select('qty_ordered,qty_received').eq('po_id', selectedPo.id);
    const allReceived = freshItems?.every((it) => it.qty_received >= it.qty_ordered);
    const anyReceived = freshItems?.some((it) => it.qty_received > 0);
    const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : 'ordered';
    await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', selectedPo.id);
    setSaving(false);
    toast.success('บันทึกการรับสินค้าเรียบร้อย');
    setShowReceive(false);
    load();
  }

  async function updatePoStatus(poId: string, status: string) {
    await supabase.from('purchase_orders').update({ status }).eq('id', poId);
    toast.success('อัปเดตสถานะเรียบร้อย');
    load();
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">ใบสั่งซื้อ (PO)</h1>
          <p className="text-slate-500 text-sm mt-0.5">Purchase Orders · สั่งซื้อวัสดุจาก Supplier</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setSupForm({ name: '', contact_name: '', phone: '', lead_time_days: '', payment_terms: '' }); setShowAddSupplier(true); }}
            className="px-4 py-1.5 text-sm border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50">
            + Supplier
          </button>
          <button onClick={openCreate} disabled={materials.length === 0}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            + สร้าง PO
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm animate-pulse">โหลดข้อมูล…</div>
      ) : pos.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-300">
          <div className="text-4xl mb-3">🛒</div>
          <div className="font-medium">ยังไม่มีใบสั่งซื้อ</div>
        </div>
      ) : (
        <div className="space-y-4">
          {pos.map((po) => {
            const st = STATUS_LABEL[po.status] ?? { label: po.status, cls: 'bg-slate-100 text-slate-500' };
            return (
              <div key={po.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4">
                  <div>
                    <div className="font-semibold font-mono">{po.po_number}</div>
                    <div className="text-xs text-slate-400">
                      {po.supplier?.name ?? 'ไม่ระบุ Supplier'}
                      {po.eta && <> · ETA: {po.eta}</>}
                      {' · '}{new Date(po.created_at).toLocaleDateString('th-TH')}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
                  {po.total_amount != null && (
                    <div className="text-sm font-semibold text-slate-700">฿{po.total_amount.toLocaleString()}</div>
                  )}
                  <div className="ml-auto flex gap-2">
                    {po.status === 'draft' && (
                      <button onClick={() => updatePoStatus(po.id, 'ordered')}
                        className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100">สั่งแล้ว</button>
                    )}
                    {(po.status === 'ordered' || po.status === 'partial') && (
                      <button onClick={() => openReceive(po)}
                        className="px-3 py-1 text-xs bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">▲ รับสินค้า</button>
                    )}
                    {po.status !== 'cancelled' && po.status !== 'received' && (
                      <button onClick={() => updatePoStatus(po.id, 'cancelled')}
                        className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100">ยกเลิก</button>
                    )}
                  </div>
                </div>
                {(po.po_items?.length ?? 0) > 0 && (
                  <table className="w-full text-sm border-t border-slate-50">
                    <thead className="bg-slate-50">
                      <tr>
                        {['วัสดุ', 'สั่ง', 'รับแล้ว', 'ราคา/หน่วย', 'รวม'].map((h) => (
                          <th key={h} className="text-left px-4 py-2 text-xs font-medium text-slate-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {po.po_items?.map((it) => (
                        <tr key={it.id}>
                          <td className="px-4 py-2">{it.material?.name ?? '—'} <span className="text-xs text-slate-400">{it.material?.sku}</span></td>
                          <td className="px-4 py-2 tabular-nums">{it.qty_ordered} {it.material?.unit ?? ''}</td>
                          <td className={`px-4 py-2 tabular-nums ${it.qty_received >= it.qty_ordered ? 'text-emerald-600 font-medium' : 'text-amber-600'}`}>
                            {it.qty_received} / {it.qty_ordered}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-slate-500">฿{it.unit_price.toLocaleString()}</td>
                          <td className="px-4 py-2 tabular-nums font-medium">฿{(it.qty_ordered * it.unit_price).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== CREATE PO MODAL ===== */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-semibold">สร้างใบสั่งซื้อ</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Supplier</label>
                  <select value={poForm.supplier_id} onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— ไม่ระบุ —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ETA</label>
                  <input type="date" value={poForm.eta} onChange={(e) => setPoForm({ ...poForm, eta: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                <input value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-500">รายการวัสดุ</label>
                  <button onClick={addPoItem} className="text-xs text-blue-600 hover:underline">+ เพิ่ม</button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['วัสดุ', 'จำนวน', 'ราคา/หน่วย', ''].map((h) => (
                        <th key={h} className="text-left py-1 px-1 text-xs font-medium text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {poItems.map((item, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-1">
                          <select value={item.material_id} onChange={(e) => updatePoItem(i, { material_id: e.target.value })}
                            className="w-36 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none">
                            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 px-1">
                          <input type="number" step="0.001" value={item.qty_ordered}
                            onChange={(e) => updatePoItem(i, { qty_ordered: Number(e.target.value) })}
                            className="w-16 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="py-1.5 px-1">
                          <input type="number" step="0.01" value={item.unit_price}
                            onChange={(e) => updatePoItem(i, { unit_price: Number(e.target.value) })}
                            className="w-20 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="py-1.5 px-1">
                          <button onClick={() => setPoItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-right text-sm font-semibold text-slate-700 mt-2">
                  รวม: ฿{poItems.reduce((s, it) => s + it.qty_ordered * it.unit_price, 0).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-100">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
              <button onClick={savePo} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'กำลังบันทึก…' : 'สร้าง PO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD SUPPLIER MODAL ===== */}
      {showAddSupplier && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddSupplier(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">เพิ่ม Supplier</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อบริษัท *</label>
                  <input value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อผู้ติดต่อ</label>
                    <input value={supForm.contact_name} onChange={(e) => setSupForm({ ...supForm, contact_name: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">เบอร์โทร</label>
                    <input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Lead Time (วัน)</label>
                    <input type="number" value={supForm.lead_time_days} onChange={(e) => setSupForm({ ...supForm, lead_time_days: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">เงื่อนไขชำระ</label>
                    <input value={supForm.payment_terms} onChange={(e) => setSupForm({ ...supForm, payment_terms: e.target.value })}
                      placeholder="เช่น NET30" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowAddSupplier(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                <button onClick={saveSupplier} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                  {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== RECEIVE MODAL ===== */}
      {showReceive && selectedPo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowReceive(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-1">▲ รับสินค้าเข้าคลัง</h2>
              <p className="text-sm text-slate-400 mb-4">{selectedPo.po_number}</p>
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['วัสดุ', 'สั่ง', 'รับแล้ว', 'รับเพิ่ม'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 text-xs font-medium text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {selectedPo.po_items?.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 px-2">{item.material?.name ?? '—'}</td>
                      <td className="py-2 px-2 tabular-nums text-slate-500">{item.qty_ordered}</td>
                      <td className="py-2 px-2 tabular-nums text-slate-500">{item.qty_received}</td>
                      <td className="py-2 px-2">
                        <input type="number" step="0.001" min="0"
                          max={item.qty_ordered - item.qty_received}
                          value={receiveQtys[item.id ?? ''] ?? 0}
                          onChange={(e) => setReceiveQtys({ ...receiveQtys, [item.id ?? '']: Number(e.target.value) })}
                          className="w-20 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowReceive(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                <button onClick={saveReceive} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                  {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

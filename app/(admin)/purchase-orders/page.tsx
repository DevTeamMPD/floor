"use client";
export const dynamic = "force-dynamic";

/**
 * P5-8 / P5-9 — ใบสั่งซื้อและการตรวจรับของ
 *
 * หน้าเดิมเขียนตาราง purchase_orders / po_items / materials / stock_movements ตรงจาก client
 * ทีละคำสั่ง ไม่มีธุรกรรม ไม่มีด่านสิทธิ์ และไม่มีที่บันทึกว่า "ตรวจแล้วผ่านหรือไม่ผ่าน"
 * ตอนนี้ทุกการเขียนไปที่ RPC ตัวเดียวที่จบในธุรกรรมเดียว และตารางเหล่านั้นถอนสิทธิ์เขียน
 * ของ client ออกไปแล้ว — หน้าจอจึงเขียนตรงไม่ได้อีกแม้จะเผลอเขียนโค้ดแบบนั้น
 *
 * สิ่งที่หน้าจอนี้ต้องซื่อสัตย์:
 *   - ผู้ขายที่เลือกได้มีเฉพาะรายที่อนุมัติแล้วและไม่ถูกระงับ ถ้าไม่มีเลยต้องบอกว่าเพราะอะไร
 *   - ก่อนกดยืนยันการตรวจรับ ต้องบอกล่วงหน้าว่ากดแล้วจะเกิดใบ NC หรือไม่
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import {
  PO_SNAPSHOT_RPC, PO_FORM_OPTIONS_RPC, CREATE_PO_RPC, ISSUE_PO_RPC, CANCEL_PO_RPC, RECORD_RECEIPT_RPC,
  PO_STATUS_LABELS, RECEIPT_RESULT_LABELS, RECEIPT_NCR_TYPES, NCR_SEVERITIES,
  EMPTY_PO_FORM_OPTIONS, parsePurchaseOrders, parsePoFormOptions, poDraftError, poDraftTotal,
  remainingQty, receiptDraftCheck, receiptOutcomeMessage, poFormEmptyMessage,
  type PurchaseOrder, type PoDraft, type ReceiptDraft,
} from "@/lib/purchase-order";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  ordered: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
};

const RESULT_STYLE: Record<string, string> = {
  pass: "bg-emerald-50 text-emerald-700",
  partial_fail: "bg-amber-50 text-amber-800",
  fail: "bg-red-50 text-red-700",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_DRAFT: PoDraft = {
  supplierId: "", requiredDate: "", acceptanceRequirements: "", eta: "", jobNo: "", notes: "", items: [],
};

export default function PurchaseOrdersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [options, setOptions] = useState(EMPTY_PO_FORM_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<PoDraft>(EMPTY_DRAFT);

  const [receiveFor, setReceiveFor] = useState<PurchaseOrder | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft>({});
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptSamplePct, setReceiptSamplePct] = useState("");
  const [receiptJobNo, setReceiptJobNo] = useState("");
  const [defectSummary, setDefectSummary] = useState("");
  const [ncrType, setNcrType] = useState<string>("quality");
  const [ncrSeverity, setNcrSeverity] = useState<string>("medium");

  const load = useCallback(async () => {
    setLoading(true);
    const [snapshot, opts] = await Promise.all([
      supabase.rpc(PO_SNAPSHOT_RPC),
      supabase.rpc(PO_FORM_OPTIONS_RPC),
    ]);
    if (snapshot.error) toast.error(floorErrorMessage(snapshot.error));
    setPos(parsePurchaseOrders(snapshot.data));
    setOptions(parsePoFormOptions(opts.data));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const formBlocked = poFormEmptyMessage(options);

  function openCreate() {
    setDraft({
      ...EMPTY_DRAFT,
      supplierId: options.providers[0]?.id ?? "",
      items: options.materials[0]
        ? [{ materialId: options.materials[0].id, qty: "1",
             unitPrice: options.materials[0].unitCost?.toString() ?? "", acceptanceSpec: "", note: "" }]
        : [],
    });
    setShowCreate(true);
  }

  function addItem() {
    const material = options.materials[0];
    if (!material) return;
    setDraft((prev) => ({ ...prev, items: [...prev.items,
      { materialId: material.id, qty: "1", unitPrice: material.unitCost?.toString() ?? "", acceptanceSpec: "", note: "" }] }));
  }

  function patchItem(index: number, patch: Partial<PoDraft["items"][number]>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (patch.materialId) {
          const material = options.materials.find((m) => m.id === patch.materialId);
          if (material?.unitCost != null) next.unitPrice = material.unitCost.toString();
        }
        return next;
      }),
    }));
  }

  async function savePo() {
    const error = poDraftError(draft, todayISO());
    if (error) { toast.error(error); return; }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc(CREATE_PO_RPC, {
      p_supplier_id: draft.supplierId,
      p_required_date: draft.requiredDate,
      p_acceptance_requirements: draft.acceptanceRequirements.trim(),
      p_items: draft.items.map((item) => ({
        materialId: item.materialId,
        qty: Number(item.qty),
        unitPrice: item.unitPrice.trim() === "" ? null : Number(item.unitPrice),
        acceptanceSpec: item.acceptanceSpec || null,
        note: item.note || null,
      })),
      p_eta: draft.eta || null,
      p_notes: draft.notes || null,
      p_job_no: draft.jobNo || null,
    });
    setSaving(false);
    if (rpcError) { toast.error(floorErrorMessage(rpcError)); return; }
    const result = data as { poNumber?: string } | null;
    toast.success(`สร้างใบสั่งซื้อ ${result?.poNumber ?? ""} เป็นร่างแล้ว — กด "ส่งให้ผู้ขาย" เมื่อพร้อม`);
    setShowCreate(false);
    await load();
  }

  async function issuePo(po: PurchaseOrder) {
    setSaving(true);
    const { error } = await supabase.rpc(ISSUE_PO_RPC, { p_po_id: po.id });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(`ส่งใบ ${po.poNumber} ให้ผู้ขายแล้ว`);
    await load();
  }

  async function cancelPo(po: PurchaseOrder) {
    const reason = window.prompt(`ยกเลิกใบ ${po.poNumber} เพราะอะไร (บังคับกรอก)`) ?? "";
    if (!reason.trim()) { toast.error("การยกเลิกใบสั่งซื้อต้องระบุเหตุผล"); return; }
    setSaving(true);
    const { error } = await supabase.rpc(CANCEL_PO_RPC, { p_po_id: po.id, p_reason: reason.trim() });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(`ยกเลิกใบ ${po.poNumber} แล้ว`);
    await load();
  }

  function openReceive(po: PurchaseOrder) {
    setReceiveFor(po);
    setReceiptDraft(Object.fromEntries(po.items.map((item) => [item.id, { accepted: "", rejected: "", defectNote: "" }])));
    setReceiptNote("");
    setReceiptSamplePct(po.inspectionSamplePct?.toString() ?? "");
    setReceiptJobNo("");
    setDefectSummary("");
    setNcrType("quality");
    setNcrSeverity("medium");
  }

  const receiptCheck = receiveFor ? receiptDraftCheck(receiveFor, receiptDraft, receiptJobNo) : null;

  async function saveReceipt() {
    if (!receiveFor || !receiptCheck) return;
    if (receiptCheck.error) { toast.error(receiptCheck.error); return; }
    setSaving(true);
    const lines = receiveFor.items
      .map((item) => {
        const line = receiptDraft[item.id];
        if (!line) return null;
        const accepted = line.accepted.trim() === "" ? 0 : Number(line.accepted);
        const rejected = line.rejected.trim() === "" ? 0 : Number(line.rejected);
        if (accepted + rejected === 0) return null;
        return { poItemId: item.id, qtyAccepted: accepted, qtyRejected: rejected, defectNote: line.defectNote || null };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    const { data, error } = await supabase.rpc(RECORD_RECEIPT_RPC, {
      p_po_id: receiveFor.id,
      p_lines: lines,
      p_note: receiptNote || null,
      p_sample_pct: receiptSamplePct.trim() === "" ? null : Number(receiptSamplePct),
      p_ncr_job_no: receiptJobNo || null,
      p_defect_summary: defectSummary || null,
      p_ncr_severity: ncrSeverity,
      p_ncr_type: ncrType,
    });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    const result = data as { receiptNo?: string; ncrId?: string | null; qtyRejected?: number } | null;
    toast.success(result?.ncrId
      ? `บันทึกใบตรวจรับ ${result.receiptNo} แล้ว — เปิดใบ NC ให้ 1 ใบเพราะมีของไม่ผ่าน ${result.qtyRejected} หน่วย`
      : `บันทึกใบตรวจรับ ${result?.receiptNo ?? ""} แล้ว — ผ่านทั้งหมด`);
    setReceiveFor(null);
    await load();
  }

  return (
    <div className="pb-16">
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">ใบสั่งซื้อและการตรวจรับ</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            ข้อกำหนดที่ส่งถึงผู้ขายก่อนสั่ง และผลการตรวจรับตอนของมาถึง (ISO 9001 ข้อ 8.4.2 / 8.4.3)
          </p>
        </div>
        <button onClick={openCreate} disabled={Boolean(formBlocked)}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
          + สร้างใบสั่งซื้อ
        </button>
      </div>

      {formBlocked && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{formBlocked}</div>
      )}

      {loading ? (
        <div className="animate-pulse text-sm text-slate-400">โหลดข้อมูล…</div>
      ) : pos.length === 0 ? (
        <div className="rounded-xl border border-slate-100 bg-white p-12 text-center text-slate-400">
          <div className="mb-3 text-4xl">🛒</div>
          <div className="font-medium text-slate-500">ยังไม่มีใบสั่งซื้อในระบบ</div>
          <p className="mx-auto mt-2 max-w-lg text-sm">
            ใบสั่งซื้อใบแรกจะเป็นจุดที่บริษัทบอกผู้ขายเป็นลายลักษณ์อักษรว่าต้องได้ของเมื่อไร และของแบบไหนถึงจะรับ
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pos.map((po) => (
            <article key={po.id} className="overflow-hidden rounded-xl border border-slate-100 bg-white">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div>
                  <div className="font-mono font-semibold">{po.poNumber}</div>
                  <div className="text-xs text-slate-400">
                    {po.supplierName ?? "ไม่ระบุผู้ขาย"}
                    {po.supplierApprovalStatus === "suspended" && <span className="ml-1 text-red-600">· ผู้ขายรายนี้ถูกระงับอยู่</span>}
                    {po.requiredDate && ` · ต้องได้ของ ${po.requiredDate}`}
                    {po.eta && ` · ผู้ขายแจ้ง ${po.eta}`}
                    {po.jobNo && ` · เพื่องาน ${po.jobNo}`}
                  </div>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[po.status] ?? "bg-slate-100 text-slate-500"}`}>
                  {PO_STATUS_LABELS[po.status] ?? po.status}
                </span>
                {po.totalAmount != null && <span className="text-sm font-semibold text-slate-700">฿{po.totalAmount.toLocaleString()}</span>}
                <div className="ml-auto flex flex-wrap gap-2">
                  {po.status === "draft" && (
                    <button onClick={() => issuePo(po)} disabled={saving}
                      className="rounded-lg bg-blue-50 px-3 py-1 text-xs text-blue-600 hover:bg-blue-100">ส่งให้ผู้ขาย</button>
                  )}
                  {(po.status === "ordered" || po.status === "partial") && (
                    <button onClick={() => openReceive(po)}
                      className="rounded-lg bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100">ตรวจรับของ</button>
                  )}
                  {po.status !== "cancelled" && po.status !== "received" && (
                    <button onClick={() => cancelPo(po)} disabled={saving}
                      className="rounded-lg bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100">ยกเลิก</button>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-50 bg-slate-50/60 px-5 py-3 text-sm">
                <div className="text-xs font-medium text-slate-400">ข้อกำหนดการตรวจรับที่แจ้งผู้ขาย</div>
                <div className="text-slate-700">{po.acceptanceRequirements ?? "— ยังไม่ระบุ —"}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {po.createdByName && `สร้างโดย ${po.createdByName}`}
                  {po.issuedByName && ` · ส่งให้ผู้ขายโดย ${po.issuedByName}`}
                  {po.inspectionSamplePct != null && ` · สุ่มตรวจ ${po.inspectionSamplePct}%`}
                  {po.cancelReason && ` · ยกเลิกเพราะ ${po.cancelReason}`}
                </div>
              </div>

              <table className="w-full border-t border-slate-50 text-sm">
                <thead className="bg-slate-50 text-xs text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">วัสดุ</th>
                    <th className="px-4 py-2 text-left font-medium">สั่ง</th>
                    <th className="px-4 py-2 text-left font-medium">รับแล้ว</th>
                    <th className="px-4 py-2 text-left font-medium">ปฏิเสธ</th>
                    <th className="px-4 py-2 text-left font-medium">ค้างรับ</th>
                    <th className="px-4 py-2 text-left font-medium">ราคา/หน่วย</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {po.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2">
                        {item.materialName ?? "—"} <span className="text-xs text-slate-400">{item.sku}</span>
                        {item.acceptanceSpec && <div className="text-xs text-slate-400">ข้อกำหนด: {item.acceptanceSpec}</div>}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{item.qtyOrdered} {item.unit ?? ""}</td>
                      <td className="px-4 py-2 tabular-nums text-emerald-700">{item.qtyReceived}</td>
                      <td className={`px-4 py-2 tabular-nums ${item.qtyRejected > 0 ? "text-red-600" : "text-slate-400"}`}>{item.qtyRejected}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-500">{remainingQty(item)}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-500">{item.unitPrice != null ? `฿${item.unitPrice.toLocaleString()}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {po.receipts.length > 0 && (
                <div className="border-t border-slate-50 px-5 py-3">
                  <div className="mb-2 text-xs font-medium text-slate-400">ประวัติการตรวจรับ</div>
                  <ul className="space-y-2">
                    {po.receipts.map((receipt) => (
                      <li key={receipt.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{receipt.receiptNo}</span>
                          <span className={`rounded px-2 py-0.5 text-xs ${RESULT_STYLE[receipt.inspectionResult]}`}>
                            {RECEIPT_RESULT_LABELS[receipt.inspectionResult] ?? receipt.inspectionResult}
                          </span>
                          {receipt.ncrId && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">เปิดใบ NC แล้ว</span>}
                          <span className="text-xs text-slate-400">
                            {receipt.receivedByName}
                            {receipt.receivedAt && ` · ${new Date(receipt.receivedAt).toLocaleString("th-TH")}`}
                            {receipt.samplePct != null && ` · สุ่มตรวจ ${receipt.samplePct}%`}
                          </span>
                        </div>
                        {receipt.lines.some((line) => line.qtyRejected > 0) && (
                          <ul className="mt-1 text-xs text-red-700">
                            {receipt.lines.filter((line) => line.qtyRejected > 0).map((line) => {
                              const item = po.items.find((i) => i.id === line.poItemId);
                              return (
                                <li key={line.poItemId}>
                                  ปฏิเสธ {line.qtyRejected} {item?.unit ?? ""} · {item?.materialName ?? "ไม่ระบุ"} — {line.defectNote}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {receipt.defectSummary && <div className="mt-1 text-xs text-slate-500">สรุปโดยผู้ตรวจรับ: {receipt.defectSummary}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold">สร้างใบสั่งซื้อ</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                ใบใหม่จะเป็น &quot;ร่าง&quot; ก่อน — ยังไม่ถือว่าสื่อสารกับผู้ขาย จนกว่าจะกด &quot;ส่งให้ผู้ขาย&quot;
              </p>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">ผู้ขาย * (เฉพาะรายที่อนุมัติแล้วและไม่ถูกระงับ)</span>
                  <select value={draft.supplierId} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">— เลือกผู้ขาย —</option>
                    {options.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.leadTimeDays != null ? ` (รอของ ${p.leadTimeDays} วัน)` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">วันที่เราต้องได้ของ *</span>
                  <input type="date" min={todayISO()} value={draft.requiredDate}
                    onChange={(e) => setDraft({ ...draft, requiredDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">วันที่ผู้ขายรับปากว่าจะส่ง (ถ้ามี)</span>
                  <input type="date" value={draft.eta} onChange={(e) => setDraft({ ...draft, eta: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">ซื้อเพื่องานติดตั้งใด (ถ้ามี)</span>
                  <select value={draft.jobNo} onChange={(e) => setDraft({ ...draft, jobNo: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">— ซื้อเข้าสต็อกกลาง —</option>
                    {options.jobs.map((job) => (
                      <option key={job.jobNo} value={job.jobNo}>{job.jobNo}{job.customer ? ` · ${job.customer}` : ""}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-400">
                    ถ้าระบุไว้ ใบ NC ที่เกิดจากของไม่ผ่านตรวจรับจะผูกกับงานนี้ให้อัตโนมัติ
                  </span>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  ข้อกำหนดการตรวจรับ * — บอกผู้ขายก่อนสั่งว่า &quot;ของแบบไหนถึงจะรับ&quot;
                </span>
                <textarea rows={3} value={draft.acceptanceRequirements}
                  placeholder="เช่น ต้องแนบใบรับรองคุณภาพทุกล็อต · ผิวไม่มีรอยฉีกหรือบิ่น · ความชื้นไม่เกิน 12% · บรรจุพาเลตรัดฟิล์ม"
                  onChange={(e) => setDraft({ ...draft, acceptanceRequirements: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">รายการที่สั่ง</span>
                  <button onClick={addItem} className="text-xs text-blue-600 hover:underline">+ เพิ่มรายการ</button>
                </div>
                <div className="space-y-2">
                  {draft.items.map((item, index) => (
                    <div key={index} className="rounded-lg border border-slate-100 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={item.materialId} onChange={(e) => patchItem(index, { materialId: e.target.value })}
                          className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm">
                          {options.materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>)}
                        </select>
                        <input type="number" step="0.001" min="0" value={item.qty} placeholder="จำนวน"
                          onChange={(e) => patchItem(index, { qty: e.target.value })}
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-sm" />
                        <input type="number" step="0.01" min="0" value={item.unitPrice} placeholder="ราคา/หน่วย"
                          onChange={(e) => patchItem(index, { unitPrice: e.target.value })}
                          className="w-28 rounded border border-slate-200 px-2 py-1 text-sm" />
                        <button onClick={() => setDraft((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))}
                          className="text-xs text-red-400 hover:text-red-600">ลบ</button>
                      </div>
                      <input value={item.acceptanceSpec} placeholder="ข้อกำหนดเฉพาะรายการนี้ (ถ้ามี) เช่น ความหนา 6 มม. สี Ivory"
                        onChange={(e) => patchItem(index, { acceptanceSpec: e.target.value })}
                        className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-right text-sm font-semibold text-slate-700">
                  รวม: ฿{poDraftTotal(draft).toLocaleString()}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุ</span>
                <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 p-5">
              <button onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">ยกเลิก</button>
              <button onClick={savePo} disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? "กำลังบันทึก…" : "สร้างเป็นร่าง"}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiveFor && receiptCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReceiveFor(null)}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold">ตรวจรับของ · {receiveFor.poNumber}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                ข้อกำหนดที่ตกลงไว้: {receiveFor.acceptanceRequirements ?? "— ไม่ได้ระบุ —"}
              </p>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400">
                  <tr className="border-b border-slate-100">
                    <th className="px-2 py-2 text-left font-medium">วัสดุ</th>
                    <th className="px-2 py-2 text-left font-medium">ค้างรับ</th>
                    <th className="px-2 py-2 text-left font-medium">รับเข้าคลัง</th>
                    <th className="px-2 py-2 text-left font-medium">ปฏิเสธ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {receiveFor.items.map((item) => {
                    const line = receiptDraft[item.id] ?? { accepted: "", rejected: "", defectNote: "" };
                    return (
                      <tr key={item.id}>
                        <td className="px-2 py-2 align-top">
                          <div>{item.materialName ?? "—"}</div>
                          {item.acceptanceSpec && <div className="text-xs text-slate-400">{item.acceptanceSpec}</div>}
                          {Number(line.rejected) > 0 && (
                            <input value={line.defectNote} placeholder="ของที่ปฏิเสธเสียตรงไหน (บังคับกรอก)"
                              onChange={(e) => setReceiptDraft((prev) => ({ ...prev, [item.id]: { ...line, defectNote: e.target.value } }))}
                              className="mt-2 w-full rounded border border-red-200 px-2 py-1 text-xs" />
                          )}
                        </td>
                        <td className="px-2 py-2 align-top tabular-nums text-slate-500">{remainingQty(item)} {item.unit ?? ""}</td>
                        <td className="px-2 py-2 align-top">
                          <input type="number" min="0" step="0.001" value={line.accepted}
                            onChange={(e) => setReceiptDraft((prev) => ({ ...prev, [item.id]: { ...line, accepted: e.target.value } }))}
                            className="w-24 rounded border border-slate-200 px-2 py-1 text-sm" />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input type="number" min="0" step="0.001" value={line.rejected}
                            onChange={(e) => setReceiptDraft((prev) => ({ ...prev, [item.id]: { ...line, rejected: e.target.value } }))}
                            className="w-24 rounded border border-slate-200 px-2 py-1 text-sm" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">สัดส่วนที่สุ่มตรวจจริง (%)</span>
                  <input type="number" min="0" max="100" value={receiptSamplePct}
                    onChange={(e) => setReceiptSamplePct(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">บันทึกการตรวจรับ</span>
                  <input value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>

              {receiptCheck.willOpenNcr && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="text-sm font-medium text-red-800">
                    มีของไม่ผ่านตรวจรับ — ระบบจะเปิดใบ NC ให้ 1 ใบ (สาเหตุ: วัสดุ/สินค้า) และผูกกับผู้ขายรายนี้
                  </div>
                  {!receiveFor.jobNo && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-red-800">
                        ของล็อตนี้กระทบงานใด * (ใบ NC ในระบบนี้ต้องผูกกับเลขงานเสมอ)
                      </span>
                      <select value={receiptJobNo} onChange={(e) => setReceiptJobNo(e.target.value)}
                        className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm">
                        <option value="">— เลือกงาน —</option>
                        {options.jobs.map((job) => (
                          <option key={job.jobNo} value={job.jobNo}>{job.jobNo}{job.customer ? ` · ${job.customer}` : ""}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-red-800">อาการที่พบ</span>
                      <select value={ncrType} onChange={(e) => setNcrType(e.target.value)}
                        className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm">
                        {RECEIPT_NCR_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-red-800">ความรุนแรง</span>
                      <select value={ncrSeverity} onChange={(e) => setNcrSeverity(e.target.value)}
                        className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm">
                        {NCR_SEVERITIES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-red-800">สรุปโดยผู้ตรวจรับ (ไม่บังคับ)</span>
                    <textarea rows={2} value={defectSummary} onChange={(e) => setDefectSummary(e.target.value)}
                      className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}

              <div className={`rounded-lg p-3 text-sm ${receiptCheck.error ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}>
                {receiptOutcomeMessage(receiptCheck)}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 p-5">
              <button onClick={() => setReceiveFor(null)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">ยกเลิก</button>
              <button onClick={saveReceipt} disabled={saving || Boolean(receiptCheck.error)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? "กำลังบันทึก…" : "บันทึกผลการตรวจรับ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * P3-5 — แผงหยิบของรายบรรทัดของหน้าคลัง
 *
 * ทำไมแยกเป็นคอมโพเนนต์: หน้า app/(admin)/warehouse/page.tsx เขียนแบบบรรทัดยาวมาก
 * การยัดตรรกะการหยิบรายบรรทัดเข้าไปอีกจะทำให้ไฟล์นั้นอ่านไม่ออกไปมากกว่าเดิม
 * และแผงนี้มีสถานะของตัวเอง (โหลดบรรทัด ยิง RPC รีเฟรช) ที่ไม่เกี่ยวกับหน้านั้นเลย
 *
 * การเขียนทั้งหมดผ่าน RPC record_warehouse_item_pick — คอมโพเนนต์นี้ไม่แตะตารางตรงเลย
 * และ "ของขาดเท่าไหร่" คิดด้วย calculateJobStockShortage() ตัวเดิมของ P3-4 ไม่มีสูตรที่สอง
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import { STOCK_LINE_STATUS_LABELS, calculateJobStockShortage } from "@/lib/stock-shortage";
import {
  PICK_STATUSES,
  PICK_STATUS_BADGE,
  PICK_STATUS_LABELS,
  RECORD_ITEM_PICK_RPC,
  WAREHOUSE_PICK_LINES_RPC,
  type PickStatus,
  type WarehousePickLine,
  isPickStatus,
  num,
  pickNoteError,
  qtyText,
  resolvePickedQty,
  stockBesideLineLabel,
  summarisePickProgress,
  toWarehousePickLines,
} from "@/lib/warehouse-picking";

const STATUS_BUTTON_CLASS: Record<PickStatus, { on: string; off: string }> = {
  picked_full: { on: "bg-emerald-600 text-white border-emerald-600", off: "border-emerald-200 bg-white text-emerald-700" },
  picked_partial: { on: "bg-amber-500 text-white border-amber-500", off: "border-amber-200 bg-white text-amber-700" },
  unavailable: { on: "bg-rose-600 text-white border-rose-600", off: "border-rose-200 bg-white text-rose-700" },
};

function badgeClass(status: string | null) {
  if (status === "picked_full") return "bg-emerald-100 text-emerald-700";
  if (status === "picked_partial") return "bg-amber-100 text-amber-700";
  if (status === "unavailable") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-500";
}

export default function WarehouseLinePicking({
  workOrderId,
  canPick,
  onLinesChanged,
}: {
  workOrderId: string;
  /** หยิบได้ก็ต่อเมื่อใบสั่งงานกำลังเตรียมสินค้าและผู้ใช้เป็นพนักงาน active — ด่านจริงอยู่ใน RPC อีกชั้น */
  canPick: boolean;
  /** ส่งบรรทัดล่าสุดกลับให้หน้าแม่ เพื่อ prefill ช่อง "จำนวนที่คลังจัดจริง" ของทางเดิมทั้งใบ */
  onLinesChanged?: (lines: WarehousePickLine[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [lines, setLines] = useState<WarehousePickLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<Record<string, PickStatus>>({});
  const [draftQty, setDraftQty] = useState<Record<string, string>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc(WAREHOUSE_PICK_LINES_RPC, { p_work_order_id: workOrderId });
    if (error) {
      setLoadError(floorErrorMessage(error));
      setLines([]);
      setLoading(false);
      return;
    }
    const rows = toWarehousePickLines(data);
    setLoadError(null);
    setLines(rows);
    setDraftStatus(Object.fromEntries(rows.flatMap((row) => (isPickStatus(row.pick_status) ? [[row.item_id ?? "", row.pick_status]] : []))));
    setDraftQty(Object.fromEntries(rows.map((row) => [row.item_id ?? "", row.picked_qty == null ? "" : String(num(row.picked_qty) ?? "")])));
    setDraftNote(Object.fromEntries(rows.map((row) => [row.item_id ?? "", row.pick_note ?? ""])));
    setLoading(false);
    onLinesChanged?.(rows);
  }, [onLinesChanged, supabase, workOrderId]);

  useEffect(() => { void load(); }, [load]);

  const progress = useMemo(() => summarisePickProgress(lines), [lines]);
  // ใช้สูตรเดียวกับหน้าใบสั่งงานและงานเตือนกลางคืน ไม่คิดเองใหม่
  const shortage = useMemo(() => calculateJobStockShortage(lines), [lines]);

  async function save(line: WarehousePickLine) {
    const itemId = line.item_id;
    if (!itemId) return;
    const status = draftStatus[itemId];
    if (!status) { toast.error("เลือกก่อนว่าหยิบครบ หยิบได้บางส่วน หรือไม่มีของ"); return; }

    const qty = resolvePickedQty(status, draftQty[itemId] ?? "", num(line.planned_qty));
    if (!qty.ok) { toast.error(qty.error); return; }
    const noteProblem = pickNoteError(status, draftNote[itemId] ?? "");
    if (noteProblem) { toast.error(noteProblem); return; }

    setSaving(itemId);
    const { error } = await supabase.rpc(RECORD_ITEM_PICK_RPC, {
      p_item_id: itemId,
      p_pick_status: status,
      p_picked_qty: status === "picked_partial" ? qty.qty : null,
      p_note: (draftNote[itemId] ?? "").trim() || null,
    });
    setSaving(null);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(`บันทึกแล้ว: ${line.item_name} · ${PICK_STATUS_LABELS[status]}`);
    await load();
  }

  if (loading) {
    return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">กำลังโหลดรายการหยิบของ…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      อ่านรายการหยิบของไม่สำเร็จ — {loadError}
      <button type="button" onClick={() => void load()} className="ml-2 underline">ลองใหม่</button>
    </div>;
  }
  if (!lines.length) {
    return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">ใบสั่งงานนี้ยังไม่มีรายการของ</div>;
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-700">ความคืบหน้าการหยิบ</span>
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">ครบ {progress.full}</span>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">บางส่วน {progress.partial}</span>
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">ไม่มีของ {progress.unavailable}</span>
      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">ยังไม่หยิบ {progress.pending}</span>
      {shortage.snapshotDate ? <span className="ml-auto text-slate-400">ยอดคลัง ณ {shortage.snapshotDate}</span> : null}
    </div>

    {progress.hasShortfall ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      มีบรรทัดที่หยิบไม่ครบ {progress.partial + progress.unavailable} รายการ — ช่างจะเห็นตัวเลขนี้ตอนรับของหน้างาน และถ้าของยังขาดตอนถึงหน้างาน ระบบจะเปิด NC ให้เอง
    </div> : null}

    {lines.map((line) => {
      const itemId = line.item_id ?? "";
      const status = draftStatus[itemId];
      const planned = num(line.planned_qty);
      const group = shortage.groups.find((entry) => entry.itemIds.includes(itemId));
      return <div key={itemId} className="rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{line.item_name}{line.line_sku ? ` · ${line.line_sku}` : ""}</div>
            <div className="mt-0.5 text-xs text-slate-500">{line.specification || "ไม่ระบุสเปก"}{line.note ? ` · ${line.note}` : ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${badgeClass(line.pick_status)}`}>
              {isPickStatus(line.pick_status) ? PICK_STATUS_BADGE[line.pick_status] : "ยังไม่หยิบ"}
            </span>
            <div className="rounded-lg bg-violet-50 px-3 py-1.5 text-right">
              <div className="text-[10px] text-violet-700">ตามแผน</div>
              <div className="text-sm font-bold text-violet-950">{qtyText(planned)} {line.unit}</div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lg bg-sky-50 px-2 py-1 font-medium text-sky-800">{stockBesideLineLabel(line)}</span>
          {group ? <span className="text-slate-500">
            สถานะสต็อก: {STOCK_LINE_STATUS_LABELS[group.status]}
            {group.status === "short" ? ` · ขาด ${qtyText(group.shortageQty)} ${group.unit}` : ""}
          </span> : null}
          {line.picked_by_name ? <span className="text-slate-400">
            หยิบโดย {line.picked_by_name}{line.picked_at ? ` · ${new Date(line.picked_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}` : ""}
          </span> : null}
        </div>

        {line.pick_note && !canPick ? <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">หมายเหตุคลัง: {line.pick_note}</div> : null}

        {canPick ? <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {PICK_STATUSES.map((option) => <button
              key={option}
              type="button"
              onClick={() => setDraftStatus((current) => ({ ...current, [itemId]: option }))}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${status === option ? STATUS_BUTTON_CLASS[option].on : STATUS_BUTTON_CLASS[option].off}`}
            >{PICK_STATUS_LABELS[option]}</button>)}
          </div>

          {status === "picked_partial" ? <label className="block text-xs font-medium text-slate-600">
            หยิบได้จริงกี่{line.unit}
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={draftQty[itemId] ?? ""}
              onChange={(event) => setDraftQty((current) => ({ ...current, [itemId]: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm text-slate-900"
              placeholder={`น้อยกว่า ${qtyText(planned)}`}
            />
          </label> : null}

          {status ? <input
            value={draftNote[itemId] ?? ""}
            onChange={(event) => setDraftNote((current) => ({ ...current, [itemId]: event.target.value }))}
            placeholder={status === "unavailable" ? "ทำไมถึงไม่มีของ (จำเป็น)" : "หมายเหตุ (ถ้ามี)"}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 ${status === "unavailable" ? "border-rose-300" : "border-slate-200"}`}
          /> : null}

          <button
            type="button"
            onClick={() => void save(line)}
            disabled={saving === itemId || !status}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
          >{saving === itemId ? "กำลังบันทึก…" : "บันทึกการหยิบบรรทัดนี้"}</button>
        </div> : null}
      </div>;
    })}
  </div>;
}

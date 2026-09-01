"use client";

/**
 * P3-6 — แผงตรวจรับของหน้างานของช่าง (มือถือ ใช้มือเดียว)
 *
 * ข้อกำหนดหน้างานที่มีผลกับการออกแบบทุกบรรทัดในไฟล์นี้:
 *   * ช่างถือของอยู่มือหนึ่ง ถือมืออีกข้างจิ้มจอ ปุ่มจึงเต็มความกว้าง สูงพอกดด้วยนิ้วโป้ง
 *     และเรียงลงล่างเป็นคอลัมน์เดียวเสมอ ไม่มี layout สองคอลัมน์ให้ต้องเล็งบนจอ 5 นิ้ว
 *   * แดดจ้า จอมองยาก จึงใช้สีที่ต่างกันชัดต่อสถานะ ไม่พึ่งตัวอักษรเล็ก ๆ อย่างเดียว
 *   * เน็ตหน้างานไม่ดี จึงบันทึก "ทีละบรรทัด" ไม่ต้องกรอกครบทั้งใบก่อนกดส่ง
 *     ถ้าเน็ตหลุดกลางคัน บรรทัดที่ยืนยันไปแล้วอยู่ครบ ไม่ต้องเริ่มใหม่
 *
 * การเขียนทั้งหมดผ่าน RPC record_technician_item_receipt ที่ตรวจ token+PIN
 * หน้าช่างวิ่งเป็น anon และไม่ได้รับสิทธิ์ตารางใด ๆ เพิ่มจากงานนี้เลย
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import {
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  RECORD_TECHNICIAN_RECEIPT_RPC,
  TECHNICIAN_RECEIPT_LINES_RPC,
  type ReceiptStatus,
  type TechnicianReceiptLine,
  type TechnicianReceiptPayload,
  confirmableLines,
  needsFreeText,
  needsReason,
  parseReceiptPayload,
  qtyText,
  reasonLabel,
  receiptFormError,
  resolveReceivedQty,
  summariseReceipts,
  warehouseSaidLabel,
  willOpenNcr,
} from "@/lib/technician-receipt";

const STATUS_STYLE: Record<ReceiptStatus, { on: string; off: string }> = {
  received_full: { on: "bg-emerald-600 text-white border-emerald-600", off: "border-emerald-200 bg-white text-emerald-800" },
  received_partial: { on: "bg-amber-500 text-white border-amber-500", off: "border-amber-200 bg-white text-amber-800" },
  not_received: { on: "bg-rose-600 text-white border-rose-600", off: "border-rose-200 bg-white text-rose-800" },
};

function num(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function statusBadge(status: string | null | undefined) {
  if (status === "received_full") return { text: "ได้ครบ", cls: "bg-emerald-100 text-emerald-800" };
  if (status === "received_partial") return { text: "ได้ไม่ครบ", cls: "bg-amber-100 text-amber-800" };
  if (status === "not_received") return { text: "ไม่ได้รับ", cls: "bg-rose-100 text-rose-800" };
  return { text: "ยังไม่ยืนยัน", cls: "bg-slate-100 text-slate-500" };
}

const WORK_ORDER_STATUS_TH: Record<string, string> = {
  head_review: "รอหัวหน้าช่างตรวจ",
  returned_sales: "ส่งกลับฝ่ายขาย",
  warehouse_waiting: "รอคลังรับงาน",
  warehouse_preparing: "คลังกำลังเตรียมสินค้า",
  ready_to_install: "รอติดตั้ง",
  installing: "กำลังติดตั้ง",
  waiting_cs: "รอ CS โทรประเมิน",
  closed: "ปิดงานแล้ว",
  cancelled: "ยกเลิก",
};

export default function TechnicianReceiptConfirmation({
  token, pin, assignmentId, demoMode,
}: {
  token: string;
  pin: string;
  assignmentId: string;
  demoMode?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [payload, setPayload] = useState<TechnicianReceiptPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [status, setStatus] = useState<ReceiptStatus | null>(null);
  const [rawQty, setRawQty] = useState("");
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reasonNote, setReasonNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demoMode) {
      setPayload(null);
      setLoadError("โหมดข้อมูลจำลองไม่ได้เชื่อมกับใบสั่งงานจริง จึงยืนยันรับของไม่ได้");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc(TECHNICIAN_RECEIPT_LINES_RPC, {
      p_token: token, p_pin: pin, p_assignment_id: assignmentId,
    });
    if (error) {
      setLoadError(floorErrorMessage(error));
      setPayload(null);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setPayload(parseReceiptPayload(data));
    setLoading(false);
  }, [assignmentId, demoMode, pin, supabase, token]);

  useEffect(() => { void load(); }, [load]);

  function openLine(line: TechnicianReceiptLine) {
    if (openItemId === line.itemId) { setOpenItemId(null); return; }
    setOpenItemId(line.itemId);
    const existing = line.receipt;
    const nextStatus = (existing?.status as ReceiptStatus | undefined) ?? null;
    setStatus(nextStatus);
    setRawQty(existing?.receivedQty != null && nextStatus === "received_partial" ? String(num(existing.receivedQty) ?? "") : "");
    setReasonCode(existing?.reasonCode ?? null);
    setReasonNote(existing?.reasonNote ?? "");
    setFormError(null);
  }

  async function submit(line: TechnicianReceiptLine) {
    if (!status) { setFormError("เลือกก่อนว่าได้ครบ ได้ไม่ครบ หรือไม่ได้รับเลย"); return; }
    const expected = num(line.expectedQty);
    const problem = receiptFormError({ status, rawQty, reasonCode, reasonNote, expectedQty: expected });
    if (problem) { setFormError(problem); return; }
    const qty = resolveReceivedQty(status, rawQty, expected);
    if (!qty.ok) { setFormError(qty.error); return; }

    setSaving(true);
    setFormError(null);
    const { data, error } = await supabase.rpc(RECORD_TECHNICIAN_RECEIPT_RPC, {
      p_token: token, p_pin: pin, p_assignment_id: assignmentId,
      p_item_id: line.itemId,
      p_receipt_status: status,
      p_received_qty: status === "received_partial" ? qty.qty : null,
      p_reason_code: needsReason(status) ? reasonCode : null,
      p_reason_note: needsReason(status) ? (reasonNote.trim() || null) : null,
    });
    setSaving(false);
    if (error) { setFormError(floorErrorMessage(error)); return; }

    const result = (data ?? {}) as Record<string, unknown>;
    if (typeof result.ncrError === "string" && result.ncrError) {
      setFlash(`บันทึกผลตรวจรับแล้ว แต่เปิดใบ NC อัตโนมัติไม่สำเร็จ กรุณาแจ้งหัวหน้าช่างด้วยตัวเอง (${result.ncrError})`);
    } else if (result.ncrCreated === true) {
      setFlash(`บันทึกแล้ว · ระบบเปิดใบ NC เรื่องของไม่ครบให้อัตโนมัติ ไม่ต้องโทรแจ้งซ้ำ`);
    } else if (result.ncrId) {
      setFlash("บันทึกแล้ว · อัปเดตใบ NC เดิมของรายการนี้ ไม่ได้เปิดใบใหม่");
    } else {
      setFlash("บันทึกแล้ว");
    }
    setOpenItemId(null);
    await load();
  }

  if (loading) {
    return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">กำลังโหลดรายการของที่ต้องตรวจรับ…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
      {loadError}
      {!demoMode ? <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">ลองใหม่</button> : null}
    </div>;
  }
  if (!payload?.found) {
    return <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">ยังไม่มีใบสั่งงานของนัดหมายนี้ จึงยังตรวจรับของไม่ได้</div>;
  }

  const lines = confirmableLines(payload.lines);
  const progress = summariseReceipts(payload.lines);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-700">ยืนยันแล้ว {progress.confirmed}/{progress.total} รายการ</span>
      {progress.shortLines > 0 ? <span className="rounded-full bg-amber-200 px-2 py-0.5 font-medium text-amber-900">ไม่ครบ {progress.shortLines}</span> : null}
      {progress.ncrCount > 0 ? <span className="rounded-full bg-rose-200 px-2 py-0.5 font-medium text-rose-900">เปิด NC แล้ว {progress.ncrCount}</span> : null}
    </div>

    {flash ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
      {flash}
      <button type="button" onClick={() => setFlash(null)} className="ml-2 font-semibold underline">ปิด</button>
    </div> : null}

    {!payload.canConfirm ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-800">
      ยังยืนยันรับของไม่ได้ — ใบสั่งงานอยู่สถานะ “{WORK_ORDER_STATUS_TH[payload.workOrderStatus ?? ""] ?? payload.workOrderStatus}”
      · ยืนยันได้เมื่อคลังจ่ายของแล้วและงานยังไม่จบ
    </div> : null}

    {!lines.length ? <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">ใบสั่งงานนี้ไม่มีรายการของให้ตรวจรับ</div> : null}

    {lines.map((line) => {
      const expected = num(line.expectedQty);
      const badge = statusBadge(line.receipt?.status);
      const isOpen = openItemId === line.itemId;
      return <div key={line.itemId} className={`rounded-2xl border ${isOpen ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
        <button
          type="button"
          onClick={() => openLine(line)}
          disabled={!payload.canConfirm}
          className="w-full px-3 py-3 text-left disabled:opacity-60"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold leading-snug text-slate-900">{line.itemName}</div>
              <div className="mt-0.5 text-xs text-slate-500">{line.sku ? `${line.sku} · ` : ""}{line.specification || "ไม่ระบุสเปก"}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.cls}`}>{badge.text}</span>
          </div>
          <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-700">{warehouseSaidLabel(line)}</div>
          {line.receipt ? <div className="mt-1.5 text-xs text-slate-600">
            บันทึกไว้: ได้รับ {qtyText(num(line.receipt.receivedQty))} จาก {qtyText(num(line.receipt.expectedQty))} {line.unit}
            {line.receipt.reasonCode ? ` · ${reasonLabel(payload.reasonOptions, line.receipt.reasonCode)}` : ""}
            {line.receipt.ncrId ? " · เปิด NC แล้ว" : ""}
          </div> : null}
        </button>

        {isOpen && payload.canConfirm ? <div className="space-y-3 border-t border-blue-200 px-3 py-3">
          <div className="grid gap-2">
            {RECEIPT_STATUSES.map((option) => <button
              key={option}
              type="button"
              onClick={() => { setStatus(option); setFormError(null); }}
              className={`w-full rounded-xl border-2 px-3 py-3.5 text-base font-semibold ${status === option ? STATUS_STYLE[option].on : STATUS_STYLE[option].off}`}
            >
              {RECEIPT_STATUS_LABELS[option]}
              {option === "received_full" ? <span className="ml-1 text-xs font-normal opacity-80">({qtyText(expected)} {line.unit})</span> : null}
            </button>)}
          </div>

          {status === "received_partial" ? <label className="block">
            <span className="text-sm font-medium text-slate-700">ได้รับจริงกี่{line.unit}</span>
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={rawQty}
              onChange={(event) => { setRawQty(event.target.value); setFormError(null); }}
              placeholder={`น้อยกว่า ${qtyText(expected)}`}
              className="mt-1 w-full rounded-xl border-2 border-amber-300 bg-white px-3 py-3 text-lg text-slate-900"
            />
          </label> : null}

          {status && needsReason(status) ? <div>
            <div className="text-sm font-medium text-slate-700">เพราะอะไร</div>
            <div className="mt-1.5 grid gap-2">
              {payload.reasonOptions.map((option) => <button
                key={option.code}
                type="button"
                onClick={() => { setReasonCode(option.code); setFormError(null); }}
                className={`w-full rounded-xl border px-3 py-3 text-left text-base ${reasonCode === option.code ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-slate-300 bg-white text-slate-800"}`}
              >{option.label}</button>)}
            </div>
            <textarea
              value={reasonNote}
              onChange={(event) => { setReasonNote(event.target.value); setFormError(null); }}
              rows={2}
              placeholder={needsFreeText(reasonCode) ? "อธิบายเพิ่ม (จำเป็น)" : "อธิบายเพิ่ม (ถ้ามี)"}
              className={`mt-2 w-full rounded-xl border-2 bg-white px-3 py-2.5 text-base text-slate-900 ${needsFreeText(reasonCode) ? "border-blue-400" : "border-slate-200"}`}
            />
          </div> : null}

          {status && willOpenNcr(status) ? <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs leading-relaxed text-rose-900">
            กดยืนยันแล้วระบบจะเปิดใบ NC เรื่องของไม่ครบให้อัตโนมัติ พร้อมระบุว่าเป็นปัญหาการจัดส่ง/คลัง (logistics)
            ไม่ต้องโทรแจ้งซ้ำ · ถ้าเคยแจ้งรายการนี้ไปแล้ว ระบบจะอัปเดตใบเดิม ไม่เปิดใบใหม่
          </div> : null}

          {formError ? <div className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{formError}</div> : null}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenItemId(null)} className="flex-1 rounded-xl border border-slate-300 bg-white py-3.5 text-base font-medium text-slate-700">ยกเลิก</button>
            <button
              type="button"
              onClick={() => void submit(line)}
              disabled={saving || !status}
              className="flex-[2] rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
            >{saving ? "กำลังบันทึก…" : "ยืนยันรายการนี้"}</button>
          </div>
        </div> : null}
      </div>;
    })}
  </div>;
}

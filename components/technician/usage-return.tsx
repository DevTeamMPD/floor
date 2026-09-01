"use client";

/**
 * P4-1 — แผงปิดยอดหน้างานของช่าง: "ใช้ไปเท่าไหร่ / เอากลับมาคืนเท่าไหร่" (มือถือ ใช้มือเดียว)
 *
 * ข้อกำหนดหน้างานที่มีผลกับทุกบรรทัดในไฟล์นี้ (เหมือนแผงตรวจรับของ P3-6):
 *   * ปุ่มเต็มความกว้าง ช่องกรอกสูง กดด้วยนิ้วโป้งได้ เรียงคอลัมน์เดียวเสมอ
 *   * บันทึกทีละบรรทัด ไม่ต้องกรอกครบทั้งใบก่อนกดส่ง เน็ตหลุดแล้วของที่บันทึกไปแล้วอยู่ครบ
 *   * ช่างเห็น "คลังจ่ายมาเท่าไหร่" ก่อนกรอกเสมอ และเห็นทันทีว่า "ยังไม่กลับกี่ชิ้น"
 *
 * เครื่องมือ (item_kind = 'tool') ไม่มีช่อง "ใช้ไป" ให้กรอกเลย — ไม่ใช่ซ่อนไว้เฉย ๆ
 * เพราะเครื่องมือไม่ได้ถูกใช้หมดไป มันถูกคืนหรือยังไม่ถูกคืน และยอดค้างคืนของ P4-2
 * ต้องอ่านค่าได้ตรง ๆ จาก เบิก − คืน ฝั่งฐานข้อมูลก็ปฏิเสธด้วย trigger อีกชั้น
 *
 * ทุกการเขียนผ่าน RPC record_technician_line_usage ที่ตรวจ token+PIN
 * หน้าช่างวิ่งเป็น anon และไม่ได้รับสิทธิ์ตารางใด ๆ เพิ่มจากงานนี้เลย
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import {
  RECORD_TECHNICIAN_USAGE_RPC,
  TECHNICIAN_USAGE_LINES_RPC,
  type UsageLine,
  type UsagePayload,
  allowsUsedQty,
  closableLines,
  isClosed,
  isOutstandingTool,
  issuedLabel,
  num,
  parseUsagePayload,
  qtyText,
  resolveUsage,
  summariseUsage,
  unaccountedQty,
  usageSummaryLabel,
} from "@/lib/job-usage";

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

function badge(line: UsageLine) {
  if (isOutstandingTool(line)) return { text: "เครื่องมือยังไม่คืน", cls: "bg-rose-100 text-rose-800" };
  if (!isClosed(line)) return { text: "ยังไม่ปิดยอด", cls: "bg-slate-100 text-slate-500" };
  const gap = unaccountedQty(num(line.expectedQty), num(line.usedQty), num(line.returnedQty));
  if (gap !== null && gap > 0) return { text: "ยังไม่ครบ", cls: "bg-amber-100 text-amber-800" };
  return { text: "ปิดยอดแล้ว", cls: "bg-emerald-100 text-emerald-800" };
}

export default function TechnicianUsageReturn({
  token, pin, assignmentId, demoMode,
}: {
  token: string;
  pin: string;
  assignmentId: string;
  demoMode?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [usedRaw, setUsedRaw] = useState("");
  const [returnedRaw, setReturnedRaw] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demoMode) {
      setPayload(null);
      setLoadError("โหมดข้อมูลจำลองไม่ได้เชื่อมกับใบสั่งงานจริง จึงบันทึกยอดใช้/คืนไม่ได้");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc(TECHNICIAN_USAGE_LINES_RPC, {
      p_token: token, p_pin: pin, p_assignment_id: assignmentId,
    });
    if (error) {
      setLoadError(floorErrorMessage(error));
      setPayload(null);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setPayload(parseUsagePayload(data));
    setLoading(false);
  }, [assignmentId, demoMode, pin, supabase, token]);

  useEffect(() => { void load(); }, [load]);

  function openLine(line: UsageLine) {
    if (openItemId === line.itemId) { setOpenItemId(null); return; }
    setOpenItemId(line.itemId);
    const used = num(line.usedQty);
    const returned = num(line.returnedQty);
    setUsedRaw(used === null ? "" : String(used));
    setReturnedRaw(returned === null ? "" : String(returned));
    setNote(line.usageNote ?? "");
    setFormError(null);
  }

  async function submit(line: UsageLine) {
    if (!payload) return;
    const result = resolveUsage({
      usedRaw, returnedRaw, expectedQty: num(line.expectedQty), line, returnOnly: payload.returnOnly,
    });
    if (!result.ok) { setFormError(result.error); return; }

    setSaving(true);
    setFormError(null);
    const { data, error } = await supabase.rpc(RECORD_TECHNICIAN_USAGE_RPC, {
      p_token: token, p_pin: pin, p_assignment_id: assignmentId,
      p_item_id: line.itemId,
      p_used_qty: result.used,
      p_returned_qty: result.returned,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) { setFormError(floorErrorMessage(error)); return; }

    const row = (data ?? {}) as Record<string, unknown>;
    const gap = num(row.unaccountedQty) ?? 0;
    if (row.toolOutstanding === true) {
      setFlash("บันทึกแล้ว · เครื่องมือชิ้นนี้ยังไม่ได้คืนครบ คลังจะเห็นว่ายังค้างอยู่กับทีม");
    } else if (gap > 0) {
      setFlash(`บันทึกแล้ว · ยังมีของที่เบิกไปแล้วไม่ได้ใช้และไม่ได้คืนอีก ${qtyText(gap)} ${line.unit}`);
    } else {
      setFlash("บันทึกแล้ว · ยอดของบรรทัดนี้ครบแล้ว");
    }
    setOpenItemId(null);
    await load();
  }

  if (loading) {
    return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">กำลังโหลดรายการของที่ต้องปิดยอด…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
      {loadError}
      {!demoMode ? <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">ลองใหม่</button> : null}
    </div>;
  }
  if (!payload?.found) {
    return <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">ยังไม่มีใบสั่งงานของนัดหมายนี้ จึงยังปิดยอดของไม่ได้</div>;
  }

  const lines = closableLines(payload.lines);
  const progress = summariseUsage(payload.lines);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-700">ปิดยอดแล้ว {progress.closed}/{progress.total} รายการ</span>
      {progress.outstandingTools > 0 ? <span className="rounded-full bg-rose-200 px-2 py-0.5 font-medium text-rose-900">เครื่องมือยังไม่คืน {progress.outstandingTools}</span> : null}
      {progress.unaccountedLines > 0 ? <span className="rounded-full bg-amber-200 px-2 py-0.5 font-medium text-amber-900">ของยังไม่กลับ {progress.unaccountedLines} รายการ</span> : null}
    </div>

    {flash ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
      {flash}
      <button type="button" onClick={() => setFlash(null)} className="ml-2 font-semibold underline">ปิด</button>
    </div> : null}

    {!payload.canRecord ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-800">
      ยังบันทึกยอดใช้/คืนไม่ได้ — ใบสั่งงานอยู่สถานะ “{WORK_ORDER_STATUS_TH[payload.workOrderStatus ?? ""] ?? payload.workOrderStatus}”
      · บันทึกได้เมื่อคลังจ่ายของแล้ว
    </div> : null}

    {payload.canRecord && payload.returnOnly ? <div className="rounded-xl bg-blue-50 px-3 py-3 text-sm text-blue-900">
      งานนี้ปิดไปแล้ว — ยังบันทึก “จำนวนที่เอากลับมาคืน” ได้ (เครื่องมือที่คืนช้าเป็นเรื่องปกติ)
      แต่แก้ยอดที่ใช้ไปไม่ได้แล้ว
    </div> : null}

    {!lines.length ? <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
      ใบสั่งงานนี้ยังไม่มีของที่คลังจ่ายออกมา จึงยังไม่มีอะไรให้ปิดยอด
    </div> : null}

    {lines.map((line) => {
      const expected = num(line.expectedQty);
      const gap = unaccountedQty(expected, num(line.usedQty), num(line.returnedQty));
      const tag = badge(line);
      const isOpen = openItemId === line.itemId;
      const canUse = allowsUsedQty(line);
      return <div key={line.itemId} className={`rounded-2xl border ${isOpen ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
        <button
          type="button"
          onClick={() => openLine(line)}
          disabled={!payload.canRecord}
          className="w-full px-3 py-3 text-left disabled:opacity-60"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold leading-snug text-slate-900">
                {line.itemKind === "tool" ? "🔧 " : ""}{line.itemName}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{line.sku ? `${line.sku} · ` : ""}{line.specification || "ไม่ระบุสเปก"}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tag.cls}`}>{tag.text}</span>
          </div>
          <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-700">{issuedLabel(line)}</div>
          <div className="mt-1.5 text-xs text-slate-600">
            {usageSummaryLabel(line)}
            {line.usageRecordedByName ? ` · บันทึกโดย ${line.usageRecordedByName}` : ""}
          </div>
        </button>

        {isOpen && payload.canRecord ? <div className="space-y-3 border-t border-blue-200 px-3 py-3">
          {canUse ? <label className="block">
            <span className="text-sm font-medium text-slate-700">ใช้ไปจริงกี่{line.unit}</span>
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={usedRaw}
              disabled={payload.returnOnly}
              onChange={(event) => { setUsedRaw(event.target.value); setFormError(null); }}
              placeholder={`เบิกไป ${qtyText(expected)} ${line.unit}`}
              className="mt-1 w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-lg text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
            />
          </label> : <div className="rounded-xl bg-slate-100 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
            รายการนี้เป็นเครื่องมือที่ต้องคืน ไม่ใช่ของสิ้นเปลือง จึงไม่มีช่อง “ใช้ไป”
            — เอากลับมาแล้วกี่{line.unit} ให้กรอกในช่องด้านล่าง ถ้าหายหรือพังให้ปล่อยค้างไว้แล้วแจ้งหัวหน้าช่าง
          </div>}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">เอากลับมาคืนคลังกี่{line.unit}</span>
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={returnedRaw}
              onChange={(event) => { setReturnedRaw(event.target.value); setFormError(null); }}
              placeholder="ไม่ได้เอาอะไรกลับมาให้ใส่ 0"
              className="mt-1 w-full rounded-xl border-2 border-blue-300 bg-white px-3 py-3 text-lg text-slate-900"
            />
          </label>

          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="หมายเหตุ (ถ้ามี) เช่น เหตุผลที่ของไม่ครบ"
            className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900"
          />

          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
            เบิกออกไป {qtyText(expected)} {line.unit}
            {gap !== null && gap > 0 ? ` · ตอนนี้ยังไม่กลับ ${qtyText(gap)} ${line.unit}` : ""}
            <br />
            ยอดที่ใช้บวกยอดที่คืนต้องไม่เกินของที่เบิกออกไป · ส่วนที่เหลือระบบถือว่า “ยังอยู่กับทีมช่าง”
          </div>

          {formError ? <div className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{formError}</div> : null}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenItemId(null)} className="flex-1 rounded-xl border border-slate-300 bg-white py-3.5 text-base font-medium text-slate-700">ยกเลิก</button>
            <button
              type="button"
              onClick={() => void submit(line)}
              disabled={saving}
              className="flex-[2] rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
            >{saving ? "กำลังบันทึก…" : "บันทึกรายการนี้"}</button>
          </div>
        </div> : null}
      </div>;
    })}
  </div>;
}

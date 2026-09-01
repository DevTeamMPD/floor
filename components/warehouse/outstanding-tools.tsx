"use client";

/**
 * P4-2 — รายการเครื่องมือที่เบิกออกไปแล้วยังไม่ได้คืน (หน้าจอคลัง)
 *
 * ทำไมอยู่ในหน้าคลัง: คนที่จ่ายเครื่องมือออกไปคือคลัง และคนที่เดือดร้อนเมื่อของไม่กลับมา
 * คือคลังในวันที่หยิบให้งานถัดไปไม่ได้ รายการนี้จึงต้องอยู่ตรงที่คนคลังเปิดดูอยู่แล้วทุกวัน
 * ไม่ใช่หน้าใหม่ที่ต้องจำว่ามีอยู่
 *
 * "อยู่กับใคร" ตอบเป็น "ทีม" ก่อนเสมอ แล้วค่อยตามด้วยช่างที่โทรได้
 * เหตุผลเต็ม (พร้อมตัวเลขจากฐานข้อมูลจริง) อยู่ในหัวไฟล์
 * supabase/migrations/20260902150020_outstanding_tools.sql
 *
 * ทั้งแผงเป็นทางอ่านอย่างเดียว ผ่าน RPC get_outstanding_tools (security definer, เฉพาะพนักงานที่ active)
 * การเคลียร์ยอดทำที่เดียวคือหน้าจอช่าง (record_technician_line_usage) เพื่อไม่ให้มีสองมือเขียนตัวเลขเดียวกัน
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import {
  CANCELLED_TOOL_BADGE,
  CANCELLED_TOOL_EXPLANATION,
  DEFAULT_OUTSTANDING_SORT,
  OUTSTANDING_TOOLS_RPC,
  OVERDUE_LEVEL_LABELS,
  type OutstandingSortKey,
  type OutstandingToolRow,
  callablePhone,
  daysOutLabel,
  holderLabel,
  holderSourceLabel,
  isCancelledJobHolder,
  isExternalHolder,
  overdueLevel,
  parseOutstandingTools,
  sortOutstandingTools,
  summariseOutstandingTools,
} from "@/lib/outstanding-tools";

const LEVEL_STYLE = {
  fresh: "border-slate-200 bg-white",
  warn: "border-amber-300 bg-amber-50",
  critical: "border-rose-300 bg-rose-50",
} as const;

const LEVEL_BADGE = {
  fresh: "bg-slate-100 text-slate-600",
  warn: "bg-amber-200 text-amber-900",
  critical: "bg-rose-200 text-rose-900",
} as const;

const SORT_BUTTONS: { key: OutstandingSortKey; label: string }[] = [
  { key: "days", label: "ค้างนานสุด" },
  { key: "qty", label: "จำนวนชิ้น" },
  { key: "team", label: "ทีม" },
  { key: "job", label: "เลขงาน" },
];

function thaiDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });
}

export default function WarehouseOutstandingTools() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<OutstandingToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<OutstandingSortKey>(DEFAULT_OUTSTANDING_SORT.key);
  const [desc, setDesc] = useState(DEFAULT_OUTSTANDING_SORT.desc);
  const [externalOnly, setExternalOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc(OUTSTANDING_TOOLS_RPC);
    if (rpcError) {
      setError(floorErrorMessage(rpcError));
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    setRows(parseOutstandingTools(data));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const visible = sortOutstandingTools(
    externalOnly ? rows.filter(isExternalHolder) : rows,
    { key: sortKey, desc },
  );
  const summary = summariseOutstandingTools(visible);

  function toggleSort(key: OutstandingSortKey) {
    if (key === sortKey) { setDesc((current) => !current); return; }
    setSortKey(key);
    // เปลี่ยนคอลัมน์แล้วเริ่มจากทิศที่มีประโยชน์ที่สุดของคอลัมน์นั้น
    setDesc(key === "days" || key === "qty");
  }

  return <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-slate-950">🔧 เครื่องมือที่ยังไม่ได้คืน</h2>
        <p className="mt-1 text-xs text-slate-500">
          เครื่องมือที่จ่ายออกไปกับทีมช่างแล้วยังกลับมาไม่ครบ · เรียงจากค้างนานสุดก่อน
          · ช่างเคลียร์ยอดเองได้จากหน้าจอหน้างาน
        </p>
      </div>
      <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600">รีเฟรช</button>
    </div>

    {loading ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">กำลังโหลด…</div> : null}

    {!loading && error ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
      {error}
      <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">ลองใหม่</button>
    </div> : null}

    {!loading && !error ? <>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
          ค้าง {summary.lines} รายการ · {summary.totalQty} ชิ้น · {summary.teams} ทีม
        </span>
        {summary.critical > 0 ? <span className="rounded-full bg-rose-200 px-2.5 py-1 font-medium text-rose-900">ค้างเกิน 7 วัน {summary.critical}</span> : null}
        {summary.external > 0 ? <span className="rounded-full bg-violet-200 px-2.5 py-1 font-medium text-violet-900">อยู่กับทีมภายนอก {summary.external}</span> : null}
        {summary.cancelled > 0 ? <span className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-white" title={CANCELLED_TOOL_EXPLANATION}>งานถูกยกเลิกแล้ว {summary.cancelled}</span> : null}
        {summary.oldestDays > 0 ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">นานสุด {daysOutLabel(summary.oldestDays)}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">เรียงตาม</span>
        {SORT_BUTTONS.map((button) => <button
          key={button.key}
          type="button"
          onClick={() => toggleSort(button.key)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${sortKey === button.key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600"}`}
        >{button.label}{sortKey === button.key ? (desc ? " ↓" : " ↑") : ""}</button>)}
        <button
          type="button"
          onClick={() => setExternalOnly((current) => !current)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${externalOnly ? "bg-violet-600 text-white" : "border border-violet-300 text-violet-700"}`}
        >เฉพาะทีมภายนอก</button>
      </div>

      {!visible.length ? <div className="mt-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-8 text-center text-sm text-emerald-700">
        {externalOnly ? "ไม่มีเครื่องมือค้างอยู่กับทีมภายนอก" : "ไม่มีเครื่องมือค้างคืน — ของกลับคลังครบทุกชิ้น"}
      </div> : <div className="mt-3 space-y-2">
        {visible.map((row) => {
          const level = overdueLevel(row.daysOut);
          const phone = callablePhone(row);
          const cancelledJob = isCancelledJobHolder(row);
          return <article key={row.itemId} className={`rounded-xl border p-3 ${LEVEL_STYLE[level]}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-slate-950">
                  {row.itemName}{row.sku ? ` · ${row.sku}` : ""}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  #{row.jobNo}{row.customerName ? ` · ${row.customerName}` : ""} · นัดติดตั้ง {thaiDate(row.appointmentStart)}
                </div>
                {cancelledJob ? <div className="mt-1.5">
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-white">🚫 {CANCELLED_TOOL_BADGE}</span>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{CANCELLED_TOOL_EXPLANATION}</p>
                </div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${LEVEL_BADGE[level]}`}>
                  {daysOutLabel(row.daysOut)} · {OVERDUE_LEVEL_LABELS[level]}
                </span>
                <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
                  ค้าง {row.outstandingQty} {row.unit}
                </span>
              </div>
            </div>

            <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
              <div>
                <span className="text-slate-400">อยู่กับ: </span>
                <span className="font-medium">{holderLabel(row)}</span>
                {isExternalHolder(row) ? <span className="ml-1 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900">ทีมภายนอก</span> : null}
              </div>
              <div>
                <span className="text-slate-400">โทรหา: </span>
                {phone ? <a href={`tel:${phone}`} className="font-medium text-blue-700 underline">{phone}</a> : <span className="text-slate-400">ยังไม่มีเบอร์ในระบบ</span>}
              </div>
              <div className="text-slate-500">รู้ตัวคนจาก: {holderSourceLabel(row)}</div>
              <div className="text-slate-500">
                เบิกออกไป {row.pickedQty} · คืนแล้ว {row.returnedQty} · ออกจากคลัง {thaiDate(row.outSince)}
              </div>
            </div>

            {row.pickNote || row.usageNote ? <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-xs text-slate-600">
              {row.pickNote ? <div>หมายเหตุคลังตอนหยิบ: {row.pickNote}</div> : null}
              {row.usageNote ? <div>หมายเหตุจากช่าง: {row.usageNote}</div> : null}
            </div> : null}
          </article>;
        })}
      </div>}
    </> : null}
  </section>;
}

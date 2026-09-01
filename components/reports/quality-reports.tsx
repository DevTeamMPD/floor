"use client";

/**
 * P4-6 — สามรายงานคุณภาพตาม ISO 9001 ข้อ 9.1.3 บนหน้า "คุณภาพและความพึงพอใจ"
 *
 * ทำไมอยู่ที่นี่ ไม่ใช่หน้าใหม่
 *   เมนูซ้ายเรียกหน้านี้ว่า "คุณภาพและความพึงพอใจ" อยู่แล้ว แต่ทั้งหน้ามีแต่ความพึงพอใจ
 *   ที่ดึงจาก Google Form ส่วน "คุณภาพ" ที่เป็นข้อมูลภายในยังไม่เคยมีที่อยู่
 *   การเพิ่มเมนูที่ 21 ให้คนต้องจำเพิ่ม แย่กว่าการทำให้หน้าที่สัญญาไว้แล้วพูดครบ
 *
 * ทำไมไม่ใส่ไว้ในก้อน loading ของ CSAT
 *   ทั้งหน้าถูกครอบด้วยสถานะโหลดของ Google Sheet ถ้าชีตล่ม รายงานคุณภาพจะหายไปด้วย
 *   ทั้งที่อ่านคนละแหล่งกันคนละที่ ส่วนนี้จึงโหลดของตัวเองแยกและพังแยก
 *
 * เรื่องกราฟ: โปรเจกต์นี้วาดกราฟด้วย SVG/div ที่เขียนเองทุกที่ (app/(admin)/exec/page.tsx)
 *   ถึงจะมี recharts ใน package.json แต่ไม่มีหน้าไหนเรียกใช้เลย จึงไม่เพิ่มการพึ่งพาใหม่
 *   และไม่ปลุกไลบรารีที่ทั้งแอปไม่ได้ใช้ขึ้นมาเพื่อกราฟแท่งแนวนอนสิบแท่ง
 *   แอปนี้ไม่มีธีมมืด (ไม่มี dark: หรือ prefers-color-scheme ที่ไหนเลย) ส่วนนี้จึงใช้
 *   ชุดสีสว่างชุดเดียวกับทั้งแอป — ถ้าวันหนึ่งแอปมีธีมมืด ต้องแก้ทั้งแอปพร้อมกัน ไม่ใช่แก้เฉพาะที่นี่
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { floorErrorMessage } from "@/lib/floor-error-message";
import {
  ACCEPTANCE_FAILURES_RPC,
  MATERIAL_SHORTAGES_RPC,
  PICK_VS_USE_RPC,
  acceptanceNotice,
  groupAcceptanceFailures,
  groupMaterialShortages,
  groupPickVsUseByJob,
  groupPickVsUseByMaterial,
  parseAcceptanceEnvelope,
  parsePickVsUseEnvelope,
  parseShortageEnvelope,
  pickVsUseNotice,
  shortageNotice,
  type AcceptanceRow,
  type PickVsUseRow,
  type ReportEnvelope,
  type ReportNotice,
  type ShortageRow,
} from "@/lib/quality-reports";

const BAD = "#C0392B";
const WARN = "#C2820E";
const GOOD = "#15935E";
const ACCENT = "#2563EB";

type RangeKey = "30" | "90" | "365" | "all";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "30", label: "30 วัน" },
  { key: "90", label: "90 วัน" },
  { key: "365", label: "1 ปี" },
  { key: "all", label: "ทั้งหมด" },
];

function bangkokToday(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map((v) => Number(v));
  const base = Date.UTC(y, (m || 1) - 1, d || 1);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function fmtQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function fmtSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${fmtQty(value)}`;
}

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });
}

/* --------------------------------------------------------------------- ชิ้นส่วน UI */

function Notice({ notice }: { notice: ReportNotice }) {
  const palette =
    notice.tone === "filtered"
      ? { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700", icon: "🔍" }
      : notice.tone === "partial"
        ? { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900", icon: "⏳" }
        : { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-900", icon: "ℹ️" };
  return (
    <div className={`${palette.bg} ${palette.border} ${palette.text} rounded-xl border px-4 py-3`}>
      <div className="text-sm font-semibold">
        {palette.icon} {notice.title}
      </div>
      <p className="mt-1 text-xs leading-relaxed">{notice.why}</p>
      {notice.steps.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold opacity-80">ต้องเกิดอะไรขึ้น รายงานนี้ถึงจะมีข้อมูล</div>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
            {notice.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** กราฟแท่งแนวนอน — อ่านง่ายกว่าแท่งตั้งเมื่อป้ายชื่อเป็นภาษาไทยยาว ๆ */
function BarRow({ label, sub, value, max, color, valueText }: { label: string; sub?: string; value: number; max: number; color: string; valueText: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-slate-800" title={label}>
          {label}
        </div>
        {sub && <div className="truncate text-[11px] text-slate-400">{sub}</div>}
      </div>
      <div className="text-xs font-bold tabular-nums" style={{ color }}>
        {valueText}
      </div>
      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Card({ title, subtitle, badge, children }: { title: string; subtitle: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-slate-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{badge}</span>}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">{subtitle}</p>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ ตัวหลัก */

export default function QualityReports() {
  const today = useMemo(() => bangkokToday(), []);
  const [range, setRange] = useState<RangeKey>("90");
  const [from, setFrom] = useState<string>(() => shiftDays(bangkokToday(), -89));
  const [to, setTo] = useState<string>(() => bangkokToday());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acceptance, setAcceptance] = useState<ReportEnvelope<AcceptanceRow> | null>(null);
  const [shortages, setShortages] = useState<ReportEnvelope<ShortageRow> | null>(null);
  const [pickVsUse, setPickVsUse] = useState<ReportEnvelope<PickVsUseRow> | null>(null);
  const [pickView, setPickView] = useState<"material" | "job">("material");

  const applyRange = useCallback(
    (key: RangeKey) => {
      setRange(key);
      if (key === "all") return;
      const end = bangkokToday();
      setTo(end);
      setFrom(shiftDays(end, -(Number(key) - 1)));
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const args = range === "all" ? { p_from: null, p_to: null } : { p_from: from, p_to: to };
    const [a, b, c] = await Promise.all([
      supabase.rpc(ACCEPTANCE_FAILURES_RPC, args),
      supabase.rpc(MATERIAL_SHORTAGES_RPC, args),
      supabase.rpc(PICK_VS_USE_RPC, args),
    ]);
    const firstError = a.error ?? b.error ?? c.error;
    if (firstError) {
      setErr(floorErrorMessage(firstError));
      setAcceptance(null);
      setShortages(null);
      setPickVsUse(null);
    } else {
      setAcceptance(parseAcceptanceEnvelope(a.data));
      setShortages(parseShortageEnvelope(b.data));
      setPickVsUse(parsePickVsUseEnvelope(c.data));
    }
    setLoading(false);
  }, [range, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const criteria = useMemo(() => (acceptance ? groupAcceptanceFailures(acceptance.rows) : []), [acceptance]);
  const shortageStats = useMemo(() => (shortages ? groupMaterialShortages(shortages.rows) : []), [shortages]);
  const pickStats = useMemo(() => {
    if (!pickVsUse) return [];
    return pickView === "material" ? groupPickVsUseByMaterial(pickVsUse.rows) : groupPickVsUseByJob(pickVsUse.rows);
  }, [pickVsUse, pickView]);

  const acceptanceMsg = acceptance ? acceptanceNotice(acceptance) : null;
  const shortageMsg = shortages ? shortageNotice(shortages) : null;
  const pickMsg = pickVsUse ? pickVsUseNotice(pickVsUse) : null;

  const topCriteria = criteria.filter((c) => c.fail > 0).slice(0, 10);
  const maxFail = topCriteria.reduce((m, c) => Math.max(m, c.fail), 0);
  const topShortages = shortageStats.slice(0, 10);
  const maxShortEvents = topShortages.reduce((m, s) => Math.max(m, s.events), 0);
  const topGaps = pickStats.slice(0, 10);
  const maxGap = topGaps.reduce((m, s) => Math.max(m, Math.abs(s.varianceVsPlan ?? 0)), 0);

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">📐 รายงานคุณภาพภายใน (ISO 9001 ข้อ 9.1.3)</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            สามคำถามที่บริษัทต้องตอบได้จากข้อมูลของตัวเอง — ไม่ใช่จากความทรงจำของคน · อ่านอย่างเดียว ไม่มีการแก้ไขข้อมูลจากหน้านี้
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          disabled={loading}
        >
          {loading ? "⏳ กำลังโหลด..." : "🔄 โหลดใหม่"}
        </button>
      </div>

      {/* ช่วงวันที่ */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white p-3">
        <span className="text-xs font-medium text-slate-500">ช่วงเวลา</span>
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => applyRange(option.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              range === option.key ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-xs text-slate-500">
          ตั้งแต่
          <input
            type="date"
            value={from}
            max={to}
            disabled={range === "all"}
            onChange={(e) => {
              setRange("30");
              setFrom(e.target.value);
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-300"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          ถึง
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            disabled={range === "all"}
            onChange={(e) => {
              setRange("30");
              setTo(e.target.value);
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-300"
          />
        </label>
        {range === "all" && <span className="text-[11px] text-slate-400">กำลังดูข้อมูลทั้งหมดที่มี ไม่จำกัดวันที่</span>}
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠️ อ่านรายงานไม่สำเร็จ: {err}
        </div>
      )}

      {loading && !acceptance && <div className="py-10 text-center text-sm text-slate-400">⏳ กำลังโหลดรายงาน...</div>}

      {/* ---------------------------------------------- รายงานที่ 1 */}
      {acceptance && (
        <Card
          title="1. เกณฑ์ตรวจรับข้อไหนตกบ่อยที่สุด"
          badge={acceptance.rowCount > 0 ? `${acceptance.rowCount} ผลตรวจในช่วงนี้` : undefined}
          subtitle="นับตามรหัสถาวรของเกณฑ์ (QC01, QC02, …) ไม่ใช่ตามรุ่นของแม่แบบ — ข้อเดิมที่ถูกแก้ชื่อหรือย้ายไปแม่แบบรุ่นใหม่จึงยังนับรวมเป็นข้อเดียวกัน ซึ่งคือเหตุผลทั้งหมดที่รหัสนี้มีอยู่ อัตราตกใช้ตัวหารเป็น ผ่าน+ไม่ผ่าน เท่านั้น ไม่นับ “ไม่เกี่ยวข้อง”"
        >
          {acceptanceMsg ? (
            <Notice notice={acceptanceMsg} />
          ) : topCriteria.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              ✅ ในช่วงนี้มีการตรวจรับ {acceptance.rowCount} รายการ และไม่มีเกณฑ์ข้อไหนถูกบันทึกว่า “ไม่ผ่าน” เลย
            </div>
          ) : (
            <div className="space-y-3">
              {topCriteria.map((c) => (
                <div key={c.itemCode}>
                  <BarRow
                    label={`${c.itemCode} · ${c.displayLabel}`}
                    sub={`ตก ${c.fail} จาก ${c.judged} ครั้งที่ตัดสิน · กระทบ ${c.jobsWithFail} งาน · ตกล่าสุด ${fmtDateTime(c.lastFailAt)}`}
                    value={c.fail}
                    max={maxFail}
                    color={c.failRate !== null && c.failRate >= 50 ? BAD : c.failRate !== null && c.failRate >= 20 ? WARN : ACCENT}
                    valueText={c.failRate === null ? `${c.fail} ครั้ง` : `${c.fail} ครั้ง (${c.failRate}%)`}
                  />
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {c.isCritical && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">ข้อวิกฤต</span>}
                    {c.spansTemplateVersions && (
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                        รวมข้ามแม่แบบรุ่น {c.templateVersions.join(", ")}
                      </span>
                    )}
                    {c.labelChanged && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800" title={c.labelHistory.join(" ← ")}>
                        เคยใช้ชื่อ “{c.labelHistory[c.labelHistory.length - 1]}”
                      </span>
                    )}
                    {c.removedFromActiveTemplate && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">ไม่มีในแม่แบบรุ่นปัจจุบันแล้ว</span>
                    )}
                  </div>
                </div>
              ))}
              {criteria.length > topCriteria.length && (
                <p className="text-[11px] text-slate-400">
                  แสดง {topCriteria.length} ข้อแรกจากทั้งหมด {criteria.length} ข้อที่มีผลตรวจในช่วงนี้
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ---------------------------------------------- รายงานที่ 2 */}
      {shortages && (
        <Card
          title="2. ของขาดบ่อยที่สุด"
          badge={shortages.rowCount > 0 ? `${shortages.rowCount} ครั้งในช่วงนี้` : undefined}
          subtitle="นับจากสิ่งที่ช่างยืนยันตอนรับของหน้างานว่า “ของมาไม่ครบ” เท่านั้น — ไม่ได้นับจากคำเตือน “ของไม่พอ” ที่ระบบส่งล่วงหน้า เพราะคำเตือนเป็นคำทำนายรายงาน ไม่มีคอลัมน์วัสดุให้นับรายตัว ส่งซ้ำได้ทุกวัน และเตือนแล้วของมาทันคือไม่เคยขาดจริง ส่วน NC โลจิสติกส์เป็นผลพวงของแถวเดียวกัน จึงแสดงเป็นตัวเลขประกอบ ไม่ใช่ตัวตั้ง"
        >
          {shortageMsg ? (
            <Notice notice={shortageMsg} />
          ) : (
            <div className="space-y-3">
              {topShortages.map((s) => (
                <div key={s.materialKey}>
                  <BarRow
                    label={s.itemName ?? s.materialKey}
                    sub={`${s.sku ? `${s.sku} · ` : ""}ขาดรวม ${fmtQty(s.shortageQty)} ${s.unit ?? ""} · ${s.jobs} งาน · ส่วนใหญ่เพราะ ${s.topReasonLabel ?? "—"}`}
                    value={s.events}
                    max={maxShortEvents}
                    color={s.notReceivedEvents > 0 ? BAD : WARN}
                    valueText={`${s.events} ครั้ง`}
                  />
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {s.notReceivedEvents > 0 && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">ไม่ได้รับเลย {s.notReceivedEvents} ครั้ง</span>
                    )}
                    {s.partialEvents > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">ได้ไม่ครบ {s.partialEvents} ครั้ง</span>}
                    {s.ncrOpened > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">เปิด NC แล้ว {s.ncrOpened} ใบ</span>}
                  </div>
                </div>
              ))}
              {shortageStats.length > topShortages.length && (
                <p className="text-[11px] text-slate-400">
                  แสดง {topShortages.length} รายการแรกจากทั้งหมด {shortageStats.length} รายการ
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ---------------------------------------------- รายงานที่ 3 */}
      {pickVsUse && (
        <Card
          title="3. เบิกไป vs ใช้จริง"
          badge={pickVsUse.rowCount > 0 ? `${pickVsUse.rowCount} บรรทัดในช่วงนี้` : undefined}
          subtitle="“ประมาณไว้” คือตัวเลขที่สูตรในแม่แบบคำนวณให้ (หรือที่หัวหน้าช่างกรอกทับเอง) ไม่ใช่ความจริง ความจริงคือเบิกไปเท่าไหร่ ใช้จริงเท่าไหร่ คืนคลังเท่าไหร่ ช่องว่างระหว่างสองอย่างนี้คือวัตถุดิบของการแก้สูตรแม่แบบรอบหน้า ไม่ใช่คะแนนความผิดของใคร · นับเฉพาะของสิ้นเปลือง ไม่รวมเครื่องมือที่ต้องคืน"
        >
          {pickMsg ? (
            <Notice notice={pickMsg} />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-slate-500">ดูแบบ</span>
                {(
                  [
                    { key: "material", label: "รายวัสดุ" },
                    { key: "job", label: "รายงาน" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setPickView(option.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      pickView === option.key ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-slate-400">
                      <th className="py-2 pr-2 font-medium">{pickView === "material" ? "วัสดุ" : "เลขที่งาน"}</th>
                      <th className="py-2 px-2 text-right font-medium">ประมาณไว้</th>
                      <th className="py-2 px-2 text-right font-medium">เบิกไป</th>
                      <th className="py-2 px-2 text-right font-medium">คืนคลัง</th>
                      <th className="py-2 px-2 text-right font-medium">ใช้จริง</th>
                      <th className="py-2 pl-2 text-right font-medium">ส่วนต่างจากที่ประมาณ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topGaps.map((s) => (
                      <tr key={s.key} className="border-b border-slate-50 align-top">
                        <td className="py-2 pr-2">
                          <div className="max-w-[260px] truncate font-medium text-slate-800" title={s.label}>
                            {s.label}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {s.lines} บรรทัด
                            {pickView === "material" ? ` · ${s.jobs} งาน` : ""}
                            {s.unit ? ` · หน่วย ${s.unit}` : ""}
                            {s.manualOverrideLines > 0 ? ` · กรอกทับเอง ${s.manualOverrideLines} บรรทัด` : ""}
                            {s.templateLines > 0 ? ` · จากแม่แบบ ${s.templateLines} บรรทัด` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500">{fmtQty(s.planned)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                          {s.linesWithPick === 0 ? <span className="text-slate-300">ยังไม่มีใครหยิบ</span> : fmtQty(s.picked)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                          {s.linesWithReturn === 0 ? <span className="text-slate-300">—</span> : fmtQty(s.returned)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                          {s.linesWithUsage === 0 ? <span className="text-slate-300">ยังไม่ปิดยอด</span> : fmtQty(s.used)}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          {s.varianceVsPlan === null ? (
                            <span className="text-slate-300">เทียบไม่ได้</span>
                          ) : (
                            <span
                              className="font-bold tabular-nums"
                              style={{ color: Math.abs(s.variancePct ?? 0) >= 20 ? BAD : Math.abs(s.variancePct ?? 0) >= 5 ? WARN : GOOD }}
                            >
                              {fmtSigned(s.varianceVsPlan)}
                              {s.variancePct !== null ? ` (${fmtSigned(s.variancePct)}%)` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {maxGap > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-500">ส่วนต่างที่มากที่สุด (ออกจากคลังสุทธิ ลบ ที่ประมาณไว้)</div>
                  {topGaps
                    .filter((s) => s.varianceVsPlan !== null && s.varianceVsPlan !== 0)
                    .slice(0, 8)
                    .map((s) => (
                      <BarRow
                        key={`gap-${s.key}`}
                        label={s.label}
                        sub={(s.varianceVsPlan ?? 0) > 0 ? "เบิกเกินกว่าที่แม่แบบประมาณไว้" : "เบิกน้อยกว่าที่แม่แบบประมาณไว้"}
                        value={Math.abs(s.varianceVsPlan ?? 0)}
                        max={maxGap}
                        color={(s.varianceVsPlan ?? 0) > 0 ? BAD : ACCENT}
                        valueText={fmtSigned(s.varianceVsPlan ?? 0)}
                      />
                    ))}
                </div>
              )}

              {pickStats.length > topGaps.length && (
                <p className="mt-3 text-[11px] text-slate-400">
                  แสดง {topGaps.length} รายการแรกจากทั้งหมด {pickStats.length} รายการ
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {(acceptance?.truncated || shortages?.truncated || pickVsUse?.truncated) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠️ ข้อมูลในช่วงนี้ยาวเกินเพดานที่ระบบส่งได้ต่อครั้ง ({acceptance?.rowCap ?? 20000} แถว) ตัวเลขที่เห็นจึงยังไม่ครบทั้งช่วง — ให้แคบช่วงวันที่ลงแล้วดูทีละช่วง
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-400">
        ข้อมูลอ่านจากฐานข้อมูลโดยตรงผ่านทางอ่านที่เปิดให้เฉพาะพนักงานที่มีสิทธิ์ (ผู้ดูแลระบบ ผู้บริหาร หัวหน้าช่าง คลัง และ CS)
        {acceptance?.generatedAt ? ` · ดึงเมื่อ ${new Date(acceptance.generatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}` : ""}
      </p>
    </div>
  );
}

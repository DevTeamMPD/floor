"use client";

/**
 * P4-3 — ทะเบียนเครื่องมือวัด (measuring_devices)
 *
 * ทำไมอยู่ในหน้า "แม่แบบงาน" ไม่ใช่หน้าใหม่:
 * ชนิดเครื่องมือ (measuring_device_kind) ถูก "ประกาศ" ที่แม่แบบเกณฑ์ตรวจรับในหน้านี้อยู่แล้ว
 * คนที่พิมพ์ว่าเกณฑ์ข้อนี้ต้องวัดด้วยฟีลเลอร์เกจ คือคนเดียวกับที่ต้องรู้ว่าบริษัทมีฟีลเลอร์เกจกี่ตัว
 * และตัวไหนเลยกำหนดสอบเทียบแล้ว การแยกเป็นหน้าใหม่แปลว่าต้องจำว่ามีหน้านั้นอยู่ ซึ่งไม่มีใครจำ
 * สิทธิ์ก็ชุดเดียวกัน (admin / head_technician) จึงไม่ต้องเพิ่มด่านใหม่ให้ผิดพลาดได้อีกจุด
 *
 * ทุกการเขียนผ่าน RPC upsert_measuring_device เท่านั้น (security definer, ตรวจ role ในตัวฟังก์ชัน)
 * หน้าจอไม่คำนวณ next_due_at เอง — ฐานข้อมูลคำนวณจาก last_calibrated_at + รอบสอบเทียบ
 * ถ้าหน้าจอคำนวณเองด้วย วันครบกำหนดจะเพี้ยนจากของจริงได้โดยไม่มีใครจับได้
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { floorActionError, floorErrorMessage } from "@/lib/floor-error-message";
import { createClient } from "@/lib/supabase/client";
import {
  MEASURING_DEVICES_RPC,
  MEASURING_DEVICE_STATUS_LABELS,
  MEASURING_DEVICE_UPSERT_RPC,
  MEASURING_DEVICE_USAGE_RPC,
  NO_DEVICE_USAGE_NOTICE,
  NO_MEASURING_DEVICES_NOTICE,
  deviceCalibrationLabel,
  parseMeasuringDeviceUsage,
  parseMeasuringDevices,
  type MeasuringDevice,
  type MeasuringDeviceStatus,
  type MeasuringDeviceUsageRow,
} from "@/lib/job-acceptance";

const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50";
const PRIMARY = "min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const SECONDARY = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

interface DraftState {
  id: string | null;
  code: string;
  kind: string;
  ownerTeamId: string;
  rangeText: string;
  resolutionText: string;
  lastCalibratedAt: string;
  calibrationIntervalDays: string;
  status: MeasuringDeviceStatus;
  note: string;
}

function emptyDraft(): DraftState {
  return { id: null, code: "", kind: "", ownerTeamId: "", rangeText: "", resolutionText: "", lastCalibratedAt: "", calibrationIntervalDays: "", status: "ok", note: "" };
}

function draftFromDevice(device: MeasuringDevice): DraftState {
  return {
    id: device.id,
    code: device.code,
    kind: device.kind,
    ownerTeamId: device.ownerTeamId ?? "",
    rangeText: device.rangeText ?? "",
    resolutionText: device.resolutionText ?? "",
    lastCalibratedAt: device.lastCalibratedAt ?? "",
    calibrationIntervalDays: device.calibrationIntervalDays != null ? String(device.calibrationIntervalDays) : "",
    status: device.status,
    note: device.note ?? "",
  };
}

function thaiDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

export default function MeasuringDeviceRegistry({ canEdit, kindsInUse }: { canEdit: boolean; kindsInUse: string[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [devices, setDevices] = useState<MeasuringDevice[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [usageFor, setUsageFor] = useState<string | null>(null);
  const [usage, setUsage] = useState<MeasuringDeviceUsageRow[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc(MEASURING_DEVICES_RPC);
    if (error) { setLoadError(floorErrorMessage(error)); setDevices([]); }
    else { setLoadError(null); setDevices(parseMeasuringDevices(data)); }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void supabase.from("tech_teams").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setTeams((data as { id: string; name: string }[]) ?? []));
  }, [supabase]);

  async function save() {
    if (!draft) return;
    if (!draft.code.trim()) { toast.error("ต้องระบุรหัสเครื่องมือ"); return; }
    if (!draft.kind.trim()) { toast.error("ต้องระบุชนิดเครื่องมือ"); return; }
    const interval = draft.calibrationIntervalDays.trim() ? Number(draft.calibrationIntervalDays.trim()) : null;
    if (interval !== null && (!Number.isFinite(interval) || interval <= 0)) {
      toast.error("รอบสอบเทียบต้องเป็นจำนวนวันที่มากกว่า 0");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc(MEASURING_DEVICE_UPSERT_RPC, {
        p_id: draft.id,
        p_code: draft.code.trim(),
        p_kind: draft.kind.trim(),
        p_owner_team_id: draft.ownerTeamId || null,
        p_range_text: draft.rangeText.trim() || null,
        p_resolution_text: draft.resolutionText.trim() || null,
        p_last_calibrated_at: draft.lastCalibratedAt || null,
        p_calibration_interval_days: interval,
        p_status: draft.status,
        p_note: draft.note.trim() || null,
      });
      if (error) throw error;
      toast.success(draft.id ? "แก้ไขข้อมูลเครื่องมือแล้ว" : "เพิ่มเครื่องมือเข้าทะเบียนแล้ว");
      setDraft(null);
      await load();
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกทะเบียนเครื่องมือวัด", e), { duration: 15000 });
    }
    setSaving(false);
  }

  async function openUsage(deviceId: string) {
    if (usageFor === deviceId) { setUsageFor(null); setUsage(null); return; }
    setUsageFor(deviceId); setUsage(null); setUsageLoading(true);
    const { data, error } = await supabase.rpc(MEASURING_DEVICE_USAGE_RPC, { p_device_id: deviceId });
    if (error) { toast.error(floorActionError("ดูประวัติการใช้เครื่องมือวัด", error)); setUsage([]); }
    else setUsage(parseMeasuringDeviceUsage(data));
    setUsageLoading(false);
  }

  const missingKinds = kindsInUse.filter((kind) => !devices.some((device) => device.kind.trim() === kind.trim()));

  return <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">📏 ทะเบียนเครื่องมือวัด</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          เครื่องมือที่ใช้วัดค่าในการตรวจรับงาน · ผลวัดจะเชื่อถือได้ต่อเมื่อรู้ว่าวัดด้วยเครื่องไหนและเครื่องนั้นสอบเทียบล่าสุดเมื่อไร
          <br />วันครบกำหนดสอบเทียบระบบคำนวณให้เองจาก “สอบเทียบล่าสุด + รอบสอบเทียบ” จึงไม่มีช่องให้กรอกเอง
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void load()} className={SECONDARY}>รีเฟรช</button>
        {canEdit ? <button type="button" onClick={() => setDraft(emptyDraft())} className={PRIMARY}>+ เพิ่มเครื่องมือ</button> : null}
      </div>
    </div>

    {loading ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">กำลังโหลดทะเบียนเครื่องมือวัด…</div> : null}

    {!loading && loadError ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
      อ่านทะเบียนเครื่องมือวัดไม่สำเร็จ: {loadError}
      <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">ลองใหม่</button>
    </div> : null}

    {!loading && !loadError && !devices.length ? <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center">
      <div className="text-sm font-semibold text-amber-900">{NO_MEASURING_DEVICES_NOTICE}</div>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-amber-800">
        ตอนนี้ยังไม่มีเครื่องมือให้เลือกในหน้าบันทึกผลตรวจรับ ผู้ตรวจจึงกรอกได้แค่ค่าที่วัดได้ แต่บอกไม่ได้ว่าวัดด้วยเครื่องไหน
        {canEdit ? " กด “เพิ่มเครื่องมือ” เพื่อเริ่มลงทะเบียนเครื่องแรก" : " แจ้งผู้ดูแลระบบหรือหัวหน้าช่างให้ลงทะเบียนเครื่องมือก่อน"}
      </p>
    </div> : null}

    {!loading && !loadError && devices.length && missingKinds.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
      แม่แบบเกณฑ์ตรวจรับอ้างถึงเครื่องมือชนิดที่ยังไม่มีในทะเบียน: {missingKinds.join(" · ")}
      <br />ข้อที่ใช้ชนิดเหล่านี้จะยังเลือกเครื่องมือตรงชนิดไม่ได้จนกว่าจะลงทะเบียนเพิ่ม
    </div> : null}

    {devices.length ? <div className="mt-4 space-y-2">
      {devices.map((device) => <article key={device.id} className={`rounded-xl border p-3 ${device.status === "out_of_service" ? "border-slate-300 bg-slate-50" : device.isOverdue || device.status === "due" ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-slate-900">{device.code}</span>
              <span className="text-sm text-slate-700">{device.kind}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${device.status === "ok" ? "bg-emerald-100 text-emerald-800" : device.status === "due" ? "bg-amber-200 text-amber-900" : "bg-slate-300 text-slate-800"}`}>
                {MEASURING_DEVICE_STATUS_LABELS[device.status]}
              </span>
              {device.isOverdue ? <span className="rounded-full bg-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-900">เลยกำหนดสอบเทียบ</span> : null}
              {!device.calibrationKnown ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">ยังไม่รู้วันสอบเทียบ</span> : null}
            </div>
            <div className="mt-1 text-xs text-slate-600">{deviceCalibrationLabel(device)}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {device.ownerTeamName ? `ทีมที่ถือ: ${device.ownerTeamName} · ` : "ไม่ได้ผูกกับทีมใด · "}
              {device.rangeText ? `ช่วงวัด ${device.rangeText} · ` : ""}
              {device.resolutionText ? `ความละเอียด ${device.resolutionText}` : ""}
            </div>
            {device.note ? <div className="mt-0.5 text-xs text-slate-500">หมายเหตุ: {device.note}</div> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
              ใช้กับ {device.jobsSinceCalibration} งาน · {device.readingsSinceCalibration} ค่าวัด
            </span>
            <span className="text-[11px] text-slate-500">นับหลังสอบเทียบล่าสุด · ใช้ครั้งสุดท้าย {thaiDateTime(device.lastUsedAt)}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => void openUsage(device.id)} className={SECONDARY}>
            {usageFor === device.id ? "ปิดประวัติการใช้งาน" : "ดูว่าใช้กับงานไหนบ้าง"}
          </button>
          {canEdit ? <button type="button" onClick={() => setDraft(draftFromDevice(device))} className={SECONDARY}>แก้ไข</button> : null}
        </div>

        {usageFor === device.id ? <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {usageLoading ? <div className="text-xs text-slate-500">กำลังโหลดประวัติการใช้งาน…</div>
            : !usage?.length ? <div className="text-xs text-slate-500">{NO_DEVICE_USAGE_NOTICE}</div>
            : <ul className="space-y-1.5">
                {usage.map((row) => <li key={`${row.deviceId}-${row.jobNo}`} className="text-xs text-slate-700">
                  <span className="font-semibold">#{row.jobNo}</span>{row.customerName ? ` · ${row.customerName}` : ""}
                  {" · "}{row.readings} ค่าวัด ({row.itemCodes.join(", ")})
                  {" · "}ล่าสุด {thaiDateTime(row.lastUsedAt)}
                </li>)}
              </ul>}
        </div> : null}
      </article>)}
    </div> : null}

    {draft ? <div role="dialog" aria-modal="true" aria-label="ข้อมูลเครื่องมือวัด" className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDraft(null); }}>
      <section className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-900">{draft.id ? "แก้ไขเครื่องมือวัด" : "เพิ่มเครื่องมือวัดเข้าทะเบียน"}</h3>
          <p className="mt-1 text-xs text-slate-500">รหัสและชนิดเป็นข้อมูลที่ต้องระบุ · ชนิดควรพิมพ์ให้ตรงกับที่ระบุไว้ในแม่แบบเกณฑ์ตรวจรับ เพื่อให้ระบบจับคู่ให้อัตโนมัติ</p>
        </header>
        <div className="grid gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">รหัสเครื่องมือ <span className="text-rose-600">*</span>
            <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="เช่น FG-01" className={`${INPUT} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-600">ชนิดเครื่องมือ <span className="text-rose-600">*</span>
            <input list="measuring-device-kinds" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} placeholder="เช่น ฟีลเลอร์เกจ" className={`${INPUT} mt-1`} />
            <datalist id="measuring-device-kinds">{kindsInUse.map((kind) => <option key={kind} value={kind} />)}</datalist>
          </label>
          <label className="text-xs font-medium text-slate-600">ทีมที่ถือเครื่องมือ
            <select value={draft.ownerTeamId} onChange={(e) => setDraft({ ...draft, ownerTeamId: e.target.value })} className={`${INPUT} mt-1`}>
              <option value="">ไม่ผูกกับทีมใด (ของกลาง)</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">สถานะ
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as MeasuringDeviceStatus })} className={`${INPUT} mt-1`}>
              {(["ok", "due", "out_of_service"] as MeasuringDeviceStatus[]).map((status) => <option key={status} value={status}>{MEASURING_DEVICE_STATUS_LABELS[status]}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">ช่วงวัด
            <input value={draft.rangeText} onChange={(e) => setDraft({ ...draft, rangeText: e.target.value })} placeholder="เช่น 0.05–1.00 mm" className={`${INPUT} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-600">ความละเอียด
            <input value={draft.resolutionText} onChange={(e) => setDraft({ ...draft, resolutionText: e.target.value })} placeholder="เช่น 0.05 mm" className={`${INPUT} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-600">สอบเทียบล่าสุด
            <input type="date" value={draft.lastCalibratedAt} onChange={(e) => setDraft({ ...draft, lastCalibratedAt: e.target.value })} className={`${INPUT} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-600">รอบสอบเทียบ (วัน)
            <input inputMode="numeric" value={draft.calibrationIntervalDays} onChange={(e) => setDraft({ ...draft, calibrationIntervalDays: e.target.value })} placeholder="เช่น 365" className={`${INPUT} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">หมายเหตุ
            <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="เช่น ใบรับรองเลขที่ …" className={`${INPUT} mt-1`} />
          </label>
          <p className="text-[11px] leading-relaxed text-slate-500 sm:col-span-2">
            ถ้าไม่กรอกวันสอบเทียบล่าสุดหรือรอบสอบเทียบ ระบบจะไม่คิดวันครบกำหนดให้ และจะแสดงว่า “ยังไม่รู้วันสอบเทียบล่าสุด”
            ซึ่งตั้งใจให้หน้าตาไม่เหมือน “ยังไม่ครบกำหนด” เพราะสองอย่างนี้ไม่เหมือนกัน
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" disabled={saving} onClick={() => setDraft(null)} className={SECONDARY}>ยกเลิก</button>
          <button type="button" disabled={saving || !draft.code.trim() || !draft.kind.trim()} onClick={() => void save()} className={PRIMARY}>
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </footer>
      </section>
    </div> : null}
  </section>;
}

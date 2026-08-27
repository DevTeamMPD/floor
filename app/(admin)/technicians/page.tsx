"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

interface Technician {
  id: string;
  name: string;
  phone: string | null;
  personal_token: string;
  is_team_lead: boolean;
  created_at: string;
  device_count: number;
}

function makePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function TechniciansPage() {
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<Technician | null>(null);
  const [newPin, setNewPin] = useState("");
  const [resetResult, setResetResult] = useState<{ name: string; pin: string; url: string } | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_floor_technicians_admin");
    setLoading(false);
    if (error) { toast.error("โหลดรายชื่อช่างไม่สำเร็จ: " + error.message); return; }
    setTechs((data ?? []) as Technician[]);
  }

  useEffect(() => { void load(); }, []);

  function openReset(technician: Technician) {
    setResetTarget(technician);
    setNewPin(makePin());
  }

  async function resetPin() {
    if (!resetTarget) return;
    const pin = newPin.replace(/\D/g, "");
    if (!/^\d{4,6}$/.test(pin)) {
      toast.error("PIN ต้องเป็นตัวเลข 4–6 หลัก");
      return;
    }

    setResetting(resetTarget.id);
    const nextToken = crypto.randomUUID();
    const { error: updateError } = await supabase
      .from("floor_technicians")
      .update({ personal_token: nextToken, updated_at: new Date().toISOString() })
      .eq("id", resetTarget.id);
    if (updateError) {
      setResetting(null);
      toast.error("ออกลิงก์ใหม่ไม่สำเร็จ: " + updateError.message);
      return;
    }

    const { data: pinSet, error: pinError } = await supabase.rpc("set_floor_technician_pin", {
      p_personal_token: nextToken,
      p_pin: pin,
    });
    if (pinError || !pinSet) {
      setResetting(null);
      toast.error("ตั้ง PIN ใหม่ไม่สำเร็จ: " + (pinError?.message ?? "ไม่พบช่างที่ใช้งานอยู่"));
      return;
    }

    const { error: deviceError } = await supabase.rpc("reset_floor_device_pin", { p_technician_id: resetTarget.id });
    setResetting(null);
    if (deviceError) {
      toast.error("ตั้ง PIN แล้ว แต่ถอดเครื่องเดิมไม่สำเร็จ: " + deviceError.message);
      return;
    }

    const url = `${window.location.origin}/work/${nextToken}`;
    setResetTarget(null);
    setResetResult({ name: resetTarget.name, pin, url });
    toast.success(`ออกลิงก์และ PIN ใหม่สำหรับ ${resetTarget.name} แล้ว`);
    await load();
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`คัดลอก${label}แล้ว`);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง");
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">จัดการช่างและ PIN</h1>
          <p className="text-slate-500 text-sm mt-1">รีเซ็ต PIN เมื่อช่างลืม PIN หรือเปลี่ยนเครื่อง</p>
        </div>
        <button
          onClick={() => void load()}
          className="text-sm text-blue-600 hover:underline font-medium"
        >
          รีเฟรช
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 text-center py-16">กำลังโหลด…</div>
      ) : techs.length === 0 ? (
        <div className="text-slate-500 text-center py-16">ยังไม่มีข้อมูลช่าง</div>
      ) : (
        <div className="space-y-3">
          {techs.map((t) => (
            <div
              key={t.id}
              className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">{t.name}</span>
                  {t.is_team_lead && (
                    <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">หัวหน้าช่าง</span>
                  )}
                </div>
                <div className="text-sm text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {t.phone && <span>📞 {t.phone}</span>}
                  <span className={t.device_count > 0 ? "text-green-700" : "text-slate-400"}>
                    📱 {t.device_count > 0 ? `ผูกเครื่องแล้ว ${t.device_count} เครื่อง` : "ยังไม่ได้ผูกเครื่อง"}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono break-all">
                  ลิงก์: /work/{t.personal_token}
                </div>
              </div>
              <button
                disabled={resetting === t.id}
                onClick={() => openReset(t)}
                className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg border transition-colors
                  enabled:bg-red-50 enabled:text-red-700 enabled:border-red-200 enabled:hover:bg-red-100
                  disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
              >
                {resetting === t.id ? "กำลังรีเซ็ต…" : t.device_count > 0 ? "รีเซ็ต PIN" : "ตั้ง PIN / ออกลิงก์"}
              </button>
            </div>
          ))}
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => !resetting && setResetTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">{resetTarget.device_count > 0 ? "รีเซ็ต PIN และออกลิงก์ใหม่" : "ตั้ง PIN และออกลิงก์ใหม่"}</h2>
            <p className="mt-1 text-sm text-slate-500">สำหรับ <strong className="text-slate-700">{resetTarget.name}</strong>{resetTarget.device_count > 0 ? " เครื่องเดิมทุกเครื่องจะถูกถอดออก" : " ช่างยังไม่เคยผูกเครื่อง"}</p>
            <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="technician-pin">PIN ใหม่ (4–6 หลัก)</label>
            <div className="mt-2 flex gap-2">
              <input id="technician-pin" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-lg tracking-widest outline-none focus:border-blue-500" />
              <button type="button" onClick={() => setNewPin(makePin())} className="rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-700 hover:bg-blue-50">สุ่ม PIN</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">ระบบจะเปลี่ยนลิงก์ส่วนตัวเดิมด้วย โปรดส่งลิงก์และ PIN ใหม่ให้ช่างพร้อมกัน</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={Boolean(resetting)} onClick={() => setResetTarget(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">ยกเลิก</button>
              <button type="button" disabled={Boolean(resetting)} onClick={() => void resetPin()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300">{resetting ? "กำลังบันทึก…" : "ยืนยันและออกลิงก์"}</button>
            </div>
          </div>
        </div>
      )}

      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setResetResult(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">พร้อมส่งให้ {resetResult.name}</h2>
            <p className="mt-1 text-sm text-slate-500">ลิงก์เดิมใช้งานไม่ได้แล้ว เก็บข้อมูลนี้ก่อนปิดหน้าต่าง</p>
            <div className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
              <div><span className="text-xs font-medium text-slate-500">PIN ใหม่</span><div className="mt-1 flex items-center justify-between gap-3"><code className="text-xl font-bold tracking-[0.25em] text-slate-900">{resetResult.pin}</code><button onClick={() => void copy(resetResult.pin, "PIN")} className="text-sm font-medium text-blue-700">คัดลอก PIN</button></div></div>
              <div><span className="text-xs font-medium text-slate-500">ลิงก์ส่วนตัว</span><div className="mt-1 flex items-center justify-between gap-3"><code className="min-w-0 truncate text-xs text-slate-700">{resetResult.url}</code><button onClick={() => void copy(resetResult.url, "ลิงก์")} className="shrink-0 text-sm font-medium text-blue-700">คัดลอกลิงก์</button></div></div>
            </div>
            <div className="mt-6 flex justify-end"><button onClick={() => setResetResult(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">เสร็จสิ้น</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

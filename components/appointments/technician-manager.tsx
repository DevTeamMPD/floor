"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { FloorTechnician } from "@/lib/technicians";
import { personalWorkUrl } from "@/lib/technicians";
import { notifyError } from "@/lib/notify-error";

interface Team { id: string; name: string; is_active?: boolean }

interface Props {
  open: boolean;
  teams: Team[];
  technicians: FloorTechnician[];
  onClose: () => void;
  onChanged: () => void;
}

const EMPTY = { name: "", phone: "", team_id: "", is_team_lead: false, pin: "" };

function makePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function TechnicianManager({ open, teams, technicians, onClose, onChanged }: Props) {
  const supabase = createClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [newLink, setNewLink] = useState<{ name: string; url: string; pin: string } | null>(null);
  const activeTeams = teams.filter((team) => team.is_active !== false);
  const activeTechnicians = technicians.filter((technician) => technician.is_active);

  if (!open) return null;

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  function edit(t: FloorTechnician) {
    setEditingId(t.id);
    setForm({ name: t.name, phone: t.phone ?? "", team_id: t.team_id ?? "", is_team_lead: t.is_team_lead, pin: "" });
  }

  async function save() {
    if (!form.name.trim() || !form.team_id) {
      notifyError("กรุณาระบุชื่อช่างและทีม");
      return;
    }
    setSaving(true);
    const pin = form.pin.trim() || (!editingId ? makePin() : "");
    const values = {
      name: form.name.trim(), phone: form.phone.trim() || null, team_id: form.team_id,
      is_team_lead: form.is_team_lead, updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const resetToken = pin ? crypto.randomUUID() : "";
      const updateValues = resetToken ? { ...values, personal_token: resetToken } : values;
      const { error } = await supabase.from("floor_technicians").update(updateValues).eq("id", editingId);
      if (error) notifyError(error);
      else {
        if (pin) {
          const { error: pinError } = await supabase.rpc("set_floor_technician_pin", {
            p_personal_token: resetToken,
            p_pin: pin,
          });
          if (pinError) {
            notifyError(pinError);
            setSaving(false);
            return;
          }
        }
        if (resetToken) setNewLink({ name: values.name, url: personalWorkUrl(resetToken), pin });
        toast.success(resetToken ? "แก้ไขข้อมูลช่างและออกลิงก์/PIN ใหม่แล้ว" : "แก้ไขข้อมูลช่างแล้ว");
        reset();
        onChanged();
      }
    } else {
      const id = crypto.randomUUID();
      const token = crypto.randomUUID();
      const { error } = await supabase.from("floor_technicians").insert({ id, personal_token: token, ...values });
      if (error) notifyError(error);
      else {
        if (!pin) {
          notifyError("ไม่สามารถตั้ง PIN อัตโนมัติได้");
          setSaving(false);
          return;
        }
        const { error: pinError } = await supabase.rpc("set_floor_technician_pin", {
          p_personal_token: token,
          p_pin: pin,
        });
        if (pinError) {
          notifyError(pinError);
          setSaving(false);
          return;
        }
        setNewLink({ name: values.name, url: personalWorkUrl(token), pin });
        toast.success("เพิ่มช่างแล้ว กรุณาคัดลอกลิงก์และ PIN");
        reset();
        onChanged();
      }
    }
    setSaving(false);
  }

  async function toggle(t: FloorTechnician) {
    const { error } = await supabase.from("floor_technicians")
      .update({ is_active: !t.is_active, updated_at: new Date().toISOString() }).eq("id", t.id);
    if (error) notifyError(error); else onChanged();
  }

  async function rotateLink(t: FloorTechnician) {
    if (!window.confirm(`สร้างลิงก์ใหม่ให้ ${t.name}? ลิงก์เดิมจะใช้ไม่ได้ทันที`)) return;
    const token = crypto.randomUUID();
    const { error } = await supabase.from("floor_technicians")
      .update({ personal_token: token, updated_at: new Date().toISOString() }).eq("id", t.id);
    if (error) notifyError(error);
    else setNewLink({ name: t.name, url: personalWorkUrl(token), pin: "" });
  }

  async function copyLink() {
    if (!newLink) return;
    await navigator.clipboard.writeText(newLink.url);
    toast.success("คัดลอกลิงก์แล้ว");
  }

  async function copyPin() {
    if (!newLink?.pin) return;
    await navigator.clipboard.writeText(newLink.pin);
    toast.success("คัดลอก PIN แล้ว");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="font-semibold">👤 จัดการช่าง / PIN</h2><p className="text-xs text-slate-500">สร้างลิงก์ส่วนตัวและตั้ง PIN 4-6 หลักให้ช่างแต่ละคน</p></div>
          <button onClick={onClose} aria-label="ปิด" className="text-xl text-slate-400">×</button>
        </div>

        {newLink ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-medium text-emerald-800">ลิงก์ส่วนตัวของ {newLink.name}</div>
            <div className="text-xs text-emerald-700 break-all my-2">{newLink.url}</div>
            {newLink.pin ? <div className="text-xs text-emerald-700 mb-2">PIN: <span className="font-semibold">{newLink.pin}</span></div> : null}
            <div className="flex gap-2">
              <button onClick={copyLink} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs">คัดลอกลิงก์</button>
              {newLink.pin ? <button onClick={copyPin} className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs">คัดลอก PIN</button> : null}
              <button onClick={() => setNewLink(null)} className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs">ปิดข้อความ</button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ชื่อช่าง *" className="border rounded-lg px-3 py-2 text-sm" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="เบอร์โทร" className="border rounded-lg px-3 py-2 text-sm" />
          <select value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">เลือกทีม *</option>{activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_team_lead} onChange={(e) => setForm({ ...form, is_team_lead: e.target.checked })} />หัวหน้าทีม</label>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-xs text-slate-500">{editingId ? "PIN ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)" : "PIN 4-6 หลัก *"}</label>
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, pin: makePin() }))}
                className="text-xs text-blue-600"
              >
                สุ่ม PIN
              </button>
            </div>
            <input
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              placeholder="เช่น 123456"
              inputMode="numeric"
              maxLength={6}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2 mb-5">
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">{editingId ? "บันทึกการแก้ไข" : "เพิ่มช่าง"}</button>
          {editingId ? <button onClick={reset} className="px-4 py-2 rounded-lg border text-sm">ยกเลิกแก้ไข</button> : null}
        </div>

        <div className="divide-y">
          {activeTechnicians.map((t) => (
            <div key={t.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{t.name}{t.is_team_lead ? " · หัวหน้าทีม" : ""}</div>
                <div className="text-xs text-slate-500">{teams.find((x) => x.id === t.team_id)?.name ?? "ไม่ระบุทีม"}{t.phone ? ` · ${t.phone}` : ""}</div>
                <div className="text-xs mt-0.5 text-slate-400">
                  สถานะ PIN ถูกซ่อนเพื่อความปลอดภัย
                </div>
              </div>
              <button onClick={() => edit(t)} className="text-xs text-blue-600">แก้ไข</button>
              <button onClick={() => rotateLink(t)} className="text-xs text-violet-600">สร้างลิงก์ใหม่</button>
              <button onClick={() => toggle(t)} className="text-xs text-slate-500">ปิดใช้</button>
            </div>
          ))}
          {!activeTechnicians.length ? <div className="py-6 text-center text-sm text-slate-400">ยังไม่มีรายชื่อช่างที่เปิดใช้งาน</div> : null}
        </div>
      </div>
    </div>
  );
}

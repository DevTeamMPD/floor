"use client";

import { FormEvent, useState } from "react";
import { toast } from "sonner";

export default function WarehousePinManager({ onCreated }: { onCreated?: () => void }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewUsers, setPreviewUsers] = useState<Array<{ fullName: string; username: string }>>([]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    const response = await fetch("/api/staff/warehouse-pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName, username, pin }) });
    const result = await response.json() as { error?: string; localPreview?: boolean; fullName?: string; username?: string };
    setSaving(false);
    if (!response.ok) { toast.error(result.error || "สร้างบัญชี PIN ไม่สำเร็จ"); return; }
    if (result.localPreview && result.fullName && result.username) {
      setPreviewUsers((current) => [...current, { fullName: result.fullName!, username: result.username! }]);
      toast.success("ทดลองเพิ่มบัญชีแล้ว (Local Preview · ยังไม่บันทึกข้อมูลจริง)");
    } else toast.success("สร้างบัญชีทีมคลังแล้ว · เข้าได้เฉพาะหน้าเตรียมสินค้า");
    setFullName(""); setUsername(""); setPin(""); onCreated?.();
  }

  return <form onSubmit={submit} className="mx-auto max-w-lg rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
    <h2 className="font-semibold text-emerald-950">🔐 เพิ่มผู้ใช้ PIN ทีมคลัง</h2>
    <p className="mt-1 text-xs text-emerald-700">ผู้ใช้นี้จะเห็นและทำงานได้เฉพาะหน้า “เตรียมสินค้า”</p>
    <div className="mt-4 space-y-3">
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="ชื่อที่แสดง" className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm" />
      <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32))} required minLength={3} placeholder="ชื่อผู้ใช้ เช่น warehouse01" className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm" />
      <div className="flex gap-2"><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} required minLength={6} maxLength={6} placeholder="PIN ตัวเลข 6 หลัก" className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm" /><button type="button" onClick={() => setPin(String(Math.floor(100000 + Math.random() * 900000)))} className="rounded-xl border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-700">สุ่ม PIN</button></div>
      <button disabled={saving || pin.length !== 6} className="w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลังสร้าง…" : "สร้างบัญชี PIN"}</button>
    </div>
    {previewUsers.length ? <div className="mt-4 space-y-2 border-t border-emerald-200 pt-4"><div className="text-xs font-semibold text-emerald-800">บัญชีที่เพิ่มระหว่างทดลอง</div>{previewUsers.map((user) => <div key={user.username} className="rounded-xl bg-white px-3 py-2 text-sm"><div className="font-medium text-slate-800">{user.fullName}</div><div className="text-xs text-slate-500">ชื่อผู้ใช้: {user.username} · เตรียมสินค้าเท่านั้น</div></div>)}</div> : null}
  </form>;
}

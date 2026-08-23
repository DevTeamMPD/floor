"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, STAFF_ROLES, type StaffProfile, type StaffRole } from "@/lib/staff";

interface Invite { id: string; email: string; full_name: string | null; role: StaffRole; used_at: string | null; created_at: string }

export default function StaffPage() {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("sales");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: profiles, error: profileError }, { data: inviteRows, error: inviteError }] = await Promise.all([
      supabase.from("floor_staff_profiles").select("id,email,full_name,role,is_active").order("full_name"),
      supabase.from("floor_staff_invites").select("id,email,full_name,role,used_at,created_at").order("created_at", { ascending: false }),
    ]);
    if (profileError || inviteError) toast.error(profileError?.message ?? inviteError?.message ?? "โหลดบัญชีไม่สำเร็จ");
    setStaff((profiles ?? []) as StaffProfile[]);
    setInvites((inviteRows ?? []) as Invite[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    const { error } = await supabase.rpc("invite_floor_staff", { p_email: email.trim(), p_full_name: fullName.trim(), p_role: role });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("สร้างคำเชิญแล้ว ส่งลิงก์หน้า Login ให้พนักงานเปิดใช้บัญชี");
    setEmail(""); setFullName(""); setRole("sales"); void load();
  }

  async function updateProfile(id: string, patch: Partial<Pick<StaffProfile, "role" | "is_active">>) {
    const { error } = await supabase.from("floor_staff_profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("อัปเดตบัญชีแล้ว"); void load(); }
  }

  return <div className="mx-auto max-w-6xl">
    <div><h1 className="text-2xl font-bold text-slate-950">บัญชีพนักงาน</h1><p className="mt-1 text-sm text-slate-500">เชิญอีเมลและกำหนดเมนูตามบทบาท</p></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={invite} className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">เชิญพนักงาน</h2>
        <div className="mt-4 space-y-3">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="ชื่อพนักงาน" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="อีเมล" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">{STAFF_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
          <button disabled={saving} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลังบันทึก…" : "สร้างคำเชิญ"}</button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">พนักงานเปิด `/login` แล้วเลือก “เปิดใช้บัญชี” ด้วยอีเมลนี้</p>
      </form>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 font-semibold">บัญชีที่ใช้งาน ({staff.length})</div>
          <div className="divide-y divide-slate-100">{staff.map((person) => <div key={person.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><div className="font-medium text-slate-900">{person.full_name}</div><div className="truncate text-xs text-slate-500">{person.email}</div></div>
            <select value={person.role} onChange={(e) => updateProfile(person.id, { role: e.target.value as StaffRole })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">{STAFF_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
            <button onClick={() => updateProfile(person.id, { is_active: !person.is_active })} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${person.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.is_active ? "ใช้งานอยู่" : "ปิดใช้งาน"}</button>
          </div>)}</div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">คำเชิญล่าสุด</h2><div className="mt-3 space-y-2">{invites.slice(0, 10).map((inviteRow) => <div key={inviteRow.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><div><div>{inviteRow.full_name || inviteRow.email}</div><div className="text-xs text-slate-400">{inviteRow.email} · {ROLE_LABELS[inviteRow.role]}</div></div><span className={`text-xs ${inviteRow.used_at ? "text-emerald-600" : "text-amber-600"}`}>{inviteRow.used_at ? "เปิดใช้แล้ว" : "รอเปิดใช้"}</span></div>)}</div></section>
      </div>
    </div>
  </div>;
}

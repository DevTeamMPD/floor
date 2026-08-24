"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, STAFF_ROLES, type StaffProfile, type StaffRole } from "@/lib/staff";

interface Invite { id: string; email: string; full_name: string | null; role: StaffRole; used_at: string | null; created_at: string }
interface EmployeePreview {
  employee_id: string; employee_code: string; full_name: string; email: string | null;
  employee_status: string; department_name: string | null; position_name: string | null;
  mapped_role: StaffRole; auth_linked: boolean; profile_source: "manual" | "master" | null; profile_active: boolean | null;
}

export default function StaffPage() {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [employeePreview, setEmployeePreview] = useState<EmployeePreview[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("sales");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: profiles, error: profileError }, { data: inviteRows, error: inviteError }, { data: previewRows, error: previewError }] = await Promise.all([
      supabase.from("floor_staff_profiles").select("id,email,full_name,role,is_active,master_employee_id,role_source,master_synced_at").order("full_name"),
      supabase.from("floor_staff_invites").select("id,email,full_name,role,used_at,created_at").order("created_at", { ascending: false }),
      supabase.rpc("list_floor_employee_role_preview"),
    ]);
    if (profileError || inviteError || previewError) toast.error(profileError?.message ?? inviteError?.message ?? previewError?.message ?? "โหลดบัญชีไม่สำเร็จ");
    setStaff((profiles ?? []) as StaffProfile[]);
    setInvites((inviteRows ?? []) as Invite[]);
    setEmployeePreview((previewRows ?? []) as EmployeePreview[]);
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
    const { error } = await supabase.from("floor_staff_profiles").update({ ...patch, role_source: "manual", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("บันทึกเป็นสิทธิ์กำหนดเองแล้ว"); void load(); }
  }

  async function syncEmployeeMaster() {
    setSaving(true);
    const { data, error } = await supabase.rpc("sync_floor_staff_from_employee_master");
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    const result = data as { upserted?: number; deactivated?: number } | null;
    toast.success(`Sync สำเร็จ: อัปเดต ${result?.upserted ?? 0} บัญชี · ปิด ${result?.deactivated ?? 0} บัญชี`);
    void load();
  }

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold text-slate-950">บัญชีพนักงาน</h1><p className="mt-1 text-sm text-slate-500">บทบาทจาก Master พนักงาน และสิทธิ์ยกเว้นที่ Admin กำหนดเอง</p></div><button type="button" onClick={syncEmployeeMaster} disabled={saving} className="min-h-11 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลัง Sync…" : "Sync Master ตอนนี้"}</button></div>
    <section className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><div className="text-xs text-blue-600">พนักงานที่เข้าเกณฑ์ FloorNow</div><div className="mt-1 text-2xl font-bold text-blue-950">{employeePreview.length}</div></div>
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-xs text-emerald-600">ผูก Supabase Auth แล้ว</div><div className="mt-1 text-2xl font-bold text-emerald-950">{employeePreview.filter((row) => row.auth_linked).length}</div></div>
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4"><div className="text-xs text-amber-700">ยังไม่ผูกบัญชี</div><div className="mt-1 text-2xl font-bold text-amber-950">{employeePreview.filter((row) => !row.auth_linked).length}</div></div>
    </section>
    <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={invite} className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">บัญชียกเว้น / บุคคลภายนอก</h2>
        <div className="mt-4 space-y-3">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="ชื่อพนักงาน" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="อีเมล" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">{STAFF_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
          <button disabled={saving} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลังบันทึก…" : "สร้างคำเชิญ"}</button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">ใช้เฉพาะผู้ที่ไม่มีใน Master พนักงาน เมื่อเปิดใช้แล้วจะเป็นสิทธิ์กำหนดเองและไม่ถูก Sync ทับ</p>
      </form>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 font-semibold">บัญชีที่ใช้งาน ({staff.length})</div>
          <div className="divide-y divide-slate-100">{staff.map((person) => <div key={person.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{person.full_name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${person.role_source === "master" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{person.role_source === "master" ? "จาก Master" : "กำหนดเอง"}</span></div><div className="truncate text-xs text-slate-500">{person.email}</div></div>
            <select value={person.role} onChange={(e) => updateProfile(person.id, { role: e.target.value as StaffRole })} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">{STAFF_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
            <button onClick={() => updateProfile(person.id, { is_active: !person.is_active })} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${person.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.is_active ? "ใช้งานอยู่" : "ปิดใช้งาน"}</button>
          </div>)}</div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><div className="font-semibold">ตัวอย่าง Role Mapping ({employeePreview.length})</div><div className="mt-1 text-xs text-slate-500">แสดงเฉพาะพนักงาน active/probation ที่ตรงกฎ FloorNow</div></div>
          <div className="divide-y divide-slate-100">{employeePreview.map((person) => <div key={person.employee_id} className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[1fr_160px_150px] sm:items-center">
            <div className="min-w-0"><div className="truncate font-medium text-slate-900">{person.full_name}</div><div className="truncate text-xs text-slate-500">{person.department_name || "ไม่ระบุแผนก"} · {person.position_name || "ไม่ระบุตำแหน่ง"}</div></div>
            <div className="text-xs font-medium text-blue-700">{ROLE_LABELS[person.mapped_role]}</div>
            <div className={`text-xs ${person.auth_linked ? "text-emerald-600" : "text-amber-600"}`}>{person.auth_linked ? "พร้อมเข้าใช้งาน" : "ยังไม่ผูก Auth"}</div>
          </div>)}</div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">คำเชิญล่าสุด</h2><div className="mt-3 space-y-2">{invites.slice(0, 10).map((inviteRow) => <div key={inviteRow.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><div><div>{inviteRow.full_name || inviteRow.email}</div><div className="text-xs text-slate-400">{inviteRow.email} · {ROLE_LABELS[inviteRow.role]}</div></div><span className={`text-xs ${inviteRow.used_at ? "text-emerald-600" : "text-amber-600"}`}>{inviteRow.used_at ? "เปิดใช้แล้ว" : "รอเปิดใช้"}</span></div>)}</div></section>
      </div>
    </div>
  </div>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { FloorTechnician, TechnicianAssignment } from "@/lib/technicians";
import { assignmentEvidenceLabel } from "@/lib/technicians";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { notifyError } from "@/lib/notify-error";

interface Team { id: string; name: string }
interface Props {
  appointmentId: string;
  appointmentTeamId: string | null;
  jobNo: string | null;
  teams: Team[];
  technicians: FloorTechnician[];
  assignments: TechnicianAssignment[];
  onChanged: () => void;
}

export default function TechnicianAssignmentButton({ appointmentId, appointmentTeamId, jobNo, teams, technicians, assignments, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const active = useMemo(() => assignments.filter((a) => a.appointment_id === appointmentId && a.is_active), [assignments, appointmentId]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("floor_staff_profiles").select("id").eq("id", user.id).maybeSingle();
      setCanManage(Boolean(data));
    })();
  }, [supabase]);

  function show() {
    setSelected(active.map((a) => a.technician_id));
    setLeadId(active.find((a) => a.is_lead)?.technician_id ?? active[0]?.technician_id ?? "");
    setOpen(true);
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
    if (leadId === id) setLeadId("");
  }

  async function save() {
    if (!canManage) { notifyError("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานที่ Active"); return; }
    if (!selected.length) { notifyError("กรุณาเลือกช่างอย่างน้อย 1 คน"); return; }
    const actualLead = selected.includes(leadId) ? leadId : selected[0];
    setSaving(true);
    const now = new Date().toISOString();
    const rows = selected.map((technicianId) => ({
      appointment_id: appointmentId, technician_id: technicianId,
      is_lead: technicianId === actualLead, is_active: true, revoked_at: null,
      assigned_by: "หัวหน้าช่าง", assigned_at: now,
    }));
    const removed = active.filter((a) => !selected.includes(a.technician_id)).map((a) => a.id);
    const { error: upsertError } = await supabase.from("appointment_technicians")
      .upsert(rows, { onConflict: "appointment_id,technician_id" });
    if (upsertError) { notifyError(upsertError); setSaving(false); return; }
    if (removed.length) {
      const { error } = await supabase.from("appointment_technicians")
        .update({ is_active: false, revoked_at: now, is_lead: false }).in("id", removed);
      if (error) { notifyError(error); setSaving(false); return; }
    }
    if (jobNo) {
      const names = selected.map((id) => technicians.find((t) => t.id === id)?.name).filter((x): x is string => Boolean(x));
      const { error: summaryError } = await supabase.from("install_jobs").update({ assignees: names, updated_at: now }).eq("job_no", jobNo);
      if (summaryError) {
        notifyError(`จ่ายงานให้ช่างแล้ว แต่บันทึกรายชื่อสรุปในใบงานไม่สำเร็จ: ${floorErrorMessage(summaryError)}`);
        setOpen(false); setSaving(false); onChanged();
        return;
      }
    }
    toast.success("จ่ายงานให้ช่างแล้ว");
    setOpen(false); setSaving(false); onChanged();
  }

  return (
    <>
      {canManage ? <button onClick={show} className="shrink-0 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100">
        👤 {active.length ? `แก้ไขช่าง (${active.length} คน)` : "มอบหมายช่าง"}
      </button> : <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">ดูข้อมูลเท่านั้น</span>}
      {active.length ? <div className="mt-1 flex flex-wrap gap-1">
        {active.map((a) => {
          const t = technicians.find((x) => x.id === a.technician_id);
          const label = assignmentEvidenceLabel(a);
          return <span key={a.id} className={`text-[10px] px-1.5 py-0.5 rounded ${a.acknowledged_at ? "bg-emerald-100 text-emerald-700" : a.first_opened_at ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{t?.name ?? "ช่าง"}{a.is_lead ? " ★" : ""} · {label}</span>;
        })}
      </div> : null}

      {open ? <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
        <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between mb-3"><div><h3 className="font-semibold">จ่ายงานรายบุคคล</h3><p className="text-xs text-slate-500">เลือกได้หลายคน และกำหนดผู้รับผิดชอบหลักหนึ่งคน</p></div><button onClick={() => setOpen(false)} aria-label="ปิด">×</button></div>
          <div className="max-h-80 overflow-y-auto divide-y">
            {technicians.filter((t) => t.is_active).sort((a, b) => Number(b.team_id === appointmentTeamId) - Number(a.team_id === appointmentTeamId) || a.name.localeCompare(b.name, "th")).map((t) => {
              const checked = selected.includes(t.id);
              return <div key={t.id} className="py-2 flex items-center gap-2">
                <input type="checkbox" id={`assign-${appointmentId}-${t.id}`} checked={checked} onChange={() => toggle(t.id)} />
                <label htmlFor={`assign-${appointmentId}-${t.id}`} className="flex-1 text-sm">{t.name}<span className="text-xs text-slate-400 ml-1">· {teams.find((x) => x.id === t.team_id)?.name ?? "ไม่ระบุทีม"}</span></label>
                <label className="text-xs text-slate-500 flex items-center gap-1"><input type="radio" name={`lead-${appointmentId}`} checked={leadId === t.id} disabled={!checked} onChange={() => setLeadId(t.id)} />คนหลัก</label>
              </div>;
            })}
          </div>
          {!technicians.some((t) => t.is_active) ? <p className="py-6 text-center text-sm text-slate-400">เพิ่มรายชื่อช่างก่อนจ่ายงาน</p> : null}
          <div className="flex gap-2 mt-4"><button onClick={() => setOpen(false)} className="flex-1 border rounded-lg py-2 text-sm">ยกเลิก</button><button onClick={save} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm disabled:opacity-50">{saving ? "กำลังบันทึก…" : "บันทึกการจ่ายงาน"}</button></div>
        </div>
      </div> : null}
    </>
  );
}

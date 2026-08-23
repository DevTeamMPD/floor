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

export default function TechniciansPage() {
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_floor_technicians_admin");
    setLoading(false);
    if (error) { toast.error("โหลดรายชื่อช่างไม่สำเร็จ: " + error.message); return; }
    setTechs((data ?? []) as Technician[]);
  }

  useEffect(() => { void load(); }, []);

  async function resetPin(techId: string, name: string) {
    if (!confirm(`รีเซ็ต PIN และถอดเครื่องของ "${name}" ออกทั้งหมด?\n\nช่างจะต้องผูกเครื่องและตั้ง PIN ใหม่`)) return;
    setResetting(techId);
    const { error } = await supabase.rpc("reset_floor_device_pin", { p_technician_id: techId });
    setResetting(null);
    if (error) { toast.error("รีเซ็ตไม่สำเร็จ: " + error.message); return; }
    toast.success(`รีเซ็ต PIN ของ ${name} เรียบร้อยแล้ว`);
    await load();
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
                disabled={resetting === t.id || t.device_count === 0}
                onClick={() => void resetPin(t.id, t.name)}
                className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg border transition-colors
                  enabled:bg-red-50 enabled:text-red-700 enabled:border-red-200 enabled:hover:bg-red-100
                  disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed"
              >
                {resetting === t.id ? "กำลังรีเซ็ต…" : "รีเซ็ต PIN"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

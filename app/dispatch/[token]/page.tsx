import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function LegacyDispatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("resolve_legacy_floor_dispatch", { p_dispatch_token: token });
  const resolved = data as { technicianToken?: string; jobNo?: string } | null;
  if (resolved?.technicianToken) redirect(`/work/${resolved.technicianToken}${resolved.jobNo ? `?job=${encodeURIComponent(resolved.jobNo)}` : ""}`);

  return <main className="min-h-screen bg-slate-50 px-4 py-12 grid place-items-center">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div className="text-3xl">📋</div><h1 className="mt-3 text-xl font-semibold text-slate-900">ลิงก์ใบส่งงานแบบเก่า</h1><p className="mt-2 text-sm leading-relaxed text-slate-500">งานนี้ยังไม่ได้จ่ายให้ช่างรายบุคคล กรุณาขอลิงก์พนักงานและ PIN จากหัวหน้าช่าง</p>
    </div>
  </main>;
}

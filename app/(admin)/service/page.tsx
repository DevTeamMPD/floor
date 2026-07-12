"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";

interface SkuRow {
  sku: string;
  note: string | null;
  active: boolean;
  created_at: string;
  job_count?: number;
}

export default function ServicePage() {
  const supabase = createClient();
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("install_sku_watch").select("*").order("active", { ascending: false }).order("sku"),
      supabase.from("install_jobs").select("sku"),
    ]).then(([{ data: skuData }, { data: jobData }]) => {
      setSkus((skuData ?? []) as SkuRow[]);
      const counts: Record<string, number> = {};
      for (const j of jobData ?? []) {
        if (j.sku) counts[j.sku] = (counts[j.sku] ?? 0) + 1;
      }
      setJobCounts(counts);
      setLoading(false);
    });
  }, []);

  const activeCount = skus.filter((s) => s.active).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">บริการ</h1>
          <p className="text-slate-500 text-sm mt-0.5">รายการ SKU สินค้าที่ติดตาม</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            {loading ? "…" : `${activeCount} SKU ที่ใช้งาน`}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["SKU", "รายละเอียด", "จำนวนงาน", "สถานะ", "เพิ่มเมื่อ"].map((h) => (
                <th key={h} className="text-left px-5 py-3 font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-300 animate-pulse">โหลดข้อมูล…</td></tr>
            ) : skus.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-300">ยังไม่มี SKU</td></tr>
            ) : (
              skus.map((s) => (
                <tr key={s.sku} className={`hover:bg-slate-50 ${!s.active ? "opacity-50" : ""}`}>
                  <td className="px-5 py-3 font-mono font-medium text-blue-700">{s.sku}</td>
                  <td className="px-5 py-3 text-slate-700">{s.note ?? "—"}</td>
                  <td className="px-5 py-3">
                    {jobCounts[s.sku] ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                        💼 {jobCounts[s.sku]} งาน
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">ยังไม่มีงาน</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}>
                      {s.active ? "✅ ใช้งาน" : "❌ ปิดใช้"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{formatDate(s.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

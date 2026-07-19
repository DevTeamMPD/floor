"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstallJob } from "@/lib/types";
import Link from "next/link";

interface NcrReport {
  id: string;
  title: string;
  type: string;
  status: string;
  product_sku: string | null;
  quantity: number | null;
  estimated_value_thb: number | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  quality: "คุณภาพ",
  damage: "เสียหาย",
  missing: "ขาดหาย",
  wrong: "ผิดรายการ",
  other: "อื่นๆ",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  investigating: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  closed: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<string, string> = {
  open: "รับเรื่อง",
  investigating: "ตรวจสอบ",
  approved: "อนุมัติ",
  closed: "ปิดเคลม",
};

export default function NcrTab({ job }: { job: InstallJob }) {
  const supabase = createClient();
  const [ncrs, setNcrs] = useState<NcrReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("ncr_reports")
        .select(
          "id, title, type, status, product_sku, quantity, estimated_value_thb, created_at"
        )
        .eq("job_no", job.jobNo)
        .order("created_at", { ascending: false });
      if (!error && data) setNcrs(data);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.jobNo]);

  if (loading)
    return (
      <div className="text-sm text-gray-400 py-4 text-center">
        กำลังโหลด...
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">🔴 NCR — เคลมสินค้า</h3>
        <Link
          href={`/ncr?job_no=${encodeURIComponent(job.jobNo)}`}
          className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors font-medium"
        >
          + สร้าง NCR
        </Link>
      </div>

      {ncrs.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">ไม่มีรายการ NCR สำหรับงานนี้</p>
          <Link
            href={`/ncr?job_no=${encodeURIComponent(job.jobNo)}`}
            className="mt-3 inline-block text-sm text-blue-600 hover:underline"
          >
            สร้าง NCR แรก →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {ncrs.map((ncr) => (
            <Link
              key={ncr.id}
              href={`/ncr?id=${ncr.id}`}
              className="block border rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {ncr.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {TYPE_LABELS[ncr.type] ?? ncr.type}
                    {ncr.product_sku && ` · ${ncr.product_sku}`}
                    {ncr.quantity && ` × ${ncr.quantity}`}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    STATUS_COLORS[ncr.status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {STATUS_LABELS[ncr.status] ?? ncr.status}
                </span>
              </div>
              {ncr.estimated_value_thb != null && (
                <p className="text-xs text-gray-500 mt-1">
                  มูลค่าโดยประมาณ: ฿{ncr.estimated_value_thb.toLocaleString()}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      <div className="pt-2 border-t">
        <Link href="/ncr" className="text-sm text-blue-600 hover:underline">
          ดู NCR ทั้งหมด →
        </Link>
      </div>
    </div>
  );
}

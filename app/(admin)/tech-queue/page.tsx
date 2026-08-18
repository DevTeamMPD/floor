"use client";
export const dynamic = "force-dynamic";
import { useState } from "react";
import TechQueueView from "@/components/tech-queue/tech-queue-view";

export default function TechQueuePage() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-slate-900">👷 คิวช่าง</h1>
        <button onClick={() => setReloadKey((k) => k + 1)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">↻ รีเฟรช</button>
      </div>
      <p className="text-xs text-slate-500 mb-4">ดูอย่างเดียว — สำหรับเซลเช็คคิวช่างก่อนนัดงาน (14 วันข้างหน้า)</p>
      <TechQueueView reloadKey={reloadKey} />
    </div>
  );
}

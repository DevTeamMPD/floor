"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ipGenOrderNo, today } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const SOURCES = ["manual", "shopee", "lazada", "tiktok", "jst", "web"];

const SHIFT_OPTIONS = [
  { value: "morning", label: "🌅 เช้า" },
  { value: "afternoon", label: "☀️ บ่าย" },
  { value: "allday", label: "🌞 ทั้งวัน" },
] as const;

export default function CreateOrderModal({ onClose, onCreated }: Props) {
  const supabase = createClient();
  const [form, setForm] = useState({
    order_no: ipGenOrderNo(),
    order_source: "manual",
    sku: "",
    order_date: today(),
    product_name: "",
    customer_name: "",
    phone: "",
    address: "",
    location_url: "",
    appt_shift: "",
  });
  const [checking, setChecking] = useState(false);
  const [exists, setExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!form.order_no) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      const { data } = await supabase
        .from("install_jobs")
        .select("job_no")
        .eq("order_no", form.order_no)
        .single();
      setExists(!!data);
      setChecking(false);
    }, 400);
  }, [form.order_no]);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleShift(v: string) {
    setForm((f) => ({ ...f, appt_shift: f.appt_shift === v ? "" : v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        location_url: form.location_url || null,
        appt_shift: form.appt_shift || null,
        stage: 1,
        status: "Active",
      };
      if (exists) {
        await supabase
          .from("install_jobs")
          .update(payload)
          .eq("order_no", form.order_no);
      } else {
        await supabase
          .from("install_jobs")
          .insert(payload);
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">สร้างออเดอร์ใหม่</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">เลขออเดอร์</label>
            <div className="flex gap-2">
              <input
                value={form.order_no}
                onChange={(e) => set("order_no", e.target.value)}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                required
              />
              <button
                type="button"
                onClick={() => set("order_no", ipGenOrderNo())}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs hover:bg-slate-50"
              >
                สุ่ม
              </button>
            </div>
            {checking && <p className="text-xs text-slate-400 mt-1">ตรวจสอบ…</p>}
            {!checking && exists && (
              <p className="text-xs text-amber-600 mt-1">⚠️ ออเดอร์นี้มีอยู่แล้ว — จะอัปเดตแทนสร้างใหม่</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">แหล่งที่มา</label>
              <select
                value={form.order_source}
                onChange={(e) => set("order_source", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">SKU</label>
              <input
                value={form.sku}
                onChange={(e) => set("sku", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">วันที่สั่งซื้อ</label>
            <input
              type="date"
              value={form.order_date}
              onChange={(e) => set("order_date", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">ชื่อสินค้า</label>
            <input
              value={form.product_name}
              onChange={(e) => set("product_name", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">ชื่อลูกค้า</label>
              <input
                value={form.customer_name}
                onChange={(e) => set("customer_name", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">เบอร์โทร</label>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">ที่อยู่ติดตั้ง</label>
            <textarea
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Location URL */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">📍 Google Maps URL</label>
            <input
              value={form.location_url}
              onChange={(e) => set("location_url", e.target.value)}
              placeholder="https://maps.app.goo.gl/..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Appointment shift */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">🕐 กะนัดหมาย</label>
            <div className="flex gap-2">
              {SHIFT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleShift(opt.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    form.appt_shift === opt.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2"
          >
            {submitting ? "กำลังบันทึก…" : exists ? "อัปเดตออเดอร์" : "สร้างออเดอร์"}
          </button>
        </form>
      </div>
    </div>
  );
}

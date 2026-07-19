"use client";
import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";

interface NcrReport {
  id: string;
  job_no: string | null;
  title: string;
  type: string;
  status: string;
  product_sku: string | null;
  quantity: number | null;
  description: string | null;
  estimated_value_thb: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

const STAGES = [
  {
    key: "open",
    label: "รับเรื่อง",
    color: "border-red-300 bg-red-50",
    badge: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  {
    key: "investigating",
    label: "ตรวจสอบ",
    color: "border-yellow-300 bg-yellow-50",
    badge: "bg-yellow-100 text-yellow-700",
    dot: "bg-yellow-500",
  },
  {
    key: "approved",
    label: "อนุมัติ",
    color: "border-blue-300 bg-blue-50",
    badge: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
  },
  {
    key: "closed",
    label: "ปิดเคลม",
    color: "border-green-300 bg-green-50",
    badge: "bg-green-100 text-green-700",
    dot: "bg-green-500",
  },
] as const;

const TYPE_LABELS: Record<string, string> = {
  quality: "คุณภาพสินค้า",
  damage: "สินค้าเสียหาย",
  missing: "สินค้าขาดหาย",
  wrong: "สินค้าผิดรายการ",
  other: "อื่นๆ",
};

const NEXT_STAGE: Record<string, string> = {
  open: "investigating",
  investigating: "approved",
  approved: "closed",
};

const NEXT_LABEL: Record<string, string> = {
  open: "ตรวจสอบ",
  investigating: "อนุมัติ",
  approved: "ปิดเคลม",
};

const EMPTY_FORM = {
  job_no: "",
  title: "",
  type: "quality",
  product_sku: "",
  quantity: "",
  description: "",
  estimated_value_thb: "",
  created_by: "",
};

function NcrPageInner() {
  const searchParams = useSearchParams();
  const prefillJobNo = searchParams.get("job_no") ?? "";
  const highlightId = searchParams.get("id") ?? "";

  const supabase = createClient();
  const [ncrs, setNcrs] = useState<NcrReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(!!prefillJobNo);
  const [selected, setSelected] = useState<NcrReport | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM, job_no: prefillJobNo });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ncr_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setNcrs(data);
      if (highlightId) {
        const found = data.find((n: NcrReport) => n.id === highlightId);
        if (found) setSelected(found);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createNcr() {
    if (!form.title.trim()) {
      toast.error("กรุณากรอกชื่อเรื่อง");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("ncr_reports").insert({
        job_no: form.job_no.trim() || null,
        title: form.title.trim(),
        type: form.type,
        product_sku: form.product_sku.trim() || null,
        quantity: form.quantity ? parseInt(form.quantity) : null,
        description: form.description.trim() || null,
        estimated_value_thb: form.estimated_value_thb
          ? parseFloat(form.estimated_value_thb)
          : null,
        created_by: form.created_by.trim() || null,
        status: "open",
      });
      if (error) throw error;
      toast.success("สร้าง NCR แล้ว");
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function advanceStage(ncr: NcrReport) {
    const next = NEXT_STAGE[ncr.status];
    if (!next) return;
    const patch: Record<string, unknown> = {
      status: next,
      updated_at: new Date().toISOString(),
    };
    if (next === "closed") patch.closed_at = new Date().toISOString();
    const { error } = await supabase
      .from("ncr_reports")
      .update(patch)
      .eq("id", ncr.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`เลื่อนเป็น: ${NEXT_LABEL[ncr.status]}`);
    setSelected(null);
    await load();
  }

  const filteredNcrs = filter
    ? ncrs.filter(
        (n) =>
          n.title.toLowerCase().includes(filter.toLowerCase()) ||
          (n.job_no ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          (n.product_sku ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : ncrs;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            🔴 NCR — Non-Conformance Report
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            จัดการรายการเคลมสินค้าและข้อบกพร่อง
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="ค้นหา NCR / เลขงาน / SKU..."
            className="border rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setShowForm(true);
            }}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors whitespace-nowrap"
          >
            + สร้าง NCR
          </button>
        </div>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-lg">📝 สร้าง NCR ใหม่</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">
                    เลขงาน (Job No.)
                  </label>
                  <input
                    type="text"
                    value={form.job_no}
                    onChange={(e) =>
                      setForm({ ...form, job_no: e.target.value })
                    }
                    placeholder="ไม่บังคับ"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">
                    ประเภท
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm({ ...form, type: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
                  ชื่อเรื่อง{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                  placeholder="สรุปปัญหาสั้นๆ"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">
                    SKU สินค้า
                  </label>
                  <input
                    type="text"
                    value={form.product_sku}
                    onChange={(e) =>
                      setForm({ ...form, product_sku: e.target.value })
                    }
                    placeholder="รหัสสินค้า"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">
                    จำนวน
                  </label>
                  <input
                    type="number"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm({ ...form, quantity: e.target.value })
                    }
                    placeholder="0"
                    min="0"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
                  รายละเอียด
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={3}
                  placeholder="อธิบายปัญหา สาเหตุ และผลกระทบ"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">
                    มูลค่าโดยประมาณ (฿)
                  </label>
                  <input
                    type="number"
                    value={form.estimated_value_thb}
                    onChange={(e) =>
                      setForm({ ...form, estimated_value_thb: e.target.value })
                    }
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">
                    ผู้รายงาน
                  </label>
                  <input
                    type="text"
                    value={form.created_by}
                    onChange={(e) =>
                      setForm({ ...form, created_by: e.target.value })
                    }
                    placeholder="ชื่อ-นามสกุล"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border rounded-lg py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={createNcr}
                disabled={saving}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "💾 สร้าง NCR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NCR Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-start justify-between px-5 py-4 border-b gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-lg leading-tight">
                  {selected.title}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selected.job_no
                    ? `งาน: ${selected.job_no}`
                    : "ไม่ระบุเลขงาน"}{" "}
                  · {TYPE_LABELS[selected.type] ?? selected.type}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-xl shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              {selected.product_sku && (
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">SKU:</span>
                  <span className="font-medium">{selected.product_sku}</span>
                </div>
              )}
              {selected.quantity != null && (
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">จำนวน:</span>
                  <span className="font-medium">{selected.quantity} ชิ้น</span>
                </div>
              )}
              {selected.estimated_value_thb != null && (
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">มูลค่า:</span>
                  <span className="font-medium">
                    ฿{selected.estimated_value_thb.toLocaleString()}
                  </span>
                </div>
              )}
              {selected.description && (
                <div>
                  <p className="text-gray-500 mb-1">รายละเอียด:</p>
                  <p className="text-gray-800 bg-gray-50 rounded-lg p-3 leading-relaxed">
                    {selected.description}
                  </p>
                </div>
              )}
              {selected.created_by && (
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">ผู้รายงาน:</span>
                  <span className="font-medium">{selected.created_by}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-gray-500 shrink-0">วันที่รายงาน:</span>
                <span className="font-medium">
                  {new Date(selected.created_at).toLocaleDateString("th-TH")}
                </span>
              </div>
              {selected.closed_at && (
                <div className="flex gap-2">
                  <span className="text-gray-500 shrink-0">วันที่ปิด:</span>
                  <span className="font-medium">
                    {new Date(selected.closed_at).toLocaleDateString("th-TH")}
                  </span>
                </div>
              )}
            </div>
            {NEXT_STAGE[selected.status] && (
              <div className="px-5 pb-5">
                <button
                  onClick={() => advanceStage(selected)}
                  className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  ➡️ เลื่อนเป็น {NEXT_LABEL[selected.status]}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <p className="text-2xl mb-2">⏳</p>
            <p className="text-sm">กำลังโหลด...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-6">
          <div className="flex gap-4 min-h-[calc(100vh-120px)]">
            {STAGES.map((stage) => {
              const stageNcrs = filteredNcrs.filter(
                (n) => n.status === stage.key
              );
              return (
                <div
                  key={stage.key}
                  className={`flex-1 min-w-[250px] rounded-xl border-2 ${stage.color} flex flex-col`}
                >
                  <div className="px-4 py-3 font-semibold text-sm flex items-center justify-between border-b border-current border-opacity-20">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${stage.dot}`}
                      />
                      <span>{stage.label}</span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${stage.badge}`}
                    >
                      {stageNcrs.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {stageNcrs.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-6">
                        ไม่มีรายการ
                      </p>
                    )}
                    {stageNcrs.map((ncr) => (
                      <div
                        key={ncr.id}
                        onClick={() => setSelected(ncr)}
                        className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-all border border-gray-100 hover:border-gray-200"
                      >
                        <p className="text-sm font-medium text-gray-800 line-clamp-2">
                          {ncr.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className="text-xs text-gray-500">
                            {TYPE_LABELS[ncr.type] ?? ncr.type}
                          </span>
                          {ncr.job_no && (
                            <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
                              {ncr.job_no}
                            </span>
                          )}
                        </div>
                        {ncr.estimated_value_thb != null && (
                          <p className="text-xs text-gray-500 mt-1">
                            ฿{ncr.estimated_value_thb.toLocaleString()}
                          </p>
                        )}
                        {ncr.product_sku && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            SKU: {ncr.product_sku}
                            {ncr.quantity && ` × ${ncr.quantity}`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NcrPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-gray-400">
          กำลังโหลด...
        </div>
      }
    >
      <NcrPageInner />
    </Suspense>
  );
}

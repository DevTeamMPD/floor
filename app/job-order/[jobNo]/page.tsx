"use client";
import { useState, useEffect } from "react";
import { use } from "react";
import { createClient } from "@/lib/supabase/client";

interface MaterialItem {
  thickness: string;
  color: string;
  widthCm: string;
  lengthCm: string;
  qty: string;
}
interface SurveyData {
  cutTypes?: string[];
  weldType?: string;
  finishTypes?: string[];
  floorCondition?: string;
  wetZone?: boolean;
  areaSqm?: string;
  notes?: string;
}
interface HandoverData {
  actualAreaSqm?: string;
  materials?: MaterialItem[];
  notes?: string;
}

const CUT_LABELS: Record<string, string> = {
  corner_moulding: "มุมบัว / ประตูเลื่อน",
  pillar_corner: "มุมเสา",
  curved_wall: "กำแพงโค้ง",
  fixed_furniture: "เฟอร์นิเจอร์ติดตาย",
  straight_wall: "แนวกำแพงตรง",
};
const WELD_LABELS: Record<string, string> = {
  cold: "เย็น (น้ำยาประสาน)",
  hot: "ร้อน (เส้นเชื่อม + ไดร์ลมร้อน)",
  both: "ทั้งสองแบบ",
};
const FINISH_LABELS: Record<string, string> = {
  wall_moulding: "บัวผนัง",
  floor_moulding: "บัวพื้น / ตัวจบ",
  ramp_trim: "ตัวจบลาดเฉียงกันน้ำ",
};
const FLOOR_LABELS: Record<string, string> = {
  dry: "แห้งสะอาด",
  damp: "มีความชื้น",
  prep: "ต้องเตรียมพื้น",
};
const ROOM_LABELS: Record<string, string> = {
  bedroom: "ห้องนอน",
  living: "ห้องนั่งเล่น",
  corridor: "โถงทางเดิน",
  pet_room: "ห้องเลี้ยงสัตว์",
};
const SHIFT_LABELS: Record<string, string> = {
  morning: "🌅 กะเช้า",
  afternoon: "☀️ กะบ่าย",
  allday: "🌞 ทั้งวัน",
};

function formatThaiDate(d?: string) {
  if (!d) return "—";
  try {
    const date = new Date(d.includes("T") ? d : d + "T00:00:00");
    return date.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return d;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-300 pb-1 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function JobOrderPage({ params }: { params: Promise<{ jobNo: string }> }) {
  const { jobNo } = use(params);
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    createClient()
      .from("install_jobs")
      .select("*")
      .eq("job_no", jobNo)
      .single()
      .then(({ data }) => { setJob(data); setLoading(false); });
  }, [jobNo]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        กำลังโหลดข้อมูลใบงาน...
      </div>
    );
  }
  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500 text-sm">
        ไม่พบข้อมูลงาน: {jobNo}
      </div>
    );
  }

  const survey: SurveyData = job.survey_data ? JSON.parse(job.survey_data as string) : {};
  const handover: HandoverData = job.handover_data ? JSON.parse(job.handover_data as string) : {};
  const roomTypes = (job.room_type as string[] | null) ?? [];
  const materials: MaterialItem[] = handover.materials ?? [];
  const totalArea = materials.reduce((sum, m) => {
    const w = Number(m.widthCm), l = Number(m.lengthCm), q = Number(m.qty) || 1;
    return w > 0 && l > 0 ? sum + (w * l * q) / 10000 : sum;
  }, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
        body { font-family: 'Sarabun', sans-serif; }
        @media print {
          .no-print { display: none !important; }
          @page { margin: 1.5cm; size: A4; }
          body { background: white; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-100 print:bg-white">
        {/* Toolbar */}
        <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold shadow hover:bg-blue-700"
          >
            🖨️ พิมพ์ใบงาน
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold shadow hover:bg-gray-300"
          >
            ✕ ปิด
          </button>
        </div>

        {/* A4 Page */}
        <div className="max-w-3xl mx-auto bg-white shadow-xl print:shadow-none print:max-w-none p-10 my-8 print:my-0 print:p-8 text-gray-800 text-sm">

          {/* Header */}
          <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-800">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-gray-400">MPD Group · Hosttail</p>
              <h1 className="text-2xl font-bold text-gray-900 mt-1">ใบงานช่างติดตั้ง</h1>
              <p className="text-xs text-gray-400 mt-0.5">Anti-Slip Mat Installation Work Order</p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-xs text-gray-400">เลขที่ใบงาน</p>
              <p className="text-xl font-bold text-blue-700">{job.job_no as string}</p>
              {job.appt_date && (
                <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-right">
                  <p className="text-xs text-blue-500 font-medium">📅 วันที่นัดหมาย</p>
                  <p className="text-sm font-bold text-blue-800">{formatThaiDate(job.appt_date as string)}</p>
                  {job.appt_shift && (
                    <p className="text-xs text-blue-600">{SHIFT_LABELS[job.appt_shift as string] ?? job.appt_shift}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Customer */}
          <Section title="ข้อมูลลูกค้า">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
              <div>
                <p className="text-xs text-gray-400">ชื่อลูกค้า</p>
                <p className="font-semibold">{(job.customer_name as string) || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">เบอร์โทรศัพท์</p>
                <p className="font-semibold">{(job.phone as string) || "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400">ที่อยู่ติดตั้ง</p>
                <p className="font-semibold">{(job.address as string) || "—"}</p>
              </div>
              {job.location_url && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400">Google Maps</p>
                  <p className="text-blue-600 text-xs break-all">{job.location_url as string}</p>
                </div>
              )}
            </div>
          </Section>

          {/* Product */}
          <Section title="รายละเอียดสินค้า">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
              <div>
                <p className="text-xs text-gray-400">SKU</p>
                <p className="font-semibold font-mono">{(job.sku as string) || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">ออเดอร์ / บิล</p>
                <p className="font-semibold text-xs">
                  {[job.order_no, job.bill_no].filter(Boolean).join(" / ") || "—"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400">ชื่อสินค้า</p>
                <p className="font-semibold">{(job.product_name as string) || "—"}</p>
              </div>
              {roomTypes.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400">ประเภทพื้นที่</p>
                  <p className="font-semibold">{roomTypes.map((r) => ROOM_LABELS[r] ?? r).join(", ")}</p>
                </div>
              )}
              {survey.areaSqm && (
                <div>
                  <p className="text-xs text-gray-400">พื้นที่ประมาณการ</p>
                  <p className="font-semibold">{survey.areaSqm} ตร.ม.</p>
                </div>
              )}
            </div>
          </Section>

          {/* Survey */}
          {(survey.cutTypes?.length || survey.weldType || survey.finishTypes?.length || survey.floorCondition) ? (
            <Section title="รายละเอียดจากสำรวจหน้างาน">
              <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
                {survey.cutTypes?.length ? (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400">ประเภทการตัด</p>
                    <p className="font-medium">{survey.cutTypes.map((c) => CUT_LABELS[c] ?? c).join(", ")}</p>
                  </div>
                ) : null}
                {survey.weldType && (
                  <div>
                    <p className="text-xs text-gray-400">วิธีการเชื่อม</p>
                    <p className="font-medium">{WELD_LABELS[survey.weldType] ?? survey.weldType}</p>
                  </div>
                )}
                {survey.finishTypes?.length ? (
                  <div>
                    <p className="text-xs text-gray-400">การจบงาน</p>
                    <p className="font-medium">{survey.finishTypes.map((f) => FINISH_LABELS[f] ?? f).join(", ")}</p>
                  </div>
                ) : null}
                {survey.floorCondition && (
                  <div>
                    <p className="text-xs text-gray-400">สภาพพื้น</p>
                    <p className="font-medium">{FLOOR_LABELS[survey.floorCondition] ?? survey.floorCondition}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-400">โซนเปียก</p>
                  <p className="font-medium">{survey.wetZone ? "มี" : "ไม่มี"}</p>
                </div>
                {survey.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400">หมายเหตุสำรวจ</p>
                    <p className="font-medium">{survey.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          ) : null}

          {/* Materials */}
          <Section title="รายการวัสดุที่เบิก">
            {materials.length > 0 ? (
              <>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-xs text-gray-600">
                      <th className="border border-gray-300 px-2 py-1.5 text-center">#</th>
                      <th className="border border-gray-300 px-2 py-1.5">ความหนา</th>
                      <th className="border border-gray-300 px-2 py-1.5">สี</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">กว้าง (cm)</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">ยาว (cm)</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">จำนวน (ม้วน)</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">พื้นที่ (ตรม.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m, i) => {
                      const area =
                        m.widthCm && m.lengthCm
                          ? ((Number(m.widthCm) * Number(m.lengthCm) * (Number(m.qty) || 1)) / 10000).toFixed(2)
                          : "—";
                      return (
                        <tr key={i} className={i % 2 === 1 ? "bg-gray-50" : ""}>
                          <td className="border border-gray-300 px-2 py-1.5 text-center text-gray-400">{i + 1}</td>
                          <td className="border border-gray-300 px-2 py-1.5">{m.thickness ? `${m.thickness} cm` : "—"}</td>
                          <td className="border border-gray-300 px-2 py-1.5 capitalize">{m.color || "—"}</td>
                          <td className="border border-gray-300 px-2 py-1.5 text-center">{m.widthCm || "—"}</td>
                          <td className="border border-gray-300 px-2 py-1.5 text-center">{m.lengthCm || "—"}</td>
                          <td className="border border-gray-300 px-2 py-1.5 text-center">{m.qty || "—"}</td>
                          <td className="border border-gray-300 px-2 py-1.5 text-center">{area}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totalArea > 0 && (
                    <tfoot>
                      <tr className="bg-blue-50 font-semibold">
                        <td colSpan={6} className="border border-gray-300 px-2 py-1.5 text-right text-xs text-gray-600">รวมพื้นที่ทั้งหมด</td>
                        <td className="border border-gray-300 px-2 py-1.5 text-center">{totalArea.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                {handover.actualAreaSqm && (
                  <p className="text-xs text-gray-500 mt-2">
                    พื้นที่จริงที่ติดตั้ง: <strong>{handover.actualAreaSqm} ตร.ม.</strong>
                  </p>
                )}
              </>
            ) : (
              <>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-xs text-gray-600">
                      <th className="border border-gray-300 px-2 py-1.5 text-center">#</th>
                      <th className="border border-gray-300 px-2 py-1.5">ความหนา</th>
                      <th className="border border-gray-300 px-2 py-1.5">สี</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">กว้าง (cm)</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">ยาว (cm)</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">จำนวน (ม้วน)</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center">พื้นที่ (ตรม.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1,2,3].map((i) => (
                      <tr key={i}>
                        <td className="border border-gray-300 px-2 py-3 text-center text-gray-400">{i}</td>
                        <td className="border border-gray-300 px-2 py-3"></td>
                        <td className="border border-gray-300 px-2 py-3"></td>
                        <td className="border border-gray-300 px-2 py-3"></td>
                        <td className="border border-gray-300 px-2 py-3"></td>
                        <td className="border border-gray-300 px-2 py-3"></td>
                        <td className="border border-gray-300 px-2 py-3"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-1">* ยังไม่มีรายการวัสดุ — ช่างกรอกในใบงาน</p>
              </>
            )}
          </Section>

          {/* Notes */}
          <Section title="หมายเหตุ">
            <div className="min-h-[48px] border border-gray-200 rounded p-2 text-sm text-gray-700">
              {handover.notes || <span className="text-gray-300">—</span>}
            </div>
          </Section>

          {/* Signatures */}
          <div className="mt-8 grid grid-cols-2 gap-10">
            <div className="text-center">
              <div className="border-b border-gray-400 mb-2 pb-10"></div>
              <p className="text-xs text-gray-500 font-medium">ลายเซ็นช่างผู้ติดตั้ง</p>
              <p className="text-xs text-gray-400 mt-1">วันที่ ___________________</p>
            </div>
            <div className="text-center">
              <div className="border-b border-gray-400 mb-2 pb-10"></div>
              <p className="text-xs text-gray-500 font-medium">ลายเซ็นลูกค้า / ผู้รับงาน</p>
              <p className="text-xs text-gray-400 mt-1">วันที่ ___________________</p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-3 border-t border-gray-200 flex justify-between text-xs text-gray-400">
            <span>พิมพ์เมื่อ {new Date().toLocaleString("th-TH")}</span>
            <span>MPD Group | floor-delta.vercel.app</span>
          </div>

        </div>
      </div>
    </>
  );
}

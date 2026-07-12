"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import type { InstallJob } from "@/lib/types";
import { formatDate, ipGenToken } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  job: InstallJob;
  onClose: () => void;
  onRefresh: () => void;
}

const FIELD_ROWS = [
  { label: "ลูกค้า", key: "customer" as const },
  { label: "เบอร์โทร", key: "phone" as const },
  { label: "ที่อยู่", key: "addr" as const },
  { label: "สินค้า", key: "product" as const },
  { label: "SKU", key: "sku" as const },
  { label: "ออเดอร์", key: "order" as const },
  { label: "บิล", key: "bill" as const },
  { label: "วันที่สั่ง", key: "date" as const, format: true },
  { label: "กำหนดเสร็จ", key: "due" as const, format: true },
];

// ─── Survey types ────────────────────────────────────────────────────────────────────────────────
const CUT_TYPES = [
  { id: "corner_moulding", label: "มุมบัว / ประตูเลื่อน" },
  { id: "pillar_corner", label: "มุมเสา" },
  { id: "curved_wall", label: "กำแพงโค้ง" },
  { id: "fixed_furniture", label: "เฟอร์นิเจอร์ติดตาย" },
  { id: "straight_wall", label: "แนวกำแพงตรง" },
];

const WELD_TYPES = [
  { id: "cold", label: "เชื่อมเย็น (น้ำยาประสาน)" },
  { id: "hot", label: "เชื่อมร้อน (เส้นเชื่อม + ไดร์ลมร้อน)" },
  { id: "both", label: "ทั้งสองแบบ" },
];

const FINISH_TYPES = [
  { id: "wall_moulding", label: "บัวผนัง" },
  { id: "floor_moulding", label: "บัวพื้น / ตัวจบ" },
  { id: "ramp_trim", label: "ตัวจบลาดเฉียงกันน้ำ" },
];

const FLOOR_CONDITIONS = [
  { id: "dry", label: "แห้งสะอาด" },
  { id: "damp", label: "มีความชื้น" },
  { id: "prep", label: "ต้องเตรียมพื้น" },
];

interface SurveyData {
  cutTypes: string[];
  weldType: string;
  finishTypes: string[];
  floorCondition: string;
  wetZone: boolean;
  areaSqm: string;
  notes: string;
  savedAt?: string;
}

// ─── QC types ───────────────────────────────────────────────────────────────────────────────────
const QC_ITEMS = [
  { id: 1, label: "ช่องว่างขอบแผ่นกับผนัง/บัว/เสา/เฟอร์นิเจอร์", spec: "≤ 1 mm" },
  { id: 2, label: "รอยต่อชนก่อนเชื่อม", spec: "≤ 0.3 mm" },
  { id: 3, label: "ความตรงของแนวตัด", spec: "เบี่ยง ≤ 1 mm/1 m" },
  { id: 4, label: "ขอบแผ่นเผยอ / กระดก", spec: "= 0 mm" },
  { id: 5, label: "รอยตัดไหม้ / บิ่น / ฉีก", spec: "ต้องไม่มี" },
  { id: 6, label: "ความลึกร่องกรีด", spec: "~2/3 ความหนาแผ่น" },
  { id: 7, label: "ความสมบูรณ์แนวเชื่อม", spec: "เต็มแนว เรียบเสมอผิว" },
  { id: 8, label: "ความแข็งแรงรอยเชื่อม", spec: "ดึงเบาไม่แยก" },
  { id: 9, label: "เวลาบ่ม", spec: "≥ 24 ชม." },
  { id: 10, label: "บัว / ตัวจบแนบสนิท", spec: "0 mm" },
  { id: 11, label: "แนวซิลิโคนต่อเนื่อง", spec: "ไม่ขาดช่วง" },
  { id: 12, label: "โซนเปียก — น้ำไม่ซึมใต้แผ่น", spec: "ผ่านทดสอบ" },
  { id: 13, label: "ความลาดตัวจบ", spec: "เดินผ่านไม่สะดุ้ง" },
  { id: 14, label: "ความสะอาดผิวงาน", spec: "ไม่มีคราบ" },
  { id: 15, label: "สภาพพื้นก่อนติดตั้ง", spec: "แห้งสะอาด" },
];

type QCResult = "pass" | "fail" | "na" | null;
interface QCData {
  results: Record<number, QCResult>;
  inspector: string;
  notes: string;
  savedAt?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────────────────────────
export default function JobDrawer({ job, onClose, onRefresh }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<"info" | "stages" | "survey" | "qc" | "close">("info");
  const [saving, setSaving] = useState(false);

  // Survey state
  const [survey, setSurvey] = useState<SurveyData>({
    cutTypes: [],
    weldType: "",
    finishTypes: [],
    floorCondition: "",
    wetZone: false,
    areaSqm: "",
    notes: "",
  });
  const [surveyLoaded, setSurveyLoaded] = useState(false);

  // QC state
  const [qcResults, setQcResults] = useState<Record<number, QCResult>>({});
  const [qcInspector, setQcInspector] = useState("");
  const [qcNotes, setQcNotes] = useState("");
  const [qcLoaded, setQcLoaded] = useState(false);

  // Load survey + QC when those tabs are first opened
  useEffect(() => {
    if (tab === "survey" && !surveyLoaded) loadSurvey();
    if (tab === "qc" && !qcLoaded) loadQC();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadSurvey() {
    try {
      const { data, error } = await supabase
        .from("install_jobs")
        .select("survey_data")
        .eq("id", job.id)
        .single();
      if (!error && data?.survey_data) {
        const parsed: SurveyData = JSON.parse(data.survey_data);
        setSurvey(parsed);
      }
    } catch {
      // column not yet migrated — start blank
    }
    setSurveyLoaded(true);
  }

  async function loadQC() {
    try {
      const { data, error } = await supabase
        .from("install_jobs")
        .select("qc_data")
        .eq("id", job.id)
        .single();
      if (!error && data?.qc_data) {
        const parsed: QCData = JSON.parse(data.qc_data);
        setQcResults(parsed.results ?? {});
        setQcInspector(parsed.inspector ?? "");
        setQcNotes(parsed.notes ?? "");
      }
    } catch {
      // column not yet migrated — start blank
    }
    setQcLoaded(true);
  }

  async function saveSurvey() {
    setSaving(true);
    try {
      const payload: SurveyData = { ...survey, savedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("install_jobs")
        .update({ survey_data: JSON.stringify(payload) })
        .eq("id", job.id);
      if (error) throw error;
      toast.success("บันทึกข้อมูลสำรวจแล้ว");
      onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
      toast.error("บันทึกไม่สำเร็จ: " + msg);
    }
    setSaving(false);
  }

  async function saveQC() {
    setSaving(true);
    try {
      const payload: QCData = {
        results: qcResults,
        inspector: qcInspector,
        notes: qcNotes,
        savedAt: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("install_jobs")
        .update({ qc_data: JSON.stringify(payload) })
        .eq("id", job.id);
      if (error) throw error;
      toast.success("บันทึก QC แล้ว");
      onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
      toast.error("บันทึกไม่สำเร็จ: " + msg);
    }
    setSaving(false);
  }

  // ─── Advance stage ─────────────────────────────────────────────────────────────────────────────
  async function advanceStage() {
    if (job.stage >= 7) return;
    const { error } = await supabase
      .from("install_jobs")
      .update({ stage: job.stage + 1 })
      .eq("id", job.id);
    if (error) { toast.error("เกิดข้อผิดพลาด"); return; }
    toast.success(`ย้ายไป ${IP_STAGES[job.stage]?.name}`);
    onRefresh();
  }

  // ─── Close job ────────────────────────────────────────────────────────────────────────────────
  async function closeJob() {
    const token = ipGenToken();
    const { error } = await supabase
      .from("install_jobs")
      .update({ stage: 7, closed_at: new Date().toISOString(), eval_token: token })
      .eq("id", job.id);
    if (error) { toast.error("ปิดงานไม่สำเร็จ"); return; }
    await supabase.from("job_evals").insert({ install_job_id: job.id, token });
    const link = `${window.location.origin}/eval/${token}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    toast.success("ปิดงานแล้ว — ลิงก์ประเมินคัดลอกแล้ว");
    onRefresh();
    onClose();
  }

  // ─── QC stats ────────────────────────────────────────────────────────────────────────────────────
  const qcAnswered = Object.values(qcResults).filter(Boolean).length;
  const qcPass = Object.values(qcResults).filter((v) => v === "pass").length;
  const qcFail = Object.values(qcResults).filter((v) => v === "fail").length;

  // ─── Render ───────────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <div>
            <p className="text-xs text-gray-500">{job.ticket ?? job.order ?? "—"}</p>
            <p className="font-semibold text-gray-900 leading-tight">{job.customer}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl font-bold">✕</button>
        </div>

        {/* Stage badge */}
        <div className="px-4 pt-3 pb-1">
          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {IP_STAGES[job.stage - 1]?.name ?? `Stage ${job.stage}`}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex text-sm border-b overflow-x-auto">
          {(["info", "stages", "survey", "qc", "close"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 shrink-0 border-b-2 font-medium transition-colors ${
                tab === t
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "info" ? "ข้อมูล"
               : t === "stages" ? "สเตจ"
               : t === "survey" ? "สำรวจ"
               : t === "qc" ? "QC"
               : "ปิดงาน"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* ── INFO ── */}
          {tab === "info" && (
            <table className="w-full text-sm">
              <tbody>
                {FIELD_ROWS.map(({ label, key, format }) => {
                  const val = job[key as keyof InstallJob] as string | number | undefined;
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-gray-500 w-28 shrink-0">{label}</td>
                      <td className="py-2 font-medium text-gray-900 break-words">
                        {format && typeof val === "string" ? formatDate(val) : (val ?? "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── STAGES ── */}
          {tab === "stages" && (
            <div className="space-y-3">
              <ol className="space-y-1">
                {IP_STAGES.map((stage, i) => (
                  <li
                    key={i}
                    className={`flex items-center gap-3 p-2 rounded-lg text-sm ${
                      i + 1 < job.stage ? "text-gray-400 line-through"
                      : i + 1 === job.stage ? "bg-blue-50 font-semibold text-blue-800"
                      : "text-gray-500"
                    }`}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      i + 1 < job.stage ? "bg-gray-200 text-gray-500"
                      : i + 1 === job.stage ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-400"
                    }`}>{i + 1}</span>
                    {stage.icon} {stage.name}
                  </li>
                ))}
              </ol>
              {job.stage < 7 && (
                <button
                  onClick={advanceStage}
                  className="w-full mt-4 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  ➡ ย้ายไปขั้นถัดไป
                </button>
              )}
            </div>
          )}

          {/* ── SURVEY ── */}
          {tab === "survey" && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
                บันทึกข้อมูลสำรวจหน้างาน ใช้ที่ขั้นตอน ติดต่อลูกค้า / ยืนยันนัดหมาย
              </p>

              {/* Cut types */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">ประเภทการตัดที่ต้องทำ</legend>
                <div className="space-y-1.5">
                  {CUT_TYPES.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded accent-blue-600"
                        checked={survey.cutTypes.includes(id)}
                        onChange={(e) => {
                          setSurvey((s) => ({
                            ...s,
                            cutTypes: e.target.checked
                              ? [...s.cutTypes, id]
                              : s.cutTypes.filter((x) => x !== id),
                          }));
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Weld type */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">วิธีการเชื่อม</legend>
                <div className="space-y-1.5">
                  {WELD_TYPES.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="radio"
                        name="weldType"
                        className="w-4 h-4 accent-blue-600"
                        checked={survey.weldType === id}
                        onChange={() => setSurvey((s) => ({ ...s, weldType: id }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Finish types */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">การจบงาน</legend>
                <div className="space-y-1.5">
                  {FINISH_TYPES.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded accent-blue-600"
                        checked={survey.finishTypes.includes(id)}
                        onChange={(e) => {
                          setSurvey((s) => ({
                            ...s,
                            finishTypes: e.target.checked
                              ? [...s.finishTypes, id]
                              : s.finishTypes.filter((x) => x !== id),
                          }));
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Floor condition */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">สภาพพื้น</legend>
                <div className="space-y-1.5">
                  {FLOOR_CONDITIONS.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="radio"
                        name="floorCondition"
                        className="w-4 h-4 accent-blue-600"
                        checked={survey.floorCondition === id}
                        onChange={() => setSurvey((s) => ({ ...s, floorCondition: id }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Wet zone */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-gray-800">มีโซนเปียก?</label>
                <button
                  onClick={() => setSurvey((s) => ({ ...s, wetZone: !s.wetZone }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    survey.wetZone ? "bg-blue-600" : "bg-gray-200"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    survey.wetZone ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
                <span className="text-sm text-gray-600">{survey.wetZone ? "ใช่" : "ไม่มี"}</span>
              </div>

              {/* Area */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">พื้นที่ติดตั้ง (ตร.ม.)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="เช่น 24.5"
                  value={survey.areaSqm}
                  onChange={(e) => setSurvey((s) => ({ ...s, areaSqm: e.target.value }))}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">หมายเหตุ</label>
                <textarea
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="รายละเอียดเพิ่มเติมหน้างาน..."
                  value={survey.notes}
                  onChange={(e) => setSurvey((s) => ({ ...s, notes: e.target.value }))}
                />
              </div>

              {survey.savedAt && (
                <p className="text-xs text-gray-400">
                  บันทึกล่าสุด {new Date(survey.savedAt).toLocaleString("th-TH")}
                </p>
              )}

              <button
                onClick={saveSurvey}
                disabled={saving}
                className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "กำลังบันทึก..." : "💾 บันทึกข้อมูลสำรวจ"}
              </button>
            </div>
          )}

          {/* ── QC ── */}
          {tab === "qc" && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
                เกณฑ์ตรวจรับงาน 15 ข้อ ตาม SOP — ใช้ที่ขั้นตอน ตรวจสอบงาน (Stage 6)
              </div>

              {/* Stats bar */}
              <div className="flex gap-3 text-xs">
                <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">ตอบแล้ว {qcAnswered}/15</span>
                <span className="px-2 py-1 rounded-full bg-green-100 text-green-700">ผ่าน {qcPass}</span>
                <span className="px-2 py-1 rounded-full bg-red-100 text-red-700">ไม่ผ่าน {qcFail}</span>
              </div>

              {/* Checklist */}
              <div className="space-y-2">
                {QC_ITEMS.map(({ id, label, spec }) => (
                  <div key={id} className="border rounded-lg p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">
                          <span className="text-gray-400 mr-1">{id}.</span>{label}
                        </p>
                        <p className="text-xs text-gray-500">{spec}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(["pass", "fail", "na"] as QCResult[]).map((v) => (
                        <button
                          key={v as string}
                          onClick={() =>
                            setQcResults((r) => ({
                              ...r,
                              [id]: r[id] === v ? null : v,
                            }))
                          }
                          className={`flex-1 py-1 rounded text-xs font-medium transition-colors border ${
                            qcResults[id] === v
                              ? v === "pass"
                                ? "bg-green-500 text-white border-green-500"
                                : v === "fail"
                                ? "bg-red-500 text-white border-red-500"
                                : "bg-gray-400 text-white border-gray-400"
                              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          {v === "pass" ? "ผ่าน" : v === "fail" ? "ไม่ผ่าน" : "N/A"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Inspector */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">ผู้ตรวจ</label>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ชื่อผู้ตรวจ"
                  value={qcInspector}
                  onChange={(e) => setQcInspector(e.target.value)}
                />
              </div>

              {/* QC notes */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">หมายเหตุ QC</label>
                <textarea
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="ประเด็นที่พบ หรือข้อสังเกต..."
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                />
              </div>

              {/* Warning if any fail */}
              {qcFail > 0 && (
                <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                  ⚠️ มี {qcFail} รายการที่ยังไม่ผ่าน — กรุณาแก้ไขก่อนปิดงาน
                </div>
              )}

              {/* Save */}
              <button
                onClick={saveQC}
                disabled={saving}
                className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "กำลังบันทึก..." : "💾 บันทึก QC"}
              </button>
            </div>
          )}

          {/* ── CLOSE ── */}
          {tab === "close" && (
            <div className="space-y-4">
              {qcFail > 0 && (
                <div className="text-sm bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">
                  ⚠️ มี {qcFail} รายการ QC ที่ยังไม่ผ่าน — แนะนำแก้ไขก่อนปิดงาน
                </div>
              )}
              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1">
                <p>การปิดงานจะ:</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                  <li>เปลี่ยน Stage เป็น <strong>เสร็จสิ้น</strong></li>
                  <li>บันทึกวันที่ปิดงาน</li>
                  <li>สร้างลิงก์ประเมินและคัดลอกไปยัง Clipboard</li>
                </ul>
              </div>
              <button
                onClick={closeJob}
                disabled={saving}
                className="w-full bg-green-600 text-white rounded-lg py-3 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                ✅ ปิดงาน &amp; คัดลอกลิงก์ประเมิน
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

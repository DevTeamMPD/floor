"use client";
import { useState, useEffect, useRef } from "react";
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

// Static fields — customer/phone/addr are editable in the contact section below
const FIELD_ROWS = [
  { label: "สินค้า", key: "product" as const },
  { label: "SKU", key: "sku" as const },
  { label: "ออเดอร์", key: "order" as const },
  { label: "บิล", key: "bill" as const },
  { label: "วันที่สั่ง", key: "date" as const, format: true },
  { label: "กำหนดเสร็จ", key: "due" as const, format: true },
];

const SHIFT_OPTIONS = [
  { value: "morning", label: "🌅 เช้า" },
  { value: "afternoon", label: "☀️ บ่าย" },
  { value: "allday", label: "🌞 ทั้งวัน" },
] as const;

const BUCKET = "job-photos";

// ─── Survey types ─────────────────────────────────────────────────────────────
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

// ─── QC types ─────────────────────────────────────────────────────────────────
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function JobDrawer({ job, onClose, onRefresh }: Props) {
  const supabase = createClient();
  const jobNo = job.jobNo ?? "";
  const [tab, setTab] = useState<"info" | "stages" | "survey" | "qc" | "photos" | "close">("info");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const completionFileInputRef = useRef<HTMLInputElement>(null);

  // ─── Contact/appointment draft state ──────────────────────────────────────
  const [contactDraft, setContactDraft] = useState({
    customer_name: job.customer ?? "",
    phone: job.phone ?? "",
    address: job.addr ?? "",
    location_url: job.locationUrl ?? "",
    appt_shift: job.apptShift ?? "",
  });

  // ─── Survey state ──────────────────────────────────────────────────────────
  const [survey, setSurvey] = useState<SurveyData>({
    cutTypes: [], weldType: "", finishTypes: [],
    floorCondition: "", wetZone: false, areaSqm: "", notes: "",
  });
  const [surveyLoaded, setSurveyLoaded] = useState(false);

  // ─── QC state ──────────────────────────────────────────────────────────────
  const [qcResults, setQcResults] = useState<Record<number, QCResult>>({});
  const [qcInspector, setQcInspector] = useState("");
  const [qcNotes, setQcNotes] = useState("");
  const [qcLoaded, setQcLoaded] = useState(false);

  // ─── Photos state ──────────────────────────────────────────────────────────
  const [photoPaths, setPhotoPaths] = useState<string[]>(job.sitePhotos ?? []);
  const [completionPhotoPaths, setCompletionPhotoPaths] = useState<string[]>(job.completionPhotos ?? []);
  const [uploading, setUploading] = useState(false);

  // lazy load survey/qc
  useEffect(() => {
    if (tab === "survey" && !surveyLoaded) loadSurvey();
    if (tab === "qc" && !qcLoaded) loadQC();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadSurvey() {
    try {
      const { data, error } = await supabase
        .from("install_jobs").select("survey_data").eq("job_no", jobNo).single();
      if (!error && data?.survey_data) setSurvey(JSON.parse(data.survey_data));
    } catch { /* column not yet migrated */ }
    setSurveyLoaded(true);
  }

  async function loadQC() {
    try {
      const { data, error } = await supabase
        .from("install_jobs").select("qc_data").eq("job_no", jobNo).single();
      if (!error && data?.qc_data) {
        const p: QCData = JSON.parse(data.qc_data);
        setQcResults(p.results ?? {});
        setQcInspector(p.inspector ?? "");
        setQcNotes(p.notes ?? "");
      }
    } catch { /* column not yet migrated */ }
    setQcLoaded(true);
  }

  // ─── Save contact/appointment info ─────────────────────────────────────────
  async function saveContact() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("install_jobs")
        .update({
          customer_name: contactDraft.customer_name,
          phone: contactDraft.phone,
          address: contactDraft.address,
          location_url: contactDraft.location_url || null,
          appt_shift: contactDraft.appt_shift || null,
        })
        .eq("job_no", jobNo);
      if (error) throw error;
      toast.success("บันทึกข้อมูลแล้ว");
      onRefresh();
    } catch (e: unknown) {
      toast.error("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : ""));
    }
    setSaving(false);
  }

  async function saveSurvey() {
    setSaving(true);
    try {
      const payload: SurveyData = { ...survey, savedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("install_jobs").update({ survey_data: JSON.stringify(payload) }).eq("job_no", jobNo);
      if (error) throw error;
      toast.success("บันทึกข้อมูลสำรวจแล้ว");
      onRefresh();
    } catch (e: unknown) {
      toast.error("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : ""));
    }
    setSaving(false);
  }

  async function saveQC() {
    setSaving(true);
    try {
      const payload: QCData = { results: qcResults, inspector: qcInspector, notes: qcNotes, savedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("install_jobs").update({ qc_data: JSON.stringify(payload) }).eq("job_no", jobNo);
      if (error) throw error;
      toast.success("บันทึก QC แล้ว");
      onRefresh();
    } catch (e: unknown) {
      toast.error("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : ""));
    }
    setSaving(false);
  }

  // ─── Photos ────────────────────────────────────────────────────────────────
  function getPublicUrl(path: string): string {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function uploadPhotos(files: FileList) {
    setUploading(true);
    const newPaths = [...photoPaths];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${jobNo}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) { toast.error(`อัปโหลดไม่สำเร็จ: ${file.name}`); continue; }
      newPaths.push(path);
    }
    const { error: dbErr } = await supabase
      .from("install_jobs").update({ site_photos: newPaths }).eq("job_no", jobNo);
    if (dbErr) { toast.error("บันทึกไม่สำเร็จ"); }
    else { setPhotoPaths(newPaths); toast.success(`อัปโหลดแล้ว ${newPaths.length - photoPaths.length} รูป`); onRefresh(); }
    setUploading(false);
  }

  async function deletePhoto(path: string) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) { toast.error("ลบไม่สำเร็จ"); return; }
    const newPaths = photoPaths.filter((p) => p !== path);
    const { error: dbErr } = await supabase
      .from("install_jobs").update({ site_photos: newPaths }).eq("job_no", jobNo);
    if (dbErr) { toast.error("อัปเดต DB ไม่สำเร็จ"); return; }
    setPhotoPaths(newPaths);
    toast.success("ลบรูปแล้ว");
    onRefresh();
  }

  // ─── Completion photos ─────────────────────────────────────────────────────
  async function uploadCompletionPhotos(files: FileList) {
    setUploading(true);
    const newPaths = [...completionPhotoPaths];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${jobNo}/completion/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) { toast.error(`อัปโหลดไม่สำเร็จ: ${file.name}`); continue; }
      newPaths.push(path);
    }
    const { error: dbErr } = await supabase
      .from("install_jobs").update({ completion_photos: newPaths }).eq("job_no", jobNo);
    if (dbErr) { toast.error("บันทึกไม่สำเร็จ"); }
    else { setCompletionPhotoPaths(newPaths); toast.success(`อัปโหลดแล้ว ${newPaths.length - completionPhotoPaths.length} รูป`); onRefresh(); }
    setUploading(false);
  }

  async function deleteCompletionPhoto(path: string) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) { toast.error("ลบไม่สำเร็จ"); return; }
    const newPaths = completionPhotoPaths.filter((p) => p !== path);
    const { error: dbErr } = await supabase
      .from("install_jobs").update({ completion_photos: newPaths }).eq("job_no", jobNo);
    if (dbErr) { toast.error("อัปเดต DB ไม่สำเร็จ"); return; }
    setCompletionPhotoPaths(newPaths);
    toast.success("ลบรูปแล้ว");
    onRefresh();
  }

  // ─── Advance stage ─────────────────────────────────────────────────────────
  async function advanceStage() {
    if (job.stage >= 7) return;
    const { error } = await supabase
      .from("install_jobs").update({ stage: job.stage + 1 }).eq("job_no", jobNo);
    if (error) { toast.error("เกิดข้อผิดพลาด"); return; }
    toast.success(`ย้ายไป ${IP_STAGES[job.stage]?.name}`);
    onRefresh();
  }

  // ─── Close job ─────────────────────────────────────────────────────────────
  async function closeJob() {
    const token = ipGenToken();
    const { error } = await supabase
      .from("install_jobs")
      .update({ stage: 7, closed_at: new Date().toISOString(), eval_token: token })
      .eq("job_no", jobNo);
    if (error) { toast.error("ปิดงานไม่สำเร็จ"); return; }
    await supabase.from("job_evals").insert({ install_job_id: jobNo, token });
    const link = `${window.location.origin}/eval?t=${token}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    toast.success("ปิดงานแล้ว — ลิงก์ประเมินคัดลอกแล้ว");
    onRefresh(); onClose();
  }

  // ─── QC stats ──────────────────────────────────────────────────────────────
  const qcAnswered = Object.values(qcResults).filter(Boolean).length;
  const qcPass    = Object.values(qcResults).filter((v) => v === "pass").length;
  const qcFail    = Object.values(qcResults).filter((v) => v === "fail").length;

  // ─── Render ────────────────────────────────────────────────────────────────
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
          {job.apptShift && (
            <span className={`ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
              job.apptShift === "morning" ? "bg-orange-100 text-orange-700"
              : job.apptShift === "afternoon" ? "bg-yellow-100 text-yellow-700"
              : "bg-green-100 text-green-700"
            }`}>
              {job.apptShift === "morning" ? "🌅 เช้า" : job.apptShift === "afternoon" ? "☀️ บ่าย" : "🌞 ทั้งวัน"}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex text-sm border-b overflow-x-auto">
          {(["info", "stages", "survey", "qc", "photos", "close"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 shrink-0 border-b-2 font-medium transition-colors ${
                tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "info" ? "ข้อมูล"
               : t === "stages" ? "สเตจ"
               : t === "survey" ? "สำรวจ"
               : t === "qc" ? "QC"
               : t === "photos" ? `รูป${photoPaths.length ? ` (${photoPaths.length})` : ""}`
               : `ปิดงาน${completionPhotoPaths.length ? ` 📷${completionPhotoPaths.length}` : ""}`}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* ── INFO ── */}
          {tab === "info" && (
            <div className="space-y-4">
              {/* Static job info */}
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

              {/* Photo prompt banner — stage 2 */}
              {job.stage === 2 && (
                <button
                  onClick={() => setTab("photos")}
                  className="w-full flex items-center gap-3 border border-blue-200 bg-blue-50 rounded-xl p-3 hover:bg-blue-100 transition-colors text-left"
                >
                  <span className="text-2xl">📷</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-800">แนบรูปพื้นที่บ้านลูกค้า</p>
                    <p className="text-xs text-blue-600">ให้ช่างรู้ลักษณะพื้นก่อนเข้างาน{photoPaths.length > 0 ? ` — มี ${photoPaths.length} รูปแล้ว` : " — ยังไม่มีรูป"}</p>
                  </div>
                  <span className="text-blue-400 text-lg">›</span>
                </button>
              )}

              {/* Editable contact + appointment section */}
              <div className="border border-slate-200 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">📞 ข้อมูลติดต่อ / นัดหมาย</p>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">ชื่อลูกค้า</label>
                  <input
                    value={contactDraft.customer_name}
                    onChange={(e) => setContactDraft((d) => ({ ...d, customer_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">เบอร์โทร</label>
                  <input
                    value={contactDraft.phone}
                    onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">ที่อยู่ติดตั้ง</label>
                  <textarea
                    rows={2}
                    value={contactDraft.address}
                    onChange={(e) => setContactDraft((d) => ({ ...d, address: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">📍 Google Maps URL</label>
                  <div className="flex gap-2">
                    <input
                      value={contactDraft.location_url}
                      onChange={(e) => setContactDraft((d) => ({ ...d, location_url: e.target.value }))}
                      placeholder="https://maps.app.goo.gl/..."
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    {contactDraft.location_url && (
                      <a
                        href={contactDraft.location_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 bg-green-100 text-green-700 rounded-lg text-xs font-medium hover:bg-green-200 whitespace-nowrap flex items-center"
                      >
                        📍 เปิด
                      </a>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">🕐 กะนัดหมาย</label>
                  <div className="flex gap-2">
                    {SHIFT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setContactDraft((d) => ({
                            ...d,
                            appt_shift: d.appt_shift === opt.value ? "" : opt.value,
                          }))
                        }
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          contactDraft.appt_shift === opt.value
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={saveContact}
                  disabled={saving}
                  className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "กำลังบันทึก…" : "💾 บันทึกข้อมูล"}
                </button>
              </div>
            </div>
          )}

          {/* ── STAGES ── */}
          {tab === "stages" && (
            <div className="space-y-3">
              <ol className="space-y-1">
                {IP_STAGES.map((stage, i) => (
                  <li key={i} className={`flex items-center gap-3 p-2 rounded-lg text-sm ${
                    i + 1 < job.stage ? "text-gray-400 line-through"
                    : i + 1 === job.stage ? "bg-blue-50 font-semibold text-blue-800"
                    : "text-gray-500"
                  }`}>
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
                <button onClick={advanceStage}
                  className="w-full mt-4 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 transition-colors">
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
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">ประเภทการตัดที่ต้องทำ</legend>
                <div className="space-y-1.5">
                  {CUT_TYPES.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" className="w-4 h-4 rounded accent-blue-600"
                        checked={survey.cutTypes.includes(id)}
                        onChange={(e) => setSurvey((s) => ({ ...s, cutTypes: e.target.checked ? [...s.cutTypes, id] : s.cutTypes.filter((x) => x !== id) }))}
                      />{label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">วิธีการเชื่อม</legend>
                <div className="space-y-1.5">
                  {WELD_TYPES.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="radio" name="weldType" className="w-4 h-4 accent-blue-600"
                        checked={survey.weldType === id}
                        onChange={() => setSurvey((s) => ({ ...s, weldType: id }))}
                      />{label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">การจบงาน</legend>
                <div className="space-y-1.5">
                  {FINISH_TYPES.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" className="w-4 h-4 rounded accent-blue-600"
                        checked={survey.finishTypes.includes(id)}
                        onChange={(e) => setSurvey((s) => ({ ...s, finishTypes: e.target.checked ? [...s.finishTypes, id] : s.finishTypes.filter((x) => x !== id) }))}
                      />{label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800 mb-2">สภาพพื้น</legend>
                <div className="space-y-1.5">
                  {FLOOR_CONDITIONS.map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="radio" name="floorCondition" className="w-4 h-4 accent-blue-600"
                        checked={survey.floorCondition === id}
                        onChange={() => setSurvey((s) => ({ ...s, floorCondition: id }))}
                      />{label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-gray-800">มีโซนเปียก?</label>
                <button onClick={() => setSurvey((s) => ({ ...s, wetZone: !s.wetZone }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${survey.wetZone ? "bg-blue-600" : "bg-gray-200"}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${survey.wetZone ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <span className="text-sm text-gray-600">{survey.wetZone ? "ใช่" : "ไม่มี"}</span>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">พื้นที่ติดตั้ง (ตร.ม.)</label>
                <input type="number" min="0" step="0.1" placeholder="เช่น 24.5"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={survey.areaSqm} onChange={(e) => setSurvey((s) => ({ ...s, areaSqm: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">หมายเหตุ</label>
                <textarea rows={3} placeholder="รายละเอียดเพิ่มเติม..."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  value={survey.notes} onChange={(e) => setSurvey((s) => ({ ...s, notes: e.target.value }))} />
              </div>
              {survey.savedAt && (
                <p className="text-xs text-gray-400">บันทึกล่าสุด {new Date(survey.savedAt).toLocaleString("th-TH")}</p>
              )}
              <button onClick={saveSurvey} disabled={saving}
                className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
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
              <div className="flex gap-3 text-xs">
                <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">ตอบแล้ว {qcAnswered}/15</span>
                <span className="px-2 py-1 rounded-full bg-green-100 text-green-700">ผ่าน {qcPass}</span>
                <span className="px-2 py-1 rounded-full bg-red-100 text-red-700">ไม่ผ่าน {qcFail}</span>
              </div>
              <div className="space-y-2">
                {QC_ITEMS.map(({ id, label, spec }) => (
                  <div key={id} className="border rounded-lg p-3 space-y-1.5">
                    <p className="text-sm font-medium text-gray-800"><span className="text-gray-400 mr-1">{id}.</span>{label}</p>
                    <p className="text-xs text-gray-500">{spec}</p>
                    <div className="flex gap-2">
                      {(["pass", "fail", "na"] as QCResult[]).map((v) => (
                        <button key={v as string}
                          onClick={() => setQcResults((r) => ({ ...r, [id]: r[id] === v ? null : v }))}
                          className={`flex-1 py-1 rounded text-xs font-medium transition-colors border ${
                            qcResults[id] === v
                              ? v === "pass" ? "bg-green-500 text-white border-green-500"
                                : v === "fail" ? "bg-red-500 text-white border-red-500"
                                : "bg-gray-400 text-white border-gray-400"
                              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                          }`}>
                          {v === "pass" ? "ผ่าน" : v === "fail" ? "ไม่ผ่าน" : "N/A"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">ผู้ตรวจ</label>
                <input type="text" placeholder="ชื่อผู้ตรวจ"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={qcInspector} onChange={(e) => setQcInspector(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">หมายเหตุ QC</label>
                <textarea rows={3} placeholder="ประเด็นที่พบ / ข้อสังเกต..."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  value={qcNotes} onChange={(e) => setQcNotes(e.target.value)} />
              </div>
              {qcFail > 0 && (
                <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                  ⚠️ มี {qcFail} รายการที่ยังไม่ผ่าน — กรุณาแก้ไขก่อนปิดงาน
                </div>
              )}
              <button onClick={saveQC} disabled={saving}
                className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? "กำลังบันทึก..." : "💾 บันทึก QC"}
              </button>
            </div>
          )}

          {/* ── PHOTOS ── */}
          {tab === "photos" && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
                อัปโหลดรูปหน้างาน / สภาพพื้น / งานสำเร็จ — เก็บไว้ใน Supabase Storage
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadPhotos(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-blue-300 rounded-lg py-6 text-sm text-blue-600 font-medium hover:bg-blue-50 disabled:opacity-50 transition-colors"
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    กำลังอัปโหลด...
                  </span>
                ) : (
                  <>📷 แตะรูปเพื่ออัปโหลด</>
                )}
              </button>

              {photoPaths.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีรูป</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {photoPaths.map((path) => (
                    <div key={path} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getPublicUrl(path)}
                        alt="รูปหน้างาน"
                        className="w-full h-40 object-cover rounded-lg border"
                        loading="lazy"
                      />
                      <button
                        onClick={() => deletePhoto(path)}
                        className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
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

              {/* Completion photos */}
              <div className="border border-slate-200 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">📸 รูปงานเสร็จสิ้น</p>
                <p className="text-xs text-gray-500">ถ่ายรูปหลังงานเสร็จ — ลูกค้าจะเห็นผ่านลิงก์ประเมิน</p>

                <input
                  ref={completionFileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && uploadCompletionPhotos(e.target.files)}
                />
                <button
                  onClick={() => completionFileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full border-2 border-dashed border-green-300 rounded-lg py-4 text-sm text-green-700 font-medium hover:bg-green-50 disabled:opacity-50 transition-colors"
                >
                  {uploading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      กำลังอัปโหลด...
                    </span>
                  ) : (
                    <>📷 ถ่ายรูป / เลือกรูปงานเสร็จ{completionPhotoPaths.length ? ` (${completionPhotoPaths.length})` : ""}</>
                  )}
                </button>

                {completionPhotoPaths.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {completionPhotoPaths.map((path) => (
                      <div key={path} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getPublicUrl(path)}
                          alt="รูปงานเสร็จ"
                          className="w-full h-32 object-cover rounded-lg border"
                          loading="lazy"
                        />
                        <button
                          onClick={() => deleteCompletionPhoto(path)}
                          className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1">
                <p>การปิดงานจะ:</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                  <li>เปลี่ยน Stage เป็น <strong>เสร็จสิ้น</strong></li>
                  <li>บันทึกวันที่ปิดงาน</li>
                  <li>สร้างลิงก์ประเมินและคัดลอกไปยัง Clipboard</li>
                </ul>
              </div>
              <button onClick={closeJob} disabled={saving}
                className="w-full bg-green-600 text-white rounded-lg py-3 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                ✅ ปิดงาน &amp; คัดลอกลิงก์ประเมิน
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

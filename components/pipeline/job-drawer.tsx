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

const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1xTJeN6HAhqX8wZ1RKFjm1yzrHaIPCnUpas7E_W2I50I/edit?usp=sharing";

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

const ROOM_TYPES = [
  { id: "bedroom", label: "ห้องนอน" },
  { id: "living", label: "ห้องนั่งเล่น" },
  { id: "corridor", label: "โถงทางเดิน" },
  { id: "pet_room", label: "ห้องเลี้ยงสัตว์" },
];

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
interface ZoneDimension {
  roomType: string;
  widthM: string;
  lengthM: string;
}

interface SurveyData {
  cutTypes: string[];
  weldType: string;
  finishTypes: string[];
  floorCondition: string;
  wetZone: boolean;
  areaSqm: string;
  zones?: ZoneDimension[];
  notes: string;
  savedAt?: string;
}

const PRE_INSTALL_ITEMS = [
  { id: 1, label: "จำนวนสินค้า / จำนวนแผ่นครบตามรายการ" },
  { id: 2, label: "สี / รุ่น / ลวดลายตรงตามที่ลูกค้าสั่งซื้อ" },
  { id: 3, label: "สินค้าไม่มีรอยชำรุด แตกหัก หรือเสียหายก่อนติดตั้ง" },
  { id: 4, label: "พื้นที่หน้างานพร้อมสำหรับการติดตั้ง" },
  { id: 5, label: "ลูกค้ารับทราบแนวทาง / รูปแบบการติดตั้ง" },
];
interface PreInstallData {
  checks: Record<number, boolean>;
  notes: string;
  savedAt?: string;
}

const HANDOVER_ITEMS = [
  { id: 1, label: "ติดตั้งครบตามพื้นที่ที่ตกลง" },
  { id: 2, label: "งานติดตั้งเรียบร้อย แนบสนิท และพร้อมใช้งาน" },
  { id: 3, label: "พื้นที่หน้างานได้รับการเก็บความเรียบร้อยหลังติดตั้ง" },
  { id: 4, label: "ลูกค้าได้รับคำแนะนำการดูแลรักษาเบื้องต้น" },
  { id: 5, label: "ลูกค้าตรวจรับงานเรียบร้อย" },
];

interface MaterialItem {
  thickness: "0.6" | "1.6" | "";
  color: "beige" | "whitebuzz" | "";
  widthCm: "110" | "140" | "";
  lengthCm: string;
  qty: string;
}

const EMPTY_MATERIAL: MaterialItem = { thickness: "", color: "", widthCm: "", lengthCm: "", qty: "" };

interface ReturnItem {
  thickness: "0.6" | "1.6" | "";
  color: "beige" | "whitebuzz" | "";
  widthCm: "110" | "140" | "";
  lengthCm: string;
  qty: string;
}
const EMPTY_RETURN: ReturnItem = { thickness: "", color: "", widthCm: "", lengthCm: "", qty: "" };

interface HandoverData {
  checks: Record<number, boolean>;
  actualAreaSqm: string;
  materials: MaterialItem[];
  returnItems: ReturnItem[];
  notes: string;
  savedAt?: string;
}

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

export default function JobDrawer({ job, onClose, onRefresh }: Props) {
  const supabase = createClient();
  const jobNo = job.jobNo ?? "";
  const [tab, setTab] = useState<"info" | "stages" | "survey" | "qc" | "photos" | "close">("info");
  const [saving, setSaving] = useState(false);
  const [contactErrors, setContactErrors] = useState<string[]>([]);
  const [zoneDimensions, setZoneDimensions] = useState<ZoneDimension[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const completionFileInputRef = useRef<HTMLInputElement>(null);

  const [contactDraft, setContactDraft] = useState({
    customer_name: job.customer ?? "",
    phone: job.phone ?? "",
    address: job.addr ?? "",
    location_url: job.locationUrl ?? "",
    appt_shift: job.apptShift ?? "",
    apptDate: job.apptDate ?? "",
  });
  const [roomTypes, setRoomTypes] = useState<string[]>([]);
  const [roomTypesLoaded, setRoomTypesLoaded] = useState(false);

  const [survey, setSurvey] = useState<SurveyData>({
    cutTypes: [], weldType: "", finishTypes: [],
    floorCondition: "", wetZone: false, areaSqm: "", notes: "",
  });
  const [surveyLoaded, setSurveyLoaded] = useState(false);

  const [preInstall, setPreInstall] = useState<PreInstallData>({ checks: {}, notes: "" });
  const [preInstallLoaded, setPreInstallLoaded] = useState(false);

  const [qcResults, setQcResults] = useState<Record<number, QCResult>>({});
  const [qcInspector, setQcInspector] = useState("");
  const [qcNotes, setQcNotes] = useState("");
  const [qcLoaded, setQcLoaded] = useState(false);

  const [handover, setHandover] = useState<HandoverData>({
    checks: {}, actualAreaSqm: "", materials: [{ ...EMPTY_MATERIAL }], returnItems: [{ ...EMPTY_RETURN }], notes: "",
  });
  const [handoverLoaded, setHandoverLoaded] = useState(false);

  const [photoPaths, setPhotoPaths] = useState<string[]>(job.sitePhotos ?? []);
  const [completionPhotoPaths, setCompletionPhotoPaths] = useState<string[]>(job.completionPhotos ?? []);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadRoomTypes(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "survey" && !surveyLoaded) loadSurvey();
    if (tab === "qc") {
      if (!qcLoaded) loadQC();
      if (!preInstallLoaded) loadPreInstall();
    }
    if (tab === "close" && !handoverLoaded) loadHandover();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRoomTypes() {
    if (roomTypesLoaded) return;
    try {
      const { data } = await supabase
        .from("install_jobs").select("room_type, survey_data").eq("job_no", jobNo).single();
      if (data?.room_type) {
        const rts = data.room_type as string[];
        setRoomTypes(rts);
        // Init zones for any room types that don't already have a zone entry
        if (data?.survey_data) {
          const sd = JSON.parse(data.survey_data as string);
          if (sd.zones && sd.zones.length > 0) {
            setZoneDimensions(sd.zones);
          } else {
            setZoneDimensions(rts.map((rt) => ({ roomType: rt, widthM: "", lengthM: "" })));
          }
        } else {
          setZoneDimensions(rts.map((rt) => ({ roomType: rt, widthM: "", lengthM: "" })));
        }
      }
    } catch { }
    setRoomTypesLoaded(true);
  }

  async function loadSurvey() {
    try {
      const { data } = await supabase
        .from("install_jobs").select("survey_data").eq("job_no", jobNo).single();
      if (data?.survey_data) setSurvey(JSON.parse(data.survey_data));
    } catch { }
    setSurveyLoaded(true);
  }

  async function loadPreInstall() {
    try {
      const { data } = await supabase
        .from("install_jobs").select("pre_install_data").eq("job_no", jobNo).single();
      if (data?.pre_install_data) setPreInstall(JSON.parse(data.pre_install_data));
    } catch { }
    setPreInstallLoaded(true);
  }

  async function loadQC() {
    try {
      const { data } = await supabase
        .from("install_jobs").select("qc_data").eq("job_no", jobNo).single();
      if (data?.qc_data) {
        const p: QCData = JSON.parse(data.qc_data);
        setQcResults(p.results ?? {});
        setQcInspector(p.inspector ?? "");
        setQcNotes(p.notes ?? "");
      }
    } catch { }
    setQcLoaded(true);
  }

  async function loadHandover() {
    try {
      const { data } = await supabase
        .from("install_jobs").select("handover_data").eq("job_no", jobNo).single();
      if (data?.handover_data) {
        const parsed = JSON.parse(data.handover_data);
        if (!parsed.materials) parsed.materials = [{ ...EMPTY_MATERIAL }];
        if (!parsed.returnItems) parsed.returnItems = [{ ...EMPTY_RETURN }];
        setHandover(parsed);
      }
    } catch { }
    setHandoverLoaded(true);
  }

  async function saveContact() {
    // Client-side validation
    const missing: string[] = [];
    if (!contactDraft.customer_name.trim()) missing.push("ชื่อลูกค้า");
    if (!contactDraft.phone.trim()) missing.push("เบอร์โทร");
    if (!contactDraft.address.trim()) missing.push("ที่อยู่ติดตั้ง");
    if (missing.length > 0) {
      toast.error("กรุณากรอกข้อมูล: " + missing.join(", "));
      setContactErrors(missing);
      return;
    }
    setContactErrors([]);
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
          appt_date: contactDraft.apptDate || null,
          room_type: roomTypes.length ? roomTypes : null,
          survey_data: JSON.stringify({ ...survey, zones: zoneDimensions }),
        })
        .eq("job_no", jobNo);
      if (error) throw error;
      toast.success("บันทึกข้อมูลแล้ว");
      onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? JSON.stringify(e);
      toast.error("บันทึกไม่สำเร็จ: " + msg);
    }
    setSaving(false);
  }

  async function saveSurvey() {
    setSaving(true);
    try {
      const payload: SurveyData = { ...survey, zones: zoneDimensions, savedAt: new Date().toISOString() };
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

  async function savePreInstall() {
    setSaving(true);
    try {
      const payload: PreInstallData = { ...preInstall, savedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("install_jobs").update({ pre_install_data: JSON.stringify(payload) }).eq("job_no", jobNo);
      if (error) throw error;
      toast.success("บันทึกรายการตรวจเช็คแล้ว");
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

  async function saveHandover() {
    setSaving(true);
    try {
      const payload: HandoverData = { ...handover, savedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("install_jobs").update({ handover_data: JSON.stringify(payload) }).eq("job_no", jobNo);
      if (error) throw error;
      toast.success("บันทึกรายการส่งมอบแล้ว");
    } catch (e: unknown) {
      toast.error("บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : ""));
    }
    setSaving(false);
  }

  function updateReturn(idx: number, patch: Partial<ReturnItem>) {
    setHandover((h) => {
      const items = [...h.returnItems];
      items[idx] = { ...items[idx], ...patch };
      return { ...h, returnItems: items };
    });
  }
  function addReturnRow() {
    setHandover((h) => ({ ...h, returnItems: [...h.returnItems, { ...EMPTY_RETURN }] }));
  }
  function removeReturnRow(idx: number) {
    setHandover((h) => ({ ...h, returnItems: h.returnItems.filter((_, i) => i !== idx) }));
  }

  function updateMaterial(idx: number, patch: Partial<MaterialItem>) {
    setHandover((h) => {
      const mats = [...h.materials];
      mats[idx] = { ...mats[idx], ...patch };
      return { ...h, materials: mats };
    });
  }

  function addMaterialRow() {
    setHandover((h) => ({ ...h, materials: [...h.materials, { ...EMPTY_MATERIAL }] }));
  }

  function removeMaterialRow(idx: number) {
    setHandover((h) => ({ ...h, materials: h.materials.filter((_, i) => i !== idx) }));
  }

  const totalMaterialAreaSqm = handover.materials.reduce((sum, m) => {
    const w = Number(m.widthCm);
    const l = Number(m.lengthCm);
    const q = Number(m.qty) || 1;
    if (w > 0 && l > 0) return sum + (w * l * q) / 10000;
    return sum;
  }, 0);

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

  async function advanceStage() {
    if (job.stage >= 7) return;
    const { error } = await supabase
      .from("install_jobs").update({ stage: job.stage + 1 }).eq("job_no", jobNo);
    if (error) { toast.error("เกิดข้อผิดพลาด"); return; }
    toast.success(`ย้ายไป ${IP_STAGES[job.stage]?.name}`);
    onRefresh();
  }

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

  const qcAnswered = Object.values(qcResults).filter(Boolean).length;
  const qcPass    = Object.values(qcResults).filter((v) => v === "pass").length;
  const qcFail    = Object.values(qcResults).filter((v) => v === "fail").length;
  const preInstallCheckedCount = Object.values(preInstall.checks).filter(Boolean).length;
  const handoverCheckedCount = Object.values(handover.checks).filter(Boolean).length;
  const allHandoverChecked = handoverCheckedCount === HANDOVER_ITEMS.length;

  function toggleBtn(active: boolean) {
    return `px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
      active ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
    }`;
  }

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.open(`/job-order/${jobNo}`, "_blank")}
              className="text-gray-400 hover:text-blue-600 text-sm px-2 py-1 rounded hover:bg-blue-50 transition-colors"
              title="พิมพ์ใบงาน"
            >
              🖨️
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl font-bold">✕</button>
          </div>
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
               : t === "qc" ? `QC${preInstallCheckedCount > 0 ? ` ✓${preInstallCheckedCount}` : ""}`
               : t === "photos" ? `รูป${photoPaths.length ? ` (${photoPaths.length})` : ""}`
               : `ปิดงาน${completionPhotoPaths.length ? ` 📷${completionPhotoPaths.length}` : ""}`}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* INFO */}
          {tab === "info" && (
            <div className="space-y-4">
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

              <div className="border border-slate-200 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">📞 ข้อมูลติดต่อ / นัดหมาย</p>

                <div>
                  <label className={`text-xs block mb-1 ${contactErrors.includes("ชื่อลูกค้า") ? "text-red-500 font-medium" : "text-gray-500"}`}>ชื่อลูกค้า {contactErrors.includes("ชื่อลูกค้า") && <span className="text-red-400">* จำเป็น</span>}</label>
                  <input
                    value={contactDraft.customer_name}
                    onChange={(e) => { setContactDraft((d) => ({ ...d, customer_name: e.target.value })); if(e.target.value.trim()) setContactErrors(prev => prev.filter(f => f !== "ชื่อลูกค้า")); }}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${contactErrors.includes("ชื่อลูกค้า") ? "border-red-400 bg-red-50" : "border-slate-200"}`}
                  />
                </div>

                <div>
                  <label className={`text-xs block mb-1 ${contactErrors.includes("เบอร์โทร") ? "text-red-500 font-medium" : "text-gray-500"}`}>เบอร์โทร {contactErrors.includes("เบอร์โทร") && <span className="text-red-400">* จำเป็น</span>}</label>
                  <input
                    value={contactDraft.phone}
                    onChange={(e) => { setContactDraft((d) => ({ ...d, phone: e.target.value })); if(e.target.value.trim()) setContactErrors(prev => prev.filter(f => f !== "เบอร์โทร")); }}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${contactErrors.includes("เบอร์โทร") ? "border-red-400 bg-red-50" : "border-slate-200"}`}
                  />
                </div>

                <div>
                  <label className={`text-xs block mb-1 ${contactErrors.includes("ที่อยู่ติดตั้ง") ? "text-red-500 font-medium" : "text-gray-500"}`}>ที่อยู่ติดตั้ง {contactErrors.includes("ที่อยู่ติดตั้ง") && <span className="text-red-400">* จำเป็น</span>}</label>
                  <textarea
                    rows={2}
                    value={contactDraft.address}
                    onChange={(e) => { setContactDraft((d) => ({ ...d, address: e.target.value })); if(e.target.value.trim()) setContactErrors(prev => prev.filter(f => f !== "ที่อยู่ติดตั้ง")); }}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none ${contactErrors.includes("ที่อยู่ติดตั้ง") ? "border-red-400 bg-red-50" : "border-slate-200"}`}
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
                  <label className="text-xs text-gray-500 block mb-1.5">🏠 ประเภทพื้นที่ติดตั้ง</label>
                  <div className="flex flex-wrap gap-2">
                    {ROOM_TYPES.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          if (roomTypes.includes(id)) {
                            setRoomTypes((prev) => prev.filter((r) => r !== id));
                            setZoneDimensions((prev) => prev.filter((z) => z.roomType !== id));
                          } else {
                            setRoomTypes((prev) => [...prev, id]);
                            setZoneDimensions((prev) => [...prev, { roomType: id, widthM: "", lengthM: "" }]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          roomTypes.includes(id)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {zoneDimensions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-500 font-medium">📐 ขนาดพื้นที่ (กว้างสุด × ยาวสุด)</p>
                      {zoneDimensions.map((zone, idx) => {
                        const area =
                          zone.widthM && zone.lengthM
                            ? (Number(zone.widthM) * Number(zone.lengthM)).toFixed(2)
                            : null;
                        return (
                          <div key={zone.roomType} className="bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                            <p className="text-xs font-semibold text-blue-700 mb-1.5">
                              {ROOM_TYPES.find((r) => r.id === zone.roomType)?.label ?? zone.roomType}
                            </p>
                            <div className="flex gap-2 items-end">
                              <div className="flex-1">
                                <label className="text-xs text-gray-400 block mb-0.5">กว้างสุด (ม.)</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  placeholder="0.0"
                                  value={zone.widthM}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setZoneDimensions((prev) =>
                                      prev.map((z, i) => (i === idx ? { ...z, widthM: v } : z))
                                    );
                                  }}
                                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                              </div>
                              <span className="text-gray-400 text-xs pb-2">×</span>
                              <div className="flex-1">
                                <label className="text-xs text-gray-400 block mb-0.5">ยาวสุด (ม.)</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  placeholder="0.0"
                                  value={zone.lengthM}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setZoneDimensions((prev) =>
                                      prev.map((z, i) => (i === idx ? { ...z, lengthM: v } : z))
                                    );
                                  }}
                                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                              </div>
                              {area && (
                                <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-1.5 rounded whitespace-nowrap">
                                  {area} ตร.ม.
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {zoneDimensions.length > 1 &&
                        zoneDimensions.every((z) => z.widthM && z.lengthM) && (
                          <p className="text-right text-xs text-gray-600">
                            รวม:{" "}
                            <span className="font-bold text-blue-700">
                              {zoneDimensions
                                .reduce((s, z) => s + Number(z.widthM) * Number(z.lengthM), 0)
                                .toFixed(2)}{" "}
                              ตร.ม.
                            </span>
                          </p>
                        )}
                    </div>
                  )}
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

                <div>
                  <label className="text-xs text-gray-500 block mb-1">📅 วันที่นัดหมาย</label>
                  <input
                    type="date"
                    value={contactDraft.apptDate}
                    onChange={(e) => setContactDraft((d) => ({ ...d, apptDate: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
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

          {/* STAGES */}
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

          {/* SURVEY */}
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

          {/* QC */}
          {tab === "qc" && (
            <div className="space-y-5">
              <div className="border border-amber-200 rounded-xl p-3 space-y-3 bg-amber-50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">✅ ตรวจเช็คก่อนเริ่มติดตั้ง</p>
                  <span className="text-xs text-amber-600 font-medium">{preInstallCheckedCount}/{PRE_INSTALL_ITEMS.length}</span>
                </div>
                <div className="space-y-2">
                  {PRE_INSTALL_ITEMS.map(({ id, label }) => (
                    <label key={id} className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="mt-0.5 w-4 h-4 accent-amber-600 shrink-0"
                        checked={!!preInstall.checks[id]}
                        onChange={(e) =>
                          setPreInstall((p) => ({ ...p, checks: { ...p.checks, [id]: e.target.checked } }))
                        }
                      />
                      <span className={`text-sm ${preInstall.checks[id] ? "line-through text-gray-400" : "text-gray-800"}`}>
                        {id}. {label}
                      </span>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">หมายเหตุก่อนติดตั้ง</label>
                  <textarea rows={2} placeholder="บันทึกประเด็นที่พบ..."
                    className="w-full border border-amber-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                    value={preInstall.notes} onChange={(e) => setPreInstall((p) => ({ ...p, notes: e.target.value }))} />
                </div>
                {preInstall.savedAt && (
                  <p className="text-xs text-gray-400">บันทึกล่าสุด {new Date(preInstall.savedAt).toLocaleString("th-TH")}</p>
                )}
                <button onClick={savePreInstall} disabled={saving}
                  className="w-full bg-amber-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors">
                  {saving ? "กำลังบันทึก..." : "💾 บันทึกรายการตรวจเช็ค"}
                </button>
              </div>

              <div className="space-y-4">
                <div className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
                  เกณฑ์ตรวจรับงาน 15 ข้อ ตาม SOP
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
            </div>
          )}

          {/* PHOTOS */}
          {tab === "photos" && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
                อัปโหลดรูปหน้างาน / สภาพพื้น — เก็บไว้ใน Supabase Storage
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => e.target.files && uploadPhotos(e.target.files)} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="w-full border-2 border-dashed border-blue-300 rounded-lg py-6 text-sm text-blue-600 font-medium hover:bg-blue-50 disabled:opacity-50 transition-colors">
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    กำลังอัปโหลด...
                  </span>
                ) : <>📷 แตะรูปเพื่ออัปโหลด</>}
              </button>
              {photoPaths.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีรูป</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {photoPaths.map((path) => (
                    <div key={path} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getPublicUrl(path)} alt="รูปหน้างาน" className="w-full h-40 object-cover rounded-lg border" loading="lazy" />
                      <button onClick={() => deletePhoto(path)}
                        className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CLOSE */}
          {tab === "close" && (
            <div className="space-y-4">
              {qcFail > 0 && (
                <div className="text-sm bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">
                  ⚠️ มี {qcFail} รายการ QC ที่ยังไม่ผ่าน — แนะนำแก้ไขก่อนปิดงาน
                </div>
              )}

              <div className="border border-green-200 rounded-xl p-3 space-y-3 bg-green-50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">📋 รายการส่งมอบงาน</p>
                  <span className="text-xs text-green-600 font-medium">{handoverCheckedCount}/{HANDOVER_ITEMS.length}</span>
                </div>
                <div className="space-y-2">
                  {HANDOVER_ITEMS.map(({ id, label }) => (
                    <label key={id} className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="mt-0.5 w-4 h-4 accent-green-600 shrink-0"
                        checked={!!handover.checks[id]}
                        onChange={(e) =>
                          setHandover((h) => ({ ...h, checks: { ...h.checks, [id]: e.target.checked } }))
                        }
                      />
                      <span className={`text-sm ${handover.checks[id] ? "line-through text-gray-400" : "text-gray-800"}`}>
                        {id}. {label}
                      </span>
                    </label>
                  ))}
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">พื้นที่ติดตั้งจริง (ตรม.)</label>
                  <input type="number" min="0" step="0.1" placeholder="เช่น 22"
                    className="w-full border border-green-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                    value={handover.actualAreaSqm}
                    onChange={(e) => setHandover((h) => ({ ...h, actualAreaSqm: e.target.value }))} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-green-700">📦 รายการเบิกสินค้า</p>
                    {totalMaterialAreaSqm > 0 && (
                      <span className="text-xs text-green-600 font-medium">
                        รวม {totalMaterialAreaSqm.toFixed(2)} ตรม.
                      </span>
                    )}
                  </div>

                  {handover.materials.map((mat, idx) => (
                    <div key={idx} className="bg-white border border-green-200 rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">รายการ {idx + 1}</span>
                        {handover.materials.length > 1 && (
                          <button onClick={() => removeMaterialRow(idx)}
                            className="text-red-400 hover:text-red-600 text-xs">✕ ลบ</button>
                        )}
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1">ความหนา</p>
                        <div className="flex gap-1.5">
                          {(["0.6", "1.6"] as const).map((t) => (
                            <button key={t} type="button"
                              onClick={() => updateMaterial(idx, { thickness: mat.thickness === t ? "" : t })}
                              className={toggleBtn(mat.thickness === t)}>
                              {t} cm
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1">สี</p>
                        <div className="flex gap-1.5">
                          <button type="button"
                            onClick={() => updateMaterial(idx, { color: mat.color === "beige" ? "" : "beige" })}
                            className={toggleBtn(mat.color === "beige")}>
                            Beige
                          </button>
                          <button type="button"
                            onClick={() => updateMaterial(idx, { color: mat.color === "whitebuzz" ? "" : "whitebuzz" })}
                            className={toggleBtn(mat.color === "whitebuzz")}>
                            Whitebuzz
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">ความกว้าง</p>
                          <div className="flex gap-1.5">
                            {(["110", "140"] as const).map((w) => (
                              <button key={w} type="button"
                                onClick={() => updateMaterial(idx, { widthCm: mat.widthCm === w ? "" : w })}
                                className={toggleBtn(mat.widthCm === w)}>
                                {w} cm
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">ความยาว (cm)</p>
                          <input type="number" min="0" step="1" placeholder="เช่น 1000"
                            className="w-full border border-green-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                            value={mat.lengthCm}
                            onChange={(e) => updateMaterial(idx, { lengthCm: e.target.value })} />
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1">จำนวน (ม้วน)</p>
                        <input type="number" min="1" step="1" placeholder="1"
                          className="w-24 border border-green-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                          value={mat.qty}
                          onChange={(e) => updateMaterial(idx, { qty: e.target.value })} />
                      </div>

                      {mat.widthCm && mat.lengthCm && (
                        <p className="text-xs text-green-600">
                          ≈ {((Number(mat.widthCm) * Number(mat.lengthCm) * (Number(mat.qty) || 1)) / 10000).toFixed(2)} ตรม.
                        </p>
                      )}
                    </div>
                  ))}

                  <button type="button" onClick={addMaterialRow}
                    className="w-full border border-dashed border-green-300 text-green-600 rounded-lg py-2 text-xs font-medium hover:bg-green-50 transition-colors">
                    + เพิ่มรายการ
                  </button>
                </div>

                {/* Return Items */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-orange-700">↩️ รายการคืนสินค้า</p>

                  {handover.returnItems.map((ret, idx) => (
                    <div key={idx} className="bg-white border border-orange-200 rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">คืนรายการ {idx + 1}</span>
                        {handover.returnItems.length > 1 && (
                          <button onClick={() => removeReturnRow(idx)}
                            className="text-red-400 hover:text-red-600 text-xs">✕ ลบ</button>
                        )}
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1">ความหนา</p>
                        <div className="flex gap-1.5">
                          {(["0.6", "1.6"] as const).map((t) => (
                            <button key={t} type="button"
                              onClick={() => updateReturn(idx, { thickness: ret.thickness === t ? "" : t })}
                              className={toggleBtn(ret.thickness === t)}>
                              {t} cm
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1">สี</p>
                        <div className="flex gap-1.5">
                          <button type="button"
                            onClick={() => updateReturn(idx, { color: ret.color === "beige" ? "" : "beige" })}
                            className={toggleBtn(ret.color === "beige")}>
                            Beige
                          </button>
                          <button type="button"
                            onClick={() => updateReturn(idx, { color: ret.color === "whitebuzz" ? "" : "whitebuzz" })}
                            className={toggleBtn(ret.color === "whitebuzz")}>
                            Whitebuzz
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">ความกว้าง</p>
                          <div className="flex gap-1.5">
                            {(["110", "140"] as const).map((w) => (
                              <button key={w} type="button"
                                onClick={() => updateReturn(idx, { widthCm: ret.widthCm === w ? "" : w })}
                                className={toggleBtn(ret.widthCm === w)}>
                                {w} cm
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">ความยาว (cm)</p>
                          <input type="number" min="0" step="1" placeholder="เช่น 500"
                            className="w-full border border-orange-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                            value={ret.lengthCm}
                            onChange={(e) => updateReturn(idx, { lengthCm: e.target.value })} />
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1">จำนวน (ม้วน)</p>
                        <input type="number" min="1" step="1" placeholder="1"
                          className="w-24 border border-orange-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                          value={ret.qty}
                          onChange={(e) => updateReturn(idx, { qty: e.target.value })} />
                      </div>

                      {ret.widthCm && ret.lengthCm && (
                        <p className="text-xs text-orange-600">
                          ≈ {((Number(ret.widthCm) * Number(ret.lengthCm) * (Number(ret.qty) || 1)) / 10000).toFixed(2)} ตรม.
                        </p>
                      )}
                    </div>
                  ))}

                  <button type="button" onClick={addReturnRow}
                    className="w-full border border-dashed border-orange-300 text-orange-600 rounded-lg py-2 text-xs font-medium hover:bg-orange-50 transition-colors">
                    + เพิ่มรายการคืน
                  </button>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">หมายเหตุการส่งมอบ</label>
                  <textarea rows={2} placeholder="รายละเอียดข้อแก้ไข / หมายเหตุเพิ่มเติม..."
                    className="w-full border border-green-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
                    value={handover.notes} onChange={(e) => setHandover((h) => ({ ...h, notes: e.target.value }))} />
                </div>
                {handover.savedAt && (
                  <p className="text-xs text-gray-400">บันทึกล่าสุด {new Date(handover.savedAt).toLocaleString("th-TH")}</p>
                )}
                <button onClick={saveHandover} disabled={saving}
                  className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {saving ? "กำลังบันทึก..." : "💾 บันทึกรายการส่งมอบ"}
                </button>
              </div>

              <div className="border border-slate-200 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">📸 รูปงานเสร็จสิ้น</p>
                <input ref={completionFileInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={(e) => e.target.files && uploadCompletionPhotos(e.target.files)} />
                <button onClick={() => completionFileInputRef.current?.click()} disabled={uploading}
                  className="w-full border-2 border-dashed border-green-300 rounded-lg py-4 text-sm text-green-700 font-medium hover:bg-green-50 disabled:opacity-50 transition-colors">
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
                        <img src={getPublicUrl(path)} alt="รูปงานเสร็จ" className="w-full h-32 object-cover rounded-lg border" loading="lazy" />
                        <button onClick={() => deleteCompletionPhoto(path)}
                          className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!allHandoverChecked && (
                <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-700">
                  ⚠️ ยังมีรายการส่งมอบที่ยังไม่เช็ค ({HANDOVER_ITEMS.length - handoverCheckedCount} รายการ)
                </div>
              )}

              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1">
                <p>การปิดงานจะ:</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                  <li>เปลี่ยน Stage เป็น <strong>เสร็จสิ้น</strong></li>
                  <li>บันทึกวันที่ปิดงาน</li>
                  <li>สร้างลิงก์ประเมิน (ลูกค้า) และคัดลอกไปยัง Clipboard</li>
                </ul>
              </div>

              {job.stage === 7 && job.evalToken && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-blue-700">🔗 ลิงก์แบบประเมิน</p>
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}/eval?t=${job.evalToken}`;
                      navigator.clipboard.writeText(link).catch(() => {});
                      toast.success("คัดลอกลิงก์ประเมินแล้ว");
                    }}
                    className="w-full text-left text-xs bg-white border border-blue-200 rounded-lg px-3 py-2 text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    📋 คัดลอกลิงก์แบบประเมิน (ส่งให้ลูกค้า)
                  </button>
                  <a href={GOOGLE_SHEET_URL} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 w-full text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 text-emerald-700 hover:bg-emerald-50 transition-colors">
                    📊 เปิด Google Sheet บันทึกผลประเมิน ↗
                  </a>
                </div>
              )}

              {job.stage < 7 && (
                <div className="space-y-2">
                  <button onClick={closeJob} disabled={saving}
                    className="w-full bg-green-600 text-white rounded-lg py-3 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                    ✅ ปิดงาน &amp; คัดลอกลิงก์ประเมิน
                  </button>
                  <a href={GOOGLE_SHEET_URL} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full border border-slate-200 rounded-lg py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                    📊 Google Sheet บันทึกผลประเมิน ↗
                  </a>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

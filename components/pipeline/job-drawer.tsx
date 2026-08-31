"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import type { InstallJob } from "@/lib/types";
import { formatDate, ipGenToken } from "@/lib/utils";
import { floorActionError, floorErrorMessage } from "@/lib/floor-error-message";
import {
  FLOOR_JOB_TYPE_CODE,
  checklistItemsFromRows,
  checklistProvenanceLabel,
  fallbackChecklist,
  loadingChecklist,
  normalizeQcResults,
  qcSaveBlockReason,
  type JobChecklistSource,
  type QcLoadState,
  type QCResult,
} from "@/lib/job-checklist";
import type { StaffRole } from "@/lib/staff";
import { toast } from "sonner";
import TechQueueView from "@/components/tech-queue/tech-queue-view";

// เกณฑ์สิทธิ์เดียวกับหน้า /job-templates (ผู้แก้แม่แบบเกณฑ์ตรวจรับ) และเมนู Pipeline
// นโยบาย install_jobs_active_staff_update เปิดให้พนักงาน active ทุกคนเขียนแถวงานได้
// หน้าจอจึงต้องกันเองไม่ให้ฝ่ายขาย/คลัง/CS บันทึกหรือทับผลตรวจรับ ส่วนการ "อ่าน" เกณฑ์ยังเปิดให้ทุกคน
const QC_ROLE_NOTICE = "บัญชีนี้ดูเกณฑ์ตรวจรับได้อย่างเดียว เฉพาะผู้ดูแลระบบและหัวหน้าช่างเท่านั้นที่บันทึกผลตรวจรับได้";

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

// เฟส A: รออยู่ที่ใคร + ธง (คู่ขนานกับ stage — ไม่ใช่สถานะ)
const WAITING_OPTIONS = ["ไม่ได้ค้าง", "รอลูกค้า", "รอเซล", "รอคลัง/ผลิต", "รอช่าง", "รอ QC", "รอประเมินพื้นที่"];
type FlagState = { needs_survey: boolean; has_defect: boolean; needs_redesign: boolean; is_claim: boolean };
const FLAG_DEFS: { key: keyof FlagState; label: string }[] = [
  { key: "needs_survey", label: "ต้องประเมินพื้นที่" },
  { key: "needs_redesign", label: "แก้แบบ/หน้างานไม่ตรง" },
  { key: "has_defect", label: "มี Defect" },
  { key: "is_claim", label: "งานเคลม" },
];

// เฟส B: activity log
interface ActivityRow { id: number; action: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string }
const ACT_FIELD_LABEL: Record<string, string> = {
  stage: "สเตจ", status: "สถานะ", waiting_on: "รออยู่ที่", needs_survey: "ธง ประเมินพื้นที่",
  has_defect: "ธง Defect", needs_redesign: "ธง แก้แบบ", is_claim: "ธง เคลม",
  appt_date: "วันนัด", eval_score: "คะแนนประเมิน", closed_at: "ปิดงาน",
};
function fmtActVal(field: string | null, v: string | null): string {
  if (v == null || v === "") return "—";
  if (field === "stage") return IP_STAGES[Number(v) - 1]?.name ?? v;
  if (v === "true") return "✓"; if (v === "false") return "—";
  return v;
}

interface SurveyData {
  cutTypes: string[];
  weldType: string;
  finishTypes: string[];
  floorCondition: string;
  wetZone: boolean;
  areaSqm: string;
  notes: string;
  photos?: string[];
  savedAt?: string;
}

// เกณฑ์ตรวจรับ 15 ข้อที่เคย hardcode ไว้ตรงนี้ (const QC_ITEMS) ถูกย้ายไปที่
// lib/job-checklist.ts ในชื่อ FALLBACK_QC_ITEMS — ไม่ได้ถูกลบทิ้ง ยังอยู่ในโค้ดและยังใช้จริง
// เพียงแต่ย้ายไปที่เดียวกลาง เพราะหน้าช่างหน้างาน (app/work/[token]/page.tsx) ต้องใช้ชุดสำรองชุดเดียวกัน
// ถ้าเก็บสำเนาไว้สองที่ วันหนึ่งสองจอจะแสดงเกณฑ์สำรองคนละชุดโดยไม่มีใครรู้

interface QCData {
  // คีย์เป็นรหัสเกณฑ์ (QC01…) ตั้งแต่ T8 เป็นต้นไป — ของเก่าที่คีย์เป็นเลขข้อ ("1".."15")
  // ยังอ่านได้เหมือนเดิม ผ่าน normalizeQcResults() ที่แปลงเลขข้อเป็นรหัสให้ตรงกันข้อต่อข้อ
  results: Record<string, QCResult>;
  inspector: string;
  notes: string;
  savedAt?: string;
  // ที่มาของเกณฑ์ที่ใช้ตอนบันทึก เพื่อให้ย้อนดูได้ว่าผลชุดนี้ตรวจด้วยแม่แบบรุ่นไหน
  templateId?: string | null;
  templateVersion?: number | null;
}

// เฟส 3: เศษคงเหลือ (S4) — บันทึกง่าย + เข้าคลังเศษ (remnant_stock)
interface RemnantPiece { mat_type: string; width_bin: string; length_cm: string; note: string }
interface MatUsage {
  noRemnant: boolean;
  pieces: RemnantPiece[];
  note: string;
  savedAt?: string;
}

// เฟส 4: ใบสั่งงาน (S2) — หัวหน้าช่างระบุของที่ต้องหยิบ + คำนวณความยาวจากโซน
interface PickNewItem { width: "110" | "140"; length_cm: string; qty: string; note: string }
interface PickRemnant { mat_type: string; width_bin: string; length_cm: string; note: string }
interface PickPlan {
  newItems: PickNewItem[];
  remnants: PickRemnant[];
  note: string;
  savedAt?: string;
}
interface ZoneRow { zone_name: string; width_cm: number; length_cm: number }
// ความยาวแผ่นที่ต้องใช้ต่อโซน (roll 140/110) — อิงตรรกะเดียวกับหน้าต้นทุนเศษ (ยังไม่หักสิ่งกีดขวาง)
function stripLenForZone(dimA: number, dimB: number): { total140: number; total110: number } {
  function orient(stripLen: number, cover: number) {
    const nPairs = Math.floor(cover / 250);
    const rem = cover % 250;
    let n140 = nPairs, n110 = nPairs;
    if (rem > 0 && rem <= 110) n110 += 1;
    else if (rem > 110) { n140 += 1; n110 += 1; }
    return { total140: n140 * stripLen, total110: n110 * stripLen };
  }
  const a = orient(dimA, dimB), b = orient(dimB, dimA);
  return a.total140 + a.total110 <= b.total140 + b.total110 ? a : b;
}
function sumZoneStrips(zones: ZoneRow[]): { total140: number; total110: number } {
  return zones.reduce((acc, z) => {
    if (z.width_cm <= 0 || z.length_cm <= 0) return acc;
    const c = stripLenForZone(z.width_cm, z.length_cm);
    return { total140: acc.total140 + c.total140, total110: acc.total110 + c.total110 };
  }, { total140: 0, total110: 0 });
}

export default function JobDrawer({ job, onClose, onRefresh }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<"info" | "stages" | "survey" | "qc" | "log">("info");
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  // Survey state
  const [survey, setSurvey] = useState<SurveyData>({
    cutTypes: [],
    weldType: "",
    finishTypes: [],
    floorCondition: "",
    wetZone: false,
    areaSqm: "",
    notes: "",
    photos: [],
  });
  const [uploading, setUploading] = useState(false);

  // เฟส 3: เศษคงเหลือ (S4)
  const [matUsage, setMatUsage] = useState<MatUsage>({ noRemnant: false, pieces: [], note: "" });


  // เฟส 4: ใบสั่งงาน (S2) — pick plan + zones
  const [pickPlan, setPickPlan] = useState<PickPlan>({ newItems: [], remnants: [], note: "" });
  const [zones, setZones] = useState<ZoneRow[]>([]);

  // ดูรูปขยายที่โซนซ้าย (A) โดย drawer (B) ยังกดได้ — เลื่อนดูหลายรูปได้
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  // แสดงตารางคิวช่างที่โซนซ้าย (A) ตอนจองช่าง
  const [showQueue, setShowQueue] = useState(false);

  // QC state — คีย์ด้วยรหัสเกณฑ์ (QC01…) ไม่ใช่ลำดับที่แสดงบนจอ เพราะลำดับเปลี่ยนได้เมื่อหัวหน้าช่างแก้แม่แบบ
  const [qcResults, setQcResults] = useState<Record<string, QCResult>>({});
  const [qcInspector, setQcInspector] = useState("");
  const [qcNotes, setQcNotes] = useState("");
  // สถานะการโหลดผลตรวจรับเดิม — ปุ่มบันทึกเขียนทับทั้งก้อน จึงห้ามบันทึกถ้ายังไม่รู้ว่าของเดิมมีอะไร
  const [qcLoadState, setQcLoadState] = useState<QcLoadState>(() => (job.id ? "loading" : "ready"));
  // เกณฑ์ตรวจรับที่กำลังแสดง: ตั้งต้นเป็น "กำลังโหลด" (ไม่ใช่ชุดสำรอง) เพื่อไม่ให้เอารายการเก่าขึ้นจอเป็นของจริง
  const [checklist, setChecklist] = useState<JobChecklistSource>(() => loadingChecklist());
  // สิทธิ์บันทึกผลตรวจรับ — ใช้เกณฑ์เดียวกับหน้า "แม่แบบประเภทงาน" และเมนู Pipeline คือ ผู้ดูแลระบบ/หัวหน้าช่าง
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const canEditQc = roleChecked && (staffRole === "admin" || staffRole === "head_technician");

  // S3 reschedule state
  const [newApptDate, setNewApptDate] = useState(job.apptDate ?? "");
  // นัดช่าง -> คิวงาน (ตาราง appointments)
  const [techs, setTechs] = useState<{ id: string; name: string }[]>([]);
  const [apptTechId, setApptTechId] = useState("");
  const [apptStart, setApptStart] = useState("09:00");
  const [apptEnd, setApptEnd] = useState("12:00");

  // เฟส A: waiting_on + flags
  const [waitingOn, setWaitingOn] = useState<string>("ไม่ได้ค้าง");
  const [waitingSince, setWaitingSince] = useState<string | null>(null);
  const [flags, setFlags] = useState<FlagState>({ needs_survey: false, has_defect: false, needs_redesign: false, is_claim: false });

  // Load saved data
  useEffect(() => {
    if (job.id) {
      setQcLoadState("loading");
      supabase.from("install_jobs")
        .select("survey_data, qc_data, material_usage, pick_plan, waiting_on, waiting_since, needs_survey, has_defect, needs_redesign, is_claim")
        .eq("job_no", job.jobNo).single().then(({ data, error }) => {
        if (error) {
          // อ่านแถวงานไม่สำเร็จ = ไม่รู้ว่าผลตรวจรับเดิมมีอะไร ห้ามให้กดบันทึกทับ
          setQcLoadState("error");
          toast.error(floorActionError("โหลดข้อมูลที่บันทึกไว้ของงานนี้", error));
          return;
        }
        if (data?.survey_data) {
          try { setSurvey(JSON.parse(data.survey_data)); } catch {}
        }
        if (data?.material_usage) {
          try {
            const mu = typeof data.material_usage === "string" ? JSON.parse(data.material_usage) : data.material_usage;
            if (mu) setMatUsage({ noRemnant: !!mu.noRemnant, pieces: mu.pieces ?? [], note: mu.note ?? "", savedAt: mu.savedAt });
          } catch {}
        }
        if (data?.pick_plan) {
          try {
            const pp = typeof data.pick_plan === "string" ? JSON.parse(data.pick_plan) : data.pick_plan;
            if (pp) setPickPlan({ newItems: pp.newItems ?? [], remnants: pp.remnants ?? [], note: pp.note ?? "", savedAt: pp.savedAt });
          } catch {}
        }
        if (data?.qc_data) {
          try {
            const qc: QCData = typeof data.qc_data === "string" ? JSON.parse(data.qc_data) : (data.qc_data as QCData);
            setQcResults(normalizeQcResults(qc?.results));
            setQcInspector(qc?.inspector ?? "");
            setQcNotes(qc?.notes ?? "");
            setQcLoadState("ready");
          } catch (e: unknown) {
            // ห้ามกลืนเงียบ: ถ้าอ่านของเดิมไม่ออกแล้วยังให้กดบันทึกได้ ผลตรวจรับเดิมจะถูกทับหายทั้งชุด
            setQcLoadState("error");
            toast.error(floorActionError("อ่านผลตรวจรับเดิมของงานนี้", e));
          }
        } else {
          setQcLoadState("ready");
        }
        if (data) {
          setWaitingOn(data.waiting_on ?? "ไม่ได้ค้าง");
          setWaitingSince(data.waiting_since ?? null);
          setFlags({
            needs_survey: !!data.needs_survey, has_defect: !!data.has_defect,
            needs_redesign: !!data.needs_redesign, is_claim: !!data.is_claim,
          });
        }
      });
    }
  }, [job.id, job.jobNo]);

  // โหลดรายชื่อทีมช่าง (active) สำหรับนัดคิว
  useEffect(() => {
    supabase.from("tech_teams").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setTechs((data as { id: string; name: string }[]) ?? []));
  }, []);

  // สิทธิ์ของผู้ใช้ที่ล็อกอินอยู่ — ใช้วิธีเดียวกับหน้า /job-templates (ดู is_active ด้วย ไม่ใช่แค่ role)
  // ถ้าดูแค่ role พนักงานที่ถูกปิดใช้งานจะเห็นปุ่มบันทึกครบ กดแล้วเพิ่งโดนปฏิเสธ ซึ่งทำให้เข้าใจผิด
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) { setStaffRole(null); setRoleChecked(true); } return; }
      const { data } = await supabase.from("floor_staff_profiles").select("role,is_active").eq("id", user.id).maybeSingle();
      if (cancelled) return;
      setStaffRole(data?.is_active ? ((data.role as StaffRole | undefined) ?? null) : null);
      setRoleChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);


  // เฟส 4: โหลดโซนของงาน (คำนวณความยาวแผ่นที่ต้องใช้)
  useEffect(() => {
    if (!job.jobNo) return;
    supabase.from("install_job_zones").select("zone_name, width_cm, length_cm").eq("job_no", job.jobNo)
      .then(({ data }) => setZones((data as ZoneRow[]) ?? []));
  }, [job.jobNo]);

  // T8: เกณฑ์ตรวจรับต้องมาจากแม่แบบที่หัวหน้าช่างเปิดใช้งานอยู่ ไม่ใช่รายการที่ฝังไว้ในไฟล์นี้
  // อ่านตรงจากตารางด้วยสิทธิ์ของพนักงานที่ล็อกอิน (RLS เปิด select ให้ staff ที่ active อยู่แล้ว)
  // ถ้าอ่านไม่ได้ด้วยเหตุใดก็ตาม ให้ตกไปใช้ชุดสำรองในโค้ด และบอกบนจอตรง ๆ ว่ากำลังใช้ชุดสำรอง
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: jobType, error: jobTypeError } = await supabase
          .from("job_types").select("id, name")
          .eq("code", FLOOR_JOB_TYPE_CODE).eq("is_active", true).maybeSingle();
        if (jobTypeError) throw jobTypeError;
        if (!jobType) {
          if (!cancelled) setChecklist(fallbackChecklist(`ยังไม่ได้ตั้งประเภทงานรหัส ${FLOOR_JOB_TYPE_CODE} ในระบบ`));
          return;
        }
        const { data: template, error: templateError } = await supabase
          .from("job_checklist_templates").select("id, version")
          .eq("job_type_id", jobType.id).eq("status", "active")
          .order("version", { ascending: false }).limit(1).maybeSingle();
        if (templateError) throw templateError;
        if (!template) {
          if (!cancelled) setChecklist(fallbackChecklist("ยังไม่มีแม่แบบเกณฑ์ตรวจรับที่เปิดใช้งานสำหรับงานปูพื้น"));
          return;
        }
        const { data: rows, error: itemsError } = await supabase
          .from("job_checklist_template_items")
          .select("code, label, spec_text, requires_photo, is_critical, measuring_device_kind, sort_order, is_active")
          .eq("template_id", template.id).eq("is_active", true).order("sort_order");
        if (itemsError) throw itemsError;
        if (cancelled) return;
        const items = checklistItemsFromRows(rows);
        if (items.length === 0) {
          setChecklist(fallbackChecklist("แม่แบบที่เปิดใช้งานอยู่ยังไม่มีเกณฑ์ที่เปิดใช้งานสักข้อ"));
          return;
        }
        setChecklist({
          items, origin: "template", version: template.version,
          templateId: template.id, jobTypeName: jobType.name, fallbackReason: null,
        });
      } catch (e: unknown) {
        if (!cancelled) setChecklist(fallbackChecklist(`โหลดแม่แบบเกณฑ์ตรวจรับไม่สำเร็จ — ${floorErrorMessage(e)}`));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // เฟส A: บันทึก waiting_on / ธง (ตั้ง waiting_since เมื่อ waiting_on เปลี่ยน)
  async function saveWaiting(nextWaiting?: string, nextFlags?: FlagState) {
    const w = nextWaiting ?? waitingOn;
    const f = nextFlags ?? flags;
    let since = waitingSince;
    if (nextWaiting !== undefined && nextWaiting !== waitingOn) {
      since = nextWaiting === "ไม่ได้ค้าง" ? null : new Date().toISOString();
    }
    const { error } = await supabase.from("install_jobs").update({
      waiting_on: w, waiting_since: since,
      needs_survey: f.needs_survey, has_defect: f.has_defect,
      needs_redesign: f.needs_redesign, is_claim: f.is_claim,
    }).eq("job_no", job.jobNo);
    if (error) { toast.error(floorActionError("บันทึกสถานะรอ", error)); return; }
    setWaitingOn(w); setWaitingSince(since); setFlags(f);
    toast.success("อัปเดตแล้ว"); onRefresh();
  }

  // เฟส B: โหลดประวัติเมื่อเปิดแท็บ "ประวัติ"
  useEffect(() => {
    if (tab === "log" && job.jobNo) {
      supabase.from("job_activity")
        .select("id, action, field, old_value, new_value, created_at")
        .eq("job_no", job.jobNo).order("created_at", { ascending: false }).limit(100)
        .then(({ data }) => setActivity((data as ActivityRow[]) ?? []));
    }
  }, [tab, job.jobNo]);

  async function saveSurvey() {
    setSaving(true);
    try {
      const surveyPayload = { ...survey, savedAt: new Date().toISOString() };
      const { error } = await supabase
        .from("install_jobs")
        .update({ survey_data: JSON.stringify(surveyPayload) })
        .eq("job_no", job.jobNo);
      if (error) throw error;
      setSurvey({ ...survey, savedAt: surveyPayload.savedAt });
      toast.success("บันทึกข้อมูลสำรวจแล้ว");
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกข้อมูลสำรวจ", e));
    }
    setSaving(false);
  }

  // แนบรูปหน้างาน -> Supabase Storage (bucket job-photos, public)
  function surveyPhotoUrl(path: string): string {
    return supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl;
  }
  async function handleSurveyUpload(files: File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const added: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `survey/${job.jobNo}/${Date.now()}-${i}-${safe}`;
        const { error } = await supabase.storage.from("job-photos").upload(path, f, { upsert: false, contentType: f.type || "image/jpeg" });
        if (error) throw error;
        added.push(path);
      }
      setSurvey((s) => ({ ...s, photos: [...(s.photos ?? []), ...added] }));
      toast.success(`อัปโหลด ${added.length} รูปแล้ว — อย่าลืมกดบันทึก`);
    } catch (e: unknown) {
      toast.error(floorActionError("อัปโหลดรูปหน้างาน", e));
    }
    setUploading(false);
  }
  function removeSurveyPhoto(path: string) {
    setSurvey((s) => ({ ...s, photos: (s.photos ?? []).filter((p) => p !== path) }));
  }

  async function saveQC() {
    // กันข้อมูลหาย: ถ้ายังโหลดผลเดิมไม่สำเร็จ การเขียนทั้งก้อนจากหน่วยความจำจะลบผลตรวจรับเดิมทิ้ง
    const blocked = qcSaveBlockReason(qcLoadState);
    if (blocked) { toast.error(blocked); return; }
    if (!canEditQc) { toast.error(QC_ROLE_NOTICE); return; }
    setSaving(true);
    try {
      const qcPayload: QCData = {
        results: qcResults,
        inspector: qcInspector,
        notes: qcNotes,
        savedAt: new Date().toISOString(),
        templateId: checklist.templateId,
        templateVersion: checklist.version,
      };
      const { error } = await supabase
        .from("install_jobs")
        .update({ qc_data: JSON.stringify(qcPayload) })
        .eq("job_no", job.jobNo);
      if (error) throw error;
      toast.success("บันทึก QC แล้ว");
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกผลตรวจ QC", e));
    }
    setSaving(false);
  }

  // S2: log a call attempt
  async function logCall() {
    setSaving(true);
    try {
      const newCount = (job.callAttempts ?? 0) + 1;
      const newLog = [
        ...(job.callLogs ?? []),
        { date: new Date().toISOString(), note: "โทรครั้งที่ " + newCount },
      ];
      const { error } = await supabase
        .from("install_jobs")
        .update({ call_attempts: newCount, call_logs: newLog })
        .eq("job_no", job.jobNo);
      if (error) throw error;
      toast.success("บันทึกการโทรครั้งที่ " + newCount + " แล้ว");
      onRefresh();
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกการโทร", e));
    }
    setSaving(false);
  }

  // S3: save new appointment date without changing stage
  async function saveApptDate() {
    if (!newApptDate) { toast.error("กรุณาเลือกวันนัดใหม่"); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("install_jobs")
        .update({ appt_date: newApptDate })
        .eq("job_no", job.jobNo);
      if (error) throw error;
      toast.success("บันทึกวันนัดใหม่แล้ว (ไม่เปลี่ยน Stage)");
      onRefresh();
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกวันนัดใหม่", e));
    }
    setSaving(false);
  }

  // นัดช่าง + เข้าคิว: สร้างเรคอร์ดใน appointments (คิวช่าง) + เซ็ต appt_date บนงาน
  async function bookTech() {
    if (!newApptDate) { toast.error("กรุณาเลือกวันนัด"); return; }
    if (!apptTechId) { toast.error("กรุณาเลือกทีมช่าง"); return; }
    setSaving(true);
    try {
      const slotStart = new Date(`${newApptDate}T${apptStart || "09:00"}:00`).toISOString();
      const slotEnd = new Date(`${newApptDate}T${apptEnd || "12:00"}:00`).toISOString();
      const { error: aerr } = await supabase.from("appointments").insert({
        job_id: job.jobNo, tech_id: apptTechId, slot_start: slotStart, slot_end: slotEnd, status: "proposed",
      });
      if (aerr) throw aerr;
      const { error: jobError } = await supabase.from("install_jobs").update({ appt_date: newApptDate }).eq("job_no", job.jobNo);
      if (jobError) {
        toast.error(`นัดช่างเข้าคิวแล้ว แต่บันทึกวันนัดในใบงานไม่สำเร็จ: ${floorErrorMessage(jobError)}`);
        onRefresh();
        return;
      }
      toast.success("นัดช่างเข้าคิวแล้ว — ดูได้ที่หน้า นัดหมาย/คิวงาน");
      onRefresh();
    } catch (e: unknown) {
      toast.error(floorActionError("นัดช่างเข้าคิว", e));
    }
    setSaving(false);
  }

  // สำรวจหน้างานแล้วหรือยัง (ใช้เป็น gate ก่อนขึ้น S2)
  const surveyDone = !!(survey.savedAt || survey.areaSqm || survey.floorCondition || (survey.photos?.length ?? 0) > 0);

  // เฟส 3: บันทึกเศษคงเหลือ + เข้าคลังเศษ (remnant_stock)
  const matDone = !!matUsage.savedAt;
  function addPiece() {
    setMatUsage((m) => ({ ...m, pieces: [...m.pieces, { mat_type: job.product ?? "", width_bin: "", length_cm: "", note: "" }] }));
  }
  function setPiece(i: number, k: keyof RemnantPiece, v: string) {
    setMatUsage((m) => ({ ...m, pieces: m.pieces.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }));
  }
  function removePiece(i: number) {
    setMatUsage((m) => ({ ...m, pieces: m.pieces.filter((_, idx) => idx !== i) }));
  }
  async function saveMaterialUsage() {
    if (!matUsage.noRemnant && matUsage.pieces.length === 0) {
      toast.error("กรอกเศษที่เหลือ หรือติ๊ก 'ไม่มีเศษเหลือ'");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...matUsage, savedAt: new Date().toISOString() };
      const { error } = await supabase.from("install_jobs")
        .update({ material_usage: JSON.stringify(payload) }).eq("job_no", job.jobNo);
      if (error) throw error;
      // เข้าคลังเศษ: insert remnant_stock ต่อชิ้น (เฉพาะที่ยังไม่เคยบันทึก)
      if (!matUsage.noRemnant && !matUsage.savedAt && matUsage.pieces.length > 0) {
        const rows = matUsage.pieces
          .filter((p) => p.width_bin || p.length_cm)
          .map((p) => ({
            mat_type: p.mat_type || (job.product ?? ""),
            width_bin: p.width_bin ? Math.round(Number(p.width_bin)) : null,
            length_cm: p.length_cm ? Number(p.length_cm) : null,
            status: "available",
            source_job: job.jobNo,
            note: p.note || null,
          }));
        if (rows.length > 0) {
          const { error: rerr } = await supabase.from("remnant_stock").insert(rows);
          if (rerr) throw rerr;
        }
      }
      setMatUsage(payload);
      toast.success("บันทึกเศษคงเหลือแล้ว — เข้าคลังเศษเรียบร้อย");
      onRefresh();
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกเศษคงเหลือ", e));
    }
    setSaving(false);
  }

  // เฟส 4: ใบสั่งงาน (S2) — คำนวณความยาวที่ต้องใช้จากโซน + บันทึกของที่ต้องหยิบ
  const req = sumZoneStrips(zones);
  function addNewItem() { setPickPlan((p) => ({ ...p, newItems: [...p.newItems, { width: "140", length_cm: "", qty: "1", note: "" }] })); }
  function setNewItem(i: number, k: keyof PickNewItem, v: string) { setPickPlan((p) => ({ ...p, newItems: p.newItems.map((x, idx) => idx === i ? { ...x, [k]: v } : x) })); }
  function removeNewItem(i: number) { setPickPlan((p) => ({ ...p, newItems: p.newItems.filter((_, idx) => idx !== i) })); }
  function addPickRemnant() { setPickPlan((p) => ({ ...p, remnants: [...p.remnants, { mat_type: job.product ?? "", width_bin: "", length_cm: "", note: "" }] })); }
  function setPickRemnant(i: number, k: keyof PickRemnant, v: string) { setPickPlan((p) => ({ ...p, remnants: p.remnants.map((x, idx) => idx === i ? { ...x, [k]: v } : x) })); }
  function removePickRemnant(i: number) { setPickPlan((p) => ({ ...p, remnants: p.remnants.filter((_, idx) => idx !== i) })); }
  async function savePickPlan() {
    setSaving(true);
    try {
      const payload = { ...pickPlan, savedAt: new Date().toISOString() };
      const { error } = await supabase.from("install_jobs")
        .update({ pick_plan: JSON.stringify(payload) }).eq("job_no", job.jobNo);
      if (error) throw error;
      setPickPlan(payload);
      toast.success("บันทึกใบสั่งงานแล้ว — จะแสดงในใบส่งงาน");
      onRefresh();
    } catch (e: unknown) {
      toast.error(floorActionError("บันทึกใบสั่งงาน", e));
    }
    setSaving(false);
  }

  // Advance stage
  async function advanceStage() {
    if (job.stage >= 6) return;
    // Gate: ต้องสำรวจหน้างานก่อนขึ้น S2 (ยืนยันนัด + ใบส่งงาน)
    if (job.stage === 1 && !surveyDone) {
      toast.error("ต้องสำรวจหน้างาน (แท็บ สำรวจ) ก่อนส่งให้หัวหน้าช่าง");
      setTab("survey");
      return;
    }
    // Gate: ต้องกรอกเศษคงเหลือก่อนขึ้น S5 (รอประเมิน)
    if (job.stage === 4 && !matDone) {
      toast.error("ต้องกรอกเศษคงเหลือก่อน แล้วจึงเข้าสู่รอประเมิน");
      return;
    }
    const { error } = await supabase
      .from("install_jobs")
      .update({ stage: job.stage + 1 })
      .eq("job_no", job.jobNo);
    if (error) { toast.error(floorActionError("ย้ายสถานะงาน", error)); return; }
    toast.success(`ย้ายไป ${IP_STAGES[job.stage]?.name}`);
    onRefresh();
  }

  // Close job
  async function closeJob() {
    const token = ipGenToken();
    const { error } = await supabase
      .from("install_jobs")
      .update({ stage: 6, closed_at: new Date().toISOString(), eval_token: token })
      .eq("job_no", job.jobNo);
    if (error) { toast.error(floorActionError("ปิดงาน", error)); return; }
    const { error: evaluationError } = await supabase.from("job_evals").insert({ install_job_id: job.id, token });
    if (evaluationError) {
      toast.error(`ปิดงานแล้ว แต่สร้างลิงก์ประเมินลูกค้าไม่สำเร็จ: ${floorErrorMessage(evaluationError)}`);
      onRefresh();
      return;
    }
    const link = `${window.location.origin}/eval?t=${encodeURIComponent(token)}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    toast.success("ปิดงานแล้ว — ลิงก์ประเมินคัดลอกแล้ว");
    onRefresh();
    onClose();
  }

  // นับเฉพาะข้อที่แสดงอยู่จริงในแม่แบบรุ่นปัจจุบัน ไม่นับผลของข้อที่ถูกถอดออกจากแม่แบบไปแล้ว
  // (ผลของข้อเก่ายังอยู่ใน qc_data ไม่ได้ถูกลบ แต่ไม่ควรเอามาโชว์ว่า "ตอบครบ" ทั้งที่ข้อนั้นไม่มีแล้ว)
  const qcShownResults = checklist.items.map((item) => qcResults[item.code] ?? null);
  const qcAnswered = qcShownResults.filter(Boolean).length;
  const qcPass = qcShownResults.filter((v) => v === "pass").length;
  const qcFail = qcShownResults.filter((v) => v === "fail").length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      {/* โซน A: ตารางคิวช่าง — ดูขณะจองช่างใน drawer (โซน B) */}
      {showQueue && (
        <div
          className="hidden md:flex fixed inset-y-0 left-0 z-40 flex-col bg-slate-100 border-r border-slate-300 shadow-xl"
          style={{ right: "32rem" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b shrink-0">
            <span className="font-semibold text-slate-800">👷 ตารางคิวช่าง (14 วัน)</span>
            <button onClick={() => setShowQueue(false)} className="text-slate-400 hover:text-slate-700 text-sm">ปิด ✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <TechQueueView highlightDate={newApptDate || undefined} reloadKey={showQueue ? 1 : 0} />
          </div>
        </div>
      )}
      {/* โซน A: รูปขยายฝั่งซ้าย — drawer (โซน B) ยังกดได้ เลื่อนดูได้หลายรูป */}
      {previewIdx !== null && survey.photos && survey.photos[previewIdx] && (() => {
        const photos = survey.photos!;
        const n = photos.length;
        const go = (d: number) => setPreviewIdx((i) => (i === null ? 0 : (i + d + n) % n));
        return (
          <div
            className="hidden md:flex fixed inset-y-0 left-0 z-40 flex-col items-center justify-center p-4 bg-black/70"
            style={{ right: "32rem" }}
            onClick={(e) => { e.stopPropagation(); setPreviewIdx(null); }}
          >
            <div className="relative flex items-center justify-center w-full flex-1" onClick={(e) => e.stopPropagation()}>
              {n > 1 && (
                <button onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-2 bg-white/85 hover:bg-white text-slate-800 rounded-full w-11 h-11 text-2xl font-bold flex items-center justify-center shadow-lg">‹</button>
              )}
              <img src={surveyPhotoUrl(photos[previewIdx])} alt="รูปขยาย" className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl" />
              {n > 1 && (
                <button onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-2 bg-white/85 hover:bg-white text-slate-800 rounded-full w-11 h-11 text-2xl font-bold flex items-center justify-center shadow-lg">›</button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <span className="bg-white/85 text-slate-800 rounded-full px-3 py-1 text-sm font-medium">{previewIdx + 1} / {n}</span>
              <button onClick={(e) => { e.stopPropagation(); setPreviewIdx(null); }} className="bg-white/90 text-slate-800 rounded-full px-4 py-1.5 text-sm font-medium hover:bg-white">ปิดรูป ✕</button>
            </div>
          </div>
        );
      })()}
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

        {/* เฟส A: รออยู่ที่ใคร + ธง (เห็นทุกแท็บ) */}
        <div className="px-4 py-2 border-b bg-gray-50/60 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 shrink-0">รออยู่ที่:</span>
            <select
              value={waitingOn}
              onChange={(e) => saveWaiting(e.target.value)}
              className={`text-xs border rounded-lg px-2 py-1 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400 ${waitingOn !== "ไม่ได้ค้าง" ? "border-amber-300 bg-amber-50 text-amber-800 font-medium" : "border-gray-200 text-gray-600"}`}
            >
              {WAITING_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {waitingOn !== "ไม่ได้ค้าง" && waitingSince && (
              <span className="text-xs font-semibold text-amber-700 shrink-0 whitespace-nowrap">
                ค้างมา {Math.max(0, Math.floor((Date.now() - new Date(waitingSince).getTime()) / 86400000))} วัน
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FLAG_DEFS.map((fd) => {
              const on = flags[fd.key];
              return (
                <button
                  key={fd.key}
                  onClick={() => saveWaiting(undefined, { ...flags, [fd.key]: !on })}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${on ? "bg-red-100 border-red-300 text-red-700 font-medium" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"}`}
                >
                  {on ? "●" : "○"} {fd.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex text-sm border-b overflow-x-auto">
          {(["info", "stages", "survey", "qc", "log"] as const).map((t) => (
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
               : t === "qc" ? "ตรวจรับ"
               : "ประวัติ"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* INFO */}
          {tab === "info" && (
            <>
            {job.stage < 6 && (
              <button
                onClick={() => setTab("stages")}
                className="w-full flex items-center justify-between border-2 border-indigo-300 bg-indigo-50 rounded-xl px-4 py-3 mb-3 hover:bg-indigo-100 transition-colors"
              >
                <span className="text-sm font-semibold text-indigo-800">📅 นัดหมาย & คิวช่าง</span>
                <span className="text-xs text-indigo-700">
                  {job.apptDate
                    ? new Date(job.apptDate).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) + " ›"
                    : "ยังไม่นัด — กดเพื่อจองช่าง ›"}
                </span>
              </button>
            )}
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
            </>
          )}

          {/* STAGES */}
          {tab === "stages" && (
            <div className="space-y-4">
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

              {/* S1: Call log section (โทรติดต่อลูกค้าตอนรับ order) */}
              {job.stage === 1 && (
                <div className="border rounded-xl p-4 bg-blue-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-blue-800">📞 บันทึกการโทรหาลูกค้า</p>
                    <span className="text-2xl font-bold text-blue-700">{job.callAttempts ?? 0}</span>
                  </div>
                  <p className="text-xs text-blue-600">จำนวนครั้งที่โทรแล้ว</p>
                  {(job.callAttempts ?? 0) >= 3 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
                      ⚠️ โทรครบ {job.callAttempts} ครั้งแล้วยังไม่ได้นัด — ควรแจ้งหัวหน้าเพื่อ Escalate
                    </div>
                  )}
                  {job.callLogs && job.callLogs.length > 0 && (
                    <div className="space-y-1">
                      {job.callLogs.slice(-3).map((log, idx) => (
                        <div key={idx} className="text-xs text-blue-600 bg-white/60 rounded px-2 py-1">
                          {new Date(log.date).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — {log.note}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={logCall}
                    disabled={saving}
                    className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "กำลังบันทึก..." : "📞 +1 บันทึกการโทร"}
                  </button>
                </div>
              )}

              {/* วันนัดหมาย + นัดช่างเข้าคิว — แสดงได้ทุกสเตจที่งานยังไม่เสร็จ */}
              {job.stage < 6 && (
                <div className="border-2 border-indigo-300 rounded-xl p-4 bg-indigo-50 space-y-3">
                  <p className="text-sm font-semibold text-indigo-800">📅 นัดหมาย & คิวช่าง</p>
                  {job.apptDate && (
                    <p className="text-xs text-indigo-600">นัดปัจจุบัน: {new Date(job.apptDate).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}</p>
                  )}
                  <div>
                    <label className="text-xs font-medium text-indigo-700">เลื่อนนัด / ยืนยันวันใหม่</label>
                    <input
                      type="date"
                      value={newApptDate}
                      onChange={(e) => setNewApptDate(e.target.value)}
                      className="mt-1 w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                  </div>
                  <p className="text-xs text-indigo-500">ℹ️ บันทึก/เลื่อนวันนัดได้ทุกสเตจ โดยไม่เปลี่ยน Stage ของงาน</p>
                  <button
                    onClick={saveApptDate}
                    disabled={saving || !newApptDate}
                    className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "กำลังบันทึก..." : "📅 บันทึกวันนัด"}
                  </button>

                  {/* นัดช่าง -> เข้าคิวงาน (appointments) */}
                  <div className="pt-3 mt-1 border-t border-indigo-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-indigo-800">👷 นัดช่าง + เข้าคิวงาน</p>
                      <button type="button" onClick={() => { setPreviewIdx(null); setShowQueue((v) => !v); }} className="hidden md:inline-block text-[11px] px-2 py-0.5 rounded-full border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50">
                        {showQueue ? "ซ่อนคิวช่าง" : "👁 ดูคิวช่าง (ซ้าย)"}
                      </button>
                    </div>
                    <select
                      value={apptTechId}
                      onChange={(e) => setApptTechId(e.target.value)}
                      className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option value="">— เลือกทีมช่าง —</option>
                      {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                      <input type="time" value={apptStart} onChange={(e) => setApptStart(e.target.value)} className="flex-1 border border-indigo-200 rounded-lg px-2 py-2 text-sm bg-white" />
                      <span className="text-xs text-indigo-500">ถึง</span>
                      <input type="time" value={apptEnd} onChange={(e) => setApptEnd(e.target.value)} className="flex-1 border border-indigo-200 rounded-lg px-2 py-2 text-sm bg-white" />
                    </div>
                    <button
                      onClick={bookTech}
                      disabled={saving || !newApptDate || !apptTechId}
                      className="w-full bg-cyan-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "กำลังบันทึก..." : "👷 นัดช่าง + เข้าคิว"}
                    </button>
                    <p className="text-[11px] text-indigo-500">สร้างคิวในตาราง นัดหมาย/คิวงาน (สถานะ: รอยืนยัน)</p>
                  </div>
                </div>
              )}

              {/* S2: ใบสั่งงาน (หัวหน้าช่าง) — ของที่ต้องหยิบ + คำนวณความยาว */}
              {false && job.stage === 2 && (
                <div className="border-2 border-amber-300 rounded-xl p-4 bg-amber-50 space-y-3">
                  <p className="text-sm font-semibold text-amber-900">🧰 ใบสั่งงาน (หัวหน้าช่างระบุของที่ต้องหยิบ)</p>

                  <div className="bg-white rounded-lg p-2.5 text-xs text-slate-700 border border-amber-200">
                    <p className="font-medium text-amber-800 mb-1">📐 ความยาวแผ่นที่ห้องต้องใช้ (อ้างอิงจากโซน)</p>
                    {zones.length === 0 ? (
                      <p className="text-slate-400">ยังไม่มีข้อมูลโซน — ไปกำหนดโซนที่หน้า “ต้นทุนเศษ” เพื่อคำนวณ</p>
                    ) : (
                      <p>รวม {zones.length} โซน · หน้ากว้าง 140: <b>{req.total140.toLocaleString()}</b> ซม. · หน้ากว้าง 110: <b>{req.total110.toLocaleString()}</b> ซม.</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-amber-800">🆕 ของใหม่ที่ต้องเบิก</p>
                    {pickPlan.newItems.map((it, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <select value={it.width} onChange={(e) => setNewItem(i, "width", e.target.value)} className="border border-amber-200 rounded px-1.5 py-1 text-sm bg-white">
                          <option value="140">140</option>
                          <option value="110">110</option>
                        </select>
                        <input value={it.length_cm} onChange={(e) => setNewItem(i, "length_cm", e.target.value)} placeholder="ยาว(ซม.)" inputMode="decimal" className="w-20 border border-amber-200 rounded px-1.5 py-1 text-sm" />
                        <input value={it.qty} onChange={(e) => setNewItem(i, "qty", e.target.value)} placeholder="จำนวน" inputMode="numeric" className="w-16 border border-amber-200 rounded px-1.5 py-1 text-sm" />
                        <input value={it.note} onChange={(e) => setNewItem(i, "note", e.target.value)} placeholder="หมายเหตุ" className="flex-1 border border-amber-200 rounded px-1.5 py-1 text-sm" />
                        <button onClick={() => removeNewItem(i)} className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                      </div>
                    ))}
                    <button onClick={addNewItem} className="w-full border border-dashed border-amber-400 text-amber-700 rounded-lg py-1.5 text-sm hover:bg-amber-100">+ เพิ่มของใหม่</button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-amber-800">♻️ เศษที่ให้หยิบไปใช้</p>
                    {pickPlan.remnants.map((it, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input value={it.mat_type} onChange={(e) => setPickRemnant(i, "mat_type", e.target.value)} placeholder="ชนิด" className="flex-1 border border-amber-200 rounded px-1.5 py-1 text-sm" />
                        <input value={it.width_bin} onChange={(e) => setPickRemnant(i, "width_bin", e.target.value)} placeholder="กว้าง" inputMode="numeric" className="w-16 border border-amber-200 rounded px-1.5 py-1 text-sm" />
                        <input value={it.length_cm} onChange={(e) => setPickRemnant(i, "length_cm", e.target.value)} placeholder="ยาว" inputMode="decimal" className="w-16 border border-amber-200 rounded px-1.5 py-1 text-sm" />
                        <button onClick={() => removePickRemnant(i)} className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                      </div>
                    ))}
                    <button onClick={addPickRemnant} className="w-full border border-dashed border-amber-400 text-amber-700 rounded-lg py-1.5 text-sm hover:bg-amber-100">+ เพิ่มเศษที่ใช้</button>
                  </div>

                  <textarea value={pickPlan.note} onChange={(e) => setPickPlan((p) => ({ ...p, note: e.target.value }))} rows={2} placeholder="หมายเหตุถึงทีมช่าง" className="w-full border border-amber-200 rounded-lg px-2 py-1.5 text-sm bg-white" />
                  <button onClick={savePickPlan} disabled={saving} className="w-full bg-amber-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
                    {saving ? "กำลังบันทึก..." : pickPlan.savedAt ? "🧰 บันทึกใบสั่งงานอีกครั้ง" : "🧰 บันทึกใบสั่งงาน"}
                  </button>
                </div>
              )}

              {/* S2: ส่งต่อไป Operations เพื่อจ่ายงานรายบุคคล */}
              {job.stage === 2 && (
                <div className="border rounded-xl p-4 bg-violet-50 space-y-2">
                  <p className="text-sm font-semibold text-violet-800">📋 ใบสั่งงานกลาง FloorNow</p>
                  <p className="text-xs text-violet-600">ตรวจข้อมูลลูกค้า จ่ายช่าง ระบุวัสดุ/อุปกรณ์ และส่งต่อคลังจากเอกสารเดียว</p>
                  <a href={`/orders/${encodeURIComponent(job.jobNo)}`} className="block w-full rounded-lg bg-violet-600 py-2 text-center text-sm font-semibold text-white hover:bg-violet-700">เปิดใบสั่งงานฉบับเต็ม</a>
                </div>
              )}

              {/* S4: เศษคงเหลือ + เข้าคลังเศษ */}
              {job.stage === 4 && (
                <div className="border-2 border-emerald-300 rounded-xl p-4 bg-emerald-50 space-y-3">
                  <p className="text-sm font-semibold text-emerald-800">♻️ เศษคงเหลือ (บันทึกก่อนเข้ารอประเมิน)</p>
                  <label className="flex items-center gap-2 text-sm text-emerald-800">
                    <input
                      type="checkbox"
                      checked={matUsage.noRemnant}
                      onChange={(e) => setMatUsage((m) => ({ ...m, noRemnant: e.target.checked, savedAt: undefined }))}
                    />
                    ไม่มีเศษเหลือ (ใช้วัสดุหมด)
                  </label>
                  {!matUsage.noRemnant && (
                    <div className="space-y-2">
                      {matUsage.pieces.map((p, i) => (
                        <div key={i} className="border border-emerald-200 rounded-lg p-2 bg-white space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-emerald-700">ชิ้นที่ {i + 1}</span>
                            <button onClick={() => removePiece(i)} className="text-red-400 hover:text-red-600 text-xs">ลบ</button>
                          </div>
                          <input value={p.mat_type} onChange={(e) => setPiece(i, "mat_type", e.target.value)} placeholder="ชนิดวัสดุ" className="w-full border border-emerald-200 rounded px-2 py-1 text-sm" />
                          <div className="flex items-center gap-2">
                            <input value={p.width_bin} onChange={(e) => setPiece(i, "width_bin", e.target.value)} placeholder="กว้าง (cm)" inputMode="numeric" className="flex-1 border border-emerald-200 rounded px-2 py-1 text-sm" />
                            <input value={p.length_cm} onChange={(e) => setPiece(i, "length_cm", e.target.value)} placeholder="ยาว (cm)" inputMode="decimal" className="flex-1 border border-emerald-200 rounded px-2 py-1 text-sm" />
                          </div>
                          <input value={p.note} onChange={(e) => setPiece(i, "note", e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" className="w-full border border-emerald-200 rounded px-2 py-1 text-sm" />
                        </div>
                      ))}
                      <button onClick={addPiece} className="w-full border border-dashed border-emerald-400 text-emerald-700 rounded-lg py-1.5 text-sm hover:bg-emerald-100 transition-colors">+ เพิ่มชิ้นเศษ</button>
                    </div>
                  )}
                  <textarea value={matUsage.note} onChange={(e) => setMatUsage((m) => ({ ...m, note: e.target.value }))} rows={2} placeholder="หมายเหตุรวม เช่น วัสดุที่หยิบไป vs ใช้จริง" className="w-full border border-emerald-200 rounded-lg px-2 py-1.5 text-sm bg-white" />
                  <button
                    onClick={saveMaterialUsage}
                    disabled={saving}
                    className="w-full bg-emerald-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "กำลังบันทึก..." : matDone ? "♻️ บันทึกอีกครั้ง" : "♻️ บันทึกเศษ + เข้าคลัง"}
                  </button>
                  {matDone && <p className="text-[11px] text-emerald-600">✓ บันทึกแล้ว — กด 'ย้ายไปขั้นถัดไป' เพื่อเข้าสู่รอประเมิน</p>}
                </div>
              )}

              {job.stage < 6 && (
                <>
                  {job.stage === 1 && !surveyDone && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ ต้องสำรวจหน้างาน (แท็บ สำรวจ) ก่อนถึงจะส่งให้หัวหน้าช่างยืนยันนัดได้
                    </p>
                  )}
                  {job.stage === 4 && !matDone && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ ต้องบันทึกเศษคงเหลือก่อนถึงจะเข้าสู่รอประเมินได้
                    </p>
                  )}
                  <button
                    onClick={advanceStage}
                    disabled={(job.stage === 1 && !surveyDone) || (job.stage === 4 && !matDone)}
                    className="w-full mt-2 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    ➡ ย้ายไปขั้นถัดไป
                  </button>
                </>
              )}
            </div>
          )}

          {/* SURVEY */}
          {tab === "survey" && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
                บันทึกข้อมูลสำรวจหน้างาน — บังคับทำที่ S1 (รับ order) ก่อนส่งให้หัวหน้าช่างยืนยันนัด
              </p>

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

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">พื้นที่ติดตั้ง (ตร.ม.)</label>
                <input
                  type="number" min="0" step="0.1"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="เช่น 24.5"
                  value={survey.areaSqm}
                  onChange={(e) => setSurvey((s) => ({ ...s, areaSqm: e.target.value }))}
                />
              </div>

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

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">รูปหน้างาน</label>
                <div className="flex gap-2 mb-2">
                  <label className="flex-1 cursor-pointer text-center border border-blue-200 text-blue-700 rounded-lg py-2 text-sm hover:bg-blue-50">
                    📷 ถ่ายรูป
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; handleSurveyUpload(fs); }} />
                  </label>
                  <label className="flex-1 cursor-pointer text-center border border-slate-200 text-slate-700 rounded-lg py-2 text-sm hover:bg-slate-50">
                    🖼️ เลือกรูป
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; handleSurveyUpload(fs); }} />
                  </label>
                </div>
                {uploading && <p className="text-xs text-gray-400 mb-2">กำลังอัปโหลด...</p>}
                {(survey.photos?.length ?? 0) > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {survey.photos!.map((p, idx) => (
                      <div key={p} className="relative">
                        <button type="button" onClick={() => { setShowQueue(false); setPreviewIdx(idx); }} className="block w-full" title="กดเพื่อดูรูปขยายด้านซ้าย">
                          <img src={surveyPhotoUrl(p)} alt="รูปหน้างาน" className="w-full h-20 object-cover rounded-lg border border-gray-200 hover:ring-2 hover:ring-blue-400" />
                        </button>
                        <button onClick={() => removeSurveyPhoto(p)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs leading-none flex items-center justify-center">×</button>
                      </div>
                    ))}
                  </div>
                )}
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

          {/* ตรวจรับ (QC) — เกณฑ์มาจากแม่แบบที่หัวหน้าช่างเปิดใช้งานอยู่ ไม่ใช่รายการที่ฝังในโค้ด */}
          {tab === "qc" && (
            <div className="space-y-4">
              <div className={`rounded-lg border p-2.5 text-xs leading-relaxed ${checklist.origin === "template" ? "border-blue-200 bg-blue-50 text-blue-900" : checklist.origin === "loading" ? "border-gray-200 bg-gray-50 text-gray-600" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                <div className="font-semibold">{checklistProvenanceLabel(checklist)}</div>
                <p className="mt-0.5">
                  {checklist.origin === "loading"
                    ? "ยังไม่แสดงรายการจนกว่าจะรู้ว่าแม่แบบรุ่นไหนเปิดใช้งานอยู่ — กันไม่ให้อ่านเกณฑ์รุ่นเก่าไปโดยเข้าใจว่าเป็นรุ่นล่าสุด"
                    : checklist.origin === "template"
                    ? `แสดง ${checklist.items.length} ข้อจากแม่แบบที่เปิดใช้งานอยู่ — แก้ได้ที่หน้า “แม่แบบประเภทงาน” โดยไม่ต้องแก้โปรแกรม`
                    : `ตอนนี้ใช้ชุดสำรองที่ฝังอยู่ในโปรแกรม (${checklist.items.length} ข้อ) การแก้แม่แบบจะยังไม่มีผลกับหน้านี้ · สาเหตุ: ${checklist.fallbackReason ?? "ไม่ทราบสาเหตุ"}`}
                </p>
              </div>

              {roleChecked && !canEditQc ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">{QC_ROLE_NOTICE}</div>
              ) : null}
              {qcSaveBlockReason(qcLoadState) && qcLoadState === "error" ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{qcSaveBlockReason(qcLoadState)}</div>
              ) : null}

              {checklist.origin === "loading" ? (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((row) => <div key={row} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}
                </div>
              ) : null}

              {checklist.origin === "loading" ? null : (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-gray-500">ตอบแล้ว {qcAnswered}/{checklist.items.length} ข้อ</span>
                  <span className="text-emerald-700 font-medium">ผ่าน {qcPass}</span>
                  <span className="text-red-700 font-medium">ไม่ผ่าน {qcFail}</span>
                </div>
              )}

              <div className="space-y-2">
                {checklist.items.map((item, index) => {
                  const value = qcResults[item.code] ?? null;
                  return (
                    <div key={item.code} className="rounded-lg border border-gray-200 p-2.5">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-600" title="รหัสถาวรของเกณฑ์ข้อนี้ ใช้อ้างอิงผลตรวจรับย้อนหลัง">{item.code}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 break-words">{index + 1}. {item.label}</div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {item.spec ? `เกณฑ์: ${item.spec}` : "ไม่ได้ระบุค่าเกณฑ์"}
                            {item.measuringDeviceKind ? ` · เครื่องมือ: ${item.measuringDeviceKind}` : ""}
                            {item.isCritical ? " · ข้อสำคัญ" : ""}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {([["pass", "ผ่าน"], ["fail", "ไม่ผ่าน"], ["na", "ไม่เกี่ยวข้อง"]] as const).map(([key, label]) => {
                          const on = value === key;
                          const tone = key === "pass" ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                            : key === "fail" ? "border-red-500 bg-red-50 text-red-800"
                            : "border-gray-400 bg-gray-100 text-gray-700";
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={!canEditQc || qcLoadState !== "ready"}
                              onClick={() => setQcResults((current) => ({ ...current, [item.code]: on ? null : key }))}
                              className={`min-h-9 rounded-lg border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? tone : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-gray-500">
                  ผู้ตรวจรับ
                  <input
                    value={qcInspector}
                    disabled={!canEditQc || qcLoadState !== "ready"}
                    onChange={(e) => setQcInspector(e.target.value)}
                    placeholder="ชื่อผู้ตรวจรับ"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  หมายเหตุการตรวจรับ
                  <textarea
                    value={qcNotes}
                    disabled={!canEditQc || qcLoadState !== "ready"}
                    onChange={(e) => setQcNotes(e.target.value)}
                    rows={3}
                    placeholder="สิ่งที่พบหน้างาน / สิ่งที่ต้องแก้"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </label>
              </div>

              <button
                onClick={saveQC}
                disabled={saving || !canEditQc || qcLoadState !== "ready"}
                title={!canEditQc && roleChecked ? QC_ROLE_NOTICE : (qcSaveBlockReason(qcLoadState) ?? undefined)}
                className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "กำลังบันทึก..."
                  : !roleChecked ? "กำลังตรวจสอบสิทธิ์…"
                  : !canEditQc ? "🔒 ไม่มีสิทธิ์บันทึกผลตรวจรับ"
                  : qcLoadState === "loading" ? "กำลังโหลดผลตรวจรับเดิม…"
                  : qcLoadState === "error" ? "⛔ บันทึกไม่ได้ — อ่านผลเดิมไม่สำเร็จ"
                  : "💾 บันทึกผลตรวจรับ"}
              </button>
            </div>
          )}

          {/* LOG — ประวัติงาน (เฟส B) */}
          {tab === "log" && (
            <div className="space-y-2">
              {activity.length === 0 ? (
                <p className="text-sm text-gray-400">ยังไม่มีประวัติการเปลี่ยนแปลง</p>
              ) : activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs border-b border-gray-100 pb-2">
                  <span className="text-gray-400 shrink-0 w-[86px]">
                    {new Date(a.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="flex-1 leading-relaxed">
                    <span className="font-medium text-gray-700">{ACT_FIELD_LABEL[a.field ?? ""] ?? a.field}</span>
                    {a.action === "created" ? (
                      <span className="text-green-600"> · สร้างงาน</span>
                    ) : (
                      <span className="text-gray-500"> : {fmtActVal(a.field, a.old_value)} → <span className="text-gray-800 font-medium">{fmtActVal(a.field, a.new_value)}</span></span>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-400 pt-1">บันทึกอัตโนมัติทุกการเปลี่ยนแปลง · ล่าสุด 100 รายการ</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

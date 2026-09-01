"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { floorActionError, floorErrorMessage } from "@/lib/floor-error-message";
import { isFreeformWorkNote as isFreeformWorkNoteLine } from "@/lib/freeform-work-note";
import {
  checklistFromRpcPayload,
  checklistProvenanceLabel,
  checklistWithoutAssignment,
  fallbackChecklist,
  loadingChecklist,
  type JobChecklistSource,
} from "@/lib/job-checklist";
import BbpsWorkOrderDetails from "@/components/tech-queue/bbps-work-order-details";
import RemnantReportForm, { MaterialMovement, RemnantReportData } from "@/components/technician/remnant-report-form";
import TechnicianReceiptConfirmation from "@/components/technician/receipt-confirmation";
import TechnicianUsageReturn from "@/components/technician/usage-return";
import TechnicianPushButton from "@/components/notifications/technician-push-button";
import TicketChat from "@/components/tickets/ticket-chat";
import LendiSkeleton from "@/components/brand/lendi-skeleton";

interface WorkAssignment {
  assignmentId: string | null; isLead: boolean; isTeamQueue?: boolean; firstOpenedAt: string | null; lastOpenedAt: string | null;
  openCount: number; acknowledgedAt: string | null; appointmentId: string; slotStart: string; slotEnd: string;
  appointmentStatus: string; teamName: string | null; notes: string | null; requirement: string | null;
  jobNo: string | null; source: string | null; billNo: string | null; customerName: string | null;
  customerPhone: string | null; address: string | null; locationUrl: string | null; productName: string | null;
  surveyData: string | null; pickPlan: unknown;
}
interface ResponsibleTechnician {
  id: string;
  is_lead: boolean;
  first_opened_at: string | null;
  acknowledged_at: string | null;
  technician: { name: string | null; phone: string | null; is_team_lead: boolean | null } | null;
}
interface DetailJob { raw_payload: unknown; site_photos: string[] | null; survey_data: string | null }
interface WorkProgressEvent {
  id: number; status: string; note: string | null; photoPaths: string[]; pickedSheetCount: number | null;
  customerSignedName: string | null; customerSignaturePath: string | null; occurredAt: string;
}
interface WorkProgress { plannedSheetCount: number | null; pickedSheetCount: number | null; events: WorkProgressEvent[] }
interface StatusFilePreview { id: string; file: File; url: string }
interface CentralWorkItem { id: string; category: string; itemName: string; sku: string | null; specification: string | null; plannedQty: number; actualQty: number | null; unit: string; sourceType: string; note: string | null }
interface CentralWorkOrder { id: string; status: string; revision: number; note: string | null; warehouseAssignee: string | null; warehouseAcceptedAt: string | null; warehouseCompletedAt: string | null; isLead: boolean; items: CentralWorkItem[]; events: { id: number; eventType: string; actorName: string; note: string | null; photoPaths: string[]; occurredAt: string }[] }
interface Workspace {
  technician: { id: string; name: string; phone: string | null; teamId: string | null; teamName: string | null; isTeamLead: boolean };
  assignments: WorkAssignment[];
}
interface PickNewItem { width?: string | null; length_cm?: string | null; qty?: string | null; note?: string | null }
interface PickRemnant { mat_type?: string | null; width_bin?: string | null; length_cm?: string | null; note?: string | null }
interface PickPlan { newItems?: PickNewItem[]; remnants?: PickRemnant[]; note?: string | null }

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}
function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
function parsePickPlan(value: unknown): PickPlan | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed as PickPlan : null;
  } catch {
    return null;
  }
}
function hasPickPlan(plan: PickPlan | null) {
  return Boolean(plan && ((plan.newItems?.length ?? 0) > 0 || (plan.remnants?.length ?? 0) > 0 || (typeof plan.note === "string" && plan.note.trim())));
}
function PickPlanDetails({ value }: { value: unknown }) {
  const plan = parsePickPlan(value);
  if (!hasPickPlan(plan)) return null;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
    <div className="font-semibold text-amber-950">ใบสั่งงาน — ของที่ต้องหยิบ</div>
    {plan?.newItems?.length ? <div className="mt-3">
      <div className="text-xs font-medium text-amber-700">ของใหม่ที่ต้องเบิก</div>
      <div className="mt-1 space-y-1.5">{plan.newItems.map((item, index) => <div key={index} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
        หน้ากว้าง {item.width || "—"} ซม. · ยาว {item.length_cm || "—"} ซม. · จำนวน {item.qty || "—"}{item.note ? ` · ${item.note}` : ""}
      </div>)}</div>
    </div> : null}
    {plan?.remnants?.length ? <div className="mt-3">
      <div className="text-xs font-medium text-amber-700">เศษที่ให้หยิบไปใช้</div>
      <div className="mt-1 space-y-1.5">{plan.remnants.map((item, index) => <div key={index} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
        {item.mat_type || "เศษวัสดุ"} · กว้าง {item.width_bin || "—"} · ยาว {item.length_cm || "—"} ซม.{item.note ? ` · ${item.note}` : ""}
      </div>)}</div>
    </div> : null}
    {plan?.note ? <div className="mt-3 whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-xs text-slate-700">{plan.note}</div> : null}
  </section>;
}
function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
function textOf(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
function workErrorMessage(error: unknown) {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : error instanceof Error ? error.message : "";
  if (message.includes("installation can be accepted on the scheduled date")) return "ยังเริ่มงานไม่ได้: งานจริงเริ่มได้เฉพาะวันนัดติดตั้ง หากวันนัดไม่ถูกต้อง กรุณาแจ้งหัวหน้าช่าง";
  if (message.includes("lead technician must accept installation first")) return "ยังเริ่มงานไม่ได้: หัวหน้าช่างที่ได้รับมอบหมายต้องกดรับงานติดตั้งก่อน";
  if (message.includes("assignment not found")) return "ไม่พบงานที่มอบหมายให้บัญชีนี้ กรุณาปิดหน้าแล้วเปิดลิงก์งานใหม่ หรือติดต่อหัวหน้าช่าง";
  if (message.includes("acknowledge assignment first")) return "กรุณากด “รับทราบงาน” ก่อนเริ่มอัปเดตสถานะ";
  if (message.includes("invalid work status transition")) return "ลำดับสถานะไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วทำขั้นตอนล่าสุดอีกครั้ง";
  if (message.includes("head technician material plan is required")) return "ยังเริ่มงานไม่ได้: หัวหน้าช่างต้องระบุรายการวัสดุและจำนวนแผ่นก่อน";
  if (message.includes("status photo is required")) return "กรุณาถ่ายหรือเลือกรูปหลักฐานอย่างน้อย 1 รูป";
  if (message.includes("remnant report is required")) return "กรุณาบันทึกเศษที่เหลือ หรือยืนยันว่าไม่มีเศษเหลือ ก่อนให้ลูกค้าเซ็นรับงาน";
  return message ? `บันทึกสถานะไม่สำเร็จ: ${floorErrorMessage(error)}` : "บันทึกสถานะไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองอีกครั้ง หากยังไม่ได้ให้แจ้งหัวหน้าช่าง";
}

function suggestedMaterialMovements(order: CentralWorkOrder | null): MaterialMovement[] {
  return (order?.items ?? []).filter((item) => item.category === "floor_material").map((item) => {
    const text = `${item.itemName} ${item.sku ?? ""} ${item.specification ?? ""}`;
    const width = /140/.test(text) ? "140" : "110";
    const thickness = /(^|\D)6\s*(มม|mm|B|W|$)/i.test(text) ? "6" : "16";
    const color = /white|ขาว|(^|[^a-z])W([^a-z]|$)/i.test(text) ? "W" : "B";
    const lengthMatch = text.match(/(?:ยาว|length)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    return { thickness, color, widthCm: width, lengthCm: lengthMatch?.[1] ?? "", qty: String(item.actualQty ?? item.plannedQty ?? 1), note: [item.sku, item.itemName].filter(Boolean).join(" · ") };
  });
}

function totalSheetQuantity(order: CentralWorkOrder | null, field: "plannedQty" | "actualQty") {
  if (!order) return null;
  const quantities = order.items
    .filter((item) => item.unit.trim().includes("แผ่น"))
    .map((item) => item[field])
    .filter((quantity): quantity is number => typeof quantity === "number");
  return quantities.length ? quantities.reduce((total, quantity) => total + quantity, 0) : null;
}

interface LinkRedirect {
  newToken: string;
}

function localDemoWorkspace(): Workspace {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12, 0, 0, 0);
  return {
    technician: { id: "00000000-0000-4000-8000-000000000001", name: "โจเซฟ (ข้อมูลจำลอง)", phone: "080-000-0000", teamId: "demo-team", teamName: "ทีม B", isTeamLead: true },
    assignments: [{
      assignmentId: "00000000-0000-4000-8000-000000000002", isLead: true, firstOpenedAt: null, lastOpenedAt: null, openCount: 0, acknowledgedAt: null,
      appointmentId: "00000000-0000-4000-8000-000000000003", slotStart: start.toISOString(), slotEnd: end.toISOString(), appointmentStatus: "confirmed", teamName: "ทีม B",
      notes: "ข้อมูลจำลองสำหรับทดสอบหน้าช่างบน local เท่านั้น", requirement: "ติดตั้งกระเบื้องยาง Safespace พร้อมเก็บขอบ", jobNo: "DEMO-LOCAL-001", source: "demo",
      billNo: "DEMO-260827", customerName: "ลูกค้าทดสอบ Local", customerPhone: "080-000-0000", address: "123 ถนนทดสอบ กรุงเทพมหานคร", locationUrl: "https://maps.google.com/?q=13.7563,100.5018",
      productName: "Safespace 0.6 cm", surveyData: JSON.stringify({ areaSqm: "25", floorCondition: "แห้งสะอาด", notes: "ใช้เพื่อทดสอบหน้าจอเท่านั้น" }),
      pickPlan: { newItems: [{ width: "110", length_cm: "250", qty: "10", note: "กระเบื้องยาง Safespace" }], note: "โปรดตรวจสอบจำนวนก่อนออกหน้างาน" },
    }],
  };
}

function localDemoWorkProgress(): WorkProgress {
  return { plannedSheetCount: 10, pickedSheetCount: null, events: [] };
}

function localDemoWorkOrder(): CentralWorkOrder {
  return {
    id: "00000000-0000-4000-8000-000000000004", status: "ready_to_install", revision: 1,
    note: "ข้อมูลจำลอง: คลังเตรียมและจ่ายกระเบื้องให้ครบ 10 แผ่น", warehouseAssignee: "คลังสินค้า (ข้อมูลจำลอง)", warehouseAcceptedAt: new Date().toISOString(), warehouseCompletedAt: new Date().toISOString(), isLead: true,
    items: [{ id: "00000000-0000-4000-8000-000000000005", category: "material", itemName: "กระเบื้องยาง Safespace", sku: "LDSSF004", specification: "0.6 cm", plannedQty: 10, actualQty: 10, unit: "แผ่น", sourceType: "sku", note: null }],
    events: [],
  };
}
// แก้ตามรีวิว D2: กฎ "บรรทัดไหนไม่ใช่ของ" ย้ายไปอยู่ที่เดียวใน lib/freeform-work-note.ts
// เพื่อไม่ให้มีสำเนาที่ค่อย ๆ เพี้ยนจากกัน (lib/technician-receipt.ts เคยลอกไปแค่ 3 ใน 6 เงื่อนไข)
function isFreeformWorkNote(item: CentralWorkItem) {
  return isFreeformWorkNoteLine(item);
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs font-medium text-slate-400">{label}</div><div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{children || "—"}</div></div>;
}
function WorkSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}</div>
    </div>
    {children}
  </section>;
}

function EvidenceGallery({ paths, label, supabase }: { paths: string[]; label: string; supabase: ReturnType<typeof createClient> }) {
  if (!paths.length) return <div className="mt-2 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">ไม่มีรูปหลักฐานในสถานะนี้</div>;
  return <div className="mt-3">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-xs font-semibold text-slate-700">รูปหลักฐาน</div>
      <div className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500">{paths.length} รูป</div>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {paths.map((path, index) => {
        const url = /^(https?:|blob:|data:)/.test(path) ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl;
        return <a key={`${path}-${index}`} href={url} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${label} รูปที่ ${index + 1}`} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white">รูปที่ {index + 1}</span>
          <span className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 py-1 text-[10px] font-medium text-slate-700">เปิดรูปเต็ม</span>
        </a>;
      })}
    </div>
  </div>;
}

const WORK_STEPS = [
  { status: "travelling", label: "กำลังเดินทาง", button: "เริ่มเดินทาง" },
  { status: "arrived", label: "ถึงบ้านลูกค้าแล้ว", button: "ยืนยันถึงหน้างาน" },
  { status: "installing", label: "กำลังติดตั้ง", button: "เริ่มติดตั้ง" },
  { status: "completed", label: "ติดตั้งงานเสร็จสมบูรณ์", button: "ยืนยันติดตั้งเสร็จ" },
] as const;

function CustomerSignature({ busy, onSubmit }: { busy: boolean; onSubmit: (name: string, blob: Blob) => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [name, setName] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  }
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!; const p = point(event);
    drawing.current = true; canvas.setPointerCapture(event.pointerId); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.strokeStyle = "#0f172a";
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!; const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasInk(true);
  }
  function stop() { drawing.current = false; }
  function clear() { canvasRef.current?.getContext("2d")?.clearRect(0, 0, 700, 240); setHasInk(false); }
  async function submit() {
    if (!name.trim() || !hasInk || !canvasRef.current) return;
    const blob = await new Promise<Blob | null>((resolve) => canvasRef.current!.toBlob(resolve, "image/png"));
    if (blob) await onSubmit(name.trim(), blob);
  }

  return <div className="space-y-3">
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-relaxed text-violet-950"><div className="font-semibold">ข้อกำหนดก่อนลงนาม</div><p className="mt-1">ลูกค้าตรวจรับผลงานตามขอบเขตที่ตกลง รับทราบวิธีดูแลรักษา และยอมรับว่าหากพบประเด็นเพิ่มเติมจะแจ้งผ่านช่องทางบริการลูกค้า</p><label className="mt-2 flex cursor-pointer items-start gap-2 font-medium"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} className="mt-0.5" />ข้าพเจ้าอ่านและยอมรับข้อกำหนดข้างต้น</label></div>
    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อผู้รับงาน" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
    <div className="overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white"><canvas ref={canvasRef} width={700} height={240} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} className="h-40 w-full touch-none" /></div>
    <div className="flex gap-2"><button type="button" onClick={clear} className="flex-1 rounded-xl border border-slate-300 py-2 text-sm">ล้างลายเซ็น</button><button type="button" onClick={() => void submit()} disabled={busy || !acceptedTerms || !name.trim() || !hasInk} className="flex-1 rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "กำลังบันทึก…" : "ยอมรับและเซ็นรับงาน"}</button></div>
  </div>;
}

export default function TechnicianWorkspacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [linkRedirect, setLinkRedirect] = useState<LinkRedirect | null | undefined>(undefined);
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkAssignment | null>(null);
  const [responsibles, setResponsibles] = useState<ResponsibleTechnician[]>([]);
  const [detailJob, setDetailJob] = useState<DetailJob | null>(null);
  const [workProgress, setWorkProgress] = useState<WorkProgress | null>(null);
  const [centralWorkOrder, setCentralWorkOrder] = useState<CentralWorkOrder | null>(null);
  const [remnantReport, setRemnantReport] = useState<RemnantReportData | null>(null);
  // T8: เกณฑ์ตรวจรับที่ช่างต้องเคลียร์ — อ่านจากแม่แบบที่หัวหน้าช่างเปิดใช้งานอยู่ ไม่ใช่รายการที่ฝังในโค้ด
  const [checklist, setChecklist] = useState<JobChecklistSource>(() => fallbackChecklist("ยังไม่ได้เปิดงาน"));
  const [statusFiles, setStatusFiles] = useState<StatusFilePreview[]>([]);
  const statusFilesRef = useRef<StatusFilePreview[]>([]);
  const [statusNote, setStatusNote] = useState("");
  const [pickedSheetCount, setPickedSheetCount] = useState("");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [requestedJob, setRequestedJob] = useState<string | null>(null);
  const pinStorageKey = `floor-work-pin:${token}`;
  const suggestedRemnantMaterials = useMemo(() => suggestedMaterialMovements(centralWorkOrder), [centralWorkOrder]);

  useEffect(() => { statusFilesRef.current = statusFiles; }, [statusFiles]);
  useEffect(() => () => { statusFilesRef.current.forEach((item) => URL.revokeObjectURL(item.url)); }, []);

  useEffect(() => {
    setRequestedJob(new URLSearchParams(window.location.search).get("job"));
  }, []);

  useEffect(() => {
    let active = true;
    supabase.rpc("get_floor_technician_link_redirect", { p_old_token: token }).then(({ data }) => {
      if (!active) return;
      const value = data as LinkRedirect | null;
      setLinkRedirect(value?.newToken ? value : null);
    });
    return () => { active = false; };
  }, [supabase, token]);

  const load = useCallback(async (pinValue: string) => {
    const normalized = pinValue.trim();
    if (!normalized) {
      setWorkspace(null);
      setLoading(false);
      return false;
    }
    const { data, error } = await supabase.rpc("get_technician_workspace", { p_token: token, p_pin: normalized });
    if (!error && data) {
      const rawWorkspace = data as Workspace;
      const nextWorkspace: Workspace = {
        ...rawWorkspace,
        // Never trust a team-wide queue on a personal link. Only rows backed by
        // this technician's active individual assignment are allowed here.
        assignments: (rawWorkspace.assignments ?? []).filter((assignment) =>
          Boolean(assignment.assignmentId) && assignment.isTeamQueue !== true
        ),
      };
      // Personal links expose only explicitly assigned appointments. Team queues
      // belong on the head-technician screens and must not leak customer data.
      setWorkspace(nextWorkspace);
      setAuthError(null);
      setLoading(false);
      if (typeof window !== "undefined") window.sessionStorage.setItem(pinStorageKey, normalized);
      return true;
    }
    setWorkspace(null);
    setLoading(false);
    return false;
  }, [pinStorageKey, supabase, token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isLocalDemo = ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).get("demo") === "1";
    if (isLocalDemo) {
      setDemoMode(true);
      setWorkspace(localDemoWorkspace());
      setLoading(false);
      return;
    }
    const saved = window.sessionStorage.getItem(pinStorageKey);
    if (saved) {
      setPin(saved);
      void load(saved);
      return;
    }
    setLoading(false);
  }, [load, pinStorageKey]);

  const upcoming = useMemo(() => {
    const now = Date.now() - 12 * 60 * 60 * 1000;
    return (workspace?.assignments ?? []).filter((a) => new Date(a.slotEnd).getTime() >= now);
  }, [workspace]);
  const grouped = useMemo(() => {
    const groups = new Map<string, WorkAssignment[]>();
    for (const a of upcoming) groups.set(dateKey(a.slotStart), [...(groups.get(dateKey(a.slotStart)) ?? []), a]);
    return Array.from(groups.entries());
  }, [upcoming]);

  async function openWork(a: WorkAssignment) {
    const openedAt = new Date().toISOString();
    const openedAssignment = demoMode && !a.firstOpenedAt
      ? { ...a, firstOpenedAt: openedAt, lastOpenedAt: openedAt, openCount: a.openCount + 1 }
      : a;
    setSelected(openedAssignment);
    setResponsibles([]);
    setDetailJob(null);
    setWorkProgress(null);
    setCentralWorkOrder(null);
    setRemnantReport(null);
    setChecklist(loadingChecklist());
    clearStatusFiles();
    setStatusNote("");
    setPickedSheetCount("");
    setProgressError(null);
    if (demoMode) {
      setWorkspace((current) => current ? {
        ...current,
        assignments: current.assignments.map((item) => item.assignmentId === a.assignmentId ? openedAssignment : item),
      } : current);
      setWorkProgress(localDemoWorkProgress());
      setCentralWorkOrder(localDemoWorkOrder());
      // โหมดข้อมูลจำลองไม่มี token/PIN จริงให้เรียก RPC จึงแสดงชุดสำรองและบอกตรง ๆ ว่าเป็นชุดสำรอง
      setChecklist(fallbackChecklist("โหมดข้อมูลจำลองไม่ได้อ่านแม่แบบจากระบบจริง"));
      return;
    }
    if (a.assignmentId) {
      await supabase.rpc("record_technician_work_event", {
        p_token: token,
        p_pin: pin.trim(),
        p_assignment_id: a.assignmentId,
        p_event_type: "opened",
        p_user_agent: navigator.userAgent,
      });
    }
    const detailTasks: PromiseLike<unknown>[] = [];
    if (!a.assignmentId) {
      // งานคิวทีมยังไม่มีใบมอบหมายรายบุคคล จึงเรียก RPC เกณฑ์ตรวจรับไม่ได้ (ด่านตรวจสิทธิ์ผูกกับใบมอบหมาย)
      // และเราจะไม่ลดด่านลงเพื่อให้เรียกได้ — ต้อง "จบ" ที่ชุดสำรองพร้อมเหตุผลจริง
      // ไม่ใช่ปล่อยให้จอค้างคำว่า "กำลังโหลด" ตลอดกาลจนดูเหมือนแอปแฮงก์
      setChecklist(checklistWithoutAssignment());
    } else {
      detailTasks.push(
        supabase.rpc("get_technician_assignment_detail", { p_token: token, p_pin: pin.trim(), p_assignment_id: a.assignmentId })
          .then(({ data }) => {
            const detail = (data ?? null) as { responsibles?: ResponsibleTechnician[]; job?: DetailJob | null } | null;
            setResponsibles(detail?.responsibles ?? []);
            setDetailJob(detail?.job ?? null);
          })
      );
      detailTasks.push(
        supabase.rpc("get_technician_work_progress", { p_token: token, p_pin: pin.trim(), p_assignment_id: a.assignmentId })
          .then(({ data }) => {
            const progress = (data ?? null) as WorkProgress | null;
            setWorkProgress(progress);
            if (progress?.pickedSheetCount != null) setPickedSheetCount(String(progress.pickedSheetCount));
          })
      );
      detailTasks.push(
        supabase.rpc("get_technician_work_order_v2", { p_token: token, p_pin: pin.trim(), p_assignment_id: a.assignmentId })
          .then(({ data }) => setCentralWorkOrder((data ?? null) as CentralWorkOrder | null))
      );
      detailTasks.push(
        supabase.rpc("get_technician_remnant_report", { p_token: token, p_pin: pin.trim(), p_assignment_id: a.assignmentId })
          .then(({ data }) => setRemnantReport((data ?? null) as RemnantReportData | null))
      );
      detailTasks.push(
        // RPC security definer ที่ตรวจ token+PIN ก่อน — หน้านี้วิ่งเป็น anon จึงอ่านตารางแม่แบบตรง ๆ ไม่ได้
        supabase.rpc("get_technician_job_checklist", { p_token: token, p_pin: pin.trim(), p_assignment_id: a.assignmentId })
          .then(({ data, error }) => {
            if (error) {
              setChecklist(fallbackChecklist(`อ่านแม่แบบเกณฑ์ตรวจรับไม่สำเร็จ — ${floorErrorMessage(error)}`));
              return;
            }
            setChecklist(checklistFromRpcPayload(data, "ยังไม่มีแม่แบบเกณฑ์ตรวจรับที่เปิดใช้งานสำหรับงานนี้"));
          })
      );
    }
    await Promise.all(detailTasks.map((task) => Promise.resolve(task)));
    void load(pin);
  }

  async function acknowledge() {
    if (!selected?.assignmentId) return;
    if (demoMode) {
      const acknowledgedAt = new Date().toISOString();
      const acknowledgedAssignment = { ...selected, acknowledgedAt };
      setSelected(acknowledgedAssignment);
      setWorkspace((current) => current ? {
        ...current,
        assignments: current.assignments.map((item) => item.assignmentId === selected.assignmentId ? acknowledgedAssignment : item),
      } : current);
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("record_technician_work_event", {
      p_token: token,
      p_pin: pin.trim(),
      p_assignment_id: selected.assignmentId,
      p_event_type: "acknowledged",
      p_user_agent: navigator.userAgent,
    });
    if (!error && data) {
      setSelected({ ...selected, acknowledgedAt: new Date().toISOString() });
      await load(pin);
    }
    setSaving(false);
  }

  useEffect(() => {
    if (!workspace || !requestedJob || selected) return;
    const assignment = workspace.assignments.find((item) => item.jobNo === requestedJob);
    if (assignment) {
      void openWork(assignment);
      setRequestedJob(null);
    }
  }, [workspace, requestedJob, selected]);

  async function reloadProgress(assignmentId: string) {
    const { data } = await supabase.rpc("get_technician_work_progress", { p_token: token, p_pin: pin.trim(), p_assignment_id: assignmentId });
    setWorkProgress((data ?? null) as WorkProgress | null);
  }

  function addStatusFiles(files: FileList | null) {
    const added = Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    if (!added.length) { setProgressError("เลือกได้เฉพาะไฟล์รูปภาพ"); return; }
    setStatusFiles((current) => [...current, ...added]);
  }

  function removeStatusFile(id: string) {
    setStatusFiles((current) => { const target = current.find((item) => item.id === id); if (target) URL.revokeObjectURL(target.url); return current.filter((item) => item.id !== id); });
  }

  function clearStatusFiles() {
    statusFilesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    setStatusFiles([]);
  }

  function retainStatusFilesAsEvidence() {
    statusFilesRef.current = [];
    setStatusFiles([]);
  }

  async function updateWorkStatus() {
    if (!selected?.assignmentId) return;
    const coreEvents = (workProgress?.events ?? []).filter((event) => !["customer_signed", "warehouse_returned"].includes(event.status));
    const current = coreEvents.at(-1)?.status;
    const currentIndex = WORK_STEPS.findIndex((step) => step.status === current);
    const next = WORK_STEPS[currentIndex + 1];
    if (!next) return;
    if (!statusFiles.length) { setProgressError("กรุณาถ่ายหรือเลือกรูปสถานะอย่างน้อย 1 รูป"); return; }
    if (next.status === "travelling" && (!pickedSheetCount.trim() || Number(pickedSheetCount) < 0)) { setProgressError("กรุณาระบุจำนวนแผ่นที่หยิบจริง"); return; }
    if (demoMode) {
      const occurredAt = new Date().toISOString();
      const photoPaths = statusFiles.map((item) => item.url);
      setWorkProgress((currentProgress) => ({
        plannedSheetCount: currentProgress?.plannedSheetCount ?? 10,
        pickedSheetCount: next.status === "travelling" ? Number(pickedSheetCount) : currentProgress?.pickedSheetCount ?? null,
        events: [...(currentProgress?.events ?? []), { id: Date.now(), status: next.status, note: statusNote.trim() || null, photoPaths, pickedSheetCount: next.status === "travelling" ? Number(pickedSheetCount) : null, customerSignedName: null, customerSignaturePath: null, occurredAt }],
      }));
      retainStatusFilesAsEvidence();
      setStatusNote("");
      setProgressError(null);
      return;
    }
    setSaving(true); setProgressError(null);
    const uploadResults = await Promise.all(statusFiles.map(async (item, index) => {
      const file = item.file;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `work/${selected.appointmentId}/${next.status}/${Date.now()}-${index}-${safe}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      return { path, error };
    }));
    const paths = uploadResults.filter((result) => !result.error).map((result) => result.path);
    const failedCount = uploadResults.length - paths.length;
    if (failedCount > 0) {
      setSaving(false);
      setProgressError(`อัปโหลดรูปไม่สำเร็จ ${failedCount} จาก ${uploadResults.length} รูป (รูปที่อัปโหลดสำเร็จแล้ว ${paths.length} รูปถูกเก็บไว้ ไม่ต้องถ่ายซ้ำ กดบันทึกอีกครั้งเพื่อลองใหม่)`);
      return;
    }
    try {
      const { error } = await supabase.rpc("record_technician_work_status", {
        p_token: token, p_pin: pin.trim(), p_assignment_id: selected.assignmentId,
        p_status: next.status, p_photo_paths: paths,
        p_picked_sheet_count: next.status === "travelling" ? Number(pickedSheetCount) : null,
        p_note: statusNote.trim() || null,
      });
      if (error) throw error;
      clearStatusFiles(); setStatusNote("");
      await reloadProgress(selected.assignmentId);
    } catch (error) {
      // รูปที่อัปโหลดสำเร็จแล้วถูกเก็บไว้โดยตั้งใจ ไม่ลบทิ้ง เพราะการบังคับให้ช่างถ่ายรูปซ้ำกลางหน้างาน
      // เมื่อ RPC ล้มเหลวชั่วคราว เป็นการลงโทษช่างสำหรับความผิดพลาดที่ไม่ใช่ของช่าง
      setProgressError(workErrorMessage(error));
    }
    setSaving(false);
  }

  async function saveCustomerSignature(customerName: string, blob: Blob) {
    if (!selected?.assignmentId) return;
    if (demoMode) {
      const signaturePath = URL.createObjectURL(blob);
      setWorkProgress((current) => ({
        plannedSheetCount: current?.plannedSheetCount ?? 10, pickedSheetCount: current?.pickedSheetCount ?? null,
        events: [...(current?.events ?? []), { id: Date.now(), status: "customer_signed", note: "ลูกค้าอ่านและยอมรับข้อกำหนด", photoPaths: [signaturePath], pickedSheetCount: null, customerSignedName: customerName, customerSignaturePath: signaturePath, occurredAt: new Date().toISOString() }],
      }));
      return;
    }
    setSaving(true); setProgressError(null);
    try {
      const path = `work/${selected.appointmentId}/signature/${Date.now()}-customer.png`;
      const { error: uploadError } = await supabase.storage.from("job-photos").upload(path, blob, { upsert: false, contentType: "image/png" });
      if (uploadError) throw uploadError;
      const { error } = await supabase.rpc("record_technician_customer_signature", { p_token: token, p_pin: pin.trim(), p_assignment_id: selected.assignmentId, p_customer_name: customerName, p_signature_path: path });
      if (error) throw error;
      await reloadProgress(selected.assignmentId);
    } catch (error) {
      setProgressError(floorActionError("บันทึกลายเซ็นลูกค้า", error));
    }
    setSaving(false);
  }

  async function saveWarehouseReturn() {
    if (!selected?.assignmentId) return;
    if (!statusFiles.length) { setProgressError("กรุณาแนบภาพยืนยันการนำสินค้า/เศษกลับคลังอย่างน้อย 1 รูป"); return; }
    if (demoMode) {
      const photoPaths = statusFiles.map((item) => item.url);
      setWorkProgress((current) => ({
        plannedSheetCount: current?.plannedSheetCount ?? 10, pickedSheetCount: current?.pickedSheetCount ?? null,
        events: [...(current?.events ?? []), { id: Date.now(), status: "warehouse_returned", note: "นำสินค้า/เศษกลับถึงคลังแล้ว", photoPaths, pickedSheetCount: null, customerSignedName: null, customerSignaturePath: null, occurredAt: new Date().toISOString() }],
      }));
      retainStatusFilesAsEvidence();
      setProgressError(null);
      return;
    }
    setSaving(true); setProgressError(null);
    const paths: string[] = [];
    try {
      for (let index = 0; index < statusFiles.length; index++) {
        const file = statusFiles[index].file;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `work/${selected.appointmentId}/warehouse-return/${Date.now()}-${index}-${safeName}`;
        const { error } = await supabase.storage.from("job-photos").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
        if (error) throw error;
        paths.push(path);
      }
      const { error } = await supabase.rpc("record_technician_warehouse_return", { p_token: token, p_pin: pin.trim(), p_assignment_id: selected.assignmentId, p_photo_paths: paths, p_note: statusNote.trim() || null });
      if (error) throw error;
      clearStatusFiles(); setStatusNote("");
      await reloadProgress(selected.assignmentId);
    } catch (error) {
      if (paths.length) await supabase.storage.from("job-photos").remove(paths);
      setProgressError(floorActionError("บันทึกการนำสินค้ากลับคลัง", error));
    }
    setSaving(false);
  }

  async function unlock() {
    setLoading(true);
    setAuthError(null);
    const ok = await load(pin);
    if (!ok) {
      // RPC (get_technician_workspace) ไม่ส่ง error กลับมาแยกกรณี "PIN ผิด" กับ
      // "ยังไม่ได้ตั้ง PIN" — ทั้งสองกรณีได้ผลลัพธ์เหมือนกันทุกประการจากฝั่ง client
      // จึงยังต้องใช้ข้อความเดียว แต่ทำให้สั่งการได้ชัดเจนว่าต้องทำอะไรต่อ
      setAuthError("PIN ไม่ถูกต้อง หรือยังไม่ได้ตั้ง PIN — ลองพิมพ์ใหม่อีกครั้ง หากยังไม่สำเร็จให้แจ้งหัวหน้าช่างตั้ง PIN ให้ลิงก์นี้ใหม่");
      setLoading(false);
    }
  }

  if (loading || linkRedirect === undefined) return <main className="grid min-h-screen place-items-center bg-slate-50 p-4"><div className="w-full max-w-3xl"><LendiSkeleton label="กำลังโหลดตารางงานและสถานะใบงาน…" cards={3} compact /></div></main>;
  if (linkRedirect) return <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
    <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
      <div className="text-3xl">🔗</div>
      <h1 className="mt-3 text-xl font-semibold text-slate-900">ลิงก์นี้ถูกแทนที่แล้ว</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">เพื่อให้ได้รับตารางงานล่าสุด กรุณาใช้ลิงก์ใหม่จากหัวหน้าช่าง พร้อม PIN ล่าสุด</p>
      <a href={`/work/${linkRedirect.newToken}`} className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700">ไปที่ลิงก์ใหม่</a>
    </div>
  </main>;
  if (!workspace) return <main className="min-h-screen bg-slate-950 px-4 py-10 grid place-items-center">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">LENDI Engineering</div>
      <div className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">FloorNow · หน้างานของฉัน</div>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">ใส่ PIN เพื่อเปิดตารางงาน</h1>
      <p className="mt-1 text-sm text-slate-500">ใช้รหัสจากหัวหน้าช่างร่วมกับลิงก์ประจำตัวนี้</p>
      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">PIN 4-6 หลัก</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500"
          />
        </div>
        {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
        <button
          onClick={() => void unlock()}
          disabled={!pin.trim()}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
        >
          เปิดตารางงาน
        </button>
      </div>
    </div>
  </main>;

  return <main className="min-h-screen bg-slate-50 pb-12">
    <header className="bg-slate-950 text-white px-4 py-5">
      <div className="max-w-4xl mx-auto"><div className="text-xs text-slate-400">LENDI Engineering · หน้างานของฉัน</div><h1 className="text-xl font-semibold mt-1">{workspace.technician.name}</h1><div className="text-sm text-slate-300">{workspace.technician.teamName ?? "ไม่ระบุทีม"}{workspace.technician.isTeamLead ? " · หัวหน้าทีม" : ""}</div>{demoMode ? <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">🧪 โหมดข้อมูลจำลองบน local — ปุ่มบันทึกจะไม่เชื่อมกับงานจริง</div> : <TechnicianPushButton token={token} pin={pin} />}</div>
    </header>
    <div className="max-w-4xl mx-auto px-4 py-5">
      <div className="flex items-end justify-between mb-4"><div><h2 className="font-semibold text-slate-900">ตารางงานของฉัน</h2><p className="text-xs text-slate-500">กดงานเพื่อเปิดรายละเอียดและบันทึกการเปิดใบงาน</p></div><span className="text-xs text-slate-500">{upcoming.length} งาน</span></div>
      <div className="space-y-5">
        {grouped.map(([day, jobs]) => <section key={day}>
          <div className="text-sm font-medium text-slate-700 mb-2">{thaiDate(jobs[0].slotStart)}{day === dateKey(new Date().toISOString()) ? <span className="ml-2 text-xs text-blue-600">วันนี้</span> : null}</div>
          <div className="space-y-2">{jobs.map((a) => <button key={a.assignmentId ?? `team-${a.appointmentId}`} onClick={() => openWork(a)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300">
            <div className="flex gap-3"><div className="font-semibold text-blue-700 shrink-0">{time(a.slotStart)}–{time(a.slotEnd)}</div><div className="flex-1 min-w-0"><div className="font-medium truncate">{a.customerName ?? a.jobNo ?? "งานติดตั้ง"}</div><div className="text-xs text-slate-500 truncate">{a.productName ?? a.requirement ?? "ยังไม่ระบุสเปก"}</div></div></div>
            <div className="mt-2 flex gap-1.5 flex-wrap"><span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">{a.teamName ?? "ทีมช่าง"}</span>{a.isTeamQueue ? <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">คิวทีม · รอหัวหน้าจ่ายรายบุคคล</span> : null}{a.isLead ? <span className="text-[11px] px-2 py-0.5 rounded bg-violet-100 text-violet-700">ผู้รับผิดชอบหลัก</span> : null}<span className={`text-[11px] px-2 py-0.5 rounded ${a.acknowledgedAt ? "bg-emerald-100 text-emerald-700" : a.firstOpenedAt ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{a.acknowledgedAt ? "รับทราบแล้ว" : a.firstOpenedAt ? "เปิดแล้ว" : a.isTeamQueue ? "รอจ่ายงาน" : "ยังไม่เปิด"}</span></div>
          </button>)}</div>
        </section>)}
        {!grouped.length ? <div className="bg-white border rounded-xl p-8 text-center text-slate-400">ยังไม่มีงานที่ได้รับมอบหมาย</div> : null}
      </div>
    </div>

    {selected ? <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelected(null)}>
      <div className="bg-slate-50 w-full sm:max-w-4xl max-h-[96vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-blue-600">FloorNow · ใบสั่งงานกลาง</div>
              <h2 className="mt-1 truncate text-xl font-semibold text-slate-950">{selected.customerName ?? selected.jobNo ?? "งานติดตั้ง"}</h2>
              <div className="mt-1 text-sm text-slate-500">
                งาน #{selected.jobNo ?? "—"} · {thaiDate(selected.slotStart)} · {time(selected.slotStart)}–{time(selected.slotEnd)} น.
              </div>
            </div>
            <button onClick={() => setSelected(null)} aria-label="ปิด" className="rounded-full p-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">×</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">ฝ่ายขาย: กรอกข้อมูล</span>
            <span className="rounded-full border border-blue-200 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">หัวหน้าช่าง: ตรวจ/จ่ายงาน</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">ทีมช่าง: รับทราบ/อัปเดต</span>
            <span className={`ml-auto rounded-full px-3 py-1.5 text-xs font-medium ${selected.isTeamQueue ? "bg-amber-100 text-amber-700" : selected.acknowledgedAt ? "bg-emerald-100 text-emerald-700" : selected.firstOpenedAt ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
              {selected.isTeamQueue ? "คิวทีม · รอหัวหน้าจ่ายรายบุคคล" : selected.acknowledgedAt ? "รับทราบแล้ว" : selected.firstOpenedAt ? "เปิดใบงานแล้ว" : "ยังไม่รับทราบ"}
            </span>
            {selected.jobNo?.toUpperCase().startsWith("TEST-") ? <span className="rounded-full bg-fuchsia-100 px-3 py-1.5 text-xs font-semibold text-fuchsia-700">โหมดทดสอบ · เริ่มก่อนวันนัดได้</span> : null}
          </div>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[1.2fr_0.8fr] md:p-5">
          <WorkSection title="📍 ข้อมูลงานที่ฝ่ายขายยืนยันแล้ว" subtitle="ข้อมูลหลักที่ช่างต้องใช้ก่อนออกงาน">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ลูกค้า">{selected.customerName}</Field>
              <Field label="เบอร์โทร">{selected.customerPhone ? <a href={`tel:${selected.customerPhone}`} className="text-blue-600 hover:underline">{selected.customerPhone}</a> : "—"}</Field>
              <Field label="สินค้า / สเปก">{selected.productName ?? selected.requirement}</Field>
              <Field label="เลขบิล / แหล่งที่มา">{[selected.billNo, selected.source === "bbps" ? "งาน BBPS" : selected.source].filter(Boolean).join(" · ")}</Field>
              <div className="sm:col-span-2"><Field label="ที่อยู่หน้างาน">{selected.address}</Field></div>
              {selected.locationUrl ? <div className="sm:col-span-2"><a href={selected.locationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">📍 เปิด Google Maps</a></div> : null}
              {selected.notes ? <div className="sm:col-span-2"><Field label="หมายเหตุคิว / หัวหน้าช่าง">{selected.notes}</Field></div> : null}
            </div>
          </WorkSection>

          <WorkSection title="👥 ผู้รับผิดชอบ" subtitle="หลักฐานเปิดใบงานและรับทราบงาน">
            <div className="space-y-2">
              {(responsibles.length ? responsibles : selected.isTeamQueue ? [] : [{
                id: selected.assignmentId,
                is_lead: selected.isLead,
                first_opened_at: selected.firstOpenedAt,
                acknowledged_at: selected.acknowledgedAt,
                technician: { name: workspace.technician.name, phone: workspace.technician.phone, is_team_lead: workspace.technician.isTeamLead },
              }]).map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">{(r.technician?.name ?? "ช").slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{r.technician?.name ?? "ไม่ระบุชื่อ"}{r.is_lead ? " · ผู้รับผิดชอบหลัก" : ""}</div>
                    <div className="text-xs text-slate-500">{r.technician?.is_team_lead ? "หัวหน้าทีม" : "ช่างติดตั้ง"}{r.technician?.phone ? ` · ${r.technician.phone}` : ""}</div>
                  </div>
                  <div className={`rounded-lg px-2 py-1 text-xs ${r.acknowledged_at ? "bg-emerald-100 text-emerald-700" : r.first_opened_at ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                    {r.acknowledged_at ? "รับทราบ" : r.first_opened_at ? "เปิดแล้ว" : "ยังไม่เปิด"}
                  </div>
                </div>
              ))}
            </div>
          </WorkSection>

          <div className="space-y-4">
            <PickPlanDetails value={selected.pickPlan} />
            {selected.jobNo && <TicketChat jobNo={selected.jobNo} viewer="technician" viewerName={`${selected.isLead ? "หัวหน้าช่าง" : "ช่าง"} · ${workspace.technician.name}`} technicianToken={token} technicianPin={pin.trim()} />}
            {(() => {
              const survey = parseJsonObject(detailJob?.survey_data ?? selected.surveyData);
              const photos = Array.isArray(survey?.photos) ? survey.photos.map(textOf).filter(Boolean) : [];
              if (!survey && !photos.length) return null;
              return <WorkSection title="🖼 ภาพหน้างานและข้อมูลที่ฝ่ายขายกรอก">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="พื้นที่ติดตั้ง">{textOf(survey?.areaSqm) ? `${textOf(survey?.areaSqm)} ตร.ม.` : "—"}</Field>
                  <Field label="สภาพพื้น">{textOf(survey?.floorCondition) || "—"}</Field>
                  <div className="sm:col-span-2"><Field label="หมายเหตุสำรวจ">{textOf(survey?.notes) || "—"}</Field></div>
                </div>
                {photos.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((path, index) => {
                    const url = path.startsWith("http") ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl;
                    return <a key={path} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`ภาพหน้างาน ${index + 1}`} className="h-full w-full object-cover" />
                    </a>;
                  })}
                </div> : null}
              </WorkSection>;
            })()}
            {selected.source === "bbps" ? <BbpsWorkOrderDetails rawPayload={detailJob?.raw_payload} /> : null}
            {centralWorkOrder ? <WorkSection title="📦 ใบสั่งงานที่คลังเตรียมให้" subtitle={`Revision ${centralWorkOrder.revision} · ${centralWorkOrder.warehouseAssignee ? `ผู้เตรียม ${centralWorkOrder.warehouseAssignee}` : "ยังไม่มีผู้รับงานคลัง"}`}>
              <div className="mb-3 rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">สถานะ: {{ head_review: "รอหัวหน้าช่างตรวจ", returned_sales: "ส่งกลับฝ่ายขาย", warehouse_waiting: "รอคลังรับงาน", warehouse_preparing: "กำลังเตรียมสินค้า", ready_to_install: "รอติดตั้ง", installing: "กำลังติดตั้ง", waiting_cs: "รอ CS โทรประเมิน", closed: "ปิดงานแล้ว", cancelled: "ยกเลิก" }[centralWorkOrder.status] ?? centralWorkOrder.status}</div>
              <div className="space-y-2">{centralWorkOrder.items.map((item) => isFreeformWorkNote(item) ? <div key={item.id} className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm"><div className="font-semibold text-violet-950">📝 โน้ต Freeform จากหัวหน้าช่าง</div><div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-violet-900">{item.note || "—"}</div></div> : <div key={item.id} className="rounded-xl border border-slate-200 p-3 text-sm"><div className="font-medium text-slate-900">{item.itemName}{item.sku ? ` · ${item.sku}` : ""}</div><div className="mt-1 text-xs text-slate-500">{item.specification || "ไม่ระบุสเปก"} · ตามแผน {item.plannedQty} {item.unit} · หยิบจริง {item.actualQty ?? "—"} {item.unit}</div>{item.note ? <div className="mt-1 text-xs text-amber-700">{item.note}</div> : null}</div>)}</div>
              {centralWorkOrder.note ? <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">หมายเหตุ: {centralWorkOrder.note}</div> : null}
            </WorkSection> : null}
            {/* P3-6: ช่างยืนยันของที่มาถึงจริงทีละบรรทัด และแจ้ง "ได้ไม่ครบ + เหตุผล"
                วางไว้ต่อจากใบสั่งงานที่คลังเตรียมให้โดยตั้งใจ — ช่างอ่านว่าคลังบอกอะไร แล้วตอบทันทีในหน้าจอเดียวกัน
                คิวทีมยังไม่มีใบมอบหมายรายบุคคล จึงเรียก RPC (ที่ผูกด่านกับใบมอบหมาย) ไม่ได้ และเราไม่ลดด่านลง */}
            {selected.assignmentId && !selected.isTeamQueue ? <WorkSection
              title="📦 ตรวจรับของที่มาถึงหน้างาน"
              subtitle="ยืนยันทีละรายการ — ถ้าได้ไม่ครบให้บอกเหตุผล แล้วระบบจะเปิดเรื่องให้เอง ไม่ต้องโทรแจ้งซ้ำ"
            >
              <TechnicianReceiptConfirmation token={token} pin={pin.trim()} assignmentId={selected.assignmentId} demoMode={demoMode} />
            </WorkSection> : null}
            {/* P4-1: ปิดยอดของหลังติดตั้ง — ใช้ไปเท่าไหร่ เอากลับมาคืนเท่าไหร่ และเครื่องมือกลับครบไหม
                วางไว้ต่อจากการตรวจรับโดยตั้งใจ: ช่างตรวจรับตอนของมาถึง แล้วปิดยอดตอนงานจบ เป็นลำดับเดียวกับที่ทำจริงหน้างาน
                ทุกตัวเลขที่บันทึกจะไปโผล่ใน stock_movements ของงานนี้ทันที และเครื่องมือที่ยังไม่คืนจะขึ้นในรายการของคลัง */}
            {selected.assignmentId && !selected.isTeamQueue ? <WorkSection
              title="🧾 ปิดยอดของหลังติดตั้ง"
              subtitle="ใช้ไปเท่าไหร่ · เอากลับมาคืนเท่าไหร่ — เครื่องมือที่ยังไม่คืนคลังจะเห็นว่ายังอยู่กับทีม"
            >
              <TechnicianUsageReturn token={token} pin={pin.trim()} assignmentId={selected.assignmentId} demoMode={demoMode} />
            </WorkSection> : null}
          </div>

          <div className="space-y-4">
            <WorkSection title="✅ ตรวจรับและปิดงาน" subtitle="เกณฑ์ที่ต้องเคลียร์ก่อนส่งมอบ">
              <div className="space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.acknowledgedAt)} /> ทีมช่างรับทราบงานแล้ว</label>
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.locationUrl || selected.address)} /> มีพิกัด/ที่อยู่สำหรับเดินทาง</label>
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(selected.productName || selected.requirement)} /> มีสเปกงานติดตั้ง</label>
                <label className="flex items-center gap-2"><input type="checkbox" readOnly checked={Boolean(centralWorkOrder?.items.length || selected.pickPlan)} /> มีใบสั่งงานและรายการวัสดุ/อุปกรณ์</label>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${checklist.origin === "template" ? "border-blue-200 bg-blue-50 text-blue-900" : checklist.origin === "loading" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                  <div className="font-semibold">{checklistProvenanceLabel(checklist)}</div>
                  <p className="mt-0.5">
                    {checklist.origin === "loading"
                      ? "ยังไม่แสดงรายการจนกว่าจะรู้ว่าเกณฑ์รุ่นไหนใช้อยู่ — กันไม่ให้อ่านเกณฑ์รุ่นเก่าโดยไม่รู้ตัว"
                      : checklist.origin === "template"
                      ? `${checklist.items.length} ข้อ ตามเกณฑ์รุ่นที่หัวหน้าช่างเปิดใช้งานอยู่`
                      : `กำลังแสดงชุดสำรองในโปรแกรม (${checklist.items.length} ข้อ) ยังไม่ใช่รุ่นล่าสุดที่หัวหน้าช่างแก้ · สาเหตุ: ${checklist.fallbackReason ?? "ไม่ทราบสาเหตุ"}`}
                  </p>
                </div>
                {checklist.origin === "loading" ? <div className="mt-3 space-y-2" aria-busy="true">
                  {[0, 1, 2].map((row) => <div key={row} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}
                </div> : null}
                <ul className="mt-3 space-y-2">
                  {checklist.items.map((item, index) => <li key={item.code} className="rounded-xl border border-slate-200 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{item.code}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900">{index + 1}. {item.label}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {item.spec ? `เกณฑ์: ${item.spec}` : "ไม่ได้ระบุค่าเกณฑ์"}
                          {item.measuringDeviceKind ? ` · เครื่องมือ: ${item.measuringDeviceKind}` : ""}
                          {item.requiresPhoto ? " · ต้องมีรูป" : ""}
                        </div>
                      </div>
                    </div>
                  </li>)}
                </ul>
                <p className="mt-3 text-xs text-slate-500">หน้านี้แสดงเกณฑ์ให้ตรวจหน้างาน ส่วนการบันทึกผลผ่าน/ไม่ผ่านทำที่หน้าออฟฟิศ (แท็บ “ตรวจรับ” ในรายละเอียดงาน)</p>
              </div>
            </WorkSection>

            <WorkSection title="📸 อัปเดตหน้างานวันนี้" subtitle="ทุกสถานะต้องมีรูปและบันทึกเวลาอัตโนมัติ">
              {selected.isTeamQueue ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">หัวหน้าช่างต้องจ่ายงานให้คุณก่อน จึงจะอัปเดตสถานะได้</div> : (() => {
                const events = workProgress?.events ?? [];
                const coreEvents = events.filter((event) => !["customer_signed", "warehouse_returned"].includes(event.status));
                const currentStatus = coreEvents.at(-1)?.status;
                const currentIndex = WORK_STEPS.findIndex((step) => step.status === currentStatus);
                const next = WORK_STEPS[currentIndex + 1];
                const signed = events.find((event) => event.status === "customer_signed");
                const warehouseReturned = events.find((event) => event.status === "warehouse_returned");
                const remnantReady = remnantReport?.status === "pending_review" || remnantReport?.status === "accepted";
                const workReady = !centralWorkOrder || centralWorkOrder.status === "ready_to_install" || centralWorkOrder.status === "installing";
                const canStart = currentStatus || !centralWorkOrder || (centralWorkOrder.status === "ready_to_install" && centralWorkOrder.isLead);
                const headPlannedSheetCount = workProgress?.plannedSheetCount ?? totalSheetQuantity(centralWorkOrder, "plannedQty");
                const warehousePreparedSheetCount = totalSheetQuantity(centralWorkOrder, "actualQty");
                const technicianPickedSheetCount = pickedSheetCount.trim() ? Number(pickedSheetCount) : null;
                return <div className="space-y-4">
                  <div className="space-y-2">{WORK_STEPS.map((step, index) => {
                    const stepEvents = events.filter((item) => item.status === step.status);
                    const event = stepEvents.at(-1);
                    return <div key={step.status} className={`rounded-xl border px-3 py-3 ${event ? "border-emerald-200 bg-emerald-50" : index === currentIndex + 1 ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex items-center justify-between gap-3"><div className="text-sm font-medium text-slate-800">{index + 1}. {step.label}</div><div className={`text-xs ${event ? "text-emerald-700" : "text-slate-400"}`}>{event ? new Date(event.occurredAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "รอดำเนินการ"}</div></div>
                      {stepEvents.map((history, historyIndex) => <div key={history.id} className={historyIndex ? "mt-3 border-t border-emerald-200 pt-3" : ""}>
                        {stepEvents.length > 1 ? <div className="text-[11px] font-medium text-emerald-700">อัปเดตครั้งที่ {historyIndex + 1} · {new Date(history.occurredAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น.</div> : null}
                        {history.note ? <div className="mt-2 text-xs text-slate-600">{history.note}</div> : null}
                        <EvidenceGallery paths={history.photoPaths ?? []} label={step.label} supabase={supabase} />
                      </div>)}
                    </div>;
                  })}</div>

                  {next && selected.acknowledgedAt && workReady && canStart ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <div className="text-sm font-semibold text-blue-950">ขั้นต่อไป: {next.status === "travelling" && centralWorkOrder ? "รับงานติดตั้งและเริ่มเดินทาง" : next.label}</div>
                    {next.status === "travelling" ? <div className="mt-3"><label className="text-xs font-medium text-blue-800">จำนวนแผ่นที่หยิบจริง *</label><div className="mt-2 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-2"><div className="text-[10px] text-violet-700">หัวหน้าช่างแจ้ง</div><div className="mt-0.5 text-sm font-semibold text-violet-950">{headPlannedSheetCount ?? "—"} <span className="text-[10px] font-normal">แผ่น</span></div></div><div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2"><div className="text-[10px] text-emerald-700">คลังเตรียม/จ่าย</div><div className="mt-0.5 text-sm font-semibold text-emerald-950">{warehousePreparedSheetCount ?? "—"} <span className="text-[10px] font-normal">แผ่น</span></div></div><div className={`rounded-lg border px-2 py-2 ${technicianPickedSheetCount == null ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50"}`}><div className="text-[10px] text-blue-700">ช่างหยิบจริง</div><div className="mt-0.5 text-sm font-semibold text-blue-950">{technicianPickedSheetCount ?? "—"} <span className="text-[10px] font-normal">แผ่น</span></div></div></div><div className="mt-2 flex items-center gap-2"><input type="number" min={0} step={1} value={pickedSheetCount} onChange={(event) => setPickedSheetCount(event.target.value)} placeholder="กรอกจำนวนที่หยิบจริง" className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" /><span className="text-xs text-blue-700">แผ่น</span></div><div className={`mt-2 text-xs ${technicianPickedSheetCount != null && warehousePreparedSheetCount != null && technicianPickedSheetCount !== warehousePreparedSheetCount ? "text-amber-700" : "text-slate-500"}`}>{technicianPickedSheetCount != null && warehousePreparedSheetCount != null && technicianPickedSheetCount !== warehousePreparedSheetCount ? `จำนวนต่างจากที่คลังจ่าย ${Math.abs(technicianPickedSheetCount - warehousePreparedSheetCount)} แผ่น — กรุณาระบุเหตุผล` : "ใช้ตรวจสอบก่อนเริ่มเดินทาง หากจำนวนต่างกัน ให้บันทึกเหตุผลในหมายเหตุ"}</div></div> : null}
                    <textarea value={statusNote} onChange={(event) => setStatusNote(event.target.value)} rows={2} placeholder="หมายเหตุ (ถ้ามี)" className="mt-3 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
                    <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-blue-300 bg-white px-3 py-3 text-center text-sm font-medium text-blue-700">📷 ถ่ายรูป / เพิ่มรูป<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => { addStatusFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
                    {statusFiles.length ? <div className="mt-3"><div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold text-blue-800">ภาพที่เลือก ({statusFiles.length})</div><button type="button" onClick={clearStatusFiles} className="text-xs font-medium text-red-500">ล้างทั้งหมด</button></div><div className="grid grid-cols-3 gap-2">{statusFiles.map((item, index) => <div key={item.id} className="relative aspect-square overflow-hidden rounded-xl border border-blue-200 bg-white"><img src={item.url} alt={`ภาพสถานะ ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => removeStatusFile(item.id)} aria-label={`ลบภาพ ${index + 1}`} className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">ลบ</button><span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">{index + 1}</span></div>)}</div></div> : <div className="mt-2 text-xs text-blue-600">ยังไม่ได้เลือกรูป</div>}
                    <button onClick={() => void updateWorkStatus()} disabled={saving} className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลังบันทึก…" : next.status === "travelling" && centralWorkOrder ? "รับงานติดตั้ง" : next.button}</button>
                  </div> : null}
                  {next && selected.acknowledgedAt && !workReady ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">ยังเริ่มงานไม่ได้: ใบสั่งงานอยู่สถานะ {{ head_review: "รอหัวหน้าช่างตรวจ", warehouse_waiting: "รอคลังรับงาน", warehouse_preparing: "กำลังเตรียมสินค้า" }[centralWorkOrder?.status ?? ""] ?? centralWorkOrder?.status}</div> : null}
                  {next && selected.acknowledgedAt && workReady && !canStart ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">หัวหน้าทีมที่ได้รับมอบหมายต้องกด “รับงานติดตั้ง” ก่อน</div> : null}
                  {next && !selected.acknowledgedAt ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">กดรับทราบงานก่อนเริ่มอัปเดตสถานะ</div> : null}
                  {currentStatus === "completed" && !signed && selected.isLead ? <div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="mb-3"><div className="text-sm font-semibold text-violet-950">5. ลูกค้าอ่านข้อกำหนดและเซ็นรับงาน</div><div className="mt-0.5 text-xs text-violet-700">ให้ลูกค้าอ่าน กดยอมรับข้อกำหนด แล้วลงลายเซ็น</div></div><CustomerSignature busy={saving} onSubmit={saveCustomerSignature} /></div> : null}
                  {currentStatus === "completed" && !signed && !selected.isLead ? <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-700">รอหัวหน้าทีมให้ลูกค้าอ่านข้อกำหนดและเซ็นรับงาน</div> : null}
                  {signed ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">✓ ลูกค้า {signed.customerSignedName} ยอมรับข้อกำหนดและเซ็นรับงานแล้ว เวลา {new Date(signed.occurredAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}</div> : null}
                  {signed && !remnantReady && selected.isLead ? <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3"><div className="mb-3"><div className="text-sm font-semibold text-amber-950">6. รับเศษกลับคลัง</div><div className="mt-0.5 text-xs text-amber-700">บันทึกวัสดุที่ใช้และเศษที่เหลือ เพื่อส่งให้คลังตรวจรับ</div></div><RemnantReportForm token={token} pin={pin.trim()} assignmentId={selected.assignmentId!} appointmentId={selected.appointmentId} initial={remnantReport} suggestedMaterials={suggestedRemnantMaterials} onSaved={setRemnantReport} demoMode={demoMode} /></div> : null}
                  {signed && remnantReady && !warehouseReturned && selected.isLead ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><div className="text-sm font-semibold text-sky-950">7. ภาพยืนยันนำสินค้า/เศษกลับคลัง</div><div className="mt-0.5 text-xs text-sky-700">แนบได้หลายรูป และต้องมีอย่างน้อย 1 รูปก่อนยืนยัน</div><label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-sky-300 bg-white px-3 py-3 text-center text-sm font-medium text-sky-700">📷 ถ่ายรูป / เพิ่มรูป<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => { addStatusFiles(event.target.files); event.currentTarget.value = ""; }} /></label>{statusFiles.length ? <div className="mt-3 grid grid-cols-3 gap-2">{statusFiles.map((item, index) => <div key={item.id} className="relative aspect-square overflow-hidden rounded-xl border border-sky-200 bg-white"><img src={item.url} alt={`ภาพกลับคลัง ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => removeStatusFile(item.id)} className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">ลบ</button></div>)}</div> : null}<textarea value={statusNote} onChange={(event) => setStatusNote(event.target.value)} rows={2} placeholder="หมายเหตุถึงคลัง (ถ้ามี)" className="mt-3 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" /><button type="button" onClick={() => void saveWarehouseReturn()} disabled={saving} className="mt-3 w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "กำลังบันทึก…" : "ยืนยันนำกลับถึงคลัง"}</button></div> : null}
                  {warehouseReturned ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800"><div className="font-semibold">✓ ยืนยันนำสินค้า/เศษกลับถึงคลังแล้ว</div><EvidenceGallery paths={warehouseReturned.photoPaths ?? []} label="นำกลับคลัง" supabase={supabase} /></div> : null}
                  {progressError ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{progressError}</div> : null}
                </div>;
              })()}
            </WorkSection>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4">
          <button onClick={acknowledge} disabled={saving || Boolean(selected.acknowledgedAt) || Boolean(selected.isTeamQueue)} className="w-full rounded-xl bg-emerald-600 py-3 font-medium text-white disabled:bg-emerald-100 disabled:text-emerald-700">
            {selected.isTeamQueue ? "รอหัวหน้าช่างจ่ายงานรายบุคคล" : selected.acknowledgedAt ? "✓ รับทราบงานแล้ว" : saving ? "กำลังบันทึก…" : "รับทราบงาน"}
          </button>
        </div>
      </div>
    </div> : null}
  </main>;
}

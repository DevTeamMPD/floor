"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { Badge } from "@/components/ui/badge";
import type { StaffRole } from "@/lib/staff";

type TaskField = "ball_pit" | "workshop_set" | "gym" | "floor" | "other";
type TemplateStatus = "draft" | "active" | "retired";
type ItemKind = "consumable" | "tool";
type CalcMode = "fixed" | "per_sqm" | "per_unit";
type TemplateKind = "checklist" | "prep";

interface JobType {
  id: string;
  code: string;
  name: string;
  task_field: TaskField | null;
  is_active: boolean;
  sort_order: number;
}

interface TemplateRow {
  id: string;
  job_type_id: string;
  version: number;
  status: TemplateStatus;
  notes: string | null;
  effective_from: string | null;
  created_at: string;
}

interface ChecklistItemRow {
  id: string;
  code: string;
  label: string;
  spec_text: string | null;
  requires_photo: boolean;
  is_critical: boolean;
  measuring_device_kind: string | null;
  sort_order: number;
  is_active: boolean;
}

interface ChecklistItemDraft {
  key: string;
  // code เป็นตัวระบุที่ต้องคงที่ข้ามเวลา/เวอร์ชัน — ผูกกับ job_acceptance_results.item_code
  // ตอนช่างติ๊กผลตรวจรับ (ใช้หาสถิติ "เกณฑ์ข้อไหนตกบ่อยที่สุด" ตาม ISO 9.1.3)
  // undefined = ข้อที่ยังไม่เคยบันทึกลง DB (สร้างใหม่ในฟอร์ม) ต้อง generate ตอนบันทึก
  code?: string;
  label: string;
  spec_text: string;
  requires_photo: boolean;
  is_critical: boolean;
  measuring_device_kind: string;
  is_active: boolean;
}

interface PrepItemRow {
  id: string;
  material_id: string | null;
  item_name: string;
  unit: string | null;
  item_kind: ItemKind;
  calc_mode: CalcMode;
  calc_qty: number;
  waste_pct: number;
  is_required: boolean;
  note: string | null;
  sort_order: number;
}

interface PrepItemDraft {
  key: string;
  material_id: string;
  item_name: string;
  unit: string;
  item_kind: ItemKind;
  calc_mode: CalcMode;
  calc_qty: string;
  waste_pct: string;
  is_required: boolean;
  note: string;
}

interface Material { id: string; sku: string; name: string; unit: string | null }

interface RevisionRow {
  id: string;
  template_kind: TemplateKind;
  template_id: string;
  version: number;
  action: string;
  changed_at: string;
  note: string | null;
  diff: { item_count?: number } | null;
  staff: { full_name: string } | null;
}

interface JobTypeFormState { id: string | null; code: string; name: string; task_field: TaskField | ""; is_active: boolean }
const EMPTY_JOB_TYPE_FORM: JobTypeFormState = { id: null, code: "", name: "", task_field: "", is_active: true };

interface CopyDialogState { kind: TemplateKind; sourceTemplateId: string; sourceLabel: string; targetJobTypeId: string }

const TASK_FIELD_LABELS: Record<TaskField, string> = {
  ball_pit: "บ่อบอล",
  workshop_set: "ชุดเวิร์คช็อป",
  gym: "ฟิตเนส/โรงยิม",
  floor: "พื้น",
  other: "อื่นๆ",
};
const TASK_FIELD_OPTIONS = (Object.entries(TASK_FIELD_LABELS) as [TaskField, string][]);

const STATUS_LABELS: Record<TemplateStatus, string> = { draft: "ร่าง", active: "ใช้งานอยู่", retired: "ปลดระวางแล้ว" };

const ITEM_KIND_LABELS: Record<ItemKind, string> = { consumable: "วัสดุสิ้นเปลือง", tool: "เครื่องมือ (ต้องคืน)" };
const CALC_MODE_LABELS: Record<CalcMode, string> = { fixed: "จำนวนคงที่", per_sqm: "ต่อ ตร.ม.", per_unit: "ต่อชิ้นงาน" };

const ACTION_LABELS: Record<string, string> = {
  create: "สร้างแม่แบบใหม่",
  update: "แก้ไขฉบับร่าง",
  new_version: "สร้างฉบับร่างใหม่ (แก้จากที่ใช้งานอยู่)",
  activate: "เปิดใช้งาน",
  copy: "คัดลอกจากแม่แบบอื่น",
};

const FORK_NOTICE = "เวอร์ชันนี้กำลังใช้งานอยู่ — งานที่ตรวจรับไปแล้วยึดเกณฑ์รุ่นนี้เสมอ (ISO 7.5) ถ้ากดบันทึก ระบบจะสร้างฉบับร่างใหม่ให้อัตโนมัติ ไม่ทับของเดิม แล้วต้องกด “เปิดใช้งานเวอร์ชันนี้” อีกครั้งเพื่อให้ฉบับร่างมีผลจริง";
const FORK_SUCCESS = "บันทึกแล้ว — ระบบสร้างฉบับร่างใหม่ให้อัตโนมัติเพราะรุ่นเดิมกำลังใช้งานอยู่ กด “เปิดใช้งานเวอร์ชันนี้” เพื่อให้มีผลจริง";

const INPUT_CLS = "w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500";
const PRIMARY_BTN = "min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300";
const SECONDARY_BTN = "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const GHOST_BTN = "min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_TEXT_BTN = "min-h-11 rounded-lg px-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";
const ICON_BTN = "flex h-9 w-9 min-h-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function newChecklistDraft(): ChecklistItemDraft {
  return { key: crypto.randomUUID(), label: "", spec_text: "", requires_photo: false, is_critical: true, measuring_device_kind: "", is_active: true };
}
function checklistRowToDraft(row: ChecklistItemRow): ChecklistItemDraft {
  return { key: row.id, code: row.code, label: row.label, spec_text: row.spec_text ?? "", requires_photo: row.requires_photo, is_critical: row.is_critical, measuring_device_kind: row.measuring_device_kind ?? "", is_active: row.is_active };
}
function newPrepDraft(): PrepItemDraft {
  return { key: crypto.randomUUID(), material_id: "", item_name: "", unit: "", item_kind: "consumable", calc_mode: "fixed", calc_qty: "1", waste_pct: "0", is_required: true, note: "" };
}
function prepRowToDraft(row: PrepItemRow): PrepItemDraft {
  return { key: row.id, material_id: row.material_id ?? "", item_name: row.item_name, unit: row.unit ?? "", item_kind: row.item_kind, calc_mode: row.calc_mode, calc_qty: String(row.calc_qty), waste_pct: String(row.waste_pct), is_required: row.is_required, note: row.note ?? "" };
}
function moveByKey<T extends { key: string }>(items: T[], key: string, direction: -1 | 1): T[] {
  const idx = items.findIndex((item) => item.key === key);
  const target = idx + direction;
  if (idx < 0 || target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

// code ต้องคงที่ข้ามเวลา/เวอร์ชัน (ผูกกับ job_acceptance_results.item_code สำหรับสถิติ ISO 9.1.3)
// ข้อที่มี code อยู่แล้วจากฐานข้อมูล -> ใช้ค่าเดิมเสมอ ไม่ว่าจะถูกเลื่อนลำดับหรือย้ายตำแหน่งแค่ไหน
// ข้อใหม่ที่ยังไม่มี code -> เดินหน้าต่อจากเลขสูงสุดของ QCnn ที่ "เคยมีอยู่ในแม่แบบนี้" เท่านั้น
// ห้ามอิง sort_order/ตำแหน่งใน array เป็นที่มาของเลข เพราะจะวนกลับไปชนกับ code ของข้อที่เคยถูกลบไปแล้ว
function assignChecklistCodes(items: ChecklistItemDraft[]): string[] {
  let maxSeq = 0;
  for (const item of items) {
    const match = item.code ? /^QC(\d+)$/.exec(item.code) : null;
    if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
  }
  return items.map((item) => {
    if (item.code) return item.code;
    maxSeq += 1;
    return `QC${String(maxSeq).padStart(2, "0")}`;
  });
}

export default function JobTemplatesPage() {
  const supabase = useMemo(() => createClient(), []);

  const [role, setRole] = useState<StaffRole | null>(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const canEdit = roleChecked && (role === "admin" || role === "head_technician");

  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [loadingJobTypes, setLoadingJobTypes] = useState(true);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [savingJobTypeOrder, setSavingJobTypeOrder] = useState<string | null>(null);

  const [selectedJobTypeId, setSelectedJobTypeId] = useState<string | null>(null);
  const [tab, setTab] = useState<TemplateKind>("checklist");
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [clTemplates, setClTemplates] = useState<TemplateRow[]>([]);
  const [clSelectedId, setClSelectedId] = useState<string | null>(null);
  const [clEditMode, setClEditMode] = useState(false);
  const [clNotes, setClNotes] = useState("");
  const [clItems, setClItems] = useState<ChecklistItemDraft[]>([]);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [activatingChecklistId, setActivatingChecklistId] = useState<string | null>(null);

  const [prTemplates, setPrTemplates] = useState<TemplateRow[]>([]);
  const [prSelectedId, setPrSelectedId] = useState<string | null>(null);
  const [prEditMode, setPrEditMode] = useState(false);
  const [prNotes, setPrNotes] = useState("");
  const [prItems, setPrItems] = useState<PrepItemDraft[]>([]);
  const [savingPrep, setSavingPrep] = useState(false);
  const [activatingPrepId, setActivatingPrepId] = useState<string | null>(null);

  const [revisions, setRevisions] = useState<RevisionRow[]>([]);

  const [jobTypeForm, setJobTypeForm] = useState<JobTypeFormState | null>(null);
  const [savingJobType, setSavingJobType] = useState(false);

  const [copyDialog, setCopyDialog] = useState<CopyDialogState | null>(null);
  const [copying, setCopying] = useState(false);

  const jobTypesSorted = useMemo(
    () => [...jobTypes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "th")),
    [jobTypes]
  );
  const selectedJobType = useMemo(() => jobTypes.find((jt) => jt.id === selectedJobTypeId) ?? null, [jobTypes, selectedJobTypeId]);

  async function loadJobTypes() {
    setLoadingJobTypes(true);
    const { data, error } = await supabase.from("job_types").select("*").order("sort_order").order("name");
    setLoadingJobTypes(false);
    if (error) { toast.error(floorErrorMessage(error)); return [] as JobType[]; }
    const rows = (data ?? []) as JobType[];
    setJobTypes(rows);
    return rows;
  }

  async function loadMaterials() {
    const { data, error } = await supabase.from("materials").select("id,sku,name,unit").order("name");
    if (error) { toast.error(floorErrorMessage(error)); return; }
    setMaterials((data ?? []) as Material[]);
  }

  async function loadRole() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRole(null); setRoleChecked(true); return; }
    const { data } = await supabase.from("floor_staff_profiles").select("role").eq("id", user.id).maybeSingle();
    setRole((data?.role as StaffRole | undefined) ?? null);
    setRoleChecked(true);
  }

  useEffect(() => {
    void loadRole();
    void loadMaterials();
    (async () => {
      const rows = await loadJobTypes();
      if (rows.length) void selectJobType(rows[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectChecklistVersion(id: string | null, rows: TemplateRow[]) {
    setClSelectedId(id);
    setClEditMode(false);
    if (!id) { setClItems([]); setClNotes(""); return; }
    setClNotes(rows.find((t) => t.id === id)?.notes ?? "");
    const { data, error } = await supabase.from("job_checklist_template_items").select("*").eq("template_id", id).order("sort_order");
    if (error) { toast.error(floorErrorMessage(error)); return; }
    setClItems(((data ?? []) as ChecklistItemRow[]).map(checklistRowToDraft));
  }

  async function selectPrepVersion(id: string | null, rows: TemplateRow[]) {
    setPrSelectedId(id);
    setPrEditMode(false);
    if (!id) { setPrItems([]); setPrNotes(""); return; }
    setPrNotes(rows.find((t) => t.id === id)?.notes ?? "");
    const { data, error } = await supabase.from("job_prep_template_items").select("*").eq("template_id", id).order("sort_order");
    if (error) { toast.error(floorErrorMessage(error)); return; }
    setPrItems(((data ?? []) as PrepItemRow[]).map(prepRowToDraft));
  }

  async function loadTemplatesForJobType(jobTypeId: string, opts?: { selectTemplateId?: string; kind?: TemplateKind }) {
    setTemplatesLoading(true);
    const [clRes, prRes] = await Promise.all([
      supabase.from("job_checklist_templates").select("*").eq("job_type_id", jobTypeId).order("version", { ascending: false }),
      supabase.from("job_prep_templates").select("*").eq("job_type_id", jobTypeId).order("version", { ascending: false }),
    ]);
    if (clRes.error || prRes.error) {
      toast.error(floorErrorMessage(clRes.error ?? prRes.error));
      setTemplatesLoading(false);
      return;
    }
    const clRows = (clRes.data ?? []) as TemplateRow[];
    const prRows = (prRes.data ?? []) as TemplateRow[];
    setClTemplates(clRows);
    setPrTemplates(prRows);

    const clPick = (opts?.kind === "checklist" && opts.selectTemplateId) ? opts.selectTemplateId
      : clRows.find((t) => t.status === "active")?.id ?? clRows[0]?.id ?? null;
    const prPick = (opts?.kind === "prep" && opts.selectTemplateId) ? opts.selectTemplateId
      : prRows.find((t) => t.status === "active")?.id ?? prRows[0]?.id ?? null;

    await selectChecklistVersion(clPick, clRows);
    await selectPrepVersion(prPick, prRows);

    const ids = [...clRows.map((t) => t.id), ...prRows.map((t) => t.id)];
    if (ids.length) {
      const { data, error } = await supabase
        .from("job_template_revisions")
        .select("id,template_kind,template_id,version,action,changed_at,note,diff,staff:floor_staff_profiles(full_name)")
        .in("template_id", ids)
        .order("changed_at", { ascending: false })
        .limit(40);
      if (error) toast.error(floorErrorMessage(error));
      else setRevisions((data ?? []) as unknown as RevisionRow[]);
    } else {
      setRevisions([]);
    }
    setTemplatesLoading(false);
  }

  async function selectJobType(id: string) {
    setSelectedJobTypeId(id);
    setTab("checklist");
    await loadTemplatesForJobType(id);
  }

  function openAddJobType() { setJobTypeForm({ ...EMPTY_JOB_TYPE_FORM }); }
  function openEditJobType(jt: JobType) { setJobTypeForm({ id: jt.id, code: jt.code, name: jt.name, task_field: jt.task_field ?? "", is_active: jt.is_active }); }

  async function saveJobTypeForm() {
    if (!jobTypeForm) return;
    const code = jobTypeForm.code.trim();
    const name = jobTypeForm.name.trim();
    if (!code || !name) { toast.error("กรุณากรอกรหัสและชื่อประเภทงานให้ครบ"); return; }
    const sortOrder = jobTypeForm.id
      ? jobTypes.find((jt) => jt.id === jobTypeForm.id)?.sort_order ?? 0
      : (jobTypes.length ? Math.max(...jobTypes.map((jt) => jt.sort_order)) + 1 : 1);
    setSavingJobType(true);
    const { data, error } = await supabase.rpc("save_job_type", {
      p_id: jobTypeForm.id,
      p_code: code,
      p_name: name,
      p_task_field: jobTypeForm.task_field || null,
      p_is_active: jobTypeForm.is_active,
      p_sort_order: sortOrder,
    });
    setSavingJobType(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(jobTypeForm.id ? "แก้ไขประเภทงานแล้ว" : "เพิ่มประเภทงานใหม่แล้ว");
    setJobTypeForm(null);
    const rows = await loadJobTypes();
    if (!jobTypeForm.id && typeof data === "string") void selectJobType(data);
    else if (jobTypeForm.id && !rows.some((jt) => jt.id === selectedJobTypeId)) void selectJobType(rows[0]?.id ?? "");
  }

  async function toggleJobTypeActive(jt: JobType) {
    if (!canEdit) return;
    setSavingJobTypeOrder(jt.id);
    const { error } = await supabase.rpc("save_job_type", { p_id: jt.id, p_code: jt.code, p_name: jt.name, p_task_field: jt.task_field, p_is_active: !jt.is_active, p_sort_order: jt.sort_order });
    setSavingJobTypeOrder(null);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(jt.is_active ? `ปิดใช้งาน "${jt.name}" แล้ว` : `เปิดใช้งาน "${jt.name}" แล้ว`);
    await loadJobTypes();
  }

  async function moveJobType(jt: JobType, direction: -1 | 1) {
    if (!canEdit) return;
    const idx = jobTypesSorted.findIndex((row) => row.id === jt.id);
    const other = jobTypesSorted[idx + direction];
    if (!other) return;
    setSavingJobTypeOrder(jt.id);
    const [r1, r2] = await Promise.all([
      supabase.rpc("save_job_type", { p_id: jt.id, p_code: jt.code, p_name: jt.name, p_task_field: jt.task_field, p_is_active: jt.is_active, p_sort_order: other.sort_order }),
      supabase.rpc("save_job_type", { p_id: other.id, p_code: other.code, p_name: other.name, p_task_field: other.task_field, p_is_active: other.is_active, p_sort_order: jt.sort_order }),
    ]);
    setSavingJobTypeOrder(null);
    const err = r1.error ?? r2.error;
    if (err) { toast.error(floorErrorMessage(err)); return; }
    await loadJobTypes();
  }

  function addChecklistItem() { setClItems((items) => [...items, newChecklistDraft()]); }
  function removeChecklistItem(key: string) { setClItems((items) => items.filter((item) => item.key !== key)); }
  function updateChecklistItem(key: string, patch: Partial<ChecklistItemDraft>) {
    setClItems((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }
  function moveChecklistItem(key: string, direction: -1 | 1) { setClItems((items) => moveByKey(items, key, direction)); }

  function addPrepItem() { setPrItems((items) => [...items, newPrepDraft()]); }
  function removePrepItem(key: string) { setPrItems((items) => items.filter((item) => item.key !== key)); }
  function updatePrepItem(key: string, patch: Partial<PrepItemDraft>) {
    setPrItems((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }
  function movePrepItem(key: string, direction: -1 | 1) { setPrItems((items) => moveByKey(items, key, direction)); }

  async function saveChecklist() {
    if (!selectedJobTypeId) return;
    if (clItems.length === 0) { toast.error("ต้องมีรายการเกณฑ์ตรวจรับอย่างน้อย 1 รายการ"); return; }
    for (const item of clItems) {
      if (!item.label.trim()) { toast.error("กรุณากรอกชื่อรายการตรวจให้ครบทุกข้อ"); return; }
    }
    const wasActive = clTemplates.find((t) => t.id === clSelectedId)?.status === "active";
    // code มาจาก assignChecklistCodes (คงค่าเดิมของข้อที่มีอยู่แล้ว, gen ใหม่เฉพาะข้อที่เพิ่งเพิ่ม)
    // ส่วน sort_order ยังมาจากตำแหน่งใน array ตามเดิม — ลำดับการแสดงผลกับตัวระบุ (code) เป็นคนละเรื่องกัน
    const codes = assignChecklistCodes(clItems);
    const payload = clItems.map((item, idx) => ({
      code: codes[idx],
      label: item.label.trim(),
      spec_text: item.spec_text.trim() || null,
      requires_photo: item.requires_photo,
      is_critical: item.is_critical,
      measuring_device_kind: item.measuring_device_kind.trim() || null,
      sort_order: idx,
      is_active: item.is_active,
    }));
    setSavingChecklist(true);
    const { data, error } = await supabase.rpc("save_job_checklist_template", {
      p_template_id: clSelectedId,
      p_job_type_id: selectedJobTypeId,
      p_notes: clNotes.trim() || null,
      p_items: payload,
    });
    setSavingChecklist(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(wasActive ? FORK_SUCCESS : "บันทึกแม่แบบเกณฑ์ตรวจรับแล้ว");
    await loadTemplatesForJobType(selectedJobTypeId, { selectTemplateId: data as string, kind: "checklist" });
  }

  async function activateChecklist(id: string) {
    if (!selectedJobTypeId) return;
    setActivatingChecklistId(id);
    const { error } = await supabase.rpc("activate_job_checklist_template", { p_template_id: id });
    setActivatingChecklistId(null);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success("เปิดใช้งานแม่แบบเกณฑ์ตรวจรับเวอร์ชันนี้แล้ว");
    await loadTemplatesForJobType(selectedJobTypeId, { selectTemplateId: id, kind: "checklist" });
  }

  async function savePrep() {
    if (!selectedJobTypeId) return;
    if (prItems.length === 0) { toast.error("ต้องมีรายการเตรียมของอย่างน้อย 1 รายการ"); return; }
    for (const item of prItems) {
      if (!item.item_name.trim()) { toast.error("กรุณากรอกชื่อของให้ครบทุกรายการ"); return; }
      const qty = Number(item.calc_qty);
      if (!Number.isFinite(qty) || qty <= 0) { toast.error(`จำนวนของ "${item.item_name || "รายการ"}" ต้องมากกว่า 0`); return; }
      const waste = Number(item.waste_pct || "0");
      if (!Number.isFinite(waste) || waste < 0 || waste > 100) { toast.error(`เปอร์เซ็นต์เผื่อของ "${item.item_name || "รายการ"}" ต้องอยู่ระหว่าง 0-100`); return; }
    }
    const wasActive = prTemplates.find((t) => t.id === prSelectedId)?.status === "active";
    const payload = prItems.map((item, idx) => ({
      material_id: item.material_id || null,
      item_name: item.item_name.trim(),
      unit: item.unit.trim() || null,
      item_kind: item.item_kind,
      calc_mode: item.calc_mode,
      calc_qty: Number(item.calc_qty),
      waste_pct: Number(item.waste_pct || "0"),
      is_required: item.is_required,
      note: item.note.trim() || null,
      sort_order: idx,
    }));
    setSavingPrep(true);
    const { data, error } = await supabase.rpc("save_job_prep_template", {
      p_template_id: prSelectedId,
      p_job_type_id: selectedJobTypeId,
      p_notes: prNotes.trim() || null,
      p_items: payload,
    });
    setSavingPrep(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(wasActive ? FORK_SUCCESS : "บันทึกแม่แบบรายการเตรียมของแล้ว");
    await loadTemplatesForJobType(selectedJobTypeId, { selectTemplateId: data as string, kind: "prep" });
  }

  async function activatePrep(id: string) {
    if (!selectedJobTypeId) return;
    setActivatingPrepId(id);
    const { error } = await supabase.rpc("activate_job_prep_template", { p_template_id: id });
    setActivatingPrepId(null);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success("เปิดใช้งานแม่แบบรายการเตรียมของเวอร์ชันนี้แล้ว");
    await loadTemplatesForJobType(selectedJobTypeId, { selectTemplateId: id, kind: "prep" });
  }

  function openCopyDialog(kind: TemplateKind, sourceTemplateId: string, sourceLabel: string) {
    if (!selectedJobTypeId) return;
    setCopyDialog({ kind, sourceTemplateId, sourceLabel, targetJobTypeId: selectedJobTypeId });
  }

  async function confirmCopy() {
    if (!copyDialog) return;
    if (!copyDialog.targetJobTypeId) { toast.error("กรุณาเลือกประเภทงานปลายทาง"); return; }
    setCopying(true);
    const { data, error } = await supabase.rpc("copy_job_template", {
      p_kind: copyDialog.kind,
      p_source_template_id: copyDialog.sourceTemplateId,
      p_target_job_type_id: copyDialog.targetJobTypeId,
    });
    setCopying(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success("คัดลอกแม่แบบเป็นฉบับร่างใหม่แล้ว");
    const targetId = copyDialog.targetJobTypeId;
    const kind = copyDialog.kind;
    setCopyDialog(null);
    setTab(kind);
    if (targetId !== selectedJobTypeId) setSelectedJobTypeId(targetId);
    await loadTemplatesForJobType(targetId, { selectTemplateId: data as string, kind });
  }

  const clCurrent = clSelectedId ? clTemplates.find((t) => t.id === clSelectedId) ?? null : null;
  const clIsNew = clSelectedId === null;
  const clEditable = canEdit && (clIsNew || clCurrent?.status === "draft" || (clCurrent?.status === "active" && clEditMode));

  const prCurrent = prSelectedId ? prTemplates.find((t) => t.id === prSelectedId) ?? null : null;
  const prIsNew = prSelectedId === null;
  const prEditable = canEdit && (prIsNew || prCurrent?.status === "draft" || (prCurrent?.status === "active" && prEditMode));

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">แม่แบบงานติดตั้ง</h1>
          <p className="mt-1 text-sm text-slate-500">จัดการประเภทงาน เกณฑ์ตรวจรับ และรายการเตรียมของ โดยไม่ต้องเรียกโปรแกรมเมอร์</p>
        </div>
        <button onClick={() => { void loadJobTypes(); if (selectedJobTypeId) void loadTemplatesForJobType(selectedJobTypeId); }} className="text-sm font-medium text-blue-600 hover:underline">รีเฟรช</button>
      </div>

      {roleChecked && !canEdit ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          บัญชีนี้ดูข้อมูลได้อย่างเดียว เฉพาะผู้ดูแลระบบและหัวหน้าช่างเท่านั้นที่แก้ไขแม่แบบได้
        </div>
      ) : null}

      {/* ---- job types ---- */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">ประเภทงาน</h2>
          {canEdit ? <button onClick={openAddJobType} className={GHOST_BTN}>+ เพิ่มประเภทงาน</button> : null}
        </div>
        {loadingJobTypes ? (
          <div className="mt-3 py-8 text-center text-sm text-slate-400">กำลังโหลด…</div>
        ) : jobTypesSorted.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">ยังไม่มีประเภทงาน</div>
        ) : (
          <div className="mt-3 space-y-2">
            {jobTypesSorted.map((jt, idx) => (
              <div key={jt.id} className={`rounded-xl border p-4 ${selectedJobTypeId === jt.id ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{jt.name}</span>
                      <Badge tone={jt.is_active ? "green" : "slate"}>{jt.is_active ? "ใช้งาน" : "ปิดใช้งาน"}</Badge>
                      {jt.task_field ? <Badge tone="blue">{TASK_FIELD_LABELS[jt.task_field]}</Badge> : null}
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-400">รหัส {jt.code}</div>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button aria-label="เลื่อนขึ้น" disabled={idx === 0 || Boolean(savingJobTypeOrder)} onClick={() => void moveJobType(jt, -1)} className={ICON_BTN}>▲</button>
                      <button aria-label="เลื่อนลง" disabled={idx === jobTypesSorted.length - 1 || Boolean(savingJobTypeOrder)} onClick={() => void moveJobType(jt, 1)} className={ICON_BTN}>▼</button>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => void selectJobType(jt.id)} className={selectedJobTypeId === jt.id ? PRIMARY_BTN : SECONDARY_BTN}>
                    {selectedJobTypeId === jt.id ? "กำลังจัดการแม่แบบ" : "จัดการแม่แบบ"}
                  </button>
                  {canEdit ? (
                    <>
                      <button onClick={() => openEditJobType(jt)} className={SECONDARY_BTN}>แก้ไข</button>
                      <button disabled={savingJobTypeOrder === jt.id} onClick={() => void toggleJobTypeActive(jt)} className={SECONDARY_BTN}>
                        {jt.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- selected job type workspace ---- */}
      {selectedJobTypeId ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-800">{selectedJobType?.name ?? ""} · แม่แบบ</h2>
          <div className="mt-3 flex rounded-xl bg-slate-100 p-1">
            <button onClick={() => setTab("checklist")} className={`min-h-11 flex-1 rounded-lg px-3 text-sm ${tab === "checklist" ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>เกณฑ์ตรวจรับ</button>
            <button onClick={() => setTab("prep")} className={`min-h-11 flex-1 rounded-lg px-3 text-sm ${tab === "prep" ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>รายการเตรียมของ</button>
          </div>

          {templatesLoading ? (
            <div className="mt-4 py-8 text-center text-sm text-slate-400">กำลังโหลดแม่แบบ…</div>
          ) : tab === "checklist" ? (
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                {[...clTemplates].sort((a, b) => b.version - a.version).map((v) => (
                  <button key={v.id} onClick={() => void selectChecklistVersion(v.id, clTemplates)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-medium ${clSelectedId === v.id ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600"}`}>
                    v{v.version} · {STATUS_LABELS[v.status]}
                  </button>
                ))}
                {canEdit ? (
                  <button onClick={() => selectChecklistVersion(null, clTemplates)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-medium ${clIsNew ? "border-blue-400 bg-blue-50 text-blue-700" : "border-dashed border-slate-300 bg-white text-slate-600"}`}>
                    + สร้างแม่แบบใหม่
                  </button>
                ) : null}
              </div>

              {clCurrent?.status === "active" ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{FORK_NOTICE}</div>
              ) : null}
              {clCurrent?.status === "retired" ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">เวอร์ชันนี้ปลดระวางแล้ว ดูได้อย่างเดียว ไม่สามารถแก้ไขได้</div>
              ) : null}
              {clCurrent?.status === "active" && canEdit && !clEditMode ? (
                <button onClick={() => setClEditMode(true)} className={`${SECONDARY_BTN} mt-3`}>แก้ไขเวอร์ชันนี้ (จะสร้างฉบับร่างใหม่)</button>
              ) : null}

              <div className="mt-4">
                <label className="text-xs font-medium text-slate-600">หมายเหตุแม่แบบ</label>
                <textarea disabled={!clEditable} value={clNotes} onChange={(e) => setClNotes(e.target.value)} rows={2} placeholder="เช่น ใช้กับงานปูพื้นกระเบื้องยางทุกรุ่น" className={`${INPUT_CLS} mt-1`} />
              </div>

              <div className="mt-3 space-y-3">
                {clItems.map((item, idx) => (
                  <div key={item.key} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">ข้อที่ {idx + 1}</span>
                      {clEditable ? (
                        <div className="flex gap-1">
                          <button aria-label="เลื่อนขึ้น" disabled={idx === 0} onClick={() => moveChecklistItem(item.key, -1)} className={ICON_BTN}>▲</button>
                          <button aria-label="เลื่อนลง" disabled={idx === clItems.length - 1} onClick={() => moveChecklistItem(item.key, 1)} className={ICON_BTN}>▼</button>
                          <button onClick={() => removeChecklistItem(item.key)} className={DANGER_TEXT_BTN}>ลบ</button>
                        </div>
                      ) : null}
                    </div>
                    <input disabled={!clEditable} value={item.label} onChange={(e) => updateChecklistItem(item.key, { label: e.target.value })} placeholder="รายการตรวจ เช่น ช่องว่างขอบแผ่นกับผนัง" className={`${INPUT_CLS} mt-2`} />
                    <textarea disabled={!clEditable} value={item.spec_text} onChange={(e) => updateChecklistItem(item.key, { spec_text: e.target.value })} rows={2} placeholder="สเปค/เกณฑ์ผ่าน (ถ้ามี) เช่น ไม่เกิน 2 มม." className={`${INPUT_CLS} mt-2`} />
                    <input disabled={!clEditable} value={item.measuring_device_kind} onChange={(e) => updateChecklistItem(item.key, { measuring_device_kind: e.target.value })} placeholder="เครื่องมือวัด (พิมพ์อิสระ) เช่น ตลับเมตร, ระดับน้ำ" className={`${INPUT_CLS} mt-2`} />
                    <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-4">
                      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" disabled={!clEditable} checked={item.requires_photo} onChange={(e) => updateChecklistItem(item.key, { requires_photo: e.target.checked })} className="h-4 w-4" />
                        ต้องถ่ายรูป
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" disabled={!clEditable} checked={item.is_critical} onChange={(e) => updateChecklistItem(item.key, { is_critical: e.target.checked })} className="h-4 w-4" />
                        ข้อวิกฤต (Critical)
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" disabled={!clEditable} checked={item.is_active} onChange={(e) => updateChecklistItem(item.key, { is_active: e.target.checked })} className="h-4 w-4" />
                        เปิดใช้งานข้อนี้
                      </label>
                    </div>
                  </div>
                ))}
                {clItems.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400">ยังไม่มีรายการเกณฑ์ตรวจรับ</div> : null}
              </div>

              {clEditable ? <button onClick={addChecklistItem} className={`${SECONDARY_BTN} mt-3`}>+ เพิ่มข้อตรวจ</button> : null}

              {clEditable || (canEdit && clCurrent) ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {clEditable ? <button disabled={savingChecklist} onClick={() => void saveChecklist()} className={PRIMARY_BTN}>{savingChecklist ? "กำลังบันทึก…" : "บันทึกแม่แบบเกณฑ์ตรวจรับ"}</button> : null}
                  {clCurrent?.status === "draft" && canEdit ? (
                    <button disabled={activatingChecklistId === clCurrent.id} onClick={() => void activateChecklist(clCurrent.id)} className={SECONDARY_BTN}>
                      {activatingChecklistId === clCurrent.id ? "กำลังเปิดใช้งาน…" : "เปิดใช้งานเวอร์ชันนี้"}
                    </button>
                  ) : null}
                  {clCurrent && canEdit ? <button onClick={() => openCopyDialog("checklist", clCurrent.id, `เกณฑ์ตรวจรับ v${clCurrent.version}`)} className={SECONDARY_BTN}>คัดลอกแม่แบบนี้ไปประเภทงานอื่น</button> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                {[...prTemplates].sort((a, b) => b.version - a.version).map((v) => (
                  <button key={v.id} onClick={() => void selectPrepVersion(v.id, prTemplates)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-medium ${prSelectedId === v.id ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600"}`}>
                    v{v.version} · {STATUS_LABELS[v.status]}
                  </button>
                ))}
                {canEdit ? (
                  <button onClick={() => selectPrepVersion(null, prTemplates)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-medium ${prIsNew ? "border-blue-400 bg-blue-50 text-blue-700" : "border-dashed border-slate-300 bg-white text-slate-600"}`}>
                    + สร้างแม่แบบใหม่
                  </button>
                ) : null}
              </div>

              {prCurrent?.status === "active" ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{FORK_NOTICE}</div>
              ) : null}
              {prCurrent?.status === "retired" ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">เวอร์ชันนี้ปลดระวางแล้ว ดูได้อย่างเดียว ไม่สามารถแก้ไขได้</div>
              ) : null}
              {prCurrent?.status === "active" && canEdit && !prEditMode ? (
                <button onClick={() => setPrEditMode(true)} className={`${SECONDARY_BTN} mt-3`}>แก้ไขเวอร์ชันนี้ (จะสร้างฉบับร่างใหม่)</button>
              ) : null}

              <div className="mt-4">
                <label className="text-xs font-medium text-slate-600">หมายเหตุแม่แบบ</label>
                <textarea disabled={!prEditable} value={prNotes} onChange={(e) => setPrNotes(e.target.value)} rows={2} placeholder="เช่น เผื่อของสำหรับหน้างานที่ตัดเยอะ" className={`${INPUT_CLS} mt-1`} />
              </div>

              <div className="mt-3 space-y-3">
                {prItems.map((item, idx) => (
                  <div key={item.key} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">รายการที่ {idx + 1}</span>
                      {prEditable ? (
                        <div className="flex gap-1">
                          <button aria-label="เลื่อนขึ้น" disabled={idx === 0} onClick={() => movePrepItem(item.key, -1)} className={ICON_BTN}>▲</button>
                          <button aria-label="เลื่อนลง" disabled={idx === prItems.length - 1} onClick={() => movePrepItem(item.key, 1)} className={ICON_BTN}>▼</button>
                          <button onClick={() => removePrepItem(item.key)} className={DANGER_TEXT_BTN}>ลบ</button>
                        </div>
                      ) : null}
                    </div>

                    <label className="mt-2 block text-xs font-medium text-slate-500">เลือกจากทะเบียนวัสดุ (ถ้ามี)</label>
                    <select disabled={!prEditable} value={item.material_id} onChange={(e) => {
                      const mat = materials.find((m) => m.id === e.target.value);
                      updatePrepItem(item.key, {
                        material_id: e.target.value,
                        item_name: item.item_name || mat?.name || "",
                        unit: item.unit || mat?.unit || "",
                      });
                    }} className={`${INPUT_CLS} mt-1`}>
                      <option value="">— ไม่ผูกกับทะเบียน (พิมพ์ชื่อเอง) —</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.sku} · {m.name}</option>)}
                    </select>

                    <input disabled={!prEditable} value={item.item_name} onChange={(e) => updatePrepItem(item.key, { item_name: e.target.value })} placeholder="ชื่อของ" className={`${INPUT_CLS} mt-2`} />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input disabled={!prEditable} value={item.unit} onChange={(e) => updatePrepItem(item.key, { unit: e.target.value })} placeholder="หน่วย เช่น ตร.ม., ม้วน" className={INPUT_CLS} />
                      <select disabled={!prEditable} value={item.item_kind} onChange={(e) => updatePrepItem(item.key, { item_kind: e.target.value as ItemKind })} className={INPUT_CLS}>
                        {(Object.entries(ITEM_KIND_LABELS) as [ItemKind, string][]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <select disabled={!prEditable} value={item.calc_mode} onChange={(e) => updatePrepItem(item.key, { calc_mode: e.target.value as CalcMode })} className={`${INPUT_CLS} col-span-2 sm:col-span-1`}>
                        {(Object.entries(CALC_MODE_LABELS) as [CalcMode, string][]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                      <input disabled={!prEditable} type="number" min="0" step="any" inputMode="decimal" value={item.calc_qty} onChange={(e) => updatePrepItem(item.key, { calc_qty: e.target.value })} placeholder="จำนวน" className={INPUT_CLS} />
                      <input disabled={!prEditable} type="number" min="0" max="100" step="any" inputMode="decimal" value={item.waste_pct} onChange={(e) => updatePrepItem(item.key, { waste_pct: e.target.value })} placeholder="เผื่อ %" className={INPUT_CLS} />
                    </div>
                    <input disabled={!prEditable} value={item.note} onChange={(e) => updatePrepItem(item.key, { note: e.target.value })} placeholder="หมายเหตุ (ถ้ามี)" className={`${INPUT_CLS} mt-2`} />
                    <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" disabled={!prEditable} checked={item.is_required} onChange={(e) => updatePrepItem(item.key, { is_required: e.target.checked })} className="h-4 w-4" />
                      จำเป็นต้องเตรียม (ถ้าไม่ติ๊ก ถือเป็นของทางเลือก)
                    </label>
                  </div>
                ))}
                {prItems.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400">ยังไม่มีรายการเตรียมของ</div> : null}
              </div>

              {prEditable ? <button onClick={addPrepItem} className={`${SECONDARY_BTN} mt-3`}>+ เพิ่มรายการของ</button> : null}

              {prEditable || (canEdit && prCurrent) ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {prEditable ? <button disabled={savingPrep} onClick={() => void savePrep()} className={PRIMARY_BTN}>{savingPrep ? "กำลังบันทึก…" : "บันทึกแม่แบบรายการเตรียมของ"}</button> : null}
                  {prCurrent?.status === "draft" && canEdit ? (
                    <button disabled={activatingPrepId === prCurrent.id} onClick={() => void activatePrep(prCurrent.id)} className={SECONDARY_BTN}>
                      {activatingPrepId === prCurrent.id ? "กำลังเปิดใช้งาน…" : "เปิดใช้งานเวอร์ชันนี้"}
                    </button>
                  ) : null}
                  {prCurrent && canEdit ? <button onClick={() => openCopyDialog("prep", prCurrent.id, `รายการเตรียมของ v${prCurrent.version}`)} className={SECONDARY_BTN}>คัดลอกแม่แบบนี้ไปประเภทงานอื่น</button> : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {/* ---- revision history ---- */}
      {selectedJobTypeId ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-800">ประวัติการแก้ไข</h2>
          <div className="mt-3 space-y-2">
            {revisions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400">ยังไม่มีประวัติการแก้ไข</div>
            ) : revisions.map((rev) => (
              <div key={rev.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-slate-800">{rev.template_kind === "checklist" ? "เกณฑ์ตรวจรับ" : "รายการเตรียมของ"} v{rev.version} · {ACTION_LABELS[rev.action] ?? rev.action}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(rev.changed_at)}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  โดย {rev.staff?.full_name ?? "ไม่ทราบผู้ใช้"}{typeof rev.diff?.item_count === "number" ? ` · ${rev.diff.item_count} รายการ` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- job type modal ---- */}
      {jobTypeForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => !savingJobType && setJobTypeForm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">{jobTypeForm.id ? "แก้ไขประเภทงาน" : "เพิ่มประเภทงานใหม่"}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">รหัส (code)</label>
                <input value={jobTypeForm.code} onChange={(e) => setJobTypeForm((f) => f && { ...f, code: e.target.value.toUpperCase() })} placeholder="เช่น FLOOR_INSTALL" className={`${INPUT_CLS} mt-1 font-mono`} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">ชื่อประเภทงาน</label>
                <input value={jobTypeForm.name} onChange={(e) => setJobTypeForm((f) => f && { ...f, name: e.target.value })} placeholder="เช่น ปูพื้น" className={`${INPUT_CLS} mt-1`} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">หมวดงาน</label>
                <select value={jobTypeForm.task_field} onChange={(e) => setJobTypeForm((f) => f && { ...f, task_field: e.target.value as TaskField | "" })} className={`${INPUT_CLS} mt-1`}>
                  <option value="">ไม่ระบุหมวด</option>
                  {TASK_FIELD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={jobTypeForm.is_active} onChange={(e) => setJobTypeForm((f) => f && { ...f, is_active: e.target.checked })} className="h-4 w-4" />
                เปิดใช้งานประเภทงานนี้
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button disabled={savingJobType} onClick={() => setJobTypeForm(null)} className={SECONDARY_BTN}>ยกเลิก</button>
              <button disabled={savingJobType} onClick={() => void saveJobTypeForm()} className={PRIMARY_BTN}>{savingJobType ? "กำลังบันทึก…" : "บันทึก"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- copy modal ---- */}
      {copyDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => !copying && setCopyDialog(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">คัดลอกแม่แบบ</h2>
            <p className="mt-1 text-sm text-slate-500">คัดลอก <strong className="text-slate-700">{copyDialog.sourceLabel}</strong> เป็นฉบับร่างใหม่ของประเภทงานที่เลือก</p>
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-600">คัดลอกไปยังประเภทงาน</label>
              <select value={copyDialog.targetJobTypeId} onChange={(e) => setCopyDialog((d) => d && { ...d, targetJobTypeId: e.target.value })} className={`${INPUT_CLS} mt-1`}>
                {jobTypesSorted.map((jt) => <option key={jt.id} value={jt.id}>{jt.name}{jt.id === selectedJobTypeId ? " (ประเภทงานนี้)" : ""}</option>)}
              </select>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button disabled={copying} onClick={() => setCopyDialog(null)} className={SECONDARY_BTN}>ยกเลิก</button>
              <button disabled={copying} onClick={() => void confirmCopy()} className={PRIMARY_BTN}>{copying ? "กำลังคัดลอก…" : "คัดลอก"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

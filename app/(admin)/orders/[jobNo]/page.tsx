"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import BbpsWorkOrderDetails from "@/components/tech-queue/bbps-work-order-details";
import TechnicianAssignmentButton from "@/components/appointments/technician-assignment";
import { WORK_ITEM_CATEGORIES, WORK_ITEM_CATEGORY_LABELS, WORK_ORDER_STATUS_LABELS, type WorkItemCategory, type WorkOrder, type WorkOrderEvent, type WorkOrderItem, workOrderStatusClass } from "@/lib/work-orders";
import type { StaffRole } from "@/lib/staff";
import type { FloorTechnician, TechnicianAssignment } from "@/lib/technicians";

interface Job {
  job_no: string; source: string | null; bill_no: string | null; customer_name: string | null; customer_phone: string | null;
  address: string | null; location_url: string | null; product_name: string | null; survey_data: string | null;
  raw_payload: unknown; site_photos: string[] | null; pick_plan: unknown; status: string | null;
  sku: string | null; product_skus: string[] | null; flag_note: string | null;
}
interface Appointment { id: string; job_id: string; tech_id: string | null; slot_start: string; slot_end: string; status: string; notes: string | null; requirement: string | null }
interface Team { id: string; name: string }
interface Material { id: string; sku: string; name: string; unit: string | null; qty_on_hand: number | null }
type Technician = FloorTechnician & { personal_token: string };
type Assignment = TechnicianAssignment;
interface DraftItem { id?: string; category: WorkItemCategory; itemName: string; sku: string; specification: string; plannedQty: string; actualQty: string; unit: string; sourceType: string; note: string }

function thaiDate(iso: string) { return new Date(iso).toLocaleString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
function jsonObject(value: unknown): Record<string, unknown> {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function emptyItem(category: WorkItemCategory = "floor_material"): DraftItem {
  return { category, itemName: "", sku: "", specification: "", plannedQty: "", actualQty: "", unit: category === "floor_material" || category === "remnant" ? "แผ่น" : "ชิ้น", sourceType: category === "remnant" ? "remnant" : "new", note: "" };
}
function fromSaved(item: WorkOrderItem): DraftItem {
  return { id: item.id, category: item.category, itemName: item.item_name, sku: item.sku ?? "", specification: item.specification ?? "", plannedQty: String(item.planned_qty), actualQty: item.actual_qty == null ? "" : String(item.actual_qty), unit: item.unit, sourceType: item.source_type, note: item.note ?? "" };
}
function legacyItems(value: unknown): DraftItem[] {
  const plan = jsonObject(value); const rows: DraftItem[] = [];
  if (Array.isArray(plan.newItems)) for (const raw of plan.newItems) { const item = jsonObject(raw); rows.push({ ...emptyItem("floor_material"), itemName: "วัสดุปูพื้น", specification: `หน้ากว้าง ${item.width ?? "—"} ซม. × ยาว ${item.length_cm ?? "—"} ซม.`, plannedQty: String(item.qty ?? ""), note: String(item.note ?? "") }); }
  if (Array.isArray(plan.remnants)) for (const raw of plan.remnants) { const item = jsonObject(raw); rows.push({ ...emptyItem("remnant"), itemName: String(item.mat_type ?? "เศษวัสดุ"), specification: `กว้าง ${item.width_bin ?? "—"} × ยาว ${item.length_cm ?? "—"} ซม.`, plannedQty: "1", note: String(item.note ?? "") }); }
  return rows;
}
function skuItems(job: Job | null, materials: Material[]): DraftItem[] {
  if (!job) return [];
  const skus = Array.from(new Set([...(job.product_skus ?? []), job.sku].filter((value): value is string => Boolean(value?.trim()))));
  return skus.map((sku) => { const material = materials.find((row) => row.sku === sku); return { ...emptyItem("floor_material"), sku, itemName: material?.name || job.product_name || "วัสดุปูพื้น", unit: material?.unit || "แผ่น" }; });
}
function bbpsMaterialText(value: unknown) {
  const payload = jsonObject(value); const orders = Array.isArray(payload.workOrders) ? payload.workOrders : [];
  return orders.flatMap((raw, index) => { const row = jsonObject(raw); const text = typeof row.materials === "string" ? row.materials.trim() : ""; return text ? [`ใบสั่งงานครั้งที่ ${Number(row.seq) || index + 1}: ${text}`] : []; });
}
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="font-semibold text-slate-950">{title}</h2>{subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}</div>{children}</section>;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) { return <div><div className="text-xs font-medium text-slate-400">{label}</div><div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{value || "—"}</div></div>; }

export default function CentralWorkOrderPage({ params }: { params: Promise<{ jobNo: string }> }) {
  const { jobNo } = use(params); const supabase = useMemo(() => createClient(), []);
  const [job, setJob] = useState<Job | null>(null); const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [order, setOrder] = useState<WorkOrder | null>(null); const [items, setItems] = useState<DraftItem[]>([]); const [events, setEvents] = useState<WorkOrderEvent[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]); const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [teams, setTeams] = useState<Team[]>([]); const [materials, setMaterials] = useState<Material[]>([]);
  const [role, setRole] = useState<StaffRole | null>(null); const [note, setNote] = useState(""); const [warehouseFiles, setWarehouseFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const [jobResult, apptResult, profileResult, techResult, teamResult, materialResult] = await Promise.all([
      supabase.from("install_jobs").select("job_no,source,bill_no,customer_name,customer_phone,address,location_url,product_name,survey_data,raw_payload,site_photos,pick_plan,status,sku,product_skus,flag_note").eq("job_no", decodeURIComponent(jobNo)).maybeSingle(),
      supabase.from("appointments").select("id,job_id,tech_id,slot_start,slot_end,status,notes,requirement").eq("job_id", decodeURIComponent(jobNo)).neq("status", "cancelled").order("slot_start", { ascending: false }).limit(1).maybeSingle(),
      user ? supabase.from("floor_staff_profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      // Load inactive rows too so old assignments retain the technician name and evidence.
      // TechnicianAssignmentButton filters the selectable list to active technicians.
      supabase.from("floor_technicians").select("id,team_id,personal_token,name,phone,is_team_lead,is_active,created_at,updated_at,pin_updated_at"),
      supabase.from("tech_teams").select("id,name").eq("is_active", true).order("name"),
      supabase.from("materials").select("id,sku,name,unit,qty_on_hand").order("sku"),
    ]);
    const appt = apptResult.data as Appointment | null; const loadedJob = jobResult.data as Job | null; const loadedMaterials = (materialResult.data ?? []) as Material[];
    setJob(loadedJob); setAppointment(appt); setRole((profileResult.data?.role as StaffRole | undefined) ?? null); setTechnicians((techResult.data ?? []) as Technician[]); setTeams((teamResult.data ?? []) as Team[]); setMaterials(loadedMaterials);
    if (appt) {
      const [orderResult, assignmentResult] = await Promise.all([
        supabase.from("floor_work_orders").select("*").eq("appointment_id", appt.id).maybeSingle(),
        supabase.from("appointment_technicians").select("*").eq("appointment_id", appt.id).eq("is_active", true),
      ]);
      const wo = orderResult.data as WorkOrder | null; setOrder(wo); setAssignments((assignmentResult.data ?? []) as Assignment[]); setNote(wo?.note ?? "");
      if (wo) {
        const [itemResult, eventResult] = await Promise.all([
          supabase.from("floor_work_order_items").select("*").eq("work_order_id", wo.id).order("sort_order"),
          supabase.from("floor_work_order_events").select("*").eq("work_order_id", wo.id).order("occurred_at", { ascending: false }),
        ]);
        const saved = (itemResult.data ?? []) as WorkOrderItem[]; const legacy = legacyItems(loadedJob?.pick_plan); setItems(saved.length ? saved.map(fromSaved) : legacy.length ? legacy : skuItems(loadedJob, loadedMaterials)); setEvents((eventResult.data ?? []) as WorkOrderEvent[]);
      }
    }
    setLoading(false);
  }, [jobNo, supabase]);
  useEffect(() => { void load(); }, [load]);

  function patchItem(index: number, patch: Partial<DraftItem>) { setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item)); }
  function addItem(category: WorkItemCategory = "floor_material") { setItems((current) => [...current, emptyItem(category)]); }
  function removeItem(index: number) { setItems((current) => current.filter((_, i) => i !== index)); }
  function selectMaterial(index: number, sku: string) {
    const material = materials.find((row) => row.sku === sku);
    patchItem(index, { sku, ...(material ? { itemName: material.name, unit: material.unit || "ชิ้น" } : {}) });
  }
  function rpcItems() { return items.map((item) => ({ category: item.category, itemName: item.itemName.trim(), sku: item.sku.trim(), specification: item.specification.trim(), plannedQty: Number(item.plannedQty), unit: item.unit.trim(), sourceType: item.sourceType, note: item.note.trim() })); }

  async function confirmOrder() {
    if (!order) return; if (!items.length || items.some((item) => !item.itemName.trim() || !item.unit.trim() || item.plannedQty === "" || Number(item.plannedQty) < 0 || (item.category === "floor_material" && !item.sku.trim()))) { toast.error("กรอก SKU ชื่อรายการ จำนวน และหน่วยให้ครบทุกบรรทัด"); return; }
    setSaving(true); const { error } = await supabase.rpc("confirm_floor_work_order_v2", { p_work_order_id: order.id, p_items: rpcItems(), p_note: note.trim() || null }); setSaving(false);
    if (error) toast.error(error.message); else { toast.success("ยืนยันใบสั่งงานและส่งให้คลังแล้ว"); void load(); }
  }
  async function returnOrder() {
    if (!order) return; const reason = window.prompt(job?.source === "bbps" ? "ระบุข้อมูลที่ต้องให้ BBPS แก้ไข" : "ระบุข้อมูลที่ต้องให้ฝ่ายขายแก้ไข");
    if (!reason?.trim()) return; setSaving(true); const { error } = await supabase.rpc("return_floor_work_order_v3", { p_work_order_id: order.id, p_reason: reason.trim() }); setSaving(false);
    if (error) toast.error(error.message); else { toast.success(job?.source === "bbps" ? "ส่งกลับ BBPS แล้ว" : "ส่งกลับฝ่ายขายแล้ว"); void load(); }
  }
  async function acceptWarehouse() {
    if (!order) return; setSaving(true); const { error } = await supabase.rpc("accept_floor_warehouse_order_v2", { p_work_order_id: order.id }); setSaving(false);
    if (error) toast.error(error.message); else { toast.success("รับงานเตรียมสินค้าแล้ว"); void load(); }
  }
  async function completeWarehouse() {
    if (!order) return; if (items.some((item) => item.actualQty === "" || Number(item.actualQty) < 0)) { toast.error("กรอกจำนวนหยิบจริงให้ครบทุกบรรทัด"); return; } if (!warehouseFiles.length) { toast.error("ต้องแนบรูปสินค้าที่เตรียมเสร็จอย่างน้อย 1 รูป"); return; }
    setSaving(true); const paths: string[] = [];
    for (let index = 0; index < warehouseFiles.length; index++) { const file = warehouseFiles[index]; const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const path = `work-orders/${order.id}/warehouse/${Date.now()}-${index}-${safe}`; const { error } = await supabase.storage.from("job-photos").upload(path, file); if (error) { toast.error(error.message); setSaving(false); return; } paths.push(path); }
    const actual = items.map((item) => ({ id: item.id, actualQty: Number(item.actualQty) }));
    const { error } = await supabase.rpc("complete_floor_warehouse_order_v2", { p_work_order_id: order.id, p_actual_items: actual, p_photo_paths: paths, p_note: note.trim() || null }); setSaving(false);
    if (error) toast.error(error.message); else { toast.success("เตรียมสินค้าเสร็จและย้ายไปรอติดตั้งแล้ว"); setWarehouseFiles([]); void load(); }
  }
  async function copyLink(token: string) { await navigator.clipboard.writeText(`${window.location.origin}/work/${token}`); toast.success("คัดลอกลิงก์ช่างแล้ว"); }
  async function copyExternalLink() { if (!order?.external_share_token) return; await navigator.clipboard.writeText(`${window.location.origin}/status/${order.external_share_token}`); toast.success("คัดลอกลิงก์ภายนอกแล้ว"); }
  async function rotateExternalLink() { if (!order || !window.confirm("ลิงก์เดิมจะเปิดไม่ได้ทันที ต้องการสร้างลิงก์ใหม่หรือไม่?")) return; setSaving(true); const { error } = await supabase.rpc("rotate_floor_external_share_v3", { p_work_order_id: order.id }); setSaving(false); if (error) toast.error(error.message); else { toast.success("สร้างลิงก์ใหม่แล้ว"); void load(); } }
  async function toggleExternalLink() { if (!order) return; setSaving(true); const { error } = await supabase.rpc("set_floor_external_share_enabled_v3", { p_work_order_id: order.id, p_enabled: !order.external_share_enabled }); setSaving(false); if (error) toast.error(error.message); else { toast.success(order.external_share_enabled ? "ปิดลิงก์ภายนอกแล้ว" : "เปิดลิงก์ภายนอกแล้ว"); void load(); } }

  if (loading) return <div className="py-20 text-center text-slate-400">กำลังโหลดใบสั่งงาน…</div>;
  if (!job || !appointment || !order) return <div className="rounded-2xl border bg-white p-10 text-center text-slate-500">ไม่พบใบสั่งงานสำหรับงานนี้</div>;
  const survey = jsonObject(job.survey_data); const canEdit = (role === "admin" || role === "head_technician") && order.status === "head_review";
  const canWarehouse = role === "admin" || role === "warehouse"; const canManageExternal = role === "admin" || role === "head_technician";
  const materialNotes = bbpsMaterialText(job.raw_payload); const hasLead = assignments.some((row) => row.is_active && row.is_lead);
  const missing = [!job.customer_phone ? "เบอร์โทร" : null, !job.address && !job.location_url ? "สถานที่/แผนที่" : null, !job.product_name && !appointment.requirement ? "สินค้า/ขอบเขตงาน" : null, !hasLead ? "หัวหน้าทีมติดตั้ง" : null, !items.length ? "รายการวัสดุ/อุปกรณ์" : null, items.some((item) => item.category === "floor_material" && !item.sku.trim()) ? "SKU วัสดุปูพื้น" : null, items.some((item) => item.plannedQty === "") ? "จำนวนตามแผน" : null].filter((value): value is string => Boolean(value));

  return <div className="mx-auto max-w-7xl space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><Link href="/operations" className="text-sm text-blue-600">← กลับรายการงาน</Link><div className="mt-3 text-xs font-semibold uppercase tracking-wider text-blue-600">FloorNow · ใบสั่งงานกลาง</div><h1 className="mt-1 text-2xl font-bold text-slate-950">{job.customer_name || job.job_no}</h1><p className="mt-1 text-sm text-slate-500">งาน #{job.job_no}{job.bill_no ? ` · บิล ${job.bill_no}` : ""} · Revision {order.revision}</p></div><span className={`w-fit rounded-full px-4 py-2 text-sm font-semibold ${workOrderStatusClass(order.status)}`}>{WORK_ORDER_STATUS_LABELS[order.status]}</span></div>

    {order.status === "returned_sales" ? <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4"><div className="font-semibold text-amber-900">ส่งกลับให้{job.source === "bbps" ? " BBPS" : "ฝ่ายขาย"}แก้ไขแล้ว</div><p className="mt-1 whitespace-pre-wrap text-sm text-amber-800">{order.returned_reason || job.flag_note || "ไม่ระบุเหตุผล"}</p>{job.source === "bbps" ? <p className="mt-2 text-xs text-amber-700">ต้องแก้ข้อมูลที่ BBPS CRM เมื่อ Sync revision ใหม่กลับมา งานจะเข้าคิวหัวหน้าช่างอีกครั้ง</p> : null}</div> : null}
    {canEdit ? <div className={`rounded-2xl border p-4 ${missing.length ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className={`font-semibold ${missing.length ? "text-amber-900" : "text-emerald-900"}`}>{missing.length ? `ยังขาด ${missing.length} รายการก่อนอนุมัติ` : "ข้อมูลพร้อมอนุมัติส่งคลัง"}</div><div className="mt-2 flex flex-wrap gap-2">{missing.map((item) => <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs text-amber-700">ต้องกรอก: {item}</span>)}</div></div><button onClick={() => void returnOrder()} disabled={saving} className="shrink-0 rounded-xl border border-amber-400 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700">↩ ส่งกลับ{job.source === "bbps" ? " BBPS" : "ฝ่ายขาย"}</button></div></div> : null}

    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <div className="space-y-5">
        <Card title="1. ข้อมูลลูกค้าและนัดหมาย" subtitle="ข้อมูลต้นทางจากฝ่ายขายหรือ BBPS">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="ลูกค้า" value={job.customer_name} /><Field label="เบอร์โทร" value={job.customer_phone ? <a href={`tel:${job.customer_phone}`} className="text-blue-600">{job.customer_phone}</a> : null} /><Field label="วันติดตั้ง" value={thaiDate(appointment.slot_start)} /><Field label="สินค้า / ขอบเขตงาน" value={job.product_name || appointment.requirement} /><Field label="SKU จากต้นทาง" value={[...(job.product_skus ?? []), job.sku].filter(Boolean).join(", ")} /><Field label="แหล่งงาน" value={job.source === "bbps" ? "BBPS CRM" : "ฝ่ายขาย FloorNow"} /><div className="sm:col-span-2"><Field label="สถานที่ติดตั้ง" value={job.address} /></div>{job.location_url ? <a href={job.location_url} target="_blank" rel="noreferrer" className="w-fit rounded-xl bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">📍 เปิดแผนที่</a> : null}</div>
        </Card>
        <Card title="2. รายละเอียดหน้างาน" subtitle="ข้อมูลสำรวจและรูปทั้งหมดที่ฝ่ายขายบันทึก">
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries(survey).filter(([key, value]) => key !== "photos" && value !== "" && value != null && (!Array.isArray(value) || value.length)).map(([key, value]) => <Field key={key} label={key} value={Array.isArray(value) ? value.join(", ") : String(value)} />)}</div>
          {Array.isArray(survey.photos) && survey.photos.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{(survey.photos as string[]).map((src) => <img key={src} src={src} alt="ภาพหน้างาน" className="h-28 w-full rounded-xl object-cover" />)}</div> : <p className="mt-3 text-sm text-amber-600">ยังไม่มีรูปสำรวจหน้างาน</p>}
          {job.source === "bbps" ? <div className="mt-5"><BbpsWorkOrderDetails rawPayload={job.raw_payload} /></div> : null}
        </Card>
        <Card title="3. วัสดุ อุปกรณ์ และของที่ต้องเตรียม" subtitle="หัวหน้ากำหนด SKU และจำนวนตามแผน คลังกรอกเฉพาะจำนวนหยิบจริง">
          {materialNotes.length ? <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><div className="text-sm font-semibold text-indigo-950">ข้อความวัสดุจาก BBPS</div><div className="mt-2 space-y-1">{materialNotes.map((text) => <p key={text} className="whitespace-pre-wrap text-sm text-indigo-800">{text}</p>)}</div><p className="mt-2 text-xs text-indigo-600">หัวหน้าช่างต้องเลือก SKU และจำนวนจริงด้านล่างก่อนอนุมัติ</p></div> : null}
          <div className="space-y-3">{items.map((item, index) => { const stock = materials.find((row) => row.sku === item.sku); return <div key={item.id ?? index} className={`rounded-xl border p-4 ${item.category === "floor_material" && !item.sku ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
            <div className="mb-3 flex items-center justify-between"><div className="font-medium text-slate-900">รายการที่ {index + 1}</div>{canEdit ? <button onClick={() => removeItem(index)} className="text-xs font-medium text-red-500">ลบรายการ</button> : null}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-medium text-slate-500">ประเภท *<select value={item.category} disabled={!canEdit} onChange={(e) => patchItem(index, { category: e.target.value as WorkItemCategory })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm">{WORK_ITEM_CATEGORIES.map((category) => <option key={category} value={category}>{WORK_ITEM_CATEGORY_LABELS[category]}</option>)}</select></label>
              <label className="text-xs font-medium text-slate-500">SKU {item.category === "floor_material" ? "*" : ""}<input list="floor-material-skus" value={item.sku} disabled={!canEdit} onChange={(e) => selectMaterial(index, e.target.value)} placeholder="พิมพ์หรือเลือก SKU" className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 font-mono text-sm" />{stock ? <span className="mt-1 block text-[11px] text-emerald-600">คงเหลือ {Number(stock.qty_on_hand ?? 0).toLocaleString()} {stock.unit || "หน่วย"}</span> : item.sku ? <span className="mt-1 block text-[11px] text-amber-600">ไม่พบ SKU นี้ในคลัง</span> : null}</label>
              <label className="text-xs font-medium text-slate-500">ชื่อสินค้า/อุปกรณ์ *<input value={item.itemName} disabled={!canEdit} onChange={(e) => patchItem(index, { itemName: e.target.value })} placeholder="ชื่อรายการ" className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm" /></label>
              <label className="text-xs font-medium text-slate-500">รุ่น สี ขนาด หรือล็อต<input value={item.specification} disabled={!canEdit} onChange={(e) => patchItem(index, { specification: e.target.value })} placeholder="เช่น Whitebuzz · 1.8 cm" className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm" /></label>
              <div className="grid grid-cols-[1fr_100px] gap-2"><label className="text-xs font-medium text-slate-500">จำนวนตามแผน *<input type="number" min="0" step="0.01" value={item.plannedQty} disabled={!canEdit} onChange={(e) => patchItem(index, { plannedQty: e.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm" /></label><label className="text-xs font-medium text-slate-500">หน่วย *<input value={item.unit} disabled={!canEdit} onChange={(e) => patchItem(index, { unit: e.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm" /></label></div>
              <label className="text-xs font-medium text-slate-500">แหล่งที่มา *<select value={item.sourceType} disabled={!canEdit} onChange={(e) => patchItem(index, { sourceType: e.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm"><option value="new">ของใหม่</option><option value="warehouse">ของในคลัง</option><option value="remnant">เศษวัสดุ</option><option value="bring_along">ช่างนำไป</option><option value="other">อื่น ๆ</option></select></label>
              <label className="text-xs font-medium text-slate-500 sm:col-span-2">หมายเหตุสำหรับคลัง/ช่าง<input value={item.note} disabled={!canEdit} onChange={(e) => patchItem(index, { note: e.target.value })} placeholder="ตำแหน่งใช้งาน วิธีแพ็ก หรือข้อควรระวัง" className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm" /></label>
              <label className="text-xs font-medium text-slate-500">จำนวนหยิบจริง<input type="number" min="0" step="0.01" value={item.actualQty} disabled={order.status !== "warehouse_preparing" || !canWarehouse} onChange={(e) => patchItem(index, { actualQty: e.target.value })} placeholder="คลังกรอกเมื่อรับงาน" className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm disabled:bg-slate-100" /></label>
            </div>
          </div>; })}</div>
          <datalist id="floor-material-skus">{materials.map((material) => <option key={material.id} value={material.sku}>{material.name}</option>)}</datalist>
          {canEdit ? <div className="mt-3 flex flex-wrap gap-2">{WORK_ITEM_CATEGORIES.map((category) => <button key={category} onClick={() => addItem(category)} className="rounded-lg border border-dashed border-blue-300 px-3 py-2 text-xs text-blue-700">+ {WORK_ITEM_CATEGORY_LABELS[category]}</button>)}</div> : null}
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="4. ผู้รับผิดชอบและลิงก์ช่าง" subtitle="ลิงก์ประจำตัวใช้ร่วมกับ PIN ของแต่ละคน">
          {canEdit ? <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-semibold text-violet-950">มอบหมายช่างจากใบสั่งงานนี้</div><p className="mt-1 text-xs text-violet-700">ต้องเลือกผู้รับผิดชอบหลักหนึ่งคนก่อนอนุมัติ</p></div><TechnicianAssignmentButton appointmentId={appointment.id} appointmentTeamId={appointment.tech_id} jobNo={appointment.job_id} teams={teams} technicians={technicians} assignments={assignments} onChanged={() => void load()} /></div></div> : null}
          <div className="space-y-2">{assignments.map((assignment) => { const tech = technicians.find((item) => item.id === assignment.technician_id); return <div key={assignment.id} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><div><div className="font-medium text-slate-900">{tech?.name || "ช่าง"}{assignment.is_lead ? " · หัวหน้าทีม" : ""}</div><div className="mt-1 text-xs text-slate-500">{assignment.acknowledged_at ? "รับทราบงานแล้ว" : assignment.first_opened_at ? "เปิดใบงานแล้ว" : "ยังไม่เปิดใบงาน"}</div></div>{tech?.personal_token ? <button onClick={() => void copyLink(tech.personal_token)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white">คัดลอกลิงก์</button> : null}</div></div>; })}{!assignments.length ? <p className="text-sm text-amber-600">ยังไม่ได้จ่ายงานให้ช่างรายบุคคล</p> : null}</div>
        </Card>
        <Card title="5. ลิงก์สำหรับลูกค้า/บุคคลภายนอก" subtitle="ลิงก์อ่านอย่างเดียว ซ่อนต้นทุน สต็อก PIN และบันทึกภายใน">
          <div className={`rounded-xl p-3 text-sm ${order.external_share_enabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{order.external_share_enabled ? "ลิงก์เปิดใช้งานอยู่" : "ลิงก์ถูกปิดใช้งาน"}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><button onClick={() => void copyExternalLink()} disabled={!order.external_share_enabled} className="rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200">คัดลอกลิงก์สถานะ</button>{canManageExternal ? <button onClick={() => void toggleExternalLink()} disabled={saving} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium">{order.external_share_enabled ? "ปิดลิงก์" : "เปิดลิงก์"}</button> : null}</div>
          {canManageExternal ? <button onClick={() => void rotateExternalLink()} disabled={saving} className="mt-2 w-full rounded-xl border border-red-200 px-3 py-2.5 text-sm text-red-600">ยกเลิกลิงก์เดิมและสร้างใหม่</button> : null}
        </Card>
        <Card title="6. การดำเนินงาน">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit && order.status !== "warehouse_preparing"} rows={3} placeholder="หมายเหตุถึงผู้รับช่วงงานถัดไป" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          {canEdit ? <button onClick={() => void confirmOrder()} disabled={saving || missing.length > 0} className="mt-3 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{saving ? "กำลังบันทึก…" : missing.length ? `ยังอนุมัติไม่ได้ · ขาด ${missing.length} รายการ` : "ยืนยันใบสั่งงาน → ส่งให้คลัง"}</button> : null}
          {canWarehouse && order.status === "warehouse_waiting" ? <button onClick={() => void acceptWarehouse()} disabled={saving} className="mt-3 w-full rounded-xl bg-amber-500 py-3 font-semibold text-white disabled:opacity-50">รับงานเตรียมสินค้า</button> : null}
          {canWarehouse && order.status === "warehouse_preparing" ? <div className="mt-3 space-y-3"><label className="block rounded-xl border border-dashed border-slate-300 p-4 text-sm"><div className="font-medium">รูปสินค้าที่จัดเตรียมเสร็จ *</div><input type="file" accept="image/*" multiple onChange={(e) => setWarehouseFiles(Array.from(e.target.files ?? []))} className="mt-2 w-full text-xs" /></label><button onClick={() => void completeWarehouse()} disabled={saving} className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white disabled:opacity-50">เตรียมเสร็จ → ย้ายไปรอติดตั้ง</button></div> : null}
          {order.status === "ready_to_install" ? <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">สินค้าและอุปกรณ์พร้อมแล้ว รอหัวหน้าทีมกดรับงานติดตั้งจากหน้าของช่าง</div> : null}
        </Card>
        <Card title="7. ประวัติใบสั่งงาน">
          <div className="space-y-3">{events.map((event) => <div key={event.id} className="border-l-2 border-blue-200 pl-3"><div className="text-sm font-medium text-slate-800">{event.actor_name}</div><div className="text-xs text-slate-500">{event.event_type} · {thaiDate(event.occurred_at)}</div>{event.note ? <p className="mt-1 text-xs text-slate-600">{event.note}</p> : null}{event.photo_paths?.length ? <div className="mt-2 grid grid-cols-3 gap-2">{event.photo_paths.map((path) => { const url = path.startsWith("http") ? path : supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl; return <a key={path} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg border bg-slate-100"><img src={url} alt="รูปหลักฐาน" className="h-full w-full object-cover" /></a>; })}</div> : null}</div>)}{!events.length ? <p className="text-sm text-slate-400">ยังไม่มีประวัติ</p> : null}</div>
        </Card>
      </div>
    </div>
  </div>;
}

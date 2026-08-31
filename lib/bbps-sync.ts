import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { outboundConfig, sendMessageToBbps } from "@/lib/integrations/bbps-chat";

export const TEAM_B_ID = "eb37a557-3c82-4051-b056-a5f6075f6c9e";
const BKK = "+07:00";
const WORK_START = "09:00";
const WORK_END = "17:00";

// ใบสั่งงานย่อยจาก BBPS — ฝั่ง BBPS ส่งมาครบ 37 ฟิลด์ต่อใบเสมอ (to_jsonb(w) ยัดทั้งแถวลง payload)
// แต่เดิมที่นี่อ่านไปใช้แค่ seq/start/end คงฟิลด์เดิมสามตัวไว้ก่อนเพราะโค้ดเก่าพึ่งพาอยู่
// (collectBlockDates, jobHasYearWarning) แล้วต่อท้ายด้วยฟิลด์ที่เหลือทั้งหมด — ทุกฟิลด์ optional/nullable
// เพราะ BBPS ส่งค่า null มาได้เสมอเมื่อยังไม่กรอกข้อมูลหัวข้อนั้น
export interface BbpsWorkOrder {
  seq?: number;
  start?: string | null;
  end?: string | null;
  id?: string | null;
  install_start?: string | null;
  install_end?: string | null;
  location_address?: string | null;
  location_map_link?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  manpower?: string | null;
  materials?: string | null;
  task_details?: string | null;
  task_ball_pit?: string | null;
  task_workshop_set?: string | null;
  task_gym?: string | null;
  task_floor?: string | null;
  task_other?: string | null;
  constraint_access_time?: string | null;
  constraint_logistics?: string | null;
  constraint_work_area?: string | null;
  constraint_obstacles?: string | null;
  constraint_ground?: string | null;
  constraint_utilities?: string | null;
  constraint_noise_dust?: string | null;
  constraint_weather?: string | null;
  constraint_site_authority?: string | null;
  acceptance_criteria?: string | null;
  acceptance_photos?: string | null;
  acceptance_quality_check?: string | null;
  acceptance_documents?: string | null;
  acceptance_signoff?: string | null;
  acceptance_followup?: string | null;
  design_images?: string[] | null;
  site_photos?: string[] | null;
}

// รูปแถวที่จะเขียนลง public.install_job_work_orders (ไม่มี job_no เพราะ parseBbpsWorkOrders
// เป็นฟังก์ชันบริสุทธิ์ที่ไม่รู้จัก job_no จริง — job_no ผูกเพิ่มตอนเรียกใช้ใน applyBbpsJob
// หลังจาก upsertTicket คืนค่ามาแล้วเท่านั้น)
export interface BbpsWorkOrderRow {
  external_work_order_id: string;
  seq: number | null;
  install_start: string | null;
  install_end: string | null;
  location_address: string | null;
  location_map_link: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  manpower: string | null;
  materials: string | null;
  task_details: string | null;
  task_ball_pit: string | null;
  task_workshop_set: string | null;
  task_gym: string | null;
  task_floor: string | null;
  task_other: string | null;
  constraint_access_time: string | null;
  constraint_logistics: string | null;
  constraint_work_area: string | null;
  constraint_obstacles: string | null;
  constraint_ground: string | null;
  constraint_utilities: string | null;
  constraint_noise_dust: string | null;
  constraint_weather: string | null;
  constraint_site_authority: string | null;
  acceptance_criteria: string | null;
  acceptance_photos: string | null;
  acceptance_quality_check: string | null;
  acceptance_documents: string | null;
  acceptance_signoff: string | null;
  acceptance_followup: string | null;
  design_images: string[];
  site_photos: string[];
  raw: BbpsWorkOrder;
}

export interface BbpsJob {
  id: string;
  quoteNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  address?: string | null;
  locationUrl?: string | null;
  productName?: string | null;
  areaSqm?: string | number | null;
  status?: string | null;
  statusCode?: string | null;
  installStart?: string | null;
  installEnd?: string | null;
  workOrders?: BbpsWorkOrder[] | null;
}

function yearOf(s: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? parseInt(m[1], 10) : null;
}

function isCEDate(s: string | null | undefined): boolean {
  const y = yearOf(s);
  return y !== null && y <= 2100;
}

// แปลงวันที่จาก work order ให้เป็นค่าที่เขียนลงคอลัมน์ date ได้อย่างปลอดภัย
// ปี พ.ศ. (>2100) ต้องคืน null ไม่ใช่ค่าเพี้ยน — ใช้ isCEDate ตัวเดิมซ้ำ (ไม่ควรมีตรรกะแปลงปีสองที่)
function ceDateOrNull(s: string | null | undefined): string | null {
  if (!isCEDate(s)) return null;
  return s as string;
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

// แปลง workOrders ดิบ (37 ฟิลด์ต่อใบตามที่ BBPS ส่งมาจริง) ให้เป็นแถวพร้อมเขียนลง
// public.install_job_work_orders — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล ไม่ throw
// ใบสั่งงานที่ไม่มี id (ไม่มี natural key ให้ upsert ซ้ำได้) จะถูกข้ามไปทั้งใบ ไม่ทำให้ทั้งชุดพัง
export function parseBbpsWorkOrders(job: BbpsJob): BbpsWorkOrderRow[] {
  const orders = job.workOrders ?? [];
  const rows: BbpsWorkOrderRow[] = [];
  for (const order of orders) {
    if (!order || typeof order !== "object") continue;
    const externalId = textOrNull(order.id);
    if (!externalId) continue; // ไม่มี id -> ข้ามรายการนี้ (เลือกทางนี้แทน throw หรือคืน id เป็น null)
    rows.push({
      external_work_order_id: externalId,
      seq: typeof order.seq === "number" ? order.seq : null,
      install_start: ceDateOrNull(order.install_start),
      install_end: ceDateOrNull(order.install_end),
      location_address: textOrNull(order.location_address),
      location_map_link: textOrNull(order.location_map_link),
      contact_name: textOrNull(order.contact_name),
      contact_phone: textOrNull(order.contact_phone),
      manpower: textOrNull(order.manpower),
      materials: textOrNull(order.materials),
      task_details: textOrNull(order.task_details),
      task_ball_pit: textOrNull(order.task_ball_pit),
      task_workshop_set: textOrNull(order.task_workshop_set),
      task_gym: textOrNull(order.task_gym),
      task_floor: textOrNull(order.task_floor),
      task_other: textOrNull(order.task_other),
      constraint_access_time: textOrNull(order.constraint_access_time),
      constraint_logistics: textOrNull(order.constraint_logistics),
      constraint_work_area: textOrNull(order.constraint_work_area),
      constraint_obstacles: textOrNull(order.constraint_obstacles),
      constraint_ground: textOrNull(order.constraint_ground),
      constraint_utilities: textOrNull(order.constraint_utilities),
      constraint_noise_dust: textOrNull(order.constraint_noise_dust),
      constraint_weather: textOrNull(order.constraint_weather),
      constraint_site_authority: textOrNull(order.constraint_site_authority),
      acceptance_criteria: textOrNull(order.acceptance_criteria),
      acceptance_photos: textOrNull(order.acceptance_photos),
      acceptance_quality_check: textOrNull(order.acceptance_quality_check),
      acceptance_documents: textOrNull(order.acceptance_documents),
      acceptance_signoff: textOrNull(order.acceptance_signoff),
      acceptance_followup: textOrNull(order.acceptance_followup),
      design_images: stringArray(order.design_images),
      site_photos: stringArray(order.site_photos),
      raw: order,
    });
  }
  return rows;
}

export function jobHasYearWarning(j: BbpsJob): boolean {
  const cands = [j.installStart, j.installEnd, ...((j.workOrders ?? []).flatMap((w) => [w?.start, w?.end]))];
  return cands.some((d) => { const y = yearOf(d); return y !== null && y > 2100; });
}

export function collectBlockDates(j: BbpsJob): string[] {
  const set = new Set<string>();
  const addRange = (start?: string | null, end?: string | null) => {
    if (!isCEDate(start)) return;
    const s = new Date(`${start!.slice(0, 10)}T00:00:00Z`);
    const e = isCEDate(end) ? new Date(`${end!.slice(0, 10)}T00:00:00Z`) : new Date(s);
    for (let i = 0; i < 60 && s.getTime() + i * 86400000 <= e.getTime(); i++) {
      const d = new Date(s.getTime() + i * 86400000);
      set.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    }
  };
  addRange(j.installStart, j.installEnd);
  (j.workOrders ?? []).forEach((w) => addRange(w?.start, w?.end));
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------------
// กันคิวชน
//
// งาน BBPS ถูกจองให้ทีม B เต็มวัน 09:00-17:00 เสมอ และเดิมโค้ดนี้ insert/update
// ลงตาราง appointments ตรง ๆ โดยไม่เช็คว่าทีม B ว่างหรือไม่  การเช็คคิวชนที่มีอยู่
// อยู่ในหน้าจอลงคิวฝั่ง browser เท่านั้น (app/share/queue/page.tsx) ซึ่งงานที่ไหล
// มาจาก BBPS ไม่เคยผ่าน  ผลคือเมื่อ 2026-08-20 มีงาน BBPS ถูกจองทับบล็อก
// "วันหยุด" ของทีม B ไปแล้วจริง
//
// นโยบายเมื่อชน: ไม่จองทับ และไม่เงียบ — ข้ามวันนั้น แล้วติดธงไว้ที่ ticket
// ให้คนตัดสินใจ (เลื่อนวัน / ย้ายทีม / ยกเลิกงานเดิม)
// ---------------------------------------------------------------------------

export const CLASH_FLAG_PREFIX = "คิวชนกับงานอื่น:";

export interface ClashRow {
  ext_ref?: string | null;
  slot_start: string;
  slot_end: string;
  notes?: string | null;
  job_id?: string | null;
}

export interface ClashInfo {
  date: string;
  withLabel: string;
}

function clashLabel(r: ClashRow): string {
  const fromNotes = (r.notes || "").split(/[·\n/]/)[0].trim();
  return fromNotes || (r.job_id || "").trim() || "งานอื่น";
}

/**
 * หาว่าวันไหนในรายการที่ขอจองไปชนกับคิวที่ทีมถืออยู่แล้ว
 * others ต้องกรองมาแล้วว่าเป็นทีมเดียวกัน ยังไม่ยกเลิก และไม่ใช่คิวของงานนี้เอง
 * ชนขอบไม่ถือว่าซ้อน (จบ 09:00 แล้วเริ่ม 09:00 ต่อได้) ให้ตรงกับ tstzrange '[)' ที่ฐานข้อมูล
 */
export function findClashes(dates: string[], others: ClashRow[]): ClashInfo[] {
  const out: ClashInfo[] = [];
  for (const d of dates) {
    const s = new Date(`${d}T${WORK_START}:00${BKK}`).getTime();
    const e = new Date(`${d}T${WORK_END}:00${BKK}`).getTime();
    const hit = others.find((r) => {
      const rs = new Date(r.slot_start).getTime();
      const re = new Date(r.slot_end).getTime();
      return Number.isFinite(rs) && Number.isFinite(re) && s < re && e > rs;
    });
    if (hit) out.push({ date: d, withLabel: clashLabel(hit) });
  }
  return out;
}

export function formatClashNote(clashes: ClashInfo[]): string | null {
  if (!clashes.length) return null;
  return `${CLASH_FLAG_PREFIX} ${clashes.map((c) => `${c.date} (${c.withLabel})`).join(", ")}`;
}

/**
 * ต่อ/ถอดข้อความคิวชนใน flag_note โดยไม่ทับธงเรื่องอื่น (เช่น "ข้อมูลไม่ครบ")
 * sync ซ้ำด้วยผลลัพธ์เดิมต้องได้ค่าเดิม เพื่อไม่ให้ข้อความสะสมและไม่ log ซ้ำ
 */
export function mergeClashFlag(existing: string | null | undefined, clashNote: string | null): string | null {
  const kept = (existing ?? "")
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(CLASH_FLAG_PREFIX));
  if (clashNote) kept.push(clashNote);
  return kept.length ? kept.join(" · ") : null;
}

/**
 * ข้อความแจ้งคิวชนที่จะส่งเข้าแชทตั๋ว — ฝั่ง LENDI เห็น และวิ่งต่อไปฝั่ง BBPS
 * ผ่านช่องทางแชทเดิมที่พิสูจน์แล้ว จึงไม่ต้องเพิ่มสัญญา event ใหม่ระหว่างสองระบบ
 *
 * externalMessageId ผูกกับ "ชุดวันที่ชน" ไม่ใช่เวลาที่ส่ง — sync ซ้ำด้วยผลเดิมจึงได้ id เดิม
 * และถูก BBPS ตัดซ้ำทิ้งเองด้วย unique external_message_id
 */
export function buildClashNotice(jobNo: string, clashes: ClashInfo[]): { externalMessageId: string; body: string } | null {
  if (!clashes.length) return null;
  const fingerprint = createHash("sha256")
    .update(`${jobNo}|${clashes.map((c) => c.date).join(",")}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  const lines = clashes.map((c) => `• ${c.date} — ชนกับ ${c.withLabel}`);
  return {
    externalMessageId: `lendi-clash-${fingerprint}`,
    body: [
      "⚠️ วันติดตั้งที่ส่งมาชนกับงานที่ทีมช่างรับไว้แล้ว ระบบจึงยังไม่ได้จองคิวให้",
      ...lines,
      "กรุณาเลือกวันใหม่ หรือแจ้งให้หัวหน้าช่างจัดคิวให้",
    ].join("\n"),
  };
}

const CLASH_NOTICE_SENDER = "ระบบคิว LENDI";

/**
 * แจ้งฝั่ง BBPS ว่าคิวชน โดยส่งเข้าแชทตั๋ว
 *
 * ห้าม throw: งานหลักคือการจองคิวซึ่งสำเร็จไปแล้ว ถ้าการแจ้งล้มเหลวแล้วโยน error ออกไป
 * BBPS จะเห็นเป็น 500 แล้วส่งซ้ำทั้งชุด กลายเป็นทำงานซ้ำโดยไม่จำเป็น
 * ถ้าส่งไม่ผ่าน ข้อความจะค้างเป็น pending และถูก flush ตอนมีคนเปิดแชท (พฤติกรรมเดิม)
 */
async function notifyBbpsClash(
  supabase: SupabaseClient,
  jobNo: string,
  job: BbpsJob,
  clashes: ClashInfo[],
): Promise<void> {
  const notice = buildClashNotice(jobNo, clashes);
  if (!notice) return;

  try {
    const { data: already } = await supabase.from("floor_ticket_messages")
      .select("id").eq("job_no", jobNo).eq("external_message_id", notice.externalMessageId).maybeSingle();
    if (already) return;

    const createdAt = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase.from("floor_ticket_messages").insert({
      job_no: jobNo,
      sender_kind: "staff",
      sender_name: CLASH_NOTICE_SENDER,
      body: notice.body,
      external_message_id: notice.externalMessageId,
    }).select("id").maybeSingle();
    if (insertError) { console.warn("[bbps-sync] clash notice insert failed", insertError.message); return; }

    const config = outboundConfig();
    // ยังตั้ง env ไม่ครบ: ข้อความอยู่ในแชทฝั่ง LENDI แล้ว และค้าง pending รอ flush
    if (!config) return;

    const outcome = await sendMessageToBbps({
      externalMessageId: notice.externalMessageId,
      ticketId: job.id,
      quoteNumber: job.quoteNumber ?? null,
      senderName: CLASH_NOTICE_SENDER,
      senderRole: "staff",
      body: notice.body,
      attachments: [],
      createdAt,
    }, config);

    const patch = outcome.kind === "delivered"
      ? { sync_status: "delivered", external_provider_message_id: outcome.providerMessageId, sync_error: null, sync_attempts: 1, synced_at: new Date().toISOString() }
      : { sync_status: outcome.kind === "failed" ? "failed" : "pending", sync_error: outcome.message, sync_attempts: 1 };
    if (inserted?.id) await supabase.from("floor_ticket_messages").update(patch).eq("id", inserted.id);
    console.log(`[bbps-sync] clash notice job=${jobNo} dates=${clashes.map((c) => c.date).join(",")} -> ${outcome.kind}`);
  } catch (e) {
    console.warn("[bbps-sync] clash notice failed", e instanceof Error ? e.message : String(e));
  }
}

function jobNoFor(id: string) {
  return `BBPS-${id}`;
}

async function writeActivity(
  supabase: SupabaseClient,
  jobNo: string,
  action: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
) {
  const { error } = await supabase.from("job_activity").insert({
    job_no: jobNo,
    actor: "BBPS Sync",
    action,
    field,
    old_value: oldValue,
    new_value: newValue,
  });
  if (error) console.warn("[bbps-sync] activity log failed", error.message);
}

async function upsertTicket(supabase: SupabaseClient, j: BbpsJob, dates: string[]) {
  const fallbackJobNo = jobNoFor(j.id);
  const { data: existing, error: findError } = await supabase
    .from("install_jobs")
    .select("job_no, status, appt_date, raw_payload")
    .eq("source", "bbps")
    .eq("external_id", j.id)
    .maybeSingle();
  if (findError) throw findError;

  const jobNo = (existing?.job_no as string | undefined) ?? fallbackJobNo;
  const firstDate = dates[0] ?? null;
  const missing = [
    !j.quoteNumber ? "เลขอ้างอิง BBPS" : null,
    !j.customerName ? "ชื่อลูกค้า" : null,
    !j.customerPhone ? "เบอร์โทร" : null,
    !j.address && !j.locationUrl ? "ที่อยู่หรือแผนที่" : null,
  ].filter((x): x is string => Boolean(x));
  const needsInfo = missing.length > 0;
  const shared = {
    order_no: j.quoteNumber || fallbackJobNo,
    bill_no: j.quoteNumber || null,
    customer_name: j.customerName || null,
    customer_phone: j.customerPhone || null,
    address: j.address || null,
    ...(j.locationUrl ? { location_url: j.locationUrl } : {}),
    ...(j.productName ? { product_name: j.productName } : {}),
    ...(j.areaSqm ? { survey_data: JSON.stringify({ areaSqm: String(j.areaSqm), savedAt: new Date().toISOString() }) } : {}),
    appt_date: firstDate,
    due_date: firstDate,
    created_via: "bbps",
    source: "bbps",
    order_source: "bbps",
    external_id: j.id,
    raw_payload: j,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const reactivated = existing.status === "BBPS ออกจากคิว" || existing.status === "ยกเลิกคิว";
    const keepApproved = existing.status === "ยืนยันคิวแล้ว" || existing.status === "ติดตั้งสำเร็จ";
    const payloadChanged = JSON.stringify(existing.raw_payload ?? null) !== JSON.stringify(j);
    const keepReturned = existing.status === "ส่งกลับ BBPS แก้ไข" && !payloadChanged;
    const { error } = await supabase.from("install_jobs").update({
      ...shared,
      ...((!keepApproved && !keepReturned) || reactivated ? {
        status: needsInfo ? "รอฝ่ายขายเติมข้อมูล" : "รอหัวหน้าช่างยืนยัน",
        waiting_on: needsInfo ? "ฝ่ายขาย" : "หัวหน้าช่าง",
        waiting_since: new Date().toISOString(),
        flag_note: needsInfo ? `ข้อมูลไม่ครบ: ${missing.join(", ")}` : null,
      } : {}),
    }).eq("job_no", jobNo);
    if (error) throw error;
    if ((existing.appt_date ?? null) !== firstDate) {
      await writeActivity(supabase, jobNo, "sync", "appt_date", existing.appt_date ?? null, firstDate);
    }
  } else {
    const { error } = await supabase.from("install_jobs").insert({
      job_no: jobNo,
      ...shared,
      stage: 2,
      status: needsInfo ? "รอฝ่ายขายเติมข้อมูล" : "รอหัวหน้าช่างยืนยัน",
      linked: true,
      waiting_on: needsInfo ? "ฝ่ายขาย" : "หัวหน้าช่าง",
      waiting_since: new Date().toISOString(),
      flag_note: needsInfo ? `ข้อมูลไม่ครบ: ${missing.join(", ")}` : null,
    });
    if (error) throw error;
    await writeActivity(supabase, jobNo, "create", "source", null, "bbps");
  }

  return jobNo;
}

export async function closeBbpsJob(supabase: SupabaseClient, j: BbpsJob, event: string) {
  const { data: ticket, error: ticketError } = await supabase
    .from("install_jobs")
    .select("job_no, status")
    .eq("source", "bbps")
    .eq("external_id", j.id)
    .maybeSingle();
  if (ticketError) throw ticketError;

  const statusText = (j.status || "").toLowerCase();
  const isCancelled = event === "deleted" || event === "cancelled" || /ยกเลิก|cancel|delete/.test(statusText);
  const isCompleted = !isCancelled && /ติดตั้งเสร็จ|เสร็จสิ้น|ส่งมอบ|complete|done/.test(statusText);
  const appointmentStatus = isCompleted ? "completed" : "cancelled";
  const nextJobStatus = isCompleted ? "ติดตั้งสำเร็จ" : (isCancelled ? "ยกเลิกคิว" : "BBPS ออกจากคิว");

  const { data, error } = await supabase
    .from("appointments")
    .update({ status: appointmentStatus })
    .like("ext_ref", `bbps:${j.id}:%`)
    .neq("status", appointmentStatus)
    .select("id");
  if (error) throw error;

  if (ticket?.job_no) {
    const { error: updateError } = await supabase.from("install_jobs").update({
      status: nextJobStatus,
      ...(isCompleted ? { stage: 4, completed_date: new Date().toISOString().slice(0, 10) } : {}),
      waiting_on: "ไม่ได้ค้าง",
      waiting_since: null,
      updated_at: new Date().toISOString(),
    }).eq("job_no", ticket.job_no);
    if (updateError) throw updateError;
    await writeActivity(supabase, ticket.job_no, "sync", "status", ticket.status ?? null, nextJobStatus);
  }

  return (data ?? []).length;
}

/**
 * เขียนใบสั่งงานย่อย (37 ฟิลด์ที่ BBPS ส่งมา) ลง install_job_work_orders
 *
 * ห้าม throw: ตอนเรียกจุดนี้ การจองคิวหลัก (upsertTicket) สำเร็จไปแล้ว ถ้าขั้นนี้ล้มเหลวแล้วโยน error
 * ออกไป BBPS จะเห็นเป็น 500 แล้วส่งซ้ำทั้งชุดโดยไม่จำเป็น (แพตเทิร์นเดียวกับ notifyBbpsClash ด้านบน)
 * onConflict ที่ external_work_order_id ทำให้ sync ซ้ำแล้วอัปเดตแถวเดิมแทนสร้างซ้ำ
 */
async function syncWorkOrders(supabase: SupabaseClient, jobNo: string, j: BbpsJob): Promise<void> {
  try {
    const rows = parseBbpsWorkOrders(j);
    if (!rows.length) return;
    // ตารางนี้ไม่มี trigger auto-update updated_at (ตั้งใจ ตามแพตเทิร์นของคลัง) จึงต้องเซ็ต
    // synced_at/updated_at เองทุกครั้งที่ upsert ไม่งั้นตอน conflict ค่าเดิมจะค้าง ตอบไม่ได้ว่า
    // sync ล่าสุดเมื่อไหร่
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("install_job_work_orders")
      .upsert(
        rows.map((row) => ({ ...row, job_no: jobNo, synced_at: now, updated_at: now })),
        { onConflict: "external_work_order_id" },
      );
    if (error) {
      console.warn("[bbps-sync] work order upsert failed", error.message);
    }
  } catch (e) {
    console.warn("[bbps-sync] work order upsert failed", e instanceof Error ? e.message : String(e));
  }
}

// สร้าง Ticket กลางและทำ Appointment ของ BBPS ให้ตรงกับวันล่าสุดแบบ idempotent
export async function applyBbpsJob(supabase: SupabaseClient, j: BbpsJob) {
  const dates = collectBlockDates(j);
  // งานยังไม่มีวันติดตั้งที่เป็น ค.ศ. ถูกต้อง: ยังไม่สร้าง Ticket/คิว และรอ BBPS ส่งใหม่เมื่อข้อมูลครบ
  if (!dates.length) {
    return { jobNo: null, added: 0, updated: 0, removed: 0, blocks: 0, skipped: true, clashes: [] as ClashInfo[] };
  }
  const jobNo = await upsertTicket(supabase, j, dates);
  await syncWorkOrders(supabase, jobNo, j);
  const label = j.customerName || j.quoteNumber || "BBPS";
  const refPrefix = `bbps:${j.id}:`;

  const { data: existing, error } = await supabase.from("appointments")
    .select("id, ext_ref, tech_id, status, job_id").like("ext_ref", `${refPrefix}%`);
  if (error) throw error;

  const byRef = new Map((existing ?? []).map((e) => [e.ext_ref as string, e]));
  const desiredRefs = new Set(dates.map((d) => `${refPrefix}${d}`));

  // ปล่อยคิววันที่ BBPS ไม่ได้ขอแล้วก่อน แล้วค่อยจองวันใหม่
  // ถ้าจองก่อนปล่อย งานเดียวกันอาจไปชนคิวเก่าของตัวเองที่ฐานข้อมูล
  const staleIds = (existing ?? [])
    .filter((e) => !desiredRefs.has(e.ext_ref as string) && e.status !== "cancelled")
    .map((e) => e.id);
  if (staleIds.length) {
    const { error: staleError } = await supabase.from("appointments")
      .update({ status: "cancelled" }).in("id", staleIds);
    if (staleError) throw staleError;
  }

  // คิวที่ทีม B ถืออยู่แล้วในช่วงวันเดียวกัน ไม่นับคิวของงานนี้เอง
  // เทียบด้วย slot_start < ปลายช่วง และ slot_end > ต้นช่วง เพื่อให้เห็นคิวข้ามวัน
  // ที่ "เริ่มก่อน" ช่วงนี้แต่ลากมาทับด้วย — เป็นช่องที่การเช็คฝั่ง browser มองไม่เห็น
  const rangeStart = new Date(`${dates[0]}T00:00:00${BKK}`).toISOString();
  const rangeEnd = new Date(`${dates[dates.length - 1]}T23:59:59${BKK}`).toISOString();
  const { data: otherRows, error: othersError } = await supabase.from("appointments")
    .select("id, ext_ref, slot_start, slot_end, notes, job_id")
    .eq("tech_id", TEAM_B_ID)
    .neq("status", "cancelled")
    .lt("slot_start", rangeEnd)
    .gt("slot_end", rangeStart);
  if (othersError) throw othersError;
  const others = ((otherRows ?? []) as ClashRow[]).filter((r) => !(r.ext_ref ?? "").startsWith(refPrefix));

  const clashes = findClashes(dates, others);
  const clashDates = new Set(clashes.map((c) => c.date));

  const toInsert: Record<string, unknown>[] = [];
  let updated = 0;

  for (const d of dates) {
    // ชน = ไม่แตะวันนั้นเลย ทั้งจองใหม่และแก้ของเดิม ปล่อยให้คนตัดสินใจก่อน
    if (clashDates.has(d)) continue;
    const extRef = `${refPrefix}${d}`;
    const current = byRef.get(extRef);
    const values = {
      slot_start: new Date(`${d}T${WORK_START}:00${BKK}`).toISOString(),
      slot_end: new Date(`${d}T${WORK_END}:00${BKK}`).toISOString(),
      notes: `🔒 BBPS · ${label}`,
      ext_ref: extRef,
      job_id: jobNo,
    };
    if (!current) {
      toInsert.push({ ...values, tech_id: TEAM_B_ID, status: "proposed" });
    } else {
      const { error: updateError } = await supabase.from("appointments").update({
        ...values,
        // บล็อกรุ่นเก่าที่ยังไม่เคยผูก Ticket ต้องกลับเข้ารอยืนยันครั้งแรก
        status: current.status === "cancelled" || !current.job_id ? "proposed" : current.status,
      }).eq("id", current.id);
      if (updateError) throw updateError;
      updated++;
    }
  }

  let added = 0;
  if (toInsert.length) {
    const { error: insertError } = await supabase.from("appointments").insert(toInsert);
    if (!insertError) {
      added = toInsert.length;
    } else if (insertError.code === "23P01") {
      // 23P01 = exclusion constraint กันคิวชนที่ฐานข้อมูล (ด่านสุดท้าย)
      // เกิดได้เมื่อมีคนจองแทรกหลังจากเราเช็คไปแล้ว — ลองทีละแถว
      // เพื่อไม่ให้วันที่ยังว่างตกไปพร้อมกับวันที่ชน
      for (const row of toInsert) {
        const { error: rowError } = await supabase.from("appointments").insert(row);
        if (!rowError) { added++; continue; }
        if (rowError.code !== "23P01") throw rowError;
        clashes.push({ date: String(row.ext_ref).slice(refPrefix.length), withLabel: "งานที่จองแทรกเข้ามาระหว่างซิงก์" });
      }
    } else {
      throw insertError;
    }
  }

  clashes.sort((a, b) => a.date.localeCompare(b.date));

  // ติดธงไว้ที่ ticket ให้คนเห็น แทนที่จะจองทับเงียบ ๆ
  const { data: ticketRow, error: ticketError } = await supabase
    .from("install_jobs").select("flag_note").eq("job_no", jobNo).maybeSingle();
  if (ticketError) throw ticketError;
  const previousFlag = (ticketRow?.flag_note as string | null) ?? null;
  const nextFlag = mergeClashFlag(previousFlag, formatClashNote(clashes));
  if (nextFlag !== previousFlag) {
    const { error: flagError } = await supabase.from("install_jobs").update({
      flag_note: nextFlag,
      ...(clashes.length ? { waiting_on: "หัวหน้าช่าง", waiting_since: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq("job_no", jobNo);
    if (flagError) throw flagError;
    await writeActivity(supabase, jobNo, "sync", "flag_note", previousFlag, nextFlag);
    // แจ้งฝั่ง BBPS เฉพาะตอนชุดวันที่ชนเปลี่ยน ไม่ใช่ทุกครั้งที่ sync
    if (clashes.length) await notifyBbpsClash(supabase, jobNo, j, clashes);
  }

  return { jobNo, added, updated, removed: staleIds.length, blocks: dates.length, skipped: false, clashes };
}

import type { SupabaseClient } from "@supabase/supabase-js";

export const TEAM_B_ID = "eb37a557-3c82-4051-b056-a5f6075f6c9e";
const BKK = "+07:00";
const WORK_START = "09:00";
const WORK_END = "17:00";

export interface BbpsWorkOrder { seq?: number; start?: string | null; end?: string | null }
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

// สร้าง Ticket กลางและทำ Appointment ของ BBPS ให้ตรงกับวันล่าสุดแบบ idempotent
export async function applyBbpsJob(supabase: SupabaseClient, j: BbpsJob) {
  const dates = collectBlockDates(j);
  // งานยังไม่มีวันติดตั้งที่เป็น ค.ศ. ถูกต้อง: ยังไม่สร้าง Ticket/คิว และรอ BBPS ส่งใหม่เมื่อข้อมูลครบ
  if (!dates.length) {
    return { jobNo: null, added: 0, updated: 0, removed: 0, blocks: 0, skipped: true };
  }
  const jobNo = await upsertTicket(supabase, j, dates);
  const label = j.customerName || j.quoteNumber || "BBPS";

  const { data: existing, error } = await supabase.from("appointments")
    .select("id, ext_ref, tech_id, status, job_id").like("ext_ref", `bbps:${j.id}:%`);
  if (error) throw error;

  const byRef = new Map((existing ?? []).map((e) => [e.ext_ref as string, e]));
  const desiredRefs = new Set(dates.map((d) => `bbps:${j.id}:${d}`));
  const toInsert = [];
  let updated = 0;

  for (const d of dates) {
    const extRef = `bbps:${j.id}:${d}`;
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

  if (toInsert.length) {
    const { error: insertError } = await supabase.from("appointments").insert(toInsert);
    if (insertError) throw insertError;
  }

  const staleIds = (existing ?? [])
    .filter((e) => !desiredRefs.has(e.ext_ref as string) && e.status !== "cancelled")
    .map((e) => e.id);
  if (staleIds.length) {
    const { error: staleError } = await supabase.from("appointments")
      .update({ status: "cancelled" }).in("id", staleIds);
    if (staleError) throw staleError;
  }

  return { jobNo, added: toInsert.length, updated, removed: staleIds.length, blocks: dates.length, skipped: false };
}

// รับ push จาก BBPS แล้วลงบล็อก "ทีม B ไม่ว่างเต็มวัน" ลงปฏิทิน (appointments.ext_ref = "bbps:{id}:{date}")
// เวอร์ชันง่าย: ไม่มีตารางกลาง ไม่มี poll — บล็อกตามงานที่ยิงเข้ามาโดยตรง
import type { SupabaseClient } from "@supabase/supabase-js";

// id ของ "ทึม B" ในตาราง tech_teams (ค่าคงที่ในระบบเรา ไม่ใช่ความลับ)
export const TEAM_B_ID = "eb37a557-3c82-4051-b056-a5f6075f6c9e";
const BKK = "+07:00";
const WORK_START = "09:00";
const WORK_END = "17:00";

export interface BbpsWorkOrder { seq?: number; start?: string | null; end?: string | null }
export interface BbpsJob {
  id: string;
  quoteNumber?: string | null;
  customerName?: string | null;
  status?: string | null;      // ข้อความไทย (แสดงผลเท่านั้น)
  statusCode?: string | null;  // queued | installing (ใช้ในเงื่อนไข)
  installStart?: string | null;
  installEnd?: string | null;
  workOrders?: BbpsWorkOrder[] | null;
}

function yearOf(s: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? parseInt(m[1], 10) : null;
}
// ปี > 2100 = น่าจะเป็น พ.ศ. ที่กรอกมือ -> เตือน ไม่แปลงอัตโนมัติ ไม่ block
function isCEDate(s: string | null | undefined): boolean {
  const y = yearOf(s);
  return y !== null && y <= 2100;
}
export function jobHasYearWarning(j: BbpsJob): boolean {
  const cands = [j.installStart, j.installEnd, ...((j.workOrders ?? []).flatMap((w) => [w?.start, w?.end]))];
  return cands.some((d) => { const y = yearOf(d); return y !== null && y > 2100; });
}

// รวมวันที่ (ค.ศ. ปกติ) ที่ต้อง block จาก 1 job — นับด้วย UTC กัน timezone เลื่อนวัน
function collectBlockDates(j: BbpsJob): string[] {
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
  return Array.from(set);
}

// ลบบล็อกทั้งหมดของงานนี้ (ใช้กับ completed/deleted หรือ status ที่ไม่ active)
export async function removeJobBlocks(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("appointments").delete().like("ext_ref", `bbps:${id}:%`).select("id");
  if (error) throw error;
  return (data ?? []).length;
}

// อัปเดตบล็อกของงานนี้ให้ตรงกับวันที่ปัจจุบัน (สร้างที่ขาด ลบที่เกิน) เฉพาะ namespace ของ id นี้
export async function applyJobBlocks(supabase: SupabaseClient, j: BbpsJob) {
  const dates = collectBlockDates(j);
  const label = j.customerName || j.quoteNumber || "BBPS";

  const { data: existing, error } = await supabase.from("appointments")
    .select("id, ext_ref").like("ext_ref", `bbps:${j.id}:%`);
  if (error) throw error;
  const existingRefs = new Set((existing ?? []).map((e) => e.ext_ref as string));
  const desiredRefs = new Set(dates.map((d) => `bbps:${j.id}:${d}`));

  const toInsert = dates
    .filter((d) => !existingRefs.has(`bbps:${j.id}:${d}`))
    .map((d) => ({
      tech_id: TEAM_B_ID,
      slot_start: new Date(`${d}T${WORK_START}:00${BKK}`).toISOString(),
      slot_end: new Date(`${d}T${WORK_END}:00${BKK}`).toISOString(),
      status: "confirmed",
      notes: `🔒 BBPS · ${label}`,
      ext_ref: `bbps:${j.id}:${d}`,
      job_id: null,
    }));
  if (toInsert.length) {
    const { error: e2 } = await supabase.from("appointments").insert(toInsert);
    if (e2) throw e2;
  }

  const staleIds = (existing ?? []).filter((e) => !desiredRefs.has(e.ext_ref as string)).map((e) => e.id);
  if (staleIds.length) {
    const { error: e3 } = await supabase.from("appointments").delete().in("id", staleIds);
    if (e3) throw e3;
  }
  return { added: toInsert.length, removed: staleIds.length, blocks: dates.length };
}

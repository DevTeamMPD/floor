/**
 * นโยบายอนุมัติเอกสาร (ISO 9001:2015 ข้อ 7.5.2) — ฝั่ง TypeScript
 *
 * ต้องตรงกับ public.document_approval_policy() ใน
 * supabase/migrations/20260902230000_document_approval_7_5_2.sql เสมอ
 * มีเทสอ่านไฟล์ migration มาเทียบกับค่าในไฟล์นี้ กัน drift ระหว่างสองฝั่ง
 *
 * แยกออกมาจาก generation-worker.ts เพราะไฟล์นั้น import "server-only"
 * ซึ่งทำให้เทสโหลดไม่ได้ — นโยบายเป็นข้อมูลล้วน ไม่ควรผูกกับ runtime ของเซิร์ฟเวอร์
 */

/** เอกสารที่คนเอาไปสั่งงานต่อ — ต้องมีคนตรวจความเหมาะสมก่อนออกใช้ */
export const HUMAN_APPROVAL_DOCUMENT_CLASSES = ["controlled_document"] as const;

/** บันทึกว่าเกิดอะไรขึ้นไปแล้ว — คุมด้วยข้อ 7.5.3 (การเก็บรักษา) ไม่ใช่การอนุมัติก่อนออก */
export const AUTO_APPROVE_DOCUMENT_CLASSES = ["quality_record", "external_reference"] as const;

/** ตำแหน่งที่กดอนุมัติ/ตีกลับได้ — ชุดเดียวกับที่ /document-control ประกาศใน lib/nav.ts */
export const DOCUMENT_APPROVER_ROLES = ["admin", "head_technician", "cs"] as const;

export function requiresHumanApproval(documentClass: string | null | undefined): boolean {
  return HUMAN_APPROVAL_DOCUMENT_CLASSES.includes(
    documentClass as (typeof HUMAN_APPROVAL_DOCUMENT_CLASSES)[number]
  );
}

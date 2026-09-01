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

/**
 * ชนิดเอกสาร -> ชั้นเอกสาร — ต้องตรงกับ public.document_class_for_type() ใน
 * supabase/migrations/20260903000020_document_class_and_approval_enforced.sql เสมอ
 * (มีเทสอ่านไฟล์ migration มาเทียบกับตารางนี้)
 *
 * ทำไมต้องมีตารางนี้ ทั้งที่ renderer แต่ละตัวก็ประกาศชั้นของตัวเองอยู่แล้ว:
 * เอกสารเข้าระบบได้สองทาง — worker ที่ render เอง (รู้ชั้นอยู่แล้ว) กับการอัปโหลดด้วยมือ
 * ที่ app/api/job-documents ซึ่งเดิมใส่ 'quality_record' ตายตัวให้ทุกชนิด
 * ทางที่สองคือที่มาของแถว document_type = 'work_order' ที่ document_class = 'quality_record'
 * ในฐานข้อมูลวันนี้ — ใบสั่งงานที่หลุดออกจากคิวคนอนุมัติได้
 */
export const DOCUMENT_TYPE_CLASSES: Record<string, string> = {
  work_order: "controlled_document",
  boq: "controlled_document",
  ncr: "controlled_document",
  pick_confirmation: "quality_record",
  installation_report: "quality_record",
  customer_acceptance: "quality_record",
  remnant_report: "quality_record",
  handover: "quality_record",
  csat: "quality_record",
};

/** ชนิดที่ระบบยังไม่รู้จัก ได้ชั้นที่ "ต้องมีคนอนุมัติ" — การไม่รู้ต้องพลาดไปทางปลอดภัย */
export const UNKNOWN_DOCUMENT_CLASS = "controlled_document";

export function documentClassForType(documentType: string | null | undefined): string {
  return DOCUMENT_TYPE_CLASSES[String(documentType ?? "")] ?? UNKNOWN_DOCUMENT_CLASS;
}

export function requiresHumanApproval(documentClass: string | null | undefined): boolean {
  return HUMAN_APPROVAL_DOCUMENT_CLASSES.includes(
    documentClass as (typeof HUMAN_APPROVAL_DOCUMENT_CLASSES)[number]
  );
}

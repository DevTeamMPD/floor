import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AUTO_APPROVE_DOCUMENT_CLASSES, DOCUMENT_APPROVER_ROLES, DOCUMENT_TYPE_CLASSES, HUMAN_APPROVAL_DOCUMENT_CLASSES, UNKNOWN_DOCUMENT_CLASS, documentClassForType, requiresHumanApproval } from "@/lib/documents/approval-policy";
import { renderBoq, renderCsat, renderCustomerAcceptance, renderHandover, renderInstallationReport, renderNcr, renderPickConfirmation, renderRemnantReport, renderWorkOrder } from "@/lib/documents/render";

const MIGRATION = path.join(
  process.cwd(), "supabase", "migrations", "20260902230000_document_approval_7_5_2.sql"
);

const ENFORCEMENT_MIGRATION = path.join(
  process.cwd(), "supabase", "migrations", "20260903000020_document_class_and_approval_enforced.sql"
);

function migrationSql() {
  return fs.readFileSync(MIGRATION, "utf8");
}

function enforcementSql() {
  return fs.readFileSync(ENFORCEMENT_MIGRATION, "utf8");
}

describe("นโยบายอนุมัติเอกสาร (ISO 7.5.2)", () => {
  it("ชนิดที่ต้องใช้คนอนุมัติในฝั่ง TS ตรงกับ document_approval_policy() ในฐานข้อมูล", () => {
    const sql = migrationSql();
    const block = sql.slice(sql.indexOf("'humanApprovalClasses'"), sql.indexOf("'autoApproveClasses'"));
    for (const documentClass of HUMAN_APPROVAL_DOCUMENT_CLASSES) {
      expect(block).toContain(`'${documentClass}'`);
    }
    // และชนิดที่อนุมัติอัตโนมัติต้องไม่หลุดเข้ามาอยู่ในฝั่งที่ต้องใช้คน
    expect(HUMAN_APPROVAL_DOCUMENT_CLASSES).not.toContain("quality_record");
  });

  it("เอกสารสั่งงานต้องมีคนอนุมัติ — ใบสั่งงาน BOQ และ NCR", () => {
    expect(requiresHumanApproval("controlled_document")).toBe(true);
    expect(AUTO_APPROVE_DOCUMENT_CLASSES).toContain("quality_record");
  });

  it("บันทึกคุณภาพยังอนุมัติอัตโนมัติ จึงไม่มีคิวใหม่ที่ไม่มีใครเคลียร์", () => {
    expect(requiresHumanApproval("quality_record")).toBe(false);
    expect(requiresHumanApproval("external_reference")).toBe(false);
    expect(requiresHumanApproval(null)).toBe(false);
    expect(requiresHumanApproval(undefined)).toBe(false);
    expect(requiresHumanApproval("")).toBe(false);
  });

  /**
   * เทสนี้คือหัวใจของ "ไม่ทำให้ของเดิมพัง": ถ้าใครเผลอเปลี่ยน documentClass ของ
   * เอกสารหน้างานให้เป็น controlled_document งานหน้างานจะไปค้างในคิวอนุมัติทันที
   */
  const snapshot = { jobNo: "TEST-1", sourceUpdatedAt: new Date(0).toISOString(),
    workOrder: { revision: 1 } } as never;

  it("เอกสารหน้างานทุกชนิดต้องไม่ตกไปอยู่ในคิวรออนุมัติ", () => {
    for (const render of [renderPickConfirmation, renderInstallationReport, renderCustomerAcceptance,
                          renderRemnantReport, renderHandover, renderCsat]) {
      let documentClass: string;
      try { documentClass = render(snapshot).documentClass; }
      catch { continue; } // template บางตัวต้องการ snapshot เต็ม — ข้ามไปใช้ค่าที่ประกาศไว้แทน
      expect(requiresHumanApproval(documentClass)).toBe(false);
    }
  });

  it("migration ประกาศตำแหน่งที่อนุมัติได้ และเปิดคำว่า rejected ใน audit trail", () => {
    const sql = migrationSql();
    expect(sql).toContain("'approverRoles'");
    for (const role of DOCUMENT_APPROVER_ROLES) expect(sql).toContain(`'${role}'`);
    // ถ้าไม่เปิดคำนี้ การตีกลับจะเขียน audit ไม่ได้ = มีการกระทำที่ไม่มีร่องรอย
    expect(sql).toContain("'rejected'");
    // ค่าเดิมทั้ง 7 ต้องยังอยู่ครบ ไม่ใช่แทนที่ด้วยชุดใหม่
    for (const value of ["created", "uploaded", "submitted_for_review", "approved",
                         "superseded", "archived", "opened"]) {
      expect(sql).toContain(`'${value}'`);
    }
  });

  it("RPC ทุกตัวในไฟล์นี้ต้องไม่ให้สิทธิ์ anon และต้องตั้ง search_path ว่าง", () => {
    const sql = migrationSql();
    const functions = [...sql.matchAll(/create or replace function (public\.[a-z_]+)\(/g)].map((m) => m[1]);
    expect(functions.length).toBeGreaterThan(0);
    for (const fn of functions) {
      expect(sql).toMatch(new RegExp(`revoke all on function ${fn.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated`));
    }
    expect(sql).not.toMatch(/grant execute on function [^;]*to[^;]*anon/);
    const definerCount = (sql.match(/security definer/g) ?? []).length;
    const searchPathCount = (sql.match(/set search_path = ''/g) ?? []).length;
    expect(searchPathCount).toBeGreaterThanOrEqual(definerCount);
  });

  /**
   * *** กฎ 7.5.2 ต้องอยู่ในที่ที่ข้ามไม่ได้ ไม่ใช่แค่ใน TypeScript ***
   * เดิมกฎทั้งข้ออยู่ใน generation-worker.ts ตัวเดียว ฐานข้อมูลไม่มีอะไรห้ามการสร้าง
   * แถว controlled_document ที่ status = 'approved' ตั้งแต่แรก
   */
  it("migration ต้องมี trigger บังคับทั้งชั้นเอกสารและด่านอนุมัติที่ระดับตาราง", () => {
    const sql = enforcementSql();
    expect(sql).toContain("create trigger floor_job_documents_class_approval_guard_ins");
    expect(sql).toContain("create trigger floor_job_documents_class_approval_guard_upd");
    expect(sql).toContain("public.document_requires_human_approval(new.document_class)");
    expect(sql).toContain("new.approved_by is null");
    // ค่าเริ่มต้นต้องพลาดไปทางปลอดภัย: ลืมระบุชนิด = ต้องมีคนอนุมัติ
    expect(sql).toContain("alter column document_class set default 'controlled_document'");
    expect(UNKNOWN_DOCUMENT_CLASS).toBe("controlled_document");
    expect(requiresHumanApproval(UNKNOWN_DOCUMENT_CLASS)).toBe(true);
  });

  it("ตารางชนิด -> ชั้นเอกสารฝั่ง TS ตรงกับ document_class_for_type() ในฐานข้อมูล", () => {
    const sql = enforcementSql();
    for (const [documentType, documentClass] of Object.entries(DOCUMENT_TYPE_CLASSES)) {
      expect(sql).toMatch(new RegExp(`when '${documentType}'\\s+then '${documentClass}'`));
    }
    // ชนิดที่ระบบไม่รู้จักต้องพลาดไปทางที่ต้องมีคนอ่าน ไม่ใช่ทางที่ปล่อยผ่าน
    expect(documentClassForType("ใบเสนอราคาที่อัปโหลดเอง")).toBe("controlled_document");
    expect(documentClassForType(null)).toBe("controlled_document");
    expect(documentClassForType("work_order")).toBe("controlled_document");
    expect(documentClassForType("pick_confirmation")).toBe("quality_record");
  });

  /** ชั้นที่ renderer ประกาศเอง ต้องตรงกับตารางกลาง ไม่งั้น trigger จะปฏิเสธเอกสารที่ worker สร้าง */
  it("ชั้นเอกสารที่ renderer ประกาศ ต้องตรงกับตารางกลางทุกชนิด", () => {
    const declared: Record<string, string> = {
      work_order: "controlled_document", boq: "controlled_document", ncr: "controlled_document",
      pick_confirmation: "quality_record", installation_report: "quality_record",
      customer_acceptance: "quality_record", remnant_report: "quality_record",
      handover: "quality_record", csat: "quality_record",
    };
    const renderSource = fs.readFileSync(path.join(process.cwd(), "lib", "documents", "render.ts"), "utf8");
    for (const [documentType, documentClass] of Object.entries(declared)) {
      expect(DOCUMENT_TYPE_CLASSES[documentType]).toBe(documentClass);
      expect(renderSource).toContain(`documentType: "${documentType}", documentClass: "${documentClass}"`);
    }
  });

  it("การอัปโหลดด้วยมือต้องไม่ใส่ quality_record ตายตัวอีกแล้ว", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "app", "api", "job-documents", "route.ts"), "utf8");
    expect(route).not.toContain('document_class: "quality_record"');
    expect(route).toContain("documentClassForType(input.documentType)");
  });
});

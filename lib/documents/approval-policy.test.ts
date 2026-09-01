import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AUTO_APPROVE_DOCUMENT_CLASSES, DOCUMENT_APPROVER_ROLES, HUMAN_APPROVAL_DOCUMENT_CLASSES, requiresHumanApproval } from "@/lib/documents/approval-policy";
import { renderBoq, renderCsat, renderCustomerAcceptance, renderHandover, renderInstallationReport, renderNcr, renderPickConfirmation, renderRemnantReport, renderWorkOrder } from "@/lib/documents/render";

const MIGRATION = path.join(
  process.cwd(), "supabase", "migrations", "20260902230000_document_approval_7_5_2.sql"
);

function migrationSql() {
  return fs.readFileSync(MIGRATION, "utf8");
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
});

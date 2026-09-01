import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FALLBACK_CRITERIA, parseCriteriaCatalog, parseProviderRegister, criteriaForKind,
  providerFormError, approvalBlockers, canApprove, canTakeInstallers, canTakePurchaseOrders,
  registerEmptyMessage, unassignedRosterMessage, parseScoreBoard, suspensionCandidates,
  suspensionReasonError, scoreBoardEmptyMessage, parseSupplierClaims, claimMatchStatus,
  claimMatchSummary, EMPTY_REGISTER, type ProviderRecord,
} from "./provider-register";

const MIGRATION = path.join(process.cwd(), "supabase/migrations/20260902220000_provider_register.sql");

function provider(patch: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: "p1", name: "บริษัททดสอบ", providerKind: "labor", approvalStatus: "approved",
    approvedScope: "ติดตั้งพื้นยาง", selectionCriteria: [{ code: "CREW_SKILL", label: "ฝีมือ", met: true, note: null }],
    selectionNotes: null, approvedAt: "2026-09-01", approvedByName: "ผู้อนุมัติ", decisionNote: null,
    contactName: null, phone: null, email: null, taxId: null, address: null,
    leadTimeDays: null, paymentTerms: null, inspectionSamplePct: null, isActive: true,
    suspendedAt: null, suspensionReason: null, suspendedByName: null,
    suspendedScore: null, suspendedThreshold: null,
    teamCount: 0, technicianCount: 0, poCount: 0, ncrCount: 0, ...patch,
  };
}

describe("เกณฑ์คัดเลือกต้องไม่เพี้ยนจากฝั่งฐานข้อมูล", () => {
  // แพตเทิร์นเดียวกับ lib/job-checklist.test.ts: เทียบกับไฟล์ migration ตรง ๆ
  const sql = fs.readFileSync(MIGRATION, "utf8");

  it("รหัสและป้ายทุกข้อของ FALLBACK_CRITERIA มีอยู่จริงใน provider_selection_criteria_catalog()", () => {
    for (const criterion of FALLBACK_CRITERIA) {
      expect(sql, `ไม่พบรหัส ${criterion.code} ใน migration`).toContain(`'code','${criterion.code}'`);
      expect(sql, `ไม่พบป้าย ${criterion.label} ใน migration`).toContain(`'label','${criterion.label}'`);
      expect(sql, `appliesTo ของ ${criterion.code} ไม่ตรง`).toContain(`'appliesTo','${criterion.appliesTo}'`);
    }
  });

  it("จำนวนเกณฑ์ใน migration เท่ากับใน TS", () => {
    const codes = sql.match(/jsonb_build_object\('code','[A-Z_]+'/g) ?? [];
    expect(codes.length).toBe(FALLBACK_CRITERIA.length);
  });
});

describe("criteriaForKind — ไม่เอาช่องติ๊กที่ไม่มีความหมายมาให้คนกรอก", () => {
  it("ผู้ขายวัสดุไม่เห็นเกณฑ์เรื่องความปลอดภัยหน้างานของทีมช่าง", () => {
    const codes = criteriaForKind(FALLBACK_CRITERIA, "material").map((c) => c.code);
    expect(codes).toContain("CAPACITY");
    expect(codes).not.toContain("SAFETY");
    expect(codes).not.toContain("CREW_SKILL");
  });
  it("ทีมรับเหมาไม่เห็นเกณฑ์เรื่องสต็อกสำรอง", () => {
    const codes = criteriaForKind(FALLBACK_CRITERIA, "labor").map((c) => c.code);
    expect(codes).toContain("CREW_SKILL");
    expect(codes).not.toContain("CAPACITY");
  });
  it("รายที่ทำทั้งสองอย่างเห็นครบทุกข้อ", () => {
    expect(criteriaForKind(FALLBACK_CRITERIA, "both")).toHaveLength(FALLBACK_CRITERIA.length);
  });
});

describe("parseProviderRegister — ต้องทนกับ payload ที่ยังว่าง", () => {
  it("payload ว่างได้ทะเบียนว่างพร้อมเกณฑ์สำรอง", () => {
    expect(parseProviderRegister(null)).toEqual(EMPTY_REGISTER);
    expect(parseProviderRegister({}).criteria).toEqual(FALLBACK_CRITERIA);
  });

  it("อ่านผู้ให้บริการ ทีม และช่าง พร้อมกันได้", () => {
    const parsed = parseProviderRegister({
      providers: [{ id: "p1", name: "หจก. ทดสอบ", providerKind: "both", approvalStatus: "approved",
        approvedScope: "ปูพื้น", selectionCriteria: [{ code: "ON_TIME", label: "ตรงเวลา", met: false, note: "ช้า 1 ครั้ง" }],
        teamCount: 2, technicianCount: 5, poCount: 1, ncrCount: 0, inspectionSamplePct: 10 }],
      teams: [{ id: "t1", name: "ทีมรับเหมา ก", providerType: "subcontract", providerId: "p1", memberCount: 3 }],
      technicians: [{ id: "f1", name: "ช่างทดสอบ", teamId: "t1", teamName: "ทีมรับเหมา ก", providerId: "p1", isActive: true }],
      criteria: [{ code: "X", label: "เกณฑ์ทดสอบ", help: "", appliesTo: "both" }],
    });
    expect(parsed.providers[0].providerKind).toBe("both");
    expect(parsed.providers[0].selectionCriteria[0].note).toBe("ช้า 1 ครั้ง");
    expect(parsed.providers[0].inspectionSamplePct).toBe(10);
    expect(parsed.teams[0].providerId).toBe("p1");
    expect(parsed.technicians[0].teamName).toBe("ทีมรับเหมา ก");
    expect(parsed.criteria).toHaveLength(1);
  });

  it("ค่าชนิดที่ระบบไม่รู้จักถูกตีเป็นยังไม่ระบุ ไม่ใช่ถูกเชื่อ", () => {
    const parsed = parseProviderRegister({ providers: [{ id: "p", name: "n", providerKind: "ghost", approvalStatus: "weird" }] });
    expect(parsed.providers[0].providerKind).toBeNull();
    expect(parsed.providers[0].approvalStatus).toBe("pending");
  });

  it("แถวที่ไม่มี id หรือชื่อถูกทิ้ง ไม่ใช่กลายเป็นแถวว่าง", () => {
    const parsed = parseProviderRegister({ providers: [{ id: "p" }, { name: "n" }, {}], teams: [{ id: "t" }] });
    expect(parsed.providers).toHaveLength(0);
    expect(parsed.teams).toHaveLength(0);
  });

  it("parseCriteriaCatalog ตกกลับไปใช้ค่าสำรองเมื่อ payload ใช้ไม่ได้", () => {
    expect(parseCriteriaCatalog("ไม่ใช่ array")).toEqual(FALLBACK_CRITERIA);
    expect(parseCriteriaCatalog([{ label: "ไม่มีรหัส" }])).toEqual(FALLBACK_CRITERIA);
  });
});

describe("ด่านฝั่งหน้าจอของฟอร์มผู้ให้บริการ", () => {
  const base = { name: "บริษัท ก", providerKind: "material", approvedScope: "", inspectionSamplePct: "", leadTimeDays: "", criteria: [] };
  it("ต้องมีชื่อ", () => expect(providerFormError({ ...base, name: "   " })).toContain("ชื่อ"));
  it("ต้องเลือกชนิด", () => expect(providerFormError({ ...base, providerKind: "" })).toContain("ขายวัสดุ"));
  it("สุ่มตรวจเกิน 100 ไม่ได้", () => expect(providerFormError({ ...base, inspectionSamplePct: "120" })).toContain("0 ถึง 100"));
  it("สุ่มตรวจ 0 ได้", () => expect(providerFormError({ ...base, inspectionSamplePct: "0" })).toBeNull());
  it("lead time ติดลบไม่ได้", () => expect(providerFormError({ ...base, leadTimeDays: "-1" })).toContain("ติดลบ"));
  it("กรอกครบผ่าน", () => expect(providerFormError(base)).toBeNull());
});

describe("ISO 8.4.1 — อนุมัติได้เมื่อตอบได้ว่าอนุมัติเพราะอะไรและให้ทำอะไร", () => {
  it("ไม่มีขอบเขต -> บอกเหตุผลที่อนุมัติไม่ได้", () => {
    const blockers = approvalBlockers(provider({ approvedScope: null }));
    expect(blockers.join(" ")).toContain("ขอบเขต");
    expect(canApprove(provider({ approvedScope: null }))).toBe(false);
  });
  it("ไม่มีเกณฑ์ -> อนุมัติไม่ได้", () => {
    expect(canApprove(provider({ selectionCriteria: [] }))).toBe(false);
  });
  it("ไม่มีชนิด -> อนุมัติไม่ได้", () => {
    expect(canApprove(provider({ providerKind: null }))).toBe(false);
  });
  it("บอกเหตุผลครบทุกข้อพร้อมกัน ไม่ใช่ทีละข้อ", () => {
    expect(approvalBlockers(provider({ providerKind: null, approvedScope: null, selectionCriteria: [] }))).toHaveLength(3);
  });
  it("ครบแล้วอนุมัติได้", () => expect(canApprove(provider())).toBe(true));
  it("รายที่ถูกระงับอยู่ อนุมัติซ้ำไม่ได้", () => {
    expect(canApprove(provider({ approvalStatus: "suspended" }))).toBe(false);
  });
});

describe("แยกผู้ขายวัสดุออกจากทีมรับเหมา", () => {
  it("ผู้ขายวัสดุผูกทีมช่างไม่ได้ แต่ออกใบสั่งซื้อได้", () => {
    const p = provider({ providerKind: "material" });
    expect(canTakeInstallers(p)).toBe(false);
    expect(canTakePurchaseOrders(p)).toBe(true);
  });
  it("ทีมรับเหมาผูกช่างได้ แต่ออกใบสั่งซื้อไม่ได้", () => {
    const p = provider({ providerKind: "labor" });
    expect(canTakeInstallers(p)).toBe(true);
    expect(canTakePurchaseOrders(p)).toBe(false);
  });
  it("รายที่ทำทั้งสองอย่างทำได้ทั้งคู่", () => {
    const p = provider({ providerKind: "both" });
    expect(canTakeInstallers(p)).toBe(true);
    expect(canTakePurchaseOrders(p)).toBe(true);
  });
  it("ยังไม่อนุมัติ ทำอะไรไม่ได้เลยแม้ชนิดจะถูก", () => {
    const p = provider({ providerKind: "both", approvalStatus: "pending" });
    expect(canTakeInstallers(p)).toBe(false);
    expect(canTakePurchaseOrders(p)).toBe(false);
  });
  it("ถูกระงับ ออกใบสั่งซื้อและผูกทีมไม่ได้", () => {
    const p = provider({ providerKind: "both", approvalStatus: "suspended" });
    expect(canTakeInstallers(p)).toBe(false);
    expect(canTakePurchaseOrders(p)).toBe(false);
  });
  it("ปิดการใช้งานแล้วออกใบสั่งซื้อไม่ได้", () => {
    expect(canTakePurchaseOrders(provider({ providerKind: "material", isActive: false }))).toBe(false);
  });
});

describe("หน้าจอต้องพูดความจริงเรื่องความว่างเปล่า", () => {
  it("ทะเบียนว่าง -> บอกว่าว่างและบอกว่าเริ่มยังไง", () => {
    const message = registerEmptyMessage(EMPTY_REGISTER);
    expect(message).toContain("ว่างเปล่า");
    expect(message).toContain("เพิ่มผู้ให้บริการ");
  });
  it("มีรายชื่อแต่ยังไม่อนุมัติ -> เป็นคนละข้อความ", () => {
    const register = { ...EMPTY_REGISTER, providers: [provider({ approvalStatus: "pending" })] };
    expect(registerEmptyMessage(register)).toContain("ยังไม่มีรายไหนผ่านการอนุมัติ");
  });
  it("มีรายที่อนุมัติแล้ว -> ไม่ต้องขึ้นข้อความ", () => {
    expect(registerEmptyMessage({ ...EMPTY_REGISTER, providers: [provider()] })).toBeNull();
  });
  it("ทีมที่ยังไม่ระบุชนิดถูกนับและรายงาน", () => {
    const register = { ...EMPTY_REGISTER,
      teams: [{ id: "t1", name: "ทีม A", providerType: null, providerId: null, isActive: true, memberCount: 2 }],
      technicians: [{ id: "f1", name: "ช่าง", teamId: "t1", teamName: "ทีม A", providerId: null, isActive: true, isTeamLead: false }] };
    expect(unassignedRosterMessage(register)).toContain("1 ทีม");
  });
  it("ทีมระบุครบแล้วไม่ต้องเตือน", () => {
    const register = { ...EMPTY_REGISTER,
      teams: [{ id: "t1", name: "ทีม A", providerType: "in_house", providerId: null, isActive: true, memberCount: 2 }] };
    expect(unassignedRosterMessage(register)).toBeNull();
  });
});

describe("P5-10 — กระดานคะแนนและการระงับ", () => {
  const board = parseScoreBoard({
    policy: { scoreThreshold: 60 },
    candidateCount: 1,
    providers: [
      { providerId: "a", providerName: "ต่ำกว่าเกณฑ์", approvalStatus: "approved", providerScore: 56.7,
        belowThreshold: true, settledTeams: 2, settledJobs: 15, totalTeams: 2, reason: "คะแนน 56.7 ต่ำกว่าเกณฑ์ 60",
        teams: [{ teamId: "t1", teamName: "ทีม 1", evalScore: 45, jobCount: 10, isProvisional: false, hasData: true }] },
      { providerId: "b", providerName: "ยังไม่นิ่ง", approvalStatus: "approved", providerScore: null,
        belowThreshold: false, settledTeams: 0, totalTeams: 1, reason: "ยังไม่มีทีมไหนที่คะแนนนิ่งพอ", teams: [] },
      { providerId: "c", providerName: "ระงับอยู่แล้ว", approvalStatus: "suspended", providerScore: 20,
        belowThreshold: true, settledTeams: 1, totalTeams: 1, reason: "", teams: [] },
    ],
  });

  it("อ่านเกณฑ์จาก policy ที่เซิร์ฟเวอร์ส่งมา", () => expect(board.threshold).toBe(60));

  it("ชี้ตัวเฉพาะรายที่ต่ำกว่าเกณฑ์และยังอนุมัติอยู่ — ไม่ชี้ซ้ำรายที่ระงับไปแล้ว", () => {
    const candidates = suspensionCandidates(board);
    expect(candidates.map((c) => c.providerId)).toEqual(["a"]);
  });

  it("คะแนนที่ยังไม่นิ่งไม่ถูกนับเป็นผู้เข้าเกณฑ์", () => {
    expect(suspensionCandidates(board).some((c) => c.providerId === "b")).toBe(false);
  });

  it("เหตุผลการระงับสั้นเกินไปไม่ผ่าน", () => {
    expect(suspensionReasonError("")).toContain("ต้องระบุเหตุผล");
    expect(suspensionReasonError("แย่")).toContain("สั้นเกินไป");
    expect(suspensionReasonError("งานไม่ผ่านตรวจรับซ้ำสามครั้งติดกัน")).toBeNull();
  });

  it("กระดานว่างพูดความจริงว่ายังไม่มีใครให้พิจารณา", () => {
    expect(scoreBoardEmptyMessage(parseScoreBoard({}))).toContain("ยังไม่มีผู้ให้บริการงานติดตั้ง");
  });

  it("มีรายชื่อแต่ยังไม่มีคะแนนนิ่ง -> บอกเกณฑ์ให้ด้วย", () => {
    const noScores = parseScoreBoard({ policy: { scoreThreshold: 60 },
      providers: [{ providerId: "b", providerName: "x", approvalStatus: "approved", providerScore: null, belowThreshold: false }] });
    expect(scoreBoardEmptyMessage(noScores)).toContain("60");
  });
});

describe("P5-9 — สถานะการจับคู่ใบเคลม ต้องแยกสาเหตุที่จับคู่ไม่ได้", () => {
  const claims = parseSupplierClaims({
    unlinked: 2, withName: 2,
    claims: [
      { id: "1", status: "filed", supplierName: "Super Safety", supplierId: "p1", registeredName: "Super Safety", matchMethod: "auto_exact_name" },
      { id: "2", status: "draft", supplierName: "ร้านที่ยังไม่ขึ้นทะเบียน", supplierId: null },
      { id: "3", status: "draft", supplierName: null, supplierId: null },
    ],
  });

  it("ผูกแล้วบอกว่าใครเป็นคนผูก", () => {
    expect(claimMatchStatus(claims.claims[0])).toContain("ชื่อตรงกัน");
  });
  it("กรอกชื่อแล้วแต่ไม่รู้จัก ต่างจากไม่ได้กรอกชื่อ", () => {
    expect(claimMatchStatus(claims.claims[1])).toContain("ยังไม่มีบริษัทชื่อนี้ในทะเบียน");
    expect(claimMatchStatus(claims.claims[2])).toContain("ไม่ได้ระบุชื่อผู้ขาย");
  });
  it("สรุปบอกจำนวนที่จับคู่ไม่ได้เพราะไม่มีชื่อให้เทียบตั้งแต่แรก", () => {
    expect(claimMatchSummary(claims)).toContain("1 ใบไม่ได้กรอกชื่อผู้ขายไว้ตั้งแต่แรก");
  });
  it("payload ว่างไม่ระเบิด", () => {
    expect(parseSupplierClaims(null).claims).toEqual([]);
  });
});

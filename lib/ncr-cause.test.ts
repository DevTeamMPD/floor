import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_NCR_CAUSES,
  NCR_CAUSE_CODES,
  causeLabel,
  findJob,
  ncrFormError,
  parseCauseOptions,
  parseNcrFormOptions,
  providerEmptyMessage,
  providerFieldVisible,
  type NcrJobOption,
} from "@/lib/ncr-cause";

const internalJob: NcrJobOption = { jobNo: "JOB-1", customer: "ลูกค้า ก", teamName: "ทีม A", providerType: "in_house", isExternal: false };
const externalJob: NcrJobOption = { jobNo: "JOB-2", customer: "ลูกค้า ข", teamName: "ทีม B", providerType: "subcontract", isExternal: true };
const jobs = [internalJob, externalJob];

describe("กันเพี้ยนกับ public.ncr_cause_code_catalog()", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260902200000_ncr_cause_code_and_provider.sql"),
    "utf8",
  );

  it("รหัสสาเหตุใน TS ตรงกับที่ catalog ฝั่ง SQL ประกาศ ทั้งชุดและลำดับ", () => {
    const codes = [...migration.matchAll(/jsonb_build_object\('code', '([A-Z]+)'/g)].map((match) => match[1]);
    expect(codes).toEqual([...NCR_CAUSE_CODES]);
    expect(FALLBACK_NCR_CAUSES.map((cause) => cause.code)).toEqual([...NCR_CAUSE_CODES]);
  });

  it("ป้ายภาษาไทยของทุกรหัสตรงกับฝั่ง SQL ข้อต่อข้อ", () => {
    // ไฟล์ SQL จัดคอลัมน์ด้วยช่องว่าง จึงเทียบหลังยุบช่องว่างซ้ำให้เหลือช่องเดียว
    const flattened = migration.replace(/[ \t]+/g, " ");
    for (const cause of FALLBACK_NCR_CAUSES) {
      expect(flattened).toContain(`'code', '${cause.code}', 'label', '${cause.label}', 'help', '${cause.help}'`);
    }
  });

  it("check constraint ของตารางอนุญาตครบทุกรหัส และไม่มีรหัสนอกรายการ", () => {
    const constraint = migration.slice(migration.indexOf("ncr_reports_cause_code_check"));
    for (const code of NCR_CAUSE_CODES) expect(constraint).toContain(`'${code}'`);
  });

  it("ยังไม่แตะ constraint เดิมของ type — งานนี้เพิ่มแกนใหม่ ไม่ได้แก้แกนเก่า", () => {
    expect(migration).not.toContain("drop constraint ncr_reports_type_check");
    expect(migration).not.toContain("ncr_reports_type_check\n");
  });
});

describe("อ่านตัวเลือกจากเซิร์ฟเวอร์", () => {
  it("อ่าน payload ของ ncr_form_options() ได้ครบสามส่วน", () => {
    const options = parseNcrFormOptions({
      jobs: [{ job_no: "JOB-9", customer: "ลูกค้า", team_name: "ทีม B", provider_type: "subcontract", is_external: true }],
      causeCodes: [{ code: "LOGISTICS", label: "ขนส่ง/คลัง", help: "ของหาย" }],
      providers: [{ id: "sup-1", name: "ซัพ ก", providerKind: "labor" }],
    });
    expect(options.jobs[0]).toMatchObject({ jobNo: "JOB-9", isExternal: true, teamName: "ทีม B" });
    expect(options.causes).toHaveLength(1);
    expect(options.providers[0]).toMatchObject({ id: "sup-1", name: "ซัพ ก" });
  });

  it("payload พังหรือว่าง ยังได้รายการสาเหตุสำรอง จะได้ไม่เหลือฟอร์มที่เลือกอะไรไม่ได้เลย", () => {
    expect(parseCauseOptions(null)).toEqual(FALLBACK_NCR_CAUSES);
    expect(parseCauseOptions([])).toEqual(FALLBACK_NCR_CAUSES);
    expect(parseNcrFormOptions("ขยะ").causes).toEqual(FALLBACK_NCR_CAUSES);
    expect(parseNcrFormOptions({}).jobs).toEqual([]);
  });

  it("งานที่ไม่มีทีม ถือว่าไม่ใช่งานภายนอก", () => {
    const options = parseNcrFormOptions({ jobs: [{ job_no: "JOB-0", customer: null }] });
    expect(options.jobs[0].isExternal).toBe(false);
    expect(options.jobs[0].teamName).toBeNull();
  });
});

describe("ช่องผู้ให้บริการภายนอก (P4-10)", () => {
  it("โชว์เฉพาะงานที่ทีมเป็นผู้รับเหมาภายนอก", () => {
    expect(providerFieldVisible(jobs, "JOB-2")).toBe(true);
    expect(providerFieldVisible(jobs, "JOB-1")).toBe(false);
    expect(providerFieldVisible(jobs, "ไม่มีงานนี้")).toBe(false);
    expect(providerFieldVisible(jobs, "")).toBe(false);
  });

  it("ไม่มีผู้ให้บริการในระบบ ต้องบอกความจริงเป็นภาษาไทย ไม่ใช่กล่องเปล่าเงียบ ๆ", () => {
    const message = providerEmptyMessage([]);
    expect(message).toContain("ยังไม่มีผู้ให้บริการภายนอกในระบบ");
    expect(providerEmptyMessage([{ id: "s", name: "ซัพ", providerKind: null }])).toBeNull();
  });

  it("findJob คืนงานที่ตรงเท่านั้น", () => {
    expect(findJob(jobs, "JOB-2")).toBe(externalJob);
    expect(findJob(jobs, "ไม่มี")).toBeNull();
  });
});

describe("ด่านหน้าของฟอร์มเปิด NC", () => {
  const causes = FALLBACK_NCR_CAUSES;

  it("ต้องเลือกใบงานและระบุปัญหาก่อนเสมอ", () => {
    expect(ncrFormError({ jobNo: "", title: "พื้นบวม", causeCode: "", providerId: "" }, jobs, causes)).toBe("เลือกใบงานก่อน");
    expect(ncrFormError({ jobNo: "JOB-1", title: "   ", causeCode: "", providerId: "" }, jobs, causes)).toBe("ระบุปัญหาที่พบ");
  });

  it("ไม่ระบุสาเหตุก็เปิด NC ได้ — 'ยังไม่รู้' เป็นคำตอบที่ซื่อสัตย์กว่าการบังคับให้เดา", () => {
    expect(ncrFormError({ jobNo: "JOB-1", title: "พื้นบวม", causeCode: "", providerId: "" }, jobs, causes)).toBeNull();
  });

  it("รหัสสาเหตุนอกรายการถูกปฏิเสธตั้งแต่หน้าจอ", () => {
    expect(ncrFormError({ jobNo: "JOB-1", title: "พื้นบวม", causeCode: "GHOST", providerId: "" }, jobs, causes))
      .toBe("รหัสสาเหตุไม่อยู่ในรายการที่ระบบรู้จัก");
  });

  it("ระบุผู้ให้บริการในงานที่ใช้ทีมภายในไม่ได้", () => {
    expect(ncrFormError({ jobNo: "JOB-1", title: "พื้นบวม", causeCode: "INSTALL", providerId: "sup-1" }, jobs, causes))
      .toBe("งานนี้ไม่ได้ใช้ทีมภายนอก จึงระบุผู้ให้บริการไม่ได้");
    expect(ncrFormError({ jobNo: "JOB-2", title: "พื้นบวม", causeCode: "INSTALL", providerId: "sup-1" }, jobs, causes)).toBeNull();
  });
});

describe("ป้ายสาเหตุบนหน้าจอ", () => {
  it("NC เก่าที่ไม่มีสาเหตุ ต้องอ่านออกว่ายังไม่ระบุ ไม่ใช่ช่องว่าง", () => {
    expect(causeLabel(null)).toBe("ยังไม่ระบุสาเหตุ");
    expect(causeLabel("")).toBe("ยังไม่ระบุสาเหตุ");
  });

  it("รหัสที่รู้จักแปลเป็นไทย รหัสแปลกแสดงรหัสดิบแทนการหายไปเฉย ๆ", () => {
    expect(causeLabel("LOGISTICS")).toBe("ขนส่ง/คลัง");
    expect(causeLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

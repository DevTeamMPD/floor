/**
 * P4-4 / P4-10 — สาเหตุของ NC (cause_code) และผู้ให้บริการภายนอก (provider_id) ฝั่งหน้าจอ
 *
 * สองแกนที่ต้องไม่ปนกัน:
 *   ncr_reports.type       = "เกิดอะไรขึ้น" (ของขาด ของเสียหาย ของผิดรุ่น คุณภาพ อื่น ๆ) — ของเดิม ไม่แตะ
 *   ncr_reports.cause_code = "ทำไมถึงเกิด" (วัสดุ ผลิต ติดตั้ง แบบ ขนส่ง หน้างาน อื่น ๆ) — ของใหม่
 * ของขาดเพราะขนส่งตกหล่น กับ ของขาดเพราะคลังไม่มีของ เป็นอาการเดียวกันแต่คนละต้นตอและแก้คนละที่
 *
 * แหล่งความจริงของรายการสาเหตุคือ public.ncr_cause_code_catalog() ฝั่งเซิร์ฟเวอร์ที่เดียว
 * และ ncr_form_options() ส่งรายการนั้นมาให้หน้าจอทุกครั้งที่เปิดฟอร์ม
 * FALLBACK_NCR_CAUSES ข้างล่างใช้เฉพาะกรณีอ่าน payload ไม่ได้ จะได้ไม่เหลือฟอร์มที่มีช่อง
 * "สาเหตุ" แต่ไม่มีตัวเลือกให้เลือกเลย — และมีเทสกันเพี้ยนเทียบกับไฟล์ migration ตรง ๆ
 */

export const NCR_FORM_OPTIONS_RPC = "ncr_form_options";
export const CREATE_NCR_RPC = "create_floor_ncr";

export const NCR_CAUSE_CODES = [
  "MATERIAL", "PRODUCTION", "INSTALL", "DESIGN", "LOGISTICS", "SITE", "OTHER",
] as const;
export type NcrCauseCode = typeof NCR_CAUSE_CODES[number];

export interface NcrCauseOption {
  code: string;
  label: string;
  help: string;
}

/** ต้องตรงกับ public.ncr_cause_code_catalog() — ถ้าไม่ตรง ตัวที่ถูกใช้จริงคือของเซิร์ฟเวอร์ */
export const FALLBACK_NCR_CAUSES: NcrCauseOption[] = [
  { code: "MATERIAL", label: "วัสดุ/สินค้า", help: "ตัวสินค้าหรือวัสดุเองไม่ได้มาตรฐานตั้งแต่ต้นทาง" },
  { code: "PRODUCTION", label: "การผลิต", help: "ผลิต ตัด หรือประกอบผิดไปจากแบบ" },
  { code: "INSTALL", label: "การติดตั้ง", help: "วิธีทำงานหน้างานของทีมติดตั้ง" },
  { code: "DESIGN", label: "แบบ/ออกแบบ", help: "แบบผิด วัดผิด หรือสเปกไม่ตรงหน้างานจริง" },
  { code: "LOGISTICS", label: "ขนส่ง/คลัง", help: "ของหาย ตกหล่น จ่ายไม่ครบ หรือไม่ได้โหลดขึ้นรถ" },
  { code: "SITE", label: "หน้างาน/ลูกค้า", help: "สภาพหน้างานหรือเงื่อนไขฝั่งลูกค้าทำให้งานไม่เป็นไปตามข้อกำหนด" },
  { code: "OTHER", label: "อื่น ๆ", help: "ยังจัดกลุ่มไม่ได้ ต้องอธิบายในรายละเอียด" },
];

export interface NcrJobOption {
  jobNo: string;
  customer: string | null;
  teamName: string | null;
  providerType: string | null;
  /** งานที่ทีมช่างเป็นผู้รับเหมาภายนอก — ตัวตัดสินว่าจะโชว์ช่อง "ผู้ให้บริการ" หรือไม่ */
  isExternal: boolean;
}

export interface NcrProviderOption {
  id: string;
  name: string;
  providerKind: string | null;
}

export interface NcrFormOptions {
  jobs: NcrJobOption[];
  causes: NcrCauseOption[];
  providers: NcrProviderOption[];
}

export const EMPTY_NCR_FORM_OPTIONS: NcrFormOptions = {
  jobs: [],
  causes: FALLBACK_NCR_CAUSES,
  providers: [],
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function parseCauseOptions(value: unknown): NcrCauseOption[] {
  if (!Array.isArray(value)) return FALLBACK_NCR_CAUSES;
  const parsed = value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const code = text(raw.code);
    const label = text(raw.label);
    if (!code || !label) return [];
    return [{ code, label, help: text(raw.help) ?? "" }];
  });
  return parsed.length > 0 ? parsed : FALLBACK_NCR_CAUSES;
}

export function parseNcrFormOptions(value: unknown): NcrFormOptions {
  if (!value || typeof value !== "object") return EMPTY_NCR_FORM_OPTIONS;
  const raw = value as Record<string, unknown>;

  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const job = row as Record<string, unknown>;
        const jobNo = text(job.job_no) ?? text(job.jobNo);
        if (!jobNo) return [];
        return [{
          jobNo,
          customer: text(job.customer),
          teamName: text(job.team_name) ?? text(job.teamName),
          providerType: text(job.provider_type) ?? text(job.providerType),
          isExternal: (job.is_external ?? job.isExternal) === true,
        }];
      })
    : [];

  const providers = Array.isArray(raw.providers)
    ? raw.providers.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const provider = row as Record<string, unknown>;
        const id = text(provider.id);
        const name = text(provider.name);
        if (!id || !name) return [];
        return [{ id, name, providerKind: text(provider.providerKind) ?? text(provider.provider_kind) }];
      })
    : [];

  return { jobs, causes: parseCauseOptions(raw.causeCodes ?? raw.causes), providers };
}

export function findJob(jobs: NcrJobOption[], jobNo: string): NcrJobOption | null {
  return jobs.find((job) => job.jobNo === jobNo) ?? null;
}

/** โชว์ช่อง "ผู้ให้บริการภายนอก" เฉพาะงานที่ทีมช่างเป็นผู้รับเหมาภายนอกเท่านั้น */
export function providerFieldVisible(jobs: NcrJobOption[], jobNo: string): boolean {
  return findJob(jobs, jobNo)?.isExternal === true;
}

/**
 * ข้อความเมื่อไม่มีผู้ให้บริการให้เลือก — ต้องบอกความจริงว่า "ยังไม่มีใครในระบบ"
 * ไม่ใช่ปล่อยกล่องเปล่าให้คนเดาว่าโหลดไม่ขึ้นหรือไม่มีสิทธิ์
 */
export function providerEmptyMessage(providers: NcrProviderOption[]): string | null {
  if (providers.length > 0) return null;
  return "ยังไม่มีผู้ให้บริการภายนอกในระบบ — เพิ่มที่ทะเบียนซัพพลายเออร์ก่อนจึงจะเลือกได้";
}

export function causeLabel(code: string | null | undefined, causes: NcrCauseOption[] = FALLBACK_NCR_CAUSES): string {
  if (!code) return "ยังไม่ระบุสาเหตุ";
  return causes.find((cause) => cause.code === code)?.label ?? code;
}

export interface NcrDraft {
  jobNo: string;
  title: string;
  causeCode: string;
  providerId: string;
}

/**
 * ด่านหน้าฝั่งหน้าจอ — ผู้ตัดสินจริงคือ create_floor_ncr ฝั่งฐานข้อมูล
 * ที่นี่มีไว้เพื่อไม่ให้คนกดส่งแล้วรอ round-trip เพื่อรู้ว่าลืมเลือกใบงาน
 */
export function ncrFormError(draft: NcrDraft, jobs: NcrJobOption[], causes: NcrCauseOption[]): string | null {
  if (!draft.jobNo.trim()) return "เลือกใบงานก่อน";
  if (!draft.title.trim()) return "ระบุปัญหาที่พบ";
  if (draft.causeCode && !causes.some((cause) => cause.code === draft.causeCode)) {
    return "รหัสสาเหตุไม่อยู่ในรายการที่ระบบรู้จัก";
  }
  if (draft.providerId && !providerFieldVisible(jobs, draft.jobNo)) {
    return "งานนี้ไม่ได้ใช้ทีมภายนอก จึงระบุผู้ให้บริการไม่ได้";
  }
  return null;
}

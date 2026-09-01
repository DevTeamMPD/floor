/**
 * P5-7 / P5-10 — ทะเบียนผู้ให้บริการภายนอก และการระงับ (ฝั่งหน้าจอ)
 *
 * ทำไมไฟล์นี้มีอยู่: ครึ่งหนึ่งของงานติดตั้งทำโดยคนนอก แต่ระบบไม่เคยรู้จักพวกเขา
 * หน้าจอ /providers เป็นที่แรกที่บริษัทจะพิมพ์ชื่อคนเหล่านั้นลงไป — ตอนนี้ยังว่างเปล่า
 * ทุกฟังก์ชันในไฟล์นี้จึงต้องทำงานถูกต้องกับ "ศูนย์แถว" ก่อนเป็นอันดับแรก
 *
 * แหล่งความจริงของเกณฑ์คัดเลือกคือ public.provider_selection_criteria_catalog() ฝั่งเซิร์ฟเวอร์
 * FALLBACK_CRITERIA ข้างล่างมีไว้กันจอว่างเมื่ออ่าน payload ไม่ได้ และมีเทสเทียบกับไฟล์
 * migration ตรง ๆ เพื่อกันสองฝั่งเพี้ยนออกจากกันเงียบ ๆ (แพตเทิร์นเดียวกับ lib/job-checklist.ts)
 *
 * ฝั่งหน้าจอไม่ใช่ผู้ตัดสิน — ผู้ตัดสินจริงคือ RPC ที่ตรวจซ้ำทุกข้อ ที่นี่มีไว้เพื่อไม่ให้คน
 * กดส่งแล้วรอ round-trip เพื่อรู้ว่าลืมกรอกช่องเดียว
 */

export const PROVIDER_REGISTER_SNAPSHOT_RPC = "provider_register_snapshot";
export const UPSERT_PROVIDER_RPC = "upsert_provider";
export const DECIDE_PROVIDER_APPROVAL_RPC = "decide_provider_approval";
export const SET_TEAM_PROVIDER_RPC = "set_tech_team_provider";
export const SET_TECHNICIAN_PROVIDER_RPC = "set_technician_provider";
export const PROVIDER_SCORE_BOARD_RPC = "provider_score_board";
export const SUSPEND_PROVIDER_RPC = "suspend_provider";
export const REINSTATE_PROVIDER_RPC = "reinstate_provider";
export const SUSPENSION_HISTORY_RPC = "provider_suspension_history";
export const SUPPLIER_CLAIMS_SNAPSHOT_RPC = "supplier_claims_snapshot";
export const MATCH_SUPPLIER_CLAIMS_RPC = "match_supplier_claims_to_register";
export const LINK_SUPPLIER_CLAIM_RPC = "link_supplier_claim";

export const PROVIDER_KINDS = ["material", "labor", "both"] as const;
export type ProviderKind = typeof PROVIDER_KINDS[number];

/** ป้ายที่ตอบคำถามเดียวว่า "รายนี้ขายของให้เรา หรือทำงานแทนเรา" */
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  material: "ผู้ขายวัสดุ/สินค้า",
  labor: "ทีมรับเหมาติดตั้ง",
  both: "ขายวัสดุและรับติดตั้ง",
};

export const PROVIDER_KIND_HELP: Record<ProviderKind, string> = {
  material: "ขายของให้บริษัท — ออกใบสั่งซื้อและตรวจรับของจากรายนี้ได้",
  labor: "ทำงานติดตั้งแทนบริษัท — ผูกทีมช่างและช่างเข้ากับรายนี้ได้",
  both: "ทำทั้งสองอย่าง — ทั้งออกใบสั่งซื้อและผูกทีมช่างได้",
};

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "รอพิจารณา",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  suspended: "ถูกระงับ",
};

export interface CriterionOption {
  code: string;
  label: string;
  help: string;
  /** "material" | "labor" | "both" — เกณฑ์นี้ใช้กับผู้ให้บริการพันธุ์ไหน */
  appliesTo: string;
}

export interface SelectionCriterion {
  code: string;
  label: string;
  met: boolean;
  note: string | null;
}

/** ต้องตรงกับ public.provider_selection_criteria_catalog() — ถ้าไม่ตรง ของเซิร์ฟเวอร์ชนะ */
export const FALLBACK_CRITERIA: CriterionOption[] = [
  { code: "QUALITY_RECORD", appliesTo: "both", label: "ผลงานคุณภาพที่ผ่านมา", help: "เคยส่งของหรือทำงานให้เราหรือที่อื่นแล้วผลเป็นอย่างไร มีหลักฐานอะไร" },
  { code: "PRICE_TERMS", appliesTo: "both", label: "ราคาและเงื่อนไขการชำระเงิน", help: "ราคาที่ตกลง เงื่อนไขเครดิต และความชัดเจนของใบเสนอราคา" },
  { code: "ON_TIME", appliesTo: "both", label: "ความตรงเวลา", help: "ส่งของตามกำหนดหรือเข้างานตามนัดได้จริงแค่ไหน" },
  { code: "DOCUMENTS", appliesTo: "both", label: "เอกสารบริษัทและใบรับรอง", help: "หนังสือรับรองบริษัท เลขผู้เสียภาษี ใบรับรองมาตรฐาน หรือกรมธรรม์ประกันภัย" },
  { code: "CAPACITY", appliesTo: "material", label: "กำลังจัดหาและสต็อกสำรอง", help: "รับปริมาณที่เราสั่งไหวไหม ของขาดแล้วมีทางเลือกอะไร" },
  { code: "WARRANTY", appliesTo: "material", label: "การรับประกันและการเปลี่ยนคืน", help: "ของไม่ผ่านตรวจรับแล้วเปลี่ยนคืนได้ภายในกี่วัน ใครออกค่าขนส่ง" },
  { code: "CREW_SKILL", appliesTo: "labor", label: "ฝีมือและประสบการณ์ของทีมช่าง", help: "เคยติดตั้งพื้นชนิดไหนมาบ้าง ทีมมีกี่คน หัวหน้าทีมคือใคร" },
  { code: "SAFETY", appliesTo: "labor", label: "ความปลอดภัยหน้างาน", help: "อุปกรณ์ป้องกัน การดูแลพื้นที่ของลูกค้า และประวัติอุบัติเหตุ" },
  { code: "REWORK", appliesTo: "labor", label: "ข้อตกลงเรื่องการแก้งาน", help: "งานไม่ผ่านแล้วใครกลับไปแก้ ภายในกี่วัน และใครรับผิดชอบค่าใช้จ่าย" },
];

export interface ProviderRecord {
  id: string;
  name: string;
  providerKind: ProviderKind | null;
  approvalStatus: ApprovalStatus;
  approvedScope: string | null;
  selectionCriteria: SelectionCriterion[];
  selectionNotes: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  decisionNote: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  address: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  inspectionSamplePct: number | null;
  isActive: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  suspendedByName: string | null;
  suspendedScore: number | null;
  suspendedThreshold: number | null;
  teamCount: number;
  technicianCount: number;
  poCount: number;
  ncrCount: number;
}

export interface TeamRecord {
  id: string;
  name: string;
  providerType: string | null;
  providerId: string | null;
  isActive: boolean;
  memberCount: number;
}

export interface TechnicianRecord {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  providerId: string | null;
  isActive: boolean;
  isTeamLead: boolean;
}

export interface ProviderRegister {
  providers: ProviderRecord[];
  teams: TeamRecord[];
  technicians: TechnicianRecord[];
  criteria: CriterionOption[];
}

export const EMPTY_REGISTER: ProviderRegister = {
  providers: [], teams: [], technicians: [], criteria: FALLBACK_CRITERIA,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function int(value: unknown): number {
  return num(value) ?? 0;
}

export function parseCriteriaCatalog(value: unknown): CriterionOption[] {
  if (!Array.isArray(value)) return FALLBACK_CRITERIA;
  const parsed = value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const code = text(raw.code);
    const label = text(raw.label);
    if (!code || !label) return [];
    return [{ code, label, help: text(raw.help) ?? "", appliesTo: text(raw.appliesTo) ?? "both" }];
  });
  return parsed.length > 0 ? parsed : FALLBACK_CRITERIA;
}

function parseSelectionCriteria(value: unknown): SelectionCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const code = text(raw.code);
    if (!code) return [];
    return [{ code, label: text(raw.label) ?? code, met: raw.met === true, note: text(raw.note) }];
  });
}

function parseKind(value: unknown): ProviderKind | null {
  const raw = text(value);
  return raw && (PROVIDER_KINDS as readonly string[]).includes(raw) ? (raw as ProviderKind) : null;
}

function parseStatus(value: unknown): ApprovalStatus {
  const raw = text(value);
  return raw && (APPROVAL_STATUSES as readonly string[]).includes(raw) ? (raw as ApprovalStatus) : "pending";
}

export function parseProviderRegister(value: unknown): ProviderRegister {
  if (!value || typeof value !== "object") return EMPTY_REGISTER;
  const raw = value as Record<string, unknown>;

  const providers = Array.isArray(raw.providers)
    ? raw.providers.flatMap((row): ProviderRecord[] => {
        if (!row || typeof row !== "object") return [];
        const p = row as Record<string, unknown>;
        const id = text(p.id);
        const name = text(p.name);
        if (!id || !name) return [];
        return [{
          id, name,
          providerKind: parseKind(p.providerKind),
          approvalStatus: parseStatus(p.approvalStatus),
          approvedScope: text(p.approvedScope),
          selectionCriteria: parseSelectionCriteria(p.selectionCriteria),
          selectionNotes: text(p.selectionNotes),
          approvedAt: text(p.approvedAt),
          approvedByName: text(p.approvedByName),
          decisionNote: text(p.decisionNote),
          contactName: text(p.contactName),
          phone: text(p.phone),
          email: text(p.email),
          taxId: text(p.taxId),
          address: text(p.address),
          leadTimeDays: num(p.leadTimeDays),
          paymentTerms: text(p.paymentTerms),
          inspectionSamplePct: num(p.inspectionSamplePct),
          isActive: p.isActive !== false,
          suspendedAt: text(p.suspendedAt),
          suspensionReason: text(p.suspensionReason),
          suspendedByName: text(p.suspendedByName),
          suspendedScore: num(p.suspendedScore),
          suspendedThreshold: num(p.suspendedThreshold),
          teamCount: int(p.teamCount),
          technicianCount: int(p.technicianCount),
          poCount: int(p.poCount),
          ncrCount: int(p.ncrCount),
        }];
      })
    : [];

  const teams = Array.isArray(raw.teams)
    ? raw.teams.flatMap((row): TeamRecord[] => {
        if (!row || typeof row !== "object") return [];
        const t = row as Record<string, unknown>;
        const id = text(t.id);
        const name = text(t.name);
        if (!id || !name) return [];
        return [{
          id, name,
          providerType: text(t.providerType),
          providerId: text(t.providerId),
          isActive: t.isActive !== false,
          memberCount: int(t.memberCount),
        }];
      })
    : [];

  const technicians = Array.isArray(raw.technicians)
    ? raw.technicians.flatMap((row): TechnicianRecord[] => {
        if (!row || typeof row !== "object") return [];
        const f = row as Record<string, unknown>;
        const id = text(f.id);
        const name = text(f.name);
        if (!id || !name) return [];
        return [{
          id, name,
          teamId: text(f.teamId),
          teamName: text(f.teamName),
          providerId: text(f.providerId),
          isActive: f.isActive !== false,
          isTeamLead: f.isTeamLead === true,
        }];
      })
    : [];

  return { providers, teams, technicians, criteria: parseCriteriaCatalog(raw.criteria) };
}

/** เกณฑ์ที่ถามได้จริงกับผู้ให้บริการพันธุ์นี้ — ไม่เอาช่องติ๊กที่ไม่มีความหมายมาให้คนกรอก */
export function criteriaForKind(catalog: CriterionOption[], kind: ProviderKind | null): CriterionOption[] {
  if (!kind) return catalog;
  if (kind === "both") return catalog;
  return catalog.filter((c) => c.appliesTo === "both" || c.appliesTo === kind);
}

export interface ProviderDraft {
  name: string;
  providerKind: string;
  approvedScope: string;
  inspectionSamplePct: string;
  leadTimeDays: string;
  criteria: SelectionCriterion[];
}

export function providerFormError(draft: ProviderDraft): string | null {
  if (!draft.name.trim()) return "ระบุชื่อผู้ให้บริการก่อน";
  if (!parseKind(draft.providerKind)) return "เลือกว่ารายนี้ขายวัสดุให้เรา หรือรับงานติดตั้งแทนเรา";
  const pct = draft.inspectionSamplePct.trim();
  if (pct !== "") {
    const value = Number(pct);
    if (!Number.isFinite(value) || value < 0 || value > 100) return "สัดส่วนการสุ่มตรวจต้องอยู่ระหว่าง 0 ถึง 100";
  }
  const lead = draft.leadTimeDays.trim();
  if (lead !== "") {
    const value = Number(lead);
    if (!Number.isFinite(value) || value < 0) return "ระยะเวลารอของ (วัน) ติดลบไม่ได้";
  }
  return null;
}

/**
 * เหตุผลที่ยัง "อนุมัติไม่ได้" — ต้องบอกให้ครบทุกข้อในประโยคเดียว
 * ไม่ใช่ให้คนกดแล้วโดนปฏิเสธทีละข้อ (ทั้งสองข้อนี้คือสิ่งที่ ISO 8.4.1 ถามหา)
 */
export function approvalBlockers(provider: ProviderRecord): string[] {
  const blockers: string[] = [];
  if (!provider.providerKind) blockers.push("ยังไม่ได้เลือกชนิดของผู้ให้บริการ");
  if (!provider.approvedScope || !provider.approvedScope.trim()) {
    blockers.push("ยังไม่ได้ระบุขอบเขตที่อนุมัติ (อนุมัติให้ส่งของอะไร หรือรับงานติดตั้งชนิดไหน)");
  }
  if (provider.selectionCriteria.length === 0) blockers.push("ยังไม่ได้บันทึกเกณฑ์ที่ใช้ตัดสินสักข้อ");
  return blockers;
}

export function canApprove(provider: ProviderRecord): boolean {
  return provider.approvalStatus !== "suspended" && approvalBlockers(provider).length === 0;
}

/** ผูกทีมช่าง/ช่างเข้ากับรายนี้ได้ไหม — พันธุ์ต้องใช่ และต้องอนุมัติแล้ว */
export function canTakeInstallers(provider: ProviderRecord): boolean {
  return provider.approvalStatus === "approved"
    && (provider.providerKind === "labor" || provider.providerKind === "both");
}

/** ออกใบสั่งซื้อให้รายนี้ได้ไหม */
export function canTakePurchaseOrders(provider: ProviderRecord): boolean {
  return provider.approvalStatus === "approved" && provider.isActive
    && (provider.providerKind === "material" || provider.providerKind === "both");
}

/**
 * ข้อความสถานะของทะเบียนที่ต้องพูดความจริง
 * "ยังไม่มีใครในทะเบียน" กับ "มีแต่ยังไม่อนุมัติ" เป็นคนละเรื่องและต้องทำคนละอย่างต่อ
 */
export function registerEmptyMessage(register: ProviderRegister): string | null {
  if (register.providers.length === 0) {
    return "ทะเบียนผู้ให้บริการยังว่างเปล่า — งานติดตั้งราวครึ่งหนึ่งของบริษัททำโดยทีมภายนอก แต่ยังไม่มีบริษัทไหนถูกบันทึกไว้ที่นี่ เริ่มจากกดปุ่ม \"เพิ่มผู้ให้บริการ\" แล้วกรอกทีละราย";
  }
  if (!register.providers.some((p) => p.approvalStatus === "approved")) {
    return "มีผู้ให้บริการในทะเบียนแล้ว แต่ยังไม่มีรายไหนผ่านการอนุมัติ — จึงยังออกใบสั่งซื้อหรือผูกทีมช่างเข้ากับใครไม่ได้";
  }
  return null;
}

/** ทีมและช่างที่ยังไม่รู้ว่าเป็นของบริษัทเราเองหรือของใคร */
export function unassignedRosterMessage(register: ProviderRegister): string | null {
  const teams = register.teams.filter((t) => !t.providerType).length;
  const techs = register.technicians.filter((f) => f.isActive && !f.providerId).length;
  if (teams === 0) return null;
  return `ยังมีทีมช่าง ${teams} ทีมที่ไม่ได้ระบุว่าเป็นทีมภายในหรือทีมรับเหมาภายนอก (ช่างที่ยังไม่ระบุสังกัด ${techs} คน) — ระบุให้ครบแล้วระบบจะแยกงานของคนนอกออกจากงานของเราได้`;
}

// ---------------------------------------------------------------------------
// P5-10 — กระดานคะแนนและการระงับ
// ---------------------------------------------------------------------------

export interface ProviderScoreTeam {
  teamId: string;
  teamName: string;
  evalScore: number | null;
  jobCount: number;
  isProvisional: boolean;
  hasData: boolean;
}

export interface ProviderScoreRow {
  providerId: string;
  providerName: string;
  approvalStatus: ApprovalStatus;
  providerScore: number | null;
  belowThreshold: boolean;
  settledTeams: number;
  settledJobs: number;
  totalTeams: number;
  reason: string;
  teams: ProviderScoreTeam[];
}

export interface ProviderScoreBoard {
  threshold: number;
  rows: ProviderScoreRow[];
  candidateCount: number;
}

export const EMPTY_SCORE_BOARD: ProviderScoreBoard = { threshold: 60, rows: [], candidateCount: 0 };

export function parseScoreBoard(value: unknown): ProviderScoreBoard {
  if (!value || typeof value !== "object") return EMPTY_SCORE_BOARD;
  const raw = value as Record<string, unknown>;
  const policy = (raw.policy && typeof raw.policy === "object" ? raw.policy : {}) as Record<string, unknown>;
  const rows = Array.isArray(raw.providers)
    ? raw.providers.flatMap((row): ProviderScoreRow[] => {
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        const providerId = text(r.providerId);
        const providerName = text(r.providerName);
        if (!providerId || !providerName) return [];
        return [{
          providerId, providerName,
          approvalStatus: parseStatus(r.approvalStatus),
          providerScore: num(r.providerScore),
          belowThreshold: r.belowThreshold === true,
          settledTeams: int(r.settledTeams),
          settledJobs: int(r.settledJobs),
          totalTeams: int(r.totalTeams),
          reason: text(r.reason) ?? "",
          teams: Array.isArray(r.teams)
            ? r.teams.flatMap((t): ProviderScoreTeam[] => {
                if (!t || typeof t !== "object") return [];
                const tt = t as Record<string, unknown>;
                const teamId = text(tt.teamId);
                if (!teamId) return [];
                return [{
                  teamId,
                  teamName: text(tt.teamName) ?? "ไม่ระบุชื่อทีม",
                  evalScore: num(tt.evalScore),
                  jobCount: int(tt.jobCount),
                  isProvisional: tt.isProvisional !== false,
                  hasData: tt.hasData === true,
                }];
              })
            : [],
        }];
      })
    : [];
  return {
    threshold: num(policy.scoreThreshold) ?? 60,
    rows,
    candidateCount: int(raw.candidateCount),
  };
}

/** ผู้ที่ระบบ "ชี้ตัวให้พิจารณา" — ไม่ใช่ผู้ที่ระบบสั่งระงับ */
export function suspensionCandidates(board: ProviderScoreBoard): ProviderScoreRow[] {
  return board.rows.filter((r) => r.belowThreshold && r.approvalStatus === "approved");
}

export const MIN_SUSPENSION_REASON_LENGTH = 10;

export function suspensionReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "การระงับผู้ให้บริการต้องระบุเหตุผล — นี่คือการตัดงานของคนกลุ่มหนึ่ง";
  if (trimmed.length < MIN_SUSPENSION_REASON_LENGTH) {
    return "เหตุผลสั้นเกินไป กรุณาอธิบายให้คนที่มาอ่านทีหลังเข้าใจได้ว่าเกิดอะไรขึ้น";
  }
  return null;
}

export function scoreBoardEmptyMessage(board: ProviderScoreBoard): string | null {
  if (board.rows.length === 0) {
    return "ยังไม่มีผู้ให้บริการงานติดตั้งในทะเบียน จึงยังไม่มีคะแนนให้พิจารณา";
  }
  if (board.rows.every((r) => r.providerScore === null)) {
    return `มีผู้ให้บริการในทะเบียนแล้ว แต่ยังไม่มีรายไหนที่คะแนนนิ่งพอจะใช้ตัดสิน (เกณฑ์พิจารณา: ต่ำกว่า ${board.threshold} จาก 100)`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// P5-9 — ใบเคลมผู้ขายที่ผูกกับทะเบียน
// ---------------------------------------------------------------------------

export interface SupplierClaimRow {
  id: string;
  status: string;
  supplierName: string | null;
  supplierId: string | null;
  registeredName: string | null;
  matchMethod: string | null;
  productName: string | null;
  orderNumber: string | null;
  claimAmount: number | null;
}

export interface SupplierClaims {
  claims: SupplierClaimRow[];
  unlinked: number;
  withName: number;
}

export const EMPTY_CLAIMS: SupplierClaims = { claims: [], unlinked: 0, withName: 0 };

export function parseSupplierClaims(value: unknown): SupplierClaims {
  if (!value || typeof value !== "object") return EMPTY_CLAIMS;
  const raw = value as Record<string, unknown>;
  const claims = Array.isArray(raw.claims)
    ? raw.claims.flatMap((row): SupplierClaimRow[] => {
        if (!row || typeof row !== "object") return [];
        const c = row as Record<string, unknown>;
        const id = text(c.id);
        if (!id) return [];
        return [{
          id,
          status: text(c.status) ?? "draft",
          supplierName: text(c.supplierName),
          supplierId: text(c.supplierId),
          registeredName: text(c.registeredName),
          matchMethod: text(c.matchMethod),
          productName: text(c.productName),
          orderNumber: text(c.orderNumber),
          claimAmount: num(c.claimAmount),
        }];
      })
    : [];
  return { claims, unlinked: int(raw.unlinked), withName: int(raw.withName) };
}

/**
 * เหตุผลที่ใบนี้ยังผูกกับทะเบียนไม่ได้ — ต้องแยก "ไม่ได้กรอกชื่อ" ออกจาก "กรอกแล้วแต่ไม่รู้จัก"
 * เพราะสองอย่างนี้ต้องทำคนละอย่างต่อ (ไปหาว่าใครขาย vs ไปเพิ่มบริษัทลงทะเบียน)
 */
export function claimMatchStatus(claim: SupplierClaimRow): string {
  if (claim.supplierId) {
    return claim.matchMethod === "manual" ? "ผูกด้วยมือ" : "ระบบจับคู่ให้เพราะชื่อตรงกัน";
  }
  if (!claim.supplierName || !claim.supplierName.trim()) {
    return "ใบนี้ไม่ได้ระบุชื่อผู้ขายไว้เลย จึงไม่มีอะไรให้เทียบ";
  }
  return "กรอกชื่อผู้ขายไว้ แต่ยังไม่มีบริษัทชื่อนี้ในทะเบียน";
}

export function claimMatchSummary(claims: SupplierClaims): string {
  const linked = claims.claims.length - claims.unlinked;
  const noName = claims.claims.length - claims.withName;
  return `ใบเคลมทั้งหมด ${claims.claims.length} ใบ · ผูกกับทะเบียนแล้ว ${linked} ใบ · ยังไม่ผูก ${claims.unlinked} ใบ (ในจำนวนนี้ ${noName} ใบไม่ได้กรอกชื่อผู้ขายไว้ตั้งแต่แรก จึงไม่มีอะไรให้จับคู่)`;
}

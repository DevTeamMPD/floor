"use client";
export const dynamic = "force-dynamic";

/**
 * P5-7 / P5-9 / P5-10 — หน้าทะเบียนผู้ให้บริการภายนอก
 *
 * ความจริงที่หน้านี้ต้องยอมรับตั้งแต่วันแรก: ทะเบียนยังว่างเปล่า
 * งานติดตั้งราวครึ่งหนึ่งของบริษัททำโดยทีมภายนอก แต่ไม่มีใครในนั้นอยู่ในระบบเลย
 * หน้าจอจึงต้องบอกความจริงข้อนี้ ไม่ใช่โชว์ตารางว่างเฉย ๆ ให้คนเดาว่าโหลดไม่ขึ้น
 *
 * การเขียนทุกอย่างผ่าน RPC — หน้านี้ไม่มีสิทธิ์ insert/update ตารางใดโดยตรง
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { useCanDo } from "@/components/layout/viewer-role";
import {
  PROVIDER_REGISTER_SNAPSHOT_RPC, UPSERT_PROVIDER_RPC, DECIDE_PROVIDER_APPROVAL_RPC,
  SET_TEAM_PROVIDER_RPC, SET_TECHNICIAN_PROVIDER_RPC, PROVIDER_SCORE_BOARD_RPC,
  SUSPEND_PROVIDER_RPC, REINSTATE_PROVIDER_RPC, SUSPENSION_HISTORY_RPC,
  SUPPLIER_CLAIMS_SNAPSHOT_RPC, MATCH_SUPPLIER_CLAIMS_RPC, LINK_SUPPLIER_CLAIM_RPC,
  PROVIDER_KINDS, PROVIDER_KIND_LABELS, PROVIDER_KIND_HELP, APPROVAL_STATUS_LABELS,
  EMPTY_REGISTER, EMPTY_SCORE_BOARD, EMPTY_CLAIMS,
  parseProviderRegister, parseScoreBoard, parseSupplierClaims,
  criteriaForKind, providerFormError, approvalBlockers, canApprove, canTakeInstallers,
  registerEmptyMessage, unassignedRosterMessage, suspensionCandidates, suspensionReasonError,
  scoreBoardEmptyMessage, claimMatchStatus, claimMatchSummary,
  type ProviderKind, type ProviderRecord, type SelectionCriterion,
} from "@/lib/provider-register";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-slate-200 text-slate-600",
  suspended: "bg-red-100 text-red-700",
};

const TABS = [
  { id: "register", label: "ทะเบียนผู้ให้บริการ" },
  { id: "roster", label: "ทีมช่างและช่าง" },
  { id: "score", label: "คะแนนและการระงับ" },
  { id: "claims", label: "ใบเคลมผู้ขาย" },
] as const;
type TabId = typeof TABS[number]["id"];

const EMPTY_FORM = {
  id: "" as string, name: "", providerKind: "" as string, contactName: "", phone: "", email: "",
  taxId: "", address: "", leadTimeDays: "", paymentTerms: "", inspectionSamplePct: "",
  approvedScope: "", selectionNotes: "", isActive: true,
};

export default function ProvidersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<TabId>("register");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [register, setRegister] = useState(EMPTY_REGISTER);
  const [board, setBoard] = useState(EMPTY_SCORE_BOARD);
  const [claims, setClaims] = useState(EMPTY_CLAIMS);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [criteria, setCriteria] = useState<SelectionCriterion[]>([]);

  const [suspendTarget, setSuspendTarget] = useState<ProviderRecord | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [reinstateTarget, setReinstateTarget] = useState<ProviderRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [reg, sb, cl, hi] = await Promise.all([
      supabase.rpc(PROVIDER_REGISTER_SNAPSHOT_RPC),
      supabase.rpc(PROVIDER_SCORE_BOARD_RPC),
      supabase.rpc(SUPPLIER_CLAIMS_SNAPSHOT_RPC),
      supabase.rpc(SUSPENSION_HISTORY_RPC, { p_provider_id: null }),
    ]);
    if (reg.error) toast.error(floorErrorMessage(reg.error));
    setRegister(parseProviderRegister(reg.data));
    setBoard(parseScoreBoard(sb.data));
    setClaims(parseSupplierClaims(cl.data));
    const events = (hi.data as { events?: Array<Record<string, unknown>> } | null)?.events;
    setHistory(Array.isArray(events) ? events : []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const providerById = useMemo(
    () => new Map(register.providers.map((p) => [p.id, p])),
    [register.providers],
  );
  const installerProviders = useMemo(
    () => register.providers.filter(canTakeInstallers),
    [register.providers],
  );

  // สิทธิ์ "ลงมือทำ" ต้องตรงกับตำแหน่งที่ RPC ยอมรับจริง (ดู PAGE_ACTION_ROLES ใน lib/nav.ts)
  // หน้านี้เปิดให้อ่านกว้างโดยตั้งใจ แต่ปุ่มที่ RPC จะปฏิเสธต้องไม่ถูกยื่นให้คนกด
  const canUpsert = useCanDo("providers.upsert");
  const canDecide = useCanDo("providers.decide");
  const canSuspend = useCanDo("providers.suspend");
  const canLink = useCanDo("providers.link");
  const canClaims = useCanDo("providers.claims");
  const readOnly = !canUpsert && !canDecide && !canSuspend && !canLink && !canClaims;

  function openCreate() {
    setForm(EMPTY_FORM);
    setCriteria([]);
    setShowForm(true);
  }

  function openEdit(provider: ProviderRecord) {
    setForm({
      id: provider.id, name: provider.name, providerKind: provider.providerKind ?? "",
      contactName: provider.contactName ?? "", phone: provider.phone ?? "", email: provider.email ?? "",
      taxId: provider.taxId ?? "", address: provider.address ?? "",
      leadTimeDays: provider.leadTimeDays?.toString() ?? "", paymentTerms: provider.paymentTerms ?? "",
      inspectionSamplePct: provider.inspectionSamplePct?.toString() ?? "",
      approvedScope: provider.approvedScope ?? "", selectionNotes: provider.selectionNotes ?? "",
      isActive: provider.isActive,
    });
    setCriteria(provider.selectionCriteria);
    setShowForm(true);
  }

  const formCriteria = useMemo(
    () => criteriaForKind(register.criteria, (form.providerKind || null) as ProviderKind | null),
    [register.criteria, form.providerKind],
  );

  function toggleCriterion(code: string, label: string) {
    setCriteria((prev) => prev.some((c) => c.code === code)
      ? prev.filter((c) => c.code !== code)
      : [...prev, { code, label, met: true, note: null }]);
  }
  function setCriterionField(code: string, patch: Partial<SelectionCriterion>) {
    setCriteria((prev) => prev.map((c) => (c.code === code ? { ...c, ...patch } : c)));
  }

  async function saveProvider() {
    const error = providerFormError({
      name: form.name, providerKind: form.providerKind, approvedScope: form.approvedScope,
      inspectionSamplePct: form.inspectionSamplePct, leadTimeDays: form.leadTimeDays, criteria,
    });
    if (error) { toast.error(error); return; }
    setSaving(true);
    const { error: rpcError } = await supabase.rpc(UPSERT_PROVIDER_RPC, {
      p_id: form.id || null,
      p_name: form.name.trim(),
      p_provider_kind: form.providerKind,
      p_contact_name: form.contactName || null,
      p_phone: form.phone || null,
      p_email: form.email || null,
      p_tax_id: form.taxId || null,
      p_address: form.address || null,
      p_lead_time_days: form.leadTimeDays ? Number(form.leadTimeDays) : null,
      p_payment_terms: form.paymentTerms || null,
      p_inspection_sample_pct: form.inspectionSamplePct ? Number(form.inspectionSamplePct) : null,
      p_approved_scope: form.approvedScope || null,
      p_selection_criteria: criteria.map((c) => ({ code: c.code, met: c.met, note: c.note })),
      p_selection_notes: form.selectionNotes || null,
      p_is_active: form.isActive,
    });
    setSaving(false);
    if (rpcError) { toast.error(floorErrorMessage(rpcError)); return; }
    toast.success(form.id ? "แก้ไขข้อมูลผู้ให้บริการแล้ว" : "เพิ่มผู้ให้บริการเข้าทะเบียนแล้ว (สถานะ: รอพิจารณา)");
    setShowForm(false);
    await load();
  }

  async function decide(provider: ProviderRecord, decision: "approved" | "rejected") {
    let note: string | null = null;
    if (decision === "rejected") {
      note = window.prompt(`ไม่อนุมัติ "${provider.name}" เพราะอะไร (บังคับกรอก)`) ?? "";
      if (!note.trim()) { toast.error("การไม่อนุมัติต้องระบุเหตุผล"); return; }
    }
    setSaving(true);
    const { error } = await supabase.rpc(DECIDE_PROVIDER_APPROVAL_RPC, {
      p_provider_id: provider.id, p_decision: decision, p_note: note,
    });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(decision === "approved" ? `อนุมัติ "${provider.name}" แล้ว` : `บันทึกว่าไม่อนุมัติ "${provider.name}"`);
    await load();
  }

  async function linkTeam(teamId: string, value: string) {
    const providerType = value === "in_house" ? "in_house" : value === "" ? "" : "subcontract";
    if (!providerType) return;
    setSaving(true);
    const { error } = await supabase.rpc(SET_TEAM_PROVIDER_RPC, {
      p_team_id: teamId,
      p_provider_type: providerType,
      p_provider_id: providerType === "subcontract" ? value : null,
    });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success("บันทึกสังกัดของทีมแล้ว");
    await load();
  }

  async function linkTechnician(technicianId: string, providerId: string) {
    setSaving(true);
    const { error } = await supabase.rpc(SET_TECHNICIAN_PROVIDER_RPC, {
      p_technician_id: technicianId, p_provider_id: providerId || null,
    });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(providerId ? "บันทึกสังกัดของช่างแล้ว" : "ปลดสังกัดช่างแล้ว");
    await load();
  }

  async function confirmSuspend() {
    if (!suspendTarget) return;
    const error = suspensionReasonError(suspendReason);
    if (error) { toast.error(error); return; }
    setSaving(true);
    const { error: rpcError } = await supabase.rpc(SUSPEND_PROVIDER_RPC, {
      p_provider_id: suspendTarget.id, p_reason: suspendReason.trim(),
    });
    setSaving(false);
    if (rpcError) { toast.error(floorErrorMessage(rpcError)); return; }
    toast.success(`ระงับ "${suspendTarget.name}" แล้ว — รายนี้จะรับงานใหม่ไม่ได้จนกว่าจะคืนสิทธิ์`);
    setSuspendTarget(null); setSuspendReason("");
    await load();
  }

  async function confirmReinstate() {
    if (!reinstateTarget) return;
    const error = suspensionReasonError(suspendReason);
    if (error) { toast.error("การคืนสิทธิ์ต้องอธิบายว่าปัญหาถูกแก้อย่างไร (อย่างน้อย 10 ตัวอักษร)"); return; }
    setSaving(true);
    const { error: rpcError } = await supabase.rpc(REINSTATE_PROVIDER_RPC, {
      p_provider_id: reinstateTarget.id, p_reason: suspendReason.trim(),
    });
    setSaving(false);
    if (rpcError) { toast.error(floorErrorMessage(rpcError)); return; }
    toast.success(`คืนสิทธิ์ "${reinstateTarget.name}" แล้ว`);
    setReinstateTarget(null); setSuspendReason("");
    await load();
  }

  async function runClaimMatch() {
    setSaving(true);
    const { data, error } = await supabase.rpc(MATCH_SUPPLIER_CLAIMS_RPC, { p_dry_run: false });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    const result = data as Record<string, number> | null;
    toast.success(
      `จับคู่ได้ ${result?.matched ?? 0} ใบ · ชื่อกำกวมจึงไม่เดา ${result?.ambiguous ?? 0} ใบ · ` +
      `ยังไม่มีในทะเบียน ${result?.unknownName ?? 0} ใบ · ไม่ได้กรอกชื่อ ${result?.noName ?? 0} ใบ`,
    );
    await load();
  }

  async function linkClaim(claimId: string, supplierId: string) {
    setSaving(true);
    const { error } = await supabase.rpc(LINK_SUPPLIER_CLAIM_RPC, {
      p_claim_id: claimId, p_supplier_id: supplierId || null,
    });
    setSaving(false);
    if (error) { toast.error(floorErrorMessage(error)); return; }
    toast.success(supplierId ? "ผูกใบเคลมกับผู้ให้บริการแล้ว" : "ปลดการผูกแล้ว");
    await load();
  }

  const emptyMessage = registerEmptyMessage(register);
  const rosterMessage = unassignedRosterMessage(register);
  const candidates = suspensionCandidates(board);

  return (
    <div className="pb-16">
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">ผู้ให้บริการภายนอก</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            ทะเบียนผู้ขายวัสดุและทีมรับเหมาติดตั้ง พร้อมเหตุผลที่อนุมัติและขอบเขตที่อนุมัติ (ISO 9001 ข้อ 8.4.1)
          </p>
        </div>
        {canUpsert && (
          <button onClick={openCreate}
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            + เพิ่มผู้ให้บริการ
          </button>
        )}
      </div>

      {readOnly && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          ตำแหน่งของคุณเปิดทะเบียนนี้เพื่ออ่านได้ แต่การเพิ่ม/แก้ อนุมัติ ระงับ และผูกทีมกับบริษัท
          เป็นสิทธิ์ของผู้ดูแลระบบและฝ่ายคลัง/จัดซื้อ จึงไม่แสดงปุ่มเหล่านั้นให้กด
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === item.id
              ? "border-blue-600 font-medium text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {item.label}
            {item.id === "score" && candidates.length > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{candidates.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse text-sm text-slate-400">โหลดข้อมูล…</div>
      ) : (
        <>
          {tab === "register" && (
            <section className="space-y-4">
              {emptyMessage && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{emptyMessage}</div>
              )}
              {register.providers.map((provider) => {
                const blockers = approvalBlockers(provider);
                return (
                  <article key={provider.id} className="rounded-xl border border-slate-100 bg-white p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-semibold">{provider.name}</h2>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[provider.approvalStatus]}`}>
                        {APPROVAL_STATUS_LABELS[provider.approvalStatus]}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {provider.providerKind ? PROVIDER_KIND_LABELS[provider.providerKind] : "ยังไม่ระบุชนิด"}
                      </span>
                      {!provider.isActive && <span className="text-xs text-slate-400">ปิดการใช้งาน</span>}
                      <div className="ml-auto flex flex-wrap gap-2">
                        {canUpsert && (
                          <button onClick={() => openEdit(provider)}
                            className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">แก้ไข</button>
                        )}
                        {canDecide && provider.approvalStatus !== "approved" && provider.approvalStatus !== "suspended" && (
                          <button onClick={() => decide(provider, "approved")} disabled={!canApprove(provider) || saving}
                            title={blockers.join(" · ")}
                            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40">
                            อนุมัติ
                          </button>
                        )}
                        {canDecide && provider.approvalStatus === "pending" && (
                          <button onClick={() => decide(provider, "rejected")} disabled={saving}
                            className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">ไม่อนุมัติ</button>
                        )}
                        {canSuspend && provider.approvalStatus === "approved" && (
                          <button onClick={() => { setSuspendTarget(provider); setSuspendReason(""); }}
                            className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">ระงับ</button>
                        )}
                        {canSuspend && provider.approvalStatus === "suspended" && (
                          <button onClick={() => { setReinstateTarget(provider); setSuspendReason(""); }}
                            className="rounded-lg bg-slate-700 px-3 py-1 text-xs text-white hover:bg-slate-800">คืนสิทธิ์</button>
                        )}
                      </div>
                    </div>

                    {provider.approvalStatus === "suspended" && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        ถูกระงับโดย {provider.suspendedByName ?? "ไม่ระบุ"}
                        {provider.suspendedAt && ` เมื่อ ${new Date(provider.suspendedAt).toLocaleDateString("th-TH")}`}
                        {provider.suspendedScore !== null && ` · คะแนน ณ ตอนนั้น ${provider.suspendedScore.toFixed(1)} จากเกณฑ์ ${provider.suspendedThreshold ?? "-"}`}
                        <div className="mt-1">เหตุผล: {provider.suspensionReason}</div>
                      </div>
                    )}

                    {blockers.length > 0 && provider.approvalStatus === "pending" && (
                      <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                        ยังอนุมัติไม่ได้ เพราะ {blockers.join(" · ")}
                      </div>
                    )}

                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-slate-400">ขอบเขตที่อนุมัติ (อนุมัติให้ทำอะไร)</dt>
                        <dd className={provider.approvedScope ? "" : "text-slate-400"}>
                          {provider.approvedScope ?? "ยังไม่ระบุ"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">ผู้อนุมัติ</dt>
                        <dd className={provider.approvedByName ? "" : "text-slate-400"}>
                          {provider.approvedByName ?? "ยังไม่มีผู้อนุมัติ"}
                          {provider.approvedAt && ` · ${new Date(provider.approvedAt).toLocaleDateString("th-TH")}`}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-400">เกณฑ์ที่ใช้ตัดสิน (อนุมัติเพราะอะไร)</dt>
                        <dd>
                          {provider.selectionCriteria.length === 0 ? (
                            <span className="text-slate-400">ยังไม่ได้บันทึกเกณฑ์ไว้</span>
                          ) : (
                            <ul className="mt-1 space-y-0.5">
                              {provider.selectionCriteria.map((c) => (
                                <li key={c.code} className="text-slate-700">
                                  <span className={c.met ? "text-emerald-600" : "text-amber-600"}>{c.met ? "ผ่าน" : "ยังไม่ผ่าน"}</span>
                                  {" · "}{c.label}{c.note ? ` — ${c.note}` : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3 flex flex-wrap gap-4 border-t border-slate-50 pt-3 text-xs text-slate-500">
                      <span>ทีมช่างที่สังกัด {provider.teamCount} ทีม</span>
                      <span>ช่าง {provider.technicianCount} คน</span>
                      <span>ใบสั่งซื้อ {provider.poCount} ใบ</span>
                      <span>NC ที่เกี่ยวข้อง {provider.ncrCount} ใบ</span>
                      {provider.inspectionSamplePct !== null && <span>สุ่มตรวจตอนรับของ {provider.inspectionSamplePct}%</span>}
                      {provider.leadTimeDays !== null && <span>รอของ {provider.leadTimeDays} วัน</span>}
                      {provider.paymentTerms && <span>ชำระ {provider.paymentTerms}</span>}
                      {provider.contactName && <span>ติดต่อ {provider.contactName}</span>}
                      {provider.phone && <span>{provider.phone}</span>}
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          {tab === "roster" && (
            <section className="space-y-5">
              {rosterMessage && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{rosterMessage}</div>
              )}
              {installerProviders.length === 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  ยังไม่มีบริษัทรับเหมาที่อนุมัติแล้วในทะเบียน — ทีมช่างจึงตั้งได้แค่ &quot;ทีมภายใน&quot; เท่านั้น
                  เพิ่มบริษัทที่แท็บ &quot;ทะเบียนผู้ให้บริการ&quot; แล้วอนุมัติก่อน
                </div>
              )}

              <div className="rounded-xl border border-slate-100 bg-white">
                <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">ทีมช่าง</h2>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-400">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">ทีม</th>
                      <th className="px-4 py-2 text-left font-medium">จำนวนช่าง</th>
                      <th className="px-4 py-2 text-left font-medium">สังกัด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {register.teams.map((team) => (
                      <tr key={team.id}>
                        <td className="px-4 py-2">{team.name}</td>
                        <td className="px-4 py-2 text-slate-500">{team.memberCount} คน</td>
                        <td className="px-4 py-2">
                          <select value={team.providerType === "subcontract" ? (team.providerId ?? "") : (team.providerType ?? "")}
                            onChange={(event) => linkTeam(team.id, event.target.value)} disabled={saving || !canLink}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                            <option value="">— ยังไม่ระบุ —</option>
                            <option value="in_house">ทีมภายในของบริษัท</option>
                            {installerProviders.map((p) => (
                              <option key={p.id} value={p.id}>ทีมรับเหมา · {p.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-slate-100 bg-white">
                <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">ช่างรายคน</h2>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-400">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">ชื่อ</th>
                      <th className="px-4 py-2 text-left font-medium">ทีม</th>
                      <th className="px-4 py-2 text-left font-medium">บริษัทต้นสังกัด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {register.technicians.map((tech) => (
                      <tr key={tech.id} className={tech.isActive ? "" : "text-slate-400"}>
                        <td className="px-4 py-2">
                          {tech.name}
                          {tech.isTeamLead && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">หัวหน้าทีม</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{tech.teamName ?? "ยังไม่มีทีม"}</td>
                        <td className="px-4 py-2">
                          <select value={tech.providerId ?? ""} disabled={saving || !canLink}
                            onChange={(event) => linkTechnician(tech.id, event.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                            <option value="">ช่างของบริษัทเราเอง</option>
                            {installerProviders.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "score" && (
            <section className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                ระบบทำได้สองอย่างเท่านั้น: <b>ชี้ตัว</b>ผู้ที่คะแนนต่ำกว่าเกณฑ์ {board.threshold} จาก 100 ให้พิจารณา
                และ<b>บังคับใช้</b>เมื่อคนตัดสินใจแล้ว — ระบบไม่ระงับใครเอง เพราะคะแนนต่ำอาจมาจากงานที่ยากผิดปกติ
                หรือข้อมูลที่ยังน้อยเกินไป คนที่รู้บริบทต้องเป็นคนตัดสินและเซ็นชื่อกำกับ
              </div>
              {scoreBoardEmptyMessage(board) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{scoreBoardEmptyMessage(board)}</div>
              )}
              {board.rows.map((row) => {
                const provider = providerById.get(row.providerId);
                return (
                  <article key={row.providerId} className="rounded-xl border border-slate-100 bg-white p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-semibold">{row.providerName}</h3>
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[row.approvalStatus]}`}>
                        {APPROVAL_STATUS_LABELS[row.approvalStatus]}
                      </span>
                      {row.belowThreshold && row.approvalStatus === "approved" && (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">เข้าเกณฑ์ควรพิจารณาระงับ</span>
                      )}
                      <span className="ml-auto text-lg font-semibold tabular-nums">
                        {row.providerScore === null ? <span className="text-sm font-normal text-slate-400">ยังไม่มีคะแนน</span> : row.providerScore.toFixed(1)}
                      </span>
                      {provider && row.approvalStatus === "approved" && (
                        <button onClick={() => { setSuspendTarget(provider); setSuspendReason(""); }}
                          className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">ระงับ</button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{row.reason}</p>
                    {row.teams.length > 0 && (
                      <ul className="mt-3 space-y-1 border-t border-slate-50 pt-3 text-xs text-slate-500">
                        {row.teams.map((team) => (
                          <li key={team.teamId}>
                            {team.teamName} · {team.evalScore === null ? "ยังไม่มีคะแนน" : `${team.evalScore.toFixed(1)} คะแนน`}
                            {" · "}{team.jobCount} งาน
                            {team.isProvisional && <span className="ml-1 text-amber-600">(คะแนนยังไม่นิ่ง ไม่ถูกใช้ตัดสิน)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}

              <div className="rounded-xl border border-slate-100 bg-white p-5">
                <h3 className="font-semibold">ประวัติการระงับและคืนสิทธิ์</h3>
                {history.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">ยังไม่เคยมีการระงับผู้ให้บริการรายใด</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {history.map((event) => (
                      <li key={String(event.id)} className="rounded-lg bg-slate-50 p-3">
                        <b>{String(event.providerName)}</b> · {event.action === "suspend" ? "ระงับ" : "คืนสิทธิ์"}
                        {" · โดย "}{String(event.decidedByName)}
                        {event.decidedAt ? ` · ${new Date(String(event.decidedAt)).toLocaleString("th-TH")}` : ""}
                        {event.aboveThreshold === true && event.action === "suspend" && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">ใช้ดุลพินิจ (คะแนนยังไม่ต่ำกว่าเกณฑ์)</span>
                        )}
                        <div className="mt-1 text-slate-600">{String(event.reason)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {tab === "claims" && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <span>{claimMatchSummary(claims)}</span>
                {canClaims && <button onClick={runClaimMatch} disabled={saving}
                  className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
                  จับคู่กับทะเบียนอัตโนมัติ
                </button>}
              </div>
              <p className="text-xs text-slate-500">
                การจับคู่เทียบชื่อแบบตรงเป๊ะเท่านั้น (ไม่สนตัวพิมพ์และช่องว่างซ้ำ) — ชื่อที่ชี้ไปหาบริษัทมากกว่าหนึ่งราย
                หรือยังไม่มีในทะเบียน จะถูกปล่อยว่างไว้ ไม่เดาให้ และไม่มีการแก้ข้อความชื่อผู้ขายที่บันทึกไว้เดิม
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-400">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">สินค้า / เลขที่คำสั่งซื้อ</th>
                      <th className="px-4 py-2 text-left font-medium">ชื่อผู้ขายที่บันทึกไว้</th>
                      <th className="px-4 py-2 text-left font-medium">สถานะการจับคู่</th>
                      <th className="px-4 py-2 text-left font-medium">ผูกกับทะเบียน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {claims.claims.map((claim) => (
                      <tr key={claim.id}>
                        <td className="px-4 py-2">
                          <div>{claim.productName ?? "ไม่ระบุสินค้า"}</div>
                          <div className="text-xs text-slate-400">{claim.orderNumber ?? "ไม่มีเลขที่คำสั่งซื้อ"}</div>
                        </td>
                        <td className="px-4 py-2">
                          {claim.supplierName ?? <span className="text-slate-400">ไม่ได้กรอกไว้</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">{claimMatchStatus(claim)}</td>
                        <td className="px-4 py-2">
                          <select value={claim.supplierId ?? ""} disabled={saving || !canClaims}
                            onChange={(event) => linkClaim(claim.id, event.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                            <option value="">— ยังไม่ผูก —</option>
                            {register.providers.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold">{form.id ? "แก้ไขผู้ให้บริการ" : "เพิ่มผู้ให้บริการเข้าทะเบียน"}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                ของใหม่จะอยู่ในสถานะ &quot;รอพิจารณา&quot; เสมอ — คนกรอกข้อมูลกับคนอนุมัติต้องแยกกัน
              </p>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">ชื่อบริษัท/ร้าน *</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">รายนี้เป็นอะไรกับเรา *</span>
                  <select value={form.providerKind} onChange={(e) => setForm({ ...form, providerKind: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">— เลือก —</option>
                    {PROVIDER_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{PROVIDER_KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                  {form.providerKind && (
                    <span className="mt-1 block text-xs text-slate-400">{PROVIDER_KIND_HELP[form.providerKind as ProviderKind]}</span>
                  )}
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  ขอบเขตที่อนุมัติ — อนุมัติให้ส่งของอะไร หรือรับงานติดตั้งชนิดไหน พื้นที่ไหน (ต้องมีก่อนอนุมัติ)
                </span>
                <textarea value={form.approvedScope} onChange={(e) => setForm({ ...form, approvedScope: e.target.value })}
                  rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>

              <div>
                <div className="mb-2 text-xs font-medium text-slate-500">
                  เกณฑ์ที่ใช้ตัดสิน — ติ๊กข้อที่ใช้จริง และบันทึกผลของแต่ละข้อ (ต้องมีอย่างน้อยหนึ่งข้อก่อนอนุมัติ)
                </div>
                <div className="space-y-2">
                  {formCriteria.map((option) => {
                    const chosen = criteria.find((c) => c.code === option.code);
                    return (
                      <div key={option.code} className="rounded-lg border border-slate-100 p-3">
                        <label className="flex items-start gap-2">
                          <input type="checkbox" checked={Boolean(chosen)} className="mt-1"
                            onChange={() => toggleCriterion(option.code, option.label)} />
                          <span>
                            <span className="text-sm font-medium">{option.label}</span>
                            <span className="block text-xs text-slate-400">{option.help}</span>
                          </span>
                        </label>
                        {chosen && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                            <select value={chosen.met ? "yes" : "no"}
                              onChange={(e) => setCriterionField(option.code, { met: e.target.value === "yes" })}
                              className="rounded border border-slate-200 px-2 py-1 text-xs">
                              <option value="yes">ผ่านเกณฑ์</option>
                              <option value="no">ยังไม่ผ่าน / มีข้อสังเกต</option>
                            </select>
                            <input value={chosen.note ?? ""} placeholder="หลักฐานหรือข้อสังเกต"
                              onChange={(e) => setCriterionField(option.code, { note: e.target.value || null })}
                              className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">ผู้ติดต่อ</span>
                  <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">เบอร์โทร</span>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">อีเมล</span>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">เลขผู้เสียภาษี</span>
                  <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">ระยะเวลารอของ (วัน)</span>
                  <input type="number" min="0" value={form.leadTimeDays}
                    onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">เงื่อนไขชำระเงิน</span>
                  <input value={form.paymentTerms} placeholder="เช่น NET30"
                    onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    สัดส่วนที่ต้องสุ่มตรวจตอนรับของจากรายนี้ (%) — ใบตรวจรับจะใช้ค่านี้เป็นค่าเริ่มต้น
                  </span>
                  <input type="number" min="0" max="100" value={form.inspectionSamplePct}
                    onChange={(e) => setForm({ ...form, inspectionSamplePct: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-500">ที่อยู่</span>
                  <textarea value={form.address} rows={2} onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-500">บันทึกเพิ่มเติมของผู้คัดเลือก</span>
                  <textarea value={form.selectionNotes} rows={2}
                    onChange={(e) => setForm({ ...form, selectionNotes: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                ยังใช้งานอยู่
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 p-5">
              <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">ยกเลิก</button>
              <button onClick={saveProvider} disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {(suspendTarget || reinstateTarget) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setSuspendTarget(null); setReinstateTarget(null); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">
              {suspendTarget ? `ระงับ "${suspendTarget.name}"` : `คืนสิทธิ์ "${reinstateTarget?.name}"`}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {suspendTarget
                ? "รายนี้จะรับงานใหม่ไม่ได้ทุกทาง — มอบนัดใหม่ไม่ได้ และออกใบสั่งซื้อไม่ได้ ส่วนงานที่ค้างอยู่ยังทำต่อและปิดได้ตามปกติ ชื่อของคุณจะถูกบันทึกไว้กับการตัดสินใจนี้"
                : "อธิบายว่าปัญหาที่ทำให้ถูกระงับได้รับการแก้ไขอย่างไร — ข้อความนี้จะถูกเก็บไว้ในประวัติพร้อมชื่อของคุณ"}
            </p>
            <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} rows={4}
              placeholder="เหตุผล (อย่างน้อย 10 ตัวอักษร)"
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setSuspendTarget(null); setReinstateTarget(null); }}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">ยกเลิก</button>
              <button onClick={suspendTarget ? confirmSuspend : confirmReinstate} disabled={saving}
                className={`rounded-lg px-4 py-2 text-sm text-white disabled:opacity-60 ${suspendTarget ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {saving ? "กำลังบันทึก…" : suspendTarget ? "ยืนยันการระงับ" : "ยืนยันการคืนสิทธิ์"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

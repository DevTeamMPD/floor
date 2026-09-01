"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { floorActionError } from "@/lib/floor-error-message";

const SNAPSHOT_RPC = "capa_snapshot";
const CREATE_RPC = "create_capa";
const ANALYSIS_RPC = "record_capa_analysis";
const SUBMIT_RPC = "submit_capa_for_verification";
const EFFECTIVENESS_RPC = "record_capa_effectiveness";

interface CatalogEntry { code: string; label: string; help?: string }
interface LinkedNcr { ncrId: string; title: string; status: string; severity: string; causeCode: string | null; jobNo: string | null }
interface UnlinkedNcr extends LinkedNcr { createdAt: string }
interface StaffOption { id: string; name: string; role: string }

interface CapaRecord {
  capaId: string; capaNo: string; title: string; status: string;
  originSystem: string; originRef: string | null;
  problemStatement: string; immediateCorrection: string | null;
  causeCode: string | null; rootCauseMethod: string | null; rootCauseAnalysis: string | null;
  correctiveAction: string | null;
  ownerStaffId: string; ownerName: string | null;
  dueDate: string | null; effectivenessDueDate: string | null;
  effectivenessCheckedAt: string | null; effectivenessCheckedByName: string | null;
  effectivenessVerdict: string | null; effectivenessEvidence: string | null;
  cancelledReason: string | null; closedAt: string | null; createdAt: string;
  overdue: boolean; linkedNcrs: LinkedNcr[];
}

interface Snapshot {
  statusCatalog: CatalogEntry[];
  effectivenessCatalog: CatalogEntry[];
  causeCodeCatalog: CatalogEntry[];
  canEdit: boolean;
  records: CapaRecord[];
  unlinkedNcrs: UnlinkedNcr[];
  staff: StaffOption[];
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  analysis: "bg-amber-100 text-amber-800",
  action: "bg-blue-100 text-blue-800",
  verification: "bg-violet-100 text-violet-800",
  closed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-500",
};

const VERDICT_STYLE: Record<string, string> = {
  effective: "bg-emerald-100 text-emerald-800",
  not_effective: "bg-red-100 text-red-800",
  inconclusive: "bg-amber-100 text-amber-800",
};

function labelOf(catalog: CatalogEntry[], code: string | null) {
  if (!code) return "—";
  return catalog.find((entry) => entry.code === code)?.label ?? code;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("th-TH", { dateStyle: "medium" });
}

export default function CapaPage() {
  const supabase = useMemo(() => createClient(), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "", problem: "", correction: "", owner: "", causeCode: "", dueDate: "",
    ncrIds: [] as string[],
  });
  const [analysis, setAnalysis] = useState({ rootCause: "", action: "", method: "", effDue: "" });
  const [effectiveness, setEffectiveness] = useState({ verdict: "", evidence: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc(SNAPSHOT_RPC);
    if (rpcError) {
      setError(floorActionError("โหลดทะเบียน CAPA", rpcError));
      setSnapshot(null);
    } else {
      setError(null);
      setSnapshot(data as unknown as Snapshot);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function createCapa() {
    if (!form.title.trim() || !form.problem.trim() || !form.owner) {
      toast.error("ต้องระบุชื่อเรื่อง คำอธิบายปัญหา และผู้รับผิดชอบ");
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc(CREATE_RPC, {
      p_title: form.title.trim(),
      p_problem_statement: form.problem.trim(),
      p_owner_staff_id: form.owner,
      p_ncr_ids: form.ncrIds.length ? form.ncrIds : null,
      p_immediate_correction: form.correction.trim() || null,
      p_cause_code: form.causeCode || null,
      p_due_date: form.dueDate || null,
    });
    setBusy(false);
    if (rpcError) { toast.error(floorActionError("เปิดเรื่อง CAPA", rpcError)); return; }
    toast.success("เปิดเรื่อง CAPA แล้ว");
    setForm({ title: "", problem: "", correction: "", owner: "", causeCode: "", dueDate: "", ncrIds: [] });
    setCreating(false);
    await load();
  }

  async function saveAnalysis(record: CapaRecord) {
    if (!analysis.rootCause.trim() || !analysis.action.trim()) {
      toast.error("ต้องระบุทั้งสาเหตุรากและมาตรการแก้ไข");
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc(ANALYSIS_RPC, {
      p_capa_id: record.capaId,
      p_root_cause_analysis: analysis.rootCause.trim(),
      p_corrective_action: analysis.action.trim(),
      p_root_cause_method: analysis.method || null,
      p_cause_code: null,
      p_effectiveness_due_date: analysis.effDue || null,
    });
    setBusy(false);
    if (rpcError) { toast.error(floorActionError("บันทึกการวิเคราะห์", rpcError)); return; }
    toast.success("บันทึกสาเหตุรากและมาตรการแก้ไขแล้ว");
    setAnalysis({ rootCause: "", action: "", method: "", effDue: "" });
    await load();
  }

  async function submitForVerification(record: CapaRecord) {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc(SUBMIT_RPC, {
      p_capa_id: record.capaId, p_effectiveness_due_date: null,
    });
    setBusy(false);
    if (rpcError) { toast.error(floorActionError("ส่งเข้าตรวจประสิทธิผล", rpcError)); return; }
    toast.success("ส่งเข้ารอตรวจประสิทธิผลแล้ว");
    await load();
  }

  async function saveEffectiveness(record: CapaRecord, close: boolean) {
    if (!effectiveness.verdict || !effectiveness.evidence.trim()) {
      toast.error("ต้องระบุทั้งผลการตรวจและหลักฐานที่ใช้ตัดสิน");
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc(EFFECTIVENESS_RPC, {
      p_capa_id: record.capaId,
      p_verdict: effectiveness.verdict,
      p_evidence: effectiveness.evidence.trim(),
      p_close: close,
    });
    setBusy(false);
    if (rpcError) { toast.error(floorActionError("บันทึกผลการตรวจประสิทธิผล", rpcError)); return; }
    toast.success(close ? "ตรวจประสิทธิผลและปิดเรื่องแล้ว" : "บันทึกผลการตรวจแล้ว");
    setEffectiveness({ verdict: "", evidence: "" });
    await load();
  }

  const records = snapshot?.records ?? [];
  const canEdit = Boolean(snapshot?.canEdit);
  const statusCatalog = snapshot?.statusCatalog ?? [];
  const effCatalog = snapshot?.effectivenessCatalog ?? [];
  const causeCatalog = snapshot?.causeCodeCatalog ?? [];

  const openCount = records.filter((r) => !["closed", "cancelled"].includes(r.status)).length;
  const awaitingCheck = records.filter((r) => r.status === "verification").length;
  const overdue = records.filter((r) => r.overdue).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-bold text-slate-900">CAPA — แก้ไขและป้องกันการเกิดซ้ำ</h1>
        <p className="mt-1 text-sm text-slate-600">
          ใบ NC บอกว่ามีอะไรผิดพลาด ส่วน CAPA บันทึกว่าทำอะไรเพื่อไม่ให้เกิดอีก
          และที่ทำไปนั้นได้ผลจริงหรือเปล่า ตามมาตรฐาน ISO 9001:2015 ข้อ 10.2
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">เรื่องที่ยังไม่ปิด</div>
          <div className="mt-0.5 text-2xl font-bold text-slate-900">{openCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">รอตรวจประสิทธิผล</div>
          <div className="mt-0.5 text-2xl font-bold text-violet-700">{awaitingCheck}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">เลยกำหนด</div>
          <div className="mt-0.5 text-2xl font-bold text-red-600">{overdue}</div>
        </div>
      </div>

      {!canEdit && !loading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          คุณดูทะเบียน CAPA ได้ แต่การเปิดเรื่องและบันทึกผลจำกัดเฉพาะผู้ดูแลระบบ หัวหน้าช่าง คลัง และ CS
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          <button onClick={() => void load()} className="ml-3 font-medium underline">ลองใหม่</button>
        </div>
      ) : null}

      {canEdit ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {!creating ? (
            <button onClick={() => setCreating(true)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              เปิดเรื่อง CAPA ใหม่
            </button>
          ) : (
            <div className="space-y-3">
              <h2 className="font-medium text-slate-900">เปิดเรื่อง CAPA ใหม่</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-700">ชื่อเรื่อง</span>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                         placeholder="เช่น ของหายระหว่างขนส่งซ้ำ ๆ"
                         className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-700">ผู้รับผิดชอบ</span>
                  <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                    <option value="">— เลือกผู้รับผิดชอบ —</option>
                    {(snapshot?.staff ?? []).map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-slate-700">ปัญหาคืออะไร</span>
                <textarea value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })}
                          rows={2} placeholder="อธิบายสิ่งที่เกิดขึ้นให้คนที่มาอ่านทีหลังเข้าใจได้"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">แก้เฉพาะหน้าไปแล้วอย่างไร (ถ้ามี)</span>
                <textarea value={form.correction} onChange={(e) => setForm({ ...form, correction: e.target.value })}
                          rows={2} placeholder="การคุมผลกระทบทันที — คนละเรื่องกับการแก้ที่ต้นเหตุ"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-700">สาเหตุเบื้องต้น</span>
                  <select value={form.causeCode} onChange={(e) => setForm({ ...form, causeCode: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                    <option value="">— ยังไม่ระบุ —</option>
                    {causeCatalog.map((entry) => (
                      <option key={entry.code} value={entry.code}>{entry.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-slate-700">กำหนดแล้วเสร็จ</span>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                         className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
              </div>

              {(snapshot?.unlinkedNcrs ?? []).length ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-700">
                    ผูกกับใบ NC ที่เป็นหลักฐาน (เลือกได้หลายใบ)
                  </div>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {(snapshot?.unlinkedNcrs ?? []).map((ncr) => (
                      <label key={ncr.ncrId} className="flex items-start gap-2 text-xs text-slate-700">
                        <input type="checkbox" checked={form.ncrIds.includes(ncr.ncrId)}
                               onChange={(e) => setForm({
                                 ...form,
                                 ncrIds: e.target.checked
                                   ? [...form.ncrIds, ncr.ncrId]
                                   : form.ncrIds.filter((id) => id !== ncr.ncrId),
                               })}
                               className="mt-0.5" />
                        <span>{ncr.title}{ncr.jobNo ? ` · งาน ${ncr.jobNo}` : ""}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <button onClick={() => void createCapa()} disabled={busy}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy ? "กำลังบันทึก…" : "เปิดเรื่อง"}
                </button>
                <button onClick={() => setCreating(false)} className="text-sm text-slate-600 hover:text-slate-900">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          กำลังโหลดทะเบียน CAPA…
        </div>
      ) : null}

      {!loading && !error && records.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center">
          <div className="text-3xl" aria-hidden>🛠️</div>
          <div className="mt-2 text-sm font-medium text-slate-900">ยังไม่มีเรื่อง CAPA</div>
          <div className="mt-1 text-xs text-slate-500">
            เมื่อมีปัญหาที่เกิดซ้ำจนต้องแก้ที่ต้นเหตุ ให้เปิดเรื่องไว้ที่นี่เพื่อติดตามจนกว่าจะพิสูจน์ได้ว่าได้ผลจริง
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {records.map((record) => {
          const open = expanded === record.capaId;
          return (
            <article key={record.capaId} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{record.capaNo}</span>
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[record.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {labelOf(statusCatalog, record.status)}
                    </span>
                    {record.originSystem !== "lendi" ? (
                      <span className="rounded-lg bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                        ต้นเรื่องจาก {record.originSystem.toUpperCase()}
                      </span>
                    ) : null}
                    {record.overdue ? (
                      <span className="rounded-lg bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">เลยกำหนด</span>
                    ) : null}
                  </div>
                  <h2 className="mt-1.5 font-medium text-slate-900">{record.title}</h2>
                  <div className="mt-0.5 text-xs text-slate-500">
                    ผู้รับผิดชอบ {record.ownerName ?? "—"} · กำหนดเสร็จ {formatDate(record.dueDate)}
                    {record.linkedNcrs.length ? ` · ผูกกับ NC ${record.linkedNcrs.length} ใบ` : ""}
                  </div>
                </div>
                <button onClick={() => { setExpanded(open ? null : record.capaId); setAnalysis({ rootCause: "", action: "", method: "", effDue: "" }); setEffectiveness({ verdict: "", evidence: "" }); }}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  {open ? "ย่อ" : "ดูรายละเอียด"}
                </button>
              </div>

              {record.effectivenessVerdict ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">ผลการตรวจประสิทธิผล:</span>
                  <span className={`rounded-lg px-2 py-0.5 font-medium ${VERDICT_STYLE[record.effectivenessVerdict] ?? "bg-slate-100"}`}>
                    {labelOf(effCatalog, record.effectivenessVerdict)}
                  </span>
                  <span className="text-slate-500">
                    ตรวจเมื่อ {formatDate(record.effectivenessCheckedAt)}
                    {record.effectivenessCheckedByName ? ` โดย ${record.effectivenessCheckedByName}` : ""}
                  </span>
                </div>
              ) : null}

              {open ? (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <section className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-slate-500">ปัญหา</div>
                      <p className="mt-0.5 text-slate-800">{record.problemStatement}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">แก้เฉพาะหน้า</div>
                      <p className="mt-0.5 text-slate-800">{record.immediateCorrection ?? "—"}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">สาเหตุราก</div>
                      <p className="mt-0.5 text-slate-800">{record.rootCauseAnalysis ?? "ยังไม่ได้บันทึก"}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">มาตรการแก้ไขที่ต้นเหตุ</div>
                      <p className="mt-0.5 text-slate-800">{record.correctiveAction ?? "ยังไม่ได้บันทึก"}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">หมวดสาเหตุ</div>
                      <p className="mt-0.5 text-slate-800">{labelOf(causeCatalog, record.causeCode)}</p>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">กำหนดตรวจประสิทธิผล</div>
                      <p className="mt-0.5 text-slate-800">{formatDate(record.effectivenessDueDate)}</p>
                    </div>
                  </section>

                  {record.effectivenessEvidence ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <span className="font-medium">หลักฐานการตรวจ:</span> {record.effectivenessEvidence}
                    </div>
                  ) : null}

                  {record.linkedNcrs.length ? (
                    <div>
                      <div className="text-xs font-medium text-slate-500">ใบ NC ที่เป็นหลักฐาน</div>
                      <ul className="mt-1 space-y-1">
                        {record.linkedNcrs.map((ncr) => (
                          <li key={ncr.ncrId} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                            {ncr.title}{ncr.jobNo ? ` · งาน ${ncr.jobNo}` : ""} · {ncr.status}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {canEdit && !["closed", "cancelled"].includes(record.status) ? (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {["draft", "analysis", "action"].includes(record.status) ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-slate-700">บันทึกสาเหตุรากและมาตรการแก้ไข</div>
                          <textarea value={analysis.rootCause} onChange={(e) => setAnalysis({ ...analysis, rootCause: e.target.value })}
                                    rows={2} placeholder="ทำไมถึงเกิด — สาเหตุที่แท้จริง ไม่ใช่อาการ"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                          <textarea value={analysis.action} onChange={(e) => setAnalysis({ ...analysis, action: e.target.value })}
                                    rows={2} placeholder="จะแก้ที่ต้นเหตุอย่างไรไม่ให้เกิดอีก"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select value={analysis.method} onChange={(e) => setAnalysis({ ...analysis, method: e.target.value })}
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                              <option value="">— วิธีวิเคราะห์ —</option>
                              <option value="5why">5 Why</option>
                              <option value="fishbone">ผังก้างปลา</option>
                              <option value="other">อื่น ๆ</option>
                            </select>
                            <input type="date" value={analysis.effDue}
                                   onChange={(e) => setAnalysis({ ...analysis, effDue: e.target.value })}
                                   className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                   aria-label="กำหนดวันตรวจประสิทธิผล" />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => void saveAnalysis(record)} disabled={busy}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                              บันทึกการวิเคราะห์
                            </button>
                            {record.status === "action" ? (
                              <button onClick={() => void submitForVerification(record)} disabled={busy}
                                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-white disabled:opacity-50">
                                แก้เสร็จแล้ว ส่งเข้าตรวจประสิทธิผล
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {record.status === "verification" ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-slate-700">
                            ตรวจประสิทธิผล — สิ่งที่แก้ไปได้ผลจริงไหม (ISO 10.2.2)
                          </div>
                          <select value={effectiveness.verdict}
                                  onChange={(e) => setEffectiveness({ ...effectiveness, verdict: e.target.value })}
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            <option value="">— เลือกผลการตรวจ —</option>
                            {effCatalog.map((entry) => (
                              <option key={entry.code} value={entry.code}>{entry.label}</option>
                            ))}
                          </select>
                          <textarea value={effectiveness.evidence}
                                    onChange={(e) => setEffectiveness({ ...effectiveness, evidence: e.target.value })}
                                    rows={2} placeholder="หลักฐานที่ใช้ตัดสิน เช่น เฝ้าดู 30 วันไม่เกิดซ้ำ"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => void saveEffectiveness(record, false)} disabled={busy}
                                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-white disabled:opacity-50">
                              บันทึกผล (ยังไม่ปิดเรื่อง)
                            </button>
                            <button onClick={() => void saveEffectiveness(record, true)}
                                    disabled={busy || effectiveness.verdict !== "effective"}
                                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                              ได้ผลจริง ปิดเรื่อง
                            </button>
                          </div>
                          <p className="text-xs text-slate-500">
                            ปิดเรื่องได้เฉพาะเมื่อผลออกมาว่า &ldquo;ได้ผล&rdquo; เท่านั้น
                            ถ้าเลือก &ldquo;ไม่ได้ผล&rdquo; ระบบจะดึงเรื่องกลับไปหาสาเหตุใหม่ให้เอง
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {record.cancelledReason ? (
                    <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                      เหตุผลที่ยกเลิก: {record.cancelledReason}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

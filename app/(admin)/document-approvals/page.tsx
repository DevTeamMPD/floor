"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { floorActionError } from "@/lib/floor-error-message";

const PENDING_RPC = "pending_document_approvals";
const APPROVE_RPC = "approve_job_document";
const REJECT_RPC = "reject_job_document";

const MIN_REASON_LENGTH = 10;

interface PendingDocument {
  documentId: string;
  jobNo: string;
  documentCode: string | null;
  documentType: string;
  documentClass: string;
  workflowStage: string;
  fileName: string;
  version: number;
  webUrl: string | null;
  changeSummary: string | null;
  systemGenerated: boolean;
  submittedAt: string;
  createdAt: string;
  lastRejectionReason: string | null;
  customerName: string | null;
  requestedByName: string | null;
  sourceEvent: string | null;
}

interface Snapshot {
  canApprove: boolean;
  pending: PendingDocument[];
}

/** ป้ายภาษาไทยของชนิดเอกสาร — ให้คนอ่านรู้ว่ากำลังอนุมัติอะไรอยู่ ไม่ใช่รหัสดิบ */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  work_order: "ใบสั่งงาน",
  boq: "รายการวัสดุและราคา (BOQ)",
  ncr: "ใบรายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด (NCR)",
  pick_confirmation: "ใบยืนยันการหยิบสินค้า",
  installation_report: "รายงานการติดตั้ง",
  customer_acceptance: "ใบตรวจรับจากลูกค้า",
  remnant_report: "รายงานเศษวัสดุ",
  handover: "ใบส่งมอบงาน",
  csat: "แบบประเมินความพึงพอใจ",
};

const STAGE_LABELS: Record<string, string> = {
  "01-sales": "ขาย",
  "02-planning": "วางแผน",
  "03-warehouse": "คลัง",
  "04-installation": "ติดตั้ง",
  "05-closing": "ปิดงาน",
};

function documentTypeLabel(type: string) {
  return DOCUMENT_TYPE_LABELS[type] ?? type;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

/** รอมานานแค่ไหน — คิวอนุมัติที่ค้างนานคือสัญญาณว่ากระบวนการติด ไม่ใช่ว่างานน้อย */
function waitingLabel(submittedAt: string) {
  const submitted = new Date(submittedAt).getTime();
  if (Number.isNaN(submitted)) return "—";
  const days = Math.floor((Date.now() - submitted) / 86_400_000);
  if (days <= 0) return "วันนี้";
  if (days === 1) return "รอมา 1 วัน";
  return `รอมา ${days} วัน`;
}

export default function DocumentApprovalsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc(PENDING_RPC);
    if (rpcError) {
      setError(floorActionError("โหลดคิวอนุมัติเอกสาร", rpcError));
      setSnapshot(null);
    } else {
      setError(null);
      setSnapshot(data as unknown as Snapshot);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function approve(document: PendingDocument) {
    setBusyId(document.documentId);
    const { error: rpcError } = await supabase.rpc(APPROVE_RPC, {
      p_document_id: document.documentId,
      p_note: null,
    });
    setBusyId(null);
    if (rpcError) { toast.error(floorActionError("อนุมัติเอกสาร", rpcError)); return; }
    toast.success(`อนุมัติ ${document.documentCode ?? document.fileName} แล้ว`);
    await load();
  }

  async function reject(document: PendingDocument) {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      toast.error("กรุณาอธิบายเหตุผลให้คนที่ต้องแก้เข้าใจได้ว่าต้องแก้อะไร");
      return;
    }
    setBusyId(document.documentId);
    const { error: rpcError } = await supabase.rpc(REJECT_RPC, {
      p_document_id: document.documentId,
      p_reason: trimmed,
    });
    setBusyId(null);
    if (rpcError) { toast.error(floorActionError("ตีกลับเอกสาร", rpcError)); return; }
    toast.success("ตีกลับเอกสารแล้ว");
    setRejectingId(null);
    setReason("");
    await load();
  }

  const pending = snapshot?.pending ?? [];
  const canApprove = Boolean(snapshot?.canApprove);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-bold text-slate-900">อนุมัติเอกสาร</h1>
        <p className="mt-1 text-sm text-slate-600">
          เอกสารควบคุม (ใบสั่งงาน, BOQ, NCR) ต้องมีคนตรวจและอนุมัติก่อนนำไปใช้สั่งงาน
          ตามมาตรฐาน ISO 9001:2015 ข้อ 7.5.2
        </p>
        <p className="mt-1 text-xs text-slate-500">
          บันทึกคุณภาพ เช่น ใบยืนยันการหยิบสินค้าและรายงานติดตั้ง ยังออกให้อัตโนมัติเหมือนเดิม
          จึงไม่มาค้างอยู่ในคิวนี้
        </p>
      </header>

      {!canApprove && !loading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          คุณดูคิวนี้ได้เพื่อความโปร่งใส แต่การกดอนุมัติหรือตีกลับจำกัดเฉพาะ
          ผู้ดูแลระบบ หัวหน้าช่าง และ CS
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          <button onClick={() => void load()} className="ml-3 font-medium underline">ลองใหม่</button>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          กำลังโหลดคิวอนุมัติ…
        </div>
      ) : null}

      {!loading && !error && pending.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center">
          <div className="text-3xl" aria-hidden>✅</div>
          <div className="mt-2 text-sm font-medium text-slate-900">ไม่มีเอกสารรออนุมัติ</div>
          <div className="mt-1 text-xs text-slate-500">
            เอกสารควบคุมที่ระบบสร้างใหม่จะมาปรากฏที่นี่เพื่อรอการตรวจ
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {pending.map((document) => (
          <article key={document.documentId} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {documentTypeLabel(document.documentType)}
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    ขั้นตอน {STAGE_LABELS[document.workflowStage] ?? document.workflowStage}
                  </span>
                  <span className="text-xs text-slate-500">ฉบับที่ {document.version}</span>
                </div>
                <h2 className="mt-1.5 truncate font-medium text-slate-900">
                  {document.documentCode ?? document.fileName}
                </h2>
                <div className="mt-0.5 text-sm text-slate-600">
                  งาน {document.jobNo}
                  {document.customerName ? ` · ลูกค้า ${document.customerName}` : ""}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>{waitingLabel(document.submittedAt)}</div>
                <div className="mt-0.5">{formatDateTime(document.submittedAt)}</div>
              </div>
            </div>

            <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">ใครเป็นคนขอ</dt>
                <dd className="mt-0.5 text-slate-800">
                  {document.requestedByName
                    ?? (document.systemGenerated ? "ระบบสร้างอัตโนมัติ" : "—")}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">สร้างจากเหตุการณ์</dt>
                <dd className="mt-0.5 text-slate-800">{document.sourceEvent ?? document.changeSummary ?? "—"}</dd>
              </div>
            </dl>

            {document.lastRejectionReason ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-medium">เคยถูกตีกลับ:</span> {document.lastRejectionReason}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {document.webUrl ? (
                <a href={document.webUrl} target="_blank" rel="noreferrer"
                   className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  เปิดอ่านเอกสาร ↗
                </a>
              ) : null}
              {canApprove ? (
                <>
                  <button
                    onClick={() => void approve(document)}
                    disabled={busyId === document.documentId}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busyId === document.documentId ? "กำลังบันทึก…" : "อนุมัติ"}
                  </button>
                  <button
                    onClick={() => {
                      setRejectingId(rejectingId === document.documentId ? null : document.documentId);
                      setReason("");
                    }}
                    disabled={busyId === document.documentId}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    ตีกลับ
                  </button>
                </>
              ) : null}
            </div>

            {rejectingId === document.documentId ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="block text-xs font-medium text-slate-700" htmlFor={`reason-${document.documentId}`}>
                  เหตุผลที่ตีกลับ (อย่างน้อย {MIN_REASON_LENGTH} ตัวอักษร)
                </label>
                <textarea
                  id={`reason-${document.documentId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="เช่น ปริมาณวัสดุในใบไม่ตรงกับหน้างาน ต้องแก้ก่อนออกใช้"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void reject(document)}
                    disabled={busyId === document.documentId || reason.trim().length < MIN_REASON_LENGTH}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    ยืนยันตีกลับ
                  </button>
                  <button onClick={() => { setRejectingId(null); setReason(""); }}
                          className="text-sm text-slate-600 hover:text-slate-900">
                    ยกเลิก
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  เอกสารจะกลับไปเป็นฉบับร่างเพื่อให้แก้แล้วส่งใหม่ ฉบับที่อนุมัติไปก่อนหน้ายังใช้งานได้ตามปกติ
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

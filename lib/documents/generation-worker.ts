import "server-only";

import { createClient } from "@supabase/supabase-js";
import { renderBoq, renderCsat, renderCustomerAcceptance, renderHandover, renderInstallationReport, renderNcr, renderPickConfirmation, renderRemnantReport, renderWorkOrder } from "@/lib/documents/render";
import { loadWorkOrderDocumentSnapshot } from "@/lib/documents/source-snapshot";
import { requiresHumanApproval } from "@/lib/documents/approval-policy";
import { convertJobDocumentToPdf, ensureJobDocumentFolder, isSharePointConfigured, uploadJobDocument } from "@/lib/sharepoint/floor-job-documents";

const BATCH_SIZE = 10;
const STALE_PROCESSING_MS = 15 * 60_000;

type GenerationJob = {
  id: string;
  job_no: string;
  document_type: string;
  workflow_stage: string;
  document_class: string;
  source_event: string;
  source_updated_at: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "retrying" | "skipped_unchanged";
  attempt_count: number;
  max_attempts: number;
  result_document_id: string | null;
};

export type DocumentGenerationRun = {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  skipped: number;
  reclaimed: number;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("document generator server environment is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function retryAt(attempt: number) {
  // 1, 2, 4, 8, 16, then max 30 minutes.  The outbox remains independent of the user workflow.
  return new Date(Date.now() + Math.min(30, 2 ** Math.max(0, attempt - 1)) * 60_000).toISOString();
}

function templateFor(documentType: string) {
  if (documentType === "work_order") return renderWorkOrder;
  if (documentType === "boq") return renderBoq;
  if (documentType === "pick_confirmation") return renderPickConfirmation;
  if (documentType === "installation_report") return renderInstallationReport;
  if (documentType === "customer_acceptance") return renderCustomerAcceptance;
  if (documentType === "remnant_report") return renderRemnantReport;
  if (documentType === "handover") return renderHandover;
  if (documentType === "csat") return renderCsat;
  if (documentType === "ncr") return renderNcr;
  return null;
}

function safeError(cause: unknown) {
  return (cause instanceof Error ? cause.message : "document generation failed").slice(0, 1000);
}

async function markFailure(job: GenerationJob, cause: unknown) {
  const admin = serviceClient();
  const terminal = job.attempt_count >= job.max_attempts;
  const { error } = await admin.from("floor_document_generation_jobs").update({
    status: terminal ? "failed" : "retrying",
    last_error: safeError(cause),
    next_attempt_at: terminal ? new Date().toISOString() : retryAt(job.attempt_count),
  }).eq("id", job.id).eq("status", "processing");
  if (error) throw new Error(`unable to record document generation failure: ${error.message}`);
  return terminal ? "failed" as const : "retrying" as const;
}

async function finalizeGeneratedDocument(job: GenerationJob, documentId: string) {
  const admin = serviceClient();
  const now = new Date().toISOString();
  const { data: document, error: documentReadError } = await admin.from("floor_job_documents")
    .select("id,job_no,document_type,document_class,workflow_stage,version,status")
    .eq("id", documentId).single();
  if (documentReadError) throw new Error(`unable to read document for approval: ${documentReadError.message}`);

  // ISO 9001:2015 ข้อ 7.5.2 — เอกสารควบคุมต้องมีคนอนุมัติก่อนใช้งาน
  // worker จึงหยุดที่ under_review แล้วปล่อยให้คนกดอนุมัติที่หน้า /document-approvals
  // ส่วนบันทึกคุณภาพ (quality_record) ยังอนุมัติอัตโนมัติเหมือนเดิม เพราะเป็นหลักฐาน
  // ว่าเกิดอะไรขึ้นไปแล้ว ไม่ใช่เอกสารที่ใครจะเอาไปสั่งงานต่อ
  // เหตุผลเต็มอยู่ใน supabase/migrations/20260902230000_document_approval_7_5_2.sql
  if (requiresHumanApproval(document.document_class)) {
    if (document.status === "draft") {
      const { error: queueError } = await admin.from("floor_job_documents")
        .update({ status: "under_review", submitted_for_review_at: now, updated_at: now })
        .eq("id", documentId).eq("status", "draft");
      if (queueError) throw new Error(`unable to queue document for approval: ${queueError.message}`);
      const { data: queuedEvent } = await admin.from("floor_job_document_events").select("id")
        .eq("document_id", documentId).eq("event_type", "submitted_for_review").limit(1).maybeSingle();
      if (!queuedEvent) {
        const { error } = await admin.from("floor_job_document_events").insert({
          document_id: documentId, event_type: "submitted_for_review",
          detail: { mode: "awaiting_human_approval", generation_job_id: job.id, document_class: document.document_class },
        });
        if (error) throw new Error(`unable to write review-queue audit: ${error.message}`);
      }
    }
    // ไม่ supersede ฉบับก่อนหน้าที่นี่ — ฉบับเดิมต้องมีผลใช้งานต่อไปจนกว่าฉบับใหม่จะผ่านการอนุมัติ
    // ตรรกะ supersede ย้ายไปอยู่ใน RPC approve_job_document() แล้ว
    return;
  }

  if (document.status !== "approved") {
    const { error: approveError } = await admin.from("floor_job_documents").update({ status: "approved", approved_at: now, effective_from: now })
      .eq("id", documentId).eq("is_system_generated", true);
    if (approveError) throw new Error(`unable to auto-approve generated document: ${approveError.message}`);
  }
  const { data: approvalEvent } = await admin.from("floor_job_document_events").select("id").eq("document_id", documentId).eq("event_type", "approved").limit(1).maybeSingle();
  if (!approvalEvent) {
    const { error } = await admin.from("floor_job_document_events").insert({ document_id: documentId, event_type: "approved", detail: { mode: "phase_1_auto_approve", generation_job_id: job.id } });
    if (error) throw new Error(`unable to write auto-approval audit: ${error.message}`);
  }

  const { data: previous, error: previousError } = await admin.from("floor_job_documents").select("id")
    .eq("job_no", document.job_no).eq("document_type", document.document_type).eq("workflow_stage", document.workflow_stage)
    .eq("status", "approved").neq("id", documentId).lt("version", document.version)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (previousError) throw new Error(`unable to find superseded document: ${previousError.message}`);
  if (previous) {
    const { error } = await admin.from("floor_job_documents").update({ status: "superseded", superseded_at: now, superseded_by: documentId }).eq("id", previous.id).eq("status", "approved");
    if (error) throw new Error(`unable to supersede prior document: ${error.message}`);
    const { data: event } = await admin.from("floor_job_document_events").select("id").eq("document_id", previous.id).eq("event_type", "superseded").limit(1).maybeSingle();
    if (!event) await admin.from("floor_job_document_events").insert({ document_id: previous.id, event_type: "superseded", detail: { superseded_by: documentId } });
  }
}

async function generateOne(job: GenerationJob) {
  const admin = serviceClient();
  if (job.result_document_id) {
    const { data: existing, error } = await admin.from("floor_job_documents").select("id").eq("id", job.result_document_id).maybeSingle();
    if (error) throw new Error(`unable to read generated document: ${error.message}`);
    if (existing) {
      await finalizeGeneratedDocument(job, job.result_document_id);
      const { error: completeError } = await admin.from("floor_document_generation_jobs").update({ status: "succeeded", last_error: null, processed_at: new Date().toISOString() }).eq("id", job.id).eq("status", "processing");
      if (completeError) throw new Error(`unable to complete generation job: ${completeError.message}`);
      return "skipped" as const;
    }
  }

  const { data: alreadyCreated, error: alreadyCreatedError } = await admin
    .from("floor_job_documents")
    .select("id")
    .eq("generation_job_id", job.id)
    .maybeSingle();
  if (alreadyCreatedError) throw new Error(`unable to check generated document: ${alreadyCreatedError.message}`);
  if (alreadyCreated) {
    await finalizeGeneratedDocument(job, alreadyCreated.id);
    const { error: completeError } = await admin.from("floor_document_generation_jobs").update({ status: "succeeded", result_document_id: alreadyCreated.id, last_error: null, processed_at: new Date().toISOString() }).eq("id", job.id).eq("status", "processing");
    if (completeError) throw new Error(`unable to complete generation job: ${completeError.message}`);
    return "skipped" as const;
  }

  const render = templateFor(job.document_type);
  if (!render) throw new Error(`document template is not registered: ${job.document_type}`);
  if (!isSharePointConfigured()) throw new Error("SharePoint integration is not configured on the server");

  const snapshot = await loadWorkOrderDocumentSnapshot(job.job_no);
  const rendered = render(snapshot);
  const { data: previous, error: previousError } = await admin
    .from("floor_job_documents")
    .select("version")
    .eq("job_no", job.job_no)
    .eq("document_type", rendered.documentType)
    .eq("workflow_stage", job.workflow_stage)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw new Error(`unable to get document revision: ${previousError.message}`);

  const version = Number(previous?.version ?? 0) + 1;
  const needsApproval = requiresHumanApproval(rendered.documentClass);
  const templateVersion = ["pick_confirmation", "installation_report"].includes(rendered.documentType) ? "P2.4" : ["customer_acceptance", "remnant_report", "handover", "csat", "ncr"].includes(rendered.documentType) ? "P2.5" : "P2.1";
  // A source revision can change without a work-order revision. Keep every controlled copy on SharePoint.
  const fileName = rendered.fileName.replace(/\.html$/i, `-V${version}.html`);
  const folder = await ensureJobDocumentFolder(job.job_no, job.workflow_stage);
  const contentBytes = new TextEncoder().encode(rendered.html);
  const htmlSource = await uploadJobDocument({
    jobNo: job.job_no,
    workflowStage: job.workflow_stage,
    fileName,
    mimeType: "text/html; charset=utf-8",
    content: contentBytes.buffer.slice(contentBytes.byteOffset, contentBytes.byteOffset + contentBytes.byteLength) as ArrayBuffer,
  });
  const uploaded = await convertJobDocumentToPdf({
    jobNo: job.job_no,
    workflowStage: job.workflow_stage,
    itemId: htmlSource.itemId,
    fileName,
  });

  const { error: folderError } = await admin.from("floor_job_document_folders").upsert({
    job_no: job.job_no,
    provider: "sharepoint",
    provider_folder_id: folder.folderId,
    provider_folder_url: folder.folderUrl,
    updated_at: new Date().toISOString(),
  });
  if (folderError) throw new Error(`unable to save document folder metadata: ${folderError.message}`);

  const { data: document, error: documentError } = await admin.from("floor_job_documents").insert({
    job_no: job.job_no,
    document_code: rendered.documentCode,
    document_type: rendered.documentType,
    document_class: rendered.documentClass,
    workflow_stage: job.workflow_stage,
    provider: "sharepoint",
    provider_item_id: uploaded.itemId,
    provider_web_url: uploaded.webUrl,
    file_name: uploaded.fileName,
    mime_type: uploaded.mimeType,
    file_size_bytes: uploaded.fileSizeBytes,
    version,
    // เอกสารควบคุมเกิดมาเป็น draft แล้ว finalizeGeneratedDocument() จะพาไป under_review
    // บันทึกคุณภาพยังเกิดมาเป็น approved ทันทีเหมือนเดิม จึงไม่มีคิวใหม่ให้ใครต้องเคลียร์
    ...(needsApproval
      ? { status: "draft" as const }
      : { status: "approved" as const, approved_at: new Date().toISOString(), effective_from: new Date().toISOString() }),
    change_summary: `สร้างอัตโนมัติจาก ${job.source_event}`,
    is_system_generated: true,
    generation_job_id: job.id,
    generated_from_version: snapshot.workOrder.revision,
    template_version: templateVersion,
    source_snapshot_json: snapshot,
  }).select("id").single();
  if (documentError) throw new Error(`unable to register generated document: ${documentError.message}`);

  const { error: eventError } = await admin.from("floor_job_document_events").insert({
    document_id: document.id,
    event_type: "created",
    detail: { source: "document_generation_worker", generation_job_id: job.id, source_event: job.source_event, template_version: templateVersion, html_source_item_id: htmlSource.itemId },
  });
  if (eventError) throw new Error(`unable to write document audit event: ${eventError.message}`);
  await finalizeGeneratedDocument(job, document.id);

  const { error: jobError } = await admin.from("floor_document_generation_jobs").update({
    status: "succeeded",
    source_snapshot_json: snapshot,
    result_document_id: document.id,
    last_error: null,
    processed_at: new Date().toISOString(),
  }).eq("id", job.id).eq("status", "processing");
  if (jobError) throw new Error(`unable to complete generation job: ${jobError.message}`);
  return "succeeded" as const;
}

export async function processDocumentGenerationJobs(): Promise<DocumentGenerationRun> {
  const admin = serviceClient();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: reclaimedRows, error: reclaimError } = await admin.from("floor_document_generation_jobs")
    .update({ status: "retrying", next_attempt_at: now, last_error: "worker lease expired; queued for retry" })
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .select("id");
  if (reclaimError) throw new Error(`unable to reclaim stale generation jobs: ${reclaimError.message}`);

  const { data: candidates, error: readError } = await admin.from("floor_document_generation_jobs")
    .select("id,job_no,document_type,workflow_stage,document_class,source_event,source_updated_at,status,attempt_count,max_attempts,result_document_id")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", now)
    .order("requested_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (readError) throw new Error(`unable to read document generation queue: ${readError.message}`);

  const run: DocumentGenerationRun = { claimed: 0, succeeded: 0, retried: 0, failed: 0, skipped: 0, reclaimed: reclaimedRows?.length ?? 0 };
  for (const candidate of (candidates ?? []) as GenerationJob[]) {
    const attemptCount = candidate.attempt_count + 1;
    const { data: claimed, error: claimError } = await admin.from("floor_document_generation_jobs").update({
      status: "processing",
      attempt_count: attemptCount,
      last_error: null,
    }).eq("id", candidate.id).in("status", ["pending", "retrying"]).select("id").maybeSingle();
    if (claimError) throw new Error(`unable to claim document generation job: ${claimError.message}`);
    if (!claimed) continue; // another worker claimed it between the read and the conditional update
    run.claimed += 1;
    const claimedJob = { ...candidate, attempt_count: attemptCount, status: "processing" as const };
    try {
      const result = await generateOne(claimedJob);
      if (result === "succeeded") run.succeeded += 1;
      else run.skipped += 1;
    } catch (cause) {
      const status = await markFailure(claimedJob, cause);
      if (status === "failed") run.failed += 1;
      else run.retried += 1;
    }
  }
  return run;
}

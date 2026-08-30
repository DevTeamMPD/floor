import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentStaff } from "@/lib/staff-server";
import { createJobDocumentUploadSession, ensureJobDocumentFolder, isSharePointConfigured, SHAREPOINT_UPLOAD_MAX_BYTES, uploadJobDocument, verifyUploadedJobDocument, type SharePointDocument } from "@/lib/sharepoint/floor-job-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WORKFLOW_STAGES = new Set(["01-sales", "02-planning", "03-warehouse", "04-installation", "05-closing"]);

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("การตั้งค่าเอกสารบนเซิร์ฟเวอร์ยังไม่ครบ");
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const jobNo = new URL(request.url).searchParams.get("jobNo")?.trim();
  if (!jobNo) return NextResponse.json({ error: "jobNo_required" }, { status: 400 });
  const { data, error } = await serviceClient().from("floor_job_documents").select("id,job_no,document_code,document_type,document_class,workflow_stage,provider,provider_web_url,file_name,mime_type,file_size_bytes,version,status,change_summary,retention_until,review_due_at,effective_from,uploaded_by,approved_by,approved_at,created_at").eq("job_no", jobNo).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data ?? [], sharePointConfigured: isSharePointConfigured() });
}

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  if (!isSharePointConfigured()) return NextResponse.json({ error: "SharePoint integration ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์" }, { status: 503 });
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const payload = await request.json() as Record<string, unknown>;
      const action = String(payload.action ?? "");
      const jobNo = String(payload.jobNo ?? "").trim();
      const workflowStage = String(payload.workflowStage ?? "").trim();
      const fileName = String(payload.fileName ?? "").trim();
      const fileSize = Number(payload.fileSize ?? 0);
      if (!jobNo || !WORKFLOW_STAGES.has(workflowStage) || !fileName || fileName.length > 180 || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > SHAREPOINT_UPLOAD_MAX_BYTES) return NextResponse.json({ error: "ข้อมูลไฟล์ไม่ถูกต้องหรือไฟล์เกิน 250 MB" }, { status: 400 });
      const admin = serviceClient();
      const { data: job } = await admin.from("install_jobs").select("job_no").eq("job_no", jobNo).maybeSingle();
      if (!job) return NextResponse.json({ error: "ไม่พบเลขงาน" }, { status: 404 });
      if (action === "create-upload-session") {
        const session = await createJobDocumentUploadSession({ jobNo, workflowStage, fileName });
        return NextResponse.json(session);
      }
      if (action === "finalize-upload-session") {
        const documentType = String(payload.documentType ?? "").trim();
        const changeSummary = String(payload.changeSummary ?? "").trim();
        const mimeType = String(payload.mimeType ?? "application/octet-stream");
        const itemId = String(payload.itemId ?? "").trim();
        if (!itemId || !documentType || documentType.length > 80 || changeSummary.length > 1000) return NextResponse.json({ error: "ข้อมูลเอกสารไม่ครบ" }, { status: 400 });
        const uploaded = await verifyUploadedJobDocument({ jobNo, workflowStage, itemId, mimeType });
        const document = await registerDocument({ admin, uploaded, jobNo, workflowStage, documentType, changeSummary, uploadedBy: staff.id });
        return NextResponse.json({ document }, { status: 201 });
      }
      return NextResponse.json({ error: "ไม่รู้จักคำสั่งอัปโหลด" }, { status: 400 });
    }
    const form = await request.formData();
    const jobNo = String(form.get("jobNo") ?? "").trim();
    const workflowStage = String(form.get("workflowStage") ?? "").trim();
    const documentType = String(form.get("documentType") ?? "").trim();
    const changeSummary = String(form.get("changeSummary") ?? "").trim();
    const file = form.get("file");
    if (!jobNo || !documentType || documentType.length > 80 || changeSummary.length > 1000 || !WORKFLOW_STAGES.has(workflowStage) || !(file instanceof File)) return NextResponse.json({ error: "ข้อมูลเอกสารไม่ครบหรือไม่ถูกต้อง" }, { status: 400 });

    const admin = serviceClient();
    const { data: job } = await admin.from("install_jobs").select("job_no").eq("job_no", jobNo).maybeSingle();
    if (!job) return NextResponse.json({ error: "ไม่พบเลขงาน" }, { status: 404 });

    const uploaded = await uploadJobDocument({ jobNo, workflowStage, fileName: file.name, mimeType: file.type, content: await file.arrayBuffer() });
    const document = await registerDocument({ admin, uploaded, jobNo, workflowStage, documentType, changeSummary, uploadedBy: staff.id });
    return NextResponse.json({ document }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "อัปโหลดเอกสารไม่สำเร็จ" }, { status: 500 });
  }
}

async function registerDocument(input: { admin: ReturnType<typeof serviceClient>; uploaded: SharePointDocument; jobNo: string; workflowStage: string; documentType: string; changeSummary: string; uploadedBy: string }) {
  const folder = await ensureJobDocumentFolder(input.jobNo, input.workflowStage);
  const { error: folderError } = await input.admin.from("floor_job_document_folders").upsert({ job_no: input.jobNo, provider: "sharepoint", provider_folder_id: folder.folderId, provider_folder_url: folder.folderUrl, updated_at: new Date().toISOString() });
  if (folderError) throw folderError;
  const { data: previous } = await input.admin.from("floor_job_documents").select("version").eq("job_no", input.jobNo).eq("document_type", input.documentType).eq("workflow_stage", input.workflowStage).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await input.admin.from("floor_job_documents").insert({ job_no: input.jobNo, document_type: input.documentType, document_class: "quality_record", workflow_stage: input.workflowStage, provider: "sharepoint", provider_item_id: input.uploaded.itemId, provider_web_url: input.uploaded.webUrl, file_name: input.uploaded.fileName, mime_type: input.uploaded.mimeType, file_size_bytes: input.uploaded.fileSizeBytes, version: (previous?.version ?? 0) + 1, change_summary: input.changeSummary || null, uploaded_by: input.uploadedBy }).select("id,job_no,document_type,workflow_stage,provider_web_url,file_name,version,status,created_at").single();
  if (error) throw error;
  const { error: eventError } = await input.admin.from("floor_job_document_events").insert({ document_id: data.id, event_type: "uploaded", actor_id: input.uploadedBy, detail: { file_name: data.file_name, workflow_stage: data.workflow_stage } });
  if (eventError) throw eventError;
  return data;
}

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentStaff } from "@/lib/staff-server";
import { ensureJobDocumentFolder, isSharePointConfigured, uploadJobDocument } from "@/lib/sharepoint/floor-job-documents";

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
    const folder = await ensureJobDocumentFolder(jobNo, workflowStage);
    const { error: folderError } = await admin.from("floor_job_document_folders").upsert({ job_no: jobNo, provider: "sharepoint", provider_folder_id: folder.folderId, provider_folder_url: folder.folderUrl, updated_at: new Date().toISOString() });
    if (folderError) throw folderError;
    const { data: previous } = await admin.from("floor_job_documents").select("version").eq("job_no", jobNo).eq("document_type", documentType).eq("workflow_stage", workflowStage).order("version", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await admin.from("floor_job_documents").insert({ job_no: jobNo, document_type: documentType, document_class: "quality_record", workflow_stage: workflowStage, provider: "sharepoint", provider_item_id: uploaded.itemId, provider_web_url: uploaded.webUrl, file_name: uploaded.fileName, mime_type: uploaded.mimeType, file_size_bytes: uploaded.fileSizeBytes, version: (previous?.version ?? 0) + 1, change_summary: changeSummary || null, uploaded_by: staff.id }).select("id,job_no,document_type,workflow_stage,provider_web_url,file_name,version,status,created_at").single();
    if (error) throw error;
    const { error: eventError } = await admin.from("floor_job_document_events").insert({ document_id: data.id, event_type: "uploaded", actor_id: staff.id, detail: { file_name: data.file_name, workflow_stage: data.workflow_stage } });
    if (eventError) throw eventError;
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "อัปโหลดเอกสารไม่สำเร็จ" }, { status: 500 });
  }
}

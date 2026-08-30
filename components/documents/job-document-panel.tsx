"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type DocumentRow = {
  id: string;
  job_no: string;
  document_code: string | null;
  document_type: string;
  document_class: "controlled_document" | "quality_record" | "external_reference";
  workflow_stage: string;
  provider: string;
  provider_web_url: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  version: number;
  status: "draft" | "under_review" | "approved" | "superseded" | "archived";
  change_summary: string | null;
  retention_until: string | null;
  review_due_at: string | null;
  effective_from: string | null;
  uploaded_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

type DocumentType = { value: string; label: string };
type Stage = { id: string; title: string; required: string[]; requiredTypes: string[]; types: DocumentType[] };

const STAGES: Stage[] = [
  { id: "01-sales", title: "1. ข้อมูลขายและสำรวจ", required: ["สรุปงาน / ข้อมูลต้นทาง", "รูปสำรวจหรือเงื่อนไขหน้างาน"], requiredTypes: ["job_summary", "site_survey"], types: [{ value: "job_summary", label: "สรุปงาน" }, { value: "site_survey", label: "แบบสำรวจ / รูปหน้างาน" }, { value: "external_reference", label: "เอกสารจากลูกค้า / BBPS" }] },
  { id: "02-planning", title: "2. แผนงาน", required: ["ใบสั่งงาน", "BOQ / รายการวัสดุ"], requiredTypes: ["work_order", "boq"], types: [{ value: "work_order", label: "ใบสั่งงาน" }, { value: "boq", label: "BOQ / รายการวัสดุ" }, { value: "technical_drawing", label: "แบบ / รายละเอียดเทคนิค" }] },
  { id: "03-warehouse", title: "3. คลังสินค้า", required: ["ใบหยิบสินค้า", "รูปสินค้าจริง"], requiredTypes: ["pick_confirmation", "picked_item_photo"], types: [{ value: "pick_confirmation", label: "ใบยืนยันการหยิบ" }, { value: "picked_item_photo", label: "รูปสินค้าจริง" }] },
  { id: "04-installation", title: "4. ติดตั้ง", required: ["รูปก่อน–หลัง", "ลายเซ็นรับงาน", "รายงานเศษ"], requiredTypes: ["installation_photo", "customer_acceptance", "remnant_report"], types: [{ value: "installation_photo", label: "รูปก่อน–หลังติดตั้ง" }, { value: "customer_acceptance", label: "ลายเซ็น / ใบรับมอบ" }, { value: "remnant_report", label: "รายงานเศษ" }, { value: "installation_report", label: "รายงานติดตั้ง" }] },
  { id: "05-closing", title: "5. หลังการขายและปิดงาน", required: ["ใบส่งมอบ", "ประเมินความพึงพอใจ", "บันทึกติดตาม / NCR (หากมี)"], requiredTypes: ["handover", "csat"], types: [{ value: "handover", label: "ใบส่งมอบ" }, { value: "csat", label: "ประเมินความพึงพอใจ" }, { value: "post_sales_followup", label: "บันทึกติดตามหลังการขาย" }, { value: "ncr", label: "NCR / ข้อร้องเรียน" }] },
];

const STATUS: Record<DocumentRow["status"], { label: string; className: string }> = {
  draft: { label: "ร่าง", className: "bg-slate-100 text-slate-700" },
  under_review: { label: "รอตรวจ", className: "bg-amber-100 text-amber-800" },
  approved: { label: "อนุมัติแล้ว", className: "bg-emerald-100 text-emerald-800" },
  superseded: { label: "ถูกแทนที่", className: "bg-violet-100 text-violet-800" },
  archived: { label: "เก็บถาวร", className: "bg-slate-200 text-slate-600" },
};

function formatDate(value: string) { return new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }); }
function fileSize(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function missingTypes(stage: Stage, documents: DocumentRow[]) { return stage.requiredTypes.filter((type) => !documents.some((item) => item.workflow_stage === stage.id && item.document_type === type && item.status !== "archived")); }

export default function JobDocumentPanel({ jobNo }: { jobNo: string }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stageId, setStageId] = useState(STAGES[0].id);
  const [documentType, setDocumentType] = useState(STAGES[0].types[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");

  const selectedStage = useMemo(() => STAGES.find((stage) => stage.id === stageId) ?? STAGES[0], [stageId]);
  const missingByStage = useMemo(() => STAGES.map((stage) => ({ stage, missing: missingTypes(stage, documents) })), [documents]);
  const missingCount = missingByStage.reduce((count, item) => count + item.missing.length, 0);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/job-documents?jobNo=${encodeURIComponent(jobNo)}`, { cache: "no-store" });
      const payload = await response.json() as { documents?: DocumentRow[]; sharePointConfigured?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "โหลดเอกสารไม่สำเร็จ");
      setDocuments(payload.documents ?? []); setConfigured(Boolean(payload.sharePointConfigured));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "โหลดเอกสารไม่สำเร็จ");
    } finally { setLoading(false); }
  }, [jobNo]);

  useEffect(() => { void (async () => { await fetch("/api/documents/process", { method: "POST" }).catch(() => null); await load(); })(); }, [load]);
  useEffect(() => { setDocumentType(selectedStage.types[0]?.value ?? "other"); }, [selectedStage]);

  async function upload() {
    if (!file) { toast.error("เลือกไฟล์ที่ต้องการแนบก่อน"); return; }
    if (file.size > 250 * 1024 * 1024) { toast.error("ไฟล์ต้องมีขนาดไม่เกิน 250 MB"); return; }
    setUploading(true);
    try {
      let response: Response;
      if (file.size <= 4 * 1024 * 1024) {
        const form = new FormData(); form.set("jobNo", jobNo); form.set("workflowStage", stageId); form.set("documentType", documentType); form.set("changeSummary", description.trim()); form.set("file", file);
        response = await fetch("/api/job-documents", { method: "POST", body: form });
      } else {
        const sessionResponse = await fetch("/api/job-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-upload-session", jobNo, workflowStage: stageId, fileName: file.name, fileSize: file.size }) });
        const session = await sessionResponse.json() as { uploadUrl?: string; error?: string };
        if (!sessionResponse.ok || !session.uploadUrl) throw new Error(session.error || "สร้างช่องทางอัปโหลดไฟล์ใหญ่ไม่สำเร็จ");
        const chunkSize = 10 * 320 * 1024;
        let uploadedItem: { id?: string } | null = null;
        for (let start = 0; start < file.size; start += chunkSize) {
          const end = Math.min(start + chunkSize, file.size);
          const chunkResponse = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${file.size}` }, body: file.slice(start, end) });
          if (chunkResponse.status === 200 || chunkResponse.status === 201) uploadedItem = await chunkResponse.json() as { id?: string };
          else if (chunkResponse.status !== 202) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จที่ ${Math.round(start / file.size * 100)}%`);
        }
        if (!uploadedItem?.id) throw new Error("อัปโหลดครบแล้วแต่ไม่ได้รับรหัสไฟล์จาก SharePoint");
        response = await fetch("/api/job-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize-upload-session", jobNo, workflowStage: stageId, documentType, changeSummary: description.trim(), fileName: file.name, fileSize: file.size, mimeType: file.type, itemId: uploadedItem.id }) });
      }
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "อัปโหลดเอกสารไม่สำเร็จ");
      toast.success("แนบเอกสารและบันทึกทะเบียนแล้ว");
      setShowUpload(false); setFile(null); setDescription(""); await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "อัปโหลดเอกสารไม่สำเร็จ");
    } finally { setUploading(false); }
  }

  function openUpload(stage?: Stage) {
    const next = stage ?? STAGES[0]; setStageId(next.id); setDocumentType(next.types[0]?.value ?? "other"); setShowUpload(true);
  }

  return <section className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-5 shadow-sm">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-semibold text-slate-950">7. เอกสารงาน</h2><p className="mt-1 text-xs text-slate-600">ทะเบียนหลักฐานตามใบงาน · ไฟล์ทางการจัดเก็บบน SharePoint</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">รีเฟรช</button><button type="button" onClick={() => openUpload()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">+ แนบเอกสาร</button></div></div>

    {!configured ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><b>SharePoint ยังไม่พร้อม:</b> ดูทะเบียนเอกสารได้ตามปกติ แต่การแนบไฟล์จะใช้งานได้หลังตั้งค่า integration บน Vercel</div> : null}

    {!loading ? <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${missingCount ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><div className="font-semibold">{missingCount ? `ยังขาดหลักฐานบังคับ ${missingCount} รายการ` : "เอกสารบังคับครบทุกขั้นงาน"}</div><p className="mt-1 text-xs leading-5">{missingCount ? "ระบบยังไม่บล็อกการทำงานในรอบนี้ แต่จะแสดงรายการที่ต้องตามเก็บให้ครบก่อนส่งต่องานหรือปิดงาน" : "ตรวจจากประเภทเอกสารในทะเบียนงาน"}</p></div> : null}

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{missingByStage.map(({ stage, missing }) => { const count = documents.filter((item) => item.workflow_stage === stage.id && item.status !== "archived").length; const complete = missing.length === 0; const labels = missing.map((type) => stage.types.find((item) => item.value === type)?.label ?? type); return <button key={stage.id} type="button" onClick={() => openUpload(stage)} className={`rounded-xl border p-3 text-left transition ${complete ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100" : "border-amber-200 bg-amber-50 hover:bg-amber-100"}`}><div className="flex items-start justify-between gap-2"><div className="text-xs font-semibold text-slate-900">{stage.title}</div><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{complete ? "ครบ" : `ขาด ${missing.length}`}</span></div><div className="mt-2 text-xs font-medium text-slate-700">{count ? `มีเอกสาร ${count} รายการ` : "ยังไม่มีเอกสาร"}</div><div className="mt-1 text-[11px] leading-4 text-slate-500">{complete ? "พร้อมสำหรับขั้นงานนี้" : `ต้องเพิ่ม: ${labels.join(" · ")}`}</div></button>; })}</div>
    <div className="mt-5 space-y-3">{loading ? <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-400">กำลังโหลดทะเบียนเอกสาร…</div> : missingByStage.map(({ stage, missing }) => { const rows = documents.filter((item) => item.workflow_stage === stage.id); const labels = missing.map((type) => stage.types.find((item) => item.value === type)?.label ?? type); return <div key={stage.id} className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-semibold text-slate-900">{stage.title}</h3><p className="mt-0.5 text-[11px] text-slate-500">ต้องมี: {stage.required.join(" · ")}</p>{missing.length ? <p className="mt-1 text-[11px] font-medium text-amber-700">ขาด: {labels.join(" · ")}</p> : <p className="mt-1 text-[11px] font-medium text-emerald-700">เอกสารบังคับครบแล้ว</p>}</div><button type="button" onClick={() => openUpload(stage)} className="shrink-0 text-xs font-semibold text-blue-700">แนบไฟล์</button></div>{rows.length ? <div className="divide-y divide-slate-100">{rows.map((item) => <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-slate-900">{item.file_name}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Rev{String(item.version).padStart(2, "0")}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[item.status].className}`}>{STATUS[item.status].label}</span></div><p className="mt-1 text-xs text-slate-500">{item.document_code ? `${item.document_code} · ` : ""}{item.document_type} · {fileSize(item.file_size_bytes)} · {formatDate(item.created_at)}</p>{item.change_summary ? <p className="mt-1 text-xs text-slate-600">{item.change_summary}</p> : null}</div><a href={item.provider_web_url} target="_blank" rel="noreferrer" className="w-fit rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">เปิด SharePoint ↗</a></div>)}</div> : <div className="px-4 py-4 text-xs text-slate-500">ยังไม่มีเอกสารในขั้นนี้</div>}</div>; })}</div>

    {showUpload ? <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-4 sm:items-center sm:justify-center" onClick={() => !uploading && setShowUpload(false)}><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-950">แนบเอกสารกับใบงาน</h3><p className="mt-1 text-xs text-slate-500">ระบบจัดโฟลเดอร์และชื่อจัดเก็บให้ตามขั้นงาน</p></div><button type="button" onClick={() => setShowUpload(false)} disabled={uploading} className="rounded-lg px-2 py-1 text-slate-500">×</button></div><div className="mt-5 space-y-4"><label className="block text-xs font-medium text-slate-700">ขั้นงาน *<select value={stageId} onChange={(event) => setStageId(event.target.value)} disabled={uploading} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label><label className="block text-xs font-medium text-slate-700">ประเภทเอกสาร *<select value={documentType} onChange={(event) => setDocumentType(event.target.value)} disabled={uploading} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{selectedStage.types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="block text-xs font-medium text-slate-700">ไฟล์ *<input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={uploading} className="mt-1 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm" /><span className="mt-1 block text-[11px] text-slate-500">รองรับสูงสุด 250 MB · ไฟล์ใหญ่แบ่งส่งอย่างปลอดภัย</span></label><label className="block text-xs font-medium text-slate-700">คำอธิบาย / เหตุผลการเพิ่มไฟล์<textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={uploading} rows={2} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowUpload(false)} disabled={uploading} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium">ยกเลิก</button><button type="button" onClick={() => void upload()} disabled={uploading || !file} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{uploading ? "กำลังอัปโหลด…" : "อัปโหลดเอกสาร"}</button></div></div></div> : null}
  </section>;
}

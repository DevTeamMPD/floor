"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { floorErrorMessage } from "@/lib/floor-error-message";
import { notifyError } from "@/lib/notify-error";

type ChatSender = "technician" | "sales" | "warehouse" | "staff";
type ReadBy = { name: string; kind: string; read_at?: string; readAt?: string };
type ExternalAttachment = { url: string; type: string; name: string };
type SyncStatus = "local" | "pending" | "delivered" | "failed";
type TicketMessage = { id: string; sender_kind: string; sender_name: string; sender_user_id?: string | null; body: string; attachment_paths: string[]; external_attachments: ExternalAttachment[]; external_source: string | null; external_sender_role: string | null; sync_status: SyncStatus; sync_error: string | null; created_at: string; read_by: ReadBy[] };

// บทบาทฝั่ง BBPS -> ป้ายภาษาไทย (สำเนาฝั่ง client ของ BBPS_ROLE_LABEL ใน lib/integrations/bbps-chat.ts
// ซึ่งเป็นโมดูลฝั่งเซิร์ฟเวอร์ล้วน import เข้ามาที่นี่ไม่ได้)
const BBPS_ROLE_LABEL: Record<string, string> = { sales: "ฝ่ายขาย", coordinator: "ผู้ประสานงาน", admin: "แอดมิน", technician: "ช่าง", foreman: "หัวหน้าช่าง", head_technician: "หัวหน้าช่าง", warehouse: "คลัง", staff: "ทีมงาน", system: "ระบบ" };
type Props = { jobNo: string; viewer: ChatSender; viewerName: string; technicianToken?: string; technicianPin?: string; requestActionLabel?: string; onRequestData?: (message: string) => Promise<void> | void };

function formatTime(iso: string) { return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
function formatDateDivider(iso: string) { return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }); }
function dateKey(iso: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso)); }
function normalizeMessages(rows: unknown): TicketMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      id: String(value.id ?? ""),
      sender_kind: String(value.sender_kind ?? value.senderKind ?? "staff"),
      sender_name: String(value.sender_name ?? value.senderName ?? "ทีม FloorNow"),
      sender_user_id: typeof value.sender_user_id === "string" ? value.sender_user_id : null,
      body: String(value.body ?? ""),
      attachment_paths: Array.isArray(value.attachment_paths) ? value.attachment_paths.map(String) : Array.isArray(value.attachmentPaths) ? value.attachmentPaths.map(String) : [],
      external_attachments: Array.isArray(value.external_attachments) ? value.external_attachments as ExternalAttachment[] : Array.isArray(value.externalAttachments) ? value.externalAttachments as ExternalAttachment[] : [],
      external_source: typeof value.external_source === "string" ? value.external_source : typeof value.externalSource === "string" ? value.externalSource : null,
      external_sender_role: typeof value.external_sender_role === "string" ? value.external_sender_role : typeof value.externalSenderRole === "string" ? value.externalSenderRole : null,
      sync_status: (String(value.sync_status ?? value.syncStatus ?? "local") as SyncStatus),
      sync_error: typeof value.sync_error === "string" ? value.sync_error : typeof value.syncError === "string" ? value.syncError : null,
      created_at: String(value.created_at ?? value.createdAt ?? new Date().toISOString()),
      read_by: Array.isArray(value.read_by) ? value.read_by as ReadBy[] : Array.isArray(value.readBy) ? value.readBy as ReadBy[] : [],
    };
  });
}

export default function TicketChat({ jobNo, viewer, viewerName, technicianToken, technicianPin, requestActionLabel, onRequestData }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const technician = viewer === "technician";
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [staffReads, setStaffReads] = useState<Record<string, ReadBy[]>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  // state ยังไม่อัปเดตทันทีหลัง load() จบ จึงต้องใช้ ref เป็นตัวบอกว่ามีของค้างส่งจริงไหม
  // ถ้าดูจาก state จะยิง /api/tickets/chat/sync ทุกครั้งที่เปิดแชท รวมถึงตั๋วที่ไม่เกี่ยวกับ BBPS
  const hasPendingRef = useRef(false);

  const load = useCallback(async () => {
    if (!jobNo) return;
    if (technician) {
      if (!technicianToken || !technicianPin) return;
      await supabase.rpc("mark_technician_ticket_messages_read", { p_token: technicianToken, p_pin: technicianPin, p_job_no: jobNo });
      const { data, error: rpcError } = await supabase.rpc("get_technician_ticket_messages", { p_token: technicianToken, p_pin: technicianPin, p_job_no: jobNo });
      if (rpcError) { const msg = `โหลดแชทไม่สำเร็จ: ${floorErrorMessage(rpcError)}`; setError(msg); notifyError(msg); return; }
      const rows = normalizeMessages(data);
      hasPendingRef.current = rows.some((message) => message.sync_status === "pending");
      setMessages(rows);
      return;
    }
    const { data, error: queryError } = await supabase.from("floor_ticket_messages").select("id,sender_kind,sender_name,sender_user_id,body,attachment_paths,external_attachments,external_source,external_sender_role,sync_status,sync_error,created_at").eq("job_no", jobNo).order("created_at", { ascending: true });
    if (queryError) { const msg = `โหลดแชทไม่สำเร็จ: ${floorErrorMessage(queryError)}`; setError(msg); notifyError(msg); return; }
    const next = normalizeMessages(data); hasPendingRef.current = next.some((message) => message.sync_status === "pending"); setMessages(next);
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const reads = next.filter((message) => message.sender_user_id !== auth.user!.id).map((message) => ({ message_id: message.id, job_no: jobNo, reader_key: `staff:${auth.user!.id}`, reader_kind: viewer, reader_name: viewerName, reader_user_id: auth.user!.id }));
      if (reads.length) await supabase.from("floor_ticket_message_reads").upsert(reads, { onConflict: "message_id,reader_key", ignoreDuplicates: true });
    }
    const { data: receiptRows } = await supabase.from("floor_ticket_message_reads").select("message_id,reader_name,reader_kind,read_at").eq("job_no", jobNo);
    const grouped: Record<string, ReadBy[]> = {};
    for (const row of receiptRows ?? []) (grouped[row.message_id] ??= []).push({ name: row.reader_name, kind: row.reader_kind, read_at: row.read_at });
    setStaffReads(grouped);
  }, [jobNo, supabase, technician, technicianPin, technicianToken]);

  const resolveAttachmentUrls = useCallback(async (rows: TicketMessage[]) => {
    const paths = [...new Set(rows.flatMap((message) => message.attachment_paths))];
    if (!paths.length) { setAttachmentUrls({}); return; }
    const form = new FormData(); form.set("action", "sign"); form.set("jobNo", jobNo);
    if (technicianToken && technicianPin) { form.set("token", technicianToken); form.set("pin", technicianPin); }
    paths.forEach((path) => form.append("path", path));
    const response = await fetch("/api/ticket-files", { method: "POST", body: form });
    const payload = await response.json() as { files?: { path: string; url: string }[] };
    if (!response.ok) return;
    setAttachmentUrls(Object.fromEntries((payload.files ?? []).map((item) => [item.path, item.url])));
  }, [jobNo, technicianPin, technicianToken]);

  useEffect(() => { void resolveAttachmentUrls(messages); }, [messages, resolveAttachmentUrls]);

  // ตั๋วที่ผูกกับ BBPS จะมีข้อความที่ trigger ตั้ง sync_status ไว้ไม่ใช่ "local"
  // หรือมีข้อความที่รับมาจาก BBPS อยู่แล้ว — ตั๋วอื่นจะไม่เข้าเงื่อนไขนี้เลย
  const bbpsLinked = useMemo(() => messages.some((message) => message.external_source === "bbps" || message.sync_status !== "local"), [messages]);
  const hasPending = useMemo(() => messages.some((message) => message.sync_status === "pending"), [messages]);

  // ผลักข้อความที่ยังไม่ถึง BBPS ออกไป — ข้อความถูกบันทึกใน LENDI ไปแล้วเสมอ
  // ถ้า route นี้ล้ม ข้อความไม่หาย แค่ค้างสถานะ "กำลังส่ง" ให้ผู้ใช้เห็นและกดลองใหม่ได้
  const flushSync = useCallback(async (messageId?: string) => {
    if (!messageId && !hasPendingRef.current) return;
    try {
      const response = await fetch("/api/tickets/chat/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobNo, messageId, token: technicianToken, pin: technicianPin }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { configured?: boolean; sent?: number; failed?: number; retrying?: number };
      if (payload.configured === false) return;
      if ((payload.sent ?? 0) + (payload.failed ?? 0) + (payload.retrying ?? 0) > 0) await load();
    } catch { /* ปล่อยผ่าน สถานะบนข้อความเป็นตัวบอกเองว่ายังไม่ถึงปลายทาง */ }
  }, [jobNo, load, technicianPin, technicianToken]);

  useEffect(() => {
    setLoading(true); void load().then(() => flushSync()).finally(() => setLoading(false));
    if (technician) { const interval = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(interval); }
    const channel = supabase.channel(`floor-ticket-chat:${jobNo}`).on("postgres_changes", { event: "*", schema: "public", table: "floor_ticket_messages", filter: `job_no=eq.${jobNo}` }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [jobNo, load, flushSync, supabase, technician]);

  async function uploadAttachments() {
    if (!attachments.length) return [];
    // Ask the server for a signed upload URL per file (small JSON only --
    // see app/api/ticket-files/route.ts for why: routing full file bytes
    // through that route hit Vercel's ~4.5 MB function body limit and failed
    // as a bare "Failed to fetch" for anything bigger, well under the 10 MB
    // this UI advertises). The actual bytes go straight from this browser to
    // Supabase Storage using that signed URL, so the server never sees them.
    const form = new FormData(); form.set("action", "prepare-upload"); form.set("jobNo", jobNo);
    if (technicianToken && technicianPin) { form.set("token", technicianToken); form.set("pin", technicianPin); }
    form.set("files", JSON.stringify(attachments.map((file) => ({ name: file.name, size: file.size }))));
    const response = await fetch("/api/ticket-files", { method: "POST", body: form });
    const payload = await response.json() as { uploads?: { path: string; signedUrl: string; token: string }[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "เตรียมอัปโหลดไฟล์ไม่สำเร็จ");
    const uploads = payload.uploads ?? [];
    if (uploads.length !== attachments.length) throw new Error("เตรียมอัปโหลดไฟล์ไม่สำเร็จ");
    const paths: string[] = [];
    for (let index = 0; index < attachments.length; index++) {
      const file = attachments[index]; const target = uploads[index];
      const { error } = await supabase.storage.from("ticket-chat-files").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw new Error(`แนบไฟล์ ${file.name} ไม่สำเร็จ: ${floorErrorMessage(error)}`);
      paths.push(target.path);
    }
    return paths;
  }

  async function send(asDataRequest = false) {
    const body = draft.trim(); if ((!body && !attachments.length) || sending || (asDataRequest && !body)) return;
    setSending(true); setError("");
    try {
      const attachmentPaths = await uploadAttachments();
      if (technician) {
        const { error: rpcError } = await supabase.rpc("post_technician_ticket_message", { p_token: technicianToken, p_pin: technicianPin, p_job_no: jobNo, p_body: body, p_attachment_paths: attachmentPaths });
        if (rpcError) throw rpcError;
      } else {
        const { data: auth } = await supabase.auth.getUser(); if (!auth.user) throw new Error("กรุณาเข้าสู่ระบบก่อนส่งข้อความ");
        const { error: insertError } = await supabase.from("floor_ticket_messages").insert({ job_no: jobNo, sender_kind: viewer, sender_name: viewerName, sender_user_id: auth.user.id, body, attachment_paths: attachmentPaths });
        if (insertError) throw insertError;
      }
      setDraft(""); setAttachments([]); await load(); void flushSync(); if (asDataRequest && onRequestData) await onRequestData(body);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : `ส่งข้อความไม่สำเร็จ: ${floorErrorMessage(cause)}`;
      setError(msg);
      notifyError(msg);
    } finally { setSending(false); }
  }

  return <section className="rounded-3xl border-2 border-cyan-300 bg-gradient-to-br from-cyan-50 via-white to-blue-50 p-4 shadow-lg shadow-cyan-100/70 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-cyan-700 px-4 py-3 text-white"><div><h3 className="text-lg font-bold">💬 แชทในตั๋ว</h3><p className="mt-0.5 text-xs text-cyan-100">ช่องทางสื่อสารหลักของงาน #{jobNo} · ข้อความจะส่งถึงอีกฝ่ายทันที</p></div><div className="flex flex-wrap items-center gap-1.5">{bbpsLinked ? <span title="ตั๋วนี้ผูกกับ BBPS CRM ข้อความจะถูกส่งถึงกันทั้งสองระบบ" className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700">🔗 เชื่อมกับ BBPS</span> : null}{hasPending ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">⏳ กำลังส่ง</span> : null}<span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">● LIVE</span></div></div>
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-cyan-100 bg-white p-3 md:max-h-[30rem]">{loading ? <div className="py-6 text-center text-xs text-slate-400">กำลังโหลดข้อความ…</div> : messages.length ? messages.map((message, index) => { const mine = message.external_source ? false : technician ? ["technician", "head_technician"].includes(message.sender_kind) : message.sender_kind === viewer; const readers = message.read_by.length ? message.read_by : (staffReads[message.id] ?? []); const showDate = index === 0 || dateKey(message.created_at) !== dateKey(messages[index - 1].created_at); return <div key={message.id}>{showDate ? <div className="my-3 flex items-center gap-2 text-[10px] font-medium text-slate-400"><span className="h-px flex-1 bg-slate-100" /><span className="rounded-full bg-slate-100 px-2 py-1">{formatDateDivider(message.created_at)}</span><span className="h-px flex-1 bg-slate-100" /></div> : null}<div className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"}`}><div className={`text-[10px] font-semibold ${mine ? "text-blue-100" : "text-slate-500"}`}>{message.sender_name}{message.external_source === "bbps" ? <span className="ml-1 rounded bg-indigo-100 px-1 py-px font-bold text-indigo-700">BBPS · {BBPS_ROLE_LABEL[message.external_sender_role ?? ""] ?? "ทีมงาน"}</span> : null}</div>{message.body ? <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p> : null}{message.attachment_paths.length ? <div className="mt-2 grid grid-cols-2 gap-2">{message.attachment_paths.map((path) => { const name = path.split("/").at(-1) || "ไฟล์แนบ"; const url = attachmentUrls[path]; const image = /\.(png|jpe?g|gif|webp|heic)$/i.test(name); return url ? <a key={path} href={url} target="_blank" rel="noreferrer" className={`overflow-hidden rounded-lg border ${mine ? "border-white/30 bg-white/10" : "border-slate-200 bg-white"}`}>{image ? <img src={url} alt={name} className="aspect-square w-full object-cover" /> : <span className="block px-2 py-2 text-xs">📎 {name}</span>}<span className={`block truncate px-2 py-1 text-[10px] ${mine ? "text-blue-100" : "text-slate-500"}`}>{image ? `🖼 ${name}` : "เปิดไฟล์"}</span></a> : <span key={path} className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-400">กำลังเตรียมไฟล์…</span>; })}</div> : null}{message.external_attachments.length ? <div className="mt-2 grid grid-cols-2 gap-2">{message.external_attachments.map((file) => <a key={file.url} href={file.url} target="_blank" rel="noreferrer noopener" className={`overflow-hidden rounded-lg border ${mine ? "border-white/30 bg-white/10" : "border-slate-200 bg-white"}`}>{file.type === "image" ? <img src={file.url} alt={file.name} className="aspect-square w-full object-cover" /> : <span className="block px-2 py-2 text-xs">📎 {file.name}</span>}<span className={`block truncate px-2 py-1 text-[10px] ${mine ? "text-blue-100" : "text-slate-500"}`}>{file.name}</span></a>)}</div> : null}{message.sync_status !== "local" ? <div className={`mt-1 flex flex-wrap items-center gap-2 text-[10px] ${mine ? "text-blue-100" : "text-slate-500"}`}>{message.sync_status === "pending" ? <span>⏳ กำลังส่งไป BBPS…</span> : null}{message.sync_status === "delivered" ? <span>✓✓ ส่งถึง BBPS แล้ว</span> : null}{message.sync_status === "failed" ? <><span className={mine ? "text-amber-100" : "text-red-600"} title={message.sync_error ?? undefined}>⚠ ส่งไป BBPS ไม่สำเร็จ</span><button type="button" disabled={retrying === message.id} onClick={async () => { setRetrying(message.id); try { await flushSync(message.id); } finally { setRetrying(null); } }} className={`rounded-md border px-1.5 py-px font-semibold disabled:opacity-50 ${mine ? "border-white/40 text-white" : "border-red-300 text-red-700"}`}>{retrying === message.id ? "กำลังลองใหม่…" : "ลองส่งใหม่"}</button></> : null}</div> : null}<div className={`mt-1 flex items-center justify-between gap-3 text-[10px] ${mine ? "text-blue-100" : "text-slate-400"}`}><span>{readers.length ? `✓ อ่านแล้ว: ${[...new Set(readers.map((reader) => reader.name))].join(", ")}` : "ยังไม่มีผู้เปิดอ่าน"}</span><span>{formatTime(message.created_at)}</span></div></div></div></div>; }) : <div className="py-6 text-center text-xs text-slate-400">ยังไม่มีข้อความ เริ่มคุยกับทีมได้เลย</div>}</div>
    <div className="mt-3 flex gap-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} placeholder="พิมพ์ข้อความถึงอีกฝ่าย…" className="min-w-0 flex-1 resize-none rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500" /><button type="button" onClick={() => void send()} disabled={!draft.trim() && !attachments.length || sending} className="self-end rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{sending ? "กำลังส่ง…" : "ส่ง"}</button></div>
    {attachments.length ? <div className="mt-2 flex flex-wrap gap-2">{attachments.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-lg border border-cyan-200 bg-white px-2 py-1 text-xs text-cyan-900">{file.type.startsWith("image/") ? "🖼" : "📎"} {file.name}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-1 font-bold text-red-500">×</button></span>)}</div> : null}
    <label className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-cyan-300 bg-white px-3 py-2 text-xs font-medium text-cyan-700 hover:bg-cyan-50">📎 แนบรูป / ไฟล์<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={(event) => { setAttachments((current) => [...current, ...Array.from(event.target.files ?? [])]); event.currentTarget.value = ""; }} /></label><p className="mt-1 text-[10px] text-slate-500">แนบได้หลายไฟล์ ไฟล์ละไม่เกิน 10 MB</p>{error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    {onRequestData ? <button type="button" onClick={() => void send(true)} disabled={!draft.trim() || sending} className="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 disabled:opacity-40">↩ {requestActionLabel || "ส่งคำขอให้ฝ่ายขายแก้ไข"}</button> : null}
  </section>;
}

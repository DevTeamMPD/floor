"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ChatSender = "technician" | "sales" | "warehouse" | "staff";
type ReadBy = { name: string; kind: string; read_at?: string; readAt?: string };
type TicketMessage = { id: string; sender_kind: string; sender_name: string; sender_user_id?: string | null; body: string; attachment_paths: string[]; created_at: string; read_by: ReadBy[] };
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

  const load = useCallback(async () => {
    if (!jobNo) return;
    if (technician) {
      if (!technicianToken || !technicianPin) return;
      await supabase.rpc("mark_technician_ticket_messages_read", { p_token: technicianToken, p_pin: technicianPin, p_job_no: jobNo });
      const { data, error: rpcError } = await supabase.rpc("get_technician_ticket_messages", { p_token: technicianToken, p_pin: technicianPin, p_job_no: jobNo });
      if (rpcError) { setError("โหลดแชทไม่สำเร็จ: " + rpcError.message); return; }
      setMessages(normalizeMessages(data));
      return;
    }
    const { data, error: queryError } = await supabase.from("floor_ticket_messages").select("id,sender_kind,sender_name,sender_user_id,body,attachment_paths,created_at").eq("job_no", jobNo).order("created_at", { ascending: true });
    if (queryError) { setError("โหลดแชทไม่สำเร็จ: " + queryError.message); return; }
    const next = normalizeMessages(data); setMessages(next);
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

  useEffect(() => {
    setLoading(true); void load().finally(() => setLoading(false));
    if (technician) { const interval = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(interval); }
    const channel = supabase.channel(`floor-ticket-chat:${jobNo}`).on("postgres_changes", { event: "*", schema: "public", table: "floor_ticket_messages", filter: `job_no=eq.${jobNo}` }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [jobNo, load, supabase, technician]);

  async function uploadAttachments() {
    if (!attachments.length) return [];
    const form = new FormData(); form.set("action", "upload"); form.set("jobNo", jobNo);
    if (technicianToken && technicianPin) { form.set("token", technicianToken); form.set("pin", technicianPin); }
    attachments.forEach((file) => form.append("file", file));
    const response = await fetch("/api/ticket-files", { method: "POST", body: form });
    const payload = await response.json() as { paths?: string[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "อัปโหลดไฟล์ไม่สำเร็จ");
    return payload.paths ?? [];
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
      setDraft(""); setAttachments([]); await load(); if (asDataRequest && onRequestData) await onRequestData(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ส่งข้อความไม่สำเร็จ"); } finally { setSending(false); }
  }

  return <section className="rounded-3xl border-2 border-cyan-300 bg-gradient-to-br from-cyan-50 via-white to-blue-50 p-4 shadow-lg shadow-cyan-100/70 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-cyan-700 px-4 py-3 text-white"><div><h3 className="text-lg font-bold">💬 แชทในตั๋ว</h3><p className="mt-0.5 text-xs text-cyan-100">ช่องทางสื่อสารหลักของงาน #{jobNo} · ข้อความจะส่งถึงอีกฝ่ายทันที</p></div><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">● LIVE</span></div>
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-cyan-100 bg-white p-3 md:max-h-[30rem]">{loading ? <div className="py-6 text-center text-xs text-slate-400">กำลังโหลดข้อความ…</div> : messages.length ? messages.map((message, index) => { const mine = technician ? ["technician", "head_technician"].includes(message.sender_kind) : message.sender_kind === viewer; const readers = message.read_by.length ? message.read_by : (staffReads[message.id] ?? []); const showDate = index === 0 || dateKey(message.created_at) !== dateKey(messages[index - 1].created_at); return <div key={message.id}>{showDate ? <div className="my-3 flex items-center gap-2 text-[10px] font-medium text-slate-400"><span className="h-px flex-1 bg-slate-100" /><span className="rounded-full bg-slate-100 px-2 py-1">{formatDateDivider(message.created_at)}</span><span className="h-px flex-1 bg-slate-100" /></div> : null}<div className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"}`}><div className={`text-[10px] font-semibold ${mine ? "text-blue-100" : "text-slate-500"}`}>{message.sender_name}</div>{message.body ? <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p> : null}{message.attachment_paths.length ? <div className="mt-2 grid grid-cols-2 gap-2">{message.attachment_paths.map((path) => { const name = path.split("/").at(-1) || "ไฟล์แนบ"; const url = attachmentUrls[path]; const image = /\.(png|jpe?g|gif|webp|heic)$/i.test(name); return url ? <a key={path} href={url} target="_blank" rel="noreferrer" className={`overflow-hidden rounded-lg border ${mine ? "border-white/30 bg-white/10" : "border-slate-200 bg-white"}`}>{image ? <img src={url} alt={name} className="aspect-square w-full object-cover" /> : <span className="block px-2 py-2 text-xs">📎 {name}</span>}<span className={`block truncate px-2 py-1 text-[10px] ${mine ? "text-blue-100" : "text-slate-500"}`}>{image ? `🖼 ${name}` : "เปิดไฟล์"}</span></a> : <span key={path} className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-400">กำลังเตรียมไฟล์…</span>; })}</div> : null}<div className={`mt-1 flex items-center justify-between gap-3 text-[10px] ${mine ? "text-blue-100" : "text-slate-400"}`}><span>{readers.length ? `✓ อ่านแล้ว: ${[...new Set(readers.map((reader) => reader.name))].join(", ")}` : "ยังไม่มีผู้เปิดอ่าน"}</span><span>{formatTime(message.created_at)}</span></div></div></div></div>; }) : <div className="py-6 text-center text-xs text-slate-400">ยังไม่มีข้อความ เริ่มคุยกับทีมได้เลย</div>}</div>
    <div className="mt-3 flex gap-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} placeholder="พิมพ์ข้อความถึงอีกฝ่าย…" className="min-w-0 flex-1 resize-none rounded-xl border border-cyan-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500" /><button type="button" onClick={() => void send()} disabled={!draft.trim() && !attachments.length || sending} className="self-end rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{sending ? "กำลังส่ง…" : "ส่ง"}</button></div>
    {attachments.length ? <div className="mt-2 flex flex-wrap gap-2">{attachments.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-lg border border-cyan-200 bg-white px-2 py-1 text-xs text-cyan-900">{file.type.startsWith("image/") ? "🖼" : "📎"} {file.name}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-1 font-bold text-red-500">×</button></span>)}</div> : null}
    <label className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-cyan-300 bg-white px-3 py-2 text-xs font-medium text-cyan-700 hover:bg-cyan-50">📎 แนบรูป / ไฟล์<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={(event) => { setAttachments((current) => [...current, ...Array.from(event.target.files ?? [])]); event.currentTarget.value = ""; }} /></label><p className="mt-1 text-[10px] text-slate-500">แนบได้หลายไฟล์ ไฟล์ละไม่เกิน 10 MB</p>{error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    {onRequestData ? <button type="button" onClick={() => void send(true)} disabled={!draft.trim() || sending} className="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 disabled:opacity-40">↩ {requestActionLabel || "ส่งคำขอให้ฝ่ายขายแก้ไข"}</button> : null}
  </section>;
}

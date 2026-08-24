"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, CheckCheck, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { canUseWebPush, subscribeBrowserToPush } from "@/lib/push-client";
import { toast } from "sonner";

interface NotificationRow {
  id: number;
  event_type: string;
  title: string;
  body: string | null;
  target_url: string | null;
  read_at: string | null;
  created_at: string;
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function NotificationCenter() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const unread = rows.filter((row) => !row.read_at).length;

  const load = useCallback(async () => {
    const { data } = await supabase.from("floor_notifications")
      .select("id,event_type,title,body,target_url,read_at,created_at")
      .order("created_at", { ascending: false }).limit(40);
    setRows((data ?? []) as NotificationRow[]);
  }, [supabase]);

  useEffect(() => {
    void load();
    void (async () => {
      if (!canUseWebPush() || Notification.permission !== "granted") return;
      const registration = await navigator.serviceWorker.getRegistration("/");
      setPushReady(Boolean(await registration?.pushManager.getSubscription()));
    })();
    const channel = supabase.channel("floor-notifications-self")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "floor_notifications" }, () => {
        void load();
        toast.info("มีการแจ้งเตือนงานใหม่");
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, supabase]);

  async function markRead(id: number) {
    await supabase.from("floor_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setRows((current) => current.map((row) => row.id === id ? { ...row, read_at: new Date().toISOString() } : row));
  }

  async function markAllRead() {
    await supabase.from("floor_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })));
  }

  async function enablePush() {
    setPushBusy(true);
    try {
      const subscription = await subscribeBrowserToPush();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const { error } = await supabase.from("floor_push_subscriptions").upsert({
        auth_user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth_secret: subscription.auth,
        platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "ios-web" : /Android/i.test(navigator.userAgent) ? "android-web" : "web",
        user_agent: navigator.userAgent,
        is_active: true,
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) throw error;
      setPushReady(true);
      toast.success("มือถือเครื่องนี้พร้อมรับการแจ้งเตือนแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปิดการแจ้งเตือนไม่สำเร็จ");
    } finally { setPushBusy(false); }
  }

  return <div className="fixed right-3 top-3 z-[70] md:right-6 md:top-5">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-label="การแจ้งเตือน" className="relative grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg">
      {unread ? <BellRing className="h-5 w-5 text-blue-600" /> : <Bell className="h-5 w-5" />}
      {unread ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] font-bold leading-5 text-white">{Math.min(unread, 99)}</span> : null}
    </button>
    {open ? <div className="absolute right-0 mt-2 w-[min(92vw,24rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3"><div><div className="font-semibold text-slate-900">การแจ้งเตือน</div><div className="text-xs text-slate-500">{unread ? `${unread} รายการที่ยังไม่ได้อ่าน` : "อ่านครบแล้ว"}</div></div>{unread ? <button onClick={() => void markAllRead()} className="flex min-h-11 items-center gap-1 text-xs font-medium text-blue-600"><CheckCheck className="h-4 w-4" /> อ่านทั้งหมด</button> : null}</div>
      <div className="max-h-[55vh] overflow-y-auto">{rows.map((row) => {
        const content = <div className={`border-b px-4 py-3 ${row.read_at ? "bg-white" : "bg-blue-50"}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${row.read_at ? "bg-slate-300" : "bg-blue-600"}`} /><div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{row.title}</div>{row.body ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{row.body}</div> : null}<div className="mt-1 text-[11px] text-slate-400">{relativeTime(row.created_at)}</div></div></div></div>;
        return row.target_url ? <Link key={row.id} href={row.target_url} onClick={() => { void markRead(row.id); setOpen(false); }}>{content}</Link> : <button key={row.id} onClick={() => void markRead(row.id)} className="w-full text-left">{content}</button>;
      })}{!rows.length ? <div className="p-10 text-center text-sm text-slate-400">ยังไม่มีการแจ้งเตือน</div> : null}</div>
      <div className="border-t bg-slate-50 p-3"><button type="button" onClick={() => void enablePush()} disabled={pushBusy || pushReady || !canUseWebPush()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 disabled:opacity-60"><Smartphone className="h-4 w-4" />{pushReady ? "เครื่องนี้เปิดแจ้งเตือนแล้ว" : pushBusy ? "กำลังเปิด…" : "เปิดแจ้งเตือนบนมือถือเครื่องนี้"}</button></div>
    </div> : null}
  </div>;
}

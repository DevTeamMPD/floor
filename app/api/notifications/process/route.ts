import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const dynamic = "force-dynamic";

interface DeliveryRow {
  id: number;
  attempts: number;
  notification: { id: number; title: string; body: string | null; target_url: string | null; event_type: string; job_no: string | null };
  subscription: { id: string; endpoint: string; p256dh: string; auth_secret: string };
}

function authorized(request: Request) {
  const secret = process.env.PUSH_CRON_SECRET ?? process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@mpdgroup.co.th";
  if (!url || !serviceKey || !publicKey || !privateKey) return Response.json({ error: "push environment is not configured" }, { status: 503 });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: staffSync, error: staffSyncError } = await supabase.rpc("sync_floor_staff_from_employee_master");
  if (staffSyncError) return Response.json({ error: `staff sync failed: ${staffSyncError.message}` }, { status: 500 });
  const { data, error } = await supabase.from("floor_push_deliveries")
    .select("id,attempts,notification:floor_notifications!inner(id,title,body,target_url,event_type,job_no),subscription:floor_push_subscriptions!inner(id,endpoint,p256dh,auth_secret)")
    .in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true }).limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0; let failed = 0; let expired = 0;
  for (const raw of data ?? []) {
    const row = raw as unknown as DeliveryRow;
    await supabase.from("floor_push_deliveries").update({ status: "processing", attempts: row.attempts + 1 }).eq("id", row.id);
    try {
      await webpush.sendNotification({ endpoint: row.subscription.endpoint, keys: { p256dh: row.subscription.p256dh, auth: row.subscription.auth_secret } }, JSON.stringify({
        title: row.notification.title, body: row.notification.body ?? "มีการอัปเดตงาน",
        targetUrl: row.notification.target_url ?? "/", tag: `${row.notification.event_type}:${row.notification.job_no ?? row.notification.id}`,
      }), { TTL: 60 * 60 * 24 });
      await supabase.from("floor_push_deliveries").update({ status: "sent", delivered_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
      sent += 1;
    } catch (caught) {
      const pushError = caught as { statusCode?: number; message?: string };
      const gone = pushError.statusCode === 404 || pushError.statusCode === 410;
      if (gone) {
        await supabase.from("floor_push_subscriptions").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", row.subscription.id);
        await supabase.from("floor_push_deliveries").update({ status: "expired", last_error: pushError.message ?? "subscription expired" }).eq("id", row.id);
        expired += 1;
      } else {
        const attempts = row.attempts + 1; const terminal = attempts >= 5;
        const retryAt = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString();
        await supabase.from("floor_push_deliveries").update({ status: terminal ? "expired" : "failed", next_attempt_at: retryAt, last_error: (pushError.message ?? "push failed").slice(0, 1000) }).eq("id", row.id);
        failed += 1;
      }
    }
  }
  return Response.json({ staffSync, processed: (data ?? []).length, sent, failed, expired });
}

export const POST = GET;

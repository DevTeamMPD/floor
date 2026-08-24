self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: "FloorNow", body: event.data?.text() || "มีการอัปเดตงาน" }; }
  event.waitUntil(self.registration.showNotification(payload.title || "FloorNow", {
    body: payload.body || "มีการอัปเดตงาน",
    data: { url: payload.targetUrl || "/" },
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === target);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});

/* ==========================================================
   TRACKLY service worker (served from the site root, so it covers every page)
   It does three small jobs and nothing else:
     1. Shows push notifications (and opens Trackly when one is tapped).
     2. Shows offline.html when a page cannot load because there is no internet.
     3. Keeps ONLY the offline page and its logo and icon in the phone's memory.
   It never keeps Trackly's pages or scripts. Trackly has no build step, so a kept copy would show old code after a new release.
   Change CACHE below only if you change what is kept (the old copy is then cleared).
   ========================================================== */

const CACHE = "trackly-offline-v1";
const OFFLINE = "/offline.html";
const KEEP = [OFFLINE, "/assets/images/logo.webp", "/assets/images/icon-192.png"];
const ICON = "/assets/images/icon-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(KEEP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Opening a page: the internet first. Only when it fails, the offline page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  // The offline page's own logo and icon come from memory, so the page looks right with no internet
  if (url.origin === self.location.origin && KEEP.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(request)));
  }
});

/* Only addresses on our own site may be opened from a notification */
function safeUrl(value, origin = self.location.origin) {
  try {
    const u = new URL(String(value || "/dashboard"), origin);
    return u.origin === origin ? u.pathname + u.search : "/dashboard";
  } catch (err) {
    return "/dashboard";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = {}; }
  const title = typeof data.t === "string" && data.t ? data.t.slice(0, 140) : "Trackly";
  // iPhone requires every push to show something, so this always does
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.b === "string" ? data.b.slice(0, 200) : "",
    icon: ICON,
    tag: typeof data.g === "string" && data.g ? data.g.slice(0, 80) : undefined,
    data: { url: safeUrl(data.u) }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      if (open && "navigate" in open) return open.navigate(target).then((w) => (w ? w.focus() : open.focus()));
      return self.clients.openWindow(target);
    })
  );
});

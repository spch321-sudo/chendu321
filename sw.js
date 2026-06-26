/* 晨讀321 · Service Worker（網路優先導覽，離線快取） */
const CACHE = "chendu321-v3";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-180.png",
  "icon-maskable-512.png",
  "favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 導覽 / 主頁：網路優先（永遠拿最新版），離線時才用快取
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/") || url.pathname === "/chendu321/") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("index.html", copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("index.html").then((c) => c || caches.match("./")))
    );
    return;
  }

  // 其他靜態檔：快取優先、背景更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const live = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || live;
    })
  );
});

/* 晨讀321 · Service Worker（離線快取） */
const CACHE = "chendu321-v1";
const SHELL = [
  ".",
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
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
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
  // 只處理本網站的 GET（小智 / AI 等跨網域請求一律直接走網路，不快取）
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 導覽請求：先用快取的 index.html，離線也能開
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("index.html").then((cached) => cached || fetch(req))
    );
    return;
  }

  // 其他靜態檔：快取優先，順便更新
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

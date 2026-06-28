/* 晨讀321 · Service Worker v4（快取優先秒開 ＋ 背景更新 ＋ 偵測新版提示） */
const CACHE = "chendu321-v4";
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

  // 導覽 / 主頁：快取優先「秒開」，背景抓最新；若偵測到新版本，通知頁面顯示更新提示
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/") || url.pathname === "/chendu321/") {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match("index.html");
      const fetching = fetch(req).then(async (res) => {
        if (res && res.ok) {
          const newTag = res.headers.get("etag") || res.headers.get("last-modified") || "";
          const oldTag = cached ? (cached.headers.get("etag") || cached.headers.get("last-modified") || "") : "";
          await cache.put("index.html", res.clone());
          if (cached && newTag && oldTag && newTag !== oldTag) {
            const cs = await self.clients.matchAll();
            cs.forEach((c) => c.postMessage({ type: "update-available" }));
          }
        }
        return res;
      }).catch(() => null);
      // 有快取就先秒回（背景仍會更新）；完全沒有快取才等網路
      return cached || (await fetching) || cache.match("./");
    })());
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

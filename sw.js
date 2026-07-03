/* ============================================================
   晨讀321（繁體版）· Service Worker
   - 離線可用：預先快取 App 外殼
   - 內容更新：導覽請求採「網路優先」，確保改版即時生效；離線時回退快取
   - 有新版時：通知頁面顯示「✦ 已有新版本」更新提示
   改版上線時，請把下面 CACHE 的版本號 +1（例如 v52 → v53），即可強制更新。
   ── 注意：本團契三個 App（繁體／簡體／英文）同在一個網域下，
   　　瀏覽器的 Cache Storage 是整個網域共用。因此清理舊版時，
   　　只清「自己前綴」（chendu321-zht-）的快取，絕不誤刪另一個 App 的離線內容。
   ============================================================ */
var PREFIX  = "chendu321-zht-";
var VERSION = "v54";
var CACHE   = PREFIX + VERSION;

var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon-32.png",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

/* 安裝：預先快取外殼，並立即接手 */
self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 個別檔案抓不到也不讓整體失敗 */
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
});

/* 啟用：只清掉「本 App」的舊版快取；若確實是更新（先前有舊版），通知頁面顯示更新提示 */
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      var hadOld = keys.some(function (k) {
        return k !== CACHE && k.indexOf(PREFIX) === 0;
      });
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf(PREFIX) === 0) return caches.delete(k);
      })).then(function () {
        return self.clients.claim();
      }).then(function () {
        if (hadOld) {
          return self.clients.matchAll({ type: "window" }).then(function (cl) {
            cl.forEach(function (c) { c.postMessage({ type: "update-available" }); });
          });
        }
      });
    })
  );
});

/* 攔截：僅處理同源 GET；POST（語音／AI 代理）與跨域請求一律放行不快取 */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  /* 導覽（HTML）：網路優先 → 取得最新內容；離線時回退快取 */
  var accept = req.headers.get("accept") || "";
  if (req.mode === "navigate" || accept.indexOf("text/html") >= 0) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match("./index.html");
        });
      })
    );
    return;
  }

  /* 靜態資源（圖示、manifest 等）：快取優先 → 沒有再上網並順手快取 */
  e.respondWith(
    caches.match(req).then(function (m) {
      return m || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      });
    })
  );
});

/* 允許頁面要求立即套用新版 */
self.addEventListener("message", function (e) {
  if (e.data === "skipWaiting" || (e.data && e.data.type === "skipWaiting")) self.skipWaiting();
});

/* ============================================================
   晨读321（简体版）· Service Worker
   - 离线可用：预先快取 App 外壳
   - 内容更新：导览请求采「网路优先」，确保改版即时生效；离线时回退快取
   - 有新版时：通知页面显示「✦ 已有新版本」更新提示
   改版上线时，请把下面的版本号 +1（例如 v1 → v2），即可强制更新。
   ============================================================ */
var VERSION = "chendu321-zht-v28";
var CACHE   = VERSION;

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

/* 安装：预先快取外壳，并立即接手 */
self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 个别档案抓不到也不让整体失败 */
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
});

/* 启用：清掉旧版快取；若确实是「更新」（先前有旧版），通知页面显示更新提示 */
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      var hadOld = keys.some(function (k) { return k !== CACHE; });
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      })).then(function () {
        return self.clients.claim();
      }).then(function () {
        if (hadOld) {
          return self.clients.matchAll().then(function (cl) {
            cl.forEach(function (c) { c.postMessage({ type: "update-available" }); });
          });
        }
      });
    })
  );
});

/* 拦截：仅处理同源 GET；POST（语音/AI 代理）与跨域请求一律放行不快取 */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  /* 导览（HTML）：网路优先 → 取得最新内容；离线时回退快取 */
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

  /* 静态资源（图示、manifest 等）：快取优先 → 没有再上网并顺手快取 */
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

/* 允许页面要求立即套用新版 */
self.addEventListener("message", function (e) {
  if (e.data === "skipWaiting" || (e.data && e.data.type === "skipWaiting")) self.skipWaiting();
});

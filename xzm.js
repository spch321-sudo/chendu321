/* 簡體字串對照表（build_xzm.py 以系統 ICU 產生，勿手改）*/
window.XZM_SC = {'停止':'停止','原回答已不在對話中':'原回答已不在对话中','回到原處':'回到原处','小智':'小智','我的領受：':'我的领受：','請就這句幫助我默想：':'请就这句帮助我默想：','請就這句話幫助我默想：「':'请就这句话帮助我默想：「','（原回答已不在對話中）':'（原回答已不在对话中）','💡 點一下任何一句畫線；再點一下可換色、寫領受、做成美圖或問小智。':'💡 点一下任何一句画线；再点一下可换色、写领受、做成美图或问小智。'};
/* ═══════════════════════════════════════════════════════════════════
   xzm.js v1（xzm1103-g）— 321 小智回答「逐句跟讀＋畫線＋再點」通用模組（ES5，無相依）

   小智每則回答完成後，文字被切成一句一句 <span class="xzs" data-xk="z|訊息id|區塊序|句序">：
     · 點一下畫線、再點開面板（面板與儲存重用該 App 正文的畫線機制，由 marks 後端接上）
     · 🔊 朗讀整則回答時逐句高亮、畫面捲到該句，使用者自己捲動後 6 秒內不搶畫面
     · 小智訊息（最近 60 則）保存、重開還原；孤兒畫線仍可看，跳轉停用
   不改任何宿主函式的原始碼：全部用「外掛」方式——
     · 用 MutationObserver 看著聊天視窗，宿主重畫之後立刻把已完成的回答切句（同一個 microtask，畫面不閃）
     · 🔊 按鈕用 capture 階段攔截（或包 SAGE321.speak），沒有 XZM 時宿主行為完全不變
   移植只需要提供一個 adapter（見 porting.md 的「adapter 介面」）；本檔內附兩組現成 preset：
     XZM.preset.gx(opts)      SAGE321 + GXA.hl + TTS321（gxa.js / gxr.js 系）
     XZM.preset.lesson(opts)  S.chat／CHAT + 課程型 App 的 sentList／paintHl／spk 朗讀（mission、life 系）
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__xzmc) return; window.__xzmc = 1;
  var root = document.documentElement;
  var A = null;                                   /* 目前的 adapter */
  var HOLD_MS = 6000, KEEP = 60;
  var ST = { reading: null, hold: 0, timer: 0, own: false, mo: null, wait: 0, busy: false, sig: '', last: [], tagSig: {}, units: {} };

  /* ── 小工具 ─────────────────────────────────────────────────────── */
  function g(f, d) { try { var r = f(); return r === undefined ? d : r; } catch (e) { return d; } }
  function arr(l) { return Array.prototype.slice.call(l || []); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $1(s, r) { return (r || document).querySelector(s); }
  function lang() { return g(function () { return A.lang(); }, 'tc'); }
  /* T(繁體, English)；簡體從 window.XZM_SC（build 時由系統 ICU 產生的對照表）查，沒有就用 adapter.toSC */
  function T(zh, en) {
    var l = lang();
    if (l === 'en') return en;
    if (l === 'sc') {
      var m = window.XZM_SC && window.XZM_SC[zh];
      if (m) return m;
      var r = g(function () { return A.toSC(zh); });
      if (r) return r;
    }
    return zh;
  }
  function say(m) { g(function () { A.toast(m); }); }
  function isTag(t) { return t.charAt(0) === '<'; }

  /* ── 切句（句子界線：。！？ 與英文 .!?；收尾引號括號跟著前一句；標籤與實體不切）──── */
  var TOKRE = /<[^>]*>|&#?\w+;|[\s\S]/g;
  var CLOSERS = '」』）)】》〉”’"\'］]»';
  var ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&rdquo;': '”', '&rsquo;': '’' };
  var BOOKS = /^(gen|exod|ex|lev|num|deut|josh|judg|sam|kgs|chr|neh|esth|ps|prov|eccl|isa|jer|lam|ezek|dan|hos|obad|mic|nah|hab|zeph|hag|zech|mal|matt|mk|lk|jn|rom|cor|gal|eph|phil|col|thess|tim|tit|phlm|heb|jas|pet|rev|ch|chs|vv|v)$/i;
  var REAL = /[\p{L}\p{N}]/u;
  function pc(t) { return t.length === 1 ? t : (ENT[t] !== undefined ? ENT[t] : 'x'); }
  function isSp(t) { return !isTag(t) && /^\s$/.test(pc(t)); }
  function isCloser(t) { return !isTag(t) && CLOSERS.indexOf(pc(t)) >= 0; }
  function afterOk(toks, i) {
    var j = i + 1, nx;
    while (j < toks.length && (isCloser(toks[j]) || toks[j] === '.' || toks[j] === '!' || toks[j] === '?')) j++;
    nx = toks[j];
    if (nx === undefined || isTag(nx) || isSp(nx)) return { ok: true, j: j };
    return { ok: false, j: j, cjk: pc(nx).charCodeAt(0) > 0x2E7F };
  }
  function isEndMark(toks, i, ch) {
    if (ch === '。' || ch === '！' || ch === '？') return true;
    if (ch === '!' || ch === '?') { var a = afterOk(toks, i); return a.ok || a.cjk; }
    if (ch === '.') {
      var r = afterOk(toks, i);
      if (!r.ok) return false;
      var w = '', p = i - 1, k;
      while (p >= 0 && !isTag(toks[p]) && /^[A-Za-z]$/.test(toks[p])) { w = toks[p] + w; p--; }
      if (w) {
        if (/^(mr|mrs|ms|dr|st|vs|prof|fig|vol|no|nos|jr|sr)$/i.test(w)) return false;
        k = r.j;
        while (k < toks.length && (isSp(toks[k]) || isTag(toks[k]))) k++;
        if (BOOKS.test(w) && toks[k] && /^[0-9]$/.test(toks[k])) return false;
        if (w.length === 1 && /[A-Z]/.test(w) && toks[k] && /^[A-Z]$/.test(toks[k])) return false;
      }
      return true;
    }
    return false;
  }
  function splitSent(html) {
    var toks = String(html).match(TOKRE) || [], out = [], cur = [], depth = 0, pend = false, i, t, ch;
    function flush() { if (cur.length) { out.push({ k: 's', h: cur.join('') }); cur = []; } pend = false; }
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      if (isTag(t)) {
        if (/^<br\b/i.test(t)) { flush(); out.push({ k: 'x', h: t }); continue; }
        cur.push(t);
        if (t.charAt(1) === '/') { depth = Math.max(0, depth - 1); if (depth === 0 && pend) flush(); }
        else if (!/\/>$/.test(t) && !/^<(img|hr|wbr|input)\b/i.test(t)) depth++;
        continue;
      }
      cur.push(t);
      ch = pc(t);
      if (isEndMark(toks, i, ch)) {
        while (i + 1 < toks.length && !isTag(toks[i + 1]) && (CLOSERS.indexOf(pc(toks[i + 1])) >= 0 || '。！？!?'.indexOf(pc(toks[i + 1])) >= 0)) cur.push(toks[++i]);
        if (depth === 0) flush(); else pend = true;
      } else if (pend && !/^\s$/.test(ch) && CLOSERS.indexOf(ch) < 0) pend = false;
    }
    flush();
    var res = [], carry = '';
    out.forEach(function (it) {
      if (it.k !== 's') { if (carry) { res.push({ k: 'x', h: carry }); carry = ''; } res.push(it); return; }
      if (REAL.test(it.h.replace(/<[^>]*>|&#?\w+;/g, ''))) { res.push({ k: 's', h: carry + it.h }); carry = ''; }
      else { var last = res[res.length - 1]; if (last && last.k === 's') last.h += it.h; else carry += it.h; }
    });
    if (carry) res.push({ k: 'x', h: carry });
    return res;
  }

  /* ── 訊息與代號 ─────────────────────────────────────────────────── */
  function msgs() { return g(function () { return A.msgs(); }, []) || []; }
  function newId() { return 'a' + (new Date()).getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function idOf(m) {
    if (!m) return '';
    if (typeof A.idOf === 'function') return A.idOf(m);
    if (!m.xid) { m.xid = newId(); ST.dirty = true; }
    return m.xid;
  }
  function msgById(id) { var a = msgs(), i; for (i = 0; i < a.length; i++) if (a[i] && a[i].xid === id) return a[i]; return null; }
  function parse(xk) { var p = String(xk).split('|'); return { id: p[1] || '', b: +p[2] || 0, s: +p[3] || 0 }; }
  function isZ(xk) { return typeof xk === 'string' && xk.charAt(0) === 'z' && xk.charAt(1) === '|'; }

  /* ── 把回答的 HTML 切成可點的句子 ─────────────────────────────── */
  function containers(el) { var c = el.querySelectorAll('li,th,td'); return c.length ? arr(c) : [el]; }
  function plain(h) {
    return h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  var BLOCKRE = /^(P|UL|OL|DL|H[1-6]|BLOCKQUOTE|TABLE|DIV|PRE|HR|SECTION|ARTICLE|FIGURE|DETAILS)$/;
  /* 頂層若有「裸文字＋行內標籤」（有些宿主的 markdown 不包 <p>），連續的一段包成 <span data-xzrun>，視同一個段落 */
  function normalize(tpl) {
    var run = null;
    arr(tpl.content.childNodes).forEach(function (nd) {
      if (nd.nodeType === 1 && BLOCKRE.test(nd.tagName)) { run = null; return; }
      if (nd.nodeType === 8) return;
      if (!run) { run = document.createElement('span'); run.setAttribute('data-xzrun', '1'); tpl.content.insertBefore(run, nd); }
      run.appendChild(nd);
    });
  }
  function tagHtml(html, id) {
    var tpl = document.createElement('template'), list = [];
    tpl.innerHTML = html;
    normalize(tpl);
    arr(tpl.content.children).forEach(function (el, b) {
      var n = 0;
      if (el.classList && (el.classList.contains('xzhint') || el.hasAttribute('data-xzskip'))) return;
      containers(el).forEach(function (c) {
        var out = '';
        splitSent(c.innerHTML).forEach(function (it) {
          if (it.k === 'x') { out += it.h; return; }
          var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(it.h), xk = 'z|' + id + '|' + b + '|' + (n++);
          out += m[1] + '<span class="xzs' + (A.cls ? ' ' + A.cls : '') + '" data-xk="' + xk + '"' + (A.attrs ? A.attrs(id, b, n - 1, xk) : '') +
            (A.ownClick === false ? '' : ' onclick="XZM.tap(event,this)"') + '>' + m[2] + '</span>' + m[3];
          list.push({ xk: xk, b: b, s: n - 1, t: plain(m[2]) });
        });
        c.innerHTML = out;
      });
    });
    return { html: tpl.innerHTML, list: list };
  }
  /* 掃描聊天視窗：把「已完成、還沒切句」的回答切句（整個過程在 busy 旗標裡，自己造成的 DOM 變動不會再觸發自己） */
  function scan() {
    if (!A || ST.busy) return;
    ST.busy = true;
    var any = false;
    try {
      A.answers().forEach(function (a) {
        var m = a.m, body = a.body;
        if (!m || !body || !A.isDone(m)) return;
        var id = idOf(m), sig = id + ':' + String(m.text || '').length;
        if (body.getAttribute('data-xzt') === sig && body.querySelector('.xzs')) return;
        var r = tagHtml(body.innerHTML, id);
        body.innerHTML = r.html;
        body.setAttribute('data-xzt', sig);
        g(function () { if (A.decorate) A.decorate(body, id); });
        any = true;
        if (A.hint && a.last && r.list.length) addHint(body);
      });
      if (any || ST.dirty) {
        ST.dirty = false;
        g(function () { A.marks.attach(chatRoot()); });
        g(function () { A.marks.paint(chatRoot()); });
        syncBtn();
        var rd = ST.reading;
        if (rd && rd.units[rd.last]) { var h = ST.hold; ST.hold = Date.now() + 1500; mark(rd.units[rd.last], true); ST.hold = h; }
        g(function () { if (A.afterScan) A.afterScan(any); });
      }
      persist();
    } catch (e) { try { console.error('XZM scan', e); } catch (_) {} }
    if (ST.mo) ST.mo.takeRecords();
    ST.busy = false;
  }
  function addHint(body) {
    if (anyMarks() || body.querySelector('.xzhint')) return;
    body.insertAdjacentHTML('beforeend', '<div class="xzhint" data-xzskip="1">' + esc(T('💡 點一下任何一句畫線；再點一下可換色、寫領受、做成美圖或問小智。',
      '💡 Tap any sentence to highlight it; tap again to change colour, write a reflection, make a card or ask Xiaozhi.')) + '</div>');
  }
  function anyMarks() { return g(function () { return A.marks.any(); }, false); }
  function chatRoot() { return g(function () { return A.root(); }, null); }
  /* ── 看著聊天視窗 ─────────────────────────────────────────────── */
  function watch() {
    var r = chatRoot();
    if (!r) { ST.wait = setTimeout(watch, 400); return; }
    if (ST.watched === r) return;
    ST.watched = r;
    if (ST.mo) ST.mo.disconnect();
    if (window.MutationObserver) {
      ST.mo = new MutationObserver(function () { if (!ST.busy) scan(); });
      ST.mo.observe(r, { childList: true, subtree: true });
    }
    scan();
  }
  /* 聊天視窗元素本身也可能被換掉：低頻檢查一次（不重的 getElementById） */
  setInterval(function () { if (A && ST.watched && chatRoot() !== ST.watched) { ST.watched = null; watch(); } else if (A && !ST.watched) watch(); }, 1500);

  /* ── 點一下畫線、再點開面板 ───────────────────────────────────── */
  function selecting() { return g(function () { return String(window.getSelection()).replace(/\s/g, '').length > 0; }, false); }
  function tap(ev, el) {
    try {
      if (ev) {
        ev.stopPropagation();
        var t = ev.target;
        if (t && t.closest && t.closest('a,button,.mknote,.hl-note,.gxhl-note')) return;
      }
    } catch (e) {}
    if (selecting()) return;
    if (!el) return;
    A.marks.tap(el.getAttribute('data-xk'), el);
  }
  function sentEl(xk) { return $1('.xzs[data-xk="' + xk + '"]', chatRoot() || document); }
  function sentText(el) { return plain(el.innerHTML); }

  /* ── 朗讀：句子 ↔ 單元一對一 ─────────────────────────────────── */
  function endP(t) { return /[。！？；：、，,.:;!?」』）)”"…]$/.test(t) ? t : t + (lang() === 'en' ? '.' : '。'); }
  function tableText(el) {
    var rows = arr(el.querySelectorAll('tr')).map(function (tr) { return arr(tr.children).map(function (c) { return plain(c.innerHTML); }).filter(Boolean); });
    var head = rows[0] || [], body = rows.slice(1), out = [];
    if (!body.length) return endP(head.join('，'));
    body.forEach(function (r) {
      out.push(endP(r.map(function (c, j) { return (head[j] && r.length > 1 ? head[j] + (lang() === 'en' ? ': ' : '：') : '') + c; }).join(lang() === 'en' ? ', ' : '，')));
    });
    return out.join(' ');
  }
  /* 預設：一句一個單元；表格整張一個單元；adapter.units(node, i, m) 可以整個換掉（例如用 NAR321 補口語帶入詞） */
  function unitsOf(node, m, i) {
    if (A.units) { var u = g(function () { return A.units(node, m, i, defaultUnits); }, null); if (u && u.length) return u; }
    return defaultUnits(node);
  }
  function defaultUnits(node) {
    var body = A.bodyOf(node), us = [];
    function U(t, spans, whole) {
      t = A.clean ? g(function () { return A.clean(t); }, t) : t;
      if (!t || !String(t).replace(/\s+/g, '')) return;
      us.push({ t: t, keys: spans.map(function (s) { return s.getAttribute('data-xk'); }), whole: !!whole });
    }
    arr(body.children).forEach(function (el) {
      var spans = arr(el.querySelectorAll('.xzs'));
      if (!spans.length) return;
      if (el.tagName === 'TABLE' || el.querySelector('table') && el.children.length === 1) { U(tableText(el.tagName === 'TABLE' ? el : el.querySelector('table')), spans, true); return; }
      spans.forEach(function (s) { U(endP(sentText(s)), [s]); });
    });
    return us;
  }
  function resolve(u) {
    var els = u.keys.map(sentEl).filter(Boolean);
    if (u.whole && els[0]) { var tb = els[0].closest('table'); if (tb) return [tb]; }
    return els;
  }
  function clearMarks() {
    ST.last.forEach(function (e) { g(function () { e.classList.remove(A.nowCls || 'spk-now'); }); });
    ST.last = [];
    arr(document.querySelectorAll('.' + (A.nowCls || 'spk-now'))).forEach(function (e) { e.classList.remove(A.nowCls || 'spk-now'); });
  }
  function scrollToEl(el) {
    var box = g(function () { return A.scroller(); }, null);
    if (!box || !el) return;
    var r = el.getBoundingClientRect(), br = box.getBoundingClientRect();
    var top = box.scrollTop + (r.top - br.top) - (r.height > br.height * 0.8 ? 24 : (br.height - r.height) / 2);
    top = Math.max(0, top);
    if (Math.abs(top - box.scrollTop) < 8) return;
    try { box.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { box.scrollTop = top; }
  }
  function mark(u, quiet) {
    clearMarks();
    var els = resolve(u);
    if (!els.length) return;
    g(function () { if (A.beforeMark) A.beforeMark(els[0]); });
    els.forEach(function (e) { e.classList.add(A.nowCls || 'spk-now'); });
    ST.last = els;
    if (!quiet && g(function () { return A.follow(); }, true) === false) return;
    if (Date.now() < ST.hold) return;
    scrollToEl(els[0]);
  }
  /* poll 型引擎（TTS321 這種「有 isOn／index」的）：每 120ms 看一次現在唸到第幾段 */
  function tick() {
    var rd = ST.reading;
    if (!rd) { stopTimer(); return; }
    var s = A.engine.state();
    if (!s.on) { endReading(); return; }
    if (s.i !== rd.last) { rd.last = s.i; if (rd.units[s.i]) mark(rd.units[s.i]); }
  }
  function stopTimer() { if (ST.timer) { clearInterval(ST.timer); ST.timer = 0; } }
  function endReading() { ST.reading = null; stopTimer(); clearMarks(); syncBtn(); }
  function stopEngine() { g(function () { A.engine.stop(); }); endReading(); }
  function begin(units, title, meta) {
    if (!A.engine || !units.length) return false;
    g(function () { if (A.engine.ready) A.engine.ready(); });   /* 引擎若是延遲初始化（TTS321.init）先叫醒它 */
    var us = [];
    units.forEach(function (u) { A.engine.chunks(u.t).forEach(function (c) { us.push({ t: c, src: u }); }); });
    if (!us.length) return false;
    ST.hold = 0;
    endReading();
    ST.own = true;
    try { A.engine.play(us.map(function (x) { return { t: x.t }; }), title); } catch (err) { ST.own = false; return false; }
    ST.own = false;
    ST.reading = { mid: meta.mid, kind: meta.kind, units: us.map(function (x) { return x.src; }), last: -1 };
    ST.timer = setInterval(tick, 120);
    tick();
    syncBtn();
    return true;
  }
  /* 🔊 朗讀整則回答（i＝adapter 認得的訊息索引） */
  function speakMsg(i) {
    var m = g(function () { return A.msgAt(i); }, null), node = g(function () { return A.nodeAt(i); }, null);
    if (!m || !node || !A.isDone(m) || !node.querySelector('.xzs')) return false;
    var id = idOf(m);
    if (A.beginMsg) {                               /* 非 poll 型引擎（課程型 App 的 spk 朗讀）：由 adapter 自己開唸 */
      return g(function () { return A.beginMsg(i, m, node, unitsOf(node, m, i), id); }, false);
    }
    if (!A.engine) return false;
    var rd = ST.reading;
    if (rd && rd.mid === id && rd.kind === 'msg' && A.engine.state().on) { stopEngine(); return true; }
    var units = unitsOf(node, m, i);
    if (!units.length) return false;
    return begin(units, T('小智', 'Xiaozhi'), { mid: id, kind: 'msg' });
  }
  /* 從某一句開始唸到這則回答結束（面板的「從這裡朗讀」；單句＝from 之後只取一句） */
  function sayFrom(xk, onlyOne) {
    var el = typeof xk === 'string' ? sentEl(xk) : xk;
    if (!el) return false;
    var key = el.getAttribute('data-xk'), p = parse(key), node = el.closest(A.msgSel), m = msgById(p.id), units, j, from = -1, picked;
    if (!node || !m) return false;
    units = unitsOf(node, m, -1);
    for (j = 0; j < units.length; j++) if (units[j].keys.indexOf(key) >= 0) { from = j; break; }
    if (from < 0) return false;
    picked = onlyOne ? [units[from]] : units.slice(from);
    if (A.beginMsg) return g(function () { return A.beginMsg(-1, m, node, picked, idOf(m), true); }, false);
    return begin(picked, T('小智', 'Xiaozhi'), { mid: idOf(m), kind: onlyOne ? 'one' : 'from' });
  }
  function syncBtn() { g(function () { if (A.syncBtn) A.syncBtn(ST.reading); }); }
  function wrapEngine() {
    if (!A.engine || !A.engine.wrap) return;
    A.engine.wrap(function () { if (!ST.own) endReading(); });
  }
  ['wheel', 'touchstart', 'touchmove', 'pointerdown'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (ST.reading || (A && A.reading && A.reading())) ST.hold = Date.now() + HOLD_MS; }, { passive: true });
  });
  window.addEventListener('keydown', function (e) {
    if ((ST.reading || (A && A.reading && A.reading())) && /^(Arrow|Page)|^(Home|End)$|^ $/.test(e.key || '')) ST.hold = Date.now() + HOLD_MS;
  });

  /* ── 小智訊息的保存／還原（宿主自己會存的就不用，adapter 不給 store 即略過）──── */
  function persist() {
    if (!A || !A.store) return;
    try {
      var a = msgs(), out = [], i, m;
      for (i = 0; i < a.length; i++) {
        m = a[i];
        if (!m || m.cont) continue;
        if (A.isUser(m)) { out.push({ id: idOf(m), role: 'user', text: m.text, at: +m.at || 0 }); continue; }
        if (!A.isDone(m)) continue;
        out.push({ id: idOf(m), role: 'assistant', text: m.text, at: +m.at || 0 });
      }
      if (out.length && out[out.length - 1].role === 'user' && g(function () { return A.busy(); }, false)) out.pop();
      out = out.slice(-KEEP);
      var sig = out.map(function (x) { return x.id + x.text.length; }).join(',');
      if (sig === ST.sig) return;
      ST.sig = sig;
      A.store.set(out);
    } catch (e) {}
  }
  function restore() {
    if (!A || !A.store || msgs().length || g(function () { return A.busy(); }, false)) return false;
    var list = g(function () { return A.store.get(); }, null);
    if (!Array.isArray(list) || !list.length) return false;
    list = list.filter(function (x) { return x && x.id && x.text && (x.role === 'user' || x.role === 'assistant'); });
    if (!list.length) return false;
    g(function () { A.restore(list); });
    ST.sig = list.map(function (x) { return x.id + x.text.length; }).join(',');
    return true;
  }

  /* ── 回到原處／刪除 ──────────────────────────────────────────── */
  function jump(xk) {
    var m = msgById(parse(xk).id);
    if (!m) { say(T('原回答已不在對話中', 'The original answer is no longer in the chat')); return false; }
    g(function () { A.open(); });
    setTimeout(function () {
      var el = sentEl(xk);
      if (!el) return;
      g(function () { if (A.beforeMark) A.beforeMark(el); });
      scrollToEl(el);
      el.classList.add('xzflash');
      setTimeout(function () { el.classList.remove('xzflash'); }, 1800);
    }, 120);
    return true;
  }

  /* ── 樣式 ───────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('xzmcss')) return;
    var st = document.createElement('style'); st.id = 'xzmcss';
    st.textContent =
      '.xzs{cursor:pointer;border-radius:4px;-webkit-box-decoration-break:clone;box-decoration-break:clone}' +
      '.xzs.spk-now{background:rgba(108,147,209,.28);box-shadow:inset 0 0 0 999px rgba(108,147,209,.0)}' +
      'table.spk-now,.spk-now>table{background:rgba(108,147,209,.18)}' +
      '.xzhint{font-size:.78em;line-height:1.6;color:#6b6b6b;background:rgba(156,107,24,.1);border-radius:10px;padding:7px 11px;margin-top:8px}' +
      '.xzs.xzflash{animation:xzfl 1.7s ease}' +
      '@keyframes xzfl{0%,60%{background:#FFE9A8}100%{background:transparent}}' +
      'html[data-dark="1"] .xzs.spk-now,html[data-theme=dark] .xzs.spk-now{background:rgba(120,160,230,.34)}' +
      'html[data-dark="1"] .xzhint,html[data-theme=dark] .xzhint{color:#bdb8aa;background:rgba(255,230,160,.1)}' +
      '@media (prefers-color-scheme:dark){html:not([data-theme=light]) .xzhint{color:#bdb8aa;background:rgba(255,230,160,.1)}}' +
      (A.css || '');
    document.head.appendChild(st);
  }

  /* ── 安裝 ───────────────────────────────────────────────────── */
  function install(adapter) {
    if (A) return false;
    A = adapter;
    css();
    wrapEngine();
    g(function () { if (A.hook) A.hook(); });
    restore();
    watch();
    scan();
    return true;
  }
  window.XZM = {
    version: 'xzm1103-g', install: install, tap: tap, scan: scan, watch: watch, persist: persist, restore: restore,
    speakMsg: speakMsg, sayFrom: sayFrom, jump: jump, begin: begin, mark: mark, clearMarks: clearMarks, endReading: endReading,
    stopEngine: stopEngine, scrollToEl: scrollToEl, holdScroll: function () { ST.hold = Date.now() + HOLD_MS; },
    T: T, esc: esc, g: g, arr: arr, splitSent: splitSent, tagHtml: tagHtml, plain: plain, endP: endP, tableText: tableText, defaultUnits: defaultUnits,
    parse: parse, isZ: isZ, msgById: msgById, idOf: idOf, sentEl: sentEl, sentText: sentText, newId: newId,
    state: function () { return ST; }, adapter: function () { return A; }, preset: {}
  };
})();

/* ═══ preset.gx：SAGE321（gxa.js 或內嵌的 v2.0.0 核心）＋ GXA.hl 畫線面板 ＋ TTS321 朗讀（gxr.js）══════════════
   host 需要：window.SAGE321（msgs／draw／open／isBusy／speak）、window.GXA.hl（attach／tap／paint／db）
   朗讀：window.TTS321 + window.GXR.speak（用來先把 TTS321 初始化）；沒有 TTS321 就不接管 🔊（宿主照舊朗讀）
   opts.slug 畫線資料庫的前綴（預設 GXA_CFG.slug）；opts.nar=false 關掉用 NAR321 補口語帶入詞 */
XZM.preset.gx = function (o) {
  o = o || {};
  var X = XZM, g = X.g, arr = X.arr, T = X.T;
  var SLUG = o.slug || g(function () { return GXA_CFG.slug; }, 'app');
  var KEY = SLUG + '-xz';
  var NODE = /^gxxzm(\d+)$/;
  function root() { return document.getElementById('gxaxz'); }
  function nodeAt(i) { return document.getElementById('gxxzm' + i); }
  function dbKeys() { var d = g(function () { return GXA.hl.db(); }, {}), p = KEY + '|'; return Object.keys(d).filter(function (k) { return k.indexOf(p) === 0; }); }

  /* ── 朗讀單元（口語帶入詞用 NAR321；與講義版同做法）─────────────────── */
  function blockMd(blk) {
    if (blk.k === 'h') return new Array(blk.n + 1).join('#') + ' ' + blk.t;
    if (blk.k === 'table') {
      var hd = blk.head, hh = '| ' + hd.join(' | ') + ' |\n|' + hd.map(function () { return '---'; }).join('|') + '|';
      return hh + '\n' + blk.rows.map(function (r) { return '| ' + r.join(' | ') + ' |'; }).join('\n');
    }
    return '';
  }
  function listHeads(blk, bi) {
    var n = blk.items.length, j, mk1 = [], mk2 = [], p1, p2, heads = [], ends = [], pre = blk.ord ? function (x) { return (x + 1) + '. '; } : function () { return '- '; };
    for (j = 0; j < n; j++) { mk1.push(pre(j) + 'ǂ' + j + 'ǂ'); mk2.push(pre(j) + 'ǂ' + j + 'ǂ。'); }
    p1 = NAR321.speech(mk1.join('\n'), { i: bi }).split(/ǂ\d+ǂ/);
    p2 = NAR321.speech(mk2.join('\n'), { i: bi }).split(/ǂ\d+ǂ。/);
    if (p1.length !== n + 1 || p2.length !== n + 1) return null;
    for (j = 0; j < n; j++) {
      heads.push(j === 0 ? p1[0] : p2[j]);
      var a = p1[j + 1], b = p2[j + 1];
      ends.push(j < n - 1 ? (a.length >= b.length && a.slice(a.length - b.length) === b ? a.slice(0, a.length - b.length) : '') : a);
    }
    return { heads: heads, ends: ends };
  }
  function narUnits(node, m) {
    if (o.nar === false || !window.NAR321 || !NAR321.blocks || !NAR321.speech) return null;
    var body = node.querySelector('.xzt'), kids = arr(body ? body.children : []).filter(function (x) { return !x.classList.contains('xzhint'); });
    var bl = g(function () { return NAR321.blocks(m.text); }, null), us = [];
    if (!(bl && bl.length === kids.length)) return null;
    function U(t, spans, whole) {
      if (!t || !String(t).replace(/\s+/g, '')) return;
      us.push({ t: t, keys: spans.map(function (s) { return s.getAttribute('data-xk'); }), whole: !!whole });
    }
    function sp(el) { return X.sentText(el); }
    kids.forEach(function (el, b) {
      var spans = arr(el.querySelectorAll('.xzs')), blk = bl[b], done = false, n0 = us.length;
      if (!spans.length) return;
      try {
        if (blk.k === 'h') { U(NAR321.speech(blockMd(blk), { i: b }), spans); done = true; }
        else if (blk.k === 'table') { U(NAR321.speech(blockMd(blk), { i: b }), spans, true); done = true; }
        else if (blk.k === 'quote') {
          var lead = NAR321.speech('> ǂ', { i: b }).replace('ǂ', '');
          spans.forEach(function (s, j) { U((j === 0 ? lead : '') + X.endP(sp(s)), [s]); }); done = true;
        } else if (blk.k === 'list') {
          var lh = listHeads(blk, b), lis = arr(el.querySelectorAll('li'));
          if (lh && lis.length === blk.items.length) {
            lis.forEach(function (li, j) {
              var ss = arr(li.querySelectorAll('.xzs'));
              ss.forEach(function (s, q) {
                var tx = sp(s), last = q === ss.length - 1;
                U((q === 0 ? lh.heads[j] : '') + tx + (last && !/[。！？.!?]$/.test(tx) ? lh.ends[j] : ''), [s]);
              });
            });
            done = true;
          }
        }
      } catch (e) { done = false; us.length = n0; }
      if (!done) spans.forEach(function (s) { U(X.endP(sp(s)), [s]); });
    });
    return us.length ? us : null;
  }

  var HEAD = 'h1,h2,h3,h4,h5,h6';
  var A = {
    css: '.gxz .xzh>.xs{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +          /* 英文 320 寬標題列會把 ✕ 擠出畫面 */
         '.gxz .xzs.spk-now{background:rgba(31,77,61,.20)}.gxz table.spk-now{background:rgba(31,77,61,.12)}' +
         '@media (prefers-color-scheme:dark){.gxz .xzs.spk-now{background:rgba(120,190,150,.30)}}',
    lang: function () { var l = g(function () { return GXA_CFG.lang(); }, 'zh'); return l === 'en' ? 'en' : (l === 'zs' || l === 'sc' ? 'sc' : 'tc'); },
    toast: function (m) { g(function () { GXA.toast(m); }); },
    msgs: function () { return SAGE321.msgs(); },
    isDone: function (m) { return !!(m && m.role === 'assistant' && m.ok && !m.cont); },
    isUser: function (m) { return !!(m && m.role === 'user'); },
    busy: function () { return SAGE321.isBusy(); },
    open: function () { SAGE321.open(); },
    root: root,
    msgSel: '.xzm',
    nodeAt: nodeAt,
    msgAt: function (i) { return SAGE321.msgs()[i]; },
    bodyOf: function (node) { return node.querySelector('.xzt'); },
    scroller: function () { return document.getElementById('gxxzb'); },
    follow: function () { return true; },
    hint: true,
    answers: function () {
      var a = SAGE321.msgs(), out = [];
      arr(document.querySelectorAll('#gxaxz .xzm.assistant')).forEach(function (node) {
        var mm = NODE.exec(node.id), i = mm ? +mm[1] : -1, m = a[i];
        if (m) out.push({ node: node, body: node.querySelector('.xzt'), m: m, i: i, last: i === a.length - 1 });
      });
      return out;
    },
    units: function (node, m, i, dflt) { return narUnits(node, m) || dflt(node); },
    /* 先前存的小智訊息 → 放回 SAGE321 */
    store: o.store === false ? null : {
      get: function () { try { return JSON.parse(localStorage.getItem('xzm_' + SLUG) || 'null'); } catch (e) { return null; } },
      set: function (l) { try { localStorage.setItem('xzm_' + SLUG, JSON.stringify(l)); } catch (e) {} }
    },
    restore: function (list) {
      var a = SAGE321.msgs();
      if (a.length) return;
      list.forEach(function (x) { var m = { role: x.role, text: x.text, xid: x.id, at: x.at }; if (x.role === 'assistant') m.ok = true; a.push(m); });
      g(function () { SAGE321.draw(true); });
    },
    /* 畫線：GXA.hl（和正文同一個資料庫、同一個面板） */
    marks: {
      any: function () { return dbKeys().length > 0; },
      attach: function (r) {
        if (!r || !window.GXA || !GXA.hl) return;
        GXA.hl.attach(r, {
          unit: '.xzs', key: KEY, bind: false, head: HEAD + ',.xzhint',
          idOf: function (el) { return el.getAttribute('data-xk'); },
          refOf: function (el) { return refOf(el); },
          readFrom: function (el) { X.sayFrom(el); }
        });
      },
      paint: function (r) { if (r && r.__gxhl && window.GXA && GXA.hl) GXA.hl.paint(r); },
      tap: function (xk, el) { GXA.hl.tap(el); },
      keys: dbKeys
    },
    /* 朗讀引擎：TTS321（gxr.js）*/
    engine: window.TTS321 && window.GXR ? {
      ready: function () { g(function () { GXR.speak(''); }); },
      state: function () { return { on: g(function () { return TTS321.isOn(); }, false), i: g(function () { return TTS321.index(); }, -1) }; },
      stop: function () { g(function () { TTS321.stop(); }); },
      chunks: function (t) { return g(function () { return TTS321.chunks(t); }, []) || []; },
      play: function (parts, title) { this.ready(); TTS321.play(parts.map(function (u) { return { t: u.t, els: [] }; }), { title: title }); },   /* els:[] 讓 gxr.js 的 elFor 不會因為沒有元素而丟錯 */
      wrap: function (onOther) {
        ['play', 'playFrom'].forEach(function (n) {
          var f = TTS321[n]; if (typeof f !== 'function' || f.__xzm) return;
          TTS321[n] = function () { onOther(); return f.apply(this, arguments); };
          TTS321[n].__xzm = 1;
        });
      }
    } : null,
    syncBtn: function (rd) {
      arr(document.querySelectorAll('#gxaxz .xzm.assistant')).forEach(function (node) {
        var mm = NODE.exec(node.id), i = mm ? +mm[1] : -1, m = SAGE321.msgs()[i];
        arr(node.querySelectorAll('.xzact button')).forEach(function (b) {
          if ((b.getAttribute('onclick') || '').indexOf('SAGE321.speak(') < 0) return;
          var on = !!(rd && m && rd.mid === m.xid && rd.kind === 'msg');
          if (b.getAttribute('data-xzl') == null) b.setAttribute('data-xzl', b.textContent);
          b.textContent = on ? '⏹ ' + T('停止', 'Stop') : b.getAttribute('data-xzl');
          b.classList.toggle('on', on);
        });
      });
    },
    hook: function () {
      var s0 = SAGE321.speak;
      SAGE321.speak = function (i) { if (A.engine && X.speakMsg(i)) return; return s0.apply(this, arguments); };
      var o0 = SAGE321.open;
      SAGE321.open = function () { X.restore(); return o0.apply(this, arguments); };
    }
  };
  function refOf(el) {
    var id = X.parse(el.getAttribute('data-xk')).id, m = X.msgById(id), at = m && m.at;
    return T('小智', 'Xiaozhi') + (at ? ' · ' + g(function () { return new Date(at).toLocaleDateString(); }, '') : '');
  }
  return A;
};

/* ═══ preset.lesson：課程型 App（321mission／321life 這一系：S.chat 或 CHAT、S.hl 或 HL、spk 逐句朗讀、#xz 滿版小智）══
   畫線：把小智的句子做成宿主的 .sent（同一套 sentList／paintHl／openHlSheet／hlKeyOf），所以換色、領受、做成美圖、問小智、
        複製、分享、刪除全是宿主原本的面板與資料（HL 或 S.hl），不另存一份。
   朗讀：宿主的 spk（page 朗讀）佇列，一句一個項目，由宿主的 raSeg 加 .tts-reading 並捲到畫面中央。
   兩種宿主的差別由偵測決定：
     mission 型：S.chat／S.hl／hlRoot()，sentList(root)、paintHl(root)、區塊要有 data-l／data-b（我們補在回答的頂層區塊上）
     life 型   ：CHAT／HL，sentList()、paintHl()，區塊代號放在句子的 data-k
   opts.msgSel／ttsSel 等可覆寫；opts.noNow 不改 RA_COOL                                                    */
XZM.preset.lesson = function (o) {
  o = o || {};
  var X = XZM, g = X.g, arr = X.arr, T = X.T;
  var MIS = g(function () { return typeof hlRoot === 'function' && typeof S !== 'undefined' && !!S.hl && Array.isArray(S.chat); }, false);
  function CH() { return MIS ? S.chat : CHAT; }
  function HLS() { return MIS ? S.hl : HL; }
  function saveChatHost() { g(function () { if (MIS) save(); else saveChat(); }); }
  function saveHlHost() { g(function () { if (MIS) save(); else saveHL(); }); }
  function root() { return document.getElementById('xz'); }
  function lastOkIdx() { var a = CH(), i; for (i = a.length - 1; i >= 0; i--) if (a[i].role !== 'user') return A.isDone(a[i]) ? i : -1; return -1; }
  function chatEls() { var r = root(); return r ? arr(r.querySelectorAll('.sent.xzs')) : []; }
  function isChatEl(e) { return !!(e && e.classList && e.classList.contains('xzs') && e.closest && e.closest('#xz')); }
  function zRec(k) { return /^[a-z]+\|z:/.test(k); }
  function zKeys() { var h = HLS(), out = [], k; for (k in h) if (h.hasOwnProperty(k) && zRec(k) && (h[k].lang || 'zh') === g(function () { return L(); }, 'zh')) out.push(k); return out; }
  function refFor(el) {
    var id = X.parse(el.getAttribute('data-xk')).id, m = X.msgById(id), at = m && (m.ts || m.at);
    return T('小智', 'Xiaozhi') + (at ? ' · ' + g(function () { return new Date(at).toLocaleDateString(); }, '') : '');
  }
  function xkOfRec(h) { return h && h.xk ? h.xk : ''; }

  XZM._mis = MIS;
  var A = {
    lang: function () { var l = g(function () { return L(); }, 'zh'); return l === 'en' ? 'en' : (l === 'zs' ? 'sc' : 'tc'); },
    toast: function (m) { g(function () { toast(m); }); },
    msgs: function () { return CH(); },
    isDone: function (m) { return !!(m && m.role !== 'user' && m.ok && !m.wait && !m.cont && !m.err); },
    isUser: function (m) { return !!(m && m.role === 'user'); },
    busy: function () { return g(function () { return !!chatBusy; }, false); },
    open: function () { g(function () { openXz(); }); },
    root: root,
    msgSel: '.msg',
    nodeAt: function (i) { return document.getElementById('msg' + i); },
    msgAt: function (i) { return CH()[i]; },
    bodyOf: function (node) { return node.querySelector('.msg-body'); },
    scroller: function () { return document.getElementById('xzb'); },
    follow: function () { return true; },
    hint: true,
    /* 句子＝宿主的 .sent；life 型靠 data-k（區塊代號）、mission 型靠區塊上的 data-l／data-b */
    cls: 'sent',
    attrs: function (id, b, s, xk) { return MIS ? ' data-s="' + s + '"' : ' data-k="z:' + id + ':' + b + '" data-s="' + s + '"'; },
    idOf: function (m) { if (!m.xid) { m.xid = X.newId(); saveChatHost(); } return m.xid; },
    decorate: function (body, id) {
      var i = 0;
      arr(body.children).forEach(function (el) {
        if (el.classList.contains('xzhint') || !el.querySelector('.xzs')) return;
        el.setAttribute('data-xzb', '1'); el.setAttribute('data-l', 'z:' + id); el.setAttribute('data-b', String(i++));
        el.setAttribute('data-rf', T('小智', 'Xiaozhi'));
      });
    },
    answers: function () {
      var a = CH(), lk = lastOkIdx(), out = [];
      arr(document.querySelectorAll('#xz .msg.ai')).forEach(function (node) {
        var i = +String(node.id).replace('msg', ''), m = a[i];
        if (m) out.push({ node: node, body: node.querySelector('.msg-body'), m: m, i: i, last: i === lk });
      });
      return out;
    },
    marks: {
      any: function () { return zKeys().length > 0; },
      attach: function () { },
      paint: function () { g(function () { if (MIS) { paintHl(hlRoot()); } else paintHl(); }); },
      tap: function (xk, el) {
        var k = g(function () { return hlKeyOf(el); }, null);
        onSentTap(el);
        var r = k && HLS()[k];
        if (r && !r.xk) { r.xk = xk; saveHlHost(); }
        else if (!k) { var k2 = g(function () { return hlKeyOf(el); }, null); if (k2 && HLS()[k2] && !HLS()[k2].xk) { HLS()[k2].xk = xk; saveHlHost(); } }
      },
      keys: zKeys
    },
    /* 逐句朗讀：把句子排進宿主的 spk 佇列 */
    beginMsg: function (i, m, node, units, id, isFrom) {
      var key = 'm' + (i >= 0 ? i : CH().indexOf(m));
      if (!isFrom && g(function () { return sayKey === key && spk.on; }, false)) { stopAll(); return true; }
      if (node.classList.contains('fold')) g(function () { msgFold(CH().indexOf(m), true); });
      var items = [];
      units.forEach(function (u) {
        var els = u.keys.map(X.sentEl).filter(Boolean);
        if (u.whole && els[0]) { var tb = els[0].closest('table'); if (tb) els = [tb]; }
        var t = u.t;
        if (!els.length || !g(function () { return ttsPrep(t); }, t)) return;
        items.push({ text: t, segs: els, lens: [Math.max(1, g(function () { return ttsPrep(t).length; }, t.length))], locs: [], xks: u.keys.slice(), at: -1 });
      });
      if (!items.length) return false;
      stopAll(); ttsUnlock();
      var ttl = T('小智', 'Xiaozhi');
      spk = { on: true, items: items, idx: 0, cache: {}, native: false, abort: false, title: ttl };
      raManualAt = 0; sayKey = key;
      g(function () { keepAwake(true); }); g(function () { mediaSession(ttl); }); g(function () { drawFab(); });
      g(function () { paintSay(); });
      ttsPlayFrom(0);
      return true;
    },
    /* 聊天視窗重畫之後：把朗讀佇列裡的句子元素換成新的，現在唸到的那句重新亮起 */
    afterScan: function (tagged) {
      if (!tagged || !g(function () { return spk.on; }, false)) return;
      var cur = null;
      spk.items.forEach(function (it, j) {
        if (!it.xks) return;
        var els = it.xks.map(X.sentEl).filter(Boolean);
        if (els.length) { if (it.segs[0] && it.segs[0].tagName === 'TABLE') { var tb = els[0].closest('table'); if (tb) els = [tb]; } it.segs = els; }
        if (j === spk.idx) cur = it;
      });
      if (cur && cur.at >= 0) {
        var k = cur.at, keep = raManualAt; cur.at = -1; raManualAt = Date.now(); raSeg(cur, k); raManualAt = keep;
      }
    },
    syncBtn: function () { g(function () { paintSay(); }); },
    beforeMark: function (el) {
      var n = el.closest && el.closest('.msg');
      if (n && n.classList.contains('fold')) g(function () { msgFold(+String(n.id).replace('msg', ''), true); });
    },
    hook: function () {
      /* 1) 句子清單：不帶參數＝宿主的 hl 操作（含小智）；帶 root 參數＝只看那個 root（朗讀整頁不會唸到小智）*/
      var SL0 = window.sentList;
      if (MIS) window.sentList = function (r) { var l = SL0.apply(this, arguments); return r ? l : l.concat(chatEls()); };
      else window.sentList = function () { return SL0.apply(this, arguments).concat(chatEls()); };
      /* 2) 區塊／出處／畫線重畫 */
      var BK0 = window.blkOf;
      window.blkOf = function (el) {
        var tb = isChatEl(el) ? el.closest('table') : null;
        if (MIS) { var z = el && el.closest && el.closest('#xz [data-xzb]'); if (z) return z; }
        else if (tb) return tb;
        return BK0.apply(this, arguments);
      };
      var HR0 = window.hlRef;
      window.hlRef = function (x) {
        var e = Array.isArray(x) ? x[0] : x;
        if (isChatEl(e)) return refFor(e);
        return HR0.apply(this, arguments);
      };
      var PH0 = window.paintHl;
      window.paintHl = function (r) {
        var rr = root();
        if (rr) arr(rr.querySelectorAll('.hl-note')).forEach(function (n) { n.parentNode.removeChild(n); });
        var res = PH0.apply(this, arguments);
        if (MIS && r && r === hlRoot() && rr) PH0.call(this, rr);
        return res;
      };
      /* 3) 回到原處／我的畫線多一個「小智」類別 */
      if (typeof window.hlGo === 'function') {
        var GO0 = window.hlGo;
        window.hlGo = function (k) {
          var h = HLS()[k];
          if (h && zRec(k)) { var xk = xkOfRec(h); if (xk) X.jump(xk); else A.toast(T('原回答已不在對話中', 'The original answer is no longer in the chat')); return; }
          return GO0.apply(this, arguments);
        };
      }
      var MK0 = window.marksHTML, HLL0 = window.hlListHtml;
      function zSection() {
        var ks = zKeys().sort(function (a, b) { return (HLS()[b].ts || 0) - (HLS()[a].ts || 0); });
        if (!ks.length) return '';
        var h = '', E = X.esc;
        ks.forEach(function (k) {
          var x = HLS()[k], orphan = !(x.xk && X.msgById(X.parse(x.xk).id));
          h += '<div class="hitem"><div class="q" data-color="' + E(x.c) + '" data-c="' + E(x.c) + '">' + E(x.t) + '</div>' + (x.n ? '<div class="n">' + E(x.n) + '</div>' : '') +
            '<div class="m"><span>' + E(x.ref || '') + (orphan ? '　' + E(T('（原回答已不在對話中）', '(the original answer is no longer in the chat)')) : '') + '</span><span>' +
            (orphan ? '' : '<button class="linkbtn" onclick="XZM.jump(\'' + E(x.xk) + '\')">' + E(T('回到原處', 'Go back')) + '</button>') +
            '<button class="linkbtn" onclick="XZM.zCard(\'' + E(k) + '\')">🖼</button>' +
            '<button class="linkbtn" onclick="XZM.zAsk(\'' + E(k) + '\')">✨</button>' +
            '<button class="linkbtn danger" onclick="XZM.zDel(\'' + E(k) + '\')">✕</button></span></div></div>';
        });
        return '<section class="card xzsec"><div class="eyebrow">✨ ' + E(T('小智', 'Xiaozhi')) + '（' + ks.length + '）</div>' + h + '</section>';
      }
      function stashed(fn, self, args) {
        var st = {}, h = HLS();
        zKeys().forEach(function (k) { st[k] = h[k]; delete h[k]; });
        try { return fn.apply(self, args); } finally { Object.keys(st).forEach(function (k) { h[k] = st[k]; }); }
      }
      if (typeof MK0 === 'function') {
        window.marksHTML = function () {
          var h = stashed(MK0, this, arguments), z = zSection();
          if (!z) return h;
          var i = h.lastIndexOf('<section class="card"><div class="eyebrow">');
          return i < 0 ? h + z : h.slice(0, i) + z + h.slice(i);
        };
      }
      if (typeof HLL0 === 'function') {
        window.hlListHtml = function () {
          var h = stashed(HLL0, this, arguments), z = zSection();
          if (!z) return h;
          if (/class="empty"/.test(h)) h = '';
          return h + z;
        };
      }
      /* 4) 🔊 與畫線面板的朗讀：capture 階段攔截，小智頁上才逐句跟讀 */
      var TTS = MIS ? '[data-act="msgtts"]' : '[data-xa="tts"]';
      document.addEventListener('click', function (e) {
        var t = e.target, b = t && t.closest ? t.closest(TTS) : null;
        if (b && b.closest('#xz')) {
          if (X.speakMsg(+b.getAttribute('data-i'))) { e.stopPropagation(); e.preventDefault(); }
          return;
        }
        var nb = t && t.closest ? t.closest('#xz .hl-note') : null;
        if (nb && !g(function () { return !!document.getElementById(MIS ? 'hsheet' : 'sheet'); }, false)) {   /* 點領受條＝打開那一句的面板 */
          var hk = nb.getAttribute('data-hk'), list = chatEls(), q;
          for (q = 0; q < list.length; q++) if (g(function () { return hlKeyOf(list[q]); }) === hk) { e.stopPropagation(); e.preventDefault(); openHlSheet(list[q]); break; }
          return;
        }
        var cur = g(function () { return hlCur; }, null);
        if (!cur || !isChatEl(cur.el)) return;
        var rb = t && t.closest ? t.closest(MIS ? '[data-act="hlread"]' : '[data-ha="read"],[data-ha="from"]') : null;
        if (rb) {
          e.stopPropagation(); e.preventDefault();
          var one = MIS || rb.getAttribute('data-ha') === 'read', el = cur.el;
          g(function () { hlNoteGrab(); }); g(function () { MIS ? closeHSheet() : closeSheet(); });
          g(function () { MIS ? paintHl(hlRoot()) : paintHl(); });
          X.sayFrom(el, one);
        }
      }, true);
      if (!o.noNow && typeof window.RA_COOL === 'number') window.RA_COOL = Math.max(window.RA_COOL, 6000);   /* 使用者自己捲動後 6 秒不搶畫面（宿主原本 4 秒）*/
      /* 5) 句子點擊在 mission 型由我們自己處理（宿主 document 監聽只認 target 本身是 .sent，點到粗體會漏掉）*/
    },
    css: '@media (max-width:360px){#xz .hd{gap:6px;padding-left:10px;padding-right:10px}#xz .hd .btn.sm{padding-left:8px;padding-right:8px}#xz .hd .ib{min-width:36px}}' +
         '#xz .hd .grow{min-width:0}#xz .hd .grow .xs{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
         '.xz table.tts-reading,.xz .tts-reading>table{background:rgba(108,147,209,.22)}' +
         '.xz .msg-body .sent{-webkit-box-decoration-break:clone;box-decoration-break:clone}' +
         '.xz .msg-body .xzhint{margin-top:10px}' +
         /* 宿主的小智視窗層級 >= 面板（ot／soul／truth：xz 80、面板 75）時，面板會被蓋住：只在這種情況把面板抬到視窗之上；層級本來就夠的（mission、pray…）不輸出任何規則 */
         g(function () {
           var t = document.createElement('div'); t.className = 'xz'; t.style.display = 'none'; document.body.appendChild(t);
           var zx = parseInt(getComputedStyle(t).zIndex, 10); document.body.removeChild(t);
           var m = document.createElement('div'); m.className = 'sheet-mask'; m.style.display = 'none'; document.body.appendChild(m);
           var zs = parseInt(getComputedStyle(m).zIndex, 10); document.body.removeChild(m);
           return (zx >= 0 && !(zs > zx)) ? '#hsheet.sheet-mask,#sheet.sheet-mask{z-index:' + (zx + 5) + '}' : '';
         }, '')
  };
  return A;
};
/* 清單裡「小智」項目的按鈕動作 */
XZM.zCard = function (k) { var h = XZM.g(function () { return (typeof S !== 'undefined' && S.hl && S.hl[k]) || HL[k]; }); if (h && window.openStudio) openStudio({ t: h.t, ref: h.ref, n: h.n }); };
XZM.zAsk = function (k) {
  var h = XZM.g(function () { return (typeof S !== 'undefined' && S.hl && S.hl[k]) || HL[k]; });
  if (!h) return;
  var q = XZM.T('請就這句幫助我默想：', 'Please help me reflect on this: ') + '「' + h.t + '」' + (h.n ? '\n' + XZM.T('我的領受：', 'My reflection: ') + h.n : '');
  XZM.g(function () { if (XZM._mis) openXz(q, undefined, { t: h.t, ref: h.ref }); else openXz(q, { t: h.t, ref: h.ref }); });
};
XZM.zDel = function (k) {
  var H = XZM.g(function () { return (typeof S !== 'undefined' && S.hl) ? S.hl : HL; });
  if (H && H[k]) { delete H[k]; XZM.g(function () { if (typeof S !== 'undefined' && S.hl) save(); else saveHL(); }); }
  XZM.g(function () { if (typeof S !== 'undefined' && S.hl) { render(); } else { keepScroll(); } });
};
/* ═══ preset.sage：「課程＋AI 小智」範本（235leader／321assistant／321head／321leader／321student／321creation）══════════
   這一系的宿主已經自己做完：
     · 小智回答 .msg.ai[data-mid] 放在 #chatlog（我的收藏 #favlog），完成後 bindBodies → wrapSents(b,'chat|'+mid) 切成 .sent
     · 畫線：HLS['chat|mid|區塊|句'] ＋ paintHl／onSentTap／openHlSheet（點一下畫線、再點開面板）
     · 朗讀：spk 佇列 ＋ ttsPlayFrom ＋ raSeg（加 .tts-reading 並捲到畫面中央）
     · 訊息保存：S.chat（或 localStorage CHATKEY），m.id 穩定，最多 40 則
   所以本 preset 不切句、不另存畫線，只補宿主缺的三件事：
     1) 🔊 逐句跟讀：把回答的 .sent 一句一個項目排進宿主的 spk，由宿主的 ttsPlayFrom／raSeg 高亮與捲動；
        表格整張高亮（一列一個朗讀單位，高亮整張 table）；已收合的回答先展開；串流／接續寫作中不接管（宿主照舊整段念）
     2) 畫線面板「朗讀這句」：小智句子改成單句（含「範圍」多句）逐句高亮，不再整段念不高亮
     3) 手動捲動保護 6 秒（RA_COOLDOWN 拉到 ≥ 6000，再補鍵盤捲動）
   補洞：宿主的 mdToHtml 對「## 標題\n緊接的文字」不包 <p>，這些頂層裸文字不在 [data-b] 區塊裡，wrapSents 完全沒切到——不能點、朗讀也會漏唸。
        本 preset 在宿主畫完之後，把頂層裸文字節點用宿主自己的 wrapSents 補切（key＝chat|mid|x<節點序>|句，不動既有區塊的 key），
        唸的時候相鄰的「粗體開頭＋後面的裸文字」合成一個朗讀單位（同時亮起）。
   宿主頁面重畫（收合、收藏、送出新問題）後，把 spk 項目裡的句子元素換成新節點、現在唸到的那句重新亮起。
   取得宿主內部函式的方式：window.XZM_HOST（宿主在 IIFE 內時由宿主放一個小掛鉤，321creation 用）；沒有就直接讀全域。
   XZM_HOST = { fn:{wrapSents,groups,gText,rootOf,ttsPrep,ttsStop,ttsSayStop,ttsUnlock,ttsBtn,ttsPlayFrom,raSeg,wake?,saveHl,paintHl,msgAction},
                spk(v?), reset(), manual(), cool(ms), busy(), audio(), list(where), hls() }                                                    */
XZM.preset.sage = function (o) {
  o = o || {};
  var X = XZM, g = X.g, arr = X.arr, T = X.T;
  var COOL = o.cool || 6000;
  var lastTap = '';                                   /* 最後一次點的 .sent 的畫線 key（面板「朗讀這句」要知道是哪一句）*/

  /* ── 宿主橋接：IIFE 宿主給 XZM_HOST；全域宿主直接讀 window ───────────────── */
  function H() {
    if (window.XZM_HOST) return window.XZM_HOST;
    return {
      fn: window,
      spk: function (v) { if (v) window.spk = v; return window.spk; },
      manual: function () { window.raManualAt = Date.now(); },
      reset: function () { window.raManualAt = 0; },
      cool: function (ms) { if (typeof window.RA_COOLDOWN === 'number' && window.RA_COOLDOWN < ms) window.RA_COOLDOWN = ms; },
      busy: function () { return !!window.chatBusy; },
      audio: function () { return window.ttsEl; },
      list: function (w) { return w === 'fav' ? window.FAV : window.CHAT; },
      hls: function () { return window.HLS; }
    };
  }
  function F(n) { var h = H(); return (h.fn && h.fn[n]) || null; }
  function SP() { return g(function () { return H().spk(); }, null); }
  function isEn() { return /^en/i.test(document.documentElement.lang || ''); }

  /* ── 補切頂層裸文字（宿主 wrapSents 漏掉的）────────────────────────── */
  var BLOCK = /^(P|UL|OL|DL|H[1-6]|BLOCKQUOTE|TABLE|DIV|PRE|HR|SECTION|FIGURE|DETAILS)$/;
  function fixLoose(body) {
    if (body.getAttribute('data-xzl') || !body.querySelector('.sent')) return false;
    var mid = body.parentNode && body.parentNode.getAttribute('data-mid'), ws = F('wrapSents'), done = 0;
    if (!mid || !ws) return false;
    body.setAttribute('data-xzl', '1');
    arr(body.childNodes).forEach(function (nd, i) {
      if (nd.nodeType !== 3 || !/\S/.test(nd.nodeValue)) return;
      var outer = document.createElement('span'), inner = document.createElement('p');   /* P：各宿主的領受條都掛在 P 後面（321creation 的清單不含 DIV）；CSS 讓它維持行內 */
      inner.setAttribute('data-b', 'x' + i); inner.className = 'xzl';
      inner.appendChild(document.createTextNode(nd.nodeValue));
      outer.appendChild(inner);
      ws(outer, 'chat|' + mid);
      body.replaceChild(inner, nd); done++;
    });
    if (done) g(function () { F('paintHl')(); });
    return done > 0;
  }
  function fixAll() { arr(document.querySelectorAll('#chatlog .msg.ai .msg-body,#favlog .msg.ai .msg-body')).forEach(function (b) { g(function () { fixLoose(b); }); }); }
  function topOf(body, el) { while (el && el.parentNode !== body) el = el.parentNode; return el; }
  function nextSib(n) { n = n && n.nextSibling; while (n && n.nodeType === 3 && !/\S/.test(n.nodeValue)) n = n.nextSibling; return n; }
  var ENDP = /[。！？.!?][」』）)"”’]*$/;

  /* ── 朗讀單位 ──────────────────────────────────────────────────── */
  function cellText(c) { return (c.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function tableUnits(tb, idx, keys) {
    var rows = arr(tb.querySelectorAll('tr')).map(function (tr) { return arr(tr.children).map(cellText).filter(Boolean); }).filter(function (r) { return r.length; });
    var head = rows[0] || [], body = rows.slice(1), en = isEn(), out = [];
    function U(t) { out.push({ t: t, keys: keys, tb: idx }); }
    if (!body.length) { if (head.length) U(X.endP(head.join(en ? ', ' : '，'))); return out; }
    body.forEach(function (r, i) {
      var s = r.map(function (c, j) { var hh = head[j] || ''; c = c.replace(/[。！？.!?]+$/, ''); return hh && r.length > 1 ? (en ? hh + ' is ' + c : hh + '是' + c) : c; }).join(en ? ', ' : '，') + (en ? '.' : '。');
      U((i === 0 ? (en ? 'Here is a summary: ' : '下面用表格整理：') : '') + s);
    });
    return out;
  }
  function unitsOf(body) {
    var gs = g(function () { return F('groups')(body); }, []), gText = F('gText'), tbs = arr(body.querySelectorAll('table')), seen = {}, out = [], prev = null;
    gs.forEach(function (gr) {
      var tb = gr.els[0] && gr.els[0].closest ? gr.els[0].closest('table') : null, ti = tb ? tbs.indexOf(tb) : -1;
      if (ti >= 0) {
        prev = null;
        if (seen[ti]) return;
        seen[ti] = 1;
        var ks = {}, kl = [];
        gs.forEach(function (x) { if (x.els[0] && tb.contains(x.els[0]) && !ks[x.k]) { ks[x.k] = 1; kl.push(x.k); } });
        tableUnits(tb, ti, kl).forEach(function (u) { out.push(u); });
        return;
      }
      var t = gText(gr);
      if (!t) return;
      var tf = topOf(body, gr.els[0]), tl = topOf(body, gr.els[gr.els.length - 1]);
      if (prev && !ENDP.test(prev.raw) && prev.tl && tf && !BLOCK.test(prev.tl.tagName || '') && !BLOCK.test(tf.tagName || '') && nextSib(prev.tl) === tf) {
        prev.raw += (isEn() ? ' ' : '') + t; prev.keys.push(gr.k); prev.tl = tl; return;       /* 粗體開頭＋後面的裸文字：同一句 */
      }
      prev = { raw: t, keys: [gr.k], tl: tl };
      out.push(prev);
    });
    return out.map(function (u) { return u.raw === undefined ? u : { t: X.endP(u.raw), keys: u.keys, tb: -1 }; });
  }
  function elsOf(body, u) {
    if (u.tb >= 0) { var tb = body.querySelectorAll('table')[u.tb]; return tb ? [tb] : []; }
    var out = [];
    u.keys.forEach(function (k) { arr(body.querySelectorAll('.sent')).forEach(function (e) { if (e.getAttribute('data-k') === k) out.push(e); }); });
    return out;
  }
  function nodeOfMid(mid, where) {
    var log = document.getElementById(where === 'fav' ? 'favlog' : 'chatlog'), n = null;
    if (!log) return null;
    arr(log.querySelectorAll('.msg.ai')).forEach(function (x) { if (x.getAttribute('data-mid') === mid) n = x; });
    return n;
  }

  /* ── 開唸：一句一個項目排進宿主的 spk ─────────────────────────────── */
  function start(node, units, one, btn) {
    var body = node.querySelector('.msg-body'), prep = F('ttsPrep'), items = [], h = H();
    if (!body || !prep) return false;
    units.forEach(function (u) {
      var els = elsOf(body, u), n = g(function () { return prep(u.t).length; }, 0);
      if (els.length && n > 0) items.push({ text: u.t, segs: [els], lens: [Math.max(1, n)], at: -1, u: u });
    });
    if (!items.length) return false;
    var mid = node.getAttribute('data-mid'), where = node.parentNode && node.parentNode.id === 'favlog' ? 'fav' : 'chat';
    /* 只有「正在唸」才先停；閒置時不呼叫 ttsStop（它會 pause 已播完的 audio，Chromium 會補發 ended，舊的 onended 就把新佇列結束掉）*/
    var sp0 = SP();
    if (sp0 && sp0.on) F('ttsStop')(); else { var ss = F('ttsSayStop'); if (ss) ss(); }
    /* 宿主 ttsUnlock 在還沒解鎖成功時會再播一次靜音 wav，它的 ended 會觸發上一輪遺留的 onended → 新佇列被直接結束；先清掉舊處理器 */
    g(function () { var au = h.audio && h.audio(); if (au) { au.onended = null; au.onerror = null; au.ontimeupdate = null; } });
    F('ttsUnlock')();
    g(function () { h.reset(); });                                  /* 開唸時第一句一定捲到畫面中央 */
    g(function () { h.cool(COOL); });
    var label = btn ? btn.textContent : '';
    h.spk({ on: true, items: items, idx: 0, cache: {}, native: false, abort: false, btn: one ? null : btn, label: label || '🔊', root: 'xzm-sage', sage: { mid: mid, where: where, one: !!one } });
    g(function () { var w = F('wake'); if (w) w(true); });
    F('ttsBtn')('loading');
    F('ttsPlayFrom')(0);
    return true;
  }
  /* 收合的回答先展開（用宿主自己的「展開」動作，會存 col 並重畫、保留捲動位置）*/
  function unfold(node) {
    if (!node.classList.contains('col')) return node;
    var mid = node.getAttribute('data-mid'), where = node.parentNode.id === 'favlog' ? 'fav' : 'chat', mb = node.querySelector('.msg-more');
    if (mb) g(function () { F('msgAction')({ target: mb }); });
    return nodeOfMid(mid, where) || node;
  }
  function speakBtn(btn) {
    var node = btn.closest('.msg.ai');
    if (!node || H().busy()) return false;                          /* 接續寫作中：宿主照舊 */
    var sp = SP(), mid = node.getAttribute('data-mid'), where = btn.getAttribute('data-w') || 'chat';
    if (sp && sp.on && sp.sage && sp.sage.mid === mid && sp.sage.where === where) { F('ttsStop')(); return true; }   /* 再按一次＝停止 */
    if (!node.querySelector('.sent')) return false;
    node = unfold(node);
    g(function () { fixLoose(node.querySelector('.msg-body')); });
    btn = node.querySelector('.msg-act[data-a="tts"]') || btn;
    var units = unitsOf(node.querySelector('.msg-body'));
    if (!units.length) return false;
    return start(node, units, false, btn);
  }
  /* 面板的「朗讀這句」：小智句子 → 單句（或畫線範圍內的幾句）逐句高亮 */
  function speakHl(mask) {
    var k = lastTap, hls = g(function () { return H().hls(); }, null), hh = hls && hls[k], q = document.getElementById('hlQuote');
    if (!hh || !/^chat\|/.test(k) || !q || q.textContent !== hh.t) return false;
    var first = document.querySelector('.sent[data-k="' + k + '"]'), body = first && F('rootOf')(first), node = body && body.closest('.msg.ai');
    if (!node) return false;
    var gs = F('groups')(body), i = -1, j, units = [], gText = F('gText'), n = Math.max(1, +hh.sp || 1);
    for (j = 0; j < gs.length; j++) if (gs[j].k === k) { i = j; break; }
    if (i < 0) return false;
    for (j = i; j < i + n && j < gs.length; j++) { var t = gText(gs[j]); if (t) units.push({ t: X.endP(t), keys: [gs[j].k], tb: -1 }); }
    if (!units.length) return false;
    var ta = document.getElementById('hlNote');
    if (ta) hh.n = ta.value.replace(/^\s+|\s+$/g, '');
    g(function () { F('saveHl')(); });
    if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    g(function () { F('paintHl')(); });
    return start(node, units, true, null);
  }

  /* ── 宿主重畫之後把朗讀佇列接回新的節點 ─────────────────────────────── */
  var rebinding = false;
  function rebind() {
    var sp = SP();
    if (rebinding || !sp || !sp.on || !sp.sage) return;
    var cur = sp.items[sp.idx] || sp.items[0], probe = cur && cur.segs[0] && cur.segs[0][0];
    if (probe && document.body.contains(probe)) return;
    rebinding = true;
    try {
      var node = nodeOfMid(sp.sage.mid, sp.sage.where), body = node && node.querySelector('.msg-body');
      if (!body) {
        var lg = document.getElementById(sp.sage.where === 'fav' ? 'favlog' : 'chatlog');
        if (lg && g(function () { return H().list(sp.sage.where).every(function (m) { return m.id !== sp.sage.mid; }); }, false)) F('ttsStop')();   /* 這則回答已被刪掉 */
        return;
      }
      sp.items.forEach(function (it) { it.segs = [elsOf(body, it.u)]; });
      var btn = node.querySelector('.msg-act[data-a="tts"]');
      if (!sp.sage.one && btn) { sp.btn = btn; g(function () { F('ttsBtn')('playing'); }); }
      if (cur && cur.at >= 0) {
        var k = cur.at; cur.at = -1;
        var h = H(); g(function () { h.manual(); });                 /* 只重新亮起、不搶畫面 */
        g(function () { F('raSeg')(cur, k); });
      }
    } finally { rebinding = false; }
  }

  var A = {
    lang: function () { var l = document.documentElement.lang || ''; return /^en/i.test(l) ? 'en' : (/Hans|CN/i.test(l) ? 'sc' : 'tc'); },
    toast: function () { },
    msgs: function () { return []; },
    isDone: function () { return false; },
    isUser: function () { return false; },
    busy: function () { return false; },
    root: function () {
      var r = document.getElementById('xzm-sage-root');
      if (!r && document.body) { r = document.createElement('div'); r.id = 'xzm-sage-root'; r.hidden = true; document.body.appendChild(r); }
      return r;
    },
    msgSel: '.msg.ai', nodeAt: function () { return null; }, msgAt: function () { return null; }, bodyOf: function (n) { return n.querySelector('.msg-body'); },
    answers: function () { return []; },                           /* 切句與畫線都是宿主做的，核心不掃描 */
    scroller: function () { return document.scrollingElement || document.documentElement; },
    marks: { attach: function () { }, paint: function () { }, tap: function () { }, keys: function () { return []; }, any: function () { return false; } },
    store: null,
    hook: function () {
      var h = H();
      if (!F('groups') || !F('ttsPlayFrom') || !F('raSeg') || !F('ttsPrep') || !h.spk) return;
      g(function () { h.cool(COOL); });
      /* document capture：🔊（小智訊息）與畫線面板的「朗讀這句」 */
      document.addEventListener('click', function (e) {
        var t = e.target; if (!t || !t.closest) return;
        var s = t.closest('.sent');
        if (s) { lastTap = s.getAttribute('data-own') || s.getAttribute('data-k') || ''; return; }
        var b = t.closest('.msg-act[data-a="tts"]');
        if (b && b.closest('#chatlog,#favlog')) {
          if (speakBtn(b)) { e.stopPropagation(); e.preventDefault(); }
          return;
        }
        var rb = t.closest('.hlsheet-mask [data-a="read"]');
        if (rb && speakHl(rb.closest('.hlsheet-mask'))) { e.stopPropagation(); e.preventDefault(); }
      }, true);
      /* 手動捲動保護：宿主已聽 wheel／touchmove；補鍵盤與拖捲軸，朗讀中才算 */
      window.addEventListener('keydown', function (e) {
        var sp = SP();
        if (sp && sp.on && /^(Arrow|Page)|^(Home|End)$|^ $/.test(e.key || '')) g(function () { H().manual(); });
      });
      window.addEventListener('pointerdown', function (e) {
        var sp = SP();
        if (sp && sp.on && (e.target === document.documentElement || e.target === document.body)) g(function () { H().manual(); });
      }, { passive: true });
      if (window.MutationObserver) new MutationObserver(function () { fixAll(); rebind(); }).observe(document.body, { childList: true, subtree: true });
      fixAll();
    },
    css: '.msg-body p.xzl{display:inline!important;margin:0!important;padding:0!important}.msg-body table.tts-reading,.msg-body table.tts-reading th,.msg-body table.tts-reading td{background:var(--reading,#D6E3F7)}' +
         '.msg-body table.tts-reading{box-shadow:0 0 0 3px var(--reading,#D6E3F7)}'
  };
  XZM.sage = { start: start, units: unitsOf, rebind: rebind, speakBtn: speakBtn, fix: fixAll };
  return A;
};
/* ═══ preset.mix：混合系（G3：課程型宿主＋內嵌 SAGE321 v2 小智＋GXHL 畫線，朗讀走宿主的 spk 頁面朗讀）══════════
   聊天與畫線＝preset.gx（#gxaxz／#gxxzm{i}／.xzt、GXA.hl 資料庫 gxa_hl_<slug>、點一下畫線再點開面板）；
   朗讀＝preset.lesson 的做法：一句一個項目排進宿主的 spk 佇列，由宿主的 ttsPlayFrom／raSeg 加 .tts-reading 並捲到畫面中央
        （宿主沒有 TTS321，所以不用 poll 型引擎）；口語帶入詞照舊用 NAR321（與 SAGE321 原本的 onSpeak 一致）。
   另補：「我的畫線」（宿主 hlListHtml）多一個「✨ 小智」區段；朗讀按鈕狀態（⏹ 停止）；RA_COOL 拉到 ≥ 6000；
        聊天視窗重畫（收合、收藏、送出新問題）後把朗讀佇列接回新節點。
   取得宿主內部函式：宿主在頂層 script（churchlife／seekerlife）就直接讀 window；宿主包在 IIFE 裡（family／marriage／spiritual／work）
   則由宿主放一個只做存取的小掛鉤 window.XZM_MIXHOST：
     { fn:{ttsPrep,ttsUnlock,ttsPlayFrom,stopAll,raSeg,keepAwake,mediaSession}, spk(v?), manual(v?), cool(ms), say(v),
       nextGen?()（有 ttsGen 的宿主）, wrapPaintSay(w), wrapHlList(w), wrapTtsStop?(w)（ttsStop 有 natural 參數、會自動換頁的宿主）, resume?(v?) }       */
XZM.preset.mix = function (o) {
  o = o || {};
  var X = XZM, g = X.g, arr = X.arr, T = X.T;
  var A = XZM.preset.gx(o);
  var SLUG = o.slug || g(function () { return GXA_CFG.slug; }, 'app'), KEY = SLUG + '-xz', NODE = /^gxxzm(\d+)$/;
  var gxCss = A.css || '';
  A.engine = null;                                       /* 宿主沒有 TTS321：🔊 由 beginMsg 接管 */

  function H() {
    if (window.XZM_MIXHOST) return window.XZM_MIXHOST;
    var W = window;
    return {
      fn: W,
      spk: function (v) { if (v) W.spk = v; return W.spk; },
      manual: function (v) { if (v !== undefined) W.raManualAt = v; return W.raManualAt; },
      cool: function (ms) { if (typeof W.RA_COOL === 'number' && W.RA_COOL < ms) W.RA_COOL = ms; },
      say: function (v) { W.sayKey = v; },
      wrapPaintSay: function (w) { var f = W.paintSay; if (typeof f === 'function') W.paintSay = function () { var r = f.apply(this, arguments); try { w(); } catch (e) { } return r; }; },
      wrapHlList: function (w) { var f = W.hlListHtml; if (typeof f === 'function') W.hlListHtml = function () { return w(f.apply(this, arguments)); }; }
    };
  }
  function F(n) { return g(function () { return H().fn[n]; }, null); }
  function SP() { return g(function () { return H().spk(); }, null); }
  function spkOn() { var s = SP(); return !!(s && s.on && s.xzm); }
  function spkMid() { var s = SP(); return s && s.xzm ? s.xzm.mid : ''; }

  A.beginMsg = function (i, m, node, units, id, isFrom) {
    var prep = F('ttsPrep'), play = F('ttsPlayFrom');
    if (!prep || !play) return false;
    if (!isFrom && spkOn() && spkMid() === id) { g(function () { F('stopAll')(); }); return true; }      /* 再按一次＝停止 */
    var items = [];
    units.forEach(function (u) {
      var els = u.keys.map(X.sentEl).filter(Boolean);
      if (u.whole && els[0]) { var tb = els[0].closest('table'); if (tb) els = [tb]; }
      var t = u.t, n = g(function () { return prep(t).length; }, t.length);
      if (!els.length || !n) return;
      items.push({ text: t, segs: els, lens: [Math.max(1, n)], locs: [], xks: u.keys.slice(), at: -1 });
    });
    if (!items.length) return false;
    g(function () { F('stopAll')(); }); g(function () { F('ttsUnlock')(); });
    var ttl = T('小智', 'Xiaozhi'), h = H(), gen = g(function () { return h.nextGen ? h.nextGen() : 0; }, 0);
    h.spk({ on: true, paused: false, items: items, idx: 0, cache: {}, native: false, abort: false, gen: gen, audio: null, title: ttl, xzm: { mid: id } });
    g(function () { h.manual(0); });                       /* 開唸時第一句一定捲到畫面中央 */
    g(function () { h.say('xzm'); });
    g(function () { F('keepAwake')(true); }); g(function () { F('mediaSession')(ttl); }); g(function () { var d = F('drawSpk'); if (d) d(); });
    A.syncBtn();
    play(0, gen);
    return true;
  };
  /* 聊天視窗重畫之後：把朗讀佇列裡的句子元素換成新的，現在唸到的那句重新亮起 */
  A.afterScan = function (tagged) {
    if (!tagged || !spkOn()) return;
    var sp = SP(), cur = null, h = H();
    sp.items.forEach(function (it, j) {
      if (!it.xks) return;
      var els = it.xks.map(X.sentEl).filter(Boolean);
      if (els.length) { if (it.segs[0] && it.segs[0].tagName === 'TABLE') { var tb = els[0].closest('table'); if (tb) els = [tb]; } it.segs = els; }
      if (j === sp.idx) cur = it;
    });
    A.syncBtn();
    if (cur && cur.at >= 0) {
      var k = cur.at, keep = h.manual(); cur.at = -1; h.manual(Date.now()); g(function () { F('raSeg')(cur, k); }); h.manual(keep);
    }
  };
  A.reading = spkOn;
  A.syncBtn = function () {
    var mid = spkOn() ? spkMid() : '';
    arr(document.querySelectorAll('#gxaxz .xzm.assistant')).forEach(function (node) {
      var mm = NODE.exec(node.id), i = mm ? +mm[1] : -1, m = g(function () { return SAGE321.msgs()[i]; }, null);
      arr(node.querySelectorAll('.xzact button')).forEach(function (b) {
        if ((b.getAttribute('onclick') || '').indexOf('SAGE321.speak(') < 0) return;
        var on = !!(mid && m && m.xid === mid);
        if (b.getAttribute('data-xzl') == null) b.setAttribute('data-xzl', b.textContent);
        b.textContent = on ? '⏹ ' + T('停止', 'Stop') : b.getAttribute('data-xzl');
        b.classList.toggle('on', on);
      });
    });
  };

  /* ── 我的畫線：宿主清單多一個「✨ 小智」區段（資料在 GXA.hl 資料庫，key＝<slug>-xz|…）──────────────── */
  function zKeys() {
    var d = g(function () { return GXA.hl.db(); }, {}), p = KEY + '|';
    return Object.keys(d).filter(function (k) { return k.indexOf(p) === 0 && d[k] && d[k].t; }).sort(function (a, b) { return (d[b].ts || 0) - (d[a].ts || 0); });
  }
  function zSection() {
    var ks = zKeys(), d = X.mixDb(), E = X.esc, h = '';
    if (!ks.length) return '';
    ks.forEach(function (k) {
      var x = d[k], xk = k.slice(KEY.length + 1), orphan = !X.msgById(X.parse(xk).id);
      h += '<div class="hitem"><div class="q" data-c="' + E(x.c || 'gold') + '">' + E(x.t) + '</div>' + (x.n ? '<div class="n">' + E(x.n) + '</div>' : '') +
        '<div class="m"><span>' + E(x.ref || '') + (orphan ? '　' + E(T('（原回答已不在對話中）', '(the original answer is no longer in the chat)')) : '') + '</span><span>' +
        (orphan ? '' : '<button class="linkbtn" onclick="XZM.mixGo(\'' + E(k) + '\')">' + E(T('回到原處', 'Go back')) + '</button>') +
        '<button class="linkbtn" onclick="XZM.mixCard(\'' + E(k) + '\')">🖼</button>' +
        '<button class="linkbtn" onclick="XZM.mixAsk(\'' + E(k) + '\')">✨</button>' +
        '<button class="linkbtn danger" onclick="XZM.mixDel(\'' + E(k) + '\',this)">✕</button></span></div></div>';
    });
    return '<div class="card xzsec" style="padding:4px 16px"><div class="eyebrow" style="margin:10px 0 2px">✨ ' + E(T('小智', 'Xiaozhi')) + '（' + ks.length + '）</div>' + h + '</div>';
  }
  X.mixDb = function () { return g(function () { return GXA.hl.db(); }, {}); };
  X.mixGo = function (k) { X.jump(k.slice(KEY.length + 1)); };
  X.mixCard = function (k) { var h = X.mixDb()[k]; if (h) g(function () { GXA.studio({ text: h.t, ref: h.ref || '', note: h.n || '' }); }); };
  X.mixAsk = function (k) {
    var h = X.mixDb()[k]; if (!h) return;
    var q = T('請就這句話幫助我默想：「', 'Help me meditate on this: “') + h.t + T('」', '”') + (h.n ? '\n' + T('我的領受：', 'My reflection: ') + h.n : '');
    g(function () { SAGE321.open(); SAGE321.send(q); });
  };
  X.mixDel = function (k, btn) {
    var d = X.mixDb();
    if (d[k]) { delete d[k]; g(function () { localStorage.setItem('gxa_hl_' + SLUG, JSON.stringify(d)); }); }
    g(function () { arr(document.querySelectorAll('#gxaxz')).forEach(function (r) { GXA.hl.paint(r); }); });
    /* 清單即時更新：移除該列；整區沒有了就移除整個區段（宿主若有 render 也一併重畫）*/
    g(function () {
      var row = btn && btn.closest ? btn.closest('.hitem') : null, sec = row && row.closest('.xzsec');
      if (row) row.parentNode.removeChild(row);
      if (sec) {
        var n = sec.querySelectorAll('.hitem').length, ey = sec.querySelector('.eyebrow');
        if (!n) sec.parentNode.removeChild(sec); else if (ey) ey.textContent = ey.textContent.replace(/[（(]\d+[）)]/, '（' + n + '）');
      }
    });
    g(function () { if (typeof render === 'function') render(); });
  };

  A.hook = function () {
    var h = H();
    var s0 = SAGE321.speak;
    SAGE321.speak = function (i) { if (X.speakMsg(i)) return; return s0.apply(this, arguments); };
    var o0 = SAGE321.open;
    SAGE321.open = function () { X.restore(); return o0.apply(this, arguments); };
    if (!o.noNow) g(function () { h.cool(6000); });        /* 使用者自己捲動後 6 秒不搶畫面（宿主原本 4 秒）*/
    g(function () { h.wrapPaintSay(function () { A.syncBtn(); }); });
    g(function () { h.wrapHlList(function (html) {
      var z = zSection();
      if (!z) return html;
      if (/class="empty"/.test(html)) html = '';
      return html + z;
    }); });
    /* 宿主的 ttsStop（有 natural 參數）：念完／停止小智回答時不要觸發「自動下一頁」、也不要蓋掉課程頁的續讀位置 */
    g(function () { if (h.wrapTtsStop) h.wrapTtsStop(function (orig, self, args) {
      if (!spkOn()) return orig.apply(self, args);
      var keep = h.resume ? h.resume() : null;
      var r = orig.call(self, false);
      if (h.resume) h.resume(keep);
      return r;
    }); });
    window.addEventListener('keydown', function (e) {
      if (spkOn() && /^(Arrow|Page)|^(Home|End)$|^ $/.test(e.key || '')) g(function () { h.manual(Date.now()); });
    });
  };
  A.css = gxCss +
    '.gxz .xzs.tts-reading,.xzs.tts-reading{background:rgba(108,147,209,.26);-webkit-box-decoration-break:clone;box-decoration-break:clone}' +
    '.gxz table.tts-reading,.gxz .tts-reading>table{background:rgba(108,147,209,.18)}' +
    '@media (prefers-color-scheme:dark){.gxz .xzs.tts-reading,.xzs.tts-reading{background:rgba(120,160,230,.34)}}';
  return A;
};

/* ═══ preset.mix2：內嵌 SAGE321 v2（#gxaxz／.xzt／GXA.hl）但「沒有 TTS321」的 App ═══════════════════════════════
   321sociallife／321couples／chendu321：小智視窗與畫線面板與 preset.gx 相同，所以以 gx 為底（不改 gx），只補三件事：
     1) 朗讀引擎（poll 型，與 TTS321 同介面：state/stop/chunks/play）依宿主現有的 azure 朗讀自動選：
        · 'along'：宿主有 window.xzSpeakAlong(items,btn,onEnd)（321couples）——宿主自己做 azure 預抓、解鎖、重試、內建語音備援、
                  Media Session；我們給每一句一個「假元素」，宿主只負責念，高亮與捲動全由 XZM 核心做（6 秒手動捲動保護、表格整塊）。
        · 'speak'：宿主有 speak／stopSpeak／ttsFetch／audioEl／SPK（321sociallife）——照宿主 speak() 的規則自建逐句佇列：
                  同一個 audio 元素、點擊當下用靜音 wav 解鎖、預抓後 2 段、失敗重試 2 次、仍失敗該句改用內建語音；
                  沿用宿主的 SPK 與 #spk 控制列（⏮ ⏸ ⏭ ✕）、PRON321 發音修正、GXMS 的鎖屏控制／Wake Lock。
        · 都沒有（chendu321：宿主的 yun 朗讀是整課串成一個 MP3，沒有逐句邊界）→ 不接管 🔊，宿主照舊；只做畫線＋面板。
     2) 沒有引擎時，面板的「從這裡朗讀」改成把該句到回答結尾的文字交給宿主朗讀函式（spkToggle／speak）。
     3) 宿主換語言時會重建 SAGE321（sociallife）：偵測物件換了就重新掛 🔊／關閉／清空；訊息保存分語言（xzm_<slug>_<lang>）。
   opts：engine＝'along'|'speak'|'none'（預設自動偵測）；slug／nar 同 preset.gx。                                    */
XZM.preset.mix2 = function (o) {
  o = o || {};
  var X = XZM, g = X.g, arr = X.arr;
  var A = X.preset.gx(o);
  var SLUG = o.slug || g(function () { return GXA_CFG.slug; }, 'app');
  var SIL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

  /* 一個朗讀單位若太長（>280 字）就在標點處切開；一般一句一個 part */
  function chunks(t) {
    t = String(t || '');
    if (t.length <= 280) return t.replace(/\s/g, '') ? [t] : [];
    var out = [], buf = '', i, ch;
    for (i = 0; i < t.length; i++) { ch = t.charAt(i); buf += ch; if (buf.length >= 120 && '。！？；.!?;'.indexOf(ch) >= 0) { out.push(buf); buf = ''; } }
    if (buf.replace(/\s/g, '')) out.push(buf);
    var fin = [];
    out.forEach(function (s) { while (s.length > 300) { fin.push(s.slice(0, 300)); s = s.slice(300); } if (s) fin.push(s); });
    return fin;
  }

  /* ── 引擎一：宿主 xzSpeakAlong（321couples）──────────────────────── */
  function alongEngine() {
    var tok = 0, on = false, cur = -1;
    return {
      ready: function () { },
      state: function () { return { on: on, i: cur }; },
      stop: function () { on = false; g(function () { window.xzSpeakStop(); }); },
      chunks: chunks,
      play: function (parts, title) {
        var my = ++tok, items;
        on = true; cur = -1;
        items = parts.map(function (p, i) {
          /* 宿主只對 el 做 classList.add/remove、scrollIntoView、CR.tts(el)：給它一個假的，真正的高亮與捲動由 XZM 核心做 */
          var fake = { classList: { add: function () { if (my === tok) cur = i; }, remove: function () { }, contains: function () { return false; } }, scrollIntoView: function () { }, closest: function () { return null; } };
          return { text: p.t, el: fake };
        });
        window.xzSpeakAlong(items, null, function () { if (my === tok) on = false; });
      }
    };
  }

  /* ── 引擎二：宿主 speak／ttsFetch／audioEl／SPK（321sociallife）────── */
  function speakEngine() {
    var mine = 0, cur = -1;
    function nativeSay(text, done) {
      try {
        if (!window.speechSynthesis) return done();
        var u = new SpeechSynthesisUtterance(text), l = g(function () { return L(); }, 'zh');
        u.lang = l === 'en' ? 'en-US' : (l === 'zs' ? 'zh-CN' : 'zh-TW'); u.rate = 1;
        u.onend = u.onerror = function () { done(); };
        speechSynthesis.speak(u);
      } catch (e) { done(); }
    }
    return {
      ready: function () { },
      state: function () { var s = window.SPK; return { on: !!(mine && s && s.on && s.tok === mine), i: cur }; },
      stop: function () { if (mine && window.SPK && SPK.tok === mine) g(function () { stopSpeak(); }); },
      chunks: chunks,
      play: function (parts, title) {
        var texts = parts.map(function (p) { return g(function () { return sanitize(p.t); }, p.t) || ' '; });
        var n = texts.length, human = g(function () { return !!S.set.human; }, true) && navigator.onLine !== false;
        g(function () { stopSpeak(); });
        var my = (window.SPK && SPK.tok || 0) + 1, blobs = [], played = [], url = null, a = null;
        mine = my; cur = -1;
        window.SPK = { on: true, pause: false, tok: my, list: texts, i: 0, title: title || '小智', nat: human ? 0 : 1 };
        function stillMine() { return my === SPK.tok && SPK.on; }
        function finish() { if (stillMine()) g(function () { stopSpeak(); }); }
        function bar() { g(function () { drawSpk(); }); }
        if (!human) {                                             /* 內建語音：一句一個 utterance */
          g(function () { speechSynthesis.cancel(); });
          var step = function (k) {
            if (!stillMine()) return;
            if (k >= n) return finish();
            SPK.i = k; cur = k; bar();
            nativeSay(texts[k], function () { if (stillMine()) step(k + 1); });
          };
          SPK.go = function () { };
          bar(); step(0); return;
        }
        /* azure：同一個 audio、點擊當下用靜音 wav 解鎖（這個函式就是在點擊裡同步呼叫的）*/
        a = g(function () { return audioEl(); }, null);
        if (a) { try { a.onended = null; a.onerror = null; a.src = SIL; var pr = a.play(); if (pr && pr['catch']) pr['catch'](function () { }); } catch (e) { } }
        function get(k) {
          if (k >= n || blobs[k]) return;
          blobs[k] = 'p';
          (function attempt(t) {
            ttsFetch(texts[k], function (b) {
              if (!b || b.size < 128) return bad(t); blobs[k] = b; kick(k);
            }, function () { bad(t); });
            function bad(t0) {
              if (my !== SPK.tok) return;
              if (t0 < 2) setTimeout(function () { attempt(t0 + 1); }, [800, 1600][t0]);
              else { blobs[k] = 'x'; kick(k); }
            }
          })(0);
        }
        function kick(k) { if (k === cur && !played[k]) playAt(k); }
        function playAt(k) {
          if (!stillMine()) return;
          if (k >= n) return finish();
          SPK.i = k; cur = k; bar();
          get(k); get(k + 1); get(k + 2);
          var b = blobs[k];
          if (!b || b === 'p') return;                            /* 還在抓：抓好時 kick */
          played[k] = 1;
          if (b === 'x') { nativeSay(texts[k], function () { if (stillMine()) playAt(k + 1); }); return; }   /* 這句連不上：改內建語音，下一句繼續 */
          var au = g(function () { return audioEl(); }, a);
          try { if (url) URL.revokeObjectURL(url); } catch (e) { }
          url = URL.createObjectURL(b);
          au.onended = function () { if (stillMine()) playAt(k + 1); };
          au.onerror = function () { if (stillMine()) playAt(k + 1); };
          au.src = url;
          var p = au.play(); if (p && p['catch']) p['catch'](function () { if (stillMine()) playAt(k + 1); });
        }
        SPK.go = function (k) { played[k] = 0; try { audioEl().pause(); } catch (e) { } playAt(k); };
        bar();
        get(0); get(1); get(2);
        cur = 0; SPK.i = 0; kick(0);
      }
    };
  }

  var kind = o.engine || (typeof window.xzSpeakAlong === 'function' ? 'along' :
    (typeof window.speak === 'function' && typeof window.ttsFetch === 'function' && typeof window.audioEl === 'function' && typeof window.stopSpeak === 'function' && 'SPK' in window ? 'speak' : 'none'));
  A.engine = kind === 'along' ? alongEngine() : (kind === 'speak' ? speakEngine() : null);
  XZM._mix2 = kind;

  /* ── 沒有引擎：面板「從這裡朗讀」交給宿主朗讀函式 ─────────────────── */
  function hostRead(text) {
    if (!text) return;
    if (typeof window.spkToggle === 'function') { g(function () { if (window.spkStop) spkStop(); }); g(function () { spkToggle(text, 'xzm_from'); }); }
    else if (typeof window.speak === 'function') g(function () { speak(text, X.T('小智', 'Xiaozhi')); });
  }
  function textFrom(el) {
    var node = el.closest && el.closest('.xzm'), all = node ? arr(node.querySelectorAll('.xzs')) : [el], i = all.indexOf(el), t = '', j;
    for (j = Math.max(0, i); j < all.length && t.length < 6000; j++) t += (t && /^en/i.test(document.documentElement.lang || '') ? ' ' : '') + X.sentText(all[j]);
    return t;
  }
  var attach0 = A.marks.attach;
  A.marks.attach = function (r) {
    if (A.engine || !window.GXA || !GXA.hl) return attach0.apply(this, arguments);
    var h = GXA.hl, a0 = h.attach;
    h.attach = function (root, opt) { if (opt && opt.unit === '.xzs') opt.readFrom = function (el) { hostRead(textFrom(el)); }; return a0.apply(this, arguments); };
    try { return attach0.apply(this, arguments); } finally { h.attach = a0; }
  };

  /* ── 訊息保存分語言 ──────────────────────────────────────────── */
  if (A.store) {
    var key = function () { return 'xzm_' + SLUG + '_' + A.lang(); };
    A.store = {
      get: function () { try { return JSON.parse(localStorage.getItem(key()) || 'null'); } catch (e) { return null; } },
      set: function (l) { try { localStorage.setItem(key(), JSON.stringify(l)); } catch (e) { } }
    };
  }

  /* ── 掛鉤：🔊（含 SAGE321 被宿主換掉後重掛）、開窗還原、關閉／清空時停止朗讀 ── */
  function hookObj() {
    var S3 = window.SAGE321;
    if (!S3 || S3.__xzm2) return;
    S3.__xzm2 = 1;
    var s0 = S3.speak, o0 = S3.open, c0 = S3.close, k0 = S3.clear;
    S3.speak = function (i) { if (A.engine && X.speakMsg(i)) return; return s0.apply(this, arguments); };
    S3.open = function () { X.restore(); return o0.apply(this, arguments); };
    S3.close = function () { if (X.state().reading) X.stopEngine(); return c0.apply(this, arguments); };
    S3.clear = function () { if (X.state().reading) X.stopEngine(); return k0.apply(this, arguments); };
  }
  A.hook = function () { hookObj(); setInterval(hookObj, 800); };
  return A;
};

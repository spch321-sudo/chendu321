/* CPAR321 晨讀321 版（2026-11-09）：課文逐句中英並讀
   繁／简頁並讀英文（en.html 的課文資料），英文頁並讀繁體中文（index.html 的課文資料）。
   每一課七個分頁（閱讀、對焦、盼望、靜默、操練、宣告、分享）的每一句，下面附上另一種語言的對應句子。
   作法：從另一個語言頁讀出 lessons-json，依段落代號（與畫線同一套：L、0-1、D0-1、H0、T0、R0…）配對；
   主要句子就是畫線單位（.mk-s），另一語言切句後依長度比例對齊（1:1、1:2、2:1…），插在單位後面（.cps）。
   朗讀從課文資料取句子、畫線只認 .mk-s，所以並讀句子不會被朗讀或畫線。設定存 localStorage cpar321。 */
(function () {
  if (window.CPAR321) return;
  if (typeof state === 'undefined' || typeof render !== 'function' || typeof LESSONS === 'undefined') return;
  var P = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var LN = P.indexOf('en.html') === 0 ? 'en' : (P.indexOf('sc.html') === 0 ? 'sc' : 'tc');
  var EN = LN === 'en';
  var ALT_FILE = EN ? 'index.html' : 'en.html', ALT_LANG = EN ? 'zh-Hant' : 'en';
  var STR = {
    tc: { btn: '中英並讀', on: '開', off: '關', loading: '英文內容載入中…', fail: '英文內容載入失敗，請檢查網路' },
    sc: { btn: '中英并读', on: '开', off: '关', loading: '英文内容载入中…', fail: '英文内容载入失败，请检查网络' },
    en: { btn: 'Chinese parallel', on: 'On', off: 'Off', loading: 'Loading the Chinese text…', fail: 'Couldn’t load the Chinese text — check your connection' }
  };
  function T(k) { return STR[LN][k]; }
  function isOn() { try { return localStorage.getItem('cpar321') === '1'; } catch (e) { return false; } }
  function setOn(v) { try { localStorage.setItem('cpar321', v ? '1' : ''); } catch (e) {} }
  var TABS = { read: 1, focus: 1, hope: 1, still: 1, steps: 1, declare: 1, share: 1 };

  /* ── 另一語言的課文 ── */
  var ALT = null, loading = false, failed = false, waiters = [];
  function load(cb) {
    if (ALT) return cb(true);
    waiters.push(cb); if (loading) return; loading = true;
    fetch(ALT_FILE, { cache: 'force-cache' }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (s) {
      var m = s.match(/<script type="application\/json" id="lessons-json">([\s\S]*?)<\/script>/);
      if (!m) throw 0;
      var arr = JSON.parse(m[1]), map = {};
      arr.forEach(function (l) { map[l.n] = l; });
      ALT = map; failed = false;
    }).catch(function () { failed = true; }).then(function () {
      loading = false; var w = waiters; waiters = [];
      w.forEach(function (f) { try { f(!!ALT); } catch (e) {} });
    });
  }

  /* ── 文字工具 ── */
  function plain(t) { return String(t || '').replace(/⟦[a-z]:([^⟧]*)⟧/g, '$1').replace(/[⟦⟧]/g, '').replace(/\s+/g, ' ').trim(); }
  function paras(t) { return String(t || '').split('\n').filter(function (x) { return x.replace(/\s/g, '').length; }); }
  /* 段落代號 → 另一語言的原文（與主程式 mkSentence 同一套代號） */
  function rawOf(l, pid) {
    var m = pid.match(/^[A-Za-z]+/), pre = m ? m[0] : '', rest = pid.slice(pre.length), ab;
    if (pre === 'L') return l.lead;
    if (pre === 'D') { ab = rest.split('-'); var ds = (l.sections || [])[+ab[0]]; return ds ? paras((ds.deeper && ds.deeper.a) || '')[+ab[1]] : ''; }
    if (pre === 'F') return l.focus;
    if (pre === 'H') return l.hope && l.hope.paras && l.hope.paras[+rest];
    if (pre === 'SH') return l.still_hint;
    if (pre === 'S') return l.still;
    if (pre === 'T') return l.steps && l.steps[+rest] && l.steps[+rest].act;
    if (pre === 'Q') return l.declare;
    if (pre === 'R') return l.share && l.share[+rest] && l.share[+rest].q;
    if (pre === 'V') return l.verse;
    if (pre === 'B') return l.bigidea;
    if (pre === 'P') { var ps = (l.sections || [])[+rest]; return ps ? ps.pq : ''; }
    if (!pre) { ab = pid.split('-'); var sc = (l.sections || [])[+ab[0]]; return sc ? (sc.paras || [])[+ab[1]] : ''; }
    return '';
  }
  /* 同一組段落（例：第 i 段的所有段落）兩種語言數量不同時，整組一起對齊 */
  function family(l, a, pid) {
    var m = pid.match(/^[A-Za-z]+/), pre = m ? m[0] : '', rest = pid.slice(pre.length), i;
    if (!pre && /^\d+-\d+$/.test(pid)) {
      i = +pid.split('-')[0];
      var x = ((l.sections || [])[i] || {}).paras || [], y = ((a.sections || [])[i] || {}).paras || [];
      return x.length === y.length ? null : { key: 'S' + i, text: y.join(' ') };
    }
    if (pre === 'D') {
      i = +rest.split('-')[0];
      var dx = paras((((l.sections || [])[i] || {}).deeper || {}).a), dy = paras((((a.sections || [])[i] || {}).deeper || {}).a);
      return dx.length === dy.length ? null : { key: 'D' + i, text: dy.join(' ') };
    }
    if (pre === 'H') {
      var hx = (l.hope && l.hope.paras) || [], hy = (a.hope && a.hope.paras) || [];
      return hx.length === hy.length ? null : { key: 'H', text: hy.join(' ') };
    }
    return null;
  }

  /* ── 切句與對齊（與聖經講義版同一套演算法） ── */
  function splitSents(t, zh) {
    t = plain(t); if (!t) return [];
    var re = zh ? /[^。！？；!?]+(?:[。！？；!?]+[」』”’）)】〕]*)?/g : /[^.!?;]+(?:[.!?;]+["”’)\]]*)?(?=\s|$)|[^.!?;]+$/g;
    var out = (t.match(re) || [t]).map(function (x) { return x.trim(); }).filter(Boolean), merged = [];
    out.forEach(function (x) {
      if (merged.length && (x.replace(/[\s\p{P}]/gu, '').length < (zh ? 3 : 6))) merged[merged.length - 1] += (zh ? '' : ' ') + x;
      else merged.push(x);
    });
    return merged;
  }
  function plen(t, zh) { return Math.max(1, zh ? t.replace(/[\s\p{P}]/gu, '').length : t.replace(/\s+/g, ' ').length); }
  function align(ma, al) {
    var M = ma.map(function (t) { return plen(t, !EN); }), A2 = al.map(function (t) { return plen(t, EN); });
    var sm = M.reduce(function (a, b) { return a + b; }, 0), sa = A2.reduce(function (a, b) { return a + b; }, 0), r = sa / sm;
    var m = M.length, n = A2.length, INF = 1e9, C = [], B = [], i, j;
    for (i = 0; i <= m; i++) { C.push(new Float64Array(n + 1).fill(INF)); B.push(new Array(n + 1)); }
    C[0][0] = 0;
    var moves = [[1, 1, 0], [1, 2, .6], [2, 1, .6], [1, 3, 1.4], [3, 1, 1.4], [2, 2, 1], [1, 0, 3], [0, 1, 3]];
    for (i = 0; i <= m; i++) for (j = 0; j <= n; j++) {
      if (C[i][j] >= INF) continue;
      for (var q = 0; q < moves.length; q++) {
        var mv = moves[q], a = i + mv[0], b = j + mv[1]; if (a > m || b > n) continue;
        var x = 0, y = 0, k; for (k = i; k < a; k++) x += M[k]; for (k = j; k < b; k++) y += A2[k];
        var c = C[i][j] + mv[2] + Math.abs(y - r * x) / Math.sqrt(r * x + y + 1);
        if (c < C[a][b]) { C[a][b] = c; B[a][b] = [i, j]; }
      }
    }
    var groups = []; i = m; j = n;
    while (i > 0 || j > 0) { var p = B[i][j]; if (!p) break; groups.unshift([p[0], i, p[1], j]); i = p[0]; j = p[1]; }
    return groups;
  }
  function mkSpan(t) { var d = document.createElement('span'); d.className = 'cps'; d.setAttribute('lang', ALT_LANG); d.textContent = t; return d; }
  /* units：主要句子（畫線單位），依序；altText：另一語言整段 */
  function pairUnits(units, altText) {
    var alts = splitSents(altText, EN);
    if (!units.length || !alts.length) return 0;
    var groups = units.length === 1 ? [[0, 1, 0, alts.length]] : align(units.map(function (u) { return u.textContent || ''; }), alts);
    var ins = [];
    groups.forEach(function (g) {
      var t = alts.slice(g[2], g[3]).join(EN ? '' : ' ');
      if (!t) return;
      var at = g[1] > g[0] ? g[1] - 1 : Math.max(0, g[0] - 1);
      if (ins.length && ins[ins.length - 1][0] === at) ins[ins.length - 1][1] += (EN ? '' : ' ') + t; else ins.push([at, t]);
    });
    for (var k = ins.length - 1; k >= 0; k--) {
      var u = units[ins[k][0]], after = u;
      if (after.nextSibling && after.nextSibling.classList && after.nextSibling.classList.contains('mk-flag')) after = after.nextSibling;
      after.parentNode.insertBefore(mkSpan(ins[k][1]), after.nextSibling);
    }
    return ins.length;
  }
  function addAfterText(el, t, outside) {
    t = plain(t); if (!el || !t || plain(el.textContent).indexOf(t) >= 0) return 0;
    var sp = mkSpan(t);
    if (outside) el.parentNode.insertBefore(sp, el.nextSibling); else el.appendChild(sp);
    return 1;
  }

  /* ── 課文頁配對 ── */
  function pairLesson(root, l, a) {
    var n = 0, units = root.querySelectorAll('.mk-s'), byPid = {}, order = [];
    for (var i = 0; i < units.length; i++) {
      var oc = units[i].getAttribute('onclick') || '', m = oc.match(/mkTap\(\d+,'([^'#]+)#\d+'/);
      if (!m) continue;
      var pid = m[1], fam = family(l, a, pid), key = fam ? fam.key : pid;
      if (!byPid[key]) { byPid[key] = { units: [], text: fam ? fam.text : rawOf(a, pid) }; order.push(key); }
      byPid[key].units.push(units[i]);
    }
    order.forEach(function (k) { var g = byPid[k]; if (g.text) n += pairUnits(g.units, g.text); });
    /* 標題類：章節小標、盼望標題、問候語、經文出處、「想更深」問題、分享標籤（固定在上方的課名不加，免得頁首變高） */
    n += addAfterText(root.querySelector('.greet'), a.greet);
    n += addAfterText(root.querySelector('.verse-ref'), a.verse_ref);
    n += addAfterText(root.querySelector('.hope-t'), a.hope && a.hope.t);
    var secs = root.querySelectorAll('.section');
    for (var s = 0; s < secs.length; s++) {
      var sec = (a.sections || [])[s]; if (!sec) continue;
      n += addAfterText(secs[s].querySelector('.sec-h'), sec.h);
      var db = secs[s].querySelector('.deep-btn');
      if (db && sec.deeper) n += addAfterText(db, sec.deeper.q, true);
    }
    var pills = root.querySelectorAll('.share-card .pill');
    for (var p = 0; p < pills.length; p++) if (a.share && a.share[p]) n += addAfterText(pills[p], a.share[p].tag, true);
    return n;
  }
  function clear() {
    var old = document.querySelectorAll('.cps,.cpar-st'); for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
  }
  function css() {
    if (document.getElementById('cparCss')) return;
    var st = document.createElement('style'); st.id = 'cparCss';
    st.textContent = '.cps{display:block;margin:2px 0 8px;padding:1px 0 1px 9px;border-left:3px solid rgba(47,107,90,.4);font-size:.86em;line-height:1.65;color:inherit;opacity:.68;font-weight:400;font-style:normal;letter-spacing:0;text-transform:none;text-align:left;white-space:normal}'
      + '.sec-h .cps,.hope-t .cps{font-weight:600}'
      + '.pill+.cps{display:inline-block;margin:0 0 4px 6px;border:0;padding:0}.deep-btn+.cps{margin:-2px 0 10px}'
      + '.cparbar{display:flex;justify-content:flex-end;margin:10px 0 2px}.cparbtn{border:1px solid rgba(47,107,90,.35);background:transparent;color:inherit;border-radius:999px;padding:6px 14px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}'
      + '.cparbtn.on{border-color:#2f6b5a;color:#2f6b5a;background:rgba(47,107,90,.08)}.cpar-st{font-size:12.5px;opacity:.75;margin:2px 0 6px;text-align:right}';
    document.head.appendChild(st);
  }
  function addBar(body) {
    var old = body.querySelector('.cparbar'); if (old) old.parentNode.removeChild(old);
    var on = isOn(), bar = document.createElement('div'); bar.className = 'cparbar';
    bar.innerHTML = '<button type="button" class="cparbtn' + (on ? ' on' : '') + '">🌐 ' + T('btn') + (EN ? ': ' : '：') + (on ? T('on') : T('off')) + '</button>';
    bar.firstChild.onclick = function () { window.CPAR321.toggle(); };
    body.insertBefore(bar, body.firstChild);
    return bar;
  }
  function status(body, msg) {
    var s = body.querySelector('.cpar-st');
    if (!msg) { if (s) s.parentNode.removeChild(s); return; }
    if (!s) { s = document.createElement('div'); s.className = 'cpar-st'; var bar = body.querySelector('.cparbar'); body.insertBefore(s, bar ? bar.nextSibling : body.firstChild); }
    s.textContent = msg;
  }
  function apply() {
    if (state.view !== 'reader' || !state.lesson || !TABS[state.tab]) return;
    var body = document.querySelector('#app .rd-body'); if (!body) return;
    css(); addBar(body); clear();
    if (!isOn()) return;
    var l = state.lesson, key = l.n + '|' + state.tab;
    if (!ALT) {
      status(body, failed ? T('fail') : T('loading'));
      load(function (ok) {
        if (state.view !== 'reader' || !state.lesson || state.lesson.n + '|' + state.tab !== key) return;
        if (ok) apply(); else { var b = document.querySelector('#app .rd-body'); if (b) status(b, T('fail')); }
      });
      return;
    }
    var a = ALT[l.n]; if (!a) return;
    try { pairLesson(body, l, a); } catch (e) {}
  }
  var orig = window.render;
  window.render = function () {
    var r = orig.apply(this, arguments);
    try { apply(); } catch (e) {}
    return r;
  };
  try { render = window.render; } catch (e) {}
  window.CPAR321 = {
    toggle: function () {
      setOn(!isOn()); var y = window.scrollY || 0;
      apply(); window.scrollTo(0, y);
    },
    apply: apply, _load: load
  };
  if (state.view === 'reader') { try { apply(); } catch (e) {} }
})();

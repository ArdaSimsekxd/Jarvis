// Jarvis panelinin sayfası. Sayfa veri içermez: verileri adresin # kısmındaki gizli anahtarla /panel/api'den okur.
// Bütün yazılar textContent ile basılır (mail konusu gibi dışarıdan gelen yazılar HTML olarak çalışmaz).
export const PANEL_HTML = String.raw`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#03070d">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Jarvis">
<title>Jarvis</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2303070d'/%3E%3Ccircle cx='32' cy='32' r='20' fill='none' stroke='%233fd8ff' stroke-width='4'/%3E%3Ccircle cx='32' cy='32' r='8' fill='%233fd8ff'/%3E%3C/svg%3E">
<link rel="apple-touch-icon" href="/panel/icon-180.png">
<link rel="manifest" href="/panel/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #03070d; --panel: rgba(8, 24, 38, .62); --line: rgba(63, 216, 255, .22); --cyan: #3fd8ff; --cyan-soft: rgba(63, 216, 255, .55);
  --text: #d6f3ff; --muted: #7ea3b8; --amber: #ffb547; --red: #ff5a6e; --green: #4dffb0;
  --head: "Orbitron", "Segoe UI", sans-serif; --body: "Rajdhani", "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  min-height: 100vh; background: var(--bg); color: var(--text); font: 500 17px/1.35 var(--body);
  background-image:
    radial-gradient(1200px 700px at 50% -10%, rgba(30, 120, 170, .28), transparent 60%),
    linear-gradient(rgba(63, 216, 255, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(63, 216, 255, .045) 1px, transparent 1px);
  background-size: auto, 40px 40px, 40px 40px;
  padding: env(safe-area-inset-top) 16px calc(24px + env(safe-area-inset-bottom));
  -webkit-font-smoothing: antialiased;
}
body::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 50;
  background: repeating-linear-gradient(0deg, rgba(0, 0, 0, .14) 0 1px, transparent 1px 3px);
}
a { color: var(--cyan); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1180px; margin: 0 auto; }

header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0 8px; flex-wrap: wrap; }
.logo { font: 700 20px var(--head); letter-spacing: .32em; color: var(--cyan); text-shadow: 0 0 12px var(--cyan-soft); }
.logo small { display: block; font: 600 11px var(--body); letter-spacing: .3em; color: var(--muted); margin-top: 2px; }
.chips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.chip { font: 600 12px var(--body); letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  border: 1px solid var(--line); padding: 4px 10px; border-radius: 999px; display: inline-flex; gap: 6px; align-items: center; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.on { background: var(--green); box-shadow: 0 0 8px var(--green); }
.dot.off { background: var(--red); box-shadow: 0 0 8px var(--red); }
button { font: 600 13px var(--body); letter-spacing: .1em; text-transform: uppercase; color: var(--cyan); background: rgba(63, 216, 255, .06);
  border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; cursor: pointer; transition: background .15s, box-shadow .15s; }
button:hover { background: rgba(63, 216, 255, .14); box-shadow: 0 0 14px rgba(63, 216, 255, .25); }
button:disabled { opacity: .4; cursor: default; box-shadow: none; }

.hero { display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: center; padding: 18px 0 26px; }
.reactor { position: relative; width: 190px; height: 190px; }
.ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--cyan-soft); }
.ring.r1 { border-style: dashed; border-color: rgba(63, 216, 255, .5); animation: spin 26s linear infinite; }
.ring.r2 { inset: 14px; border-width: 6px; border-color: transparent; border-top-color: var(--cyan); border-bottom-color: var(--cyan);
  filter: drop-shadow(0 0 6px var(--cyan)); animation: spin 9s linear infinite reverse; }
.ring.r3 { inset: 30px; border: 1px solid rgba(63, 216, 255, .35); }
.ring.r4 { inset: 38px; border: 10px dotted rgba(63, 216, 255, .28); animation: spin 40s linear infinite; }
.core { position: absolute; inset: 52px; border-radius: 50%; display: grid; place-items: center; text-align: center;
  background: radial-gradient(circle, rgba(63, 216, 255, .22), rgba(3, 7, 13, .9) 70%); box-shadow: 0 0 40px rgba(63, 216, 255, .35), inset 0 0 22px rgba(63, 216, 255, .35); }
.clock { font: 700 28px var(--head); color: #fff; text-shadow: 0 0 10px var(--cyan); letter-spacing: .04em; }
.sec { font: 500 11px var(--head); color: var(--cyan); letter-spacing: .2em; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ring { animation: none !important; } }
.hello h1 { font: 700 clamp(28px, 4vw, 44px) var(--body); margin: 0 0 4px; letter-spacing: .04em; color: #fff; text-shadow: 0 0 18px rgba(63, 216, 255, .35); }
.hello .date { color: var(--cyan); font: 600 14px var(--body); letter-spacing: .28em; text-transform: uppercase; }
.hello p { margin: 10px 0 0; color: var(--text); font-size: 19px; max-width: 640px; }

.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
.card { position: relative; grid-column: span 4; background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
  padding: 16px 16px 14px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); min-width: 0; }
.card.wide { grid-column: span 8; }
.card::before, .card::after { content: ""; position: absolute; width: 14px; height: 14px; border: 2px solid var(--cyan); pointer-events: none; }
.card::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.card::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.card h2 { margin: 0 0 12px; font: 700 13px var(--head); letter-spacing: .26em; color: var(--cyan); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card h2 .count { font: 600 12px var(--body); letter-spacing: .1em; color: var(--muted); }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.row { display: grid; grid-template-columns: 78px 1fr; gap: 10px; align-items: baseline; padding-bottom: 8px; border-bottom: 1px solid rgba(63, 216, 255, .08); }
.row:last-child { border-bottom: 0; padding-bottom: 0; }
.when { font: 700 13px var(--head); color: var(--cyan); letter-spacing: .04em; white-space: nowrap; }
.what { min-width: 0; overflow-wrap: anywhere; }
.sub { display: block; color: var(--muted); font-size: 14px; }
.past { opacity: .45; }
.now .when, .now .what { color: #fff; text-shadow: 0 0 8px var(--cyan); }
.tag { font: 700 10px var(--head); letter-spacing: .14em; padding: 2px 6px; border-radius: 3px; border: 1px solid currentColor; margin-left: 6px; }
.late { color: var(--red); }
.soon { color: var(--amber); }
.empty { color: var(--muted); font-style: italic; }
.subhead { margin: 14px 0 8px; font: 600 12px var(--head); letter-spacing: .22em; color: var(--muted); }

.money { display: grid; grid-template-columns: 120px 1fr; gap: 16px; align-items: center; }
.gauge { width: 120px; height: 120px; }
.gauge text { font-family: var(--head); }
.big { font: 700 26px var(--head); color: #fff; }
.bars { display: grid; gap: 6px; margin-top: 12px; }
.bar { display: grid; grid-template-columns: 1fr auto; gap: 8px; font-size: 15px; }
.bar i { grid-column: 1 / -1; display: block; height: 4px; background: rgba(63, 216, 255, .12); border-radius: 2px; overflow: hidden; }
.bar i b { display: block; height: 100%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }

.pcbox { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 18px; }
.actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.toast { min-height: 22px; margin-top: 10px; color: var(--cyan); font-size: 15px; }

.card.full { grid-column: 1 / -1; }
.dl { display: inline-block; margin-top: 4px; padding: 4px 12px; border: 1px solid var(--cyan); border-radius: 3px; font: 600 13px var(--head); letter-spacing: .14em; }
.chatlog { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; margin-bottom: 10px; }
.msg { max-width: 88%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; }
.msg.me { align-self: flex-end; background: rgba(63, 216, 255, .16); border: 1px solid var(--line); }
.msg.bot { align-self: flex-start; background: rgba(255, 255, 255, .04); border: 1px solid rgba(63, 216, 255, .12); }
.msg.wait { color: var(--muted); font-style: italic; }
.msg code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; color: var(--cyan); }
.chatform { display: flex; gap: 8px; }
input[type=text] { flex: 1; min-width: 0; font: 500 17px var(--body); color: var(--text); background: rgba(3, 7, 13, .7); border: 1px solid var(--line);
  border-radius: 6px; padding: 10px 12px; outline: none; }
input[type=text]:focus { border-color: var(--cyan); box-shadow: 0 0 12px rgba(63, 216, 255, .25); }
.gate form { display: flex; gap: 8px; margin-top: 18px; }
.gate input { text-transform: uppercase; letter-spacing: .2em; text-align: center; }
.chip.btn { cursor: pointer; background: none; }
.chip.btn:hover { color: var(--cyan); }
footer { margin-top: 22px; color: var(--muted); font-size: 13px; letter-spacing: .12em; text-align: center; text-transform: uppercase; }
.gate { max-width: 520px; margin: 18vh auto 0; text-align: center; }
.gate h1 { font: 700 22px var(--head); letter-spacing: .2em; color: var(--cyan); }
.gate p { color: var(--muted); font-size: 18px; }
.hidden { display: none !important; }
.found { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgba(3, 7, 13, .92); color: var(--cyan); text-align: center; padding: 24px; }
.found b { font: 700 34px var(--head); letter-spacing: .18em; text-shadow: 0 0 24px rgba(63, 216, 255, .7); }
.found span { color: var(--muted); font-size: 18px; }

@media (max-width: 980px) { .card, .card.wide { grid-column: span 6; } }
@media (max-width: 680px) {
  .grid { grid-template-columns: 1fr; }
  .card, .card.wide { grid-column: auto; }
  .hero { grid-template-columns: 1fr; justify-items: center; text-align: center; gap: 16px; }
  .reactor { width: 170px; height: 170px; }
  .core { inset: 46px; }
  .clock { font-size: 24px; }
  .hello p { margin-left: auto; margin-right: auto; }
  #chatHint { display: none; }
}
</style>
</head>
<body>
<div class="wrap">
  <div id="gate" class="gate hidden">
    <h1>ERİŞİM YOK</h1>
    <p id="gateText">Telegram'da Jarvis'e <b>/panel</b> yaz ve gelen kodu buraya gir.</p>
    <form id="loginForm" autocomplete="off">
      <input type="text" id="code" placeholder="ABCD-EFGH" maxlength="12" autocapitalize="characters" spellcheck="false" aria-label="Giriş kodu">
      <button type="submit">Giriş</button>
    </form>
    <p id="loginMsg" class="toast"></p>
  </div>

  <div id="app" class="hidden">
    <header>
      <div class="logo">J.A.R.V.I.S<small>KİŞİSEL ASİSTAN</small></div>
      <div class="chips">
        <span class="chip"><span class="dot" id="dotCanvas"></span>Canvas</span>
        <span class="chip"><span class="dot" id="dotPc"></span>Bilgisayar</span>
        <span class="chip"><span class="dot" id="dotLive"></span>Canlı</span>
        <button class="chip btn" id="notify" type="button">🔔 Bildirimler</button>
        <button class="chip btn" id="findPhone" type="button">📱 Telefonumu bul</button>
        <button id="refresh" type="button">Yenile</button>
      </div>
    </header>

    <section class="hero">
      <div class="reactor" aria-hidden="true">
        <div class="ring r1"></div><div class="ring r2"></div><div class="ring r4"></div><div class="ring r3"></div>
        <div class="core"><div><div class="clock" id="clock">--:--</div><div class="sec" id="sec">00</div></div></div>
      </div>
      <div class="hello">
        <div class="date" id="date"></div>
        <h1 id="greet">Sistemler başlatılıyor</h1>
        <p id="summary">Veriler yükleniyor…</p>
      </div>
    </section>

    <main class="grid">
      <section class="card full"><h2>JARVIS İLE KONUŞ <span class="count" id="chatHint">Telegram'da yazdığın her şeyi buradan da yazabilirsin</span></h2>
        <div class="chatlog" id="chatlog" aria-live="polite"></div>
        <form class="chatform" id="chatForm" autocomplete="off">
          <input type="text" id="chatInput" placeholder="Jarvis'e yaz: yarın derslerim ne?" maxlength="1000" aria-label="Jarvis'e mesaj">
          <button type="submit">Gönder</button>
        </form>
      </section>
      <section class="card"><h2>BUGÜN <span class="count" id="cLessons"></span></h2><div id="lessons"></div></section>
      <section class="card wide"><h2>ÖDEVLER <span class="count" id="cHomework"></span></h2><div id="homework"></div></section>
      <section class="card wide"><h2>YAKLAŞANLAR <span class="count" id="cUpcoming"></span></h2><div id="upcoming"></div></section>
      <section class="card"><h2>BU AY HARCAMA</h2><div id="money"></div></section>
      <section class="card"><h2>SON MAİLLER</h2><div id="mails"></div></section>
      <section class="card"><h2>YEMEKHANE</h2><div id="menu"></div></section>
      <section class="card"><h2>BİLGİSAYAR</h2>
        <div class="pcbox"><span class="dot" id="pcDot"></span><span id="pcText">Bilinmiyor</span></div>
        <div class="actions">
          <button type="button" data-is="kilitle">Kilitle</button>
          <button type="button" data-is="ekran">Ekran</button>
          <button type="button" data-is="uyku">Uyku</button>
          <button type="button" data-is="ses" data-arg="kis">Ses −</button>
          <button type="button" data-is="medya" data-arg="oynat">⏯</button>
          <button type="button" data-is="ses" data-arg="ac">Ses +</button>
        </div>
        <div class="toast" id="toast"></div>
      </section>
      <section class="card"><h2>DOSYALAR <span class="count" id="cFiles"></span></h2><div id="files"></div></section>
    </main>
    <footer id="foot"></footer>
  </div>
  <div class="found hidden" id="found" role="status"><b>📍 BULDUN</b><span>Bildirimler durdu.</span></div>
</div>
<script>
(function () {
  "use strict";
  var STORE = "jarvis-panel-key";
  var key = location.hash.replace(/^#/, "");
  try {
    if (key) localStorage.setItem(STORE, key); else key = localStorage.getItem(STORE) || "";
  } catch (e) { /* gizli sekme: yalnızca adresteki anahtar */ }

  var TZ = "Europe/Istanbul";
  var fTime = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  var fSec = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, second: "2-digit" });
  var fDate = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  var fDay = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
  var fKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  var fMoney = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function money(k) { return fMoney.format(k / 100) + " TL"; }
  function dayLabel(ms) {
    var k = fKey.format(new Date(ms)), now = Date.now();
    if (k === fKey.format(new Date(now))) return "Bugün";
    if (k === fKey.format(new Date(now + 864e5))) return "Yarın";
    return fDay.format(new Date(ms));
  }
  function left(ms) {
    var d = ms - Date.now(), a = Math.abs(d), m = Math.round(a / 6e4), h = Math.floor(m / 60), day = Math.floor(h / 24);
    var t = day >= 2 ? day + " gün" : h >= 1 ? h + " sa " + (m % 60) + " dk" : m + " dk";
    return d < 0 ? t + " geçti" : t;
  }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 6e4);
    if (m < 60) return m + " dk önce";
    if (m < 1440) return Math.floor(m / 60) + " sa önce";
    return dayLabel(ms);
  }
  function empty(box, text) { box.textContent = ""; box.appendChild(el("div", "empty", text)); }
  function row(when, title, sub, cls) {
    var li = el("li", "row" + (cls ? " " + cls : ""));
    li.appendChild(el("span", "when", when));
    var w = el("span", "what");
    if (title instanceof Node) w.appendChild(title); else w.appendChild(document.createTextNode(title));
    if (sub) w.appendChild(el("span", "sub", sub));
    li.appendChild(w);
    return li;
  }

  function tick() {
    var d = new Date();
    $("clock").textContent = fTime.format(d);
    $("sec").textContent = fSec.format(d).padStart(2, "0");
    $("date").textContent = fDate.format(d);
  }

  function renderLessons(data) {
    var box = $("lessons"), now = Date.now(), list = data.lessons.today, ul = el("ul", "list"), n = 0;
    box.textContent = "";
    list.forEach(function (x) {
      var cls = x.endMs < now ? "past" : (x.startMs <= now ? "now" : "");
      if (x.endMs >= now) n++;
      ul.appendChild(row(x.start, (x.name ? x.name + " " : "") + x.code, (x.room ? x.room + " · " : "") + x.start + "–" + x.end + (cls === "now" ? " · ŞU AN" : ""), cls));
    });
    if (list.length) box.appendChild(ul); else box.appendChild(el("div", "empty", "Bugün ders yok."));
    if (data.lessons.next) {
      box.appendChild(el("div", "subhead", data.lessons.next.label.toUpperCase()));
      var ul2 = el("ul", "list");
      data.lessons.next.lessons.forEach(function (x) {
        ul2.appendChild(row(x.start, (x.name ? x.name + " " : "") + x.code, x.room || ""));
      });
      box.appendChild(ul2);
    }
    $("cLessons").textContent = list.length ? n + " / " + list.length : "";
    return n;
  }

  function renderHomework(data) {
    var box = $("homework"), ul = el("ul", "list");
    box.textContent = "";
    if (!data.canvas && !data.homework.length) return empty(box, "Canvas'a şu an ulaşılamadı.");
    if (!data.homework.length) return empty(box, "Bekleyen ödev yok. Keyfine bak efendim.");
    data.homework.forEach(function (h) {
      var title = h.url ? el("a", null, h.name) : el("span", null, h.name);
      if (h.url) { title.href = h.url; title.target = "_blank"; title.rel = "noopener noreferrer"; }
      var wrap = el("span");
      wrap.appendChild(title);
      var soon = !h.overdue && h.due - Date.now() < 864e5;
      if (h.overdue) wrap.appendChild(el("span", "tag late", "GECİKTİ"));
      else if (soon) wrap.appendChild(el("span", "tag soon", "YAKIN"));
      ul.appendChild(row(dayLabel(h.due), wrap, h.course + " · " + fTime.format(new Date(h.due)) + " · " + left(h.due), h.overdue ? "late" : ""));
    });
    box.appendChild(ul);
    $("cHomework").textContent = data.homework.length + " ödev";
  }

  function renderUpcoming(data) {
    var box = $("upcoming"), ul = el("ul", "list"), icon = { tarih: "📅 ", hatirlatma: "⏰ ", fitness: "🏋 " };
    box.textContent = "";
    if (!data.upcoming.length) return empty(box, "Yaklaşan bir tarih, hatırlatma ya da randevu yok.");
    data.upcoming.forEach(function (u) {
      ul.appendChild(row(dayLabel(u.at), (icon[u.kind] || "") + u.text, u.allDay ? "" : fTime.format(new Date(u.at)) + " · " + left(u.at)));
    });
    box.appendChild(ul);
    $("cUpcoming").textContent = data.upcoming.length + " kayıt";
  }

  function gauge(pct) {
    var ns = "http://www.w3.org/2000/svg", r = 50, c = 2 * Math.PI * r, svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 120"); svg.setAttribute("class", "gauge");
    var color = pct >= 100 ? "#ff5a6e" : pct >= 80 ? "#ffb547" : "#3fd8ff";
    function circle(stroke, dash) {
      var n = document.createElementNS(ns, "circle");
      n.setAttribute("cx", 60); n.setAttribute("cy", 60); n.setAttribute("r", r); n.setAttribute("fill", "none");
      n.setAttribute("stroke", stroke); n.setAttribute("stroke-width", 8);
      if (dash) { n.setAttribute("stroke-dasharray", dash); n.setAttribute("transform", "rotate(-90 60 60)"); n.setAttribute("stroke-linecap", "round");
        n.setAttribute("style", "filter: drop-shadow(0 0 4px " + color + ")"); }
      return n;
    }
    svg.appendChild(circle("rgba(63,216,255,.12)"));
    svg.appendChild(circle(color, (Math.min(pct, 100) / 100 * c) + " " + c));
    var t = document.createElementNS(ns, "text");
    t.setAttribute("x", 60); t.setAttribute("y", 67); t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", "#fff"); t.setAttribute("font-size", 22);
    t.textContent = "%" + pct;
    svg.appendChild(t);
    return svg;
  }

  function renderMoney(data) {
    var e = data.expenses, box = $("money");
    box.textContent = "";
    var top = el("div", "money"), info = el("div");
    if (e.budget) {
      top.appendChild(gauge(Math.floor(e.spent * 100 / e.budget)));
      info.appendChild(el("div", "big", money(e.spent)));
      info.appendChild(el("div", "sub", "Bütçe " + money(e.budget)));
      info.appendChild(el("div", "sub", e.left >= 0 ? "Kalan " + money(e.left) + (e.perDay !== null ? " · günde " + money(e.perDay) : "") : "Bütçe " + money(-e.left) + " aşıldı"));
    } else {
      top.style.gridTemplateColumns = "1fr";
      info.appendChild(el("div", "big", money(e.spent)));
      info.appendChild(el("div", "sub", "Bütçe yok. Telegram'da /butce 6000 gibi ayarlayabilirsin."));
    }
    top.appendChild(info);
    box.appendChild(top);
    if (e.categories.length) {
      var bars = el("div", "bars"), max = e.categories[0].amount;
      e.categories.forEach(function (c) {
        var b = el("div", "bar");
        b.appendChild(el("span", null, c.label));
        b.appendChild(el("span", null, money(c.amount)));
        var track = el("i"), fill = el("b");
        fill.style.width = Math.max(4, Math.round(c.amount * 100 / max)) + "%";
        track.appendChild(fill); b.appendChild(track); bars.appendChild(b);
      });
      box.appendChild(bars);
    } else {
      box.appendChild(el("div", "empty", "Bu ay henüz harcama yok."));
    }
  }

  function renderMails(data) {
    var box = $("mails"), ul = el("ul", "list");
    box.textContent = "";
    if (!data.mails.length) return empty(box, "Mail bilgisi yok.");
    data.mails.forEach(function (m) {
      ul.appendChild(row(m.at ? ago(m.at) : "", m.subject || "(konu yok)", m.from));
    });
    box.appendChild(ul);
  }

  function renderMenu(data) {
    var box = $("menu"), ul = el("ul", "list");
    box.textContent = "";
    if (!data.menu.length) return empty(box, "Bugün için menü bilgisi yok.");
    data.menu.forEach(function (m) { var li = el("li", null, "› " + m); ul.appendChild(li); });
    box.appendChild(ul);
  }

  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function renderFiles(data) {
    var box = $("files"), ul = el("ul", "list"), files = data.files || [];
    box.textContent = "";
    $("cFiles").textContent = files.length ? String(files.length) : "";
    if (!files.length) return empty(box, "Bilgisayardan dosya istemek için yaz: \"bilgisayardan devre raporunu getir\"");
    files.forEach(function (f) {
      var w = el("span");
      w.appendChild(el("span", null, f.name));
      if (/^\/panel\/file\/[0-9a-f]+\?t=[\w-]+$/.test(f.url)) {
        var a = el("a", "dl", "İNDİR");
        a.href = f.url; a.target = "_blank"; a.rel = "noopener";
        w.appendChild(el("br")); w.appendChild(a);
      }
      ul.appendChild(row(left(f.exp).replace(" geçti", "") + " kaldı", w, size(f.size)));
    });
    box.appendChild(ul);
  }

  var pcOnline = false;
  function renderPc(data) {
    var pc = data.pc, dot = $("pcDot"), text = $("pcText");
    pcOnline = Boolean(pc && pc.online);
    dot.className = "dot " + (pcOnline ? "on" : "off");
    $("dotPc").className = "dot " + (pcOnline ? "on" : "off");
    text.textContent = !pc || !pc.paired ? "Bağlı değil (Telegram'da /pc bağla)" : pcOnline ? "Çevrimiçi" : "Kapalı ya da uykuda";
    Array.prototype.forEach.call(document.querySelectorAll(".actions button"), function (b) { b.disabled = !pcOnline; });
  }

  function render(data) {
    $("greet").textContent = data.greeting + ".";
    $("dotCanvas").className = "dot " + (data.canvas ? "on" : "off");
    var left = renderLessons(data);
    renderHomework(data); renderUpcoming(data); renderMoney(data); renderMails(data); renderMenu(data); renderPc(data); renderFiles(data);
    var late = data.homework.filter(function (h) { return h.overdue; }).length;
    var soon = data.homework.filter(function (h) { return !h.overdue && h.due - Date.now() < 3 * 864e5; }).length;
    var parts = [];
    parts.push(left ? "Bugün " + left + " dersin daha var" : data.lessons.next ? "Bugün dersin kalmadı; " + data.lessons.next.label.toLowerCase() + " ilk ders " + data.lessons.next.lessons[0].start : "Bugün dersin yok");
    if (late) parts.push(late + " ödevin gecikmiş");
    if (soon) parts.push(soon + " ödevin 3 gün içinde teslim");
    if (!late && !soon) parts.push("yakın teslim yok");
    if (data.expenses.budget && data.expenses.left < 0) parts.push("bütçe aşıldı");
    $("summary").textContent = parts.join(", ") + ".";
    $("foot").textContent = "Son güncelleme " + fTime.format(new Date()) + " · 3 dakikada bir yenilenir";
  }

  function gate(text) {
    $("app").classList.add("hidden");
    $("gate").classList.remove("hidden");
    if (text) $("gateText").textContent = text;
  }

  $("loginForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var code = $("code").value.trim();
    if (!code) return;
    $("loginMsg").textContent = "Kontrol ediliyor…";
    fetch("/panel/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.key) { $("loginMsg").textContent = r.error || "Giriş olmadı."; return; }
        key = r.key;
        try { localStorage.setItem(STORE, key); } catch (e) {}
        $("loginMsg").textContent = "";
        load(); live();
      })
      .catch(function () { $("loginMsg").textContent = "Jarvis'e ulaşılamadı."; });
  });

  // Bot cevapları Telegram'ın sınırlı HTML'iyle gelir: yalnızca kalın, eğik, kod ve bağlantı kopyalanır.
  var ALLOWED = { b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", code: "code", pre: "pre", a: "a" };
  function rich(html) {
    var doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    var out = document.createDocumentFragment();
    (function walk(node, into) {
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) return into.appendChild(document.createTextNode(n.nodeValue));
        if (n.nodeType !== 1 || /^(script|style|iframe|object|embed)$/i.test(n.tagName)) return;
        var tag = ALLOWED[n.tagName.toLowerCase()];
        if (!tag) return walk(n, into);
        var e = document.createElement(tag);
        if (tag === "a") {
          var h = n.getAttribute("href") || "";
          if (/^https?:\/\//i.test(h)) { e.href = h; e.target = "_blank"; e.rel = "noopener noreferrer"; }
        }
        walk(n, e);
        into.appendChild(e);
      });
    })(doc.body.firstChild, out);
    return out;
  }

  var CHAT = "jarvis-chat";
  var history = [];
  try { history = JSON.parse(localStorage.getItem(CHAT) || "[]"); } catch (e) { history = []; }
  function bubble(who, html, cls) {
    var m = el("div", "msg " + who + (cls ? " " + cls : ""));
    if (who === "bot") m.appendChild(rich(html)); else m.textContent = html;
    $("chatlog").appendChild(m);
    $("chatlog").scrollTop = $("chatlog").scrollHeight;
    return m;
  }
  function remember(who, text) {
    history.push({ w: who, t: text });
    history = history.slice(-40);
    try { localStorage.setItem(CHAT, JSON.stringify(history)); } catch (e) {}
  }
  history.forEach(function (h) { bubble(h.w, h.t); });
  if (!history.length) bubble("bot", "Merhaba efendim. Ne yapmamı istersin? Örnek: <i>bu hafta beni ne bekliyor?</i>, <i>kahveye 80 TL verdim</i>, <i>bilgisayarı kilitle</i>");

  $("chatForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("chatInput"), text = input.value.trim();
    if (!text) return;
    input.value = "";
    bubble("me", text); remember("me", text);
    var waiting = bubble("bot", "Düşünüyorum…", "wait");
    fetch("/panel/chat", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ text: text }) })
      .then(function (r) { if (r.status === 401) throw new Error("yetki"); return r.json(); })
      .then(function (r) {
        waiting.remove();
        (r.replies && r.replies.length ? r.replies : ["Tamam."]).forEach(function (h) { bubble("bot", h); remember("bot", h); });
      })
      .catch(function (err) {
        waiting.remove();
        if (err.message === "yetki") return gate("Giriş süren dolmuş. Telegram'da /panel yazıp gelen kodu gir.");
        bubble("bot", "Jarvis'e ulaşılamadı, biraz sonra yeniden dener misin?");
      });
  });

  // Canlı bağlantı: yeni bir şey olunca Jarvis haber verir, ekran hemen yenilenir.
  var sock = null, wait = 2000, pinger = null;
  function live() {
    if (!key || !("WebSocket" in window) || (sock && sock.readyState <= 1)) return;
    try { sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/panel/live?k=" + encodeURIComponent(key)); }
    catch (e) { return; }
    sock.onopen = function () {
      wait = 2000;
      $("dotLive").className = "dot on";
      clearInterval(pinger);
      pinger = setInterval(function () { try { sock.send("ping"); } catch (e) {} }, 30000);
    };
    sock.onmessage = function (ev) {
      if (ev.data === "pong") return;
      var d = {};
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.tip === "yenile") load();
      if (d.tip === "dosya") { load(); $("foot").textContent = "📄 " + String(d.name || "Dosya") + " hazır: Dosyalar bölümünden indir."; }
      if (d.tip === "bulundu") $("foot").textContent = "📱 Telefon bulundu, bildirimler durdu.";
      if (d.tip === "pc") renderPc({ pc: { paired: true, online: d.online } });
    };
    sock.onclose = function () {
      $("dotLive").className = "dot off";
      clearInterval(pinger);
      if (!document.hidden) setTimeout(live, wait);
      wait = Math.min(wait * 2, 60000);
    };
  }

  // Bildirimler (iPhone'da yalnızca Ana Ekrana eklenmiş uygulamada çalışır)
  function b64ToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(s + "===".slice((s.length + 3) % 4)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  var swReady = ("serviceWorker" in navigator) ? navigator.serviceWorker.register("/panel/sw.js", { scope: "/panel" }).catch(function () { return null; }) : Promise.resolve(null);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", function (ev) {
      if (ev.data && ev.data.tip === "yenile") load();
      if (ev.data && ev.data.tip === "bulundu") found();
    });
  }

  // Telefonumu bul: bildirime dokunulunca çaldırma durur.
  function found() {
    if (!key) return;
    fetch("/panel/found", { method: "POST", headers: { Authorization: "Bearer " + key } }).catch(function () {});
    var box = $("found");
    box.classList.remove("hidden");
    setTimeout(function () { box.classList.add("hidden"); }, 3500);
  }
  if (/[?&]bul=1/.test(location.search)) {
    try { window.history.replaceState(null, "", "/panel" + location.hash); } catch (e) {}
    setTimeout(found, 300);
  }
  $("findPhone").addEventListener("click", function () {
    var b = $("findPhone");
    b.disabled = true;
    $("foot").textContent = "Telefon aranıyor…";
    fetch("/panel/bul", { method: "POST", headers: { Authorization: "Bearer " + key } })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var tmp = new DOMParser().parseFromString("<p>" + (r.text || r.error || "Tamam.") + "</p>", "text/html");
        $("foot").textContent = tmp.body.textContent;
      })
      .catch(function () { $("foot").textContent = "Jarvis'e ulaşılamadı."; })
      .then(function () { b.disabled = false; });
  });
  function notifyState() {
    var b = $("notify");
    if (!("Notification" in window) || !("PushManager" in window)) { b.textContent = "🔔 Bildirimler"; return; }
    if (Notification.permission === "granted") {
      swReady.then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
        b.textContent = sub ? "🔔 Bildirim açık" : "🔔 Bildirimler";
      });
    } else if (Notification.permission === "denied") b.textContent = "🔕 Bildirim kapalı";
  }
  $("notify").addEventListener("click", function () {
    var toast = function (t) { $("foot").textContent = t; window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); };
    var standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (!("Notification" in window) || !("PushManager" in window)) {
      return toast(standalone ? "Bu cihaz bildirimleri desteklemiyor (iOS 16.4 ve üstü gerekir)." : "Bildirimler için önce Safari'de paylaş düğmesinden Ana Ekrana Ekle'yi seç, sonra uygulamayı ana ekrandan aç.");
    }
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("izin");
      return Promise.all([swReady, fetch("/panel/push-key", { headers: { Authorization: "Bearer " + key } }).then(function (r) { return r.json(); })]);
    }).then(function (x) {
      var reg = x[0], k = x[1];
      if (!reg || !k.publicKey) throw new Error("hazir degil");
      return reg.pushManager.getSubscription().then(function (old) {
        return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.publicKey) });
      });
    }).then(function (sub) {
      return fetch("/panel/push", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ sub: sub.toJSON() }) });
    }).then(function (r) {
      toast(r.ok ? "Bildirimler açıldı. Deneme bildirimi gönderildi." : "Bildirim kaydı olmadı.");
      notifyState();
    }).catch(function (err) {
      toast(err.message === "izin" ? "Bildirim izni verilmedi. Ayarlar > Bildirimler > Jarvis'ten açabilirsin." : "Bildirimler açılamadı, biraz sonra yeniden dener misin?");
      notifyState();
    });
  });

  var loading = false;
  function load() {
    if (!key) return gate();
    if (loading) return;
    loading = true;
    fetch("/panel/api", { headers: { Authorization: "Bearer " + key }, cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) { try { localStorage.removeItem(STORE); } catch (e) {} throw new Error("yetki"); }
        if (!res.ok) throw new Error("http " + res.status);
        return res.json();
      })
      .then(function (data) {
        $("gate").classList.add("hidden");
        $("app").classList.remove("hidden");
        render(data);
      })
      .catch(function (err) {
        if (err.message === "yetki") return gate("Bu bağlantı artık geçerli değil. Telegram'da Jarvis'e /panel yazıp yeni bağlantıyı aç.");
        $("foot").textContent = "Jarvis'e ulaşılamadı, biraz sonra yeniden denenecek.";
        if ($("app").classList.contains("hidden")) gate("Jarvis'e şu an ulaşılamadı. Biraz sonra sayfayı yenile.");
      })
      .then(function () { loading = false; });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".actions button"), function (b) {
    b.addEventListener("click", function () {
      var toast = $("toast");
      b.disabled = true;
      toast.textContent = "İletiliyor…";
      fetch("/panel/pc", {
        method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ is: b.getAttribute("data-is"), arg: b.getAttribute("data-arg") || "" }),
      }).then(function (r) { return r.json(); })
        .then(function (r) { toast.textContent = r.text || r.error || "Tamam."; })
        .catch(function () { toast.textContent = "Jarvis'e ulaşılamadı."; })
        .then(function () { b.disabled = !pcOnline; });
    });
  });

  $("refresh").addEventListener("click", load);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { load(); live(); } });
  tick();
  setInterval(tick, 1000);
  setInterval(function () { if (!document.hidden) load(); }, 180000);
  load();
  live();
  notifyState();
})();
</script>
</body>
</html>`;

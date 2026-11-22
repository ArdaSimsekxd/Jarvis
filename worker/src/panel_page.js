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
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Orbitron:wght@500;700&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
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
.mini { white-space: nowrap; flex: 0 0 auto; font: 700 10px var(--head); letter-spacing: .14em; padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(63, 216, 255, .45); background: transparent; color: var(--cyan); cursor: pointer; }
.mini.warn { color: var(--red); border-color: var(--red); }
.akform { display: flex; gap: 8px; margin-bottom: 12px; }
.akform input { min-width: 0; flex: 1 1 auto; }
.ak { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(63, 216, 255, .08); }
.ak:last-child { border-bottom: 0; }
.ak .tick { flex: 0 0 auto; width: 30px; height: 30px; padding: 0; border-radius: 50%; font-size: 15px; line-height: 1; }
.ak .txt { min-width: 0; overflow-wrap: anywhere; flex: 1 1 auto; }
.ak.done .txt { text-decoration: line-through; opacity: .45; }
.ak .age { flex: 0 0 auto; color: var(--muted); font-size: 13px; }
.rem { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
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
.chatform input { min-width: 0; flex: 1 1 auto; }
.sendico { display: none; }
@media (max-width: 480px) { .chatform { gap: 6px; } .chatform .mic { width: 40px; font-size: 19px; } .chatform button[type=submit] { flex: 0 0 auto; width: 52px; padding: 0; font-size: 20px; } .sendtxt { display: none; } .sendico { display: inline; } }
.mic { flex: 0 0 auto; width: 52px; font-size: 22px; padding: 0; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.mic.rec { background: rgba(255, 77, 109, .22); border-color: #ff4d6d; box-shadow: 0 0 18px rgba(255, 77, 109, .55); animation: pulse 1s ease-in-out infinite; }
.mic:disabled { opacity: .5; }
@keyframes pulse { 50% { box-shadow: 0 0 4px rgba(255, 77, 109, .2); } }
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

/* ---------- Anı defteri ---------- */
.anibox { display: flex; gap: 14px; align-items: center; margin-bottom: 12px; }
.anithumb { flex: 0 0 auto; width: 74px; height: 84px; background: #f7f0e1; padding: 5px 5px 14px; transform: rotate(-4deg);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .5); display: grid; place-items: center; font-size: 30px; }
.anithumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.anitext { min-width: 0; font-size: 18px; color: #fff; }
.anibtns { display: flex; gap: 8px; flex-wrap: wrap; }
.anibtns button { flex: 1 1 auto; }
.aniform { display: grid; gap: 8px; margin-top: 12px; }
.aniform img { max-width: 100%; max-height: 220px; justify-self: center; border: 6px solid #f7f0e1; box-shadow: 0 4px 14px rgba(0, 0, 0, .5); }
.anirow { display: flex; gap: 8px; }
.anirow input { flex: 1 1 auto; min-width: 0; }
.aniwarn { color: var(--amber); font-size: 15px; }
input[type=date] { font: 500 16px var(--body); color: var(--text); background: rgba(3, 7, 13, .7); border: 1px solid var(--line);
  border-radius: 6px; padding: 8px 10px; color-scheme: dark; }

.bookwrap { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  padding: calc(10px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom)); overflow: hidden;
  background-color: #02050a; background-image: radial-gradient(900px 700px at 50% 45%, rgba(63, 216, 255, .13), transparent 65%); }
.bookwrap.show { animation: bookin .35s ease-out; }
@keyframes bookin { from { opacity: 0; transform: scale(.96); } }
.booktop, .bookbar { width: min(100%, 520px); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.booktop { color: var(--cyan); font: 600 13px var(--head); letter-spacing: .16em; }
.bookbar input { flex: 1 1 auto; accent-color: #3fd8ff; }
.bookbar .mini { font-size: 18px; padding: 2px 14px; }
.bookhint { color: var(--muted); font-size: 13px; letter-spacing: .14em; text-transform: uppercase; }
.stage { touch-action: none; -webkit-user-select: none; user-select: none; padding-left: 6px; }
.book { position: relative; width: min(86vw, 430px, calc((100vh - 190px) * .72)); aspect-ratio: 3 / 4.15; perspective: 2200px; }
.book::before { content: ""; position: absolute; inset: 6px -6px -6px 6px; background: #d9cdb4; border-radius: 3px 10px 10px 3px;
  box-shadow: 0 30px 60px rgba(0, 0, 0, .6), 0 0 40px rgba(63, 216, 255, .12); }
.leaf { position: absolute; inset: 0; transform-origin: left center; transform-style: preserve-3d; -webkit-transform-style: preserve-3d;
  transition: transform .75s cubic-bezier(.22, .7, .22, 1); will-change: transform; }
.face { position: absolute; inset: 0; overflow: hidden; border-radius: 2px 8px 8px 2px; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.face.back { transform: rotateY(180deg); border-radius: 8px 2px 2px 8px; }
.face::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .75s;
  background: linear-gradient(to left, rgba(0, 0, 0, .28), rgba(0, 0, 0, 0) 55%); }
.face.back::after { background: linear-gradient(to right, rgba(0, 0, 0, .3), rgba(255, 255, 255, .08) 60%); }
.leaf.turning .face::after { opacity: 1; }
.paper { background: radial-gradient(130% 90% at 60% 40%, #fbf6ea, #efe4cc 92%);
  color: #3a2f28; display: flex; flex-direction: column; align-items: center; padding: 18px 18px 14px 26px; }
.paper::before { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(to right, rgba(80, 55, 30, .22), rgba(80, 55, 30, 0) 7%), repeating-linear-gradient(transparent 0 31px, rgba(120, 150, 180, .16) 31px 32px); }
.face.back.paper { background: radial-gradient(130% 90% at 40% 40%, #f3ead6, #e4d6b8 92%); }
.hand { font-family: "Caveat", "Segoe Print", cursive; }
.pdate { position: relative; font: 700 30px "Caveat", cursive; line-height: 1; color: #4b3a2e; text-align: center; }
.pdate small { display: block; font-size: 19px; font-weight: 500; color: #8a7461; margin-top: 2px; }
.polaroid { position: relative; margin: 14px 0 10px; background: #fff; padding: 8px 8px 30px; box-shadow: 0 6px 18px rgba(60, 40, 20, .35); width: 74%; }
.polaroid.wide { width: 88%; }
.polaroid .ph { width: 100%; aspect-ratio: 4 / 5; background: #e9e2d3 center / cover no-repeat; }
.polaroid.wide .ph { aspect-ratio: 4 / 3; }
.polaroid::before, .polaroid::after { content: ""; position: absolute; top: -10px; width: 70px; height: 22px; background: rgba(63, 216, 255, .38); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
.polaroid::before { left: -14px; transform: rotate(-32deg); }
.polaroid::after { right: -14px; transform: rotate(30deg); background: rgba(255, 181, 71, .42); }
.pcap { position: relative; font: 500 25px/1.12 "Caveat", cursive; text-align: center; color: #2f2620; max-height: 3.4em; overflow: hidden; overflow-wrap: anywhere; }
.pnum { position: absolute; bottom: 10px; right: 16px; font: 500 18px "Caveat", cursive; color: #9a8570; }
.pdel { position: absolute; top: 8px; right: 8px; z-index: 2; background: rgba(255, 255, 255, .5); color: #8a5a4a; border-color: rgba(138, 90, 74, .35); font-size: 13px; padding: 4px 8px; }
.pdel.warn { background: #fff; color: #c0392b; border-color: #c0392b; }
.pend { justify-content: center; gap: 14px; text-align: center; }
.pend .big2 { position: relative; font: 700 34px/1.1 "Caveat", cursive; color: #4b3a2e; }
.pend button { position: relative; color: #2b6f8c; border-color: rgba(43, 111, 140, .5); background: rgba(255, 255, 255, .55); }
.cover { background: radial-gradient(120% 90% at 30% 20%, #1c3346, #0b1520 70%); color: var(--cyan); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; }
.cover::before { content: ""; position: absolute; inset: 14px 14px 14px 22px; border: 2px dashed rgba(63, 216, 255, .35); border-radius: 4px; pointer-events: none; }
.cover::after { background: linear-gradient(to right, rgba(0, 0, 0, .45), rgba(0, 0, 0, 0) 9%) !important; opacity: 1 !important; }
.cover .crest { width: 96px; height: 96px; border-radius: 50%; border: 3px solid var(--cyan); box-shadow: 0 0 26px var(--cyan-soft), inset 0 0 18px var(--cyan-soft);
  display: grid; place-items: center; font-size: 40px; }
.cover h3 { margin: 0; font: 700 24px var(--head); letter-spacing: .28em; text-shadow: 0 0 14px var(--cyan-soft); }
.cover p { margin: 0; font: 500 26px "Caveat", cursive; color: #cfefff; }
.cover .meta { font: 600 13px var(--body); letter-spacing: .2em; color: var(--muted); text-transform: uppercase; }
.pback { justify-content: center; }
.pback .mark { position: relative; font: 700 64px var(--head); color: rgba(75, 58, 46, .08); }
@media (prefers-reduced-motion: reduce) { .leaf { transition-duration: .01s; } }

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
          <button type="button" id="bus" class="mic" aria-label="Yakınımdaki otobüsler" title="Yakınımdaki durağa gelen otobüsler (konumunu bir kez kullanır)">🚌</button>
          <button type="button" id="tram" class="mic" aria-label="Yakınımdaki tramvay" title="Yakınımdaki tramvay durağı (konumunu bir kez kullanır)">🚋</button>
          <button type="button" id="mic" class="mic" aria-label="Basılı tut ve konuş" title="Basılı tut ve konuş (ya da dokun, konuş, yeniden dokun)">🎙</button>
          <button type="submit" aria-label="Gönder"><span class="sendtxt">Gönder</span><span class="sendico">➤</span></button>
        </form>
        <div class="toast" id="micState" aria-live="polite"></div>
      </section>
      <section class="card wide"><h2>AKLIMDA <span class="count" id="cAklimda">saati olmayan yapılacaklar</span></h2>
        <form class="akform" id="akForm" autocomplete="off">
          <input type="text" id="akInput" placeholder="Aklında kalsın: süt al, kitabı iade et…" maxlength="300" aria-label="Aklımda listesine ekle">
          <button type="submit">EKLE</button>
        </form>
        <div class="toast" id="akState" aria-live="polite"></div>
        <div id="aklimda"></div>
      </section>
      <section class="card"><h2>ANI DEFTERİ <span class="count" id="cAni"></span></h2>
        <div class="anibox">
          <div class="anithumb" id="aniThumb">📖</div>
          <div class="anitext"><div id="aniStatus">Her güne bir fotoğraf</div><div class="sub" id="aniSub"></div></div>
        </div>
        <div class="anibtns"><button type="button" id="aniAdd">📷 Bugünü ekle</button><button type="button" id="aniOpen">📖 Defteri aç</button></div>
        <form class="aniform hidden" id="aniForm" autocomplete="off">
          <img id="aniPreview" alt="Seçilen fotoğraf">
          <input type="text" id="aniCap" maxlength="200" placeholder="Bugün nasıldı? (isteğe bağlı)" aria-label="Fotoğrafın notu">
          <div class="anirow"><input type="date" id="aniDay" aria-label="Gün"><button type="submit" id="aniSave">Kaydet</button><button type="button" id="aniCancel">Vazgeç</button></div>
          <div class="aniwarn" id="aniWarn"></div>
        </form>
        <div class="toast" id="aniState" aria-live="polite"></div>
        <input type="file" id="aniFile" accept="image/*" class="hidden">
      </section>
      <section class="card"><h2>BUGÜN <span class="count" id="cLessons"></span></h2><div id="lessons"></div></section>
      <section class="card wide"><h2>ÖDEVLER <span class="count" id="cHomework"></span></h2><div id="homework"></div></section>
      <section class="card wide"><h2>YAKLAŞANLAR <span class="count" id="cUpcoming"></span></h2><div id="upcoming"></div></section>
      <section class="card wide"><h2>HATIRLATMALAR <span class="count"><span id="cReminders"></span> <button type="button" class="mini" id="addReminder">+ EKLE</button></span></h2><div id="reminders"></div></section>
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
  <div class="bookwrap hidden" id="book" role="dialog" aria-modal="true" aria-label="Anı defteri">
    <div class="booktop"><span id="bookPos">ANI DEFTERİ</span><span><button type="button" class="mini" id="bookSound" aria-label="Sayfa sesi">🔊</button> <button type="button" class="mini" id="bookClose">Kapat ✕</button></span></div>
    <div class="stage" id="stage"><div class="book" id="bookPages"></div></div>
    <div class="bookbar"><button type="button" class="mini" id="bookPrev" aria-label="Önceki sayfa">‹</button><input type="range" id="bookRange" min="0" max="0" value="0" aria-label="Sayfaya git"><button type="button" class="mini" id="bookNext" aria-label="Sonraki sayfa">›</button></div>
    <div class="bookhint">Sayfayı parmağınla çevir ya da kenarına dokun</div>
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

  // Aklımda: saati olmayan yapılacaklar. ✓'ye dokununca yapıldı sayılır ve listeden düşer.
  function ago(ms) {
    var d = Math.floor((Date.now() - ms) / 864e5);
    return d <= 0 ? "bugün" : d === 1 ? "dün" : d + " gün önce";
  }
  function renderAklimda(data) {
    var box = $("aklimda"), list = data.aklimda || [];
    box.textContent = "";
    $("cAklimda").textContent = list.length ? list.length + " madde" : "saati olmayan yapılacaklar";
    if (!list.length) return empty(box, "Liste boş. Yukarıya yaz ya da Jarvis'e söyle: \"aklımda kalsın, kitabı iade edeceğim\"");
    list.forEach(function (it) {
      var line = el("div", "ak");
      var b = el("button", "tick", "✓");
      b.type = "button"; b.title = "Yapıldı"; b.setAttribute("aria-label", "Yapıldı: " + it.text);
      b.addEventListener("click", function () {
        b.disabled = true; line.classList.add("done");
        fetch("/panel/aklimda", { method: "DELETE", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) })
          .then(function (res) { if (!res.ok && res.status !== 404) throw new Error("http"); setTimeout(load, 500); })
          .catch(function () { b.disabled = false; line.classList.remove("done"); $("akState").textContent = "Jarvis'e ulaşılamadı, yeniden dener misin?"; });
      });
      line.appendChild(b);
      line.appendChild(el("span", "txt", it.text));
      line.appendChild(el("span", "age", ago(it.at)));
      box.appendChild(line);
    });
  }
  $("akForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("akInput"), text = input.value.trim();
    if (!text) return;
    input.disabled = true; $("akState").textContent = "";
    fetch("/panel/aklimda", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ text: text }) })
      .then(function (res) { return res.json().then(function (r) { return { ok: res.ok, r: r }; }); })
      .then(function (x) {
        if (!x.ok) { $("akState").textContent = x.r.error || "Eklenemedi."; return; }
        input.value = ""; load();
      })
      .catch(function () { $("akState").textContent = "Jarvis'e ulaşılamadı, yeniden dener misin?"; })
      .then(function () { input.disabled = false; input.focus(); });
  });

  // ---------- Anı defteri: her güne bir fotoğraf, sayfaları çevrilen bir defter ----------
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  var fWeek = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long" });
  function dayParts(d) { var p = d.split("-").map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function dayTitle(d) { var p = dayParts(d); return p.d + " " + MONTHS[p.m - 1] + " " + p.y; }
  function weekday(d) { var p = dayParts(d); return fWeek.format(new Date(Date.UTC(p.y, p.m - 1, p.d))); }
  var aniUrls = {};
  function aniPhoto(d, v) {
    var id = d + "." + v;
    if (!aniUrls[id]) {
      aniUrls[id] = fetch("/panel/ani/foto?d=" + d + "&v=" + encodeURIComponent(v), { headers: { Authorization: "Bearer " + key } })
        .then(function (res) { if (!res.ok) throw new Error("http"); return res.blob(); })
        .then(function (b) { return URL.createObjectURL(b); })
        .catch(function (err) { delete aniUrls[id]; throw err; });
    }
    return aniUrls[id];
  }
  var aniSum = null, aniDays = null;
  function renderAni(data) {
    var s = data.ani || { count: 0, today: false, streak: 0, last: null };
    aniSum = s;
    $("cAni").textContent = s.count ? s.count + " sayfa" : "";
    $("aniStatus").textContent = s.today ? "Bugünün sayfası hazır ✓" : "Bugün henüz fotoğraf yok";
    $("aniSub").textContent = s.streak >= 2 ? "🔥 " + s.streak + " gün üst üste" : s.last ? "Son sayfa: " + dayTitle(s.last.d) : "İlk sayfanı bugün aç. Telegram'da fotoğrafın altına \"anı\" yazman da yeter.";
    $("aniAdd").textContent = s.today ? "📷 Bugünü değiştir" : "📷 Bugünü ekle";
    var thumb = $("aniThumb");
    if (!s.last) { thumb.textContent = "📖"; return; }
    if (thumb.getAttribute("data-id") === s.last.d + s.last.v) return;
    thumb.setAttribute("data-id", s.last.d + s.last.v);
    aniPhoto(s.last.d, s.last.v).then(function (u) { thumb.textContent = ""; var im = el("img"); im.alt = dayTitle(s.last.d); im.src = u; thumb.appendChild(im); }).catch(function () {});
  }

  // Fotoğraf seçilince küçültülür (en uzun kenar 1440 px, JPEG): yükleme hızlı olur, defter yer kaplamaz
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var s = Math.min(1, 1440 / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
        var g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        (function enc(q) {
          c.toBlob(function (b) {
            if (!b) return reject(new Error("resim"));
            if (b.size > 1400000 && q > .5) return enc(q - .13);
            resolve(b);
          }, "image/jpeg", q);
        })(.85);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("resim")); };
      im.src = url;
    });
  }
  function blobB64(b) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function () { reject(new Error("okuma")); };
      r.readAsDataURL(b);
    });
  }
  function aniList() {
    return fetch("/panel/ani", { headers: { Authorization: "Bearer " + key }, cache: "no-store" })
      .then(function (res) { if (!res.ok) throw new Error("http"); return res.json(); })
      .then(function (r) { aniDays = r.days || []; return aniDays; });
  }
  var aniBlob = null;
  function aniWarn() {
    var d = $("aniDay").value, has = (aniDays || []).some(function (x) { return x.d === d; });
    $("aniWarn").textContent = has ? "Bu günün sayfası zaten var; fotoğrafı yenisiyle değişecek." : "";
  }
  $("aniAdd").addEventListener("click", function () { $("aniFile").value = ""; $("aniFile").click(); });
  $("aniFile").addEventListener("change", function () {
    var f = $("aniFile").files && $("aniFile").files[0];
    if (!f) return;
    $("aniState").textContent = "Fotoğraf hazırlanıyor…";
    shrink(f).then(function (b) {
      aniBlob = b;
      var old = $("aniPreview").src; if (old && old.indexOf("blob:") === 0) URL.revokeObjectURL(old);
      $("aniPreview").src = URL.createObjectURL(b);
      var today = fKey.format(new Date());
      $("aniDay").value = today; $("aniDay").max = today;
      $("aniCap").value = "";
      $("aniForm").classList.remove("hidden");
      $("aniState").textContent = "";
      aniWarn();
      aniList().then(aniWarn).catch(function () {});
      $("aniCap").focus();
    }).catch(function () { $("aniState").textContent = "Bu fotoğrafı açamadım. Başka bir fotoğraf dener misin?"; });
  });
  $("aniDay").addEventListener("change", aniWarn);
  $("aniCancel").addEventListener("click", function () { $("aniForm").classList.add("hidden"); aniBlob = null; $("aniState").textContent = ""; });
  $("aniForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!aniBlob) return;
    var btn = $("aniSave"), d = $("aniDay").value;
    btn.disabled = true; $("aniState").textContent = "Deftere yapıştırılıyor…";
    blobB64(aniBlob).then(function (img) {
      return fetch("/panel/ani", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ d: d, cap: $("aniCap").value, img: img }) });
    }).then(function (res) { return res.json().then(function (r) { return { ok: res.ok, r: r }; }); })
      .then(function (x) {
        if (!x.ok) { $("aniState").textContent = x.r.error || "Kaydedilemedi."; return; }
        $("aniForm").classList.add("hidden"); aniBlob = null;
        $("aniState").textContent = "📖 " + dayTitle(d) + " sayfası deftere eklendi.";
        load();
      })
      .catch(function () { $("aniState").textContent = "Jarvis'e ulaşılamadı, yeniden dener misin?"; })
      .then(function () { btn.disabled = false; });
  });

  // Sayfa sesi: kısa bir kâğıt hışırtısı (Web Audio ile üretilir, dosya yok)
  var SOUND = "jarvis-ani-ses", soundOn = true, actx = null;
  try { soundOn = localStorage.getItem(SOUND) !== "0"; } catch (e) {}
  function soundLabel() { $("bookSound").textContent = soundOn ? "🔊" : "🔇"; }
  function rustle() {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var len = Math.floor(actx.sampleRate * .32), buf = actx.createBuffer(1, len, actx.sampleRate), ch = buf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
      var src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain(), t = actx.currentTime;
      src.buffer = buf; bp.type = "bandpass"; bp.Q.value = .8;
      bp.frequency.setValueAtTime(1800, t); bp.frequency.linearRampToValueAtTime(4200, t + .28);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .04); g.gain.exponentialRampToValueAtTime(.001, t + .32);
      src.connect(bp); bp.connect(g); g.connect(actx.destination); src.start(t);
    } catch (e) {}
  }
  $("bookSound").addEventListener("click", function () {
    soundOn = !soundOn; soundLabel();
    try { localStorage.setItem(SOUND, soundOn ? "1" : "0"); } catch (e) {}
    rustle();
  });

  var bk = { pages: [], els: {}, cur: 0, busy: false };
  function paperFace(cls) { return el("div", "face paper " + (cls || "")); }
  function backFace() { var f = el("div", "face back paper pback"); f.appendChild(el("div", "mark", "J")); return f; }
  function buildLeaf(i) {
    var pg = bk.pages[i], leaf = el("div", "leaf"), front;
    if (pg.t === "cover") {
      front = el("div", "face cover");
      front.appendChild(el("div", "crest", "📖"));
      front.appendChild(el("h3", null, "ANI DEFTERİ"));
      front.appendChild(el("p", null, "Her gün bir sayfa"));
      var days = bk.pages.length - 2;
      front.appendChild(el("div", "meta", days ? days + " sayfa" + (aniSum && aniSum.streak >= 2 ? " · 🔥 " + aniSum.streak + " gün" : "") : "Henüz boş"));
    } else if (pg.t === "end") {
      front = paperFace("pend");
      var today = fKey.format(new Date()), has = bk.pages.some(function (p) { return p.d === today; });
      front.appendChild(el("div", "big2", has ? "Bugünün sayfası tamam ✓" : "Bugünün sayfası boş"));
      front.appendChild(el("div", "pcap", has ? "Yarın yeni bir sayfa seni bekliyor." : "Bir fotoğraf çek, defter seni bekliyor."));
      var add = el("button", null, has ? "📷 Değiştir" : "📷 Fotoğraf ekle");
      add.type = "button";
      add.addEventListener("click", function () { closeBook(); $("aniFile").value = ""; $("aniFile").click(); });
      front.appendChild(add);
    } else {
      front = paperFace();
      var date = el("div", "pdate", dayTitle(pg.d));
      date.appendChild(el("small", null, weekday(pg.d)));
      front.appendChild(date);
      var pol = el("div", "polaroid"), ph = el("div", "ph");
      pol.style.transform = "rotate(" + (i % 2 ? 1.6 : -1.8) + "deg)";
      pol.appendChild(ph); front.appendChild(pol);
      if (pg.cap) front.appendChild(el("div", "pcap", pg.cap));
      front.appendChild(el("div", "pnum", String(i)));
      var del = el("button", "mini pdel", "🗑");
      del.type = "button"; del.setAttribute("aria-label", dayTitle(pg.d) + " sayfasını sil");
      var armed = null;
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (!armed) { del.classList.add("warn"); del.textContent = "Silinsin mi?"; armed = setTimeout(function () { armed = null; del.classList.remove("warn"); del.textContent = "🗑"; }, 3000); return; }
        clearTimeout(armed); del.disabled = true;
        fetch("/panel/ani", { method: "DELETE", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ d: pg.d }) })
          .then(function (res) { if (!res.ok && res.status !== 404) throw new Error("http"); removePage(i); load(); })
          .catch(function () { del.disabled = false; del.textContent = "🗑"; del.classList.remove("warn"); armed = null; });
      });
      front.appendChild(del);
      pg.ph = ph; pg.pol = pol;
    }
    leaf.appendChild(front);
    leaf.appendChild(backFace());
    return leaf;
  }
  function leafAt(i) { if (!bk.els[i]) bk.els[i] = buildLeaf(i); return bk.els[i]; }
  function loadPhoto(i) {
    var pg = bk.pages[i];
    if (!pg || !pg.d || pg.loaded) return;
    leafAt(i);
    pg.loaded = true;
    aniPhoto(pg.d, pg.v).then(function (u) {
      var probe = new Image();
      probe.onload = function () { if (probe.naturalWidth > probe.naturalHeight * 1.1) pg.pol.classList.add("wide"); pg.ph.style.backgroundImage = "url(\"" + u + "\")"; };
      probe.src = u;
    }).catch(function () { pg.loaded = false; });
  }
  // Yalnızca açık sayfa, altındaki ve bir önceki (çevrilmiş) sayfa sahnede durur
  function layout() {
    var box = $("bookPages"), n = bk.pages.length;
    box.textContent = "";
    [bk.cur + 1, bk.cur, bk.cur - 1].forEach(function (i) {
      if (i < 0 || i >= n) return;
      var leaf = leafAt(i);
      leaf.classList.remove("turning");
      leaf.style.transition = "none";
      leaf.style.zIndex = String(n - i);
      leaf.style.transform = i < bk.cur ? "rotateY(-180deg)" : "rotateY(0deg)";
      leaf.style.visibility = i < bk.cur ? "hidden" : "visible";
      box.appendChild(leaf);
    });
    void box.offsetWidth;
    [bk.cur - 1, bk.cur, bk.cur + 1, bk.cur + 2].forEach(loadPhoto);
    var pg = bk.pages[bk.cur];
    $("bookPos").textContent = pg.t === "cover" ? "ANI DEFTERİ" : pg.t === "end" ? "SON SAYFA" : bk.cur + " / " + (n - 2) + " · " + dayTitle(pg.d).toUpperCase();
    $("bookRange").max = String(n - 1); $("bookRange").value = String(bk.cur);
    $("bookPrev").disabled = bk.cur === 0; $("bookNext").disabled = bk.cur === n - 1;
  }
  function animate(leaf, deg, done) {
    leaf.style.transition = "";
    leaf.classList.add("turning");
    var finished = false;
    function end() { if (finished) return; finished = true; leaf.removeEventListener("transitionend", onEnd); done(); }
    function onEnd(ev) { if (ev.target === leaf && ev.propertyName === "transform") end(); }
    leaf.addEventListener("transitionend", onEnd);
    setTimeout(end, 900);
    leaf.style.transform = "rotateY(" + deg + "deg)";
  }
  function next() {
    if (bk.busy || bk.cur >= bk.pages.length - 1) return;
    bk.busy = true; rustle();
    animate(leafAt(bk.cur), -180, function () { bk.cur++; bk.busy = false; layout(); });
  }
  function prev() {
    if (bk.busy || bk.cur <= 0) return;
    bk.busy = true; rustle();
    var leaf = leafAt(bk.cur - 1);
    leaf.style.visibility = "visible";
    void leaf.offsetWidth;
    animate(leaf, 0, function () { bk.cur--; bk.busy = false; layout(); });
  }
  function jump(i) { if (bk.busy || i === bk.cur) return; bk.cur = Math.max(0, Math.min(bk.pages.length - 1, i)); layout(); }
  function removePage(i) {
    bk.pages.splice(i, 1);
    bk.els = {};
    bk.pages.forEach(function (p) { p.loaded = false; });
    if (bk.cur >= bk.pages.length) bk.cur = bk.pages.length - 1;
    layout();
  }
  function openBook() {
    var b = $("aniOpen");
    b.disabled = true;
    aniList().then(function (days) {
      bk.pages = [{ t: "cover" }].concat(days.map(function (x) { return { t: "day", d: x.d, cap: x.cap, v: x.v }; }), [{ t: "end" }]);
      bk.els = {}; bk.busy = false;
      var target = days.length ? days.length : 1;
      bk.cur = 0;
      $("book").classList.remove("hidden"); $("book").classList.add("show");
      document.body.style.overflow = "hidden";
      soundLabel();
      layout();
      // Kapak açılır ve defter en son sayfadan başlar: kapağın altına son sayfa konur
      if (target !== 1) {
        var box = $("bookPages"), first = leafAt(1), under = leafAt(target);
        if (first.parentNode === box) box.removeChild(first);
        under.style.transition = "none"; under.style.transform = "rotateY(0deg)"; under.style.visibility = "visible"; under.style.zIndex = "1";
        box.insertBefore(under, box.firstChild);
      }
      loadPhoto(target);
      bk.busy = true;
      setTimeout(function () {
        rustle();
        animate(leafAt(0), -180, function () { bk.cur = target; bk.busy = false; layout(); });
      }, 450);
    }).catch(function () { $("aniState").textContent = "Defter açılamadı, yeniden dener misin?"; })
      .then(function () { b.disabled = false; });
  }
  function closeBook() {
    $("book").classList.add("hidden"); $("book").classList.remove("show");
    document.body.style.overflow = "";
    $("bookPages").textContent = "";
    bk.els = {};
  }
  $("aniOpen").addEventListener("click", openBook);
  $("bookClose").addEventListener("click", closeBook);
  $("bookNext").addEventListener("click", next);
  $("bookPrev").addEventListener("click", prev);
  $("bookRange").addEventListener("input", function () { jump(Number($("bookRange").value)); });
  $("bookRange").addEventListener("change", rustle);
  document.addEventListener("keydown", function (ev) {
    if ($("book").classList.contains("hidden")) return;
    if (ev.key === "Escape") closeBook();
    if (ev.key === "ArrowRight") next();
    if (ev.key === "ArrowLeft") prev();
  });
  // Parmakla çevirme: sayfa parmağı izler; yarıdan fazla çevrilince kendiliğinden tamamlanır
  var drag = null;
  $("stage").addEventListener("pointerdown", function (ev) {
    if (bk.busy || ev.target.closest("button")) return;
    drag = { x: ev.clientX, t: Date.now(), w: $("bookPages").offsetWidth, leaf: null, mode: null, deg: 0 };
    try { $("stage").setPointerCapture(ev.pointerId); } catch (e) {}
  });
  $("stage").addEventListener("pointermove", function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x;
    if (!drag.mode) {
      if (Math.abs(dx) < 8) return;
      if (dx < 0 && bk.cur < bk.pages.length - 1) drag.mode = "next";
      else if (dx > 0 && bk.cur > 0) drag.mode = "prev";
      else return;
      drag.leaf = leafAt(drag.mode === "next" ? bk.cur : bk.cur - 1);
      drag.leaf.style.transition = "none";
      drag.leaf.style.visibility = "visible";
      drag.leaf.classList.add("turning");
    }
    var f = Math.max(0, Math.min(1, Math.abs(dx) / (drag.w * 1.05)));
    drag.deg = drag.mode === "next" ? (dx < 0 ? -180 * f : 0) : (dx > 0 ? -180 + 180 * f : -180);
    drag.leaf.style.transform = "rotateY(" + drag.deg + "deg)";
  });
  function endDrag(ev) {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.mode) {
      var r = $("bookPages").getBoundingClientRect(), x = (ev.clientX - r.left) / r.width;
      if (ev.type === "pointerup" && Date.now() - d.t < 500) { if (x > .55) next(); else if (x < .4) prev(); }
      return;
    }
    var fast = Date.now() - d.t < 280;
    bk.busy = true;
    if (d.mode === "next") {
      var go = d.deg < -75 || (fast && d.deg < -12);
      if (go) rustle();
      animate(d.leaf, go ? -180 : 0, function () { if (go) bk.cur++; bk.busy = false; layout(); });
    } else {
      var back = d.deg > -105 || (fast && d.deg > -168);
      if (back) rustle();
      animate(d.leaf, back ? 0 : -180, function () { if (back) bk.cur--; bk.busy = false; layout(); });
    }
  }
  $("stage").addEventListener("pointerup", endDrag);
  $("stage").addEventListener("pointercancel", endDrag);

  // Bütün bekleyen hatırlatmalar. SİL'e iki kez dokununca silinir (yanlışlıkla silinmesin).
  function renderReminders(data) {
    var box = $("reminders"), ul = el("ul", "list"), list = data.reminders || [];
    box.textContent = "";
    $("cReminders").textContent = list.length ? list.length + " hatırlatma" : "";
    if (!list.length) return empty(box, "Bekleyen hatırlatma yok. Eklemek için yaz: \"yarın 15:00'te kütüphaneye gitmeyi hatırlat\"");
    list.forEach(function (r) {
      var w = el("span", "rem");
      w.appendChild(el("span", null, (r.auto ? "📧 " : "⏰ ") + r.text));
      var b = el("button", "mini", "SİL");
      b.type = "button";
      b.addEventListener("click", function () {
        if (!b.classList.contains("warn")) { b.classList.add("warn"); b.textContent = "EMİN MİSİN?"; return; }
        b.disabled = true; b.textContent = "…";
        fetch("/panel/reminder", { method: "DELETE", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ key: r.key }) })
          .then(function (res) { if (!res.ok) throw new Error("http"); load(); })
          .catch(function () { b.disabled = false; b.classList.remove("warn"); b.textContent = "SİL"; });
      });
      w.appendChild(b);
      ul.appendChild(row(dayLabel(r.at), w, fTime.format(new Date(r.at)) + " · " + left(r.at) + (r.auto ? " · maildeki tarihten" : "")));
    });
    box.appendChild(ul);
  }
  $("addReminder").addEventListener("click", function () {
    var input = $("chatInput");
    input.placeholder = "Örnek: yarın 15:00'te kütüphaneye gitmeyi hatırlat";
    input.focus();
    input.scrollIntoView({ block: "center", behavior: "smooth" });
  });

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
    renderHomework(data); renderUpcoming(data); renderReminders(data); renderAklimda(data); renderAni(data); renderMoney(data); renderMails(data); renderMenu(data); renderPc(data); renderFiles(data);
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
  // Sohbet hep en son mesajda durur. Panel ilk açılışta gizli olduğu için (giriş ekranı) o anki kaydırma işe yaramaz;
  // kutu görünür olunca, yazı tipleri yüklenince ve içerik büyüdükçe yeniden en alta inilir.
  // Kullanıcı eski mesajları okumak için yukarı kaydırdıysa yerinden oynatılmaz.
  var stick = true;
  function toBottom() { var c = $("chatlog"); c.scrollTop = c.scrollHeight; }
  function keepBottom() { if (stick) { toBottom(); requestAnimationFrame(toBottom); } }
  $("chatlog").addEventListener("scroll", function () {
    var c = $("chatlog");
    if (c.clientHeight) stick = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
  }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(keepBottom).observe($("chatlog"));
  if (window.MutationObserver) new MutationObserver(keepBottom).observe($("chatlog"), { childList: true, subtree: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(keepBottom);
  function bubble(who, html, cls) {
    var m = el("div", "msg " + who + (cls ? " " + cls : ""));
    if (who === "bot") m.appendChild(rich(html)); else m.textContent = html;
    $("chatlog").appendChild(m);
    if (who === "me") stick = true;   // yeni soru sorunca her zaman en alta
    keepBottom();
    return m;
  }
  function remember(who, text) {
    history.push({ w: who, t: text });
    history = history.slice(-40);
    try { localStorage.setItem(CHAT, JSON.stringify(history)); } catch (e) {}
  }
  function drawChat() {
    stick = true;
    $("chatlog").textContent = "";
    history.forEach(function (h) { bubble(h.w, h.t); });
    if (!history.length) bubble("bot", "Merhaba efendim. Ne yapmamı istersin? Örnek: <i>bu hafta beni ne bekliyor?</i>, <i>kahveye 80 TL verdim</i>, <i>bilgisayarı kilitle</i>");
  }
  drawChat();
  // Ortak geçmiş: telefondaki ve bilgisayardaki panel aynı konuşmayı görür. Cevap beklenirken dokunulmaz.
  var pending = 0;
  function syncChat() {
    if (!key || pending) return;
    fetch("/panel/chat", { headers: { Authorization: "Bearer " + key }, cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (r) {
        if (!r || !Array.isArray(r.log) || pending) return;
        var log = r.log.filter(function (h) { return h && (h.w === "me" || h.w === "bot") && typeof h.t === "string"; }).map(function (h) { return { w: h.w, t: h.t }; });
        if (JSON.stringify(log) === JSON.stringify(history)) return;
        history = log.slice(-40);
        try { localStorage.setItem(CHAT, JSON.stringify(history)); } catch (e) {}
        drawChat();
      })
      .catch(function () {});
  }

  // ---------- sesli komut: kayıt tarayıcıda WAV'a (16 kHz, tek kanal) çevrilir, Jarvis yazıya çevirip cevaplar ----------
  var rec = null, recStart = 0, toggleMode = false, MAX_REC_MS = 60000;
  function micState(t) { $("micState").textContent = t || ""; }
  function wav(chunks, rate) {
    var n = 0, i, j;
    for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    var all = new Float32Array(n), at = 0;
    for (i = 0; i < chunks.length; i++) { all.set(chunks[i], at); at += chunks[i].length; }
    var ratio = rate / 16000, len = Math.floor(n / ratio), pcm = new Int16Array(len);
    for (i = 0; i < len; i++) {
      var from = Math.floor(i * ratio), to = Math.min(n, Math.floor((i + 1) * ratio)), sum = 0, c = 0;
      for (j = from; j < to; j++) { sum += all[j]; c++; }
      var v = Math.max(-1, Math.min(1, c ? sum / c : 0));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    var buf = new ArrayBuffer(44 + pcm.length * 2), d = new DataView(buf);
    function str(o, t) { for (var k = 0; k < t.length; k++) d.setUint8(o + k, t.charCodeAt(k)); }
    str(0, "RIFF"); d.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, 16000, true);
    d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, pcm.length * 2, true);
    for (i = 0; i < pcm.length; i++) d.setInt16(44 + i * 2, pcm[i], true);
    return new Blob([buf], { type: "audio/wav" });
  }
  function startRec() {
    if (rec) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AC) { micState("Bu tarayıcı mikrofonu desteklemiyor."); return; }
    var ac = new AC();   // dokunuşun içinde açılmalı (iPhone)
    rec = { ac: ac, chunks: [], stream: null, node: null, src: null, timer: null };
    recStart = Date.now();
    $("mic").classList.add("rec");
    micState("Dinliyorum… Bırakınca gönderirim.");
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      if (!rec) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      rec.stream = stream;
      rec.src = ac.createMediaStreamSource(stream);
      rec.node = ac.createScriptProcessor(4096, 1, 1);
      rec.node.onaudioprocess = function (e) { if (rec) rec.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      rec.src.connect(rec.node); rec.node.connect(ac.destination);
      if (ac.resume) ac.resume();
      rec.timer = setTimeout(function () { stopRec(true); }, MAX_REC_MS);
    }).catch(function () {
      cleanup();
      micState("Mikrofon izni yok. iPhone'da Ayarlar > Safari > Mikrofon'dan izin ver, sonra yeniden dene.");
    });
  }
  function cleanup() {
    var r = rec;
    rec = null; toggleMode = false;
    $("mic").classList.remove("rec");
    if (!r) return null;
    clearTimeout(r.timer);
    try { if (r.node) { r.node.disconnect(); r.node.onaudioprocess = null; } if (r.src) r.src.disconnect(); } catch (e) {}
    if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); });
    var rate = r.ac.sampleRate;
    try { r.ac.close(); } catch (e) {}
    return { chunks: r.chunks, rate: rate };
  }
  function stopRec(send) {
    var took = Date.now() - recStart, r = cleanup();
    if (!r || !send) { micState(""); return; }
    if (took < 600 || !r.chunks.length) { micState("Çok kısa oldu. Basılı tutup konuş."); return; }
    micState("");
    var mine = bubble("me", "🎙 …"), waiting = bubble("bot", "Dinledim, düşünüyorum…", "wait");
    $("mic").disabled = true;
    pending++;
    fetch("/panel/voice", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "audio/wav" }, body: wav(r.chunks, r.rate) })
      .then(function (res) { if (res.status === 401) throw new Error("yetki"); return res.json(); })
      .then(function (res) {
        waiting.remove();
        if (res.text) { mine.textContent = "🎙 " + res.text; remember("me", "🎙 " + res.text); } else mine.remove();
        (res.replies && res.replies.length ? res.replies : [res.error || "Tamam."]).forEach(function (h) { bubble("bot", h); remember("bot", h); });
      })
      .catch(function (err) {
        waiting.remove(); mine.remove();
        if (err.message === "yetki") return gate("Giriş süren dolmuş. Telegram'da /panel yazıp gelen kodu gir.");
        bubble("bot", "Jarvis'e ulaşılamadı, biraz sonra yeniden dener misin?");
      })
      .then(function () { $("mic").disabled = false; pending--; });
  }
  // Basılı tut: bırakınca gönderir. Kısa dokunuş: kayıt açık kalır, yeniden dokununca gönderir.
  $("mic").addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    if (rec && toggleMode) { stopRec(true); return; }
    startRec();
  });
  $("mic").addEventListener("pointerup", function (ev) {
    ev.preventDefault();
    if (!rec || toggleMode) return;
    if (Date.now() - recStart < 350) { toggleMode = true; micState("Dinliyorum… Bitince 🎙'a yeniden dokun."); return; }
    stopRec(true);
  });
  $("mic").addEventListener("pointercancel", function () { if (rec && !toggleMode) stopRec(false); });
  $("mic").addEventListener("contextmenu", function (ev) { ev.preventDefault(); });

  function ask(payload, waitText) {
    var waiting = bubble("bot", waitText || "Düşünüyorum…", "wait");
    pending++;
    return fetch("/panel/chat", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { if (r.status === 401) throw new Error("yetki"); return r.json(); })
      .then(function (r) {
        waiting.remove();
        (r.replies && r.replies.length ? r.replies : ["Tamam."]).forEach(function (h) { bubble("bot", h); remember("bot", h); });
      })
      .catch(function (err) {
        waiting.remove();
        if (err.message === "yetki") return gate("Giriş süren dolmuş. Telegram'da /panel yazıp gelen kodu gir.");
        bubble("bot", "Jarvis'e ulaşılamadı, biraz sonra yeniden dener misin?");
      })
      .then(function () { pending--; });
  }
  $("chatForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("chatInput"), text = input.value.trim();
    if (!text) return;
    input.value = "";
    bubble("me", text); remember("me", text);
    ask({ text: text });
  });
  // 🚌: o anki konumla en yakın durağa gelen otobüsler. Konum yalnızca bu soru için gönderilir.
  // 🚌 yalnız otobüs, 🚋 yalnız tramvay. Konum yalnızca o soru için gönderilir, saklanmaz.
  function nearby(id, only, label, wait) {
    var b = $(id);
    if (!navigator.geolocation) { micState("Bu tarayıcı konumu desteklemiyor."); return; }
    b.disabled = true;
    micState("Konumunu alıyorum…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      micState(""); b.disabled = false;
      bubble("me", label); remember("me", label);
      ask({ location: { lat: pos.coords.latitude, lon: pos.coords.longitude }, only: only }, wait);
    }, function (err) {
      b.disabled = false;
      micState(err && err.code === 1
        ? "Konum izni yok. iPhone'da Ayarlar > Gizlilik > Konum Servisleri > Safari Web Siteleri'nden izin ver, sonra yeniden dene."
        : "Konumunu alamadım. Biraz sonra yeniden dener misin?");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  $("bus").addEventListener("click", function () { nearby("bus", "bus", "🚌 Yakınımdaki otobüsler", "En yakın durağa bakıyorum…"); });
  $("tram").addEventListener("click", function () { nearby("tram", "tram", "🚋 Yakınımdaki tramvay", "En yakın tramvay durağına bakıyorum…"); });

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
        syncChat();
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

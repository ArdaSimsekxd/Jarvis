// Jarvis paneli: Jarvis'in bildiği her şeyi tek ekranda gösteren, Iron Man tarzı sayfa.
// Sayfanın kendisi veri içermez; veriler yalnızca gizli anahtarla (/panel komutunun verdiği bağlantı) okunur.
import { MAIL_KEY, WEEKDAYS, dateKey, esc, isMissing, isSubmitted, plain, trParts, trToMs } from "./logic.js";
import { CATEGORIES, loadBudget, loadMonth, monthKey } from "./expenses.js";
import { loadMemory } from "./memory.js";
import { loadState, wantedSlots } from "./fitness.js";
import { PANEL_HTML } from "./panel_page.js";
import { ICON_180, ICON_512 } from "./app_icons.js";

export const PANEL_KEY = "panel:key";
const DAY = 24 * 60 * 60 * 1000;
const CANVAS_TTL = 10 * 60;       // Canvas'tan okunan ödevler 10 dakika saklanır (her açılışta 10+ istek olmasın)
const DATA_TTL = 3 * 60;          // geri kalan veriler 3 dakika (KV list sınırı: günde 1.000)
const HOMEWORK_DAYS = 14;
const PC_ACTIONS = new Set(["durum", "kilitle", "uyku", "ekran", "medya", "ses"]);   // panelden kapatma yok

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- veriyi panel için sadeleştiren saf fonksiyonlar (test edilir) ----------

export function lessonsFor(schedule, dayMs, names = {}) {
  return (schedule?.[trParts(dayMs).wd] ?? []).map((x) => {
    const [sh, sm] = x.start.split(":").map(Number);
    const [eh, em] = x.end.split(":").map(Number);
    const p = trParts(dayMs);
    return {
      start: x.start, end: x.end, code: x.code, name: names?.[x.code] ?? "", room: x.room ?? "",
      startMs: trToMs(p.y, p.m, p.d, sh, sm), endMs: trToMs(p.y, p.m, p.d, eh, em),
    };
  });
}

// Bugünün dersleri; bugün ders kalmadıysa sıradaki dersli gün de verilir.
export function lessonDays(schedule, nowMs, names = {}) {
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  const todayList = lessonsFor(schedule, today, names);
  let next = null;
  if (!todayList.some((x) => x.endMs > nowMs)) {
    for (let i = 1; i <= 7 && !next; i += 1) {
      const list = lessonsFor(schedule, today + i * DAY, names);
      if (list.length) next = { day: today + i * DAY, label: i === 1 ? "Yarın" : WEEKDAYS[trParts(today + i * DAY).wd], lessons: list };
    }
  }
  return { today: todayList, next };
}

export function homeworkItems(courses, assignmentsByCourse, nowMs) {
  const out = [];
  for (const c of courses ?? []) {
    for (const a of assignmentsByCourse.get(c.id) ?? []) {
      if (!a?.due_at || a.published === false || isSubmitted(a)) continue;
      const due = Date.parse(a.due_at);
      if (Number.isNaN(due)) continue;
      const overdue = due < nowMs;
      if (overdue ? nowMs - due > HOMEWORK_DAYS * DAY || !isMissing(a) : due - nowMs > 30 * DAY) continue;
      out.push({
        due, overdue, course: c.course_code || c.name || "", name: String(a.name ?? "").slice(0, 120),
        url: /^https:\/\//.test(a.html_url ?? "") ? a.html_url : "",
      });
    }
  }
  return out.sort((x, y) => x.due - y.due).slice(0, 12);
}

export function upcomingItems({ notes = [], reminders = [], fitness = [] }, nowMs) {
  const today = dateKey(nowMs);
  const items = [];
  for (const n of notes) {
    if (n.kind !== "tarih" || !n.day || n.day < today) continue;
    const [y, m, d] = n.day.split("-").map(Number);
    items.push({ kind: "tarih", at: trToMs(y, m, d, 12, 0), allDay: true, text: String(n.text ?? "").replace(/\. Kaynak: [\s\S]*$/, "").slice(0, 160) });
  }
  for (const r of reminders) {
    if (r.at >= nowMs && !r.ev) items.push({ kind: "hatirlatma", at: r.at, text: String(r.text ?? "").slice(0, 160) });
  }
  for (const s of fitness) items.push({ kind: "fitness", at: s.startMs, text: `Fitness ${s.start}–${s.end}` });
  return items.sort((a, b) => a.at - b.at).slice(0, 10);
}

export function expenseSummary(month, budget, nowMs) {
  const spent = month.items.reduce((sum, it) => sum + it.amount, 0);
  const byCat = {};
  for (const it of month.items) byCat[it.cat] = (byCat[it.cat] ?? 0) + it.amount;
  const p = trParts(nowMs);
  const daysInMonth = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  const daysLeft = daysInMonth - p.d + 1;
  return {
    spent, budget,
    left: budget ? budget - spent : null,
    perDay: budget && budget > spent ? Math.floor((budget - spent) / daysLeft) : null,
    categories: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([cat, amount]) => ({ label: CATEGORIES[cat] ?? CATEGORIES.diger, amount })),
    last: month.items.slice().sort((a, b) => b.at - a.at).slice(0, 3)
      .map((it) => ({ at: it.at, amount: it.amount, what: String(it.what ?? "").slice(0, 60), label: CATEGORIES[it.cat] ?? CATEGORIES.diger })),
  };
}

export function mailList(mails) {
  return (Array.isArray(mails) ? mails : []).filter((m) => m && typeof m === "object").slice(-5).reverse()
    .map((m) => ({ from: String(m.from ?? "").slice(0, 60), subject: String(m.subject ?? "").slice(0, 120), at: Number(m.at) || null }));
}

export function menuItems(menu, dayMs) {
  const entry = menu?.days?.[dateKey(dayMs)];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry.map(String).slice(0, 8);
  const out = [];
  for (const [name, value] of Object.entries(entry)) {
    if (Array.isArray(value)) out.push(...value.map((v) => `${name}: ${v}`));
    else if (typeof value === "string" && value) out.push(`${name}: ${value}`);
  }
  return out.slice(0, 8);
}

export function greeting(nowMs) {
  const h = trParts(nowMs).hh;
  if (h >= 5 && h < 12) return "Günaydın efendim";
  if (h >= 12 && h < 18) return "İyi günler efendim";
  if (h >= 18 && h < 23) return "İyi akşamlar efendim";
  return "İyi geceler efendim";
}

// ---------- veriyi toplama ----------

async function cached(ctx, name, ttl, make) {
  const hit = await ctx.cache?.get(name).catch(() => null);
  if (hit) return hit;
  const value = await make();
  if (value !== undefined) await ctx.cache?.put(name, value, ttl).catch(() => {});
  return value;
}

async function readJson(kv, key) {
  try {
    return JSON.parse(await kv.get(key));
  } catch {
    return null;
  }
}

// src: index.js'teki veri kaynakları { canvas, reminders, names, menu }
export async function buildPanel(ctx, src) {
  const now = ctx.now;
  const canvasPart = ctx.canvas
    ? cached(ctx, "canvas", CANVAS_TTL, async () => {
      try {
        const { courses, assignments } = await src.canvas();
        return { ok: true, homework: homeworkItems(courses, assignments, now) };
      } catch (err) {
        console.error("panel: canvas okunamadı", err?.message);
        return undefined;   // saklama, bir dahakine yeniden dene
      }
    }).then((v) => v ?? { ok: false, homework: [] })
    : Promise.resolve({ ok: false, homework: [] });

  const dataPart = cached(ctx, "data", DATA_TTL, async () => {
    const [mem, reminders, fit, month, budget, mails, names, menu] = await Promise.all([
      loadMemory(ctx.kv), src.reminders().catch(() => []), loadState(ctx.kv), loadMonth(ctx.kv, monthKey(now)),
      loadBudget(ctx.kv), readJson(ctx.kv, MAIL_KEY), src.names().catch(() => ({})), src.menu().catch(() => null),
    ]);
    const fitness = wantedSlots(fit.rules, now).filter((s) => fit.slots[s.key]?.ref);
    const p = trParts(now);
    return {
      lessons: lessonDays(ctx.schedule, now, names),
      upcoming: upcomingItems({ notes: mem.notes, reminders, fitness }, now),
      expenses: expenseSummary(month, budget, now),
      mails: mailList(mails?.mails),
      menu: menuItems(menu, trToMs(p.y, p.m, p.d)),
      notes: mem.notes.length,
    };
  });

  const pcPart = ctx.pc ? ctx.pc.call("status").catch(() => null) : Promise.resolve(null);
  const [canvas, data, pc] = await Promise.all([canvasPart, dataPart, pcPart]);
  return {
    now, greeting: greeting(now),
    homework: canvas.homework, canvas: canvas.ok,
    ...data,
    pc: pc ? { paired: Boolean(pc.paired), online: Boolean(pc.online) } : null,
  };
}

// ---------- bağlantı ve istekler ----------

export async function panelKey(kv, { renew = false } = {}) {
  let key = renew ? null : await kv.get(PANEL_KEY);
  if (!key) {
    key = newKey();
    await kv.put(PANEL_KEY, key);
  }
  return key;
}

// "/panel" komutu
export async function cmdPanel(args, ctx) {
  if (!ctx.origin) return "Paneli şu an hazırlayamadım, biraz sonra yeniden dener misin?";
  const renew = ["yenile", "degistir", "sifirla"].includes(plain(args));
  const key = await panelKey(ctx.kv, { renew });
  if (renew && ctx.pc) await ctx.pc.call("pushclear").catch(() => {});   // eski cihazlara bildirim gitmesin
  const link = `${ctx.origin}/panel#${key}`;
  const login = ctx.pc ? await ctx.pc.call("lcode").catch(() => null) : null;
  return [
    renew ? "🛡 Panel bağlantısını yeniledim. Eski bağlantı ve uygulamadaki eski girişler artık açılmaz." : "🛡 <b>Jarvis paneli</b>",
    `<a href="${esc(link)}">Paneli aç</a>`,
    "",
    "📱 <b>iPhone'a uygulama olarak kurmak için:</b>",
    "1. Bağlantıyı <b>Safari</b>'de aç (Telegram'ın içinde açılırsa sağ üstten \"Safari'de aç\").",
    "2. Alttaki paylaş düğmesine (kare ve yukarı ok) dokun, <b>Ana Ekrana Ekle</b>'yi seç.",
    "3. Ana ekrandaki Jarvis simgesini aç." + (login ? ` Kod sorarsa: <code>${login.code}</code> (15 dakika geçerli)` : ""),
    "",
    "Bu bağlantı sana özel, kimseyle paylaşma. Paylaştıysan: <code>/panel yenile</code>",
  ].join("\n");
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
});

async function authorized(request, kv) {
  const key = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  const real = await kv.get(PANEL_KEY);
  return Boolean(key && real && key === real);
}

// /panel, /panel/api ve /panel/pc isteklerini karşılar. Bu yollardan biri değilse null.
const MANIFEST = JSON.stringify({
  name: "Jarvis", short_name: "Jarvis", id: "/panel", start_url: "/panel", scope: "/panel", display: "standalone",
  background_color: "#03070d", theme_color: "#03070d", lang: "tr",
  icons: [
    { src: "/panel/icon-180.png", sizes: "180x180", type: "image/png" },
    { src: "/panel/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
});

// Bildirimleri gösteren servis çalışanı (service worker). Uygulama kapalıyken de çalışır.
export const SERVICE_WORKER = `self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Jarvis", {
    body: d.body || "", icon: "/panel/icon-180.png", badge: "/panel/icon-180.png", data: { url: d.url || "/panel" },
  }).then(function () {
    return self.clients.matchAll({ type: "window" }).then(function (list) {
      list.forEach(function (c) { c.postMessage({ tip: "yenile" }); });
    });
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "/panel");
  }));
});
`;

function png(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}

// Bot cevapları Telegram'ın HTML'iyle yazılır; bildirimde düz yazı gerekir.
export function plainText(html) {
  return String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function handlePanel(request, ctx, src) {
  const path = new URL(request.url).pathname;
  if (path === "/panel/manifest.webmanifest") {
    return new Response(MANIFEST, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } });
  }
  if (path === "/panel/sw.js") {
    return new Response(SERVICE_WORKER, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/panel" },
    });
  }
  if (path === "/panel/icon-180.png") return png(ICON_180);
  if (path === "/panel/icon-512.png") return png(ICON_512);
  if (path === "/panel/login" && request.method === "POST") {
    if (!ctx.pc) return json({ error: "Giriş kodu bu kurulumda yok." }, 400);
    const body = await request.json().catch(() => ({}));
    const r = await ctx.pc.call("lcheck", { code: String(body.code ?? "").slice(0, 20) });
    if (!r.ok) return json({ error: r.expired ? "Kodun süresi dolmuş. Telegram'da /panel yazıp yeni kodu gir." : "Kod yanlış. Telegram'da /panel yazınca gelen kodu gir." }, 403);
    return json({ key: await panelKey(ctx.kv) });
  }
  if ((path === "/panel" || path === "/panel/") && request.method === "GET") {
    return new Response(PANEL_HTML, {
      headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex",
        "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      },
    });
  }
  if (path === "/panel/api" && request.method === "GET") {
    if (!(await authorized(request, ctx.kv))) return json({ error: "yetkisiz" }, 401);
    return json(await buildPanel(ctx, src));
  }
  if (path === "/panel/chat" && request.method === "POST") {
    if (!(await authorized(request, ctx.kv))) return json({ error: "yetkisiz" }, 401);
    const body = await request.json().catch(() => ({}));
    const text = String(body.text ?? "").trim().slice(0, 1000);
    if (!text) return json({ replies: [] });
    try {
      return json({ replies: await src.chat(text) });
    } catch (err) {
      console.error("uygulama sohbeti cevaplanamadı", err?.message);
      return json({ replies: ["Şu an cevap veremedim, biraz sonra yeniden dener misin?"] });
    }
  }
  if (path === "/panel/push" && (request.method === "POST" || request.method === "DELETE")) {
    if (!(await authorized(request, ctx.kv))) return json({ error: "yetkisiz" }, 401);
    if (!ctx.pc) return json({ error: "Bildirimler bu kurulumda yok." }, 400);
    const body = await request.json().catch(() => ({}));
    if (request.method === "DELETE") return json(await ctx.pc.call("pushunsub", { endpoint: String(body.endpoint ?? "") }));
    const r = await ctx.pc.call("pushsub", { sub: body.sub });
    if (r.ok) await ctx.pc.call("push", { title: "Jarvis", body: "Bildirimler açık. Hatırlatmalar ve önemli haberler buraya da gelecek." }).catch(() => {});
    return json(r, r.ok ? 200 : 400);
  }
  if (path === "/panel/push-key" && request.method === "GET") {
    if (!(await authorized(request, ctx.kv))) return json({ error: "yetkisiz" }, 401);
    if (!ctx.pc) return json({ error: "Bildirimler bu kurulumda yok." }, 400);
    return json(await ctx.pc.call("vapid"));
  }
  if (path === "/panel/pc" && request.method === "POST") {
    if (!(await authorized(request, ctx.kv))) return json({ error: "yetkisiz" }, 401);
    if (!ctx.pc) return json({ text: "Bilgisayar bağlantısı kurulu değil." });
    const body = await request.json().catch(() => ({}));
    const is = String(body.is ?? "");
    if (!PC_ACTIONS.has(is)) return json({ error: "Bu iş panelden yapılamaz." }, 400);
    const r = await ctx.pc.call("send", { is, arg: String(body.arg ?? "").slice(0, 20) });
    const text = !r.paired ? "Bilgisayar bağlı değil. Telegram'da /pc bağla yaz."
      : !r.online ? "Bilgisayar şu an bağlı değil."
        : r.timeout ? "İletildi, cevap bekleniyor."
          : r.reply || (is === "ekran" ? "Ekran görüntüsü Telegram'a gönderildi." : "Tamam.");
    return json({ text });
  }
  return null;
}


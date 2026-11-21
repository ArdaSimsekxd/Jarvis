// Jarvis paneli: Jarvis'in bildiği her şeyi tek ekranda gösteren, Iron Man tarzı sayfa.
// Sayfanın kendisi veri içermez; veriler yalnızca gizli anahtarla (/panel komutunun verdiği bağlantı) okunur.
import { MAIL_KEY, WEEKDAYS, dateKey, esc, isMissing, isSubmitted, plain, trParts, trToMs } from "./logic.js";
import { CATEGORIES, loadBudget, loadMonth, monthKey } from "./expenses.js";
import { loadMemory } from "./memory.js";
import { loadState, wantedSlots } from "./fitness.js";
import { PANEL_HTML } from "./panel_page.js";

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
  const link = `${ctx.origin}/panel#${key}`;
  return [
    renew ? "🛡 Panel bağlantısını yeniledim. Eski bağlantı artık açılmaz." : "🛡 <b>Jarvis paneli</b>",
    `<a href="${esc(link)}">Paneli aç</a>`,
    "",
    "Telefonda açınca tarayıcının menüsünden <b>Ana ekrana ekle</b> dersen uygulama gibi açılır.",
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
export async function handlePanel(request, ctx, src) {
  const path = new URL(request.url).pathname;
  if (path === "/panel" && request.method === "GET") {
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


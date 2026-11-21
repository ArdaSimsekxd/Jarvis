import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PANEL_KEY, buildPanel, cmdPanel, expenseSummary, greeting, handlePanel, homeworkItems, lessonDays, mailList, menuItems, upcomingItems,
} from "../src/panel.js";
import { PANEL_HTML } from "../src/panel_page.js";
import { parseSchedule, trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 22, 1, 40);   // Pazar gecesi
const H = 3600e3;

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return {
    values,
    async get(k) { return values.get(k) ?? null; },
    async put(k, v) { values.set(k, v); },
  };
}

const schedule = parseSchedule("Pazartesi 10:00-11:45 EE452 F0C04\nPazartesi 13:00-14:45 EE301\nPazar 00:30-01:00 GEC");

test("dersler: bugün bittiyse sıradaki dersli gün gelir", () => {
  const d = lessonDays(schedule, NOW, { EE452: "Digital" });
  assert.equal(d.today.length, 1);
  assert.equal(d.next.label, "Yarın");
  assert.deepEqual(d.next.lessons.map((x) => [x.start, x.name, x.code, x.room]), [["10:00", "Digital", "EE452", "F0C04"], ["13:00", "", "EE301", ""]]);
  assert.equal(lessonDays(schedule, trToMs(2026, 11, 23, 9, 0)).next, null, "pazartesi sabahı: bugünün dersleri yeter");
});

test("ödevler: teslim edilenler gizlenir, gecikenler işaretlenir", () => {
  const courses = [{ id: 1, course_code: "EE452" }];
  const list = [
    { name: "Geç", due_at: new Date(NOW - 5 * H).toISOString(), submission: { missing: true }, html_url: "https://c/1" },
    { name: "Yakın", due_at: new Date(NOW + 5 * H).toISOString(), submission: {}, html_url: "javascript:alert(1)" },
    { name: "Teslim", due_at: new Date(NOW + 5 * H).toISOString(), submission: { submitted_at: "x" } },
    { name: "Çok ileri", due_at: new Date(NOW + 40 * 24 * H).toISOString(), submission: {} },
  ];
  const items = homeworkItems(courses, new Map([[1, list]]), NOW);
  assert.deepEqual(items.map((i) => [i.name, i.overdue, i.url]), [["Geç", true, "https://c/1"], ["Yakın", false, ""]]);
});

test("yaklaşanlar: tarih notları, hatırlatmalar ve fitness birlikte sıralanır", () => {
  const items = upcomingItems({
    notes: [{ kind: "tarih", day: "2026-11-24", text: "Staj başvurusu: Salı 24.11. Kaynak: mail" }, { kind: "tarih", day: "2026-11-01", text: "eski" }, { kind: "not", text: "x" }],
    reminders: [{ at: NOW + H, text: "Hocaya mail at" }, { at: NOW + 2 * H, text: "📅 Staj (1 gün önce)", ev: 5 }, { at: NOW - H, text: "geçmiş" }],
    fitness: [{ startMs: NOW + 30 * H, start: "13:00", end: "14:30" }],
  }, NOW);
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [
    ["hatirlatma", "Hocaya mail at"], ["fitness", "Fitness 13:00–14:30"], ["tarih", "Staj başvurusu: Salı 24.11"],
  ]);
});

test("harcama, mail ve menü özetleri", () => {
  const month = { items: [{ at: NOW - H, amount: 12000, cat: "kafe", what: "kahve" }, { at: NOW - 2 * H, amount: 30000, cat: "yemek" }] };
  const e = expenseSummary(month, 600000, NOW);
  assert.equal(e.spent, 42000);
  assert.equal(e.left, 558000);
  assert.equal(e.perDay, Math.floor(558000 / 9), "22 Kasım dahil 9 gün kaldı");
  assert.deepEqual(e.categories.map((c) => c.label), ["🍽 Yemek", "☕ Kafe"]);
  assert.equal(expenseSummary({ items: [] }, null, NOW).perDay, null);

  const mails = mailList([{ from: "A", subject: "eski", at: 1 }, { from: "B", subject: "yeni", at: 2, text: "gizli içerik" }]);
  assert.deepEqual(mails, [{ from: "B", subject: "yeni", at: 2 }, { from: "A", subject: "eski", at: 1 }], "mail metni panele gitmez");

  assert.deepEqual(menuItems({ days: { "2026-11-22": { "Çorba": "Mercimek", "Öğle": ["Pilav"], Kalori: 900 } } }, NOW), ["Çorba: Mercimek", "Öğle: Pilav"]);
  assert.deepEqual(menuItems(null, NOW), []);
  assert.equal(greeting(NOW), "İyi geceler efendim");
  assert.equal(greeting(trToMs(2026, 11, 22, 9, 0)), "Günaydın efendim");
});

test("/panel kişiye özel bağlantı verir, yenileyince eskisi geçersiz olur", async () => {
  const kv = fakeKv();
  const ctx = { kv, origin: "https://jarvis.x.workers.dev" };
  const first = await cmdPanel("", ctx);
  const key = kv.values.get(PANEL_KEY);
  assert.match(key, /^[\w-]{30,}$/);
  assert.ok(first.includes(`https://jarvis.x.workers.dev/panel#${key}`));
  await cmdPanel("", ctx);
  assert.equal(kv.values.get(PANEL_KEY), key, "aynı bağlantı");
  await cmdPanel("yenile", ctx);
  assert.notEqual(kv.values.get(PANEL_KEY), key);
});

const req = (path, { method = "GET", key, body } = {}) => new Request(`https://jarvis.x.workers.dev${path}`, {
  method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

function panelCtx() {
  const store = new Map();
  const sent = [];
  return {
    sent, store,
    ctx: {
      now: NOW, kv: fakeKv({ [PANEL_KEY]: "dogru-anahtar", "mail:recent": JSON.stringify({ mails: [{ from: "B", subject: "S", at: 1 }] }) }),
      schedule, canvas: () => {},
      cache: { get: async (n) => store.get(n) ?? null, put: async (n, v) => { store.set(n, v); } },
      pc: { call: async (op, body) => { sent.push([op, body]); return op === "status" ? { paired: true, online: true } : { paired: true, online: true, reply: "🔒 Kilitlendi" }; } },
    },
  };
}

const SRC = {
  canvas: async () => ({ courses: [{ id: 1, course_code: "EE452" }], assignments: new Map([[1, [{ name: "Ödev", due_at: new Date(NOW + H).toISOString(), submission: {} }]]]) }),
  reminders: async () => [{ at: NOW + H, text: "Not" }],
  names: async () => ({}),
  menu: async () => null,
};

test("panel sayfası boş gelir, veriler anahtarsız okunamaz", async () => {
  const { ctx } = panelCtx();
  const page = await handlePanel(req("/panel"), ctx, SRC);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(await page.text(), PANEL_HTML);
  assert.doesNotMatch(PANEL_HTML, /innerHTML/, "dışarıdan gelen yazı HTML olarak basılmaz");

  assert.equal((await handlePanel(req("/panel/api"), ctx, SRC)).status, 401);
  assert.equal((await handlePanel(req("/panel/api", { key: "yanlis" }), ctx, SRC)).status, 401);
  assert.equal(await handlePanel(req("/baska"), ctx, SRC), null);
});

test("panel verisi toplanır ve kısa süre saklanır", async () => {
  const { ctx, store } = panelCtx();
  let canvasCalls = 0;
  const src = { ...SRC, canvas: async () => { canvasCalls += 1; return SRC.canvas(); } };
  const res = await handlePanel(req("/panel/api", { key: "dogru-anahtar" }), ctx, src);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const data = await res.json();
  assert.equal(data.greeting, "İyi geceler efendim");
  assert.deepEqual(data.homework.map((h) => h.name), ["Ödev"]);
  assert.equal(data.canvas, true);
  assert.deepEqual(data.upcoming.map((u) => u.text), ["Not"]);
  assert.deepEqual(data.mails, [{ from: "B", subject: "S", at: 1 }]);
  assert.deepEqual(data.pc, { paired: true, online: true });
  assert.ok(store.has("canvas") && store.has("data"));

  await buildPanel(ctx, src);
  assert.equal(canvasCalls, 1, "ikinci açılışta Canvas'a yeniden gidilmez");
});

test("panelden yalnızca güvenli bilgisayar işleri yapılır", async () => {
  const { ctx, sent } = panelCtx();
  const ok = await handlePanel(req("/panel/pc", { method: "POST", key: "dogru-anahtar", body: { is: "kilitle" } }), ctx, SRC);
  assert.deepEqual(await ok.json(), { text: "🔒 Kilitlendi" });
  assert.deepEqual(sent.at(-1), ["send", { is: "kilitle", arg: "" }]);

  const off = await handlePanel(req("/panel/pc", { method: "POST", key: "dogru-anahtar", body: { is: "kapat" } }), ctx, SRC);
  assert.equal(off.status, 400);
  const anon = await handlePanel(req("/panel/pc", { method: "POST", body: { is: "kilitle" } }), ctx, SRC);
  assert.equal(anon.status, 401);
  assert.equal(sent.length, 1);
});

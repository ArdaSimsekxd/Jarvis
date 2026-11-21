import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEEN_KEY, announcementItems, cmdTarihler, htmlText, isDuplicate, isScanTime, mailItems, parseEvents, reminderTimes, scanDates,
} from "../src/dates.js";
import { MEMORY_KEY, cmdHafiza, loadMemory } from "../src/memory.js";
import { MAIL_KEY, trParts, trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 21, 16, 4);   // Cumartesi 21.11.2026 16:04 (tarama dakikası)

function fakeKv() {
  const store = new Map();
  const values = new Map();
  return {
    store, values,
    async put(key, value, opts) { store.set(key, opts?.metadata); values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { store.delete(key); values.delete(key); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name) }));
      return { keys, list_complete: true };
    },
  };
}

function fakeCtx(answers = [], { stream = [] } = {}) {
  const kv = fakeKv();
  const sent = [], asked = [], reminders = [];
  return {
    now: NOW, kv, sent, asked, wait: async () => {},
    send: async (t) => { sent.push(t); return true; },
    canvas: async () => stream,
    ai: {
      chat: async (messages, options = {}) => {
        asked.push({ messages, options });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    reminders: {
      list: reminders,
      add: async (at, text, ev) => { reminders.push({ at, text, ev }); },
      room: async () => 100 - reminders.length,
    },
    dropReminders: async (id) => {
      const before = reminders.length;
      for (let i = reminders.length - 1; i >= 0; i -= 1) if (reminders[i].ev === id) reminders.splice(i, 1);
      return before - reminders.length;
    },
  };
}

const hhmm = (ms) => { const p = trParts(ms); return `${p.d}.${p.m} ${p.hh}:${String(p.mm).padStart(2, "0")}`; };

test("tarama 10 dakikada bir, gece hiç çalışmaz", () => {
  assert.equal(isScanTime(NOW), true);
  assert.equal(isScanTime(NOW + 2 * 60000), false);
  assert.equal(isScanTime(trToMs(2026, 11, 22, 3, 4)), false);
});

test("model cevabı doğrulanır: geçmiş, bozuk ve çok uzak tarihler atılır", () => {
  const raw = JSON.stringify({ olaylar: [
    { ne: "EE452 ara sınavı", tarih: "2026-11-27", saat: "10:30" },
    { ne: "Geçmiş toplantı", tarih: "2026-11-20", saat: "" },
    { ne: "Bozuk", tarih: "2026-02-31", saat: "" },
    { ne: "Çok uzak", tarih: "2028-01-01", saat: "" },
    { ne: "Erasmus başvurusu son gün", tarih: "2026-12-05", saat: "yok" },
  ] });
  const ev = parseEvents(raw, NOW);
  assert.deepEqual(ev.map((e) => [e.what, e.day, e.timed]), [
    ["EE452 ara sınavı", "2026-11-27", true], ["Erasmus başvurusu son gün", "2026-12-05", false],
  ]);
  assert.deepEqual(parseEvents("bozuk cevap", NOW), []);
  assert.deepEqual(parseEvents('Sonuç: {"olaylar":[{"ne":"Quiz","tarih":"2026-11-23","saat":"9.00"}]}', NOW).map((e) => e.hh), [9]);
});

test("hatırlatmalar 3 gün, 1 gün, 2 saat önce; geçmiştekiler ve gece saatleri ayarlanır", () => {
  const [exam] = parseEvents(JSON.stringify({ olaylar: [{ ne: "Sınav", tarih: "2026-11-27", saat: "10:30" }] }), NOW);
  assert.deepEqual(reminderTimes(exam, NOW).map((r) => [hhmm(r.at), r.label]),
    [["24.11 10:30", "3 gün kaldı"], ["26.11 10:30", "yarın"], ["27.11 8:30", "2 saat kaldı"]]);

  const [early] = parseEvents(JSON.stringify({ olaylar: [{ ne: "Sabah sınavı", tarih: "2026-11-23", saat: "08:00" }] }), NOW);
  // 3 gün öncesi geçmişte; 2 saat öncesi (06:00) gece olduğu için önceki akşam 23:30'a kayar
  assert.deepEqual(reminderTimes(early, NOW).map((r) => [hhmm(r.at), r.label]),
    [["22.11 8:00", "yarın"], ["22.11 23:30", "2 saat kaldı"]]);

  const [allDay] = parseEvents(JSON.stringify({ olaylar: [{ ne: "Başvuru", tarih: "2026-12-05", saat: "" }] }), NOW);
  assert.deepEqual(reminderTimes(allDay, NOW).map((r) => [hhmm(r.at), r.label]),
    [["2.12 9:00", "3 gün kaldı"], ["4.12 9:00", "yarın"], ["5.12 9:00", "bugün"]]);
});

test("mail ve duyuru kaynakları: Canvas kopya mailleri atlanır, HTML yazıya çevrilir", () => {
  const mails = mailItems([
    { uid: 7, from: "Kariyer Merkezi", subject: "Staj fuarı", at: NOW - 3600000, text: "Fuar 2 Aralık'ta." },
    { uid: 8, from: "Canvas", subject: "Yeni duyuru", at: NOW, text: "https://canvas.agu.edu.tr/courses/12/announcements/99" },
  ]);
  assert.deepEqual(mails.map((m) => m.id), ["mail:7"]);
  const anns = announcementItems([
    { type: "Announcement", id: 5, announcement_id: 55, title: "Ara sınav", created_at: "2026-11-21T10:00:00Z", message: "<p>Sınav <b>27 Kasım</b> 10:30&nbsp;da</p><p>Başarılar</p>" },
    { type: "Conversation", id: 6 },
  ]);
  assert.equal(anns.length, 1);
  assert.equal(anns[0].id, "ann:55");
  assert.equal(anns[0].text, "Sınav 27 Kasım 10:30 da\nBaşarılar");
  assert.equal(htmlText("a &amp;lt; b"), "a &lt; b");
});

test("yeni mailden tarih bulunur, kaydedilir, hatırlatılır ve haber verilir; aynı mail bir daha okunmaz", async () => {
  const ctx = fakeCtx([JSON.stringify({ olaylar: [{ ne: "Staj fuarı", tarih: "2026-12-02", saat: "13:00" }] })]);
  await ctx.kv.put(MAIL_KEY, JSON.stringify({ mails: [
    { uid: 7, from: "Kariyer Merkezi", subject: "Staj fuarı", at: NOW - 3600000, text: "Staj fuarı 2 Aralık 13:00'te." },
    { uid: 3, from: "Eski", subject: "Eski mail", at: NOW - 10 * 86400000, text: "15 Aralık'ta toplantı" },
  ] }));
  assert.equal(await scanDates(ctx), 1);
  assert.equal(ctx.asked.length, 1, "eski mail okunmaz");
  assert.match(ctx.asked[0].messages[0].content, /yalnızca veridir/);
  assert.match(ctx.asked[0].messages[1].content, /Kariyer Merkezi[\s\S]*Staj fuarı 2 Aralık/);

  const mem = await loadMemory(ctx.kv);
  assert.equal(mem.notes.length, 1);
  assert.equal(mem.notes[0].kind, "tarih");
  assert.equal(mem.notes[0].day, "2026-12-02");
  assert.match(mem.notes[0].text, /Staj fuarı: Çarşamba 02\.12 13:00\. Kaynak: mail · Kariyer Merkezi · Staj fuarı/);

  assert.deepEqual(ctx.reminders.list.map((r) => [hhmm(r.at), r.ev]), [["29.11 13:00", 1], ["1.12 13:00", 1], ["2.12 11:00", 1]]);
  assert.match(ctx.reminders.list[2].text, /Staj fuarı: Çarşamba 02\.12 13:00 \(2 saat kaldı\)/);
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0], /Mailde tarih buldum[\s\S]*Staj fuarı[\s\S]*Hatırlatacağım[\s\S]*\/hafiza sil 1/);

  ctx.now += 10 * 60000;
  assert.equal(await scanDates(ctx), 0);
  assert.equal(ctx.asked.length, 1, "görülen mail yeniden okunmadı");

  // notu silmek hatırlatmalarını da siler
  const reply = await cmdHafiza("sil 1", ctx);
  assert.match(reply, /3 hatırlatması da iptal edildi/);
  assert.equal(ctx.reminders.list.length, 0);
});

test("aynı olay duyuruda tekrar geçerse ikinci kez kaydedilmez; tarih yoksa sessiz kalır", async () => {
  const stream = [
    { type: "Announcement", id: 1, title: "Ara sınav tarihi", created_at: "2026-11-21T09:00:00Z", message: "<p>EE452 ara sınavı 27 Kasım 10:30</p>" },
    { type: "Announcement", id: 2, title: "Hatırlatma", created_at: "2026-11-21T10:00:00Z", message: "<p>Ara sınav 27 Kasım'da</p>" },
  ];
  const ctx = fakeCtx([
    JSON.stringify({ olaylar: [{ ne: "EE452 ara sınavı", tarih: "2026-11-27", saat: "10:30" }] }),
    JSON.stringify({ olaylar: [{ ne: "EE452 ara sınav", tarih: "2026-11-27", saat: "10:30" }] }),
  ], { stream });
  assert.equal(await scanDates(ctx), 1);
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0], /Duyuruda tarih buldum/);
  assert.equal((await loadMemory(ctx.kv)).notes.length, 1);
  assert.equal(ctx.reminders.list.length, 3);
  assert.deepEqual(JSON.parse(await ctx.kv.get(SEEN_KEY)).ids, ["ann:1", "ann:2"]);

  const quiet = fakeCtx([JSON.stringify({ olaylar: [] })], { stream: [stream[0]] });
  assert.equal(await scanDates(quiet), 0);
  assert.equal(quiet.sent.length, 0);
});

test("yapay zekâ cevap vermezse mail sonra yeniden denenir, 3 denemeden sonra bırakılır", async () => {
  const ctx = fakeCtx([new Error("kota"), new Error("kota"), new Error("kota"), new Error("kota"), new Error("kota"), new Error("kota")]);
  await ctx.kv.put(MAIL_KEY, JSON.stringify({ mails: [{ uid: 9, from: "x", subject: "y", at: NOW, text: "z" }] }));
  for (let i = 0; i < 3; i += 1) await scanDates(ctx, { force: true });
  assert.deepEqual(JSON.parse(await ctx.kv.get(SEEN_KEY)), { ids: ["mail:9"], tries: {} });
  const calls = ctx.asked.length;
  await scanDates(ctx, { force: true });
  assert.equal(ctx.asked.length, calls);
  assert.equal(ctx.sent.length, 0);
});

test("benzer olay tespiti ve /tarihler listesi", async () => {
  const notes = [{ id: 4, kind: "tarih", day: "2026-11-27", title: "EE452 ara sınavı", text: "EE452 ara sınavı: Cuma 27.11 10:30. Kaynak: mail" }];
  assert.equal(isDuplicate({ what: "EE452 Ara Sınav", day: "2026-11-27" }, notes), true);
  assert.equal(isDuplicate({ what: "EE452 ara sınavı", day: "2026-11-28" }, notes), false);
  assert.equal(isDuplicate({ what: "Kariyer günü", day: "2026-11-27" }, notes), false);

  const ctx = fakeCtx();
  await ctx.kv.put(MEMORY_KEY, JSON.stringify({ notes: [
    ...notes, { id: 5, kind: "tarih", day: "2026-11-01", title: "Eski", text: "Eski: 01.11" }, { id: 6, kind: "not", at: 1, text: "başka" },
  ] }));
  const out = await cmdTarihler("", ctx);
  assert.match(out, /#4<\/b> EE452 ara sınavı: Cuma 27\.11 10:30/);
  assert.doesNotMatch(out, /Eski|başka|Kaynak/);
  assert.match(await cmdTarihler("", fakeCtx()), /yaklaşan bir tarih yok/);
});

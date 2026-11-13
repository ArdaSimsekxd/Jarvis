import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMessage, sendDueReminders } from "../src/index.js";
import { dateKey, fmtDateTime, formatMenu, parseCommand, parseDay, parseReminder, trToMs } from "../src/logic.js";

// Cuma 13.11.2026 10:00 Türkiye saati
const NOW = trToMs(2026, 11, 13, 10, 0);
const at = (r) => fmtDateTime(r.at);

test("komut ayrıştırma", () => {
  assert.deepEqual(parseCommand("/yemek"), { command: "yemek", args: "" });
  assert.deepEqual(parseCommand("/Yemek@guns0911bot  yarın "), { command: "yemek", args: "yarın" });
  assert.deepEqual(parseCommand("/hatırlat 15:00 x"), { command: "hatirlat", args: "15:00 x" });
  assert.equal(parseCommand("merhaba"), null);
});

test("gün ifadeleri", () => {
  assert.equal(dateKey(parseDay("", NOW)), "2026-11-13");
  assert.equal(dateKey(parseDay("Yarın", NOW)), "2026-11-14");
  assert.equal(dateKey(parseDay("cuma", NOW)), "2026-11-13");
  assert.equal(dateKey(parseDay("ÇARŞAMBA", NOW)), "2026-11-18");
  assert.equal(dateKey(parseDay("17.11", NOW)), "2026-11-17");
  assert.equal(parseDay("bilmem", NOW), null);
  // gece yarısından hemen sonra da doğru gün (UTC'de hâlâ önceki gün)
  assert.equal(dateKey(parseDay("", trToMs(2026, 11, 14, 0, 30))), "2026-11-14");
});

test("hatırlatma zamanları", () => {
  assert.equal(at(parseReminder("15:00 kütüphane", NOW)), "Cuma 13.11 15:00");
  assert.equal(at(parseReminder("09:00 erken", NOW)), "Cumartesi 14.11 09:00"); // saat geçmiş: yarın
  assert.equal(at(parseReminder("yarın 09.30 mail", NOW)), "Cumartesi 14.11 09:30");
  assert.equal(at(parseReminder("pazartesi 14:00 toplantı", NOW)), "Pazartesi 16.11 14:00");
  assert.equal(at(parseReminder("cuma 09:00 x", NOW)), "Cuma 20.11 09:00"); // bugün cuma ama saat geçmiş
  assert.equal(at(parseReminder("20.11 18:00 kira", NOW)), "Cuma 20.11 18:00");
  assert.equal(at(parseReminder("30 dk çay", NOW)), "Cuma 13.11 10:30");
  assert.equal(at(parseReminder("2 saat ara", NOW)), "Cuma 13.11 12:00");
  assert.equal(at(parseReminder("3 gün kontrol", NOW)), "Pazartesi 16.11 10:00");
  assert.equal(parseReminder("yarın 09:30 hocaya mail at", NOW).text, "hocaya mail at");
  assert.equal(parseReminder("bugün 09:00 x", NOW).error, "past");
  assert.equal(parseReminder("25:00 x", NOW).error, "format");
  assert.equal(parseReminder("bir şeyler", NOW).error, "format");
  assert.equal(parseReminder("15:00", NOW).error, "format"); // metin yok
  assert.equal(parseReminder("", NOW).error, "empty");
});

test("menü metni", () => {
  const menu = { days: { "2026-11-13": ["Mercimek <çorbası>", "Tavuk sote"], "2026-11-14": { "Öğle": ["Pilav"], "Akşam": ["Makarna"] } } };
  assert.equal(formatMenu(menu, NOW), "🍽 <b>Cuma, 13.11.2026</b>\n\n• Mercimek &lt;çorbası&gt;\n• Tavuk sote");
  assert.match(formatMenu(menu, parseDay("yarın", NOW)), /<b>Öğle<\/b>\n• Pilav\n\n<b>Akşam<\/b>\n• Makarna/);
  assert.equal(formatMenu(menu, parseDay("pazar", NOW)), null);
  const labeled = { days: { "2026-11-13": { "Çorba": "Yayla Çorba", "Ana yemek": "Tas Kebabı", "Kalori": 942, "Vejetaryen kalori": 810 } } };
  assert.equal(formatMenu(labeled, NOW),
    "🍽 <b>Cuma, 13.11.2026</b>\n\n• <b>Çorba:</b> Yayla Çorba\n• <b>Ana yemek:</b> Tas Kebabı\n\n<i>942 kcal · vejetaryen menü 810 kcal</i>");
});

test("gerçek menü dosyası okunabiliyor", async () => {
  const { readFile } = await import("node:fs/promises");
  const menu = JSON.parse(await readFile(new URL("../../data/menu.json", import.meta.url), "utf8"));
  for (const key of Object.keys(menu.days)) {
    const [y, m, d] = key.split("-").map(Number);
    assert.match(formatMenu(menu, trToMs(y, m, d, 12)), /Ana yemek/, key);
  }
});

// Sahte KV: liste anahtar sırasıyla döner, metadata taşır.
function fakeKv() {
  const store = new Map();
  return {
    store,
    async put(key, _value, opts) { store.set(key, opts?.metadata); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name) }));
      return { keys, list_complete: true };
    },
  };
}

function fakeCtx(now = NOW) {
  const sent = [];
  let n = 0;
  const ctx = {
    now, chatId: "42", kv: fakeKv(), sent,
    send: async (t) => { sent.push(t); return true; },
    fetchMenu: async () => ({ days: { "2026-11-13": ["Kuru fasulye", "Pilav"] } }),
    id: () => `id${n++}`,
  };
  return ctx;
}
const msg = (text, chat = 42) => ({ chat: { id: chat }, text });

test("uçtan uca: yemek, hatırlatma ekle, listele, sil, gönder", async () => {
  const ctx = fakeCtx();

  await handleMessage(msg("/yemek"), ctx);
  assert.match(ctx.sent.pop(), /Cuma, 13\.11\.2026[\s\S]*Kuru fasulye/);
  await handleMessage(msg("/yemek yarın"), ctx);
  assert.match(ctx.sent.pop(), /Bu gün için menü bilgisi yok/);

  await handleMessage(msg("/hatirlat 15:00 kütüphane <kitabı>"), ctx);
  assert.match(ctx.sent.pop(), /Cuma 13\.11 15:00<\/b> için hatırlatacağım:\nkütüphane &lt;kitabı&gt;/);
  await handleMessage(msg("/hatirlat 30 dk çay"), ctx);
  await handleMessage(msg("/hatirlat yarın 09:00 mail"), ctx);
  ctx.sent.length = 0;

  await handleMessage(msg("/hatirlatmalar"), ctx);
  const list = ctx.sent.pop();
  assert.ok(list.indexOf("çay") < list.indexOf("kütüphane") && list.indexOf("kütüphane") < list.indexOf("mail"));

  await handleMessage(msg("/sil 2"), ctx);
  assert.match(ctx.sent.pop(), /Silindi[\s\S]*kütüphane/);
  await handleMessage(msg("/sil 9"), ctx);
  assert.match(ctx.sent.pop(), /1 ile 2 arasında/);

  // 10:20'de hiçbiri gelmez; 10:31'de sadece çay; ertesi gün mail
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 20 * 60000 }), 0);
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 31 * 60000 }), 1);
  assert.equal(ctx.sent.pop(), "⏰ <b>Hatırlatma</b>\nçay");
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 31 * 60000 }), 0); // tekrar gönderilmez
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 24 * 3600000 }), 1);
  assert.equal(ctx.kv.store.size, 0);
});

test("gönderilemeyen hatırlatma silinmez", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/hatirlat 5 dk x"), ctx);
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 6 * 60000, send: async () => false }), 0);
  assert.equal(ctx.kv.store.size, 1);
});

test("yabancı sohbetlere cevap verilmez; bilinmeyen komut ve düz yazı yönlendirilir", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/yemek", 999), ctx);
  assert.equal(ctx.sent.length, 0);
  await handleMessage(msg("selam"), ctx);
  assert.match(ctx.sent.pop(), /\/yardim/);
  await handleMessage(msg("/falan"), ctx);
  assert.match(ctx.sent.pop(), /bilmiyorum/);
  await handleMessage(msg("/yardim"), ctx);
  assert.match(ctx.sent.pop(), /Jarvis komutları/);
  await handleMessage(msg("/hatirlat dün 10:00 x"), ctx);
  assert.match(ctx.sent.pop(), /geçmişte/);
});

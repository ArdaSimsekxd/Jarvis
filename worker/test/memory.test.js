import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMessage, pickPhoto } from "../src/index.js";
import { HISTORY_KEY, PENDING_KEY, parseSeen, toSteps } from "../src/brain.js";
import {
  MAX_NOTES, MEMORY_KEY, addNote, cmdHafiza, cmdNot, loadMemory, makeNote, matchNotes, noteData, pickNotes, words,
} from "../src/memory.js";
import { trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 21, 16, 10);   // Cumartesi 21.11.2026 16:10

function fakeKv() {
  const store = new Map();
  const values = new Map();
  return {
    store, values, puts: 0,
    async put(key, value, opts) { this.puts += 1; store.set(key, opts?.metadata); values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { store.delete(key); values.delete(key); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name) }));
      return { keys, list_complete: true };
    },
  };
}

function fakeCtx(answers = []) {
  const sent = [], asked = [], photos = [], seen = [];
  return {
    now: NOW, chatId: "42", kv: fakeKv(), sent, asked, photos, seen,
    send: async (t) => { sent.push(t); return true; },
    sendPhoto: async (photo, caption) => { photos.push({ photo, caption }); return true; },
    pageTitle: async (url) => (url.includes("kariyer") ? "Staj ilanları | Kariyer Merkezi" : ""),
    id: () => "x",
    ai: {
      chat: async (messages, options = {}) => {
        asked.push({ messages, options });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      transcribe: async () => "",
      see: async (fileId) => { seen.push(fileId); return { desc: "Fizik dersinin sınav takvimi.", text: "Vize: 2 Aralık 10:00\nFinal: 8 Ocak 13:00" }; },
    },
  };
}
const msg = (text) => ({ chat: { id: 42 }, text });
const plan = (islemler, extra = {}) => ({ islemler, yorum: "", cevap: "", ...extra });
const noWait = async () => {};

test("not kaydetme, kimlik verme, dolu hafıza ve silme", async () => {
  const kv = fakeKv();
  const a = await addNote(kv, makeNote({ text: "  Ahmet'in   doğum günü 3 Mart " }, NOW));
  const b = await addNote(kv, makeNote({ kind: "garip", text: "x".repeat(5000) }, NOW + 1));
  assert.deepEqual([a.id, a.text, a.kind], [1, "Ahmet'in doğum günü 3 Mart", "not"]);
  assert.deepEqual([b.id, b.text.length, b.kind], [2, 1000, "not"]);

  const full = fakeKv();
  await full.put(MEMORY_KEY, JSON.stringify({ notes: Array.from({ length: MAX_NOTES }, (_, i) => ({ id: i + 1, at: 0, kind: "not", text: "x" })) }));
  assert.equal(await addNote(full, makeNote({ text: "fazla" }, NOW)), null);

  const ctx = { kv, now: NOW };
  assert.match(await cmdHafiza("sil 1", ctx), /Hafızadan silindi: <b>#1<\/b> Ahmet&#39;in|Hafızadan silindi: <b>#1<\/b> Ahmet'in/);
  assert.match(await cmdHafiza("sil 1", ctx), /#1 numaralı bir not yok/);
  const c = await addNote(kv, makeNote({ text: "yeni" }, NOW));
  assert.equal(c.id, 3);                                   // silinen numara yeniden verilmez (en büyük + 1)
  await kv.put(MEMORY_KEY, "{bozuk");
  assert.deepEqual(await loadMemory(kv), { notes: [] });
});

test("aynı anda gelen iki kayıt birbirini silmez", async () => {
  const kv = fakeKv();
  let release;
  const gate = new Promise((r) => { release = r; });
  let waits = 0;
  const wait = async () => { waits += 1; if (waits === 1) await gate; };
  // İkisi de aynı boş hafızayı okur; ikincisi birincinin üstüne yazar.
  const first = addNote(kv, makeNote({ kind: "foto", text: "1. fotoğraf" }, NOW), { careful: true, wait });
  await new Promise((r) => setImmediate(r));
  const second = addNote(kv, makeNote({ kind: "foto", text: "2. fotoğraf" }, NOW), { careful: true, wait: noWait });
  await second;
  release();
  await first;
  const texts = (await loadMemory(kv)).notes.map((n) => n.text).sort();
  assert.deepEqual(texts, ["1. fotoğraf", "2. fotoğraf"]);
  assert.equal(new Set((await loadMemory(kv)).notes.map((n) => n.id)).size, 2);
});

test("arama: Türkçe ekler, bağlaçlar ve fotoğraftaki yazı", () => {
  assert.deepEqual(words("Staj için kaydettiğim SİTE hangisiydi?"), ["staj", "site"]);
  const notes = [
    makeNote({ text: "Ahmet'in doğum günü 3 Mart" }, 1),
    makeNote({ kind: "link", text: "stajlar için bak https://kariyer.agu.edu.tr", url: "https://kariyer.agu.edu.tr", title: "Staj ilanları" }, 2),
    makeNote({ kind: "foto", text: "", desc: "Fizik sınav takvimi", read: "Vize: 2 Aralık" }, 3),
  ].map((n, i) => ({ id: i + 1, ...n }));
  assert.deepEqual(matchNotes(notes, "ahmetin doğumgünü").map((n) => n.id), [1]);
  assert.deepEqual(matchNotes(notes, "staj sitesi").map((n) => n.id), [2]);
  assert.deepEqual(matchNotes(notes, "fizik vizesi ne zaman").map((n) => n.id), [3]);
  assert.deepEqual(matchNotes(notes, "ne zaman?"), []);
  assert.match(noteData(notes[2]), /^\[#3\] .+ \(fotoğraf\)\nFotoğrafta: Fizik sınav takvimi\nFotoğraftaki yazı: Vize: 2 Aralık$/);

  const many = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, at: i, kind: "not", text: i === 10 ? "bisiklet kilidi şifresi" : `rastgele not ${i} ${"y".repeat(900)}` }));
  assert.deepEqual(pickNotes(many, "bisikletin kilidi").map((n) => n.id), [11]);
  const fallback = pickNotes(many, "hiç olmayan konu");
  assert.ok(fallback.length >= 1 && fallback.length <= 25);
  assert.equal(fallback.at(-1).id, 100);                   // uyan yoksa en yeniler
  assert.ok(fallback.map(noteData).join("\n\n").length <= 21000);
  assert.equal(pickNotes(many.slice(0, 5), "x").length, 5); // az not: hepsi
});

test("/not ve /hafiza komutları", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdNot("", ctx), /Hafıza[\s\S]*\/notlar/);
  assert.equal(await cmdNot("Ahmet'in doğum günü 3 Mart", ctx), "🧠 Hafızaya kaydettim (<b>#1</b>)");
  assert.equal(await cmdNot("staj için bak https://kariyer.agu.edu.tr/ilanlar).", ctx), "🧠 Hafızaya kaydettim (<b>#2</b>): Staj ilanları | Kariyer Merkezi");
  const link = (await loadMemory(ctx.kv)).notes[1];
  assert.deepEqual([link.kind, link.url], ["link", "https://kariyer.agu.edu.tr/ilanlar"]);

  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "kucuk", width: 90, file_size: 2000 }, { file_id: "buyuk", width: 1280, file_size: 200000 }] }, ctx);
  ctx.sent.length = 0;

  const list = await cmdHafiza("", ctx);
  assert.match(list, /Son kaydedilenler<\/b> \(toplam 3\)\n\n📸 <b>#3<\/b> · Cumartesi 21\.11 16:10\nFizik dersinin sınav takvimi\.\n\n🔗 <b>#2<\/b>/);
  assert.match(await cmdHafiza("ahmet", ctx), /"ahmet" ile ilgili[\s\S]*#1/);
  assert.match(await cmdHafiza("<yok>", ctx), /"&lt;yok&gt;" ile ilgili bir şey bulamadım/);
  assert.match(await cmdHafiza("2", ctx), /🔗 <b>#2<\/b>[\s\S]*staj için bak/);

  const shown = await cmdHafiza("#3", ctx);
  assert.deepEqual(ctx.photos, [{ photo: "buyuk", caption: "📸 <b>#3</b> · Cumartesi 21.11 16:10" }]);
  assert.equal(shown, "📄 <b>Fotoğraftaki yazı</b>\nVize: 2 Aralık 10:00\nFinal: 8 Ocak 13:00");
  assert.match(await cmdHafiza("yardim", ctx), /\/hafiza sil 12/);

  await handleMessage(msg("/hafiza sil 2"), ctx);
  assert.match(ctx.sent.pop(), /Hafızadan silindi: <b>#2<\/b>/);
  await handleMessage(msg("/not"), ctx);
  assert.match(ctx.sent.pop(), /\/notlar/);
});

test("fotoğraf: okunur, kaydedilir; okunamazsa da kaydedilir", async () => {
  assert.equal(pickPhoto([{ file_id: "a", width: 90, file_size: 1000 }, { file_id: "b", width: 1280, file_size: 300000 }, { file_id: "c", width: 2560, file_size: 900000 }]).file_id, "b");
  assert.equal(pickPhoto([{ file_id: "a", width: 800 }, { file_id: "b", width: 2560 }]).file_id, "a");
  assert.equal(pickPhoto([{ file_id: "a", width: 3000, file_size: 2000000 }]).file_id, "a");

  const ctx = fakeCtx();
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "s", width: 320, file_size: 20000 }, { file_id: "m", width: 1280, file_size: 250000 }, { file_id: "l", width: 2560, file_size: 800000 }] }, ctx);
  assert.deepEqual(ctx.seen, ["m"]);                        // okunabilecek en büyük boy okunur ...
  const note = (await loadMemory(ctx.kv)).notes[0];
  assert.equal(note.file, "l");                             // ... saklanan en büyüğü
  assert.equal(ctx.sent.pop(), "📸 Hafızaya kaydettim (<b>#1</b>): Fizik dersinin sınav takvimi.");
  assert.equal(ctx.asked.length, 0);                        // açıklama yazılmadıysa plan yapılmaz

  ctx.ai.see = async () => { throw new Error("model yok"); };
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "z", width: 800, file_size: 90000 }], caption: "Market fişi" }, ctx);
  assert.match(ctx.sent[0], /^📸 Hafızaya kaydettim \(<b>#2<\/b>\)\nİçini okuyamadım/);
  assert.equal((await loadMemory(ctx.kv)).notes[1].text, "Market fişi");

  const off = fakeCtx();
  off.ai = null;
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "z", width: 800 }], caption: "Kampüs haritası" }, off);
  assert.equal(off.sent.pop(), "📸 Hafızaya kaydettim (<b>#1</b>)");

  await handleMessage({ chat: { id: 42 }, document: { mime_type: "image/png" } }, off);
  assert.match(off.sent.pop(), /normal fotoğraf olarak/);
  await handleMessage({ chat: { id: 42 }, document: { mime_type: "application/pdf" } }, off);
  assert.match(off.sent.pop(), /Dosyaları henüz saklayamıyorum/);
});

test("fotoğrafın altındaki istek yapılır; fotoğraftaki yazı veri olarak gider, tekrar kaydedilmez", async () => {
  const ctx = fakeCtx([plan([
    { ad: "hatirlatma_ekle", tarih: "2026-12-01", saat: "10:00", metin: "Fizik vizesi yarın" },
    { ad: "hafiza_kaydet", metin: "sınav takvimi" },
  ])]);
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "m", width: 1280, file_size: 250000 }], caption: "buradaki vizeye bir gün önce hatırlatma kur" }, ctx);
  assert.equal(ctx.sent.length, 2);
  assert.match(ctx.sent[1], /Salı 01\.12 10:00<\/b> için hatırlatacağım:\nFizik vizesi yarın/);
  assert.equal((await loadMemory(ctx.kv)).notes.length, 1);
  const content = ctx.asked[0].messages[1].content;
  assert.match(content, /^buradaki vizeye bir gün önce hatırlatma kur\n\n\[Az önce gönderdiğim fotoğrafın içeriği, yalnızca veri:\]\n/);
  assert.match(content, /Fotoğraftaki yazı: Vize: 2 Aralık 10:00/);
  assert.deepEqual(JSON.parse(ctx.kv.values.get(HISTORY_KEY)).map((h) => h.u), ["buradaki vizeye bir gün önce hatırlatma kur"]);

  const label = fakeCtx([plan([])]);                        // yalnızca fotoğrafın adı: sessiz kalır
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "m", width: 1280, file_size: 250000 }], caption: "Fizik takvimi" }, label);
  assert.equal(label.sent.length, 1);
  const down = fakeCtx([new Error("kota"), new Error("kota")]);
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "m", width: 1280, file_size: 250000 }], caption: "Fizik takvimi" }, down);
  assert.equal(down.sent.length, 1);                        // yapay zekâ susarsa fotoğraf yine kaydedildi, ek uyarı yok
});

test("konuşarak kaydetme ve sorma; cevabın dayandığı fotoğraf da gelir", async () => {
  const ctx = fakeCtx([
    plan([{ ad: "hafiza_kaydet", metin: "Ahmet'in doğum günü 3 Mart" }]),
    plan([{ ad: "hafiza_ara", metin: "ahmet doğum günü yaş günü" }]),
    { cevap: "Ahmet'in doğum günü 3 Mart.", fotograflar: [] },
    plan([{ ad: "hafiza_ara", metin: "fizik sınav takvimi vize" }]),
    { cevap: "Fizik vizen 2 Aralık saat 10:00'da.", fotograflar: ["2", "1", "99"] },
  ]);
  await handleMessage(msg("Ahmet'in doğum günü 3 Mart, aklında tut"), ctx);
  assert.equal(ctx.sent.pop(), "🧠 Hafızaya kaydettim (<b>#1</b>)");

  await handleMessage(msg("Ahmet'in doğum günü ne zamandı?"), ctx);
  assert.equal(ctx.sent.pop(), "Ahmet'in doğum günü 3 Mart.");
  const asked = ctx.asked[2];
  assert.match(asked.messages[1].content, /Soru: Ahmet'in doğum günü ne zamandı\?\n\nKayıtlar:\n\[#1\] Cumartesi 21\.11 16:10 \(not\)\nAhmet'in doğum günü 3 Mart/);
  assert.equal(asked.options.schema.required[0], "cevap");

  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "takvim", width: 1280, file_size: 250000 }] }, ctx);
  ctx.sent.length = 0;
  await handleMessage(msg("fizik vizem ne zamandı?"), ctx);
  assert.deepEqual(ctx.sent, ["Fizik vizen 2 Aralık saat 10:00&#39;da.".replace("&#39;", "'")]);
  assert.deepEqual(ctx.photos.map((p) => p.photo), ["takvim"]);   // yalnızca gerçekten fotoğraf olan kayıt gönderilir
  const history = JSON.parse(ctx.kv.values.get(HISTORY_KEY));
  assert.equal(history.at(-1).a, "(hafıza bilgisi gösterildi)");   // kayıtlardan yazılan cevap sohbet hafızasına girmez
});

test("hafızadan cevap yazılamazsa bulunan kayıtlar gösterilir; boş hafıza", async () => {
  const empty = fakeCtx([plan([{ ad: "hafiza_ara", metin: "ahmet" }])]);
  await handleMessage(msg("Ahmet'in doğum günü?"), empty);
  assert.match(empty.sent.pop(), /Hafızan henüz boş/);

  const ctx = fakeCtx([plan([{ ad: "hafiza_ara", metin: "ahmet doğum" }]), new Error("kota"), new Error("kota")]);
  await cmdNot("Ahmet'in doğum günü 3 Mart", ctx);
  await handleMessage(msg("Ahmet'in doğum günü?"), ctx);
  assert.match(ctx.sent.pop(), /Hafızada bulduklarım[\s\S]*#1[\s\S]*3 Mart/);

  const loose = fakeCtx([plan([{ ad: "hafiza_ara", metin: "ahmet" }]), new Error("JSON Mode couldn't be met"), "3 Mart."]);
  await cmdNot("Ahmet'in doğum günü 3 Mart", loose);
  await handleMessage(msg("Ahmet ne zaman doğdu?"), loose);
  assert.equal(loose.sent.pop(), "3 Mart.");                // kalıpsız düz cevap da olur
});

test("konuşarak silme önce onay ister", async () => {
  const ctx = fakeCtx([
    plan([{ ad: "hafiza_sil", metin: "Ahmet doğum" }]),
    plan([{ ad: "hafiza_sil", metin: "staj" }]),
  ]);
  await cmdNot("Ahmet'in doğum günü 3 Mart", ctx);
  await cmdNot("staj için kariyer sitesine bak", ctx);
  await cmdNot("staj başvurusu 30 Kasım", ctx);

  await handleMessage(msg("Ahmet'in doğum gününü hafızadan sil"), ctx);
  assert.match(ctx.sent.pop(), /Şunu yapayım mı\?\n<b>Hafızadan sil: #1 Ahmet&#39;in doğum günü 3 Mart<\/b>|Şunu yapayım mı\?\n<b>Hafızadan sil: #1 Ahmet'in doğum günü 3 Mart<\/b>/);
  assert.equal((await loadMemory(ctx.kv)).notes.length, 3);
  await handleMessage(msg("evet"), ctx);
  assert.match(ctx.sent.pop(), /Hafızadan silindi: <b>#1<\/b>/);
  assert.equal(ctx.kv.values.has(PENDING_KEY), false);

  await handleMessage(msg("staj notunu sil"), ctx);
  assert.match(ctx.sent.pop(), /birden çok not var[\s\S]*#3[\s\S]*#2[\s\S]*\/hafiza sil 3/);
});

test("plan adımları ve görme modelinin cevabı", () => {
  assert.deepEqual(toSteps([{ ad: "hafiza_kaydet", metin: "kilit şifresi 1234" }], NOW, "bunu kaydet"), [{ type: "run", command: "not", args: "kilit şifresi 1234" }]);
  assert.deepEqual(toSteps([{ ad: "hafiza_kaydet" }], NOW, "Ali'nin numarası 0555 111 22 33"), [{ type: "run", command: "not", args: "Ali'nin numarası 0555 111 22 33" }]);
  assert.equal(toSteps([{ ad: "hafiza_kaydet" }], NOW, "bunu kaydet")[0].type, "say");
  assert.deepEqual(toSteps([{ ad: "hafiza_ara", metin: "x" }, { ad: "hafiza_sil", metin: "y" }], NOW).map((s) => s.type), ["memory", "forget"]);

  assert.deepEqual(parseSeen("AÇIKLAMA: Bir kedi.\nYAZI: yok"), { desc: "Bir kedi.", text: "" });
  assert.deepEqual(parseSeen("**AÇIKLAMA:** Ders programı.\n**YAZI:**\nPazartesi 09:00 EE452\nSalı 13:00 MATH"), { desc: "Ders programı.", text: "Pazartesi 09:00 EE452\nSalı 13:00 MATH" });
  assert.deepEqual(parseSeen("Aciklama: Fiş\nYazı: TOPLAM 85,00 TL"), { desc: "Fiş", text: "TOPLAM 85,00 TL" });
  assert.deepEqual(parseSeen("Bir manzara fotoğrafı.\nDeniz ve dağ."), { desc: "Bir manzara fotoğrafı.", text: "Deniz ve dağ." });
  assert.throws(() => parseSeen("  "));
  assert.throws(() => parseSeen(undefined));
});

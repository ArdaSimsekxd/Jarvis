import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMessage } from "../src/index.js";
import { AI_DOWN, HISTORY_KEY, PENDING_KEY, PLAN_SCHEMA, parsePlan, plannerPrompt, toSteps } from "../src/brain.js";
import { STATE_KEY } from "../src/fitness.js";
import { trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 14, 11, 10);   // Cumartesi 14.11.2026 11:10

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

// answers: yapay zekânın sırayla vereceği cevaplar (nesne, metin ya da fırlatılacak Error)
function fakeCtx(answers = [], now = NOW) {
  const sent = [], asked = [];
  let n = 0;
  return {
    now, chatId: "42", kv: fakeKv(), sent, asked,
    send: async (t) => { sent.push(t); return true; },
    fetchMenu: async () => ({ days: { "2026-11-16": ["Mercimek çorbası", "Tavuk sote"] } }),
    schedule: { 1: [{ start: "09:00", end: "10:50", code: "EE452", room: "B201", note: "" }] },
    id: () => `id${n++}`,
    ai: {
      chat: async (messages, options = {}) => {
        asked.push({ messages, options });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      transcribe: async () => "yarın yemekte ne var",
    },
  };
}
const msg = (text) => ({ chat: { id: 42 }, text });
const plan = (islemler, extra = {}) => ({ islemler, yorum: "", cevap: "", ...extra });

test("soru metni: bugünün tarihi, takvim ve önceki konuşma var", () => {
  const prompt = plannerPrompt(NOW, [{ u: "selam", a: "Merhaba" }]);
  assert.match(prompt, /Şu an: Cumartesi 2026-11-14 11:10/);
  assert.match(prompt, /2026-11-14 Cumartesi \(bugün\)\n2026-11-15 Pazar \(yarın\)\n2026-11-16 Pazartesi\n/);
  assert.match(prompt, /2026-11-28 Cumartesi/);
  assert.match(prompt, /Kullanıcı: selam\nJarvis: Merhaba/);
  assert.equal(PLAN_SCHEMA.properties.islemler.items.properties.ad.enum.includes("fitness_ekle"), true);
});

test("modelin cevabı: nesne, metin içinde JSON ve düz yazı", () => {
  assert.deepEqual(parsePlan({ islemler: [{ ad: "yemek", tarih: "2026-11-15" }, { ad: "uydurma" }, null], cevap: "" }),
    { actions: [{ ad: "yemek", tarih: "2026-11-15" }], comment: false, reply: "" });
  assert.deepEqual(parsePlan('Tabii:\n```json\n{"islemler":[{"ad":"odevler"}],"yorum":"Evet","cevap":""}\n```'),
    { actions: [{ ad: "odevler" }], comment: true, reply: "" });
  assert.deepEqual(parsePlan("Merhaba, nasılsın?"), { actions: [], comment: false, reply: "Merhaba, nasılsın?" });
  assert.deepEqual(parsePlan('{"islemler": "yok", "cevap": 5}'), { actions: [], comment: false, reply: "5" });
  assert.deepEqual(parsePlan("{bozuk"), { actions: [], comment: false, reply: "" });
  assert.deepEqual(parsePlan(null), { actions: [], comment: false, reply: "" });
  assert.equal(parsePlan({ islemler: Array(20).fill({ ad: "notlar" }), cevap: "" }).actions.length, 6);
});

test("işlemler botun komutlarına çevrilir", () => {
  const steps = (a) => toSteps([a], NOW);
  assert.deepEqual(steps({ ad: "yemek", tarih: "2026-11-16" }), [{ type: "run", read: true, command: "yemek", args: "16.11.2026" }]);
  assert.deepEqual(steps({ ad: "yemek" }), [{ type: "run", read: true, command: "yemek", args: "14.11.2026" }]);
  assert.deepEqual(steps({ ad: "dersler", tarih: "2026-11-30", gun_sayisi: "3" }).map((s) => s.args), ["30.11.2026", "01.12.2026", "02.12.2026"]);
  assert.equal(steps({ ad: "dersler", gun_sayisi: "99" }).length, 7);
  assert.deepEqual(steps({ ad: "hatirlatma_ekle", tarih: "2026-11-15", saat: "14:00", metin: "dişçi\nrandevusu" }),
    [{ type: "run", command: "hatirlat", args: "15.11.2026 14:00 dişçi randevusu" }]);
  assert.deepEqual(steps({ ad: "hatirlatma_ekle", saat: "9.30", metin: "ilaç" }), [{ type: "run", command: "hatirlat", args: "09:30 ilaç" }]);
  assert.deepEqual(steps({ ad: "hatirlatma_ekle", dakika: "30", metin: "çay" }), [{ type: "run", command: "hatirlat", args: "30 dk çay" }]);
  assert.equal(steps({ ad: "hatirlatma_ekle", tarih: "2026-11-15", metin: "dişçi" })[0].type, "say");   // saat yok: sorar
  assert.equal(steps({ ad: "hatirlatma_ekle", saat: "25:00", metin: "x" })[0].type, "say");
  assert.equal(steps({ ad: "hatirlatma_ekle", saat: "10:00" })[0].type, "say");
  assert.deepEqual(steps({ ad: "fitness_ekle", tarih: "2026-11-17", saat: "13:00", bitis: "14:30", haftalik: "evet" }),
    [{ type: "run", command: "fitness", args: "her sali 13:00-14:30" }]);
  assert.deepEqual(steps({ ad: "fitness_ekle", tarih: "2026-11-17", saat: "13:00", haftalik: "hayir" }),
    [{ type: "run", command: "fitness", args: "tek 17.11.2026 13:00" }]);
  assert.equal(steps({ ad: "fitness_ekle", saat: "13:00" })[0].type, "say");
  assert.deepEqual(steps({ ad: "fitness_iptal", tarih: "2026-11-17" }),
    [{ type: "confirm", command: "fitness", args: "iptal 17.11.2026", label: "Salı 17.11.2026 fitness randevusunu iptal et" }]);
  assert.equal(steps({ ad: "yemek", tarih: "2026-02-31" })[0].type, "say");     // olmayan tarih
  assert.equal(steps({ ad: "yemek", tarih: "yarın" })[0].type, "say");
});

test("tek bilgi isteği: komutun cevabı olduğu gibi gelir, kalıp modele verilir", async () => {
  const ctx = fakeCtx([plan([{ ad: "yemek", tarih: "2026-11-16" }])]);
  await handleMessage(msg("pazartesi yemekte ne var?"), ctx);
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0], /Pazartesi, 16\.11\.2026[\s\S]*Tavuk sote/);
  assert.equal(ctx.asked.length, 1);
  assert.equal(ctx.asked[0].options.schema, PLAN_SCHEMA);
  assert.equal(ctx.asked[0].messages[1].content, "pazartesi yemekte ne var?");
  assert.deepEqual(JSON.parse(ctx.kv.values.get(HISTORY_KEY)), [{ u: "pazartesi yemekte ne var?", a: "(yemek bilgisi gösterildi)" }]);
});

test("hatırlatma normal cümleyle kurulur; ikinci mesajda önceki konuşma modele gider", async () => {
  const ctx = fakeCtx([
    plan([{ ad: "hatirlatma_ekle", tarih: "2026-11-15", saat: "14:00", metin: "dişçi" }]),
    plan([], { cevap: "Rica ederim <3" }),
  ]);
  await handleMessage(msg("yarın 3'te dişçim var, bir saat önce hatırlat"), ctx);
  assert.match(ctx.sent[0], /Pazar 15\.11 14:00<\/b> için hatırlatacağım:\ndişçi/);
  assert.equal([...ctx.kv.store.keys()].filter((k) => k.startsWith("rem:")).length, 1);

  await handleMessage(msg("teşekkürler"), ctx);
  assert.equal(ctx.sent[1], "Rica ederim &lt;3");                       // modelin yazdığı güvenli hale getirilir
  assert.match(ctx.asked[1].messages[0].content, /Kullanıcı: yarın 3'te dişçim var[\s\S]*Jarvis: ✅ Tamam/);
});

test("belirli soru ve birden çok veri: cevabı model yazar, olmazsa veri olduğu gibi gelir", async () => {
  const ctx = fakeCtx([
    plan([{ ad: "dersler", tarih: "2026-11-16" }], { yorum: "evet" }),
    "İlk dersin 09:00'da EE452, B201'de.",
  ]);
  await handleMessage(msg("pazartesi ilk dersim kaçta?"), ctx);
  assert.deepEqual(ctx.sent, ["İlk dersin 09:00'da EE452, B201'de."]);
  const data = ctx.asked[1].messages[1].content;
  assert.match(data, /Soru: pazartesi ilk dersim kaçta\?/);
  assert.match(data, /09:00[\s\S]*EE452/);
  assert.doesNotMatch(data, /<b>/);                                      // modele biçim etiketi gitmez
  assert.equal(ctx.asked[1].options.schema, undefined);

  const two = fakeCtx([plan([{ ad: "dersler", tarih: "2026-11-16" }, { ad: "yemek", tarih: "2026-11-16" }]), new Error("kota")]);
  await handleMessage(msg("pazartesi günüm nasıl?"), two);
  assert.equal(two.sent.length, 2);
  assert.match(two.sent[0], /EE452/);
  assert.match(two.sent[1], /Tavuk sote/);
});

test("silme ve iptal önce onay ister", async () => {
  const ctx = fakeCtx([
    plan([{ ad: "hatirlatma_sil", metin: "Dişçi" }]),
    plan([{ ad: "hatirlatma_sil", metin: "dişçi" }]),
    plan([{ ad: "hatirlatma_sil", metin: "olmayan" }]),
  ]);
  await handleMessage(msg("/hatirlat yarın 14:00 dişçi randevusu"), ctx);
  await handleMessage(msg("/hatirlat yarın 18:00 market"), ctx);
  ctx.sent.length = 0;

  await handleMessage(msg("dişçi hatırlatmasını sil"), ctx);
  assert.match(ctx.sent.pop(), /Şunu yapayım mı\?\n<b>Hatırlatmayı sil: Pazar 15\.11 14:00 dişçi randevusu<\/b>/);
  assert.equal([...ctx.kv.store.keys()].filter((k) => k.startsWith("rem:")).length, 2);   // henüz silinmedi
  await handleMessage(msg("hayır"), ctx);
  assert.equal(ctx.sent.pop(), "Tamam, vazgeçtim.");
  assert.equal(ctx.kv.values.has(PENDING_KEY), false);

  await handleMessage(msg("dişçi hatırlatmasını sil"), ctx);
  ctx.sent.length = 0;
  await handleMessage(msg("Evet lütfen"), ctx);
  assert.equal(ctx.sent.pop(), "🗑 Silindi: Pazar 15.11 14:00 dişçi randevusu");
  const left = [...ctx.kv.store.entries()].filter(([k]) => k.startsWith("rem:"));
  assert.deepEqual(left.map(([, meta]) => meta.text), ["market"]);
  assert.equal(ctx.asked.length, 2);                                     // "hayır" ve "evet" modele sorulmadı

  await handleMessage(msg("olmayan hatırlatmayı sil"), ctx);
  assert.match(ctx.sent.pop(), /Buna uyan bir hatırlatma bulamadım/);
});

test("onay beklerken başka bir şey yazılırsa bekleyen iş düşer", async () => {
  const ctx = fakeCtx([plan([{ ad: "fitness_iptal", tarih: "2026-11-17" }]), plan([], { cevap: "İyiyim" }), plan([], { cevap: "Neye evet?" })]);
  await handleMessage(msg("salı fitness'ı iptal et"), ctx);
  assert.match(ctx.sent.pop(), /Salı 17\.11\.2026 fitness randevusunu iptal et/);
  await handleMessage(msg("nasılsın"), ctx);
  assert.equal(ctx.sent.pop(), "İyiyim");
  await handleMessage(msg("evet"), ctx);
  assert.equal(ctx.sent.pop(), "Neye evet?");                            // artık onaylanacak bir şey yok
});

test("fitness isteği normal cümleyle eklenir ve kaldırılır", async () => {
  const ctx = fakeCtx([
    plan([{ ad: "fitness_ekle", tarih: "2026-11-17", saat: "13:00", bitis: "14:30", haftalik: "evet" }]),
    plan([{ ad: "fitness_istek_sil", tarih: "2026-11-17", haftalik: "evet" }]),
  ]);
  await handleMessage(msg("her salı 1 buçuğa kadar spora yaz beni"), ctx);
  assert.match(ctx.sent.pop(), /Fitness randevusu henüz kurulmamış/);    // bu testte site bağlı değil: komuta doğru gitti

  await ctx.kv.put(STATE_KEY, JSON.stringify({ rules: [{ wd: 2, start: "13:00", end: "14:30" }, { wd: 4, start: "10:00", end: "11:30" }], slots: {} }));
  await handleMessage(msg("artık salıları gitmeyeceğim"), ctx);
  assert.match(ctx.sent.pop(), /Fitness isteğini kaldır: Her Salı 13:00-14:30/);
  assert.deepEqual(JSON.parse(ctx.kv.values.get(PENDING_KEY)), { command: "fitness", args: "sil 1", label: "Fitness isteğini kaldır: Her Salı 13:00-14:30" });
});

test("model kalıbı tutturamazsa kalıpsız yeniden sorulur; hiç cevap vermezse komutlar önerilir", async () => {
  const ctx = fakeCtx([new Error("JSON Mode couldn't be met"), '{"islemler":[],"cevap":"Merhaba!"}']);
  await handleMessage(msg("selam"), ctx);
  assert.deepEqual(ctx.sent, ["Merhaba!"]);
  assert.equal(ctx.asked[1].options.schema, undefined);

  const down = fakeCtx([new Error("kota"), new Error("kota")]);
  await handleMessage(msg("selam"), down);
  assert.deepEqual(down.sent, [AI_DOWN]);

  const empty = fakeCtx([plan([])]);
  await handleMessage(msg("???"), empty);
  assert.match(empty.sent[0], /tam anlayamadım/);
});

test("sesli mesaj yazıya çevrilir, duyulan gösterilir ve işlenir", async () => {
  const ctx = fakeCtx([plan([{ ad: "yemek", tarih: "2026-11-16" }])]);
  await handleMessage({ chat: { id: 42 }, voice: { file_id: "f1", duration: 4, file_size: 9000 } }, ctx);
  assert.equal(ctx.sent[0], "🎙 <i>yarın yemekte ne var</i>");
  assert.match(ctx.sent[1], /Tavuk sote/);

  await handleMessage({ chat: { id: 42 }, voice: { file_id: "f2", duration: 600 } }, ctx);
  assert.match(ctx.sent.pop(), /çok uzun/);

  ctx.ai.transcribe = async () => { throw new Error("indirilemedi"); };
  await handleMessage({ chat: { id: 42 }, voice: { file_id: "f3", duration: 4 } }, ctx);
  assert.match(ctx.sent.pop(), /yazıya çeviremedim/);

  const off = fakeCtx();
  off.ai = null;
  await handleMessage({ chat: { id: 42 }, voice: { file_id: "f4", duration: 4 } }, off);
  assert.match(off.sent.pop(), /henüz anlayamıyorum/);
  await handleMessage(msg("selam"), off);
  assert.equal(off.sent.pop(), "Komutları görmek için /yardim yaz.");   // yapay zekâ yoksa eskisi gibi
});

test("komutlar yapay zekâya sorulmaz; yabancı sohbet hiçbir şey tetiklemez", async () => {
  const ctx = fakeCtx([]);
  await handleMessage(msg("/hatirlatmalar"), ctx);
  await handleMessage({ chat: { id: 7 }, text: "selam" }, ctx);
  assert.equal(ctx.asked.length, 0);
  assert.equal(ctx.sent.length, 1);
});

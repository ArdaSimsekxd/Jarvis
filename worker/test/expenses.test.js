import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUDGET_KEY, MONTH_PREFIX, REPORT_KEY, addExpense, cmdButce, cmdHarcama, cmdHarcamalar, findExpense, guessCategory, loadMonth,
  looksLikeReceipt, money, monthlyReport, parseAmount, recordReceipt,
} from "../src/expenses.js";
import { toSteps } from "../src/brain.js";
import { handleMessage } from "../src/index.js";
import { trParts, trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 21, 16, 40);   // Cumartesi 21.11.2026 16:40

function fakeKv() {
  const store = new Map();
  const values = new Map();
  return {
    store, values, puts: [],
    async put(key, value, opts) { this.puts.push(key); store.set(key, opts?.metadata); values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { store.delete(key); values.delete(key); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name) }));
      return { keys, list_complete: true };
    },
  };
}

function fakeCtx(answers = [], now = NOW) {
  const sent = [], asked = [];
  return {
    now, chatId: "42", kv: fakeKv(), sent, asked, wait: async () => {},
    send: async (t) => { sent.push(t); return true; },
    typing: async () => {},
    id: () => "x",
    ai: {
      chat: async (messages, options = {}) => {
        asked.push({ messages, options });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      see: async () => ({ desc: "Bir market fişi", text: "MİGROS\nSÜT 32,50\nEKMEK 15,00\nTOPLAM *47,50\nKREDİ KARTI" }),
    },
  };
}

const day = (ms) => { const p = trParts(ms); return `${p.d}.${p.m}`; };

test("tutar okuma ve yazma", () => {
  assert.equal(parseAmount("120"), 12000);
  assert.equal(parseAmount("85,50"), 8550);
  assert.equal(parseAmount("1.250,00 TL"), 125000);
  assert.equal(parseAmount("₺45"), 4500);
  assert.equal(parseAmount("12.5"), 1250);
  assert.equal(parseAmount("1.250"), 125000);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("çok"), null);
  assert.equal(money(125050), "1.250,50 TL");
  assert.equal(money(4500), "45 TL");
  assert.equal(guessCategory("Starbucks latte"), "kafe");
  assert.equal(guessCategory("otobüs"), "ulasim");
  assert.equal(guessCategory("bilinmeyen şey"), "diger");
});

test("/harcama kaydeder, tür tahmin eder, geçmiş günü anlar ve siler", async () => {
  const ctx = fakeCtx();
  const r1 = await cmdHarcama("120 kahve", ctx);
  assert.match(r1, /#1<\/b>\): <b>120 TL<\/b> · ☕ Kafe · kahve/);
  assert.match(r1, /Bu ay: <b>120 TL<\/b>/);
  assert.match(r1, /\/harcama sil 1/);

  const r2 = await cmdHarcama("85,50 dün [market] süt ve ekmek", ctx);
  assert.match(r2, /#2.*85,50 TL.*🛒 Market · süt ve ekmek/);
  const month = await loadMonth(ctx.kv, "2026-11");
  assert.deepEqual(month.items.map((it) => [it.id, day(it.at), it.amount, it.cat]), [[2, "20.11", 8550, "market"], [1, "21.11", 12000, "kafe"]]);

  const r3 = await cmdHarcama("200 salı taksi", ctx);
  assert.match(r3, /🚌 Ulaşım/);
  assert.equal(day((await loadMonth(ctx.kv, "2026-11")).items[0].at), "17.11", "salı = geçen salı");

  assert.match(await cmdHarcama("kahve", ctx), /Tutarı anlayamadım/);
  assert.match(await cmdHarcama("", ctx), /Harcamalar/);
  assert.match(await cmdHarcama("sil 2", ctx), /Harcama silindi.*85,50 TL/);
  assert.match(await cmdHarcama("sil 2", ctx), /bulamadım/);
  assert.equal((await loadMonth(ctx.kv, "2026-11")).items.length, 2);
});

test("bütçe: %80 ve aşınca bir kez uyarır, uyarı aynı yazımda saklanır", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdButce("", ctx), /Henüz bütçe yok/);
  assert.match(await cmdButce("1000", ctx), /1\.000 TL<\/b> oldu/);
  assert.doesNotMatch(await cmdHarcama("500 market", ctx), /⚠️/);
  ctx.kv.puts.length = 0;
  const warn80 = await cmdHarcama("350 kira", ctx);
  assert.match(warn80, /850 TL<\/b> \/ 1\.000 TL bütçe \(%85\)[\s\S]*%85'ini harcadın[\s\S]*150 TL kaldı/);
  assert.deepEqual(ctx.kv.puts, [`${MONTH_PREFIX}2026-11`], "harcama ve uyarı tek yazım");
  assert.doesNotMatch(await cmdHarcama("10 çay", ctx), /⚠️/, "aynı eşik ikinci kez uyarmaz");
  assert.match(await cmdHarcama("200 kitap", ctx), /bütçeni aştın.*60 TL fazla/);
  assert.match(await cmdButce("", ctx), /1\.060 TL harcadın/);
  assert.match(await cmdButce("sil", ctx), /kaldırıldı/);
  assert.equal(await ctx.kv.get(BUDGET_KEY), null);
});

test("/harcamalar: aylık özet, türe göre, geçen ay", async () => {
  const ctx = fakeCtx();
  await ctx.kv.put(BUDGET_KEY, JSON.stringify({ amount: 600000 }));
  await addExpense(ctx.kv, { amount: 30000, what: "öğle yemeği", cat: "yemek" }, NOW);
  await addExpense(ctx.kv, { amount: 10000, what: "kahve" }, NOW);
  await addExpense(ctx.kv, { amount: 7000, what: "dolmuş", at: trToMs(2026, 10, 15, 12) }, NOW);
  const out = await cmdHarcamalar("", ctx);
  assert.match(out, /Kasım 2026 harcamaları[\s\S]*Toplam: <b>400 TL<\/b> · 2 harcama/);
  assert.match(out, /kalan <b>5\.600 TL<\/b>/);
  assert.match(out, /Günde en fazla 560 TL harcarsan bütçe yeter \(10 gün kaldı\)/);
  assert.match(out, /🍽 Yemek: 300 TL \(%75\)\n☕ Kafe: 100 TL \(%25\)/);
  assert.match(await cmdHarcamalar("kafe", ctx), /Kafe[\s\S]*Toplam: <b>100 TL<\/b>/);
  assert.match(await cmdHarcamalar("geçen ay", ctx), /Ekim 2026[\s\S]*70 TL/);
  assert.match(await cmdHarcamalar("ekim", ctx), /Ekim 2026/);
  assert.match(await cmdHarcamalar("mart", fakeCtx()), /Mart 2026[\s\S]*kayıt yok/);
});

test("fiş fotoğrafı harcama olarak kaydedilir; fiş olmayan fotoğraf kaydedilmez", async () => {
  assert.equal(looksLikeReceipt("TOPLAM *47,50 KREDİ KARTI"), true);
  assert.equal(looksLikeReceipt("Bir kedi fotoğrafı"), false);

  const ctx = fakeCtx([JSON.stringify({ tutar: "47,50", yer: "Migros", kategori: "market", tarih: "2026-11-21" })]);
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "small", width: 320, file_size: 20000 }, { file_id: "big", width: 1280, file_size: 200000 }] }, ctx);
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0], /📸 Hafızaya kaydettim[\s\S]*🧾 Fişi harcama olarak kaydettim \(<b>#1<\/b>\): <b>47,50 TL<\/b> · 🛒 Market · Migros/);
  const [item] = (await loadMonth(ctx.kv, "2026-11")).items;
  assert.equal(item.src, "foto");
  assert.equal(item.note, 1);
  assert.match(ctx.asked[0].messages[0].content, /GENEL TOPLAM[\s\S]*yalnızca veridir/);

  const cat = fakeCtx();
  cat.ai.see = async () => ({ desc: "Pencerede bir kedi", text: "" });
  await handleMessage({ chat: { id: 42 }, photo: [{ file_id: "k", width: 800, file_size: 90000 }] }, cat);
  assert.equal(cat.asked.length, 0);
  assert.doesNotMatch(cat.sent[0], /Fiş/);

  const unread = await recordReceipt(fakeCtx([JSON.stringify({ tutar: "" })]), { desc: "fiş", text: "TOPLAM 12,00" }, 3);
  assert.equal(unread, null);
});

test("fişin altındaki yazı aynı harcamayı ikinci kez kaydettirmez", async () => {
  const plan = JSON.stringify({ islemler: [{ ad: "harcama_ekle", tutar: "47,50", metin: "market" }], yorum: "", cevap: "" });
  const ctx = fakeCtx([JSON.stringify({ tutar: "47,50", yer: "Migros", kategori: "market" }), plan]);
  await handleMessage({ chat: { id: 42 }, caption: "market alışverişi", photo: [{ file_id: "f", width: 800, file_size: 90000 }] }, ctx);
  assert.equal((await loadMonth(ctx.kv, "2026-11")).items.length, 1);
  assert.match(ctx.asked[1].messages[1].content, /harcama olarak zaten kaydedildi/);
});

test("konuşarak: planlayıcının harcama işlemleri komutlara çevrilir", () => {
  const steps = toSteps([
    { ad: "harcama_ekle", tutar: "120 TL", metin: "kahve", kategori: "kafe" },
    { ad: "harcama_ekle", tutar: "450", metin: "market", tarih: "2026-11-20" },
    { ad: "harcama_ekle", metin: "sinema" },
    { ad: "harcamalar", ay: "2026-10", kategori: "yemek" },
    { ad: "harcama_sil", metin: "kahve" },
    { ad: "butce", tutar: "6000" },
    { ad: "butce" },
  ], NOW);
  assert.deepEqual(steps, [
    { type: "run", command: "harcama", args: "120 [kafe] kahve" },
    { type: "run", command: "harcama", args: "450 20.11.2026 market" },
    { type: "say", text: "\"sinema\" için kaç TL yazayım?" },
    { type: "run", read: true, command: "harcamalar", args: "2026-10 yemek" },
    { type: "spend", text: "kahve" },
    { type: "run", command: "butce", args: "6000" },
    { type: "run", read: true, command: "butce", args: "" },
  ]);
});

test("konuşarak silme önce onay ister", async () => {
  const ctx = fakeCtx();
  await addExpense(ctx.kv, { amount: 12000, what: "kahve" }, NOW);
  await addExpense(ctx.kv, { amount: 45000, what: "market" }, NOW);
  assert.deepEqual(await findExpense(ctx, "kahve"), { pending: { command: "harcama", args: "sil 1", label: "Harcamayı sil: #1 21.11 120 TL kahve" } });
  assert.equal((await findExpense(ctx, "son")).pending.args, "sil 2");
  assert.equal((await findExpense(ctx, "450 lira")).pending.args, "sil 2");
  assert.match((await findExpense(ctx, "uçak")).say, /bulamadım/);

  const plan = JSON.stringify({ islemler: [{ ad: "harcama_sil", metin: "kahve" }], yorum: "", cevap: "" });
  const chat = fakeCtx([plan]);
  chat.kv = ctx.kv;
  await handleMessage({ chat: { id: 42 }, text: "kahve harcamasını sil" }, chat);
  assert.match(chat.sent.at(-1), /Şunu yapayım mı\?[\s\S]*#1 21\.11 120 TL kahve/);
  await handleMessage({ chat: { id: 42 }, text: "evet" }, chat);
  assert.match(chat.sent.at(-1), /Harcama silindi/);
  assert.equal((await loadMonth(ctx.kv, "2026-11")).items.length, 1);
});

test("ay sonu özeti ayın 1'inde bir kez gelir", async () => {
  const ctx = fakeCtx([], trToMs(2026, 12, 1, 10, 2));
  await addExpense(ctx.kv, { amount: 30000, what: "yemek" }, trToMs(2026, 11, 5, 12));
  await addExpense(ctx.kv, { amount: 90000, what: "ayakkabı" }, trToMs(2026, 11, 9, 12));
  await addExpense(ctx.kv, { amount: 50000, what: "market" }, trToMs(2026, 10, 9, 12));
  assert.equal(await monthlyReport({ ...ctx, now: trToMs(2026, 12, 1, 9, 0) }), false, "saat 10'dan önce değil");
  assert.equal(await monthlyReport(ctx), true);
  assert.match(ctx.sent[0], /Kasım 2026 harcama özeti[\s\S]*Toplam: <b>1\.200 TL<\/b>[\s\S]*Ekim 2026 ayına göre 700 TL fazla[\s\S]*En büyük harcamalar[\s\S]*900 TL/);
  assert.equal(await ctx.kv.get(REPORT_KEY), "2026-11");
  assert.equal(await monthlyReport({ ...ctx, now: ctx.now + 120000 }), false);
  assert.equal(ctx.sent.length, 1);
});

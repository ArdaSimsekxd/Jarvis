import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMessage } from "../src/index.js";
import { STATE_KEY, dueSlots, parseFitness, runFitness, wantedSlots } from "../src/fitness.js";
import { trToMs } from "../src/logic.js";

// Cuma 13.11.2026 10:00 Türkiye saati
const NOW = trToMs(2026, 11, 13, 10, 0);
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

test("fitness komutu ayrıştırma", () => {
  assert.deepEqual(parseFitness("", NOW), { action: "list" });
  assert.deepEqual(parseFitness("salı 13:00-14:30", NOW), { action: "add", rule: { wd: 2, start: "13:00", end: "14:30" } });
  assert.deepEqual(parseFitness("Her ÇARŞAMBA 9.30 - 11", NOW), { action: "add", rule: { wd: 3, start: "09:30", end: "11:00" } });
  assert.deepEqual(parseFitness("cuma 16:00", NOW), { action: "add", rule: { wd: 5, start: "16:00", end: "17:30" } });   // bitiş yoksa 90 dk
  assert.deepEqual(parseFitness("27.11 13:00-14:30", NOW), { action: "add", rule: { date: "2026-11-27", start: "13:00", end: "14:30" } });
  assert.deepEqual(parseFitness("yarın 13", NOW), { action: "add", rule: { date: "2026-11-14", start: "13:00", end: "14:30" } });
  assert.deepEqual(parseFitness("bu cuma 13:00", NOW), { action: "add", rule: { date: "2026-11-13", start: "13:00", end: "14:30" } });
  assert.deepEqual(parseFitness("bu cuma 09:00", NOW), { action: "add", rule: { date: "2026-11-20", start: "09:00", end: "10:30" } });   // saat geçmiş: haftaya
  assert.deepEqual(parseFitness("sil 2", NOW), { action: "remove", n: 2 });
  assert.deepEqual(parseFitness("iptal 17.11", NOW), { action: "cancel", date: "2026-11-17" });
  assert.deepEqual(parseFitness("iptal salı", NOW), { action: "cancel", date: "2026-11-17" });
  assert.deepEqual(parseFitness("dene", NOW), { action: "retry" });
  assert.equal(parseFitness("bugün 09:00", NOW).error, "past");
  for (const bad of ["salı", "salı 25:00", "salı 14:00-13:00", "bilmem 13:00", "sil x", "iptal", "13:00"]) {
    assert.equal(parseFitness(bad, NOW).error, "format", bad);
  }
});

test("fitness: hangi randevular açık", () => {
  const rules = [{ wd: 2, start: "13:00", end: "14:30" }, { wd: 5, start: "09:00", end: "10:30" }, { date: "2026-12-10", start: "13:00", end: "14:30" }];
  // Bugün cuma 10:00: bugünkü 09:00 geçti; 27.11 09:00 tam 14 gün içinde kalıyor; 10.12 henüz açılmadı.
  assert.deepEqual(wantedSlots(rules, NOW).map((s) => s.key), [
    "2026-11-17 13:00-14:30", "2026-11-20 09:00-10:30", "2026-11-24 13:00-14:30", "2026-11-27 09:00-10:30",
  ]);
  // 14 gün sınırı saate göre: salı 13:00 randevusu iki hafta önce salı 13:00'te açılır.
  const tue = [{ wd: 2, start: "13:00", end: "14:30" }];
  assert.deepEqual(wantedSlots(tue, trToMs(2026, 11, 17, 12, 58)).map((s) => s.date), ["2026-11-17", "2026-11-24"]);
  assert.deepEqual(wantedSlots(tue, trToMs(2026, 11, 17, 13, 0)).map((s) => s.date), ["2026-11-24"]);
  assert.deepEqual(wantedSlots(tue, trToMs(2026, 11, 17, 13, 2)).map((s) => s.date), ["2026-11-24", "2026-12-01"]);

  const state = { rules: tue, slots: { "2026-11-17 13:00-14:30": { ref: "abc" }, "2026-11-24 13:00-14:30": { fails: 1, next: NOW + 30 * MIN } } };
  assert.deepEqual(dueSlots(state, NOW), []);
  assert.deepEqual(dueSlots(state, NOW + 31 * MIN).map((s) => s.date), ["2026-11-24"]);
  state.slots["2026-11-24 13:00-14:30"] = { skip: true };
  assert.deepEqual(dueSlots(state, NOW + 31 * MIN), []);
});

function fakeKv() {
  const values = new Map();
  return {
    values,
    async put(key, value) { values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { values.delete(key); },
    async list() { return { keys: [], list_complete: true }; },
  };
}

// Sahte rezervasyon sitesi: resmi API'nin kullandığımız uçları.
function fakeSite({ password = "pw", reject = null, existing = [] } = {}) {
  const site = { calls: [], reservations: [...existing], logins: 0, signouts: 0, down: false, reject };
  const raw = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text });
  const json = (status, body) => raw(status, JSON.stringify(body));
  // Gerçek site, bu alanlar istekte yoksa HTTP 500 ve düz yazı döndürüyor.
  const REQUIRED = ["title", "description", "allowParticipation", "termsAccepted"];
  site.fetch = async (url, init) => {
    if (site.down) throw new Error("ağ yok");
    const path = url.replace("https://site.test/Web/Services/index.php/", "");
    const body = init.body ? JSON.parse(init.body) : null;
    site.calls.push(`${init.method} ${path.split("?")[0]}`);
    if (path === "Authentication/Authenticate") {
      site.logins += 1;
      return body.username === "ogrenci" && body.password === password
        ? json(200, { sessionToken: "tok", userId: 7, isAuthenticated: true })
        : json(200, { sessionToken: null, userId: null, isAuthenticated: false, message: "Login credentials rejected" });
    }
    if (path === "Authentication/SignOut") { site.signouts += 1; return raw(200, ""); }
    assert.equal(init.headers["X-Booked-SessionToken"], "tok");
    assert.equal(init.headers["X-Booked-UserId"], "7");
    if (init.method === "GET" && path === "Accessories/") return json(200, { accessories: [{ id: 4, name: "havlu" }, { id: 9, name: "Fitness Number" }] });
    if (init.method === "GET" && path.startsWith("Reservations/?")) {
      assert.match(path, /userId=7&resourceId=3&startDateTime=2026-\d\d-\d\dT[\d%A]+%2B0000&endDateTime=/);
      return json(200, { reservations: site.reservations.map((r) => ({ referenceNumber: r.ref, startDate: r.startDate, userId: 7, resourceId: 3 })) });
    }
    if (init.method === "POST" && path === "Reservations/") {
      if (site.crash || REQUIRED.some((k) => !(k in body))) return raw(500, "Exception was logged.");
      if (site.reject) return json(400, { errors: [site.reject], message: null });
      const ref = `ref${site.reservations.length + 1}`;
      site.reservations.push({ ref, ...body });
      return json(201, { referenceNumber: ref, isPendingApproval: false });
    }
    if (init.method === "DELETE" && path.startsWith("Reservations/")) {
      const ref = path.split("/")[1];
      site.reservations = site.reservations.filter((r) => r.ref !== ref);
      return json(200, { message: "The item was deleted" });
    }
    return json(404, null);
  };
  return site;
}

function fakeCtx(site, now = NOW) {
  const sent = [];
  return {
    now, chatId: "42", kv: fakeKv(), sent,
    send: async (t) => { sent.push(t); return true; },
    booked: { url: "https://site.test/Web/", username: "ogrenci", password: "pw", resourceId: 3, fetch: site.fetch },
  };
}
const msg = (text) => ({ chat: { id: 42 }, text });
const stateOf = (ctx) => JSON.parse(ctx.kv.values.get(STATE_KEY));

test("fitness uçtan uca: haftalık istek, açılınca alma, iptal, kaldırma", async () => {
  const site = fakeSite();
  const ctx = fakeCtx(site);

  await handleMessage(msg("/fitness"), ctx);
  assert.match(ctx.sent.pop(), /\/fitness salı 13:00-14:30/);   // istek yokken kullanım anlatılır
  assert.equal(site.logins, 0);

  // Haftalık istek: açık olan iki salı hemen alınır.
  await handleMessage(msg("/fitness salı 13:00-14:30"), ctx);
  const reply = ctx.sent.pop();
  assert.match(reply, /Her <b>Salı 13:00–14:30<\/b> için randevu alacağım/);
  assert.match(reply, /✅ <b>Salı 17\.11 13:00–14:30<\/b> alındı/);
  assert.match(reply, /✅ <b>Salı 24\.11 13:00–14:30<\/b> alındı/);
  assert.deepEqual(site.calls, ["POST Authentication/Authenticate", "GET Reservations/", "GET Accessories/", "POST Reservations/", "POST Reservations/", "POST Authentication/SignOut"]);
  assert.deepEqual(site.reservations[0], {
    ref: "ref1", resourceId: 3, userId: 7, title: "", description: "",
    startDateTime: "2026-11-17T13:00:00+0300", endDateTime: "2026-11-17T14:30:00+0300",
    accessories: [{ accessoryId: 9, quantityRequested: 1 }],   // kişi sayısı: 1
    customAttributes: [], resources: [], participants: [], invitees: [], participatingGuests: [], invitedGuests: [],
    recurrenceRule: null, startReminder: null, endReminder: null, allowParticipation: false, retryParameters: [], termsAccepted: false,
  });

  // Zamanlayıcı: alınacak yeni bir şey yokken siteye hiç gitmez.
  site.calls.length = 0;
  await runFitness(ctx);
  assert.deepEqual(site.calls, []);
  assert.deepEqual(ctx.sent, []);

  // İki hafta sonraki salı aynı saatte açılır: zamanlayıcı alır ve haber verir.
  ctx.now = trToMs(2026, 11, 17, 13, 0);
  await runFitness(ctx);
  assert.deepEqual(site.calls, []);
  ctx.now = trToMs(2026, 11, 17, 13, 2);
  await runFitness(ctx);
  assert.equal(site.reservations.at(-1).startDateTime, "2026-12-01T13:00:00+0300");
  assert.match(ctx.sent.pop(), /✅ <b>Salı 01\.12 13:00–14:30<\/b> alındı/);
  assert.equal(stateOf(ctx).slots["2026-11-13 13:00-14:30"], undefined);

  // Liste
  await handleMessage(msg("/fitness"), ctx);
  const list = ctx.sent.pop();
  assert.match(list, /1\. Her Salı 13:00–14:30/);
  assert.match(list, /✅ Salı 24\.11 13:00–14:30\n✅ Salı 01\.12 13:00–14:30/);

  // Bir günü iptal: sitedeki randevu silinir ve o gün yeniden alınmaz.
  await handleMessage(msg("/fitness iptal 24.11"), ctx);
  assert.match(ctx.sent.pop(), /🚫 <b>Salı 24\.11 13:00–14:30<\/b> iptal edildi/);
  assert.equal(site.reservations.some((r) => r.startDateTime?.startsWith("2026-11-24")), false);
  site.calls.length = 0;
  ctx.now += 10 * MIN;
  await runFitness(ctx);
  assert.deepEqual(site.calls, []);

  // İsteği kaldır: artık yeni randevu alınmaz.
  await handleMessage(msg("/fitness sil 1"), ctx);
  assert.match(ctx.sent.pop(), /Kaldırıldı: Her <b>Salı 13:00–14:30<\/b>/);
  ctx.now += 7 * DAY;
  await runFitness(ctx);
  assert.deepEqual(site.calls, []);
  await handleMessage(msg("/fitness sil 1"), ctx);
  assert.equal(ctx.sent.pop(), "Kaldırılacak istek yok.");
});

test("fitness: tek seferlik istek açılınca alınır, elle alınmış randevu yeniden alınmaz", async () => {
  const site = fakeSite({ existing: [{ ref: "elle", startDate: "2026-11-20T10:00:00+0000" }] });   // 20.11 13:00 Türkiye saati
  const ctx = fakeCtx(site);

  await handleMessage(msg("/fitness 20.11 13:00-14:30"), ctx);
  assert.match(ctx.sent.pop(), /✅ <b>Cuma 20\.11 13:00–14:30<\/b> zaten sende/);
  assert.equal(site.calls.includes("POST Reservations/"), false);

  await handleMessage(msg("/fitness 10.12 18:00"), ctx);
  assert.match(ctx.sent.pop(), /<b>Perşembe 10\.12 18:00–19:30<\/b> için randevu alacağım\.\nRandevular en fazla 2 hafta öncesinden açılıyor/);
  ctx.now = trToMs(2026, 11, 26, 18, 1);
  await runFitness(ctx);
  assert.match(ctx.sent.pop(), /✅ <b>Perşembe 10\.12 18:00–19:30<\/b> alındı/);

  // Günü geçince tek seferlik istek kendiliğinden kalkar.
  ctx.now = trToMs(2026, 12, 11, 9, 0);
  await runFitness(ctx);
  assert.deepEqual(stateOf(ctx).rules, []);
  assert.deepEqual(stateOf(ctx).slots, {});
});

test("fitness: site reddederse bir kez haber verir, aralıklarla yeniden dener", async () => {
  const site = fakeSite({ reject: "Kontenjan <dolu>" });
  const ctx = fakeCtx(site);
  ctx.kv.values.set(STATE_KEY, JSON.stringify({ rules: [{ wd: 2, start: "13:00", end: "14:30" }], slots: { "2026-11-24 13:00-14:30": { ref: "x" } } }));

  await runFitness(ctx);
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0], /⚠️ <b>Salı 17\.11 13:00–14:30<\/b> alınamadı\. Sitenin cevabı: Kontenjan &lt;dolu&gt;/);
  assert.equal(site.logins, 1);

  ctx.now += 10 * MIN;            // bekleme süresi dolmadan siteye gidilmez
  await runFitness(ctx);
  assert.equal(site.logins, 1);

  ctx.now += 25 * MIN;            // yarım saat sonra sessizce yeniden dener
  await runFitness(ctx);
  assert.equal(site.logins, 2);
  assert.equal(ctx.sent.length, 1);

  site.reject = null;             // yer açıldı: alır ve haber verir
  ctx.now += 31 * MIN;
  await runFitness(ctx);
  assert.match(ctx.sent[1], /✅ <b>Salı 17\.11 13:00–14:30<\/b> alındı/);

  // "/fitness dene" beklemeden yeniden dener
  site.reject = "dolu";
  const ctx2 = fakeCtx(site);
  await handleMessage(msg("/fitness salı 13:00"), ctx2);
  assert.match(ctx2.sent.pop(), /alınamadı[\s\S]*aralıklarla yeniden deneyeceğim/);
  site.reject = null;
  await handleMessage(msg("/fitness dene"), ctx2);
  assert.match(ctx2.sent.pop(), /✅ <b>Salı 17\.11 13:00–14:30<\/b> alındı/);
});

test("fitness: yanlış şifrede sık denemez; siteye ulaşılamazsa söyler; kurulmamışsa yönlendirir", async () => {
  const site = fakeSite({ password: "başka" });
  const ctx = fakeCtx(site);
  await handleMessage(msg("/fitness salı 13:00"), ctx);
  assert.match(ctx.sent.pop(), /Siteye giriş yapamadım/);
  assert.equal(site.logins, 1);
  ctx.now += 5 * 60 * MIN;        // 5 saat boyunca yeniden giriş denemesi yok (hesap kilitlenmesin)
  await runFitness(ctx);
  assert.equal(site.logins, 1);
  ctx.now += 61 * MIN;
  await runFitness(ctx);
  assert.equal(site.logins, 2);

  // Mevcut randevular okunamıyorsa çift randevu riskine girmez, hiç almaz.
  const blind = fakeSite();
  const realFetch = blind.fetch;
  blind.fetch = async (url, init) => (init.method === "GET" && url.includes("/Reservations/?") ? { status: 500, ok: false, text: async () => "" } : realFetch(url, init));
  const ctx4 = fakeCtx(blind);
  await handleMessage(msg("/fitness salı 13:00"), ctx4);
  assert.match(ctx4.sent.pop(), /Siteye ulaşamadım/);
  assert.equal(blind.calls.includes("POST Reservations/"), false);
  assert.equal(blind.signouts, 1);

  // Site kendi içinde hata verirse (JSON olmayan cevap) durum kodu ve kısa metin gösterilir.
  const broken = fakeSite();
  broken.crash = true;
  const ctx5 = fakeCtx(broken);
  await handleMessage(msg("/fitness salı 13:00"), ctx5);
  assert.match(ctx5.sent.pop(), /Sitenin cevabı: HTTP 500 \(Exception was logged\.\)/);

  const down = fakeSite();
  down.down = true;
  const ctx2 = fakeCtx(down);
  await handleMessage(msg("/fitness salı 13:00"), ctx2);
  assert.match(ctx2.sent.pop(), /Siteye ulaşamadım/);

  const ctx3 = { ...fakeCtx(fakeSite()), booked: null };
  await handleMessage(msg("/fitness salı 13:00"), ctx3);
  assert.match(ctx3.sent.pop(), /henüz kurulmamış/);
  assert.deepEqual(await runFitness(ctx3), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE, BUS_KEY, INDEX_KEY, busLocation, crawlBus, cmdOtobus, formatStop, groupByLine, learnLines, nearestStops, parseArrivals, parseMapStops,
  parseStops, titleTr,
} from "../src/bus.js";
import { toSteps } from "../src/brain.js";
import { handleMessage } from "../src/index.js";
import { trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 22, 13, 12);
const ARRIVE = `${BASE}/OtobusTramvayHatlari/DurakDetay?DurakID=`;
const SEARCH = `${BASE}/OtobusTramvayHatlari/DurakListInp/`;
const MAP = `${BASE}/OtobusTramvayHatlari/OtobusDuraklariHaritaJSON`;
const AGU = { lat: 38.740692, lon: 35.476428 };

// kayseriulasim.com'un 7548 (AGÜ) durağı için verdiği cevap, sadeleştirilmiş
const line = (code, name, min, type = "bus") => ({ name: null, line: { code, description: code, name, type, city: { code: "KAY", name: "Kayseri", id: "6" }, id: "-1" }, timeToStop: min, busLineDirection: "ARRIVAL", stop: null });
const ARRIVALS = [
  line("448", "ŞEHİR MERKEZİ - ERKİLET 5 KATLI", 5),
  line("15", "15 TE TALAS - ERKİLET", 10),
  line("206", "ŞEHİR MERKEZİ -YEŞİL MAHALLE İSTASYON CAD.", 10),
  line("485", "ŞEHİR MERKEZİ- ERTUĞRUL GAZİ MAH.-CAMİKEBİR", 13),
  line("449", "ŞEHİR MERKEZİ - ERKİLET ORTAYOL", 17),
  line("485", "ŞEHİR MERKEZİ- ERTUĞRUL GAZİ MAH.-CAMİKEBİR", 23),
  line("441", "ŞEHİR MERKEZİ-ERKİLET 5 KATLI ÇORAKLI", 27),
];
const SEARCH_7548 = [{ DURAK_ADI: "7548-ERKİLET BULV.AGÜ 1", DURAK_TURU: "", DURAK_NO: "7548", DURAK_ID: "7548", HAT_NO: null }];
const mapStop = (DurakAdi, DurakNo, Lat, Lng) => ({ DurakAdi, DurakNo, BirOncekiDuraklaMesafe: null, Lat, Lng, SiraNo: "BUS" });
const LINE_448 = [
  mapStop("ERKİLET BLV 7", "449", "38.742777", "35.475193"),
  mapStop("ERKİLET BLV 5 AGÜ", "7548", "38.740691996", "35.476427824"),
  mapStop("ERKİLET BLV 3 EMNİYET MÜDÜRLÜĞÜ", "288", "38.73633069", "35.47909851"),
  mapStop("HUNAT 1", "14", "38.720008", "35.490761"),
];

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return { values, async get(k) { return values.get(k) ?? null; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}

function fakeCtx({ kv = fakeKv(), routes = {} } = {}) {
  const calls = [], sent = [];
  const all = {
    [ARRIVE]: { status: 200, body: ARRIVALS },
    [SEARCH]: { status: 200, body: SEARCH_7548 },
    [MAP]: (url) => ({ status: 200, body: url.includes("lineId=448&") ? LINE_448 : [] }),
    ...routes,
  };
  return {
    now: NOW, kv, calls, sent, chatId: "1",
    send: async (t) => { sent.push(t); return true; },
    webFetch: async (url, init = {}) => {
      calls.push({ url, init });
      const hit = Object.entries(all).find(([prefix]) => url.startsWith(prefix));
      if (!hit) throw new Error(`beklenmeyen istek ${url}`);
      const r = typeof hit[1] === "function" ? hit[1](url, init) : hit[1];
      if (r instanceof Error) throw r;
      return { ok: r.status === 200, status: r.status, headers: new Headers({ "content-type": "application/json; charset=utf-8" }), json: async () => r.body, text: async () => JSON.stringify(r.body) };
    },
  };
}

test("otobüs: adlar düzgün yazılır", () => {
  assert.equal(titleTr("ŞEHİR MERKEZİ- ERTUĞRUL GAZİ MAH.-CAMİKEBİR"), "Şehir Merkezi - Ertuğrul Gazi Mah. - Camikebir");
  assert.equal(titleTr("ERKİLET BULV.AGÜ 1"), "Erkilet Bulv. AGÜ 1");
  assert.equal(titleTr("OSB VE TALAS"), "OSB ve Talas");
  assert.equal(titleTr("ERKİLET BLV 43 İTFAYE "), "Erkilet Blv 43 İtfaye");
});

test("otobüs: geliş süreleri okunur, aynı hat tek satır olur", () => {
  const list = parseArrivals([...ARRIVALS, line("99", "BOZUK", -3), line("", "ADSIZ", 4), { line: null }, line("T1", "TRAMVAY", 2, "tram")]);
  assert.deepEqual(list.map((x) => [x.code, x.min]), [["T1", 2], ["448", 5], ["15", 10], ["206", 10], ["485", 13], ["449", 17], ["485", 23], ["441", 27]]);
  assert.equal(list.find((x) => x.code === "15").name, "Talas - Erkilet", "baştaki '15 TE' atılır");
  assert.equal(list[0].type, "tram");
  assert.deepEqual(parseArrivals({ hata: 1 }), []);
  assert.equal(parseArrivals({ list: ARRIVALS }).length, 7, "sarılı liste de okunur");
  const lines = groupByLine(parseArrivals(ARRIVALS));
  assert.deepEqual(lines.find((l) => l.code === "485").mins, [13, 23]);
  const text = formatStop({ id: "7548", label: "okul" }, parseArrivals(ARRIVALS), NOW);
  assert.match(text, /^🚌 <b>okul durağı<\/b> \(7548\) · 13:12/);
  assert.match(text, /<b>485<\/b> Şehir Merkezi - Ertuğrul Gazi Mah\. - Camikebir · 13 dk, 23 dk/);
  assert.match(formatStop({ id: "1", name: "X", km: 0.123 }, [], NOW), /X<\/b> \(1\) · 13:12 · 120\u00a0m uzakta\nŞu an bu durağa yaklaşan otobüs görünmüyor/);
});

test("otobüs: durak arama ve harita cevapları okunur", () => {
  assert.deepEqual(parseStops(SEARCH_7548), [{ id: "7548", name: "Erkilet Bulv. AGÜ 1" }]);
  assert.deepEqual(parseStops([{ DURAK_ADI: "", DURAK_ID: "5" }, { DURAK_ADI: "A", DURAK_ID: "x" }]), []);
  const stops = parseMapStops([...LINE_448, mapStop("BOZUK", "12", "0", "0"), mapStop("ADSIZ", "", "38.7", "35.4")]);
  assert.equal(stops.length, 4);
  assert.deepEqual(stops[1], { id: "7548", name: "Erkilet Blv 5 AGÜ", lat: 38.740691996, lon: 35.476427824 });
});

test("otobüs: durak numarasıyla sorulur, adı siteden gelir, hatların durakları öğrenilir", async () => {
  const ctx = fakeCtx();
  const text = await cmdOtobus("7548", ctx);
  assert.match(text, /^🚌 <b>Erkilet Bulv\. AGÜ 1<\/b> \(7548\)/);
  assert.match(text, /<b>15<\/b> Talas - Erkilet · 10 dk/);
  const arrive = ctx.calls.find((c) => c.url.startsWith(ARRIVE));
  assert.equal(arrive.url, `${ARRIVE}7548`);
  assert.equal(arrive.init.method, undefined, "GET");
  assert.equal(arrive.init.headers["Content-Type"], undefined);
  assert.equal(arrive.init.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(ctx.calls.find((c) => c.url.startsWith(SEARCH)).init.body, JSON.stringify({ Search: "7548" }));
  const maps = ctx.calls.filter((c) => c.url.startsWith(MAP)).map((c) => c.url.slice(MAP.length));
  assert.deepEqual(maps.slice(0, 2), ["?lineId=448&directions=1", "?lineId=448&directions=2"]);
  assert.equal(maps.length, 12, "duraktaki 6 hattın hepsi hemen öğrenilir");
  const index = JSON.parse(ctx.kv.values.get(INDEX_KEY));
  assert.deepEqual(index.stops["7548"], ["Erkilet Blv 5 AGÜ", 38.74069, 35.47643]);
  assert.deepEqual(Object.keys(index.lines).sort(), ["15", "206", "441", "448", "449", "485"]);
  assert.deepEqual(index.queue, []);
  // İkinci soru bilinen hatları yeniden istemez
  const again = fakeCtx({ kv: ctx.kv });
  await cmdOtobus("7548", again);
  assert.equal(again.calls.filter((c) => c.url.startsWith(MAP)).length, 0);
});

test("otobüs: kaydet, adla sor, sil", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdOtobus("ekle 7548 okul", ctx), /okul durağını kaydettim: 7548 \(Erkilet Bulv\. AGÜ 1\)\.\nSormak için: <code>\/otobus okul<\/code>/);
  assert.deepEqual(JSON.parse(ctx.kv.values.get(BUS_KEY)).stops, [{ id: "7548", label: "okul", name: "Erkilet Bulv. AGÜ 1" }]);
  assert.match(await cmdOtobus("okul", ctx), /^🚌 <b>okul durağı<\/b> \(7548\)/);
  assert.match(await cmdOtobus("", ctx), /okul durağı/);
  assert.match(await cmdOtobus("ev", ctx), /"ev" adında kayıtlı durak yok/);
  assert.match(await cmdOtobus("ekle", ctx), /Durak numarasını yazar mısın/);
  assert.match(await cmdOtobus("sil okul", ctx), /okul durağını sildim/);
  assert.match(await cmdOtobus("", ctx), /Henüz kayıtlı durak yok/);
  // Ad verilmezse sitedeki adın ilk parçası kullanılır
  assert.match(await cmdOtobus("ekle 7548", ctx), /Erkilet Blv 5 AGÜ durağını kaydettim: 7548\./);
});

test("otobüs: ad öğrenilmiş duraklardan gelir, test komutu ham cevabı gösterir", async () => {
  const kv = fakeKv({ [INDEX_KEY]: JSON.stringify({ stops: { 7548: ["Erkilet Blv 5 AGÜ", 38.74069, 35.47643] }, lines: {} }) });
  const ctx = fakeCtx({ kv, routes: { [SEARCH]: { status: 404, body: null } } });
  assert.match(await cmdOtobus("7548", ctx), /^🚌 <b>Erkilet Blv 5 AGÜ<\/b> \(7548\)/);
  assert.equal(ctx.calls.filter((c) => c.url.startsWith(SEARCH)).length, 0);
  const t = await cmdOtobus("test 7548", fakeCtx());
  assert.match(t, /<b>Geliş süreleri<\/b>: HTTP 200 · application\/json; charset=utf-8 · \d+ karakter\n<code>\[\{/);
  assert.match(t, /<b>Durak arama<\/b>: HTTP 200/);
});

test("otobüs: durak arama ve siteye ulaşılamazsa", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdOtobus("ara agü", ctx), /🚏 <b>Duraklar<\/b> · "agü"\n<code>7548<\/code> Erkilet Bulv\. AGÜ 1/);
  const down = fakeCtx({ routes: { [ARRIVE]: { status: 500, body: null }, [SEARCH]: { status: 500, body: null } } });
  assert.match(await cmdOtobus("7548", down), /Kayseri Ulaşım'a şu an ulaşamadım/);
  assert.match(await cmdOtobus("ara agü", down), /ulaşamadım/);
});

test("otobüs: konuma en yakın durak", async () => {
  const index = { stops: { 7548: ["Erkilet Blv 5 AGÜ", 38.74069, 35.47643], 449: ["Erkilet Blv 7", 38.74278, 35.47519], 14: ["Hunat 1", 38.72001, 35.49076] }, lines: {} };
  const near = nearestStops(index, { lat: 38.7405, lon: 35.4766 });
  assert.equal(near[0].id, "7548");
  assert.ok(near[0].km < 0.05);
  assert.deepEqual(nearestStops(index, { lat: 39.9, lon: 32.8 }), [], "Ankara'da yakın durak yok");

  // Hiç bilinen durak yokken: kayıtlı durağın hatlarından öğrenip bulur
  const kv = fakeKv({ [BUS_KEY]: JSON.stringify({ stops: [{ id: "7548", label: "okul" }] }) });
  const ctx = fakeCtx({ kv });
  const text = await busLocation({ latitude: AGU.lat + 0.0003, longitude: AGU.lon }, ctx);
  assert.match(text, /^🚌 <b>Erkilet Blv 5 AGÜ<\/b> \(7548\) · 13:12 · 30\u00a0m uzakta/);
  assert.match(text, /<b>448<\/b>/);
  assert.equal(kv.values.has("konum"), false);

  // Tanınmayan bir yer
  const empty = fakeCtx({ routes: { [MAP]: { status: 200, body: [] } } });
  assert.match(await busLocation({ latitude: 38.6, longitude: 35.2 }, empty), /henüz tanımıyorum/);
  assert.equal(await busLocation({ latitude: "x" }, empty), "Konumu okuyamadım.");
});

test("otobüs: Telegram konumu ve yapay zekâ adımı", async () => {
  const kv = fakeKv({ [INDEX_KEY]: JSON.stringify({ stops: { 7548: ["Erkilet Blv 5 AGÜ", 38.74069, 35.47643] }, lines: { 448: NOW, 15: NOW, 206: NOW, 485: NOW, 449: NOW, 441: NOW } }) });
  const ctx = fakeCtx({ kv });
  await handleMessage({ chat: { id: "1" }, location: { latitude: AGU.lat, longitude: AGU.lon } }, ctx);
  assert.equal(ctx.sent.length, 1);
  assert.match(ctx.sent[0], /Erkilet Blv 5 AGÜ/);
  assert.equal(ctx.calls.filter((c) => c.url.startsWith(MAP)).length, 0, "bilinen hatlar yeniden istenmez");

  const steps = toSteps([{ ad: "otobus", metin: "okul durağı" }, { ad: "otobus", metin: "7548'e" }, { ad: "otobus", metin: "" }], {});
  assert.deepEqual(steps.map((s) => [s.type, s.command, s.args]), [["private", "otobus", "okul"], ["private", "otobus", "7548"], ["private", "otobus", ""]]);
});

test("otobüs: uzaktaki bilinen durakta not düşülür", async () => {
  const kv = fakeKv({ [INDEX_KEY]: JSON.stringify({ stops: { 7548: ["Erkilet Blv 5 AGÜ", 38.74069, 35.47643] }, lines: { 448: NOW, 15: NOW, 206: NOW, 485: NOW, 449: NOW, 441: NOW } }) });
  const text = await busLocation({ latitude: AGU.lat + 0.005, longitude: AGU.lon }, fakeCtx({ kv }));
  assert.match(text, /560\u00a0m uzakta/);
  assert.match(text, /Bildiğim en yakın durak 560\u00a0m uzakta\. Yanındaki durağı henüz tanımıyor olabilirim/);
});

test("otobüs: arka plan taraması sıradaki hatları öğrenir, sonra durakları yoklar, bitince durur", async () => {
  const at = (mm) => trToMs(2026, 11, 22, 14, mm);
  const kv = fakeKv({ [BUS_KEY]: JSON.stringify({ stops: [{ id: "7548", label: "okul" }] }) });
  const run = async (mm, routes) => { const c = fakeCtx({ kv, routes }); c.now = at(mm); return [await crawlBus(c), c.calls]; };

  const [skip, none] = await run(2);
  assert.deepEqual(skip, { skipped: true });
  assert.equal(none.length, 0, "10 dakikada bir çalışır");

  // Boş başlangıç: kayıtlı durağın hatları sıraya girer, ikisi öğrenilir
  let [r, calls] = await run(10);
  assert.deepEqual(r, { learned: true, queue: 4 });
  assert.equal(calls.filter((c) => c.url.startsWith(MAP)).length, 4);
  [r] = await run(20);
  assert.deepEqual(r, { learned: true, queue: 2 });
  [r] = await run(30);
  assert.deepEqual(r, { learned: true, queue: 0 });

  // Sıra boş: bilinen duraklar yoklanır; yeni bir hat (99) bulunursa sıraya girer
  const arrivals = (url) => ({ status: 200, body: url.endsWith("=449") ? [{ line: { code: "99", name: "YENİ", type: "bus" }, timeToStop: 3 }] : ARRIVALS });
  [r, calls] = await run(40, { [ARRIVE]: arrivals });
  assert.equal(r.probed, 3);
  assert.equal(r.queue, 1);
  assert.equal(calls.filter((c) => c.url.startsWith(ARRIVE)).length, 3);
  [r] = await run(50, { [ARRIVE]: arrivals });
  assert.deepEqual(r, { learned: true, queue: 0 });
  assert.ok(JSON.parse(kv.values.get(INDEX_KEY)).lines["99"], "yeni hat öğrenildi");
  // Bütün duraklar yoklanınca istek atmadan durur
  let guard = 0;
  while (!(r.done) && guard++ < 10) [r] = await run(0, { [ARRIVE]: arrivals });
  assert.deepEqual(r, { done: true });
  const [, quiet] = await run(0, { [ARRIVE]: arrivals });
  assert.equal(quiet.length, 0);
});

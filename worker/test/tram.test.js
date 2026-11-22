import assert from "node:assert/strict";
import { test } from "node:test";
import { busLocation } from "../src/bus.js";
import { toSteps } from "../src/brain.js";
import { trToMs } from "../src/logic.js";
import {
  ARRIVAL_VARIANTS, TRAM_KEY, errorHint, fetchTramArrivals, cmdTramvay, crawlTram, findTramStops, formatTram, loadTramIndex, nearestTram, parseTramArrivals, parseTramStops, tramArrivalsUrl,
} from "../src/tram.js";

const NOW = trToMs(2026, 11, 22, 20, 55);
const MAP = "https://www.kayseriulasim.com/OtobusTramvayHatlari/OtobusDuraklariHaritaJSON?lineId=";
const ARR = "https://www.kayseriulasim.com/OtobusTramvayHatlari/AracNeZamanGelecekTramvay/";
const ILDEM5 = "cd764853-7b2c-4e16-bd41-2e2aebbd3c9a", ILDEM1 = "d9e7cbab-1996-4f65-9054-299599c49e14", CUMH = "c467e3b3-cc51-42f8-86af-00ae98501e3d";
const st = (DurakAdi, DurakNo, Lat, Lng) => ({ DurakAdi, DurakNo, BirOncekiDuraklaMesafe: null, Lat, Lng, SiraNo: "TRAMVAY" });
// kayseriulasim.com T1 hattı 2. yön (kısaltılmış, Arda'nın DevTools kaydından)
const T1 = [
  st("İldem5", ILDEM5, "38.786984", "35.6257987"),
  st("İldem4", "8c586c79-0772-44ac-bab7-9ccf132dfa3b", "38.786188", "35.6189556"),
  st("İldem1", ILDEM1, "38.782533", "35.6007001"),
  st("Cumhuriyet Meydanı", CUMH, "38.7218926", "35.4876962"),
  st("DSI-Yeni Sanayi", "848e1480-8551-4d36-8a47-d2fd107f43d0", "38.7298918", "35.445926"),
  st("bozuk", "12", "38.7", "35.4"),
];
const arr = (name, dataType, timeToStop, doorNo = "İldem5") => ({ name, dataType, line: null, doorNo, timeToStop, properties: null, guessType: 0, ringLine: 0, busLineDirection: null, stop: null, HatKonumlar: null });
const ARR_ILDEM5 = [arr("[T3] İldem - Kumsmall", "PLAN", 4), arr("[T1] İldem - Organize Sanayi", "PLAN", 14)];
const ARR_ILDEM1 = [arr("[T1] İldem - Organize Sanayi", "LIVE", 2, "İldem1"), arr("[T3] İldem - Kumsmall", "PLAN", 10, "İldem1")];

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return { values, async get(k) { return values.get(k) ?? null; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}
function fakeCtx({ kv = fakeKv(), fail = false } = {}) {
  const calls = [], cache = new Map();
  return {
    now: NOW, kv, calls,
    cache: { get: async (k) => cache.get(k) ?? null, put: async (k, v) => { cache.set(k, v); } },
    webFetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (fail) throw new Error("ağ yok");
      let body = [];
      if (url.startsWith(MAP)) body = url.includes("lineId=T1&") ? T1 : url.includes("lineId=T3&") ? T1.slice(0, 2) : [];
      else if (url === ARR + ILDEM5) body = ARR_ILDEM5;
      else if (url === ARR + ILDEM1) body = ARR_ILDEM1;
      else if (url.startsWith(ARR)) body = [];
      else if (url.includes("DurakDetay")) body = [];
      else throw new Error(`beklenmeyen istek ${url}`);
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    },
  };
}

test("tramvay: harita ve varış cevapları okunur", () => {
  const stops = parseTramStops(T1);
  assert.equal(stops.length, 5);
  assert.deepEqual(stops[0], { id: ILDEM5, name: "İldem5", lat: 38.786984, lon: 35.6257987 });
  assert.deepEqual(parseTramArrivals(ARR_ILDEM1), [
    { code: "T1", name: "İldem - Organize Sanayi", min: 2, live: true },
    { code: "T3", name: "İldem - Kumsmall", min: 10, live: false },
  ]);
  assert.deepEqual(parseTramArrivals({ x: 1 }), []);
  const text = formatTram({ name: "İldem1", km: 0.12 }, parseTramArrivals(ARR_ILDEM1), NOW);
  assert.equal(text, "🚋 <b>İldem1</b> tramvay durağı · 20:55 · 120 m uzakta\n<b>T1</b> İldem - Organize Sanayi · 2 dk\n<b>T3</b> İldem - Kumsmall · ~10 dk\n<i>~ tarifeye göre</i>");
});

test("tramvay: komut, durak arama ve tek seferlik durak listesi", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdTramvay("ildem", ctx), /Birden fazla durak tutuyor: <code>İldem5<\/code>, <code>İldem4<\/code>, <code>İldem1<\/code>/);
  const maps = ctx.calls.filter((c) => c.url.startsWith(MAP)).map((c) => c.url.slice(MAP.length));
  assert.deepEqual(maps, ["T1&directions=1", "T1&directions=2", "T2&directions=1", "T2&directions=2", "T3&directions=1", "T3&directions=2"]);
  const idx = await loadTramIndex(ctx.kv);
  assert.deepEqual(idx.lines, ["T1", "T3"]);
  assert.deepEqual(idx.stops[ILDEM5][3], ["T1", "T3"]);
  assert.match(await cmdTramvay("ildem 1", ctx), /🚋 <b>İldem1<\/b> tramvay durağı · 20:55\n<b>T1<\/b> İldem - Organize Sanayi · 2 dk/);
  const post = ctx.calls.find((c) => c.url === ARR + ILDEM1);
  assert.equal(post.init.method, "POST");
  assert.match(await cmdTramvay("cumhuriyet", ctx), /Cumhuriyet Meydanı<\/b> tramvay durağı · 20:55\nŞu an bu durağa yaklaşan tramvay görünmüyor/);
  assert.match(await cmdTramvay("kumsmall", ctx), /tramvay durağı bulamadım/);
  assert.match(await cmdTramvay("duraklar", ctx), /Tramvay durakları<\/b> · 5\nCumhuriyet Meydanı, DSI-Yeni Sanayi, İldem1/);
  assert.equal(ctx.calls.filter((c) => c.url.startsWith(MAP)).length, 6, "durak listesi bir kez alınır");
  assert.deepEqual(findTramStops(idx, "DSİ yeni").map((s) => s.name), ["DSI-Yeni Sanayi"]);
  assert.equal(tramArrivalsUrl(ILDEM5), ARR + ILDEM5);
});

test("tramvay: site cevap vermezse 10 dakika yeniden denenmez", async () => {
  const ctx = fakeCtx({ fail: true });
  assert.match(await cmdTramvay("ildem", ctx), /alamadım/);
  assert.match(await cmdTramvay("ildem", ctx), /alamadım/);
  assert.equal(ctx.calls.length, 6);
  assert.equal(ctx.kv.values.has(TRAM_KEY), false);
});

test("tramvay: konumla en yakın durak, otobüsten önce", async () => {
  const ctx = fakeCtx();
  const near = { latitude: 38.7826, longitude: 35.6012 };   // İldem1'in ~40 m yanı
  const text = await busLocation(near, ctx);
  assert.match(text, /^🚋 <b>İldem1<\/b> tramvay durağı · 20:55 · 40 m uzakta\n<b>T1<\/b>/);
  assert.doesNotMatch(text, /tanımıyorum/);
  assert.deepEqual(nearestTram(await loadTramIndex(ctx.kv), { lat: 38.7, lon: 35.2 }), []);
});

test("tramvay: arka plan yenilemesi yalnızca dakika 5'te ve eskiyince", async () => {
  const ctx = fakeCtx();
  ctx.now = trToMs(2026, 11, 22, 21, 0);
  assert.deepEqual(await crawlTram(ctx), { skipped: true });
  ctx.now = trToMs(2026, 11, 22, 21, 5);
  assert.deepEqual(await crawlTram(ctx), { stops: 5 });
  ctx.now = trToMs(2026, 11, 22, 21, 15);
  assert.deepEqual(await crawlTram(ctx), { fresh: true });
  assert.equal(ctx.calls.length, 6);
});

test("tramvay: yapay zekâ adımı", () => {
  const steps = toSteps([{ ad: "tramvay", metin: "Cumhuriyet Meydanı'na" }, { ad: "tramvay", metin: "tramvay durağı ildem1" }], {});
  assert.deepEqual(steps.map((s) => [s.type, s.command, s.args]), [["private", "tramvay", "Cumhuriyet Meydanı"], ["private", "tramvay", "ildem1"]]);
});

test("tramvay: panel düğmeleri ayrı (🚌 yalnız otobüs, 🚋 yalnız tramvay)", async () => {
  const near = { latitude: 38.7826, longitude: 35.6012 };
  const tramOnly = fakeCtx();
  const t = await busLocation(near, tramOnly, { only: "tram" });
  assert.match(t, /^🚋 <b>İldem1<\/b> tramvay durağı/);
  assert.equal(tramOnly.calls.some((c) => c.url.includes("DurakDetay")), false, "otobüse bakılmaz");
  const far = await busLocation({ latitude: 38.70, longitude: 35.52 }, tramOnly, { only: "tram" });
  assert.match(far, /Yakınında \(800\u00a0m içinde\) tramvay durağı yok\. En yakın tramvay durağı <b>Cumhuriyet Meydanı<\/b>, 3\.7\u00a0km uzakta/);
  const busOnly = fakeCtx();
  const b = await busLocation(near, busOnly, { only: "bus" });
  assert.doesNotMatch(b, /🚋/);
  assert.equal(busOnly.calls.some((c) => c.url.includes("lineId=T")), false, "tramvaya bakılmaz");
});

test("tramvay: varış isteği çerezle gider; çalışmayan biçimde sıradaki denenir ve hatırlanır", async () => {
  const ctx = fakeCtx();
  const plain = ctx.webFetch;
  ctx.webFetch = async (url, init = {}) => (url.startsWith(ARR) && init.body !== "{}"
    ? (ctx.calls.push({ url, init }), { ok: false, status: 500, json: async () => { throw new Error("html"); }, text: async () => "<html>" })
    : plain(url, init));
  const list = await fetchTramArrivals(ctx, ILDEM1);
  assert.equal(list[0].code, "T1");
  const tries = ctx.calls.filter((c) => c.url === ARR + ILDEM1);
  assert.equal(tries.length, 3);
  assert.equal(tries[0].init.headers.Cookie, "dil=tr; HatTuru=2");
  assert.equal(tries[0].init.headers["Accept-Language"], "tr-TR,tr;q=0.9");
  assert.equal(tries[2].init.body, "{}");
  assert.equal(await ctx.cache.get("tramvay:bicim"), 2);
  await fetchTramArrivals(ctx, ILDEM5);
  assert.equal(ctx.calls.filter((c) => c.url === ARR + ILDEM5).length, 1, "çalışan biçim doğrudan kullanılır");
  assert.equal(ARRIVAL_VARIANTS.length, 4);
  assert.ok(ARRIVAL_VARIANTS.every((v) => v.init.method === "POST"), "GET sayfa döndürüyor, denenmez");
});

test("tramvay: her biçime 500 veren durak 'veri yok' sayılır ve 5 dakika yeniden sorulmaz", async () => {
  const ctx = fakeCtx();
  const plain = ctx.webFetch;
  ctx.webFetch = async (url, init = {}) => (url === ARR + CUMH
    ? (ctx.calls.push({ url, init }), { ok: false, status: 500, json: async () => { throw new Error("html"); }, text: async () => "<html>" })
    : plain(url, init));
  await assert.rejects(fetchTramArrivals(ctx, CUMH), (e) => e.noData === true);
  assert.equal(ctx.calls.length, 4);
  await assert.rejects(fetchTramArrivals(ctx, CUMH), (e) => e.noData === true);
  assert.equal(ctx.calls.length, 4, "ikinci sorguda siteye gidilmez");
  const out = await cmdTramvay("cumhuriyet", ctx);
  assert.match(out, /varış bilgisi vermiyor/);
  assert.doesNotMatch(out, /ulaşamadım/);
});

test("tramvay: Makas Bölgesi konum aramasında atlanır; test komutu birkaç durağı dener", async () => {
  const index = { stops: {
    [ILDEM5]: ["İldem5", 38.786984, 35.6257987, ["T1"]],
    "aaaaaaaa-1111-2222-3333-444444444444": ["Makas Bölgesi", 38.7869, 35.6258, ["T1"]],
  } };
  assert.deepEqual(nearestTram(index, { lat: 38.7869, lon: 35.6258 }).map((s) => s.name), ["İldem5"]);
  const ctx = fakeCtx();
  const out = await cmdTramvay("test", ctx);
  assert.match(out, /Varış · İldem1 · tarayıcı başlıkları/);
  assert.match(out, /Varış · İldem1 · çerez \+ form/);
  assert.doesNotMatch(out, /Varış · İldem5/);
  const one = await cmdTramvay("test ildem5", ctx);
  assert.match(one, /Varış · İldem5/);
  assert.doesNotMatch(one, /Varış · İldem1/);
  assert.equal(errorHint("<html><head><title>Hata Sayfası</title><script>var error=1;</script></head><body><p>Bir hata oluştu. Object reference not set to an instance of an object.</p></body></html>"),
    "başlık: Hata Sayfası · ipucu: Bir hata oluştu");
});

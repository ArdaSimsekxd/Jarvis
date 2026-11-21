import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AFAD_URL, EMSC_URL, GEO_URL, QUAKE_KEY, USGS_URL, checkQuakes, cmdDeprem, distanceKm, parseAfad, parseEmsc, parseTime, shouldAlert,
  DEFAULT_SETTINGS,
} from "../src/quake.js";
import { API, CARGO_KEY, checkCargo, cmdKargo, parseAdd, readTrack, trackLink } from "../src/cargo.js";
import { PcHub } from "../src/pc.js";
import { PANEL_KEY, SERVICE_WORKER, cmdBul, handlePanel } from "../src/panel.js";
import { toSteps } from "../src/brain.js";
import { trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 22, 14, 0);   // gündüz
const NIGHT = trToMs(2026, 11, 22, 3, 0);
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return { values, async get(k) { return values.get(k) ?? null; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}

// routes: adres başına cevap (fonksiyon ya da { status, body }); çağrılar kaydedilir
function fakeCtx({ now = NOW, routes = {}, kv = fakeKv(), cargoKey = null } = {}) {
  const calls = [], sent = [];
  return {
    now, kv, calls, sent, cargoKey,
    send: async (t) => { sent.push(t); return true; },
    webFetch: async (url, init = {}) => {
      calls.push({ url, init });
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!hit) throw new Error(`beklenmeyen istek ${url}`);
      const r = typeof hit[1] === "function" ? hit[1](url, init) : hit[1];
      if (r instanceof Error) throw r;
      return { ok: r.status === 200, status: r.status, json: async () => r.body };
    },
  };
}

const afadEvent = (o) => ({
  eventID: "1", latitude: "38.70", longitude: "35.60", depth: "7.1", magnitude: "4.2", type: "ML",
  location: "Talas (Kayseri)", province: "Kayseri", district: "Talas", date: iso(NOW - 5 * 60 * 1000), ...o,
});

test("deprem: mesafe ve saat", () => {
  assert.ok(Math.abs(distanceKm({ lat: 38.7225, lon: 35.4875 }, { lat: 39.9334, lon: 32.8597 }) - 260) < 15, "Kayseri-Ankara ~260 km");
  assert.equal(parseTime("2026-11-22T10:55:00", NOW), Date.UTC(2026, 10, 22, 10, 55), "saat dilimi yoksa UTC");
  assert.equal(parseTime("2026-11-22T13:55:00", NOW), Date.UTC(2026, 10, 22, 10, 55), "gelecekte kalıyorsa Türkiye saatidir");
  assert.equal(parseTime("2026-11-22T10:55:00Z", NOW), Date.UTC(2026, 10, 22, 10, 55));
});

test("deprem: AFAD ve EMSC cevapları okunur", () => {
  const [e] = parseAfad([afadEvent({})], NOW);
  assert.deepEqual({ ...e }, { id: "1", time: NOW - 300000, lat: 38.7, lon: 35.6, mag: 4.2, depth: 7.1, place: "Talas, Kayseri", source: "AFAD" });
  assert.equal(parseAfad([afadEvent({ magnitude: "" })], NOW).length, 0, "büyüklüğü olmayan atlanır");
  assert.throws(() => parseAfad({ hata: 1 }, NOW));
  const [m] = parseEmsc({ features: [{ id: "x", geometry: { coordinates: [29, 40.8, -10] }, properties: { unid: "u1", time: "2026-11-22T10:50:00.0Z", lat: 40.8, lon: 29, depth: 10, mag: 5.1, flynn_region: "WESTERN TURKEY" } }] }, NOW);
  assert.equal(m.id, "emsc-u1");
  assert.equal(m.mag, 5.1);
  assert.equal(m.place, "WESTERN TURKEY");
});

test("deprem: hangi deprem bildirilir", () => {
  const s = { ...DEFAULT_SETTINGS };
  const at = (lat, lon, mag) => ({ lat, lon, mag });
  assert.equal(shouldAlert(at(38.7, 35.6, 3.6), s, NOW).name, "Kayseri", "yakın ve eşiğin üstü");
  assert.equal(shouldAlert(at(38.7, 35.6, 3.2), s, NOW), null, "eşiğin altı");
  assert.equal(shouldAlert(at(38.7, 35.6, 3.6), s, NIGHT), null, "gece küçük deprem uyandırmaz");
  assert.ok(shouldAlert(at(38.7, 35.6, 4.1), s, NIGHT));
  assert.equal(shouldAlert(at(39.9, 32.9, 4.0), s, NOW), null, "260 km, 4.5 altı");
  assert.ok(shouldAlert(at(39.9, 32.9, 4.6), s, NOW), "bölgede 4.5 ve üstü");
  assert.ok(shouldAlert(at(38.4, 27.1, 5.2), s, NOW), "Türkiye'nin her yerinde 5 ve üstü");
  assert.ok(shouldAlert(at(38.4, 27.1, 5.2), { ...s, places: [] }, NOW), "şehir yokken de büyük deprem");
});

test("deprem: yeni depremi bir kez bildirir, AFAD çökerse EMSC'ye geçer", async () => {
  const kv = fakeKv();
  let afad = { status: 200, body: [afadEvent({}), afadEvent({ eventID: "2", magnitude: "2.9" }), afadEvent({ eventID: "3", date: iso(NOW - 2 * 3600 * 1000) })] };
  const ctx = fakeCtx({ kv, routes: { [AFAD_URL]: () => afad, [EMSC_URL]: { status: 200, body: { features: [] } } } });
  assert.equal(await checkQuakes(ctx), 1, "yalnızca yeni ve eşiğin üstündeki");
  assert.match(ctx.sent[0], /Deprem: 4\.2/);
  assert.match(ctx.sent[0], /Talas, Kayseri · Kayseri: \d+ km uzakta/);
  assert.match(ctx.sent[0], /Saat 13:55 · derinlik 7\.1 km · kaynak AFAD/);
  assert.match(ctx.calls[0].url, /start=2026-11-22T08%3A00%3A00&end=2026-11-22T11%3A05%3A00&minmag=3\.5/);
  assert.equal(await checkQuakes(ctx), 0, "aynı deprem tekrar yazılmaz");
  // AFAD çöktü: aynı deprem EMSC'den başka numarayla gelir, yine yazılmaz; yeni olan yazılır
  afad = { status: 503, body: null };
  ctx.calls.length = 0;
  const emsc = (unid, mins, mag) => ({ id: unid, geometry: { coordinates: [35.6, 38.7, 7] }, properties: { unid, time: new Date(NOW - mins * 60000).toISOString(), lat: 38.7, lon: 35.6, depth: 7, mag, flynn_region: "CENTRAL TURKEY" } });
  ctx.webFetch = fakeCtx({ routes: { [AFAD_URL]: afad, [EMSC_URL]: { status: 200, body: { features: [emsc("a", 5, 4.3), emsc("b", 1, 3.9)] } } } }).webFetch;
  assert.equal(await checkQuakes(ctx), 1);
  assert.match(ctx.sent[1], /Deprem: 3\.9.*\n.*CENTRAL TURKEY[\s\S]*kaynak EMSC/);
  assert.equal(JSON.parse(kv.values.get(QUAKE_KEY)).seen.length, 2);
  // kapatılınca bakmaz
  await cmdDeprem("kapat", ctx);
  assert.equal(await checkQuakes(ctx), 0);
});

test("deprem: büyük deprem uyarısı ve hiçbir kaynak yoksa sessizlik", async () => {
  const ctx = fakeCtx({ routes: { [AFAD_URL]: { status: 200, body: [afadEvent({ magnitude: "5.6" })] } } });
  await checkQuakes(ctx);
  assert.match(ctx.sent[0], /^⚠️ <b>Deprem: 5\.6<\/b>/);
  assert.match(ctx.sent[0], /112/);
  const down = fakeCtx({ routes: { [AFAD_URL]: new Error("x"), [EMSC_URL]: new Error("x"), [USGS_URL]: { status: 500 } } });
  assert.equal(await checkQuakes(down), 0);
  assert.equal(down.calls.length, 3);
  assert.match(await cmdDeprem("", down), /ulaşamadım/);
});

test("deprem: komutlar", async () => {
  const ctx = fakeCtx({
    routes: {
      [AFAD_URL]: { status: 200, body: [afadEvent({ magnitude: "3.1" })] },
      [GEO_URL]: (url) => (/name=Yokyer/.test(url) ? { status: 200, body: {} }
        : { status: 200, body: { results: [{ name: "Izmir", latitude: 1, longitude: 1, country_code: "US" }, { name: "İzmir", latitude: 38.41273, longitude: 27.13838, country_code: "TR" }] } }),
    },
  });
  const list = await cmdDeprem("", ctx);
  assert.match(list, /Son depremler[\s\S]*<b>3\.1<\/b> Talas, Kayseri · 13:55 · Kayseri: \d+ km/);
  assert.match(list, /Şehirler: <b>Kayseri<\/b>/);
  assert.match(await cmdDeprem("ekle izmir", ctx), /İzmir eklendi.*Kayseri, İzmir/);
  assert.deepEqual(JSON.parse(ctx.kv.values.get(QUAKE_KEY)).places[1], { name: "İzmir", lat: 38.4127, lon: 27.1384 });
  assert.match(await cmdDeprem("ekle İzmir", ctx), /zaten listede/);
  assert.match(await cmdDeprem("ekle Yokyer", ctx), /bulamadım/);
  assert.match(await cmdDeprem("esik 9", ctx), /2\.5 ile 7/);
  assert.match(await cmdDeprem("eşik 4,2", ctx), /4\.2 ve üstü/);
  assert.match(await cmdDeprem("sil kayseri", ctx), /Kayseri çıkarıldı.*İzmir/);
  assert.match(await cmdDeprem("sil 1", ctx), /Şehir kalmadı/);
});

test("kargo: numara ve firma ayrıştırma", () => {
  assert.deepEqual(parseAdd("123456789012 kulaklık"), { carrier: null, number: "123456789012", name: "kulaklık" });
  assert.deepEqual(parseAdd("Yurtiçi 1234-5678-9012 yeni ayakkabı"), { carrier: 100348, number: "123456789012", name: "yeni ayakkabı" });
  assert.deepEqual(parseAdd("aras kargo 7100123456789"), { carrier: 100607, number: "7100123456789", name: "" });
  assert.equal(parseAdd("kulaklık geldi mi"), null);
  assert.deepEqual(readTrack({ track_info: { latest_status: { status: "OutForDelivery" }, latest_event: { description: "Kurye  dağıtımda", location: "KAYSERİ", time_utc: "2026-11-22T07:30:00Z" } } }),
    { status: "OutForDelivery", event: "Kurye dağıtımda", where: "KAYSERİ", time: Date.UTC(2026, 10, 22, 7, 30) });
  assert.equal(readTrack({ track_info: { latest_status: { status: "Yeni" } } }).status, "InTransit", "tanınmayan durum yolda sayılır");
  assert.equal(readTrack({ track_info: { tracking: { providers: [{ events: [{ description: "Çıkış şubesinde" }] }] } } }).event, "Çıkış şubesinde");
});

test("kargo: anahtarsız kayıt, bağlantı ve sabah hatırlatması", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdKargo("", ctx), /Kayıtlı kargo yok/);
  const added = await cmdKargo("yurtici 123456789012 kulaklık", ctx);
  assert.match(added, /Kaydettim: <b>kulaklık<\/b> · <code>123456789012<\/code> \(Yurtiçi\)/);
  assert.match(added, /href="https:\/\/www\.yurticikargo\.com\/tr\/online-servisler\/gonderi-sorgula\?code=123456789012"/);
  await cmdKargo("ABC1234567890 kitap", ctx);
  assert.equal(trackLink({ number: "ABC1234567890", carrier: null }), "https://t.17track.net/tr#nums=ABC1234567890");
  assert.match(await cmdKargo("ABC1234567890", ctx), /zaten listede/);
  assert.equal(ctx.calls.length, 0, "anahtarsız hiçbir servise istek gitmez");
  ctx.now = trToMs(2026, 11, 22, 9, 58);
  assert.equal(await checkCargo(ctx), 0);
  ctx.now = trToMs(2026, 11, 22, 10, 0);
  assert.equal(await checkCargo(ctx), 1);
  assert.match(ctx.sent[0], /Yolda 2 kargon var\n1\. <b>kulaklık<\/b>.*takip<\/a>\n2\. <b>kitap<\/b>/);
  assert.match(await cmdKargo("geldi 1", ctx), /Afiyetle kullan.*kulaklık/);
  assert.match(await cmdKargo("", ctx), /1\. <b>kitap<\/b>[\s\S]*t\.17track\.net/);
  ctx.now = trToMs(2026, 12, 25, 10, 0);
  assert.equal(await checkCargo(ctx), 0, "30 günden eski kayıt düşer");
  assert.equal(JSON.parse(ctx.kv.values.get(CARGO_KEY)).items.length, 0);
});

test("kargo (17TRACK anahtarıyla): numara kaydedilir ve izlenir", async () => {
  let info = { status: "InfoReceived", description: "Gönderi kaydı oluşturuldu", location: "İSTANBUL" };
  const routes = {
    [`${API}/register`]: () => ({ status: 200, body: { code: 0, data: { accepted: [{ number: "123456789012", carrier: 100348 }], rejected: [] } } }),
    [`${API}/gettrackinfo`]: () => ({ status: 200, body: { code: 0, data: { accepted: [{ number: "123456789012", carrier: 100348, track_info: { latest_status: { status: info.status }, latest_event: { description: info.description, location: info.location, time_utc: "2026-11-22T08:00:00Z" } } }] } } }),
    [`${API}/stoptrack`]: { status: 200, body: { code: 0, data: {} } },
  };
  const ctx = fakeCtx({ cargoKey: "k", routes });
  const added = await cmdKargo("123456789012 kulaklık", ctx);
  assert.match(added, /Yurtiçi kargosu takipte: <b>kulaklık<\/b> · <code>123456789012<\/code>/);
  assert.match(added, /Kargo bilgisi alındı\nGönderi kaydı oluşturuldu · İSTANBUL · 22\.11 11:00/);
  assert.equal(ctx.calls[0].init.headers["17token"], "k");
  assert.deepEqual(JSON.parse(ctx.calls[0].init.body), [{ number: "123456789012" }]);
  assert.match(await cmdKargo("123456789012", ctx), /zaten takipte/);

  // zamanlayıcı: yalnızca :06 / :36 turlarında bakar, durum değişince yazar
  const turn = trToMs(2026, 11, 22, 14, 36);
  ctx.now = turn - 4 * 60000;
  assert.equal(await checkCargo(ctx), 0);
  ctx.now = turn;
  assert.equal(await checkCargo(ctx), 0, "değişiklik yok");
  info = { status: "OutForDelivery", description: "Dağıtıma çıktı", location: "KAYSERİ" };
  assert.equal(await checkCargo(ctx), 1);
  assert.match(ctx.sent[0], /^🛵 Dağıtıma çıktı\n<b>kulaklık<\/b>/);
  info = { status: "Delivered", description: "Teslim edildi: ARDA", location: "KAYSERİ" };
  assert.equal(await checkCargo(ctx), 1);
  assert.match(ctx.sent[1], /^✅ Teslim edildi/);
  const saved = JSON.parse(ctx.kv.values.get(CARGO_KEY)).items[0];
  assert.equal(saved.doneAt, turn);
  // teslim edilen artık sorulmaz, 3 gün sonra listeden düşer
  const before = ctx.calls.length;
  assert.equal(await checkCargo(ctx), 0);
  assert.equal(ctx.calls.length, before, "teslim edilen için istek yok");
  ctx.now = turn + 4 * 24 * 3600 * 1000;
  await checkCargo(ctx);
  assert.equal(JSON.parse(ctx.kv.values.get(CARGO_KEY)).items.length, 0);
});

test("kargo: firma tanınmazsa sorar, silinince takipten çıkar", async () => {
  const ctx = fakeCtx({
    cargoKey: "k",
    routes: {
      [`${API}/register`]: (url, init) => (JSON.parse(init.body)[0].carrier
        ? { status: 200, body: { code: 0, data: { accepted: [{ number: "999988887777", carrier: 100607 }], rejected: [] } } }
        : { status: 200, body: { code: 0, data: { accepted: [], rejected: [{ number: "999988887777", error: { code: -18019903, message: "The carrier can not be detected" } }] } } }),
      [`${API}/gettrackinfo`]: new Error("ağ"),
      [`${API}/stoptrack`]: { status: 200, body: { code: 0, data: {} } },
    },
  });
  assert.match(await cmdKargo("999988887777", ctx), /firmasını numaradan tanıyamadım.*\/kargo aras 999988887777/);
  assert.match(await cmdKargo("aras 999988887777 kitap", ctx), /Aras kargosu takipte[\s\S]*Bilgi bekleniyor/);
  assert.match(await cmdKargo("", ctx), /1\. <b>kitap<\/b>/);
  assert.match(await cmdKargo("sil 1", ctx), /Takipten çıkarıldı/);
  assert.ok(ctx.calls.some((c) => c.url.endsWith("/stoptrack")));
  assert.match(await cmdKargo("", ctx), /Takipte kargo yok/);
  const bad = fakeCtx({ cargoKey: "yanlis", routes: { [`${API}/register`]: { status: 401 } } });
  assert.match(await cmdKargo("123456789012", bad), /TRACK17_KEY/);
});

function fakeState() {
  const data = new Map();
  const state = {
    data, alarm: null,
    storage: {
      async get(k) { return data.get(k); }, async put(k, v) { data.set(k, structuredClone(v)); }, async delete(k) { return data.delete(k); },
      async setAlarm(t) { state.alarm = t; }, async deleteAlarm() { state.alarm = null; },
    },
    getWebSockets: () => [], getTags: () => [],
  };
  return state;
}
const call = async (hub, op, body = {}) => (await hub.fetch(new Request(`https://pc/internal/${op}`, { method: "POST", body: JSON.stringify(body) }))).json();

test("telefonumu bul: aralıklarla bildirim, dokununca durur", async () => {
  const state = fakeState();
  const hub = new PcHub(state, {});
  assert.deepEqual(await call(hub, "find"), { subs: 0, sent: 0 }, "bildirim açık değilse");
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const { b64url } = await import("../src/webpush.js");
  const sub = { endpoint: "https://web.push.apple.com/x", keys: { p256dh: b64url(await crypto.subtle.exportKey("raw", ua.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
  await call(hub, "pushsub", { sub });
  let pushes = 0;
  hub.pushFetch = async () => { pushes += 1; return new Response("", { status: 201 }); };
  assert.deepEqual(await call(hub, "find"), { subs: 1, sent: 1 });
  assert.ok(state.alarm > Date.now(), "sonraki bildirim kuruldu");
  await hub.alarm();
  await hub.alarm();
  assert.equal(pushes, 3);
  assert.equal(state.data.get("find").n, 3);
  for (let i = 0; i < 10; i += 1) await hub.alarm();
  assert.equal(pushes, 9, "en fazla 9 bildirim");
  assert.equal(state.data.has("find"), false);
  await call(hub, "find");
  assert.deepEqual(await call(hub, "findstop"), { stopped: true });
  assert.equal(state.alarm, null);
  await hub.alarm();
  assert.equal(pushes, 10, "durunca bildirim yok");
});

test("telefonumu bul: komut, panel düğmesi ve bildirime dokunma", async () => {
  const calls = [];
  const pc = { call: async (op) => { calls.push(op); return op === "find" ? { subs: 1, sent: 1 } : { stopped: true }; } };
  assert.match(await cmdBul("", { pc }), /3 dakika boyunca/);
  assert.match(await cmdBul("dur", { pc }), /durdurdum/);
  assert.match(await cmdBul("", { pc: { call: async () => ({ subs: 0 }) } }), /Bildirimler düğmesine/);
  assert.match(await cmdBul("", {}), /\/panel/);
  const ctx = { kv: fakeKv({ [PANEL_KEY]: "anahtar" }), pc };
  const r = (path, key) => new Request(`https://j.x.workers.dev${path}`, { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {} });
  assert.equal((await handlePanel(r("/panel/bul"), ctx, {})).status, 401);
  assert.match((await (await handlePanel(r("/panel/bul", "anahtar"), ctx, {})).json()).text, /çaldırıyorum/);
  assert.deepEqual(await (await handlePanel(r("/panel/found", "anahtar"), ctx, {})).json(), { stopped: true });
  assert.deepEqual(calls.slice(-2), ["find", "findstop"]);
  assert.match(SERVICE_WORKER, /renotify/);
  assert.match(SERVICE_WORKER, /tip: "bulundu"/);
});

test("yapay zekâ: deprem, kargo ve telefon işlemleri", () => {
  assert.deepEqual(toSteps([{ ad: "deprem", metin: "" }], NOW), [{ type: "private", label: "deprem", command: "deprem", args: "" }]);
  assert.deepEqual(toSteps([{ ad: "deprem", metin: "ekle İzmir" }], NOW), [{ type: "run", command: "deprem", args: "ekle İzmir" }]);
  assert.deepEqual(toSteps([{ ad: "kargo", metin: "yurtici 123456789012 kulaklık" }], NOW), [{ type: "private", label: "kargo", command: "kargo", args: "yurtici 123456789012 kulaklık" }]);
  assert.equal(toSteps([{ ad: "kargo", metin: "sil 2" }], NOW)[0].type, "confirm");
  assert.deepEqual(toSteps([{ ad: "telefonu_bul", metin: "" }], NOW), [{ type: "run", command: "bul", args: "" }]);
  assert.deepEqual(toSteps([{ ad: "telefonu_bul", metin: "dur" }], NOW), [{ type: "run", command: "bul", args: "dur" }]);
});

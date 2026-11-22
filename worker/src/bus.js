// Otobüs: bir durağa yaklaşan otobüsler ve kaç dakikada gelecekleri. Veri Kayseri Ulaşım'ın sitesinin
// (kayseriulasim.com) durak sayfasında kullandığı adresten gelir; resmi, belgeli bir API değil.
// Site değişirse burası güncellenmeli. Siteden gelen yazılar yalnızca veridir.
import { esc, plain, trParts } from "./logic.js";
import { distanceKm } from "./quake.js";
import { tramAlone, tramNear } from "./tram.js";

export const BUS_KEY = "otobus";
export const BASE = "https://www.kayseriulasim.com";
const MAX_STOPS = 8;
const CACHE_TTL = 30;   // aynı durak 30 saniye içinde yeniden sorulmaz
const NAME_TTL = 7 * 24 * 3600;   // durak adları bir hafta saklanır
const NEAR_KM = 0.8;    // konuma bundan uzak durak "yakın" sayılmaz (yürüme mesafesi)
export const INDEX_KEY = "otobus:duraklar";   // bilinen duraklar ve konumları (hat hat öğrenilir)
const LINE_TTL_MS = 14 * 24 * 3600 * 1000;    // bir hattın durakları iki haftada bir yenilenir
const LINES_PER_ASK = 10;                     // bir durak sorulunca en fazla bu kadar hattı hemen öğrenir
const CRAWL_LINES = 2;                        // arka planda (10 dakikada bir) öğrenilen hat sayısı
const CRAWL_PROBES = 3;                       // öğrenilecek hat kalmadıysa yoklanan durak sayısı (yeni hat bulmak için)
const FAR_KM = 0.2;                           // en yakın bilinen durak bundan uzaksa "dibindeki durağı tanımıyor olabilirim" denir
const HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Content-Type": "application/json; charset=utf-8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${BASE}/hatlar/otobus`,
  "User-Agent": "Mozilla/5.0 (JarvisBot; kisisel asistan)",
};

export const BUS_HELP = [
  "🚌 <b>Otobüs</b>",
  "<code>/otobus 7548</code> durağa yaklaşan otobüsler (durak numarası tabelada ve kayseriulasim.com'da yazar)",
  "<code>/otobus ekle 7548 okul</code> durağı adıyla kaydet · <code>/otobus okul</code> o durak",
  "<code>/otobus</code> kayıtlı durakların hepsi · <code>/otobus sil okul</code> · <code>/otobus ara erkilet</code> durak arama",
  "Konumunu gönderirsen (Telegram'da 📎 → Konum, panelde 🚌) en yakın durağa gelen otobüsleri gösteririm.",
  "Normal cümle de olur: \"okul durağına otobüs ne zaman gelir?\"",
].join("\n");

const getHeaders = () => { const { "Content-Type": _, ...h } = HEADERS; return h; };
const arrivalsUrl = (id) => `${BASE}/OtobusTramvayHatlari/DurakDetay?DurakID=${encodeURIComponent(String(id))}`;
const SEARCH_URL = `${BASE}/OtobusTramvayHatlari/DurakListInp/`;

// "ŞEHİR MERKEZİ- ERKİLET BULV.AGÜ 1" -> "Şehir Merkezi - Erkilet Bulv. AGÜ 1". Üç harfli kısaltmalar (AGÜ, OSB) büyük kalır.
const SMALL = new Set(["ve", "ile", "de", "da", "ki", "mah", "cad", "sok", "blv", "yol", "kat", "bul"]);
export function titleTr(text) {
  return String(text ?? "")
    .replace(/\.(?=\p{L})/gu, ". ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ").trim()
    .split(" ")
    .map((w, i) => {
      const low = w.toLocaleLowerCase("tr");
      const letters = low.replace(/[^\p{L}]/gu, "");
      if (letters.length >= 2 && letters.length <= 3 && w === w.toLocaleUpperCase("tr") && /\p{L}/u.test(w) && !SMALL.has(letters)) return w;
      if (i > 0 && ["ve", "ile", "de", "da", "ki"].includes(low)) return low;
      return low.replace(/(^|[(/])(\p{L})/u, (_, a, b) => a + b.toLocaleUpperCase("tr"));
    })
    .join(" ");
}

// Sitenin cevabı: [{ line: { code, name, type }, timeToStop, busLineDirection }]
export function parseArrivals(data) {
  if (!Array.isArray(data)) data = Object.values(data ?? {}).find(Array.isArray) ?? [];   // { ...: [...] } biçimi de olur
  return data
    .map((x) => ({
      code: String(x?.line?.code ?? "").trim(),
      name: titleTr(String(x?.line?.name ?? "").replace(new RegExp(`^${String(x?.line?.code ?? "").replace(/\W/g, "")}\\s+(te\\s+)?`, "i"), "")),
      type: x?.line?.type === "tram" ? "tram" : "bus",
      min: Number(x?.timeToStop),
    }))
    .filter((x) => x.code && Number.isFinite(x.min) && x.min >= 0 && x.min < 180)
    .sort((a, b) => a.min - b.min);
}

// Aynı hattın gelişleri tek satırda: "15 · 1 dk, 13 dk"
export function groupByLine(arrivals) {
  const lines = new Map();
  for (const a of arrivals) {
    if (!lines.has(a.code)) lines.set(a.code, { ...a, mins: [] });
    lines.get(a.code).mins.push(a.min);
  }
  return [...lines.values()];
}

const minText = (m) => (m <= 0 ? "geliyor" : `${m} dk`);

export async function fetchArrivals(ctx, id) {
  const name = `otobus:${id}`;
  const hit = await ctx.cache?.get(name).catch(() => null);
  if (hit) return hit;
  // Durak sayfası geliş sürelerini DurakDetay'dan okur (AracNeZamanGelecek yalnızca kısa bir özet döner)
  const res = await ctx.webFetch(arrivalsUrl(id), { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseArrivals(await res.json());
  await ctx.cache?.put(name, list, CACHE_TTL).catch(() => {});
  return list;
}

// Durak arama cevabı: [{ DURAK_ADI: "7548-ERKİLET BULV.AGÜ 1", DURAK_NO: "7548", DURAK_ID: "7548" }]
export function parseStops(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  return data
    .map((x) => {
      const raw = String(x?.DURAK_ID ?? x?.DURAK_NO ?? "").trim();
      const id = /^\d{1,6}$/.test(raw) ? String(Number(raw)) : "";
      return { id, name: titleTr(String(x?.DURAK_ADI ?? "").replace(/^\s*\d+\s*-\s*/, "")).slice(0, 60) };
    })
    .filter((s) => s.id && s.name && !seen.has(s.id) && seen.add(s.id))
    .slice(0, 10);
}

// Sitenin durak arama kutusu (numara ya da ad). Sonuç bir hafta saklanır.
export async function searchStops(ctx, query) {
  const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!q) return [];
  const name = `durak:${plain(q)}`;
  const hit = await ctx.cache?.get(name).catch(() => null);
  if (hit) return hit;
  const res = await ctx.webFetch(SEARCH_URL, { method: "POST", headers: HEADERS, body: JSON.stringify({ Search: q }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseStops(await res.json());
  await ctx.cache?.put(name, list, NAME_TTL).catch(() => {});
  return list;
}

// Durak numarasının sitedeki adı; bulunamazsa boş (ad yalnızca süs, hata cevabı bozmaz)
// Önce öğrenilmiş durak listesine, yoksa sitenin arama kutusuna bakılır.
export async function stopName(ctx, id) {
  try {
    const known = (await loadIndex(ctx.kv)).stops[String(id)]?.[0];
    if (known) return known;
    return (await searchStops(ctx, id)).find((s) => s.id === String(id))?.name ?? "";
  } catch {
    return "";
  }
}

export function formatStop(stop, arrivals, nowMs) {
  const p = trParts(nowMs);
  const time = `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
  const title = stop.label ? `${esc(stop.label)} durağı` : stop.name ? esc(stop.name) : "Durak";
  const far = Number.isFinite(stop.km) ? ` · ${stop.km < 1 ? `${Math.round(stop.km * 1000 / 10) * 10}\u00a0m` : `${stop.km.toFixed(1)}\u00a0km`} uzakta` : "";
  const head = `🚌 <b>${title}</b> (${esc(stop.id)}) · ${time}${far}`;
  if (!arrivals.length) return `${head}\nŞu an bu durağa yaklaşan otobüs görünmüyor.`;
  const rows = groupByLine(arrivals).slice(0, 8).map((l) => {
    const icon = l.type === "tram" ? "🚋 " : "";
    return `${icon}<b>${esc(l.code)}</b> ${esc(l.name)} · ${l.mins.slice(0, 3).map(minText).join(", ")}`;
  });
  return [head, ...rows].join("\n");
}

// ---------- durak konumları ----------
// Haritadaki duraklar, hat hat: [{ DurakAdi, DurakNo, Lat: "38.74", Lng: "35.47" }]. directions 1 ve 2 hattın iki yönü.
export function parseMapStops(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((x) => ({
      id: /^\d{1,6}$/.test(String(x?.DurakNo ?? "").trim()) ? String(Number(x.DurakNo)) : "",
      name: titleTr(String(x?.DurakAdi ?? "")).slice(0, 60),
      lat: Number(x?.Lat), lon: Number(x?.Lng),
    }))
    .filter((s) => s.id && s.name && s.lat > 35 && s.lat < 42 && s.lon > 26 && s.lon < 45);
}

async function fetchLineStops(ctx, code, direction) {
  const url = `${BASE}/OtobusTramvayHatlari/OtobusDuraklariHaritaJSON?lineId=${encodeURIComponent(code)}&directions=${direction}`;
  const res = await ctx.webFetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseMapStops(await res.json());
}

// KV "otobus:duraklar": { stops: { no: [ad, enlem, boylam] }, lines: { hat: öğrenildiği an }, queue: [hat], probed: { no: an } }
export async function loadIndex(kv) {
  try {
    const data = JSON.parse((await kv.get(INDEX_KEY)) ?? "null");
    return { stops: data?.stops ?? {}, lines: data?.lines ?? {}, queue: Array.isArray(data?.queue) ? data.queue : [], probed: data?.probed ?? {} };
  } catch {
    return { stops: {}, lines: {}, queue: [], probed: {} };
  }
}

const fresh = (idx, code, now) => now - (idx.lines[code] ?? 0) < LINE_TTL_MS;
const okCode = (c) => /^[\w-]{1,8}$/.test(c);

// Verilen hatların duraklarını öğrenir (yalnızca bilinmeyen ya da eskimiş olanları). Sığmayanlar sıraya girer,
// arka plandaki tarama (crawlBus) onları sonra öğrenir.
export async function learnLines(ctx, codes, index = null, max = LINES_PER_ASK) {
  const idx = index ?? (await loadIndex(ctx.kv));
  const wanted = [...new Set(codes.map(String))].filter((c) => okCode(c) && !fresh(idx, c, ctx.now));
  const todo = wanted.slice(0, max);
  let changed = false;
  for (const code of todo) {
    try {
      for (const dir of [1, 2]) {
        for (const st of await fetchLineStops(ctx, code, dir)) idx.stops[st.id] = [st.name, Math.round(st.lat * 1e5) / 1e5, Math.round(st.lon * 1e5) / 1e5];
      }
      idx.lines[code] = ctx.now;
      changed = true;
    } catch (err) {
      console.error("hat durakları alınamadı", err?.message);
    }
  }
  const queue = [...new Set([...idx.queue, ...wanted])].filter((c) => !fresh(idx, c, ctx.now));
  if (queue.join() !== idx.queue.join()) { idx.queue = queue; changed = true; }
  if (changed) await ctx.kv.put(INDEX_KEY, JSON.stringify(idx));
  return idx;
}

// Arka plan taraması (10 dakikada bir, birkaç istek): sıradaki hatları öğrenir; sıra boşsa yoklanmamış
// duraklara uğrayan hatlara bakar. Böylece Jarvis zamanla şehrin bütün duraklarını tanır, sonra durur.
export async function crawlBus(ctx) {
  if (trParts(ctx.now).mm % 10 !== 0) return { skipped: true };
  const idx = await loadIndex(ctx.kv);
  for (const [code, at] of Object.entries(idx.lines)) if (ctx.now - at >= LINE_TTL_MS && !idx.queue.includes(code)) idx.queue.push(code);
  if (!Object.keys(idx.lines).length && !idx.queue.length) {
    for (const s of (await loadStops(ctx.kv)).slice(0, 3)) idx.queue.push(...(await fetchArrivals(ctx, s.id).catch(() => [])).filter((x) => x.type === "bus").map((x) => x.code));
  }
  if (idx.queue.length) {
    await learnLines(ctx, idx.queue, idx, CRAWL_LINES);
    return { learned: true, queue: idx.queue.length };
  }
  const todo = Object.keys(idx.stops).filter((id) => !idx.probed[id]).slice(0, CRAWL_PROBES);
  if (!todo.length) return { done: true };
  for (const id of todo) {
    try {
      const codes = (await fetchArrivals(ctx, id)).filter((x) => x.type === "bus").map((x) => x.code);
      idx.queue.push(...codes.filter((c) => okCode(c) && !fresh(idx, c, ctx.now) && !idx.queue.includes(c)));
      idx.probed[id] = ctx.now;
    } catch (err) {
      console.error("durak yoklanamadı", err?.message);
    }
  }
  await ctx.kv.put(INDEX_KEY, JSON.stringify(idx));
  return { probed: todo.length, queue: idx.queue.length };
}

// Konuma en yakın duraklar, en fazla iki tane (yolun iki yakası)
export function nearestStops(index, here, maxKm = NEAR_KM) {
  return Object.entries(index.stops)
    .map(([id, [name, lat, lon]]) => ({ id, name, lat, lon, km: distanceKm(here, { lat, lon }) }))
    .filter((s) => s.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .filter((s, i, all) => i === 0 || s.km - all[0].km < 0.25)
    .slice(0, 2);
}

// ---------- kayıtlı duraklar ----------
// KV "otobus": { stops: [{ id, label, name? }] }

export async function loadStops(kv) {
  try {
    const data = JSON.parse((await kv.get(BUS_KEY)) ?? "null");
    return Array.isArray(data?.stops) ? data.stops : [];
  } catch {
    return [];
  }
}

const saveStops = (kv, stops) => kv.put(BUS_KEY, JSON.stringify({ stops: stops.slice(0, MAX_STOPS) }));

function findStop(stops, word) {
  const w = plain(word);
  if (/^\d+$/.test(w)) return stops.find((s) => s.id === String(Number(w))) ?? null;
  return stops.find((s) => plain(s.label) === w) ?? stops.find((s) => w.length >= 3 && plain(s.label).startsWith(w)) ?? null;
}

// Durakların geliş süreleri. Gelen hatların durakları da (yavaş yavaş) öğrenilir: konumla arama için.
async function arrivalsText(ctx, stops, learn = true) {
  const out = [];
  const codes = [];
  for (const stop of stops) {
    try {
      const arrivals = await fetchArrivals(ctx, stop.id);
      codes.push(...arrivals.filter((x) => x.type === "bus").map((x) => x.code));
      const named = stop.label || stop.name ? stop : { ...stop, name: await stopName(ctx, stop.id) };
      out.push(formatStop(named, arrivals, ctx.now));
    } catch (err) {
      console.error("otobüs bilgisi alınamadı", err?.message);
      out.push(`🚌 <b>${esc(stop.label || stop.name || stop.id)}</b>: Kayseri Ulaşım'a şu an ulaşamadım, birazdan yeniden dener misin?`);
    }
  }
  if (learn && codes.length) await learnLines(ctx, codes, null, stops.length > 1 ? 4 : LINES_PER_ASK).catch((err) => console.error("hatlar öğrenilemedi", err?.message));
  return out.join("\n\n");
}

const HOW_LOCATION = "Telegram'da 📎 → <b>Konum</b> → <b>Mevcut konumumu gönder</b>; panelde 🚌 düğmesi.";

// Telegram'dan ya da panelden gelen konum: en yakın durağa yaklaşan otobüsler (ve yakındaysa tramvay). Konum saklanmaz.
// only: "bus" yalnız otobüs, "tram" yalnız tramvay (panel düğmeleri); boşsa ikisi birlikte.
export async function busLocation(loc, ctx, { only = null } = {}) {
  const here = { lat: Number(loc?.latitude), lon: Number(loc?.longitude) };
  if (!Number.isFinite(here.lat) || !Number.isFinite(here.lon)) return "Konumu okuyamadım.";
  if (only === "tram") return tramAlone(ctx, here);
  const tram = only === "bus" ? null : await tramNear(ctx, here).catch((err) => { console.error("tramvay durağı bulunamadı", err?.message); return null; });
  let index = await loadIndex(ctx.kv);
  let near = nearestStops(index, here);
  if (!near.length) {
    // Henüz bilinen durak yoksa kayıtlı durakların hatlarından öğrenmeye başla
    const saved = (await loadStops(ctx.kv)).slice(0, 3);
    const codes = [];
    for (const s of saved) codes.push(...(await fetchArrivals(ctx, s.id).catch(() => [])).filter((x) => x.type === "bus").map((x) => x.code));
    if (codes.length) {
      index = await learnLines(ctx, codes, index);
      near = nearestStops(index, here);
    }
  }
  if (!near.length) {
    if (tram) return tram.text;
    return [
      "📍 Bu civardaki durakları henüz tanımıyorum.",
      "Yakınındaki durağın numarasını (tabelada yazar) bir kez sorarsan, örneğin <code>/otobus 7548</code>, o durağa uğrayan hatların bütün duraklarını öğrenirim. Bir dahaki sefere konumundan bulurum.",
    ].join("\n");
  }
  let text = await arrivalsText(ctx, near.map((s) => ({ id: s.id, label: "", name: s.name, km: s.km })));
  // Tramvay durağı otobüs durağından yakınsa önce o gösterilir; tramvay durağı dibindeyse "tanımıyorum" uyarısı gereksiz
  if (tram) text = tram.km < near[0].km ? `${tram.text}\n\n${text}` : `${text}\n\n${tram.text}`;
  if (near[0].km <= FAR_KM || (tram && tram.km <= FAR_KM)) return text;
  return `${text}\n\n📍 Bildiğim en yakın durak ${Math.round(near[0].km * 1000 / 10) * 10}\u00a0m uzakta. Yanındaki durağı henüz tanımıyor olabilirim: tabeladaki numarayı yaz (örneğin <code>/otobus 467</code>), bir dahakine konumundan bulurum. Şehrin duraklarını arka planda da yavaş yavaş öğreniyorum.`;
}

// "/otobus test 7548": site değişti mi diye ham cevapların başını gösterir (yalnızca herkese açık durak verisi)
async function busTest(ctx, id) {
  const probes = [
    ["Geliş süreleri", arrivalsUrl(id), { headers: getHeaders() }],
    ["Durak arama", SEARCH_URL, { method: "POST", headers: HEADERS, body: JSON.stringify({ Search: id }) }],
  ];
  const out = [`🔧 <b>Otobüs testi</b> · durak ${esc(id)}`];
  for (const [label, url, init] of probes) {
    try {
      const res = await ctx.webFetch(url, init);
      const body = await res.text();
      out.push(`<b>${label}</b>: HTTP ${res.status} · ${esc(res.headers?.get?.("content-type") ?? "?")} · ${body.length} karakter\n<code>${esc(body.slice(0, 160))}</code>`);
    } catch (err) {
      out.push(`<b>${label}</b>: ulaşılamadı (${esc(String(err?.message ?? err).slice(0, 80))})`);
    }
  }
  return out.join("\n\n");
}

const stopLine = (s) => `<code>${esc(s.id)}</code> ${esc(s.name)}`;

// "/otobus" komutu
export async function cmdOtobus(args, ctx) {
  const raw = String(args ?? "").replace(/\s+/g, " ").trim();
  const words = raw.split(" ").filter(Boolean);
  const first = plain(words[0] ?? "");
  const stops = await loadStops(ctx.kv);

  if (["yardim", "help"].includes(first)) return BUS_HELP;
  if (first === "test") return busTest(ctx, /^\d{1,6}$/.test(words[1] ?? "") ? String(Number(words[1])) : "7548");
  if (["ara", "bul"].includes(first)) {
    const q = words.slice(1).join(" ");
    if (!q) return "Ne arayayım? Örnek: <code>/otobus ara erkilet</code>";
    let found;
    try {
      found = await searchStops(ctx, q);
    } catch (err) {
      console.error("durak araması yapılamadı", err?.message);
      return "Kayseri Ulaşım'a şu an ulaşamadım, birazdan yeniden dener misin?";
    }
    if (!found.length) return `"${esc(q)}" için durak bulamadım. Durak numarası tabelada yazar.`;
    return [`🚏 <b>Duraklar</b> · "${esc(q)}"`, ...found.map(stopLine), "", "Sormak için: <code>/otobus 7548</code> · kaydetmek için: <code>/otobus ekle 7548 okul</code>"].join("\n");
  }
  if (["ekle", "kaydet"].includes(first)) {
    const id = /^\d{1,6}$/.test(words[1] ?? "") ? String(Number(words[1])) : null;
    const label = words.slice(2).join(" ").slice(0, 30);
    if (!id) return "Durak numarasını yazar mısın? Örnek: <code>/otobus ekle 7548 okul</code>";
    const name = await stopName(ctx, id);
    const short = label || name.split(" - ")[0].slice(0, 30) || `Durak ${id}`;
    const rest = stops.filter((s) => s.id !== id && plain(s.label) !== plain(short));
    if (rest.length >= MAX_STOPS) return `En fazla ${MAX_STOPS} durak kaydedebilirim. Birini sil: <code>/otobus sil ad</code>`;
    await saveStops(ctx.kv, [...rest, { id, label: short, ...(name ? { name } : {}) }]);
    const real = name && plain(name) !== plain(short) ? ` (${esc(name)})` : "";
    return `🚌 ${esc(short)} durağını kaydettim: ${esc(id)}${real}.\nSormak için: <code>/otobus ${esc(plain(short).split(" ")[0])}</code>`;
  }
  if (["sil", "kaldir"].includes(first)) {
    const stop = findStop(stops, words.slice(1).join(" "));
    if (!stop) return "Bu adla kayıtlı durak yok. Kayıtlılar için: <code>/otobus</code>";
    await saveStops(ctx.kv, stops.filter((s) => s !== stop));
    return `${esc(stop.label)} durağını sildim.`;
  }
  if (["konum", "yer", "yakin", "yakinimdaki", "yakindaki"].includes(first) || plain(raw) === "en yakin") {
    return `📍 Konumunu gönderirsen en yakın durağa gelen otobüsleri gösteririm: ${HOW_LOCATION}`;
  }
  if (/^\d{1,6}$/.test(raw)) {
    const id = String(Number(raw));
    return arrivalsText(ctx, [stops.find((s) => s.id === id) ?? { id, label: "" }]);
  }
  if (raw) {
    const stop = findStop(stops, raw);
    if (stop) return arrivalsText(ctx, [stop]);
    return stops.length
      ? `"${esc(raw)}" adında kayıtlı durak yok. Kayıtlılar: ${stops.map((s) => `<code>${esc(s.label)}</code>`).join(", ")}\nDurak aramak için: <code>/otobus ara ${esc(raw.slice(0, 20))}</code>`
      : `Henüz kayıtlı durak yok. Durak aramak için: <code>/otobus ara ${esc(raw.slice(0, 20))}</code>\n\n${BUS_HELP}`;
  }
  if (!stops.length) return `Henüz kayıtlı durak yok. Durak numarasıyla sorabilir ya da kaydedebilirsin.\n\n${BUS_HELP}`;
  return arrivalsText(ctx, stops.slice(0, 3));
}

// Tramvay: duraklar ve tramvayın kaç dakikada geleceği. Veri Kayseri Ulaşım'ın tramvay sayfasının
// kullandığı adreslerden gelir (resmi, belgeli bir API değil). Tramvay durakları sayı değil, uzun bir kimlikle (GUID) tanınır.
// Siteden gelen yazılar yalnızca veridir.
import { esc, plain, trParts } from "./logic.js";
import { distanceKm } from "./quake.js";

const BASE = "https://www.kayseriulasim.com";
export const TRAM_KEY = "otobus:tramvay";            // { stops: { guid: [ad, enlem, boylam, [hatlar]] }, lines: [hat], at }
export const TRAM_LINES = ["T1", "T2", "T3"];        // bilinen hatlar; varış listesinde yeni hat görülürse o da öğrenilir
const TRAM_TTL_MS = 14 * 24 * 3600 * 1000;           // duraklar iki haftada bir yenilenir
const CACHE_TTL = 30;
const NEAR_KM = 0.8;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${BASE}/hatlar/tramvay`,
  "User-Agent": "Mozilla/5.0 (JarvisBot; kisisel asistan)",
};

export const TRAM_HELP = [
  "🚋 <b>Tramvay</b>",
  "<code>/tramvay ildem</code> o durağa tramvay kaç dakikada gelir · <code>/tramvay duraklar</code> bütün duraklar",
  "Konumunu gönderirsen (Telegram'da 📎 → Konum, panelde 🚌) yakınındaki tramvay durağı da gösterilir.",
  "<i>~</i> işaretli süreler canlı değil, tarifeye göre.",
].join("\n");

// Varış isteği: site tarayıcının "HatTuru=2" (tramvay) çerezine bakıyor; çerezsiz istek 500 veriyor.
// İsteğin tam biçimi belgeli olmadığı için birkaç biçim sırayla denenir; çalışan biçim bir gün hatırlanır.
const ARRIVAL_COOKIE = "dil=tr; HatTuru=2";
const ARRIVAL_REFERER = `${BASE}/OtobusTramvayHatlariHatDetay/HatDetay/1/?HAT_TURU=TRAMVAY&&HAT_YON=ARRIVAL`;
export const ARRIVAL_VARIANTS = [
  { label: "çerez", init: { method: "POST", headers: { ...HEADERS, Cookie: ARRIVAL_COOKIE, Referer: ARRIVAL_REFERER } } },
  { label: "çerez + JSON", init: { method: "POST", headers: { ...HEADERS, Cookie: ARRIVAL_COOKIE, Referer: ARRIVAL_REFERER, "Content-Type": "application/json; charset=utf-8" }, body: "{}" } },
  { label: "çerez + form", init: { method: "POST", headers: { ...HEADERS, Cookie: ARRIVAL_COOKIE, Referer: ARRIVAL_REFERER, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: "" } },
  { label: "GET", init: { method: "GET", headers: { ...HEADERS, Cookie: ARRIVAL_COOKIE, Referer: ARRIVAL_REFERER } } },
];

export const isGuid = (id) => GUID.test(String(id ?? ""));
export const tramMapUrl = (line, dir) => `${BASE}/OtobusTramvayHatlari/OtobusDuraklariHaritaJSON?lineId=${encodeURIComponent(line)}&directions=${dir}`;
export const tramArrivalsUrl = (id) => `${BASE}/OtobusTramvayHatlari/AracNeZamanGelecekTramvay/${id}`;

// Harita: [{ DurakAdi: "İldem5", DurakNo: "<guid>", Lat: "38.78", Lng: "35.62", SiraNo: "TRAMVAY" }]
export function parseTramStops(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((x) => ({
      id: String(x?.DurakNo ?? "").trim().toLowerCase(),
      name: String(x?.DurakAdi ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      lat: Number(x?.Lat), lon: Number(x?.Lng),
    }))
    .filter((s) => isGuid(s.id) && s.name && s.lat > 35 && s.lat < 42 && s.lon > 26 && s.lon < 45);
}

// Varış: [{ name: "[T1] İldem - Organize Sanayi", dataType: "LIVE" | "PLAN", timeToStop: 2 }]
export function parseTramArrivals(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((x) => {
      const m = /^\s*\[([^\]]{1,8})\]\s*(.*)$/.exec(String(x?.name ?? ""));
      return {
        code: (m?.[1] ?? "").trim(),
        name: (m?.[2] ?? String(x?.name ?? "")).replace(/\s+/g, " ").trim().slice(0, 60),
        min: Number(x?.timeToStop),
        live: String(x?.dataType ?? "").toUpperCase() === "LIVE",
      };
    })
    .filter((x) => x.code && Number.isFinite(x.min) && x.min >= 0 && x.min < 180)
    .sort((a, b) => a.min - b.min);
}

export async function loadTramIndex(kv) {
  try {
    const d = JSON.parse((await kv.get(TRAM_KEY)) ?? "null");
    return { stops: d?.stops ?? {}, lines: Array.isArray(d?.lines) ? d.lines : [], at: Number(d?.at) || 0 };
  } catch {
    return { stops: {}, lines: [], at: 0 };
  }
}

// Bütün hatların iki yönünün duraklarını yeniden okur (3 hat x 2 yön = 6 istek). Hiçbiri okunamazsa eskisi kalır.
export async function refreshTrams(ctx, index = null, extra = []) {
  const idx = index ?? (await loadTramIndex(ctx.kv));
  const lines = [...new Set([...TRAM_LINES, ...idx.lines, ...extra])].filter((l) => /^T\d{1,2}$/i.test(l)).slice(0, 8);
  const stops = {}, found = [];
  let ok = 0;
  for (const line of lines) {
    for (const dir of [1, 2]) {
      try {
        const res = await ctx.webFetch(tramMapUrl(line, dir), { headers: HEADERS });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ok += 1;
        for (const s of parseTramStops(await res.json())) {
          const old = stops[s.id];
          stops[s.id] = [s.name, Math.round(s.lat * 1e6) / 1e6, Math.round(s.lon * 1e6) / 1e6, [...new Set([...(old?.[3] ?? []), line])]];
          if (!found.includes(line)) found.push(line);
        }
      } catch (err) {
        console.error("tramvay durakları alınamadı", err?.message);
      }
    }
  }
  if (!ok || !Object.keys(stops).length) return idx;
  const next = { stops, lines: found, at: ctx.now };
  await ctx.kv.put(TRAM_KEY, JSON.stringify(next));
  return next;
}

// Duraklar yoksa ya da eskidiyse yeniler. Site cevap vermiyorsa 10 dakika yeniden denemez.
export async function tramIndex(ctx) {
  const idx = await loadTramIndex(ctx.kv);
  if (Object.keys(idx.stops).length && ctx.now - idx.at < TRAM_TTL_MS) return idx;
  if (await ctx.cache?.get("tramvay:denendi").catch(() => null)) return idx;
  await ctx.cache?.put("tramvay:denendi", true, 600).catch(() => {});
  return refreshTrams(ctx, idx);
}

// Arka planda (10 dakikada bir, dakika 5'te): duraklar eskidiyse yeniler; aksi halde hiçbir istek yapmaz.
export async function crawlTram(ctx) {
  if (trParts(ctx.now).mm % 10 !== 5) return { skipped: true };
  const idx = await loadTramIndex(ctx.kv);
  if (Object.keys(idx.stops).length && ctx.now - idx.at < TRAM_TTL_MS) return { fresh: true };
  const next = await refreshTrams(ctx, idx);
  return { stops: Object.keys(next.stops).length };
}

export async function fetchTramArrivals(ctx, id) {
  if (!isGuid(id)) throw new Error("geçersiz durak");
  const name = `tramvay:${id}`;
  const hit = await ctx.cache?.get(name).catch(() => null);
  if (hit) return hit;
  const known = Number(await ctx.cache?.get("tramvay:bicim").catch(() => null));
  const order = Number.isInteger(known) && ARRIVAL_VARIANTS[known] ? [known, ...ARRIVAL_VARIANTS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...ARRIVAL_VARIANTS.keys()];
  let last = null;
  for (const v of order) {
    try {
      const res = await ctx.webFetch(tramArrivalsUrl(id), ARRIVAL_VARIANTS[v].init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = parseTramArrivals(await res.json());
      if (v !== known) await ctx.cache?.put("tramvay:bicim", v, 24 * 3600).catch(() => {});
      await ctx.cache?.put(name, list, CACHE_TTL).catch(() => {});
      return list;
    } catch (err) {
      last = err;   // bu biçim çalışmadı (ya da hatırlanan biçim artık çalışmıyor): sıradakini dene
    }
  }
  throw last ?? new Error("tramvay varışı alınamadı");
}

const metres = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1)} km`);

export function formatTram(stop, arrivals, nowMs) {
  const p = trParts(nowMs);
  const time = `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
  const far = Number.isFinite(stop.km) ? ` · ${metres(stop.km)} uzakta` : "";
  const head = `🚋 <b>${esc(stop.name)}</b> tramvay durağı · ${time}${far}`;
  if (!arrivals.length) return `${head}\nŞu an bu durağa yaklaşan tramvay görünmüyor.`;
  const lines = new Map();
  for (const a of arrivals) {
    const k = `${a.code}|${a.name}`;
    if (!lines.has(k)) lines.set(k, { ...a, times: [] });
    lines.get(k).times.push((a.live ? "" : "~") + (a.min <= 0 ? "geliyor" : `${a.min} dk`));
  }
  const rows = [...lines.values()].slice(0, 6).map((l) => `<b>${esc(l.code)}</b> ${esc(l.name)} · ${l.times.slice(0, 3).join(", ")}`);
  if (arrivals.some((a) => !a.live)) rows.push("<i>~ tarifeye göre</i>");
  return [head, ...rows].join("\n");
}

async function stopsText(ctx, stops) {
  const out = [];
  for (const s of stops) {
    try {
      out.push(formatTram(s, await fetchTramArrivals(ctx, s.id), ctx.now));
    } catch (err) {
      console.error("tramvay bilgisi alınamadı", err?.message);
      out.push(`🚋 <b>${esc(s.name)}</b>: Kayseri Ulaşım'a şu an ulaşamadım, birazdan yeniden dener misin?`);
    }
  }
  return out.join("\n\n");
}

// Konuma en yakın tramvay durağı (ve varsa aynı adlı karşı peronu)
export function nearestTram(index, here, maxKm = NEAR_KM) {
  const all = Object.entries(index.stops)
    .map(([id, [name, lat, lon]]) => ({ id, name, km: distanceKm(here, { lat, lon }) }))
    .filter((s) => s.km <= maxKm)
    .sort((a, b) => a.km - b.km);
  if (!all.length) return [];
  return all.filter((s) => s === all[0] || (s.name === all[0].name && s.km - all[0].km < 0.25)).slice(0, 2);
}

// Konum mesajı için: yakında tramvay durağı varsa { km, text }, yoksa null. Konum saklanmaz.
export async function tramNear(ctx, here) {
  const near = nearestTram(await tramIndex(ctx), here);
  if (!near.length) return null;
  return { km: near[0].km, text: await stopsText(ctx, near) };
}

// Yalnız tramvay (panelin 🚋 düğmesi): yakında durak yoksa en yakın tramvay durağının ne kadar uzakta olduğunu söyler.
export async function tramAlone(ctx, here) {
  const index = await tramIndex(ctx);
  if (!Object.keys(index.stops).length) return "Tramvay duraklarını şu an Kayseri Ulaşım'dan alamadım. Birazdan yeniden dener misin?";
  const near = nearestTram(index, here);
  if (near.length) return stopsText(ctx, near);
  const [closest] = nearestTram(index, here, Infinity);
  return `🚋 Yakınında (800\u00a0m içinde) tramvay durağı yok. En yakın tramvay durağı <b>${esc(closest.name)}</b>, ${metres(closest.km)} uzakta.\nO durak için: <code>/tramvay ${esc(closest.name)}</code>`;
}

// Ada göre durak bulur: önce tam eşleşme, sonra başı ya da içi tutanlar. Aynı adlı peronlar birlikte döner.
export function findTramStops(index, query) {
  const squash = (t) => plain(t).replace(/[^\p{L}\p{N}]/gu, "");
  const q = squash(query);
  if (!q) return [];
  const all = Object.entries(index.stops).map(([id, [name]]) => ({ id, name, key: squash(name) }));
  for (const test of [(k) => k === q, (k) => k.startsWith(q), (k) => k.includes(q)]) {
    const hits = all.filter((s) => test(s.key));
    if (hits.length) return hits;
  }
  return [];
}

async function tramTest(ctx, index) {
  const id = Object.keys(index.stops)[0];
  const probes = [["Durak haritası (T1)", tramMapUrl("T1", 2), { headers: HEADERS }]];
  if (id) for (const v of ARRIVAL_VARIANTS) probes.push([`Varış süreleri (${v.label}) · ${esc(index.stops[id][0])}`, tramArrivalsUrl(id), v.init]);
  const out = ["🔧 <b>Tramvay testi</b>"];
  for (const [label, url, init] of probes) {
    try {
      const res = await ctx.webFetch(url, init);
      const body = await res.text();
      out.push(`<b>${label}</b>: HTTP ${res.status} · ${body.length} karakter\n<code>${esc(body.slice(0, 160))}</code>`);
    } catch (err) {
      out.push(`<b>${label}</b>: ulaşılamadı (${esc(String(err?.message ?? err).slice(0, 80))})`);
    }
  }
  return out.join("\n\n");
}

export async function cmdTramvay(args, ctx) {
  const raw = String(args ?? "").replace(/\s+/g, " ").trim();
  const first = plain(raw.split(" ")[0] ?? "");
  if (["yardim", "help"].includes(first)) return TRAM_HELP;
  if (["konum", "yakin", "yakinimdaki"].includes(first)) {
    return "📍 Konumunu gönderirsen en yakın tramvay ve otobüs durağını gösteririm: Telegram'da 📎 → <b>Konum</b>; panelde 🚌 düğmesi.";
  }
  const index = await tramIndex(ctx);
  if (first === "test") return tramTest(ctx, index);
  const names = [...new Set(Object.values(index.stops).map((s) => s[0]))];
  if (!names.length) return "Tramvay duraklarını şu an Kayseri Ulaşım'dan alamadım. Birazdan yeniden dener misin?";
  if (!raw || ["duraklar", "liste", "hepsi"].includes(first)) {
    const sorted = names.sort((a, b) => a.localeCompare(b, "tr"));
    return [`🚋 <b>Tramvay durakları</b> · ${sorted.length}`, sorted.map(esc).join(", "), "", "Sormak için: <code>/tramvay ildem</code>"].join("\n");
  }
  const hits = findTramStops(index, raw);
  const distinct = [...new Set(hits.map((h) => h.name))];
  if (!hits.length) return `"${esc(raw)}" adında tramvay durağı bulamadım. Bütün duraklar için: <code>/tramvay duraklar</code>`;
  if (distinct.length > 1) {
    return `Birden fazla durak tutuyor: ${distinct.slice(0, 10).map((n) => `<code>${esc(n)}</code>`).join(", ")}\nHangisi? Örnek: <code>/tramvay ${esc(distinct[0])}</code>`;
  }
  return stopsText(ctx, hits.slice(0, 2));
}

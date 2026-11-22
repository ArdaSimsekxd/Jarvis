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

// Varış isteği (Arda'nın DevTools kaydından): JSON gövdede durağın kodu { code: "<guid>" }, tramvay çerezi
// "HatTuru=2" ve HatDetay sayfasının Referer'ı. Gövdesiz istekte site "404 Sayfa Bulunamadı" sayfasıyla 500 veriyor.
// Doğru istekte 500 gelirse o durak için veri yok sayılır (ör. hat sonu ya da teknik durak).
const ARRIVAL_COOKIE = "dil=tr; HatTuru=2";
const ARRIVAL_REFERER = `${BASE}/OtobusTramvayHatlariHatDetay/HatDetay/1/?HAT_TURU=TRAMVAY&&HAT_YON=ARRIVAL`;
export function arrivalInit(id) {
  return {
    method: "POST",
    headers: {
      ...HEADERS,
      "Accept-Language": "tr-TR,tr;q=0.9",
      Origin: BASE,
      Cookie: ARRIVAL_COOKIE,
      Referer: ARRIVAL_REFERER,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ code: id }),
  };
}

const NO_DATA_TTL = 300;                              // 500 veren durak 5 dakika yeniden sorulmaz
const TECHNICAL = /makas/i;                           // "Makas Bölgesi" gibi yolcu durağı olmayan noktalar konum aramasında atlanır

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
  if (hit === "yok") throw noData();
  if (hit) return hit;
  const res = await ctx.webFetch(tramArrivalsUrl(id), arrivalInit(id));
  if (res.status === 500) {
    await ctx.cache?.put(name, "yok", NO_DATA_TTL).catch(() => {});
    throw noData();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseTramArrivals(await res.json());
  await ctx.cache?.put(name, list, CACHE_TTL).catch(() => {});
  return list;
}

function noData() {
  const err = new Error("durak için veri yok");
  err.noData = true;
  return err;
}

const metres = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1)} km`);

// "İldem - Organize Sanayi" → { from: "İldem", to: "Organize Sanayi" }: tramvayın nereden gelip nereye gittiği
export function tramRoute(name) {
  const parts = String(name ?? "").split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? { from: parts.slice(0, -1).join(" - "), to: parts[parts.length - 1] } : { from: "", to: parts[0] ?? "" };
}

const NO_DATA_TEXT = "Kayseri Ulaşım bu durak için şu an varış bilgisi vermiyor (hat sonu ya da sefer dışı olabilir). Bir sonraki durağı dener misin?";
const UNREACHABLE_TEXT = "Kayseri Ulaşım'a şu an ulaşamadım, birazdan yeniden dener misin?";

// Bir peronun satırları ve o perondan kalkan tramvayların gittiği yönler
function platform(arrivals) {
  const lines = new Map();
  for (const a of arrivals) {
    const k = `${a.code}|${a.name}`;
    if (!lines.has(k)) lines.set(k, { ...a, times: [] });
    lines.get(k).times.push((a.live ? "" : "~") + (a.min <= 0 ? "geliyor" : `${a.min} dk`));
  }
  const list = [...lines.values()].slice(0, 6);
  const rows = list.map((l) => {
    const r = tramRoute(l.name);
    return `<b>${esc(l.code)}</b> ${r.from ? `${esc(r.from)} ` : ""}→ <b>${esc(r.to)}</b> · ${l.times.slice(0, 3).join(", ")}`;
  });
  const dests = [...new Set(list.map((l) => tramRoute(l.name).to).filter(Boolean))].slice(0, 3);
  return { rows, dir: dests.length ? `${dests.map(esc).join(" / ")} yönü` : "" };
}

// Bir durak (aynı adlı iki peronuyla birlikte). platforms: [{ km, arrivals } | { km, error }]
// Her peron, oradan kalkan tramvayların gittiği yönle başlıklandırılır; böylece hangi perona gidileceği anlaşılır.
export function formatStop(name, platforms, nowMs) {
  const p = trParts(nowMs);
  const time = `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
  const far = (km) => (Number.isFinite(km) ? ` · ${metres(km)} uzakta` : "");
  const errText = (e) => (e?.noData ? NO_DATA_TEXT : UNREACHABLE_TEXT);
  const anyPlan = platforms.some((x) => x.arrivals?.some((a) => !a.live));
  if (platforms.length === 1) {
    const [one] = platforms;
    if (one.error) return `🚋 <b>${esc(name)}</b>: ${errText(one.error)}`;
    const head = `🚋 <b>${esc(name)}</b> tramvay durağı · ${time}${far(one.km)}`;
    if (!one.arrivals.length) return `${head}\nŞu an bu durağa yaklaşan tramvay görünmüyor.`;
    const { rows, dir } = platform(one.arrivals);
    return [head, ...(dir ? [`➡️ ${dir}`] : []), ...rows, ...(anyPlan ? ["<i>~ tarifeye göre</i>"] : [])].join("\n");
  }
  const parts = [`🚋 <b>${esc(name)}</b> tramvay durağı · ${time}`];
  platforms.forEach((x, i) => {
    const mark = i === 0 ? "➡️" : "⬅️";
    if (x.error) return parts.push(`${mark} Bir peron${far(x.km)}: ${errText(x.error)}`);
    if (!x.arrivals.length) return parts.push(`${mark} Bir peron${far(x.km)}: şu an yaklaşan tramvay yok.`);
    const { rows, dir } = platform(x.arrivals);
    parts.push([`${mark} <b>${dir || "Bir peron"}</b>${far(x.km)}`, ...rows].join("\n"));
  });
  parts.push(["<i>Gideceğin yön hangi başlıktaysa o perondan bin.</i>", ...(anyPlan ? ["<i>~ tarifeye göre</i>"] : [])].join("\n"));
  return parts.join("\n\n");
}

export function formatTram(stop, arrivals, nowMs) {
  return formatStop(stop.name, [{ km: stop.km, arrivals }], nowMs);
}

async function stopsText(ctx, stops) {
  const groups = new Map();
  for (const s of stops) {
    let entry;
    try {
      entry = { km: s.km, arrivals: await fetchTramArrivals(ctx, s.id) };
    } catch (err) {
      if (!err?.noData) console.error("tramvay bilgisi alınamadı", err?.message);
      entry = { km: s.km, error: err };
    }
    if (!groups.has(s.name)) groups.set(s.name, []);
    groups.get(s.name).push(entry);
  }
  return [...groups].map(([name, platforms]) => formatStop(name, platforms, ctx.now)).join("\n\n");
}

// Konuma en yakın tramvay durağı (ve varsa aynı adlı karşı peronu)
export function nearestTram(index, here, maxKm = NEAR_KM) {
  const all = Object.entries(index.stops)
    .map(([id, [name, lat, lon]]) => ({ id, name, km: distanceKm(here, { lat, lon }) }))
    .filter((s) => s.km <= maxKm && !TECHNICAL.test(s.name))
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

// Hata sayfasından kısa bir ipucu: başlık ve "hata/exception" geçen ilk cümle (sitenin yazısı, yalnızca gösterilir).
export function errorHint(html) {
  const text = String(html ?? "");
  const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const bare = text.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
  const m = /[^.!?]{0,60}(hata|error|exception|istisna|bulunamad|object reference|null)[^.!?]{0,100}/i.exec(bare);
  return [title && `başlık: ${title}`, m && `ipucu: ${m[0].trim()}`].filter(Boolean).join(" · ").slice(0, 260);
}

// Test: harita + bir durağın varışı. "/tramvay test hunat" o durağı dener.
function testStop(index, query) {
  if (query) return findTramStops(index, query)[0] ?? null;
  const all = Object.entries(index.stops).map(([id, [name]]) => ({ id, name }));
  return all.find((s) => s.name === "İldem1") ?? all.find((s) => /^[İi]ldem/.test(s.name)) ?? all[0] ?? null;
}

async function tramTest(ctx, index, query) {
  const stop = testStop(index, query);
  if (query && !stop) return `"${esc(query)}" adında tramvay durağı bulamadım.`;
  const probes = [["Durak haritası (T1)", tramMapUrl("T1", 2), { headers: HEADERS }]];
  if (stop) probes.push([`Varış · ${esc(stop.name)}`, tramArrivalsUrl(stop.id), arrivalInit(stop.id)]);
  const out = ["🔧 <b>Tramvay testi</b>"];
  for (const [label, url, init] of probes) {
    try {
      const res = await ctx.webFetch(url, init);
      const body = await res.text();
      const html = /^\s*</.test(body);
      const hint = html ? errorHint(body) : "";
      out.push(`<b>${label}</b>: HTTP ${res.status} · ${body.length} karakter\n<code>${esc(html ? hint || "(HTML sayfa)" : body.slice(0, 120))}</code>`);
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
  if (first === "test") return tramTest(ctx, index, raw.split(" ").slice(1).join(" "));
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

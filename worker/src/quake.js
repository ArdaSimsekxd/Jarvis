// Deprem uyarısı: AFAD'ın son depremler listesini 2 dakikada bir okur. Kullanıcının şehirlerine yakın
// ya da Türkiye'de büyük bir deprem olunca Telegram'a (ve telefondaki uygulamaya) haber verir.
// AFAD'a ulaşılamazsa sırayla EMSC ve USGS denenir. Gelen yazılar yalnızca veridir.
import { esc, isQuiet, plain, trParts } from "./logic.js";

export const QUAKE_KEY = "deprem";
export const AFAD_URL = "https://deprem.afad.gov.tr/apiv2/event/filter";
export const EMSC_URL = "https://www.seismicportal.eu/fdsnws/event/1/query";
export const USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
export const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";

const HOUR = 3600 * 1000;
const WINDOW_MS = 3 * HOUR;          // her turda son 3 saat okunur
const FRESH_MS = HOUR;               // yalnızca son 1 saatteki depremler bildirilir (eskiler zaten kaçmıştır)
const NEAR_KM = 150;                 // "yakın": bu mesafede eşik kullanıcının seçtiği büyüklük
const REGION_KM = 400;               // bölge: 4.5 ve üstü
const REGION_MAG = 4.5;
const TURKEY_MAG = 5.0;              // Türkiye'nin herhangi bir yerinde
const NIGHT_MAG = 4.0;               // gece (00:00-07:00) küçük depremler için uyandırmaz
const MAX_PLACES = 5;
const MAX_SEEN = 60;
const MAX_ALERTS = 3;                // bir turda en fazla bu kadar mesaj
// Türkiye ve yakın çevresi (enlem/boylam kutusu)
const BOX = { minlat: 35.5, maxlat: 42.5, minlon: 25.5, maxlon: 45.0 };

export const DEFAULT_SETTINGS = {
  on: true,
  min: 3.5,
  places: [{ name: "Kayseri", lat: 38.7225, lon: 35.4875 }],
  seen: [],
};

const two = (n) => String(n).padStart(2, "0");
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

function utcStamp(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

// İki nokta arası kuş uçuşu mesafe (km)
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Saat bilgisi saat dilimi içermiyorsa UTC sayılır. Sonuç gelecekte kalıyorsa yazı Türkiye saatiyle
// gelmiş demektir (UTC+3): üç saat geri alınır.
export function parseTime(value, nowMs) {
  if (typeof value === "number") return value;
  const s = String(value ?? "").trim();
  if (!s) return NaN;
  let t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  if (t > nowMs + 10 * 60 * 1000) t -= 3 * HOUR;
  return t;
}

function clean(e) {
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || !Number.isFinite(e.mag) || !Number.isFinite(e.time)) return null;
  return {
    id: String(e.id ?? `${e.time}-${e.lat}-${e.lon}`).slice(0, 80),
    time: e.time,
    lat: e.lat,
    lon: e.lon,
    mag: Math.round(e.mag * 10) / 10,
    depth: Number.isFinite(e.depth) ? Math.round(e.depth * 10) / 10 : null,
    place: String(e.place ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    source: e.source,
  };
}

// AFAD: [{ eventID, latitude, longitude, depth, magnitude, location, province, district, date }, ...]
export function parseAfad(data, nowMs) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.result) ? data.result : null;
  if (!list) throw new Error("AFAD cevabı tanınmadı");
  return list.map((e) => clean({
    id: e.eventID ?? e.eventId ?? e.id,
    time: parseTime(e.date ?? e.eventDate ?? e.time, nowMs),
    lat: num(e.latitude ?? e.lat), lon: num(e.longitude ?? e.lon),
    mag: num(e.magnitude ?? e.mag), depth: num(e.depth),
    place: [e.district, e.province].filter(Boolean).join(", ") || e.location || e.region,
    source: "AFAD",
  })).filter(Boolean);
}

// EMSC (FDSN, GeoJSON): features[].properties { unid, time, lat, lon, depth, mag, flynn_region }
export function parseEmsc(data, nowMs) {
  if (!Array.isArray(data?.features)) throw new Error("EMSC cevabı tanınmadı");
  return data.features.map((f) => {
    const p = f.properties ?? {};
    const [lon, lat, depth] = f.geometry?.coordinates ?? [];
    return clean({
      id: `emsc-${p.unid ?? f.id}`, time: parseTime(p.time, nowMs),
      lat: num(p.lat ?? lat), lon: num(p.lon ?? lon), mag: num(p.mag), depth: Math.abs(num(p.depth ?? depth)),
      place: p.flynn_region, source: "EMSC",
    });
  }).filter(Boolean);
}

// USGS (GeoJSON): features[] { id, properties { mag, place, time (ms) }, geometry { coordinates [lon, lat, depth] } }
export function parseUsgs(data) {
  if (!Array.isArray(data?.features)) throw new Error("USGS cevabı tanınmadı");
  return data.features.map((f) => {
    const [lon, lat, depth] = f.geometry?.coordinates ?? [];
    return clean({
      id: `usgs-${f.id}`, time: num(f.properties?.time), lat: num(lat), lon: num(lon), mag: num(f.properties?.mag),
      depth: num(depth), place: f.properties?.place, source: "USGS",
    });
  }).filter(Boolean);
}

function sources(nowMs, minMag) {
  const start = utcStamp(nowMs - WINDOW_MS), end = utcStamp(nowMs + 5 * 60 * 1000);
  const q = (o) => new URLSearchParams(o).toString();
  return [
    { name: "AFAD", url: `${AFAD_URL}?${q({ start, end, minmag: minMag, orderby: "timedesc", limit: 200, format: "json" })}`, parse: parseAfad },
    {
      name: "EMSC",
      url: `${EMSC_URL}?${q({ format: "json", start, minmag: minMag, ...BOX, orderby: "time", limit: 200 })}`,
      parse: parseEmsc,
    },
    {
      name: "USGS",
      url: `${USGS_URL}?${q({
        format: "geojson", starttime: start, minmagnitude: minMag, minlatitude: BOX.minlat, maxlatitude: BOX.maxlat,
        minlongitude: BOX.minlon, maxlongitude: BOX.maxlon, orderby: "time", limit: 200,
      })}`,
      parse: parseUsgs,
    },
  ];
}

// Son depremleri ilk cevap veren kaynaktan okur. Dönen: { source, events } ya da { error }
export async function fetchQuakes(ctx, { minMag = 2.5, nowMs = ctx.now } = {}) {
  for (const s of sources(nowMs, minMag)) {
    try {
      const res = await ctx.webFetch(s.url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const events = s.parse(await res.json(), nowMs)
        .filter((e) => e.lat >= BOX.minlat && e.lat <= BOX.maxlat && e.lon >= BOX.minlon && e.lon <= BOX.maxlon)
        .sort((a, b) => b.time - a.time);
      return { source: s.name, events };
    } catch (err) {
      console.error("deprem kaynağı okunamadı", s.name, err?.message);
    }
  }
  return { error: true };
}

export async function loadSettings(kv) {
  let saved = null;
  try {
    saved = JSON.parse((await kv.get(QUAKE_KEY)) ?? "null");
  } catch { /* bozuk kayıt: varsayılan */ }
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}), places: saved?.places ?? DEFAULT_SETTINGS.places, seen: saved?.seen ?? [] };
}

function saveSettings(kv, s) {
  return kv.put(QUAKE_KEY, JSON.stringify({ ...s, seen: s.seen.slice(-MAX_SEEN) }));
}

function nearest(e, places) {
  let best = null;
  for (const p of places) {
    const km = distanceKm(e, p);
    if (!best || km < best.km) best = { name: p.name, km };
  }
  return best;
}

// Bu deprem bildirilmeli mi? Dönen: en yakın şehir bilgisi ya da null
export function shouldAlert(e, settings, nowMs) {
  const near = nearest(e, settings.places);
  const night = isQuiet(nowMs);
  const floor = (m) => (night ? Math.max(m, NIGHT_MAG) : m);
  if (near && near.km <= NEAR_KM && e.mag >= floor(settings.min)) return near;
  if (near && near.km <= REGION_KM && e.mag >= floor(Math.max(settings.min, REGION_MAG))) return near;
  if (e.mag >= floor(Math.max(settings.min, TURKEY_MAG))) return near ?? { name: null, km: null };
  return null;
}

// Aynı deprem farklı kaynaklardan farklı numarayla gelebilir: zaman ve yer de karşılaştırılır.
function alreadySeen(e, seen) {
  return seen.some((s) => s.id === e.id || (Math.abs(s.time - e.time) < 120 * 1000 && distanceKm(s, e) < 60));
}

function clock(ms) {
  const p = trParts(ms);
  return `${two(p.hh)}:${two(p.mm)}`;
}

function dayClock(ms, nowMs) {
  const p = trParts(ms), n = trParts(nowMs);
  return p.d === n.d && p.m === n.m ? clock(ms) : `${two(p.d)}.${two(p.m)} ${clock(ms)}`;
}

function where(e, near) {
  const parts = [];
  if (e.place) parts.push(esc(e.place));
  if (near?.name) parts.push(`${esc(near.name)}: ${Math.round(near.km)} km uzakta`);
  return parts.join(" · ");
}

export function formatAlert(e, near, nowMs) {
  const strong = e.mag >= 5 || (near?.km !== null && near?.km <= NEAR_KM && e.mag >= 4.5);
  const lines = [
    `${strong ? "⚠️" : "🌍"} <b>Deprem: ${e.mag.toFixed(1)}</b>`,
    where(e, near),
    `Saat ${dayClock(e.time, nowMs)}${e.depth !== null ? ` · derinlik ${e.depth} km` : ""} · kaynak ${e.source}`,
  ];
  if (strong) lines.push("Güvendeysen sakin ol; artçılara karşı dikkatli ol. Acil durumda 112.");
  return lines.filter(Boolean).join("\n");
}

// Zamanlayıcıdan her turda çağrılır: yeni ve önemli depremleri bildirir.
export async function checkQuakes(ctx) {
  const settings = await loadSettings(ctx.kv);
  if (!settings.on) return 0;
  const got = await fetchQuakes(ctx, { minMag: Math.min(settings.min, NIGHT_MAG) });
  if (got.error) return 0;
  const fresh = got.events.filter((e) => e.time >= ctx.now - FRESH_MS && !alreadySeen(e, settings.seen));
  const alerts = [];
  for (const e of fresh.reverse()) {   // eskiden yeniye
    const near = shouldAlert(e, settings, ctx.now);
    if (near) alerts.push({ e, near });
  }
  if (!alerts.length) return 0;
  let sent = 0;
  const skipped = alerts.slice(0, -MAX_ALERTS);   // çok sayıda deprem: yalnızca en yeni birkaçı yazılır
  for (const { e } of skipped) settings.seen.push({ id: e.id, time: e.time, lat: e.lat, lon: e.lon });
  for (const { e, near } of alerts.slice(-MAX_ALERTS)) {
    const ok = await ctx.send(formatAlert(e, near, ctx.now));
    if (ok === false) break;   // gönderilemedi: sonraki turda yeniden denenir
    settings.seen.push({ id: e.id, time: e.time, lat: e.lat, lon: e.lon });
    sent += 1;
  }
  if (sent || skipped.length) await saveSettings(ctx.kv, settings);
  return sent;
}

// Şehir adını koordinata çevirir (Open-Meteo, anahtarsız). Türkiye'deki sonuç önce gelir.
async function geocode(ctx, name) {
  const url = `${GEO_URL}?${new URLSearchParams({ name, count: "5", language: "tr", format: "json" })}`;
  const res = await ctx.webFetch(url, {});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const results = (await res.json())?.results ?? [];
  const hit = results.find((r) => r.country_code === "TR") ?? results[0];
  if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null;
  return { name: String(hit.name).slice(0, 40), lat: Math.round(hit.latitude * 1e4) / 1e4, lon: Math.round(hit.longitude * 1e4) / 1e4 };
}

function placesLine(s) {
  return s.places.length ? s.places.map((p) => esc(p.name)).join(", ") : "yok";
}

function settingsText(s) {
  return [
    `Uyarı: <b>${s.on ? "açık" : "kapalı"}</b> · Şehirler: <b>${placesLine(s)}</b>`,
    `${s.min.toFixed(1)} ve üstü ${NEAR_KM} km içinde, ${REGION_MAG} ve üstü ${REGION_KM} km içinde, ${TURKEY_MAG.toFixed(1)} ve üstü Türkiye'nin her yerinde haber veririm. Gece 00:00-07:00 arası ${NIGHT_MAG.toFixed(1)} altını bildirmem.`,
  ].join("\n");
}

export const QUAKE_HELP = [
  "<code>/deprem</code> son depremler ve ayarlar",
  "<code>/deprem ekle İstanbul</code> bir şehri de takip et (en fazla 5)",
  "<code>/deprem sil İstanbul</code> şehri çıkar",
  "<code>/deprem esik 4</code> yakındaki depremler için en küçük büyüklük",
  "<code>/deprem kapat</code> · <code>/deprem ac</code>",
].join("\n");

async function recent(ctx, s) {
  const got = await fetchQuakes(ctx, { minMag: 3 });
  if (got.error) return "Deprem servislerine şu an ulaşamadım. Birazdan yeniden dener misin?";
  const day = got.events;
  if (!day.length) return `Son 3 saatte Türkiye'de 3.0 ve üstü deprem yok. (kaynak ${got.source})`;
  const lines = day.slice(0, 8).map((e) => {
    const near = nearest(e, s.places);
    const far = near ? ` · ${esc(near.name)}: ${Math.round(near.km)} km` : "";
    return `• <b>${e.mag.toFixed(1)}</b> ${esc(e.place || "?")} · ${dayClock(e.time, ctx.now)}${far}`;
  });
  return [`🌍 <b>Son depremler</b> (son 3 saat, 3.0 ve üstü, kaynak ${got.source})`, ...lines].join("\n");
}

export async function cmdDeprem(args, ctx) {
  const s = await loadSettings(ctx.kv);
  const [word, ...rest] = String(args ?? "").trim().split(/\s+/);
  const w = plain(word ?? "");
  const value = rest.join(" ").trim();
  if (!w) return [await recent(ctx, s), "", settingsText(s), "", QUAKE_HELP].join("\n");
  if (["kapat", "kapa", "durdur"].includes(w)) {
    await saveSettings(ctx.kv, { ...s, on: false });
    return "🔕 Deprem uyarısını kapattım. Açmak için <code>/deprem ac</code> yaz.";
  }
  if (["ac", "baslat"].includes(w)) {
    await saveSettings(ctx.kv, { ...s, on: true });
    return `🔔 Deprem uyarısı açık.\n${settingsText({ ...s, on: true })}`;
  }
  if (["esik", "buyukluk", "min"].includes(w)) {
    const m = Number(value.replace(",", "."));
    if (!Number.isFinite(m) || m < 2.5 || m > 7) return "Eşik 2.5 ile 7 arasında olmalı. Örnek: <code>/deprem esik 4</code>";
    const next = { ...s, min: Math.round(m * 10) / 10 };
    await saveSettings(ctx.kv, next);
    return `✅ Tamam. ${settingsText(next)}`;
  }
  if (["ekle", "takip"].includes(w)) {
    if (!value) return "Hangi şehri ekleyeyim? Örnek: <code>/deprem ekle İzmir</code>";
    if (s.places.length >= MAX_PLACES) return `En fazla ${MAX_PLACES} şehir takip edebilirim. Önce birini <code>/deprem sil</code> ile çıkar.`;
    let place = null;
    try {
      place = await geocode(ctx, value.slice(0, 60));
    } catch (err) {
      console.error("şehir bulunamadı", err?.message);
      return "Şehri şu an arayamadım. Birazdan yeniden dener misin?";
    }
    if (!place) return `"${esc(value)}" diye bir yer bulamadım. Şehir ya da ilçe adını yazar mısın?`;
    if (s.places.some((p) => plain(p.name) === plain(place.name))) return `${esc(place.name)} zaten listede.`;
    const next = { ...s, places: [...s.places, place] };
    await saveSettings(ctx.kv, next);
    return `✅ ${esc(place.name)} eklendi. Takip edilen şehirler: <b>${placesLine(next)}</b>`;
  }
  if (["sil", "cikar", "kaldir"].includes(w)) {
    const i = /^\d+$/.test(value) ? Number(value) - 1 : s.places.findIndex((p) => plain(p.name) === plain(value));
    if (i < 0 || i >= s.places.length) return `Listede böyle bir şehir yok. Şehirler: <b>${placesLine(s)}</b>`;
    const next = { ...s, places: s.places.filter((_, j) => j !== i) };
    await saveSettings(ctx.kv, next);
    return `🗑 ${esc(s.places[i].name)} çıkarıldı. Şehirler: <b>${placesLine(next)}</b>${next.places.length ? "" : "\nŞehir kalmadı: yalnızca Türkiye'deki 5.0 ve üstü depremleri bildiririm."}`;
  }
  return QUAKE_HELP;
}

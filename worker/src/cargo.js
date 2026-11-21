// Kargo takibi: takip numaraları 17TRACK'e kaydedilir (Yurtiçi, Aras, PTT, Trendyol Express, HepsiJET ve
// yüzlerce başka firma). Bot yarım saatte bir son durumu okur; değişince Telegram'a ve telefona haber verir.
// Anahtar yalnızca Cloudflare'deki gizli alanda (TRACK17_KEY) durur. Kargo firmasından gelen yazılar yalnızca veridir.
import { esc, plain, trParts } from "./logic.js";

export const CARGO_KEY = "kargo";
export const API = "https://api.17track.net/track/v2.2";
const MAX_ITEMS = 15;
const CHECK_EVERY_MIN = 30;
const CHECK_AT_MIN = 6;              // :06 ve :36 turlarında
const DONE_KEEP_MS = 3 * 24 * 3600 * 1000;   // teslim edilenler 3 gün sonra listeden düşer

// 17TRACK firma numaraları. Yazılmazsa firma numaradan tahmin edilir.
export const CARRIERS = {
  yurtici: 100348,
  aras: 100607,
  ptt: 20111,
  trendyol: 100925,
  hepsijet: 100642,
};
const CARRIER_NAMES = { 100348: "Yurtiçi", 100607: "Aras", 20111: "PTT", 100925: "Trendyol Express", 100642: "HepsiJET" };

const STATUS = {
  NotFound: "📭 Henüz kargo firmasında görünmüyor",
  InfoReceived: "📝 Kargo bilgisi alındı",
  InTransit: "🚚 Yolda",
  AvailableForPickup: "🏪 Şubede, teslim almanı bekliyor",
  OutForDelivery: "🛵 Dağıtıma çıktı",
  DeliveryFailure: "⚠️ Teslim edilemedi",
  Delivered: "✅ Teslim edildi",
  Exception: "⚠️ Bir sorun var",
  Expired: "⌛ Uzun süredir hareket yok",
};
const DONE = new Set(["Delivered", "Expired"]);

export const SETUP = [
  "📦 Kargo takibi için bir kere kurulum gerekiyor:",
  "1. <a href=\"https://api.17track.net\">api.17track.net</a> adresinden ücretsiz hesap aç (kart istemez, 200 takip numarası ücretsiz).",
  "2. Giriş yapınca <a href=\"https://api.17track.net/admin/settings\">Settings</a> sayfasındaki <b>Security Key</b> anahtarını kopyala.",
  "3. GitHub'da <a href=\"https://github.com/ArdaSimsekxd/Jarvis/settings/secrets/actions/new\">yeni secret</a> sayfasında <code>TRACK17_KEY</code> adıyla ekle.",
  "4. Actions sekmesinden <b>Botu kur</b> iş akışını çalıştır.",
].join("\n");

export const CARGO_HELP = [
  "<code>/kargo 1234567890 kulaklık</code> takibe al (sona istersen bir ad yaz)",
  "<code>/kargo yurtici 1234567890</code> firmayı da söyle (yurtici, aras, ptt, trendyol, hepsijet)",
  "<code>/kargo</code> tüm kargolar ve son durumları",
  "<code>/kargo sil 2</code> listeden çıkar",
].join("\n");

const two = (n) => String(n).padStart(2, "0");

export function isCargoTurn(nowMs) {
  return Math.floor(nowMs / 60000) % CHECK_EVERY_MIN === CHECK_AT_MIN || Math.floor(nowMs / 60000) % CHECK_EVERY_MIN === CHECK_AT_MIN + 1;
}

// "/kargo yurtici 1234 kulaklık" -> { carrier, number, name }
export function parseAdd(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  let carrier = null;
  const i = words.findIndex((w) => CARRIERS[plain(w).replace(/kargo$/, "")] !== undefined);
  if (i >= 0) carrier = CARRIERS[plain(words.splice(i, 1)[0]).replace(/kargo$/, "")];
  const n = words.findIndex((w) => /^[A-Za-z0-9-]{8,40}$/.test(w) && /\d{6}/.test(w.replace(/-/g, "")));
  if (n < 0) return null;
  const number = words.splice(n, 1)[0].replace(/-/g, "").toUpperCase();
  const name = words.join(" ").replace(/^(kargo|takip|ekle)\s*/i, "").trim().slice(0, 40);
  return { carrier, number, name };
}

async function call(ctx, op, body) {
  const res = await ctx.webFetch(`${API}/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "17token": ctx.cargoKey },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("anahtar"), { auth: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.code !== 0 && data?.code !== undefined) throw new Error(`17TRACK kodu ${data.code}`);
  return data?.data ?? {};
}

// Bir kargonun son durumu (17TRACK gettrackinfo cevabındaki tek kayıt)
export function readTrack(item) {
  const info = item?.track_info ?? item ?? {};
  const status = info.latest_status?.status ?? item?.package_status ?? null;
  let ev = info.latest_event ?? null;
  if (!ev) ev = (info.tracking?.providers ?? []).flatMap((p) => p.events ?? [])[0] ?? null;
  const text = ev?.description ?? item?.latest_event_info ?? "";
  const when = ev?.time_utc ?? ev?.time_iso ?? item?.latest_event_time ?? null;
  return {
    status: STATUS[status] ? status : status ? "InTransit" : null,
    event: String(text).replace(/\s+/g, " ").trim().slice(0, 160),
    where: String(ev?.location ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    time: when ? Date.parse(when) || null : null,
  };
}

export async function loadCargo(kv) {
  try {
    const data = JSON.parse((await kv.get(CARGO_KEY)) ?? "null");
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

function saveCargo(kv, items) {
  return kv.put(CARGO_KEY, JSON.stringify({ items: items.slice(-MAX_ITEMS) }));
}

function when(ms) {
  if (!ms) return "";
  const p = trParts(ms);
  return `${two(p.d)}.${two(p.m)} ${two(p.hh)}:${two(p.mm)}`;
}

function title(it) {
  const firm = CARRIER_NAMES[it.carrier] ? ` (${CARRIER_NAMES[it.carrier]})` : "";
  return `${it.name ? `<b>${esc(it.name)}</b> · ` : ""}<code>${esc(it.number)}</code>${firm}`;
}

function statusLines(it) {
  const lines = [STATUS[it.status] ?? "⏳ Bilgi bekleniyor"];
  if (it.event) lines.push(`${esc(it.event)}${it.where ? ` · ${esc(it.where)}` : ""}${it.time ? ` · ${when(it.time)}` : ""}`);
  return lines;
}

export function formatList(items) {
  if (!items.length) return ["📦 Takipte kargo yok.", "", CARGO_HELP].join("\n");
  const out = ["📦 <b>Kargolarım</b>"];
  items.forEach((it, i) => out.push("", `${i + 1}. ${title(it)}`, ...statusLines(it)));
  return out.join("\n");
}

async function fetchStatus(ctx, items) {
  if (!items.length) return {};
  const data = await call(ctx, "gettrackinfo", items.map((it) => (it.carrier ? { number: it.number, carrier: it.carrier } : { number: it.number })));
  const out = {};
  for (const a of data.accepted ?? []) out[String(a.number).toUpperCase()] = { carrier: a.carrier, ...readTrack(a) };
  return out;
}

function failText(err) {
  if (err?.auth) return "17TRACK anahtarı kabul edilmedi. GitHub'daki <code>TRACK17_KEY</code> değerini kontrol edip <b>Botu kur</b>'u yeniden çalıştırır mısın?";
  return "Kargo servisine şu an ulaşamadım. Birazdan yeniden dener misin?";
}

async function add(ctx, items, text) {
  const req = parseAdd(text);
  if (!req) return `Takip numarasını bulamadım. Örnek: <code>/kargo 123456789012 kulaklık</code>\n\n${CARGO_HELP}`;
  if (items.some((it) => it.number === req.number)) return `Bu kargo zaten takipte. Durumu için <code>/kargo</code> yaz.`;
  if (items.length >= MAX_ITEMS) return `En fazla ${MAX_ITEMS} kargo takip edebilirim. Önce birini <code>/kargo sil</code> ile çıkar.`;
  let data;
  try {
    data = await call(ctx, "register", [req.carrier ? { number: req.number, carrier: req.carrier } : { number: req.number }]);
  } catch (err) {
    console.error("kargo kaydedilemedi", err?.message);
    return failText(err);
  }
  const rejected = (data.rejected ?? [])[0];
  const already = rejected?.error?.code === -18019901;   // daha önce kaydedilmiş numara
  if (rejected && !already) {
    const code = rejected.error?.code;
    if (code === -18019903) return "Kargo firmasını numaradan tanıyamadım. Firmayı da yazar mısın? Örnek: <code>/kargo aras " + esc(req.number) + "</code>";
    if (code === -18010012) return "Bu takip numarası geçerli görünmüyor. Bir kontrol eder misin?";
    return `17TRACK bu numarayı kabul etmedi${rejected.error?.message ? `: ${esc(String(rejected.error.message).slice(0, 120))}` : "."}`;
  }
  const carrier = (data.accepted ?? [])[0]?.carrier ?? req.carrier ?? null;
  const item = { number: req.number, carrier, name: req.name, status: null, event: "", where: "", time: null, added: ctx.now };
  try {
    const now = (await fetchStatus(ctx, [item]))[item.number];
    if (now) Object.assign(item, { status: now.status, event: now.event, where: now.where, time: now.time, carrier: now.carrier ?? carrier });
  } catch { /* ilk durum sonraki turda gelir */ }
  await saveCargo(ctx.kv, [...items, item]);
  const firm = CARRIER_NAMES[item.carrier] ? `${CARRIER_NAMES[item.carrier]} kargosu` : "Kargo";
  return [`✅ ${firm} takipte: ${title(item)}`, ...statusLines(item), "", "Durumu değişince haber veririm (yarım saatte bir bakıyorum)."].join("\n");
}

export async function cmdKargo(args, ctx) {
  if (!ctx.cargoKey) return SETUP;
  const items = await loadCargo(ctx.kv);
  const text = String(args ?? "").trim();
  const [first, second] = text.split(/\s+/);
  if (!text || ["liste", "durum", "hepsi"].includes(plain(first))) {
    if (!items.length) return formatList(items);
    try {
      const now = await fetchStatus(ctx, items);
      let changed = false;
      for (const it of items) {
        const s = now[it.number];
        if (s && (s.status !== it.status || s.event !== it.event)) { Object.assign(it, { status: s.status, event: s.event, where: s.where, time: s.time }); changed = true; }
      }
      if (changed) await saveCargo(ctx.kv, items);
    } catch (err) {
      console.error("kargo durumu okunamadı", err?.message);
    }
    return formatList(items);
  }
  if (["sil", "cikar", "kaldir", "iptal"].includes(plain(first))) {
    const i = /^\d+$/.test(second ?? "") ? Number(second) - 1 : items.findIndex((it) => it.number === String(second ?? "").toUpperCase() || plain(it.name) === plain(text.split(/\s+/).slice(1).join(" ")));
    if (i < 0 || i >= items.length) return `Listede böyle bir kargo yok.\n\n${formatList(items)}`;
    const [gone] = items.splice(i, 1);
    await saveCargo(ctx.kv, items);
    if (gone.carrier) await call(ctx, "stoptrack", [{ number: gone.number, carrier: gone.carrier }]).catch(() => {});
    return `🗑 Takipten çıkarıldı: ${title(gone)}`;
  }
  return add(ctx, items, text);
}

// Zamanlayıcı: yarım saatte bir durumları okur, değişenleri bildirir. Teslim edilenler 3 gün sonra düşer.
export async function checkCargo(ctx) {
  if (!ctx.cargoKey || !isCargoTurn(ctx.now)) return 0;
  const items = await loadCargo(ctx.kv);
  if (!items.length) return 0;
  const keep = items.filter((it) => !(DONE.has(it.status) && it.doneAt && ctx.now - it.doneAt > DONE_KEEP_MS));
  const active = keep.filter((it) => !DONE.has(it.status));
  let now = {};
  try {
    now = await fetchStatus(ctx, active);
  } catch (err) {
    console.error("kargo durumu okunamadı", err?.message);
    if (keep.length !== items.length) await saveCargo(ctx.kv, keep);
    return 0;
  }
  let sent = 0, changed = keep.length !== items.length;
  for (const it of active) {
    const s = now[it.number];
    if (!s || !s.status || (s.status === it.status && s.event === it.event)) continue;
    const statusChanged = s.status !== it.status;
    Object.assign(it, { status: s.status, event: s.event, where: s.where, time: s.time });
    if (DONE.has(s.status)) it.doneAt = ctx.now;
    changed = true;
    // Yalnızca durum değişince ya da dağıtım/şube/sorun aşamasındaki yeni hareketlerde yazar (her ara aktarma için değil).
    if (!statusChanged && !["OutForDelivery", "AvailableForPickup", "DeliveryFailure", "Exception"].includes(s.status)) continue;
    const ok = await ctx.send([`${STATUS[s.status] ?? "📦 Kargo hareketi"}`, title(it), ...statusLines(it).slice(1)].join("\n"));
    if (ok !== false) sent += 1;
  }
  if (changed) await saveCargo(ctx.kv, keep);
  return sent;
}

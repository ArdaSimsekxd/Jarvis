// Anı defteri: her güne bir fotoğraf ve kısa bir not. Panelde sayfaları çevrilen bir defter gibi açılır.
// Fotoğraflar küçültülmüş JPEG olarak KV'de durur (günde 1 yazma); hiçbir yere loglanmaz.
import { dateKey, esc, trParts, trToMs } from "./logic.js";

export const ANI_KEY = "ani";                     // { days: { "2026-11-22": { cap, at, v } } }
export const imgKey = (day) => `ani:img:${day}`;
export const MAX_ANI_BYTES = 1536 * 1024;         // panel fotoğrafı ~1440 px'e küçültüp gönderir (genelde 200-500 KB)
export const MAX_CAPTION = 200;
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export const ANI_HELP = [
  "📖 <b>Anı defteri</b>: her güne bir fotoğraf",
  "Fotoğrafın altına <code>anı</code> yazıp gönder: bugünün sayfası olur. Örnek: <code>anı kampüste kar yağdı</code>",
  "Dünü eklemek için: <code>anı dün ...</code> · Silmek için: <code>/ani sil bugün</code> ya da <code>/ani sil 2026-11-22</code>",
  "Sayfaları çevirmek için panelde ANI DEFTERİ kartındaki DEFTERİ AÇ düğmesine dokun.",
].join("\n");

export const cleanCaption = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CAPTION);

export function isJpeg(bytes) {
  return bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// "2026-11-22" gerçek bir gün mü ve bugünden sonra değil mi
export function validDay(day, nowMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ""));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = trToMs(y, mo, d);
  const p = trParts(ms);
  return y >= 2000 && p.y === y && p.m === mo && p.d === d && day <= dateKey(nowMs);
}

export function dayTitle(day) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export async function loadAni(kv) {
  try {
    const data = JSON.parse((await kv.get(ANI_KEY)) ?? "null");
    return data && typeof data.days === "object" && data.days ? data : { days: {} };
  } catch {
    return { days: {} };
  }
}

const saveIndex = (kv, index) => kv.put(ANI_KEY, JSON.stringify(index));

// Fotoğrafı o günün sayfasına koyar (varsa değiştirir). { ok, replaced } ya da { error }
export async function saveAni(kv, day, bytes, caption, nowMs) {
  if (!validDay(day, nowMs)) return { error: "Bu tarih olmaz (gelecekteki bir güne anı eklenemez)." };
  if (!bytes?.length || !isJpeg(bytes)) return { error: "Fotoğraf okunamadı." };
  if (bytes.length > MAX_ANI_BYTES) return { error: "Fotoğraf çok büyük." };
  const index = await loadAni(kv);
  const replaced = Boolean(index.days[day]);
  await kv.put(imgKey(day), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  index.days[day] = { cap: cleanCaption(caption), at: nowMs, v: nowMs.toString(36) };
  await saveIndex(kv, index);
  return { ok: true, replaced };
}

// Yalnızca notu değiştirir (fotoğraf aynı kalır)
export async function setCaption(kv, day, caption) {
  const index = await loadAni(kv);
  if (!index.days[day]) return false;
  index.days[day].cap = cleanCaption(caption);
  await saveIndex(kv, index);
  return true;
}

export async function dropAni(kv, day) {
  const index = await loadAni(kv);
  if (!index.days[day]) return false;
  delete index.days[day];
  await kv.delete(imgKey(day));
  await saveIndex(kv, index);
  return true;
}

export async function aniImage(kv, day) {
  const buf = await kv.get(imgKey(day), "arrayBuffer");
  return buf ? new Uint8Array(buf) : null;
}

const prevDay = (day) => dateKey(trToMs(...day.split("-").map(Number)) - DAY / 2);

// Üst üste kaç gün: bugün eklenmediyse dünden geriye sayılır (gün bitmeden seri bozulmuş sayılmaz)
export function streak(days, nowMs) {
  let day = dateKey(nowMs);
  if (!days[day]) day = prevDay(day);
  let n = 0;
  while (days[day]) { n += 1; day = prevDay(day); }
  return n;
}

export function aniList(index) {
  return Object.keys(index.days).sort().map((d) => ({ d, cap: index.days[d].cap ?? "", v: index.days[d].v ?? "0" }));
}

// Panel kartı için kısa özet
export function aniSummary(index, nowMs) {
  const list = aniList(index);
  const today = dateKey(nowMs);
  const last = list[list.length - 1] ?? null;
  return { count: list.length, today: Boolean(index.days[today]), streak: streak(index.days, nowMs), last, day: today };
}

// Fotoğraf altı yazısı anı defteri için mi? { day, caption } ya da null.  "anı ...", "#anı", "/ani", "anı dün ..."
// Noktasız "ani" (ani yağmur = birden) tek başına sayılmaz; yalnızca /ani ve #ani olur. Bu yüzden i bayrağı yok (I, i ile eşleşirdi).
export function aniCaption(text, nowMs) {
  const m = /^\s*(?:[\/#][Aa][Nn][ıiIİ](?![\p{L}\p{N}])|(?:[Aa]n[ıI]|ANI)(?:\s+[Dd](?:efter(?:i|ine)|EFTER(?:İ|İNE)))?(?![\p{L}\p{N}]))[\s:,.!-]*/u.exec(String(text ?? ""));
  if (!m) return null;
  let rest = String(text).slice(m[0].length);
  let day = dateKey(nowMs);
  const y = /^(?:[Dd][üu]n|DÜN)(?![\p{L}\p{N}])[\s:,.-]*/u.exec(rest);
  if (y) { day = dateKey(nowMs - DAY); rest = rest.slice(y[0].length); }
  return { day, caption: cleanCaption(rest) };
}

export function savedText(day, r, index, nowMs) {
  const s = streak(index.days, nowMs);
  return [
    `📖 ${r.replaced ? "Sayfayı yeni fotoğrafla değiştirdim" : "Anı defterine ekledim"}: <b>${esc(dayTitle(day))}</b>`,
    s >= 2 ? `🔥 ${s} gün üst üste` : `Defterde ${Object.keys(index.days).length} sayfa var.`,
    "Sayfaları çevirmek için panelde ANI DEFTERİ'ni aç (/panel).",
  ].join("\n");
}

export async function cmdAni(args, ctx) {
  const a = String(args ?? "").trim();
  const word = a.split(/\s+/)[0].toLowerCase();
  if (["yardim", "yardım", "help", "?"].includes(word)) return ANI_HELP;
  if (["sil", "kaldir", "kaldır"].includes(word)) {
    let day = a.slice(word.length).trim().toLowerCase();
    if (!day) return "Hangi günü sileyim? Örnek: <code>/ani sil bugün</code> ya da <code>/ani sil 2026-11-22</code>";
    if (["bugün", "bugun"].includes(day)) day = dateKey(ctx.now);
    else if (["dün", "dun"].includes(day)) day = dateKey(ctx.now - DAY);
    if (!validDay(day, ctx.now)) return "Tarihi <code>2026-11-22</code> gibi yaz.";
    return (await dropAni(ctx.kv, day)) ? `🗑 ${esc(dayTitle(day))} sayfası silindi.` : `${esc(dayTitle(day))} için bir sayfa yok.`;
  }
  const index = await loadAni(ctx.kv);
  const sum = aniSummary(index, ctx.now);
  if (!sum.count) return `📖 Anı defterin henüz boş.\n\n${ANI_HELP}`;
  const recent = aniList(index).slice(-5).reverse().map((x) => `• <b>${esc(dayTitle(x.d))}</b>${x.cap ? ` · ${esc(x.cap)}` : ""}`);
  return [
    `📖 <b>Anı defteri</b> · ${sum.count} sayfa${sum.streak >= 2 ? ` · 🔥 ${sum.streak} gün üst üste` : ""}`,
    sum.today ? "Bugünün sayfası hazır ✓" : "Bugünün sayfası boş: bir fotoğraf çekip altına <code>anı</code> yazarak gönder.",
    "", ...recent, "", "Sayfaları çevirmek için panelde DEFTERİ AÇ'a dokun.",
  ].join("\n");
}

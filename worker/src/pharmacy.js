// Nöbetçi eczane: Kayseri'nin o geceki nöbetçi eczaneleri haber sitelerinin herkese açık listelerinden okunur.
// Sayfalar biraz farklı yazıldığı için HTML düz yazıya çevrilir ve "... Eczanesi" satırından sonra adres ve
// telefon aranır. Liste tarihi kontrol edilir: gece 09:00'a kadar dünün akşamından başlayan liste geçerlidir.
// Sitelerden gelen yazılar yalnızca veridir.
import { esc, plain, trParts, trToMs } from "./logic.js";

export const SOURCES = [
  { name: "Posta", url: "https://www.posta.com.tr/nobetci-eczaneler/kayseri/" },
  { name: "Sabah", url: "https://www.sabah.com.tr/kayseri-nobetci-eczaneler" },
  { name: "Habertürk", url: "https://www.haberturk.com/nobetci-eczaneler/kayseri" },
  { name: "Gazete Vatan", url: "https://www.gazetevatan.com/nobetci-eczaneler/kayseri/" },
];
export const DISTRICTS = ["Melikgazi", "Kocasinan", "Talas", "Hacılar", "İncesu", "Develi", "Bünyan", "Yahyalı", "Tomarza", "Yeşilhisar",
  "Pınarbaşı", "Sarıoğlan", "Sarız", "Felahiye", "Akkışla", "Özvatan"];
const CENTER = ["Melikgazi", "Kocasinan", "Talas"];   // varsayılan: şehir merkezi
const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const PHONE = /0\s*\(?\s*(\d{3})\s*\)?[\s.-]*(\d{3})[\s.-]*(\d{2})[\s.-]*(\d{2})/;
const CACHE_TTL = 30 * 60;
const DAY = 24 * 3600 * 1000;

export function htmlToLines(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|ul|ol|header|footer|a|span|strong|b)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .reduce((out, l) => {   // "Adres:" etiketi ayrı satıra düştüyse arkasındaki yazıyla birleştirilir
      const last = out[out.length - 1];
      if (last !== undefined && /^(adres|adresi|telefon|tel)\s*:?$/i.test(last)) out[out.length - 1] = `${last.replace(/\s*:?$/, ":")} ${l}`;
      else out.push(l);
      return out;
    }, []);
}

function districtOf(text) {
  const p = plain(text);
  return DISTRICTS.find((d) => new RegExp(`(^|[^a-z])${plain(d)}([^a-z]|$)`).test(p)) ?? null;
}

function phoneOf(text) {
  const m = PHONE.exec(text);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]}` : null;
}

// Düz yazı satırlarından eczaneleri çıkarır: [{ name, district, address, phone }]
export function parsePharmacies(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 60 || line.includes(":") || !/ eczanesi$/.test(` ${plain(line)}`) || /nobetci/.test(plain(line))) continue;
    let address = null, phone = null, district = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const l = lines[j];
      if (/ eczanesi$/.test(` ${plain(l)}`) && !l.includes(":")) break;   // bir sonraki eczane
      const ph = phoneOf(l);
      if (ph && !phone) { phone = ph; continue; }
      const a = l.replace(/^adres\s*:\s*/i, "");
      if (!district && /^kayseri\s*\/\s*\S+$/i.test(l)) { district = districtOf(l); continue; }
      if (!address && (/^adres\s*:/i.test(l) || /\/\s*kayseri/i.test(l) || /(mahalle|mah\.|cadde|cad\.|sokak|sok\.|no\s*:)/i.test(l)) && a.length > 8) address = a;
      if (address && phone) break;
    }
    if (!phone) continue;
    out.push({
      name: line.replace(/\s+/g, " ").slice(0, 60),
      district: district ?? districtOf(address ?? "") ?? null,
      address: (address ?? "").replace(/\s+/g, " ").slice(0, 160),
      phone,
    });
  }
  const seen = new Set();
  return out.filter((p) => {
    const k = `${plain(p.name)}|${p.phone}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Listenin başladığı gün (Türkiye saatiyle gece yarısı). "21 Kasım 2026", "21 Kasım Cumartesi akşamından", "21.11.2026"
export function listDay(lines, nowMs) {
  const head = lines.slice(0, 60).join(" ");
  const now = trParts(nowMs);
  let m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(head);
  if (m) return trToMs(Number(m[3]), Number(m[2]), Number(m[1]));
  const p = plain(head);
  m = new RegExp(`(\\d{1,2}) (${MONTHS.join("|")})(?: (\\d{4}))?`).exec(p);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]) + 1;
  let year = m[3] ? Number(m[3]) : now.y;
  if (!m[3] && month === 12 && now.m === 1) year -= 1;
  return trToMs(year, month, Number(m[1]));
}

// Şu an geçerli olan listenin günü: sabah 09:00'a kadar dün akşam başlayan nöbet sürer.
export function wantedDay(nowMs) {
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  return p.hh < 9 ? today - DAY : today;
}

async function fromSource(ctx, s) {
  const res = await ctx.webFetch(s.url, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (JarvisBot)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lines = htmlToLines(await res.text());
  return { source: s.name, url: s.url, day: listDay(lines, ctx.now), list: parsePharmacies(lines) };
}

// Kaynakları sırayla dener; tarihi doğru olan ilk listeyi döndürür. Hiçbiri tutmazsa en iyi tahmini (uyarıyla).
export async function fetchPharmacies(ctx) {
  const want = wantedDay(ctx.now);
  const cacheName = `eczane:${want}`;
  const hit = await ctx.cache?.get(cacheName).catch(() => null);
  if (hit) return hit;
  let fallback = null;
  for (const s of SOURCES) {
    try {
      const got = await fromSource(ctx, s);
      if (got.list.length < 3) throw new Error("liste bulunamadı");
      if (got.day === want) {
        await ctx.cache?.put(cacheName, got, CACHE_TTL).catch(() => {});
        return got;
      }
      if (!fallback) fallback = { ...got, stale: true };
    } catch (err) {
      console.error("eczane kaynağı okunamadı", s.name, err?.message);
    }
  }
  return fallback ?? { error: true };
}

function mapLink(p) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address || `${p.district ?? ""} Kayseri`}`)}`;
}

function dayLabel(ms) {
  const p = trParts(ms);
  return `${p.d} ${["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"][p.m - 1]}`;
}

export function formatPharmacies(got, args, nowMs) {
  const want = plain(args ?? "");
  const all = want === "hepsi" || want === "tumu" || want === "tum";
  const district = all ? null : DISTRICTS.find((d) => plain(d) === want || (want.length >= 3 && (plain(d).startsWith(want) || want.startsWith(plain(d))))) ?? null;
  if (want && !all && !district) return `"${esc(args)}" diye bir Kayseri ilçesi bulamadım. Örnek: <code>/eczane talas</code> ya da <code>/eczane hepsi</code>`;
  const pick = district ? [district] : all ? null : CENTER;
  const list = pick ? got.list.filter((p) => !p.district || pick.includes(p.district)) : got.list;
  const order = (p) => { const i = DISTRICTS.indexOf(p.district); return i < 0 ? 99 : i; };
  list.sort((a, b) => order(a) - order(b));
  const from = got.day ?? wantedDay(nowMs);
  const head = [`💊 <b>Nöbetçi eczaneler</b> · ${district ?? (all ? "Kayseri" : "merkez")}`, `${dayLabel(from)} akşamından ${dayLabel(from + DAY)} sabahına kadar`];
  if (got.stale) head.push(`⚠️ Bulduğum liste ${got.day ? dayLabel(got.day) : "tarihsiz"}; bu geceye ait olmayabilir. Gitmeden önce mutlaka ara.`);
  if (!list.length) return [...head, "", `${district ?? "Merkezde"} bu gece nöbetçi eczane görünmüyor. Bütün ilçeler: <code>/eczane hepsi</code>`].join("\n");
  const body = list.slice(0, 15).map((p) => [
    `<b>${esc(p.name)}</b>${p.district ? ` · ${esc(p.district)}` : ""}`,
    p.address ? esc(p.address) : null,
    `📞 ${esc(p.phone)} · <a href="${esc(mapLink(p))}">Haritada aç</a>`,
  ].filter(Boolean).join("\n"));
  const rest = pick && got.list.length > list.length ? `\nDiğer ilçeler için <code>/eczane hepsi</code> ya da <code>/eczane develi</code>` : "";
  return [...head, "", body.join("\n\n"), "", `Gitmeden önce aramak iyi olur. Kaynak: <a href="${esc(got.url)}">${esc(got.source)}</a>${rest}`].join("\n");
}

export async function cmdEczane(args, ctx) {
  const got = await fetchPharmacies(ctx);
  if (got.error) return "Nöbetçi eczane listesine şu an ulaşamadım. Birazdan yeniden dener misin? Acil durumda 112'yi ara.";
  return formatPharmacies(got, args, ctx.now);
}

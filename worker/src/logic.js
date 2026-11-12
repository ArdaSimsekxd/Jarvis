// Saf mantık: zaman hesabı, komut ayrıştırma, menü metni. Ağ ya da depolama yok, testi kolay.

const TR_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye saati = UTC+3, yaz saati yok
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const WEEKDAY_KEYS = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];

export function esc(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Türkçe harfleri sadeleştirir: "Yarın" -> "yarin", "ÇARŞAMBA" -> "carsamba"
export function plain(text) {
  return String(text ?? "")
    .replace(/İ/g, "i").replace(/I/g, "i").toLowerCase()
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").trim();
}

// Türkiye saatine göre takvim parçaları
export function trParts(ms) {
  const d = new Date(ms + TR_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), wd: d.getUTCDay(),
  };
}

// Türkiye saatiyle verilen tarih ve saatin UTC milisaniyesi
export function trToMs(y, m, d, hh = 0, mm = 0) {
  return Date.UTC(y, m - 1, d, hh, mm) - TR_OFFSET_MS;
}

const two = (n) => String(n).padStart(2, "0");

export function dateKey(ms) {
  const p = trParts(ms);
  return `${p.y}-${two(p.m)}-${two(p.d)}`;
}

export function fmtDateTime(ms) {
  const p = trParts(ms);
  return `${WEEKDAYS[p.wd]} ${two(p.d)}.${two(p.m)} ${two(p.hh)}:${two(p.mm)}`;
}

export function fmtDate(ms) {
  const p = trParts(ms);
  return `${WEEKDAYS[p.wd]}, ${two(p.d)}.${two(p.m)}.${p.y}`;
}

// "/yemek@bot yarın" -> { command: "yemek", args: "yarın" }
export function parseCommand(text) {
  const m = /^\/([a-zA-Z_ğüşıöçĞÜŞİÖÇ]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  return { command: plain(m[1]), args: (m[2] ?? "").trim() };
}

// Gün ifadesini o günün başlangıcına (Türkiye saati 00:00) çevirir. Anlaşılmazsa null.
export function parseDay(word, nowMs) {
  const w = plain(word);
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  if (w === "" || w === "bugun") return today;
  if (w === "yarin") return today + DAY;
  if (w === "dun") return today - DAY;
  const wd = WEEKDAY_KEYS.indexOf(w);
  if (wd >= 0) return today + ((wd - p.wd + 7) % 7) * DAY; // bugün o günse bugün
  const m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/.exec(w);
  if (m) {
    const day = +m[1], month = +m[2];
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return trToMs(m[3] ? +m[3] : p.y, month, day);
  }
  return null;
}

// "/hatirlat" komutunun devamını çözer.
// Dönen değer: { at, text } ya da { error }.
export function parseReminder(args, nowMs) {
  const s = String(args ?? "").trim();
  if (!s) return { error: "empty" };
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  const validTime = (hh, mm) => hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
  let m;

  // "30 dk su iç", "2 saat ...", "3 gün ..."
  m = /^(\d{1,4})\s*(dk|dakika|saat|sa|gün|gun)\.?\s+([\s\S]+)$/i.exec(s);
  if (m) {
    const n = +m[1];
    const unit = plain(m[2]);
    const mult = unit.startsWith("d") ? MIN : unit.startsWith("s") ? 60 * MIN : DAY;
    if (n < 1) return { error: "past" };
    return { at: nowMs + n * mult, text: m[3].trim() };
  }

  // "14.11 15:00 ..." ya da "14.11.2026 15:00 ..."
  m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\s+(\d{1,2})[:.](\d{2})\s+([\s\S]+)$/.exec(s);
  if (m) {
    const day = +m[1], month = +m[2], hh = +m[4], mm = +m[5];
    if (day < 1 || day > 31 || month < 1 || month > 12 || !validTime(hh, mm)) return { error: "format" };
    let at = trToMs(m[3] ? +m[3] : p.y, month, day, hh, mm);
    if (at <= nowMs && !m[3]) at = trToMs(p.y + 1, month, day, hh, mm); // geçmişse seneye
    if (at <= nowMs) return { error: "past" };
    return { at, text: m[6].trim() };
  }

  // "yarın 15:00 ...", "cuma 09:30 ...", "bugün 18:00 ..."
  m = /^(\S+)\s+(\d{1,2})[:.](\d{2})\s+([\s\S]+)$/.exec(s);
  if (m && !/^\d/.test(m[1])) {
    const dayStart = parseDay(m[1], nowMs);
    const hh = +m[2], mm = +m[3];
    if (dayStart !== null) {
      if (!validTime(hh, mm)) return { error: "format" };
      let at = dayStart + (hh * 60 + mm) * MIN;
      const isWeekday = WEEKDAY_KEYS.includes(plain(m[1]));
      if (at <= nowMs && isWeekday) at += 7 * DAY; // bugün o gün ama saat geçmiş: haftaya
      if (at <= nowMs) return { error: "past" };
      return { at, text: m[4].trim() };
    }
  }

  // "15:00 ..." -> bugün, saat geçtiyse yarın
  m = /^(\d{1,2})[:.](\d{2})\s+([\s\S]+)$/.exec(s);
  if (m) {
    const hh = +m[1], mm = +m[2];
    if (!validTime(hh, mm)) return { error: "format" };
    let at = today + (hh * 60 + mm) * MIN;
    if (at <= nowMs) at += DAY;
    return { at, text: m[3].trim() };
  }

  return { error: "format" };
}

// Menü verisi: { "days": { "2026-11-13": ["Çorba", ...] ya da { "Öğle": [...], "Akşam": [...] } } }
export function menuForDay(menu, dayMs) {
  const entry = menu?.days?.[dateKey(dayMs)];
  if (!entry) return null;
  if (Array.isArray(entry)) return entry.length ? [["", entry]] : null;
  const meals = Object.entries(entry).filter(([, items]) => Array.isArray(items) && items.length);
  return meals.length ? meals : null;
}

export function formatMenu(menu, dayMs) {
  const meals = menuForDay(menu, dayMs);
  const title = `🍽 <b>${esc(fmtDate(dayMs))}</b>`;
  if (!meals) return null;
  const blocks = meals.map(([name, items]) =>
    (name ? `<b>${esc(name)}</b>\n` : "") + items.map((i) => `• ${esc(i)}`).join("\n"));
  return `${title}\n\n${blocks.join("\n\n")}`;
}

export const HELP = [
  "🤖 <b>Jarvis komutları</b>",
  "",
  "/yemek — bugünün menüsü",
  "/yemek yarın — yarının menüsü (ya da: <code>cuma</code>, <code>17.11</code>)",
  "",
  "/hatirlat 15:00 kütüphane kitabı — bugün 15:00 (saat geçtiyse yarın)",
  "/hatirlat yarın 09:30 hocaya mail",
  "/hatirlat cuma 14:00 proje toplantısı",
  "/hatirlat 20.11 18:00 kira",
  "/hatirlat 30 dk çay — ayrıca: <code>2 saat</code>, <code>3 gün</code>",
  "",
  "/hatirlatmalar — bekleyen hatırlatmalar",
  "/sil 2 — listedeki 2 numaralı hatırlatmayı sil",
].join("\n");

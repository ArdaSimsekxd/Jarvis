// Saf mantık: zaman hesabı, komut ayrıştırma, menü metni. Ağ ya da depolama yok, testi kolay.

const TR_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye saati = UTC+3, yaz saati yok
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
export const WEEKDAY_KEYS = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];

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

// Zamanlayıcı: GitHub'ın kendi zamanlayıcısı işleri saatlerce geciktirebildiği için
// Canvas/mail kontrolünü ve sabah özetini bot başlatır. Şu an zamanı gelen işleri döndürür.
export const CANVAS_EVERY_MIN = 10;
export const MORNING_HOUR = 8;      // Türkiye saati
export const MORNING_UNTIL = 12;    // bu saatten sonra o günün özeti artık gönderilmez
export const EVENING_HOUR = 21;     // akşam önizlemesi; gece yarısına kadar yakalanır

// Sessiz saatler (Türkiye saati): bu aralıkta Canvas/mail kontrolü başlatılmaz, yani bildirim gelmez.
// Birikenler sabah ilk kontrolde gönderilir. Aynı değerler Python tarafında da var: jarvis/agents/canvas_notifier.py
export const QUIET_FROM = 0;
export const QUIET_UNTIL = 7;

export function isQuiet(nowMs) {
  const { hh } = trParts(nowMs);
  return hh >= QUIET_FROM && hh < QUIET_UNTIL;
}

export function dueJobs(nowMs) {
  const p = trParts(nowMs);
  const jobs = [];
  if (p.mm % CANVAS_EVERY_MIN < 2 && !isQuiet(nowMs)) jobs.push("canvas");   // bot 2 dakikada bir uyanır: :00, :10, :20 ...
  if (p.hh >= MORNING_HOUR && p.hh < MORNING_UNTIL) jobs.push("morning");   // günde bir kez, çağıran taraf süzer
  if (p.hh >= EVENING_HOUR) jobs.push("evening");                             // günde bir kez
  return jobs;
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

// Menü verisi: { "days": { "2026-11-13": <gün> } }. Bir gün üç biçimde olabilir:
//   ["Çorba", "Pilav"]                                  -> düz liste
//   { "Çorba": "Yayla", "Ana yemek": "Tas kebabı", "Kalori": 942 }  -> etiketli tek öğün
//   { "Öğle": ["..."], "Akşam": ["..."] }               -> birden çok öğün
export function formatMenu(menu, dayMs) {
  const entry = menu?.days?.[dateKey(dayMs)];
  if (!entry) return null;
  const blocks = [];
  if (Array.isArray(entry)) {
    if (entry.length) blocks.push(entry.map((i) => `• ${esc(i)}`).join("\n"));
  } else {
    const labeled = [];
    for (const [name, value] of Object.entries(entry)) {
      if (Array.isArray(value) && value.length) {
        blocks.push(`<b>${esc(name)}</b>\n` + value.map((i) => `• ${esc(i)}`).join("\n"));
      } else if (typeof value === "string" && value) {
        labeled.push(`• <b>${esc(name)}:</b> ${esc(value)}`);
      }
    }
    if (labeled.length) blocks.unshift(labeled.join("\n"));
    const kcal = [];
    if (Number.isFinite(entry["Kalori"])) kcal.push(`${entry["Kalori"]} kcal`);
    if (Number.isFinite(entry["Vejetaryen kalori"])) kcal.push(`vejetaryen menü ${entry["Vejetaryen kalori"]} kcal`);
    if (blocks.length && kcal.length) blocks.push(`<i>${kcal.join(" · ")}</i>`);
  }
  if (!blocks.length) return null;
  return `🍽 <b>${esc(fmtDate(dayMs))}</b>\n\n${blocks.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Ders programı. Metin biçimi (her satırda bir ders): "Pazartesi 10:00-11:45 EE452 F0C04 not"
const SCHEDULE_LINE = /^(\S+)\s+(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\s+(\S+)(?:\s+(\S+))?(?:\s+(.+))?$/;

// Dönen değer: { <hafta günü, 0=Pazar>: [{ start, end, code, room, note }] }
export function parseSchedule(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const m = SCHEDULE_LINE.exec(raw.trim());
    const wd = m ? WEEKDAY_KEYS.indexOf(plain(m[1])) : -1;
    if (wd < 0) continue;
    (out[wd] ??= []).push({
      start: `${two(+m[2])}:${m[3]}`, end: `${two(+m[4])}:${m[5]}`,
      code: m[6], room: m[7] ?? "", note: (m[8] ?? "").trim(),
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.start + a.code < b.start + b.code ? -1 : 1));
  return out;
}

// Ders adının başında dersin kendisini anlatmayan kelimeler (dönem, şube) atlanır.
const NOISE = new Set(["guz", "bahar", "yaz", "fall", "spring", "summer", "section", "sec", "sube", "donemi", "donem"]);
const norm = (text) => plain(text).replace(/[^0-9a-z]/g, "");

// Ders kodunun Canvas'taki adının ilk kelimesi ("EE452" -> "Digital"). Bulunamazsa "".
export function firstWord(code, courses) {
  const key = norm(code);
  if (!key) return "";
  let match = null;
  for (const c of courses ?? []) {
    if (norm(c?.course_code) === key) { match = c; break; }
    if (!match && (norm(c?.course_code).includes(key) || norm(c?.name).includes(key))) match = c;
  }
  if (!match) return "";
  // Adın içinde kodun kendisi de geçebilir ("EE452 - Digital ...", "EE 452 Digital ..."): onu çıkar.
  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = /^(\p{L}+)(\d+)$/u.exec(String(code).trim());
  const pattern = m ? `${escRe(m[1])}[\\s\\-_.]*${m[2]}` : escRe(String(code).trim());
  const name = String(match.name ?? "").replace(new RegExp(pattern, "giu"), " ");
  for (const word of name.split(/[^\p{L}\p{N}_]+/u)) {
    if (word.length >= 2 && !/\d/.test(word) && !NOISE.has(plain(word))) return word;
  }
  return "";
}

// names: { <ders kodu>: <adının ilk kelimesi> }; verilirse kodun önüne yazılır.
export function formatSchedule(schedule, dayMs, names = {}) {
  const lessons = schedule?.[trParts(dayMs).wd] ?? [];
  if (!lessons.length) return null;
  const label = (x) => (names?.[x.code] ? `${names[x.code]} ${x.code}` : x.code);
  const lines = lessons.map((x) =>
    `• <b>${x.start}–${x.end}</b> ${esc(label(x))}` + (x.room ? ` · ${esc(x.room)}` : "") + (x.note ? ` (${esc(x.note)})` : ""));
  return `📚 <b>${esc(fmtDate(dayMs))}</b>\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Canvas: bekleyen ödevler ve notlar. Girdi Canvas'ın verdiği ham ders ve ödev listeleridir.
const OVERDUE_DAYS = 14;    // daha eski gecikmeler listeyi kalabalıklaştırmasın
const UPCOMING_DAYS = 30;
const MAX_LINES = 20;
const MAX_GRADES = 10;

export function isSubmitted(a) {
  const sub = a?.submission ?? {};
  return Boolean(sub.submitted_at) || ["submitted", "graded"].includes(sub.workflow_state) || Boolean(sub.excused);
}

// Teslim tarihi geçmiş ödev gerçekten eksik mi? Canvas'ın kendi "missing" işaretine güvenir.
function isMissing(a) {
  const missing = a?.submission?.missing;
  if (missing !== undefined && missing !== null) return Boolean(missing);
  return (a?.submission_types ?? []).some((t) => t.startsWith("online") || t === "external_tool");
}

const courseName = (c) => c?.course_code || c?.name || "";
const num = (n) => String(Number.isInteger(n) ? n : +Number(n).toFixed(2));
const titled = (a) => (a.html_url ? `<a href="${esc(a.html_url)}">${esc(a.name)}</a>` : esc(a.name));

// assignmentsByCourse: Map<ders id, ödev listesi>
export function formatPending(courses, assignmentsByCourse, nowMs) {
  const overdue = [], upcoming = [];
  for (const c of courses) {
    for (const a of assignmentsByCourse.get(c.id) ?? []) {
      if (!a?.due_at || a.published === false || isSubmitted(a)) continue;
      const due = Date.parse(a.due_at);
      if (Number.isNaN(due)) continue;
      const item = { due, course: courseName(c), a };
      if (due < nowMs) {
        if (nowMs - due <= OVERDUE_DAYS * DAY && isMissing(a)) overdue.push(item);
      } else if (due - nowMs <= UPCOMING_DAYS * DAY) upcoming.push(item);
    }
  }
  if (!overdue.length && !upcoming.length) {
    return `✅ Bekleyen ödev yok. Önümüzdeki ${UPCOMING_DAYS} günde teslim görünmüyor.`;
  }
  const today = dateKey(nowMs), tomorrow = dateKey(nowMs + DAY);
  const when = (ms) => {
    const p = trParts(ms), time = `${two(p.hh)}:${two(p.mm)}`;
    if (dateKey(ms) === today) return `Bugün ${time}`;
    if (dateKey(ms) === tomorrow) return `Yarın ${time}`;
    return fmtDateTime(ms);
  };
  const block = (title, items) => {
    items.sort((x, y) => x.due - y.due);
    const lines = items.slice(0, MAX_LINES).map((i) => `• <b>${when(i.due)}</b> ${esc(i.course)}: ${titled(i.a)}`);
    if (items.length > MAX_LINES) lines.push(`… ve ${items.length - MAX_LINES} tane daha`);
    return `${title}\n${lines.join("\n")}`;
  };
  const parts = ["📝 <b>Bekleyen ödevler</b>"];
  if (overdue.length) parts.push(block("⚠️ <b>Gecikenler</b> (teslim edilmemiş)", overdue));
  if (upcoming.length) parts.push(block("📅 <b>Yaklaşanlar</b>", upcoming));
  return parts.join("\n\n");
}

export function formatGrades(courses, assignmentsByCourse) {
  const graded = [];
  for (const c of courses) {
    for (const a of assignmentsByCourse.get(c.id) ?? []) {
      const sub = a?.submission;
      if (!sub || sub.excused || (sub.score == null && !sub.grade)) continue;
      const at = Date.parse(sub.graded_at ?? sub.posted_at ?? "") || 0;
      const pts = a.points_possible;
      let shown = sub.score != null && pts ? `${num(sub.score)}/${num(pts)}` : String(sub.grade ?? num(sub.score));
      if (sub.grade && sub.score != null && String(sub.grade) !== num(sub.score)) shown = `${sub.grade} (${shown})`;
      graded.push({ at, line: `• ${esc(courseName(c))}: ${titled(a)} → <b>${esc(shown)}</b>` + (at ? ` <i>${fmtDate(at).split(", ")[1].slice(0, 5)}</i>` : "") });
    }
  }
  const totals = [];
  for (const c of courses) {
    const e = (c.enrollments ?? []).find((x) => x.computed_current_score != null || x.computed_current_grade);
    if (!e) continue;
    const score = e.computed_current_score != null ? `%${num(e.computed_current_score)}` : "";
    const grade = e.computed_current_grade ? (score ? ` (${e.computed_current_grade})` : e.computed_current_grade) : "";
    totals.push(`• ${esc(courseName(c))}: <b>${esc(score + grade)}</b>`);
  }
  if (!graded.length && !totals.length) return "📊 Henüz girilmiş bir not görünmüyor.";
  const parts = [];
  if (graded.length) {
    graded.sort((x, y) => y.at - x.at);
    parts.push(`📊 <b>Son notlar</b>\n${graded.slice(0, MAX_GRADES).map((g) => g.line).join("\n")}`);
  }
  if (totals.length) parts.push(`🎓 <b>Derslerde güncel durum</b>\n${totals.join("\n")}`);
  return parts.join("\n\n");
}

export const HELP = [
  "🤖 <b>Jarvis komutları</b>",
  "",
  "/odevler — bekleyen ve geciken ödevler",
  "/notlar — son girilen notlar",
  "/dersler — bugünün dersleri (ya da: <code>/dersler yarın</code>, <code>/dersler salı</code>)",
  "",
  "/fitness salı 13:00-14:30 — her salı fitness randevusu al (tek gün için: <code>/fitness 27.11 13:00-14:30</code>)",
  "/fitness — isteklerim ve alınan randevular (ayrıntı: <code>/fitness yardim</code>)",
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

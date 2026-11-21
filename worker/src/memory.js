// Jarvis'in hafızası (ikinci beyin): kullanıcının kaydettiği notlar, bağlantılar ve fotoğraflar.
// Hepsi tek bir KV kaydında durur; böylece arama için liste işlemi (günde 1.000 sınırlı) harcanmaz.
// Fotoğrafın kendisi Telegram'da kalır, burada yalnızca Telegram'ın verdiği kimlik ve fotoğrafın yazıya dökülmüş hâli tutulur.
import { esc, fmtDateTime, plain } from "./logic.js";

export const MEMORY_KEY = "mem:notes";
export const MAX_NOTES = 300;
export const MAX_TEXT = 1000;        // bir notun yazısı
export const MAX_DESC = 300;         // fotoğrafın kısa açıklaması
export const MAX_READ = 1200;        // fotoğraftan okunan yazı
const LIST_COUNT = 10;
const ALL_LIMIT = 40;                // bu kadar ya da daha az not varsa hepsi yapay zekâya verilir
const PICK = 25;                     // fazlaysa en uygun bu kadarı
const BUDGET = 20000;                // yapay zekâya giden not yazısının üst sınırı (karakter)
const RETRY_MS = 1200;               // KV aynı kayda saniyede bir yazmaya izin verir

const STOP = new Set([
  "ve", "ile", "bir", "bu", "su", "o", "ne", "neydi", "nedir", "neler", "mi", "mu", "da", "de", "ki", "icin", "gibi",
  "kac", "hangi", "hangisi", "hangisiydi", "var", "yok", "ben", "benim", "bana", "beni", "sen", "senin", "sana", "bunu",
  "sunu", "onu", "olan", "olarak", "daha", "once", "sonra", "en", "cok", "az", "kaydet", "kaydettigim", "kaydetmistim",
  "kaydetmistik", "not", "notu", "notlar", "hafiza", "hafizada", "hafizana", "jarvis", "hatirla", "hatirliyor", "musun",
  "misin", "soyle", "soylemistim", "demistim", "yazmistim", "attigim", "gonderdigim", "fotograf", "fotografi", "resim",
]);

export const ICONS = { not: "📝", link: "🔗", foto: "📸", tarih: "📅" };

export async function loadMemory(kv) {
  try {
    const data = JSON.parse(await kv.get(MEMORY_KEY));
    if (data && Array.isArray(data.notes)) return { notes: data.notes.filter((n) => n && Number.isInteger(n.id)) };
  } catch { /* boş ya da bozuk: yeni hafıza */ }
  return { notes: [] };
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Kaydedilecek notu temizler: {kind, text, desc, read, file, url, title}
export function makeNote(fields, nowMs) {
  const note = { kind: ICONS[fields.kind] ? fields.kind : "not", at: nowMs, text: clip(fields.text, MAX_TEXT) };
  if (fields.desc) note.desc = clip(fields.desc, MAX_DESC);
  if (fields.read) note.read = String(fields.read).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_READ);
  if (fields.file) note.file = String(fields.file);
  if (fields.url) note.url = String(fields.url).slice(0, 500);
  if (fields.title) note.title = clip(fields.title, 200);
  if (fields.day) note.day = String(fields.day).slice(0, 10);       // tarih notları: olayın günü (YYYY-AA-GG)
  return note;
}

// Notları hafızaya ekler; eklenen notları (kimlikleriyle) ya da hafıza doluysa null döndürür.
// careful: aynı anda gelen birkaç kayıtta (ör. fotoğraf albümü) biri ötekinin üstüne yazmasın diye
// kayıttan sonra bir süre bekleyip notların yerinde olduğuna bakar, eksik kalanı yeniden ekler.
export async function addNotes(kv, notes, { careful = false, wait = sleep } = {}) {
  let saved = notes.map(() => null);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const mem = await loadMemory(kv);
    saved = saved.map((s) => s && (mem.notes.find((n) => n.id === s.id && n.at === s.at && n.text === s.text) ?? null));
    if (attempt > 0 && saved.every(Boolean)) return saved;
    const missing = saved.filter((s) => !s).length;
    if (mem.notes.length + missing > MAX_NOTES) return saved.some(Boolean) ? saved.filter(Boolean) : null;
    let next = mem.notes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
    const fresh = saved.map((s, i) => s ?? { id: next++, ...notes[i] });
    try {
      await kv.put(MEMORY_KEY, JSON.stringify({ notes: [...mem.notes, ...fresh.filter((n, i) => !saved[i])] }));
    } catch (err) {
      console.error("hafızaya yazılamadı", err?.message);
      await wait(RETRY_MS + Math.floor(Math.random() * 400));
      continue;
    }
    saved = fresh;
    if (!careful) return saved;
    await wait(RETRY_MS + Math.floor(Math.random() * 400));
  }
  return saved.some(Boolean) ? saved.filter(Boolean) : null;
}

export async function addNote(kv, note, options) {
  const saved = await addNotes(kv, [note], options);
  return saved?.[0] ?? null;
}

export async function removeNote(kv, id) {
  const mem = await loadMemory(kv);
  const gone = mem.notes.find((n) => n.id === id);
  if (!gone) return null;
  await kv.put(MEMORY_KEY, JSON.stringify({ notes: mem.notes.filter((n) => n.id !== id) }));
  return gone;
}

// Aramada kullanılan kelimeler: Türkçe harfler sadeleşir, sık kullanılan bağlaçlar atılır.
export function words(text) {
  return plain(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));
}

function haystack(note) {
  return words([note.text, note.title, note.url, note.desc, note.read].filter(Boolean).join(" "));
}

// Ekler yüzünden kelimeler tutmayabilir ("staj" / "stajlar için"): ilk 5 harf karşılaştırılır.
function score(note, query) {
  const hay = haystack(note);
  let total = 0;
  for (const q of query) {
    const stem = q.length > 5 ? q.slice(0, 5) : q;
    if (hay.some((w) => w.startsWith(stem) || (w.length >= 4 && q.startsWith(w)))) total += 1;
  }
  return total;
}

// Sorguya uyan notlar, en uygundan başlayarak (eşitlikte yenisi önce).
export function matchNotes(notes, query) {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  return notes
    .map((n) => ({ n, s: score(n, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n.at - a.n.at || b.n.id - a.n.id)
    .map((x) => x.n);
}

// Yapay zekâya verilecek notlar: az not varsa hepsi, çoksa sorguya en uygunları; hiçbiri uymazsa en yeniler.
// Toplam yazı BUDGET karakteri geçmez (model ve süre sınırı): önce sorguya uyanlar, sonra en yeniler tutulur.
export function pickNotes(notes, query) {
  const hits = matchNotes(notes, query);
  let ranked;
  if (notes.length <= ALL_LIMIT) {
    const hitIds = new Set(hits.map((n) => n.id));
    ranked = [...hits, ...notes.slice().reverse().filter((n) => !hitIds.has(n.id))];
  } else {
    ranked = (hits.length ? hits : notes.slice().reverse()).slice(0, PICK);
  }
  const kept = [];
  let used = 0;
  for (const n of ranked) {
    const size = noteData(n).length + 2;
    if (used + size > BUDGET) continue;
    kept.push(n);
    used += size;
  }
  return kept.sort((a, b) => a.at - b.at || a.id - b.id);
}

const KIND_LABEL = { foto: "(fotoğraf)", link: "(bağlantı)", tarih: "(mail ya da duyurudan bulunan tarih)", not: "(not)" };

// Yapay zekâya giden düz yazı hâli
export function noteData(note) {
  const parts = [`[#${note.id}] ${fmtDateTime(note.at)} ${KIND_LABEL[note.kind] ?? "(not)"}`];
  if (note.text) parts.push(note.text);
  if (note.title) parts.push(`Sayfa başlığı: ${note.title}`);
  if (note.url && !String(note.text).includes(note.url)) parts.push(`Adres: ${note.url}`);
  if (note.desc) parts.push(`Fotoğrafta: ${note.desc}`);
  if (note.read) parts.push(`Fotoğraftaki yazı: ${note.read}`);
  return parts.join("\n");
}

function short(note, n = 150) {
  const body = note.text || note.title || note.desc || note.url || "";
  return body.length <= n ? body : `${body.slice(0, n).trimEnd()}…`;
}

export function noteLine(note) {
  return `${ICONS[note.kind] ?? "📝"} <b>#${note.id}</b> · ${esc(fmtDateTime(note.at))}\n${esc(short(note))}`;
}

export function noteCaption(note) {
  return `${ICONS[note.kind] ?? "📝"} <b>#${note.id}</b> · ${esc(fmtDateTime(note.at))}${note.text ? `\n${esc(short(note, 700))}` : ""}`;
}

export const MEMORY_USAGE = [
  "🧠 <b>Hafıza</b>",
  "",
  "Kaydetmek için yazman yeterli: <i>Ahmet'in doğum günü 3 Mart, kaydet</i>",
  "Bir bağlantı ya da fotoğraf gönderirsen onu da saklarım.",
  "Sonra sor: <i>Ahmet'in doğum günü ne zamandı?</i>",
  "",
  "<code>/not metin</code> — doğrudan kaydet",
  "<code>/hafiza</code> — son kaydedilenler",
  "<code>/hafiza staj</code> — içinde \"staj\" geçenler",
  "<code>/hafiza 12</code> — 12 numaralı notu göster",
  "<code>/hafiza sil 12</code> — 12 numaralı notu sil",
].join("\n");

export const URL_RE = /https?:\/\/[^\s<>"']+/i;

// "/not" komutu: metni (ve içindeki bağlantının sayfa başlığını) kaydeder.
export async function cmdNot(args, ctx) {
  const text = String(args ?? "").trim();
  if (!text) return `${MEMORY_USAGE}\n\nDers notların için: /notlar`;
  const url = URL_RE.exec(text)?.[0]?.replace(/[).,;!?]+$/, "");
  let title = "";
  if (url && ctx.pageTitle) title = await ctx.pageTitle(url).catch(() => "");
  const note = await addNote(ctx.kv, makeNote({ kind: url ? "link" : "not", text, url, title }, ctx.now));
  if (!note) return `🧠 Hafıza dolu (${MAX_NOTES} not). Yer açmak için /hafiza ile bakıp eskileri <code>/hafiza sil 12</code> gibi silebilirsin.`;
  return `🧠 Hafızaya kaydettim (<b>#${note.id}</b>)${title ? `: ${esc(title)}` : ""}`;
}

// "/hafiza" komutu
export async function cmdHafiza(args, ctx) {
  const s = String(args ?? "").trim();
  const mem = await loadMemory(ctx.kv);
  if (["yardim", "help"].includes(plain(s))) return MEMORY_USAGE;

  const del = /^sil\s+#?(\d+)$/i.exec(s);
  if (del) {
    const gone = await removeNote(ctx.kv, +del[1]);
    if (!gone) return `#${del[1]} numaralı bir not yok. Liste için: /hafiza`;
    const dropped = gone.kind === "tarih" && ctx.dropReminders ? await ctx.dropReminders(gone.id) : 0;
    return `🗑 Hafızadan silindi: <b>#${gone.id}</b> ${esc(short(gone, 80))}${dropped ? `\n${dropped} hatırlatması da iptal edildi.` : ""}`;
  }

  const one = /^#?(\d+)$/.exec(s);
  if (one) {
    const note = mem.notes.find((n) => n.id === +one[1]);
    if (!note) return `#${one[1]} numaralı bir not yok. Liste için: /hafiza`;
    if (note.kind === "foto" && note.file && ctx.sendPhoto) {
      const ok = await ctx.sendPhoto(note.file, noteCaption(note));
      if (ok !== false) return note.read ? `📄 <b>Fotoğraftaki yazı</b>\n${esc(note.read)}` : "";
    }
    return [noteCaption(note), note.url && !note.text.includes(note.url) ? esc(note.url) : "", note.desc ? `<i>${esc(note.desc)}</i>` : "",
      note.read ? `📄 ${esc(note.read)}` : ""].filter(Boolean).join("\n");
  }

  if (!mem.notes.length) return MEMORY_USAGE;
  if (!s) {
    const last = mem.notes.slice(-LIST_COUNT).reverse();
    return `🧠 <b>Son kaydedilenler</b> (toplam ${mem.notes.length})\n\n${last.map(noteLine).join("\n\n")}\n\nGöster: <code>/hafiza 12</code> · Sil: <code>/hafiza sil 12</code> · Ara: <code>/hafiza kelime</code>`;
  }
  const hits = matchNotes(mem.notes, s).slice(0, LIST_COUNT);
  if (!hits.length) return `🧠 Hafızada "${esc(s)}" ile ilgili bir şey bulamadım.`;
  return `🧠 <b>"${esc(s)}" ile ilgili</b>\n\n${hits.map(noteLine).join("\n\n")}`;
}

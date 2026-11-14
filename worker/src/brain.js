// Jarvis'in beyni: normal cümleyle (ya da sesle) yazılanı anlar ve botun mevcut komutlarına çevirir.
// Yapay zekâ yalnızca "ne isteniyor" sorusunu cevaplar; işi yine sınanmış komutlar yapar.
// Silme ve iptal gibi geri alınması zor işler önce onay ister.
import { WEEKDAYS, WEEKDAY_KEYS, dateKey, esc, fmtDateTime, plain, trParts, trToMs } from "./logic.js";
import { loadState } from "./fitness.js";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const SPEECH_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const PENDING_KEY = "ai:pending";   // onay bekleyen iş
export const HISTORY_KEY = "ai:history";   // son birkaç mesaj: "onu 4'e al" gibi devam cümleleri için
const PENDING_TTL = 10 * 60;
const HISTORY_TTL = 30 * 60;
const HISTORY_TURNS = 4;
const MAX_INPUT = 1000;
const MAX_ACTIONS = 6;
const MAX_DAYS = 7;
const CALENDAR_DAYS = 15;
const DAY = 24 * 60 * 60 * 1000;

export const AI_DOWN = "Şu an düşünemiyorum: yapay zekâ cevap vermedi (günlük ücretsiz kota dolmuş olabilir, gece 03:00'te yenilenir). Komutlar çalışmaya devam ediyor: /yardim";
const NOT_UNDERSTOOD = "Bunu tam anlayamadım. Biraz daha açık yazar mısın? Komutlar için: /yardim";

const ACTIONS = [
  "yemek", "dersler", "odevler", "notlar", "hatirlatma_ekle", "hatirlatmalar", "hatirlatma_sil",
  "fitness_ekle", "fitness_liste", "fitness_iptal", "fitness_istek_sil",
];
const READS = new Set(["yemek", "dersler", "odevler", "notlar", "hatirlatmalar", "fitness_liste"]);

// Modelin cevabı bu kalıba zorlanır (JSON mode). Bütün alanlar metin: kalıp sade kalsın.
const text = { type: "string" };
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    islemler: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ad: { type: "string", enum: ACTIONS },
          tarih: text, saat: text, bitis: text, dakika: text, gun_sayisi: text, metin: text, haftalik: text,
        },
        required: ["ad"],
      },
    },
    yorum: text,
    cevap: text,
  },
  required: ["islemler", "cevap"],
};

const two = (n) => String(n).padStart(2, "0");

function calendar(nowMs) {
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  const lines = [];
  for (let i = 0; i < CALENDAR_DAYS; i += 1) {
    const ms = today + i * DAY;
    const note = i === 0 ? " (bugün)" : i === 1 ? " (yarın)" : "";
    lines.push(`${dateKey(ms)} ${WEEKDAYS[trParts(ms).wd]}${note}`);
  }
  return lines.join("\n");
}

export function plannerPrompt(nowMs, history = []) {
  const p = trParts(nowMs);
  const past = history.length
    ? `\n\nÖnceki konuşma (yalnızca bağlam için):\n${history.map((h) => `Kullanıcı: ${h.u}\nJarvis: ${h.a}`).join("\n")}`
    : "";
  return `Sen Jarvis'sin: bir üniversite öğrencisinin Telegram'daki kişisel asistanısın. Kullanıcının mesajını okuyup ne istediğini belirlersin.

Şu an: ${WEEKDAYS[p.wd]} ${dateKey(nowMs)} ${two(p.hh)}:${two(p.mm)} (Türkiye saati).
Önümüzdeki günler:
${calendar(nowMs)}

SADECE şu biçimde JSON yaz, başka hiçbir şey yazma:
{"islemler": [...], "yorum": "", "cevap": ""}

Yapabildiğin işlemler:
- {"ad":"yemek","tarih":"YYYY-AA-GG"} yemekhane menüsü
- {"ad":"dersler","tarih":"YYYY-AA-GG","gun_sayisi":"1"} ders programı; birden çok gün için gun_sayisi (en fazla 7)
- {"ad":"odevler"} bekleyen ve geciken ödevler
- {"ad":"notlar"} son girilen notlar
- {"ad":"hatirlatma_ekle","tarih":"YYYY-AA-GG","saat":"SS:DD","metin":"neyi hatırlatacağı"} hatırlatma kurar. "yarım saat sonra" gibi isteklerde tarih ve saat yerine "dakika":"30" yaz.
- {"ad":"hatirlatmalar"} bekleyen hatırlatmalar
- {"ad":"hatirlatma_sil","metin":"hatırlatmada geçen kelime"} bir hatırlatmayı siler
- {"ad":"fitness_ekle","tarih":"YYYY-AA-GG","saat":"13:00","bitis":"14:30","haftalik":"evet"} spor salonu randevusu alır. Her hafta tekrarlanacaksa haftalik "evet" (tarih o günün ilk tarihi), tek sefer ise "hayir". bitis söylenmediyse boş bırak.
- {"ad":"fitness_liste"} fitness istekleri ve alınan randevular
- {"ad":"fitness_iptal","tarih":"YYYY-AA-GG"} o günün fitness randevusunu iptal eder
- {"ad":"fitness_istek_sil","tarih":"YYYY-AA-GG","haftalik":"evet"} bir fitness isteğini tamamen kaldırır (ör. "artık salıları gitmeyeceğim")

Kurallar:
- Mesaj bu işlemlerle karşılanabiliyorsa islemler'e yaz ve cevap'ı boş bırak. Birden çok işlem yazabilirsin.
- "Bu hafta beni ne bekliyor?" gibi genel sorularda gerekli hepsini yaz: dersler (gun_sayisi 7), odevler, hatirlatmalar, fitness_liste.
- Kullanıcı veriden belirli bir şey soruyorsa (ör. "yarın ilk dersim kaçta?", "en yakın ödevim hangisi?") yorum'a "evet" yaz. Listeyi olduğu gibi göstermek yeterliyse yorum'u boş bırak.
- Gerekli bilgi eksikse (ör. hatırlatmanın saati) işlem yazma; cevap'ta tek cümleyle sor.
- İşlem gerektirmeyen sohbet ve genel bilgi sorularında islemler boş kalır; cevap'a kısa, samimi bir Türkçe cevap yaz. Biçimlendirme işareti (*, #, _) kullanma.
- Tarihleri yukarıdaki listeden seç. Saatleri 24 saat biçiminde yaz. Kullanıcı hakkında bilmediğin şeyi uydurma.${past}`;
}

export const ANSWER_PROMPT = `Sen Jarvis'sin: bir üniversite öğrencisinin kişisel asistanısın. Sana kullanıcının sorusu ve onunla ilgili veriler verilecek.
Soruyu yalnızca bu verilere dayanarak kısa, net ve samimi bir Türkçeyle cevapla. Veride olmayan bir şeyi uydurma; yoksa bilmediğini söyle.
Tarih ve saatleri veride yazdığı gibi kullan. Düz yazı yaz: biçimlendirme işareti (*, #, _) ya da HTML kullanma. Gerekirse satır başına "•" koyarak kısa bir liste yapabilirsin.`;

// Modelin cevabını { actions, comment, reply } haline getirir. Cevap nesne de olabilir, metin de.
export function parsePlan(raw) {
  let data = raw;
  if (typeof raw === "string") {
    const from = raw.indexOf("{"), to = raw.lastIndexOf("}");
    try {
      data = JSON.parse(raw.slice(from, to + 1));
    } catch {
      return { actions: [], comment: false, reply: from < 0 ? raw.trim() : "" };   // düz yazı cevap
    }
  }
  if (!data || typeof data !== "object") return { actions: [], comment: false, reply: "" };
  const list = Array.isArray(data.islemler) ? data.islemler : [];
  const actions = list
    .filter((a) => a && typeof a === "object" && ACTIONS.includes(a.ad))
    .slice(0, MAX_ACTIONS)
    .map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v ?? "").trim()])));
  return { actions, comment: plain(data.yorum) === "evet", reply: String(data.cevap ?? "").trim() };
}

// "2026-11-17" -> o günün başlangıcı (Türkiye saati); geçersizse null
function parseIsoDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const ms = trToMs(+m[1], +m[2], +m[3]);
  return dateKey(ms) === value ? ms : null;   // 2026-02-31 gibi tarihleri ele
}

function dayArg(ms) {
  const p = trParts(ms);
  return `${two(p.d)}.${two(p.m)}.${p.y}`;
}

function clock(value) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(value ?? "");
  return m && +m[1] <= 23 && +m[2] <= 59 ? `${two(+m[1])}:${m[2]}` : null;
}

const yes = (value) => ["evet", "true", "1"].includes(plain(value));

// Planı adımlara çevirir. Adım türleri:
//   run      -> botun bir komutu (read: yalnızca bilgi okur)
//   confirm  -> onaydan sonra çalışacak komut
//   reminder -> metne göre hatırlatma silme (önce bulunur, sonra onay istenir)
//   rule     -> fitness isteği kaldırma (önce bulunur, sonra onay istenir)
//   say      -> kullanıcıya doğrudan söylenecek söz (eksik ya da hatalı bilgi)
export function toSteps(actions, nowMs) {
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  const steps = [];
  for (const a of actions) {
    const day = a.tarih ? parseIsoDay(a.tarih) : null;
    if (a.tarih && day === null) {
      steps.push({ type: "say", text: "Tarihi anlayamadım, günü biraz daha açık yazar mısın?" });
      continue;
    }
    if (a.ad === "yemek") {
      steps.push({ type: "run", read: true, command: "yemek", args: dayArg(day ?? today) });
    } else if (a.ad === "dersler") {
      const n = Math.min(Math.max(Number.parseInt(a.gun_sayisi, 10) || 1, 1), MAX_DAYS);
      for (let i = 0; i < n; i += 1) steps.push({ type: "run", read: true, command: "dersler", args: dayArg((day ?? today) + i * DAY) });
    } else if (["odevler", "notlar", "hatirlatmalar"].includes(a.ad)) {
      steps.push({ type: "run", read: true, command: a.ad, args: "" });
    } else if (a.ad === "fitness_liste") {
      steps.push({ type: "run", read: true, command: "fitness", args: "" });
    } else if (a.ad === "hatirlatma_ekle") {
      const note = (a.metin ?? "").replace(/\s+/g, " ").trim();
      const minutes = Number.parseInt(a.dakika, 10);
      const at = clock(a.saat);
      if (!note) steps.push({ type: "say", text: "Neyi hatırlatmamı istersin?" });
      else if (Number.isInteger(minutes) && minutes > 0) steps.push({ type: "run", command: "hatirlat", args: `${minutes} dk ${note}` });
      else if (!at) steps.push({ type: "say", text: `"${note}" için saat kaçta hatırlatayım?` });
      else steps.push({ type: "run", command: "hatirlat", args: `${day === null ? "" : `${dayArg(day)} `}${at} ${note}` });
    } else if (a.ad === "hatirlatma_sil") {
      steps.push({ type: "reminder", text: a.metin ?? "" });
    } else if (a.ad === "fitness_ekle") {
      const start = clock(a.saat), end = a.bitis ? clock(a.bitis) : "";
      if (day === null || !start || end === null) {
        steps.push({ type: "say", text: "Fitness için gün ve saati yazar mısın? Örnek: salı 13:00-14:30" });
      } else {
        const when = yes(a.haftalik) ? `her ${WEEKDAY_KEYS[trParts(day).wd]}` : `tek ${dayArg(day)}`;
        steps.push({ type: "run", command: "fitness", args: `${when} ${start}${end ? `-${end}` : ""}` });
      }
    } else if (a.ad === "fitness_iptal") {
      if (day === null) steps.push({ type: "say", text: "Hangi günün fitness randevusunu iptal edeyim?" });
      else steps.push({ type: "confirm", command: "fitness", args: `iptal ${dayArg(day)}`, label: `${WEEKDAYS[trParts(day).wd]} ${dayArg(day)} fitness randevusunu iptal et` });
    } else if (a.ad === "fitness_istek_sil") {
      if (day === null) steps.push({ type: "say", text: "Hangi fitness isteğini kaldırayım? Liste için: /fitness" });
      else steps.push({ type: "rule", day, weekly: yes(a.haftalik) });
    }
  }
  return steps;
}

async function readJson(kv, key) {
  try {
    return JSON.parse(await kv.get(key));
  } catch {
    return null;
  }
}

// Onay bekleyen bir iş varsa ve mesaj "evet"/"hayır" ise sonucu döndürür; yoksa null (mesaj normal işlenir).
export async function resolvePending(message, ctx, run) {
  const pending = await readJson(ctx.kv, PENDING_KEY);
  if (!pending) return null;
  await ctx.kv.delete(PENDING_KEY);   // başka bir şey yazıldıysa da bekleyen iş düşer
  const word = message.length <= 30 ? plain(message).split(/[\s,.!?]+/)[0] : "";   // "evet lütfen" de olur
  if (["evet", "onay", "onayla", "onayliyorum", "tamam", "olur", "yap", "aynen"].includes(word)) {
    if (pending.reminder) {
      await ctx.kv.delete(pending.reminder);
      return `🗑 Silindi: ${esc(pending.what)}`;
    }
    return run({ command: pending.command, args: pending.args });
  }
  if (["hayir", "vazgec", "vazgectim", "iptal", "bosver", "yok"].includes(word)) return "Tamam, vazgeçtim.";
  return null;
}

async function askConfirm(ctx, pending) {
  await ctx.kv.put(PENDING_KEY, JSON.stringify(pending), { expirationTtl: PENDING_TTL });
  return `Şunu yapayım mı?\n<b>${esc(pending.label)}</b>\n\nOnaylıyorsan <b>evet</b>, vazgeçtiysen <b>hayır</b> yaz.`;
}

async function findReminder(ctx, needle) {
  const want = plain(needle);
  const all = await ctx.reminders();
  const hits = want ? all.filter((r) => plain(r.text).includes(want)) : [];
  if (hits.length !== 1) {
    if (!all.length) return { say: "Silinecek hatırlatma yok." };
    return { say: `${hits.length ? "Buna uyan birden çok hatırlatma var." : "Buna uyan bir hatırlatma bulamadım."} /hatirlatmalar ile listeye bakıp <code>/sil 2</code> gibi numarasıyla silebilirsin.` };
  }
  const what = `${fmtDateTime(hits[0].at)} ${hits[0].text}`;
  return { pending: { reminder: hits[0].key, what, label: `Hatırlatmayı sil: ${what}` } };
}

async function findRule(ctx, step) {
  const state = await loadState(ctx.kv);
  const wd = trParts(step.day).wd, date = dateKey(step.day);
  const matches = state.rules
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => (step.weekly ? !r.date && r.wd === wd : r.date === date) || (!step.weekly && !r.date && r.wd === wd));
  if (matches.length !== 1) return { say: `${matches.length ? "O güne uyan birden çok fitness isteği var." : "O güne ait bir fitness isteği bulamadım."} /fitness ile listeye bakıp <code>/fitness sil 1</code> gibi numarasıyla kaldırabilirsin.` };
  const { r, n } = matches[0];
  const name = r.date ? r.date.split("-").reverse().join(".") : `Her ${WEEKDAYS[r.wd]}`;
  return { pending: { command: "fitness", args: `sil ${n}`, label: `Fitness isteğini kaldır: ${name} ${r.start}-${r.end}` } };
}

const stripTags = (html) => String(html).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function ask(ctx, messages, options) {
  const out = await ctx.ai.chat(messages, options);
  if (out === undefined || out === null || out === "") throw new Error("boş cevap");
  return out;
}

async function remember(ctx, history, user, answer) {
  const short = (s) => stripTags(s).replace(/\s+/g, " ").trim().slice(0, 300);
  const next = [...history, { u: short(user), a: short(answer) }].slice(-HISTORY_TURNS);
  try {
    await ctx.kv.put(HISTORY_KEY, JSON.stringify(next), { expirationTtl: HISTORY_TTL });
  } catch { /* hafıza yazılamasa da cevap gitsin */ }
}

// Normal cümleyle yazılmış bir mesajı işler; gönderilecek mesajların listesini döndürür.
// run({command, args}) botun komut çalıştırıcısıdır.
export async function converse(input, ctx, run) {
  const message = String(input ?? "").trim().slice(0, MAX_INPUT);
  if (!message) return [NOT_UNDERSTOOD];

  const confirmed = await resolvePending(message, ctx, run);
  if (confirmed !== null) return [confirmed];

  const history = (await readJson(ctx.kv, HISTORY_KEY)) ?? [];
  const messages = [{ role: "system", content: plannerPrompt(ctx.now, Array.isArray(history) ? history : []) }, { role: "user", content: message }];
  let plan;
  try {
    let raw;
    try {
      raw = await ask(ctx, messages, { schema: PLAN_SCHEMA, maxTokens: 500 });
    } catch {
      raw = await ask(ctx, messages, { maxTokens: 500 });   // kalıp tutturulamadıysa kalıpsız bir kez daha
    }
    plan = parsePlan(raw);
  } catch (err) {
    console.error("yapay zekâ cevap vermedi", err?.message);
    return [AI_DOWN];
  }

  const steps = toSteps(plan.actions, ctx.now);
  if (!steps.length) {
    const reply = plan.reply || NOT_UNDERSTOOD;
    await remember(ctx, history, message, reply);
    return [plan.reply ? esc(reply) : reply];
  }

  const out = [], reads = [], shown = new Set();
  let asked = false;
  for (const step of steps) {
    if (step.type === "say") out.push(step.text);
    else if (step.type === "run" && step.read) { reads.push(await run(step)); shown.add(step.command); }
    else if (step.type === "run") out.push(await run(step));
    else if (asked) out.push("Silme ve iptal işlerini tek tek onaylaman gerekiyor; diğerini bundan sonra yazar mısın?");
    else {
      const found = step.type === "confirm" ? { pending: step } : step.type === "reminder" ? await findReminder(ctx, step.text) : await findRule(ctx, step);
      if (found.say) out.push(found.say);
      else {
        const { command, args, label, reminder, what } = found.pending;
        out.push(await askConfirm(ctx, reminder ? { reminder, what, label } : { command, args, label }));
        asked = true;
      }
    }
  }

  if (reads.length > 1 || (reads.length === 1 && plan.comment)) {
    try {
      const data = reads.map(stripTags).join("\n\n");
      const answer = await ask(ctx, [
        { role: "system", content: ANSWER_PROMPT },
        { role: "user", content: `Şu an: ${fmtDateTime(ctx.now)}\nSoru: ${message}\n\nVeriler:\n${data}` },
      ], { maxTokens: 700 });
      out.push(esc(String(answer).trim()));
    } catch (err) {
      console.error("yorum yazılamadı", err?.message);
      out.push(...reads);   // yorum yapılamadıysa veriyi olduğu gibi göster
    }
  } else {
    out.push(...reads);
  }

  // Hafızaya yalnızca Jarvis'in kendi sözleri girer; okunan listeler (ör. Canvas'taki ödev adları) girmez.
  const said = out.filter((o) => !reads.includes(o));
  if (said.length < out.length) said.push(`(${[...shown].join(", ")} bilgisi gösterildi)`);
  await remember(ctx, history, message, said.join(" "));
  return out;
}

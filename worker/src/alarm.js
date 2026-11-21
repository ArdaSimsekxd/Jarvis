// Sabah alarmı: kurulan saatte Jarvis seni Telegram'dan sesli arar (CallMeBot servisiyle) ve sen bir şey
// yazana kadar 2 dakikada bir mesaj atar. Cevap gelmezse aramayı tekrarlar, yarım saat sonra bırakır.
// Ayar ve o günkü alarmın durumu tek bir KV kaydında durur.
import { WEEKDAYS, dateKey, esc, parseDay, plain, trParts, trToMs } from "./logic.js";

export const ALARM_KEY = "alarm";
export const CALL_URL = "https://api.callmebot.com/start.php";
export const VOICE = "tr-TR-Standard-A";
export const CALLMEBOT_START = "https://t.me/CallMeBot_txtbot";
const CALL_EVERY_MS = 6 * 60000;    // cevap yoksa bu kadar sonra yeniden ara
const MAX_CALLS = 3;
const GIVE_UP_MS = 30 * 60000;      // bundan sonra alarm kendiliğinden kapanır
const MAX_LATE_MS = 20 * 60000;     // bot o saatte çalışamadıysa en fazla bu kadar geç başlar

const two = (n) => String(n).padStart(2, "0");

export async function loadAlarm(kv) {
  try {
    const data = JSON.parse(await kv.get(ALARM_KEY));
    if (data && typeof data === "object") return data;
  } catch { /* boş ya da bozuk */ }
  return {};
}

const saveAlarm = (kv, data) => kv.put(ALARM_KEY, JSON.stringify(data));

function clock(value) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(String(value ?? "").trim());
  if (!m || +m[1] > 23 || +(m[2] ?? 0) > 59) return null;
  return `${two(+m[1])}:${m[2] ?? "00"}`;
}

const WEEKDAY_SET = [1, 2, 3, 4, 5];

function describe(a) {
  if (!a.time) return "kapalı";
  if (a.mode === "tek") return `${String(a.date).split("-").reverse().join(".")} ${a.time} (tek sefer)`;
  if (a.mode === "haftaici") return `hafta içi her gün ${a.time}`;
  return `her gün ${a.time}`;
}

// Bugün (Türkiye saati) çalması gereken alarmın zamanı; yoksa null
export function dueToday(a, nowMs) {
  if (!a.time) return null;
  const p = trParts(nowMs);
  const [hh, mm] = a.time.split(":").map(Number);
  if (a.mode === "tek" && a.date !== dateKey(nowMs)) return null;
  if (a.mode === "haftaici" && !WEEKDAY_SET.includes(p.wd)) return null;
  return trToMs(p.y, p.m, p.d, hh, mm);
}

export function wakeText(time) {
  return `Günaydın! Saat ${time}. Kalkma vakti. Uyandıysan Jarvis'e bir mesaj yaz.`;
}

function setupText(user) {
  const lines = [
    "📞 Seni aramam için bir kere şunu yapman lazım:",
    `1. <a href="${CALLMEBOT_START}">CallMeBot</a> botunu aç ve <b>Başlat</b> (Start) düğmesine bas. Bu servis aramayı benim adıma yapıyor.`,
    "2. Telegram'da Ayarlar > Gizlilik ve Güvenlik > Aramalar bölümü <b>Herkes</b> olmalı (ya da CallMeBot'u istisna olarak ekle).",
    "3. <code>/alarm test</code> yaz, hemen arayayım.",
  ];
  if (!user) lines.push("", "⚠️ Telegram'da bir kullanıcı adın yok gibi görünüyor. Ayarlar > Kullanıcı adı bölümünden bir tane seç, sonra bana herhangi bir mesaj yaz.");
  return lines.join("\n");
}

export const ALARM_USAGE = [
  "⏰ <b>Alarm</b>",
  "Kurduğun saatte seni Telegram'dan sesli ararım; sen bir şey yazana kadar 2 dakikada bir mesaj atarım.",
  "",
  "<code>/alarm 06:00</code> — her gün",
  "<code>/alarm hafta içi 06:00</code> — pazartesi-cuma",
  "<code>/alarm yarın 06:00</code> — tek sefer (<code>/alarm 24.11 07:30</code> da olur)",
  "<code>/alarm kapat</code> — alarmı kapat",
  "<code>/alarm test</code> — şimdi deneme araması",
].join("\n");

// "/alarm" komutu
export async function cmdAlarm(args, ctx) {
  const s = plain(args).replace(/\s+/g, " ").trim();
  const a = await loadAlarm(ctx.kv);
  if (!s) {
    return `⏰ Alarm: <b>${esc(describe(a))}</b>\n\n${ALARM_USAGE}`;
  }
  if (["yardim", "help"].includes(s)) return ALARM_USAGE;
  if (["kapat", "sil", "iptal", "kaldir", "yok"].includes(s)) {
    await saveAlarm(ctx.kv, { user: a.user, run: a.run ? { ...a.run, done: true } : undefined });
    return "⏰ Alarm kapatıldı.";
  }
  if (s === "test" || s === "dene") {
    if (!a.user) return setupText(a.user);
    const ok = await ctx.call(a.user, "Merhaba, ben Jarvis. Bu bir deneme araması. Sabah seni böyle arayacağım.");
    return ok
      ? "📞 Arıyorum… Birkaç saniye içinde Telegram'dan arama gelmeli (sırada başka arama varsa biraz gecikebilir). Gelmezse:\n\n" + setupText(a.user)
      : `📞 Arama servisine ulaşamadım ya da arama reddedildi.\n\n${setupText(a.user)}`;
  }

  let mode = "her", date = null, rest = s;
  if (/^(hafta ?ici|haftaici)\b/.test(rest)) {
    mode = "haftaici";
    rest = rest.replace(/^(hafta ?ici|haftaici)\s*/, "");
  } else if (/^(her ?gun)\b/.test(rest)) {
    rest = rest.replace(/^(her ?gun)\s*/, "");
  } else {
    const [first, ...others] = rest.split(" ");
    if (others.length && !clock(first)) {
      const day = parseDay(first, ctx.now);
      if (day === null) return `"${esc(first)}" gününü anlayamadım.\n\n${ALARM_USAGE}`;
      mode = "tek";
      date = dateKey(day);
      rest = others.join(" ");
    }
  }
  const time = clock(rest.replace(/^saat\s*/, "").replace(/['’]?(de|da|te|ta)$/, ""));
  if (!time) return `Saati anlayamadım. Örnek: <code>/alarm 06:00</code>\n\n${ALARM_USAGE}`;
  if (mode === "tek") {
    const [hh, mm] = time.split(":").map(Number);
    const [y, m, d] = date.split("-").map(Number);
    if (trToMs(y, m, d, hh, mm) <= ctx.now) return "Bu zaman geçmişte kalıyor. İleri bir zaman yazar mısın?";
  }
  // O günün alarmı zaten çaldıysa yeni ayar yarından itibaren geçerli olur.
  await saveAlarm(ctx.kv, { ...a, time, mode, date });
  const next = nextRing({ time, mode, date }, ctx.now);
  const when = next ? `${WEEKDAYS[trParts(next).wd]} ${two(trParts(next).d)}.${two(trParts(next).m)} ${time}` : time;
  return `⏰ Alarm kuruldu: <b>${esc(describe({ time, mode, date }))}</b>\nİlk çalacağı zaman: <b>${esc(when)}</b>\n\n${setupText(a.user)}`;
}

// Bir sonraki çalma zamanı (bilgi için)
export function nextRing(a, nowMs) {
  for (let i = 0; i < 8; i += 1) {
    const at = dueToday(a, nowMs + i * 86400000);
    if (at !== null && at > nowMs) return at;
  }
  return null;
}

// Zamanlayıcıdan her 2 dakikada çağrılır.
export async function alarmTick(ctx) {
  const a = await loadAlarm(ctx.kv);
  if (!a.time && !(a.run && !a.run.done)) return null;
  const today = dateKey(ctx.now);
  const run = a.run;

  if (run && !run.done) {
    const elapsed = ctx.now - run.at;
    if (elapsed > GIVE_UP_MS) {
      await saveAlarm(ctx.kv, { ...a, run: { ...run, done: true } });
      await ctx.send("⏰ Yarım saattir cevap gelmedi, alarmı kapattım. Umarım uyanmışsındır!");
      return "gave-up";
    }
    let calls = run.calls;
    if (a.user && calls < MAX_CALLS && elapsed >= calls * CALL_EVERY_MS) {
      if (await ctx.call(a.user, wakeText(run.time))) calls += 1;
    }
    await ctx.send(`⏰ <b>Günaydın!</b> Saat ${esc(run.time)} alarmı. Uyandıysan bir şey yaz, susayım.`);
    await saveAlarm(ctx.kv, { ...a, run: { ...run, calls, msgs: (run.msgs ?? 0) + 1 } });
    return "nag";
  }

  const due = dueToday(a, ctx.now);
  if (due === null || ctx.now < due || ctx.now > due + MAX_LATE_MS || (run?.day === today && run?.time === a.time)) return null;
  const called = a.user ? await ctx.call(a.user, wakeText(a.time)) : false;
  await ctx.send(`⏰ <b>Günaydın!</b> Saat ${esc(a.time)}. Kalkma vakti.${a.user ? "" : "\n(Seni arayamadım: Telegram kullanıcı adın yok.)"}\nUyandıysan bir şey yaz, susayım.`);
  const next = { ...a, run: { day: today, at: due, time: a.time, calls: called ? 1 : 0, msgs: 1, done: false } };
  if (a.mode === "tek") { next.time = null; next.mode = null; next.date = null; }
  await saveAlarm(ctx.kv, next);
  return "rang";
}

// Kullanıcıdan gelen her mesajda: çalan bir alarm varsa susturur; Telegram kullanıcı adı değiştiyse kaydeder.
// Alarm susturulduysa söylenecek sözü döndürür.
export async function onUserMessage(ctx, username) {
  const a = await loadAlarm(ctx.kv);
  const user = username ? `@${String(username).replace(/^@/, "")}` : null;
  const ringing = a.run && !a.run.done;
  if (!ringing && (!user || a.user === user)) return null;
  const next = { ...a, ...(user ? { user } : {}) };
  if (ringing) next.run = { ...a.run, done: true };
  await saveAlarm(ctx.kv, next);
  return ringing ? "☀️ Günaydın! Alarmı kapattım." : null;
}

export function isWakeWord(text) {
  return /^(uyandim|uyandım|kalktim|kalktım|tamam|ok|gunaydin|günaydın|sus|kapat)[\s.!]*$/i.test(String(text ?? "").trim());
}

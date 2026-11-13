// Jarvis botu: Telegram'dan gelen komutlara anında cevap verir, hatırlatmaları zamanında gönderir.
import {
  HELP, dateKey, dueJobs, esc, fmtDateTime, formatGrades, formatMenu, formatPending, formatSchedule, fmtDate,
  parseCommand, parseDay, parseReminder, parseSchedule,
} from "./logic.js";

const REMINDER_PREFIX = "rem:";
const MAX_REMINDERS = 100;
const MAX_TEXT = 500;
const WORKFLOWS = { canvas: "canvas.yml", morning: "morning.yml", evening: "evening.yml" };
const DAILY_KEYS = { morning: "sched:morning", evening: "sched:evening" };   // günde bir kez çalışan işlerin en son başlatıldığı gün
const MAX_COURSES = 40;                // ücretsiz planda bir istekte en fazla 50 alt istek yapılabilir
const WARN_KEY = "sched:warn";         // anahtar uyarısının en son gönderildiği gün

async function telegram(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

function sender(env) {
  return (text) => telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function fetchMenu(env) {
  try {
    const res = await fetch(env.MENU_URL, { cf: { cacheTtl: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// GitHub'daki bir iş akışını başlatır; HTTP durum kodunu döndürür (204 = başladı).
async function dispatchWorkflow(env, job) {
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOWS[job]}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jarvis-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: job in DAILY_KEYS ? { otomatik: "true" } : {} }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

async function canvasGet(env, path) {
  const res = await fetch(`${env.CANVAS_BASE_URL.replace(/\/+$/, "")}/api/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.CANVAS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`canvas ${res.status}`);
  return res.json();
}

// Aktif dersleri ve her dersin ödevlerini (teslim bilgisiyle) getirir.
async function canvasData(ctx) {
  const all = await ctx.canvas("courses?enrollment_state=active&per_page=100&include[]=total_scores");
  const courses = (Array.isArray(all) ? all : []).filter((c) => c?.id && !c.access_restricted_by_date).slice(0, MAX_COURSES);
  const lists = await Promise.all(courses.map((c) =>
    ctx.canvas(`courses/${c.id}/assignments?per_page=100&include[]=submission&order_by=due_at`)
      .then((list) => (Array.isArray(list) ? list : []))
      .catch(() => [])));   // tek bir derse erişilemese de diğerleri gösterilsin
  return { courses, assignments: new Map(courses.map((c, i) => [c.id, lists[i]])) };
}

// Hatırlatma anahtarı zamana göre sıralanır: rem:<15 haneli ms>:<kimlik>
function reminderKey(at, id) {
  return `${REMINDER_PREFIX}${String(at).padStart(15, "0")}:${id}`;
}

async function listReminders(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: REMINDER_PREFIX, cursor });
    for (const k of page.keys) {
      out.push({ key: k.name, at: Number(k.name.split(":")[1]), text: k.metadata?.text ?? "" });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out; // anahtar sırası = zaman sırası
}

async function cmdYemek(args, ctx) {
  const day = parseDay(args, ctx.now);
  if (day === null) {
    return "Günü anlayamadım. Örnekler: <code>/yemek</code>, <code>/yemek yarın</code>, <code>/yemek cuma</code>, <code>/yemek 17.11</code>";
  }
  const menu = await ctx.fetchMenu();
  if (!menu) return "Menüye şu an ulaşamadım, birazdan tekrar dener misin?";
  return formatMenu(menu, day) ?? `🍽 <b>${esc(fmtDate(day))}</b>\n\nBu gün için menü bilgisi yok.`;
}

async function cmdCanvas(ctx, format) {
  if (!ctx.canvas) return "Canvas bağlantısı henüz kurulmamış. <b>Botu kur</b> iş akışını bir kez çalıştırmak gerekiyor.";
  try {
    const { courses, assignments } = await canvasData(ctx);
    return format(courses, assignments, ctx.now);
  } catch (err) {
    console.error("canvas okunamadı", err?.message);
    return "Canvas'a şu an ulaşamadım, birazdan tekrar dener misin?";
  }
}

function cmdDersler(args, ctx) {
  const day = parseDay(args, ctx.now);
  if (day === null) return "Günü anlayamadım. Örnekler: <code>/dersler</code>, <code>/dersler yarın</code>, <code>/dersler salı</code>";
  if (!Object.keys(ctx.schedule ?? {}).length) return "Ders programı henüz girilmemiş.";
  return formatSchedule(ctx.schedule, day) ?? `📚 <b>${esc(fmtDate(day))}</b>\n\nBu gün ders yok.`;
}

async function cmdHatirlat(args, ctx) {
  const r = parseReminder(args, ctx.now);
  if (r.error === "past") return "Bu zaman geçmişte kalıyor. İleri bir zaman yazar mısın?";
  if (r.error) {
    return "Şöyle yazabilirsin:\n<code>/hatirlat 15:00 kütüphane</code>\n<code>/hatirlat yarın 09:30 hocaya mail</code>\n<code>/hatirlat 30 dk çay</code>\n\nHepsi için: /yardim";
  }
  const existing = await listReminders(ctx.kv);
  if (existing.length >= MAX_REMINDERS) return `En fazla ${MAX_REMINDERS} bekleyen hatırlatma olabilir. Önce /hatirlatmalar ile bakıp birkaçını sil.`;
  const text = r.text.slice(0, MAX_TEXT);
  await ctx.kv.put(reminderKey(r.at, ctx.id()), "1", { metadata: { text } });
  return `✅ Tamam, <b>${esc(fmtDateTime(r.at))}</b> için hatırlatacağım:\n${esc(text)}`;
}

async function cmdListe(ctx) {
  const items = await listReminders(ctx.kv);
  if (!items.length) return "Bekleyen hatırlatma yok. Eklemek için: <code>/hatirlat 15:00 kütüphane</code>";
  const lines = items.map((r, i) => `${i + 1}. <b>${esc(fmtDateTime(r.at))}</b> ${esc(r.text)}`);
  return `⏰ <b>Bekleyen hatırlatmalar</b>\n${lines.join("\n")}\n\nSilmek için: <code>/sil 1</code>`;
}

async function cmdSil(args, ctx) {
  const n = Number.parseInt(args, 10);
  const items = await listReminders(ctx.kv);
  if (!Number.isInteger(n) || n < 1 || n > items.length) {
    return items.length ? `1 ile ${items.length} arasında bir numara yaz. Liste için: /hatirlatmalar` : "Silinecek hatırlatma yok.";
  }
  const r = items[n - 1];
  await ctx.kv.delete(r.key);
  return `🗑 Silindi: <b>${esc(fmtDateTime(r.at))}</b> ${esc(r.text)}`;
}

// Tek bir Telegram mesajını işler; cevabı ctx.send ile yollar.
export async function handleMessage(message, ctx) {
  if (String(message?.chat?.id) !== String(ctx.chatId)) return; // sadece sahibine cevap ver
  const cmd = parseCommand(message.text);
  let reply;
  if (!cmd) reply = "Komutları görmek için /yardim yaz.";
  else if (cmd.command === "yemek") reply = await cmdYemek(cmd.args, ctx);
  else if (["odevler", "odev"].includes(cmd.command)) reply = await cmdCanvas(ctx, formatPending);
  else if (["notlar", "not"].includes(cmd.command)) reply = await cmdCanvas(ctx, formatGrades);
  else if (["dersler", "ders", "program"].includes(cmd.command)) reply = cmdDersler(cmd.args, ctx);
  else if (cmd.command === "hatirlat") reply = await cmdHatirlat(cmd.args, ctx);
  else if (cmd.command === "hatirlatmalar") reply = await cmdListe(ctx);
  else if (cmd.command === "sil") reply = await cmdSil(cmd.args, ctx);
  else if (["start", "yardim", "help"].includes(cmd.command)) reply = HELP;
  else reply = "Bu komutu bilmiyorum. Komutlar için /yardim yaz.";
  await ctx.send(reply);
}

// Zamanı gelen hatırlatmaları gönderir. Gönderilemeyen silinmez, sonraki turda yeniden denenir.
export async function sendDueReminders(ctx) {
  let sent = 0;
  for (const r of await listReminders(ctx.kv)) {
    if (r.at > ctx.now) break; // sıralı: gerisi daha ileride
    const ok = await ctx.send(`⏰ <b>Hatırlatma</b>\n${esc(r.text)}`);
    if (ok === false) continue;
    await ctx.kv.delete(r.key);
    sent += 1;
  }
  return sent;
}

// Zamanı gelen işleri (Canvas/mail kontrolü, sabah özeti, akşam önizlemesi) GitHub'da başlatır.
// GH_TOKEN girilmemişse hiçbir şey yapmaz; o durumda GitHub'ın kendi zamanlayıcısı çalışır.
export async function runSchedule(ctx) {
  if (!ctx.dispatch) return [];
  const today = dateKey(ctx.now);
  const started = [];
  for (const job of dueJobs(ctx.now)) {
    const dailyKey = DAILY_KEYS[job];
    if (dailyKey && (await ctx.kv.get(dailyKey)) === today) continue;
    const status = await ctx.dispatch(job);
    if (status === 204) {
      if (dailyKey) await ctx.kv.put(dailyKey, today);
      started.push(job);
    } else if ((status === 401 || status === 403 || (status === 404 && job === "canvas")) && (await ctx.kv.get(WARN_KEY)) !== today) {
      // Anahtar silinmiş ya da süresi dolmuş: günde bir kez haber ver.
      await ctx.kv.put(WARN_KEY, today);
      await ctx.send("⚠️ Canvas ve mail kontrolünü başlatamadım. GitHub'daki <code>DISPATCH_TOKEN</code> anahtarının süresi dolmuş olabilir; yenisini üretip aynı isimle kaydet, sonra <b>Botu kur</b> iş akışını çalıştır.");
    }
  }
  return started;
}

function context(env, now = Date.now()) {
  return {
    now,
    chatId: env.TELEGRAM_CHAT_ID,
    kv: env.KV,
    send: sender(env),
    fetchMenu: () => fetchMenu(env),
    dispatch: env.GH_TOKEN && env.GITHUB_REPO ? (job) => dispatchWorkflow(env, job) : null,
    canvas: env.CANVAS_TOKEN && env.CANVAS_BASE_URL ? (path) => canvasGet(env, path) : null,
    schedule: parseSchedule(env.SCHEDULE),
    id: () => crypto.randomUUID().slice(0, 8),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/telegram") return new Response("Jarvis", { status: 200 });
    // Telegram her isteğe kurulumda verdiğimiz gizli değeri ekler; yoksa istek Telegram'dan değildir.
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const update = await request.json();
      if (update.message) await handleMessage(update.message, context(env));
    } catch (err) {
      console.error("update işlenemedi", err?.message);
    }
    return new Response("ok"); // hata olsa da 200: Telegram aynı mesajı tekrar tekrar yollamasın
  },

  async scheduled(event, env, ctx) {
    const c = context(env, event?.scheduledTime ?? Date.now());
    ctx.waitUntil(Promise.all([sendDueReminders(c), runSchedule(c)]));
  },
};

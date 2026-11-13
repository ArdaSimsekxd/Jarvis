// Jarvis botu: Telegram'dan gelen komutlara anında cevap verir, hatırlatmaları zamanında gönderir.
import { HELP, esc, fmtDateTime, formatMenu, fmtDate, parseCommand, parseDay, parseReminder } from "./logic.js";

const REMINDER_PREFIX = "rem:";
const MAX_REMINDERS = 100;
const MAX_TEXT = 500;

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

function context(env) {
  return {
    now: Date.now(),
    chatId: env.TELEGRAM_CHAT_ID,
    kv: env.KV,
    send: sender(env),
    fetchMenu: () => fetchMenu(env),
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

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDueReminders(context(env)));
  },
};

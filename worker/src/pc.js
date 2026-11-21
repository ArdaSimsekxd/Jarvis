// Bilgisayarı yöneten Jarvis. Windows'ta arka planda çalışan küçük program (pc/jarvis_pc.py), bu dosyadaki
// Durable Object'e (PcHub) WebSocket ile bağlanır. Bot bir iş gönderir, program yapar ve sonucu yazar.
// Program bağlantıyı kendisi açtığı için modemde ayar gerekmez. Yalnızca programın tanıdığı işler yapılır.
import { esc, plain } from "./logic.js";
import { PANEL_KEY } from "./panel.js";
import { makeVapidKeys, sendPush, trustedEndpoint } from "./webpush.js";

export const PC_FILE = "pc/jarvis_pc.py";
const PAIR_TTL_MS = 60 * 60 * 1000;      // eşleştirme kodu 1 saat geçerli
const PAIR_TRIES = 10;                   // bu kadar yanlış denemeden sonra kod silinir
const WAIT_MS = 9000;                    // bilgisayarın cevabı için beklenen süre (Telegram cevabı 30 saniyeye sığmalı)
const SLOW_WAIT_MS = 15000;              // ekran görüntüsü gibi yavaş işler için
const MAX_UPLOAD = 45 * 1024 * 1024;     // Telegram botları en fazla 50 MB dosya gönderebilir
const MAX_PHOTO = 9 * 1024 * 1024;       // fotoğraf olarak gönderilebilecek en büyük boy (üstü dosya olarak gider)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOGIN_TTL_MS = 15 * 60 * 1000;     // uygulamaya giriş kodu 15 dakika geçerli
const MAX_SUBS = 5;                      // bildirim alabilecek en fazla cihaz
const PUSH_SUBJECT = "https://github.com/ArdaSimsekxd/Jarvis";   // bildirim servislerine verilen iletişim adresi   // 32 harf: karışan 0/O, 1/I yok

export const PC_HELP = [
  "🖥 <b>Bilgisayar komutları</b>",
  "<code>/pc</code> açık mı, pil durumu",
  "<code>/pc kilitle</code> · <code>/pc uyku</code>",
  "<code>/pc kapat</code> · <code>/pc yeniden</code> (1 dakika sonra; vazgeçmek için <code>/pc iptal</code>)",
  "<code>/pc ekran</code> ekran görüntüsü",
  "<code>/pc ses 40</code> · <code>/pc ses aç</code> · <code>/pc ses kıs</code> · <code>/pc ses kapat</code>",
  "<code>/pc müzik durdur</code> · <code>/pc müzik sonraki</code> · <code>/pc müzik önceki</code>",
  "<code>/pc aç spotify</code> uygulama, site ya da bağlantı açar; <code>/pc uygulamalar</code> tanıdıklarım",
  "<code>/pc dosyalar</code> İndirilenler ve Masaüstündeki son dosyalar; <code>/pc dosya 3</code> 3. dosyayı gönderir",
  "<code>/pc bağla</code> bilgisayarı bağlar · <code>/pc ayır</code> bağlantıyı kaldırır",
  "Normal cümle de olur: \"bilgisayarı kilitle\", \"sesi 30 yap\", \"ekranın fotoğrafını at\".",
].join("\n");

const NOT_PAIRED = "🖥 Henüz bir bilgisayar bağlı değil. Bağlamak için <code>/pc bağla</code> yaz.";
const OFFLINE = "🖥 Bilgisayarın şu an bağlı değil: kapalı, uykuda ya da internete bağlı değil olabilir. Açıldığında Jarvis kendiliğinden yeniden bağlanır.";

// 8 rastgele harf: "ABCD-EFGH"
export function pairCode(bytes = crypto.getRandomValues(new Uint8Array(8))) {
  const s = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

const cleanCode = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Kullanıcının yazdığını bilgisayara gidecek işe çevirir.
// Dönen: { job: { is, arg } } | { local: "pair" | "unpair" } | { say }
export function parsePc(args) {
  const raw = String(args ?? "").replace(/\s+/g, " ").trim();
  const words = plain(raw).split(" ").filter(Boolean);
  const [first = "", ...rest] = words;
  const tail = rest.join(" ");
  const job = (is, arg = "") => ({ job: { is, arg } });

  if (!first || ["durum", "acik", "acikmi", "pil"].includes(first)) return job("durum");
  if (["bagla", "kur", "eslestir", "baglan"].includes(first)) return { local: "pair" };
  if (["ayir", "unut", "kaldir", "baglantiyi"].includes(first)) return { local: "unpair" };
  if (["kilitle", "kilit"].includes(first)) return job("kilitle");
  if (["uyku", "uyut", "uyusun"].includes(first)) return job("uyku");
  if (first === "kapat") return job("kapat");
  if (["yeniden", "restart", "yenidenbaslat"].includes(first)) return job("yeniden");
  if (["iptal", "vazgec", "durdur"].includes(first)) return job("iptal");
  if (["ekran", "ss", "goruntu", "screenshot"].includes(first)) return job("ekran");
  if (first === "ses") {
    const n = /^[+-]?\d{1,3}$/.test(rest[0] ?? "") ? rest[0] : null;
    if (n !== null) return Math.abs(Number(n)) <= 100 ? job("ses", n) : { say: "Sesi 0 ile 100 arasında bir sayıya ayarlayabilirim." };
    if (["ac", "artir", "yukselt", "yukari"].includes(rest[0])) return job("ses", "ac");
    if (["kis", "azalt", "dusur", "asagi"].includes(rest[0])) return job("ses", "kis");
    if (["kapat", "sessiz", "sustur", "sifir"].includes(rest[0])) return job("ses", "0");
    return { say: "Sesi nasıl ayarlayayım? Örnek: <code>/pc ses 40</code>, <code>/pc ses aç</code>, <code>/pc ses kıs</code>" };
  }
  if (["muzik", "medya", "sarki", "video"].includes(first)) {
    if (["sonraki", "gec", "ileri", "atla"].includes(rest[0])) return job("medya", "sonraki");
    if (["onceki", "geri"].includes(rest[0])) return job("medya", "onceki");
    return job("medya", "oynat");   // durdur, devam, oynat: hepsi aynı tuş
  }
  if (["ac", "baslat", "calistir"].includes(first)) {
    const what = raw.replace(/^\S+\s*/, "").trim();   // bağlantının büyük-küçük harfi bozulmasın
    return what ? job("ac", what.slice(0, 300)) : { say: "Neyi açayım? Örnek: <code>/pc aç spotify</code>" };
  }
  if (["yardim", "komutlar", "help"].includes(first)) return { say: PC_HELP };
  if (first === "uygulamalar") return job("uygulamalar");
  if (first === "dosyalar") return job("dosyalar");
  if (first === "dosya") {
    const n = Number.parseInt(rest[0], 10);
    return Number.isInteger(n) && n > 0 ? job("dosya", String(n)) : job("dosyalar");
  }
  if (/^https?:\/\//i.test(raw)) return job("ac", raw.slice(0, 300));
  return { say: tail || first ? `Bunu bilgisayarda nasıl yapacağımı bilmiyorum.\n\n${PC_HELP}` : PC_HELP };
}

const SETUP_CAPTION = [
  "🖥 Bilgisayarını bağlamak için:",
  "1. Python yüklü değilse python.org/downloads adresinden kur. Kurulumun ilk ekranında \"Add python.exe to PATH\" kutusunu işaretle.",
  "2. Bu dosyayı bilgisayarına indir ve çift tıkla. (Telegram \"zararlı olabilir\" diye sorarsa yine de aç.)",
  "3. Açılan siyah pencerede \"Kuruldu\" yazısını görünce bitti. Bilgisayar her açıldığında Jarvis kendiliğinden çalışır.",
  "",
  "Dosya 1 saat geçerli ve yalnızca bir kez kullanılabilir. İçinde bu bilgisayarı sana bağlayan tek kullanımlık kod var, başkasıyla paylaşma.",
].join("\n");

// Eşleştirme dosyasını hazırlar: GitHub'daki programın içine tek kullanımlık kodu yazar.
export function injectPairing(source, origin, code) {
  const line = `PAIRING = "${origin}#${code}"`;
  const out = String(source ?? "").replace(/^PAIRING = ""/m, line);
  return out.includes(line) ? out : null;
}

async function pairReply(ctx) {
  const { code } = await ctx.pc.call("pair");
  const origin = ctx.origin ?? "";
  const source = await ctx.pc.file().catch(() => null);
  const file = origin && source ? injectPairing(source, origin, code) : null;
  if (file && await ctx.sendDocument?.("jarvis_pc.py", file, SETUP_CAPTION)) {
    return "📎 Kurulum dosyasını gönderdim. Bilgisayarında aç ve dosyanın altındaki adımları izle.";
  }
  return [
    "🖥 Bilgisayarını bağlamak için:",
    `1. Programı indir: <a href="https://github.com/${esc(ctx.repo ?? "")}/raw/main/${PC_FILE}">jarvis_pc.py</a> ve çift tıkla.`,
    `2. Senden eşleştirme metni isteyince şunu yapıştır: <code>${esc(origin)}#${code}</code>`,
    "Metin 1 saat geçerli, başkasıyla paylaşma.",
  ].join("\n");
}

// "/pc" komutu
export async function cmdPc(args, ctx) {
  if (!ctx.pc) return "🖥 Bilgisayar bağlantısı bu kurulumda açık değil. <b>Botu kur</b> iş akışını yeniden çalıştırmak gerekiyor.";
  const p = parsePc(args);
  if (p.say) return p.say;
  if (p.local === "pair") return pairReply(ctx);
  if (p.local === "unpair") {
    const r = await ctx.pc.call("unpair");
    return r.paired === false
      ? "🖥 Zaten bağlı bir bilgisayar yok."
      : "🖥 Bilgisayarın bağlantısını kaldırdım. Program artık komut almayacak; tamamen silmek için bilgisayarda dosyayı yeniden açıp <b>kaldir</b> yazabilirsin.";
  }
  const r = await ctx.pc.call("send", p.job);
  if (!r.paired) return NOT_PAIRED;
  if (!r.online) return OFFLINE;
  if (r.timeout) return "🖥 İşi bilgisayara ilettim ama henüz cevap gelmedi. Biraz sonra sonucu yazar.";
  return r.reply ? esc(r.reply) : "";
}

async function telegramSend(env, text) {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error("bilgisayar mesajı gönderilemedi", err?.message);
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const bearer = (request) => /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";

// Tek bir bilgisayarın bağlantısını tutan Durable Object. Bağlantı "hibernation" ile tutulur:
// bilgisayar boşta beklerken ücretsiz plandan süre harcanmaz.
export class PcHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.waiting = new Map();
    this.wait = WAIT_MS;
    this.slowWait = SLOW_WAIT_MS;
    // Programın 30 saniyede bir gönderdiği "ping"e Cloudflare uyandırmadan "pong" der.
    if (typeof WebSocketRequestResponsePair !== "undefined" && state.setWebSocketAutoResponse) {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }
  }

  // "pc": bilgisayardaki program, "app": telefondaki Jarvis uygulaması
  sockets(tag = "pc") {
    return this.state.getWebSockets?.(tag) ?? [];
  }

  closeAll(code, reason, tag = "pc") {
    for (const ws of this.sockets(tag)) {
      try { ws.close(code, reason); } catch { /* zaten kapalı */ }
    }
  }

  async authorized(request) {
    const token = bearer(request);
    const hash = await this.state.storage.get("token");
    return Boolean(token && hash && (await sha256(token)) === hash);
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith("/internal/")) return json(await this.internal(path.slice(10), await request.json().catch(() => ({}))));
      if (path === "/pc/pair" && request.method === "POST") return await this.pair(request);
      if (path === "/pc/connect") return await this.connect(request);
      if (path === "/pc/upload" && request.method === "POST") return await this.upload(request);
      if (path === "/panel/live") return await this.live(request);
    } catch (err) {
      console.error("bilgisayar isteği işlenemedi", err?.message);
      return json({ error: "Jarvis'te bir hata oldu, biraz sonra yeniden dener misin?" }, 500);
    }
    return json({ error: "yok" }, 404);
  }

  // Botun kendi çağrıları (dışarıdan erişilemez: worker yalnızca /pc/pair, /pc/connect ve /pc/upload'ı buraya yönlendirir)
  async internal(op, body) {
    const storage = this.state.storage;
    if (op === "pair") {
      const code = pairCode();
      await storage.put("pair", { code: cleanCode(code), exp: Date.now() + PAIR_TTL_MS, tries: 0 });
      return { code };
    }
    if (op === "unpair") {
      const had = Boolean(await storage.get("token"));
      await storage.delete("token");
      this.closeAll(4001, "bağlantı kaldırıldı");
      return { paired: had };
    }
    // Panelin verileri için kısa süreli depo (KV'nin günlük yazma ve listeleme sınırlarını harcamasın)
    if (op === "cget") {
      const hit = await storage.get(`cache:${body.name}`);
      return hit && hit.exp > Date.now() ? { value: hit.value } : {};
    }
    if (op === "cput") {
      await storage.put(`cache:${body.name}`, { value: body.value, exp: Date.now() + Number(body.ttl) * 1000 });
      return { ok: true };
    }
    // Bir şey değişti (yeni mesaj, harcama, hatırlatma): panelin önbelleği silinir, açık uygulamalar yenilenir.
    if (op === "notify") {
      await storage.delete("cache:data");
      this.broadcast({ tip: "yenile" });
      return { ok: true };
    }
    // Ana ekrandaki uygulamaya giriş kodu (iPhone'da uygulamanın Safari'den ayrı bir hafızası var)
    if (op === "lcode") {
      const code = pairCode();
      await storage.put("login", { code: cleanCode(code), exp: Date.now() + LOGIN_TTL_MS, tries: 0 });
      return { code };
    }
    if (op === "lcheck") {
      const pending = await storage.get("login");
      if (!pending || pending.exp < Date.now()) return { ok: false, expired: true };
      if (cleanCode(body.code) !== pending.code) {
        pending.tries += 1;
        if (pending.tries >= PAIR_TRIES) await storage.delete("login");
        else await storage.put("login", pending);
        return { ok: false };
      }
      await storage.delete("login");
      return { ok: true };
    }
    if (op === "vapid") return { publicKey: (await this.vapid()).publicKey };
    if (op === "pushsub") {
      const sub = body.sub;
      if (!sub || !trustedEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false };
      const subs = ((await storage.get("subs")) ?? []).filter((x) => x.endpoint !== sub.endpoint);
      subs.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } });
      await storage.put("subs", subs.slice(-MAX_SUBS));
      return { ok: true };
    }
    if (op === "pushclear") {
      await storage.delete("subs");
      this.closeAll(4001, "bağlantı yenilendi", "app");
      return { ok: true };
    }
    if (op === "pushunsub") {
      const subs = (await storage.get("subs")) ?? [];
      await storage.put("subs", subs.filter((x) => x.endpoint !== body.endpoint));
      return { ok: true };
    }
    if (op === "push") {
      const subs = (await storage.get("subs")) ?? [];
      if (!subs.length) return { sent: 0 };
      const vapid = await this.vapid();
      const data = { title: String(body.title ?? "Jarvis").slice(0, 80), body: String(body.body ?? "").slice(0, 400), url: "/panel" };
      const results = await Promise.all(subs.map((sub) => sendPush(sub, data, vapid, PUSH_SUBJECT, this.pushFetch ?? fetch).catch(() => 0)));
      const alive = subs.filter((_, i) => results[i] !== 404 && results[i] !== 410);   // silinmiş abonelikler bırakılır
      if (alive.length !== subs.length) await storage.put("subs", alive);
      return { sent: results.filter((r) => r >= 200 && r < 300).length };
    }
    if (op === "status") {
      return { paired: Boolean(await storage.get("token")), online: this.sockets().length > 0 };
    }
    if (op === "send") {
      if (!(await storage.get("token"))) return { paired: false };
      const ws = this.sockets().at(-1);
      if (!ws) return { paired: true, online: false };
      const id = crypto.randomUUID().slice(0, 8);
      const reply = new Promise((resolve) => {
        const timer = setTimeout(() => { this.waiting.delete(id); resolve(null); }, ["ekran"].includes(body.is) ? this.slowWait : this.wait);
        this.waiting.set(id, (text) => { clearTimeout(timer); this.waiting.delete(id); resolve(text); });
      });
      try {
        ws.send(JSON.stringify({ id, is: String(body.is ?? ""), arg: String(body.arg ?? "") }));
      } catch {
        this.waiting.get(id)?.(null);
        return { paired: true, online: false };
      }
      const text = await reply;
      return text === null ? { paired: true, online: true, timeout: true } : { paired: true, online: true, reply: text };
    }
    return { error: "bilinmeyen iş" };
  }

  async pair(request) {
    const storage = this.state.storage;
    const body = await request.json().catch(() => ({}));
    const pending = await storage.get("pair");
    if (!pending || pending.exp < Date.now()) {
      return json({ error: "Bu eşleştirme kodunun süresi dolmuş. Telegram'da /pc bağla yazıp yeni dosyayı aç." }, 410);
    }
    if (cleanCode(body.code) !== pending.code) {
      pending.tries += 1;
      if (pending.tries >= PAIR_TRIES) await storage.delete("pair");
      else await storage.put("pair", pending);
      return json({ error: "Eşleştirme kodu yanlış. Telegram'da /pc bağla yazıp yeni dosyayı aç." }, 403);
    }
    const token = newToken();
    await storage.put("token", await sha256(token));
    await storage.put("announce", true);
    await storage.delete("pair");
    this.closeAll(4001, "yeni bilgisayar bağlandı");   // tek bilgisayar: eskisi düşer
    return json({ token });
  }

  async connect(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket bekleniyordu" }, 426);
    if (!(await this.authorized(request))) return json({ error: "yetkisiz" }, 401);
    this.closeAll(4000, "yeni bağlantı");   // aynı bilgisayar yeniden bağlandıysa eski bağlantı bırakılır
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], ["pc"]);
    this.broadcast({ tip: "pc", online: true });
    if (await this.state.storage.get("announce")) {
      await this.state.storage.delete("announce");
      await telegramSend(this.env, "🖥 Bilgisayarın Jarvis'e bağlandı. Denemek için: <code>/pc</code> ya da \"bilgisayarı kilitle\". Bütün komutlar: <code>/pc yardım</code>");
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") {
      try { ws.send("pong"); } catch { /* kapandı */ }
      return;
    }
    let data;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    if (!data?.id || !(this.state.getTags?.(ws) ?? ["pc"]).includes("pc")) return;
    const text = String(data.metin ?? "").slice(0, 3500);
    const resolve = this.waiting.get(data.id);
    if (resolve) resolve(text);
    else if (text) await telegramSend(this.env, esc(text));   // geç gelen cevap: doğrudan sohbete
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* zaten kapalı */ }
    if ((this.state.getTags?.(ws) ?? []).includes("pc") && this.sockets("pc").filter((s) => s !== ws).length === 0) {
      this.broadcast({ tip: "pc", online: false });
    }
  }

  // Açık Jarvis uygulamalarına haber verir
  broadcast(data) {
    const text = JSON.stringify(data);
    for (const ws of this.sockets("app")) {
      try { ws.send(text); } catch { /* kapanmış */ }
    }
  }

  async vapid() {
    let keys = await this.state.storage.get("vapid");
    if (!keys) {
      keys = await makeVapidKeys();
      await this.state.storage.put("vapid", keys);
    }
    return keys;
  }

  // Telefondaki uygulamanın canlı bağlantısı. Tarayıcı başlık ekleyemediği için anahtar adresle gelir (?k=).
  async live(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket bekleniyordu" }, 426);
    const key = new URL(request.url).searchParams.get("k") ?? "";
    const real = await this.env.KV?.get(PANEL_KEY);
    if (!key || !real || key !== real) return json({ error: "yetkisiz" }, 401);
    const open = this.sockets("app");
    for (const ws of open.slice(0, Math.max(0, open.length - 4))) {   // en fazla 5 açık uygulama
      try { ws.close(4000, "çok bağlantı"); } catch { /* kapalı */ }
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], ["app"]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketError() { /* program yeniden bağlanır */ }

  // Ekran görüntüsü ve dosyalar: program dosyayı buraya yollar, buradan Telegram'a gider.
  async upload(request) {
    if (!(await this.authorized(request))) return json({ error: "yetkisiz" }, 401);
    const size = Number(request.headers.get("Content-Length") ?? 0);
    if (size > MAX_UPLOAD) return json({ error: "Dosya çok büyük (en fazla 45 MB)." }, 413);
    const kind = request.headers.get("X-Tur") === "foto" ? "foto" : "dosya";
    const name = decodeURIComponent(request.headers.get("X-Ad") ?? "dosya").slice(0, 120) || "dosya";
    const caption = decodeURIComponent(request.headers.get("X-Not") ?? "").slice(0, 900);
    const blob = await request.blob();
    if (blob.size > MAX_UPLOAD) return json({ error: "Dosya çok büyük (en fazla 45 MB)." }, 413);
    const asPhoto = kind === "foto" && blob.size <= MAX_PHOTO;
    const form = new FormData();
    form.append("chat_id", String(this.env.TELEGRAM_CHAT_ID));
    if (caption) form.append("caption", caption);
    form.append(asPhoto ? "photo" : "document", blob, name);
    const res = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${asPhoto ? "sendPhoto" : "sendDocument"}`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("bilgisayardan gelen dosya gönderilemedi", res.status);
      return json({ error: "Telegram dosyayı kabul etmedi." }, 502);
    }
    return json({ ok: true });
  }
}

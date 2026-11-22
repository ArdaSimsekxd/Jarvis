// Bilgisayarı yöneten Jarvis. Windows'ta arka planda çalışan küçük program (pc/jarvis_pc.py), bu dosyadaki
// Durable Object'e (PcHub) WebSocket ile bağlanır. Bot bir iş gönderir, program yapar ve sonucu yazar.
// Program bağlantıyı kendisi açtığı için modemde ayar gerekmez. Yalnızca programın tanıdığı işler yapılır.
import { esc, isQuiet, plain, trParts } from "./logic.js";
import { PANEL_KEY } from "./panel.js";
import { makeVapidKeys, sendPush, trustedEndpoint } from "./webpush.js";

export const PC_FILE = "pc/jarvis_pc.py";
const CHAT_LOG_MAX = 60;      // panel sohbetinde saklanan en fazla mesaj
const CHAT_TEXT_MAX = 4000;
const PAIR_TTL_MS = 60 * 60 * 1000;      // eşleştirme kodu 1 saat geçerli
const PAIR_TRIES = 10;                   // bu kadar yanlış denemeden sonra kod silinir
const WAIT_MS = 9000;                    // bilgisayarın cevabı için beklenen süre (Telegram cevabı 30 saniyeye sığmalı)
const SLOW_WAIT_MS = 15000;              // ekran görüntüsü gibi yavaş işler için
const SLOW_JOBS = ["ekran", "kamera", "konum", "getir"];
const FILE_TTL_MS = 60 * 60 * 1000;      // panele gelen dosya 1 saat indirilebilir
const FILE_CHUNK = 1024 * 1024;          // Durable Object'te 1 MB'lık parçalar halinde durur
const MAX_FILES = 3;                     // panelde aynı anda en fazla 3 dosya
// Tarayıcıda açılabilecek türler; geri kalanı her zaman indirilir (HTML gibi dosyalar panelin adresinde çalışmasın)
const INLINE_TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", txt: "text/plain; charset=utf-8" };
const DOWNLOAD_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint", zip: "application/zip",
  mp3: "audio/mpeg", mp4: "video/mp4", m4a: "audio/mp4",
};
const LOST_EVERY_MS = 15 * 60 * 1000;    // kayıp modu: bilgisayar açık kaldıkça 15 dakikada bir rapor
const LOST_DELAY_MS = 10 * 1000;         // bilgisayar bağlanınca ilk rapor 10 saniye sonra (program otursun)
const LOST_WAIT_MS = 40 * 1000;          // kayıp modunda kamera ve konum için beklenen süre
const MAX_UPLOAD = 45 * 1024 * 1024;     // Telegram botları en fazla 50 MB dosya gönderebilir
const MAX_PHOTO = 9 * 1024 * 1024;       // fotoğraf olarak gönderilebilecek en büyük boy (üstü dosya olarak gider)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32 harf: karışan 0/O, 1/I yok
const LOGIN_TTL_MS = 15 * 60 * 1000;     // uygulamaya giriş kodu 15 dakika geçerli
const MAX_SUBS = 5;                      // bildirim alabilecek en fazla cihaz
const FIND_MS = 3 * 60 * 1000;           // telefonumu bul: 3 dakika boyunca
const FIND_EVERY_MS = 20 * 1000;         // 20 saniyede bir bildirim
const FIND_RINGS = 9;
const PUSH_SUBJECT = "https://github.com/ArdaSimsekxd/Jarvis";   // bildirim servislerine verilen iletişim adresi
export const WHERE_HEADER = "X-Jarvis-Yer";   // worker'ın bağlantıya eklediği yaklaşık yer (IP'ye göre)

export const PC_HELP = [
  "🖥 <b>Bilgisayar komutları</b>",
  "<code>/pc</code> açık mı, pil durumu",
  "<code>/pc kilitle</code> · <code>/pc uyku</code>",
  "<code>/pc kapat</code> · <code>/pc yeniden</code> (1 dakika sonra; vazgeçmek için <code>/pc iptal</code>)",
  "<code>/pc ekran</code> ekran görüntüsü · <code>/pc kamera</code> kameradan fotoğraf · <code>/pc konum</code> bilgisayar nerede",
  "<code>/pc kayıp</code> kayıp/çalıntı modu: fotoğraf, konum, kilit; 15 dakikada bir tekrar. Bulunca <code>/pc bulundu</code>",
  "<code>/pc ses 40</code> · <code>/pc ses aç</code> · <code>/pc ses kıs</code> · <code>/pc ses kapat</code>",
  "<code>/pc müzik durdur</code> · <code>/pc müzik sonraki</code> · <code>/pc müzik önceki</code>",
  "<code>/pc aç spotify</code> uygulama, site ya da bağlantı açar; <code>/pc uygulamalar</code> tanıdıklarım",
  "<code>/pc dosyalar</code> İndirilenler ve Masaüstündeki son dosyalar; <code>/pc dosya 3</code> 3. dosyayı gönderir",
  "<code>/pc getir devre raporu</code> adına benzeyen dosyayı bilgisayarda bulur, panele gönderir",
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
  if (["kamera", "webcam", "selfie"].includes(first)) return job("kamera");
  if (["konum", "nerede", "neresi", "yer"].includes(first)) return job("konum");
  if (["kayip", "calindi", "caldilar", "kayboldu", "kaybettim"].includes(first)) {
    return ["kapat", "bitir", "dur", "iptal", "kaldir"].includes(rest[0]) ? { local: "found" } : { local: "lost" };
  }
  if (["bulundu", "buldum"].includes(first)) return { local: "found" };
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
  if (["getir", "gonder", "bulgetir"].includes(first)) {
    const what = raw.replace(/^\S+\s*/, "").trim();   // Türkçe harfler bozulmasın
    return what ? job("getir", what.slice(0, 120)) : { say: "Hangi dosyayı getireyim? Örnek: <code>/pc getir devre raporu</code>" };
  }
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
  if (p.local === "lost") {
    const r = await ctx.pc.call("lost", { on: true });
    if (!r.paired) return NOT_PAIRED;
    return [
      r.online
        ? "🚨 <b>Kayıp modu açık.</b> Şimdi ekran görüntüsü, kamera fotoğrafı ve konum gönderip bilgisayarı kilitliyorum."
        : "🚨 <b>Kayıp modu açık.</b> Bilgisayar şu an bağlı değil. Açılıp internete bağlandığı anda ekran görüntüsü, kamera fotoğrafı ve konum gönderip kilitleyeceğim.",
      "Bilgisayar açık kaldıkça bunu 15 dakikada bir tekrarlarım. Bulunca: <code>/pc bulundu</code>",
      "",
      "Çalındıysa önce polise başvur, bu bilgileri onlara verebilirsin. Bilgisayarı kendin geri almaya çalışma.",
    ].join("\n");
  }
  if (p.local === "found") {
    const r = await ctx.pc.call("lost", { on: false });
    return r.stopped ? "✅ Kayıp modunu kapattım. Bilgisayar artık kendiliğinden fotoğraf ve konum göndermeyecek." : "Kayıp modu zaten kapalı.";
  }
  const r = await ctx.pc.call("send", p.job);
  if (!r.paired) return NOT_PAIRED;
  if (!r.online) return OFFLINE;
  if (r.timeout) return "🖥 İşi bilgisayara ilettim ama henüz cevap gelmedi. Biraz sonra sonucu yazar.";
  const text = r.reply ? esc(r.reply) : "";
  if (p.job.is !== "konum") return text;
  const line = placeLine((await ctx.pc.call("where")).where);
  return [text, line].filter(Boolean).join("\n");
}

// Worker'ın gördüğü bağlantı bilgisi: IP ve Cloudflare'in IP'den tahmin ettiği şehir. Yalnızca sahibine yazılır, loglanmaz.
export function placeOf(request) {
  const cf = request.cf ?? {};
  const num = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    ip: request.headers.get("CF-Connecting-IP") ?? null, city: cf.city ?? null, region: cf.region ?? null,
    country: cf.country ?? null, lat: num(cf.latitude), lon: num(cf.longitude), org: cf.asOrganization ?? null,
  };
}

export function parseWhere(header) {
  try {
    const w = JSON.parse(decodeURIComponent(header ?? ""));
    if (!w || typeof w !== "object") return null;
    const str = (v) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 80));
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const out = { ip: str(w.ip), city: str(w.city), region: str(w.region), country: str(w.country), lat: num(w.lat), lon: num(w.lon), org: str(w.org) };
    return out.ip || out.city || out.country ? out : null;
  } catch {
    return null;
  }
}

// "Rapor.PDF" -> { type, inline }
export function fileType(name) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(String(name ?? ""))?.[1]?.toLowerCase() ?? "";
  if (INLINE_TYPES[ext]) return { type: INLINE_TYPES[ext], inline: true };
  return { type: DOWNLOAD_TYPES[ext] ?? "application/octet-stream", inline: false };
}

export function contentDisposition(name, inline) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const hhmm = (ms) => { const p = trParts(ms); return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`; };

// "🌐 İnternet bağlantısına göre ..." satırı (Telegram HTML)
export function placeLine(w) {
  if (!w) return null;
  const names = [...new Set([w.city, w.region].filter(Boolean))];
  const place = [...names, w.country].filter(Boolean).join(", ") || "yer bilinmiyor";
  const map = w.lat !== null && w.lon !== null && w.lat !== undefined && w.lon !== undefined
    ? ` · <a href="https://maps.google.com/?q=${w.lat},${w.lon}">haritada</a>` : "";
  const extra = [w.org, w.ip ? `IP ${w.ip}` : null].filter(Boolean).map(esc).join(" · ");
  const when = w.at ? ` (${hhmm(w.at)} bağlantısı)` : "";
  return `🌐 İnternet bağlantısına göre, şehir düzeyinde: ${esc(place)}${map}${extra ? `\n${extra}` : ""}${when}`;
}

async function telegramSend(env, text, fetcher = fetch, extra = {}) {
  try {
    await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }),
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
    this.lostWait = LOST_WAIT_MS;
    this.lostEvery = LOST_EVERY_MS;
    this.lostDelay = LOST_DELAY_MS;
    this.findEvery = FIND_EVERY_MS;
    this.fileChunk = FILE_CHUNK;
    // Programın 30 saniyede bir gönderdiği "ping"e Cloudflare uyandırmadan "pong" der.
    if (typeof WebSocketRequestResponsePair !== "undefined" && state.setWebSocketAutoResponse) {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }
  }

  // "pc": bilgisayardaki program, "app": telefondaki Jarvis uygulaması
  tg(text, extra) {
    return telegramSend(this.env, text, this.tgFetch ?? fetch, extra);
  }

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
      if (path.startsWith("/panel/file/") && request.method === "GET") return await this.serveFile(request);
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
    // Panel sohbetinin ortak geçmişi: telefondaki ve bilgisayardaki panel aynı konuşmayı görür
    if (op === "chatget") return { log: (await storage.get("chatlog")) ?? [] };
    if (op === "chatadd") {
      const items = (Array.isArray(body.items) ? body.items : [])
        .filter((x) => (x?.w === "me" || x?.w === "bot") && typeof x.t === "string" && x.t)
        .map((x) => ({ w: x.w, t: x.t.slice(0, CHAT_TEXT_MAX), at: Date.now() }));
      const log = [...((await storage.get("chatlog")) ?? []), ...items].slice(-CHAT_LOG_MAX);
      await storage.put("chatlog", log);
      return { ok: true, count: log.length };
    }
    if (op === "chatclear") {
      await storage.delete("chatlog");
      return { ok: true };
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
      return this.pushAll({ title: String(body.title ?? "Jarvis").slice(0, 80), body: String(body.body ?? "").slice(0, 400), url: "/panel" });
    }
    // Telefonumu bul: birkaç dakika boyunca aralıklarla sesli bildirim gönderilir (Durable Object alarmıyla).
    if (op === "find") {
      const subs = (await storage.get("subs")) ?? [];
      if (!subs.length) return { subs: 0, sent: 0 };
      await storage.put("find", { until: Date.now() + FIND_MS, n: 0, next: Date.now() });
      const sent = await this.findRing();
      return { subs: subs.length, sent };
    }
    if (op === "findstop") {
      const had = Boolean(await storage.get("find"));
      await storage.delete("find");
      await this.schedule();
      if (had) this.broadcast({ tip: "bulundu" });
      return { stopped: had };
    }
    // Kayıp/çalıntı modu: bilgisayar bağlı kaldıkça aralıklarla fotoğraf, konum ve kilit
    if (op === "lost") {
      const paired = Boolean(await storage.get("token"));
      if (!body.on) {
        const had = Boolean((await storage.get("lost"))?.on);
        await storage.delete("lost");
        await this.schedule();
        return { paired, stopped: had };
      }
      if (!paired) return { paired: false };
      const online = this.sockets().length > 0;
      await storage.put("lost", { on: true, since: Date.now(), n: 0, next: online ? Date.now() + 1000 : null });
      await this.schedule();
      return { paired, online };
    }
    if (op === "files") {
      const files = await this.liveFiles();
      return { files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, exp: f.exp, url: `/panel/file/${f.id}?t=${f.token}` })) };
    }
    if (op === "where") return { where: (await storage.get("where")) ?? null, lost: Boolean((await storage.get("lost"))?.on) };
    if (op === "status") {
      return { paired: Boolean(await storage.get("token")), online: this.sockets().length > 0 };
    }
    if (op === "send") {
      if (!(await storage.get("token"))) return { paired: false };
      return { paired: true, ...(await this.ask(body, SLOW_JOBS.includes(body.is) ? this.slowWait : this.wait)) };
    }
    return { error: "bilinmeyen iş" };
  }

  // Bağlı bilgisayara bir iş gönderir ve cevabını bekler: { online, reply } | { online, timeout } | { online: false }
  async ask(job, ms) {
    const ws = this.sockets().at(-1);
    if (!ws) return { online: false };
    const id = crypto.randomUUID().slice(0, 8);
    const reply = new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve(null); }, ms);
      this.waiting.set(id, (text) => { clearTimeout(timer); this.waiting.delete(id); resolve(text); });
    });
    try {
      ws.send(JSON.stringify({ id, is: String(job.is ?? ""), arg: String(job.arg ?? "") }));
    } catch {
      this.waiting.get(id)?.(null);
      return { online: false };
    }
    const text = await reply;
    return text === null ? { online: true, timeout: true } : { online: true, reply: text };
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
    await this.connected(request);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Bilgisayar bağlandı: yaklaşık yeri saklanır (kayıp modu için), kayıp modu açıksa rapor kurulur.
  async connected(request) {
    const storage = this.state.storage;
    this.broadcast({ tip: "pc", online: true });
    const where = parseWhere(request.headers.get(WHERE_HEADER));
    if (where) await storage.put("where", { ...where, at: Date.now() });
    if (await storage.get("announce")) {
      await storage.delete("announce");
      await this.tg("🖥 Bilgisayarın Jarvis'e bağlandı. Denemek için: <code>/pc</code> ya da \"bilgisayarı kilitle\". Bütün komutlar: <code>/pc yardım</code>");
    }
    const lost = await storage.get("lost");
    if (lost?.on) {
      lost.next = Date.now() + this.lostDelay;
      await storage.put("lost", lost);
      await this.schedule();
    }
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
    else if (text) await this.tg(esc(text));   // geç gelen cevap: doğrudan sohbete
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

  // Bütün kayıtlı cihazlara bildirim. Silinmiş abonelikler (404/410) bırakılır.
  async pushAll(data) {
    const storage = this.state.storage;
    const subs = (await storage.get("subs")) ?? [];
    if (!subs.length) return { sent: 0 };
    const vapid = await this.vapid();
    const results = await Promise.all(subs.map((sub) => sendPush(sub, data, vapid, PUSH_SUBJECT, this.pushFetch ?? fetch).catch(() => 0)));
    const alive = subs.filter((_, i) => results[i] !== 404 && results[i] !== 410);
    if (alive.length !== subs.length) await storage.put("subs", alive);
    return { sent: results.filter((r) => r >= 200 && r < 300).length };
  }

  // Telefonumu bul: bir bildirim gönderir, süre bitmediyse bir sonrakini kurar.
  async findRing() {
    const storage = this.state.storage;
    const find = await storage.get("find");
    if (!find) return 0;
    if (Date.now() > find.until || find.n >= FIND_RINGS) {
      await storage.delete("find");
      return 0;
    }
    find.n += 1;
    find.next = Date.now() + this.findEvery;   // sonuncudan sonraki uyanışta silinir
    await storage.put("find", find);
    const { sent } = await this.pushAll({
      title: "📍 Buradayım!",
      body: find.n === 1 ? "Telefonunu arıyorsun. Bulunca bu bildirime dokun." : `Hâlâ buradayım (${find.n}/${FIND_RINGS}). Bulunca dokun.`,
      url: "/panel?bul=1",
      tag: `bul-${find.n}`,
      bul: true,
    });
    await this.schedule();
    return sent;
  }

  // Kayıp modu raporu: ekran görüntüsü, kamera fotoğrafı, konum, sonra kilit. Bilgisayar bağlı değilse
  // bir sonraki bağlantıyı bekler. Fotoğrafları program kendisi gönderir; konum ve kilit cevabı burada toplanır.
  async lostRun() {
    const storage = this.state.storage;
    const lost = await storage.get("lost");
    if (!lost?.on) return false;
    if (!this.sockets().length) {
      lost.next = null;
      await storage.put("lost", lost);
      return false;
    }
    lost.n += 1;
    lost.next = Date.now() + this.lostEvery;
    await storage.put("lost", lost);
    const time = hhmm(Date.now());
    const steps = [];
    for (const [job, ms] of [[{ is: "ekran" }, this.slowWait], [{ is: "kamera", arg: `📷 Kayıp modu · ${time}` }, this.lostWait],
      [{ is: "konum" }, this.lostWait], [{ is: "kilitle" }, this.wait]]) {
      const r = await this.ask(job, ms);
      steps.push(r);
      if (!r.online) break;
    }
    const [screen, camera, place, lock] = steps;
    const quiet = isQuiet(Date.now());
    const lines = [`🚨 <b>Kayıp modu</b> · ${lost.n}. rapor · ${time}`];
    const said = (r) => (r?.reply ? esc(r.reply) : null);
    lines.push(said(place) ?? "📍 Bilgisayardan konum gelmedi.");
    const ip = placeLine(await storage.get("where"));
    if (ip) lines.push(ip);
    for (const r of [screen, camera]) if (r?.reply && !lines.includes(esc(r.reply))) lines.push(esc(r.reply));   // fotoğraf gönderilemediyse nedeni
    lines.push(lock?.reply ? "🔒 Bilgisayarı kilitledim." : "🔒 Kilitleme cevabı gelmedi.");
    lines.push("", steps.length < 4 ? "Bilgisayarın bağlantısı koptu; yeniden bağlanınca devam ederim." : "15 dakika sonra yeniden bakarım. Bulunca: <code>/pc bulundu</code>");
    await this.tg(lines.join("\n"), quiet ? { disable_notification: true } : {});
    await this.pushAll({ title: "🚨 Kayıp modu", body: `${lost.n}. rapor geldi (${time}). Ayrıntı Telegram'da.`, url: "/panel", tag: "kayip" });
    return true;
  }

  // Durable Object'in tek alarmı: telefonumu bul ve kayıp modu sırası gelen işi yapar, sonra en yakın işe kurulur.
  async alarm() {
    const storage = this.state.storage;
    const now = Date.now() + 500;
    const find = await storage.get("find");
    if (find?.next !== null && find?.next !== undefined && find.next <= now) await this.findRing();
    const lost = await storage.get("lost");
    if (lost?.on && lost.next !== null && lost.next !== undefined && lost.next <= now) await this.lostRun();
    await this.schedule();
  }

  async schedule() {
    const storage = this.state.storage;
    const find = await storage.get("find");
    const lost = await storage.get("lost");
    const times = [find?.next, lost?.on ? lost.next : null].filter((t) => typeof t === "number");
    if (times.length) await storage.setAlarm?.(Math.min(...times));
    else await storage.deleteAlarm?.();
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
    const tur = request.headers.get("X-Tur");
    const kind = tur === "foto" ? "foto" : tur === "panel" ? "panel" : "dosya";
    const name = decodeURIComponent(request.headers.get("X-Ad") ?? "dosya").slice(0, 120) || "dosya";
    if (kind === "panel") return this.storeFile(name, request);
    const caption = decodeURIComponent(request.headers.get("X-Not") ?? "").slice(0, 900);
    const blob = await request.blob();
    if (blob.size > MAX_UPLOAD) return json({ error: "Dosya çok büyük (en fazla 45 MB)." }, 413);
    const asPhoto = kind === "foto" && blob.size <= MAX_PHOTO;
    const form = new FormData();
    form.append("chat_id", String(this.env.TELEGRAM_CHAT_ID));
    if (caption) form.append("caption", caption);
    if (isQuiet(Date.now())) form.append("disable_notification", "true");   // gece sessiz
    form.append(asPhoto ? "photo" : "document", blob, name);
    const res = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${asPhoto ? "sendPhoto" : "sendDocument"}`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("bilgisayardan gelen dosya gönderilemedi", res.status);
      return json({ error: "Telegram dosyayı kabul etmedi." }, 502);
    }
    return json({ ok: true });
  }

  // ---------- panele gelen dosyalar ----------

  // Süresi geçenleri siler, kalanları döndürür
  async liveFiles() {
    const storage = this.state.storage;
    const files = (await storage.get("files")) ?? [];
    const now = Date.now();
    const keep = files.filter((f) => f.exp > now);
    if (keep.length !== files.length) {
      for (const f of files.filter((x) => x.exp <= now)) await this.dropChunks(f);
      await storage.put("files", keep);
    }
    return keep;
  }

  async dropChunks(f) {
    for (let i = 0; i < f.n; i += 1) await this.state.storage.delete(`file:${f.id}:${i}`);
  }

  // Bilgisayardan gelen dosya parça parça saklanır; açık uygulamalara ve telefona haber gider.
  async storeFile(name, request) {
    const storage = this.state.storage;
    const files = await this.liveFiles();
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const meta = { id, token: newToken(), name, size: 0, n: 0, ...fileType(name), exp: Date.now() + FILE_TTL_MS };
    let parts = [], filled = 0;
    const flush = async () => {
      if (!filled) return;
      const out = new Uint8Array(filled);
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }
      await storage.put(`file:${id}:${meta.n}`, out);
      meta.n += 1;
      parts = [];
      filled = 0;
    };
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Dosya boş." }, 400);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      meta.size += value.length;
      if (meta.size > MAX_UPLOAD) {
        await this.dropChunks(meta);
        return json({ error: "Dosya çok büyük (en fazla 45 MB)." }, 413);
      }
      let rest = value;
      while (rest.length) {
        const take = Math.min(rest.length, this.fileChunk - filled);
        parts.push(rest.subarray(0, take));
        filled += take;
        rest = rest.subarray(take);
        if (filled === this.fileChunk) await flush();
      }
    }
    await flush();
    files.push(meta);
    while (files.length > MAX_FILES) await this.dropChunks(files.shift());
    await storage.put("files", files);
    this.broadcast({ tip: "dosya", name });
    await this.pushAll({ title: "📄 Dosya hazır", body: `${name} panelde, 1 saat içinde indirebilirsin.`, url: "/panel", tag: "dosya" });
    return json({ ok: true });
  }

  // GET /panel/file/<id>?t=<anahtar>: anahtar yalnızca panelin (gizli anahtarla açılan) verisinde görünür.
  async serveFile(request) {
    const url = new URL(request.url);
    const id = url.pathname.split("/")[3] ?? "";
    const token = url.searchParams.get("t") ?? "";
    const meta = (await this.liveFiles()).find((f) => f.id === id);
    if (!meta || !token || token !== meta.token) {
      return new Response("Bu dosyanın süresi dolmuş ya da bağlantı yanlış. Bilgisayardan yeniden iste.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const storage = this.state.storage;
    let i = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (i >= meta.n) { controller.close(); return; }
        const chunk = await storage.get(`file:${meta.id}:${i}`);
        i += 1;
        if (!chunk) { controller.error(new Error("dosya parçası yok")); return; }
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": meta.type, "Content-Length": String(meta.size), "Content-Disposition": contentDisposition(meta.name, meta.inline),
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex",
      },
    });
  }
}

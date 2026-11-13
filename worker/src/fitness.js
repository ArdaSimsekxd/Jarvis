// Fitness randevuları: okulun rezervasyon sitesinin (LibreBooking) resmi API'siyle randevu alır.
// Giriş ekranındaki güvenlik kodu aşılmaz; yalnızca sitenin programlar için açtığı kapı kullanılır.
import { WEEKDAYS, WEEKDAY_KEYS, dateKey, esc, parseDay, plain, trParts, trToMs } from "./logic.js";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export const STATE_KEY = "fit:state";
export const WINDOW_DAYS = 14;        // site en fazla 2 hafta sonrasına randevu veriyor
export const DEFAULT_MINUTES = 90;    // bitiş yazılmazsa
const OPEN_MARGIN = MIN;               // sitenin saatiyle küçük farklar ilk denemeyi boşa düşürmesin
const MAX_RULES = 14;
const FAST_TRIES = 4;                 // ilk denemeler yarım saat arayla, sonrakiler 6 saatte bir
const RETRY_FAST = 30 * MIN;
const RETRY_SLOW = 6 * 60 * MIN;

const two = (n) => String(n).padStart(2, "0");
const hm = (minutes) => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
const toMin = (text) => { const [h, m] = text.split(":").map(Number); return h * 60 + m; };

export const USAGE = [
  "🏋️ <b>Fitness randevusu</b>",
  "",
  "<code>/fitness salı 13:00-14:30</code> — her salı benim yerime al",
  "<code>/fitness 27.11 13:00-14:30</code> — sadece o gün (ya da: <code>yarın</code>, <code>bu cuma</code>)",
  "<code>/fitness</code> — isteklerim ve alınan randevular",
  "<code>/fitness sil 1</code> — listedeki 1 numaralı isteği kaldır",
  "<code>/fitness iptal 17.11</code> — o günün randevusunu iptal et, o günü atla",
  "<code>/fitness dene</code> — alınamayanları şimdi yeniden dene",
].join("\n");

// "13:00-14:30", "13.00 - 14.30", "13" -> { start: "13:00", end: "14:30" }; anlaşılmazsa null
function parseRange(text) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?:\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?)?$/.exec(text.trim());
  if (!m) return null;
  const start = +m[1] * 60 + +(m[2] ?? 0);
  const end = m[3] === undefined ? start + DEFAULT_MINUTES : +m[3] * 60 + +(m[4] ?? 0);
  if (+m[1] > 23 || +(m[2] ?? 0) > 59 || +(m[4] ?? 0) > 59 || end <= start || end > 24 * 60) return null;
  return { start: hm(start), end: hm(end) };
}

// "/fitness" komutunun devamını çözer.
export function parseFitness(args, nowMs) {
  const s = String(args ?? "").trim();
  if (!s) return { action: "list" };
  const [first, ...restWords] = s.split(/\s+/);
  const word = plain(first);
  const rest = restWords.join(" ");
  if (["yardim", "help"].includes(word)) return { action: "help" };
  if (["dene", "tekrar"].includes(word)) return { action: "retry" };
  if (word === "sil") {
    const n = Number.parseInt(rest, 10);
    return Number.isInteger(n) && n >= 1 ? { action: "remove", n } : { error: "format" };
  }
  if (word === "iptal") {
    const day = rest ? parseDay(rest, nowMs) : null;
    return day === null ? { error: "format" } : { action: "cancel", date: dateKey(day) };
  }

  // "her salı 13:00", "bu salı 13:00", "salı 13:00", "27.11 13:00", "yarın 13:00"
  let words = [first, ...restWords];
  let once = false;
  if (plain(words[0]) === "her") words = words.slice(1);
  else if (["bu", "tek", "sadece"].includes(plain(words[0]))) { once = true; words = words.slice(1); }
  if (words.length < 2) return { error: "format" };
  const dayWord = plain(words[0]);
  const range = parseRange(words.slice(1).join(" "));
  if (!range) return { error: "format" };

  const wd = WEEKDAY_KEYS.indexOf(dayWord);
  if (wd >= 0 && !once) return { action: "add", rule: { wd, ...range } };

  let day = parseDay(dayWord, nowMs);
  if (day === null) return { error: "format" };
  if (wd >= 0 && day + toMin(range.start) * MIN <= nowMs) day += 7 * DAY;   // "bu cuma" ama saat geçmiş: haftaya
  if (day + toMin(range.start) * MIN <= nowMs) return { error: "past" };
  return { action: "add", rule: { date: dateKey(day), ...range } };
}

function slotFor(date, rule) {
  const [y, m, d] = date.split("-").map(Number);
  const [sh, sm] = rule.start.split(":").map(Number);
  const [eh, em] = rule.end.split(":").map(Number);
  return { key: `${date} ${rule.start}-${rule.end}`, date, start: rule.start, end: rule.end, startMs: trToMs(y, m, d, sh, sm), endMs: trToMs(y, m, d, eh, em) };
}

// İsteklerin önümüzdeki günlere düşen randevuları (henüz başlamamış olanlar), zaman sırasıyla.
export function wantedSlots(rules, nowMs, days = WINDOW_DAYS) {
  const p = trParts(nowMs);
  const today = trToMs(p.y, p.m, p.d);
  const out = new Map();
  for (let i = 0; i <= days; i += 1) {
    const dayMs = today + i * DAY;
    const date = dateKey(dayMs);
    const wd = trParts(dayMs).wd;
    for (const rule of rules) {
      if (rule.date ? rule.date !== date : rule.wd !== wd) continue;
      const slot = slotFor(date, rule);
      if (slot.startMs > nowMs && slot.startMs <= nowMs + days * DAY - OPEN_MARGIN) out.set(slot.key, slot);
    }
  }
  return [...out.values()].sort((a, b) => a.startMs - b.startMs);
}

// Şimdi alınması gereken randevular: açılmış, alınmamış, atlanmamış ve bekleme süresi dolmuş olanlar.
export function dueSlots(state, nowMs) {
  return wantedSlots(state.rules, nowMs).filter((slot) => {
    const s = state.slots[slot.key];
    return !s || (!s.ref && !s.skip && (s.next ?? 0) <= nowMs);
  });
}

const sortRules = (rules) => rules.sort((a, b) =>
  (a.date ? 1 : 0) - (b.date ? 1 : 0)
  || (a.date ?? "").localeCompare(b.date ?? "")
  || ((a.wd ?? 0) + 6) % 7 - ((b.wd ?? 0) + 6) % 7      // pazartesi başta
  || a.start.localeCompare(b.start));

export function slotLabel(slot) {
  const [y, m, d] = slot.date.split("-").map(Number);
  return `${WEEKDAYS[trParts(trToMs(y, m, d)).wd]} ${two(d)}.${two(m)} ${slot.start}–${slot.end}`;
}

function ruleLabel(rule) {
  return rule.date ? slotLabel(slotFor(rule.date, rule)) : `${WEEKDAYS[rule.wd]} ${rule.start}–${rule.end}`;
}

export async function loadState(kv) {
  try {
    const s = JSON.parse((await kv.get(STATE_KEY)) ?? "null");
    if (s && Array.isArray(s.rules)) return { rules: s.rules, slots: s.slots ?? {}, accessoryId: s.accessoryId ?? null };
  } catch { /* bozuk kayıt: boş başla */ }
  return { rules: [], slots: {}, accessoryId: null };
}

const saveState = (kv, state) => kv.put(STATE_KEY, JSON.stringify(state));

// Geçmişte kalan kayıtları temizler; bir şey değiştiyse true döner.
function prune(state, nowMs) {
  const today = dateKey(nowMs);
  let changed = false;
  for (const key of Object.keys(state.slots)) {
    if (key.slice(0, 10) < today) { delete state.slots[key]; changed = true; }
  }
  const keep = state.rules.filter((r) => !r.date || slotFor(r.date, r).startMs > nowMs);
  if (keep.length !== state.rules.length) { state.rules = keep; changed = true; }
  return changed;
}

// ---- Sitenin API'si -------------------------------------------------------------------------

class BookedError extends Error {
  constructor(kind, detail = "") { super(kind); this.kind = kind; this.detail = detail; }
}

const iso = (date, time) => `${date}T${time}:00+0300`;
const parseIso = (text) => Date.parse(String(text ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

async function call(cfg, method, path, { body, session } = {}) {
  let res;
  try {
    res = await cfg.fetch(`${cfg.url.replace(/\/+$/, "")}/Services/index.php/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(session ? { "X-Booked-SessionToken": session.token, "X-Booked-UserId": String(session.userId) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BookedError("network");
  }
  let data = null;
  try { data = await res.json(); } catch { /* gövde boş ya da JSON değil */ }
  return { status: res.status, ok: res.ok, data };
}

async function openSession(cfg) {
  // Bu adresin sonunda / olmamalı.
  const r = await call(cfg, "POST", "Authentication/Authenticate", { body: { username: cfg.username, password: cfg.password } });
  if (r.status >= 500 || (!r.data && !r.ok && r.status !== 401)) throw new BookedError("network", `HTTP ${r.status}`);
  if (!r.data?.isAuthenticated || !r.data.sessionToken) throw new BookedError("auth");
  const session = { token: r.data.sessionToken, userId: r.data.userId };
  return {
    userId: session.userId,
    // "fitness number" ekipmanı: sitede kişi sayısı böyle bildiriliyor.
    async accessoryId() {
      const res = await call(cfg, "GET", "Accessories/", { session });
      const list = Array.isArray(res.data?.accessories) ? res.data.accessories : [];
      const hit = list.find((a) => plain(a.name).includes("fitness")) ?? (list.length === 1 ? list[0] : null);
      return hit?.id ?? null;
    },
    // Bu aralıkta zaten bende olan randevular (elle alınmış olabilir): başlangıç anı -> kayıt numarası
    async mine(fromMs, toMs) {
      const q = (ms) => encodeURIComponent(new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+0000"));
      const res = await call(cfg, "GET", `Reservations/?userId=${session.userId}&resourceId=${cfg.resourceId}&startDateTime=${q(fromMs)}&endDateTime=${q(toMs)}`, { session });
      if (!res.ok || !Array.isArray(res.data?.reservations)) throw new BookedError(res.status === 401 ? "auth" : "network", `HTTP ${res.status}`);
      const out = new Map();
      for (const x of res.data.reservations) {
        if (x.userId !== undefined && String(x.userId) !== String(session.userId)) continue;
        if (x.resourceId !== undefined && String(x.resourceId) !== String(cfg.resourceId)) continue;
        const at = parseIso(x.startDate);
        if (!Number.isNaN(at) && x.referenceNumber) out.set(at, x.referenceNumber);
      }
      return out;
    },
    async create(slot, accessoryId) {
      // Bu adresin sonunda / olmalı.
      const res = await call(cfg, "POST", "Reservations/", {
        session,
        body: {
          resourceId: cfg.resourceId,
          userId: session.userId,
          startDateTime: iso(slot.date, slot.start),
          endDateTime: iso(slot.date, slot.end),
          title: "",
          description: "",
          accessories: accessoryId == null ? [] : [{ accessoryId, quantityRequested: 1 }],
        },
      });
      if (res.ok && res.data?.referenceNumber) return { ref: res.data.referenceNumber, pending: !!res.data.isPendingApproval };
      if (res.status === 401) throw new BookedError("auth");
      const errors = Array.isArray(res.data?.errors) ? res.data.errors : [];
      throw new BookedError("rejected", String(errors[0] ?? res.data?.message ?? `HTTP ${res.status}`).slice(0, 300));
    },
    async remove(ref) {
      const res = await call(cfg, "DELETE", `Reservations/${encodeURIComponent(ref)}`, { session });
      return res.ok;
    },
    async close() {
      try { await call(cfg, "POST", "Authentication/SignOut", { body: { userId: session.userId, sessionToken: session.token } }); } catch { /* önemli değil */ }
    },
  };
}

function reason(err) {
  if (err?.kind === "auth") return "Siteye giriş yapamadım. Şifren değiştiyse GitHub'daki kaydı güncellemek gerekiyor.";
  if (err?.kind === "network") return "Siteye ulaşamadım.";
  if (err?.kind === "rejected") return `Sitenin cevabı: ${esc(err.detail)}`;
  if (err?.kind === "accessory") return "Sitede kişi sayısı alanını (fitness number) bulamadım.";
  return "Beklenmeyen bir sorun çıktı.";
}

function markFailed(state, slot, err, nowMs) {
  const fails = (state.slots[slot.key]?.fails ?? 0) + 1;
  // Şifre yanlışsa sık denemek hesabı kilitleyebilir: doğrudan uzun aralığa geç.
  const wait = err?.kind === "auth" || fails > FAST_TRIES ? RETRY_SLOW : RETRY_FAST;
  state.slots[slot.key] = { fails, next: nowMs + wait };
  return fails;
}

// Zamanı gelen randevuları alır, durumu günceller. Dönen liste: { slot, ok, pending?, text?, first? }
export async function bookDue(ctx, state) {
  const due = dueSlots(state, ctx.now);
  if (!due.length) return [];
  const failAll = (err) => due.map((slot) => ({ slot, ok: false, text: reason(err), first: markFailed(state, slot, err, ctx.now) === 1 }));
  let session;
  try {
    session = await openSession(ctx.booked);
  } catch (err) {
    return failAll(err);
  }
  const results = [];
  try {
    // Önce bende ne var ona bakılır; okunamazsa aynı saate ikinci randevu almamak için hiç alınmaz.
    let mine;
    try {
      mine = await session.mine(due[0].startMs - MIN, due[due.length - 1].endMs);
    } catch (err) {
      return failAll(err);
    }
    if (state.accessoryId == null) state.accessoryId = await session.accessoryId().catch(() => null);
    for (const slot of due) {
      if (mine.has(slot.startMs)) {
        state.slots[slot.key] = { ref: mine.get(slot.startMs) };
        results.push({ slot, ok: true, existing: true });
        continue;
      }
      try {
        // Kişi sayısı bildirilmeden randevu alınmaz: elle yapılanla aynı olsun.
        if (state.accessoryId == null) throw new BookedError("accessory");
        const made = await session.create(slot, state.accessoryId);
        state.slots[slot.key] = { ref: made.ref };
        results.push({ slot, ok: true, pending: made.pending });
      } catch (err) {
        results.push({ slot, ok: false, text: reason(err), first: markFailed(state, slot, err, ctx.now) === 1 });
      }
    }
  } finally {
    await session.close();
  }
  return results;
}

function resultLines(results) {
  return results.map((r) => {
    if (r.ok && r.existing) return `✅ <b>${esc(slotLabel(r.slot))}</b> zaten sende`;
    if (r.ok) return `✅ <b>${esc(slotLabel(r.slot))}</b> alındı${r.pending ? " (onay bekliyor)" : ""}`;
    return `⚠️ <b>${esc(slotLabel(r.slot))}</b> alınamadı. ${r.text}`;
  });
}

// Zamanlayıcıdan çağrılır: açılan randevuları alır, sonucu haber verir.
export async function runFitness(ctx) {
  if (!ctx.booked) return [];
  const state = await loadState(ctx.kv);
  if (!state.rules.length && !Object.keys(state.slots).length) return [];
  const pruned = prune(state, ctx.now);
  const results = await bookDue(ctx, state);
  if (pruned || results.length) await saveState(ctx.kv, state);
  // Aynı randevu için başarısızlık yalnızca ilk seferde bildirilir; sonraki denemeler sessizdir.
  const news = results.filter((r) => (r.ok ? !r.existing : r.first));
  if (news.length) {
    const failed = news.some((r) => !r.ok);
    await ctx.send(`🏋️ <b>Fitness</b>\n${resultLines(news).join("\n")}${failed ? "\n\nAralıklarla yeniden deneyeceğim. Vazgeçmek için: <code>/fitness iptal gün</code>" : ""}`);
  }
  return results;
}

function listText(state, nowMs) {
  if (!state.rules.length) return USAGE;
  const lines = ["🏋️ <b>Fitness istekleri</b>"];
  state.rules.forEach((r, i) => lines.push(`${i + 1}. ${r.date ? "" : "Her "}${esc(ruleLabel(r))}`));
  const slots = wantedSlots(state.rules, nowMs);
  if (slots.length) {
    lines.push("", "<b>Önümüzdeki 2 hafta</b>");
    for (const slot of slots) {
      const s = state.slots[slot.key];
      const mark = s?.ref ? "✅" : s?.skip ? "🚫" : s?.fails ? "⚠️" : "⏳";
      const note = s?.ref ? "" : s?.skip ? " (atlanacak)" : s?.fails ? " (alınamadı, yeniden denenecek)" : " (alınıyor)";
      lines.push(`${mark} ${esc(slotLabel(slot))}${note}`);
    }
  }
  lines.push("", "Kaldırmak için: <code>/fitness sil 1</code>", "Bir günü atlamak için: <code>/fitness iptal 17.11</code>");
  return lines.join("\n");
}

// "/fitness" komutu
export async function cmdFitness(args, ctx) {
  if (!ctx.booked) return "Fitness randevusu henüz kurulmamış. GitHub'da <code>BOOKED_USERNAME</code> ve <code>BOOKED_PASSWORD</code> kayıtlarını ekleyip <b>Botu kur</b> iş akışını bir kez çalıştırmak gerekiyor.";
  const cmd = parseFitness(args, ctx.now);
  if (cmd.error === "past") return "Bu zaman geçmişte kalıyor. İleri bir gün ve saat yazar mısın?";
  if (cmd.error || cmd.action === "help") return USAGE;

  const state = await loadState(ctx.kv);
  prune(state, ctx.now);

  if (cmd.action === "list") return listText(state, ctx.now);

  if (cmd.action === "remove") {
    if (cmd.n > state.rules.length) return state.rules.length ? `1 ile ${state.rules.length} arasında bir numara yaz. Liste için: /fitness` : "Kaldırılacak istek yok.";
    const [gone] = state.rules.splice(cmd.n - 1, 1);
    await saveState(ctx.kv, state);
    return `🗑 Kaldırıldı: ${gone.date ? "" : "Her "}<b>${esc(ruleLabel(gone))}</b>\nAlınmış randevular duruyor. Birini iptal etmek için: <code>/fitness iptal 17.11</code>`;
  }

  if (cmd.action === "cancel") {
    const slots = state.rules
      .filter((r) => (r.date ? r.date === cmd.date : r.wd === trParts(slotFor(cmd.date, r).startMs).wd))
      .map((r) => slotFor(cmd.date, r));
    if (cmd.date < dateKey(ctx.now)) return "Bu gün geçmişte kalıyor.";
    if (!slots.length) return "O gün için bir isteğin yok. Liste için: /fitness";
    const booked = slots.filter((s) => state.slots[s.key]?.ref);
    const lines = [];
    let session = null;
    if (booked.length) {
      try { session = await openSession(ctx.booked); } catch { /* aşağıda bildirilir */ }
    }
    for (const slot of slots) {
      const ref = state.slots[slot.key]?.ref;
      if (!ref) lines.push(`🚫 <b>${esc(slotLabel(slot))}</b> atlanacak`);
      else if (session && await session.remove(ref).catch(() => false)) lines.push(`🚫 <b>${esc(slotLabel(slot))}</b> iptal edildi`);
      else lines.push(`⚠️ <b>${esc(slotLabel(slot))}</b> sitede iptal edilemedi, siteden kendin iptal etmen gerekiyor. Ben o günü yeniden almayacağım.`);
      state.slots[slot.key] = { skip: true };
    }
    if (session) await session.close();
    state.rules = state.rules.filter((r) => r.date !== cmd.date);   // tek seferlik istek tamamen kalkar
    await saveState(ctx.kv, state);
    return lines.join("\n");
  }

  if (cmd.action === "retry") {
    for (const s of Object.values(state.slots)) if (s.fails) s.next = 0;
  } else {
    const same = (r) => r.start === cmd.rule.start && r.end === cmd.rule.end && (cmd.rule.date ? r.date === cmd.rule.date : !r.date && r.wd === cmd.rule.wd);
    if (!state.rules.some(same)) {
      if (state.rules.length >= MAX_RULES) return `En fazla ${MAX_RULES} istek olabilir. Önce /fitness ile bakıp birkaçını kaldır.`;
      state.rules.push(cmd.rule);
      sortRules(state.rules);
    }
    // Daha önce atlanan bir gün yeniden istendiyse atlamayı kaldır.
    for (const slot of wantedSlots([cmd.rule], ctx.now, 366)) if (state.slots[slot.key]?.skip) delete state.slots[slot.key];
  }

  const results = await bookDue(ctx, state);
  await saveState(ctx.kv, state);
  const retry = cmd.action === "retry";
  const head = retry ? "🏋️ <b>Fitness</b>" : `🏋️ ${cmd.rule.date ? "" : "Her "}<b>${esc(ruleLabel(cmd.rule))}</b> için randevu alacağım.`;
  if (!results.length) {
    return `${head}\n${retry ? "Şu an alınacak randevu yok." : "Randevular en fazla 2 hafta öncesinden açılıyor; açılınca alıp haber veririm."}`;
  }
  const tail = [];
  if (results.some((r) => !r.ok)) tail.push("Alınamayanları aralıklarla yeniden deneyeceğim.");
  if (!retry && !cmd.rule.date) tail.push("Sonraki haftalar açıldıkça kendiliğinden alınır.");
  return [head, "", ...resultLines(results), ...(tail.length ? ["", ...tail] : [])].join("\n");
}

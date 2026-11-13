import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMessage, runSchedule, sendDueReminders } from "../src/index.js";
import {
  dateKey, dueJobs, firstWord, fmtDateTime, formatGrades, formatMenu, formatPending, formatSchedule,
  parseCommand, parseDay, parseReminder, parseSchedule, trToMs,
} from "../src/logic.js";

// Cuma 13.11.2026 10:00 Türkiye saati
const NOW = trToMs(2026, 11, 13, 10, 0);
const at = (r) => fmtDateTime(r.at);

test("komut ayrıştırma", () => {
  assert.deepEqual(parseCommand("/yemek"), { command: "yemek", args: "" });
  assert.deepEqual(parseCommand("/Yemek@guns0911bot  yarın "), { command: "yemek", args: "yarın" });
  assert.deepEqual(parseCommand("/hatırlat 15:00 x"), { command: "hatirlat", args: "15:00 x" });
  assert.equal(parseCommand("merhaba"), null);
});

test("gün ifadeleri", () => {
  assert.equal(dateKey(parseDay("", NOW)), "2026-11-13");
  assert.equal(dateKey(parseDay("Yarın", NOW)), "2026-11-14");
  assert.equal(dateKey(parseDay("cuma", NOW)), "2026-11-13");
  assert.equal(dateKey(parseDay("ÇARŞAMBA", NOW)), "2026-11-18");
  assert.equal(dateKey(parseDay("17.11", NOW)), "2026-11-17");
  assert.equal(parseDay("bilmem", NOW), null);
  // gece yarısından hemen sonra da doğru gün (UTC'de hâlâ önceki gün)
  assert.equal(dateKey(parseDay("", trToMs(2026, 11, 14, 0, 30))), "2026-11-14");
});

test("hatırlatma zamanları", () => {
  assert.equal(at(parseReminder("15:00 kütüphane", NOW)), "Cuma 13.11 15:00");
  assert.equal(at(parseReminder("09:00 erken", NOW)), "Cumartesi 14.11 09:00"); // saat geçmiş: yarın
  assert.equal(at(parseReminder("yarın 09.30 mail", NOW)), "Cumartesi 14.11 09:30");
  assert.equal(at(parseReminder("pazartesi 14:00 toplantı", NOW)), "Pazartesi 16.11 14:00");
  assert.equal(at(parseReminder("cuma 09:00 x", NOW)), "Cuma 20.11 09:00"); // bugün cuma ama saat geçmiş
  assert.equal(at(parseReminder("20.11 18:00 kira", NOW)), "Cuma 20.11 18:00");
  assert.equal(at(parseReminder("30 dk çay", NOW)), "Cuma 13.11 10:30");
  assert.equal(at(parseReminder("2 saat ara", NOW)), "Cuma 13.11 12:00");
  assert.equal(at(parseReminder("3 gün kontrol", NOW)), "Pazartesi 16.11 10:00");
  assert.equal(parseReminder("yarın 09:30 hocaya mail at", NOW).text, "hocaya mail at");
  assert.equal(parseReminder("bugün 09:00 x", NOW).error, "past");
  assert.equal(parseReminder("25:00 x", NOW).error, "format");
  assert.equal(parseReminder("bir şeyler", NOW).error, "format");
  assert.equal(parseReminder("15:00", NOW).error, "format"); // metin yok
  assert.equal(parseReminder("", NOW).error, "empty");
});

test("menü metni", () => {
  const menu = { days: { "2026-11-13": ["Mercimek <çorbası>", "Tavuk sote"], "2026-11-14": { "Öğle": ["Pilav"], "Akşam": ["Makarna"] } } };
  assert.equal(formatMenu(menu, NOW), "🍽 <b>Cuma, 13.11.2026</b>\n\n• Mercimek &lt;çorbası&gt;\n• Tavuk sote");
  assert.match(formatMenu(menu, parseDay("yarın", NOW)), /<b>Öğle<\/b>\n• Pilav\n\n<b>Akşam<\/b>\n• Makarna/);
  assert.equal(formatMenu(menu, parseDay("pazar", NOW)), null);
  const labeled = { days: { "2026-11-13": { "Çorba": "Yayla Çorba", "Ana yemek": "Tas Kebabı", "Kalori": 942, "Vejetaryen kalori": 810 } } };
  assert.equal(formatMenu(labeled, NOW),
    "🍽 <b>Cuma, 13.11.2026</b>\n\n• <b>Çorba:</b> Yayla Çorba\n• <b>Ana yemek:</b> Tas Kebabı\n\n<i>942 kcal · vejetaryen menü 810 kcal</i>");
});

test("gerçek menü dosyası okunabiliyor", async () => {
  const { readFile } = await import("node:fs/promises");
  const menu = JSON.parse(await readFile(new URL("../../data/menu.json", import.meta.url), "utf8"));
  for (const key of Object.keys(menu.days)) {
    const [y, m, d] = key.split("-").map(Number);
    assert.match(formatMenu(menu, trToMs(y, m, d, 12)), /Ana yemek/, key);
  }
});

// Sahte KV: liste anahtar sırasıyla döner, metadata taşır.
function fakeKv() {
  const store = new Map();
  const values = new Map();
  return {
    store,
    async put(key, value, opts) { store.set(key, opts?.metadata); values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { store.delete(key); values.delete(key); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name) }));
      return { keys, list_complete: true };
    },
  };
}

function fakeCtx(now = NOW) {
  const sent = [];
  let n = 0;
  const ctx = {
    now, chatId: "42", kv: fakeKv(), sent,
    send: async (t) => { sent.push(t); return true; },
    fetchMenu: async () => ({ days: { "2026-11-13": ["Kuru fasulye", "Pilav"] } }),
    id: () => `id${n++}`,
  };
  return ctx;
}
const msg = (text, chat = 42) => ({ chat: { id: chat }, text });

test("uçtan uca: yemek, hatırlatma ekle, listele, sil, gönder", async () => {
  const ctx = fakeCtx();

  await handleMessage(msg("/yemek"), ctx);
  assert.match(ctx.sent.pop(), /Cuma, 13\.11\.2026[\s\S]*Kuru fasulye/);
  await handleMessage(msg("/yemek yarın"), ctx);
  assert.match(ctx.sent.pop(), /Bu gün için menü bilgisi yok/);

  await handleMessage(msg("/hatirlat 15:00 kütüphane <kitabı>"), ctx);
  assert.match(ctx.sent.pop(), /Cuma 13\.11 15:00<\/b> için hatırlatacağım:\nkütüphane &lt;kitabı&gt;/);
  await handleMessage(msg("/hatirlat 30 dk çay"), ctx);
  await handleMessage(msg("/hatirlat yarın 09:00 mail"), ctx);
  ctx.sent.length = 0;

  await handleMessage(msg("/hatirlatmalar"), ctx);
  const list = ctx.sent.pop();
  assert.ok(list.indexOf("çay") < list.indexOf("kütüphane") && list.indexOf("kütüphane") < list.indexOf("mail"));

  await handleMessage(msg("/sil 2"), ctx);
  assert.match(ctx.sent.pop(), /Silindi[\s\S]*kütüphane/);
  await handleMessage(msg("/sil 9"), ctx);
  assert.match(ctx.sent.pop(), /1 ile 2 arasında/);

  // 10:20'de hiçbiri gelmez; 10:31'de sadece çay; ertesi gün mail
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 20 * 60000 }), 0);
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 31 * 60000 }), 1);
  assert.equal(ctx.sent.pop(), "⏰ <b>Hatırlatma</b>\nçay");
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 31 * 60000 }), 0); // tekrar gönderilmez
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 24 * 3600000 }), 1);
  assert.equal(ctx.kv.store.size, 0);
});

test("gönderilemeyen hatırlatma silinmez", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/hatirlat 5 dk x"), ctx);
  assert.equal(await sendDueReminders({ ...ctx, now: NOW + 6 * 60000, send: async () => false }), 0);
  assert.equal(ctx.kv.store.size, 1);
});

test("yabancı sohbetlere cevap verilmez; bilinmeyen komut ve düz yazı yönlendirilir", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/yemek", 999), ctx);
  assert.equal(ctx.sent.length, 0);
  await handleMessage(msg("selam"), ctx);
  assert.match(ctx.sent.pop(), /\/yardim/);
  await handleMessage(msg("/falan"), ctx);
  assert.match(ctx.sent.pop(), /bilmiyorum/);
  await handleMessage(msg("/yardim"), ctx);
  assert.match(ctx.sent.pop(), /Jarvis komutları/);
  await handleMessage(msg("/hatirlat dün 10:00 x"), ctx);
  assert.match(ctx.sent.pop(), /geçmişte/);
});

test("zamanlayıcı: hangi işin zamanı geldi", () => {
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 7, 50)), ["canvas"]);
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 7, 52)), []);
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 8, 0)), ["canvas", "morning"]);
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 9, 4)), ["morning"]);   // 08:00 kaçtıysa sonradan yakalanır
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 12, 4)), []);
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 21, 0)), ["canvas", "evening"]);
  assert.deepEqual(dueJobs(trToMs(2026, 11, 13, 23, 58)), ["evening"]);
  assert.deepEqual(dueJobs(trToMs(2026, 11, 14, 0, 2)), []);
});

test("zamanlayıcı: işleri başlatır, sabah özeti günde bir kez", async () => {
  const calls = [];
  const at = (hh, mm, day = 13) => {
    ctx.now = trToMs(2026, 11, day, hh, mm);
    return runSchedule(ctx);
  };
  const ctx = fakeCtx();
  assert.deepEqual(await runSchedule(ctx), []);   // anahtar yoksa (dispatch yok) hiçbir şey yapmaz

  ctx.dispatch = async (job) => { calls.push(job); return 204; };
  assert.deepEqual(await at(7, 50), ["canvas"]);
  assert.deepEqual(await at(8, 0), ["canvas", "morning"]);
  assert.deepEqual(await at(8, 2), []);
  assert.deepEqual(await at(8, 10), ["canvas"]);
  assert.deepEqual(await at(8, 0, 14), ["canvas", "morning"]);   // ertesi gün yeniden
  assert.deepEqual(calls, ["canvas", "canvas", "morning", "canvas", "canvas", "morning"]);
  assert.deepEqual(ctx.sent, []);
});

test("zamanlayıcı: başlatamazsa yeniden dener, anahtar bozuksa günde bir kez uyarır", async () => {
  const ctx = fakeCtx();
  let status = 500;
  ctx.dispatch = async () => status;
  const at = (hh, mm) => {
    ctx.now = trToMs(2026, 11, 13, hh, mm);
    return runSchedule(ctx);
  };
  assert.deepEqual(await at(8, 0), []);
  assert.deepEqual(ctx.sent, []);                 // geçici hata: uyarı yok
  status = 401;
  assert.deepEqual(await at(8, 2), []);
  assert.deepEqual(await at(8, 4), []);
  assert.equal(ctx.sent.length, 1);               // tek uyarı
  assert.match(ctx.sent[0], /DISPATCH_TOKEN/);
  status = 204;
  assert.deepEqual(await at(8, 6), ["morning"]);  // özet kaçmadı, sonraki turda gitti
});

test("zamanlayıcı: akşam önizlemesi günde bir kez; iş akışı henüz yoksa (404) uyarı yok", async () => {
  const ctx = fakeCtx();
  const calls = [];
  let eveningStatus = 404;
  ctx.dispatch = async (job) => { calls.push(job); return job === "evening" ? eveningStatus : 204; };
  const at = (hh, mm) => { ctx.now = trToMs(2026, 11, 13, hh, mm); return runSchedule(ctx); };
  assert.deepEqual(await at(21, 0), ["canvas"]);
  assert.deepEqual(ctx.sent, []);
  eveningStatus = 204;
  assert.deepEqual(await at(21, 2), ["evening"]);
  assert.deepEqual(await at(21, 4), []);
  assert.deepEqual(await at(21, 10), ["canvas"]);
});

const PROGRAM = `
# örnek
Pazartesi 10:00-11:45 EE452 F0C04
Cuma 14:00-15:45 OHS401 A/S13
Cuma 9.00 - 11.45 GLB300 A/S22
cuma 14:00-15:45 EE454 F0C04 uygulama
bozuk satır
`;

test("ders programı", () => {
  const s = parseSchedule(PROGRAM);
  assert.deepEqual(Object.keys(s), ["1", "5"]);
  assert.equal(formatSchedule(s, NOW),
    "📚 <b>Cuma, 13.11.2026</b>\n\n• <b>09:00–11:45</b> GLB300 · A/S22\n• <b>14:00–15:45</b> EE454 · F0C04 (uygulama)\n• <b>14:00–15:45</b> OHS401 · A/S13");
  assert.equal(formatSchedule(s, NOW + 24 * 3600000), null);
  assert.deepEqual(parseSchedule(undefined), {});
});

// Canvas'ın verdiği biçimde örnek veri
const COURSES = [
  { id: 1, course_code: "EE452", enrollments: [{ type: "student", computed_current_score: 87.456, computed_current_grade: "BA" }] },
  { id: 2, name: "Fizik <2>", enrollments: [{ type: "student", computed_current_score: null }] },
];
const asg = (name, due, extra = {}) => ({ id: name, name, due_at: due, published: true, html_url: `https://c/${name}`, ...extra });
const ASSIGNMENTS = new Map([
  [1, [
    asg("Bugün", "2026-11-13T20:59:00Z"),                                               // Cuma 23:59
    asg("Yarın", "2026-11-14T09:00:00Z"),
    asg("Teslim edildi", "2026-11-15T09:00:00Z", { submission: { submitted_at: "2026-11-12T10:00:00Z" } }),
    asg("Gecikti", "2026-11-11T20:59:00Z", { submission: { missing: true } }),
    asg("Kağıt ödev", "2026-11-11T20:59:00Z", { submission_types: ["on_paper"] }),      // internetten teslim yok: gecikmiş sayılmaz
    asg("Çok eski", "2026-10-01T20:59:00Z", { submission: { missing: true } }),
    asg("Taslak", "2026-11-14T09:00:00Z", { published: false }),
    asg("Tarihsiz", null),
    asg("Lab 1", "2026-11-05T20:59:00Z", { points_possible: 100, submission: { workflow_state: "graded", score: 85, grade: "85", graded_at: "2026-11-10T09:00:00Z" } }),
  ]],
  [2, [
    asg("Haftaya", "2026-11-18T14:00:00Z"),
    asg("Çok uzak", "2027-02-01T14:00:00Z"),
    asg("Quiz", "2026-11-06T20:59:00Z", { points_possible: 20, submission: { workflow_state: "graded", score: 17.5, grade: "B+", graded_at: "2026-11-12T09:00:00Z" } }),
    asg("Muaf", "2026-11-06T20:59:00Z", { submission: { excused: true, grade: "EX" } }),
  ]],
]);

test("bekleyen ödevler", () => {
  const text = formatPending(COURSES, ASSIGNMENTS, NOW);
  assert.equal(text, [
    "📝 <b>Bekleyen ödevler</b>",
    "",
    "⚠️ <b>Gecikenler</b> (teslim edilmemiş)",
    '• <b>Çarşamba 11.11 23:59</b> EE452: <a href="https://c/Gecikti">Gecikti</a>',
    "",
    "📅 <b>Yaklaşanlar</b>",
    '• <b>Bugün 23:59</b> EE452: <a href="https://c/Bugün">Bugün</a>',
    '• <b>Yarın 12:00</b> EE452: <a href="https://c/Yarın">Yarın</a>',
    '• <b>Çarşamba 18.11 17:00</b> Fizik &lt;2&gt;: <a href="https://c/Haftaya">Haftaya</a>',
  ].join("\n"));
  assert.match(formatPending(COURSES, new Map(), NOW), /Bekleyen ödev yok/);
});

test("notlar", () => {
  assert.equal(formatGrades(COURSES, ASSIGNMENTS), [
    "📊 <b>Son notlar</b>",
    '• Fizik &lt;2&gt;: <a href="https://c/Quiz">Quiz</a> → <b>B+ (17.5/20)</b> <i>12.11</i>',
    '• EE452: <a href="https://c/Lab 1">Lab 1</a> → <b>85/100</b> <i>10.11</i>',
    "",
    "🎓 <b>Derslerde güncel durum</b>",
    "• EE452: <b>%87.46 (BA)</b>",
  ].join("\n"));
  assert.match(formatGrades([{ id: 9, name: "X" }], new Map()), /Henüz girilmiş bir not görünmüyor/);
});

test("uçtan uca: /odevler, /notlar, /dersler", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/odevler"), ctx);
  assert.match(ctx.sent.pop(), /Canvas bağlantısı henüz kurulmamış/);
  await handleMessage(msg("/dersler"), ctx);
  assert.match(ctx.sent.pop(), /Ders programı henüz girilmemiş/);

  const asked = [];
  ctx.canvas = async (path) => {
    asked.push(path);
    if (path.startsWith("courses?")) return [...COURSES, { id: 3, name: "Kapalı", access_restricted_by_date: true }];
    if (path.startsWith("courses/2/")) throw new Error("canvas 403");   // bir derse erişilemese de diğeri gösterilir
    return ASSIGNMENTS.get(1);
  };
  ctx.schedule = parseSchedule(PROGRAM);

  await handleMessage(msg("/odevler"), ctx);
  const pending = ctx.sent.pop();
  assert.match(pending, /Bugün 23:59<\/b> EE452/);
  assert.doesNotMatch(pending, /Haftaya/);
  assert.equal(asked.length, 3);   // dersler + erişilebilen 2 dersin ödevleri (kapalı ders sorulmaz)

  await handleMessage(msg("/notlar"), ctx);
  assert.match(ctx.sent.pop(), /Lab 1<\/a> → <b>85\/100<\/b>/);

  await handleMessage(msg("/dersler"), ctx);
  assert.match(ctx.sent.pop(), /Cuma, 13\.11\.2026[\s\S]*GLB300/);
  await handleMessage(msg("/dersler pazartesi"), ctx);
  assert.match(ctx.sent.pop(), /Pazartesi, 16\.11\.2026[\s\S]*EE452 · F0C04/);
  await handleMessage(msg("/dersler yarın"), ctx);
  assert.match(ctx.sent.pop(), /Bu gün ders yok/);

  ctx.canvas = async () => { throw new Error("canvas 500"); };
  await handleMessage(msg("/odevler"), ctx);
  assert.match(ctx.sent.pop(), /Canvas'a şu an ulaşamadım/);
});

test("ders adının ilk kelimesi Canvas'tan bulunur", async () => {
  const courses = [
    { id: 1, course_code: "EE452", name: "EE452 - Digital Signal Processing" },
    { id: 2, course_code: "EE 4005 - 01", name: "2026-2027 Güz EE 4005 Capstone Design I" },
    { id: 3, course_code: "GLB300", name: "Küresel Sorunlar (GLB300)" },
    { id: 4, course_code: "2026F-OHS", name: "OHS401 İş Sağlığı ve Güvenliği" },
    { id: 5, course_code: "EE454", name: "EE454" },
    null,
  ];
  assert.equal(firstWord("EE452", courses), "Digital");
  assert.equal(firstWord("EE4005", courses), "Capstone");   // dönem ve yıl atlanır
  assert.equal(firstWord("GLB300", courses), "Küresel");
  assert.equal(firstWord("OHS401", courses), "İş");         // kod sadece adda geçiyor
  assert.equal(firstWord("EE454", courses), "");            // adı koddan ibaret
  assert.equal(firstWord("MATH101", courses), "");          // Canvas'ta yok
  assert.equal(firstWord("EE45", [{ course_code: "EE452", name: "Yanlış" }, { course_code: "EE45", name: "Doğru Ders" }]), "Doğru");

  // /dersler: ad kodun önüne yazılır, Canvas'a günde bir kez sorulur
  const ctx = fakeCtx();
  ctx.schedule = parseSchedule(PROGRAM);
  let asked = 0;
  ctx.canvas = async () => { asked += 1; return courses; };
  await handleMessage(msg("/dersler"), ctx);
  assert.match(ctx.sent.pop(), /• <b>09:00–11:45<\/b> Küresel GLB300 · A\/S22\n• <b>14:00–15:45<\/b> EE454 · F0C04 \(uygulama\)\n• <b>14:00–15:45<\/b> İş OHS401 · A\/S13/);
  await handleMessage(msg("/dersler pazartesi"), ctx);
  assert.match(ctx.sent.pop(), /Digital EE452 · F0C04/);
  assert.equal(asked, 1);

  // Canvas'a ulaşılamazsa sadece kod gösterilir
  const offline = fakeCtx();
  offline.schedule = parseSchedule(PROGRAM);
  offline.canvas = async () => { throw new Error("canvas 500"); };
  await handleMessage(msg("/dersler pazartesi"), offline);
  assert.match(offline.sent.pop(), /<\/b> EE452 · F0C04/);
});

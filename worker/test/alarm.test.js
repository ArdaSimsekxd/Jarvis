import assert from "node:assert/strict";
import { test } from "node:test";
import { ALARM_KEY, CALL_FAILED, alarmTick, serviceText, cmdAlarm, dueToday, loadAlarm, nextRing } from "../src/alarm.js";
import { toSteps } from "../src/brain.js";
import { handleMessage } from "../src/index.js";
import { trParts, trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 21, 18, 10);   // Cumartesi 21.11.2026 18:10

function fakeKv() {
  const values = new Map();
  return {
    values,
    async put(key, value) { values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { values.delete(key); },
    async list() { return { keys: [], list_complete: true }; },
  };
}

function fakeCtx(now = NOW, { callOk = true } = {}) {
  const sent = [], calls = [];
  return {
    now, chatId: "42", kv: fakeKv(), sent, calls, ai: null,
    send: async (t) => { sent.push(t); return true; },
    call: async (user, text) => { calls.push({ user, text }); return callOk; },
  };
}

const hm = (ms) => { const p = trParts(ms); return `${p.d}.${p.m} ${p.hh}:${String(p.mm).padStart(2, "0")}`; };
const msg = (text, username = "arda") => ({ chat: { id: 42 }, from: { username }, text });

test("/alarm kurar: her gün, hafta içi, tek sefer; saat biçimleri", async () => {
  const ctx = fakeCtx();
  const out = await cmdAlarm("06:00", ctx);
  assert.match(out, /Alarm kuruldu: <b>her gün 06:00<\/b>[\s\S]*İlk çalacağı zaman: <b>Pazar 22\.11 06:00<\/b>/);
  assert.match(out, /CallMeBot[\s\S]*\/alarm test/);
  assert.match(out, /kullanıcı adın yok/, "kullanıcı adı henüz bilinmiyor");
  assert.deepEqual(await loadAlarm(ctx.kv), { time: "06:00", mode: "her", date: null });

  assert.match(await cmdAlarm("hafta içi 7", ctx), /hafta içi her gün 07:00[\s\S]*Pazartesi 23\.11 07:00/);
  assert.match(await cmdAlarm("yarın 06:30", ctx), /22\.11\.2026 06:30 \(tek sefer\)/);
  assert.match(await cmdAlarm("bugün 06:00", ctx), /geçmişte/);
  assert.match(await cmdAlarm("25", ctx), /Saati anlayamadım/);
  assert.match(await cmdAlarm("", ctx), /Alarm: <b>22\.11\.2026 06:30 \(tek sefer\)<\/b>/);
  assert.match(await cmdAlarm("kapat", ctx), /kapatıldı/);
  assert.equal((await loadAlarm(ctx.kv)).time, undefined);
});

test("alarm günleri", () => {
  const sat = trToMs(2026, 11, 21, 5, 0), mon = trToMs(2026, 11, 23, 5, 0);
  assert.equal(dueToday({ time: "06:00", mode: "haftaici" }, sat), null);
  assert.equal(hm(dueToday({ time: "06:00", mode: "haftaici" }, mon)), "23.11 6:00");
  assert.equal(dueToday({ time: "06:00", mode: "tek", date: "2026-11-22" }, sat), null);
  assert.equal(hm(nextRing({ time: "06:00", mode: "her" }, NOW)), "22.11 6:00");
});

test("kullanıcı adı ilk mesajda öğrenilir; test araması onunla yapılır", async () => {
  const ctx = fakeCtx();
  assert.match(await cmdAlarm("test", ctx), /kullanıcı adın yok/);
  assert.equal(ctx.calls.length, 0);
  await handleMessage(msg("/alarm test"), ctx);
  assert.deepEqual(ctx.calls.map((c) => c.user), ["@arda"]);
  assert.match(ctx.sent.at(-1), /Arıyorum/);
  const failing = fakeCtx(NOW, { callOk: false });
  await handleMessage(msg("/alarm test"), failing);
  assert.match(failing.sent.at(-1), /Arama yapılamadı/);

  // servis HTTP 200 dönse de cevabında hata yazıyorsa arama yapılmamış sayılır ve sebebi gösterilir
  const told = fakeCtx();
  told.call = async () => ({ ok: false, info: "User @arda not authorized. Send /start to the bot." });
  await handleMessage(msg("/alarm test"), told);
  assert.match(told.sent.at(-1), /Arama yapılamadı[\s\S]*@arda için[\s\S]*not authorized/);
});

test("saatinde arar, cevap yoksa 2 dakikada bir yazar ve 6 dakikada bir yeniden arar; mesaj gelince susar", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/alarm 06:00"), ctx);
  ctx.sent.length = 0;

  const at = (h, m) => ({ ...ctx, now: trToMs(2026, 11, 22, h, m) });
  assert.equal(await alarmTick(at(5, 58)), null);
  assert.equal(await alarmTick(at(6, 0)), "rang");
  assert.deepEqual(ctx.calls.map((c) => c.user), ["@arda"]);
  assert.match(ctx.calls[0].text, /Günaydın! Saat 06:00/);
  assert.match(ctx.sent[0], /Günaydın![\s\S]*bir şey yaz/);

  assert.equal(await alarmTick(at(6, 2)), "nag");
  assert.equal(await alarmTick(at(6, 4)), "nag");
  assert.equal(ctx.calls.length, 1, "6 dakika dolmadan yeniden aramaz");
  assert.equal(await alarmTick(at(6, 6)), "nag");
  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.sent.length, 4);

  ctx.now = trToMs(2026, 11, 22, 6, 7);
  await handleMessage(msg("uyandım"), ctx);
  assert.match(ctx.sent.at(-1), /Günaydın! Alarmı kapattım/);
  const sentBefore = ctx.sent.length;
  assert.equal(await alarmTick(at(6, 8)), null);
  assert.equal(await alarmTick(at(6, 10)), null);
  assert.equal(ctx.sent.length, sentBefore, "sustu");
  assert.equal(ctx.calls.length, 2);

  // ertesi gün yine çalar
  assert.equal(await alarmTick({ ...ctx, now: trToMs(2026, 11, 23, 6, 0) }), "rang");
});

test("en fazla 3 arama, yarım saat sonra kendiliğinden kapanır; tek seferlik alarm bir kez çalar", async () => {
  const ctx = fakeCtx();
  await handleMessage(msg("/alarm yarın 06:00"), ctx);
  for (let m = 0; m <= 30; m += 2) await alarmTick({ ...ctx, now: trToMs(2026, 11, 22, 6, m) });
  assert.equal(ctx.calls.length, 3);
  assert.equal(await alarmTick({ ...ctx, now: trToMs(2026, 11, 22, 6, 32) }), "gave-up");
  assert.match(ctx.sent.at(-1), /Yarım saattir cevap gelmedi/);
  assert.equal(await alarmTick({ ...ctx, now: trToMs(2026, 11, 23, 6, 0) }), null, "tek seferlik");
  assert.equal((await loadAlarm(ctx.kv)).time, null);
});

test("bot o saatte çalışamadıysa 20 dakikaya kadar geç çalar, daha geç çalmaz", async () => {
  const ctx = fakeCtx();
  await ctx.kv.put(ALARM_KEY, JSON.stringify({ time: "06:00", mode: "her", user: "@arda" }));
  assert.equal(await alarmTick({ ...ctx, now: trToMs(2026, 11, 22, 6, 30) }), null);
  assert.equal(await alarmTick({ ...ctx, now: trToMs(2026, 11, 22, 6, 14) }), "rang");
});

test("konuşarak alarm kurma", () => {
  assert.deepEqual(toSteps([{ ad: "alarm_kur", saat: "06:00", tekrar: "tek", tarih: "2026-11-22" }], NOW),
    [{ type: "run", command: "alarm", args: "22.11.2026 06:00" }]);
  assert.deepEqual(toSteps([{ ad: "alarm_kur", saat: "6:00" }], NOW), [{ type: "run", command: "alarm", args: "22.11.2026 06:00" }]);
  assert.deepEqual(toSteps([{ ad: "alarm_kur", saat: "19:00" }], NOW), [{ type: "run", command: "alarm", args: "21.11.2026 19:00" }]);
  assert.deepEqual(toSteps([{ ad: "alarm_kur", saat: "07:30", tekrar: "hafta_ici" }], NOW), [{ type: "run", command: "alarm", args: "hafta içi 07:30" }]);
  assert.deepEqual(toSteps([{ ad: "alarm_kur", saat: "07:30", tekrar: "her_gun" }], NOW), [{ type: "run", command: "alarm", args: "07:30" }]);
  assert.deepEqual(toSteps([{ ad: "alarm_kur" }], NOW), [{ type: "say", text: "Alarmı saat kaçta kurayım?" }]);
  assert.deepEqual(toSteps([{ ad: "alarm_kapat" }], NOW), [{ type: "run", command: "alarm", args: "kapat" }]);
});

test("servis cevabı yazıya çevrilir ve hata sözleri yakalanır", () => {
  assert.equal(serviceText("<html><body><p>Call to @arda&nbsp;queued</p><script>x()</script></body></html>"), "Call to @arda queued");
  assert.equal(CALL_FAILED.test("Error: user not authorized"), true);
  assert.equal(CALL_FAILED.test("Call to @arda queued"), false);
});

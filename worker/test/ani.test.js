import assert from "node:assert/strict";
import { test } from "node:test";
import { ANI_KEY, aniCaption, aniSummary, cmdAni, imgKey, loadAni, saveAni, streak, validDay } from "../src/ani.js";
import { toSteps } from "../src/brain.js";
import { handleMessage } from "../src/index.js";
import { PANEL_KEY, handlePanel } from "../src/panel.js";
import { trToMs } from "../src/logic.js";

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return {
    values,
    async get(k, type) {
      const v = values.get(k) ?? null;
      if (type === "arrayBuffer" && v !== null) return v;
      return v;
    },
    async put(k, v) { values.set(k, v); },
    async delete(k) { values.delete(k); },
  };
}

const NOW = trToMs(2026, 11, 22, 20, 30);   // Pazar akşamı
const jpeg = (n = 300) => { const b = new Uint8Array(n).fill(7); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };

test("anı: fotoğraf altı yazısı", () => {
  assert.deepEqual(aniCaption("anı kampüste kar yağdı", NOW), { day: "2026-11-22", caption: "kampüste kar yağdı" });
  assert.deepEqual(aniCaption("Anı: ilk kar", NOW), { day: "2026-11-22", caption: "ilk kar" });
  assert.deepEqual(aniCaption("#anı", NOW), { day: "2026-11-22", caption: "" });
  assert.deepEqual(aniCaption("/ani dün sınav bitti", NOW), { day: "2026-11-21", caption: "sınav bitti" });
  assert.deepEqual(aniCaption("anı defterine: güzel gün", NOW), { day: "2026-11-22", caption: "güzel gün" });
  assert.equal(aniCaption("ani yağmur bastırdı", NOW), null);     // "ani" = birden
  assert.equal(aniCaption("anılarım", NOW), null);
  assert.equal(aniCaption("market fişi", NOW), null);
  assert.equal(aniCaption(undefined, NOW), null);
});

test("anı: tarih kontrolü ve seri", () => {
  assert.equal(validDay("2026-11-22", NOW), true);
  assert.equal(validDay("2026-11-23", NOW), false);   // gelecek
  assert.equal(validDay("2026-02-30", NOW), false);
  assert.equal(validDay("22.11.2026", NOW), false);
  const days = { "2026-11-19": {}, "2026-11-20": {}, "2026-11-21": {} };
  assert.equal(streak(days, NOW), 3);                  // bugün eklenmedi ama seri bozulmadı
  assert.equal(streak({ ...days, "2026-11-22": {} }, NOW), 4);
  assert.equal(streak({ "2026-11-20": {} }, NOW), 0);
});

test("anı: kaydet, değiştir, komut", async () => {
  const kv = fakeKv();
  assert.deepEqual(await saveAni(kv, "2026-11-22", new Uint8Array([1, 2, 3]), "", NOW), { error: "Fotoğraf okunamadı." });
  assert.deepEqual(await saveAni(kv, "2026-11-25", jpeg(), "", NOW), { error: "Bu tarih olmaz (gelecekteki bir güne anı eklenemez)." });
  assert.deepEqual(await saveAni(kv, "2026-11-21", jpeg(), "  dün   güzeldi ", NOW), { ok: true, replaced: false });
  assert.deepEqual(await saveAni(kv, "2026-11-22", jpeg(), "<b>bugün</b>", NOW), { ok: true, replaced: false });
  assert.deepEqual(await saveAni(kv, "2026-11-22", jpeg(400), "yeni", NOW + 1000), { ok: true, replaced: true });
  assert.equal(kv.values.get(imgKey("2026-11-22")).byteLength, 400);
  const sum = aniSummary(await loadAni(kv), NOW);
  assert.deepEqual([sum.count, sum.today, sum.streak, sum.last.d, sum.last.cap], [2, true, 2, "2026-11-22", "yeni"]);
  const out = await cmdAni("", { kv, now: NOW });
  assert.match(out, /2 sayfa · 🔥 2 gün üst üste/);
  assert.match(out, /• <b>22 Kasım 2026<\/b> · yeni\n• <b>21 Kasım 2026<\/b> · dün güzeldi/);
  assert.match(await cmdAni("sil dün", { kv, now: NOW }), /21 Kasım 2026 sayfası silindi/);
  assert.equal(kv.values.has(imgKey("2026-11-21")), false);
  assert.match(await cmdAni("sil 2026-11-21", { kv, now: NOW }), /için bir sayfa yok/);
  assert.match(await cmdAni("yardım", { kv, now: NOW }), /Anı defteri/);
  assert.match(await cmdAni("", { kv: fakeKv(), now: NOW }), /henüz boş/);
});

test("anı: Telegram'da altında 'anı' yazan fotoğraf deftere gider", async () => {
  const sent = [], fetched = [];
  const ctx = {
    now: NOW, chatId: "42", kv: fakeKv(), send: async (t) => { sent.push(t); return true; },
    tgFile: async (id, max) => { fetched.push([id, max]); return jpeg(); },
    ai: { see: async () => { throw new Error("hafızaya gitmemeli"); } },
  };
  await handleMessage({ chat: { id: 42 }, caption: "anı ilk kar", photo: [{ file_id: "k", width: 320, file_size: 20000 }, { file_id: "b", width: 1280, file_size: 250000 }, { file_id: "dev", width: 2560, file_size: 3000000 }] }, ctx);
  assert.deepEqual(fetched, [["b", 1536 * 1024]]);
  assert.match(sent[0], /📖 Anı defterine ekledim: <b>22 Kasım 2026<\/b>/);
  const index = JSON.parse(ctx.kv.values.get(ANI_KEY));
  assert.equal(index.days["2026-11-22"].cap, "ilk kar");
});

test("anı: panelden ekle, oku, sil", async () => {
  const kv = fakeKv({ [PANEL_KEY]: "anahtar" });
  const calls = [];
  const c = { kv, now: NOW, pc: { call: async (op) => { calls.push(op); return { ok: true }; } } };
  const req = (method, body, { key = "anahtar", path = "/panel/ani" } = {}) => new Request(`https://j.x${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const img = Buffer.from(jpeg()).toString("base64");
  assert.equal((await handlePanel(req("POST", { d: "2026-11-22", img }, { key: "yanlis" }), c, {})).status, 401);
  assert.equal((await handlePanel(req("POST", { d: "2026-11-23", img }), c, {})).status, 400);
  assert.equal((await handlePanel(req("POST", { d: "2026-11-22", img: btoa("merhaba dünya".replace(/ü/, "u")) }), c, {})).status, 400);
  assert.equal((await handlePanel(req("POST", { d: "2026-11-22", img, cap: "sınav günü" }), c, {})).status, 200);
  assert.deepEqual(calls, ["notify"]);
  const list = await (await handlePanel(req("GET"), c, {})).json();
  assert.deepEqual(list.days.map((x) => [x.d, x.cap]), [["2026-11-22", "sınav günü"]]);
  const photo = await handlePanel(req("GET", null, { path: `/panel/ani/foto?d=2026-11-22&v=${list.days[0].v}` }), c, {});
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("Content-Type"), "image/jpeg");
  assert.equal(new Uint8Array(await photo.arrayBuffer())[0], 0xff);
  assert.equal((await handlePanel(req("GET", null, { path: "/panel/ani/foto?d=2026-11-22", key: "yanlis" }), c, {})).status, 401);
  assert.equal((await handlePanel(req("GET", null, { path: "/panel/ani/foto?d=../panel:key" }), c, {})).status, 404);
  assert.equal((await handlePanel(req("POST", { d: "2026-11-22", cap: "not değişti" }), c, {})).status, 200);
  assert.equal((await loadAni(kv)).days["2026-11-22"].cap, "not değişti");
  assert.equal((await handlePanel(req("DELETE", { d: "2026-11-22" }), c, {})).status, 200);
  assert.equal((await handlePanel(req("DELETE", { d: "2026-11-22" }), c, {})).status, 404);
  assert.deepEqual((await loadAni(kv)).days, {});
});

test("anı: yapay zekâ adımı", () => {
  assert.deepEqual(toSteps([{ ad: "ani_defteri" }], {}).map((s) => [s.type, s.command, s.args]), [["run", "ani", ""]]);
});

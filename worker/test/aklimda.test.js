import assert from "node:assert/strict";
import { test } from "node:test";
import { AKLIMDA_KEY, MAX_ITEMS, cmdAklimda, findItem, loadItems } from "../src/aklimda.js";
import { toSteps } from "../src/brain.js";
import { PANEL_KEY, handlePanel } from "../src/panel.js";

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return { values, async get(k) { return values.get(k) ?? null; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}
let n = 0;
const ctx = (kv = fakeKv()) => ({ kv, now: 1_800_000_000_000, id: () => `id${(n += 1)}` });

test("aklımda: ekle, listele, bitti", async () => {
  const c = ctx();
  assert.match(await cmdAklimda("", c), /listesi boş/);
  assert.match(await cmdAklimda("süt al", c), /📝 Aklımda: <b>süt al<\/b>\nListede 1 madde var/);
  assert.match(await cmdAklimda("ekle Kitabı kütüphaneye iade et", c), /Listede 2 madde/);
  assert.equal(await cmdAklimda("Süt   al", c), "Bu zaten listede.");
  assert.match(await cmdAklimda("<b>hoca</b>ya mail at", c), /&lt;b&gt;hoca/);
  assert.match(await cmdAklimda("", c), /📝 <b>Aklımda<\/b> · 3\n1\. süt al\n2\. Kitabı kütüphaneye iade et\n3\. &lt;b&gt;/);
  assert.match(await cmdAklimda("bitti kitab", c), /✅ <s>Kitabı kütüphaneye iade et<\/s>\nListede 2 madde kaldı/);
  assert.match(await cmdAklimda("bitti 9", c), /eşleşen tek bir madde bulamadım/);
  assert.match(await cmdAklimda("bitti", c), /Hangisi/);
  assert.match(await cmdAklimda("sil 1", c), /<s>süt al<\/s>/);
  assert.match(await cmdAklimda("bitti 1", c), /Liste bitti, tebrikler/);
  assert.deepEqual(await loadItems(c.kv), []);
  assert.match(await cmdAklimda("yardım", c), /saati olmayan yapılacaklar/);
});

test("aklımda: belirsiz sözcük ve dolu liste", async () => {
  const items = [{ id: "a", text: "Süt al" }, { id: "b", text: "Süt makinesini temizle" }, { id: "c", text: "Ekmek al" }];
  assert.equal(findItem(items, "süt"), null, "iki maddede geçiyor");
  assert.equal(findItem(items, "ekmek").id, "c");
  assert.equal(findItem(items, "2").id, "b");
  const full = fakeKv({ [AKLIMDA_KEY]: JSON.stringify({ items: Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: `x${i}`, text: `iş ${i}` })) }) });
  assert.match(await cmdAklimda("bir tane daha", ctx(full)), /Liste dolu/);
});

test("aklımda: yapay zekâ adımları", () => {
  const steps = toSteps([
    { ad: "aklimda_ekle", metin: "Süt al" }, { ad: "aklimda_liste" }, { ad: "aklimda_bitti", metin: "süt" }, { ad: "aklimda_ekle", metin: "  " },
  ], {});
  assert.deepEqual(steps.map((s) => [s.type, s.command, s.args]), [["run", "aklimda", "ekle Süt al"], ["run", "aklimda", ""], ["run", "aklimda", "bitti süt"]]);
});

test("aklımda: panelden ekle ve bitti", async () => {
  const kv = fakeKv({ [PANEL_KEY]: "anahtar" });
  const calls = [];
  const c = { ...ctx(kv), pc: { call: async (op) => { calls.push(op); return { ok: true }; } } };
  const req = (method, body, key = "anahtar") => new Request("https://j.x/panel/aklimda", { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handlePanel(req("POST", { text: "süt al" }, "yanlis"), c, {})).status, 401);
  assert.equal((await handlePanel(req("POST", { text: "süt al" }), c, {})).status, 200);
  assert.equal((await handlePanel(req("POST", { text: "süt al" }), c, {})).status, 409);
  assert.equal((await handlePanel(req("POST", { text: "  " }), c, {})).status, 400);
  const [item] = await loadItems(kv);
  assert.equal(item.text, "süt al");
  assert.equal((await handlePanel(req("DELETE", { id: "yok" }), c, {})).status, 404);
  assert.equal((await handlePanel(req("DELETE", { id: item.id }), c, {})).status, 200);
  assert.deepEqual(await loadItems(kv), []);
  assert.deepEqual(calls, ["notify", "notify"]);
});

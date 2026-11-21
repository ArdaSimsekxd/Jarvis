import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PC_HELP, PcHub, cmdPc, injectPairing, pairCode, parsePc, sha256 } from "../src/pc.js";
import { toSteps } from "../src/brain.js";
import worker from "../src/index.js";
import { trToMs } from "../src/logic.js";

const NOW = trToMs(2026, 11, 22, 1, 30);

function fakeState() {
  const data = new Map();
  const sockets = [];
  return {
    data, sockets,
    storage: {
      async get(k) { return data.get(k); },
      async put(k, v) { data.set(k, structuredClone(v)); },
      async delete(k) { return data.delete(k); },
    },
    getWebSockets: (tag) => sockets.filter((ws) => !tag || (ws.tags ?? ["pc"]).includes(tag)),
    getTags: (ws) => ws.tags ?? ["pc"],
    acceptWebSocket: (ws, tags) => { ws.tags = tags; sockets.push(ws); },
  };
}

// Bilgisayarı taklit eder: gelen işe answer(job) ile cevap verir (null: hiç cevap vermez)
function fakeSocket(hub, answer) {
  return {
    jobs: [], closed: null,
    send(message) {
      const job = JSON.parse(message);
      this.jobs.push(job);
      const text = answer(job);
      if (text !== null) setTimeout(() => hub.webSocketMessage(this, JSON.stringify({ id: job.id, metin: text })), 1);
    },
    close(code) { this.closed = code; },
  };
}

const post = (path, body, headers = {}) => new Request(`https://jarvis.example.workers.dev${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const internal = async (hub, op, body = {}) => (await hub.fetch(post(`/internal/${op}`, body))).json();

async function pairedHub() {
  const state = fakeState();
  const hub = new PcHub(state, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "42" });
  const { code } = await internal(hub, "pair");
  const { token } = await (await hub.fetch(post("/pc/pair", { code }))).json();
  return { state, hub, token };
}

test("/pc yazılanları bilgisayar işlerine çevirir", () => {
  assert.deepEqual(parsePc(""), { job: { is: "durum", arg: "" } });
  assert.deepEqual(parsePc("Kilitle"), { job: { is: "kilitle", arg: "" } });
  assert.deepEqual(parsePc("ses 40"), { job: { is: "ses", arg: "40" } });
  assert.deepEqual(parsePc("ses kıs"), { job: { is: "ses", arg: "kis" } });
  assert.deepEqual(parsePc("ses kapat"), { job: { is: "ses", arg: "0" } });
  assert.match(parsePc("ses 300").say, /0 ile 100/);
  assert.deepEqual(parsePc("müzik sonraki"), { job: { is: "medya", arg: "sonraki" } });
  assert.deepEqual(parsePc("müzik durdur"), { job: { is: "medya", arg: "oynat" } });
  assert.deepEqual(parsePc("aç https://Canvas.agu.edu.tr/Courses"), { job: { is: "ac", arg: "https://Canvas.agu.edu.tr/Courses" } });
  assert.deepEqual(parsePc("dosya 3"), { job: { is: "dosya", arg: "3" } });
  assert.deepEqual(parsePc("bağla"), { local: "pair" });
  assert.deepEqual(parsePc("ayır"), { local: "unpair" });
  assert.equal(parsePc("yardım").say, PC_HELP);
  assert.match(parsePc("formatla").say, /nasıl yapacağımı bilmiyorum/);
});

test("eşleştirme kodu ve kurulum dosyası", async () => {
  assert.equal(pairCode(new Uint8Array([0, 1, 2, 3, 31, 32, 33, 255])), "ABCD-9AB9");
  assert.match(pairCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(await sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const source = readFileSync(new URL("../../pc/jarvis_pc.py", import.meta.url), "utf8");
  const file = injectPairing(source, "https://jarvis.x.workers.dev", "ABCD-EFGH");
  assert.match(file, /^PAIRING = "https:\/\/jarvis\.x\.workers\.dev#ABCD-EFGH"$/m);
  assert.equal(injectPairing("başka dosya", "https://x", "A"), null);
});

test("eşleştirme: yanlış kod reddedilir, doğru kod bir kez kullanılır", async () => {
  const state = fakeState();
  const hub = new PcHub(state, {});
  const { code } = await internal(hub, "pair");

  const wrong = await hub.fetch(post("/pc/pair", { code: "AAAA-AAAA" }));
  assert.equal(wrong.status, 403);
  assert.equal(state.data.get("pair").tries, 1);

  const ok = await hub.fetch(post("/pc/pair", { code: code.toLowerCase().replace("-", " ") }));
  const { token } = await ok.json();
  assert.match(token, /^[\w-]{40,}$/);
  assert.equal(state.data.get("token"), await sha256(token), "anahtarın kendisi değil özeti saklanır");

  const again = await hub.fetch(post("/pc/pair", { code }));
  assert.equal(again.status, 410);
});

test("on yanlış denemeden sonra kod silinir", async () => {
  const state = fakeState();
  const hub = new PcHub(state, {});
  const { code } = await internal(hub, "pair");
  for (let i = 0; i < 10; i += 1) await hub.fetch(post("/pc/pair", { code: "ZZZZ-ZZZZ" }));
  assert.equal((await hub.fetch(post("/pc/pair", { code }))).status, 410);
});

test("işler bağlı bilgisayara gider ve cevap döner", async () => {
  const empty = new PcHub(fakeState(), {});
  assert.deepEqual(await internal(empty, "send", { is: "kilitle" }), { paired: false });

  const { state, hub } = await pairedHub();
  assert.deepEqual(await internal(hub, "send", { is: "kilitle" }), { paired: true, online: false });

  const ws = fakeSocket(hub, (job) => (job.is === "kilitle" ? "🔒 Bilgisayarı kilitledim." : null));
  state.sockets.push(ws);
  assert.deepEqual(await internal(hub, "send", { is: "kilitle", arg: "" }), { paired: true, online: true, reply: "🔒 Bilgisayarı kilitledim." });
  assert.equal(ws.jobs[0].is, "kilitle");

  hub.wait = 20;
  assert.deepEqual(await internal(hub, "send", { is: "uyku" }), { paired: true, online: true, timeout: true });
  assert.equal(hub.waiting.size, 0);

  await internal(hub, "unpair");
  assert.equal(ws.closed, 4001);
  assert.equal(state.data.has("token"), false);
});

test("dosya yükleme anahtar ister ve Telegram'a gider", async () => {
  const { hub, token } = await pairedHub();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); };
  try {
    const bad = await hub.fetch(post("/pc/upload", "x", { Authorization: "Bearer yanlis" }));
    assert.equal(bad.status, 401);
    const res = await hub.fetch(post("/pc/upload", "jpegverisi", {
      Authorization: `Bearer ${token}`, "X-Tur": "foto", "X-Ad": encodeURIComponent("ekran.jpg"), "X-Not": encodeURIComponent("🖥 Ekran"),
    }));
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/bott\/sendPhoto$/);
    assert.equal(calls[0].init.body.get("chat_id"), "42");
    assert.equal(calls[0].init.body.get("caption"), "🖥 Ekran");
    assert.equal(calls[0].init.body.get("photo").name, "ekran.jpg");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("/pc komutu: bağlı değil, kapalı, cevap ve kurulum dosyası", async () => {
  const replies = [{ paired: false }, { paired: true, online: false }, { paired: true, online: true, reply: "Pil: %80 <tam>" }];
  const calls = [];
  const docs = [];
  const ctx = {
    origin: "https://jarvis.x.workers.dev", repo: "ArdaSimsekxd/Jarvis",
    pc: {
      call: async (op, body) => { calls.push([op, body]); return op === "pair" ? { code: "ABCD-EFGH" } : replies.shift(); },
      file: async () => 'import os\nPAIRING = ""\n',
    },
    sendDocument: async (name, text, caption) => { docs.push({ name, text, caption }); return true; },
  };
  assert.match(await cmdPc("", ctx), /bağlı değil.*\/pc bağla/);
  assert.match(await cmdPc("kilitle", ctx), /şu an bağlı değil/);
  assert.equal(await cmdPc("durum", ctx), "Pil: %80 &lt;tam&gt;");

  assert.match(await cmdPc("bağla", ctx), /Kurulum dosyasını gönderdim/);
  assert.equal(docs[0].name, "jarvis_pc.py");
  assert.match(docs[0].text, /^PAIRING = "https:\/\/jarvis\.x\.workers\.dev#ABCD-EFGH"$/m);
  assert.match(docs[0].caption, /Add python\.exe to PATH/);

  ctx.pc.file = async () => null;   // GitHub'a ulaşılamazsa metinle anlatır
  assert.match(await cmdPc("bağla", ctx), /<code>https:\/\/jarvis\.x\.workers\.dev#ABCD-EFGH<\/code>/);
  assert.match(await cmdPc("ayarla", { pc: null }), /Botu kur/);
});

test("yapay zekâ: bilgisayar işleri, kapatma onay ister", () => {
  assert.deepEqual(toSteps([{ ad: "bilgisayar", metin: "kilitle" }], NOW, "bilgisayarı kilitle"),
    [{ type: "private", label: "bilgisayar", command: "pc", args: "kilitle" }]);
  assert.deepEqual(toSteps([{ ad: "bilgisayar", metin: "ses 30" }], NOW, "sesi 30 yap")[0].args, "ses 30");
  const [off] = toSteps([{ ad: "bilgisayar", metin: "kapat" }], NOW, "bilgisayarı kapat");
  assert.equal(off.type, "confirm");
  assert.equal(off.args, "kapat");
  assert.match(off.label, /kapat/);
  assert.equal(toSteps([{ ad: "bilgisayar", metin: "yeniden" }], NOW, "")[0].type, "confirm");
});

test("dışarıdan yalnızca bilgisayar programının yolları açık", async () => {
  const seen = [];
  const env = { PC: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response("hub"); } }) } };
  assert.equal(await (await worker.fetch(post("/internal/send", { is: "kapat" }), env, {})).text(), "Jarvis");
  assert.equal(await (await worker.fetch(post("/pc/internal/send", {}), env, {})).text(), "Jarvis");
  assert.equal(await (await worker.fetch(post("/pc/pair", { code: "x" }), env, {})).text(), "hub");
  assert.deepEqual(seen, ["/pc/pair"]);
});

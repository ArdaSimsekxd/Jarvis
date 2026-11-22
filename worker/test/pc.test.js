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

test("kayıp modu: komutlar", () => {
  assert.deepEqual(parsePc("kamera"), { job: { is: "kamera", arg: "" } });
  assert.deepEqual(parsePc("nerede"), { job: { is: "konum", arg: "" } });
  assert.deepEqual(parsePc("kayıp"), { local: "lost" });
  assert.deepEqual(parsePc("çalındı"), { local: "lost" });
  assert.deepEqual(parsePc("kayıp kapat"), { local: "found" });
  assert.deepEqual(parsePc("bulundu"), { local: "found" });
  assert.match(PC_HELP, /\/pc kayıp/);
});

function alarmState() {
  const state = fakeState();
  state.alarm = null;
  state.storage.setAlarm = async (t) => { state.alarm = t; };
  state.storage.deleteAlarm = async () => { state.alarm = null; };
  return state;
}

test("kayıp modu: bilgisayar bağlanınca fotoğraf, konum, kilit; 15 dakikada bir", async () => {
  const state = alarmState();
  const hub = new PcHub(state, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "42" });
  assert.deepEqual(await internal(hub, "lost", { on: true }), { paired: false });
  const { code } = await internal(hub, "pair");
  const { token } = await (await hub.fetch(post("/pc/pair", { code }))).json();
  assert.ok(token);
  state.data.delete("announce");
  const sent = [];
  hub.tgFetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}"); };

  // Bilgisayar kapalıyken açılır: bağlanınca çalışır
  assert.deepEqual(await internal(hub, "lost", { on: true }), { paired: true, online: false });
  assert.equal(state.alarm, null);
  const ws = fakeSocket(hub, (job) => ({
    ekran: "", kamera: "",
    konum: "📍 Konum (Windows): https://maps.google.com/?q=38.73,35.48 (yaklaşık ±40 m)\n📶 Wi-Fi: <Kafe>",
    kilitle: "🔒 Bilgisayarı kilitledim.",
  }[job.is] ?? null));
  state.sockets.push(ws);
  const where = { ip: "203.0.113.7", city: "Kayseri", region: "Kayseri", country: "TR", lat: 38.73, lon: 35.48, org: "Türk Telekom" };
  await hub.connected(new Request("https://pc/pc/connect", { headers: { "X-Jarvis-Yer": encodeURIComponent(JSON.stringify(where)) } }));
  assert.equal(state.data.get("where").city, "Kayseri");
  const first = state.data.get("lost").next;
  assert.ok(first > Date.now() && state.alarm === first, "10 saniye sonrasına kuruldu");

  await hub.alarm();
  assert.equal(ws.jobs.length, 0, "vakti gelmeden çalışmaz");
  state.data.get("lost").next = 0;
  await hub.alarm();
  assert.deepEqual(ws.jobs.map((j) => j.is), ["ekran", "kamera", "konum", "kilitle"], "önce fotoğraflar, en son kilit");
  assert.match(ws.jobs[1].arg, /Kayıp modu/);
  assert.equal(sent.length, 1);
  const text = sent[0].text;
  assert.match(text, /^🚨 <b>Kayıp modu<\/b> · 1\. rapor/);
  assert.match(text, /maps\.google\.com\/\?q=38\.73,35\.48/);
  assert.match(text, /Wi-Fi: &lt;Kafe&gt;/, "bilgisayardan gelen yazı kaçışlanır");
  assert.match(text, /İnternet bağlantısına göre, şehir düzeyinde: Kayseri, TR/);
  assert.match(text, /Türk Telekom · IP 203\.0\.113\.7/);
  assert.match(text, /\/pc bulundu/);
  const lost = state.data.get("lost");
  assert.equal(lost.n, 1);
  assert.ok(lost.next - Date.now() > 14 * 60 * 1000, "15 dakika sonra yeniden");
  assert.equal(state.alarm, lost.next);

  // Bilgisayar kapanırsa bekler
  state.sockets.length = 0;
  state.data.get("lost").next = 0;
  await hub.alarm();
  assert.equal(sent.length, 1);
  assert.equal(state.data.get("lost").next, null);
  assert.equal(state.alarm, null);

  assert.deepEqual(await internal(hub, "lost", { on: false }), { paired: true, stopped: true });
  assert.equal(state.data.has("lost"), false);
  assert.deepEqual(await internal(hub, "lost", { on: false }), { paired: true, stopped: false });
});

test("kayıp modu: eski program kamera ve konumu bilmiyorsa söylenir", async () => {
  const state = alarmState();
  const hub = new PcHub(state, {});
  state.data.set("token", "x");
  const sent = [];
  hub.tgFetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}"); };
  const old = "Bu işi bilmiyorum. Programın yeni sürümü gerekebilir: Telegram'da /pc bağla yazıp gelen dosyayı yeniden aç.";
  state.sockets.push(fakeSocket(hub, (job) => (job.is === "ekran" ? "" : job.is === "kilitle" ? "🔒" : old)));
  hub.lostWait = 50;
  assert.deepEqual(await internal(hub, "lost", { on: true }), { paired: true, online: true });
  state.data.get("lost").next = 0;
  await hub.alarm();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text.split("yeni sürümü").length, 2, "aynı uyarı bir kez");
  assert.match(sent[0].text, /Bilgisayarı kilitledim/);
});

test("kayıp modu: /pc komutları ve bağlantı yeri", async () => {
  const replies = { lost: [{ paired: true, online: false }, { paired: true, online: true }, { paired: true, stopped: true }] };
  const ctx = {
    pc: {
      call: async (op) => {
        if (op === "lost") return replies.lost.shift();
        if (op === "where") return { where: { ip: "203.0.113.7", city: "Talas", region: "Kayseri", country: "TR", lat: null, lon: null, org: null, at: NOW } };
        return { paired: true, online: true, reply: "📍 Konum (Windows): yok" };
      },
    },
  };
  assert.match(await cmdPc("kayıp", ctx), /bağlı değil\. Açılıp internete bağlandığı anda/);
  const on = await cmdPc("çalındı", ctx);
  assert.match(on, /Şimdi ekran görüntüsü/);
  assert.match(on, /polise/);
  assert.match(await cmdPc("bulundu", ctx), /Kayıp modunu kapattım/);
  const where = await cmdPc("konum", ctx);
  assert.match(where, /^📍 Konum \(Windows\): yok\n🌐 İnternet bağlantısına göre, şehir düzeyinde: Talas, Kayseri, TR\nIP 203\.0\.113\.7 \(01:30 bağlantısı\)$/);
  assert.doesNotMatch(where, /haritada/);
  assert.deepEqual(toSteps([{ ad: "bilgisayar", metin: "kayip" }], NOW, "laptopum çalındı"),
    [{ type: "private", label: "bilgisayar", command: "pc", args: "kayip" }]);
});

test("bağlantıya yaklaşık yer eklenir, programın gönderdiği sahte başlık silinir", async () => {
  const seen = [];
  const env = { PC: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { seen.push(req.headers.get("X-Jarvis-Yer")); return new Response("hub"); } }) } };
  const fake = encodeURIComponent(JSON.stringify({ ip: "1.1.1.1" }));
  await worker.fetch(new Request("https://j.example/pc/connect", { headers: { "X-Jarvis-Yer": fake, "CF-Connecting-IP": "203.0.113.9" } }), env, {});
  await worker.fetch(post("/pc/pair", { code: "x" }, { "X-Jarvis-Yer": fake }), env, {});
  assert.equal(JSON.parse(decodeURIComponent(seen[0])).ip, "203.0.113.9");
  assert.equal(seen[1], null);
});

test("dosya getir: komut ve yapay zekâ", () => {
  assert.deepEqual(parsePc("getir Devre Raporu"), { job: { is: "getir", arg: "Devre Raporu" } });
  assert.deepEqual(parsePc("getir 2"), { job: { is: "getir", arg: "2" } });
  assert.match(parsePc("getir").say, /Hangi dosyayı/);
  assert.deepEqual(toSteps([{ ad: "bilgisayar", metin: "getir ödev raporu" }], NOW, "bilgisayardaki ödev raporunu getir"),
    [{ type: "private", label: "bilgisayar", command: "pc", args: "getir ödev raporu" }]);
});

test("dosya getir: bilgisayardan gelen dosya panelde 1 saat indirilir", async () => {
  const { state, hub, token } = await pairedHub();
  hub.fileChunk = 4;
  const auth = (name) => ({ Authorization: `Bearer ${token}`, "X-Tur": "panel", "X-Ad": encodeURIComponent(name) });
  const app = { tags: ["app"], sent: [], send(m) { this.sent.push(JSON.parse(m)); } };
  state.sockets.push(app);
  assert.equal((await hub.fetch(post("/pc/upload", "x", { ...auth("a.pdf"), Authorization: "Bearer yanlis" }))).status, 401);
  const res = await hub.fetch(post("/pc/upload", "abcdefghij", auth("Devre Raporu ğ.pdf")));
  assert.equal(res.status, 200);
  assert.deepEqual(app.sent.at(-1), { tip: "dosya", name: "Devre Raporu ğ.pdf" });
  const meta = state.data.get("files")[0];
  assert.equal(meta.n, 3, "parçalara bölündü");
  const { files } = await internal(hub, "files");
  assert.equal(files.length, 1);
  assert.equal(files[0].size, 10);
  assert.match(files[0].url, /^\/panel\/file\/[0-9a-f]{24}\?t=[\w-]{40,}$/);
  assert.equal(files[0].token, undefined, "anahtar yalnızca bağlantının içinde");

  const got = await hub.fetch(new Request(`https://j.example${files[0].url}`));
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "abcdefghij");
  assert.equal(got.headers.get("Content-Type"), "application/pdf");
  assert.match(got.headers.get("Content-Disposition"), /^inline; filename="Devre Raporu _\.pdf"; filename\*=UTF-8''Devre%20Raporu%20%C4%9F\.pdf$/);
  assert.equal(got.headers.get("X-Content-Type-Options"), "nosniff");
  const bad = await hub.fetch(new Request(`https://j.example/panel/file/${files[0].id}?t=yanlis`));
  assert.equal(bad.status, 404);

  // HTML gibi dosyalar tarayıcıda açılmaz, indirilir
  await hub.fetch(post("/pc/upload", "<script>x</script>", auth("sayfa.html")));
  const html = (await internal(hub, "files")).files.find((f) => f.name === "sayfa.html");
  const page = await hub.fetch(new Request(`https://j.example${html.url}`));
  assert.equal(page.headers.get("Content-Type"), "application/octet-stream");
  assert.match(page.headers.get("Content-Disposition"), /^attachment;/);

  // En fazla 3 dosya: en eskisi silinir
  await hub.fetch(post("/pc/upload", "1", auth("b.txt")));
  await hub.fetch(post("/pc/upload", "2", auth("c.txt")));
  const names = (await internal(hub, "files")).files.map((f) => f.name);
  assert.deepEqual(names, ["sayfa.html", "b.txt", "c.txt"]);
  assert.equal(state.data.has(`file:${meta.id}:0`), false, "eski dosyanın parçaları silindi");

  // Süresi dolunca
  for (const f of state.data.get("files")) f.exp = Date.now() - 1;
  assert.deepEqual((await internal(hub, "files")).files, []);
  assert.equal([...state.data.keys()].filter((k) => k.startsWith("file:")).length, 0);
});

test("panel dosya bağlantısını Durable Object'e yönlendirir", async () => {
  const seen = [];
  const env = { PC: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response("dosya"); } }) } };
  const r = await worker.fetch(new Request("https://j.example/panel/file/abc?t=x"), env, {});
  assert.equal(await r.text(), "dosya");
  assert.deepEqual(seen, ["/panel/file/abc"]);
});

test("panel sohbetinin ortak geçmişi saklanır, sınırlıdır ve silinir", async () => {
  const hub = new PcHub(fakeState(), {});
  assert.deepEqual(await internal(hub, "chatget"), { log: [] });
  await internal(hub, "chatadd", { items: [{ w: "me", t: "selam" }, { w: "bot", t: "Merhaba efendim" }, { w: "kotu", t: "x" }, { w: "bot", t: "" }] });
  const { log } = await internal(hub, "chatget");
  assert.deepEqual(log.map((x) => [x.w, x.t]), [["me", "selam"], ["bot", "Merhaba efendim"]]);
  for (let i = 0; i < 40; i += 1) await internal(hub, "chatadd", { items: [{ w: "me", t: `m${i}` }, { w: "bot", t: "y".repeat(5000) }] });
  const big = (await internal(hub, "chatget")).log;
  assert.equal(big.length, 60);
  assert.equal(big.at(-1).t.length, 4000);
  await internal(hub, "chatclear");
  assert.deepEqual(await internal(hub, "chatget"), { log: [] });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { b64url, encryptPayload, fromB64url, makeVapidKeys, trustedEndpoint, vapidHeader } from "../src/webpush.js";
import { PcHub } from "../src/pc.js";
import { PANEL_KEY, SERVICE_WORKER, cmdPanel, handlePanel, plainText } from "../src/panel.js";
import { pushToApp } from "../src/index.js";

const enc = new TextEncoder();

async function hkdf(salt, ikm, info, n) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, n * 8));
}

// Telefonun yapacağı çözme (RFC 8291): şifrelemenin doğru olduğunu gösterir
async function decrypt(body, ua, auth) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  assert.equal(plain.at(-1), 2, "son kayıt işareti");
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function fakeSubscription() {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64url(await crypto.subtle.exportKey("raw", ua.publicKey));
  return { ua, auth, sub: { endpoint: "https://web.push.apple.com/QWx4", keys: { p256dh, auth: b64url(auth) } } };
}

test("bildirim şifrelemesi telefonda çözülebilir", async () => {
  const { ua, auth, sub } = await fakeSubscription();
  const body = await encryptPayload(sub, JSON.stringify({ title: "⏰ Hatırlatma", body: "Kütüphane" }));
  assert.deepEqual([...body.slice(16, 20)], [0, 0, 16, 0]);
  assert.equal(body[20], 65);
  assert.deepEqual(JSON.parse(await decrypt(body, ua, auth)), { title: "⏰ Hatırlatma", body: "Kütüphane" });
});

test("VAPID imzası doğrulanır", async () => {
  const vapid = await makeVapidKeys();
  assert.equal(fromB64url(vapid.publicKey).length, 65);
  const header = await vapidHeader("https://web.push.apple.com/abc", vapid, "https://github.com/x/y", 1_800_000_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, vapid.publicKey);
  const [h, c, sig] = jwt.split(".");
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
  assert.deepEqual(claims, { aud: "https://web.push.apple.com", exp: 1_800_000_000 + 12 * 3600, sub: "https://github.com/x/y" });
  const pub = await crypto.subtle.importKey("raw", fromB64url(vapid.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(sig), enc.encode(`${h}.${c}`)));
  assert.ok(trustedEndpoint("https://web.push.apple.com/x"));
  assert.ok(trustedEndpoint("https://fcm.googleapis.com/fcm/send/x"));
  assert.equal(trustedEndpoint("https://evil.example/push.apple.com"), false);
  assert.equal(trustedEndpoint("http://web.push.apple.com/x"), false);
});

function fakeState() {
  const data = new Map(), sockets = [];
  return {
    data, sockets,
    storage: { async get(k) { return data.get(k); }, async put(k, v) { data.set(k, structuredClone(v)); }, async delete(k) { return data.delete(k); } },
    getWebSockets: (tag) => sockets.filter((ws) => !tag || ws.tags.includes(tag)),
    getTags: (ws) => ws.tags,
  };
}
const fakeWs = (tags) => ({ tags, sent: [], closed: null, send(m) { this.sent.push(m); }, close(c) { this.closed = c; } });
const call = async (hub, op, body = {}) => (await hub.fetch(new Request(`https://pc/internal/${op}`, { method: "POST", body: JSON.stringify(body) }))).json();

test("hub: uygulamaya haber verir, bilgisayarla karıştırmaz", async () => {
  const state = fakeState();
  const hub = new PcHub(state, {});
  const app = fakeWs(["app"]);
  state.sockets.push(app);
  await state.storage.put("token", "x");
  await state.storage.put("cache:data", { value: 1, exp: Date.now() + 1e6 });
  assert.deepEqual(await call(hub, "status"), { paired: true, online: false }, "telefon bağlantısı bilgisayar sayılmaz");
  await call(hub, "notify");
  assert.equal(state.data.has("cache:data"), false);
  assert.deepEqual(app.sent.map((m) => JSON.parse(m)), [{ tip: "yenile" }]);
  const pc = fakeWs(["pc"]);
  state.sockets.push(pc);
  await hub.webSocketClose(pc, 1006, "");
  assert.deepEqual(JSON.parse(app.sent.at(-1)), { tip: "pc", online: false });
});

test("hub: uygulama giriş kodu bir kez kullanılır", async () => {
  const hub = new PcHub(fakeState(), {});
  const { code } = await call(hub, "lcode");
  assert.deepEqual(await call(hub, "lcheck", { code: "ZZZZ-ZZZZ" }), { ok: false });
  assert.deepEqual(await call(hub, "lcheck", { code: code.toLowerCase() }), { ok: true });
  assert.deepEqual(await call(hub, "lcheck", { code }), { ok: false, expired: true });
});

test("hub: bildirim abonelikleri ve gönderme", async () => {
  const state = fakeState();
  const hub = new PcHub(state, {});
  const { sub } = await fakeSubscription();
  assert.deepEqual(await call(hub, "pushsub", { sub: { ...sub, endpoint: "https://kotu.example/x" } }), { ok: false });
  assert.deepEqual(await call(hub, "pushsub", { sub }), { ok: true });
  const second = { ...sub, endpoint: "https://web.push.apple.com/eski" };
  await call(hub, "pushsub", { sub: second });
  const calls = [];
  hub.pushFetch = async (url, init) => { calls.push({ url, init }); return new Response("", { status: url.endsWith("eski") ? 410 : 201 }); };
  assert.deepEqual(await call(hub, "push", { title: "⏰ Hatırlatma", body: "Kütüphane" }), { sent: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers["Content-Encoding"], "aes128gcm");
  assert.match(calls[0].init.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.deepEqual(state.data.get("subs").map((s) => s.endpoint), [sub.endpoint], "410 veren abonelik silinir");
  const { publicKey } = await call(hub, "vapid");
  assert.equal(publicKey, state.data.get("vapid").publicKey, "anahtar bir kez üretilir");
  await call(hub, "pushclear");
  assert.equal(state.data.has("subs"), false);
});

function fakeKv(init = {}) {
  const values = new Map(Object.entries(init));
  return { values, async get(k) { return values.get(k) ?? null; }, async put(k, v) { values.set(k, v); } };
}
const req = (path, { method = "GET", key, body } = {}) => new Request(`https://jarvis.x.workers.dev${path}`, {
  method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

test("uygulama dosyaları, kodla giriş ve sohbet", async () => {
  const calls = [];
  const ctx = {
    kv: fakeKv({ [PANEL_KEY]: "anahtar" }),
    pc: { call: async (op, body) => { calls.push([op, body]); return op === "lcheck" ? { ok: body.code === "ABCD-EFGH" } : op === "lcode" ? { code: "WXYZ-2345" } : { ok: true }; } },
  };
  const src = { chat: async (text, loc) => [loc ? `Konum: ${loc.latitude},${loc.longitude}` : `Cevap: <b>${text}</b>`] };

  const manifest = await (await handlePanel(req("/panel/manifest.webmanifest"), ctx, src)).json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/panel");
  const sw = await handlePanel(req("/panel/sw.js"), ctx, src);
  assert.equal(sw.headers.get("Service-Worker-Allowed"), "/panel");
  assert.equal(await sw.text(), SERVICE_WORKER);
  const icon = new Uint8Array(await (await handlePanel(req("/panel/icon-180.png"), ctx, src)).arrayBuffer());
  assert.deepEqual([...icon.slice(1, 4)], [80, 78, 71], "PNG");
  assert.equal((await handlePanel(req("/panel/"), ctx, src)).status, 200);

  assert.equal((await handlePanel(req("/panel/login", { method: "POST", body: { code: "yanlis" } }), ctx, src)).status, 403);
  assert.deepEqual(await (await handlePanel(req("/panel/login", { method: "POST", body: { code: "ABCD-EFGH" } }), ctx, src)).json(), { key: "anahtar" });

  assert.equal((await handlePanel(req("/panel/chat", { method: "POST", body: { text: "selam" } }), ctx, src)).status, 401);
  assert.deepEqual(await (await handlePanel(req("/panel/chat", { method: "POST", key: "anahtar", body: { text: "selam" } }), ctx, src)).json(), { replies: ["Cevap: <b>selam</b>"] });
  // 🚌 düğmesi: konum yalnızca o soru için gider; bozuk konum yok sayılır
  assert.deepEqual(await (await handlePanel(req("/panel/chat", { method: "POST", key: "anahtar", body: { location: { lat: 38.74, lon: 35.47 } } }), ctx, src)).json(), { replies: ["Konum: 38.74,35.47"] });
  assert.deepEqual(await (await handlePanel(req("/panel/chat", { method: "POST", key: "anahtar", body: { location: { lat: "x", lon: 999 } } }), ctx, src)).json(), { replies: [] });

  assert.equal((await handlePanel(req("/panel/push", { method: "POST", body: {} }), ctx, src)).status, 401);
  await handlePanel(req("/panel/push", { method: "POST", key: "anahtar", body: { sub: { endpoint: "https://web.push.apple.com/x" } } }), ctx, src);
  assert.deepEqual(calls.filter(([op]) => op.startsWith("push")).map(([op]) => op), ["pushsub", "push"]);

  const msg = await cmdPanel("", { ...ctx, origin: "https://jarvis.x.workers.dev" });
  assert.match(msg, /Ana Ekrana Ekle/);
  assert.match(msg, /<code>WXYZ-2345<\/code>/);
  await cmdPanel("yenile", { ...ctx, origin: "https://jarvis.x.workers.dev" });
  assert.ok(calls.some(([op]) => op === "pushclear"), "yenilenince eski cihazların bildirimi kesilir");
});

test("Jarvis'in kendiliğinden gönderdiği mesajlar bildirime çevrilir", async () => {
  assert.equal(plainText("⏰ <b>Hatırlatma</b>\nKütüphane &amp; kitap &lt;3"), "⏰ Hatırlatma\nKütüphane & kitap <3");
  const ops = [];
  const env = { PC: { idFromName: (n) => n, get: () => ({ fetch: async (url, init) => { ops.push([new URL(url).pathname, JSON.parse(init.body)]); return new Response("{}"); } }) } };
  await pushToApp(env, ["⏰ <b>Hatırlatma</b>\nKütüphane", "tek satır", "3", "4"]);
  assert.deepEqual(ops.filter(([p]) => p.endsWith("/push")).map(([, b]) => b), [
    { title: "⏰ Hatırlatma", body: "Kütüphane" }, { title: "Jarvis", body: "tek satır" }, { title: "Jarvis", body: "3" },
  ]);
  assert.equal(ops.at(-1)[0], "/internal/notify");
  await pushToApp({}, ["x"]);
});

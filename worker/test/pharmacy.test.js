import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCES, cmdEczane, formatPharmacies, htmlToLines, listDay, parsePharmacies, wantedDay } from "../src/pharmacy.js";
import { toSteps } from "../src/brain.js";
import { trToMs } from "../src/logic.js";

const NIGHT = trToMs(2026, 11, 22, 2, 30);    // pazar gecesi 02:30: cumartesi akşamı başlayan nöbet
const EVENING = trToMs(2026, 11, 22, 20, 0);

// Posta / Gazete Vatan biçimi: ilçe başlıkları, "Kayseri / ilçe" satırı, kalın etiketler
const POSTA = `<html><head><title>x</title><script>var a = "Sahte Eczanesi 0(352)111-11-11";</script></head><body>
<h1>Kayseri Nöbetçi Eczaneler</h1><div class="date">21.11.2026</div>
<p>21 Kasım Cumartesi akşamından 22 Kasım Pazar sabahına kadar.</p>
<h2>Bünyan</h2>
<div class="item"><h3>Zambak Eczanesi</h3><div>Kayseri / Bünyan</div>
<p><b>Adres:</b> Yavuz Selim Mahallesi, 1800.Sokak No:8/I Bünyan / Kayseri</p><p><b>Telefon:</b> 0(352)712-14-77</p><a href="https://maps">Haritada göster</a></div>
<h2>Melikgazi</h2>
<div class="item"><h3>Narin Eczanesi</h3><div>Kayseri / Melikgazi</div>
<p><b>Adres:</b> Keykubat Mahallesi, Anafartalar Caddesi, No:17/A Melikgazi / Kayseri</p><p><b>Telefon:</b> 0(352)332-00-88</p></div>
<h2>Talas</h2>
<div class="item"><h3>Talas Şifa Eczanesi</h3><div>Kayseri / Talas</div>
<p><b>Adres:</b> Mevlana Mahallesi, Kiçikapı Caddesi No:5 Talas / Kayseri</p><p><b>Telefon:</b> 0(352)437-11-22</p></div>
<h2>Kocasinan</h2>
<div class="item"><h3>Zoroğlu Eczanesi</h3><div>Kayseri / Kocasinan</div>
<p><b>Adres:</b> Hoca Ahmet Yesevi Mahallesi No:24/D Kocasinan / Kayseri</p><p><b>Telefon:</b> 0(352)504-82-22</p></div>
</body></html>`;

// Sabah biçimi: düz liste, ilçe yalnızca adreste, tel: bağlantısı
const SABAH = `<h1>Kayseri nöbetçi eczaneler</h1><h2>21 Kasım 2026 Cumartesi akşamı mesai bitiminden, 22 Kasım 2026 Pazar sabahına kadar</h2>
<p>Bugün KAYSERİ ili nde 16 nöbetçi eczane bulunuyor.</p><ul>
<li><strong>EMEKTAR ECZANESİ</strong><span>Yavuz Selim Mahallesi, 1800. Sokak No:8/E Bünyan / Kayseri</span><a href="tel:03525028160">0 352 502 81 60</a><a href="https://maps">Harita için Tıklayınız</a></li>
<li><strong>Elit Eczanesi</strong><span>Mimarsinan Demokrasi Mahallesi, 2229. Sokak No:28/C Melikgazi / Kayseri</span><a href="tel:">0 352 237 02 37</a></li>
<li><strong>Elit Eczanesi</strong><span>Mimarsinan Demokrasi Mahallesi, 2229. Sokak No:28/C Melikgazi / Kayseri</span><a href="tel:">0 352 237 02 37</a></li>
<li><strong>Kale Eczanesi</strong><span>Cumhuriyet Mahallesi No:3 Kocasinan / Kayseri</span><a href="tel:">0 352 222 33 44</a></li>
</ul>`;

test("eczane: HTML düz satırlara çevrilir, etiketler birleşir", () => {
  const lines = htmlToLines(POSTA);
  assert.ok(!lines.some((l) => l.includes("Sahte")), "script içi atlanır");
  assert.ok(lines.includes("Adres: Keykubat Mahallesi, Anafartalar Caddesi, No:17/A Melikgazi / Kayseri"));
  assert.ok(lines.includes("Telefon: 0(352)332-00-88"));
});

test("eczane: iki farklı sayfa biçimi de okunur", () => {
  const posta = parsePharmacies(htmlToLines(POSTA));
  assert.equal(posta.length, 4);
  assert.deepEqual(posta[1], {
    name: "Narin Eczanesi", district: "Melikgazi", address: "Keykubat Mahallesi, Anafartalar Caddesi, No:17/A Melikgazi / Kayseri", phone: "0352 332 00 88",
  });
  const sabah = parsePharmacies(htmlToLines(SABAH));
  assert.deepEqual(sabah.map((p) => [p.name, p.district, p.phone]), [
    ["EMEKTAR ECZANESİ", "Bünyan", "0352 502 81 60"],
    ["Elit Eczanesi", "Melikgazi", "0352 237 02 37"],
    ["Kale Eczanesi", "Kocasinan", "0352 222 33 44"],
  ], "aynı eczane bir kez");
});

test("eczane: liste tarihi ve geçerli nöbet günü", () => {
  assert.equal(listDay(htmlToLines(POSTA), NIGHT), trToMs(2026, 11, 21));
  assert.equal(listDay(htmlToLines(SABAH), NIGHT), trToMs(2026, 11, 21));
  assert.equal(listDay(["Kayseri nöbetçi eczaneler", "05 Kasım Perşembe akşamından"], NIGHT), trToMs(2026, 11, 5));
  assert.equal(wantedDay(NIGHT), trToMs(2026, 11, 21), "gece 09:00'a kadar dünkü nöbet");
  assert.equal(wantedDay(EVENING), trToMs(2026, 11, 22));
});

function ctxWith(pages, now = NIGHT) {
  const calls = [];
  const store = new Map();
  return {
    now, calls, store,
    cache: { get: async (n) => store.get(n) ?? null, put: async (n, v) => { store.set(n, v); } },
    webFetch: async (url) => {
      calls.push(url);
      const page = pages[url];
      if (page instanceof Error) throw page;
      return { ok: page !== undefined, status: page === undefined ? 404 : 200, text: async () => page };
    },
  };
}

test("eczane: merkez, ilçe ve bütün liste; önbellek", async () => {
  const ctx = ctxWith({ [SOURCES[0].url]: POSTA });
  const text = await cmdEczane("", ctx);
  assert.match(text, /^💊 <b>Nöbetçi eczaneler<\/b> · merkez\n21 Kasım akşamından 22 Kasım sabahına kadar/);
  assert.match(text, /<b>Narin Eczanesi<\/b> · Melikgazi\nKeykubat[^\n]*\n📞 0352 332 00 88 · <a href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Narin%20Eczanesi/);
  assert.ok(text.indexOf("Narin") < text.indexOf("Zoroğlu") && text.indexOf("Zoroğlu") < text.indexOf("Talas Şifa"), "Melikgazi, Kocasinan, Talas sırası");
  assert.ok(!text.includes("Zambak"), "merkez dışı ilçe varsayılan listede yok");
  assert.match(text, /\/eczane hepsi/);
  assert.match(await cmdEczane("bünyan", ctx), /Zambak Eczanesi/);
  assert.match(await cmdEczane("hepsi", ctx), /Narin[\s\S]*Zambak/);
  assert.match(await cmdEczane("ankara", ctx), /ilçesi bulamadım/);
  assert.equal(ctx.calls.length, 1, "aynı gece ikinci kez indirilmez");
  assert.doesNotMatch(text, /⚠️/);
});

test("eczane: eski tarihli liste atlanır, hiçbiri tutmazsa uyarıyla gösterilir", async () => {
  const old = POSTA.replace("21.11.2026", "05.11.2026");
  const ctx = ctxWith({ [SOURCES[0].url]: old, [SOURCES[1].url]: SABAH });
  const text = await cmdEczane("", ctx);
  assert.match(text, /Kaynak: <a href="https:\/\/www\.sabah\.com\.tr/);
  assert.equal(ctx.calls.length, 2);
  const evening = ctxWith({ [SOURCES[0].url]: POSTA, [SOURCES[1].url]: new Error("x") }, EVENING);
  const warned = await cmdEczane("", evening);
  assert.match(warned, /⚠️ Bulduğum liste 21 Kasım; bu geceye ait olmayabilir/);
  assert.match(await cmdEczane("", ctxWith({})), /ulaşamadım.*112/);
});

test("eczane: yapay zekâ işlemi", () => {
  assert.deepEqual(toSteps([{ ad: "nobetci_eczane", metin: "" }], NIGHT), [{ type: "private", label: "eczane", command: "eczane", args: "" }]);
  assert.deepEqual(toSteps([{ ad: "nobetci_eczane", metin: "Talas'ta" }], NIGHT)[0].args, "Talas");
});

test("eczane: formatPharmacies boş ilçe", () => {
  const got = { list: [{ name: "A Eczanesi", district: "Develi", address: "", phone: "0352 1" }], day: trToMs(2026, 11, 21), source: "X", url: "https://x" };
  assert.match(formatPharmacies(got, "talas", NIGHT), /Talas bu gece nöbetçi eczane görünmüyor/);
});

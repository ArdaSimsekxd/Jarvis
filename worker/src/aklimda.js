// "Aklımda" listesi: saati olmayan, unutulmaması gereken işler (süt al, hocaya mail at, kitabı iade et).
// Hatırlatmadan farkı saat istememesi; hafızadan farkı bilgi değil yapılacak iş olması. Bitince listeden düşer.
import { esc, plain } from "./logic.js";

export const AKLIMDA_KEY = "aklimda";
export const MAX_ITEMS = 50;
const MAX_TEXT = 300;

export const AKLIMDA_HELP = [
  "📝 <b>Aklımda</b>: saati olmayan yapılacaklar",
  "<code>/aklimda süt al</code> listeye ekle · <code>/aklimda</code> listeyi göster",
  "<code>/aklimda bitti 2</code> ya da <code>/aklimda bitti süt</code> yapıldı, listeden çıkar",
  "Normal cümle de olur: \"aklımda kalsın, kitabı iade edeceğim\", \"süt aldım\". Panelde de AKLIMDA kartı var.",
].join("\n");

export async function loadItems(kv) {
  try {
    const data = JSON.parse((await kv.get(AKLIMDA_KEY)) ?? "null");
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

const saveItems = (kv, items) => kv.put(AKLIMDA_KEY, JSON.stringify({ items: items.slice(-MAX_ITEMS) }));

export const cleanText = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

// Ekler; { item } ya da { error }
export async function addItem(kv, text, nowMs, id) {
  const t = cleanText(text);
  if (!t) return { error: "Ne ekleyeyim? Örnek: <code>/aklimda süt al</code>" };
  const items = await loadItems(kv);
  if (items.some((i) => plain(i.text) === plain(t))) return { error: "Bu zaten listede.", dup: true };
  if (items.length >= MAX_ITEMS) return { error: `Liste dolu (${MAX_ITEMS}). Bitenleri çıkar: <code>/aklimda bitti 1</code>` };
  const item = { id, text: t, at: nowMs };
  await saveItems(kv, [...items, item]);
  return { item };
}

// Numara (listedeki sıra), kimlik ya da metindeki bir sözcükle bulur
export function findItem(items, word) {
  const w = plain(word).replace(/^#/, "");
  if (!w) return null;
  if (/^\d{1,2}$/.test(w)) return items[Number(w) - 1] ?? null;
  const byId = items.find((i) => i.id === w);
  if (byId) return byId;
  const hits = items.filter((i) => plain(i.text).includes(w));
  return hits.length === 1 ? hits[0] : null;
}

export async function doneItem(kv, word) {
  const items = await loadItems(kv);
  const item = findItem(items, word);
  if (!item) return null;
  await saveItems(kv, items.filter((i) => i !== item));
  return item;
}

export async function doneById(kv, id) {
  const items = await loadItems(kv);
  const item = items.find((i) => i.id === String(id));
  if (!item) return null;
  await saveItems(kv, items.filter((i) => i !== item));
  return item;
}

export function formatItems(items) {
  if (!items.length) return "📝 Aklımda listesi boş. Eklemek için: <code>/aklimda süt al</code>";
  return [`📝 <b>Aklımda</b> · ${items.length}`, ...items.map((i, n) => `${n + 1}. ${esc(i.text)}`), "", "Bitince: <code>/aklimda bitti 1</code>"].join("\n");
}

// "/aklimda" komutu
export async function cmdAklimda(args, ctx) {
  const raw = cleanText(args);
  const [first, ...rest] = raw.split(" ");
  const verb = plain(first ?? "");
  if (!raw) return formatItems(await loadItems(ctx.kv));
  if (["yardim", "help"].includes(verb)) return AKLIMDA_HELP;
  if (["bitti", "yaptim", "tamam", "sil", "cikar", "kaldir"].includes(verb)) {
    const target = rest.join(" ");
    if (!target) return "Hangisi? Örnek: <code>/aklimda bitti 2</code>";
    const item = await doneItem(ctx.kv, target);
    if (!item) return `"${esc(target)}" ile eşleşen tek bir madde bulamadım. Liste için: <code>/aklimda</code>`;
    const left = (await loadItems(ctx.kv)).length;
    return `✅ <s>${esc(item.text)}</s>\n${left ? `Listede ${left} madde kaldı.` : "Liste bitti, tebrikler."}`;
  }
  const text = verb === "ekle" ? rest.join(" ") : raw;
  const r = await addItem(ctx.kv, text, ctx.now, ctx.id?.() ?? Math.random().toString(16).slice(2, 10));
  if (r.error) return r.error;
  const count = (await loadItems(ctx.kv)).length;
  return `📝 Aklımda: <b>${esc(r.item.text)}</b>\nListede ${count} madde var. Bitince: <code>/aklimda bitti ${count}</code>`;
}

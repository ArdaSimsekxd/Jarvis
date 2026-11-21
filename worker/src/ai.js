// Yapay zekâya soru sormanın ortak parçaları (planlayıcı, hafıza, tarihler ve harcamalar kullanır).

// Metin içinden JSON nesnesini çıkarır; olmazsa null
export function looseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const s = String(raw ?? "");
  try {
    return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

export async function ask(ctx, messages, options) {
  const out = await ctx.ai.chat(messages, options);
  if (out === undefined || out === null || out === "") throw new Error("boş cevap");
  return out;
}

// JSON kalıbıyla sorar; model kalıbı tutturamazsa kalıpsız bir kez daha sorar.
export async function askJson(ctx, messages, schema, maxTokens) {
  try {
    return await ask(ctx, messages, { schema, maxTokens });
  } catch {
    return ask(ctx, messages, { maxTokens });
  }
}


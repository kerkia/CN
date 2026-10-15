// « IA » with the user's own key (owner, 2026-10-15): a model of their choosing — OpenRouter, Anthropic (Claude), OpenAI
// (ChatGPT) or Google (Gemini) — called by the browser itself. O'CN's server only hands over the instructions
// (/api/ask with promptOnly, the same as for its own model); the key goes from this browser to the provider and nowhere
// else: never to O'CN. It is kept for the tab's session, or on this device when the user asks (« Se souvenir »), and
// « Oublier » drops it. Each provider lists its models with the key (OpenRouter's list is public), so no model name is
// written here that could go stale.

const STORE = "ocn.ia.byok";
const LLM_OUT = 8000;                     // tokens a model may write: reasoning models count their thinking in it

/** The four providers: how to list their models and how to ask one. Each answers { text, tokensIn, tokensOut, dollars? }. */
export const PROVIDERS = {
  openrouter: {
    label: "OpenRouter", hint: "sk-or-…", keys: "https://openrouter.ai/settings/keys",
    note: "Une seule clé pour la plupart des modèles (Claude, GPT, Gemini, Llama…), un plafond de dépenses par clé, et quelques modèles gratuits.",
    prefer: [/^anthropic\/claude-sonnet/, /^anthropic\/claude/, /^openai\/gpt-5/, /^google\/gemini.*flash/],
    async models() {
      const d = await getJson("https://openrouter.ai/api/v1/models", {});
      return (d.data || []).filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"))
        .map((m) => ({ id: m.id, name: m.name || m.id, created: m.created || 0, price: [Number(m.pricing?.prompt) * 1e6, Number(m.pricing?.completion) * 1e6] }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async chat(key, model, messages) {
      const d = await postJson("https://openrouter.ai/api/v1/chat/completions",
        { Authorization: `Bearer ${key}`, "X-Title": "O'CN" },
        { model, messages, max_tokens: LLM_OUT, temperature: 0.1, usage: { include: true } });
      return { text: d.choices?.[0]?.message?.content || "", tokensIn: d.usage?.prompt_tokens, tokensOut: d.usage?.completion_tokens,
        dollars: typeof d.usage?.cost === "number" ? d.usage.cost : null };
    },
  },
  anthropic: {
    label: "Anthropic (Claude)", hint: "sk-ant-…", keys: "https://console.anthropic.com/settings/keys",
    note: "Les modèles Claude. Une clé de « workspace » avec une limite de dépenses est conseillée.",
    prefer: [/sonnet/, /haiku/, /opus/],
    async models(key) {
      const d = await getJson("https://api.anthropic.com/v1/models?limit=100", anthropicHeaders(key));
      return (d.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id, created: Date.parse(m.created_at || "") / 1000 || 0 }));
    },
    async chat(key, model, messages) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const d = await postJson("https://api.anthropic.com/v1/messages", anthropicHeaders(key),
        { model, system, max_tokens: LLM_OUT, messages: messages.filter((m) => m.role !== "system") });
      return { text: (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""),
        tokensIn: d.usage?.input_tokens, tokensOut: d.usage?.output_tokens };
    },
  },
  openai: {
    label: "OpenAI (ChatGPT)", hint: "sk-…", keys: "https://platform.openai.com/api-keys",
    note: "Les modèles GPT. Une clé de projet avec une limite de dépenses est conseillée.",
    prefer: [/^gpt-5(?!.*(nano|mini|chat))/, /^gpt-5/, /^gpt-4\.1(?!.*nano)/, /^gpt-4o(?!.*mini)/, /^o\d/],
    async models(key) {
      const d = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` });
      return (d.data || []).filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct|moderation)/.test(m.id))
        .sort((a, b) => b.id.localeCompare(a.id)).map((m) => ({ id: m.id, name: m.id, created: m.created || 0 }));
    },
    async chat(key, model, messages) {
      // no temperature: the reasoning models only take the default
      const d = await postJson("https://api.openai.com/v1/chat/completions", { Authorization: `Bearer ${key}` },
        { model, messages, max_completion_tokens: LLM_OUT });
      return { text: d.choices?.[0]?.message?.content || "", tokensIn: d.usage?.prompt_tokens, tokensOut: d.usage?.completion_tokens };
    },
  },
  gemini: {
    label: "Google (Gemini)", hint: "AIza…", keys: "https://aistudio.google.com/apikey",
    note: "Les modèles Gemini. Avec une clé gratuite, Google peut utiliser les questions pour améliorer ses produits.",
    prefer: [/flash(?!-lite)/, /pro/],
    async models(key) {
      const d = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
      return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name)
        && !/(embedding|image|tts|audio|live)/.test(m.name))
        .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name })).sort((a, b) => b.id.localeCompare(a.id));
    },
    async chat(key, model, messages) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const d = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": key },
        { systemInstruction: { parts: [{ text: system }] },
          contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: "user", parts: [{ text: m.content }] })),
          generationConfig: { temperature: 0.1, maxOutputTokens: LLM_OUT, responseMimeType: "application/json" } });
      const parts = d.candidates?.[0]?.content?.parts || [];
      return { text: parts.filter((p) => !p.thought).map((p) => p.text || "").join(""),
        tokensIn: d.usageMetadata?.promptTokenCount, tokensOut: d.usageMetadata?.candidatesTokenCount };
    },
  },
};

const anthropicHeaders = (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });

/** A provider's refusal, in plain French. */
export class ProviderError extends Error {}
async function call(url, init) {
  let r;
  try { r = await fetch(url, { ...init, credentials: "omit", referrerPolicy: "no-referrer" }); } catch (e) {
    throw new ProviderError("Le fournisseur n'a pas répondu (réseau, ou appel refusé par le navigateur).");
  }
  const d = await r.json().catch(() => ({}));
  if (r.ok) return d;
  const detail = String(d?.error?.message || d?.error || d?.message || "").slice(0, 200);
  // (Google answers 400 « API key not valid » to a wrong key)
  throw new ProviderError(r.status === 401 || r.status === 403 || /api.?key/i.test(detail) ? `Clé refusée par le fournisseur${detail ? ` (${detail})` : ""}.`
    : r.status === 402 ? "Crédit épuisé chez le fournisseur."
    : r.status === 404 ? `Modèle inconnu du fournisseur${detail ? ` (${detail})` : ""}.`
    : r.status === 429 ? "Trop de demandes ou quota atteint chez le fournisseur : réessayez dans un moment."
    : `Le fournisseur a répondu ${r.status}${detail ? ` : ${detail}` : ""}.`);
}
const getJson = (url, headers) => call(url, { headers });
const postJson = (url, headers, body) => call(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

/** The model a provider's list suggests first: the newest of the first family that has one (the user may choose another). */
export function suggest(provider, models) {
  for (const re of PROVIDERS[provider]?.prefer || []) {
    const ms = models.filter((x) => re.test(x.id));
    if (ms.length) return ms.reduce((a, b) => ((b.created || 0) > (a.created || 0) ? b : a)).id;
  }
  return models[0]?.id || "";
}

// ---- the key and the choice, in this browser only ----------------------------------------------------------------------
/** { provider, key, model, remember } or null. */
export function loadChoice() {
  for (const s of [sessionStorage, localStorage]) {
    try { const v = JSON.parse(s.getItem(STORE) || "null"); if (v?.provider && v?.key) return v; } catch (e) { /* none */ }
  }
  return null;
}
export function saveChoice(v) {
  forgetChoice();
  try { (v.remember ? localStorage : sessionStorage).setItem(STORE, JSON.stringify(v)); } catch (e) { /* kept for the visit only */ }
}
export function forgetChoice() {
  for (const s of [sessionStorage, localStorage]) { try { s.removeItem(STORE); } catch (e) { /* nothing kept */ } }
}

// POST /api/ask — « IA » (pages/ask.js; owner 2026-10-15, every account since 2026-10-16): a question in, one
// DuckDB query and how to show it out. The language model runs on Workers AI (binding AI, the account's free daily
// allowance of 10 000 neurons; past it the calls fail until the next day, nothing is billed on the free plan). The browser
// runs the query on the published files (site_ask.py), so the model never sees the data. Nothing is stored.
// Body: { question, method, terrain, previous?: { question, sql }, failed?: { sql, error }, model? (administrators: a test),
// promptOnly? }. With promptOnly the model is not called: the answer is the messages themselves, for the browser to send to a
// model of the user's own choosing, with their own key (pages/ask.js, askbyok.js; owner, 2026-10-15) - the key never comes here.
import { allow, isAdmin, json, readBody, withUser } from "../_lib/api.js";
import { DEFAULT_MODEL, MODELS, NEURONS_PER_DOLLAR, parseAnswer, systemPrompt, userPrompt } from "../_lib/ask.js";

const PER_HOUR = 40, PER_HOUR_ADMIN = 200;      // questions an hour per account: a runaway loop cannot eat the day's quota
// and a day (UTC) per account on the free model, so that a few accounts cannot use up the whole site's allowance (~90 a
// day); administrators apart, and nothing counted for a model of one's own (promptOnly)
const PER_DAY = 15;

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const admin = isAdmin(env, user);
  const b = await readBody(request);
  const question = String(b?.question || "").trim().slice(0, 1000);
  if (!question) return json({ error: "question required" }, 400);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const messages = [
    { role: "system", content: systemPrompt({ licence: /^\d+$/.test(String(user.licence || "")) ? Number(user.licence) : null, today, method: b.method, terrain: b.terrain }) },
    { role: "user", content: userPrompt({ question, previous: b.previous, failed: b.failed }) },
  ];
  if (b.promptOnly) return json({ messages });            // the user's own model: no call here, no quota used
  if (!env.AI) return json({ error: "ai not bound" }, 500);
  if (!(await allow(env, `ask:${user.id}`, admin ? PER_HOUR_ADMIN : PER_HOUR, 3600))) return json({ error: "Trop de questions cette heure-ci." }, 429);
  if (!admin && !(await allow(env, `askday:${user.id}`, PER_DAY, 86400))) {
    return json({ error: `Vous avez posé ${PER_DAY} questions aujourd'hui au modèle gratuit d'O'CN : réessayez demain, ou utilisez votre propre clé d'API.` }, 429);
  }
  const model = b.model && MODELS[b.model] && admin ? b.model : DEFAULT_MODEL;
  const t0 = Date.now();
  let out;
  try {
    // gpt-oss reasons before it answers: « low » is enough for one query and halves the wait (administrators may test others)
    const effort = admin && ["low", "medium", "high"].includes(b.effort) ? b.effort : "low";
    out = await env.AI.run(model, { messages, max_tokens: 2500, temperature: 0.1, ...(model.includes("gpt-oss") ? { reasoning: { effort } } : {}) });
  } catch (e) {
    const msg = String(e?.message || e);
    const quota = /neuron|quota|limit|429|capacity/i.test(msg);
    return json({ error: quota ? "Le quota gratuit du jour est atteint : réessayez demain." : `Le modèle n'a pas répondu (${msg.slice(0, 200)}).` }, quota ? 429 : 502);
  }
  const text = out?.choices?.[0]?.message?.content ?? out?.response ?? (typeof out === "string" ? out : "");
  const answer = parseAnswer(typeof text === "string" ? text : JSON.stringify(text));
  const u = out?.usage || {};
  const [pin, pout] = MODELS[model];
  const dollars = ((u.prompt_tokens || 0) * pin + (u.completion_tokens || 0) * pout) / 1e6;
  const usage = { model, ms: Date.now() - t0, tokensIn: u.prompt_tokens ?? null, tokensOut: u.completion_tokens ?? null,
    neurons: Math.round(dollars * NEURONS_PER_DOLLAR) };
  if (!answer) return json({ error: "La réponse du modèle n'a pas pu être lue.", raw: String(text).slice(0, 2000), usage }, 502);
  return json({ answer, usage });
});

// The anonymised runners (administrators only; owner, 2026-10-15): a licensee who asks not to be shown, or a minor's legal
// representative, has their name and licence replaced all over the published site by a pseudonym (« Coureur anonyme 3 »,
// licence 90000003). The list lives in R2 (bucket cn-state, binding BUCKET), privacy/anonymized.json; the workflow copies
// it before each run, and the next run rebuilds the site data once with it (privacy.py, update.apply_privacy).
//   GET    /api/admin/anonymized                    { next, people: [{ lic, name, pseudo, since, note }] }
//   POST   /api/admin/anonymized  { lic, name, note? }   adds one (a pseudonym never given twice)
//   DELETE /api/admin/anonymized  { lic }                removes one: shown again at the next rebuild
import { json, readBody, withUser } from "../../_lib/api.js";

const KEY = "privacy/anonymized.json";
const BASE = 90000000;
const LIC = /^\d{1,7}$/;

async function read(env) {
  const o = await env.BUCKET.get(KEY);
  if (!o) return { next: 1, people: [] };
  try {
    const v = JSON.parse(await o.text());
    return { next: Number(v.next) || 1, people: Array.isArray(v.people) ? v.people : [] };
  } catch (e) {
    return { next: 1, people: [] };
  }
}
const write = (env, list) => env.BUCKET.put(KEY, JSON.stringify(list), { httpMetadata: { contentType: "application/json" } });
const paris = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

export const onRequestGet = withUser(async ({ env }) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  return json(await read(env));
}, { admin: true });

export const onRequestPost = withUser(async ({ request, env }) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const b = await readBody(request);
  const lic = String(b?.lic || "").trim().replace(/^0+(?=\d)/, "");
  const name = String(b?.name || "").trim().replace(/\s+/g, " ");
  const note = String(b?.note || "").trim().slice(0, 200);
  if (!LIC.test(lic) || !name || name.length > 80) return json({ error: "bad request" }, 400);
  const list = await read(env);
  if (list.people.some((p) => String(p.lic) === lic)) return json({ error: "already" }, 409);
  const n = Math.max(list.next, 1 + Math.max(0, ...list.people.map((p) => Number(p.pseudo) - BASE).filter(Number.isFinite)));
  list.people.push({ lic, name, pseudo: String(BASE + n), since: paris(), note });
  list.next = n + 1;
  await write(env, list);
  return json(list);
}, { admin: true });

export const onRequestDelete = withUser(async ({ request, env }) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const b = await readBody(request);
  const lic = String(b?.lic || "").trim();
  const list = await read(env);
  const before = list.people.length;
  list.people = list.people.filter((p) => String(p.lic) !== lic);
  if (list.people.length === before) return json({ error: "not found" }, 404);
  await write(env, list);                     // `next` kept: a pseudonym is never given to someone else
  return json(list);
}, { admin: true });

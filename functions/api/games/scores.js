// /api/games/scores — the games' palmarès: every game of « Jeux » and « Apprendre »'s test (owner, 2026-11-10: kept under the
// account's name when signed in, nothing kept otherwise; for each game, the account's 20 best runs and the 20 best of everyone).
//   GET ?game=<key>                 { mine: [run], all: [run] }, best first; a run { name, value, label, extra, at, mine }
//   POST { game, value, label, extra, higher }   records a finished run (120 an hour an account), answers as GET
// A game's key is the engine's (games/quiz.js `spec.key`: one per game and level, « maze-small »…; the test « learntest »). The
// run's `value` is the game's own score, the larger the better when `higher`, else the smaller; `label` the score as the game
// writes it, `extra` its settings (the test's time and what it shows). The name is the account's display name, read here, never
// sent by the page. Kept in R2 (cn-state): games/<key>/u/<account>.json (the account's 20) and games/<key>/top.json (everyone's
// 20, with each run's account number, which no answer gives); account deletion removes them (api/account/delete.js).
import { allow, json, nowIso, readBody, withUser } from "../../_lib/api.js";

const KEEP = 20;
const GAME = /^(contour|coursechoice|gaffle|forestroute|learntest|matching|photomemory|spot|trailo|updown|(learntest|mapmemory|maze|rapid|virtually)-[a-z]{1,12})$/;   // virtually-<race>: « Virtually »'s times (smaller is better)
const TOP = (g) => `games/${g}/top.json`, MINE = (g, uid) => `games/${g}/u/${uid}.json`;

async function read(env, key) {
  const o = await env.BUCKET.get(key);
  if (!o) return [];
  try { const v = await o.json(); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
const write = (env, key, runs) => env.BUCKET.put(key, JSON.stringify(runs), { httpMetadata: { contentType: "application/json" } });
const shown = (runs, uid) => runs.map(({ uid: u, higher, ...r }) => ({ ...r, mine: u === uid }));

async function answer(env, game, user) {
  const [mine, all] = await Promise.all([read(env, MINE(game, user.id)), read(env, TOP(game))]);
  return json({ mine: shown(mine, user.id), all: shown(all, user.id) }, 200, { "Cache-Control": "private, no-store" });
}

export const onRequestGet = withUser(async ({ request, env }, user) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const game = new URL(request.url).searchParams.get("game") || "";
  if (!GAME.test(game)) return json({ error: "bad request" }, 400);
  return answer(env, game, user);
});

export const onRequestPost = withUser(async ({ request, env }, user) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  if (user.demo_until) return json({ error: "demo" }, 403);
  if (!(await allow(env, `games:${user.id}`, 120, 3600))) return json({ error: "rate" }, 429);
  const b = await readBody(request);
  const game = String(b?.game || ""), value = Number(b?.value), higher = b?.higher !== false;
  if (!GAME.test(game) || !Number.isFinite(value) || Math.abs(value) > 1e13) return json({ error: "bad request" }, 400);
  const entry = { uid: user.id, name: String(user.display_name || "").slice(0, 80), value, higher,
    label: String(b?.label || "").slice(0, 60), extra: String(b?.extra || "").slice(0, 80), at: nowIso() };
  const better = (a, c) => (higher ? c.value - a.value : a.value - c.value) || a.at.localeCompare(c.at);
  for (const key of [MINE(game, user.id), TOP(game)]) {
    const runs = await read(env, key);
    runs.push(entry);
    runs.sort(better);
    if (runs.length > KEEP) runs.length = KEEP;
    if (runs.includes(entry)) await write(env, key, runs);
  }
  return answer(env, game, user);
});

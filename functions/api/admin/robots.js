// GET /api/admin/robots?days=30|90|365 — the admin page's « Robots » card (« Consommation »; owner, 2026-11-01): the AI bots
// Cloudflare blocked or let through, day by day and bot by bot, their latest requests, and the guest passes, from Ozimut's own
// copy (_lib/robots.js; migration 0020), brought up to date first when due. Administrators only.
import { json, withUser } from "../../_lib/api.js";
import { syncBots, isoDay } from "../../_lib/robots.js";

export const onRequestGet = withUser(async ({ request, env }) => {
  const n = [30, 90, 365].includes(Number(new URL(request.url).searchParams.get("days"))) ? Number(new URL(request.url).searchParams.get("days")) : 30;
  const state = await syncBots(env, { maxDays: 4, recent: true }).catch((e) => ({ error: String(e.message || e) }));
  if (state === null) return json({ tables: false });
  const days = Array.from({ length: n }, (_, i) => isoDay(Date.now() - (n - 1 - i) * 864e5)), first = days[0];
  const [rows, recent, guests, kept] = await env.DB.batch([
    env.DB.prepare("SELECT day, bot, action, source, n FROM bot_daily WHERE day >= ?").bind(first),
    env.DB.prepare("SELECT ts, bot, action, source, path, country FROM bot_recent ORDER BY ts DESC LIMIT 40"),
    env.DB.prepare("SELECT day, passes, failed, refused FROM guest_daily WHERE day >= ?").bind(first),
    env.DB.prepare("SELECT MIN(day) AS since FROM bot_daily"),
  ]);
  const at = new Map(days.map((d, i) => [d, i])), zero = () => days.map(() => 0);
  const blocked = zero(), allowed = zero(), other = zero(), bots = new Map(), sources = new Map();
  for (const r of rows.results) {
    const i = at.get(r.day);
    if (i == null) continue;
    if (!r.bot) { other[i] += r.n; continue; }
    const b = bots.get(r.bot) || { bot: r.bot, blocked: 0, allowed: 0, last: null };
    if (r.action === "allowed") { allowed[i] += r.n; b.allowed += r.n; }
    else { blocked[i] += r.n; b.blocked += r.n; sources.set(r.source || "", (sources.get(r.source || "") || 0) + r.n); }
    if (!b.last || r.day > b.last) b.last = r.day;
    bots.set(r.bot, b);
  }
  const g = { passes: zero(), failed: zero(), refused: zero() };
  for (const r of guests.results) { const i = at.get(r.day); if (i != null) for (const k of Object.keys(g)) g[k][i] = r[k] || 0; }
  return json({
    tables: true, days, since: kept.results[0]?.since || null,
    sync: { last: state.last || null, through: state.through || null, error: state.error || null, mode: state.mode || null,
      approx: !!state.approx, allowedErr: state.allowedErr || null, done: !!state.done },
    blocked, allowed, other, bots: [...bots.values()].sort((a, b) => b.blocked + b.allowed - a.blocked - a.allowed),
    sources: [...sources].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n),
    recent: recent.results, guests: g,
  });
}, { admin: true });

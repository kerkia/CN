// Outgoing e-mail through Resend's transactional API, with a daily and a monthly quota.
//
// Every e-mail of the site goes through here. sendOrQueue() sends at once while the quota allows and
// parks the message in mail_queue otherwise; flushQueue() (called by update.py through /api/notify,
// hourly) sends the backlog — account mails first — as the quota frees up, for as many days as needed.
//
//  * Account mails (priority 1: confirmation, reset, alerts to the administrator) may use the whole day's
//    quota; the others (digests, new-course alerts) stop ACCOUNT_EMAIL_RESERVE short of it, so a heavy
//    day of digests can never delay a password reset.
//  * A message is never given up because of a temporary problem (Resend down or rate-limiting, missing
//    key…): it stays queued. It is dropped only when the address or the content is refused for good, or
//    after 30 days.
//  * A link in a queued message (reset, confirmation) starts counting down when the message is sent, not
//    when it was requested: the token's expiry is reset at that moment (m.token = { hash, ttl }).
//
// Needs RESEND_API_KEY; without it everything simply waits in the queue.
// DEV_ECHO=1 (local .dev.vars only) prints messages to the console instead.

const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const monthStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(1); return d.getTime(); };
const dailyLimit = (env) => Number(env.DAILY_EMAIL_LIMIT) || 90;
const monthlyLimit = (env) => Number(env.MONTHLY_EMAIL_LIMIT) || 2900;
const reserve = (env) => (env.ACCOUNT_EMAIL_RESERVE != null && env.ACCOUNT_EMAIL_RESERVE !== "" ? Number(env.ACCOUNT_EMAIL_RESERVE) : 20);
const GIVE_UP_MS = 30 * 86400e3;

/**
 * How many e-mails may still go out today. priority >= 1 (account mails): the day's whole quota;
 * otherwise the quota less the reserve. Both are capped by what is left of the month's.
 */
export async function budgetLeft(env, priority = 1) {
  const row = await env.DB.prepare(
    "SELECT SUM(ts >= ?) AS today, COUNT(*) AS month FROM mail_log WHERE ts >= ?").bind(dayStart(), monthStart()).first();
  const cap = dailyLimit(env) - (priority >= 1 ? 0 : reserve(env));
  return Math.max(0, Math.min(cap - (row.today || 0), monthlyLimit(env) - row.month));
}

/** One delivery attempt. { ok, permanent, rateLimited } — permanent: retrying will not help. */
async function deliver(env, m) {
  if (env.DEV_ECHO === "1") { console.log(`[mail] to ${m.to} — ${m.subject}\n${m.text}\n`); return { ok: true }; }
  if (!env.RESEND_API_KEY) return { ok: false };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${env.MAIL_FROM_NAME || "O'CN"} <${env.MAIL_FROM}>`,
        to: [m.to], subject: m.subject, html: m.html, text: m.text,
      }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, permanent: r.status === 400 || r.status === 422, rateLimited: r.status === 429 };
  } catch (e) {
    return { ok: false };
  }
}

const logStatement = (env, kind) => env.DB.prepare("INSERT INTO mail_log (ts, kind) VALUES (?, ?)").bind(Date.now(), kind);
/** The link in a message that has just left starts its life now. */
const tokenStatement = (env, hash, ttl) => (hash && ttl
  ? [env.DB.prepare("UPDATE tokens SET expires_at = ? WHERE token_hash = ?").bind(Date.now() + ttl, hash)] : []);

const queue = (env, m) => env.DB.prepare(
  "INSERT INTO mail_queue (to_email, subject, html, text, kind, priority, created_at, token_hash, token_ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
).bind(m.to, m.subject, m.html, m.text, m.kind, m.priority ?? 0, Date.now(), m.token?.hash ?? null, m.token?.ttl ?? null);

export const queueStatement = queue;

/** m: { to, subject, html, text, kind, priority, token?: { hash, ttl } }. -> "sent" | "queued". */
export async function sendOrQueue(env, m) {
  if ((await budgetLeft(env, m.priority ?? 0)) > 0) {
    const r = await deliver(env, m);
    if (r.ok) {
      await env.DB.batch([logStatement(env, m.kind), ...tokenStatement(env, m.token?.hash, m.token?.ttl)]);
      return "sent";
    }
  }
  await queue(env, m).run();
  return "queued";
}

/** Send up to `max` queued messages that fit in today's quota. -> { sent, remaining, budget } */
export async function flushQueue(env, max = 25) {
  let b1 = await budgetLeft(env, 1), b0 = await budgetLeft(env, 0);     // room for account mails / for the others
  let sent = 0;
  const stmts = [];
  if (b1 > 0) {
    const { results } = await env.DB.prepare("SELECT * FROM mail_queue ORDER BY priority DESC, id LIMIT ?").bind(max).all();
    for (const m of results) {
      const account = m.priority >= 1;
      if (account ? b1 <= 0 : (b0 <= 0 || b1 <= 0)) continue;           // no room for this kind of mail today
      const r = await deliver(env, { to: m.to_email, subject: m.subject, html: m.html, text: m.text });
      if (r.ok) {
        stmts.push(logStatement(env, m.kind), env.DB.prepare("DELETE FROM mail_queue WHERE id = ?").bind(m.id),
          ...tokenStatement(env, m.token_hash, m.token_ttl));
        b1--; b0 = Math.max(0, b0 - 1); sent++;
      } else if (r.permanent) {
        stmts.push(env.DB.prepare("DELETE FROM mail_queue WHERE id = ?").bind(m.id));     // refused for good: nothing to retry
      } else {
        stmts.push(env.DB.prepare("UPDATE mail_queue SET attempts = attempts + 1 WHERE id = ?").bind(m.id));
        if (r.rateLimited) break;                                       // Resend says stop: try again at the next run
      }
    }
  }
  stmts.push(env.DB.prepare("DELETE FROM mail_queue WHERE created_at < ?").bind(Date.now() - GIVE_UP_MS));
  await env.DB.batch(stmts);
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue").first();
  return { sent, remaining: rest.n, budget: b1 };
}

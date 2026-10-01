// Outgoing e-mail through Resend's transactional API, with a daily and a monthly quota.
//
// sendOrQueue() sends at once while today's quota allows and parks the message in
// mail_queue otherwise; flushQueue() (called by update.py through /api/notify)
// sends the backlog, account mails first, as the next day's quota frees up.
// Needs RESEND_API_KEY; without it everything simply waits in the queue.
// DEV_ECHO=1 (local .dev.vars only) prints messages to the console instead.

const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const monthStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(1); return d.getTime(); };
const dailyLimit = (env) => Number(env.DAILY_EMAIL_LIMIT) || 90;
const monthlyLimit = (env) => Number(env.MONTHLY_EMAIL_LIMIT) || 2900;

/** How many e-mails may still go out today: the daily quota, capped by what is left of the month's. */
export async function budgetLeft(env) {
  const row = await env.DB.prepare(
    "SELECT SUM(ts >= ?) AS today, COUNT(*) AS month FROM mail_log WHERE ts >= ?").bind(dayStart(), monthStart()).first();
  return Math.max(0, Math.min(dailyLimit(env) - (row.today || 0), monthlyLimit(env) - row.month));
}

/** One delivery attempt. { ok, permanent } — permanent means retrying will not help. */
async function deliver(env, m) {
  if (env.DEV_ECHO === "1") { console.log(`[mail] to ${m.to} — ${m.subject}\n${m.text}\n`); return { ok: true }; }
  if (!env.RESEND_API_KEY) return { ok: false, permanent: false };
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
    return { ok: false, permanent: r.status === 400 || r.status === 422 };    // bad address or payload
  } catch (e) {
    return { ok: false, permanent: false };
  }
}

const queue = (env, m) => env.DB.prepare(
  "INSERT INTO mail_queue (to_email, subject, html, text, kind, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
).bind(m.to, m.subject, m.html, m.text, m.kind, m.priority ?? 0, Date.now());

export const queueStatement = queue;

/** m: { to, subject, html, text, kind, priority }. -> "sent" | "queued". */
export async function sendOrQueue(env, m) {
  if ((await budgetLeft(env)) > 0) {
    const r = await deliver(env, m);
    if (r.ok) {
      await env.DB.prepare("INSERT INTO mail_log (ts, kind) VALUES (?, ?)").bind(Date.now(), m.kind).run();
      return "sent";
    }
  }
  await queue(env, m).run();
  return "queued";
}

/** Send up to `max` queued messages that fit in today's quota. -> { sent, remaining, budget } */
export async function flushQueue(env, max = 25) {
  const room = Math.min(max, await budgetLeft(env));
  let sent = 0;
  if (room > 0) {
    const { results } = await env.DB.prepare(
      "SELECT * FROM mail_queue ORDER BY priority DESC, id LIMIT ?").bind(room).all();
    const done = [], dropped = [], failed = [];
    for (const m of results) {
      const r = await deliver(env, { to: m.to_email, subject: m.subject, html: m.html, text: m.text });
      if (r.ok) done.push(m); else if (r.permanent || m.attempts >= 5) dropped.push(m); else failed.push(m);
    }
    const stmts = [
      ...done.map((m) => env.DB.prepare("INSERT INTO mail_log (ts, kind) VALUES (?, ?)").bind(Date.now(), m.kind)),
      ...[...done, ...dropped].map((m) => env.DB.prepare("DELETE FROM mail_queue WHERE id = ?").bind(m.id)),
      ...failed.map((m) => env.DB.prepare("UPDATE mail_queue SET attempts = attempts + 1 WHERE id = ?").bind(m.id)),
    ];
    if (stmts.length) await env.DB.batch(stmts);
    sent = done.length;
  }
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue").first();
  return { sent, remaining: rest.n, budget: await budgetLeft(env) };
}

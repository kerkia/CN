// Outgoing e-mail: Resend's free plan first, Scaleway's Transactional Email (TEM) beyond it (owner, 2026-11-01).
//
// Every e-mail of the site goes through here. sendOrQueue() sends at once when a provider may take it and parks the
// message in mail_queue otherwise; flushQueue() (called by update.py through /api/notify, hourly, and by Santé's
// announcements) sends the backlog as the providers allow.
//
//  * Resend comes first, within its free plan's daily and monthly quotas (DAILY_EMAIL_LIMIT, MONTHLY_EMAIL_LIMIT). Account
//    mails (priority 1: confirmation, reset, alerts to the administrators) may use the whole day's quota; the others
//    (digests, alerts) stop ACCOUNT_EMAIL_RESERVE short of it.
//  * Scaleway TEM takes what Resend cannot: at once for the urgent mails (URGENT: the registration's confirmation and the
//    password reset) and for the contact form (sendNow, which cannot wait), else only once a message has waited
//    RESEND_WAIT_HOURS (48) for Resend's quota to come back. Bounded by TEM_MONTHLY_LIMIT (Scaleway's monthly quota: 50 000
//    for an organisation whose identity is validated).
//  * A message is never given up because of a temporary problem (a provider down or rate-limiting, a missing key…): it
//    stays queued. It is dropped only when Resend refuses the address or the content for good, or after 30 days. A refusal
//    by Scaleway leaves it for Resend's next quota.
//  * A link in a queued message (reset, confirmation) starts counting down when the message is sent, not when it was
//    requested: the token's expiry is reset at that moment (m.token = { hash, ttl }).
//  * mail_log records each e-mail sent with its provider (migration 0021; NULL before: Resend's).
//
// Needs RESEND_API_KEY; Scaleway needs SCW_SECRET_KEY (a Pages secret: an IAM API key allowed to send) and SCW_PROJECT_ID.
// A provider without its key is skipped. DEV_ECHO=1 (local .dev.vars only) prints messages to the console instead, under
// the provider that would have sent them.

const RESEND = "resend", TEM = "tem";
const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const monthStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(1); return d.getTime(); };
const num = (v, dflt) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : dflt);
const dailyLimit = (env) => num(env.DAILY_EMAIL_LIMIT, 90);
const monthlyLimit = (env) => num(env.MONTHLY_EMAIL_LIMIT, 2900);
const reserve = (env) => num(env.ACCOUNT_EMAIL_RESERVE, 20);
const temMonthly = (env) => num(env.TEM_MONTHLY_LIMIT, 50000);
const waitMs = (env) => num(env.RESEND_WAIT_HOURS, 48) * 3600e3;
const GIVE_UP_MS = 30 * 86400e3;
/** The mails that never wait for Resend's quota: the registration's and the password's. */
export const URGENT = new Set(["verify", "reset"]);

const echo = (env) => env.DEV_ECHO === "1";
const hasResend = (env) => echo(env) || !!env.RESEND_API_KEY;
const hasTem = (env) => echo(env) || !!(env.SCW_SECRET_KEY && env.SCW_PROJECT_ID);

/**
 * What each provider may still take: Resend today for account mails (r1) and for the others (r0), both capped by the
 * month's; Scaleway this month (tem). Flags set during a run: a provider that answered « too many » is left alone.
 */
async function budgets(env) {
  const row = await env.DB.prepare(
    "SELECT SUM(ts >= ? AND provider IS NOT 'tem') AS today, SUM(provider IS NOT 'tem') AS month, SUM(provider = 'tem') AS tem " +
    "FROM mail_log WHERE ts >= ?").bind(dayStart(), monthStart()).first();
  const left = (cap) => Math.max(0, Math.min(cap - (row?.today || 0), monthlyLimit(env) - (row?.month || 0)));
  return {
    r1: hasResend(env) ? left(dailyLimit(env)) : 0,
    r0: hasResend(env) ? left(dailyLimit(env) - reserve(env)) : 0,
    tem: hasTem(env) ? Math.max(0, temMonthly(env) - (row?.tem || 0)) : 0,
    resendStop: false, temStop: false,
  };
}

const withReplyTo = (env, m) => ({ ...m, replyTo: m.replyTo || env.REPLY_TO || null });   // replies go to a mailbox someone reads (contact@)

function echoed(provider, m) {
  console.log(`[mail ${provider}] to ${m.to} — ${m.subject}${m.replyTo ? ` (reply to ${m.replyTo})` : ""}\n${m.text}\n` +
    (m.attachments?.length ? `[attachments] ${m.attachments.map((a) => `${a.filename} (${Math.round(a.content.length * 0.75 / 1024)} Ko)`).join(", ")}\n` : ""));
  return { ok: true };
}

/** One delivery attempt through Resend. { ok, permanent, rateLimited } — permanent: retrying will not help. */
async function viaResend(env, m) {
  if (echo(env)) return echoed(RESEND, m);
  if (!env.RESEND_API_KEY) return { ok: false };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${env.MAIL_FROM_NAME || "Ozimut"} <${env.MAIL_FROM}>`,
        to: [m.to], subject: m.subject, html: m.html, text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),   // [{ filename, content: base64 }]
      }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, permanent: r.status === 400 || r.status === 422, rateLimited: r.status === 429,
      detail: `${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}` };
  } catch (e) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

// The attachments Scaleway accepts (its « capabilities and limits » page), by the file's extension; its API takes 2 MB a
// message, attachments included
const TEM_TYPES = {
  csv: "text/csv", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif", htm: "text/html", html: "text/html", ics: "text/calendar", jpeg: "image/jpeg", jpg: "image/jpeg",
  mp3: "audio/mpeg", ods: "application/vnd.oasis.opendocument.spreadsheet", pdf: "application/pdf", png: "image/png",
  svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", txt: "text/plain", log: "text/plain", wav: "audio/wav",
  webp: "image/webp", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
};
const TEM_MAX_BYTES = 1.9 * 1024 * 1024;

/** The attachments as Scaleway takes them, or null when one of them (or their size) it would refuse. */
function temAttachments(m) {
  const list = m.attachments || [];
  let size = (m.html?.length || 0) + (m.text?.length || 0);
  const out = [];
  for (const a of list) {
    const type = TEM_TYPES[String(a.filename || "").toLowerCase().split(".").pop()];
    if (!type) return null;
    size += a.content.length;
    out.push({ name: a.filename, type, content: a.content });
  }
  return size > TEM_MAX_BYTES ? null : out;
}

/** One delivery attempt through Scaleway TEM. { ok, rateLimited } — never permanent: Resend may still take it. */
async function viaTem(env, m) {
  const attachments = temAttachments(m);
  if (!attachments) return { ok: false, skipped: true };
  if (echo(env)) return echoed(TEM, m);
  if (!env.SCW_SECRET_KEY || !env.SCW_PROJECT_ID) return { ok: false };
  try {
    const r = await fetch(`https://api.scaleway.com/transactional-email/v1alpha1/regions/${env.SCW_REGION || "fr-par"}/emails`, {
      method: "POST",
      headers: { "X-Auth-Token": env.SCW_SECRET_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "Ozimut" },
        to: [{ email: m.to }], subject: m.subject, html: m.html, text: m.text, project_id: env.SCW_PROJECT_ID,
        ...(m.replyTo ? { additional_headers: [{ key: "Reply-To", value: m.replyTo }] } : {}),
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    if (r.ok) return { ok: true };
    const detail = `${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`;
    console.log(`[mail tem] ${detail}`);
    return { ok: false, rateLimited: r.status === 429, detail };
  } catch (e) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

/**
 * Send one message by the first provider that may take it. b: budgets(), updated. now: may not wait (urgent, or the contact
 * form). age: how long it has waited in the queue. -> { ok, provider, permanent, tried }.
 */
async function route(env, m, b, { now = false, age = 0 } = {}) {
  m = withReplyTo(env, m);
  const account = (m.priority ?? 0) >= 1 || now;
  let tried = false;
  if (!b.resendStop && (account ? b.r1 : b.r0) > 0) {
    tried = true;
    const r = await viaResend(env, m);
    if (r.ok) { b.r1--; b.r0 = Math.max(0, b.r0 - 1); return { ok: true, provider: RESEND }; }
    if (r.permanent) return { ok: false, permanent: true, tried };
    if (r.rateLimited) b.resendStop = true;
  }
  const mayWait = !now && !URGENT.has(m.kind) && age < waitMs(env);
  if (mayWait || b.temStop || b.tem <= 0) return { ok: false, tried };
  const r = await viaTem(env, m);
  if (r.ok) { b.tem--; return { ok: true, provider: TEM }; }
  if (r.rateLimited) b.temStop = true;
  return { ok: false, tried: tried || !r.skipped };
}

const logStatement = (env, kind, provider) =>
  env.DB.prepare("INSERT INTO mail_log (ts, kind, provider) VALUES (?, ?, ?)").bind(Date.now(), kind, provider);
/** The link in a message that has just left starts its life now. */
const tokenStatement = (env, hash, ttl) => (hash && ttl
  ? [env.DB.prepare("UPDATE tokens SET expires_at = ? WHERE token_hash = ?").bind(Date.now() + ttl, hash)] : []);

const queue = (env, m) => env.DB.prepare(
  "INSERT INTO mail_queue (to_email, subject, html, text, kind, priority, created_at, token_hash, token_ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
).bind(m.to, m.subject, m.html, m.text, m.kind, m.priority ?? 0, Date.now(), m.token?.hash ?? null, m.token?.ttl ?? null);

export const queueStatement = queue;

/**
 * Send at once or fail - never queued (the queue keeps no attachments). For messages to the administrator:
 * m: { to, subject, html, text, kind, replyTo?, attachments?: [{ filename, content: base64 }] }.
 * -> "sent" | "quota" (no provider may take it) | "failed".
 */
export async function sendNow(env, m) {
  const b = await budgets(env);
  if (b.r1 <= 0 && b.tem <= 0) return "quota";
  const r = await route(env, m, b, { now: true });
  if (!r.ok) return "failed";
  await logStatement(env, m.kind, r.provider).run();
  return "sent";
}

/**
 * The admin page's test (owner, 2026-11-03): one message through the provider named, whatever the quotas, never queued, so
 * that a provider's key and domain can be checked (a renewed Scaleway key, say). -> { ok, detail? } (detail: the provider's
 * answer when it refused, « missing » without its key).
 */
export async function sendTest(env, provider, m) {
  const tem = provider === TEM;
  if (!(tem ? hasTem(env) : hasResend(env))) return { ok: false, detail: "missing" };
  const r = await (tem ? viaTem : viaResend)(env, withReplyTo(env, m));
  if (r.ok) await logStatement(env, m.kind, tem ? TEM : RESEND).run();
  return { ok: !!r.ok, detail: r.detail };
}

/** m: { to, subject, html, text, kind, priority, token?: { hash, ttl } }. -> "sent" | "queued". */
export async function sendOrQueue(env, m) {
  const r = await route(env, m, await budgets(env));
  if (r.ok) {
    await env.DB.batch([logStatement(env, m.kind, r.provider), ...tokenStatement(env, m.token?.hash, m.token?.ttl)]);
    return "sent";
  }
  await queue(env, m).run();
  return "queued";
}

/**
 * Send up to `max` queued messages that a provider may take now: the urgent ones first, then those that waited long enough
 * for Scaleway, then by priority and age. -> { sent, remaining, budget } (budget: Resend's room left today).
 */
export async function flushQueue(env, max = 25) {
  const b = await budgets(env);
  const t = Date.now(), ripe = t - waitMs(env);
  let sent = 0;
  const stmts = [];
  const urgent = [...URGENT].map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT * FROM mail_queue ORDER BY kind IN (${urgent}) DESC, created_at <= ? DESC, priority DESC, id LIMIT ?`)
    .bind(...URGENT, ripe, max).all();
  for (const m of results) {
    if ((b.resendStop || b.r1 <= 0) && (b.temStop || b.tem <= 0)) break;    // nobody may take anything more today
    const r = await route(env, { to: m.to_email, subject: m.subject, html: m.html, text: m.text, kind: m.kind, priority: m.priority },
      b, { age: t - m.created_at });
    if (r.ok) {
      stmts.push(logStatement(env, m.kind, r.provider), env.DB.prepare("DELETE FROM mail_queue WHERE id = ?").bind(m.id),
        ...tokenStatement(env, m.token_hash, m.token_ttl));
      sent++;
    } else if (r.permanent) {
      stmts.push(env.DB.prepare("DELETE FROM mail_queue WHERE id = ?").bind(m.id));     // refused for good: nothing to retry
    } else if (r.tried) {
      stmts.push(env.DB.prepare("UPDATE mail_queue SET attempts = attempts + 1 WHERE id = ?").bind(m.id));
    }
  }
  stmts.push(env.DB.prepare("DELETE FROM mail_queue WHERE created_at < ?").bind(t - GIVE_UP_MS));
  await env.DB.batch(stmts);
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue").first();
  return { sent, remaining: rest.n, budget: b.r1 };
}

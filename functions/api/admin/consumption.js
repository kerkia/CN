// GET /api/admin/consumption — the site's use of its free plans, for the admin page's « Consommation » tab (owner, 2026-10-20):
// each measure day by day over the last 30 days (or its value now), with the plan's limit.
//   From D1 (always): e-mails sent (mail_log, the UTC days the Resend quota counts), e-mails waiting, accounts.
//   From Cloudflare's analytics (when the Pages secret CF_ANALYTICS_TOKEN is set — a read-only API token with « Account
//   Analytics: Read », « D1: Read » and « Cloudflare Pages: Read »; the account id from CF_ACCOUNT_ID, else the token's only
//   account): requests to the Functions and Workers, Durable Objects, Workers AI neurons, D1 rows and size, R2 storage and
//   operations, Pages deployments this month. Each source is asked on its own: one that fails says why, the others still show.
import { json, withUser } from "../../_lib/api.js";

const API = "https://api.cloudflare.com/client/v4";
const DAYS = 30;
const GB = 1024 ** 3;
// The free plans' limits (2026; checked by hand on Cloudflare's and Resend's pricing pages: change them here if they move)
const LIMITS = {
  requests: 100000,          // Workers + Pages Functions, a day, for the whole account
  durable: 100000,           // Durable Objects requests, a day
  neurons: 10000,            // Workers AI, a day
  d1Read: 5000000, d1Write: 100000,      // rows a day
  d1Size: 0.5 * GB,          // a database
  r2Size: 10 * GB, r2A: 1000000, r2B: 10000000,      // storage; class A and B operations a month
  deploys: 500,              // Pages, a month
};
// R2's operations by class (Cloudflare's pricing page); the others (deletes, aborts) are free
const R2_A = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload",
  "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "ListMultipartUploads", "ListParts", "PutBucketEncryption", "PutBucketCors",
  "PutBucketLifecycleConfiguration", "LifecycleStorageTierTransition"]);
const R2_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors",
  "GetBucketLifecycleConfiguration"]);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const lastDays = () => Array.from({ length: DAYS }, (_, i) => isoDay(Date.now() - (DAYS - 1 - i) * 864e5));
const monthStart = () => `${isoDay(Date.now()).slice(0, 7)}-01`;
/** Values by day -> the list over `days` (0 where none). */
const onDays = (days, byDay) => days.map((d) => byDay.get(d) || 0);

async function cf(env, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok || body?.success === false) throw new Error(body?.errors?.[0]?.message || `HTTP ${r.status}`);
  return body;
}
/** One GraphQL dataset of the account: its rows, or an error. */
async function gql(env, account, field, selection, filter) {
  const query = `query($a: string!, $f: Json!) { viewer { accounts(filter: { accountTag: $a }) { ${field}(limit: 10000, filter: $f) { ${selection} } } } }`;
  const body = await cf(env, "/graphql", { method: "POST", body: JSON.stringify({ query, variables: { a: account, f: filter } }) });
  if (body?.errors?.length) throw new Error(body.errors[0].message);
  return body?.data?.viewer?.accounts?.[0]?.[field] || [];
}
/** Sum a dataset's rows by date (`pick` the number of a row). */
const byDate = (rows, pick) => {
  const m = new Map();
  for (const r of rows) m.set(r.dimensions.date, (m.get(r.dimensions.date) || 0) + (pick(r) || 0));
  return m;
};
const settle = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e.message || e).slice(0, 200) }; } };

export const onRequestGet = withUser(async ({ env }) => {
  const days = lastDays(), first = days[0], last = days[days.length - 1];
  const out = { days, limits: LIMITS, mail: {}, cloudflare: null };

  // from D1: the e-mails (mail_log is never pruned) and the accounts
  const since = Date.parse(`${first}T00:00:00Z`);
  const [mails, month, queued, accounts] = await env.DB.batch([
    env.DB.prepare("SELECT ts FROM mail_log WHERE ts >= ?").bind(since),
    env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE ts >= ?").bind(Date.parse(`${monthStart()}T00:00:00Z`)),
    env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue"),
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(created_at >= ?) AS recent FROM users WHERE email_verified = 1 AND demo_until IS NULL").bind(first),
  ]);
  const mailBy = new Map();
  for (const r of mails.results) { const d = isoDay(r.ts); mailBy.set(d, (mailBy.get(d) || 0) + 1); }
  out.mail = { daily: onDays(days, mailBy), month: month.results[0].n, queued: queued.results[0].n,
    dayLimit: Number(env.DAILY_EMAIL_LIMIT) || 90, monthLimit: Number(env.MONTHLY_EMAIL_LIMIT) || 2900 };
  out.accounts = { confirmed: accounts.results[0].n || 0, recent: accounts.results[0].recent || 0 };

  if (!env.CF_ANALYTICS_TOKEN) return json({ ...out, cloudflare: { error: "no token" } });
  const account = env.CF_ACCOUNT_ID || await settle(async () => (await cf(env, "/accounts?per_page=5")).result?.[0]?.id);
  if (!account || account.error) return json({ ...out, cloudflare: { error: account?.error || "no account" } });
  const range = { date_geq: first, date_leq: last };
  const [workers, pages, durable, ai, d1, r2ops, r2size, d1size, deploys] = await Promise.all([
    settle(async () => onDays(days, byDate(await gql(env, account, "workersInvocationsAdaptive", "sum { requests } dimensions { date }", range), (r) => r.sum.requests))),
    settle(async () => onDays(days, byDate(await gql(env, account, "pagesFunctionsInvocationsAdaptiveGroups", "sum { requests } dimensions { date }", range), (r) => r.sum.requests))),
    settle(async () => onDays(days, byDate(await gql(env, account, "durableObjectsInvocationsAdaptiveGroups", "sum { requests } dimensions { date }", range), (r) => r.sum.requests))),
    settle(async () => onDays(days, byDate(await gql(env, account, "aiInferenceAdaptiveGroups", "sum { totalNeurons } dimensions { date }", range), (r) => r.sum.totalNeurons))),
    settle(async () => {
      const rows = await gql(env, account, "d1AnalyticsAdaptiveGroups", "sum { rowsRead rowsWritten } dimensions { date }", range);
      return { read: onDays(days, byDate(rows, (r) => r.sum.rowsRead)), written: onDays(days, byDate(rows, (r) => r.sum.rowsWritten)) };
    }),
    settle(async () => {
      const rows = await gql(env, account, "r2OperationsAdaptiveGroups", "sum { requests } dimensions { date actionType }", { date_geq: monthStart(), date_leq: last });
      let a = 0, b = 0;
      for (const r of rows) { if (R2_A.has(r.dimensions.actionType)) a += r.sum.requests; else if (R2_B.has(r.dimensions.actionType)) b += r.sum.requests; }
      return { a, b };
    }),
    settle(async () => {
      const rows = await gql(env, account, "r2StorageAdaptiveGroups", "max { payloadSize metadataSize objectCount } dimensions { date }", range);
      const by = new Map();
      for (const r of rows) by.set(r.dimensions.date, (by.get(r.dimensions.date) || 0) + (r.max.payloadSize || 0) + (r.max.metadataSize || 0));
      return onDays(days, by);
    }),
    settle(async () => {
      const list = (await cf(env, `/accounts/${account}/d1/database?per_page=50`)).result || [];
      return list.map((d) => ({ name: d.name, bytes: Number(d.file_size) || 0 }));
    }),
    settle(async () => {
      // the deployments of this month, newest first, a page of 25 at a time (10 pages at most)
      const from = Date.parse(`${monthStart()}T00:00:00Z`);
      let n = 0;
      for (let page = 1; page <= 10; page++) {
        const rows = (await cf(env, `/accounts/${account}/pages/projects/observatoire-cn/deployments?per_page=25&page=${page}`)).result || [];
        const fresh = rows.filter((d) => Date.parse(d.created_on) >= from);
        n += fresh.length;
        if (fresh.length < rows.length || rows.length < 25) break;
      }
      return n;
    }),
  ]);
  const add = (x, y) => (Array.isArray(x) && Array.isArray(y) ? x.map((v, i) => v + y[i]) : Array.isArray(x) ? x : y);
  out.cloudflare = { requests: workers.error && pages.error ? { error: workers.error } : add(workers.error ? null : workers, pages.error ? null : pages),
    requestsNote: workers.error || pages.error || null, durable, neurons: ai, d1, r2ops, r2size, d1size, deploys };
  return json(out);
}, { admin: true });

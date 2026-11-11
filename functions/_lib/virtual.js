// « Virtually »'s runs (api/virtual): a runner is told apart in the results by a hash of their account's number, never the
// number itself.

/** The account's hash in the results (12 hex digits of SHA-256 over the account's number and the site's secret). */
export async function runnerHash(env, uid) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`virtually|${uid}|${env.SESSION_SECRET || ""}`));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

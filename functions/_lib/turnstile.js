// Cloudflare Turnstile on registration (owner, 2026-10-20: once anyone may sign up, a script could create accounts by the
// hundred, each costing a confirmation e-mail out of Resend's 100 a day). The form shows Cloudflare's widget, which hands the
// browser a token; the server asks Cloudflare whether it is genuine. Keys: TURNSTILE_SITE_KEY (wrangler.toml, public) and
// TURNSTILE_SECRET (a Pages secret); without both, the check is off and the form shows no widget.

export const turnstileOn = (env) => !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);

/** Is the widget's token genuine? true when the check is off; false when Cloudflare cannot be reached. */
export async function turnstileOk(env, token, ip) {
  if (!turnstileOn(env)) return true;
  if (!token || String(token).length > 2048) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(token));
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}

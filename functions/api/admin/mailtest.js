// POST /api/admin/mailtest { provider: "resend" | "tem" } — the admin page's test (Consommation): one e-mail to the
// administrator's own address through the provider named, whatever the quotas (_lib/mail.js sendTest). Answers the
// provider's refusal as it came, so that a wrong key, project or domain shows on the page.
import { allow, json, readBody, withUser } from "../../_lib/api.js";
import { sendTest } from "../../_lib/mail.js";
import { testMail } from "../../_lib/templates.js";

export const onRequestPost = withUser(async ({ request, env }, admin) => {
  const b = await readBody(request);
  const provider = b?.provider === "tem" ? "tem" : b?.provider === "resend" ? "resend" : null;
  if (!provider) return json({ error: "bad request" }, 400);
  if (!(await allow(env, `mailtest:${admin.id}`, 10, 3600))) return json({ error: "rate" }, 429);
  const r = await sendTest(env, provider, { to: admin.email, ...testMail(env, admin, provider), kind: "test" });
  return json({ ok: r.ok, to: admin.email, detail: r.detail || null });
}, { admin: true });

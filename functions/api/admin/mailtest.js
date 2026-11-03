// The admin page's test (Consommation): one e-mail through the provider named, whatever the quotas (_lib/mail.js sendTest).
//   GET  -> { from, to, subject, text, domain }: what the form starts with (the site's sender, the administrator's address,
//           the generic test e-mail in their language).
//   POST { provider: "resend" | "tem", from, to, subject, text } -> { ok, to, detail? }: the provider's refusal as it came,
//           so that a wrong key, project or domain shows on the page. The sender must be an address of the site's own domain
//           (the one the providers verified); the subject at least 10 characters (Scaleway refuses shorter ones).
import { allow, json, readBody, withUser } from "../../_lib/api.js";
import { sendTest } from "../../_lib/mail.js";
import { plainMail, testMail } from "../../_lib/templates.js";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const domainOf = (env) => String(env.MAIL_FROM || "").split("@")[1]?.toLowerCase() || "";

export const onRequestGet = withUser(async ({ env }, admin) => {
  const m = testMail(admin);
  return json({ from: env.MAIL_FROM, to: admin.email, subject: m.subject, text: m.text, domain: domainOf(env) });
}, { admin: true });

export const onRequestPost = withUser(async ({ request, env }, admin) => {
  const b = await readBody(request);
  const provider = b?.provider === "tem" ? "tem" : b?.provider === "resend" ? "resend" : null;
  if (!provider) return json({ error: "bad request" }, 400);
  const from = String(b.from || env.MAIL_FROM || "").trim().toLowerCase();
  const to = String(b.to || admin.email).trim();
  const subject = String(b.subject || "").trim().slice(0, 200);
  const text = String(b.text || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);
  if (!EMAIL.test(from) || from.split("@")[1] !== domainOf(env)) return json({ error: "from", domain: domainOf(env) }, 422);
  if (!EMAIL.test(to)) return json({ error: "to" }, 422);
  if (subject.length < 10) return json({ error: "subject" }, 422);
  if (!text) return json({ error: "text" }, 422);
  if (!(await allow(env, `mailtest:${admin.id}`, 10, 3600))) return json({ error: "rate" }, 429);
  const r = await sendTest(env, provider, { from, to, ...plainMail(env, subject, text, admin.lang), kind: "test" });
  return json({ ok: r.ok, to, detail: r.detail || null });
}, { admin: true });

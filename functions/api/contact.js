// POST /api/contact { category, subject, html, text, from, browser, attachments: [{ name, data }] } — logged-in only.
// Sends the message to the administrator (ADMIN_EMAILS, never shown to the visitor); replies go to the sender.
// Attachments arrive in base64 and go to Resend as they are: nothing is decoded here (the free plan allows about
// 10 ms of CPU per request), hence the size cap. Pasted pictures come as attachments too (see pages/contact.js).
import { adminEmails, allow, json, readBody, withUser } from "../_lib/api.js";
import { sendNow } from "../_lib/mail.js";
import { contactMail } from "../_lib/templates.js";

export const CATEGORIES = { bug: "Bug", aide: "Demande d'aide", idee: "Idée, nouvelle fonction", avis: "Avis" };
const MAX_FILES = 10;
const MAX_BASE64 = Math.ceil((4 * 1024 * 1024 * 4) / 3) + 1024;   // 4 Mo of files once decoded

/** Keep the formatting tags of the editor only: no scripts, styles, frames, event handlers or script links. */
function clean(html) {
  return String(html || "").slice(0, 200000)
    .replace(/<(script|style|iframe|object|embed|form|svg|math)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?!(?:p|br|div|span|b|strong|i|em|u|s|ul|ol|li|a|blockquote|pre|code|h[1-4])\b)[a-z][^>]*>/gi, "")
    .replace(/\s(?:on\w+|style|class|id|srcset|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*("|')\s*(?!https?:|mailto:)[^"']*\1/gi, "");
}

export const onRequestPost = withUser(async ({ request, env }, user) => {
  if (!(await allow(env, `contact:${user.id}`, 5, 3600))) return json({ error: "rate" }, 429);
  const b = await readBody(request);
  const category = CATEGORIES[b?.category] ? b.category : null;
  const subject = String(b?.subject || "").trim().slice(0, 150);
  const text = String(b?.text || "").trim().slice(0, 50000);
  if (!category || !subject || !text) return json({ error: "fields" }, 422);
  const files = Array.isArray(b.attachments) ? b.attachments : [];
  if (files.length > MAX_FILES) return json({ error: "files" }, 413);
  let size = 0;
  const attachments = [];
  for (const f of files) {
    const data = typeof f?.data === "string" ? f.data : "";
    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 100))) return json({ error: "files" }, 422);
    size += data.length;
    if (size > MAX_BASE64) return json({ error: "size" }, 413);
    attachments.push({ filename: String(f.name || "fichier").replace(/[\r\n"\\/]/g, "_").slice(0, 120), content: data });
  }
  const to = adminEmails(env)[0];
  if (!to) return json({ error: "unavailable" }, 503);
  const mail = contactMail(env, user, {
    category: CATEGORIES[category], subject, html: clean(b.html), text,
    from: String(b.from || "").slice(0, 300), browser: String(b.browser || "").slice(0, 300),
    files: attachments.map((a) => a.filename),
  });
  const res = await sendNow(env, { to, replyTo: user.email, ...mail, attachments, kind: "contact" });
  if (res === "sent") return json({ ok: true });
  return json({ error: res === "quota" ? "quota" : "unavailable" }, 503);
});

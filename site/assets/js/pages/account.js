// Public account pages (reachable logged out): sign-up, e-mail confirmation, forgotten
// password, reset, resend, privacy policy. #/compte/<view>[?token=…]

import { html, raw, $, esc } from "../util.js";
import { t, lang, setLang, LANGS, LANG_NAMES } from "../i18n.js";
import * as auth from "../auth.js";
import { SITE } from "../app.js";

const VIEWS = {
  inscription: register, verifier: verify, "mot-de-passe": forgot, reinitialiser: reset,
  renvoyer: resend, confidentialite: privacy,
};

export async function render(main, { arg, query }) {
  const view = VIEWS[arg] || register;
  return view(main, query);
}

const card = (title, body) => html`<section class="card account-card"><div class="card-head"><h1 style="font-size:20px;margin:0">${title}</h1></div>
  <div class="card-body">${body}</div></section>`;
const toLogin = () => html`<a class="btn btn-primary" href="#/" style="justify-content:center">${t("ac.toLogin")}</a>`;
const show = (el, text, ok = false) => { el.textContent = text; el.className = `notice${ok ? " ok" : ""}`; el.hidden = false; };

/** Wire a form: disable the button while `go` runs; `go` returns an error message, or null when done. */
function bind(form, label, go) {
  const err = $(".notice", form), btn = $("button[type=submit]", form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true; btn.textContent = t("ac.sending");
    const msg = await go(new FormData(form), err);
    if (msg) { show(err, msg); btn.disabled = false; btn.textContent = label; }
  });
}

// ---- sign-up ---------------------------------------------------------------------------------
// What is typed, passwords apart, kept for the tab while the form is open: a change of language redraws the page
// (the form's own choice or the menu beside the theme) and finds it again; gone once the account is created.
const DRAFT = "ocn.reg.draft", KEPT = ["first", "last", "licence", "email"];
const readDraft = () => { try { return JSON.parse(sessionStorage.getItem(DRAFT) || "{}"); } catch (e) { return {}; } };
const keepDraft = (form) => {
  try { sessionStorage.setItem(DRAFT, JSON.stringify(Object.fromEntries(KEPT.map((k) => [k, form.elements[k]?.value || ""])))); } catch (e) { /* not kept */ }
};
const dropDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch (e) { /* nothing kept */ } };

// Cloudflare Turnstile (owner, 2026-10-20; functions/_lib/turnstile.js): the one script the site loads from another host, on
// this form only and only when the server has its keys — it cannot be served by the site itself (it is Cloudflare's check).
// (A wrong site key shows nothing and logs Cloudflare's error 400020: the form then says so, `ac.reg.err.robotLoad`.)
const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let turnstileLoad = null;
const loadTurnstile = () => turnstileLoad || (turnstileLoad = new Promise((ok, ko) => {
  const s = document.createElement("script");
  s.src = TURNSTILE; s.async = true; s.onload = () => ok(window.turnstile); s.onerror = () => { turnstileLoad = null; ko(new Error("turnstile")); };
  document.head.append(s);
}));

async function register(main) {
  let open = true, siteKey = null;
  try {
    const st = await (await fetch("api/account/status")).json();
    open = st.registration; siteKey = st.turnstile || null;
  } catch (e) { open = false; }
  main.innerHTML = card(t("ac.reg.title"), !open
    ? html`<div class="notice info">${t("ac.reg.closed")}</div><a class="btn" href="#/" style="justify-content:center">${t("ac.toLogin")}</a>`
    : html`<p class="soft" style="margin:0">${t("ac.reg.lede")}</p>
      <form id="reg" class="stack" style="gap:12px" autocomplete="on">
        <label class="field"><span>${t("ac.reg.lang")}</span><select name="lang" id="reg-lang">
          ${LANGS.map((l) => html`<option value="${l}" lang="${l}" ${raw(l === lang() ? "selected" : "")}>${LANG_NAMES[l]}</option>`)}</select>
          <span class="muted" style="font-size:12.5px">${t("ac.reg.lang.hint")}</span></label>
        <div class="row" style="gap:12px;flex-wrap:nowrap">
          <label class="field" style="flex:1"><span>${t("ac.reg.first")}</span><input name="first" type="text" autocomplete="given-name" required maxlength="60"></label>
          <label class="field" style="flex:1"><span>${t("ac.reg.last")}</span><input name="last" type="text" autocomplete="family-name" required maxlength="60"></label>
        </div>
        <label class="field"><span>${t("ac.reg.licence")}</span><input name="licence" type="text" inputmode="numeric" autocomplete="off" required maxlength="12"></label>
        <label class="field"><span>${t("ac.email")}</span><input name="email" type="email" autocomplete="email" required maxlength="254"></label>
        <label class="field"><span>${t("ac.password")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
        <label class="field"><span>${t("ac.password2")}</span><input name="password2" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
        <div class="hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
        <label class="check"><input name="consent" type="checkbox" required><span>${t("ac.reg.consent")}
          <a href="#/compte/confidentialite">${t("ac.reg.privacy")}</a></span></label>
        ${siteKey ? html`<div id="reg-ts" class="reg-ts"></div>` : ""}
        <div class="notice" hidden></div>
        <button class="btn btn-primary" type="submit" style="height:40px;justify-content:center">${t("ac.reg.submit")}</button>
      </form>
      <a href="#/">${t("ac.toLogin")}</a>`);
  const form = $("#reg");
  if (!form) return { title: t("ac.reg.title") };
  const draft = readDraft();
  for (const k of KEPT) if (draft[k] && form.elements[k]) form.elements[k].value = draft[k];
  form.addEventListener("input", () => keepDraft(form));
  // the language: the page drawn again in it (what is typed comes back), the account created in it
  $("#reg-lang").addEventListener("change", (e) => { keepDraft(form); setLang(e.target.value); });
  // the robot check: its token is used once, so a refused registration asks for a new one
  let tsToken = "", tsWidget = null;
  if (siteKey) {
    loadTurnstile().then((ts) => {
      tsWidget = ts.render("#reg-ts", { sitekey: siteKey, language: lang(), action: "register",
        callback: (tok) => { tsToken = tok; }, "expired-callback": () => { tsToken = ""; }, "error-callback": (code) => {
          // the widget cannot run (a wrong site key, a hostname not allowed, the script blocked): said, not left blank
          tsToken = "";
          const box = $(".notice", form);
          if (box.hidden) show(box, t("ac.reg.err.robotLoad", { code: String(code || "") }));
        } });
    }).catch(() => { /* the server answers « robot »: said below */ });
  }
  bind(form, t("ac.reg.submit"), async (f) => {
    if (f.get("password") !== f.get("password2")) return t("ac.reg.err.password2");
    if (siteKey && !tsToken) return t("ac.reg.err.robotWait");
    const r = await auth.api("api/account/register", {
      email: f.get("email"), password: f.get("password"), first: f.get("first"), last: f.get("last"),
      countries: [{ country: "FR", id: f.get("licence") }], consent: f.get("consent") === "on", website: f.get("website"),
      lang: lang(), turnstile: tsToken,
    });
    if (!r.ok && tsWidget !== null) { try { window.turnstile.reset(tsWidget); } catch (e) { /* gone */ } tsToken = ""; }
    if (r.ok) {
      dropDraft();
      form.outerHTML = html`<div class="notice ok">${t("ac.reg.done")} <b>${f.get("email")}</b>.</div>
        <p class="soft" style="margin:0">${t("ac.reg.done2")}</p>
        ${r.data?.mail === "queued" ? html`<p class="muted" style="margin:0">${t("ac.reg.queued")}</p>` : ""}
        <p style="margin:0"><a href="#/compte/renvoyer">${t("ac.resend")}</a></p>`.toString();
      return null;
    }
    if (r.status === 0) return t("ac.err.unavailable");
    if (r.status === 429) return t("ac.err.rate");
    if (r.status === 503) return t("ac.reg.closed");
    return t(`ac.reg.err.${r.data?.error}`) !== `ac.reg.err.${r.data?.error}` ? t(`ac.reg.err.${r.data?.error}`) : t("ac.err.generic");
  });
  return { title: t("ac.reg.title") };
}

// ---- e-mail confirmation (the link in the message) ----------------------------------------------
async function verify(main, query) {
  main.innerHTML = card(t("ac.verify.title"), html`<div id="vr" class="notice info">${t("ac.verify.run")}</div>`);
  const r = query.token ? await auth.api("api/account/verify", { token: query.token }) : { ok: false, status: 410 };
  const box = $("#vr");
  if (r.ok) {
    show(box, t("ac.verify.ok"), true);
    box.insertAdjacentHTML("afterend", toLogin().toString());
  } else {
    show(box, r.status === 0 ? t("ac.err.unavailable") : t("ac.verify.bad"));
    box.insertAdjacentHTML("afterend", html`<a href="#/compte/renvoyer">${t("ac.resend")}</a>`.toString());
  }
  return { title: t("ac.verify.title") };
}

// ---- single-field mail forms: resend / forgot -----------------------------------------------------
function emailForm(main, { title, lede, label, endpoint, done }) {
  main.innerHTML = card(title, html`<p class="soft" style="margin:0">${lede}</p>
    <form id="ef" class="stack" style="gap:12px">
      <label class="field"><span>${t("ac.email")}</span><input name="email" type="email" autocomplete="email" required></label>
      <div class="notice" hidden></div>
      <button class="btn btn-primary" type="submit" style="height:40px;justify-content:center">${label}</button>
    </form><a href="#/">${t("ac.toLogin")}</a>`);
  bind($("#ef"), label, async (f, err) => {
    const r = await auth.api(endpoint, { email: f.get("email") });
    if (r.status === 0) return t("ac.err.unavailable");
    if (r.status === 429) return t("ac.err.rate");
    $("#ef").outerHTML = html`<div class="notice ok">${done}</div>`.toString();
    return null;
  });
  return { title };
}
function resend(main) {
  return emailForm(main, {
    title: t("ac.resend.title"), lede: t("ac.resend.lede"), label: t("ac.resend"), endpoint: "api/account/resend", done: t("ac.resend.done"),
  });
}
function forgot(main) {
  return emailForm(main, {
    title: t("ac.forgot.title"), lede: t("ac.forgot.lede"), label: t("ac.forgot.submit"), endpoint: "api/account/forgot", done: t("ac.forgot.done"),
  });
}

// ---- new password (the link in the reset message) -----------------------------------------------
async function reset(main, query) {
  main.innerHTML = card(t("ac.reset.title"), html`<form id="rf" class="stack" style="gap:12px">
      <label class="field"><span>${t("ac.password")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
      <label class="field"><span>${t("ac.password2")}</span><input name="password2" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
      <div class="notice" hidden></div>
      <button class="btn btn-primary" type="submit" style="height:40px;justify-content:center">${t("ac.reset.submit")}</button>
    </form>`);
  bind($("#rf"), t("ac.reset.submit"), async (f) => {
    if (f.get("password") !== f.get("password2")) return t("ac.reg.err.password2");
    const r = await auth.api("api/account/reset", { token: query.token, password: f.get("password") });
    if (r.ok) {
      $("#rf").outerHTML = html`<div class="notice ok">${t("ac.reset.ok")}</div>${toLogin()}`.toString();
      return null;
    }
    if (r.status === 0) return t("ac.err.unavailable");
    return r.status === 422 ? t("ac.reg.err.password") : t("ac.reset.bad");
  });
  return { title: t("ac.reset.title") };
}

// ---- privacy policy -----------------------------------------------------------------------------
async function privacy(main) {
  // the GDPR's information (articles 13 and 14) and the legal notices (LCEN, article 6): reviewed 2026-10-15 — keep the date
  // below up to date when what the site keeps changes
  // the text, one module per language (content/privacy.fr.js prevails; privacy.en.js, a translation)
  const { body } = await import(`../content/privacy.${lang()}.js`);
  main.innerHTML = html`<section class="card account-card" style="max-width:760px"><div class="card-head"><h1 style="font-size:20px;margin:0">${t("pv.title")}</h1></div>
    <div class="card-body prose">${raw(body(SITE))}
      <p><a href="#/">← ${t("ac.toLogin")}</a></p>
    </div></section>`.toString();
  return { title: t("pv.title") };
}

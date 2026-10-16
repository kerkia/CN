// « IA » (#/ia; owner 2026-10-15, every account since 2026-10-16): a question in plain French, answered with a
// table, a chart or a few figures. A language model (functions/api/ask.js, Workers AI) turns the question into one
// DuckDB query over the site's published data (site/data/ask/*.parquet, built by site_ask.py) and says how to show
// the result; the query runs here, in the browser, with DuckDB-WASM — the model never sees the data. A query that
// fails goes back to the model once, with its error. Only one SELECT is ever run, on the five tables.

import { html, raw, $, fmt, fmtDate, fmtTime, downloadCsv, normalise, plural } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as store from "../store.js";
import { timeChart, columnChart, slotColor } from "../charts.js";
import { dataTable } from "../ui.js";
import { parseAnswer } from "../askparse.js";
import { PROVIDERS, ProviderError, loadChoice, saveChoice, forgetChoice, suggest } from "../askbyok.js";

const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";
const TABLES = ["runners", "clubs", "races", "results", "cn"];
const EXAMPLES = [
  "Quels coureurs de mon club sont dans le meilleur centile de leur catégorie en forêt ? Fais un tableau.",
  "Trace l'écart entre mon CN officiel et mon CN Top sur les 3 dernières années.",
  "Mes 10 meilleures courses en sprint selon le score Top",
  "Compare l'évolution du CN Top forêt des 5 meilleurs coureurs de mon club depuis 2024",
  "Combien de coureurs ont un CN Top en forêt aujourd'hui, par ligue ?",
  "Mon taux de PM par saison",
];
// O'CN's models on Workers AI (the free allowance), the default first; « byok » = the user's own key (askbyok.js)
const MODELS = [["@cf/openai/gpt-oss-120b", "gpt-oss-120b"], ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Llama 3.3 70B"],
  ["@cf/mistralai/mistral-small-3.1-24b-instruct", "Mistral Small 3.1"], ["@cf/qwen/qwen3-30b-a3b-fp8", "Qwen3 30B"]];

// what survives a visit to another page: the answers, the database once loaded
const memo = { answers: [], duck: null, loaded: new Set(), manifest: null };

// ---- the database ---------------------------------------------------------------------------------------------------
async function duck() {
  if (memo.duck) return memo.duck;
  memo.duck = (async () => {
    const duckdb = await import(DUCKDB);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(url));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(url);
    return { db, conn: await db.connect() };
  })();
  memo.duck.catch(() => { memo.duck = null; });
  return memo.duck;
}

async function manifest() {
  if (memo.manifest) return memo.manifest;
  const r = await fetch("data/ask/manifest.json", { credentials: "same-origin", cache: "no-cache" });
  if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error("Les données des questions ne sont pas encore construites.");
  return (memo.manifest = await r.json());
}

/** Loads the tables a query names that are not loaded yet; `say` reports progress. */
async function ensureTables(sql, say) {
  const { db, conn } = await duck();
  const m = await manifest();
  const need = TABLES.filter((tb) => new RegExp(`\\b${tb}\\b`, "i").test(sql) && !memo.loaded.has(tb));
  for (const tb of need) {
    const mb = ((m.tables?.[tb]?.bytes || 0) / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    say(`Chargement de la table « ${tb} » (${mb} Mo, une fois par visite)…`);
    const r = await fetch(`data/ask/${tb}.parquet`, { credentials: "same-origin", cache: "no-cache" });
    if (!r.ok || (r.headers.get("content-type") || "").includes("html")) throw new Error(`La table « ${tb} » n'a pas pu être lue (${r.status}).`);
    await db.registerFileBuffer(`${tb}.parquet`, new Uint8Array(await r.arrayBuffer()));
    await conn.query(`CREATE OR REPLACE VIEW ${tb} AS SELECT * FROM '${tb}.parquet'`);
    memo.loaded.add(tb);
  }
  return conn;
}

/** Only one read-only query over the five tables: no other statement, no file, no address, no setting. */
export function checkSql(sql) {
  const s = String(sql || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim().replace(/;\s*$/, "");
  // string literals and quoted names (the French column titles) left out of the checks
  const bare = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (!/^(with|select|from)\b/i.test(bare)) return "La requête n'est pas une lecture (SELECT).";
  if (bare.includes(";")) return "La requête contient plusieurs instructions.";
  if (/\b(attach|detach|copy|install|load|pragma|set|reset|export|import|create|insert|update|delete|drop|alter|call|checkpoint|vacuum|use)\b/i.test(bare)) {
    return "La requête contient une instruction autre qu'une lecture.";
  }
  if (/\b(read_\w+|glob|parquet_\w+|sniff_csv|query|query_table|getenv)\s*\(/i.test(bare) || /\b(from|join)\s*''/i.test(bare) || /:\/\//.test(s)) {
    return "La requête lit autre chose que les tables du site.";
  }
  return null;
}

/** Runs the query; numbers as JS numbers, dates as « AAAA-MM-JJ » (BIGINT, DECIMAL and DATE come awkwardly otherwise). */
async function run(conn, sql) {
  const body = sql.trim().replace(/;\s*$/, "");
  const types = (await conn.query(`DESCRIBE ${body}`)).toArray().map((r) => r.toJSON());
  const q = (c) => `"${c.replace(/"/g, '""')}"`;
  const cols = types.map((r) => {
    const ty = String(r.column_type).toUpperCase();
    return /^(BIGINT|HUGEINT|UBIGINT|DECIMAL|INTEGER|SMALLINT|TINYINT|FLOAT|DOUBLE|REAL)/.test(ty) ? `CAST(${q(r.column_name)} AS DOUBLE) AS ${q(r.column_name)}`
      : /^(DATE|TIMESTAMP)/.test(ty) ? `strftime(${q(r.column_name)}, '%Y-%m-%d') AS ${q(r.column_name)}`
      : /^(VARCHAR|BOOLEAN)/.test(ty) ? q(r.column_name) : `CAST(${q(r.column_name)} AS VARCHAR) AS ${q(r.column_name)}`;
  });
  const res = await conn.query(`SELECT ${cols.join(", ")} FROM (${body}) AS answer LIMIT 5000`);
  return {
    columns: types.map((r) => ({ name: r.column_name, numeric: /^(BIGINT|HUGEINT|UBIGINT|DECIMAL|INTEGER|SMALLINT|TINYINT|FLOAT|DOUBLE|REAL)/i.test(r.column_type),
      date: /^(DATE|TIMESTAMP)/i.test(r.column_type) })),
    rows: res.toArray().map((r) => r.toJSON()),
  };
}

// ---- showing a result -------------------------------------------------------------------------------------------------
/** A column the model named, as the result spells it (models add quotes, change case or name a column the query lost). */
function colOf(result, name) {
  if (!name) return null;
  const k = String(name).replace(/^["'`]+|["'`]+$/g, "").trim().toLowerCase();
  return result.columns.find((c) => c.name.toLowerCase() === k) || null;
}

function formatter(a, col) {
  const f = Object.entries(a.formats || {}).find(([k]) => colOf({ columns: [col] }, k))?.[1];
  if (f === "duration") return (v) => (v == null ? "—" : fmtTime(Math.round(v)));
  if (f === "percent") return (v) => (v == null ? "—" : `${fmt(100 * v, 1)} %`);
  if (f === "date" || col.date) return (v) => (v == null ? "—" : fmtDate(String(v).slice(0, 10)));
  if (f === "integer") return (v) => (v == null ? "—" : fmt(Math.round(v)));
  if (col.numeric) return (v) => (v == null ? "—" : fmt(v, Number.isInteger(v) ? 0 : f === "decimal" ? 2 : 1));
  return (v) => (v == null ? "—" : String(v));
}

function draw(el, a, result) {
  const { columns, rows } = result;
  const body = $(".ia-body", el);
  if (!rows.length) { body.innerHTML = html`<div class="empty">La requête n'a renvoyé aucune ligne.</div>`; return; }
  const x = colOf(result, a.x), series = colOf(result, a.series);
  let ys = (a.y || []).map((n) => colOf(result, n)).filter(Boolean);
  if (!ys.length) ys = columns.filter((c) => c.numeric && c !== x && c !== series);
  const display = a.display === "line" && x && ys.length ? "line" : a.display === "bar" && x && ys.length ? "bar"
    : a.display === "value" && rows.length <= 3 ? "value" : "table";
  if (display === "value") {
    body.innerHTML = html`<div class="ia-values">${rows.map((r) => columns.map((c) => html`<div class="ia-value"><span>${c.name}</span>
      <b>${formatter(a, c)(r[c.name])}</b></div>`))}</div>`;
  } else if (display === "line" || display === "bar") {
    body.innerHTML = html`<div class="ia-chart"></div>`;
    const chartEl = $(".ia-chart", body);
    if (display === "line") {
      const lines = series
        ? [...new Set(rows.map((r) => r[series.name]))].slice(0, 12).map((s, i) => ({ name: String(s ?? "—"), color: slotColor(i),
            data: rows.filter((r) => r[series.name] === s && r[ys[0].name] != null).map((r) => [String(r[x.name]).slice(0, 10), r[ys[0].name]]) }))
        : ys.slice(0, 8).map((c, i) => ({ name: c.name, color: slotColor(i), data: rows.filter((r) => r[c.name] != null).map((r) => [String(r[x.name]).slice(0, 10), r[c.name]]) }));
      const dated = x.date || rows.every((r) => /^\d{4}-\d\d-\d\d/.test(String(r[x.name])));
      if (dated) timeChart(chartEl, { series: lines, yName: series ? ys[0].name : ys.length === 1 ? ys[0].name : "", zoom: false });
      else columnChart(chartEl, { categories: [...new Set(rows.map((r) => String(r[x.name])))], yName: "",
        series: lines.map((l) => ({ ...l, data: [...new Set(rows.map((r) => String(r[x.name])))].map((k) => l.data.find((d) => d[0] === k)?.[1] ?? null) })) });
    } else {
      const cats = rows.map((r) => String(r[x.name] ?? "—"));
      columnChart(chartEl, { categories: cats, yName: ys.length === 1 ? ys[0].name : "",
        series: ys.slice(0, 6).map((c, i) => ({ name: c.name, color: slotColor(i), data: rows.map((r) => r[c.name]) })) });
    }
    body.insertAdjacentHTML("beforeend", html`<details class="ia-more"><summary>Les données</summary><div class="ia-table"></div></details>`);
    table($(".ia-table", body), a, result);
  } else {
    body.innerHTML = html`<div class="ia-table"></div>`;
    table($(".ia-table", body), a, result);
  }
}

function table(el, a, { columns, rows }) {
  dataTable(el, {
    columns: columns.map((c) => {
      const f = formatter(a, c);
      return { key: c.name, label: c.name, align: c.numeric ? "r num" : "", sort: (r) => r[c.name], render: (r) => f(r[c.name]) };
    }),
    rows, sortKey: null, compact: true, maxHeight: "60vh",
  });
}

// ---- the page ---------------------------------------------------------------------------------------------------------
export async function render(main) {
  const me = auth.session();
  let followUp = null;
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.ask")}</h1>
      <p class="lede">Posez une question sur les classements, les résultats, les clubs : une IA écrit la requête, votre navigateur l'exécute sur
        les données du site et en fait un tableau ou un graphique.</p></div></div>
    <section class="card"><div class="card-body ia-top">
      <div>
        <form id="ia-form" class="ia-form">
          <textarea id="ia-q" rows="4" maxlength="1000" placeholder="Par exemple : mon CN Top en forêt mois par mois depuis 2024"></textarea>
          <div class="ia-row">
            <div id="ia-follow"></div>
            <select id="ia-model" title="Le modèle qui écrit la requête">${(me?.admin ? MODELS : MODELS.slice(0, 1)).map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
            <button type="submit" class="btn btn-primary" id="ia-go">Demander</button>
          </div>
        </form>
        <p class="muted ia-note">Gratuit, dans la limite d'une centaine de questions par jour pour tout le site (15 par personne et par jour ; sans
          limite avec votre propre clé, ci-dessous). L'IA ne voit pas les données : elle
          écrit une requête, que votre navigateur exécute. Elle peut se tromper : l'interprétation retenue et la requête sont affichées sous chaque réponse.</p>
        <details class="ia-byok" id="by">
          <summary>Votre propre clé d'API : Claude, ChatGPT, Gemini ou OpenRouter</summary>
          <div class="ia-byok-body">
            <p class="ia-note" style="margin-top:0">Un modèle plus puissant, à vos frais : votre navigateur l'appelle directement avec votre clé.</p>
            <div class="ia-byok-grid">
              <label class="field"><span>Fournisseur</span><select id="by-prov">${Object.entries(PROVIDERS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select></label>
              <label class="field"><span>Clé d'API</span><input id="by-key" type="password" autocomplete="off" spellcheck="false"></label>
              <div class="field ia-byok-model"><span>Modèle</span>
                <input id="by-filter" type="search" autocomplete="off" spellcheck="false" placeholder="Filtrer : claude, gpt, gemini, gratuit…" aria-label="Filtrer les modèles">
                <select id="by-model" aria-label="Modèle"><option value="" disabled selected>— chargez la liste —</option></select></div>
            </div>
            <div class="ia-row ia-byok-actions">
              <label class="checkline"><input type="checkbox" id="by-remember"> Se souvenir de la clé sur cet appareil</label>
              <span style="flex:1"></span>
              <button type="button" class="btn btn-sm" id="by-load">Charger les modèles</button>
              <button type="button" class="btn btn-sm btn-primary" id="by-save">Utiliser</button>
              <button type="button" class="btn btn-ghost btn-sm" id="by-forget">Oublier la clé</button>
            </div>
            <div class="ia-status" id="by-status"></div>
            <p class="muted ia-note" id="by-note"></p>
            <p class="muted ia-note">La clé reste dans ce navigateur : elle n'est jamais envoyée à O'CN (sans « Se souvenir », elle s'efface à la
              fermeture de l'onglet ; elle s'efface aussi à la déconnexion). Le fournisseur reçoit la question, la description des tables et votre
              numéro de licence — jamais les données —, selon ses conditions, et vous facture à ses tarifs (une question coûte de moins d'un
              centime à environ un centime). Créez une clé réservée à cet usage, avec une limite de dépenses : un script de la page pourrait la lire.</p>
          </div>
        </details>
      </div>
      <aside class="ia-examples" aria-label="Exemples de questions"><div class="ia-ex-head">Exemples</div>
        ${EXAMPLES.map((e) => html`<button type="button" class="chip" data-ex="${e}">${e}</button>`)}</aside>
    </div></section>
    <div id="ia-answers"></div>
    <style>
      .ia-form textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 10px 12px; border: 1px solid var(--border-strong);
        border-radius: 8px; background: var(--surface); color: var(--ink); resize: vertical }
      .ia-row { display: flex; gap: 10px; align-items: center; margin-top: 8px }
      .ia-row #ia-follow { flex: 1; min-width: 0 }
      /* the question on the left, the example questions on its right (owner, 2026-10-15); one under the other on a phone */
      .ia-top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 36%); gap: 18px; align-items: start }
      @media (max-width: 760px) { .ia-top { grid-template-columns: minmax(0, 1fr) } }
      .ia-examples { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin: 0 }
      .ia-ex-head { font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-3) }
      .ia-examples .chip { font-size: 12.5px; text-align: left; justify-content: flex-start; height: auto; min-height: 30px; padding-top: 5px;
        padding-bottom: 5px; line-height: 1.35; white-space: normal }
      .ia-note { font-size: 12.5px; margin: 12px 0 0 }
      .ia-answer .card-head h2 { font-size: 16px }
      .ia-expl { margin: 0 0 10px; color: var(--ink-2) }
      .ia-chart { height: 380px }
      .ia-values { display: flex; flex-wrap: wrap; gap: 12px }
      .ia-value { border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; min-width: 140px }
      .ia-value span { display: block; font-size: 12.5px; color: var(--ink-3) }
      .ia-value b { font-size: 22px }
      .ia-foot { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 10px; font-size: 12.5px }
      .ia-foot pre { white-space: pre-wrap; font-size: 12px; background: var(--surface-2, rgba(127,127,127,.08)); padding: 8px 10px; border-radius: 6px; margin: 6px 0 0 }
      .ia-foot details { flex-basis: 100% }
      .ia-more { margin-top: 10px }
      .ia-status { color: var(--ink-3) }
      .ia-byok { margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px }
      .ia-byok summary { cursor: pointer; font-size: 13.5px; font-weight: 600 }
      .ia-byok-body { margin-top: 10px }
      .ia-byok-grid { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(160px, 1.3fr) minmax(180px, 1.6fr); gap: 10px }
      .ia-byok-grid .field input, .ia-byok-grid .field select { width: 100%; box-sizing: border-box }
      @media (max-width: 760px) { .ia-byok-grid { grid-template-columns: minmax(0, 1fr) } }
      .ia-byok-actions { flex-wrap: wrap }
      .ia-byok-model { display: grid; gap: 6px; align-content: start }
      .ia-byok-model input, .ia-byok-model select { width: 100%; box-sizing: border-box }
      .ia-follow-chip { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
    </style>`;

  const answersEl = $("#ia-answers");
  const showFollow = () => {
    $("#ia-follow").innerHTML = followUp ? html`<span class="chip ia-follow-chip" title="${followUp.question}">Suite de : ${followUp.question.slice(0, 70)}${followUp.question.length > 70 ? "…" : ""}
      <button type="button" class="btn btn-ghost btn-sm" id="ia-unfollow" aria-label="Question indépendante">✕</button></span>` : "";
    $("#ia-unfollow")?.addEventListener("click", () => { followUp = null; showFollow(); });
  };

  function card(entry) {
    const el = document.createElement("section");
    el.className = "card ia-answer";
    el.innerHTML = html`<div class="card-head"><div><h2>${entry.answer?.title || entry.question}</h2>
        <div class="hint">${entry.question}</div></div></div>
      <div class="card-body"><p class="ia-expl">${entry.answer?.explanation || ""}</p><div class="ia-body"><div class="ia-status">${entry.status || ""}</div></div>
        <div class="ia-foot"></div></div>`;
    return el;
  }
  function foot(el, entry) {
    const u = entry.usage;
    $(".ia-foot", el).innerHTML = html`
      ${entry.result ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="csv">Télécharger (CSV)</button>` : ""}
      ${entry.answer?.sql ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="follow">Préciser cette réponse</button>` : ""}
      ${u ? html`<span class="muted">${u.provider ? `${u.provider} · ${u.model}` : String(u.model).split("/").pop()} · ${fmt(u.tokensIn)} + ${fmt(u.tokensOut)} jetons${
        u.neurons != null ? ` · ~${fmt(u.neurons)} neurones` : ""}${u.dollars != null ? ` · ${fmt(u.dollars, 4)} $` : ""} · ${fmt(u.ms / 1000, 1)} s${entry.retried ? " · requête corrigée une fois" : ""}</span>` : ""}
      ${entry.answer?.sql ? html`<details><summary>La requête</summary><pre>${entry.answer.sql}</pre></details>` : ""}`;
    $("[data-act=csv]", el)?.addEventListener("click", () => {
      const { columns, rows } = entry.result;
      downloadCsv("ocn-ia.csv", columns.map((c) => c.name), rows.map((r) => columns.map((c) => r[c.name])));
    });
    $("[data-act=follow]", el)?.addEventListener("click", () => {
      followUp = { question: entry.question, sql: entry.answer.sql };
      showFollow(); $("#ia-q").focus();
    });
  }

  async function ask(question) {
    const entry = { question, previous: followUp };
    memo.answers.unshift(entry);
    const el = card(entry);
    answersEl.prepend(el);
    const say = (s) => { entry.status = s; const st = $(".ia-status", el); if (st) st.textContent = s; };
    const own = $("#ia-model").value === "byok" ? loadChoice() : null;
    const post = async (extra) => {
      const r = await fetch("/api/ask", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, method: store.get().method, terrain: store.get().terrain, model: $("#ia-model").value,
          previous: entry.previous || undefined, promptOnly: own ? true : undefined, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (own) {
        // the user's own model: the instructions from O'CN, the call from this browser to their provider, with their key
        if (!r.ok || !d.messages) throw new Error(d.error || `Erreur ${r.status}`);
        const t0 = Date.now(), out = await PROVIDERS[own.provider].chat(own.key, own.model, d.messages);
        entry.usage = { provider: PROVIDERS[own.provider].label, model: own.model, ms: Date.now() - t0, tokensIn: out.tokensIn, tokensOut: out.tokensOut,
          dollars: out.dollars ?? null };
        const answer = parseAnswer(out.text);
        if (!answer) throw new Error("La réponse du modèle n'a pas pu être lue.");
        return answer;
      }
      if (!r.ok || !d.answer) throw new Error(d.error || `Erreur ${r.status}`);
      entry.usage = d.usage;
      return d.answer;
    };
    if ($("#ia-model").value === "byok" && !own) { say("Choisissez d'abord votre fournisseur, votre clé et le modèle, puis « Utiliser »."); return; }
    $("#ia-go").disabled = true;
    try {
      say(own ? `${PROVIDERS[own.provider].label} écrit la requête…` : "L'IA écrit la requête…");
      duck().catch(() => {});                                   // the engine loads meanwhile
      entry.answer = await post({});
      el.replaceWith(card(entry)); const cur = answersEl.firstElementChild;
      if (!entry.answer.sql) { $(".ia-body", cur).innerHTML = html`<div class="empty">${entry.answer.explanation || "Pas de requête possible."}</div>`; foot(cur, entry); return; }
      const sayCur = (s) => { const st = $(".ia-status", cur); if (st) st.textContent = s; };
      for (let attempt = 0; ; attempt++) {
        const bad = checkSql(entry.answer.sql);
        try {
          if (bad) throw new Error(bad);
          const conn = await ensureTables(entry.answer.sql, sayCur);
          sayCur("Exécution de la requête…");
          entry.result = await run(conn, entry.answer.sql);
          break;
        } catch (e) {
          if (attempt) throw e;
          sayCur("La requête a échoué ; l'IA la corrige…");
          const failed = { sql: entry.answer.sql, error: String(e.message || e).split("\n")[0].slice(0, 400) };
          entry.answer = await post({ failed });
          entry.retried = true;
          $("h2", cur).textContent = entry.answer.title || question;
          $(".ia-expl", cur).textContent = entry.answer.explanation || "";
          if (!entry.answer.sql) throw new Error(entry.answer.explanation || "Pas de requête possible.");
        }
      }
      draw(cur, entry.answer, entry.result);
      foot(cur, entry);
      followUp = null; showFollow();
    } catch (e) {
      const cur = answersEl.firstElementChild;
      $(".ia-body", cur).innerHTML = html`<div class="empty">${String(e.message || e)}</div>`;
      foot(cur, entry);
    } finally {
      $("#ia-go").disabled = false;
    }
  }

  // ---- the user's own key -------------------------------------------------------------------------------------------
  let models = [];
  const byStatus = (s, bad = false) => { const el = $("#by-status"); el.textContent = s; el.style.color = bad ? "var(--bad, #c62828)" : ""; };
  const ownOption = (c) => {
    $("#ia-model option[value=byok]")?.remove();
    if (!c) return;
    const o = document.createElement("option");
    o.value = "byok"; o.textContent = `Votre clé : ${PROVIDERS[c.provider].label} · ${c.model}`;
    $("#ia-model").prepend(o);
  };
  const showProvider = () => {
    const pv = PROVIDERS[$("#by-prov").value];
    $("#by-key").placeholder = pv.hint;
    $("#by-note").innerHTML = html`${pv.note} <a href="${pv.keys}" target="_blank" rel="noopener noreferrer">Créer une clé</a>`;
  };
  // the models as a menu: OpenRouter's free ones first, then one group per maker (its own name, the price per million
  // tokens); the filter keeps the entries whose name or id contains its words (« gratuit » finds the free ones)
  const VENDORS = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", mistralai: "Mistral", "meta-llama": "Meta", deepseek: "DeepSeek",
    qwen: "Qwen", "x-ai": "xAI", cohere: "Cohere", microsoft: "Microsoft", amazon: "Amazon", nvidia: "NVIDIA", "z-ai": "Z.ai",
    moonshotai: "Moonshot", perplexity: "Perplexity", minimax: "MiniMax", nousresearch: "Nous Research" };
  const ORDER = Object.keys(VENDORS);
  const isFree = (m) => /:free$/.test(m.id) || (m.price && m.price[0] === 0 && m.price[1] === 0);
  const priceOf = (m) => (isFree(m) ? " — gratuit" : m.price && Number.isFinite(m.price[0])
    ? ` — ${fmt(m.price[0], 2)} $ / ${fmt(m.price[1], 2)} $ le million de jetons (entrée / sortie)` : "");
  const vendorOf = (id) => id.split("/")[0];
  let picked = null;                                   // the model chosen (or suggested): a filter that hides it does not lose it
  function drawModels(keep) {
    const sel = $("#by-model"), prov = $("#by-prov").value, q = normalise($("#by-filter").value || "").split(/\s+/).filter(Boolean);
    if (!models.length) {
      sel.innerHTML = keep ? html`<option value="${keep}" selected>${keep}</option>` : html`<option value="" disabled selected>— chargez la liste —</option>`;
      return;
    }
    const shown = models.filter((m) => { const t = normalise(`${m.id} ${m.name} ${isFree(m) ? "gratuit free" : ""}`); return q.every((w) => t.includes(w)); });
    const groups = new Map();
    const add = (g, m) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m); };
    for (const m of shown) {
      if (prov !== "openrouter") add("", m);
      else if (isFree(m)) add("Gratuits", m);
      else add(vendorOf(m.id), m);
    }
    const rank = (g) => (g === "Gratuits" ? -1 : ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length);
    const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    for (const list of groups.values()) list.sort((a, b) => (b.created || 0) - (a.created || 0) || a.name.localeCompare(b.name));   // newest first
    const label = (m, g) => `${g && g !== "Gratuits" ? m.name.replace(/^[^:]+:\s*/, "") : m.name}${priceOf(m)}`;
    const opt = (m, g) => html`<option value="${m.id}" title="${m.id}" ${raw(m.id === keep ? "selected" : "")}>${label(m, g)}</option>`;
    sel.innerHTML = shown.length ? keys.map((g) => (g ? html`<optgroup label="${g === "Gratuits" ? g : VENDORS[g] || g}">${groups.get(g).map((m) => opt(m, g))}</optgroup>`
      : groups.get(g).map((m) => opt(m, g)).join(""))).join("") : html`<option value="" disabled selected>Aucun modèle ne correspond</option>`;
    if (shown.length && !shown.some((m) => m.id === keep)) sel.selectedIndex = 0;
    byStatus(q.length ? `${plural(shown.length, "modèle", "modèles")} sur ${fmt(models.length)}.`
      : `${plural(models.length, "modèle disponible", "modèles disponibles")}${prov === "openrouter" && !$("#by-key").value.trim() ? " (la clé sera vérifiée à la première question)" : ""}.`);
  }
  async function loadModels() {
    const prov = $("#by-prov").value, key = $("#by-key").value.trim(), keep = $("#by-model").value;
    if (!key && prov !== "openrouter") { byStatus("Collez d'abord votre clé."); return false; }
    byStatus("Chargement des modèles…");
    try {
      models = await PROVIDERS[prov].models(key);
    } catch (e) { byStatus(e instanceof ProviderError ? e.message : String(e.message || e), true); return false; }
    picked = keep && models.some((m) => m.id === keep) ? keep : suggest(prov, models);
    drawModels(picked);
    return true;
  }
  $("#by-prov").addEventListener("change", () => {
    models = []; picked = null; $("#by-filter").value = ""; drawModels(null); byStatus(""); showProvider();
    if ($("#by-prov").value === "openrouter" || $("#by-key").value.trim()) loadModels();
  });
  $("#by-filter").addEventListener("input", () => { if (models.length) drawModels(picked); });
  $("#by-model").addEventListener("change", (e) => { picked = e.target.value; });
  $("#by-load").addEventListener("click", loadModels);
  $("#by-key").addEventListener("change", () => { if ($("#by-key").value.trim()) loadModels(); });
  $("#by-save").addEventListener("click", async () => {
    const provider = $("#by-prov").value, key = $("#by-key").value.trim();
    if (!key) { byStatus("Collez votre clé d'API.", true); return; }
    if (!models.length && !(await loadModels())) return;
    const model = $("#by-model").value;
    if (!model) { byStatus("Choisissez un modèle.", true); return; }
    const c = { provider, key, model, remember: $("#by-remember").checked };
    saveChoice(c); ownOption(c); $("#ia-model").value = "byok";
    byStatus(`Prêt : les questions iront à ${PROVIDERS[provider].label} (${model}).`);
  });
  $("#by-forget").addEventListener("click", () => {
    forgetChoice(); ownOption(null); $("#by-key").value = ""; $("#by-remember").checked = false; $("#ia-model").selectedIndex = 0;
    byStatus("Clé oubliée : les questions vont au modèle gratuit, gpt-oss-120b.");
  });
  {
    const c = loadChoice();
    if (c && PROVIDERS[c.provider]) {
      $("#by-prov").value = c.provider; $("#by-key").value = c.key; $("#by-remember").checked = !!c.remember;
      picked = c.model; drawModels(c.model);             // the model kept; the whole list with « Charger les modèles »
      ownOption(c); $("#ia-model").value = "byok";
      byStatus(`Clé enregistrée${c.remember ? " sur cet appareil" : " pour cet onglet"} : ${PROVIDERS[c.provider].label} (${c.model}).`);
    } else if ($("#by-prov").value === "openrouter") loadModels();     // a public list: no key sent
    showProvider();
  }

  $("#ia-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#ia-q").value.trim();
    if (q) ask(q);
  });
  $("#ia-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ia-form").requestSubmit(); } });
  main.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { $("#ia-q").value = b.dataset.ex; $("#ia-form").requestSubmit(); }));
  // the answers of this visit, as they were
  for (const entry of memo.answers.slice().reverse()) {
    if (!entry.answer) continue;
    const el = card(entry);
    answersEl.prepend(el);
    if (entry.result) draw(el, entry.answer, entry.result);
    else $(".ia-body", el).innerHTML = html`<div class="empty">${entry.answer.explanation || "—"}</div>`;
    foot(el, entry);
  }
  return { title: t("nav.ask") };
}

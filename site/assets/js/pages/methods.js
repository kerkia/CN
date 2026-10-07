// Methods, in four tabs: the essentials (what each method does well and badly, what the proposed ones
// fix), the methods in detail (race score, aggregation, linear or quadratic, recalage), the analyses
// (which method predicts results best, and for what), and the site's other calculations (clubs, age
// progression, network). Only the methods this account sees are named: « Juste » is for analysts.

import { html, $, $$, fmt, fmtSigned, mean } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { timeChart, scatterChart, methodColor, terrainColor, METHOD_SLOT } from "../charts.js";
import { TERRAINS, available } from "../store.js";
import { chartCard, bindChartCard, legend, methodKey, methodLabel, methodShort, seg } from "../ui.js";
import { replaceQuery } from "../app.js";

const TABS = [["essentiel", "L'essentiel"], ["detail", "En détail"], ["analyses", "Les analyses"], ["autres", "Autres calculs"]];
const cvar = (m) => `--c:var(--s${METHOD_SLOT[m]})`;

// Race-score exponent k, measured once on database copies (7 October 2026) with the strength CN (Juste), on
// the same pairs: ln(score) = C − k·ln(time). Reference period July 2025 - October 2026; ski over 2010-2025
// (2 to 4 races a season). Then 2018-2024 for forest and sprint, as a check.
const K_TESTS = {
  ks: [0.75, 1, 1.5, 2, 2.5, 3],
  rows: [
    ["For", "juil. 2025 – oct. 2026", 746087, 80.51, [82.10, 82.28, 82.50, 82.61, 82.61, 82.53]],
    ["Spr", "juil. 2025 – oct. 2026", 116243, 80.37, [83.90, 83.94, 83.97, 84.03, 84.09, 84.08]],
    ["VTT", "juil. 2025 – oct. 2026", 16924, 76.13, [null, 81.95, 82.14, 82.16, 82.14, null]],
    ["Ski", "2010 – 2025", 6944, 84.69, [null, 82.26, 83.24, 83.68, 83.87, null]],
  ],
  past: [
    ["For", "2018 – 2024", 3365113, 80.18, [81.38, 81.66, 81.98, 82.13, 82.20, 82.20]],
    ["Spr", "2018 – 2024", 320848, 82.37, [84.92, 84.86, 84.74, 84.58, 84.39, 84.09]],
  ],
};
// The two quadratic means taken one at a time (same measurement): linear, quadratic circuit value only,
// quadratic CN only, both (the quadratic variant).
const QUAD_PARTS = [
  ["For", 776408, [82.30, 82.51, 82.42, 82.58]],
  ["Spr", 118138, [83.96, 83.97, 84.04, 84.08]],
  ["VTT", 16924, [81.95, 82.10, 82.12, 82.23]],
  ["Ski", 6944, [82.26, 82.40, 82.73, 82.86]],
];
// Top linéaire vs Top quadratique (and the others), measured once on a database copy, 7 October 2026: same
// pairs (both runners hold a CN in all five methods), July 2025 - October 2026. Shares in the order of LQ.
const LQ = ["official", "fair", "top6w", "fair2", "top6w2"];
const LIN_QUAD = {
  acc: [   // terrain, scope, pairs, shares
    ["For", "all", 771511, [80.58, 82.32, 82.06, 82.61, 82.21]],
    ["For", "nat", 276703, [81.69, 83.12, 82.80, 83.11, 82.77]],
    ["Spr", "all", 113914, [80.35, 83.99, 83.94, 84.12, 84.04]],
    ["Spr", "nat", 21452, [81.07, 82.06, 82.18, 81.98, 82.09]],
  ],
  bias: [  // terrain, group, pairs, actually ahead, predicted ahead
    ["For", "J", 18600, 62.41, [54.91, 56.80, 59.73, 59.84, 62.37]],
    ["For", "V", 12736, 42.94, [48.08, 49.75, 51.28, 50.57, 52.23]],
    ["Spr", "J", 3918, 45.58, [36.88, 40.79, 41.04, 40.91, 41.27]],
    ["Spr", "V", 2540, 15.83, [27.87, 17.95, 18.31, 17.76, 18.03]],
  ],
};
// The worked example: one runner's ten scores in the window, best first; kind: cdf | national | other.
const EXAMPLE = [[7200, "cdf"], [6900, "other"], [6800, "national"], [6500, "other"], [6400, "other"],
  [6100, "other"], [5900, "other"], [5600, "other"], [5200, "other"], [4800, "other"]];

function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const roundHalfUp = (x) => Math.sign(x) * Math.round(Math.abs(x));

export async function render(main, { query = {} } = {}) {
  const meta = data.meta();
  const pf = meta.methods.fair.params, p6 = meta.methods.top6w.params;
  const M = available();
  const analyst = M.includes("fair");
  const tops = M.filter((m) => m === "top6w" || m === "top6w2");
  const pctOf = (x) => `${fmt(100 * x)} %`;
  const fmtW = (w) => fmt(w, Number.isInteger(w) ? 0 : 1);   // 1,5 must not read as 2
  const own = (p, tr, key) => p.by_terrain?.[tr]?.[key] ?? p[key];
  // the CN that values the circuits: named for analysts, described for everyone else
  const force = analyst ? html`le CN de la ${methodLabel("fair")}` : html`le CN « de force »`;

  // ---- the 2025 validation (built once from the data): shares of duels called right --------------------
  const v = await data.validation();
  const season = v ? v.season || Object.keys(v.acc.For?.all || {}).pop() : null;
  const VM = v ? M.filter((m) => v.methods.includes(m)) : [];
  const ref = VM.includes("top6w2") ? "top6w2" : VM.includes("top6w") ? "top6w" : null;
  const entry = (tr, scope = "all") => (v?.acc?.[tr]?.[scope]?.[season]?.[0] ? v.acc[tr][scope][season] : null);
  const right = (e, m) => e[1 + v.methods.indexOf(m)];
  const share = (e, m) => (100 * right(e, m)) / e[0];
  const avoided = (e, m = ref) => (100 * (right(e, m) - right(e, "official"))) / (e[0] - right(e, "official"));

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("page.methods")}</h1>
      <p class="lede">Mêmes résultats, plusieurs façons de compter : ce que fait chaque méthode, et ce que montrent les chiffres.</p></div></div>
    <nav class="mx-tabs" role="tablist">${TABS.map(([k, label], i) => html`<button type="button" role="tab" data-tab="${k}"
      aria-selected="false"><span class="mx-n">${i + 1}</span>${label}</button>`)}</nav>
    ${TABS.map(([k]) => html`<div data-panel="${k}" role="tabpanel" hidden></div>`)}
    <p class="muted" style="font-size:13px;margin-top:8px">Site indépendant et non officiel, sans lien avec la Fédération française de course
      d'orientation. Seule la ${methodLabel("official")} reprend des valeurs publiées par la FFCO ; les autres sont des calculs alternatifs, à but d'analyse.</p>`;

  // ======================================================================================================
  // 1. L'essentiel
  // ======================================================================================================
  function essentiel() {
    const TR3 = ["For", "Spr", "VTT"].filter((x) => entry(x));
    const duels = TR3.concat("Ski").reduce((n, x) => n + (entry(x)?.[0] || 0), 0);
    const tname = (x) => (x === "VTT" ? "en VTT" : `en ${t(`terrain.${x}`).toLowerCase()}`);
    const stats = ref ? html`<div class="mx-stats">
      ${TR3.map((x) => {
        const e = entry(x);
        return html`<div class="mx-stat"><b>−${fmt(avoided(e))} %</b><span>d'erreurs de pronostic ${tname(x)} :
          ${fmt(right(e, ref) - right(e, "official"))} duels de plus bien prédits en ${season}</span></div>`;
      })}
      <div class="mx-stat"><b>${fmt(Math.round(duels / 1000))} 000</b><span>duels analysés en ${season}, les mêmes pour chaque méthode</span></div>
    </div>` : "";

    // the criteria at a glance; prediction from the data (forest and sprint, 2025)
    const ef = entry("For"), es = entry("Spr");
    const predict = (m) => {
      if (!ef || !es) return null;
      const s = (share(ef, m) + share(es, m)) / 2;
      return { s, f: share(ef, m), p: share(es, m) };
    };
    const P = Object.fromEntries(VM.map((m) => [m, predict(m)]));
    const bestP = Math.max(...VM.map((m) => P[m]?.s ?? 0));
    const mark = (kind, label, note) => html`<span class="mx-mark ${kind}">${label}</span>${note ? html`<span class="mx-note">${note}</span>` : ""}`;
    const YES = (n) => mark("yes", "oui", n), NO = (n) => mark("no", "non", n), PART = (n) => mark("part", "en partie", n);
    const isTop = (m) => m.startsWith("top"), isQuad = (m) => m.endsWith("2");
    const CRIT = [
      ["Prédit qui termine devant", (m) => (P[m] ? mark(m === "official" ? "no" : "yes",
        `${fmt(P[m].f, 1)} · ${fmt(P[m].p, 1)} %`, P[m].s === bestP ? "la meilleure" : m === "official" ? "la moins bonne" : "") : "—")],
      ["Compte les championnats et les nationales", (m) => (m === "official" ? NO("souvent écartés") : YES(`× ${fmtW(pf.weights.cdf)} et × ${fmtW(pf.weights.national)}`))],
      ["Une course de plus ne fait jamais baisser le CN", (m) => (m === "official" ? NO() : isTop(m) ? YES() : PART("une course moyenne peut le baisser"))],
      ["Reflète le niveau dans les grandes compétitions", (m) => (m === "official" ? NO("sans les 10 % meilleures") : isTop(m) ? YES("ses meilleures courses") : PART("son niveau habituel"))],
      ["Stable d'une année à l'autre", (m) => (m === "official" ? NO("marche au 1er janvier") : YES("recalage progressif"))],
      ["Simple à expliquer", (m) => (m === "official" || m === "fair" ? YES() : m === "top6w" ? PART("règle des 6 places") : PART("moyennes quadratiques"))],
      ["Fait foi pour les sélections", (m) => (m === "official" ? YES("seul classement officiel") : NO("calcul d'analyse"))],
    ];

    return html`
    <section class="mx-slide mx-hero">
      <p class="mx-kicker">Le classement national, recalculé</p>
      <h2>Un CN qui compte vos meilleures courses — et qui prédit mieux les résultats</h2>
      <p class="mx-lead">À partir des mêmes résultats que la FFCO, le site calcule des classements alternatifs. Ils gardent ce qui marche dans
        la méthode officielle et corrigent ce qui la dessert : les championnats écartés, une course de plus qui fait baisser le CN, la marche
        du 1er janvier. Et ils désignent plus souvent le bon vainqueur de chaque duel.</p>
      ${stats}
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Le point de départ</p>
      <h2>Le CN sert à deux choses très différentes</h2>
      <div class="mx-grid">
        <div class="mx-box" style="--c:var(--s1)"><h3>Mesurer la force des coureurs</h3>
          <p>Pour calculer la valeur d'un circuit, il faut le <b>niveau habituel</b> des coureurs présents, que ne déforment ni une
            contre-performance ni un exploit isolé.</p></div>
        <div class="mx-box" style="--c:var(--s3)"><h3>Classer selon le potentiel</h3>
          <p>Pour les qualifications aux championnats de France, il faut ce dont un coureur est capable <b>dans une grande compétition</b> :
            ses meilleures courses.</p></div>
      </div>
      <div class="mx-callout">La ${methodLabel("official")} utilise <b>un seul CN pour les deux</b> : il convient au premier usage, et dessert le second.
        Les méthodes proposées utilisent <b>un CN pour chaque usage</b>.</div>
    </section>

    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">${methodKey("official")} ${methodLabel("official")}</p>
      <h2>La référence : solide pour mesurer, mal adaptée pour classer</h2>
      <div class="mx-grid">
        <div><h3 style="margin-top:4px">Ce qu'elle fait bien</h3><ul class="mx-list">
          <li><span>Elle fait foi : c'est le <b>seul classement officiel</b>, celui des sélections.</span></li>
          <li><span>Une moyenne qui écarte les scores extrêmes : une bonne mesure du <b>niveau habituel</b>, pour valoriser les circuits.</span></li>
          <li><span>Une règle publique, simple à expliquer.</span></li>
        </ul></div>
        <div><h3 style="margin-top:4px">Ce qu'elle fait mal</h3><ul class="mx-list bad">
          <li><span><b>Elle écarte les 10 % meilleures courses</b> — pour les meilleurs coureurs, le plus souvent les championnats de France et
            les nationales : les courses qu'ils préparent, les plus relevées.</span></li>
          <li><span><b>Elle n'incite pas à courir</b> : pour un coureur à fort CN, une course de plus le fait souvent baisser ; certains s'arrêtent
            dès leur CN qualifiant, d'autres ne courent que les courses « rentables ».</span></li>
          <li><span><b>Une marche chaque 1er janvier</b>, et des règles qui ont changé au fil des saisons : le suivi sur plusieurs années est faussé.</span></li>
          <li><span><b>Toutes les courses pèsent pareil</b>, d'un championnat de France à une régionale.</span></li>
        </ul></div>
      </div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker" style="--c:var(--s3)">Les méthodes proposées</p>
      <h2>Ce que changent les méthodes « Top »</h2>
      <p class="mx-lead">Mêmes résultats, mêmes temps, même façon de noter une course. Ce qui change : quelles courses comptent, et combien.</p>
      <div class="mx-fix">
        <div class="head">Méthode officielle</div><div></div><div class="head">Méthodes « Top »</div>
        <div class="p"><b>Les meilleures courses écartées</b>souvent les championnats de France et les nationales</div><div class="arrow">→</div>
        <div class="s"><b>Les meilleures courses comptent le plus</b>championnat de France × ${fmtW(pf.weights.cdf)}, nationale × ${fmtW(pf.weights.national)} ;
          seules les moins bonnes sont laissées de côté</div>
        <div class="p"><b>Une course de plus peut faire baisser le CN</b>de quoi dissuader de courir</div><div class="arrow">→</div>
        <div class="s"><b>Une course de plus ne peut jamais le faire baisser</b>${fmt(p6.top_n)} places, remplies par les meilleures courses :
          courir plus, c'est plus de chances de les remplir</div>
        <div class="p"><b>Une marche au 1er janvier</b>tout le classement change d'un coup</div><div class="arrow">→</div>
        <div class="s"><b>Un recalage progressif, jour après jour</b>le score d'une course est fixé une fois pour toutes ; le CN ne bouge que
          quand une course entre dans la fenêtre ou en sort</div>
        <div class="p"><b>Un seul CN pour deux usages</b>mesurer et classer</div><div class="arrow">→</div>
        <div class="s"><b>Un CN pour chaque usage</b>les circuits sont valorisés avec le niveau habituel des coureurs${analyst
          ? html` (${methodLabel("fair")})` : ""}, le classement retient leur potentiel</div>
        <div class="p"><b>Des pronostics moins justes</b>qui, de deux coureurs, finira devant ?</div><div class="arrow">→</div>
        <div class="s"><b>De meilleurs pronostics, chaque saison depuis 2012</b>en forêt comme en sprint —
          <a href="#/methodes?onglet=analyses" data-tab-link="analyses">voir les analyses</a></div>
      </div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">En un coup d'œil</p>
      <h2>Chaque méthode, critère par critère</h2>
      <div class="table-wrap"><table class="mx-matrix">
        <thead><tr><th></th>${M.map((m) => html`<th>${methodKey(m)}${methodShort(m)}</th>`)}</tr></thead>
        <tbody>${CRIT.map(([label, cell]) => html`<tr><td>${label}</td>${M.map((m) => html`<td>${cell(m)}</td>`)}</tr>`)}</tbody>
      </table></div>
      <p class="muted" style="font-size:13px">Pronostics : part des duels bien prédits en ${season || "2025"}, forêt · sprint
        (<a href="#/methodes?onglet=analyses" data-tab-link="analyses">le détail</a>).</p>
    </section>

    ${tops.length === 2 ? html`<section class="mx-slide">
      <p class="mx-kicker" style="${cvar("top6w2")}">En test</p>
      <h2>Deux « Top » : linéaire ou quadratique ?</h2>
      <div class="mx-grid">
        <div class="mx-box" style="${cvar("top6w")}"><h3>${methodKey("top6w")} ${methodLabel("top6w")}</h3>
          <p>Les moyennes habituelles, celles de la FFCO. Le plus simple à expliquer.</p></div>
        <div class="mx-box" style="${cvar("top6w2")}"><h3>${methodKey("top6w2")} ${methodLabel("top6w2")}</h3>
          <p>Des moyennes quadratiques, qui donnent un peu plus de poids aux meilleures performances. Elle prédit un peu mieux sur
            l'ensemble des courses, un peu moins bien sur les seules courses nationales : un dixième de point dans chaque sens.</p></div>
      </div>
      <div class="mx-callout">Une seule restera. Les deux sont publiées le temps de les comparer —
        <a href="#/methodes?onglet=detail&voir=quadratique" data-tab-link="detail" data-goto="quadratique">pourquoi le quadratique</a>,
        <a href="#/methodes?onglet=analyses&voir=lin-quad" data-tab-link="analyses" data-goto="lin-quad">ce que montrent les mesures</a>.</div>
    </section>` : ""}`;
  }

  // ======================================================================================================
  // 2. Les méthodes en détail
  // ======================================================================================================
  function detail() {
    // the worked example, computed with each visible method's rules on the same ten scores
    const W = { cdf: pf.weights.cdf, national: pf.weights.national, other: pf.weights.other };
    const n = EXAMPLE.length;
    const keep = roundHalfUp(pf.eligible_fraction * n);
    function aggregate(places, power) {
      let left = places, num = 0, den = 0;
      const used = EXAMPLE.map(([s, k], i) => {
        if (i >= keep || left <= 0) return 0;
        const u = Math.min(W[k], left);
        num += u * s ** power; den += u; left -= u;
        return u;
      });
      return { cn: roundHalfUp((num / den) ** (1 / power)), used };
    }
    const offDrop = Math.round(0.1 * n), offLow = Math.round(0.4 * n);
    const offUsed = EXAMPLE.map((_, i) => (i >= offDrop && i < n - offLow ? 1 : 0));
    const offCn = Math.round(mean(EXAMPLE.filter((_, i) => offUsed[i]).map(([s]) => s)));
    const EX = {
      official: { cn: offCn, used: offUsed, what: html`moyenne des ${fmt(n - offDrop - offLow)} scores du milieu : sans la meilleure (10 %) ni les
        ${fmt(offLow)} moins bonnes (40 %)` },
      top6w: { ...aggregate(p6.top_n, 1), what: html`${fmt(p6.top_n)} places remplies par les meilleures courses, chacune selon son poids` },
      top6w2: { ...aggregate(p6.top_n, 2), what: html`les mêmes ${fmt(p6.top_n)} places, en moyenne quadratique` },
      fair: { ...aggregate(Infinity, 1), what: html`moyenne pondérée des ${pctOf(pf.eligible_fraction)} meilleures` },
      fair2: { ...aggregate(Infinity, 2), what: html`la même, en moyenne quadratique` },
    };
    const chips = (m) => html`<div class="mx-scores">${EXAMPLE.map(([s, k], i) => {
      const u = EX[m].used[i];
      const sup = m !== "official" && u ? html`<sup>${u === W[k] && k === "other" ? "" : `×${fmtW(u)}`}</sup>` : "";
      return html`<span class="mx-sc ${u ? "on" : "off"} ${k === "cdf" ? "star" : ""}">${fmt(s)}${sup}</span>`;
    })}</div>`;
    const kindName = { cdf: "championnat de France", national: "nationale" };

    const windows = TERRAINS.map((tr) => {
      const name = { For: "Forêt", Spr: "Sprint", VTT: "VTT", Ski: "Ski" }[tr];
      return [tr, own(pf, name, "window_days"), own(pf, name, "eligible_fraction")];
    });
    const years = (d) => (d === 365 ? "12 mois" : `${fmt(Math.round(d / 365))} ans`);

    // the score curve for a few k: score relative to the reference runner's, against relative time
    const curve = (() => {
      const W_ = 640, H = 260, x0 = 52, y0 = 16, w = W_ - x0 - 16, h = H - y0 - 40;
      const X = (r) => x0 + ((r - 1) / 0.5) * w, Y = (s) => y0 + ((1 - s) / 0.6) * h;
      const line = (k) => Array.from({ length: 51 }, (_, i) => 1 + i * 0.01).map((r) => `${X(r).toFixed(1)},${Y(r ** -k).toFixed(1)}`).join(" ");
      const ks = [[1, "var(--s3)", "k = 1 · aujourd'hui", ""], [1.5, "var(--ink-3)", "k = 1,5", "5 4"], [2, "var(--s4)", "k = 2", ""]];
      return html`<svg viewBox="0 0 ${W_} ${H}" role="img" aria-label="Score selon le temps pour k = 1, 1,5 et 2" style="width:100%;max-width:${W_}px;height:auto;display:block">
        ${[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4].map((s) => html`<line x1="${x0}" x2="${x0 + w}" y1="${Y(s)}" y2="${Y(s)}" stroke="var(--grid)"/>
          <text x="${x0 - 6}" y="${Y(s) + 4}" text-anchor="end" font-size="13" fill="var(--ink-3)">${fmt(100 * s)} %</text>`)}
        ${[1, 1.1, 1.2, 1.3, 1.4, 1.5].map((r) => html`<text x="${X(r)}" y="${y0 + h + 16}" text-anchor="middle" font-size="13" fill="var(--ink-3)">${r === 1 ? "temps prévu" : `+${fmt(100 * (r - 1))} %`}</text>`)}
        ${ks.map(([k, c, , dash]) => html`<polyline points="${line(k)}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="${dash}"/>`)}
        ${ks.map(([k, c, label], i) => html`<g transform="translate(${x0 + w - 170},${y0 + 10 + i * 21})"><line x1="0" x2="18" y1="0" y2="0" stroke="${c}" stroke-width="2.5"/>
          <text x="24" y="5" font-size="14" fill="var(--ink-2)">${label}</text></g>`)}
        <text x="${x0 + w / 2}" y="${H - 2}" text-anchor="middle" font-size="13" fill="var(--ink-2)">temps du coureur, par rapport au temps prévu par son CN</text>
      </svg>`;
    })();
    const kBest = (vals) => Math.max(...vals.filter((x) => x != null));
    const kRow = ([tr, period, pairs, off, vals]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td class="muted">${period}</td><td class="r num">${fmt(pairs)}</td>
      <td class="r num">${fmt(off, 2)}</td>${vals.map((x, i) => html`<td class="r num ${K_TESTS.ks[i] === 2 ? "k2" : ""}">${x == null ? "—"
        : x === kBest(vals) ? html`<b>${fmt(x, 2)}</b>` : fmt(x, 2)}</td>`)}</tr>`;

    return html`
    <section class="mx-slide">
      <p class="mx-kicker">Vue d'ensemble</p>
      <h2>Du résultat au CN, en quatre étapes</h2>
      <div class="mx-steps">
        <div class="mx-step" style="--c:var(--s1)"><b>CN J-15</b>le CN de chaque coureur ${fmt(pf.lag_days)} jours avant la course</div>
        <div class="mx-step" style="--c:var(--s1)"><b>Valeur du circuit</b>mesurée sur les deux tiers les plus rapides</div>
        <div class="mx-step" style="--c:var(--s1)"><b>Score de course</b>valeur du circuit ÷ temps du coureur</div>
        <div class="mx-step" style="--c:var(--s3)"><b>CN</b>l'agrégation des scores de la fenêtre (12 mois en forêt et en sprint)</div>
      </div>
      <p>Les trois premières étapes suivent la même formule dans toutes les méthodes ; chacune y met <b>ses propres CN</b>, et la variante
        quadratique fait autrement la moyenne de l'étape 2. C'est surtout <b>l'étape 4</b> qui les distingue.</p>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Étapes 1 à 3</p>
      <h2>Le score d'une course : le temps, comparé au niveau des présents</h2>
      <div class="mx-eq">valeur du circuit = moyenne des (<i>CN J-15</i> × <i>temps</i>) des ⌈2N/3⌉ plus rapides ayant un CN
        <small>N : les coureurs classés du circuit qui ont un CN 15 jours avant la course</small></div>
      <div class="mx-eq">score = valeur du circuit ÷ <i>temps du coureur</i></div>
      <p>Courir aussi vite que son CN le prévoit donne un score proche de son CN ; 10 % plus vite, un score 11 % plus haut. Un poinçon manquant,
        un abandon, une disqualification ou un hors-délai donnent un score de <b>0, qui compte</b>. Les résultats « non classé » (nc) ne comptent
        nulle part, ni les catégories H10 et D10.</p>
      <div class="mx-grid">
        <div class="mx-box" style="${cvar("official")}"><h3>${methodKey("official")} ${methodShort("official")}</h3>
          <p>Les CN J-15 sont les CN officiels ; la FFCO publie elle-même les scores.</p></div>
        <div class="mx-box" style="${cvar(tops[tops.length - 1] || "top6w")}"><h3>Méthodes proposées</h3>
          <p>Les CN J-15 sont ${force} — le niveau habituel des coureurs, jamais le Top (voir plus bas). Seuls les coureurs ayant leur propre CN
            dans la spécialité comptent, et un circuit en demande au moins ${fmt(pf.min_ranked)}.</p></div>
      </div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker" style="--c:var(--s3)">Étape 4 — là où tout se joue</p>
      <h2>Mêmes scores, CN différents</h2>
      <p class="mx-lead">Un coureur a couru ${fmt(n)} courses en 12 mois. Sa meilleure, ${fmt(EXAMPLE[0][0])}, est un championnat de France (★) ;
        ${fmt(EXAMPLE[2][0])} est une nationale. Voici ce que chaque méthode retient de ces mêmes scores :</p>
      ${M.map((m) => html`<div class="mx-agg" style="${cvar(m)}">
        <div><b>${methodKey(m)} ${methodShort(m)}</b><div class="what">${EX[m].what}</div></div>
        ${chips(m)}
        <div class="cn">${fmt(EX[m].cn)}</div></div>`)}
      <div class="mx-callout">La meilleure course de l'année — un championnat de France — est <b>écartée</b> par la méthode officielle ;
        elle occupe <b>${fmtW(pf.weights.cdf)} places sur ${fmt(p6.top_n)}</b> dans le Top. ×2, ×1,5 : le poids de la course, ou les places qui
        lui restent. ${analyst ? html`Dans les méthodes « Juste », la course de ${fmt(EXAMPLE[5][0])} compte encore : pas de plafond de places.` : ""}</div>
      <p class="muted" style="font-size:13px">Exemple pédagogique : dans la réalité, chaque méthode a aussi ses propres valeurs de circuit, donc
        ses propres scores. Les ${EXAMPLE.filter(([, k]) => k !== "other").map(([s, k]) => `${fmt(s)} (${kindName[k]})`).join(" et ")} sont marqués.</p>
    </section>

    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">${methodKey("official")} ${methodLabel("official")}</p>
      <h2>La moyenne du milieu</h2>
      <p>Depuis 2026 : la moyenne des scores des 12 derniers mois, <b>sans les 10 % meilleurs ni les 40 % moins bons</b>, et un recalage
        chaque 1er janvier qui fixe à 5 600 la moyenne des 20 % meilleurs CN. Forêt et sprint ont chacun leur classement ; avant 2026, un seul
        classement pédestre les réunissait, que le site affiche tel quel.</p>
      <details><summary>Ce que les données montrent des règles passées</summary>
        <ul>
          <li>un coefficient de 0,95 sur la valeur des circuits en 2022 (1,00 les autres années) ;</li>
          <li>avant 2026, seule la meilleure course était écartée, et un recalage ramenait le meilleur CN à 10 000 quand il dépassait ce plafond —
            observé au 1er janvier 2013, 2023, 2024 et 2025.</li>
        </ul>
        <p>La page d'un coureur présente, à côté du CN publié, une reconstruction : la règle documentée appliquée aux scores officiels. Les
          écarts éventuels viennent de résultats absents du site ou corrigés après coup, ou des réévaluations que la FFCO publie sur sa propre page.</p>
      </details>
    </section>

    ${tops.length ? html`<section class="mx-slide" style="${cvar(tops[0])}">
      <p class="mx-kicker">${tops.map((m) => methodKey(m))} Méthodes « Top »</p>
      <h2>${fmt(p6.top_n)} places pour vos meilleures courses</h2>
      <div class="mx-eq">CN = Σ (places × score) ÷ Σ places, au plus ${fmt(p6.top_n)} places, parmi les ${pctOf(p6.eligible_fraction)} meilleurs scores</div>
      <ul class="mx-list">
        <li><span>Du meilleur score au moins bon, chaque course occupe autant de places que son poids : championnat de France ${fmtW(pf.weights.cdf)},
          nationale (O'France, Nationale) ${fmtW(pf.weights.national)}, toute autre course ${fmtW(pf.weights.other)}. La dernière ne prend que les places qui restent.</span></li>
        <li><span><b>Une course de plus ne peut jamais faire baisser le CN</b> : soit elle entre dans les places, en chassant une moins bonne, soit
          elle n'y entre pas. Courir plus, c'est plus de chances de remplir ses ${fmt(p6.top_n)} places.</span></li>
        <li><span>Il faut au moins ${fmt(pf.min_scores)} courses pour être classé. Avec moins de ${fmt(p6.top_n)} places remplies, le CN est la moyenne
          de ce qui est là.</span></li>
        <li><span>Inspirée du <i>World Ranking</i> de l'IOF, qui retient les meilleures courses de chaque coureur.</span></li>
      </ul>
      <h3>Pourquoi les circuits ne sont pas valorisés avec le Top</h3>
      <p>Un CN qui ne garde que les meilleures courses, utilisé pour noter les circuits, se nourrit de lui-même : les groupes qui courent surtout
        entre eux (vétérans, jeunes) se gonflent, les H/D 21 se dévaluent — de 13 % environ dans nos essais. Les circuits sont donc valorisés
        avec ${force}, la moyenne pondérée des ${pctOf(pf.eligible_fraction)} meilleurs scores sans plafond de places ; le Top n'en diffère que par
        sa règle des ${fmt(p6.top_n)} places.</p>
    </section>` : ""}

    ${analyst ? html`<section class="mx-slide" style="${cvar("fair")}">
      <p class="mx-kicker">${methodKey("fair")}${methodKey("fair2")} Méthodes « Juste » · accès analyse</p>
      <h2>Le niveau habituel, sur une échelle stable depuis 2010</h2>
      <div class="mx-eq">CN = Σ (poids × score) ÷ Σ poids, sur les ${pctOf(pf.eligible_fraction)} meilleurs scores</div>
      <ul class="mx-list">
        <li><span>Mêmes poids que le Top, sans plafond de places : toutes les courses retenues comptent.</span></li>
        <li><span>C'est elle qui fournit les CN J-15 des circuits pour les deux Top : la linéaire pour le ${methodShort("top6w")}, la quadratique
          pour le ${methodShort("top6w2")}. Le Top en est dérivé : mêmes scores, mêmes valeurs de circuit, même recalage.</span></li>
        <li><span>Elle prédit les duels au moins aussi bien que le Top : c'est la mesure de la force, quand le Top est celle du potentiel.</span></li>
      </ul>
    </section>` : ""}

    <section class="mx-slide" id="quadratique" style="${cvar("top6w2")}">
      <p class="mx-kicker">Linéaire ou quadratique</p>
      <h2>Combien doit coûter une minute de retard ?</h2>
      <p class="mx-lead">Le score de course est inversement proportionnel au temps. On peut l'écrire de façon plus générale, avec un exposant
        <i>k</i> qui règle le prix d'un écart de temps :</p>
      <div class="mx-eq">ln(score) = constante − <i>k</i> · ln(temps) &nbsp;&nbsp;⇔&nbsp;&nbsp; score ∝ 1 / temps<sup><i>k</i></sup>
        <small>k = 1 : la règle actuelle — 10 % plus lent, 9 % de score en moins. k = 2 : 17 % en moins.</small></div>
      <div style="margin:8px 0 4px">${curve}</div>
        <div><p>Plus <i>k</i> est grand, plus un temps éloigné de celui des meilleurs pèse lourd. Nous avons mesuré, pour chaque valeur de <i>k</i>,
          la part des duels bien prédits (même test que dans <a href="#/methodes?onglet=analyses" data-tab-link="analyses">les analyses</a>),
          sur les mêmes paires.</p>
          <p><b>Le gain se fait entre k = 1 et k = 2</b>, dans les quatre spécialités ; au-delà, il plafonne puis redescend.</p></div>
      <div class="table-wrap"><table class="data compact mx-ktab"><thead><tr><th>${t("f.terrain")}</th><th>Période</th><th class="r">Duels</th>
        <th class="r">${methodShort("official")}</th>${K_TESTS.ks.map((k) => html`<th class="r ${k === 2 ? "k2" : ""}">k = ${String(k).replace(".", ",")}</th>`)}</tr></thead>
        <tbody>${K_TESTS.rows.map(kRow)}</tbody>
        <tbody><tr><td colspan="${4 + K_TESTS.ks.length}" class="muted" style="font-size:12.5px">Contrôle sur les saisons précédentes</td></tr>
          ${K_TESTS.past.map(kRow)}</tbody></table></div>
      <p class="muted" style="font-size:13px">Part des duels bien prédits (%), mesurée le 7 octobre 2026 avec ${force}. En gras, le meilleur de chaque ligne.
        En ski, trop peu de courses (2 à 4 par saison) pour battre la méthode officielle ; sur 2018–2024, k = 2 l'emporte aussi en forêt, pas en sprint.</p>

      <h3>k = 2, sans changer l'échelle : les moyennes quadratiques</h3>
      <p>Appliquer k = 2 tel quel donnerait des scores au carré. Or calculer avec k = 2 puis prendre la racine carrée revient exactement à
        remplacer deux moyennes par des <b>moyennes quadratiques</b> (la racine de la moyenne des carrés) : celle de la <b>valeur du circuit</b>
        et celle du <b>CN</b>. C'est la variante quadratique : les classements de k = 2, des CN à l'échelle habituelle.</p>
      <div class="mx-eq">moyenne quadratique de 6 000, 5 000 et 4 000 = √((6 000² + 5 000² + 4 000²) ÷ 3) = 5 066 &nbsp;·&nbsp; moyenne linéaire : 5 000</div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th class="r">Duels</th><th class="r">Linéaire</th>
        <th class="r">Valeur du circuit quadratique</th><th class="r">CN quadratique</th><th class="r">Les deux</th></tr></thead>
        <tbody>${QUAD_PARTS.map(([tr, pairs, vals]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td class="r num">${fmt(pairs)}</td>
          ${vals.map((x, i) => html`<td class="r num">${i === 3 ? html`<b>${fmt(x, 2)}</b>` : fmt(x, 2)}</td>`)}</tr>`)}</tbody></table></div>
      <p class="muted" style="font-size:13px">Même mesure, chaque moyenne prise séparément : chacune améliore les pronostics, les deux ensemble davantage.</p>
      <h3>Ses effets</h3>
      <ul class="mx-list">
        <li><span>Dans la valeur d'un circuit, les coureurs qui ont couru nettement au-dessus de leur CN pèsent un peu plus : un circuit réussi
          par les meilleurs vaut davantage.</span></li>
        <li><span>Dans le CN, les meilleures courses pèsent un peu plus que les autres ; pour un coureur régulier, la différence est faible
          (${fmt(EX.top6w.cn)} → ${fmt(EX.top6w2.cn)} dans l'exemple).</span></li>
        <li><span><b>En forêt, l'échelle se resserre</b> : les CN montent tous un peu, davantage en bas du classement (+140 environ pour
          les meilleurs, +350 pour les derniers) ; l'écart entre le 10e et le 90e centile passe d'un facteur 2,65 à 2,42.</span></li>
        <li><span>Les classements bougent peu : en forêt, un coureur gagne ou perd 61 places sur 3 489 (médiane) ; ceux qui courent
          beaucoup (13 courses et plus) gagnent 27 places en moyenne, ceux qui n'en ont que 3 ou 4 en perdent 19. En sprint, presque rien
          ne change (5 places en médiane).</span></li>
      </ul>
      <p class="muted" style="font-size:13px">Mesures du 7 octobre 2026, Top linéaire et Top quadratique à cette date.</p>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Méthodes proposées</p>
      <h2>Le recalage : progressif, jamais rétroactif</h2>
      <ul class="mx-list">
        <li><span>Chaque mois, un facteur ramène la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN à ${fmt(pf.anchor_target)} — la règle
          de la FFCO depuis 2026, appliquée en continu plutôt qu'au 1er janvier —, dans chaque spécialité, à partir du niveau mesuré
          ${fmt(pf.anchor_lag_months)} mois plus tôt pour que les résultats tardifs ne fassent pas bouger l'échelle.</span></li>
        <li><span>Le facteur d'une course est celui de son jour : il passe en ligne droite d'une valeur mensuelle à la suivante.</span></li>
        <li><span>Le score d'une course est fixé une fois pour toutes : le CN ne change que lorsqu'une course entre dans la fenêtre ou en sort.</span></li>
      </ul>
      <div style="margin-top:16px">${chartCard({ id: "norm", title: t("me.norm"), hint: t("me.norm.hint"), short: true })}</div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Spécialités et fenêtres</p>
      <h2>Quatre classements séparés</h2>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>${methodShort("official")}</th>
        <th>Méthodes proposées : fenêtre</th><th class="r">Scores retenus</th></tr></thead>
        <tbody>${windows.map(([tr, w, f]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>12 mois</td><td>${years(w)}</td><td class="r">${pctOf(f)} meilleurs</td></tr>`)}</tbody></table></div>
      <p>Le VTT (une trentaine de compétitions par saison) et le ski (2 à 4) ont des fenêtres plus longues : sur 12 mois, trop peu de coureurs y
        auraient un CN pour valoriser les circuits. Dans toutes les méthodes proposées, il faut au moins ${fmt(pf.min_scores)} courses dans la fenêtre pour être classé.</p>
    </section>`;
  }

  // ======================================================================================================
  // 3. Les analyses
  // ======================================================================================================
  function analyses() {
    const TR = TERRAINS.filter((x) => entry(x));
    const bold = (on, s) => (on ? html`<b>${s}</b>` : s);
    const pctCell = (e, m) => {
      if (!e) return html`<td class="r num">—</td>`;
      const best = Math.max(...VM.map((k) => right(e, k)));
      return html`<td class="r num">${bold(right(e, m) === best, `${fmt(share(e, m), 1)} %`)}</td>`;
    };
    const table = (scope) => html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>${t("f.terrain")}</th><th class="r">${t("me.val.pairs")}</th>${VM.map((m) => html`<th class="r">${methodShort(m)}</th>`)}
      ${ref ? html`<th class="r" title="${t("me.val.avoided.hint", { m: methodLabel(ref) })}">${t("me.val.avoided")} (${methodShort(ref)})</th>` : ""}</tr></thead>
      <tbody>${TR.map((x) => {
        const e = entry(x, scope);
        return html`<tr><td>${t(`terrain.${x}`)}</td><td class="r num">${e ? fmt(e[0]) : "—"}</td>${VM.map((m) => pctCell(e, m))}
          ${ref ? html`<td class="r num">${e ? `${fmt(Math.round(avoided(e)))} %` : "—"}</td>` : ""}</tr>`;
      })}</tbody></table></div>`;
    // errors per 100 duels, full scale: what each method gets wrong
    const bars = (x) => {
      const e = entry(x);
      const top = Math.max(...VM.map((m) => 100 - share(e, m)));
      return html`<div class="mx-box" style="--c:${terrainColor(x)}"><h3>${t(`terrain.${x}`)}</h3>
        <div class="mx-bars">${VM.map((m) => html`<div class="mx-bar" style="${cvar(m)}"><span>${methodShort(m)}</span>
          <div class="track"><div class="fill" style="width:${((100 - share(e, m)) / Math.max(25, top)) * 100}%"></div></div>
          <span class="v">${fmt(100 - share(e, m), 1)}</span></div>`)}</div>
        <p style="font-size:12.5px">erreurs sur 100 duels · ${fmt(e[0])} duels</p></div>`;
    };
    const groups = [["J", t("me.val.bias.J")], ["V", t("me.val.bias.V")]];
    const biasRows = TR.filter((x) => x !== "Ski").flatMap((x) => groups.map(([g, label]) => [x, label, v.bias[x]?.[g]?.[season]]))
      .filter(([, , b]) => b?.[0]);
    const biasCol = (m) => 2 + v.methods.indexOf(m);

    return html`
    <section class="mx-slide mx-hero">
      <p class="mx-kicker">Le test</p>
      <h2>Avant la course, qui est favori ? Après, a-t-il gagné ?</h2>
      <p class="mx-lead">Sur chaque circuit, chaque paire de coureurs classés est un duel. Chaque méthode désigne un favori : celui qui avait le
        CN le plus élevé <b>15 jours avant</b> — sans rien savoir de la course. On compte les duels où le favori a bien terminé devant. Toutes
        les méthodes sont jugées <b>sur les mêmes duels</b> : ceux où les deux coureurs ont un CN dans chacune.</p>
      ${ref ? html`<div class="mx-stats">${["For", "Spr"].filter((x) => entry(x)).map((x) => {
        const e = entry(x);
        return html`<div class="mx-stat"><b>${fmt(share(e, ref), 1)} %</b><span>de duels bien prédits ${x === "For" ? "en forêt" : "en sprint"} par la
          ${methodLabel(ref)}, contre ${fmt(share(e, "official"), 1)} % pour la méthode officielle (${season})</span></div>`;
      })}</div>` : ""}
    </section>

    ${v ? html`<section class="mx-slide">
      <p class="mx-kicker">Saison ${season}</p>
      <h2>Les méthodes proposées se trompent moins</h2>
      <div class="mx-grid">${["For", "Spr", "VTT"].filter((x) => entry(x)).map(bars)}</div>
      <p>Le calcul des méthodes proposées, mesuré aussi saison par saison de 2012 à 2025, fait mieux que la méthode officielle <b>à chacune</b>,
        en forêt comme en sprint. En ski, les duels sont trop peu nombreux pour conclure.</p>
      <h3>${t("me.val.all")} · ${season}</h3>${table("all")}
      <h3>${t("me.val.nat")}</h3><p class="muted" style="font-size:13px;margin-top:-4px">${t("me.val.nat.hint")}</p>${table("nat")}
      <p class="muted" style="font-size:13px">${t("me.val.hint")}</p>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Équité entre les âges</p>
      <h2>Jeunes et vétérans, à leur juste place</h2>
      <p>Les jeunes et les plus de 55 ans courent surtout entre eux : un mauvais calcul les surévalue ou les sous-évalue face aux H/D 21. Sur
        leurs duels avec un H/D 21, la part où chaque méthode les donne devant, à comparer à la part où ils ont vraiment terminé devant
        (en gras, la plus proche).</p>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>${t("me.val.bias.group")}</th>
        <th class="r">${t("me.val.pairs")}</th><th class="r">${t("me.val.bias.actual")}</th>${VM.map((m) => html`<th class="r">${methodShort(m)}</th>`)}</tr></thead>
        <tbody>${biasRows.map(([x, label, b]) => {
          const real = (100 * b[1]) / b[0];
          const pred = VM.map((m) => (100 * b[biasCol(m)]) / b[0]);
          const closest = Math.min(...pred.map((q) => Math.abs(q - real)));
          return html`<tr><td>${t(`terrain.${x}`)}</td><td>${label}</td><td class="r num">${fmt(b[0])}</td><td class="r num">${fmt(real, 1)} %</td>
            ${pred.map((q) => html`<td class="r num">${bold(Math.abs(q - real) === closest, `${fmt(q, 1)} %`)}</td>`)}</tr>`;
        })}</tbody></table></div>
    </section>` : html`<section class="mx-slide"><p>${t("me.val.none")}</p></section>`}

    ${tops.length === 2 ? html`<section class="mx-slide" id="lin-quad" style="${cvar("top6w2")}">
      <p class="mx-kicker">${methodKey("top6w")}${methodKey("top6w2")} En test</p>
      <h2>Top linéaire ou Top quadratique ?</h2>
      <div id="linquad"></div>
    </section>` : ""}

    <section class="mx-slide">
      <p class="mx-kicker">Accord entre méthodes</p>
      <h2>Des classements proches, pas identiques</h2>
      <p>Chaque point est un coureur à la dernière date disponible : son CN dans une méthode proposée face à son CN officiel.</p>
      <div class="filters" id="agr-filters"></div>
      <div class="grid grid-main-side" style="align-items:start">
        ${chartCard({ id: "agr", title: t("ov.agreement"), hint: t("ov.agreement.hint"), tall: true })}
        <section class="card"><div class="card-head"><h2>${t("ov.agreeStats")}</h2></div><div id="agr-stats"></div>
          <div class="card-body"><p class="muted" style="font-size:13px;margin:0">${t("ov.agreeStats.note")}</p></div></section>
      </div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Conclusion</p>
      <h2>Quelle méthode pour quoi ?</h2>
      <div class="mx-verdict">
        <div class="mx-box" style="${cvar(tops[tops.length - 1] || "top6w")}"><h3>Classer, qualifier, sélectionner</h3>
          <div class="who">${tops.map((m) => methodShort(m)).join(" ou ")}</div>
          <p>Le potentiel au meilleur niveau, nourri par les grandes compétitions ; une course de plus ne le fait jamais baisser.</p></div>
        <div class="mx-box" style="${cvar(analyst ? "fair2" : tops[tops.length - 1] || "top6w")}"><h3>Prédire qui finira devant</h3>
          <div class="who">${analyst ? html`${methodShort("fair2")}, puis les Top` : "Les méthodes proposées"}</div>
          <p>À quelques dixièmes près entre elles, et nettement devant la méthode officielle.</p></div>
        <div class="mx-box" style="${cvar(analyst ? "fair" : "official")}"><h3>Valoriser les circuits</h3>
          <div class="who">${analyst ? html`${methodShort("fair")} / ${methodShort("fair2")}` : "Le CN « de force »"}</div>
          <p>Le niveau habituel des coureurs, sans le plafond de places qui fausserait les circuits.</p></div>
        <div class="mx-box" style="${cvar("official")}"><h3>Faire foi</h3>
          <div class="who">${methodShort("official")}</div>
          <p>Le seul classement officiel : celui des sélections, quelles que soient ses limites.</p></div>
      </div>
    </section>`;
  }

  // ======================================================================================================
  // 4. Autres calculs
  // ======================================================================================================
  const autres = () => html`
    <section class="mx-slide" id="clubs">
      <p class="mx-kicker">Clubs</p>
      <h2>Classements des clubs</h2>
      <p>Un club se classe selon deux choix indépendants, sur les coureurs d'un sexe et d'une tranche d'âge donnés
        (jeunes : jusqu'à H/D 20 ; adultes : H/D 21 et plus ; élite : H/D 21 seulement) :</p>
      <div class="mx-grid">
        <div class="mx-box" style="--c:var(--s1)"><h3>Ce que l'on compte</h3><p>Le <b>CN</b> de chaque coureur classé (pour une méthode de CN),
          ou ses <b>points en courses nationales</b>.</p></div>
        <div class="mx-box" style="--c:var(--s3)"><h3>Comment on l'agrège</h3><p>La <b>somme</b> (effectif et niveau à la fois), la <b>moyenne</b>
          (le niveau du coureur moyen), le <b>top 5</b> (moyenne des cinq meilleurs, un coureur manquant comptant 0) ou l'<b>effectif</b>.</p></div>
      </div>
    </section>
    <section class="mx-slide" id="elite">
      <p class="mx-kicker">Clubs</p>
      <h2>Points en courses nationales</h2>
      <p>Ils ne dépendent d'aucune méthode de CN : ils reposent sur les résultats bruts. Aux courses de niveau national (groupes A et B1 :
        championnats de France, nationales, courses de sélection), les 10 premiers de chaque catégorie marquent 25, 18, 15, 12, 10, 8, 6, 4, 2
        et 1 points ; les points sont <b>doublés aux championnats de France</b>. Une catégorie est classée sur le circuit où la majorité de ses
        coureurs ont couru. Sur la page des clubs, les points portent sur les 12 mois précédant la date choisie ; la comparaison de clubs les
        montre saison par saison.</p>
    </section>
    <section class="mx-slide" id="progression">
      <p class="mx-kicker">Coureurs</p>
      <h2>Progression par âge</h2>
      <p>Pour chaque saison et chaque catégorie (H14, D21, H45…), on prend les CN de tous les coureurs classés à la fin de la saison et on en
        calcule la distribution (médiane, 50 % et 80 % centraux). Chaque mois, le CN d'un coureur est situé dans la distribution de sa
        catégorie de la saison : son <b>centile</b> est la part des coureurs de sa catégorie ayant un CN inférieur ou égal. La courbe
        « toutes saisons » regroupe les saisons depuis 2012 ; c'est une photographie de l'ensemble des coureurs, pas le suivi d'une même génération.</p>
    </section>
    <section class="mx-slide" id="reseau">
      <p class="mx-kicker">Réseau</p>
      <h2>Qui court avec qui</h2>
      <p>Deux coureurs se « rencontrent » quand ils courent le même circuit. Sur toutes les saisons, le site retient pour chaque coureur les
        30 coureurs rencontrés le plus souvent (au moins 2 fois) ; pour une saison, il les recalcule à partir des résultats de la saison.
        Il compte aussi le nombre de fois où chacun a terminé devant l'autre ; un coureur non classé (PM, abandon…) est derrière tous les classés.</p>
    </section>
    <section class="mx-slide" id="limites">
      <p class="mx-kicker">À garder en tête</p>
      <h2>Limites et précautions</h2>
      <ul class="mx-list bad">
        <li><span>Les données proviennent du site du CN de la FFCO. Une course absente, mal saisie ou corrigée ensuite peut expliquer un écart.</span></li>
        <li><span>Les méthodes proposées partent des CN de 2010 ; les premiers mois reflètent surtout ce point de départ.</span></li>
        <li><span>Leurs CN ne remplacent en aucun cas le classement officiel, qui reste la seule référence.</span></li>
        <li><span>Les instantanés du classement sont calculés en fin de mois ; la page d'un coureur détaille le calcul à n'importe quelle date.</span></li>
      </ul>
    </section>`;

  // ---- charts, drawn when their tab is first shown -------------------------------------------------------
  function drawNorm() {
    bindChartCard(main, "norm");
    const norm = TERRAINS.filter((tr) => meta.normalisation[tr]).map((tr) => ({
      name: t(`terrain.${tr}`), color: terrainColor(tr),
      data: meta.normalisation[tr].map(([d, f]) => [d, Number(f.toFixed(4))]),
    }));
    $("#norm-legend").innerHTML = legend(norm.map((s) => ({ label: s.name, color: s.color })));
    timeChart($("#norm"), { series: norm, yName: t("calc.factor"), zoom: false, digits: 3 });
    const idx = norm.map((s) => new Map(s.data));
    const dates = [...new Set(norm.flatMap((s) => s.data.map((p) => p[0])))].sort().reverse();
    $("#norm-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.date")}</th>
      ${norm.map((s) => html`<th class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${dates.map((d) => html`<tr><td>${d}</td>${idx.map((m) => html`<td class="r num">${fmt(m.get(d), 4)}</td>`)}</tr>`)}</tbody></table>`;
  }
  // how far the methods agree, per discipline: each visible computed method against the official one.
  // meta.agreement rows: [official, fair, top6w, fair2, top6w2]
  const AGREE_COL = { fair: 1, top6w: 2, fair2: 3, top6w2: 4 };
  const computed = M.filter((m) => m !== "official");
  let agTerrain = "For";
  function drawAgreement() {
    $("#agr-filters").innerHTML = html`<div class="field"><span>${t("f.terrain")}</span>${seg("agt", TERRAINS.filter((x) => meta.agreement[x]?.length).map((x) => [x, t(`terrain.${x}`)]), agTerrain)}</div>`;
    $$('[data-seg="agt"]').forEach((b) => b.addEventListener("click", () => { agTerrain = b.dataset.value; drawAgreement(); }));
    const pts = meta.agreement[agTerrain] || [];
    const series = computed.map((m) => ({
      m, name: methodShort(m), color: methodColor(m),
      data: pts.filter((p) => p[0] && p[AGREE_COL[m]]).map((p) => [p[0], p[AGREE_COL[m]]]),
    }));
    const max = Math.ceil(Math.max(0, ...pts.flat().filter(Boolean)) / 1000) * 1000;
    $("#agr-legend").innerHTML = legend(series.map((s) => ({ label: `${s.name} / ${methodShort("official")}`, color: s.color, dot: true })));
    scatterChart($("#agr"), { series, xName: methodLabel("official"), yName: "CN", max });
    const stat = (name, pairs) => {
      const d = pairs.map((p) => p[1] - p[0]);
      return { name, n: pairs.length, r: pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])), bias: mean(d), mae: mean(d.map(Math.abs)) };
    };
    const vs = (a, b) => stat(`${methodShort(b)} / ${methodShort(a)}`,
      pts.filter((p) => p[AGREE_COL[a]] && p[AGREE_COL[b]]).map((p) => [p[AGREE_COL[a]], p[AGREE_COL[b]]]));
    const stats = [
      ...series.map((x) => stat(`${x.name} / ${methodShort("official")}`, x.data)),
      ...(computed.includes("top6w") && computed.includes("top6w2") ? [vs("top6w", "top6w2")] : []),
      ...(computed.includes("fair") && computed.includes("top6w") ? [vs("fair", "top6w")] : []),
    ];
    $("#agr-stats").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>${t("ov.pair")}</th><th class="r">n</th><th class="r">r</th><th class="r">${t("ov.bias")}</th><th class="r">${t("ov.mae")}</th></tr></thead>
      <tbody>${stats.map((s) => html`<tr><td>${s.name}</td><td class="r num">${fmt(s.n)}</td>
        <td class="r num">${fmt(s.r, 3)}</td><td class="r num">${fmtSigned(Math.round(s.bias))}</td><td class="r num">${fmt(s.mae)}</td></tr>`)}</tbody></table></div>`;
    $("#agr-table").innerHTML = $("#agr-stats").innerHTML;
  }
  function drawLinQuad() {
    const box = $("#linquad");
    if (!box) return;
    const show = LQ.filter((m) => M.includes(m));          // the visible methods, measured
    const at = (vals, m) => vals[LQ.indexOf(m)];
    const gap = (x) => html`<span style="color:${x > 0 ? "var(--good)" : x < 0 ? "var(--bad)" : "inherit"}">${x > 0 ? "+" : x < 0 ? "−" : "±"}${fmt(Math.abs(x), 2)}</span>`;
    const scope = { all: "toutes les courses", nat: "courses nationales" };
    const group = { J: t("me.val.bias.J"), V: t("me.val.bias.V") };
    const d25 = (x, sc) => { const e = entry(x, sc); return e ? share(e, "top6w2") - share(e, "top6w") : null; };
    box.innerHTML = html`
      <p class="mx-lead">Mesuré sur juillet 2025 – octobre 2026, sur les mêmes duels pour toutes les méthodes : la part des duels bien prédits.</p>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Courses</th><th class="r">Duels</th>
        ${show.map((m) => html`<th class="r">${methodShort(m)}</th>`)}<th class="r">Quad. − lin. (Top)</th></tr></thead>
        <tbody>${LIN_QUAD.acc.map(([tr, sc, pairs, vals]) => {
          const best = Math.max(...show.map((m) => at(vals, m)));
          return html`<tr><td>${t(`terrain.${tr}`)}</td><td>${scope[sc]}</td><td class="r num">${fmt(pairs)}</td>
            ${show.map((m) => html`<td class="r num">${at(vals, m) === best ? html`<b>${fmt(at(vals, m), 2)} %</b>` : `${fmt(at(vals, m), 2)} %`}</td>`)}
            <td class="r num">${gap(at(vals, "top6w2") - at(vals, "top6w"))}</td></tr>`;
        })}</tbody></table></div>
      ${v ? html`<p class="muted" style="font-size:13px">Sur la seule saison ${season} (tableaux plus haut), même sens :
        ${["For", "Spr", "VTT"].filter((x) => entry(x)).map((x, i) => html`${i ? " ; " : ""}${x === "VTT" ? "VTT" : t(`terrain.${x}`).toLowerCase()} ${gap(d25(x, "all"))}
          sur toutes les courses, ${d25(x, "nat") == null ? "—" : gap(d25(x, "nat"))} sur les nationales`)}.</p>` : ""}
      <h3>Jeunes et vétérans</h3>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>${t("me.val.bias.group")}</th>
        <th class="r">Duels</th><th class="r">${t("me.val.bias.actual")}</th>${show.map((m) => html`<th class="r">${methodShort(m)}</th>`)}</tr></thead>
        <tbody>${LIN_QUAD.bias.map(([tr, g, pairs, real, vals]) => {
          const closest = Math.min(...show.map((m) => Math.abs(at(vals, m) - real)));
          return html`<tr><td>${t(`terrain.${tr}`)}</td><td>${group[g]}</td><td class="r num">${fmt(pairs)}</td><td class="r num">${fmt(real, 1)} %</td>
            ${show.map((m) => html`<td class="r num">${Math.abs(at(vals, m) - real) === closest ? html`<b>${fmt(at(vals, m), 1)} %</b>` : `${fmt(at(vals, m), 1)} %`}</td>`)}</tr>`;
        })}</tbody></table></div>
      <div class="mx-grid" style="margin-top:16px">
        <div class="mx-box" style="${cvar("top6w2")}"><h3>Pour le quadratique</h3><ul class="mx-list">
          <li><span>Un peu plus de duels bien prédits sur l'ensemble des courses : +0,15 point en forêt, +0,10 en sprint, dans le même sens en ${season || "2025"}.</span></li>
          <li><span>Les jeunes, sous-évalués par toutes les méthodes face aux H/D 21, sont mieux placés : en forêt, juste au bon niveau.</span></li>
          <li><span>Il correspond au réglage k = 2, le meilleur de nos mesures (onglet « En détail »).</span></li>
        </ul></div>
        <div class="mx-box" style="${cvar("top6w")}"><h3>Pour le linéaire</h3><ul class="mx-list">
          <li><span>Un peu meilleur sur les seules courses nationales : +0,03 point en forêt, +0,09 en sprint.</span></li>
          <li><span>Moins de surévaluation des 55 ans et plus en forêt.</span></li>
          <li><span>Plus simple à expliquer ; il garde l'échelle actuelle, que le quadratique resserre en forêt.</span></li>
        </ul></div>
      </div>
      <div class="mx-callout"><b>Bilan provisoire</b> : des écarts d'un ou deux dixièmes de point, bien plus petits que l'écart de l'une ou l'autre
        avec la méthode officielle (1,1 à 3,7 points). Les deux Top prédisent mieux que la méthode officielle sur chaque ligne ; le choix entre elles tiendra
        autant à la simplicité et à l'échelle qu'aux pronostics.</div>`;
  }
  const DRAW = { detail: drawNorm, analyses: () => { drawAgreement(); drawLinQuad(); } };
  const BUILD = { essentiel, detail, analyses, autres };

  // ---- tabs ----------------------------------------------------------------------------------------------------
  const built = new Set();
  function show(k, goto, instant = false) {
    const panel = $(`[data-panel="${k}"]`, main);
    if (!built.has(k)) {
      built.add(k);
      panel.innerHTML = BUILD[k]();
      bindLinks(panel);
    }
    $$("[data-panel]", main).forEach((p) => { p.hidden = p !== panel; });
    $$("[data-tab]", main).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    if (DRAW[k] && !built.has(`${k}:drawn`)) { built.add(`${k}:drawn`); DRAW[k](); }
    replaceQuery({ onglet: k === "essentiel" ? null : k, voir: goto || null });
    const target = goto && document.getElementById(goto);
    // a deep link (?voir=) is followed once the page is in place
    if (target) setTimeout(() => target.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "start" }), instant ? 50 : 0);
  }
  function bindLinks(root) {
    $$("[data-tab-link]", root).forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      show(a.dataset.tabLink, a.dataset.goto);
      if (!a.dataset.goto) main.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }
  $$("[data-tab]", main).forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  const first = TABS.some(([k]) => k === query.onglet) ? query.onglet : "essentiel";
  show(first, query.voir, true);
  return { title: t("page.methods") };
}

// Methods: what each of the three CN methods means, the shared score formula,
// the rules specific to each method, the recalage factors actually applied, and
// how far the three methods agree.

import { html, raw, $, $$, fmt, fmtSigned, fmtDate, mean } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { timeChart, columnChart, scatterChart, methodColor, terrainColor, css } from "../charts.js";
import { TERRAINS } from "../store.js";
import { chartCard, bindChartCard, legend, methodKey, methodLabel, methodShort, seg } from "../ui.js";

function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export async function render(main) {
  const meta = data.meta();
  const pf = meta.methods.fair.params, p6 = meta.methods.top6w.params;
  const pct = (x) => `${fmt(100 * x)} %`;
  // where a discipline has its own value (VTT, ski: fewer competitions): "70 % en VTT et en Ski"
  const own = (p, key, show) => {
    const by = Object.entries(p.by_terrain || {}).filter(([, o]) => o[key] != null && o[key] !== p[key]);
    const same = by.length > 1 && by.every(([, o]) => o[key] === by[0][1][key]);
    if (!by.length) return "";
    return same ? `${show(by[0][1][key])} en ${by.map(([tr]) => t(`terrain.${tr}`)).join(" et en ")}`
      : by.map(([tr, o]) => `${show(o[key])} en ${t(`terrain.${tr}`)}`).join(", ");
  };
  const years = (d) => `${fmt(Math.round(d / 365))} ans`;
  const alsoPct = (p) => (own(p, "eligible_fraction", pct) ? ` (${own(p, "eligible_fraction", pct)})` : "");
  const fmtW = (w) => fmt(w, Number.isInteger(w) ? 0 : 1);   // 1,5 must not read as 2

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("page.methods")}</h1>
      <p class="lede">Mêmes résultats, trois façons de compter.</p></div></div>

    <div class="notice info" style="margin-bottom:16px">Site indépendant et non officiel, sans lien avec la Fédération française de course d'orientation.
      Seule la ${methodLabel("official")} reprend des valeurs publiées par la FFCO ; les deux autres sont des calculs alternatifs, à but d'analyse.</div>

    <div class="grid grid-3" style="margin-bottom:24px">
      <section class="card"><div class="card-body">
        <h2>${methodKey("official")} ${t("m.official")}</h2>
        <p class="muted">Les CN et les scores tels que publiés sur cn.ffcorientation.fr, sans aucun recalcul.</p></div></section>
      <section class="card"><div class="card-body">
        <h2>${methodKey("fair")} ${t("m.fair")}</h2>
        <p class="muted">La force de chaque coureur, qui sert aussi à calculer la valeur des circuits : la moyenne pondérée de ses
          ${pct(pf.eligible_fraction)} meilleures courses${alsoPct(pf)}, avec un recalage progressif plutôt qu'annuel.</p></div></section>
      <section class="card"><div class="card-body">
        <h2>${methodKey("top6w")} ${t("m.top6w")}</h2>
        <p class="muted">Le potentiel au meilleur niveau, adapté aux qualifications : les mêmes scores que la méthode Juste, mais seules
          les meilleures courses comptent, sur ${fmt(p6.top_n)} places. Courir plus ne peut que le faire monter.</p></div></section>
    </div>

    <div class="prose">
      <h2>Deux usages du CN, deux méthodes</h2>
      <p>Le CN sert à deux choses très différentes :</p>
      <ul>
        <li><b>estimer la force de chaque coureur</b>, pour calculer la valeur des circuits : il faut alors son niveau habituel,
          que ne déforment ni une contre-performance ni un exploit isolé ;</li>
        <li><b>classer les coureurs selon leur potentiel au meilleur niveau</b>, notamment pour les qualifications aux championnats de France :
          il faut alors ce dont un coureur est capable dans une compétition importante, c'est-à-dire ses meilleures courses.</li>
      </ul>
      <p>La ${methodLabel("official")} utilise un seul CN pour les deux. Pour estimer la force moyenne d'un coureur dans le calcul des circuits,
        il convient : c'est une moyenne qui écarte les scores extrêmes. Mais il ne convient pas pour estimer le potentiel d'un coureur dans une
        compétition importante : il écarte justement ses meilleures courses, souvent un championnat ou une course nationale, et n'incite pas à
        courir davantage. C'est pourtant ce CN qui sert à qualifier les coureurs aux championnats de France.</p>
      <p>Les deux méthodes proposées séparent ces deux usages, à partir des mêmes scores de course : la ${methodLabel("fair")} estime la force
        des coureurs et sert au calcul de la valeur des circuits ; la ${methodLabel("top6w")} classe les coureurs selon leur potentiel au meilleur
        niveau, et convient aux qualifications.</p>
    </div>

    <div class="prose">
      <h2>Le principe commun : le score de course</h2>
      <p>Pour chaque circuit, on calcule une <b>valeur de circuit</b> à partir des coureurs classés qui ont déjà un CN,
      pris ${fmt(pf.lag_days)} jours avant la course (le « CN J-15 »). On retient les plus rapides — les deux tiers arrondis au supérieur —
      et on fait la moyenne du produit CN × temps :</p>
      <div class="formula">valeur du circuit = moyenne (CN J-15 × temps) sur les 2/3 les plus rapides</div>
      <p>Le score de chaque coureur est alors :</p>
      <div class="formula">score = valeur du circuit ÷ temps du coureur</div>
      <p>Un coureur qui court aussi vite que son CN le prévoit obtient donc un score proche de son CN. Un poinçon manquant, un abandon,
      une disqualification ou un hors-délai donnent un score de 0 qui compte dans le calcul. Les catégories H10 et D10 ne sont pas prises en compte.</p>
      <p>Toutes les méthodes utilisent une <b>fenêtre glissante de 12 mois</b> (365 jours) jusqu'à la date de calcul${
        own(pf, "window_days", years) ? ` — pour les méthodes « ${methodShort("fair")} » et « ${methodShort("top6w")} », ${own(pf, "window_days", years)}, où les compétitions sont plus rares —` : ""}, et
      tiennent un classement séparé par spécialité : <b>Forêt</b>, <b>Sprint</b>, <b>VTT</b> et <b>Ski</b>.
      Exception : avant 2026, la FFCO publiait un classement pédestre unique, forêt et sprint confondus ; la ${methodLabel("official")} l'affiche tel quel.</p>

      <h2>${methodKey("official")} ${methodLabel("official")}</h2>
      <p>Valeurs publiées. Au fil des saisons, le règlement a évolué, ce que les données laissent voir :</p>
      <ul>
        <li>un coefficient de 0,95 sur la valeur des circuits en 2022 (1,00 les autres années) ;</li>
        <li>avant 2026, un recalage ramenant le meilleur CN à 10 000 lorsqu'il dépassait ce plafond — observé au 1er janvier 2013, 2023, 2024 et 2025 ;</li>
        <li>à partir de 2026, un recalage annuel qui fixe à 5 600 la moyenne des 20 % meilleurs, et des classements forêt et sprint distincts.</li>
      </ul>
      <p>La page d'un coureur présente, à côté du CN publié, une reconstruction indicative : la règle documentée appliquée aux scores officiels.
      Les écarts éventuels peuvent venir de résultats absents du site ou de corrections apportées après coup.</p>
      <p><b>Limites</b></p>
      <ul>
        <li>La méthode a évolué au fil des années et inclut des ajustements annuels : les analyses sur le long terme sont impossibles.</li>
        <li>Elle écarte les meilleures courses : la meilleure avant 2026, les 10 % meilleures depuis. Or, pour les meilleurs coureurs, ce sont le plus
          souvent les <b>championnats de France et les courses nationales</b> : les compétitions qu'ils préparent en priorité, les plus relevées et les plus
          représentatives de leur niveau. Le CN officiel se prive ainsi précisément des résultats qui comptent le plus — un effet pervers de la méthode,
          que corrigent les méthodes ${methodShort("fair")} et ${methodShort("top6w")}.</li>
      </ul>

      <p>Depuis 2026, la règle officielle (moyenne des scores sans les 10 % meilleurs ni les 40 % moins bons, recalage chaque 1er janvier)
        a en outre ces inconvénients :</p>
      <ul>
        <li>la sélection aux championnats de France se base sur le CN : des coureurs cessent de courir les courses CN dès que leur CN est qualifiant ;</li>
        <li>des coureurs ne courent que les compétitions qui peuvent rapporter le plus de CN, et pas les autres ;</li>
        <li>les classements en sprint ont tendance à se resserrer, car les écarts relatifs y sont plus faibles qu'en forêt, et les coureurs à fort CN ont peu d'intérêt à courir : leur CN baisse à la plupart des courses ;</li>
        <li>de manière générale, la méthode n'incite pas à participer à beaucoup de compétitions CN ;</li>
        <li>l'ajustement annuel continue de gêner l'évaluation de son niveau sur le long terme ;</li>
        <li>toutes les courses contribuent également, quels que soient le nombre de participants et leur diversité.</li>
      </ul>

      <h2>${methodKey("fair")} ${methodLabel("fair")}</h2>
      <p>Une méthode alternative qui estime la force de chaque coureur, c'est-à-dire son niveau habituel, sur une échelle stable dans le temps,
        calculée sur toutes les saisons depuis 2010. C'est elle qui sert à calculer la valeur des circuits, pour les deux méthodes proposées :</p>
      <ul>
        <li>on garde les ${pct(pf.eligible_fraction)} meilleurs scores de la fenêtre${alsoPct(pf)} (arrondi à l'entier le plus proche) ;</li>
        <li>chaque score est pondéré selon le niveau de la compétition : championnat de France × ${fmtW(pf.weights.cdf)},
          course nationale (O'France, Nationale) × ${fmtW(pf.weights.national)}, toutes les autres × ${fmtW(pf.weights.other)} ;
          le CN est la moyenne pondérée de ces scores ;</li>
        <li>il faut au moins ${fmt(pf.min_scores)} courses pour avoir un CN ; un circuit ne compte que s'il a au moins ${fmt(pf.min_ranked)} coureurs classés ayant un CN ;
          seuls les coureurs ayant leur propre CN dans la spécialité entrent dans la valeur du circuit ;</li>
        <li>pas de recalage annuel : chaque mois, un facteur de recalage est calculé pour ramener la moyenne des
          ${pf.anchor_top_fraction ? html`${pct(pf.anchor_top_fraction)} meilleurs CN` : html`${fmt(pf.anchor_top_k)} meilleurs CN`}
          à ${fmt(pf.anchor_target)} — la règle de la FFCO depuis 2026, appliquée en continu plutôt qu'au 1er janvier —, séparément dans chaque spécialité,
          à partir du niveau mesuré ${fmt(pf.anchor_lag_months)} mois plus tôt pour que les résultats tardifs ne fassent pas bouger l'échelle ;</li>
        <li>le facteur d'une course est celui de son jour : il passe en ligne droite d'une valeur mensuelle à la suivante, sans marche au
          changement de mois. Chaque score est calculé une fois pour toutes et n'est jamais revu quand un nouveau facteur arrive ;
          le CN ne change que lorsqu'une course entre dans la fenêtre ou en sort.</li>
      </ul>
      <div class="formula">CN = Σ(poids × score) ÷ Σ(poids), sur les ${pct(pf.eligible_fraction)} meilleurs scores${alsoPct(pf)} — score = score brut × facteur(jour de la course)</div>
      <p><b>Ce qu'elle cherche à corriger</b> — Cette méthode vise à éliminer l'essentiel des inconvénients identifiés ci-dessus :</p>
      <ul>
        <li>elle est stable au fil des années : ni marche au 1er janvier, ni changement de règle ;</li>
        <li>les meilleures courses ne sont jamais écartées : les championnats de France et les courses nationales, que les meilleurs coureurs préparent
          en priorité, comptent au contraire davantage (× ${fmtW(pf.weights.cdf)} et × ${fmtW(pf.weights.national)}), et seules les courses les moins bonnes sont laissées de côté ;</li>
        <li>le CN de chacun dépend de son niveau habituel, pas du nombre de courses courues : les groupes qui courent surtout entre eux
          (jeunes, vétérans) ne s'écartent pas des autres ;</li>
        <li>elle sépare le sprint et la forêt, comme le VTT et le ski.</li>
      </ul>
      <p>Résultat mesurable : elle prédit nettement mieux que la ${methodLabel("official")} qui terminera devant l'autre
        (voir <a href="#/methodes" data-goto="validation">la validation</a> en bas de page).</p>

      <h2>${methodKey("top6w")} ${methodLabel("top6w")}</h2>
      <p>Le classement selon le potentiel au meilleur niveau, adapté aux qualifications, et qui incite à courir davantage. Inspirée du
        <i>World Ranking</i>, elle part de la méthode Juste :</p>
      <ul>
        <li>les scores de course, la valeur des circuits et le recalage sont exactement ceux de la méthode Juste ;</li>
        <li>le CN dispose de ${fmt(p6.top_n)} places : parmi les ${pct(p6.eligible_fraction)} meilleurs scores${alsoPct(p6)}, du meilleur au moins bon, chaque course en occupe
          autant que son poids, jusqu'à ce qu'elles soient toutes prises ; la dernière course retenue ne compte que pour les places qui restent
          (un championnat de France arrivant quand il ne reste qu'une place compte × 1) ;</li>
        <li>ainsi, plus un coureur court, plus il peut améliorer son CN, et une course de plus ou de meilleur niveau ne peut jamais le faire baisser ;</li>
        <li>la valeur des circuits, elle, repose sur le CN Juste, qui estime la force des coureurs : sinon, plus un coureur court, plus sa sélection des meilleures courses
          gonflerait les circuits où il court, et les groupes qui courent surtout entre eux (vétérans, jeunes) s'écarteraient des autres.</li>
      </ul>
      <div class="formula">CN = Σ(places × score) ÷ Σ(places), au plus ${fmt(p6.top_n)} places, parmi les ${pct(p6.eligible_fraction)} meilleurs scores${alsoPct(p6)}</div>
    </div>

    <div style="margin:24px 0 16px">
      ${chartCard({ id: "norm", title: t("me.norm"), hint: t("me.norm.hint"), short: true })}
    </div>

    <div class="prose"><h2 id="accord">${t("ov.agreement")}</h2></div>
    <div class="filters" id="agr-filters"></div>
    <div class="grid grid-main-side" style="margin-bottom:16px;align-items:start">
      ${chartCard({ id: "agr", title: t("ov.agreement"), hint: t("ov.agreement.hint"), tall: true })}
      <section class="card"><div class="card-head"><h2>${t("ov.agreeStats")}</h2></div><div id="agr-stats"></div>
        <div class="card-body"><p class="muted" style="font-size:13px;margin:0">${t("ov.agreeStats.note")}</p></div></section>
    </div>

    <div class="prose">
      <h2 id="clubs">Classements des clubs</h2>
      <p>Un club se classe selon deux choix indépendants, sur les coureurs d'un sexe et d'une tranche d'âge donnés
        (jeunes : jusqu'à H/D 20 ; adultes : H/D 21 et plus ; élite : H/D 21 seulement) :</p>
      <ul>
        <li><b>Ce que l'on compte</b> : le <b>CN</b> de chaque coureur classé (pour une méthode de CN), ou ses <b>points en courses nationales</b>.</li>
        <li><b>Comment on l'agrège</b> : la <b>somme</b> (effectif et niveau à la fois), la <b>moyenne</b> (le niveau du coureur moyen),
          le <b>top 5</b> (moyenne des cinq meilleurs, un coureur manquant comptant 0 : la force de la tête de club) ou l'<b>effectif</b>.</li>
      </ul>
      <p id="elite">Les <b>points en courses nationales</b> ne dépendent d'aucune méthode de CN : ils reposent sur les résultats bruts.
        Aux courses de niveau national (groupes A et B1 : championnats de France, nationales, courses de sélection), les 10 premiers
        de chaque catégorie marquent 25, 18, 15, 12, 10, 8, 6, 4, 2 et 1 points ; les points sont doublés aux championnats de France.
        Une catégorie est classée sur le circuit où la majorité de ses coureurs ont couru. Sur la page des clubs, les points portent
        sur les 12 mois précédant la date choisie ; la comparaison de clubs les montre saison par saison.</p>

      <h2>Progression par âge</h2>
      <p>Pour chaque saison et chaque catégorie (H14, D21, H45…), on prend les CN de tous les coureurs classés à la fin de la saison et on en
        calcule la distribution (médiane, 50 % et 80 % centraux). Chaque mois, le CN d'un coureur est situé dans la distribution de sa
        catégorie de la saison : son <b>centile</b> est la part des coureurs de sa catégorie ayant un CN inférieur ou égal. La courbe
        « toutes saisons » regroupe les saisons depuis 2012 ; c'est une photographie de l'ensemble des coureurs, pas le suivi d'une même génération.</p>

      <h2>Réseau</h2>
      <p>Deux coureurs se « rencontrent » quand ils courent le même circuit. Sur toutes les saisons, le site retient pour chaque coureur les
        30 coureurs rencontrés le plus souvent (au moins 2 fois) ; pour une saison, il les recalcule à partir des résultats de la saison.
        Il compte aussi le nombre de fois où chacun a terminé devant l'autre ; un coureur non classé (PM, abandon…) est derrière tous les classés.</p>

      <h2>Limites et précautions</h2>
      <ul>
        <li>Les données proviennent du site du CN de la FFCO. Une course absente, mal saisie ou corrigée ensuite peut expliquer un écart.</li>
        <li>La ${methodLabel("fair")} et la ${methodLabel("top6w")} partent des CN initiaux de 2010 ; les premiers mois reflètent donc surtout ce point de départ.</li>
        <li>Les CN des méthodes alternatives ne remplacent en aucun cas le classement officiel, qui reste la seule référence.</li>
        <li>Les instantanés du classement sont calculés en fin de mois ; la page d'un coureur permet de détailler le calcul à n'importe quelle date.</li>
      </ul>

      <h2 id="validation">Validation : quelle méthode prédit le mieux les résultats ?</h2>
      <p>Un classement doit d'abord dire qui est le plus fort. Le test, appliqué à chaque choix de méthode : sur chaque circuit, on prend
        toutes les paires de coureurs classés, et on regarde si celui qui avait le CN le plus élevé <b>15 jours avant la course</b> — le CN
        publié par chaque méthode à J-15, donc sans rien savoir de la course — a bien terminé devant l'autre. Les trois méthodes sont
        comparées <b>sur les mêmes paires</b> : celles où les deux coureurs ont un CN dans chacune.</p>
      <p id="val-summary"></p>
    </div>
    <div class="grid grid-main-side" style="margin-bottom:16px;align-items:start">
      <section class="card"><div class="card-head"><div><h2 id="val-title"></h2><div class="hint">${t("me.val.hint")}</div></div></div>
        <div id="val-all"></div></section>
      <section class="card"><div class="card-head"><div><h2>${t("me.val.nat")}</h2><div class="hint">${t("me.val.nat.hint")}</div></div></div>
        <div id="val-nat"></div></section>
    </div>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("me.val.bias")}</h2><div class="hint">${t("me.val.bias.hint")}</div></div></div>
      <div id="val-bias"></div></section>`;
  ["norm", "agr"].forEach((id) => bindChartCard(main, id));
  $$("[data-goto]", main).forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById(a.dataset.goto)?.scrollIntoView({ behavior: "smooth" });
  }));

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
  // how far the three methods agree, per discipline, on the same runners
  let terrain = "For";
  function drawAgreement() {
    $("#agr-filters").innerHTML = html`<div class="field"><span>${t("f.terrain")}</span>${seg("agt", TERRAINS.filter((x) => meta.agreement[x]?.length).map((x) => [x, t(`terrain.${x}`)]), terrain)}</div>`;
    $$('[data-seg="agt"]').forEach((b) => b.addEventListener("click", () => { terrain = b.dataset.value; drawAgreement(); }));
    const pts = meta.agreement[terrain] || [];
    const series = [["fair", 1], ["top6w", 2]].map(([m, i]) => ({
      name: methodShort(m), color: methodColor(m), data: pts.filter((p) => p[0] && p[i]).map((p) => [p[0], p[i]]),
    }));
    const max = Math.ceil(Math.max(0, ...pts.flat().filter(Boolean)) / 1000) * 1000;
    $("#agr-legend").innerHTML = legend(series.map((s) => ({ label: `${s.name} / ${methodShort("official")}`, color: s.color, dot: true })));
    scatterChart($("#agr"), { series, xName: methodLabel("official"), yName: "CN", max });
    const stat = (name, pairs) => {
      const d = pairs.map((p) => p[1] - p[0]);
      return { name, n: pairs.length, r: pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])), bias: mean(d), mae: mean(d.map(Math.abs)) };
    };
    const both = pts.filter((p) => p[1] && p[2]);
    const stats = [
      stat(`${methodShort("fair")} / ${methodShort("official")}`, series[0].data),
      stat(`${methodShort("top6w")} / ${methodShort("official")}`, series[1].data),
      stat(`${methodShort("top6w")} / ${methodShort("fair")}`, both.map((p) => [p[1], p[2]])),
    ];
    $("#agr-stats").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>${t("ov.pair")}</th><th class="r">n</th><th class="r">r</th><th class="r">${t("ov.bias")}</th><th class="r">${t("ov.mae")}</th></tr></thead>
      <tbody>${stats.map((s) => html`<tr><td>${s.name}</td><td class="r num">${fmt(s.n)}</td>
        <td class="r num">${fmt(s.r, 3)}</td><td class="r num">${fmtSigned(Math.round(s.bias))}</td><td class="r num">${fmt(s.mae)}</td></tr>`)}</tbody></table></div>`;
    $("#agr-table").innerHTML = $("#agr-stats").innerHTML;
  }
  // ---- validation: who finishes ahead, as predicted by each method's CN 15 days before -------------
  async function drawValidation() {
    const v = await data.validation();
    if (!v) { $("#val-summary").textContent = t("me.val.none"); return; }
    const M = v.methods;                                    // official, fair, top6w — columns 1..3 of each entry
    const season = v.season || Object.keys(v.acc.For?.all || {}).pop();
    const TR = TERRAINS.filter((x) => v.acc[x]?.all?.[season]?.[0]);
    const share = (x, i) => (x?.[0] ? (100 * x[1 + i]) / x[0] : null);
    // errors avoided by Juste, relative to the official method's errors
    const avoided = (x) => (x?.[0] && x[0] - x[1] ? (100 * (x[2] - x[1])) / (x[0] - x[1]) : null);
    const bold = (on, s) => (on ? html`<b>${s}</b>` : s);
    const pctCell = (x, i) => {
      if (!x?.[0]) return html`<td class="r num">—</td>`;
      const best = Math.max(...M.map((_, k) => x[1 + k]));
      return html`<td class="r num">${bold(x[1 + i] === best, `${fmt(share(x, i), 1)} %`)}</td>`;
    };
    const table = (scope) => html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>${t("f.terrain")}</th><th class="r">${t("me.val.pairs")}</th>${M.map((m) => html`<th class="r">${methodShort(m)}</th>`)}
      <th class="r" title="${t("me.val.avoided.hint")}">${t("me.val.avoided")}</th></tr></thead>
      <tbody>${TR.map((x) => {
        const e = v.acc[x][scope]?.[season];
        const a = avoided(e);
        return html`<tr><td>${t(`terrain.${x}`)}</td><td class="r num">${e?.[0] ? fmt(e[0]) : "—"}</td>${M.map((_, i) => pctCell(e, i))}
          <td class="r num">${a == null ? "—" : `${fmt(Math.round(a))} %`}</td></tr>`;
      })}</tbody></table></div>`;

    // the figures are read from the data; the seasons 2012-2025 were measured once, on 6 October 2026
    const name = (x) => (x === "VTT" ? "VTT" : t(`terrain.${x}`).toLowerCase());
    const parts = ["For", "Spr", "VTT"].filter((x) => v.acc[x]?.all?.[season]?.[0]).map((x) => {
      const e = v.acc[x].all[season];
      return `${name(x)} : ${fmt(share(e, 1), 1)} % de bons pronostics contre ${fmt(share(e, 0), 1)} %, soit ${fmt(Math.round(avoided(e)))} % d'erreurs en moins`;
    });
    $("#val-summary").innerHTML = html`En ${season}, sur les mêmes duels, la ${methodLabel("fair")} a mieux prédit que la ${methodLabel("official")}
      qui terminerait devant — ${parts.join(" ; ")}. Mesurée aussi sur chaque saison de 2012 à 2025, elle fait mieux que la méthode
      officielle <b>à chacune</b>, en forêt comme en sprint. La ${methodLabel("top6w")}, qui garde les mêmes scores mais récompense les
      meilleures courses, la suit de près. En ski, les duels sont trop peu nombreux (2 à 4 courses par saison) pour conclure.`;
    $("#val-title").textContent = `${t("me.val.all")} · ${season}`;
    $("#val-all").innerHTML = table("all");
    $("#val-nat").innerHTML = table("nat");

    // bias: juniors and 55+ against the 21s, per discipline
    const groups = [["J", t("me.val.bias.J")], ["V", t("me.val.bias.V")]];
    const biasRows = TR.filter((x) => x !== "Ski").flatMap((x) => groups.map(([g, label]) => [x, label, v.bias[x]?.[g]?.[season]]))
      .filter(([, , b]) => b?.[0]);
    $("#val-bias").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>${t("me.val.bias.group")}</th>
      <th class="r">${t("me.val.pairs")}</th><th class="r">${t("me.val.bias.actual")}</th>${M.map((m) => html`<th class="r">${methodShort(m)}</th>`)}</tr></thead>
      <tbody>${biasRows.map(([x, label, b]) => {
        const real = (100 * b[1]) / b[0];
        const pred = M.map((_, i) => (100 * b[2 + i]) / b[0]);
        const closest = Math.min(...pred.map((p) => Math.abs(p - real)));
        return html`<tr><td>${t(`terrain.${x}`)}</td><td>${label}</td><td class="r num">${fmt(b[0])}</td><td class="r num">${fmt(real, 1)} %</td>
          ${pred.map((p) => html`<td class="r num">${bold(Math.abs(p - real) === closest, `${fmt(p, 1)} %`)}</td>`)}</tr>`;
      })}</tbody></table></div>`;
  }

  drawAgreement();
  await drawValidation();
  return { title: t("page.methods") };
}

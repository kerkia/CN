// Methods: what each of the three CN methods means, the shared score formula,
// the rules specific to each method, the recalage factors actually applied, and
// how far the three methods agree.

import { html, raw, $, $$, fmt, fmtSigned, fmtDate, mean } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { timeChart, columnChart, scatterChart, methodColor, css } from "../charts.js";
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
  const p26 = meta.methods.v2026.params, p6 = meta.methods.top6w.params;
  const pct = (x) => `${fmt(100 * x)} %`;
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
        <h2>${methodKey("v2026")} ${t("m.v2026")}</h2>
        <p class="muted">Le règlement 2026 appliqué rétroactivement à toutes les saisons depuis 2010 : moyenne tronquée et recalage annuel.</p></div></section>
      <section class="card"><div class="card-body">
        <h2>${methodKey("top6w")} ${t("m.top6w")}</h2>
        <p class="muted">Les 6 meilleures courses, pondérées par le niveau de la compétition, avec un recalage mensuel plutôt qu'annuel.</p></div></section>
    </div>

    <div class="prose">
      <h2>Le principe commun : le score de course</h2>
      <p>Pour chaque circuit, on calcule une <b>valeur de circuit</b> à partir des coureurs classés qui ont déjà un CN,
      pris ${fmt(p26.lag_days)} jours avant la course (le « CN J-15 »). On retient les plus rapides — les deux tiers arrondis au supérieur —
      et on fait la moyenne du produit CN × temps :</p>
      <div class="formula">valeur du circuit = moyenne (CN J-15 × temps) sur les ⌈2N/3⌉ plus rapides</div>
      <p>Le score de chaque coureur est alors :</p>
      <div class="formula">score = valeur du circuit ÷ temps du coureur</div>
      <p>Un coureur qui court aussi vite que son CN le prévoit obtient donc un score proche de son CN. Un poinçon manquant, un abandon,
      une disqualification ou un hors-délai donnent un score de 0 qui compte dans le calcul. Les catégories H10 et D10 ne sont pas prises en compte.</p>
      <p>Toutes les méthodes utilisent une <b>fenêtre glissante de 12 mois</b> (365 jours) jusqu'à la date de calcul, et
      tiennent un classement <b>Forêt</b> et un classement <b>Sprint</b> séparés.
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
        <li>Elle exclut la meilleure course. Or, pour beaucoup de coureurs, et surtout pour les plus performants, c'est souvent une compétition nationale : un objectif majeur et une course très représentative de leur niveau.</li>
      </ul>

      <h2>${methodKey("v2026")} ${methodLabel("v2026")}</h2>
      <p>La règle 2026 appliquée dès 2010, en partant des CN initiaux publiés :</p>
      <ul>
        <li>on retire les ${pct(p26.trim_best)} meilleurs scores et les ${pct(p26.trim_worst)} moins bons (nombres arrondis), puis on fait la moyenne des scores restants ;</li>
        <li>il faut au moins ${fmt(p26.min_scores)} courses dans la fenêtre pour avoir un CN ; un circuit compte s'il a au moins ${fmt(p26.min_ranked)} coureurs classés avec un CN ;</li>
        <li>chaque 1er janvier, tous les scores sont multipliés par un même facteur pour que la moyenne des 20 % meilleurs CN vaille 5 600 ;</li>
        <li>coefficient de circuit à 1,00 pour toutes les années.</li>
      </ul>
      <p>Cette méthode répond à la question : « quel serait mon CN si le règlement actuel avait toujours existé ? ».
      Son défaut est visible sur les courbes : une marche, le plus souvent vers le haut, à chaque 1er janvier.</p>
      <div class="formula">CN = moyenne des scores, hors 10 % meilleurs et 40 % moins bons</div>
      <p><b>Limites</b> — Cette méthode supprime les discontinuités de méthode et permet de comparer plusieurs années.
      En revanche, elle comporte les inconvénients propres à la mise à jour 2026, par exemple :</p>
      <ul>
        <li>la sélection aux championnats de France se base sur le CN : des coureurs cessent de courir les courses CN dès que leur CN est qualifiant ;</li>
        <li>des coureurs ne courent que les compétitions qui peuvent rapporter le plus de CN, et pas les autres ;</li>
        <li>les classements en sprint ont tendance à se resserrer, car les écarts relatifs y sont plus faibles qu'en forêt, et les coureurs à fort CN ont peu d'intérêt à courir : leur CN baisse à la plupart des courses ;</li>
        <li>de manière générale, la méthode n'incite pas à participer à beaucoup de compétitions CN ;</li>
        <li>l'ajustement annuel continue de gêner l'évaluation de son niveau sur le long terme ;</li>
        <li>toutes les courses contribuent également, quels que soient le nombre de participants et leur diversité.</li>
      </ul>

      <h2>${methodKey("top6w")} ${methodLabel("top6w")}</h2>
      <p>Une méthode alternative, pensée pour récompenser les meilleures performances et lisser l'échelle dans le temps :</p>
      <ul>
        <li>on ne garde que les ${pct(p6.eligible_fraction)} meilleurs scores de la fenêtre (arrondi à l'entier le plus proche), puis au plus les ${fmt(p6.top_n)} meilleurs d'entre eux ;</li>
        <li>chaque score est pondéré selon le niveau de la compétition : A et B × ${fmtW(p6.weights.A)}, C × ${fmtW(p6.weights.C)}, D × ${fmtW(p6.weights.D)} ;</li>
        <li>il faut au moins ${fmt(p6.min_scores)} courses pour avoir un CN ; un circuit ne compte que s'il a au moins ${fmt(p6.min_ranked)} coureurs classés ayant un CN ;
          seuls les coureurs ayant un CN entrent dans la valeur du circuit ;</li>
        <li>pas de recalage annuel : chaque mois, un facteur de recalage est calculé pour que la moyenne des ${fmt(p6.anchor_top_k)} meilleurs CN
          vaille ${fmt(p6.anchor_target)}, séparément en forêt et en sprint. Le facteur appliqué un mois donné est celui mesuré ${fmt(p6.anchor_lag_months)} mois plus tôt,
          pour que les résultats tardifs ne fassent pas bouger l'échelle.</li>
      </ul>
      <div class="formula">CN = facteur(mois) × Σ(poids × score) ÷ Σ(poids), sur les 6 meilleurs des 60 % meilleurs scores</div>
      <p>Seuls les coureurs dont le CN repose sur au moins 4 courses servent de référence au recalage : une valeur bâtie sur une ou deux
      courses est trop instable pour fixer l'échelle de tout le classement. Conséquence voulue : les deux classements sont recalés indépendamment
      et ne sont pas directement comparables entre eux (les 30 premiers représentent environ 1 % des coureurs en forêt, mais près de 5 % en sprint).</p>
      <p><b>Ce qu'elle cherche à corriger</b> — Cette méthode vise à éliminer l'ensemble des inconvénients identifiés ci-dessus :</p>
      <ul>
        <li>inspirée du <i>World Ranking</i>, elle calcule le CN sur un nombre limité de courses ;</li>
        <li>plus un coureur court, plus il peut améliorer son CN, sans risquer de le faire baisser ;</li>
        <li>elle est stable au fil des années ;</li>
        <li>elle sépare le sprint et la forêt, comme la méthode CN 2026.</li>
      </ul>
    </div>

    <div class="grid grid-2" style="margin:24px 0 16px">
      ${chartCard({ id: "resc", title: t("me.rescale"), hint: t("me.rescale.hint"), short: true })}
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
        <li>La ${methodLabel("v2026")} et la ${methodLabel("top6w")} partent des CN initiaux de 2010 ; les premiers mois reflètent donc surtout ce point de départ.</li>
        <li>Les CN des méthodes alternatives ne remplacent en aucun cas le classement officiel, qui reste la seule référence.</li>
        <li>Les instantanés du classement sont calculés en fin de mois ; la page d'un coureur permet de détailler le calcul à n'importe quelle date.</li>
      </ul>
    </div>`;
  ["resc", "norm", "agr"].forEach((id) => bindChartCard(main, id));

  const years = Object.keys(meta.rescale).sort();
  // shown as a percentage change: bars of 1.03 vs 1.07 from a zero baseline would all look alike
  const rescale = [{ name: t("m.v2026"), color: methodColor("v2026"), data: years.map((y) => Number((100 * (meta.rescale[y] - 1)).toFixed(2))) }];
  columnChart($("#resc"), { categories: years, series: rescale, yName: "%", digits: 2 });
  $("#resc-table").innerHTML = html`<table class="data compact"><thead><tr><th>1er janvier</th><th class="r">${t("calc.factor")}</th><th class="r">%</th></tr></thead>
    <tbody>${[...years].reverse().map((y) => html`<tr><td>${y}</td><td class="r num">${fmt(meta.rescale[y], 4)}</td><td class="r num">${fmt(100 * (meta.rescale[y] - 1), 2)}</td></tr>`)}</tbody></table>`;

  const TERRAIN_SLOT = { For: "--s6", Spr: "--s7" };
  const norm = ["For", "Spr"].filter((tr) => meta.normalisation[tr]).map((tr) => ({
    name: t(`terrain.${tr}`), color: css(TERRAIN_SLOT[tr]), step: true,
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
    $("#agr-filters").innerHTML = html`<div class="field"><span>${t("f.terrain")}</span>${seg("agt", [["For", t("terrain.For")], ["Spr", t("terrain.Spr")]], terrain)}</div>`;
    $$('[data-seg="agt"]').forEach((b) => b.addEventListener("click", () => { terrain = b.dataset.value; drawAgreement(); }));
    const pts = meta.agreement[terrain] || [];
    const series = [["v2026", 1], ["top6w", 2]].map(([m, i]) => ({
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
      stat(`${methodShort("v2026")} / ${methodShort("official")}`, series[0].data),
      stat(`${methodShort("top6w")} / ${methodShort("official")}`, series[1].data),
      stat(`${methodShort("top6w")} / ${methodShort("v2026")}`, both.map((p) => [p[1], p[2]])),
    ];
    $("#agr-stats").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>${t("ov.pair")}</th><th class="r">n</th><th class="r">r</th><th class="r">${t("ov.bias")}</th><th class="r">${t("ov.mae")}</th></tr></thead>
      <tbody>${stats.map((s) => html`<tr><td>${s.name}</td><td class="r num">${fmt(s.n)}</td>
        <td class="r num">${fmt(s.r, 3)}</td><td class="r num">${fmtSigned(Math.round(s.bias))}</td><td class="r num">${fmt(s.mae)}</td></tr>`)}</tbody></table></div>`;
    $("#agr-table").innerHTML = $("#agr-stats").innerHTML;
  }
  drawAgreement();
  return { title: t("page.methods") };
}

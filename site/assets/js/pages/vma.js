// « VMA » (Entrainement group, 2026-10-14): the ways to measure one's maximal aerobic speed, a calculator for the 6- and
// 12-minute tests (demi-Cooper, Cooper) on a track — laps of the lane run plus the metres of the last lap, or a measured
// distance —, the training speeds that follow, and the free smartphone apps that play a track test's beeps.
// Nothing leaves the browser; the calculator's entries are kept in localStorage (ocn.vma).

import { html, raw, $, $$, fmt, fmtTime } from "../util.js";
import { t } from "../i18n.js";
import { pageTabs, tabFrom, bindPageTabs, seg, tile } from "../ui.js";

const MEM = "ocn.vma";
const LANE_W = 1.22;              // a lane's width (m); lane 1 measured 0.30 m from the kerb, the others 0.20 m from their inner line
/** One lap of a 400 m track in lane n: 400 m in lane 1, then 2π × (1.22 (n − 1) − 0.10) more (lane 2: 407.04 m, lane 8: 453.03 m). */
const lap400 = (lane) => (lane <= 1 ? 400 : 400 + 2 * Math.PI * (LANE_W * (lane - 1) - 0.1));
// % of VMA, what it is used for
const ZONES = [
  [105, "fractionné très court (15/15, 30/30, 200 m)"],
  [100, "30/30, 300 à 400 m"],
  [95, "600 à 1 000 m"],
  [90, "1 000 à 2 000 m"],
  [85, "seuil, tempo (3 à 6 km)"],
  [80, "tempo long"],
  [75, "endurance active"],
  [70, "footing"],
  [65, "récupération"],
];
// the share of VMA a runner holds over the test (owner, 2026-10-14): 6 minutes is about the time one lasts at VMA (4 to 8
// minutes, often 6), so the demi-Cooper is run at it; 12 minutes is run below it, at about 95 % for a well-trained runner and
// 90 % for a moderately trained adult (coaching rules of thumb, as the races: a 3 km near 95 %, a 10 km at 85 to 90 %)
const LEVELS = [["trained", "Bien entraîné", 0.95], ["moderate", "Modérément entraîné", 0.90]];
const shareOf = (test, level) => (test === "6" ? 1 : LEVELS.find(([k]) => k === level)?.[2] ?? null);
const read = () => { try { return JSON.parse(localStorage.getItem(MEM) || "{}") || {}; } catch (e) { return {}; } };
const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
const pace = (kmh) => (kmh > 0 ? `${fmtTime(Math.round(3600 / kmh))} /km` : "—");
const ext = (href, label) => html`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

export async function render(main, { query }) {
  const tabs = [["calcul", t("vma.tab.calc")], ["methodes", t("vma.tab.methods")], ["applis", t("vma.tab.apps")]];
  const tab = tabFrom(tabs, query);
  const m = read();
  const st = {
    test: m.test === "12" ? "12" : "6",
    level: LEVELS.some(([k]) => k === m.level) ? m.level : null,       // asked explicitly before a Cooper's VMA is shown
    mode: m.mode === "dist" ? "dist" : "track",
    track: ["400", "200", "other"].includes(m.track) ? m.track : "400",
    lane: Math.min(8, Math.max(1, Math.round(num(m.lane, 1)))),
    other: num(m.other, 250), laps: num(m.laps, ""), extra: num(m.extra, ""), dist: num(m.dist, ""),
  };
  const save = () => { try { localStorage.setItem(MEM, JSON.stringify(st)); } catch (e) {} };

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.vma")}</h1><p class="lede">${t("vma.lede")}</p></div></div>
    ${pageTabs(tabs, tab)}
    <div data-panel="calcul">
      <div class="grid grid-main-side vma-grid" style="align-items:start;margin-bottom:16px">
        <div>
          <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Votre test</h2>
            <div class="hint">Distance courue en 6 ou 12 minutes, à l'allure la plus rapide que vous tenez jusqu'au bout</div></div></div>
            <div class="card-body vma-form" id="vma-form"></div></section>
          <div class="tiles" id="vma-tiles" style="margin-bottom:12px"></div>
          <p class="muted vma-note" id="vma-note"></p>
        </div>
        <section class="card"><div class="card-head"><h2>Comment faire le test</h2></div>
          <div class="card-body vma-text">
            <ul>
              <li><b>Échauffez-vous</b> 15 à 20 minutes, avec quelques accélérations.</li>
              <li><b>Courez à allure régulière</b> : partir trop vite coûte plus que ce qu'on gagne. Visez un temps par tour, et accélérez dans la dernière minute s'il vous reste de la marge.</li>
              <li><b>Comptez vos tours</b> (ou faites-les compter) et notez où vous êtes au signal de fin : les marques de la piste tous les 100 m, ou des plots tous les 20 ou 50 m, donnent les mètres du dernier tour.</li>
              <li><b>Restez dans le même couloir</b> : le premier, au ras de la lice, est le plus court. Un tour dans le couloir 2 fait déjà 7 m de plus.</li>
              <li><b>Le minuteur du téléphone</b>, réglé sur 6 ou 12 minutes, suffit : il sonne la fin.</li>
              <li><b>Refaites-le dans les mêmes conditions</b> (piste, météo, forme) tous les deux ou trois mois pour suivre vos progrès.</li>
            </ul>
            <p class="muted">Un test maximal demande d'être en bonne santé : en cas de doute, demandez l'avis d'un médecin.</p>
          </div></section>
      </div>
      <section class="card"><div class="card-head"><div><h2>Vos allures d'entraînement</h2>
        <div class="hint">En pourcentage de la VMA calculée ci-dessus ; les usages sont des repères courants, à adapter</div></div></div>
        <div id="vma-zones"></div></section>
    </div>
    <div data-panel="methodes" hidden>${methodsPanel()}</div>
    <div data-panel="applis" hidden>${appsPanel()}</div>`;

  function lapLen() {
    if (st.track === "400") return lap400(st.lane);
    if (st.track === "200") return 200;
    return st.other > 0 ? st.other : null;
  }
  function distance() {
    if (st.mode === "dist") return st.dist > 0 ? st.dist : null;
    const L = lapLen(), laps = st.laps === "" ? 0 : st.laps, extra = st.extra === "" ? 0 : st.extra;
    if (!L || (st.laps === "" && st.extra === "")) return null;
    return laps * L + extra;
  }

  // under the track's fields: the lap's length, and a warning when the last lap's metres exceed a lap
  function trackNote() {
    const L = lapLen();
    return html`${L ? html`Un tour : <b>${fmt(L, 2)} m</b>${st.track === "400" ? " — couloir 1 mesuré à 30 cm de la lice ; chaque couloir suivant ajoute 2π × (1,22 × (n − 1) − 0,10) m par tour."
      : st.track === "200" ? " — mesuré à la corde ; dans un autre couloir, le tour est plus long." : ""}` : "Indiquez la longueur du tour."}
      ${L && st.extra !== "" && st.extra >= L ? html`<br><span class="vma-warn">Les mètres du dernier tour dépassent un tour : vérifiez le nombre de tours.</span>` : ""}`;
  }
  function drawForm() {
    $("#vma-form").innerHTML = html`
      <div class="filters vma-fields">
        <div class="field"><span>Test</span>${seg("vma-test", [["6", "Demi-Cooper · 6 min"], ["12", "Cooper · 12 min"]], st.test)}</div>
        <div class="field"><span>Distance</span>${seg("vma-mode", [["track", "Tours de piste"], ["dist", "Distance mesurée"]], st.mode)}</div>
        ${st.test === "12" ? html`<div class="field"><span>Niveau d'entraînement</span>${seg("vma-level",
          LEVELS.map(([k, l, p]) => [k, `${l} · ${fmt(p * 100)} %`]), st.level ?? "")}</div>` : ""}
      </div>
      ${st.mode === "track" ? html`<div class="filters vma-fields">
        <label class="field"><span>Piste</span><select id="vma-track">
          <option value="400" ${raw(st.track === "400" ? "selected" : "")}>400 m (piste d'athlétisme)</option>
          <option value="200" ${raw(st.track === "200" ? "selected" : "")}>200 m (piste couverte)</option>
          <option value="other" ${raw(st.track === "other" ? "selected" : "")}>Autre boucle</option></select></label>
        ${st.track === "400" ? html`<label class="field"><span>Couloir</span><select id="vma-lane">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option value="${n}" ${raw(n === st.lane ? "selected" : "")}>${n} · ${fmt(lap400(n), 2)} m</option>`)}</select></label>` : ""}
        ${st.track === "other" ? html`<label class="field"><span>Longueur du tour (m)</span>
          <input type="number" id="vma-other" min="20" max="5000" step="0.1" value="${st.other}" style="width:110px"></label>` : ""}
        <label class="field"><span>Tours complets</span><input type="number" id="vma-laps" min="0" max="60" step="1" value="${st.laps}" inputmode="numeric" style="width:90px"></label>
        <label class="field"><span>+ mètres du dernier tour</span><input type="number" id="vma-extra" min="0" max="5000" step="1" value="${st.extra}" inputmode="numeric" style="width:110px"></label>
      </div>
      <div class="muted vma-small" id="vma-small">${trackNote()}</div>`
      : html`<div class="filters vma-fields">
        <label class="field"><span>Distance (m)</span><input type="number" id="vma-dist" min="0" max="6000" step="1" value="${st.dist}" inputmode="numeric" style="width:120px"></label>
      </div>
      <div class="muted vma-small">Mesurée à la roue, sur un parcours étalonné… Une montre GPS se trompe facilement de 1 à 3 % sur une piste : préférez compter les tours.</div>`}`;
    $$('[data-seg="vma-test"]').forEach((b) => b.addEventListener("click", () => { st.test = b.dataset.value; changed(true); }));
    $$('[data-seg="vma-mode"]').forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.value; changed(true); }));
    $$('[data-seg="vma-level"]').forEach((b) => b.addEventListener("click", () => { st.level = b.dataset.value; changed(true); }));
    $("#vma-track")?.addEventListener("change", (e) => { st.track = e.target.value; changed(true); });
    $("#vma-lane")?.addEventListener("change", (e) => { st.lane = Number(e.target.value); changed(true); });
    const bindNum = (id, key, redraw) => $(id)?.addEventListener("input", (e) => {
      st[key] = e.target.value === "" ? "" : Math.max(0, Number(e.target.value)); changed(redraw);
    });
    bindNum("#vma-other", "other", false);
    bindNum("#vma-laps", "laps", false);
    bindNum("#vma-extra", "extra", false);
    bindNum("#vma-dist", "dist", false);
  }
  // a choice redraws the form; a number typed only the note under the fields (the field keeps its focus) and the results
  function changed(redrawForm) {
    save();
    if (redrawForm) drawForm();
    else if ($("#vma-small")) $("#vma-small").innerHTML = trackNote();
    drawResults();
  }

  function drawResults() {
    const d = distance(), T = Number(st.test);
    if (!d) {
      $("#vma-tiles").innerHTML = html`<div class="empty" style="grid-column:1/-1">Entrez la distance parcourue pour obtenir votre VMA.</div>`;
      $("#vma-note").textContent = "";
      $("#vma-zones").innerHTML = html`<div class="empty">—</div>`;
      return;
    }
    const share = shareOf(st.test, st.level);
    const L = lapLen();
    const how = st.mode === "track" ? `${fmt(st.laps || 0)} tour${(st.laps || 0) > 1 ? "s" : ""} de ${fmt(L, 2)} m + ${fmt(st.extra || 0)} m` : "distance mesurée";
    if (!share) {                                   // a Cooper without a level: no VMA until it is chosen
      $("#vma-tiles").innerHTML = html`${tile("Distance", `${fmt(d, d % 1 ? 1 : 0)} m`, how)}
        <div class="empty" style="grid-column:1/-1">Choisissez votre niveau d'entraînement : il fixe la part de la VMA tenue pendant 12 minutes.</div>`;
      $("#vma-note").textContent = "";
      $("#vma-zones").innerHTML = html`<div class="empty">—</div>`;
      return;
    }
    // the speed held over the test is share × VMA, and that speed is d / T
    const vma = (d * 60) / (T * 1000) / share;
    const vo2 = 3.5 * vma;                          // the oxygen cost of running: about 3.5 ml/kg/min per km/h (Léger)
    $("#vma-tiles").innerHTML = html`
      ${tile("Distance", `${fmt(d, d % 1 ? 1 : 0)} m`, how)}
      ${tile("VMA estimée", `${fmt(vma, 1)} km/h`, `${T === 6 ? "6 min tenues à 100 % de la VMA" : `12 min tenues à ${fmt(share * 100)} % de la VMA`} · ${pace(vma)}`)}
      ${tile("VO2max estimée", `${fmt(vo2, 1)} ml/kg/min`, "≈ 3,5 × VMA")}`;
    $("#vma-note").textContent = T === 6
      ? "Six minutes, c'est à peu près le temps qu'on tient à sa VMA (4 à 8 minutes selon les coureurs) : le demi-Cooper se court à la VMA, si l'allure a été régulière."
      : `Douze minutes, c'est plus long que le temps qu'on tient à sa VMA (4 à 8 minutes) : on court le Cooper en dessous, vers 95 % de la VMA bien entraîné, 90 % modérément entraîné. Hypothèse retenue : ${fmt(share * 100)} %. Ces parts sont des repères d'entraîneurs, pas des constantes mesurées : le demi-Cooper donne une VMA plus directe.`;
    $("#vma-zones").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
        <th class="r">% VMA</th><th class="r">Vitesse</th><th class="r">Allure</th><th class="r">200 m</th><th class="r">400 m</th><th class="r">1 000 m</th><th>Usage</th></tr></thead>
      <tbody>${ZONES.map(([p, use]) => {
        const s = (vma * p) / 100, per = (m) => fmtTime(Math.round((m / 1000) * (3600 / s)));
        return html`<tr class="${p === 100 ? "me" : ""}"><td class="r num">${p} %</td><td class="r num"><b>${fmt(s, 1)}</b> km/h</td><td class="r num">${pace(s)}</td>
          <td class="r num">${per(200)}</td><td class="r num">${per(400)}</td><td class="r num">${per(1000)}</td><td>${use}</td></tr>`;
      })}</tbody></table></div>`;
  }

  drawForm();
  drawResults();
  bindPageTabs(main, tabs, tab);
  return { title: t("nav.vma") };
}

// ---- the methods ---------------------------------------------------------------------------------------------------
function methodsPanel() {
  const row = (name, where, how, result) => html`<tr><td><b>${name}</b></td><td>${where}</td><td>${how}</td><td>${result}</td></tr>`;
  return html`
    <section class="card" style="margin-bottom:16px"><div class="card-body vma-text">
      <p>La <b>VMA</b> (vitesse maximale aérobie) est la plus petite vitesse de course à laquelle on atteint sa consommation
        maximale d'oxygène (VO2max). On la tient environ 4 à 8 minutes. Elle sert surtout à régler ses allures d'entraînement,
        en pourcentage de VMA. Trois familles de tests l'estiment :</p>
      <ul>
        <li><b>Au laboratoire</b>, sur tapis roulant avec analyse des gaz respirés : la référence, qui mesure aussi la VO2max.</li>
        <li><b>Sur le terrain, guidé par des bips</b> (tests « triangulaires ») : la vitesse augmente par paliers et des bips
          donnent l'allure ; la VMA est la vitesse du dernier palier tenu. Pas besoin de savoir gérer son allure.</li>
        <li><b>Sur le terrain, en durée fixe</b> (6 ou 12 minutes) : la plus grande distance possible ; la VMA se déduit de la
          vitesse moyenne. Rien d'autre qu'une piste et un chronomètre, mais il faut savoir courir régulier.</li>
      </ul>
    </div></section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Les principaux tests</h2></div>
      <div class="table-wrap"><table class="data compact vma-methods"><thead><tr><th>Test</th><th>Où</th><th>Déroulé</th><th>Résultat</th></tr></thead>
        <tbody>
          ${row("VAMEVAL (Cazorla et Léger)", "Piste de 200 ou 400 m, plots tous les 20 m",
            "Départ à 8 km/h, +0,5 km/h chaque minute ; on doit être à un plot à chaque bip. Arrêt quand on prend trop de retard sur deux plots de suite.",
            "VMA = vitesse du dernier palier terminé. Le test de terrain le plus précis et le plus répandu.")}
          ${row("Léger-Boucher (Université de Montréal, 1980)", "Piste de 400 m, plots tous les 50 m",
            "Paliers de 2 minutes, la vitesse augmentant à chaque palier (1 km/h dans les versions françaises usuelles, départ vers 8 km/h ; 0,5 km/h dans la version d'origine).",
            "VMA = vitesse du dernier palier. Paliers longs : plus éprouvant que le VAMEVAL.")}
          ${row("Demi-Cooper (6 minutes)", "Piste",
            "La plus grande distance possible en 6 minutes, à allure régulière.",
            "VMA ≈ distance (m) ÷ 100. Simple et proche de la VMA ; demande de bien gérer son effort.")}
          ${row("Cooper (12 minutes, 1968)", "Piste",
            "La plus grande distance possible en 12 minutes.",
            "On le court sous la VMA : VMA ≈ distance ÷ 200 ÷ 0,95 (bien entraîné) ou ÷ 0,90 (modérément). La règle « distance ÷ 200 » seule la sous-estime ; la formule de Cooper pour la VO2max, (distance − 504,9) ÷ 44,73, sous-estime les coureurs entraînés.")}
          ${row("Navette de Luc Léger (20 m)", "Gymnase ou terrain, deux lignes à 20 m",
            "Allers-retours, départ à 8,5 km/h, +0,5 km/h chaque minute.",
            "Les demi-tours freinent : la vitesse atteinte est inférieure à la VMA sur piste. Bon pour la VO2max, à convertir pour les allures.")}
          ${row("45-15 (Gacon)", "Piste, plots tous les 6,25 m",
            "45 s de course, 15 s de récupération ; 100 m en 45 s au départ (8 km/h), puis un plot plus loin à chaque palier (+0,5 km/h).",
            "Une VMA « intermittente », plus élevée que la VMA continue : elle sert à régler les séances de fractionné court.")}
        </tbody></table></div></section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Lequel choisir ?</h2></div><div class="card-body vma-text">
      <ul>
        <li><b>Seul sur une piste, sans matériel</b> : le demi-Cooper, et le calculateur de cette page.</li>
        <li><b>Seul ou à plusieurs, avec un téléphone et des plots</b> : le VAMEVAL, avec une application qui joue les bips
          (voir l'onglet Applications) ; aucun réglage d'allure à gérer.</li>
        <li><b>En gymnase</b> : la navette de Luc Léger, en gardant en tête qu'elle sous-estime la VMA sur piste.</li>
        <li>Une VMA peut aussi s'estimer d'après un chrono de course (un 10 km se court vers 85 à 90 % de la VMA), mais c'est
          approximatif : rien ne vaut un test.</li>
      </ul>
      <p class="muted">Sources : ${ext("https://www.topendsports.com/testing/tests/vameval.htm", "VAMEVAL")},
        ${ext("https://www.topendsports.com/testing/tests/track-test.htm", "Université de Montréal Track Test")},
        ${ext("https://www.topendsports.com/testing/tests/gacon.htm", "test de Gacon")} (Topend Sports) ;
        ${ext("https://www.aeeps.org/ajouter-un-fichier/doc_download/3071-.html", "fiche des tests VMA")} de l'AEEPS.</p>
    </div></section>`;
}

// ---- the apps --------------------------------------------------------------------------------------------------------
// checked 2026-10-14: free, no subscription needed for the test itself
const APPS = [
  { name: "EZ BIPsVMA", test: "VAMEVAL (plots tous les 20 m) et navette de Luc Léger",
    where: "Application web : s'ouvre dans le navigateur de n'importe quel téléphone, s'installe sur l'écran d'accueil et marche hors connexion.",
    links: [["https://bips.ezapps.be/", "bips.ezapps.be"]],
    note: "Le plus simple pour un VAMEVAL sur piste : posez des plots tous les 20 m, lancez les bips." },
  { name: "EPS Test VMA", test: "Léger-Boucher (plots tous les 50 m, paliers de 2 minutes)",
    where: "Android et iPhone / iPad, gratuite, sans achat intégré.",
    links: [["https://play.google.com/store/apps/details?id=com.GrangerM.testvma", "Google Play"],
      ["https://apps.apple.com/fr/app/eps-test-vma/id6466824820", "App Store"]],
    note: "Conçue pour les professeurs d'EPS ; marche aussi pour un coureur seul." },
];
const SHUTTLE = [
  { name: "VMA Test (Beep test, PACER)", links: [["https://play.google.com/store/apps/details?id=com.victormeunier.vmatest", "Google Play"]] },
  { name: "BeepRun : Test Luc Léger & VMA", links: [["https://apps.apple.com/fr/app/beeprun-test-luc-l%C3%A9ger-vma/id1411308819", "App Store"]] },
];
function appsPanel() {
  return html`
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Pour un test sur piste</h2>
      <div class="hint">Gratuites ; le téléphone joue les bips qui donnent l'allure à chaque plot</div></div></div>
      <div class="card-body vma-apps">${APPS.map((a) => html`<div class="vma-app">
        <h3>${a.name}</h3>
        <div><b>Test :</b> ${a.test}</div>
        <div>${a.where}</div>
        <div class="muted">${a.note}</div>
        <div class="row">${a.links.map(([u, l]) => html`<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`)}</div>
      </div>`)}</div></section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Sans application</h2></div><div class="card-body vma-text">
      <p>Le <b>demi-Cooper</b> et le <b>Cooper</b> n'en demandent aucune : le minuteur du téléphone réglé sur 6 ou 12 minutes,
        le nombre de tours et les mètres du dernier tour suffisent, puis le calculateur de cette page. Une montre GPS mesure
        mal une piste (1 à 3 % d'erreur) : comptez les tours.</p>
      <p><b>Conseils</b> : un haut-parleur Bluetooth si vous êtes plusieurs ; le volume au maximum et l'écran qui ne se met pas en
        veille ; des plots posés au décamètre, la ligne d'arrivée de la piste comme repère du premier.</p>
    </div></section>
    <section class="card"><div class="card-head"><div><h2>En gymnase : la navette de 20 m</h2>
      <div class="hint">Pas un test sur piste : la vitesse atteinte est en dessous de la VMA (voir l'onglet Méthodes)</div></div></div>
      <div class="card-body vma-text"><ul>${SHUTTLE.map((a) => html`<li><b>${a.name}</b> — ${a.links.map(([u, l]) => ext(u, l))}</li>`)}</ul></div></section>`;
}

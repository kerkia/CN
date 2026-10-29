// The VMA page's long texts in French (pages/vma.js: « Comment faire le test », the Méthodes and Applications tabs);
// vma.en.js in step. Checked 2026-10-14 (the apps: free, no subscription needed for the test itself).
const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const row = (name, where, how, result) => `<tr><td><b>${name}</b></td><td>${where}</td><td>${how}</td><td>${result}</td></tr>`;

export const howTo = `
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
    </div></section>`;

export const methods = `
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
          "On le court sous la VMA : VMA ≈ distance ÷ 200 ÷ 0,95 (bien entraîné), ÷ 0,90 (modérément) ou ÷ 0,85 (peu entraîné). La règle « distance ÷ 200 » seule la sous-estime ; la formule de Cooper pour la VO2max, (distance − 504,9) ÷ 44,73, sous-estime les coureurs entraînés.")}
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
export const apps = `
  <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Pour un test sur piste</h2>
    <div class="hint">Gratuites ; le téléphone joue les bips qui donnent l'allure à chaque plot</div></div></div>
    <div class="card-body vma-apps">${APPS.map((a) => `<div class="vma-app">
      <h3>${a.name}</h3>
      <div><b>Test :</b> ${a.test}</div>
      <div>${a.where}</div>
      <div class="muted">${a.note}</div>
      <div class="row">${a.links.map(([u, l]) => `<a class="btn btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}</div>
    </div>`).join("")}</div></section>
  <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Sans application</h2></div><div class="card-body vma-text">
    <p>Le <b>demi-Cooper</b> et le <b>Cooper</b> n'en demandent aucune : le minuteur du téléphone réglé sur 6 ou 12 minutes,
      le nombre de tours et les mètres du dernier tour suffisent, puis le calculateur de cette page. Une montre GPS mesure
      mal une piste (1 à 3 % d'erreur) : comptez les tours.</p>
    <p><b>Conseils</b> : un haut-parleur Bluetooth si vous êtes plusieurs ; le volume au maximum et l'écran qui ne se met pas en
      veille ; des plots posés au décamètre, la ligne d'arrivée de la piste comme repère du premier.</p>
  </div></section>
  <section class="card"><div class="card-head"><div><h2>En gymnase : la navette de 20 m</h2>
    <div class="hint">Pas un test sur piste : la vitesse atteinte est en dessous de la VMA (voir l'onglet Méthodes)</div></div></div>
    <div class="card-body vma-text"><ul>${SHUTTLE.map((a) => `<li><b>${a.name}</b> — ${a.links.map(([u, l]) => ext(u, l)).join(", ")}</li>`).join("")}</ul></div></section>`;

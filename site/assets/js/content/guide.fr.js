// The Documentation's guide to the site, in French (owner, 2026-10-24: the page told the methods but not the site; 2026-10-31:
// one documentation per module). guide.en.js in step: the same structure, the English words. build(X) receives the page's
// helpers and returns « Le site » (the documentation's home: short, every section on one page) and the guides of Arena,
// Coach and Orga, each a set of chapters (Stats' documentation is the methods', content/methods.*.js; Orga's « Le tracé »
// too). Plain sentences for orienteers; a page is named as the menu names it, with a link.
export function build(X) {
  const { html, raw, subTabs, fr = true, admin = false } = X;
  // a page of the site, as the menus name it
  const P = (href, label) => html`<a href="${href}">${label}</a>`;
  // a module's documentation
  const M = (mod, label) => html`<a href="#/documentation?module=${mod}">${label}</a>`;
  // a tab of the module's documentation shown (Orga: « Le tracé »)
  const D = (tab, label, goto) => html`<a href="#/documentation?onglet=${tab}${goto ? `&voir=${goto}` : ""}" data-tab-link="${tab}"${raw(goto ? ` data-goto="${goto}"` : "")}>${label}</a>`;
  const chapters = (list, CH) => raw(subTabs(list, list[0][0]).s.replace(/<div data-subpanel="([a-z]+)"( hidden)?><\/div>/g, (m0, k, hid) =>
    `<div data-subpanel="${k}"${hid || ""}>${CH[k]().s}</div>`));
  const slide = (kicker, title, body, id) => html`<section class="mx-slide"${raw(id ? ` id="${id}"` : "")}><p class="mx-kicker">${kicker}</p><h2>${title}</h2>${body}</section>`;
  const list = (items) => html`<ul class="mx-list">${items.filter(Boolean).map((i) => html`<li><span>${i}</span></li>`)}</ul>`;

  // what each documentation says under its title
  const LEDE = {
    home: html`Ozimut en quelques mots, puis la documentation de chaque module : choisissez celui qui vous intéresse.`,
    arena: html`Les compétitions : l'agenda, les résultats des organisateurs, le direct et l'analyse des temps intermédiaires.`,
    coach: html`S'entraîner : les analyses de traces GPS, les définitions de postes, les symboles de carte, les jeux et la VMA.`,
    orga: html`Les outils des organisateurs : résultats, horaires, direct, suivi GPS, analyses multi et tracé des circuits.`,
  };

  // ======================================================================================================
  // Le site: the documentation's home, short
  // ======================================================================================================
  function site() {
    return html`
      ${slide("Le site", "Les modules et le compte", html`
        <p>Ozimut a quatre modules : la page des modules, où l'on arrive, propose de choisir l'un d'eux, et la barre du haut montre alors ses pages
          seulement. Le logo Ozimut y ramène à tout moment. Orga s'active à l'inscription, dans les Réglages ou sur la page des modules, et s'utilise
          sur ordinateur.</p>
        ${list([
          html`<b>Sans compte</b>, Ozimut montre ce qui est public : Arena, Coach sauf l'analyse multi, et dans Stats le coureur, le classement et les
            courses sur la période que la fédération publie librement.`,
          html`<b>Un compte</b> s'ouvre avec une adresse e-mail et un mot de passe, puis les pays où l'on court (${P("#/reglages?onglet=pays", "Réglages › Mes pays")}).
            Pour la France, le nom et le numéro de licence sont vérifiés auprès de la liste des licenciés : c'est ce qui ouvre ${fr ? "les classements et votre page de coureur" : "les classements français"}.
            Le compte ne garde que ce qu'il faut ; ${P("#/compte/confidentialite", "Règles du site et confidentialité")} dit quoi, où et combien de temps.`,
          html`Sous votre nom : la page des modules, cette documentation, les ${P("#/reglages", "Réglages")}, « Nous écrire » et la déconnexion. Les pages
            encore en essai portent la mention « bêta ».`,
        ])}`, "menus")}
      ${slide("Le site", "Pays, langue et thème", html`
        ${list([
          html`<b>Le pays</b>, en haut, choisit les compétitions que l'on voit : l'agenda d'une trentaine de pays, lu chaque matin chez leur fédération,
            leurs résultats et leur direct, ouverts à tous. Les classements n'existent que là où Ozimut a les résultats de la fédération : la France
            (${fr ? "le CN officiel et " : ""}l'indice Ozimut) et l'Espagne (l'indice Ozimut).`,
          html`<b>La langue</b>, français ou anglais, change sur cet appareil et, connecté, pour le compte (les e-mails suivent).`,
          html`<b>Le thème</b>, sous la lune : Jour, Clairière, Forêt, Sous-bois ou Nuit ; clair sur un ordinateur, sombre sur un téléphone par défaut.`,
        ])}`, "pays")}
      ${slide("Le site", "Les alertes", html`
        <p>Dans les ${P("#/reglages", "Réglages")}, chaque alerte part par e-mail, par notification, ou les deux : <b>une de mes courses est en ligne</b>${fr ? "" : " (avec une licence française)"},
          <b>mon heure de départ est publiée</b>, <b>une nouvelle course dans mes régions</b> et <b>la clôture des inscriptions approche</b>. Les
          notifications se règlent appareil par appareil ; les e-mails d'alerte sont ouverts compte par compte, le nombre d'envois du site étant limité.</p>`, "compte")}
      ${slide("Le site", "Sur le téléphone", html`
        ${list([
          html`<b>L'application</b> : « Installer l'application » dans le menu sous votre nom (Chrome, Edge, Android) ; sur iPhone, Partager › « Sur l'écran
            d'accueil » — c'est aussi la seule façon d'y recevoir les notifications.`,
          html`<b>Partager une trace</b> depuis la montre ou le téléphone vers Ozimut ouvre l'${P("#/analyse-solo", "Analyse solo")} avec le fichier ; rien
            n'est envoyé.`,
        ])}`, "telephone")}`;
  }

  // ======================================================================================================
  // Arena
  // ======================================================================================================
  const ARENA = [["competitions", "Les compétitions"], ["resultats", "Résultats"], ["direct", "En direct"], ["analyse", "Analyse de course"]];
  function arena() {
    return chapters(ARENA, {
      competitions: () => html`
        ${slide("Arena", "Une page, toutes les compétitions", html`
          <p>Arena est une seule page, les ${P("#/agenda", "Compétitions")} du pays choisi : trois cases choisissent celles d'aujourd'hui, celles à venir et
            celles des 60 derniers jours. L'agenda vient chaque matin du calendrier de la fédération — les courses, et aussi les entraînements, stages et
            formations. On filtre par date, spécialité, région${fr ? ", département, et aux courses comptant pour le CN" : ""} ; sur un ordinateur, une carte
            montre où elles ont lieu.</p>
          ${list([
            html`<b>Une compétition à venir</b> s'ouvre à côté de la liste : le lieu et l'itinéraire, l'annonce, ${fr ? "le nombre d'inscrits par circuit, " : ""}la
              clôture des inscriptions, et des boutons quand ils existent — la liste de départ${fr ? " (avec le CN de chacun et la place qu'il laisse attendre)" : ""},
              « Suivre en direct », le suivi GPS.`,
            html`<b>Une compétition passée</b> ouvre sa page : les résultats en premier onglet, puis, quand les temps intermédiaires sont publiés, chaque vue
              de leur analyse. « ‹ Compétitions » ramène à la liste là où on l'avait laissée.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Arena", "Les résultats des organisateurs", html`
          <p>Les résultats des 60 derniers jours paraissent tels que les organisateurs les publient, souvent le soir même, des jours avant la fédération.
            Ozimut les cherche lui-même plusieurs fois par jour, et toutes les 20 minutes les samedis et dimanches soir :</p>
          ${list([
            html`sur les <b>plateformes</b> de résultats : liveresultat, WinSplits, Helga, O'Live, SPORTident Center, les sites MeOSDjango (dont Orientation Data) ;`,
            html`sur le <b>site du club</b> organisateur : ses pages et ses fichiers (HTML d'OE ou de MeOS, IOF XML, PDF) ;`,
            html`dans les <b>dépôts</b> des organisateurs et leurs <b>diffusions en direct</b> (voir la documentation d'${M("orga", "Orga")}).`,
          ])}
          <p>Une course en cours le dit (« en cours ») tant que des coureurs sont dehors. Quand plusieurs documents existent, Ozimut montre le meilleur :
            celui de l'organisateur avant les plateformes, les résultats en direct en dernier (ils ne sont pas corrigés ensuite). Les coureurs sont reconnus
            par leur nom et leur club.</p>`)}
        ${!fr ? "" : html`
        <section class="mx-slide">
          <p class="mx-kicker">Résultats</p>
          <h2>Scores et CN provisoires</h2>
          <p>Le site calcule des scores provisoires avec les règles de chaque méthode, pour les coureurs reconnus.</p>
          ${list([
            html`<b>Officiel</b> : le CN officiel de chaque coureur reconnu, 15 jours avant la course, et la règle de la FFCO (moyenne ordinaire sur les deux
              tiers les plus rapides).`,
            html`<b>Ozimut</b> : le niveau habituel de chaque coureur reconnu, 15 jours avant la course, la valeur Ozimut du circuit (la
              moyenne des niveaux × temps des plus rapides : 90 % du peloton en forêt, deux tiers en sprint), et le facteur de recalage du jour. L'indice Ozimut
              provisoire après la course suit la règle des places.`,
            html`Seules les listes <b>par circuit</b> sont notées. Une liste par catégorie l'est circuit par circuit une fois qu'on sait quelles catégories
              couraient sur quel circuit (d'après les listes par circuit de la même course, la liste d'inscription de la FFCO ou l'annonce de course). Les
              coureurs non reconnus restent sans CN.`,
            html`Ces valeurs sont provisoires jusqu'à la publication par la FFCO : les valeurs définitives peuvent différer, si des résultats sont corrigés
              ou des coureurs ajoutés.`,
          ])}
        </section>`}`,
      direct: () => html`
        ${slide("Arena", "En direct", html`
          <p>Le jour de la course, « Suivre en direct » relaie les résultats publiés pendant la course sur liveresultat, O'Live, SPORTident Center, un site
            MeOSDjango, ou envoyés par l'organisateur depuis son logiciel de chronométrage. Une compétition où un poste ou l'arrivée a enregistré un passage
            dans la dernière demi-heure est marquée « direct ».</p>
          ${list([
            html`<b>Par circuit ou par catégorie</b> : place, temps, écart, heure de départ${fr ? ", le CN de chacun et la place qu'il laisse attendre, et le score de son temps" : ""}.
              Un coureur encore dehors a une heure d'arrivée estimée d'après ses postes radio et le temps des arrivés.`,
            html`<b>Suivre</b> : « Mon club » (les coureurs de votre club, toutes catégories), « Encore en course », « Tous les passages » des 15
              dernières minutes, et ceux de votre club, qui peuvent faire vibrer et sonner le téléphone à chaque passage.`,
            html`<b>Les passages récents</b> sont en vert (moins de 3 minutes) puis en jaune (moins de 9) ; une recherche trouve un coureur ou un club.`,
            html`Dès qu'un temps intermédiaire arrive, « Analyse » analyse la course en direct.`,
          ])}`)}`,
      analyse: () => html`
        ${slide("Arena", "Analyse de course", html`
          <p>Quand les temps intermédiaires sont publiés, la page d'une course les analyse circuit par circuit, en plusieurs vues : Tableau, Écarts,
            Passages, Inter-postes, Profil, Face-à-face, Groupes, Autonomie, Régularité et Bilan.</p>`)}
        <section class="mx-slide">
          <p class="mx-kicker">Temps intermédiaires</p>
          <h2>Le temps perdu et les erreurs</h2>
          ${list([
            html`Sur chaque tronçon entre deux postes, le <b>temps perdu</b> est l'écart entre le temps du coureur et le temps que son allure habituelle
              sur cette course laissait prévoir. Il est négatif quand le coureur va plus vite que d'habitude. Le temps de référence d'un tronçon est la
              moyenne des temps les plus rapides (le sixième le plus rapide, sans le vainqueur), et l'allure habituelle le temps du coureur sur les tronçons
              courus sans erreur rapporté à leurs temps de référence : un long tronçon y compte plus qu'un court, comme dans MeOS.`,
            html`Une <b>erreur</b> est un tronçon où le coureur a perdu au moins 20 % du temps du tronçon <b>et</b> au moins 10 secondes ; les deux seuils se
              règlent. Les colonnes « Perdu » et « Sans temps perdu » ne comptent que les erreurs.`,
            html`Les <b>écarts</b> se mesurent au « superman », un coureur imaginaire qui aurait le meilleur temps sur chaque tronçon, parmi tous les
              coureurs ou parmi ceux que l'on compare.`,
            html`Les <b>groupes</b> repèrent les coureurs qui passent aux mêmes postes à quelques secondes d'intervalle, poste après poste.`,
          ])}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Temps intermédiaires</p>
          <h2>Passages, autonomie, régularité, contrôle des temps</h2>
          ${list([
            html`Le <b>graphique des passages</b> place chaque coureur à l'heure où il pointe chaque poste (son heure de départ plus son temps cumulé) :
              des lignes qui se rejoignent sont des coureurs ensemble, une ligne plus raide est un coureur qui en rattrape d'autres.`,
            html`<b>Autonomie</b>, qui a suivi qui : sur chaque tronçon, deux coureurs du circuit partis du même poste à moins de 20 secondes d'intervalle sont
              comparés tout du long, chacun supposé avancer à vitesse régulière entre les deux postes. À moins de 7 secondes l'un de l'autre, ils courent
              ensemble ; de 7 à 20 secondes, de moins en moins. Celui qui passe le second suit l'autre. L'indice suiveur est le temps couru derrière moins
              le temps couru devant, rapporté au temps de course : positif pour un suiveur, négatif pour un lièvre. Suivre fait gagner du temps (l'autre
              lit la carte et ouvre le chemin), d'où l'intérêt de le repérer ; les deux seuils se règlent.`,
            html`<b>Régularité</b> : sur chaque tronçon, l'indice de performance est le temps de référence (la moyenne du meilleur quart des temps)
              divisé par le temps du coureur, 100 % pour aller aussi vite que les meilleurs. L'irrégularité est l'écart type de ces indices, chaque tronçon
              pesant son temps de référence, rapporté à l'indice moyen du coureur : un coureur régulier garde le même rythme d'un tronçon à l'autre, un
              coureur irrégulier alterne bons tronçons et hésitations. La dispersion d'un tronçon, le niveau de chacun mis à part, montre ceux où tout le
              monde a varié : les tronçons piégeux. Seuls les coureurs arrivés avec tous leurs temps comptent.`,
            html`Le <b>contrôle des temps</b> lit les temps intermédiaires eux-mêmes. Un tronçon couru en temps négatif au même poste pour au moins deux
              coureurs trahit un boîtier mal mis à l'heure (celui de ce poste ou du précédent) : il décale tous ceux qui y pointent. Un tronçon négatif
              isolé trahit une carte non effacée, qui garde les poinçons d'une course précédente. Un coureur classé sans un poste que les autres ont pointé
              l'a sans doute pointé avant son départ, et le logiciel a écarté ce poinçon. L'organisateur le voit en déposant ses résultats, avant de les
              publier ; le lecteur, au-dessus des analyses, et les cases concernées sont encadrées dans le tableau.`,
          ])}
        </section>`,
    });
  }

  // ======================================================================================================
  // Coach
  // ======================================================================================================
  const COACH = [["solo", "Analyse solo"], ["multi", "Analyse multi"], ["definitions", "Définitions de postes"], ["symboles", "Symboles de carte"],
    ["jeux", "Jeux"], ["vma", "VMA"], ...(admin ? [["routes", "Itinéraires calculés"]] : [])];     // (a prototype, for the administrators)
  function coach() {
    return chapters(COACH, {
      solo: () => html`
        ${slide("Coach", "Analyse solo", html`
          <p>L'${P("#/analyse-solo", "Analyse solo")} rejoue votre course sur votre carte avec votre trace GPS. Deux onglets : une compétition (une course
            passée d'Arena, dont les temps intermédiaires publiés affinent le calage) ou un entraînement, n'importe quelle sortie.</p>
          ${list([
            html`<b>Les fichiers</b> : la carte (image, PDF, KMZ, ou le fichier OCAD ou Mapper lui-même), la trace (GPX, FIT ou TCX) et, si on les a, le calage
              de la carte (KMZ, fichier de géoréférencement) et les circuits en IOF XML. Sur un téléphone, « Photographier la carte ».`,
            html`<b>Le calage</b> se fait seul : le parcours est lu sur la carte, la trace posée dessus ; si la lecture se trompe, quelques clics la corrigent.`,
            html`<b>La course</b> se rejoue ensuite, plein écran si on veut, inter-poste par inter-poste, avec le temps perdu, l'allure et les courbes de la
              montre (fréquence cardiaque, cadence, altitude…).`,
          ])}
          <p>La carte et la trace sont lues dans votre navigateur et n'en sortent pas ; seul le calage des postes est gardé, pour retrouver l'analyse telle
            qu'on l'a laissée.</p>`)}`,
      multi: () => html`
        ${slide("Coach", "Analyse multi", html`
          <p>L'${P("#/analyse-competition", "Analyse multi")} met côte à côte les traces de tous ceux qui ont couru une compétition ou un entraînement, sur la carte
            que l'organisateur a préparée (voir la documentation d'${M("orga", "Orga")}). Choisissez la course, ajoutez votre trace — elle ne garde que les
            positions et les heures —, et comparez. Il faut un compte.</p>
          ${list([
            html`<b>Le rejeu</b>, comme sur Livelox : heure réelle, départ en masse, attente aux postes, un inter-poste à la fois.`,
            html`<b>Sous la carte</b> : les temps intermédiaires (ceux publiés pour une compétition), les inter-postes, les écarts, les variantes d'itinéraire, et
              pour un entraînement les exercices de l'organisateur (couloir, azimut).`,
            html`<b>L'accès</b> : tous les comptes, les membres d'un club, ou un mot de passe. Votre propre fichier affiche aussi vos courbes à côté de la carte,
              pour vous seul.`,
          ])}`)}`,
      definitions: () => html`
        ${slide("Coach", "Définitions de postes", html`
          <p>Les ${P("#/definitions", "Définitions de postes")} présentent les symboles de l'IOF colonne par colonne, chacun avec son équivalent sur la carte,
            leurs noms dans 23 langues et une recherche. « Lire une ligne de définitions » détaille un exemple colonne par colonne. Pour réviser, on cache les
            noms, on devine la définition d'après la carte, ou la carte d'après le symbole.</p>`)}`,
      symboles: () => html`
        ${slide("Coach", "Symboles de carte", html`
          <p>Les ${P("#/symboles", "Symboles de carte")} sont la légende complète d'une carte de forêt (ISOM 2017-2), couleur par couleur : chaque symbole avec
            son numéro, son nom et ce qu'il signifie, ceux qu'il est interdit de franchir signalés. « Ce que disent les couleurs » explique la course possible
            selon le vert. Pour réviser, on cache les noms ou les dessins.</p>`)}`,
      jeux: () => html`
        ${slide("Coach", "Douze jeux de lecture de carte", html`
          <p>Les ${P("#/jeux", "Jeux")} se jouent sur des cartes dessinées par le site à chaque partie — une forêt avec son relief et sa végétation, une
            ville, un labyrinthe — et des « photos » du terrain dessinées de même. Rien n'est envoyé ; les meilleurs scores restent dans le navigateur.</p>
          ${list([
            html`<b>Choix d'itinéraire</b> : Tracé rapide (dessiner le plus court), Choix de parcours (20 secondes de carte, 5 pour choisir), Variante la
              plus rapide, Choix d'itinéraire entre trois ou quatre tracés.`,
            html`<b>Lecture du relief et du terrain</b> : Courbes de niveau, Montée ou descente ?, Cartes identiques, Cherchez l'erreur, Trail'O.`,
            html`<b>Mémoire</b> : Mémoire de carte, Mémoire photo, et le Labyrinthe, vu à la première personne.`,
          ])}`)}`,
      vma: () => html`
        ${slide("Coach", "La VMA", html`
          <p>La page ${P("#/vma", "VMA")} présente les tests (en laboratoire, VAMEVAL, Léger-Boucher, demi-Cooper, Cooper, navette, 45-15), calcule la vitesse
            maximale aérobie d'après un demi-Cooper (6 minutes) ou un Cooper (12 minutes) — le couloir de la piste compte, comme le dernier tour incomplet —,
            en déduit les allures d'entraînement, et propose des applications gratuites pour faire les tests.</p>`)}`,
      routes: () => html`
        ${slide("Coach · essai, administrateurs", "Les itinéraires calculés", html`
          <p>Dans les deux analyses GPS, un administrateur peut faire proposer par Ozimut, pour chaque inter-poste, les itinéraires les plus rapides
            sur la carte, avec leur longueur, leur dénivelé et un temps estimé — et mesurer sur le même modèle l'itinéraire que chaque coureur a pris.
            Dans l'${P("#/analyse-solo", "Analyse solo")}, tous les inter-postes sont calculés et un tableau les reprend sous la carte ; dans
            l'${P("#/analyse-club", "Analyse multi")}, l'inter-poste affiché, avec la liste des coureurs. C'est un prototype : les itinéraires suivent
            la carte telle qu'Ozimut la lit, et cette lecture peut se tromper.</p>`)}
        ${slide("Coach · essai", "1. Lire la carte d'après ses couleurs", html`
          <p>La carte est une image : Ozimut ne connaît que ses couleurs. Chaque point est classé : le blanc (forêt où l'on court bien), le jaune
            (terrain découvert, plus ou moins clair), les trois verts selon leur intensité, l'olive (zone interdite), et les « encres » posées par-dessus —
            le noir, le gris, le brun, le bleu et le violet du parcours.</p>
          ${list([
            html`Une encre est un <b>trait</b> ou une <b>surface</b> selon son épaisseur, comparée à celle des traits noirs de la carte : ce qui reste quand
              on efface les traits fins est une surface. Le noir épais est un bâtiment ou une grande falaise (infranchissable), le gris un bâtiment en
              sprint ou du rocher nu en forêt, le brun épais une zone revêtue, le bleu épais de l'eau.`,
            html`Les <b>traits noirs fins</b> assez longs (30 m), ou les tirets d'un chemin en pointillés, forment les chemins. Un petit trait isolé
              (une petite falaise, une ruine) ou des points (une limite de végétation) n'en sont pas.`,
            html`Les <b>traits bleus fins</b> sont les ruisseaux et, serrés, les marais. Les courbes de niveau, le parcours, le texte et les points sont
              effacés : chaque point prend la couleur du terrain le plus proche en dessous.`,
            html`La carte est ensuite découpée en cases d'environ 1,5 m, chacune avec le terrain le plus présent. « Voir le terrain tel que lu »
              montre ces cases sur la carte : c'est la première chose à vérifier.`,
          ])}
          <p>Limites connues : la zone interdite hachurée en violet est effacée avec le parcours ; une photo mal éclairée trouble les couleurs ; les
            falaises infranchissables fines, les murs et les clôtures sont des traits noirs comme les chemins (le réglage « Lignes noires fines » dit ce
            qu'ils sont).</p>`)}
        ${slide("Coach · essai", "1 bis. Mieux : la carte OCAD ou Mapper", html`
          <p>Le fichier de la carte elle-même — OCAD (.ocd) ou OpenOrienteering Mapper (.omap, .xmap) — dit le terrain sans deviner : Ozimut le lit
            dans votre navigateur avec le moteur du tracé de circuits et dessine chaque symbole à sa place exacte.</p>
          ${list([
            html`Les <b>surfaces</b> d'après leur couleur de remplissage (ou de hachure : bleue pour un marais, olive ou violette pour une zone
              interdite), couche par couche comme sur la carte — un vert posé sur un jaune l'emporte. La couleur plutôt que le numéro : l'ISOM 2000,
              l'ISOM 2017 et l'ISSprOM ne numérotent pas pareil.`,
            html`Les <b>lignes</b> d'après leur numéro : routes, pistes et sentiers (501 à 508) sont des chemins, continus même quand la carte les
              dessine en tirets ; les falaises, murs et clôtures infranchissables (201, 515, 518 ; 521 et 524 en ISOM 2000) arrêtent la course, sauf
              là où un chemin les traverse ; murs et clôtures franchissables et limites de végétation sont des lignes directrices ; les lignes
              bleues des ruisseaux.`,
            html`Courbes, symboles ponctuels, textes et parcours sont laissés de côté.`,
          ])}
          <p>Dans l'Analyse solo, un fichier OCAD ou Mapper déposé seul <b>est</b> la carte : dessinée ici, la trace calée par son
            géoréférencement. Déposé avec une image de la carte — ou choisi dans la boîte « Itinéraires calculés », dans les deux analyses —, il
            sert aux itinéraires, placé sur l'image par son géoréférencement : il doit en avoir un, et recouvrir la carte affichée.</p>`)}
        ${slide("Coach · essai", "2. Le temps d'un pas", html`
          <p>Le temps pour aller d'une case à sa voisine est la distance, multipliée par la lenteur du terrain et par celle de la pente :</p>
          ${list([
            html`<b>Le terrain</b> : sa vitesse en part de celle de la forêt blanche — chemin 125 %, terrain découvert 110 %, semi-découvert
              100 %, les trois verts 75, 45 et 20 %, marais 65 %, zone revêtue 120 %. L'eau, les bâtiments, la zone interdite (et le gris
              en sprint) sont infranchissables. Tout se règle sous « Vitesses par terrain ».`,
            html`<b>La pente</b>, lue sur le relief de l'IGN (RGE ALTI, en France) ou des « Terrain Tiles » ailleurs : en montée, chaque mètre gravi
              coûte autant que 8 m à plat (le réglage « 1 m de montée vaut ») ; en descente douce on va un peu plus vite (jusqu'à 9 % de mieux à
              15 % de pente), plus raide on freine (à 30 %, 29 % plus lent qu'à plat).`,
            html`Les pas vont dans 16 directions (les huit voisines et les sauts de cavalier), ce qui suit une ligne droite à 3 % près.`,
          ])}
          <p>Ce temps est celui d'une allure de référence en forêt blanche à plat : 6:00 min/km par défaut, ou celle qu'on tape, ou — sans rien taper —
            celle du coureur : dans l'Analyse solo, la médiane, sur ses inter-postes, de son temps réel divisé par le temps du modèle sur son propre
            itinéraire ; dans l'Analyse multi, la médiane des coureurs sur l'inter-poste.</p>`)}
        ${slide("Coach · essai", "3. La prudence de navigation", html`
          <p>Le plus court n'est pas toujours le plus sûr : loin de tout repère, au milieu de la forêt, on lit la carte plus souvent, on ralentit, on se
            trompe. Ozimut appelle <b>lignes directrices</b> les chemins, les ruisseaux, les lisières entre terrains différents et les bords de ce qui
            arrête (eau, bâtiments). La prudence ajoute au coût d'un pas une part de son temps qui croît avec la distance à la ligne directrice la plus
            proche, pleine à 50 m :</p>
          <p class="mx-eq">coût = temps × (1 + prudence × visibilité × min(1, distance / 50 m))</p>
          <p>La visibilité pèse 1 en forêt blanche, 1,2 à 1,4 dans les verts, 0,3 en terrain découvert, 0 sur un chemin. À 20 % (le réglage par
            défaut), traverser une forêt sans repère coûte jusqu'à un cinquième de plus ; à 0 %, on court droit comme un coureur qui ne se trompe
            jamais. La prudence choisit l'itinéraire ; les temps affichés restent ceux de la course seule, sans elle.</p>`)}
        ${slide("Coach · essai", "4. Les variantes", html`
          <p>L'itinéraire A est le moins coûteux, trouvé par une recherche A* dans une ellipse autour de l'inter-poste (assez large pour contourner un
            lac). Pour les suivants, Ozimut pénalise le couloir des itinéraires déjà trouvés et cherche à nouveau ; chaque proposition est ensuite
            retendue sans pénalité dans une bande autour d'elle, puis gardée seulement si :</p>
          ${list([
            html`elle s'écarte des précédentes (au moins 30 % de son tracé hors de leurs couloirs) ;`,
            html`elle ne coûte pas plus que A de plus que l'écart choisi (25 % par défaut) ;`,
            html`elle est <b>localement optimale</b> : aucun tronçon de 30 % de sa longueur ne peut être raccourci de plus de 1 % — un grand arc
              à travers une forêt uniforme n'est pas un choix, un détour par un chemin ou autour d'un vert l'est.`,
          ])}
          <p>Chaque variante dit si elle passe à gauche, à droite ou tout droit par rapport à la ligne entre les postes.</p>`)}
        ${slide("Coach · essai", "5. Votre itinéraire", html`
          <p>La trace du coureur entre deux postes est mesurée sur le même modèle, puis rapprochée de la variante la plus proche (à 25 m en moyenne près,
            sinon « autre »). Le tableau de l'Analyse solo en tire deux écarts :</p>
          ${list([
            html`<b>Choix</b> : le temps du modèle sur votre itinéraire, moins celui de l'itinéraire A — ce que votre choix a coûté (ou rapporté) à
              course égale ;`,
            html`<b>Exécution</b> : votre temps réel moins le temps du modèle sur votre itinéraire — ce que la course elle-même a coûté (hésitations,
              erreurs, terrain plus lent que la carte ne le dit).`,
          ])}
          <p>Avec l'allure automatique, l'exécution est nulle en médiane : elle dit quels inter-postes ont été plus lents ou plus rapides que d'habitude.</p>`)}`,
    });
  }

  // ======================================================================================================
  // Orga (« Le tracé », its other tab, is content/methods.*.js' tracerDoc)
  // ======================================================================================================
  const ORGA = [["qui", "Qui organise"], ["resultats", "Résultats"], ["horaires", "Horaires"], ["direct", "Direct"], ["suivi", "Suivi GPS"],
    ["analyses", "Analyses multi"], ["declarer", "Compétitions déclarées"]];
  function orga() {
    return chapters(ORGA, {
      qui: () => html`
        ${slide("Orga", "Les pages des organisateurs", html`
          <p>Orga sert aux clubs qui organisent ; il s'active à l'inscription, dans les Réglages ou sur la page des modules, et s'utilise sur ordinateur.
            Est organisateur d'une compétition ${fr ? "tout membre de son club organisateur — le club de sa dernière course connue — ou" : ""}
            le compte qui l'a déclarée, hors de France. Un entraînement, lui, peut être créé par n'importe quel compte.</p>
          ${list([
            html`${P("#/orga-competitions", "Compétitions")} et ${P("#/orga-entrainements", "Entraînements")} : préparer les analyses multi.`,
            html`${P("#/orga-resultats", "Résultats")} et ${P("#/orga-horaires", "Horaires")} : déposer les résultats et la liste de départ.`,
            html`${P("#/orga-direct", "Direct")} : diffuser les résultats en direct depuis le logiciel de chronométrage, et donner le lien du suivi GPS.`,
            html`${P("#/orga-tracer", "Tracer")} : tracer les circuits ; son guide est l'onglet ${D("tracer", "Le tracé")}.`,
          ])}`)}`,
      resultats: () => html`
        ${slide("Orga", "Déposer les résultats", html`
          <p>Pour une compétition de votre club, ${P("#/orga-resultats", "Orga › Résultats")} montre ce qu'Arena en a déjà, et
            « Déposer les résultats » ajoute votre fichier, en trois étapes :</p>
          <div class="mx-steps">
            <div class="mx-step"><b>Le fichier</b>Un export IOF XML de votre logiciel (le meilleur : il porte les circuits et les temps intermédiaires),
              ou le HTML d'OE ou de MeOS, ou un PDF ; zippé ou non, 30 Mo au plus.</div>
            <div class="mx-step"><b>La vérification</b>Le fichier est lu dans votre navigateur, rien n'est envoyé : résumé, résultats circuit par circuit,
              contrôle des temps (boîtiers mal réglés, cartes non effacées), et toutes les vues de l'analyse de course.</div>
            <div class="mx-step"><b>La publication</b>« Publier » l'envoie : la course paraît dans Arena en quelques minutes, marquée comme déposée par
              l'organisateur, et n'est plus cherchée ailleurs. Un nouveau dépôt remplace le précédent.</div>
          </div>`)}`,
      horaires: () => html`
        ${slide("Orga", "Publier les horaires de départ", html`
          <p>${P("#/orga-horaires", "Orga › Horaires")} publie la liste de départ d'une compétition à venir de votre club, jusqu'au jour de la
            course. Fichiers lus : IOF XML « StartList » (le mieux), CSV, tableau à une colonne de circuit par paire, HTML, PDF d'OE ou de MeOS, ou un
            lien Google Sheets partagé.</p>
          ${list([
            html`Le fichier est d'abord lu et vérifié dans votre navigateur : deux coureurs d'un même club qui se suivent, une minute de départ partagée,
              des coureurs sans heure, sans puce ou sans circuit, les intervalles et les places libres.`,
            html`« Vérifier et exporter » écrit aussi le fichier du départ pour l'application O Checklist.`,
            html`Une fois publiée, la liste paraît dans Arena (la liste de départ de la compétition), et chaque coureur qui l'a demandé reçoit son heure de
              départ par notification ou par e-mail.`,
          ])}`)}`,
      direct: () => html`
        ${slide("Orga", "Diffuser en direct", html`
          <p>${P("#/orga-direct", "Orga › Direct")} fait paraître vos résultats en direct dans Arena sans passer par liveresultat. Une diffusion
            s'ouvre par un nom, une date et, si possible, la compétition à laquelle elle se rattache. Puis, au choix :</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>Depuis MeOS</h3><p>Le service « Résultats en ligne » de MeOS envoie lui-même ses résultats à
              l'adresse, au numéro et au mot de passe que la page donne ; les temps intermédiaires des postes radio suivent.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>Depuis un fichier</h3><p>Votre logiciel exporte la liste des résultats toutes les quelques secondes
              (IOF XML, HTML d'OE ou de MeOS) ; la page, ouverte sur l'ordinateur de l'arène dans Chrome ou Edge, relit ce fichier et envoie ce qui change.</p></div>
          </div>
          <p>Rattachée à sa compétition, une diffusion est gardée après la course : ses résultats, ses temps intermédiaires et sa liste de départ restent
            dans Arena. C'est encore une version d'essai : à tester d'abord à un entraînement, ou à côté du direct habituel.</p>`)}`,
      suivi: () => html`
        ${slide("Orga", "Le suivi GPS", html`
          <p>Ozimut ne suit aucun coureur par GPS. Si votre compétition utilise un service de suivi (Loggator, GPSSeuranta, TracTrac, Livelox,
            Routechoices…), donnez son lien dans ${P("#/orga-direct", "Orga › Direct")} : il paraît sur la compétition dans Arena, avec ses résultats et son
            direct. Seul le lien est publié.</p>`)}`,
      analyses: () => html`
        ${slide("Orga", "Préparer une analyse multi", html`
          <p>Dans ${P("#/orga-competitions", "Compétitions")} (les compétitions de votre club des 60 derniers jours) ou ${P("#/orga-entrainements", "Entraînements")}
            (« Nouvel entraînement »), une analyse multi se prépare circuit par circuit :</p>
          ${list([
            html`<b>La carte</b> : une image, un PDF ou un KMZ, gardée telle quelle, sans perte de qualité.`,
            html`<b>Son calage</b> : d'un KMZ, d'un fichier de géoréférencement, d'un IOF XML avec coordonnées, ou de votre propre trace.`,
            html`<b>Le parcours</b> : lu sur la carte, l'ordre des postes venant de l'IOF XML des circuits, de votre trace, ou de vos clics.`,
            html`<b>L'accès</b> : tous les comptes, les membres du club, ou un mot de passe. « Voir comme les coureurs » montre la page telle qu'ils la
              verront.`,
          ])}
          <p>Les coureurs la trouvent dans Coach (« Analyse multi »). Le tracé peut aussi publier ses circuits, carte comprise, vers une analyse multi (après
            la course pour une compétition).</p>`)}`,
      declarer: () => html`
        ${slide("Orga", "Déclarer une compétition, hors de France", html`
          <p>Les compétitions françaises viennent du calendrier de ${fr ? "la FFCO" : "la fédération française"}. Dans les autres pays, un compte membre du pays déclare lui-même sa
            compétition, dans l'encadré « Mes compétitions déclarées » des pages Résultats, Horaires et Compétitions : pays, club, nom, date, lieu,
            spécialité, format, site web. Elle paraît alors dans Arena, avec les compétitions de son pays, et son organisateur peut y déposer liste de départ,
            résultats et analyses. Qui l'a déclarée n'est pas publié.</p>`)}`,
    });
  }

  const LABELS = { site: "Le site", arena: "Les compétitions", coach: "Coach", orga: "Les outils" };
  return { LABELS, LEDE, ARENA, COACH, ORGA, site, arena, coach, orga };
}

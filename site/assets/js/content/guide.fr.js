// The Documentation's guide to the site, in French (owner, 2026-10-24: the page told the methods but not the site; 2026-10-31:
// one documentation per module). guide.en.js in step: the same structure, the English words. build(X) receives the page's
// helpers and returns « Le site » (the documentation's home: short, every section on one page) and the guides of Arena,
// Coach and Orga, each a set of chapters (Stats' documentation is the methods', content/methods.*.js; Orga's « Le tracé »
// too). Plain sentences for orienteers; a page is named as the menu names it, with a link.
export function build(X) {
  const { html, raw, subTabs, fr = true, admin = false, owner = false } = X;
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
    coach: owner ? html`S'entraîner : les analyses de traces GPS, les définitions de postes, les symboles de carte, les jeux et la VMA.`
      : html`S'entraîner : les analyses de traces GPS, les jeux et la VMA.`,
    orga: html`Les outils des organisateurs : résultats, horaires, direct, suivi GPS, analyses de carte et tracé des circuits.`,
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
          html`<b>Sans compte</b>, Ozimut montre ce qui est public : Arena, Coach sauf la comparaison avec les autres coureurs, et dans Stats le coureur, le classement et les
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
          html`<b>La langue</b>, français, anglais, allemand ou espagnol, change sur cet appareil et, connecté, pour le compte (les e-mails suivent).`,
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
  const COACH = [["carte", "Analyse de carte"], ["solo", "Analyse solo"], ["multi", "Comparer avec les autres coureurs"], ["cartes", "Mes cartes"], ...(owner ? [["definitions", "Définitions de postes"], ["symboles", "Symboles de carte"]] : []),     // (the accounts named Le Helloco only, auth.owner)
    ["jeux", "Jeux"], ["vma", "VMA"], ["routes", "Itinéraires calculés"]];     // (every account's since 2026-11-04)
  function coach() {
    return chapters(COACH, {
      carte: () => html`
        ${slide("Coach", "Analyse de carte", html`
          <p>L'${P("#/analyse-carte", "Analyse de carte")} rassemble les analyses de traces GPS derrière quatre tuiles, rangées selon qui fournit la carte.</p>
          ${list([
            html`<b>L'organisateur a publié la carte et les circuits</b> : <b>Comparer avec les autres coureurs</b> (votre trace partagée avec
              les coureurs de l'événement) ou <b>Analyser seul ma course</b> (l'Analyse solo sur sa carte : vous ne déposez que votre trace, elle se pose
              d'elle-même grâce au calage de l'organisateur, et rien n'est envoyé ; pour une compétition, vos temps intermédiaires publiés le chronomètrent). Il faut un compte.`,
            html`<b>Vous avez votre propre carte</b> : <b>Une compétition</b> (une course des 60 derniers jours, ses résultats et ses temps intermédiaires à
              côté de votre trace) ou <b>Un entraînement ou une sortie</b> (n'importe quelle carte, n'importe quelle trace).`,
            html`<b>L'événement</b> se choisit dans une liste, avec la carte du pays à côté sur un ordinateur ; un événement choisi dit ce qu'il offre. Une
              compétition dont l'organisateur a publié la carte le signale, et propose de l'analyser sur sa carte.`,
          ])}`)}`,
      solo: () => html`
        ${slide("Coach", "Analyse solo", html`
          <p>L'${P("#/analyse-solo", "Analyse solo")} rejoue votre course sur votre carte avec votre trace GPS. On y entre par l'${P("#/analyse-carte", "Analyse de carte")} : une compétition (une course
            passée d'Arena, dont les temps intermédiaires publiés affinent le calage), un entraînement ou n'importe quelle sortie, ou la carte publiée par
            l'organisateur, sans carte à fournir ni calage à faire.</p>
          ${list([
            html`<b>Les fichiers</b> : la carte (image, PDF, KMZ, ou le fichier OCAD ou Mapper lui-même), la trace (GPX, FIT ou TCX) et, si on les a, le calage
              de la carte (KMZ, fichier de géoréférencement) et les circuits en IOF XML. Sur un téléphone, « Photographier la carte ».`,
            html`<b>Le calage</b> se fait seul : le parcours est lu sur la carte, la trace posée dessus ; si la lecture se trompe, quelques clics la corrigent.`,
            html`<b>La course</b> se rejoue ensuite, plein écran si on veut, inter-poste par inter-poste, avec le temps perdu, l'allure et les courbes de la
              montre (fréquence cardiaque, cadence, altitude…).`,
            html`<b>La trace</b> se colore par allure, fréquence cardiaque, altitude, pente, cadence ou puissance (ce que la montre a enregistré), avec sa
              légende ; on peut en couper le début et la fin (l'échauffement, le retour) et <b>exporter une image</b> de la carte avec la trace, un titre et
              la légende, enregistrée sur l'appareil.`,
            html`<b>Pas de trace GPS ?</b> « Dessiner mon itinéraire » : cliquez votre itinéraire sur la carte, poste après poste ; les temps intermédiaires publiés
              (ou ceux que vous tapez, l'arrivée au moins) le font courir comme une trace de montre ; « Coller aux chemins » pose ensuite chaque inter-poste
              sur le passage le plus proche que lit la carte. Un itinéraire dessiné ne sert pas à se comparer aux autres coureurs. <b>📏</b> mesure une distance sur la carte, et
              « Orientation de la carte » peut tourner l'inter-poste en cours vers le haut.`,
          ])}
          <p>La carte et la trace sont lues dans votre navigateur et n'en sortent pas ; seul le calage des postes est gardé, pour retrouver l'analyse telle
            qu'on l'a laissée.</p>`)}`,
      multi: () => html`
        ${slide("Coach", "Comparer avec les autres coureurs", html`
          <p>« ${P("#/analyse-carte?choix=multi", "Comparer avec les autres coureurs")} » met côte à côte les traces de tous ceux qui ont couru une compétition ou un entraînement, sur la carte
            que l'organisateur a préparée (voir la documentation d'${M("orga", "Orga")}). Choisissez la course, ajoutez votre trace — elle ne garde que les
            positions et les heures —, et comparez. Il faut un compte.</p>
          ${list([
            html`<b>Le rejeu</b>, comme sur Livelox : heure réelle, départ en masse, attente aux postes, un inter-poste à la fois.`,
            html`<b>À gauche de la carte</b>, l'onglet « Inter-postes » (ouvert d'emblée) détaille les inter-postes d'un coureur, et l'onglet « Analyses » les temps intermédiaires (ceux publiés pour une compétition), les écarts, les variantes d'itinéraire, et
              pour un entraînement les exercices de l'organisateur (couloir, azimut).`,
            html`<b>L'accès</b> : tous les comptes, les membres d'un club, ou un mot de passe. Votre propre fichier affiche aussi vos courbes à côté de la carte,
              pour vous seul.`,
            html`Chacun peut <b>commenter</b> sa course (« Mon commentaire »), lu par tous ceux qui voient les traces.
              L'organisateur peut ouvrir l'analyse <b>aux visiteurs sans compte</b> : ils ne voient que les traces des coureurs qui l'ont accepté. Un circuit
              <b>au score</b> (postes dans n'importe quel ordre) montre l'ordre de chacun.`,
          ])}`)}`,
      cartes: () => html`
        ${slide("Coach", "Mes cartes", html`
          <p>${P("#/mes-cartes", "Mes cartes")} garde vos cartes et les itinéraires que vous y avez courus, comme un DOMA à vous : une galerie à chercher par
            titre, lieu ou année, et chaque carte avec ses courses dessinées dessus, d'une couleur chacune ou selon l'allure. Il faut un compte.</p>
          ${list([
            html`<b>Ajouter une course</b> : dans l'Analyse solo, une fois la course calée, « Enregistrer dans Mes cartes ». Sont gardés la carte telle que vous
              l'avez donnée et l'itinéraire tel qu'il est dessiné (positions sur la carte et heures, postes), jamais le fichier GPS. La même carte n'est gardée
              qu'une fois : une autre course dessus s'y ajoute.`,
            html`<b>Importer</b> : les JPEG que QuickRoute exporte (ceux que DOMA garde), les fichiers d'Ozimut, un par un ou dans un zip, ou déposés sur la page.
              L'import direct depuis un DOMA n'est pas encore ouvert : son bouton envoie à l'équipe Ozimut une demande toute prête pour l'activer.`,
            html`<b>Exporter</b> : chaque carte devient un JPEG que tout le monde peut ouvrir (la carte avec vos itinéraires), qui contient aussi la carte
              d'origine et les courses ; Ozimut le relit tel quel. Plusieurs cartes cochées s'exportent ensemble dans un zip, se partagent par un même lien ou se suppriment d'un coup.`,
            html`<b>Données personnelles</b> : la fréquence cardiaque, l'altitude et la cadence ne sont gardées que si vous cochez la case (décochée par défaut).`,
            html`<b>Partager</b> : vos cartes sont privées. Un lien vers toutes vos cartes, ou vers une seule, les montre à qui le reçoit, même sans compte, sans
              les données personnelles ; supprimer le lien arrête le partage.`,
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
        ${slide("Coach · essai", "Les itinéraires calculés", html`
          <p>Dans les deux analyses GPS, Ozimut propose, pour chaque inter-poste, les itinéraires les plus rapides
            sur la carte, avec leur longueur, leur dénivelé et un temps estimé — et mesure sur le même modèle l'itinéraire que chaque coureur a pris.
            Dans l'${P("#/analyse-solo", "Analyse solo")}, tous les inter-postes sont calculés et l'onglet « Itinéraires », à gauche de la carte, les reprend poste par poste (les réglages sont dans l'onglet « Calcul », à droite) ; dans
            « ${P("#/analyse-club", "Comparer avec les autres coureurs")} », l'inter-poste affiché, avec la liste des coureurs. C'est un prototype : les itinéraires suivent
            la carte telle qu'Ozimut la lit, et cette lecture peut se tromper. Le calcul se lance de lui-même ; on l'arrête dans l'onglet « Calcul », et l'organisateur
            d'une analyse de carte peut le fermer pour son événement.</p>`)}
        ${slide("Coach · essai", "1. Lire la carte d'après ses couleurs", html`
          <p>La carte est une image : Ozimut ne connaît que ses couleurs. Chaque point est classé : le blanc (forêt où l'on court bien), le jaune
            (terrain découvert, plus ou moins clair), les trois verts selon leur intensité, l'olive (zone interdite), et les « encres » posées par-dessus —
            le noir, le gris, le brun, le bleu et le violet du parcours.</p>
          ${list([
            html`<b>Le papier d'abord</b> : sur une photo, il est gris, plus chaud ou plus froid, plus sombre dans un coin. Ozimut trouve sa couleur
              (les points clairs et presque gris), la mesure par carrés d'une cinquantaine de mètres et la ramène au blanc partout ; une carte exportée,
              déjà blanche, reste telle quelle. Une ombre plus claire que le gris du rocher nu n'est pas du rocher.`,
            html`<b>Les lignes du nord</b>, longues, droites, parallèles et régulièrement espacées, sont retirées (en cyan dans « Voir le terrain tel que
              lu ») : elles faisaient sinon des bandes d'eau ou de marais en travers de la carte.`,
            html`Une encre est un <b>trait</b> ou une <b>surface</b> selon son épaisseur, mesurée en mètres : ce qui reste quand on efface les traits de
              moins de 7 à 10 m de large (4 à 5 m en sprint) est une surface. Le noir épais est un bâtiment ou une grande falaise (infranchissable), le
              gris foncé un bâtiment en sprint ou du rocher nu en forêt, le brun épais une zone revêtue, le bleu épais de l'eau.`,
            html`<b>Les chemins</b> : les traits noirs fins (ou gris foncé, comme sur un scan) forment un réseau. Ozimut suit chaque trait, ses deux bouts et
              sa direction, et relie bout à bout les tirets d'un chemin en pointillés quand ils se font face par-dessus leur écart. Une chaîne de 30 m au
              moins est un chemin, de l'un de trois types d'après ses tirets comparés aux autres chemins de la carte : route ou piste (trait plein et plus
              épais, ou longs tirets épais), chemin, petit sentier (tirets courts). Des points, des triangles, un petit trait isolé n'en sont pas.`,
            html`<b>La surcharge de l'organisateur</b> : le violet imprimé sur du jaune, de l'orange ou du vert sort rouge sur le papier. Ses zones
              hachurées sont interdites ; ses bandes de croix le long d'une route sont des itinéraires interdits — on les traverse, on ne les suit pas ;
              près des postes du circuit (leurs cercles et leurs numéros), elle est ignorée. Les murs et clôtures infranchissables, eux, ne se
              distinguent pas d'un chemin sur une photo : leurs petits traits sont trop fins.`,
            html`Les <b>traits bleus fins</b> sont les ruisseaux et, serrés, les marais. Les courbes de niveau, le parcours, le texte et les points sont
              effacés : chaque point prend la couleur du terrain le plus proche en dessous.`,
            html`La carte est ensuite découpée en cases d'environ 1,5 m, chacune avec le terrain le plus présent. « Voir le terrain tel que lu »
              montre ces cases sur la carte, avec leur légende : c'est la première chose à vérifier. Ozimut avertit quand la lecture semble fausse
              (beaucoup de rocher nu ou de bâtiments en forêt, un seul terrain presque partout, aucun chemin).`,
          ])}
          <p>Limites connues : la zone interdite hachurée en violet est effacée avec le parcours ; les falaises infranchissables fines, les murs et les
            clôtures sont des traits noirs comme les chemins (le réglage « Lignes noires fines » dit ce qu'ils sont).</p>`)}
        ${slide("Coach · essai", "1 bis. Mieux : la carte OCAD ou Mapper", html`
          <p>Le fichier de la carte elle-même — OCAD (.ocd) ou OpenOrienteering Mapper (.omap, .xmap) — dit le terrain sans deviner : Ozimut le lit
            dans votre navigateur avec le moteur du tracé de circuits et dessine chaque symbole à sa place exacte.</p>
          ${list([
            html`Les <b>surfaces</b> d'après leur couleur de remplissage (ou de hachure : bleue pour un marais, olive ou violette pour une zone
              interdite), couche par couche comme sur la carte — un vert posé sur un jaune l'emporte. La couleur plutôt que le numéro : l'ISOM 2000,
              l'ISOM 2017 et l'ISSprOM ne numérotent pas pareil.`,
            html`Les <b>lignes</b> d'après leur numéro : routes et pistes (501 à 504), chemins (505), petits sentiers et layons (506 à 508) sont les trois types de chemin, continus même quand la carte les
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
            html`<b>Le terrain</b> : sa vitesse en part de celle de la forêt blanche — route ou piste 130 %, chemin 125 %, petit sentier 110 %, terrain découvert 110 %, semi-découvert
              100 %, les trois verts 75, 45 et 20 %, marais 65 %, zone revêtue 120 %. L'eau, les bâtiments, la zone interdite (et le gris
              en sprint) sont infranchissables. Tout se règle sous « Vitesses par terrain ».`,
            html`<b>La pente</b>, lue sur les courbes de niveau de la carte — relevées sur le terrain par le cartographe —, chacune mise à son altitude d'après le relief de l'IGN (RGE ALTI, en France) ou des « Terrain Tiles » ailleurs, qui comble aussi l'espace entre elles (« Relief : modèle seul » s'en passe ; une courbe mal lue fait une marche) : en montée, chaque mètre gravi
              coûte autant que 8 m à plat (le réglage « 1 m de montée vaut ») ; en descente douce on va un peu plus vite (jusqu'à 9 % de mieux à
              15 % de pente), plus raide on freine (à 30 %, 29 % plus lent qu'à plat).`,
            html`Les pas vont dans 16 directions (les huit voisines et les sauts de cavalier), ce qui suit une ligne droite à 3 % près.`,
          ])}
          <p>Ce temps est celui d'une allure de référence en forêt blanche à plat : 6:00 min/km par défaut, ou celle qu'on tape, ou — sans rien taper —
            celle du coureur : dans l'Analyse solo, la médiane, sur ses inter-postes, de son temps réel divisé par le temps du modèle sur son propre
            itinéraire ; dans « Comparer avec les autres coureurs », la médiane des coureurs sur l'inter-poste.</p>`)}
        ${slide("Coach · essai", "3. La prudence de navigation", html`
          <p>Le plus court n'est pas toujours le plus sûr : loin de tout repère, au milieu de la forêt, on lit la carte plus souvent, on ralentit, on se
            trompe. Ozimut appelle <b>lignes directrices</b> les chemins, les ruisseaux, les lisières entre terrains différents et les bords de ce qui
            arrête (eau, bâtiments). La prudence ajoute au coût d'un pas une part de son temps qui croît avec la distance à la ligne directrice la plus
            proche, pleine à 50 m :</p>
          <p class="mx-eq">coût = temps × (1 + prudence × visibilité × min(1, distance / 50 m))</p>
          <p>La visibilité pèse 1 en forêt blanche, 1,2 à 1,4 dans les verts, 0,3 en terrain découvert, 0 sur un chemin. À 20 % (le réglage par
            défaut), traverser une forêt sans repère coûte jusqu'à un cinquième de plus ; à 0 %, on court droit comme un coureur qui ne se trompe
            jamais. La prudence choisit l'itinéraire ; les temps affichés restent ceux de la course seule, sans elle.</p>`)}
        ${slide("Coach · essai", "4. Les variantes et la carte des décisions", html`
          <p>Ozimut fait pousser deux arbres de plus courts chemins dans une ellipse autour de l'inter-poste (assez large pour contourner un lac ou aller
            chercher une piste à côté) : l'un depuis le départ, l'autre depuis le poste. Leur somme en un point est le coût du meilleur itinéraire qui
            passe par ce point ; la plus basse donne A, le plus rapide, exact sur la grille. Les choix se lisent sur cette somme :</p>
          ${list([
            html`les <b>plateaux</b> : les tronçons où les deux arbres s'accordent — un chemin suivi longtemps en est un ;`,
            html`les <b>vallées</b> : le long de lignes en travers de l'inter-poste, à chaque dixième, chaque creux de la somme séparé des autres par une
              crête (1,5 % du temps de A au moins) est un passage à lui — où les bons itinéraires coupent-ils l'inter-poste ?`,
          ])}
          <p>Une proposition est gardée si elle ne coûte pas plus que A de plus que l'écart choisi (25 % par défaut), s'écarte des itinéraires gardés sur
            un cinquième de son tracé au moins, et soit coupe l'inter-poste dans une vallée qu'aucun d'eux ne prend (et aucun tronçon de 30 % de sa
            longueur ne peut être raccourci de plus de 1 %), soit s'en écarte sur 30 % et reste <b>localement optimale</b> sur la moitié de sa
            longueur. Un arc à travers une forêt uniforme n'est pas un choix ; le tout droit à côté d'une piste, un détour par un chemin ou autour
            d'un vert le sont. Chaque itinéraire est enfin tendu en lignes droites, hors des 16 directions de la grille, et mesuré comme la trace d'un
            coureur.</p>
          <p>La <b>carte des décisions</b> colore chaque point par le temps perdu en y passant : vert foncé sur un meilleur itinéraire, puis vert clair,
            jaune et orange jusqu'à l'écart des variantes ; au-delà, rien. Elle montre d'un coup d'œil les couloirs des bons choix et ce que coûte
            de s'en écarter.</p>
          <p>Chaque variante dit si elle passe à gauche, à droite ou tout droit par rapport à la ligne entre les postes.</p>`)}
        ${slide("Coach · essai", "5. Votre itinéraire", html`
          <p>Une trace GPS court quelques mètres à côté du chemin qu'elle suit (l'erreur du GPS et celle du calage) : mesurée telle quelle, elle passerait
            en forêt et coûterait plus que le chemin. Ozimut la recale donc sur la carte : le chemin le plus rapide du modèle qui reste à sa marge
            d'erreur près (12 à 25 m, d'après le calage), sur le chemin quand la trace le longe. Puis il mesure la part de cet itinéraire qui suit
            chaque itinéraire calculé. S'il en suit un sur 80 % de sa longueur au moins, c'est l'<b>itinéraire pris</b> et son temps compte ; sinon,
            la liste montre la part de chacun (« A 60 % · B 35 % ») et c'est le temps de la trace recalée qui compte.</p>
          ${list([
            html`<b>Choix</b> : le temps de l'itinéraire pris, moins celui de l'itinéraire A — nul quand vous avez pris A ;`,
            html`<b>Exécution</b> : votre temps réel moins le temps de l'itinéraire pris — ce que la course elle-même a coûté (hésitations,
              erreurs, terrain plus lent que la carte ne le dit).`,
          ])}
          <p>Avec l'allure automatique, l'exécution est nulle en médiane : elle dit quels inter-postes ont été plus lents ou plus rapides que d'habitude.</p>`)}
        ${slide("Coach · essai", "6. La calibration sur les postes courus", html`
          <p>Les vitesses par défaut sont celles d'un coureur moyen. Les postes dont on connaît l'itinéraire disent ce qu'elles valent pour ce
            coureur-là : on sait combien de mètres il a couru sur un chemin, hors chemin, en montée, et en combien de temps. Ozimut en tire trois
            nombres (case « Calibrer les vitesses sur les postes courus », cochée par défaut) :</p>
          ${list([
            html`son <b>allure</b> en forêt blanche à plat ;`,
            html`sa <b>vitesse sur les chemins</b> comparée à la forêt — seulement si deux postes au moins se courent surtout sur chemin et deux
              surtout hors chemin ;`,
            html`le <b>coût de la montée</b> — seulement si la montée pèse 4 % du temps sur six postes au moins.`,
          ])}
          <p>Avec peu de postes, ces valeurs bougent peu : elles ne s'écartent des valeurs par défaut que si les postes le disent nettement. Les
            postes à plus de 25 % du modèle (une erreur, un arrêt, une carte mal lue) sont mis de côté avant un second calcul : la calibration ne doit
            pas absorber les erreurs que l'exécution veut montrer. Les itinéraires sont ensuite recalculés avec ces vitesses : A est le meilleur
            itinéraire <i>pour ce coureur</i>, le choix se mesure contre lui, l'exécution contre ses vitesses habituelles. Dans « Comparer avec les autres coureurs », la
            vitesse sur les chemins et la montée se calibrent sur tout le groupe (tous les postes de tous les coureurs), et chacun garde son allure.</p>`)}`,
    });
  }

  // ======================================================================================================
  // Orga (« Le tracé », its other tab, is content/methods.*.js' tracerDoc)
  // ======================================================================================================
  const ORGA = [["qui", "Qui organise"], ["resultats", "Résultats"], ["horaires", "Horaires"], ["direct", "Direct"], ["suivi", "Suivi GPS"],
    ["analyses", "Analyses de carte"], ["declarer", "Compétitions déclarées"]];
  function orga() {
    return chapters(ORGA, {
      qui: () => html`
        ${slide("Orga", "Les pages des organisateurs", html`
          <p>Orga sert aux clubs qui organisent ; il s'active à l'inscription, dans les Réglages ou sur la page des modules, et s'utilise sur ordinateur.
            Est organisateur d'une compétition ${fr ? "tout membre de son club organisateur — le club de sa dernière course connue — ou" : ""}
            le compte qui l'a déclarée, hors de France. Un entraînement, lui, peut être créé par n'importe quel compte.</p>
          ${list([
            html`${P("#/orga-analyses", "Analyses de carte")} : préparer l'analyse de carte des compétitions du club et de ses entraînements.`,
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
            html`« Ouvrir la réservation » remplace le tableau partagé où les coureurs s'inscrivent à un horaire : vous réglez les circuits (premier et
              dernier départ, intervalle), l'écart entre deux coureurs d'un même club, la clôture ; chaque coureur réserve sur Ozimut avec son compte,
              pour lui et pour d'autres (sa famille, des licenciés ou non, de n'importe quel club ou sans club) ; un tableau Google Sheets déjà rempli
              s'importe avec tous ses onglets. À la clôture, les réservations deviennent la liste de départ publiée, et vous téléchargez le CSV ou
              l'IOF XML pour MeOS ou OE.`,
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
        ${slide("Orga", "Préparer une analyse de carte", html`
          <p>Dans ${P("#/orga-analyses", "Analyses de carte")} (les compétitions de votre club des 60 derniers jours, et vos entraînements :
            « Nouvel entraînement »), une analyse de carte se prépare circuit par circuit :</p>
          ${list([
            html`<b>La carte</b> : une image, un PDF ou un KMZ, gardée telle quelle, sans perte de qualité.`,
            html`<b>Son calage</b> : d'un KMZ, d'un fichier de géoréférencement, d'un IOF XML avec coordonnées, ou de votre propre trace.`,
            html`<b>Le parcours</b> : lu sur la carte, l'ordre des postes venant de l'IOF XML des circuits, de votre trace, ou de vos clics.`,
            html`<b>L'accès</b> : tous les comptes, les membres du club, ou un mot de passe. « Voir comme les coureurs » montre la page telle qu'ils la
              verront.`,
          ])}
          <p>La page de l'analyse sert à la gérer, pas à analyser : la liste des circuits, la carte de celui qu'on choisit avec son parcours pour le
            vérifier, la publication (une nouvelle analyse reste un brouillon que seuls les organisateurs voient, jusqu'à « Publier »), ce que les
            coureurs peuvent faire (ajouter leur trace, « Analyse solo » sur votre carte, « Mes cartes », commentaires, variantes, vue 3D,
            vidéo, itinéraires calculés), et la fréquentation : les comptes qui l'ont ouverte, les traces par circuit, ceux qui l'ont rejouée seuls
            sans partager de trace — des nombres seulement, jamais qui.</p>
          <p>Les coureurs la trouvent dans Coach (« Analyse de carte › Comparer avec les autres coureurs »). Le tracé peut aussi publier ses circuits, carte comprise, vers une analyse de carte (après
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

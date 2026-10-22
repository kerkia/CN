// The privacy policy and legal notices, in French — the version that prevails (pages/account.js « privacy »; the GDPR's
// information, articles 13 and 14, and the legal notices, LCEN article 6; reviewed 2026-10-15: keep the date up to date
// when what the site keeps changes, and the English version, privacy.en.js, in step).
// world: registration open to every orienteer (WORLD_OPEN, /api/account/status; owner, 2026-10-20): the texts about who may
// see what follow it, so that the page says what is true on either side of the switch.
export const body = (SITE, { world = false } = {}) => `
      <p>${SITE} est un site indépendant, sans lien avec la Fédération française de course d'orientation (FFCO). Il est édité à titre
        personnel et non commercial par <b>Yann Le Helloco</b>, responsable du traitement des données personnelles décrites ci-dessous
        au sens du règlement (UE) 2016/679 (RGPD). Contact : <b>contact@ozimut.com</b>.</p>
      <h2 style="font-size:16px">Conditions d'utilisation</h2>
      <p>${SITE} fonctionne avec des ressources gratuites et limitées, partagées entre tous ses utilisateurs. Il est destiné à être
        consulté personnellement par ${world ? "ses utilisateurs" : "les licenciés"}, au moyen d'un navigateur. Sauf accord préalable de l'éditeur, sont en conséquence
        interdits : la collecte automatisée (robots, scripts, aspiration des pages ou des fichiers de données), les téléchargements
        massifs, la réutilisation des données à d'autres fins et tout usage de nature à surcharger le site au détriment des autres
        utilisateurs. Un compte qui ne respecte pas ces règles peut être suspendu.</p>
      <p>Pour un besoin particulier (étude, besoins d'un club ou d'une ligue, données destinées à un autre outil), il est possible
        d'écrire à l'éditeur, par la page « Nous écrire » ou à contact@ozimut.com : la demande sera examinée.</p>
      <h2 style="font-size:16px">Indépendance et sources</h2>
      <p>${SITE} est indépendant, non officiel et gratuit, sans lien avec aucune fédération ni aucun organisateur. Ses sources : pour la France,
        les résultats, le classement national (CN) et l'agenda publiés par la Fédération française de course d'orientation (FFCO)
        sur cn.ffcorientation.fr et ffcorientation.fr, qui restent la référence ; pour l'Espagne, le calendrier et les inscriptions
        publiés par la Fédération espagnole (FEDO) sur sico.fedo.org, et les résultats publiés sur O-Replay (oreplay.es) ; pour
        toutes les courses, les résultats et les horaires que publient les organisateurs (leur site, liveresultat, WinSplits, Helga,
        Orientation Data, O-Replay) ou qu'ils déposent sur ${SITE}.</p>
      <p>Pour l'Espagne, ${SITE} reprend les résultats publics des courses (nom, club, catégorie, temps, temps intermédiaires) et le
        nombre d'inscrits par catégorie ; il n'affiche aucun numéro de licence ni de puce SportIdent. Ces résultats étant publics, ils
        sont visibles par tous les comptes connectés. Toute personne concernée peut demander à ne plus y être identifiée (voir
        « Vos droits »).</p>
      <h2 style="font-size:16px">Données des résultats, y compris celles des licenciés sans compte</h2>
      <p>Les classements, résultats et calculs affichés proviennent des résultats publiés par la FFCO sur cn.ffcorientation.fr : nom,
        club, catégorie, numéro de licence, temps et place de chaque licencié classé, qu'il dispose ou non d'un compte sur ${SITE}, y
        compris les licenciés mineurs. ${SITE} en tire des CN recalculés, des classements, des comparaisons et des statistiques (clubs,
        territoires, pyramide des âges, coureurs rencontrés en course). La page « Résultats » présente en outre, pour les courses des
        60 derniers jours, les résultats publiés par les organisateurs eux-mêmes (sur leur site, liveresultat, WinSplits, Helga, etc.)
        ou déposés sur ${SITE}, rapprochés des licences d'après le nom et le club.</p>
      <p>Ce traitement repose sur l'intérêt légitime de l'éditeur à informer les licenciés et à analyser le classement national à
        partir de résultats déjà publiés. ${world ? `Sur ${SITE}, ces données ne sont accessibles qu'aux comptes connectés qui ont
        rejoint la France, dont le numéro de licence FFCO est vérifié d'après le nom. Les autres comptes, ouverts à tout orienteur,
        voient les résultats publiés par les organisateurs (nom, club, catégorie, temps), sans numéro de licence, sans CN ni score, et
        sans accès aux classements, aux historiques ni aux statistiques.` : `Sur ${SITE}, ces données ne sont accessibles qu'aux comptes
        connectés, réservés aux licenciés, dont l'inscription est vérifiée d'après le nom et le numéro de licence.`} Seule exception : l'éditeur peut ouvrir,
        pour une durée limitée, un compte de démonstration à un organisme de course d'orientation (fédération, ligue, club) qui
        souhaite découvrir le site ; ce compte n'est rattaché à aucune licence, ne peut rien modifier ni déposer et cesse de
        fonctionner à la date fixée. Toute personne concernée peut en demander la rectification ou demander à ne plus y être identifiée (voir
        « Vos droits ») ; la source demeure le site de la FFCO.</p>
      <h2 style="font-size:16px">Dépôts de résultats et d'horaires de départ</h2>
      <p>Lors du dépôt d'un fichier de résultats, sont enregistrés le compte de l'auteur du dépôt, la course, le nom et la taille du
        fichier ainsi que la date du dépôt. Le fichier est conservé 60 jours dans l'espace de stockage du site (Cloudflare), puis
        effacé ; les résultats qu'il contient restent affichés. L'administrateur voit l'auteur de chaque dépôt et peut retirer un
        dépôt. Les horaires de départ qu'un organisateur dépose avant la course (« Organisation › Horaires ») suivent les mêmes
        règles ; seuls les noms, clubs, catégories et heures de départ en sont publiés, et les organisateurs de la course peuvent les
        retirer. Hors de France, un organisateur déclare les compétitions de son club (« Organisation ») : leur nom, date, lieu, club,
        discipline et site sont publiés dans l'Agenda ; le site garde en plus le compte qui les a déclarées, qui seul peut les modifier
        ou les retirer, et ne le publie pas.</p>
      <h2 style="font-size:16px">Analyses de traces GPS</h2>
      <p>La page « Analyse solo » lit la carte et la trace GPS dans votre navigateur : aucune donnée n'est transmise au site, et ces
        fichiers ne sont conservés que le temps de la visite.</p>
      <p>Dans une « Analyse multi » (entraînement ou compétition), l'organisateur dépose les cartes et les parcours, et chaque
        participant peut y ajouter sa propre trace. Celle-ci est alors transmise et conservée dans l'espace de stockage du site
        (Cloudflare), avec le nom et le numéro de licence du participant, réduite aux positions et aux heures situées sur l'emprise de
        la carte (sans fréquence cardiaque, cadence ni trajet hors de la carte). Elle est visible des personnes autorisées à ouvrir
        l'analyse, selon le choix de l'organisateur : tous les licenciés connectés, les membres de son club ou les détenteurs du mot
        de passe. Chaque participant peut retirer sa trace à tout moment ; elle est effacée avec l'analyse et avec son compte. Les
        cartes d'une analyse sont conservées tant que celle-ci existe ; si l'organisateur supprime son compte, l'analyse est maintenue,
        sans son nom. Dans une « Analyse multi », vos propres courbes (allure, fréquence cardiaque, cadence, etc.) proviennent de votre
        fichier, conservé dans votre navigateur sur cet appareil : il n'est pas transmis, et vous seul y avez accès.</p>
      <h2 style="font-size:16px">Tracé des circuits</h2>
      <p>Un événement de la page « Tracer » (ses circuits, sa carte, ses versions, les commentaires de l'équipe et les états des
        postes notés en mode terrain) est conservé dans l'espace de stockage du site (Cloudflare) et n'est accessible qu'à son équipe :
        son créateur et les personnes qui la rejoignent par un lien d'invitation que l'équipe leur a transmis (personne n'y est
        recherché par son nom, sa licence ou son adresse e-mail) ; leur nom, leur compte et, pour un licencié FFCO, sa licence sont
        enregistrés avec leur rôle. Les
        versions, les commentaires et les états des postes portent le nom de leur auteur. En mode terrain, l'état noté sur un poste
        enregistre aussi la position du téléphone à cet instant (pour la comparer à la carte), visible de l'équipe, et l'équipe
        peut y joindre des photos des postes (elles peuvent montrer des personnes : évitez-le), effacées avec l'événement ; la position
        n'est lue que pendant ce mode, avec l'autorisation du navigateur. Si l'équipe chiffre l'événement, ces données sont chiffrées
        dans le navigateur et illisibles pour le site. L'événement est conservé jusqu'à sa suppression par son créateur ; si
        celui-ci supprime son compte, il passe au premier traceur (à défaut, contrôleur) de l'équipe qui a un compte, sinon il est
        supprimé. Le calcul de la dénivelée envoie au service d'altitude de l'IGN (Géoplateforme, France) les seules coordonnées des
        postes et des coudes des circuits, sans nom ni code.</p>
      <h2 style="font-size:16px">Questions à l'IA</h2>
      <p>Sur la page « IA », votre question est envoyée au modèle de langage qui écrit la requête, avec la description des tables du
        site, la date du jour, votre numéro de licence et la méthode et la discipline choisies : par défaut le modèle d'Ozimut, exécuté
        par Cloudflare (Workers AI) ; ni le site ni Cloudflare ne conservent les questions. La requête s'exécute ensuite dans votre
        navigateur, sur les données que le site publie : elles ne sont transmises à aucun modèle. Si vous utilisez votre propre clé
        d'API (Anthropic, OpenAI, Google ou OpenRouter), votre navigateur envoie ces mêmes éléments directement à ce fournisseur, sous
        votre compte et selon ses conditions (avec une clé gratuite, Google peut se servir des questions pour améliorer ses
        produits) ; la clé reste dans votre navigateur et n'est jamais transmise à Ozimut.</p>
      <h2 style="font-size:16px">Données de votre compte</h2>
      <ul>
        <li><b>Données conservées :</b> l'adresse e-mail ; les prénom et nom saisis ; les pays rejoints, avec pour chacun le club et le
          numéro de membre indiqués, et pour la France le numéro de licence, vérifié d'après les résultats publiés par la FFCO ; le mot de passe, sous une forme chiffrée irréversible ; les dates d'inscription et
          de dernière connexion ; la langue choisie pour le site et les e-mails ; les réglages d'alertes (régions choisies) et la liste des
          courses déjà annoncées par e-mail ; pour le
          simulateur de relais, les coureurs ajoutés (nom, catégorie, CN estimé) et ceux marqués indisponibles, visibles de vous seul.
          N'y ajoutez que des personnes qui y consentent.</li>
        <li><b>Finalités et bases légales :</b> l'exécution du service demandé lors de la création du compte (réserver ${world
          ? "les données de la FFCO à ses licenciés" : "l'accès aux licenciés de la FFCO"}, confirmer l'adresse e-mail, réinitialiser le mot de passe) ; l'intérêt légitime de l'éditeur à détecter
          les comptes multiples pour une même licence ; votre consentement pour les alertes par e-mail ou par notification, que vous pouvez retirer à tout
          moment dans Réglages.</li>
        <li><b>Durée de conservation :</b> jusqu'à la suppression du compte, que vous pouvez effectuer à tout moment dans Réglages. Un
          e-mail en attente d'envoi est effacé dès son envoi.</li>
        <li><b>Destinataires :</b> l'administrateur du site et les prestataires techniques mentionnés ci-dessous. Aucune donnée n'est
          vendue ni utilisée à des fins publicitaires.</li>
      </ul>
      <p>Un message envoyé par la page « Nous écrire » parvient à l'éditeur par e-mail, accompagné de votre adresse, de votre nom et du
        navigateur utilisé ; il est conservé dans sa messagerie le temps nécessaire au traitement de la demande.</p>
      <h2 style="font-size:16px">Notifications</h2>
      <p>Si vous autorisez les notifications d'Ozimut sur un appareil, le site conserve, pour cet appareil, l'adresse d'envoi que lui
        attribue le service de notification de votre navigateur (Google pour Chrome et Android, Apple pour Safari, Mozilla pour
        Firefox, Microsoft pour Edge), les clés qui servent à chiffrer les messages et le type d'appareil (par exemple
        « Chrome · Android »). Les messages (votre heure de départ, la mise en ligne de vos résultats, les courses de l'agenda,
        selon vos réglages) sont chiffrés de bout en bout : le service de notification les achemine sans pouvoir les lire. Le site
        conserve aussi la dernière heure de départ notifiée pour chaque course, afin de ne la renvoyer que si elle change, et les
        notifications en attente d'envoi, quelques jours au plus. Base légale : votre consentement, donné en autorisant les
        notifications et retirable à tout moment dans Réglages ou dans les réglages de votre navigateur. Ces données sont effacées
        lorsque vous désactivez les notifications sur l'appareil, lorsque vous vous déconnectez de cet appareil et avec le compte.</p>
      <h2 style="font-size:16px">Statistiques d'utilisation</h2>
      <p>Afin de connaître l'usage du site et de l'améliorer (intérêt légitime), le site enregistre, pour chaque compte, le nombre de
        pages vues par jour et par rubrique (Classement, Coureur, Réseau, etc.) et le nombre de visites. Aucune autre donnée n'est
        enregistrée à ce titre : ni les recherches effectuées, ni l'adresse IP. Ces statistiques ne sont accessibles qu'à
        l'administrateur ; elles sont conservées 13 mois et supprimées avec le compte.</p>
      <h2 style="font-size:16px">Sécurité</h2>
      <p>Afin de limiter les tentatives répétées (connexion, inscription, mot de passe oublié), le site comptabilise les essais par
        adresse IP et par adresse e-mail (intérêt légitime) ; ces compteurs sont effacés au bout d'un jour environ. L'hébergeur peut en
        outre traiter l'adresse IP pour acheminer les pages et protéger le site contre les attaques.</p>
      <h2 style="font-size:16px">Prestataires et transferts hors de l'Union européenne</h2>
      <p>Les prestataires suivants traitent des données pour le compte de l'éditeur :</p>
      <ul>
        <li><b>Cloudflare, Inc.</b> (États-Unis) héberge le site, sa base de comptes et son espace de stockage de fichiers, et exécute
          le modèle de langage de la page « IA » ; à l'inscription, son service Turnstile vérifie que le formulaire est rempli par une
          personne et non par un robot, en examinant le navigateur sans cookie publicitaire ni suivi d'un site à l'autre. Les
          transferts vers les États-Unis reposent sur le cadre de protection des données UE-États-Unis (Data Privacy Framework),
          auquel Cloudflare a adhéré.</li>
        <li><b>Resend</b> (Plus Five Five, Inc., États-Unis) assure l'envoi des e-mails du site, ce qui implique l'adresse du
          destinataire et le contenu du message. Les transferts sont encadrés par les clauses contractuelles types de la Commission
          européenne.</li>
        <li><b>GitHub, Inc.</b> (États-Unis) exécute les mises à jour automatiques du site ; les résultats et les fichiers déposés y sont
          traités, à l'exclusion des données de compte. Les transferts sont encadrés par les clauses contractuelles types.</li>
      </ul>
      <h2 style="font-size:16px">Cookies et stockage local</h2>
      <p>Le site dépose un seul cookie, strictement nécessaire à son fonctionnement : il maintient votre connexion, pendant 30 jours
        au plus. Le navigateur conserve également, sur votre appareil, vos préférences d'affichage (langue, thème, discipline et
        méthode choisies), vos saisies dans le calculateur VMA ou le simulateur de relais et, pour le tracé des circuits, ses réglages d'affichage, la clé
        d'un événement chiffré, tirée de sa phrase de passe (le temps de l'onglet), les états du mode terrain en attente de réseau et, si vous
        gardez un événement pour travailler hors ligne, sa copie (circuits et carte, chiffrés s'il l'est) et les fichiers du site, effacés à la déconnexion ;
        si vous utilisez votre propre clé d'API sur la page « IA », cette clé (le temps de l'onglet, ou sur l'appareil si vous le demandez ;
        effacée à la déconnexion). Le site n'utilise aucun traceur publicitaire ni
        aucun outil tiers de mesure d'audience ; aucun consentement n'est donc requis.</p>
      <h2 style="font-size:16px">Vos droits</h2>
      <p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité de vos données, d'un
        droit à la limitation de leur traitement et d'un droit d'opposition aux traitements fondés sur l'intérêt légitime de
        l'éditeur.</p>
      <p>Vous pouvez en particulier demander à ne plus être identifié sur ${SITE}, sauf motif légitime et impérieux : votre nom et
        votre numéro de licence y sont alors remplacés, sur l'ensemble du site, par une mention anonyme (« Coureur anonyme »). Vos
        temps et vos places restent pris en compte, sans votre nom ni votre numéro de licence, afin que les classements des autres
        licenciés ne soient pas modifiés ; la mesure est réversible à votre demande. Une demande d'effacement des données de résultats
        est satisfaite de la même manière ; un compte, en revanche, est supprimé intégralement. Les données d'un licencié mineur sont
        anonymisées, et son compte supprimé s'il en a un, sur simple demande de son représentant légal, qui exerce ces droits en son
        nom.</p>
      <p>Vous pouvez supprimer vous-même votre compte, dans Réglages. Les autres demandes sont à adresser à contact@ozimut.com ; il y est
        répondu dans un délai d'un mois. En cas de doute raisonnable sur l'identité du demandeur, un justificatif peut être demandé.
        Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la CNIL
        (<a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">cnil.fr/fr/plaintes</a>).</p>
      <h2 style="font-size:16px">Mentions légales</h2>
      <p><b>Éditeur et directeur de la publication :</b> Yann Le Helloco, particulier, publication à titre non professionnel ;
        contact : contact@ozimut.com.<br>
        <b>Hébergeur :</b> Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis ; téléphone : +1 888 993 5273.</p>
      <p class="muted">Dernière mise à jour : 22 octobre 2026.</p>
`;

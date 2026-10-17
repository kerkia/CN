# O'CN — French ↔ English glossary

The vocabulary of the site's English (owner, 2026-10-17). IOF English for the sport; British spelling (organiser,
licence as a noun, colour, metre); plain words for the rest. Keep these terms everywhere: catalogues
(`site/assets/js/i18n/*.js`), long texts (`*.en.js`), e-mails, the white paper. Proper names stay as they are (races,
clubs, places, ligues, départements, FFCO's own page titles); the source data from FFCO stays French.

## Sport

| Français | English | Note |
|---|---|---|
| course d'orientation (CO) | orienteering | |
| course (une compétition) | race; event (several days or races) | « Courses » (the menu) = Races |
| compétition | competition | |
| circuit | course | a race's course, e.g. « Circuit A » = Course A |
| poste | control | « poste 3 » = control 3 |
| départ / arrivée | start / finish | |
| interposte | leg | |
| temps intermédiaires | split times, splits | « Temps intermédiaires » (page) = Splits |
| temps de course | race time | |
| catégorie | class | FFCO's classes: **H21, D16 shown M21, W16 in English** (`util.fmtCat`); data keep H/D |
| H (hommes) / D (dames) | M (men) / W (women) | |
| jeunes, juniors / seniors / vétérans | juniors / seniors / veterans | H35+ = veterans |
| PM (poste manquant) | MP (mispunch) | |
| abandon | DNF (did not finish) | |
| disqualifié | DSQ (disqualified) | |
| hors délai | over time (OT) | |
| non partant | DNS (did not start) | |
| non classé (NC) | not ranked (NC) | |
| place, classement | place, ranking | |
| podium | podium | |
| forêt | forest | the discipline |
| sprint | sprint | |
| VTT (VTT-O) | MTB (mountain bike orienteering) | |
| ski (ski-O) | ski (ski orienteering) | |
| longue distance (LD) / moyenne distance (MD) | long (LD) / middle (MD) | keep LD / MD as codes |
| nuit | night | |
| relais | relay | |
| spécialité / discipline | discipline | |
| carte | map | |
| tracé (des circuits) | course setting | « Tracer » (the menu) = Course setting; « le traceur » = the course setter |
| traceur / contrôleur | course setter / controller | |
| définitions de postes | control descriptions | |
| description (symboles) | description sheet | |
| organisateur | organiser | |
| licence, licencié | licence (licence number), licence holder / member | |
| club | club | |
| ligue | region (league) | « Ligue » as a FFCO region: region; « ligue de Bretagne » = Brittany region |
| département | département | kept |
| balise | control flag | |
| doigt (SportIdent) | SI card | |
| PC course, arène | arena | |
| départs (liste de départ) | start list | |
| inscriptions | entries; registrations | « Inscriptions closes » = Entries closed |
| annonce de course | race announcement | |
| entraînement | training | « Entrainement » (menu group) = Training |
| choix d'itinéraire | route choice | |
| erreur, temps perdu | mistake, time lost | |
| allure (min/km) | pace (min/km) | |
| dénivelée | climb | |
| VMA | MAS (maximal aerobic speed) | « VMA » page = MAS; demi-Cooper = half Cooper test |

## The national ranking and its methods

| Français | English | Note |
|---|---|---|
| Classement national (CN) | national ranking (CN) | « CN » kept as the name of the points: « CN officiel » = official CN |
| CN officiel | official CN | FFCO's |
| CN Top / score Top | CN Top / Top score | kept as names |
| CN Fit (analysts only) | CN Fit | never in the documentation |
| méthode officielle / méthode Top | official method / Top method | |
| Top linéaire | linear Top | analysts |
| score (d'une course) | race score, score | |
| valeur du circuit | course value | |
| niveau habituel | usual level | |
| recalage | rescaling | |
| fenêtre (12 mois) | window (12 months) | |
| meilleures courses retenues | best races kept | |
| pondération | weighting, weight | |
| CN J-15 | CN 15 days before (CN D-15) | « J-15 » = D-15 |
| écart au CN | gap to the CN | |
| centile (de catégorie) | percentile (in class) | « Centile cat. » = Class percentile |
| attendu (place attendue) | expected (expected place) | |
| courses classées | ranked races | « Courses classées » (page) = Ranked races |
| duels bien prédits | duels called right | the study's measure |
| significatif | significant | the 95 % interval excludes 0 |
| l'étude | the study | |
| livre blanc | white paper | |

## The site

| Français | English |
|---|---|
| Classement (menu) | Ranking |
| Coureur | Runner |
| Comparer | Compare |
| Clubs / Ligues | Clubs / Regions |
| Statistiques | Statistics |
| Agenda | Calendar |
| Résultats | Results |
| En direct | Live |
| Analyse solo / Analyse multi | Solo analysis / Group analysis |
| Organisation | Organising |
| Direct (Organisation) | Live feed |
| Jeux | Games |
| IA | AI |
| Documentation | Documentation |
| Réglages | Settings |
| Nous écrire | Contact us |
| Administration | Administration |
| Déconnexion / Connexion | Log out / Log in |
| Créer un compte | Create an account |
| Mot de passe oublié ? | Forgot your password? |
| Ma page | My page |
| Mon club | My club |
| Simulateur de relais | Relay simulator |
| Coupe de France des clubs | French Club Cup |
| Déposer (des résultats) | Upload (results) |
| version bêta | beta |
| Bientôt | Coming soon |
| Calcul du CN | CN calculation |
| Historique du CN | CN history |
| Progression | Progress |
| Saisons | Seasons |
| Réseau | Network |
| Pyramide des âges | Age pyramid |
| Territoires | Territories |
| Participation | Participation |

## Style

- Sentence case for titles and buttons (« Load models », not « Load Models »).
- Numbers: « 1,234.5 » and « 12 % » become « 1,234.5 » and « 12% » through the locale (en-GB); dates « 17 Oct 2026 ».
- Quotes: French « » become “ ” in English; no space before : ; ? !
- « vous » = you; keep the tone direct and friendly, as the French.

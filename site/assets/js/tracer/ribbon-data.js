// The Tracer's ribbon, as data (owner, 2026-10-17: the « O'CN mode », by default; the menus of icons.js stay as the « Purple Pen
// mode »). Shared by the editor (ribbon.js draws it), the guide (pages/methods.js: « L'écran », « Le ruban ») and the messages
// that name where a command is (where()). Tabs follow the setter's work; contextual tabs (CONTEXT) come with the selection.
// An item: { t: "big" | "small", act (an action of dialogs.js, or one of ribbon.js) | tool (an editor tool), label, icon, key,
// tip, need, split }. need: "edit" (not read-only), "course" (a course chosen), "vector" (an OCAD or Mapper map), "after" (from
// the race day, for a competition). { t: "stack", items } piles up to three small ones; { t: "gallery" } the special objects;
// { t: "field", id } a setting drawn by ribbon.js; { t: "chip", id } live figures; { t: "modes", id } choices with a preview.

import { MENUS } from "./icons.js";

const B = (act, label, icon, o = {}) => ({ t: "big", act, label, icon, ...o });
const S = (act, label, icon, o = {}) => ({ t: "small", act, label, icon, ...o });
const T = (tool, label, icon, o = {}) => ({ t: o.small ? "small" : "big", tool, label, icon, need: "edit", ...o });
const stack = (...items) => ({ t: "stack", items });

/** The special objects of the gallery, the most used first (the rest under ▾). */
export const GALLERY = ["water", "first-aid", "out-of-bounds", "boundary", "dangerous-area", "forbidden-route", "text", "image"];

export const TABS = [
  { id: "file", label: "Fichier", key: "F", backstage: true },
  { id: "home", label: "Tracer", key: "T", icon: "control", guide: "postes", groups: [
    { id: "select", title: "Sélection", items: [T("select", "Sélection", "select", { key: "S", need: null,
      tip: "Cliquer un objet pour le choisir ; glisser un objet choisi pour le déplacer ; glisser ailleurs pour déplacer la carte." })] },
    { id: "controls", title: "Postes", items: [
      T("control", "Poste", "control", { key: "P", tip: "Poser un poste : il vient après le poste choisi, dans l'interposte choisi, ou dans l'interposte le plus proche. L'outil reste actif pour poser les suivants." }),
      T("start", "Départ", "start", { key: "D", tip: "Poser le départ, ou cliquer un départ déjà posé pour le reprendre dans ce circuit." }),
      T("finish", "Arrivée", "finish", { key: "A", tip: "Poser l'arrivée." }),
      stack(T("crossing", "Passage obligatoire", "crossing", { small: true, key: "O", tip: "Un point de passage obligé (une brèche, un pont) : cliquer sur l'interposte." }),
        T("issue", "Remise de carte", "issue", { small: true, tip: "Là où le coureur reçoit sa carte, avant le départ ; un trajet balisé mène au départ." }),
        T("exchange", "Échange de carte", "exchange", { small: true, tip: "Cliquer un poste du circuit : le coureur y change de carte, et le circuit se partage en parties." }))] },
    { id: "legs", title: "Interpostes", items: [stack(
      T("bend", "Coude", "bend", { small: true, key: "C", tip: "Cliquer un interposte pour le plier (contourner une zone interdite) ; cliquer un coude pour le retirer." }),
      T("gap", "Coupure", "gap", { small: true, key: "X", tip: "Glisser le long d'un interposte ou d'un cercle pour le couper, et laisser lisible un détail de la carte." }),
      T("route", "Itinéraire", "route", { small: true, tip: "Le chemin prévu des coureurs, pour la dénivelée : cliquer l'interposte, puis les points du chemin. Il ne s'imprime pas." }))] },
    { id: "specials", title: "Objets spéciaux", launcher: "special-more", items: [{ t: "gallery" }] },
    { id: "descr", title: "Définitions", guide: "definitions", launcher: "standards", items: [
      T("descr", "Sur la carte", "descr", { tip: "Glisser un cadre sur la carte : les définitions du circuit s'y placent, et leur largeur fixe leur taille." }),
      stack({ t: "field", id: "descStandard" }, { t: "field", id: "lang" }, S("custom-text", "Textes…", "text", { need: "edit", tip: "Changer le texte qu'un symbole donne dans les définitions en texte." }))] },
  ] },
  { id: "courses", label: "Circuits", key: "C", icon: "course", guide: "circuits", groups: [
    { id: "course", title: "Circuit", launcher: "course-props", items: [
      B("course-new", "Nouveau circuit", "addcircle", { need: "edit", tip: "Un nouveau circuit (aussi : le « + » au bout des onglets)." }),
      B("course-props", "Propriétés", "pencil", { need: "course", tip: "Le nom, le type (normal ou au score), les catégories, la dénivelée, l'échelle d'impression, les définitions, la numérotation." }),
      stack(S("course-dup", "Dupliquer", "copy", { need: "course", tip: "Une copie du circuit, pour en dériver un autre." }),
        S("course-order", "Ordre des circuits", "sort", { need: "edit", tip: "L'ordre des onglets et des listes." }),
        S("course-delete", "Supprimer", "trash", { need: "course", tip: "Supprimer le circuit ; ses postes restent dans « Tous les postes »." }))] },
    { id: "variations", title: "Variantes", items: [
      B("var-fork", "Fourche", "fork", { need: "course", tip: "Une fourche à partir du poste choisi : des branches qui se rejoignent plus loin." }),
      B("var-loop", "Boucles", "loop", { need: "course", tip: "Des boucles à partir du poste choisi, qui y reviennent (un « papillon »)." }),
      stack(S("relay", "Relais…", "relay", { need: "course", tip: "Quelle variante court chaque relayeur de chaque équipe." }),
        S("var-delete", "Supprimer la variante", "removecircle", { need: "course", tip: "Supprimer la fourche ou les boucles qui partent du poste choisi." }))] },
    { id: "print", title: "Impression", guide: "sorties", launcher: "print-area", items: [
      B("print-area", "Zone d'impression", "frame", { tip: "La partie de la carte imprimée, le format et l'orientation de la feuille, les marges." }),
      stack({ t: "field", id: "printScale" }, S("view-printarea", "Montrer la zone", "frame", { toggle: "printArea", tip: "Montrer en pointillés la zone d'impression du circuit." }),
        S("part-options", "Options de la partie", "parts", { need: "course", tip: "Pour un circuit en plusieurs parties (échange de carte) : montrer ou non l'arrivée sur la partie choisie." }))] },
    { id: "numbers", title: "Numérotation", items: [
      stack(S("numbering", "Premier code…", "hash", { need: "edit", tip: "Le premier code des nouveaux postes, et si l'on évite les codes lisibles à l'envers." }),
        S("codes", "Changer les codes…", "tag", { need: "edit", tip: "Changer les codes de plusieurs postes d'un coup." }),
        S("renumber", "Renuméroter", "renumber", { need: "edit", tip: "Redonner un code à chaque poste, à partir du premier code." })),
      stack(S("remove-unused", "Postes inutilisés", "trash", { need: "edit", count: "unused", tip: "Supprimer les postes qu'aucun circuit n'utilise." }),
        S("punch", "Poinçons…", "dots", { need: "edit", tip: "Le dessin de la pince de chaque poste, pour vérifier les cartons." }))] },
  ] },
  { id: "map", label: "Carte", key: "A", icon: "map", guide: "carte", groups: [
    { id: "mapfile", title: "Carte", items: [
      B("map-change", "Changer de carte", "swap", { need: "edit", tip: "Une autre carte (une version corrigée, un meilleur scan, le fichier OCAD) : les postes gardent leur place." }),
      stack({ t: "chip", id: "mapInfo" }, S("event-props", "Échelle, résolution…", "sliders", { need: "edit", tip: "Le titre, l'échelle de la carte (et la résolution d'une image), la langue des définitions, des notes." }),
        S("import-course", "Lire un circuit imprimé", "scan", { need: "edit", tip: "Lire les cercles, le départ et l'arrivée imprimés sur une carte (un PDF, une photo) et en faire des postes." }))] },
    { id: "position", title: "Position", items: [
      B("calage", "Caler les postes", "target", { need: "edit", tip: "Replacer tous les postes sur la carte en deux clics par poste, sur deux postes éloignés : décalage, rotation, échelle." }),
      stack(S("georef", "Géoréférencer…", "globe", { tip: "Situer la carte sur la Terre : des points cliqués, un fichier de calage, un KMZ." }),
        S("move-all", "Déplacer tous les postes…", "move", { need: "edit", tip: "Décaler, tourner ou mettre à l'échelle tous les postes à la fois." }), { t: "chip", id: "geoInfo" })] },
    { id: "purple", title: "Violet", launcher: "appearance", items: [{ t: "modes", id: "blend" },
      stack(S("appearance", "Apparence…", "palette", { need: "edit", tip: "Le violet en CMJN, la police et le contour des numéros, la coupure automatique des traits, la taille selon l'échelle." }),
        S("overprint", "Surimpression", "layers", { need: "vector", toggle: "overprint", tip: "Les couleurs que la carte marque « surimpression », fondues comme à l'impression (carte OCAD ou Mapper)." }))] },
    { id: "symbols", title: "Symboles", launcher: "appearance", items: [stack({ t: "field", id: "circle" }, { t: "field", id: "line" }, { t: "field", id: "number" }),
      stack({ t: "field", id: "mapStandard" })] },
    { id: "view", title: "Affichage", items: [
      stack(S("view-course", "Tout le circuit", "fit", { tip: "Cadrer tout le circuit." }), S("view-map", "Toute la carte", "map", { tip: "Cadrer toute la carte." }),
        S("view-all", "Tous les postes", "view", { toggle: "allControls", tip: "Montrer en pâle les postes des autres circuits, pour les reprendre." })),
      stack(S("view-others", "Autres circuits…", "layers", { tip: "Montrer d'autres circuits en bleu pâle sous celui en cours." }), { t: "field", id: "intensity" })] },
  ] },
  { id: "check", label: "Vérifier", key: "V", icon: "shield", guide: "verifier", badge: "issues", groups: [
    { id: "audit", title: "Contrôle", items: [B("rep-audit", "Contrôle de l'événement", "shield", { badge: "issues",
      tip: "Postes trop proches, définitions incomplètes, codes, interpostes à travers une zone interdite… Le nombre de problèmes est tenu à jour." }), { t: "chip", id: "issues" }] },
    { id: "reports", title: "Rapports", items: [
      B("rep-summary", "Résumé", "list", { tip: "Pour chaque circuit : la longueur, la dénivelée, le nombre de postes." }),
      B("rep-legs", "Longueurs", "ruler", { tip: "La longueur de chaque interposte de chaque circuit." }),
      stack(S("rep-cross", "Références croisées", "table", { tip: "Quels circuits passent à quel poste." }),
        S("rep-load", "Charge des postes", "bars", { tip: "Le nombre de concurrents attendus à chaque poste et sur chaque interposte." }),
        S("export-csv", "Tableaux (CSV)", "table", { tip: "Les tableaux des rapports, pour un tableur." }))] },
    { id: "calc", title: "Calculs", guide: "calculs", items: [
      B("rep-climb", "Dénivelée (IGN)", "mountain", { tip: "La dénivelée de chaque circuit, sur le modèle de terrain de l'IGN (carte géoréférencée)." }),
      B("rep-times", "Temps du vainqueur", "stopwatch", { tip: "Le temps attendu du vainqueur de chaque circuit, et la longueur pour un temps visé." }),
      stack(S("load", "Concurrents…", "bars", { need: "edit", tip: "Le nombre de concurrents de chaque circuit (repris des inscriptions de la FFCO quand il y en a)." }))] },
    { id: "figures", title: "Circuit", items: [{ t: "chip", id: "course" }] },
  ] },
  { id: "out", label: "Imprimer", key: "I", icon: "printer", guide: "sorties", groups: [
    { id: "pdf", title: "PDF", items: [
      B("pdf-courses", "Cartes des circuits", "printer", { split: [["pdf-course", "Ce circuit"], ["pdf-courses", "Tous les circuits…"]],
        tip: "Les cartes des circuits à imprimer, à leur échelle d'impression. Imprimez le PDF en taille réelle." }),
      B("pdf-descriptions", "Définitions", "descr", { tip: "Les définitions seules, plusieurs par page, à découper pour les porte-définitions." }),
      B("pdf-punch", "Cartons de contrôle", "punch", { tip: "Les cartons de contrôle, avec une case par poste." })] },
    { id: "timing", title: "Chronométrage", items: [
      B("export-iof3", "IOF XML", "stopwatch", { split: [["export-iof3", "IOF XML 3.0"], ["export-iof2", "IOF XML 2.0.3"]],
        tip: "Les circuits pour MeOS, OE, SportSoftware : postes, ordre, longueurs, équipes des relais. 2.0.3 pour les logiciels anciens." })] },
    { id: "gps", title: "GPS et web", items: [
      stack(S("export-gpx", "GPX des postes", "pin", { tip: "Les postes en points GPS (carte géoréférencée)." }),
        S("export-kml", "KML des circuits", "globe", { tip: "Les circuits pour Google Earth ou une carte en ligne (carte géoréférencée)." }),
        S("export-images", "Images…", "image", { tip: "Une image par circuit (PNG, JPEG, GIF), avec son fichier de calage quand la carte est géoréférencée." })),
      stack(S("export-routegadget", "RouteGadget", "route", { tip: "La carte en image et les circuits, à déposer sur RouteGadget." }))] },
    { id: "software", title: "Autres logiciels", items: [stack(
      S("export-ocad", "OCAD ou Mapper…", "layers", { tip: "Chaque circuit en carte OCAD ou OpenOrienteering Mapper, la carte en fond." }),
      S("export-ocn", "Fichier O'CN…", "export", { tip: "Tout l'événement en un seul fichier .ocnt, sa carte comprise si on le veut." }),
      S("export-ppen", "Purple Pen (.ppen)", "export", { tip: "Le fichier de l'événement pour Purple Pen, à mettre à côté de la carte." }))] },
    { id: "files", title: "Fichiers", items: [stack(S("save-to", "Plusieurs fichiers…", "folder",
      { tip: "Quand une commande crée plusieurs fichiers : les écrire dans un dossier choisi, ou en un seul .zip." }))] },
  ] },
  { id: "team", label: "Équipe et course", key: "E", icon: "team", guide: "outils", badge: "comments", groups: [
    { id: "teamwork", title: "Équipe", items: [
      B("team", "Équipe", "team", { tip: "Les membres de l'équipe et leur rôle : traceur, contrôleur, lecteur." }),
      B("comments", "Commentaires", "comment", { badge: "comments", tip: "Les commentaires de l'équipe, épinglés sur la carte ; « Fait » quand c'est réglé." }),
      stack(S("versions", "Versions…", "history", { tip: "Chaque version gardée, ce qui a changé depuis, et la rouvrir." }),
        S("version-save", "Garder une version…", "bookmark", { need: "edit", tip: "Garder l'état actuel sous un nom, pour y revenir plus tard." }),
        S("save", "Enregistrer maintenant", "save", { key: "Ctrl+S", tip: "L'enregistrement se fait aussi tout seul, quelques secondes après chaque changement." }))] },
    { id: "terrain", title: "Terrain", items: [
      B("field", "Mode terrain", "phone", { tip: "Sur le téléphone : la carte géoréférencée avec sa position GPS, pour poser, vérifier et ramasser les postes." }),
      stack(S("rep-pickup", "Plan de ramassage", "box", { tip: "Quand et dans quel ordre ramasser les postes." }),
        S("offline", "Hors ligne…", "offline", { tip: "Garder l'événement sur cet appareil pour l'ouvrir sans réseau." }))] },
    { id: "after", title: "Après la course", guide: "apres", items: [
      B("publish", "Analyse multi", "share", { need: "after", tip: "Les circuits dans « Analyse multi », où les coureurs déposent leurs traces GPS." }),
      B("send-results", "Vers « Résultats »", "send", { need: "after", tip: "Longueurs, dénivelées et postes de chaque circuit, envoyés aux résultats de la course." }),
      B("rep-after", "Bilan", "chart", { need: "after", tip: "Pour chaque interposte : meilleur temps, temps médian, erreurs, itinéraires pris." })] },
    { id: "security", title: "Sécurité", items: [stack(S("encryption", "Chiffrement…", "lock", { tip: "Chiffrer l'événement avec une phrase de passe de l'équipe : le serveur ne peut plus le lire." }))] },
  ] },
];

/** What the settings, figures and galleries of the ribbon are (the tooltips, the guide's « Le ruban »). */
export const INFO = {
  field: {
    descStandard: ["Norme", "La norme des définitions : IOF 2018/2024, ou 2004."],
    lang: ["Langue", "La langue des définitions en texte (23 langues)."],
    mapStandard: ["Carte", "La norme de la carte, qui fixe la taille des cercles et des numéros : ISOM 2017 (forêt), ISSprOM 2019 (sprint), ISOM 2000."],
    printScale: ["Échelle", "L'échelle d'impression du circuit en cours (de « Tous les postes » quand aucun circuit n'est choisi)."],
    circle: ["Cercles", "La taille des cercles, en proportion de la norme."],
    line: ["Traits", "L'épaisseur des traits, en proportion de la norme."],
    number: ["Numéros", "La hauteur des numéros, en proportion de la norme."],
    intensity: ["Intensité", "Pâlir la carte, pour mieux voir le circuit (aussi : le curseur sous les boutons de zoom)."],
    code: ["Code", "Le code du poste (1 à 3 caractères), tel que le porte le boîtier."],
  },
  chip: {
    issues: "Les premiers problèmes que trouve le contrôle de l'événement, tenus à jour à chaque changement ; un clic ouvre le contrôle complet.",
    course: "Le circuit en cours : longueur, dénivelée, nombre de postes, échelle, concurrents attendus.",
    mapInfo: "La carte : son format et son échelle.", geoInfo: "Si la carte est géoréférencée.",
    control: "Les circuits qui passent au poste, sa charge, la longueur jusqu'au suivant.", leg: "La longueur de l'interposte (et en ligne droite), ses circuits, sa charge.",
    special: "L'objet et les circuits où il s'affiche.", drawing: "Ce qui est en train d'être dessiné, son nombre de points, et comment finir.",
  },
  modes: {
    blend: "Comment le violet se pose sur la carte, chaque façon montrée en petit : par-dessus, mélangé (le noir reste visible), en couches (sous les couleurs de la carte, OCAD ou Mapper).",
    flag: "Le balisage de l'interposte, chaque façon montrée en petit : aucun, tout, le début, la fin.",
  },
  gallery: "Les objets spéciaux les plus courants — point d'eau, poste de secours, zone interdite, limite infranchissable, zone dangereuse, itinéraire interdit, texte, image — et ▾ pour tous.",
};

/** The contextual tabs, by the selection's kind (ribbon.js fills in titles and figures). */
export const CONTEXT = {
  control: { label: "Poste", head: "Outils du poste", guide: "postes", groups: [
    { id: "ctl", title: "Poste", items: [stack({ t: "field", id: "code" }, S("control-props", "Définition…", "descr", { need: "edit", tip: "Les colonnes de la définition du poste, et son code." }),
      S("toggle-exchange", "Échange de carte ici", "exchange", { need: "edit", toggle: "exchange", tip: "Le coureur change de carte à ce poste ; le circuit se partage en parties." }))] },
    { id: "vars", title: "Variantes", items: [B("var-fork", "Fourche ici", "fork", { need: "edit", tip: "Des branches qui partent de ce poste et se rejoignent plus loin." }),
      B("var-loop", "Boucles ici", "loop", { need: "edit", tip: "Des boucles qui partent de ce poste et y reviennent." }),
      stack(S("var-delete", "Supprimer la variante", "removecircle", { need: "edit", tip: "Supprimer la fourche ou les boucles qui partent de ce poste." }),
        S("points", "Points…", "hash", { need: "edit", tip: "Les points du poste, dans un circuit au score." }))] },
    { id: "lines", title: "Définitions", items: [stack(S("text-before", "Texte avant…", "text", { need: "edit", tip: "Une ligne de texte dans les définitions, juste avant ce poste (« Passage dans le village »)." }),
      S("text-after", "Texte après…", "text", { need: "edit", tip: "Une ligne de texte dans les définitions, juste après ce poste." }))] },
    { id: "drawing", title: "Dessin", items: [stack(S("gap-add-circle", "Couper le cercle", "gap", { need: "edit", tip: "Puis cliquer sur le cercle là où le couper, pour laisser lisible un détail de la carte." }),
      S("number-auto", "Numéro à sa place", "number", { need: "edit", tip: "Remettre le numéro à la place que le tracé lui choisit." }),
      S("rotate", "Faire pivoter…", "rotate", { need: "edit", tip: "Faire pivoter le symbole du passage obligatoire." }))] },
    { id: "where", title: "Dans les circuits", items: [{ t: "chip", id: "control" }] },
    { id: "remove", title: "", items: [B("delete", "Retirer", "trash", { need: "edit", key: "Suppr", tip: "Dans un circuit : retirer le poste du circuit, il reste dans « Tous les postes ». Dans « Tous les postes » : le supprimer." })] },
  ] },
  leg: { label: "Interposte", head: "Outils de l'interposte", guide: "circuits", groups: [
    { id: "shape", title: "Forme", items: [B("bend-add", "Ajouter un coude", "bend", { need: "edit", tip: "Puis cliquer sur l'interposte, là où le plier. Un coude se glisse ensuite." }),
      B("gap-add-leg", "Couper", "gap", { need: "edit", tip: "Puis cliquer sur l'interposte, là où le couper." }),
      stack(S("bend-remove", "Retirer un coude", "bend", { need: "edit", tip: "Puis cliquer le coude à retirer." }),
        S("gap-remove-leg", "Refermer une coupure", "gap", { need: "edit", tip: "Puis cliquer la coupure à refermer." }),
        S("route-draw", "Itinéraire prévu", "route", { need: "edit", tip: "Dessiner le chemin prévu des coureurs, pour la dénivelée ; il ne s'imprime pas." }))] },
    { id: "flagging", title: "Balisage", items: [{ t: "modes", id: "flag" }] },
    { id: "where", title: "Interposte", items: [{ t: "chip", id: "leg" }] },
  ] },
  special: { label: "Objet", head: "Outils de l'objet", guide: "speciaux", groups: [
    { id: "obj", title: "Objet", items: [B("special-props", "Modifier…", "pencil", { need: "edit", tip: "Le texte, l'apparence du trait, ou les colonnes des définitions." }),
      B("displayed-courses", "Circuits…", "layers", { need: "edit", tip: "Les circuits sur lesquels l'objet s'affiche et s'imprime." }),
      stack(S("corner-add", "Ajouter un sommet", "vertex", { need: "edit", tip: "Puis cliquer sur la ligne ou le bord de la zone." }),
        S("corner-remove", "Retirer un sommet", "vertex", { need: "edit", tip: "Puis cliquer le sommet à retirer." }),
        S("rotate", "Faire pivoter…", "rotate", { need: "edit", tip: "Faire pivoter le symbole." }))] },
    { id: "where", title: "", items: [{ t: "chip", id: "special" }] },
    { id: "remove", title: "", items: [B("delete", "Supprimer", "trash", { need: "edit", key: "Suppr", tip: "Supprimer l'objet." })] },
  ] },
  drawing: { label: "Tracé en cours", head: "Tracé en cours", guide: "speciaux", groups: [
    { id: "draw", title: "", items: [B("finish-draw", "Terminer", "check", { key: "Entrée", tip: "Finir la ligne, la zone ou l'itinéraire (comme un double-clic)." }),
      B("cancel-draw", "Annuler", "close", { key: "Échap", tip: "Abandonner ce tracé." }), { t: "chip", id: "drawing" }] },
  ] },
};

/** The « Fichier » page (the ribbon's backstage): its sections, each a list of commands with what they are for. */
export const BACKSTAGE = [
  { id: "info", label: "Informations", icon: "sliders" },
  { id: "new", label: "Nouveau", icon: "file", act: "start-new" },
  { id: "open", label: "Ouvrir", icon: "folder", act: "start-open" },
  { id: "import", label: "Importer", icon: "import", items: [
    ["start-import", "Un événement", "Un fichier O'CN (.ocnt), qui contient sa carte, ou un fichier Purple Pen (.ppen) et sa carte : un nouvel événement, à côté de celui-ci."],
    ["import-ppen", "Les circuits d'un .ppen", "Remplace les circuits de cet événement par ceux d'un fichier Purple Pen ; la carte reste celle de l'événement."],
    ["map-change", "Une autre carte", "OCAD, Mapper, PDF, TIFF ou image : les postes gardent leur place."],
    ["import-course", "Un circuit imprimé", "Les cercles, le départ et l'arrivée lus sur une carte imprimée ou photographiée."],
    ["georef", "Un calage", "Le géoréférencement de la carte : un fichier de calage (world file et .prj), un KMZ ou un KML, ou des points cliqués."]] },
  { id: "save", label: "Enregistrer", icon: "save", items: [
    ["save", "Enregistrer maintenant", "L'enregistrement se fait aussi tout seul, quelques secondes après chaque changement."],
    ["version-save", "Garder une version", "L'état actuel sous un nom, pour y revenir plus tard ; une version est aussi gardée toutes les 30 minutes de travail."],
    ["versions", "Les versions", "Chaque version, ce qui a changé depuis (« poste 34 déplacé de 40 m »), et la rouvrir."]] },
  { id: "export", label: "Exporter", icon: "export", groups: [
    ["Pour imprimer", [["pdf-courses", "PDF des circuits", "Un circuit par page, par partie, par variante ou par relayeur ; la carte et le circuit, ou le circuit seul pour une surimpression."],
      ["pdf-descriptions", "PDF des définitions", "Plusieurs par page, à découper pour les porte-définitions."], ["pdf-punch", "Cartons de contrôle", "Une case par poste, avec le dessin des pinces."]]],
    ["Pour le chronométrage", [["export-iof3", "IOF XML 3.0", "Pour MeOS, OE, SportSoftware : les circuits, l'ordre des postes, les longueurs, les équipes des relais."],
      ["export-iof2", "IOF XML 2.0.3", "La même chose pour les logiciels plus anciens."]]],
    ["Pour les GPS et le web", [["export-gpx", "GPX des postes", "Les postes en points GPS (carte géoréférencée)."], ["export-kml", "KML des circuits", "Pour Google Earth ou une carte en ligne."],
      ["export-images", "Images des circuits", "PNG, JPEG ou GIF, avec leur fichier de calage."], ["export-routegadget", "RouteGadget", "La carte en image et les circuits."]]],
    ["Pour d'autres logiciels", [["export-ocn", "Fichier O'CN (.ocnt)", "Tout l'événement en un seul fichier, sa carte comprise si on le veut : une copie, une archive, un autre club."],
      ["export-ocad", "OCAD ou Mapper", "Chaque circuit en carte OCAD (9 à 2018) ou Mapper, la carte en fond."], ["export-ppen", "Purple Pen (.ppen)", "L'événement, à ouvrir dans Purple Pen à côté de la carte."],
      ["export-csv", "Tableaux (CSV)", "Les rapports, pour un tableur."]]]] },
  { id: "share", label: "Partager", icon: "team", items: [
    ["team", "L'équipe", "Le traceur et le contrôleur modifient, un lecteur lit et commente. Les administrateurs du site ne voient pas l'événement."],
    ["encryption", "Le chiffrement", "Une phrase de passe de l'équipe : le serveur ne garde que des données illisibles."],
    ["publish", "Vers l'analyse multi", "Après la course : la carte et les circuits, pour que les coureurs y déposent leurs traces GPS."],
    ["send-results", "Vers « Résultats »", "À partir du jour de la course : les longueurs, dénivelées et postes des circuits."]] },
  { id: "offline", label: "Hors ligne", icon: "offline", items: [
    ["offline", "Travailler hors ligne", "Garder l'événement sur cet appareil : il s'ouvre sans réseau, et les modifications partent quand le réseau revient."]] },
  { id: "options", label: "Options", icon: "sliders" },
];

// ---- where a command is: the messages name it in the interface the user has (ribbon or menus) ---------------------------------
const PREF = "ocn.tr.prefs";
/** The interface chosen on this browser: "ocn" (the ribbon, by default) or "pp" (Purple Pen's menus). */
export function uiMode() { try { return JSON.parse(localStorage.getItem(PREF) || "{}").ui === "pp" ? "pp" : "ocn"; } catch (e) { return "ocn"; } }
export function setUiMode(m) { try { const o = JSON.parse(localStorage.getItem(PREF) || "{}"); o.ui = m === "pp" ? "pp" : "ocn"; localStorage.setItem(PREF, JSON.stringify(o)); } catch (e) { /* this visit */ } }

/** Every command of the ribbon: { act | tool, label, icon, tip, tab, group, ctx }. */
export function commands() {
  const out = [];
  const walk = (tab, group, items, ctx) => items.forEach((it) => {
    if (it.t === "stack") walk(tab, group, it.items, ctx);
    else if (it.act || it.tool) out.push({ ...it, tab, group, ctx });
  });
  for (const tab of TABS) for (const g of tab.groups || []) walk(tab, g, g.items, null);
  for (const [k, c] of Object.entries(CONTEXT)) for (const g of c.groups) walk({ id: `ctx:${k}`, label: c.label }, g, g.items, k);
  return out;
}
const RIBBON_AT = {};
for (const c of commands()) if (c.act && !RIBBON_AT[c.act]) RIBBON_AT[c.act] = `${c.tab.label}${c.group.title ? ` › ${c.group.title}` : ""} › ${c.label.replace(/…$/, "")}`;
for (const s of BACKSTAGE) for (const [a, l] of [...(s.items || []), ...(s.groups || []).flatMap((g) => g[1])]) if (!RIBBON_AT[a]) RIBBON_AT[a] = `Fichier › ${s.label} › ${l}`;
const MENU_AT = {};
for (const m of MENUS) for (const it of m.items) if (it !== "-" && !MENU_AT[it[0]]) MENU_AT[it[0]] = `${m.label} › ${it[1].replace(/…$/, "")}`;
/** Where a command is, in the interface in use: « Carte › Position › Caler les postes », or « Événement › Caler les postes sur la carte ». */
export const where = (act, mode = uiMode()) => (mode === "pp" ? MENU_AT[act] || RIBBON_AT[act] : RIBBON_AT[act] || MENU_AT[act]) || "";
export const ribbonAt = (act) => RIBBON_AT[act] || "";
export const menuAt = (act) => MENU_AT[act] || "";

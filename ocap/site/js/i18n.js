// Every text of the app, in French and English. The language is the one chosen in Réglages, else the phone's.
import { settings } from "./settings.js";

const T = {
  fr: {
    "app.name": "O'Cap",
    "tab.soon": "Bientôt", "tab.live": "En direct", "tab.recent": "Récemment", "tab.settings": "Réglages",
    "live.title": "En direct", "live.search": "Course, organisateur…", "live.today": "Aujourd'hui", "live.yesterday": "Hier",
    "live.tomorrow": "Demain", "live.followed": "Suivies", "live.recentOpened": "Ouvertes récemment", "live.none": "Aucune course ne correspond.",
    "live.loading": "Chargement…", "live.source": "Résultats en direct publiés par les organisateurs sur liveresultat.",
    "live.on": "En direct", "live.ago": "il y a {t}", "live.idle": "Pas de nouvelle arrivée depuis {t}", "live.connecting": "Connexion…",
    "live.offline": "Hors ligne — reconnexion…", "live.classes": "Circuits", "live.lastPass": "Dernières arrivées",
    "live.finished": "Arrivés", "live.running": "En course", "live.notStarted": "Pas encore partis", "live.others": "Autres",
    "live.justIn": "Vient d'arriver", "live.started": "Parti depuis {t}", "live.atControl": "Poste {c} · {p}e · {d}",
    "live.finish": "Arrivée", "live.you": "Vous", "live.follow": "Suivre", "live.unfollow": "Ne plus suivre",
    "live.empty": "Pas encore de résultat dans ce circuit.", "live.missing": "Ce circuit n'existe plus.",
    "live.runners": "{n} coureurs", "live.in": "{n} arrivés",
    "st.mp": "PM", "st.dnf": "Abandon", "st.dsq": "Disq.", "st.ot": "Hors délai", "st.dns": "Non partant", "st.nc": "NC",
    "soon.title": "Bientôt", "recent.title": "Récemment", "wip": "Cette page arrive bientôt.",
    "set.title": "Réglages", "set.lang": "Langue", "set.lang.auto": "Celle du téléphone", "set.me": "Vous",
    "set.me.hint": "Votre nom, pour vous retrouver d'un coup d'œil dans les résultats. Il reste sur ce téléphone : rien n'est envoyé.",
    "set.first": "Prénom", "set.last": "Nom", "set.saved": "Enregistré", "set.follow": "Suivis",
    "set.follow.none": "Personne pour l'instant : touchez l'étoile d'un coureur dans les résultats.", "set.about": "À propos",
    "set.about.text": "O'Cap relaie les résultats publics de la course d'orientation : les courses à venir, les résultats en direct (liveresultat) et les résultats publiés par les organisateurs.",
  },
  en: {
    "app.name": "O'Cap",
    "tab.soon": "Upcoming", "tab.live": "Live", "tab.recent": "Recent", "tab.settings": "Settings",
    "live.title": "Live", "live.search": "Race, organiser…", "live.today": "Today", "live.yesterday": "Yesterday",
    "live.tomorrow": "Tomorrow", "live.followed": "Followed", "live.recentOpened": "Recently opened", "live.none": "No race matches.",
    "live.loading": "Loading…", "live.source": "Live results published by organisers on liveresultat.",
    "live.on": "Live", "live.ago": "{t} ago", "live.idle": "No new finisher for {t}", "live.connecting": "Connecting…",
    "live.offline": "Offline — reconnecting…", "live.classes": "Classes", "live.lastPass": "Latest finishers",
    "live.finished": "Finished", "live.running": "Running", "live.notStarted": "Not started yet", "live.others": "Others",
    "live.justIn": "Just finished", "live.started": "Out for {t}", "live.atControl": "Control {c} · {p}th · {d}",
    "live.finish": "Finish", "live.you": "You", "live.follow": "Follow", "live.unfollow": "Unfollow",
    "live.empty": "No result in this class yet.", "live.missing": "This class no longer exists.",
    "live.runners": "{n} runners", "live.in": "{n} finished",
    "st.mp": "MP", "st.dnf": "DNF", "st.dsq": "DSQ", "st.ot": "Over time", "st.dns": "DNS", "st.nc": "NC",
    "soon.title": "Upcoming", "recent.title": "Recent", "wip": "This page is coming soon.",
    "set.title": "Settings", "set.lang": "Language", "set.lang.auto": "The phone's", "set.me": "You",
    "set.me.hint": "Your name, to spot yourself in results at a glance. It stays on this phone: nothing is sent.",
    "set.first": "First name", "set.last": "Last name", "set.saved": "Saved", "set.follow": "Following",
    "set.follow.none": "Nobody yet: tap a runner's star in the results.", "set.about": "About",
    "set.about.text": "O'Cap relays public orienteering results: upcoming races, live results (liveresultat) and the results organisers publish.",
  },
};

export function lang() {
  const s = settings().lang;
  if (s === "fr" || s === "en") return s;
  return (navigator.languages || [navigator.language || "en"]).some((l) => /^fr\b/i.test(l)) ? "fr" : "en";
}

export function t(key, vars) {
  let s = T[lang()][key] ?? T.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** « 3 min », « 1 h 05 », « 12 s » */
export function since(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
}

export function fmtDay(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(lang() === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// MeOSDjango sites (2026-10-23): a MeOS results site a club installs (github.com/Jolatomme/MeOSDjango), fed by MeOS during
// the race. Its public JSON gives each course's runners — status, start, time and the controls punched — so a race held
// there is relayed live as an organiser's broadcast is: the race's object reads its courses while someone watches and
// passes the classes that changed to the same `update`. Only the sites' public pages and JSON are read; none of their code.
//
//   /?months=3                        the competitions of the last months and the coming ones, as cards (name, date, organiser)
//   /competition/<cid>/               its courses, each with a link /competition/<cid>/course/<hash>/live/
//   /api/<cid>/course/<hash>/live/    a course's runners: name, org, class_name, stat (MeOS's code), st_abs (start, tenths after
//                                     midnight), rt (running time, tenths), radio_punches [{ctrl, time}] (tenths from the start),
//                                     last_punch_clock_abs; the course's controls [{ctrl_id, ctrl_name « 1-222 (3p) »}];
//                                     server_now_abs, competition_date, race_state

// The sites read, in this order for good: a race's number holds its site's place in the list (append only)
export const HOSTS = ["jolatomme.alwaysdata.net", "heyries.alwaysdata.net"];
export const FROM = 800000000;                   // below the organisers' broadcasts (900 000 000), far above liveresultat's
export const isMd = (comp) => Number(comp) >= FROM && Number(comp) < FROM + HOSTS.length * 1000000;
export const raceId = (i, cid) => FROM + i * 1000000 + Number(cid);
export const site = (comp) => {
  const n = Number(comp) - FROM;
  return { host: HOSTS[Math.floor(n / 1000000)], cid: n % 1000000 };
};

const UA = "Ozimut-live/1.0 (+https://ozimut.com; one reader per competition, relayed to its spectators)";
export async function get(url, json = false) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html" } });
  if (!r.ok) throw new Error(`meosdjango ${r.status} ${url}`);
  return json ? r.json() : r.text();
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] !== "#" ? ENT[e] ?? m
  : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));

/** The home page's competition cards: [{ cid, name, organizer, date }]. */
export function cards(s) {
  const out = [];
  for (const card of s.split('<div class="co-card').slice(1)) {
    const cid = /href="\/competition\/(\d+)\/"/.exec(card);
    const name = /<span class="text-truncate" title="([^"]+)"/.exec(card);
    const day = />\s*(\d{2})\/(\d{2})\/(\d{4})\s*</.exec(card);
    const org = /class="org-site-link"[^>]*>([^<]+)</.exec(card) || /bi-building[^>]*><\/i>\s*([^<]+)</.exec(card);
    if (cid && name && day) out.push({ cid: Number(cid[1]), name: unent(name[1]).trim(), organizer: org ? unent(org[1]).trim() : "",
      date: `${day[3]}-${day[2]}-${day[1]}` });
  }
  return out;
}

/** A competition page's courses: their hashes, in the page's order. */
export const courses = (s, cid) => [...new Set([...s.matchAll(new RegExp(`href="/competition/${cid}/course/([0-9a-f]+)/live/"`, "g"))].map((m) => m[1]))];

/** A course's last punch or finish, seconds before the site's clock (null: nothing yet). */
export function lastAge(d) {
  let last = null;
  for (const x of d.runners || []) {
    const t = Math.max(x.last_punch_clock_abs || 0, x.stat === 1 && x.rt > 0 && x.st_abs > 0 ? x.st_abs + x.rt : 0);
    if (t > 0 && (last == null || t > last)) last = t;
  }
  return last == null || !(d.server_now_abs > 0) ? null : Math.max(0, Math.round((d.server_now_abs - last) / 10));
}

// MeOS's status codes -> liveresultat's (0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 overtime, 12 not classified); 0 is decided below
const STAT = { 1: 0, 2: 12, 3: 3, 4: 2, 5: 4, 6: 5, 15: 12, 20: 1, 21: 1, 99: 12 };
/** « GOBILLOT, Amelie » (MeOS's « family, given ») -> « Amelie GOBILLOT », as liveresultat writes names. */
const personName = (s) => {
  const [a, ...b] = String(s || "").split(",");
  return b.length && b.join(",").trim() ? `${b.join(",").trim()} ${a.trim()}` : String(s || "").trim();
};
const ctrlName = (s, code) => String(s || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || String(code);

/**
 * Courses' JSON -> the classes in the compact form « En direct » shows (liveresultat's: rows [place, name, club, result,
 * status, timeplus, progress, start, splits, provisional] in hundredths, splits [time, place, timeplus] per control), one
 * class per class_name (a course holds several classes, a class sits on one course). Answers { order, classes }.
 */
export function compact(list) {
  const classes = {}, order = [];
  for (const d of list) {
    const ctrls = (d.controls || []).filter((c) => c.ctrl_id != null);
    const codes = ctrls.map((c) => String(c.ctrl_id));
    // a control met twice on the course (a butterfly) keeps its number with the visit (« 222 », then « 222.2 »)
    const seen = {}, keys = codes.map((c) => { seen[c] = (seen[c] || 0) + 1; return seen[c] > 1 ? `${c}.${seen[c]}` : c; });
    const now = d.server_now_abs || 0;
    const by = new Map();
    for (const x of d.runners || []) {
      const cls = String(x.class_name || d.course?.display_name || "").slice(0, 120) || "?";
      let status;
      if (x.stat === 1) status = x.rt > 0 ? 0 : null;
      else if (!x.stat) status = x.n_punches > 0 || (x.st_abs > 0 && now > 0 && x.st_abs <= now) ? 9 : x.st_abs > 0 ? 10 : null;
      else status = STAT[x.stat] ?? 12;
      // each control of the course in order, a repeated one's second punch on its second visit
      const punches = x.radio_punches || [];
      let i = 0;
      const times = codes.map((code) => {
        const j = punches.findIndex((p, n) => n >= i && String(p.ctrl) === code);
        if (j < 0) return null;
        i = j + 1;
        return punches[j].time > 0 ? punches[j].time * 10 : null;
      });
      const r = { name: personName(x.name), club: String(x.org || "").trim(), status, result: status === 0 ? x.rt * 10 : null,
        start: x.st_abs > 0 ? x.st_abs * 10 : null, times };
      (by.get(cls) || by.set(cls, []).get(cls)).push(r);
    }
    for (const [cls, rows] of by) {
      // places and gaps: at each control among those who passed it, at the finish among the classified
      const per = codes.map((_, i) => rows.map((r) => r.times[i]).filter((t) => t != null).sort((a, b) => a - b));
      const fin = rows.filter((r) => r.status === 0).map((r) => r.result).sort((a, b) => a - b);
      const placeIn = (sorted, t) => sorted.indexOf(t) + 1;
      if (!classes[cls]) order.push(cls);
      classes[cls] = {
        controls: codes.map((code, i) => [keys[i], ctrlName(ctrls[i].ctrl_name, code)]),
        rows: rows.map((r) => [r.status === 0 ? placeIn(fin, r.result) : null, r.name, r.club, r.result, r.status,
          r.status === 0 ? r.result - fin[0] : null, null, r.start,
          codes.length ? r.times.map((t, i) => (t == null ? null : [t, placeIn(per[i], t), t - per[i][0]])) : null, 0]),
      };
    }
  }
  return { order, classes };
}

// O'Live (2026-10-24): co-live.fr, Philippe Chambon's live results site, which French organisers feed from their timing
// software during the race. No API: its public pages are read, as a phone's browser reads them, while someone watches the
// race on « En direct ». A race there is relayed as a MeOSDjango race is: the race's object reads its circuits' pages and
// passes the classes that changed to the same `update`. Only its public pages are read; none of its code.
//
//   /olive/resultats.php                                  the races on offer (« Courses disponibles »): a link
//                                                         ?Action=ChoixResultats&IdCourse=<n>, its type, « le : dd/mm/yyyy »
//   ?Action=ChoixCircuits&IdCourse=<n>                    its circuits, each a link ?Action=Result&IdCourse=<n>&Circuit=<c>
//   ?Action=Result&IdCourse=<n>&Circuit=<c>               the circuit's runners: name (bib in its title), time — the running
//                                                         time of a runner still out, at O'Live's last import —, or the start
//                                                         time of one waiting (« 12 h 46 »), status (Wait, Run., Arr, OK, P.M,
//                                                         Abd, Abs, Dsq, H.D, N.C.), category, FFCO club number and name; a
//                                                         finisher's card number (data-numpuce)
//   bloc.php (POST Demande=PointagesPuce, IdCourse, NumPuce)   a card's punches: order, control code, the time from the start
//                                                         and, as its title, the time of day; the finish « Arr. »

// The sites read, in this order for good: a race's number holds its site's place in the list (append only)
export const HOSTS = ["co-live.fr"];
export const FROM = 700000000;                   // below MeOSDjango's sites (800 000 000)
export const isOl = (comp) => Number(comp) >= FROM && Number(comp) < FROM + HOSTS.length * 1000000;
export const raceId = (i, id) => FROM + i * 1000000 + Number(id);
export const site = (comp) => {
  const n = Number(comp) - FROM;
  return { host: HOSTS[Math.floor(n / 1000000)], id: n % 1000000 };
};
export const base = (host) => `https://${host}/olive`;

const UA = "Ozimut-live/1.0 (+https://ozimut.com; one reader per competition, relayed to its spectators)";
/** A page's text and the time it was made (its Date header, else now), in ms. */
export async function get(url, form = null) {
  const r = await fetch(url, form ? { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString() } : { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r.ok) throw new Error(`olive ${r.status} ${url}`);
  const at = Date.parse(r.headers.get("Date") || "");
  return { text: await r.text(), at: Number.isFinite(at) ? at : Date.now() };
}

// HTML's named entities: an accented letter is its letter and its mark (« &aacute; », « &Scaron; »: 2026-10-24, « EGRI
// M&aacute;ty&aacute;s » was shown as written), the others listed
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", szlig: "ß", oslash: "ø", Oslash: "Ø",
  aelig: "æ", AElig: "Æ", oelig: "œ", OElig: "Œ", eth: "ð", ETH: "Ð", thorn: "þ", THORN: "Þ", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…", middot: "·", euro: "€" };
const MARK = { grave: "̀", acute: "́", circ: "̂", tilde: "̃", uml: "̈", ring: "̊", cedil: "̧",
  caron: "̌" };
const named = (e) => ENT[e] ?? ((m) => m && (m[1] + MARK[m[2]]).normalize("NFC"))(/^([a-zA-Z])(grave|acute|circ|tilde|uml|ring|cedil|caron)$/.exec(e));
export const unent = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] !== "#" ? named(e) || m
  : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));

/** The races on offer: [{ id, name, date, type }] (type « Course Individuelle », « Relais »…). */
export function races(s) {
  const out = [];
  for (const x of s.matchAll(/<a href="\?Action=ChoixResultats&amp;IdCourse=(\d+)"[^>]*>([^<]*)<\/a>\s*<p class="InfoCourse">(.*?)<\/p>/g)) {
    const day = /(\d{2})\/(\d{2})\/(\d{4})/.exec(x[3]);
    const type = /<span>([^<]*)<\/span>/.exec(x[3]);
    out.push({ id: Number(x[1]), name: unent(x[2]).trim(), date: day ? `${day[3]}-${day[2]}-${day[1]}` : null,
      type: type ? unent(type[1]).trim() : "" });
  }
  return out;
}
/** A relay (« Course en Relais »): its pages show teams, read by `relay` (2026-10-25, the CNE at Le Bessat). */
export const isRelay = (r) => /relais/i.test(r?.type || "");

/** A race's circuits, in the page's order. */
export const circuits = (s, id) => [...new Set([...s.matchAll(new RegExp(`\\?Action=Result&amp;IdCourse=${id}&amp;Circuit=([^"&]+)"`, "g"))]
  .map((m) => decodeURIComponent(unent(m[1]))))];
/** A page's title (the race's name). */
export const title = (s) => unent(/<h1>([^<]*)<\/h1>/.exec(s)?.[1] || "").trim();

/** « 20:12 », « 1:02:03 » -> seconds; null when not a time. */
export function secs(s) {
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{2})$/.exec(String(s || "").trim());
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
/** A time of day in Paris, seconds after midnight. */
export function parisSeconds(ms) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms));
  const v = (k) => Number(p.find((x) => x.type === k)?.value);
  return v("hour") * 3600 + v("minute") * 60 + v("second");
}

// O'Live's states (its legend; « Arr » a finish whose card is not read yet, « Arr? » a finish that does not fit, met on
// runners recorded absent or retired) -> liveresultat's (0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 overtime, 9 running, 10 not
// started, 12 not classified)
const STAT = { ok: 0, arr: 0, pm: 3, abd: 2, abs: 1, dsq: 4, hd: 5, nc: 12, run: 9, ant: 9, wait: 10, start: 10, "dép": 10,
  dep: 10, "dep?": 9, "arr?": 12 };
const word = (s) => String(s || "").trim().toLowerCase().replace(/\./g, "");
export const statusOf = (s) => STAT[word(s)] ?? null;
/** A finish whose card is not read yet: a provisional result. */
export const radioFinish = (s) => word(s) === "arr";

/** « DE LA CRUZ Sergi » (the family name in capitals first) -> « Sergi DE LA CRUZ », as liveresultat writes names. */
export function personName(s) {
  const w = String(s || "").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < w.length && /\p{Lu}/u.test(w[i]) && w[i] === w[i].toUpperCase()) i++;
  return i > 0 && i < w.length ? `${w.slice(i).join(" ")} ${w.slice(0, i).join(" ")}` : w.join(" ");
}

/**
 * A circuit's results page: [{ bib, name, cat, club, code, status, time, start, card }], `time` in seconds (a runner out:
 * their running time at O'Live's last import), `start` in seconds after midnight when the page gives it (a runner waiting).
 */
export function rows(s) {
  const out = [];
  for (const part of s.split('data-role="collapsible" data-enhanced="true"').slice(1)) {
    const name = /<span class="NomCoureur"(?: title="Dossard #([^"]*)")?>([^<]*)<\/span>/.exec(part);
    if (!name) continue;
    const st = /<span class="Status">(?:<a [^>]*>)?([^<]*)</.exec(part);
    const time = /<span class="Temps">([^<]*)<\/span>/.exec(part);
    const dep = /<span class="HeureDepart">\s*(\d{1,2})\s*h\s*(\d{2})(?:\s*(?:min|m)?\s*(\d{2}))?/.exec(part);
    const cat = /<span class="Categorie">([^<]*)<\/span>/.exec(part);
    const code = /<span class="NumClub">([^<]*)<\/span>/.exec(part);
    const club = /<span class="LibClub">([^<]*)<\/span>/.exec(part);
    const card = /data-numpuce="(\d+)"/.exec(part);
    const word = unent(st?.[1] || "").trim();
    const at = dep ? Number(dep[1]) * 3600 + Number(dep[2]) * 60 + Number(dep[3] || 0) : 0;      // (« 00 h 00 »: none)
    out.push({ bib: name[1] || "", name: personName(unent(name[2])), cat: unent(cat?.[1] || "").trim(),
      club: unent(club?.[1] || "").trim(), code: unent(code?.[1] || "").trim(), word, status: statusOf(word),
      time: secs(unent(time?.[1] || "")), start: at || null,
      card: card ? card[1] : null });
  }
  return out;
}

/** The start of each runner out, in seconds after midnight, written on the rows: the page's time `at` (ms) less their
 *  running time. Only an estimate — O'Live counts the running time at its last import of the timing software's data, up to
 *  a minute before the page (2026-10-24: the same times for 40 s) —, used when nothing better is known: the start shown
 *  while they waited, their card's. */
export function starts(list, at) {
  const now = parisSeconds(at);
  for (const r of list) if (r.start == null && r.status === 9 && r.time != null) r.start = (now - r.time + 86400) % 86400;
  return list;
}

/** A card's punches: { codes: [control code…] in the course's order, times: [seconds from the start | null…], finish: its
 *  time from the start, start: the start's time of day (seconds), from the finish's time of day less its time }. */
export function card(s) {
  const codes = [], times = [];
  let finish = null, start = null;
  for (const p of s.matchAll(/<p class="poincons">(.*?)<\/p>/g)) {
    const ordre = /<span class="ordre">([^<]*)</.exec(p[1])?.[1]?.trim();
    const code = /<span class="code">([^<]*)</.exec(p[1])?.[1]?.trim();
    const tm = /<span class="temps"(?: title="([^"]*)")?>([^<]*)</.exec(p[1]);
    const t = secs(tm?.[2]), clock = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(tm?.[1] || "");
    if (/^arr/i.test(code || "")) {
      finish = t;
      if (t != null && clock) start = (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) - t + 86400) % 86400;
    } else if (/^\d+$/.test(ordre || "") && code) {
      const i = Number(ordre) - 1;
      codes[i] = code;
      times[i] = t;
    }
  }
  return { codes: Array.from(codes, (c) => c ?? null), times: Array.from(times, (t) => t ?? null), finish, start };
}

/** A circuit's split times page (?Action=Splits&IdCourse=<n>&Circuit=<c>): { codes: the controls in order (the finish
 *  apart), rows: [{ name, code (FFCO club number), times: [seconds from the start | null…] }] } — every runner through,
 *  in one page: what the cards would give, without the start. */
export function splitPage(s) {
  const head = [...s.matchAll(/<th class="split"><div class="ordre">[^<]*<\/div><div class="code">([^<]*)<\/div>/g)].map((m) => m[1].trim());
  const codes = head.length && !/^\d+$/.test(head[head.length - 1]) ? head.slice(0, -1) : head;
  const rows = [];
  for (const tr of s.split(/<tr class="[^"]*"><td class="infos-coureur">/).slice(1)) {
    const name = /<div class="coureur">([^<]*)<\/div>/.exec(tr), code = /<div class="club">([^<]*)<\/div>/.exec(tr);
    if (!name) continue;
    const cells = tr.split('<td class="split">').slice(1, codes.length + 1);
    rows.push({ name: personName(unent(name[1])), code: unent(code?.[1] || "").trim(),
      times: codes.map((_, i) => { const t = secs(/<div class="cumul[^"]*">([^<]*)</.exec(cells[i] || "")?.[1]); return t > 0 ? t : null; }) });
  }
  return { codes, rows };
}

/** Is anyone out on this circuit's page (a race under way)? */
export const anyOut = (list) => list.some((r) => r.status === 9);
/** Has this runner finished (their card read, or given up)? */
export const final = (r) => r.status != null && r.status !== 9 && r.status !== 10 && !radioFinish(r.word);
/** A runner's key, as `update` knows them: name and club shown. */
export const keyOf = (r) => `${r.name}|${r.club || r.code}`;

/** A card's times on the circuit's controls (`codes`), in seconds: a punch counts on its own control only. */
export const align = (k, codes) => codes.map((c, i) => (k.codes[i] === c && k.times[i] > 0 ? k.times[i] : null));

/**
 * The circuits' rows -> the classes in the compact form « En direct » shows (liveresultat's: rows [place, name, club, result,
 * status, timeplus, progress, start, splits, provisional] in hundredths, splits [time, place, timeplus] per control), one
 * class per category; a category met on several circuits is one class per circuit (« OPEN (A1) »). `byCircuit`: { circuit:
 * rows() }; `ctrls`: { circuit: [codes] }; `known`: { keyOf: { start, times } } (seconds, times on the circuit's controls:
 * from the runner's card); `cats`: { category: [circuits] } (when only some circuits are read, the others' too).
 */
export function compact(byCircuit, ctrls, known, cats = {}) {
  cats = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, new Set(v)]));
  for (const [c, list] of Object.entries(byCircuit)) for (const r of list) (cats[r.cat || c] ||= new Set()).add(c);
  const classes = {}, order = [];
  for (const [circuit, list] of Object.entries(byCircuit)) {
    const codes = ctrls[circuit] || [];
    const seen = {}, keys = codes.map((c) => { seen[c] = (seen[c] || 0) + 1; return seen[c] > 1 ? `${c}.${seen[c]}` : c; });
    const by = new Map();
    for (const r of list) {
      const cat = r.cat || circuit;
      const cls = (cats[cat].size > 1 ? `${cat} (${circuit})` : cat).slice(0, 120);
      const k = known[keyOf(r)];
      const result = r.status === 0 && r.time != null ? r.time * 100 : null;
      const start = k?.start ?? r.start;
      const times = codes.map((_, i) => (final(r) && k?.times?.[i] > 0 ? k.times[i] * 100 : null));
      (by.get(cls) || by.set(cls, []).get(cls)).push({ r, status: r.status === 0 && result == null ? 9 : r.status, result,
        start: start != null ? start * 100 : null, times, prel: radioFinish(r.word) ? 1 : 0 });
    }
    for (const [cls, list2] of by) {
      // places and gaps: at each control among those who passed it, at the finish among the classified
      const per = codes.map((_, i) => list2.map((x) => x.times[i]).filter((t) => t != null).sort((a, b) => a - b));
      const fin = list2.filter((x) => x.status === 0).map((x) => x.result).sort((a, b) => a - b);
      const placeIn = (sorted, t) => sorted.indexOf(t) + 1;
      if (!classes[cls]) order.push(cls);
      classes[cls] = {
        controls: codes.map((code, i) => [keys[i], code]),
        rows: list2.map((x) => [x.status === 0 ? placeIn(fin, x.result) : null, x.r.name, x.r.club || x.r.code, x.result, x.status,
          x.status === 0 ? x.result - fin[0] : null, null, x.start,
          codes.length ? x.times.map((t, i) => (t == null ? null : [t, placeIn(per[i], t), t - per[i][0]])) : null, x.prel]),
      };
    }
  }
  return { order, classes };
}

// ---- relays (2026-10-25: the CNE at Le Bessat) ----
//   ?Action=ChoixCategories&IdCourse=<n>                 its categories, each a link ?Action=Result&IdCourse=<n>&IdCat=<k>
//   ?Action=Result&IdCourse=<n>&IdCat=<k>                 the category's teams, grouped by the leg they are on (« 2 / 7 »):
//                                                         the team's place, bib, name, time so far, state, its place after each
//                                                         leg (« 1 > - > - »); each leg's runner, their leg time (the running time
//                                                         of one out, at O'Live's last import), place, state, and the team's total
//                                                         at the handover

/** A relay's categories: [{ id, name }], in the page's order. */
export const relayCats = (s, id) => [...s.matchAll(new RegExp(`\\?Action=Result&amp;IdCourse=${id}&amp;IdCat=(\\d+)"[^>]*>([^<]*)<`, "g"))]
  .map((m) => ({ id: Number(m[1]), name: unent(m[2]).trim() }));

const num = (s) => (/^\d+$/.test(String(s || "").trim()) ? Number(String(s).trim()) : null);
const RX = new Map(), rx = (k, state) => RX.get(k) || RX.set(k, new RegExp(state ? `<span class="${k}">\\s*(?:<a [^>]*>)?([^<]*)<`
  : `<span class="${k}">([^<]*)<`)).get(k);
const span = (k, s) => unent(rx(k).exec(s)?.[1] || "").trim();
const stateWord = (k, s) => unent(rx(k, true).exec(s)?.[1] || "").trim();

/** A category's teams: [{ bib, name, place, total, word, status, places: [the team's place after each leg | null], legs: [{ leg,
 *  name, time, place, cumul, word, status }] }], times in seconds (`cumul`: the team's total at the end of that leg). */
export function relay(s) {
  const teams = [];
  for (const part of s.split('<div class="EnteteEquipe').slice(1)) {
    const bib = span("Dossard", part), word = stateWord("StatusEquipe", part);
    const pl = /<span class="PlacesEquipe">([\s\S]*?)<span class="EcartEquipe">/.exec(part)?.[1] || "";
    const legs = [], pieces = part.split('<p class="Detail_1">');
    for (let i = 1; i < pieces.length; i++) {
      const p = pieces[i], w = stateWord("StatusRelayeur", p);
      // (the leg's card, whose punches its line opens on O'Live, is in the heading just before it: the piece before)
      const card = [...pieces[i - 1].matchAll(/data-numpuce="(\d+)"/g)].pop()?.[1] || null;
      legs.push({ leg: num(span("NumRelayeur", p)) ?? legs.length + 1, name: personName(span("NomRelayeur", p)), time: secs(span("TempsRelayeur", p)),
        place: num(span("PlaceRelayeur", p)), cumul: secs(span("TempsCumulRelayeur", p)), word: w, status: statusOf(w), card });
    }
    // in the order of their leg numbers: O'Live's page does not always list them so (2026-10-25, the CNE: « Cobs Dames »
    // 1, 2, 4, 5, 3; « O'Jura Matrus 2 » 2, 3, 1), and the legs are counted by their place here
    legs.sort((a, b) => a.leg - b.leg);
    teams.push({ bib, name: span("NomEquipe", part).replace(/^(\d+)\s+/, (m, b) => (b === bib ? "" : m)), place: num(span("PlaceEquipe", part)),
      total: secs(span("TempsEquipe", part)), word, status: statusOf(word), places: [...pl.matchAll(/<span class="Places">([^<]*)</g)].map((m) => num(m[1])), legs });
  }
  return teams;
}
/** Is anyone of these teams out, or still to start? */
export const relayOut = (teams) => teams.some((t) => t.status === 9 || t.legs.some((l) => l.status === 9));
export const relayWait = (teams) => teams.some((t) => t.status === 10 || t.legs.some((l) => l.status === 10));

/**
 * The relay's categories -> the compact form (see `compact`), one class per category: a row per leg's runner — [leg place,
 * name, team, leg time, status, gap to the leg's best, null, the leg's start, null, provisional, [team bib, leg, team's total
 * at the handover, team's place there, its gap to the first team there]] — and `relay`: { legs, teams: [[bib, name, place,
 * total, status, gap, legs done]] }, in hundredths. `cats`: { category: { teams: relay(), at: the page's time (ms) } };
 * `t0`: { "category|bib": the team's start (seconds after midnight) } — what was seen, kept by the caller and filled here.
 * Also `cards`: { category: { "name|team": card number } }, for the caller alone (a card number is never sent to the pages).
 *
 * A leg's start: a runner out, the page's time less their running time (an estimate: O'Live counts it at its last import); a
 * leg through, its team's start plus the team's total before it (the team's start being the earliest seen that way: a stale
 * running time makes it later, a mass start of the last legs too), else the category's usual team start.
 */
export function compactRelay(cats, t0 = {}) {
  const classes = {}, order = [], cards = {};
  for (const [cat, { teams, at }] of Object.entries(cats)) {
    const now = parisSeconds(at), day = (x) => ((x % 86400) + 86400) % 86400;
    const before = (t, i) => (i === 0 ? 0 : t.legs[i - 1]?.cumul ?? null);
    for (const t of teams) {
      t.legs.forEach((l, i) => {
        l.seen = l.status === 9 && l.time != null ? day(now - l.time) : null;
        const b = before(t, i), k = `${cat}|${t.bib}`;
        if (l.seen != null && b != null) {
          const s = day(l.seen - b);
          // (the earliest, within half a day: a start just before midnight stays one)
          if (t0[k] == null || ((t0[k] - s + 86400) % 86400 < 43200 && (t0[k] - s + 86400) % 86400 > 0)) t0[k] = s;
        }
      });
    }
    const all = teams.map((t) => t0[`${cat}|${t.bib}`]).filter((x) => x != null).sort((a, b) => a - b);
    const usual = all.length ? all[Math.floor((all.length - 1) / 2)] : null;
    const legs = Math.max(0, ...teams.map((t) => t.legs.length));
    const best = [], lead = [];
    for (let i = 0; i < legs; i++) {
      const ok = teams.map((t) => t.legs[i]).filter((l) => l?.status === 0 && l.time != null).map((l) => l.time).sort((a, b) => a - b);
      best[i] = ok;
      // the first team there as O'Live ranks it (a team sent off by a mass start carries a lower total of its own: the
      // smallest total made the CNE's leader 2:29:29 behind), else the smallest total
      const c = teams.filter((t) => t.places[i] != null && t.legs[i]?.cumul != null).map((t) => t.legs[i].cumul);
      lead[i] = teams.find((t) => t.places[i] === 1 && t.legs[i]?.cumul != null)?.legs[i].cumul ?? (c.length ? Math.min(...c) : null);
    }
    const lastOk = teams.filter((t) => t.status === 0 && t.total != null).map((t) => t.total);
    const winner = lastOk.length ? Math.min(...lastOk) : null;
    const rows = [], list = [], own = (cards[cat] = {});
    for (const t of teams) {
      const s0 = t0[`${cat}|${t.bib}`] ?? usual;
      let done = 0;
      t.legs.forEach((l, i) => {
        if (l.cumul != null) done = i + 1;
        if (!l.name) return;
        if (l.card) own[`${l.name}|${t.name}`] = l.card;
        const b = before(t, i);
        // (the team's start + its total before, steady from one read to the next; a runner out seen to have started over 2
        // minutes apart from it — a mass start of the last legs — by what is seen)
        const chain = s0 != null && b != null && l.status !== 10 ? day(s0 + b) : null;
        const start = chain != null && (l.seen == null || Math.abs(l.seen - chain) <= 120) ? chain : l.seen ?? chain;
        const result = l.status === 0 && l.time != null ? l.time * 100 : null;
        const status = l.status === 0 && result == null ? 9 : l.status;
        const place = result != null ? best[i].indexOf(l.time) + 1 : null;
        rows.push([place, l.name, t.name, result, status, result != null ? result - best[i][0] * 100 : null, null,
          start != null ? start * 100 : null, null, radioFinish(l.word) ? 1 : 0,
          [t.bib, i + 1, l.cumul != null ? l.cumul * 100 : null, t.places[i] ?? null,
            l.cumul != null && t.places[i] != null && lead[i] != null && l.cumul >= lead[i] ? (l.cumul - lead[i]) * 100 : null]]);
      });
      const status = t.status === 0 && done < legs ? 9 : t.status;
      list.push([t.bib, t.name, status === 0 ? t.place : null, t.total != null ? t.total * 100 : null, status,
        status === 0 && t.total != null && winner != null ? (t.total - winner) * 100 : null, done]);
    }
    order.push(cat);
    classes[cat] = { controls: [], rows, relay: { legs, teams: list } };
  }
  return { order, classes, cards };
}

/** A card's punches as O'Live shows them under a relay runner (bloc.php PointagesPuce): [[control code (« Arr. » the
 *  finish), leg time, time from the runner's start, time of day « hh:mm:ss », place there, gap to the first there]],
 *  times in seconds — radio controls while the runner is out, every control once the card is read. */
export function punchList(s) {
  const out = [];
  for (const p of s.matchAll(/<p class="poincons">([\s\S]*?)<\/p>/g)) {
    const code = span("code", p[1]);
    if (!code || /^poste$/i.test(code)) continue;                      // (the heading)
    const tm = /<span class="temps"(?: title="([^"]*)")?>([^<]*)</.exec(p[1]);
    const gap = /^\+?\s*(?:(\d+)h)?\s*(\d+)'\s*(\d+)/.exec(span("retard", p[1]));
    out.push([code, secs(span("interposte", p[1])), secs(tm?.[2]), /^\d{1,2}:\d{2}:\d{2}$/.test(tm?.[1] || "") ? tm[1] : null,
      num(span("place", p[1])), gap ? Number(gap[1] || 0) * 3600 + Number(gap[2]) * 60 + Number(gap[3]) : null]);
  }
  return out;
}

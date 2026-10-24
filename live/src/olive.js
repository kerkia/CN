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
/** Only the individual races are read (a relay's pages show teams). */
export const individual = (r) => !/relais/i.test(r.type || "");

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

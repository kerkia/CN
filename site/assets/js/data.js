// Data layer: fetches the static JSON, caches it, and answers the questions
// the pages ask ("who is ranked, with what CN, at this month-end?").

const BASE = "data/";
const cache = new Map();

async function getJson(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(BASE + path, { credentials: "same-origin" }).then((r) => {
    if (!r.ok) {
      if (r.status === 404) return null;
      // the session expired or was never valid on the server: back to the login page
      if (r.status === 401) window.dispatchEvent(new Event("cnx:unauthorised"));
      throw new Error(`${path}: HTTP ${r.status}`);
    }
    return r.json();
  });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}

// ---- race-row layout (see build_site.py) ---------------------------------
export const R = {
  cid: 0, course: 1, circuit: 2, dist: 3, date: 4, terrain: 5, epreuve: 6, groupe: 7,
  cat: 8, club: 9, place: 10, nOnCircuit: 11, time: 12, status: 13,
  offScore: 14, offCnj15: 15, offCnAfter: 16,
  v26Score: 17, v26Cnj15: 18, v26CnAfter: 19, v26Counts: 20,
  t6Raw: 21, t6Score: 22, t6Cnj15: 23, t6CnAfter: 24, t6Counts: 25, t6Weight: 26,
};
export const SCORE_COL = { official: R.offScore, v2026: R.v26Score, top6w: R.t6Score };
export const CNAFTER_COL = { official: R.offCnAfter, v2026: R.v26CnAfter, top6w: R.t6CnAfter };
export const CNJ15_COL = { official: R.offCnj15, v2026: R.v26Cnj15, top6w: R.t6Cnj15 };
// competition result row
export const C = {
  lic: 0, place: 1, time: 2, status: 3, cat: 4, club: 5,
  offScore: 6, offCnj15: 7, v26Score: 8, v26Cnj15: 9, t6Score: 10, t6Cnj15: 11,
};

// ---- core datasets ---------------------------------------------------------
let META, RUNNERS, COMPS;

/** What the login page needs: the public statistics. */
export async function bootPublic() {
  META = await getJson("meta.json");
  return META;
}
export const isPrivateLoaded = () => !!RUNNERS;

/** Everything else — only readable once logged in. */
export async function bootPrivate() {
  if (RUNNERS) return;
  const [runners, comps] = await Promise.all([getJson("runners.json"), getJson("competitions.json")]);
  const cols = runners.cols;
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const byLic = new Map();
  const list = runners.rows.map((r) => {
    const o = {
      lic: String(r[ix.licence]), nom: r[ix.nom], sexe: r[ix.sexe], first: r[ix.first],
      last: r[ix.last], n: r[ix.n], nFor: r[ix.nFor], nSpr: r[ix.nSpr],
      cat: r[ix.cat], club: r[ix.club],
    };
    byLic.set(o.lic, o);
    return o;
  });
  RUNNERS = { list, byLic };
  COMPS = new Map(Object.entries(comps.rows).map(([id, r]) => [String(id), {
    id: String(id), date: r[0], title: r[1], location: r[2], organizer: r[3],
    groupe: r[4], epreuve: r[5], terrain: r[6], season: r[7], n: r[8] || 0, nCircuits: r[9] || 0,
  }]));
}

/** After logging out: forget what was loaded. */
export function dropPrivate() {
  RUNNERS = null;
  COMPS = null;
  for (const k of [...cache.keys()]) if (k !== "meta.json") cache.delete(k);
}
export const meta = () => META;
export const runners = () => RUNNERS;
export const runner = (lic) => RUNNERS.byLic.get(String(lic));
export const comp = (id) => COMPS.get(String(id));
export const comps = () => COMPS;

// ---- names -----------------------------------------------------------------
export function clubParts(club) {
  const m = /^(\d{4})([A-Z]*)$/.exec(club || "");
  return m ? { code: m[1], dept: m[1].slice(0, 2), ligue: m[2] || null } : { code: null, dept: null, ligue: null };
}
export function clubName(club) {
  const { code } = clubParts(club);
  return (code && META.names.clubs[code]) || club || "";
}
export const ligueName = (code) => META.names.ligues[code] || code || "";
export const deptName = (code) => META.names.depts[code] || code || "";

// ---- months & snapshots ----------------------------------------------------
export const months = () => META.months;               // month-end ISO dates
export const latestMonth = () => META.months[META.months.length - 1];
export const ym = (iso) => iso.slice(0, 7);
export function monthFor(ymStr) {
  return META.months.find((m) => m.startsWith(ymStr)) || latestMonth();
}

/** The official ranking was a single pedestrian ranking before 2026. */
export function snapTerrain(method, terrain, year) {
  return method === "official" && year < META.split_year ? "Ped" : terrain;
}

/** Map(licence -> CN) for one method/discipline at one month-end. */
export async function cnAt(method, terrain, monthIso) {
  const year = Number(monthIso.slice(0, 4));
  const t = snapTerrain(method, terrain, year);
  const snap = await getJson(`snap/${method}_${t}_${year}.json`);
  const out = new Map();
  if (!snap) return out;
  const i = snap.months.findIndex((m) => m === monthIso);
  if (i < 0) return out;
  for (const row of snap.rows) {
    const v = row[1 + i];
    if (v) out.set(String(row[0]), v);
  }
  return out;
}
/** Map(licence -> [category, club]) as at the end of `year`. */
export async function attrsAt(year) {
  const a = await getJson(`snap/attr_${year}.json`);
  return new Map(Object.entries(a || {}));
}
/** Month-end a year before, if it exists in the archive. */
export function monthYearBefore(monthIso) {
  const y = Number(monthIso.slice(0, 4)) - 1;
  return META.months.find((m) => m.startsWith(`${y}-${monthIso.slice(5, 7)}`)) || null;
}

// ---- per-entity files ------------------------------------------------------
export async function runnerRaces(lic) {
  const n = String(lic);
  const bucket = /^\d+$/.test(n) ? Math.floor(Number(n) / 10) : 999999;
  const b = await getJson(`r/${bucket}.json`);
  return (b && b[n]) || [];
}
export const course = (id) => getJson(`c/${id}.json`);
/** Competitions (course ids) a club took part in. */
export const clubCourses = async (code) => (await getJson(`club_courses/${code}.json`)) || [];
export const clubSeries = (code) => getJson(`club/${code}.json`);
// club monthly aggregate layout (see site_extras.py)
export const CLUB = { n: 0, median: 1, max: 2, sum: 3, top5: 4 };

/** Co-runners: [[licence, shared circuits, finished ahead, finished behind, last met]]. */
export async function coRunners(lic) {
  const n = String(lic);
  const bucket = /^\d+$/.test(n) ? Math.floor(Number(n) / 10) : 999999;
  const b = await getJson(`net/${bucket}.json`);
  return (b && b[n]) || [];
}
export const ageCurves = () => getJson("agecurve.json");
export const eliteSummary = () => getJson("elite_summary.json");
// elite row layout: [course, licence, category, rank in category, points, club code]
export const E = { course: 0, lic: 1, cat: 2, rank: 3, pts: 4, club: 5 };
export const eliteSeason = async (y) => (await getJson(`elite/${y}.json`))?.rows || [];

/**
 * National-race points in the 365 days up to `iso` for one discipline:
 * { rows, elite: Map(club -> pts), all: Map(club -> pts) }. "elite" keeps H21/D21 only.
 */
export async function eliteWindow(iso, terrain) {
  const y = Number(iso.slice(0, 4));
  const from = new Date(iso + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - 365);
  const fromIso = from.toISOString().slice(0, 10);
  const [a, b, sum] = await Promise.all([eliteSeason(y - 1), eliteSeason(y), eliteSummary()]);
  const cats = new Set(sum?.cats || ["H21", "D21"]);
  const rows = [...a, ...b].filter((r) => {
    const c = comp(r[E.course]);
    return c && c.terrain === terrain && c.date > fromIso && c.date <= iso;
  });
  const elite = new Map(), all = new Map();
  for (const r of rows) {
    const k = r[E.club];
    if (!k) continue;
    all.set(k, (all.get(k) || 0) + r[E.pts]);
    if (cats.has(r[E.cat])) elite.set(k, (elite.get(k) || 0) + r[E.pts]);
  }
  return { rows, elite, all, cats };
}

export const officialCircuitUrl = (cid) => `https://cn.ffcorientation.fr/circuit/${cid}/`;
export const officialCourseUrl = (id) => `https://cn.ffcorientation.fr/course/${id}/`;

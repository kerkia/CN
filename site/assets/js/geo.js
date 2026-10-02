// Where competitions happen. A competition is placed by its organiser alone: a club
// ("6803 - …": the first two digits of the club number), a département committee
// ("63 - Puy-de-Dôme") or a ligue ("IF - …", which gives the region only). Each
// département belongs to one region; ligues are shown as today's regions, the
// pre-2016 ligues folding into the one that succeeded them.

// today's ligue of each département (the 2016 regions, plus the overseas ligues)
const REGION_DEPTS = {
  AR: "01 03 07 15 26 38 42 43 63 69 73 74",
  BF: "21 25 39 58 70 71 89 90",
  BR: "22 29 35 56",
  CE: "18 28 36 37 41 45",
  CO: "20",
  GE: "08 10 51 52 54 55 57 67 68 88",
  HF: "02 59 60 62 80",
  IF: "75 77 78 91 92 93 94 95",
  NM: "14 27 50 61 76",
  NA: "16 17 19 23 24 33 40 47 64 79 86 87",
  OC: "09 11 12 30 31 32 34 46 48 65 66 81 82",
  PL: "44 49 53 72 85",
  PZ: "04 05 06 13 83 84",
  OM: "96 97",
  NC: "98",
};
export const DEPT_REGION = Object.fromEntries(
  Object.entries(REGION_DEPTS).flatMap(([r, ds]) => ds.split(" ").map((d) => [d, r])));
export const REGIONS = Object.keys(REGION_DEPTS);

// the ligues before the 2016 merger, and the region that took them over
const SUCCESSOR = {
  AL: "GE", CA: "GE", LO: "GE", AQ: "NA", LI: "NA", PC: "NA", AU: "AR", RA: "AR",
  BO: "BF", FC: "BF", LR: "OC", MP: "OC", NO: "HF", PI: "HF", PR: "PZ", AZ: "PZ",
};
export const regionOf = (ligue) => SUCCESSOR[ligue] || ligue;

/** { dept, region } of a competition from its organiser; either may be null. */
export function placeOf(organizer) {
  const o = organizer || "";
  let m = /^(\d{2})\d{2} - /.exec(o) || /^(\d{2}) - /.exec(o);
  if (m) return { dept: m[1], region: DEPT_REGION[m[1]] || null };
  m = /^([A-Z]{2}) - /.exec(o);
  if (m && REGION_DEPTS[regionOf(m[1])]) return { dept: null, region: regionOf(m[1]) };
  return { dept: null, region: null };
}

// ---- boundaries ----------------------------------------------------------------
// assets/geo/{departements,regions}.json: simplified GeoJSON whose features carry
// `code` — the département number (2A/2B for Corsica), or our ligue code.
const loaded = new Map();
/** Registers the map with ECharts once; resolves to its name, or null if unavailable. */
export function loadMap(kind) {
  if (!loaded.has(kind)) {
    loaded.set(kind, fetch(`assets/geo/${kind}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((gj) => {
        if (!gj) return null;
        window.echarts.registerMap(`fr-${kind}`, gj);
        return `fr-${kind}`;
      })
      .catch(() => null));
  }
  return loaded.get(kind);
}
/** The map feature(s) standing for a département or ligue code. */
export const featuresOf = (code) => (code === "20" ? ["2A", "2B"] : [code]);

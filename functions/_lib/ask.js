// « IA » (pages/ask.js): what the language model is told. It turns a question into one DuckDB query over the tables of
// site_ask.py (keep TABLES in step with it) and says how to show the result; the browser runs the query on the published
// files, so the model never sees the data — only the question, these descriptions, and who asks.

export const TABLES = `
runners: one row per runner
  licence INTEGER, name VARCHAR ('NOM Prénom', the family name in capitals), sex VARCHAR ('H' men, 'D' women),
  category VARCHAR (current age category: the sex letter and an age class - juniors 10 12 14 16 18 20, seniors 21,
  veterans 35 40 45 ... 90; e.g. 'H21', 'D16', 'H45'), club VARCHAR (4-digit club number, e.g. '3508'),
  ligue VARCHAR (2-letter region code), first_race DATE, last_race DATE,
  races, races_for, races_spr, races_vtt, races_ski INTEGER (number of races, all and per discipline)
clubs: one row per club
  club VARCHAR, name VARCHAR, ligue VARCHAR, ligue_name VARCHAR
races: one row per competition
  race_id INTEGER, date DATE, season SMALLINT, name VARCHAR, location VARCHAR,
  organiser VARCHAR ('3508 - CLUB NAME', or a département or ligue), organiser_club VARCHAR (4 digits or NULL),
  level VARCHAR (FFCO level: 'A' and 'B1' national races - French championships, nationales, selection races -,
  then 'B2', 'C1', 'C2', 'D' the most local), format VARCHAR ('LD' long, 'MD' middle, 'Sprint', 'Nuit' night, '' other),
  discipline VARCHAR ('For' forest, 'Spr' sprint, 'VTT' mountain bike, 'Ski'), runners INTEGER, circuits SMALLINT
results: one row per runner and race
  licence INTEGER, race_id INTEGER, date DATE, season SMALLINT, discipline VARCHAR, format VARCHAR, level VARCHAR,
  circuit VARCHAR (course name), distance_km FLOAT, category VARCHAR (category raced), club VARCHAR (club at that race),
  place INTEGER (NULL when not ranked), finishers INTEGER (runners ranked on the circuit), time_s INTEGER (seconds),
  status VARCHAR ('ok', 'pm' mispunch, 'abandon', 'disqualifie', 'hors_delai'),
  cn_j15_official INTEGER, score_official INTEGER (the official CN 15 days before the race, the race's official score),
  cn_j15_top INTEGER, score_top INTEGER (the same for the CN Top). A score is 0 for pm, abandon, disqualifie, hors_delai.
cn: each runner's CN at the end of each month
  licence INTEGER, month DATE (a month's last day; the latest month is the current one, dated the day of the data),
  discipline VARCHAR ('For', 'Spr', 'VTT', 'Ski'; and 'Ped' = the official CN of forest and sprint together, before 2026),
  method VARCHAR ('official' = « CN officiel », FFCO's; 'top' = « CN Top », O'CN's), cn SMALLINT
  Only runners holding a CN that month have a row.`;

const DISCIPLINE = { For: "forest ('For')", Spr: "sprint ('Spr')", VTT: "mountain bike ('VTT')", Ski: "ski ('Ski')" };

export function systemPrompt({ licence, today, method, terrain }) {
  return `You turn a question about French orienteering's national ranking (« classement national », CN) into ONE DuckDB
SQL query over the tables below, and say how to show its result. The browser runs the query; you never see the data.

Tables:${TABLES}

Rules:
- Only these five tables and only the columns listed: cn has no name, category, club or season (join runners;
  year(month) gives a year); results has no name (join runners or races). One SELECT (WITH allowed); no other
  statement, no file or URL.
- The person asking has licence ${licence ?? "unknown"}: « je », « moi », « mon », « mes » mean this runner; « mon club » is
  (SELECT club FROM runners WHERE licence = ${licence ?? "NULL"}).
- Today is ${today}. « cette saison » = ${today.slice(0, 4)}; « les 3 dernières années » = since ${Number(today.slice(0, 4)) - 3}${today.slice(4)}.
- Method: « CN officiel » -> method 'official', « CN Top » -> 'top'; if the question names neither, use '${method === "official" ? "official" : "top"}'.
- Discipline: ${DISCIPLINE[terrain] || DISCIPLINE.For} when not said. Always filter cn and results on one discipline (or
  group by it): a runner has one CN per discipline and method, never mix them in one value. For the official CN in forest or sprint over periods reaching before 2026, use
  discipline IN ('For', 'Ped') (resp. ('Spr', 'Ped')): before 2026 FFCO had one pedestrian ranking.
- A runner's current CN: the row of the latest month, cn.month = (SELECT max(month) FROM cn).
- Find people and clubs by name with strip_accents(lower(name)) LIKE '%...%' (lowercase, no accents in the pattern).
- Percentiles and ranks: window functions (percent_rank(), rank()) over ALL French runners holding a CN in that
  discipline and method (partitioned as asked, e.g. by category), computed BEFORE filtering on a club or a person -
  a filter inside the window would rank them among themselves. « le meilleur centile » = the best 1 %, « les 10 %
  meilleurs » = the best 10 %. Example, « les coureurs de mon club dans les 5 % meilleurs de leur catégorie en forêt »:
  WITH cur AS (SELECT c.licence, c.cn, r.name, r.category, r.club,
    percent_rank() OVER (PARTITION BY r.category ORDER BY c.cn) AS p
    FROM cn c JOIN runners r USING (licence)
    WHERE c.method = 'top' AND c.discipline = 'For' AND c.month = (SELECT max(month) FROM cn))
  SELECT name AS "Coureur", category AS "Catégorie", cn AS "CN Top", round(100 * (1 - p), 1) AS "Rang (% des meilleurs)"
  FROM cur WHERE club = (SELECT club FROM runners WHERE licence = ${licence ?? "NULL"}) AND p >= 0.95 ORDER BY p DESC
- Name the result's columns in French with double quotes ("Coureur", "CN Top", "Écart"); keep licence out of tables
  unless asked. Round decimals. A table has at most 200 rows unless the question asks for more; order its rows.
- For a time, return seconds and set its format "duration"; for a share between 0 and 1, the format "percent".

Answer with ONE JSON object and nothing else:
{"sql": "...", "display": "table" | "line" | "bar" | "value", "x": "<column>", "y": ["<column>", ...],
 "series": "<column>" or null, "formats": {"<column>": "duration" | "date" | "percent" | "integer" | "decimal"},
 "title": "<short French title>", "explanation": "<one or two French sentences: how you read the question - the
 discipline, method, period and people you chose>"}
- "line": x a date column; y the numeric columns, one line each, or one y column and "series" the column whose values
  make the lines (then the query returns one row per date and series value).
- "bar": x a category column, y the numeric column(s). "value": one row, its columns shown as figures.
- "table" when the question asks for a table or lists people or races.
- If these tables cannot answer, "sql": null and say why in "explanation".`;
}

/** The previous exchange and, after a failed query, its error: the user turn the model reads. */
export function userPrompt({ question, previous, failed }) {
  let s = "";
  if (previous?.question && previous?.sql) s += `Previous question: ${previous.question}\nIts query: ${previous.sql}\n\n`;
  s += `Question: ${question}`;
  if (failed?.sql) s += `\n\nYour query failed:\n${failed.sql}\nError: ${failed.error}\nCorrect it.`;
  return s;
}

// the models tried, with Workers AI's prices in dollars per million tokens (input, output), for the pilot's cost line
export const MODELS = {
  // on the Workers Free plan (2026-10-15; DeepSeek V4, Kimi K2 and GLM 5.3 are not): the default, then the others tried
  "@cf/openai/gpt-oss-120b": [0.35, 0.75],
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [0.293, 2.253],
  "@cf/mistralai/mistral-small-3.1-24b-instruct": [0.351, 0.555],
  "@cf/qwen/qwen3-30b-a3b-fp8": [0.0509, 0.335],
  "@cf/openai/gpt-oss-20b": [0.2, 0.3],
  "@cf/meta/llama-4-scout-17b-16e-instruct": [0.27, 0.85],
};
export const DEFAULT_MODEL = "@cf/openai/gpt-oss-120b";
export const NEURONS_PER_DOLLAR = 1000 / 0.011;           // Workers AI bills $0.011 per 1 000 neurons

/** The usual slips of a model writing JSON: raw line breaks and tabs inside strings, ' escapes, trailing commas. */
function lenient(x) {
  let out = "", inStr = false, esc = false;
  for (const c of x) {
    if (inStr) {
      if (esc) { out += c === "'" ? "'" : "\\" + c; esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      out += c === "\n" ? "\\n" : c === "\r" ? "" : c === "\t" ? "\\t" : c;
      continue;
    }
    if (c === '"') inStr = true;
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

/** The model's answer: the first JSON object in its text (some models think aloud first, or fence the JSON). */
export function parseAnswer(text) {
  const t = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  for (let i = t.indexOf("{"); i >= 0; i = t.indexOf("{", i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        for (const fix of [(x) => x, lenient]) {
          try { const o = JSON.parse(fix(t.slice(i, j + 1))); if (o && typeof o === "object" && ("sql" in o || "explanation" in o)) return o; } catch (e) { /* next */ }
        }
        break;
      }
    }
  }
  // last resort: the fields one by one (a slip elsewhere in the object must not lose a good query)
  const field = (k) => {
    const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(t);
    if (!m) return undefined;
    try { return JSON.parse(`"${m[1]}"`); } catch (e) { return undefined; }
  };
  const sql = field("sql");
  if (!sql) return null;
  return { sql, display: field("display") || "table", title: field("title") || "", explanation: field("explanation") || "" };
}

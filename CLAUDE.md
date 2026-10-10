# O'CN — Observatoire du classement national de CO

Independent, unofficial site (https://ocn.kerkia.com) that scrapes the French orienteering federation's
national ranking (FFCO, cn.ffcorientation.fr), recomputes it with alternative methods, and shows rankings,
runner histories, clubs, comparisons, an agenda of upcoming events and per-race details. The site's UI is
**in French**; code, comments and commit messages are in English.

## Layout

| Path | What |
|---|---|
| `ffco_scraper/` | Scraper (`fetcher`, `crawler`, `parser`, `store`, `updater`), agenda scraper (`agenda.py`), and the CN engine (`cn.py` = formulas, `cn_engine.py` = methods and computation, `cn_schema.sql`) |
| `update.py` | The one entry point for updates: fetch → recompute → rebuild site data → deploy → mail digests. Also holds the one-off **migrations** |
| `build_site.py`, `site_extras.py`, `site_io.py` | Turn the database into the static JSON under `site/data/` (runner buckets `r/`, races `c/`, month-end snapshots `snap/`, clubs, network, `meta.json`) |
| `ffco_scraper/prov/` | Provisional results (« Récemment »): organisers' results, often before FFCO publishes — races (`races.py`), sources (`sources/`: liveresultat, WinSplits, Helga, Orientation Data, the club's site), parsers (`parsers/`: OE/MeOS HTML, IOF XML, PDF), matching to licences (`match.py`), provisional scores (`compute.py`), run + output (`run.py`) |
| `notify.py` | E-mail digests (new results, new competitions in subscribed regions) through `/api/notify` |
| `site/` | Static single-page app (vanilla JS modules, no build step). `assets/js/pages/*.js` one module per page, `i18n.js` all French text, `cn.js` the CN computation mirrored in the browser, `data.js` data access and the column index maps `R` (runner race rows) and `C` (race result rows) |
| `functions/` | Cloudflare Pages Functions: `_middleware.js` (login gate, deny by default), `api/account/*` (accounts on D1), `api/admin/*`, `api/notify.js`, `api/ffco-history.js` and `api/ffco-cn.js` (proxies to FFCO pages, logged-in users only, cached and rate-limited) |
| `migrations/` | D1 schema migrations |
| `ci/state.py` | Packs/unpacks the database and site state to/from Cloudflare R2 between CI runs |
| `.github/workflows/update.yml` | Hourly quick run, 03:00 Paris full run, 06:00 Paris agenda run, Sat/Sun evening provisional-results runs (every 20 min), deploy on push |
| `run_cn.py`, `query_cn.py`, `merge_methods.py` | Developer tools (recompute one method, inspect a runner, merge DBs) |
| `ocap/` | **O'Cap** (working name, 2026-10-09): a separate public, phone-first site — Bientôt, En direct (liveresultat relayed by one Durable Object per race, WebSockets), Récemment; no login, no CN, FR/EN. Its own Cloudflare projects: Pages `ocap` (https://ocap.pages.dev; its data exported from `site/data` by `ocap/export.py` and published by `update.deploy` after each O'CN deploy) and Worker `ocap-live` (Durable Objects, deployed by hand: `cd ocap/worker && npx wrangler deploy`); see `ocap/README.md` |

The project lives in `C:\kerkia\CO` on the PC (moved out of OneDrive on 2026-10-08: syncing rewrote files mid-edit).
Not in git (see `.gitignore`): the database and HTTP cache (`C:\kerkia\cn-data` on the PC, `paths.py`, env `CN_DATA_DIR`),
`site/data/` and `site/auth/` (generated), `.dev.vars` (local secrets), exports. **The repository is public:** never
commit results, personal data, secrets or credentials.

## Hosting and deployment

- **Cloudflare Pages** project `observatoire-cn` (static `site/` + `functions/`), custom domain `ocn.kerkia.com`
  (CNAME at GoDaddy). **D1** database `ocn` (accounts, sessions, mail queue). **R2** bucket `cn-state` (the
  SQLite database and site data between CI runs). Free plans only: ~10 ms CPU per request (hence the light,
  peppered PBKDF2), 20 000 files per deployment (site/data is ~13k files), Resend 100 mails/day.
- Pages secrets (set by the owner with `wrangler pages secret put`): `SESSION_SECRET`, `RESEND_API_KEY`,
  `NOTIFY_SECRET`. GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `NOTIFY_SECRET`. Never ask for or print their values.
- **Deploy by pushing to `main`.** The workflow restores the state from R2, runs `update.py`, publishes, and
  saves the state back. Do **not** `wrangler pages deploy` from the PC: it would publish the PC's possibly
  stale `site/data`, and anything not pushed is overwritten by the next run.
- `site/_routes.json` keeps the public files (`/`, `/assets/*`, `robots.txt`, `meta.json`…) out of the Functions:
  served free and unmetered, without the login gate (which only passed them through); the data and the API stay
  behind it. The Workers free quota (100 000 requests/day) is **per account**, shared by O'CN, O'Cap and `ocap-live`.
- A push only triggers a run when it touches `site/**` or `functions/**`. A Python-only change is picked up by
  the next hourly run (it checks out `main`), or trigger it with `workflow_dispatch`.
- `gh` is not installed on the PC; read run status with the public API, e.g.
  `curl -s "https://api.github.com/repos/kerkia/CN/actions/runs?per_page=5"` and `/runs/<id>/jobs`.
  Data on the live site needs a login, but `/data/meta.json` and the JS assets are public: use them to check
  a deploy (e.g. `meta.json` → `methods`, `normalisation`).

## Local development

- Dev server: `npx wrangler pages dev --port 8788` (local D1 under `.wrangler/`). `.dev.vars` holds local
  values (`DEV_ECHO=1` echoes mails instead of sending, `REGISTRATION_OPEN=1`, `SITE_URL=http://localhost:8788`,
  local `SESSION_SECRET`/`NOTIFY_SECRET`). Create a local test account through the register flow.
- Site data for the dev server comes from `site/data/`, built locally: `python -c "import build_site;
  build_site.main(['--out','site/data','--db', <db>])"`. Test engine changes on a **copy** of
  `C:\kerkia\cn-data\ffco_results.sqlite3`, never on the original.
- To stop the dev server on Windows, kill `workerd` and the `node` processes running wrangler.
- After a JS change, check the page in a browser (console errors!) before pushing; the browser may cache
  modules — hard-reload.

## The CN methods

All methods share the race score: circuit value = mean of (CN J-15 × time) over the fastest ⌈2N/3⌉ ranked
runners holding a CN; score = circuit value ÷ time; PM / abandon / disqualified / over time score 0 and count.
12-month window. Four specialités, each ranked separately: forest (`For`: LD/MD/Nuit), sprint (`Spr`), VTT
(`VTT`, all formats together) and ski (`Ski`, all formats together) — FFCO's own split (`specialite=` on its
CN pages). In the DB `competitions.terrain` is "Forêt", "Sprint", "VTT" or "Ski"; the site uses the codes.
VTT (~30 competitions a season) and ski (2-4, on one or two weekends) have their own Juste/Top params
(`CnParams.by_terrain`, `for_terrain`; `meta.methods.*.params.by_terrain`, `cn.paramsFor` in the browser):
window 2 years (VTT) / 3 years (ski), best 70 % — with 12 months, too few riders held a CN to value the
circuits (VTT: half the circuits, 5 of 83 in 2021; ski: nothing after 2013). The official window stays 365 days.

1. **`official`** — FFCO's published values, copied verbatim (before 2026 FFCO had one pooled pedestrian
   ranking for forest and sprint, filed under "Ped": `build_site.official_terrain`, `data.snapTerrain`,
   `data.inSeries`; VTT and ski always had their own). The runner page's official calculation card reads FFCO's own
   CN page live (`/api/ffco-cn`): FFCO re-evaluates past-season races under **new circuit ids** that only that
   page links, so its points can differ from the race's results page.
2. **`fair`, « Méthode CN « Juste »** — estimates each runner's **strength** (usual level); it also values the
   circuits. CN = weighted mean of the best 60 % of the window's scores (`top6_weighted` with an unlimited
   number of places). Weights by competition **name** (`cn.title_weight`): "Championnat de France" 2,
   "O'France" or "Nationale" 1.5, anything else 1 (Sélection races and Championnats de Ligue included, FFCO's
   A/B/C/D level not used). ≥ 3 races for a CN, a circuit needs ≥ 4 ranked CN holders.
3. **`top6w`, « Méthode CN « Top »** — ranks runners by **potential at their best** (suited to qualifications).
   **Derived from `fair`** (`CnEngine.derive`): same race scores, circuit values and recalage factors; only the
   CN differs — the best 60 % scores fill **6 weight places** from the best down, the last race only for the
   places left. Racing more can only raise it (monotonic).
4. **`fair2` and `top6w2`, the quadratic variants** (2026-10-07) — the same two methods with the CN as the
   **weighted quadratic mean** of the kept scores (`CnParams.cn_power` = 2; weights / Top places apply as in the
   linear mean); the circuit value stays FFCO's linear mean (`cv_power` = 1). `top6w2` derives from `fair2` as
   `top6w` from `fair`. Why only the CN: on the same pairs (Top, reference period) a k from 1 to 3 was applied to the
   circuit value and to the CN separately and together (scratch `kgrid.py`): the CN power gains on all races
   (forest +0.06 at 2, sprint +0.07) at no cost on national races in forest; the circuit-value power costs on
   national races, gains nothing in sprint and narrows the scale. Both at 2 (the first version, ENGINE 6) gave
   forest +0.15 but national −0.03 / sprint national −0.09. Scores proportional to 1/time² ("k = 2" on the score)
   equal both quadratic means; the IOF-style log-time z-score was worse.

**Who sees what**: everyone sees `official` and `top6w2` (« Top », the method retained: quadratic CN since
2026-10-07); `top6w` (« Top linéaire », studied for reference) and the « Juste » methods `fair2`/`fair` are analysis
methods, shown only to accounts with the `analyst` right (granted on the admin page; `store.available()`,
`store.setAnalyst`; display only — the data files are the same for every logged-in user). The Méthodes page
presents the Top and gives the linear mean's measured figures to everyone, as the variant studied for reference.

Key design decisions (each was measured — see "Evaluating" below — and agreed with the owner):
- **Circuits are valued with the Juste CN, never with Top's.** A capped best-of fed its selection back through
  circuit values: groups racing mostly among themselves (veterans, juniors) inflated, H21 deflated (~13 %).
- **No fallback on a runner's first official CN** after the archive's first season (`seed_until="2011-01-01"`):
  it was stale and on FFCO's scale, and valued a third of sprint circuits. Only runners with their own CN in the
  discipline value a circuit. Seeds are per ranking family (`cn_engine.family`: pedestrian, VTT, ski).
- **"nc" (non classé) result rows** take no part in anything (`cn.is_nc`): not in circuit values, not in the
  runner's results or statistics; the race page lists them as "NC". (PM/abandon *without* "nc" score 0 and count.)
- **Recalage**: no annual step. Each month a factor brings the mean of the best 20 % of CNs to **5600** (FFCO's
  2026 rule), per terrain, from the level 2 months earlier (13-month smoothing). The factor of a race is that of
  its **day**: straight line between monthly knots, each monthly factor reached on the 1st of the following month
  (`cn_engine.daily_knots` / `factor_on`). A race's published score = raw score × factor of its day, **fixed once,
  never revised**; the CN is the aggregate of those published scores (no factor at CN level), so a CN only moves
  when a race enters or leaves the window. Never explain method artefacts in the UI — fix the method instead.
- The CN J-15 shown for computed methods is the runner's **published** CN 15 days before the race (the engine's
  own `cn_j15` column is on its internal scale).
- Rejected after testing: Top with 10 places (6 works once circuits use Juste), best 70/80 % pools for forest
  and sprint (re-measured 2026-10-06: −0.4 to −1 point), 5 races minimum (fewer circuit valuers, worse),
  2 races minimum (2026-10-07: +11 % ranked in forest, +38 % in sprint, and those runners' Juste CN still beats
  their official one, but −0.1 to −0.4 point on the pairs already ranked; the owner kept 3), feedback on the
  recalage (oscillates), distance-pooled sprint circuit values (pace not comparable across circuits).

## Provisional results (« Récemment »)

Organisers publish results (and often split times) on race day or the next, days before FFCO. `ffco_scraper/prov`
collects them for the races of the agenda (upcoming ones are kept, with their website and place, since the agenda
drops past races) and of FFCO's last month — relays excluded — and `update.py` runs it after each hourly update
(`PROV_BUDGET` seconds, 240 by default), plus `--prov-only` runs every 20 min on Saturday and Sunday evenings (600 s);
a deploy only when something new was found — Pages' free plan counts deploys. A race is watched 14 days whether
FFCO has published it or not (FFCO has no splits); a finished race comes back when a platform competition is
newly matched to it. Sources: liveresultat.orientering.se (JSON API, matched by date + name/organiser), WinSplits
Online (sequential event ids scanned forward; HTML split tables, start times from the event's .spl file, an
undocumented format decoded and checked against the tables — `winsplits._spl`), Helga (helga-o.live's SplitsBrowser:
event titles by sequential number, the IOF XML list from `readsplits.php`; its `/webres/` pages answer robots "403"
and are not read — the owner is telling Helga's developer), Orientation Data (heyries), and the organiser's site
(WordPress media/posts API — a `*.wordpress.com` site through public-api.wordpress.com, and the club's other
subdomains met on the way, `new.co-lorient.fr` —, Blogger feed, up to 14 pages best-first across the whole crawl from
the race's page and the home page: pages naming the race (words, its day in any spelling, `2026/10/03` in an address)
before generic results pages, a multi-sport site's own orientation section before the rest, lists of past events,
`.html` pages visited too (Joomla); photo albums, other seasons' and other days' pages never; a subdomain's main site
too, `ocastor.go78.org` -> `www.go78.org`; redirects and meta-refresh followed). A page is « the race's » (its files
need not name the race) only when its title lines say results and give the race's day and no other day. A file named
for another day is never the race's, nor one printing another season in its title or a date before the race (up to
2 days after is fine: exports printed the next evening); an organiser's races of one weekend share its files out by
their own words, the title printed inside included (`races.owners`: « KO », « Challenge », « CL », « Chpt ligue »).
FFCO's f-race and the agenda's x-race of the same day and organiser are merged (`races.merge_duplicates`, name words
≥ 80 % shared). Unreadable files a full look no longer finds are dropped. A post published in the 3 weeks before
the race (its address `/2026/09/24/…`: the announcement, often updated with the results) is visited, and its date is
not « another day »; on a page about the race's weekend, « MD »/« LD » in a link read as « moyenne/longue distance ».
A file whose name, link or printed title gives another format (« VTT » for a foot race, « LD » for an MD) or another
weekday (« Samedi » for Sunday's race) is not the race's (`run.not_this_race`), nor one whose address spells another
day (« …-dimanche-5-octobre-2025/ »; WordPress's `/uploads/YYYY/MM/` folder aside: `clubsite.address_other_day`).
PDFs: `pdf._dedupe` replaces pdfplumber's slow `dedupe_chars` (same output, ~4× faster on split lists). A file rejected on one race's look but about another race of the fortnight goes to that race (`run.adopt`: the race
whose place it names and whose day and format fit — the CF week's site posting Luxeuil's results). In `races.owners`,
names count with their abbreviations both ways (« CF LD » = « Championnat de France Longue Distance »), and a file
naming neither race goes to the plain one rather than an « Open », « KO », « Challenge »… A platform competition whose
name says VTT goes to a VTT race only, and a VTT race prefers one that says so (`match_score`). A race FFCO deletes
(published twice, one deleted) gives its documents to its twin and goes (`races.drop_deleted`); f-race names follow
FFCO's. A file already parsed (same content hash) is not parsed again for the weekend's other races (`run._PARSED`, then
`prov_docs.sha`). Club websites: FFCO's club directory first (`races.read_directory`: api.ffcorientation.fr's map,
`clubs.geojson` monthly and one popup per club, 40 per run — only the number and the website are kept, never the
officers' names, phones or e-mails; table `prov_club_dir`), else the site the agenda gave for one of the club's events
(often the event's own: `prov_clubs`); the past month's races, dropped
by the agenda before the pilot started, were added from its CSV export (one request each time the window reaches
further back — `agenda_backfill_from`; the owner's go-ahead 2026-10-08, for September then August; `races.backfill`). Each run looks at the longest-waiting races first, the organiser's site before the
platforms (WinSplits' class pages only when its .spl changed); a race the budget cut short comes first next time;
the last runs are listed under the « Résultats » table. **Polite by design:**
our user agent, a pause per host, conditional requests, a few requests per race only around competitions.
**robots.txt is read but no longer obeyed** (owner's decision, 2026-10-09: low load, occasional reads): a forbidden
URL is fetched all the same and its site goes on the owner's follow-up list (`prov_blocked`, kind `robots`). Sites
that actively screen robots (401/403/429, an empty 200 to non-browsers, Helga's results pages) are **never
worked around** — no disguised user agent: recorded as refused and listed too (kind `refused`). The list
(`site/data/prov/blocked.json`, served to administrators only by `_middleware.js`) is the admin page's « Sites » tab,
with the races concerned, for the owner to contact the sites' owners. Livelox links are ignored altogether (2026-10-10:
only the runners who sent their GPS track, and closed to robots): neither a document nor on that list. WinSplits rows with
no time, no status word and no punch are non-starters (« dns »), with punches mispunches. Parsers
follow `prov/model.py`; bump `parsers.VERSION` when they improve (every known document is read again), and
`run.COLLECT_VERSION` when finding results improves (every race of the window is looked at once more, finished ones
too). A page or file up to 32 MB is read (`fetch.MAX_BYTES`); a file named for another year is not the race's
(`clubsite.other_year`), and a word of the club's own address does not name the race. WinSplits headers are kept
by date (70 days), not by number. No result
file carries licences: runners are matched by name + club number (`match.py`), unmatched rows stay unlinked.
Provisional scores reuse the engine's functions (`compute.py`): official = official CN J-15 and FFCO's rule;
Juste/Top = the base method's internal CN J-15, circuit value, raw score x the day's recalage factor; only lists by
circuit are scored. State in the main DB (`prov_*` tables); output `site/data/prov/` (index + one file per race),
served to every logged-in user (an admin-only pilot until 2026-10-08). **Uploads** (2026-10-08; three steps since
2026-10-09): « Déposer » (`#/deposer`, `pages/deposit.js`, from « Récemment ») — 1. the file (IOF XML best, OE/MeOS
HTML, PDF, .zip/.gz; 30 MB), with what to export; 2. it is **read in the browser** (`localparse.js`, a port of the
server's iofxml / oe_html / meos_html parsers giving the same documents — keep them in step; checked identical on
real files) and shown: summary, results by circuit, and every « Temps intermédiaires » tab on it
(`#/temps-inter?course=fichier`) — nothing is sent; the parse sits in sessionStorage (`local.js`: gone when the tab
closes, cleared at logout; the File itself in memory only, to be chosen again after a reload); 3. only if the user
wishes, « Publier sur O'CN » (`pages/upload.js`): the race (those of the file's date first) or a race added with it
(name, date in the last 60 days, place, club, format; pre-filled from the file), consent, send. A PDF cannot be read in
the browser: straight to step 3. `functions/api/upload.js` streams the body to R2 (`cn-state`,
`uploads/<id>/` + `meta.json`; binding `BUCKET`, the Functions write nowhere else), records it in D1 `uploads`, mails
the administrators, deletes files older than 60 days, and, when the Pages secret `GH_DISPATCH_TOKEN` is set (a
fine-grained token, repo kerkia/CN, "Actions: read and write"), starts a `prov` run (workflow_dispatch, at most
every 3 min); the workflow copies `uploads/` to `$CN_DATA_DIR/uploads`, `sources/upload.py` turns each upload into
a document (source "upload"; a newer one by the same account replaces it; added races get key `u<id>`). Every upload
is published (owner's choice); the admin page's « Dépôts » tab lists them and removes one (meta status "removed"). pages « Récemment » (`#/recemment`, in the
main menu after « Bientôt », the agenda; `#/provisoires` still works) listing the last 60 days' races (`run.SHOW_DAYS`; 30 until 2026-10-08), and
« Temps intermédiaires » (`#/temps-inter`), linked from it. By hand: `python -m ffco_scraper.prov --db <db>
--out site/data --days 31 --budget 600` (`--build-only` rebuilds the files without fetching).

## Changing a method: migrations

`update.py` holds version numbers stored in table `engine_meta`. Bumping one makes the next run of any kind
(including the CI deploy run) recompute once, everywhere, then rebuild the whole site:
- `ENGINE_VERSION` — the computation changed: drops data of methods that no longer exist, recomputes `fair` from
  2010 and derives `top6w` (~5 min on CI, ~12 min on the PC).
- `TOP6W_CN_VERSION` — only the recalage/aggregation changed: re-normalises `fair`, re-derives `top6w`.
- `EXTRAS_VERSION` — only a second-stage dataset (`site_extras.py`: co-runners, age pyramid, clubs, age
  curves…) changed: rebuilds them from `site/data` (~35 s), nothing recomputed. Needed when the page code
  reads a new or reshaped file: the push-triggered run only publishes (`--deploy-only`), after `migrate`.
Add a dated line to the comment above the constant. Test the migration locally on a DB copy with
`update.migrate(Path(copy), Path('site/data'))` before pushing.

Keep `cn.py` (Python) and `site/assets/js/cn.js` (browser) in step: same rounding (half away from zero), same
order, same slot logic; the runner page's "Détail du calcul" must reproduce the published values exactly.

## Evaluating a method change

The yardstick used for every decision: on 2025-07 → 2026-10 results, for each pair of finishers on the same
circuit, does the higher CN **15 days before the race** (the runner's own published CN, from `cn_history`; no
fallback) predict who finished ahead? Compare methods on the **same pairs** (both runners have a CN in every
method compared), per terrain. Also check group bias (share of pairs where juniors / 55+ are predicted ahead vs
actually ahead, against H21) and rank drift by number of races. Reference results of the current methods:
forest Juste 82.3 %, Top 82.1 %, official 80.9 %; sprint Juste 84.0 %, Top 83.9 %, official 80.7 %.
Top linéaire vs Top quadratique (2026-10-07, 2025-07 → 2026-10, same pairs): forest 82.06 → 82.12 % (national races
82.80 → 82.80), sprint 83.94 → 84.01 % (national 82.18 → 82.11); forest scale p90/p10 2.65 → 2.57.
The Méthodes page shows these measurements as dated constants (`pages/methods.js`: `K_TESTS`, `K_GRID`, `LIN_QUAD`):
update them when the methods are re-measured; the 2025 validation tables are read from the data.
Run variants with `run_method` / `derive` on DB copies with `dataclasses.replace(spec.params, ...)`.

## Conventions and gotchas

- Commit messages: a short title, a body explaining why, ending with the `Co-Authored-By` line the session
  provides. Commit and push only when the owner asks or has agreed to the change; usually: implement locally,
  test, then commit, push and confirm the CI run and the live site.
- Many files use CRLF line endings: edit them preserving line endings (read/write bytes in Python scripts).
  In Git Bash, heredocs with quotes break easily: write patch scripts to a file, then run them.
- The login page (`pages/overview.js`, public) shows on wide screens a reel of 15 slides (`reel.js`: drawn views of the
  analyses with **made-up figures and blurred invented names** — the page and the repo are public, never real results
  or names there; texts `reel.*` in `i18n.js`; story-like bars, ‹ ›, pause, ←/→; paused on hover, when hidden, and not
  automatic under reduced motion); phones keep the short text (`.home-text`).
- UI text lives in `i18n.js` (French). Method keys: `official`, `top6w`, `top6w2`, `fair`, `fair2` (labels « Top »
  / « Juste », linéaire / quadratique; better names to come). Old saved selections of the removed `v2026` method
  are mapped to `fair` in `store.js`; saved selections from before `top6w2` get it added once (`mv`).
- Runner race rows (`R`) and race result rows (`C`) carry each method's columns, the quadratic ones appended after
  the linear ones (`data.js`: `SCORE_COL`, `CNAFTER_COL`, `CNJ15_COL`, `COUNTS_COL`, `WEIGHT_COL`, `C_SCORE`, `C_CNJ15`).
- The archived seasons (before 2024) are members-only on the FFCO site — listings and, since 2026, the race
  pages too: re-reading them needs a fresh `FFCO_SESSIONID` (the `sessionid` cookie of a logged-in member) in
  the environment; normal runs never need it. The workflow's `backfill` mode (manual) fetches every season's
  competitions not stored yet, with the repo secret `FFCO_SESSIONID` (the owner sets it, then deletes it).
- Accounts: e-mail + password with confirmation; registration checks name + licence against the licensee index
  (`site/auth`, never served); several accounts on one licence are allowed but flagged to the admin.
  Rights per account, set on the admin page (D1 `users.analyst`, `users.alerts_allowed`; they apply to admins too,
  so an admin can uncheck « Analyse » to see the site as a regular user does): the
  analysis methods, and the agenda e-mail alerts — new courses (`agenda_alert`) and registrations closing within
  8 days (`deadline_alert`, `deadline_announced`), sharing one list of regions; both are sent by `/api/notify`
  from the daily agenda run. **D1 migrations are not applied by CI**: run `npx wrangler d1 migrations apply ocn
  --remote` (owner's go-ahead) before deploying code that needs them.
  New-account alert: when an account is confirmed (`api/account/verify.js`), each administrator whose
  `users.signup_alert` is on (default; their own checkbox on the admin page, `api/admin/prefs`) gets an e-mail.
  « En direct » (`#/direct`, `pages/live.js`; menu: Récemment, En direct, Bientôt) only for accounts with the
  `users.live` right (migration 0007, admin page checkbox; granted at first to the administrator and one tester by a
  one-off remote UPDATE — names never go into the public repo): liveresultat's races from O'Cap's live server
  (`LIVE` = https://ocap.pages.dev: its `/api/live/list`, open to other sites, and `/ws/<race>`), so live traffic
  never goes through O'CN's gate; each runner recognised by name (+ club number) and linked, their CN Top and
  official in the race's discipline (guessed from the names: sprint, VTT, ski, else forest) and the place their Top
  CN predicts (« Attendu »). `localStorage["ocn.liveBase"]` points it at a local O'Cap for tests.
  Usage: the app posts each page view of a logged-in account to `/api/track` (route, Réseau views apart; a new
  browser session = a visit) into D1 `usage_daily` (account, Paris day, page, views; 13 months, deleted with the
  account); the admin page's « Utilisation » tab reads `/api/admin/usage` for any period. The privacy page says so.
  Mail through Resend with daily/monthly quotas and a reserve for account mails (`wrangler.toml` vars).
- GitHub may occasionally fail runs on its own (e.g. "job was not acquired by Runner"): check
  githubstatus.com before suspecting the code; the next hourly run catches up.

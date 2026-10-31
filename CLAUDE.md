# Ozimut — La course d'orientation, en cartes et en chiffres (O'CN until 2026-10-19)

Independent, unofficial site (https://ozimut.com; https://ocn.kerkia.com until the move, see « The move to ozimut.com ») that scrapes the French orienteering federation's
national ranking (FFCO, cn.ffcorientation.fr), recomputes it with alternative methods, and shows rankings,
runner histories, clubs, comparisons, an agenda of upcoming events and per-race details. The site's UI is
**in French**; code, comments and commit messages are in English.

## Layout

| Path | What |
|---|---|
| `ffco_scraper/` | Scraper (`fetcher`, `crawler`, `parser`, `store`, `updater`), agenda scraper (`agenda.py`), and the CN engine (`cn.py` = formulas, `cn_engine.py` = methods and computation, `cn_schema.sql`) |
| `update.py` | The one entry point for updates: fetch → recompute → rebuild site data → deploy → mail digests. Also holds the one-off **migrations** |
| `build_site.py`, `site_extras.py`, `site_io.py` | Turn the database into the static JSON under `site/data/` (runner buckets `r/`, races `c/`, month-end snapshots `snap/`, clubs, network, `meta.json`) |
| `site_ask.py` | The Parquet tables « IA » queries in the browser (`site/data/ask/`: runners, clubs, races, results, cn), rebuilt by every build from the published data |
| `ffco_scraper/prov/` | Provisional results (« Résultats »): organisers' results, often before FFCO publishes — races (`races.py`), sources (`sources/`: liveresultat, WinSplits, Helga, Orientation Data, O'Live, SPORTident Center, the club's site), parsers (`parsers/`: OE/MeOS HTML, IOF XML, PDF), matching to licences (`match.py`), provisional scores (`compute.py`), run + output (`run.py`) |
| `notify.py` | E-mail digests (new results, new competitions in subscribed regions) through `/api/notify` |
| `site/` | Static single-page app (vanilla JS modules, no build step). `assets/js/pages/*.js` one module per page, `i18n.js` all French text, `cn.js` the CN computation mirrored in the browser, `data.js` data access and the column index maps `R` (runner race rows) and `C` (race result rows) |
| `functions/` | Cloudflare Pages Functions: `_middleware.js` (login gate, deny by default), `_lib/club.js` (an account's club, a race's organiser), `api/account/*` (accounts on D1), `api/admin/*`, `api/notify.js`, `api/ffco-history.js` and `api/ffco-cn.js` (proxies to FFCO pages, logged-in users only, cached and rate-limited), `api/analyses/[[path]].js` (the shared GPS analyses, in R2), `api/tracer/[[path]].js` (the Tracer's course-setting events, in R2) |
| `migrations/` | D1 schema migrations |
| `ci/state.py` | Packs/unpacks the database and site state to/from Cloudflare R2 between CI runs |
| `.github/workflows/update.yml` | Hourly quick run, 03:00 Paris full run, 06:00 Paris agenda run, Sat/Sun evening provisional-results runs (every 20 min), deploy on push |
| `run_cn.py`, `query_cn.py`, `merge_methods.py` | Developer tools (recompute one method, inspect a runner, merge DBs) |
| `live/` | **O'CN's live relay**, Worker `ocn-live` (2026-10-18): Durable Objects — one `LiveRace` per liveresultat competition (« En direct »), MeOSDjango, O'Live or SPORTident Center race, or organiser's broadcast (« Organisation › Direct »), and the `Directory` (liveresultat's, MeOSDjango's and O'Live's lists, the broadcasts). No public address (`workers_dev = false`): O'CN reaches it only through its Durable Object bindings (`wrangler.toml` LIVE_RACE, LIVE_DIR) — `functions/api/live/list.js`, `functions/ws/[comp].js`, `functions/api/live/push.js`, `mop.js` (MeOS's online results) and `broadcasts.js`. Deployed by hand: `cd live && npx wrangler deploy`; local: launch config `ocn-live-dev` (8786), the local Pages dev binds to it; `live/dev/lr-mock.mjs` replays recorded races as liveresultat's API (`--var LR_API:…`) |

The project lives in `C:\kerkia\CO` on the PC (moved out of OneDrive on 2026-10-08: syncing rewrote files mid-edit).
Not in git (see `.gitignore`): the database and HTTP cache (`C:\kerkia\cn-data` on the PC, `paths.py`, env `CN_DATA_DIR`),
`site/data/` and `site/auth/` (generated), `.dev.vars` (local secrets), exports. **The repository is public:** never
commit results, personal data, secrets or credentials.

## Hosting and deployment

- **Cloudflare Pages** project `observatoire-cn` (static `site/` + `functions/`), custom domains `ozimut.com` (bought
  2026-10-18 at Cloudflare Registrar, its zone on Cloudflare; `www.ozimut.com` redirected to it by a Redirect Rule) and the
  former `ocn.kerkia.com` (CNAME at GoDaddy, kept for good: its pages send visitors on, « The move to ozimut.com »). Mail:
  the owner reads and writes `contact@ozimut.com` in **Proton Mail** (the domain's MX/SPF/DKIM are Proton's); the site sends
  from `alert@ozimut.com` through Resend (its SPF and bounce address on the `send` subdomain), replies to `REPLY_TO`
  (contact@); one DMARC record for both. **D1** database `ocn` (accounts, sessions, mail queue). **R2** bucket `cn-state` (the
  SQLite database and site data between CI runs). Free plans only: ~10 ms CPU per request (hence the light,
  peppered PBKDF2), 20 000 files per deployment (France's data ~11k files since `c/` was grouped on 2026-10-23: the competitions five to a
  file by id, `c/g<id // 5>.json` = {id: results}, meta `c_group`, `site_io.course_file` / `Courses`, `data.course`; a race
  opened reads ~15 KB instead of ~3. `r/` and `net/` stay ten runners' numbers a file: the runner page, Comparer, a club's
  members and the « Réseau » tab — 21 lists — each read several, and at //100 that tab would load 306 KB instead of 53),
  Resend 100 mails/day.
- Pages secrets (set by the owner with `wrangler pages secret put`): `SESSION_SECRET`, `RESEND_API_KEY`,
  `NOTIFY_SECRET`. GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `NOTIFY_SECRET`. Never ask for or print their values.
- **Deploy by pushing to `main`.** The workflow restores the state from R2, runs `update.py`, publishes, and
  saves the state back. Do **not** `wrangler pages deploy` from the PC: it would publish the PC's possibly
  stale `site/data`, and anything not pushed is overwritten by the next run.
- `site/_routes.json` keeps the public files (`/`, `/assets/*`, `robots.txt`, `meta.json`…) out of the Functions:
  served free and unmetered, without the login gate (which only passed them through); the data and the API stay
  behind it. The Workers free quota (100 000 requests/day) is **per account**, shared by O'CN and its `ocn-live`. **O'Cap** (`ocap/`, a public phone-first companion site, Pages `ocap` and Worker
  `ocap-live`, 2026-10-09) was switched off and deleted on 2026-10-18 (owner): its code, its Cloudflare projects, their
  deployments and stored data are gone; its live relay became O'CN's `live/` (it held no broadcast to carry over).
- **Open tabs follow a deploy** (2026-10-15): the pages' modules stay in memory for the whole visit, so a tab left
  open kept running old code after a fix. `update.deploy` writes `site/assets/build.txt` (`write_build_stamp`: a hash
  of site/ without data/ and auth/, unchanged by data-only deploys; git-ignored); `app.codeChanged` reads it at a change
  of page, at most once a minute, and reloads the page when it differs. No file on the local server: nothing happens.
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
  build_site.main(['--out','site/data/fr','--db', <db>, '--auth', <a folder>])"` (France's folder; `--auth` keeps a test
  build's login index away from `site/auth`), then `python -c "import countries; countries.write_index()"`. Test engine changes on a **copy** of
  `C:\kerkia\cn-data\ffco_results.sqlite3`, never on the original.
- To stop the dev server on Windows, kill `workerd` and the `node` processes running wrangler.
- After a JS change, check the page in a browser (console errors!) before pushing; the browser may cache
  modules — hard-reload.

## The CN methods

All methods share the race score: circuit value = mean of (CN J-15 × time) over a sample of the ranked runners holding
a CN (FFCO: the arithmetic mean over the fastest ⌈2N/3⌉; the published Top since 2026-10-16: the arithmetic mean over the
fastest 90 % in forest, ⌈2N/3⌉ in sprint, 75 % in VTT and ski — `CnParams.sample_fraction` per terrain; the geometric
analysis pair: a geometric mean with the tail dial, `cv_power` 0, `tail_k`); score = circuit value ÷ time; PM / abandon /
disqualified / over time score 0 and count.
12-month window. Four specialités, each ranked separately: forest (`For`: LD/MD/Nuit), sprint (`Spr`), VTT
(`VTT`, all formats together) and ski (`Ski`, all formats together) — FFCO's own split (`specialite=` on its
CN pages). In the DB `competitions.terrain` is "Forêt", "Sprint", "VTT" or "Ski"; the site uses the codes.
VTT (~30 competitions a season) and ski (2-4, on one or two weekends) have their own Fit/Top params
(`CnParams.by_terrain`, `for_terrain`; `meta.methods.*.params.by_terrain`, `cn.paramsFor` in the browser):
window 2 years (VTT) / 3 years (ski), best 70 % — with 12 months, too few riders held a CN to value the
circuits (VTT: half the circuits, 5 of 83 in 2021; ski: nothing after 2013). The official window stays 365 days.

**Since 2026-10-19 (owner) the published method « Top » is the « méthode Ozimut »** (key `top6w` unchanged in the code and
the data) and **the geometric pair is gone** (ENGINE 13; `fair3`/`top6w3` below are history). Words (`docs/i18n/glossary.md`):
« classement Ozimut » / Ozimut rank, « indice Ozimut » / Ozimut index (a runner's value, was « CN Top »), « score Ozimut » /
Ozimut score (a runner's points in a race), « valeur Ozimut du circuit » / course's Ozimut value; « CN officiel » unchanged;
French elides (« d'Ozimut », « de l'indice Ozimut »). **A text about the value of the method shown follows the method**
(owner, 2026-10-19): it uses the placeholders of `ui.cnWords` — `{cn}`, `{cnLow}`, `{cnOf}` « de l'indice Ozimut », `{cnPl}`
« indices Ozimut », `{cnS}`/`{cnSCap}` « indice » / « CN », `{cnTo}` « à l'indice », `{cnThe}`/`{cnTheCap}` (i18n `cn.<method>.*`) —,
which `t()` fills from the site's method when the caller gives none (`i18n.setDefaults`, registered by app.js); table
columns and chart axes use `col.cn` / `chart.cn`; never « CN » written in the code. Texts about FFCO's own CN keep « CN »
(« Compte pour le CN », « Coureurs au CN »); those about both methods name both (« scores, CN et indices provisoires »).

1. **`official`** — FFCO's published values, copied verbatim (before 2026 FFCO had one pooled pedestrian
   ranking for forest and sprint, filed under "Ped": `build_site.official_terrain`, `data.snapTerrain`,
   `data.inSeries`; VTT and ski always had their own). The runner page's official calculation card reads FFCO's own
   CN page live (`/api/ffco-cn`): FFCO re-evaluates past-season races under **new circuit ids** that only that
   page links, so its points can differ from the race's results page.
2. **`fair`, « Méthode CN « Fit »** — the **usual level** (analysis method; it values the circuits). CN = weighted mean of
   the best 60 % of the window's scores (`top6_weighted` with an unlimited number of places). Weights by competition **name**
   (`cn.title_weight`): "Championnat de France" 2, "O'France" or "Nationale" 1.5, anything else 1 (Sélection races and
   Championnats de Ligue included, FFCO's A/B/C/D level not used). ≥ 2 races for a CN (3 until 2026-10-23, ENGINE 14), a
   circuit needs ≥ 4 ranked CN holders.
3. **`top6w`, « Méthode CN « Top »** — **the method published since 2026-10-16** (owner: a method everyone can follow by
   hand, at a cost of a few hundredths of a point; ENGINE 11). **Derived from `fair`** (`CnEngine.derive`): same race scores,
   circuit values and recalage factors; the best 60 % scores fill **6 weight places** from the best down, the last race only
   for the places left, in a weighted **arithmetic** mean. Racing more can only raise an adult's once the places are filled.
   **The juniors' races fade** (owner, 2026-10-19; ENGINE 12; `CnParams.junior_fade` 1.0 on `fair`, so on the Top and on the
   usual level that values circuits, 0 on the geometric pair): a race run in a junior category (H/D 12-20, `cn.is_junior` on the
   race's own category) keeps its places but weighs × (1 − its age / the window) in the mean, read on the day the CN is computed
   (`cn.fade_factors`, floor 1e-3; `RunnerHistory.add(..., junior)`, every history the engine, `prov/compute.py` and
   `build_site` build; `cn.js` `explain`/`topWeighted`/`isJunior`, the runner page's calculation shows the factor). A junior's
   CN therefore moves between races, and a recent junior race below the older ones' mean can lower it. Study of 2026-10-19
   (private artifact https://claude.ai/artifact/4QztRsFZh8siyimuLvYiGa; scratch `rvar.py`, 17 curves from 2010 on the
   2026-10-09 database, CN J-15 read on its day, against production read the same way, 2012-2024): forest +0.18 [0.16, 0.21]
   (15 of 15 seasons better, +0.14 since July 2025), sprint +0.11 [0.05, 0.17] (ns since 2025), VTT +0.15 (+0.28 since 2025);
   every runner's races fading ≤ +0.08 and nothing once the juniors' fade, a 24-month window −0.6, the Top alone −0.08; junior
   bias in forest +2.3 → +3.9 (sprint and VTT better). MTBO would gain more with adults fading over its 24 months and juniors
   over 12 (+0.41): not taken. `study.json` `jeunes`. Circuits:
   FFCO's arithmetic mean of usual level × time over the fastest **90 % in forest, ⌈2N/3⌉ in sprint, 75 % in VTT and ski**
   (all four when only four, FFCO's exception kept; `build_methods` `fair.by_terrain`). Recalage: the geometric pair's
   (`norm3`: anchored on the Top's cohort, the drift corrected, calendar months, carried 10 months). **Study of 2026-10-15/16**
   (copies of the migrated DB of 2026-10-15, `C:\kerkia\cn-data\study`: variants F50…F100, F90, E50…E100 by the scratch
   `run_variant.py`/`worker*.sh`, evaluations `eval_frac*_n.json`, `eval_elig_n.json`, `eval_switch_n.json`; the public numbers
   in `site/assets/study.json` key `lineaire`, built by the scratch `switch_json.py`; the database copies and variant exports
   of every CN study were deleted on 2026-10-17, the evaluations — `eval_*.json` and the logs — kept in the study folder): one criterion per discipline — the best
   duels on 2012-2024 without a significant loss since July 2025. Against the two-thirds (written 0.6666667 in the variants: one
   runner more on circuits whose size divides by 3; production uses the exact 2/3): forest 75 % +0.10, 85 % +0.33, 100 % +0.34,
   and **90 % +0.08 [+0.05, +0.10] over 100 %** (national +0.12, 8 seasons better, 1 worse; the owner's suggestion); sprint
   nothing beats the two-thirds (50-60 % win since 2025 but lose on 2012-2024, 100 % −0.34); VTT 75 % +0.15 (85 % +0.20 on
   2012-2024 but −0.49 since 2025); ski as VTT. The usual level's share of best scores (the owner's question): 60 % stays (forest
   50 % −0.03, 70 % −0.11, 80 % −0.16, 100 % −0.62; sprint 50-80 % equal). Against the geometric Top, same runners, 2012-2024:
   forest +0.02 [+0.01, +0.03] (national 0.00, since 2025 −0.02 ns), sprint −0.12 [−0.18, −0.07], VTT +0.10 [+0.03, +0.16].
   The production run (migration on a copy, `evaluation.json` of 2026-10-16): Top − official forest +2.17 [2.06, 2.27]
   (79.19 → 81.35 %), sprint +2.27 [1.98, 2.56] (81.16 → 83.43 %); geometric − Top forest −0.02, sprint +0.15 [0.10, 0.20].
   Published level (best 20 % of CN Top, snapshots of March and September 2018-2026): mean distance to 5600 2.0 % forest,
   3.4 % sprint, 1.0 % VTT (peaks 6-9 % after the Covid seasons; the geometric pair alike: 1.9, 2.8, 0.9 %) — « within 2 % at
   every date » said of the geometric pair held only at the dates first checked.
4. **`fair3` and `top6w3`, the geometric pair — removed on 2026-10-19 (owner; ENGINE 13: its data dropped, the race files'
   columns 27-36 and the `c/` columns 12-15 gone, `cn.circuit_value`'s tail dial gone; the study and the white paper keep one
   line: forest −0.02, sprint +0.15 [0.10, 0.20] against the published method, set aside for simplicity)** — the Top published **from 2026-10-13 to 2026-10-16**, an analysis method until 2026-10-19
   (labels « Fit géométrique » / « Top géométrique »): the circuit valued by a **geometric mean** with a dial on the slow tail
   (`CnParams.tail_k`, `cn.circuit_value`, mirrored by `cn.js circuitValue`: V = A^(1-w) x B^w, A = the fastest ceil(2n/3)
   times the discipline's usual tail effect `tail_mean`, B = the whole field, w = n / (n + k); forest 0, sprint 400, VTT and
   ski 50), the usual level `fair3` a **cubic mean** (`cn_power` 3), the Top `top6w3` the weighted arithmetic mean of its 6
   places. Its study (2026-10-13, private artifact https://claude.ai/artifact/1JSufP7jr3c9peCdSUwBuC) found what still holds:
   FFCO's two-thirds leave out the runners who made mistakes (the value 4.8 % too low on average in forest, unevenly: sd 5.4
   points, the junior circuits most), so the share of the field is what separates the methods; the geometric mean itself adds
   nothing in forest and a tenth of a point in sprint. Also measured there and rejected: the Top as its own circuit valuer (the
   loss grows over the seasons), an elasticity per circuit, per-race information weights, a bent score, the maximum-likelihood
   level, Huber's circuit value, k = 4; the study's engine options are kept in git history (commit 9244b54).
   History: `fair2`/`top6w2`, the quadratic pair (2026-10-07 to 13), dropped; `top6w3` cubic on 2026-10-13, arithmetic from
   2026-10-14; the four disciplines on one rule from 2026-10-14; the dial from 2026-10-15.

**Who sees what**: everyone sees `official` and `top6w` (« Ozimut ») and nothing else since 2026-10-19: the usual level
`fair` values the circuits and is shown to nobody, and the `analyst` right is gone (its admin checkbox and `store.setAnalyst`
removed; the D1 column `users.analyst` stays, unread). Old links and saved choices naming `top6w3`, `fair`, `fair3` open
Ozimut (`store.js` `RENAMED`). Before: `top6w3` and the « Fit » methods were analysis methods for the `analyst` right.
The Top keeps its colour and dash whichever pair publishes it (`charts.METHOD_SLOT`, `build_site` `COLOR`). **The
documentation (page and PDF) never names the Fit** (owner, 2026-10-14: misleading): the circuits are measured from the scores
the runners present earned in their previous races, their « niveau habituel », a step of the calculation and not a ranking.
« A race more never lowers the CN » is only said with « once the 6 places are filled » (before, the CN Top is an ordinary mean),
and of an adult's CN (a junior's recent races weigh more than their older ones, 2026-10-19).
**The documentation was shortened on 2026-10-16** (owner): the study tab has six chapters (Objectifs, Le point de départ,
La mesure, Les choix et les variantes, Les résultats, La méthode retenue), the alternatives in a few lines each, the
conclusion on simplicity and accuracy; old `?voir=score|circuit|recalage|ecartes` links open « choix »; the white paper
(`docs/whitepaper/methode-top.tex`, `figures.py` → `fig_trunc.pdf`, `fig_share.pdf` and `numbers.tex`, the numbers from
`study.json` and the live `site/data/evaluation.json`) follows the same plan.

Key design decisions (each was measured — see "Evaluating" below — and agreed with the owner):
- **Circuits are valued with the Fit CN, never with Top's.** A capped best-of fed its selection back through
  circuit values: groups racing mostly among themselves (veterans, juniors) inflated, H21 deflated (~13 %).
- **No fallback on a runner's first official CN** after the archive's first season (`seed_until="2011-01-01"`):
  it was stale and on FFCO's scale, and valued a third of sprint circuits. Only runners with their own CN in the
  discipline value a circuit. Seeds are per ranking family (`cn_engine.family`: pedestrian, VTT, ski).
- **"nc" (non classé) result rows** take no part in anything (`cn.is_nc`): not in circuit values, not in the
  runner's results or statistics; the race page lists them as "NC". (PM/abandon *without* "nc" score 0 and count.)
- **Recalage**: no annual step. Each month a factor brings the mean of the best 20 % of CNs to **5600** (FFCO's
  2026 rule), per terrain, from the level 2 months earlier (13-month smoothing; the Top's CNs, carried forward by the
  ten-year drift — `norm3`, shared by both pairs since 2026-10-16; see method 4). The factor of a race is that of
  its **day**: straight line between monthly knots, each monthly factor reached on the 1st of the following month
  (`cn_engine.daily_knots` / `factor_on`). A race's published score = raw score × factor of its day, **fixed once,
  never revised**; the CN is the aggregate of those published scores (no factor at CN level), so an adult's CN only
  moves when a race enters or leaves the window (a junior's also as their races fade). Never explain method artefacts in the UI — fix the method instead.
- The CN J-15 shown for computed methods is the runner's **published** CN 15 days before the race (the engine's
  own `cn_j15` column is on its internal scale), **computed on that day** from the published scores (`build_site.cn_j15`
  → `agg_at`, since 2026-10-19; before, the last CN after a race within the window, which still counted races that had
  left the window since the runner's last race: production read on the day −0.12 point in sprint, +0.02 forest, +0.22
  VTT, measured 2026-10-19). The month-end snapshots were always computed on their day. Their last point is **the build day**
  (Paris, `build_site.paris_today`; owner, 2026-10-19 — before, the last race date of the data): a junior's CN fades by the
  day and a race leaving the window shows that day. A run with nothing new but a new Paris day rebuilds the current
  season's snapshots once (`update.day_point_due`, the first run after midnight) and deploys.
- The engine takes a circuit's rules (sample, mean) from its discipline's params (`pt(terrain)` in `run_method`,
  2026-10-13); `cn.js` mirrors `circuit_value` as `circuitValue` for the live page's estimates (`meta.methods.*.params`
  carries `sample_fraction`, `cv_power`, `cn_power`, per terrain).
- Rejected after testing: Top with 10 places (6 works once circuits use Fit), best 70/80 % pools for forest
  and sprint (re-measured 2026-10-06: −0.4 to −1 point), 5 races minimum (fewer circuit valuers, worse),
  2 races minimum (2026-10-07: +11 % ranked in forest, +38 % in sprint, and those runners' Fit CN still beats
  their official one, but −0.1 to −0.4 point on the pairs already ranked; the owner kept 3 — **adopted on 2026-10-23**
  (owner, after Spain's study: +0.67 there in sprint): re-measured on the method of 2026-10-19, the 2026-10-09 database,
  every result's index read on its day, 2012-2024, the results with an index +7 % forest, +71 % sprint (+35 % since July
  2025), +13 % VTT, the newly ranked still called better than by their official CN (Ozimut − official forest +2.47 against
  +2.31, sprint +2.73 against +2.28), on the runners ranked either way forest +0.05 [0.04, 0.07], sprint −0.09 ns (since July
  2025 −0.23 [−0.43, −0.07]), VTT −0.14 (−0.43); the scratch `fr_min2.py`, `C:\kerkia\cn-data\study\min2\eval_min2.json`),
  feedback on the
  recalage (oscillates), distance-pooled sprint circuit values (pace not comparable across circuits).
  **Leaving out the runners far from the circuit's line** (study of 2026-10-18, private artifact
  https://claude.ai/artifact/WS7C7tMKsj7h7ZzezNCLvE; scratch `ovar.py`, 28 rules: by residual from the score line or a fitted
  line, one side or both, threshold or share, on top of or instead of the time trim, Huber, juniors or few-race runners not
  valuing): the fast tail's CN is really ~18 % too low, but one side only feeds back through the circuits (forest junior circuits
  +16-25 % above adult ones; −0.21 to −1.06 point), both sides lose in forest; juniors not valuing + both sides beyond the 2.5 %
  thresholds gains +0.29 in sprint and VTT but adds two rules for the flaw the juniors' fading treats: not adopted (owner,
  2026-10-19). `study.json` `ecarts`; the Documentation's « Les choix » has a slide on each study, the white paper a paragraph.

## The four modules and the three profiles (owner, 2026-10-30)

Ozimut is four **modules**, the same names in both languages: **Arena** (the competitions: coming, live, run — the map's
water blue), **Stats** (the rankings and their analyses — forest green), **Coach** (training: Analyse solo, Analyse multi,
« Définitions de postes », Jeux, VMA — the course's purple), **Orga** (the organisers' tools — the control flag's orange).
`app.js` `MODULES`, `moduleMenus()` (each module's menu), `moduleOf(r)` (a route's module; `ROUTE_MODULE` for the routes
outside the menus), `body[data-group]` = the module. The bar shows the current module's pages only (`.mod-nav`; folded behind
the menu button when they do not fit, `app.fitNav`), the logo and « Ozimut » (a link to the choice of module) with the module's name
under it (`.brand-mod`, in the flag's orange, a link to the module's first page, `moduleHome`; owner, 2026-10-30); the bar holds the menu only: the method switch sits at the right of
a Stats page's tab row (`app.placeMethod`, else alone above the page); Stats has no « Ma page »: « Coureur » opens one's own, its menu starts with « Classement » then « Coureur », the ranking's
first tab is « Liste » (owner, 2026-10-30), and Stats opens on « Classement », the page every visitor has (`moduleHome`; owner, 2026-10-30);
the contour lines are drawn behind the bar itself (owner, 2026-10-30, second review: no banner under it, no line describing the
module — the modules page says it). **The modules page** (`#/modules`, route `hub`, `pages/hub.js`) is where one lands — signed in or entered without an
account (`homeOf`) — and the logo leads back to it; it also signs out, signs in or leaves. **No page leads into another module**
(the rule of the restructure): runner names in Arena's tables open the runner's window (`runnerpop.js`, as « En direct »'s),
Orga's pages name where things show (« Arena › En direct › … ») instead of linking, the analyses tag an organiser's own event
instead of linking to Orga. E-mail and notification links go straight to their page (allowed). The pages outside the modules
(Réglages, Documentation, Nous écrire, admin) keep the last module's menu (`sessionStorage ocn.module`).

**Three profiles**: a **visitor without an account** (« Entrer sans compte »: `auth.guest()`, `localStorage ocn.guest`; the
router keeps them to `GUEST_ROUTES`: Arena, Coach but Analyse multi, Stats' runner, ranking and races), a **signed-in account**,
and a signed-in account **with Orga** (`users.orga`, migration 0016 — at registration, in Réglages › Modules, or « Activer Orga »
on the modules page; `_lib/api.js publicUser` treats a database without the column as Orga for all). Orga is never offered on a
phone (`app.isPhone`: coarse pointer and ≤ 900 px; an Orga address shows `orgaOff`, hub.js; the modules page has no Orga tile
there, and its bottom line no « Se connecter », which the bar has — owner, 2026-10-30). Analyse multi needs an account.

**Public data for visitors** (`data.setPublicRule`, set by `app.start`): a visitor, or an account that has not joined a country
whose access is "members" (France), reads its **public copy** `data/<cc>/pub/` (`site_public.py`, written by `build_site` for
France after `site_extras`, and once by any run if missing — `update.ensure_public`): the races from the first season FFCO shows
without a login (`countries/fr/public_period.py`: the season listing's « réservée aux licenciés », checked monthly by the
regular runs, `engine_meta` `ffco_public_from` / `ffco_public_checked`; 2024 on 2026-10-30), runners.json (those with a race in
the period or ranked in its snapshots, counts recomputed), competitions.json, c/, r/ (a hundred numbers a file, meta `bucket`
100), snap/ of the period's seasons, agecurve.json, meta.json (`public_from`). Agenda, evaluation and validation stay the
country's own files (`data.js SHARED`). The pages read from it (`data.isPublicCopy()`) hide the long-term tabs (runner: only
Courses and Calcul; ranking: no Progressions); the other Stats pages show `needCountry` (« create an account and join France »).
The login gate (`_middleware.js guestMay`) lets a request without a session GET the public copies and `DATA_FOR_ALL`, the
countries whose access is "all" (Spain, the agendas' countries; `auth.sees` is true for them without a session too), the live
results (`/api/live/list`, `/ws/*`) and `/api/tracking` (its GET serves visitors, `mine` false). Not excluded in `_routes.json`:
every visitor's request goes through the gate, which judges the decoded path, and counts on the Workers' daily quota.

**Arena** is one page, the competitions (`#/agenda`; owner, 2026-10-30, third review): one list of today's, the coming and the
past competitions — the Agenda's events and, from the provisional index, the last 60 days' races (`pastEvent`, an event of the
agenda's last days that « Résultats » has drops for its row) —, chosen by three boxes in a box of their own above the filters, always shown — on a phone too, where the other filters are
folded (« Aujourd'hui », « À venir », « Passées (60 jours) »; `st.when`, all three by default; the list opens on today — its box
scrolled there, on a phone, where the list has no box, the page, once the router has put it at its top). Left for a race (a row, a
link of the details), the list remembers where it was (`agenda.js` `memo`: periods and scroll, an hour, the same country): coming
back — a race page's « ‹ Compétitions » (`arena.back`, on the results page and the analysis), the browser's Back, the module's
name — finds it there; an address naming an event or `periode` opens as asked (owner, 2026-10-30). The map draws the coming
competitions as dots, today's and the past ones only while the mouse is over their row or they are selected (`agendamap.show`'s
`ghost`; a past race's place from the results index's `pos`, `prov/run.race_pos`: its place within its organiser's département
by the offline place tables, else that unit's centre). Arena offers no choice of ranking (owner, 2026-10-30: Stats' alone; « En direct »'s race page lost its button): its
tables show the one chosen in Stats. Arena has no menu: a race's
page puts its own tabs in the bar (`app.placeBarTabs` moves the page's `[data-bar-tabs]` — the results page's `raceTabs`,
`splits.js`'s `#sp-tabs` — into `#nav`; folded behind the menu button when they do not fit). **On a phone** (≤ 760 px; owner,
2026-10-30: the bar's folded menu stayed open, came twice, would not close on a tap beside it) a race's tabs and Stats' pages are a
menu in the page instead (`app.pageMenu`): its button before the race's name, or before a Stats page's tabs, the current tab or
page written on it; a choice, a tap elsewhere or Escape closes it; the bar's menu button goes on those pages (`.pm-on`). A race's
page on a phone drops the line under its name (`.race-head .lede`); Stats' CSV exports are not offered there (`.csv-btn`). **The country and the language on a phone** (owner, 2026-10-31: room in the bar) are sections of the top-right menu (`.menu-subs`: `country.subMenu`, `app.langSub`, each opening in place), not buttons of the bar; the theme stays in the bar. Visitors without an account have that menu too on a phone (`.visitor-menu`: country for a guest, language, the modules page, Documentation, Nous écrire, sign in for the signed-out, create an account); `country.hint`'s « Tous les pays » opens it at its country section. **The
source is Ozimut's choice** (owner: « users don't know better »): the results page and the analysis show the best document
(`run.doc_priority`'s order) and offer the source selector to administrators only; the circuit selector has no « Circuit » /
« Catégorie » label (« Voir » says it), and no « Temps intermédiaires de ce circuit » button: the race's tabs carry the circuit
shown (`data-view`, `raceHref`). On the modules page a module's name opens it, as its button does. A past row
opens its results page (`#/resultats?course=`); a coming or today's one its details beside the list. `#/resultats` (the old list)
leads to the competitions with « Passées » ticked (`?periode=passees`), `#/direct` to the competitions (a race's live page
`#/direct/<id>` stays), `#/analyse-course` without a race to « Passées ». Desktop layout: the filters (with the runner,
`raceFilters` `fields: ["runner"], bare`, inside the same card) and the list on the left, the map and the details on the right
from the top. A live race of today whose name fits an event becomes that event's « direct » (`findLive`); no box of live races
(owner: not useful). An event's details start with one row of buttons (`actions`: invitation, « Suivre en direct », its
provisional results and analysis, GPS tracking, the start list, « Accès » — the way there; the access text is a line of the
details). The map has no frame of its own: its buttons and legend over it (`agendamap.js`; past rows are not on it). The modules page's Arena card lists what a competition chosen
there offers (`hub.js ARENA_STEPS`: agenda, results, live, split analysis — the GPS analyses are Coach's) instead of page links. A race's page (`#/resultats?course=`) has the results as its first tab, then — when it
has split times — every view of the analysis (`raceTabs`; `splits.js` draws the same bar with the results as a link,
`SPLIT_VIEWS`); `#/analyse-course` without a race leads to « Passées ». An event under way shows, beside « En direct », « Résultats
provisoires et analyse »: the organiser's list once there, else the live times when `livesplits.probe` finds split times.
**Coach**: « Analyse solo » is one page, two tabs (`coachtabs.js`): a competition (`#/analyse`) or a training or any race
(`#/analyse-solo`); « Analyse multi » likewise (`#/analyse-competition`, `#/analyse-club`). « Définitions de postes »
(`#/definitions`, `pages/descriptions.js`): Purple Pen's symbols (`tracer/symbols.js`) column by column, column D by family,
names and sheet texts in the symbol file's 23 languages, a search, a practice mode hiding the names; Purple Pen credited in the
legal notices. Beside each symbol its map equivalent (owner, 2026-10-30, after Maprunner's posters — the idea only):
`mapsymbols.js` (`mapSvg(id, size)`, keyed by the IOF id, for the Tracer's guide later), our own schematic SVGs in ISOM 2017-2 /
ISSprOM 2019-2 colours, the purple circle on the feature — every column D symbol, C and G (the eight directions drawn for north
and turned, the flag's spot marked), E and F where a map shows them; H, sizes and special instructions none; white map paper
in every theme. Practice (owner, 2026-10-30): the names hidden (`?mode=pratique`), « Imaginer la définition d'après la carte »
(`?mode=carte`, the maps alone) or « Imaginer la carte d'après le symbole » (`?mode=symbole`), the rest shown by a tap. At the top,
« Lire une ligne de définitions »: our own worked line (`EXAMPLE`: 7, 145, the eastern stony depression 8×4, north part,
refreshments) under its letters A-H, written out in the language chosen by the Tracer's `textifier`, and what each column says
(C-H lead to their part). « Symboles de carte » (`#/symboles`, route `mapkey`, `pages/mapkey.js`, after « Définitions de postes »;
owner, 2026-10-31, after a legend of the kind maps print): every ISOM 2017-2 symbol (101-115, 201-215, 301-313, 401-419 — no 411
in 2017-2 —, 501-532, 601-603, 701-713) as a legend's swatch, group by group (= colour by colour), with its number, name and a
line of meaning; a card « Ce que disent les couleurs » with the forest's runnability by the green; search; practice hiding the
names (`?mode=noms`) or the drawings (`?mode=dessins`). `isom.js` draws them, our own SVGs at the specification's dimensions in mm
(line widths, dots, dashes, spacings read from its drawings), 18 px a mm, the course symbols in a larger frame (7.6 px a mm). Names:
the specification's (French: FFCO's translation, ISOM 2017-2 FR/EN); notes our own words (`ms.s.<code>`, `ms.n.<code>`). The four
« shall not be crossed / entered » symbols (520, 708, 709, 711) are tagged « interdit ». Sprint maps (ISSprOM 2019-2): not yet.
The file inputs of traces take any file on a touch screen (`util.fileAccept`: iOS greyed .fit and .tcx out); on a phone
« Analyse solo » offers « Photographier la carte » (`#an-cam`, `capture="environment"`: the rear camera, the photo kept on the phone).
**The home page** (owner, 2026-10-30): sections one under another, a rule between them, each a link of the bar — « Aperçu »
(Découvrir, Partout, Arrivée: what Ozimut is, phones, the pledges and the account), Arena, Stats, Coach, Orga, « Tarifs » /
« Pricing » (`#/?s=overview|arena|stats|coach|orga|features`); no sign-in buttons in the bar there, the login card under the
hero has « Se connecter », « Créer un compte », « Entrer sans compte » (`data-guest-enter`, `app.enterAsGuest`). Each section is a
course of its own (`tour.js` `mod`: the start triangle beside its introduction, its legs numbered from 1, its finish holding the
way in; the line's length measured to the finish, `--line`). « Tarifs » is a table, the modules as columns and the access levels
as rows (without an account, with one, a federation's licensee, with Orga), each row adding to the one above and marked
« Gratuit pour tous »; each cell lists what it adds (`CAPS`, keys `tour.f.<module>.<level>.<n>`: change both together). A link
of the bar is caught by the page (`overview.onSectionLink`: a second click on the same one works too) and jumps to the section
under the bar, put right again as the pictures load (their sizes are written in the page) unless the reader has scrolled since;
on the home page the logo and the name take it back to its top. Stats' « Indice Ozimut » leg holds « Votre niveau sur la durée »
(`tour.method.long.*`: one set of rules since 2010, one scale with no jump between seasons, each race scored once — owner: the
index's value for following one's level over the years); Coach has an « Analyse multi » leg (`multi`, `multi-gaps`). The notes
on licensees and on the pictures sit under the Pricing table, one under the other, and are in the rules page too (« Accès et
images du site »).
Its pictures were all retaken on 2026-10-30 (the old ones showed the menus of before) on the scrambled copy rebuilt with that day's
code — `synth/oz2` (`synth-oz2.sqlite3`, `data/` in today's layout), by `build_oz2.py` / `build_oz2b.py`, then `tour2.mjs fr|en`
(Orga's pages on the administrators' dev server, 8790, so that their lists are full), `convert.py`, `sheet.py` for contact
sheets — kept in `C:\kerkia\cn-data\scratch-scripts\C--kerkia-CO\7c7246a6-efbb-46e6-a267-01b8966734a0\scratchpad\shots`
(`npm install` there for puppeteer-core; run from PowerShell). New ones: `hub`, `past`, `descriptions`, `orga-direct`, `phone-hub`.
Retaken the same evening with the modules' bar, plus `multi` and `multi-gaps`: the local test analysis « Test UI club » (circuit
« Bleu », the reel's invented map; `multi` at 23:00, nobody followed, every runner's whole route in thick lines — `ocn.sh.prefs` tail 0, width 2.4 — so that the four routes and their variants show, owner 2026-10-31), whose title, organiser and runners `lib.mjs` replaces with invented ones
(`/api/analyses/<id>` and `/traces/<n>`, fetched with the page's cookies) — never take them without that. `past` must open in a
fresh page: an Agenda address opened from the Agenda keeps the page's periods.

## Provisional results (« Résultats »)

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
and are not read — the owner is telling Helga's developer), MeOSDjango sites (2026-10-22, `sources/meosdjango.py`: a MeOS results site any club installs — Orientation Data, `heyries`, is one, COCS 73's jolatomme.alwaysdata.net another; each course read once from its JSON `/api/<cid>/course/<hash>/live/`, start times and splits by control code, the coming races' start lists too; `KNOWN` plus the sites met on a club's site — a `/competition/<n>/` link probed, or a page with its signature —, kept in `prov_meta` « meosdjango »; a course re-read only when the competition page's « classés / partants » change), O'Live (2026-10-24, `sources/olive.py`:
co-live.fr, a live results site French organisers feed from their timing software, HTML only — the races on offer, each
circuit's results page and split times page, read again only when the results pages moved; it lists only current races, so a
race is read on its day or soon after; a link to its home page on the organiser's site, « Résultats provisoires », gets the
O'Live race of that day whose name fits, or one of whose name's own words the linking page gives: `clubsite` keeps such a link
with its page, `contexts`, `OLive.of_day`; `SOURCE_RANK` 2; **O'Live's relays in « Analyse de course »** (owner, 2026-10-25: the CNE at Le Bessat, its splits
published on co-live.fr; relays stay out of everything else): `run.relays` makes each relay O'Live lists a race « olr<IdCourse> »
(epreuve « Relais », the organiser, place and site of the agenda's relay of that day; skipped by `races.sync`'s relay cleanup,
the merges, the club-site searches, the start lists and the platform matching), read by `OLive.read_relay` — one class per
category and leg (« RELAIS HOMMES · Relayeur 3 »), every runner of the leg, the team as their club, forked positions labelled
« 127/172 » and compared by position (the owner's choice: one circuit per leg, not per variant), places ranked from the leg
times (O'Live's leg « place » is the team's at the handover), « Ant » (a mass-started leg, kept once through) through when its
block says « Arrive » or the team has its handover total; no start times (the pages give none). Read again only when the
categories' pages move (7 pages; the read itself ~33), every 50 min on its day, once more the next day, then done. `build`
puts it in the index's `relays` (not `races`: not on « Résultats », no alert, nothing scored, no category view); only
`racelist.js` (tag « relais ») and `splits.js` (no « Résultats → ») read them; **a cancelled race** (2026-10-24: FFCO's calendar still listed both CF Sprint races, cancelled on the organiser's
site and replaced by « Sprint Labyrinthe - Le Bessat », and both took its results): a race whose organiser's pages hold a sentence
with « annul… », its name — brackets and « - WRE » apart — and its day (« samedi 24/10 » too) is marked cancelled
(`ClubSite.cancelled`, `run.mark_cancelled`, prov_meta « cancelled ») and left off « Résultats » while it has no results of its
own; an O'Live race its page leads to by the page's words only becomes the replacement, a race of its own « ol<id> » with the
cancelled race's day, organiser, site and discipline, O'Live's name and the place after its « - » (`run.replacement`), and the
cancelled race drops an O'Live document the replacement holds; **a cancellation stays once the race's day is past** (owner,
  2026-10-29: the organiser's notice taken down after the weekend brought the qualification back on « Résultats » with the
  replacement's O'Live document): `run.mark_cancelled` keeps it, and `run.cancelled_keys` also counts a race holding an O'Live
  document a replacement « ol<id> » holds and the organiser's other races of that day under the same name (qualification and
  final); the build drops such a document from any race but the replacement), SPORTident Center (2026-10-24, `sources/sportident.py`: center.sportident.com, where
SPORTident's Orienteering App, its Reader, OE12 and SiTiming publish, live and after; its public events list
`/api/rest/v1/public-events` by country and dates, each event's results file `/event-files/<guid>/results/r.1.latest.bin`, a
protobuf read by its field numbers — taken from its page's script, none of its code —: classes, courses and their sections,
entries with club, bib, birth year, card, each entry's result by section; asked again conditionally, 304 when unchanged; the
Center writes the local clock as if it were UTC; one list by course, `SOURCE_RANK` 4; a country's events matched to its own
races; « SPORTident … » or « Not assigned » as organiser counts as none — « SPORTident France » took a « Coupe de France »;
pid « <slug>?event=<id> », its page `…/results/orienteering/<slug>`; a club's link to it or to si.events read too; in France
mostly club trainings, 41 public events in 2026, a few league championships; the relay's `live/src/sportident.js`), an organiser's own broadcast (« Organisation › Direct » tied to the competition: `sources/broadcast.py`), and the organiser's site
(a short link text gets the heading it sits under — « Résultats SI » under « Régionale LIFCO, le 11/10/2026 » —, links
without an extension on file hosts or saying « Résultats / départs / Annonce » are read to find out, Cloudinary's addresses
kept in their stable form; WordPress media/posts API — a `*.wordpress.com` site through public-api.wordpress.com, and the club's other
subdomains met on the way, `new.co-lorient.fr` —, Blogger feed, up to 14 pages best-first across the whole crawl from
the race's page and the home page: pages naming the race (words, its day in any spelling, `2026/10/03` in an address)
before generic results pages, a multi-sport site's own orientation section before the rest, lists of past events,
`.html` pages visited too (Joomla); photo albums, other seasons' and other days' pages never; a subdomain's main site
too, `ocastor.go78.org` -> `www.go78.org`; redirects and meta-refresh followed). A page is « the race's » (its files
need not name the race) only when its title lines say results and give the race's day and no other day. A file named
for another day is never the race's, nor one printing another season in its title or a date before the race (up to
2 days after is fine: exports printed the next evening); an organiser's races of one weekend share its files out by
their own words, the title printed inside included (`races.owners`: « KO », « Challenge », « CL », « Chpt ligue »).
A place's compass point or qualifier (« Nord », « Saint », `races.QUALIFIERS`) is weak evidence when matching a
platform's competition (2026-10-17: « Seillon Nord » took Helga's Belgian « NORD#3 - Erpent »). FFCO's f-race and the agenda's x-race of the same day and organiser are merged (`races.merge_duplicates`, name words
≥ 80 % shared). Unreadable files a full look no longer finds are dropped. A post published in the 4 weeks before
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
no time, no status word and no punch are non-starters (« dns »), with punches mispunches. A platform competition is stored under one address
whatever a club's page spells (`run.PLATFORM_URL`, `canonical_docs`: « …?lang=fr&comp=… » made duplicates); Helga links
that name no event are dropped. **A race under way** (2026-10-23, the Pélussin City Race: a MeOSDjango read at mid-race was
listed as complete): a list read from liveresultat or a MeOSDjango site while runners are still out or yet to start carries
`live` (`model.live_state`: how many, the next start, the latest finish; MeOSDjango's own `race_state` « finished » clears it);
`run.build` marks the race `ongoing` (index and race file: the number of runners out) while it is today, no organiser's file
(upload, the club's site) is there and the latest finish is under 90 min old or a start is still to come (`run.ongoing`,
`ONGOING_QUIET_S`) — the list tags it « en cours », its page says the results are partial, and `notify` holds the « mise en
ligne » alert until it is over. **A liveresultat competition goes to a race only in its country's time zones** (`races.assign`'s `accept`, `run.lr_here`;
2026-10-30: Sweden's « Halloween-Natta » had gone to Nouméa's « Kids Halloween » by the one word they share, and the Agenda offered
its live results): the time zone its organiser declared (`getcompetitioninfo`), none = Swedish, as the live relay's `countryOf`
(`timediff` cannot tell France from Sweden), overseas France counting as France (`FR_OVERSEAS`); a liveresultat document kept
before from another country's time zone is dropped. liveresultat's splits are kept when a class's « splitcontrols » cover the course (4 or more: MeOS feeds every
control, code 1000 + number, repeats 101031…; a radio control or two are not kept). A race's documents are
shown in the order `run.doc_priority` gives (`prio`, both sites follow it): uploads and the organiser's files, then
WinSplits / Orientation Data, Helga, liveresultat last (live results are not corrected afterwards); a document with
under half the runners of the fullest one drops. A split list without start times takes them, by name, from another
document of the race (`run.share_starts`, for « Groupes »). **Start lists** (2026-10-10): for the races of the next 7 days, the liveresultat
competition assigned to each is read every 6 h (`run.start_lists`, `LiveResultat.read(startlist=True)`: status
"start"); a coming race is not listed on « Résultats » (index `soon`, `startlist`, `agenda_id`): its start list is reached from « Agenda », and its page
shows start time, current CN Top / official and the expected place; « Agenda » shows a « Liste de départ publiée » box and a « départs » tag (today's races too). **Live results from the Agenda** (owner, 2026-10-23): the index gives a race of the last day on its `live` ids (`run.live_ids`: liveresultat's number, a broadcast's, a MeOSDjango site's « host/<n> »); an event under way whose live competition the relay lists, or whose tied broadcast sent something, gets a « Résultats en direct » box (« En direct en ce moment » and a « direct » tag in the list when its last punch is under the relay's `liveS`), linking to « En direct ». FFCO's public registration
list gives only the number of registrants per circuit (`agenda.circuit_counts`, races of the next 21 days, `reg.circuits`):
the names are members-only and not read. Organisers' sites too (`run.site_start_lists`,
`ClubSite.find(mode="start")`: files named départ / horaires / liste de départ / inscrits, posted in the 3 weeks before;
races of today to +7 days, 8 sites a run, each every 6 h): read by `parsers/startlist.py` (IOF XML StartList, HTML tables,
OE12 and MeOS PDFs by column positions and section lines; never by the results parsers: a start time is not a race
time) into kind "startlist", else linked (kind "startfile"); a sheet laid out as a grid — one time column, or one per
circuit, then a « name, club » pair per circuit, the circuits' names above (organisers' Google Sheets, 2026-10-17:
O'Bugey, SpOC) — is read one circuit per column pair (`startlist._grid`; merged cells expanded by `_cells`, « Hour » and
« N° Club » headings, a club number's lost zero restored), and its title lines are the file's `head`; a start list naming
another format or weekday is not the race's (`run.not_this_race`, as for results) and one kept earlier is removed; a weekend's files go by the days they print and their
first lines (`races.owners`, « SPRINT1 » split). The result pass leaves start lists alone; they rank after results. An organiser's new start list under another
name (« …-V2-… », 2026-10-22: the old one, a runner longer, ranked first and gave its old times to the race page and the
alerts) replaces the older one when it names 80 % of its runners, and a file a complete look at the site no longer finds
goes (`run.supersede_starts`). The agenda also keeps the list's rows of the last `RECENT_DAYS` (3) days (`recent`):
`races.sync` applies them, so a race-day change (CN or not, name, place, format, date) reaches the race once the agenda
has dropped it. PDFs: MeOS's coded split list (`1 (54): 2:32 (2:32) …
Arrivée:`, CF LD 2026) is read with its control codes. Parsers
follow `prov/model.py`; bump `parsers.VERSION` when they improve (every known document is read again), and
`run.COLLECT_VERSION` when finding results improves (every race of the window is looked at once more, finished ones
too). A page or file up to 32 MB is read (`fetch.MAX_BYTES`); a file named for another year is not the race's
(`clubsite.other_year`), and a word of the club's own address does not name the race. WinSplits headers are kept
by date (70 days), not by number. No result
file carries licences: runners are matched by name + club number (`match.py`), unmatched rows stay unlinked.
Provisional scores reuse the engine's functions (`compute.py`): official = official CN J-15 and FFCO's rule;
Fit/Top = the base method's internal CN J-15, circuit value, raw score x the day's recalage factor; only lists by
circuit are scored — a list by category is scored circuit by circuit once its categories are placed (several share a
circuit): by the race's lists by circuit that give runners' categories (`run.category_circuits`), else by FFCO's public
registration list, whose « Catégories » column gives each circuit's (« B : D20/35, H40/45, Open violet »; kept as a
« registration » document by `races.save_registration` from the agenda's `reg.circuits`, expanded by
`races.expand_categories`), else by the course announcement's table when it has one (`parsers/announcement.py`:
the agenda's FFCO-hosted announcements, `annCircuits`, and those on the organiser's site found by the start-list search);
categories of unknown circuit stay unscored. Such a list also gets a view by circuit (`run.circuit_view`: categories merged,
places recomputed; the race page's « par circuit / par catégorie »); « by category » is decided at build time from the
classes (an older reading may say otherwise). The results pass keeps announcements too (races already run). A liveresultat read with a class answering badly (« Too many connections ») is dropped whole. State in the main DB (`prov_*` tables); output `site/data/prov/` (index + one file per race),
served to every logged-in user (an admin-only pilot until 2026-10-08). **Uploads** (2026-10-08; three steps since
2026-10-09; the organisers' alone since 2026-10-15, under « Organisation › Résultats »: `#/orga-resultats?course=…`,
the old `#/deposer` leads there and « Courses › Résultats » — the runners' — offers no deposit): « Déposer »
(`pages/deposit.js`, opened by `pages/orgresults.js` for a race of one's club, the race fixed) — 1. the file (IOF XML best, OE/MeOS
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
is published (owner's choice); the admin page's « Dépôts » tab lists them and removes one (meta status "removed").
**Course data** (2026-10-15): X-Upload `kind: "courses"` (default "results") is a setter's IOF XML CourseData
(« Organisation › Tracer », Purple Pen; `.xml`, 5 MB, organisers only; a race of the list or a coming one of the agenda,
`a<agenda id>`), a document of kind "coursedata" (`parsers/coursedata.py`, 3.0 and 2.0.3) — no results list: not counted
or scored, no `org_races`, an account's newer courses replace its older ones (results apart). `run.fill_courses` gives
the race's lists the length, climb and controls they lack (« #3 » placeholders too) by course name (« Circuit A » = « A »),
circuit, class assignment or identical codes (a name so identified holds in the other lists; a category view takes its
circuit's values); nothing of it is used before the race's day, its courses listed from the day after. pages « Résultats » (`#/resultats`, « Récemment » until 2026-10-12, in the
menu « Courses » after « Agenda »; `#/recemment` and `#/provisoires` still work) listing the last 60 days' races (`run.SHOW_DAYS`; 30 until 2026-10-08), and
« Temps intermédiaires », now **« Analyse de course »** (owner, 2026-10-23: the analysis was buried under a race's page;
`#/analyse-course`, route `splits`, menu « Courses » after « En direct »; `#/temps-inter` still opens it): without `course=` it
lists the site's country's races of `prov/index.json` with split times, the latest first (`pages/racelist.js`: discipline,
« Mes courses seulement », search; « ma course » where one is recognised), each opening the analysis (`splits.js`: the race's
name as title, no link back to the list — the menu is it (owner) —, « Résultats → » beside it; no race selector any more; compact (owner, 2026-10-23): the circuit and club selects above the view tabs, a view's settings on one bare line, its explanations merged into one paragraph under it — `foot`; the list has no « Voir » column); « Voir » on « Résultats »
and the race page's buttons lead there. **Live races** (`course=direct-<race>`, `livesplits.js`): the live relay's classes
(`/ws/<race>`, subscribed `"*"`) read as one document of the provisional shape in the browser (`toDoc`: status 0 → ok, 9/10 →
« run », shown « en course »; the radio controls are the controls, code % 1000 when unnamed; nothing stored); drawn once the
class asked for has come, then new times of the course shown offer « Actualiser » (no redraw under the reader's eyes; the others'
are taken quietly). « En direct »'s race page shows « Analyse → » beside the race's name (owner, 2026-10-24: where « Analyse de course » has
  its way back to « En direct ») once a split time has come, and the list's box « En
direct, avec temps intermédiaires » lists the site's country's races live now whose live gives splits (`probe`: the relay's hello
— a last passing at a radio control — else one class read; 6 races at most, each connection closed at once). Its analysis — WinSplits' and MeOS's time loss (the leg against the runner's
usual pace, signed; since 2026-10-24, owner, `trace/legs.js` `refLegs`/`usualPace`/`legLoss`, shared with the GPS analyses: the
leg's reference is MeOS's — the mean of the fastest sixth after the winner, of the two best under 12 times, the best under 5 —
and the usual pace the runner's time over the reference times on the legs without a mistake, found from the median ratio then
refined three times; before, the best leg × the median ratio, which ran 7 % slower than MeOS's pace on the Le Bessat sprint and
lost 2 640 min against 3 030 for MeOS, 2 870 now; the views' « Rythme habituel » is the same legs over their best times); a mistake = lost ≥ 20 % of the leg **and** ≥ 10 s (both adjustable); « Perdu » and « Sans temps
perdu » count the mistakes only; the Tableau keeps two lines a runner, the gap on hover (owner, 2026-10-10: as
WinSplits) — on a screen without hover a third line in every cell (`.touch-only`, `@media (hover: none)`; owner, 2026-10-23),
and « Réel / Sans temps perdu » redraws without moving the table or the page (`keepPlace`); Écarts against the superman (best legs) of everyone or of the runners compared. **After MeOSDjango** (2026-10-22;
ideas only, its GPL code never copied): the **timing check** (`splitcheck.js`, pure: a class in, findings out — a negative leg at one
control for ≥ 2 runners = its unit or the previous one off the right time, alone = a card not cleared, a finisher without a control
the others punched = punched before the start, one code twice with one time = the source's fault, that control left out) on
« Déposer » step 2 (a card « Contrôle des temps ») and above every view of « Temps intermédiaires » (the cells framed in Tableau;
`provisional.clock` writes negative times « −11:17 »); three views (`splitstats.js`): « Passages » (clock time × control,
`charts.passChart`), « Autonomie » (« Lièvre / suiveur » until 2026-10-23, owner; pairs leaving a control within T2 = 20 s, compared along the leg with each one's progress
steady between controls: weight 1 under T1 = 7 s, falling to 0 at T2, both adjustable `?f1=&f2=`; the one passing later follows;
index = time behind − time in front over the race time; followed legs barred in Tableau), « Régularité » (index = the leg's mean of
its best quarter ÷ the runner's time; irregularity = its standard deviation weighted by the reference times over the runner's
mean index — the absolute one favoured slow runners; a leg's spread with each runner's level taken out; finishers with every split).
By hand: `python -m ffco_scraper.prov --db <db>
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
actually ahead, against H21) and rank drift by number of races. Reference results of the methods before 2026-10-13:
forest Fit 82.3 %, Top 82.1 %, official 80.9 %; sprint Fit 84.0 %, Top 83.9 %, official 80.7 %.
Top linéaire vs Top quadratique (2026-10-07, 2025-07 → 2026-10, same pairs): forest 82.06 → 82.12 % (national races
82.80 → 82.80), sprint 83.94 → 84.01 % (national 82.18 → 82.11); forest scale p90/p10 2.65 → 2.57.
That duel share was the tuning yardstick (each duel counted once). **The published evaluation** (owner, 2026-10-10:
the duel counts were statistically naive; 2026-10-14: weight by runners) is `site_eval.py` -> `evaluation.json`, built by
`site_extras` when missing (a migration deletes it): **the share of duels called right, each circuit weighing its number
of runners** (per circuit p = (right + ½ CN ties) / pairs, then the runner-weighted mean = the mean over results of the
share of a runner's duels called right; Kendall's tau = 2p − 1, also stored, is the same measure on another scale), and
the share of log-time spread explained (R², pooled over results) with the slope fitted on the previous season (out of
sample); the Plackett-Luce information per runner is still computed but no longer shown. Same runners for every method,
circuits of 4+; 95 % intervals by a bootstrap over **competitions** (pairs within a race are not independent); every
season from 2012, the 2012-2024 hold-out (before any tuning) and the tuning period. Results (hold-out, Top − official,
points of duels, the arithmetic Top of 2026-10-14): forest +2.13 [2.02, 2.23] (79.19 → 81.31 %), R² +10.7 pt; sprint
+2.32 [2.03, 2.62] (81.16 → 83.48 %), R² +6.3 pt; national races +1.26 forest, +1.72 sprint; significant in 15 of 15 forest
seasons, 13 of 15 sprint (the geometric Top, then published). The linear Top published since 2026-10-16: see method 3 and
the live `evaluation.json` (pair `top6w-official`). The cubic Top of 2026-10-13
had forest +2.13, sprint +2.41, R² +11.8 / +9.7. The Top of 2026-10-13 (`top6w3`, cubic) − the quadratic one
(study re-run with the weighting, `*_n.json` in the study folder): forest +0.40 [0.35, 0.44] (14 seasons of 15),
national +0.12, R² +2.4 pt; sprint +0.12 [0.09, 0.15]; k = 3 − k = 2 forest +0.04 [0.03, 0.05] (national −0.01, not
significant), k = 4 loses on national races (−0.03 vs k = 2). The Documentation's « L'étude » reads it (forest plots by
season, pooled periods) and `site/assets/study.json`; the k-grid tables (`K_TESTS`, `K_GRID`, the quadratic circuit
value) stay as dated exploratory measurements (duels counted once), labelled as such. Say « significatif » (explained on
the page: the 95 % interval does not contain 0) only when the interval excludes 0. Documentation texts: plain, correct
French, a physical reason for each mathematical choice (owner, 2026-10-14).
Run variants with `run_method` / `derive` on DB copies with `dataclasses.replace(spec.params, ...)`.

## Conventions and gotchas

- Commit messages: a short title, a body explaining why, ending with the `Co-Authored-By` line the session
  provides. Commit and push only when the owner asks or has agreed to the change; usually: implement locally,
  test, then commit, push and confirm the CI run and the live site.
- Many files use CRLF line endings: edit them preserving line endings (read/write bytes in Python scripts).
  In Git Bash, heredocs with quotes break easily: write patch scripts to a file, then run them.
- The login page (`pages/overview.js`, public) shows on wide screens a reel of 18 slides (« Analyse GPS » and « Jeux »
  added 2026-10-14, drawn on a made-up orienteering map: `reel.terrain`, `course`; « Tracé » added 2026-10-15, a screenshot,
  `site/assets/reel-tracer.webp`, of the Tracer's editor on the games' forest map — `forestMap(20261015, {w: 900, h: 600,
  features: 1.4, relief: 28})` drawn at 3 px a unit, 300 ppp, 1:10 000 — with an invented course, taken by headless Edge over
  the DevTools protocol at 2x on a local training event and cropped to the editor: no name, no site header; « Analyse GPS »
  since 2026-10-16 a screenshot too, `site/assets/reel-trace.webp`: « Analyse solo » in full window playing an invented runner
  on the games' forest map, seed 20261016, 900 x 600 m at 2.4 px/m, an invented course drawn in purple, the routes by the
  games' path finder, a GPX with heart rate and cadence and a KMZ placing the map — scratch `reelgps/` gen_map.js, gen.mjs,
  make_files.py, shot.mjs; nothing real. The « Tracé » slide no longer names Purple Pen (owner, 2026-10-16)) (`reel.js`: drawn views of the
  analyses with **made-up figures and blurred invented names** — the page and the repo are public, never real results
  or names there; texts `reel.*` in `i18n.js`; story-like bars, ‹ ›, pause, ←/→; paused on hover, when hidden, and not
  automatic under reduced motion); a phone shows the name and the tagline above the login card only (its short text, `.home-text`,
  was removed on 2026-10-30, owner: the sections below say it at length).
- **The site in pictures** (owner, 2026-10-19; first made as a brochure for Swiss Orienteering): the home page, under the hero,
  presents the whole site (`site/assets/js/tour.js`, rendered by `pages/overview.js`; texts `tour.*` in both catalogues; styles
  `.tour-*`): a course drawn down the page — the start triangle, nine numbered controls in the menu's order (owner, 2026-10-21:
  races, the GPS analysis — a computer's picture beside a phone's, `dp` —, runner, ranking, the CN Top with its duel figures,
  clubs, training, organisers, phones; a phone among screenshots kept to a phone's size, `.tour-g-3 .tour-phone`), the finish (privacy pledges, « Créer mon compte », the demo-account
  offer) —, screenshots that enlarge on click, two drawn mockups (« En direct », the phone's notifications), the live counts of
  `meta.json`. **Its screenshots show nobody's real results** (the page is public): `site/assets/tour/<fr|en>/*.webp` were taken
  on a **scrambled copy of the data** — the R2 database copied to `C:\kerkia\cn-data\synth`, scrambled by the scratch `synth.py`
  (invented names and licences, each club code given another club's members, every time multiplied by the runner's own factor
  0.90-1.10 and a per-race noise, official CN and points scaled back, places recounted, the organisers' files likewise), then
  `update.migrate` + the provisional build on it (scratch `build_synth.py`, into `synth/out/data`), and the screenshots by
  puppeteer-core + headless Edge (from PowerShell: the Bash sandbox blocks the browser) on the local dev server with every
  `/data/` request served from that copy and the account shown as « Camille Martin » (scratch `shots/lib.mjs`, `OCN_SYNTH`). Never
  replace them with screenshots of the real data. « Analyse GPS » and « Tracé » reuse the reel's invented images;
  `tour/<lang>/phone-analysis.webp` (2026-10-21) is the same invented run (`site/data/_trtest/carte.kmz` + `trace.gpx`) in « Analyse
  solo » on a phone, full window, 280 × 606 at 2×, dark theme, by headless Edge (scripts kept with the session's scratch).
  **Keep `synth/`** (owner, 2026-10-20: the data to redo the docs, slides and pictures stays). The sessions' scratch folders
  were emptied on 2026-10-20; their scripts (`synth.py`, `build_synth.py`, `shots/`, `reelgps/`, `shot_tracer2.mjs`, the
  studies' scripts…) were kept in `C:\kerkia\cn-data\scratch-scripts\<project>\<session>\scratchpad\`. Study database
  copies and variant outputs are deleted once a study is over; the evaluations and logs stay.
- **Coupe de France des clubs** (2026-10-10): `site_extras.cfc` -> `cfc.json`, FFCO's « Classement National des Clubs »
  rule of 2026 (annexe 2: each runner's 5 best official CN race scores of the year in foot + 5 best in VTT or ski, women
  x 1.4) applied to every season (not awarded 2023-2025); unofficial: every ranked runner counts (licence type unknown),
  a runner's club is that of their last race of the year. Shown on « Comparer des clubs » (seasons of the selected
  clubs, one season's ranking). FFCO's own cup pages are gone (404); nothing to scrape.
- **Relais nationaux** (`#/relais-nationaux`, `pages/relayhistory.js`, menu « Classement » after « Clubs »; owner, 2026-10-26): the
  history of the Championnat de France des Clubs (CFC, 1999 on: its four divisions — D1-D4, then N1/N2/Promotion
  Nationale/Promotion 2007-2009, N1-N4 since 2010 — and the youth relay, the Trophée Thierry Gueorgiou) and the CNE (2006 on:
  Hommes, Dames, Jeunes, Mini-relais). Not to be confused with `cfc.json`, the Coupe de France des clubs recomputed. The
  rankings were gathered by hand from the archives on 2026-10-26 (LIFCO, archives.ffcorientation.fr, CO Mulhouse's former
  site, the organisers' files, O'Live; ~12 000 team rows): two CSVs (`year;division|category;place;team;club_code;time;status;
  source`), **results, so never in the repository**: in R2 `relays/cfc.csv` and `relays/cne.csv` (`npx wrangler r2 object put
  cn-state/relays/<file> --file <csv> --remote`; a copy in `C:\kerkia\cn-data\relays`), synced by the workflow to
  `$CN_DATA_DIR/relays/`; `relays.py build` (every run, from `update.main`) writes `fr/relays.json` when they changed. A new
  edition = its rows appended to the CSV, uploaded again. Gaps: CFC 1999-2003 the champion only (`KNOWN`), 2002 nothing,
  2004-2005 extracts; CNE 2015 a few places, 2019 ECHO 73's extract (both on Helga only, which refuses robots). Teams are tied
  to clubs (`Clubs.of`): the club number the file prints, else a number in the team's name, else the name's first words
  among those the numbered teams and FFCO's club list use (a prefix must point to one club in 3/4 of its uses; generic words
  alone never), else `ALIAS`/`TEAM_RE`; open (« OPEN », FFCO's 9998), mixed, military, league and foreign teams have no club.
  A club's place in an edition = its best team's among the clubs' teams; points 100, 80, 60, 50, 45, 40… 1 for the 30th (the
  World Cup's old scale). Tabs: Palmarès (period, category or all, points or medals; the leaders' cumulated points), Classements
  (one edition complete, gap, club place and points), Club (places year by year), Éditions (venues, field sizes, winners). The
  page shows the files' order: FFCO's official CFC podiums sometimes skip a club's lower team (said under N2-N4).
- **Relais** (`#/relais`, `pages/relays.js`, a view of Clubs; 2026-10-10): a relay simulator. A format defines its discipline
  (`relay.terrainOf`: CFC, CNE, relais de catégorie in forest; the sprint relay — 2 women, 2 men of any category, D-H-H-D —
  in sprint), whatever the site-wide one; only one's own format has a discipline selector (owner, 2026-10-12). A club that
  cannot field a team is told which criterion fails. « Coureurs ajoutés » (2026-10-12): an account adds to a club the people
  who race relays without a CN (abroad, relays only): name, sex, age group, an expected CN per discipline; they join the club's
  teams (tag « ajouté »). Saved per account and club in D1 `relay_runners` (migration 0008, `api/account/relay.js` GET/PUT),
  seen by that account only, deleted with it (the privacy page says so); without the table the page keeps them for the visit. Formats from FFCO's 2026
  rules (`relay.js` `PRESETS`: CFC N1-N4 with their composition criteria and reserved legs — the women's/men's first and
  last legs alternate with the year's parity —, CNE Hommes/Dames/Jeunes/mini, relais de catégorie) or one's own legs.
  The owner's model: a runner of CN c runs k x ref / c on a leg; k makes the best team of all clubs (CNE: the mean of
  the 5 best) total the sum of the reference times. Best team exact: every distinct matching of criteria to legs, then
  the Hungarian algorithm (checked against brute force); clubs that cannot beat the shown teams are skipped by a bound.
  Age and sex from the category (a veteran racing H21 counts as 21). The first team can be changed runner by runner, two
  legs exchange their runners (▲ ▼, or the row's grip ⋮⋮ dropped on another row; owner, 2026-10-14), and a runner of the
  club can be marked **unavailable** (the « ✕ » at the end of any team row, or the « Indisponibles » block of the added-runners card:
  out of the pool and the teams, saved with the added runners — `relay_runners.runners` holds `{ runners, out }` since
  2026-10-14, a plain list before; `/api/account/relay` reads both). **The format proposed** (owner, 2026-10-14): the link's
  `?f=`, else the one chosen last time (`localStorage ocn.relay`: format, the custom format's legs, discipline, club) unless
  the agenda's next national relay changed since, else that relay's (`relay.nextNationalRelay`: CNE → `cneH`, CFC → `cfc1`,
  Championnat de France de relais → `rcH21`, de relais sprint → `spr`; ligue and regional relays are not national), else
  `cfc1`; the format card names that relay with a link to the agenda and offers its format.
- **Jeux** (`#/jeux`, `pages/games.js`, in the menu group « Entrainement » — « Jeux » until 2026-10-14; group key `training` — in the map's course purple `--course`; 2026-10-13, administrators only until 2026-10-15, every account since (owner)): twelve training games as tabs, after the games catalogued by o-mate.app (Ben Brown's orienteering games and his MIT-licensed Rapid Route, Laby's maze; the video game skipped). **Nothing comes from those sites**: the maps are generated in the browser from a seed (`games/mapgen.js`: a forest map — relief by a height field and marching-squares contours `games/terrain.js`, vegetation, marshes, paths routed by Dijkstra, boulders/knolls/pits/cliffs/trees —, a sprint map — streets, blocks, walls with gaps, parks, olive —, and a maze), the « photos » are drawn by a height-field renderer (`games/scene.js`: one column at a time, trees and bushes scattered by a hash, the map's features and control flags as shapes). `games/path.js`: cost grid (ground cost `COST`, climb) and Dijkstra, straightened in street maps (`stringPull`), `routeCost` of any polyline. `games/quiz.js`: the common engine (puzzles, timer, answer buttons or a puzzle handling its own play, the solution shown, scoring rules `SCORING`, summary, best score in `localStorage ocn.games.best`). One module per game: Tracé rapide (draw the shortest route, sprint or maze), Mémoire de carte (ski-O track network, choose at each junction), Courbes de niveau (which profile), Montée ou descente ?, Cartes identiques, Cherchez l'erreur, Choix de parcours (knockout: 20 s of map, 5 s to choose), Variante la plus rapide (relay forking, decision time + run time), Choix d'itinéraire (fastest of 3-4 routes by `routeCost`), Mémoire photo, Trail'O (flags lettered left to right, Z when none), Labyrinthe (first-person raycaster, the map without one's position). Texts `g.*` in `i18n.js`; styles `.g-*` in `app.css`. Local test: the dev config `pages-dev-games` (port 8790) passes `--binding ADMIN_EMAILS=<the local test account>` so the games show.
- **VMA** (`#/vma`, `pages/vma.js`, menu « Entrainement » after Jeux; 2026-10-14; every account since 2026-10-15): three tabs (Méthodes first and
  opened by default, then Calculateur; owner, 2026-10-30) —
  Calculateur (demi-Cooper 6 min / Cooper 12 min: laps of a 400 m track in a chosen lane — lane 1 400 m measured 0.30 m from
  the kerb, lane n + 2π(1.22(n−1) − 0.10) m —, a 200 m indoor track or any loop, plus the last lap's metres, or a measured
  distance; VMA = mean speed ÷ the share of VMA held — 100 % over 6 min, over 12 min 95 % « bien entraîné », 90 %
  « modérément entraîné » or 85 % « peu entraîné » (2026-10-29), the level asked explicitly (owner, 2026-10-14: d/200 is the mean speed, not the VMA; no mean
  speed shown) —, VO2max = 3.5 × VMA (Cooper's (d − 504.9)/44.73 agrees within ~3 ml/kg/min at 95 %, higher beyond ~2.9 km; « d ÷ 205 », met
  on French sites with no source, would put the VMA below the speed held: not offered — owner, 2026-10-29; the time held at VMA, 4 to 11 min in Billat's studies, often ~6, and those holding it
  10-11 min estimated at 97-99 % over 12 min, from the usual fall of speed with duration — said, not offered as a level); training speeds and times
  per 200/400/1000 m by % VMA, their uses naming the usual sessions (30/30 and 1'/1' at 100 %, « VMA longue » 3 min at 95 %, 4-6 min
  at 90 %; 2026-10-29); entries kept in `localStorage ocn.vma`), Méthodes (lab, VAMEVAL, Léger-Boucher, demi-Cooper,
  Cooper, Luc Léger shuttle, 45-15), Applications (free, checked 2026-10-14: EZ BIPsVMA web app for VAMEVAL, EPS Test VMA
  for Léger-Boucher on Android and iOS; 20 m shuttle apps apart). Text inline in the module, as on Documentation.
- **The « mise en ligne » alert** (owner, 2026-10-17: from the first results, wherever they appear — the club's site, a results
  platform or FFCO): `notify.run(db, out)` posts FFCO's new competitions (as before) and the races of the last `PROV_DAYS` (4) days
  with an organiser's list of results naming a subscribed runner (the provisional index's `results` flag and `rlics`, the licences
  of the lists of results when they differ from `lics`, which counts start lists too), after every deploy, the weekend's
  `--prov-only` runs included. Each race travels with every id it is known by (FFCO's competition id, its key on « Résultats »:
  `alias`); `/api/notify` mails a race once (it looks up all its ids in `notified`, then records them), FFCO's link when both
  exist, else « Résultats » (`prov`, « résultats de l'organisateur » in the mail). **« Résultats » counts FFCO's results** too: a
  runner's own races are those they are recognised in by an organiser's list or by FFCO's (`data.runnerRaces`), « Avec résultats »
  includes FFCO's, and a race without an organiser's list links to « Courses classées »; the sources column lists the organisers' sources only (owner, 2026-10-18: « FFCO » there repeated the FFCO column), a dash for a race FFCO alone has published; the tile « Avec résultats
  trouvés » still measures the organisers' lists found.
- **« Courses » (« Courses classées » until 2026-10-29, owner; « Relais nationaux » became « Relais » the same day) by link** (`#/courses?id=`, the e-mail digest's link; owner, 2026-10-17): a race named in the address
  brings its discipline (the site-wide one switches, so the list beside it holds it, opened and marked) and, without `circ=`,
  opens on the circuit the signed-in user ran (in runner mode the runner's), else the busiest.
- Tables: a `.table-wrap` (and `dataTable`'s `.table-scroll`) scrolls within the page's height with its header row frozen
  (owner, 2026-10-12: every long table); put new tables in one. **It fits in the window** (owner, 2026-10-22: a table running below the window put its
  scrollbars beside the page's, the horizontal one out of sight — Temps intermédiaires): `fit.js` (`watchTables`, started by
  `app.start`; a MutationObserver on `#main` and the window's width) gives every such box (`.table-wrap`, `.table-scroll`,
  `.scroll-box`, `.agenda-table`) `--table-fit`, the room from its top to the window's bottom with the page at its top, else
  (under ~220 px left) the window less the site's bar, so that it fits once the page is scrolled to it; `--table-max` stays an
  upper bound. A box that overflows gets `fit-over` (a frame, its scrollbars on a track, inset in its card); a box holding
  another gets `fit-outer` and grows (one scrollbar). A box whose page sets `max-height: none` (« En direct ») is left to the
  page's single scrollbar. The race results tables — Courses classées, Résultats, En direct —
  share one format (owner, 2026-10-12): Place, Coureur, Cat., Club, Temps, then per method the CN and the score with its
  coloured gap to that CN beside it (`ui.scoreCell`, `subHead`; the score column sorts by the gap). **Frozen columns** (owner,
  2026-10-24: « freezing the right columns across the site »): the columns that say whose row it is stay in view when a wide table
  scrolls sideways — on a computer the leading narrow ones (tick box, place, rank) and the name after them, on a phone the narrow
  ones only (a table starting with a name keeps it on both, capped at a third of the screen; a runner's races: the day and the
  competition, on a computer only). `table.data` with `data-freeze` / `data-freeze-phone` (app.css « Frozen columns », up to 3;
  `ui.freezeAttrs(n, phone)`); `ui.dataTable` picks them from its columns' keys (`autoFreeze`: `rank|place|pos|rownum|sel|i`, then
  `name|nom|comp|club|runner`; `freeze: [n, phone]` overrides); hand-written tables tag themselves (Analyse de course's Tableau 2 / 1,
  its name-first views 1 / 1, Analyse multi's splits, Comparer's face-à-face, Résultats' list and start list); `fit.js` measures
  where the second and third stick (`--fz2`, `--fz3`, from the header row's widths — a stuck cell's position moves with the
  scroll). Opaque cells, the row's tint `--row-tint` over them, a line after the last; « En direct » keeps its own (`--lv-tint`).
- Navigation (superseded on 2026-10-30 by « The four modules » above; owner, 2026-10-12; « Entrainement » and « Organisation » added 2026-10-14/15; « Courses » first and the agenda as
  every signed-in account's landing page since 2026-10-21, `app.homeOf`, the brand's link too): the bar shows the groups as tabs —
  « Courses » (Agenda, formerly « Bientôt »; Résultats, formerly « Récemment »; En direct; Analyse de course, 2026-10-23), « Classement » (« Classement national »
  until 2026-10-15; Coureur, Classement, Courses classées = `#/courses`, Comparer, Clubs, Statistiques = `#/reseau`), « Entrainement »,
  « Organisation »; a group's tab leads back to the page last seen in it
  (`localStorage ocn.nav.<group>`) — a list or a view, never a tool that reopens its work (the analyses, « Direct », « Tracer »:
  `TOOL_PAGES`) nor a `?fen=1` address (owner, 2026-10-17: the memory is shared by the tabs, and « Courses » reopened « Analyse
  solo » at its calibration in full window, the menus gone; a stale memory is ignored when read). The row under it shows the current group's pages. The runner search sits at the right
  end of the page's tab row (`app.placeSearch`, `.tabs-row`) on Coureur, Classement and Comparer only (`SEARCH_IN_TABS`). One's name opens a menu: Ma page, Documentation = `#/methodes`, Réglages, Nous écrire,
  Administration, Déconnexion. On a phone the menu button lists both groups under headings (`app.renderHeader`).
- **One method at a time** (owner, 2026-10-12): `store.method` (default `official`; `store.methods` = `[method]` for the
  pages that read a list), chosen with the switch at the right of the header's second row (`ui.methodSwitch`: « Calcul du
  CN » then Officiel | Top, each with a one-line tooltip `m.<method>.tip` — owner, 2026-10-13: the buttons alone did not say
  what they chose —, a list of every available method for analysts; `?m=` in a link sets it; « En direct »'s race page draws no switch in the bar but one button
  beside its status, owner 2026-10-21: compact on a phone — the race's name once, the latest punches one line each, the course
  picker, then the table with no heading of its own); no page has a method choice of its own
  (the former `methodChips`/`methodSeg` draw nothing). After a switch the runner's CN chart shows the previous method as a
  faint grey line (`store.prevMethod`, this visit only). The results tables (Courses classées, Résultats, En direct, the
  runner's race history) show one CN column and the score with its gap; En direct: the official CN at J-15, the others'
  of today, the circuit valued with `VALUER` (Top: the Fit of the same mean). The Documentation still compares methods.
  The runner's « Historique du CN » tab is the selected method's (owner, 2026-10-14; one history, not two): FFCO's
  published history read live for the official CN (`runner.drawFfHistory`), the computed window's entries and exits for
  a Top or Fit (`cn.cnHistory`), exits struck through in both.
- **Nothing moves on a change of selection** (owner, 2026-10-12/13): a switch of method, or another runner picked on the
  Coureur page (the search, a name or a node in its « Réseau »), redraws the page in place (`app.redraw`, `goInPlace`):
  same tab and settings, no loading screen, the scroll positions kept; the back button returns to the previous runner.
- **Themes** (owner, 2026-10-12/13): five, from the lightest to the darkest — Jour (`light`), Clairière (`clearing`, the pale
  yellow of open land), Forêt (`forest`, the map's light green — a light theme since 2026-10-29, owner: the grey-green
  half-light it was looked grey), Sous-bois (`undergrowth`, dark green, deeper the same day), Nuit (`dark`) —, each its own token
  set in `app.css` (`:root[data-theme=…]`; Clairière and Forêt keep Jour's series, Sous-bois shares Nuit's series and landscape;
  the system's dark mode reaches none of the light themes), chosen under
  the moon button (`app.js` `THEMES`, `themeMenu`: a swatch of each theme's ground and one colour of its own; `localStorage
  cnx.theme`); by default light on a computer, dark on a phone (`index.html`: a coarse pointer and ≤ 900 px).
- **Look** (owner, 2026-10-12): orienteering colours used mildly (`app.css` tokens `--flag`, `--forest`, `--water`,
  `--contour`): « Classement » in the map's forest green, « Courses » in its water blue (`body[data-group]` →
  `--grp`: the group's dot and tab in the bar, the current page in the row under it, the active tab's underline), the main button
  (`.btn-primary`) in control-flag orange, contour lines behind the header's second row (`app.drawContours`, 2026-10-13: a
  relief of a few hills drawn on a canvas by marching squares in the map's brown, an index contour every fifth line, as on
  the study's page; redrawn with the bar and on resize). Logo (owner, 2026-10-19; the logo study, private artifact https://claude.ai/artifact/CSyWqbeCtWjFoLamUgwhsM, proposal 6): a
  compass bezel — a ring with four ticks — and, as its needle on a bearing of 45°, the control flag's two quarters of the
  former hourglass (top-right orange, bottom-left in the text colour); outlines always drawn last, over the fills (app.js
  `.brand-mark`, favicon.svg, tour.js; the PNG icons and badge drawn by the study's scratch `make_mark.py`; e-mails: the
  mark as `assets/mail-mark.png` beside the name with its orange O, an orange button).
- **Lean pages** (owner, 2026-10-12): where the title only repeats the menu (Classement, Courses classées, Comparer, Clubs,
  Statistiques, Agenda, the lists of Résultats and En direct: `app.isLean`), `app.leanHead` drops the title line: the page
  starts with its tabs, its buttons go to the right of the tab row (`.tabs-actions`), its text is the tooltip of its name
  in the second row (`NAV_HINT`). The runner's, a club's and a race's names stay as titles, as do Documentation and Réglages.
- **One head for every page** (owner, 2026-10-12): `.page-head` = the title, a short text on its right (`.lede`; under it on a
  phone; the runner's and the club's facts as `.lede.meta`), the action buttons at the far right, then the tabs. Pages whose
  views change the text (Statistiques, Clubs) give it `id="page-lede"` and the views call `ui.setLede` (`netmodes.netHead`
  does); no view repeats a title of its own.
- **Tabs, not long pages** (owner, 2026-10-12): a page with several sections shows them as tabs (`ui.pageTabs`,
  `tabFrom`, `bindPageTabs`: panels `data-panel`, the tab in the address as `?onglet=`, kept by `replaceQuery`; charts
  drawn hidden are resized when shown). Coureur (Courses, Calcul du CN, Historique du CN — its own tab since
  2026-10-14 —, Progression — the « Évolution du CN » chart first, then the progression against the age category: one tab
  since 2026-10-14, owner; old `?onglet=evolution` links open it —, Saisons, Carte — the map
  of the races per département —, Réseau — the runner's network, `network.ego`, moved from Statistiques on 2026-10-12;
  `link.network(lic)` and the old #/reseau/<licence> open it), Club, Comparer, Classement, Comparer des clubs, Clubs, the results panel of Courses
  classées; Statistiques' views (`netmodes.js`: Réseau des meilleurs, Territoires, Participation, Âges)
  and Temps intermédiaires' views use the same tab bar; Statistiques and Clubs switch their views in place under one head
  (`network.render`, `netmodes.modeHref`; `clubs.render`: Clubs, Ligues, Comparer des clubs, Simulateur de relais, Mon club
  — the club's page `club.js` as a view, owner 2026-10-14 —, and the open club's name when it is another club's page; the
  routes `clubcompare`, `relays` and `club` load clubs.js; the address follows by pushState). The tab bar is always right under the
  page's head, above shared filters and tiles (owner, 2026-10-12); a view's own tabs under it are smaller. Do the same for new pages. No count of
  compared runners in the navigation (owner, 2026-10-12).
- **Analyse** (`#/analyse`, `pages/analysis.js`, menu « Courses » after En direct; administrators only from 2026-10-13, every account since 2026-10-15:
  the nav entry and the route gate check `me.admin`): a runner's GPS trace on their own map for a race of « Résultats »,
  played back as Livelox does. Everything is read in the browser (`trace/`), nothing sent; only the controls' positions
  are kept (`localStorage ocn.an.cal.<race>.<doc>.<circuit>.<runner>.<WxH>`). Files, dropped together: the map (image,
  a PDF's first page through pdf.js (vendored), or a KMZ with its image), the trace (`trace/track.js`: GPX with
  Garmin's extensions, TCX, **FIT** — definition/data messages, compressed timestamp headers, developer fields skipped;
  channels altitude, heart rate, cadence, temperature, power), and optionally the map's georeferencing (`trace/georef.js`:
  KMZ/KML GroundOverlay with LatLonBox + rotation or gx:LatLonQuad; a world file + .prj, Lambert conformal conic and
  transverse Mercator inverted on GRS80, the system guessed from the numbers without .prj — Lambert 93, UTM) and an IOF
  XML 3.0 CourseData (Purple Pen, OCAD, Condes: the courses, the controls' codes and order, MapPosition in mm matched
  to the circles found by `geom.registerPoints`, Position lat/lng when the map is georeferenced). OCAD and Mapper files
  are read since 2026-10-24 (drawn by the Tracer's `tracer/vmap/`, georeferenced by their own grid; see « Computed route choices »).
  **Calibration, automatic** (owner, 2026-10-14: the clicks were too tedious, and split times are not always published):
  `trace/course.js` reads the course printed on the map — purple mask (hue 265-338°, saturated), control circles by a
  Hough vote at 20 radii on a 4 px grid, each peak refined by the share of the ring that is purple (tolerant score with
  a pixel of tolerance to accept, raw score to pin radius and centre; hollow inside, clear outside; the finish = the
  larger circle concentric with one; nearly complete rings of a control's size accepted whatever sits inside, since the
  start is often drawn in the finish), the leg lines (a straight purple run of 2.2 r* through the pixel), a control =
  a circle a line reaches (digits' loops dropped), the start = the purple blob, or a circle's centre, scoring best
  against an equilateral triangle (orientation, size, centre searched). Then `trace/align.js`: without georeferencing,
  the similarity (rotation, scale, translation) that makes the trace run through most controls — RANSAC on pairs of
  Douglas-Peucker corners × pairs of controls, scored in a chamfer distance field of the trace, the best 40 refined by
  ICP; scale bounded by the circle radius (2-3.5 mm at 1:3000-1:15000), rotation ± 30° when « carte orientée au nord »
  (a photo may need it off); then `visitOrder`: each control's passing time (closest approach), the visiting order, the
  start's departure, the finish's arrival; two passes within 15 s are one control. The published split times, when
  there are any, refine everything: detected passes paired to the official times by a DP (gaps allowed, the clock shift
  re-estimated from the pairs, outliers > 60 s dropped), then `calibrate()` = least-squares similarity + the trace's clock
  offset searched to 0.1 s (georeferenced map: the geometry is kept, only the offset searched). Without splits the
  trace's own passes give the times (legs table « d'après la trace », the start from the triangle's departure, else the
  finish's arrival minus the official total time). The user can correct anything by hand (« Corriger à la main »:
  clicks snap to the circles found, 3 points suffice without splits). Measured on synthetic data (scratch
  `gen_test2.py`: a map with the course, a 7°-rotated JPEG « photo », GPX/FIT traces with 5 m drifting GPS noise built
  from a real race's splits, KMZ, world file + .prj, IOF XML): automatic calibration 5-7 m, rotation found to 0.5°,
  12/12 controls on the clean map, 9/12 on the photo (the rest placed by hand or by the DP's gaps), all georeferenced
  inputs 7 m with the clock offset to 0.1 s. Playback: trace plain or by pace, runner with a tail, play/speed/jump by
  control, « suivre », the strip under the map (pace, plus one channel — heart rate by default), the legs table (times,
  class best, rank and time lost when published; trace vs straight distance; pace; mean heart rate and cadence).
  **Real photo** (owner's Fougères night-champs photo + FIT, 2026-10-14, 960 × 1280 px): the magenta ink photographed in
  poor light is a dark plum (r and b above g, low saturation) — the mask accepts it; thick purple (titles, class names)
  is removed by an opening before the Hough vote (`thinOnly`, 1.5 line widths; the line width is the lower quartile of
  runs); the vote floor is 8 % of the strongest peak (a letter's bowl can be the strongest); a ring needs tolerant ≥ 0.8
  or (tolerant ≥ 0.55 and raw ≥ 0.5), hollow and clear; a control circle never overlaps the start/finish symbols; the
  start triangle's sides (2.1 r*) survive the line test only with runs of 2.9 r*, and a triangle a leg line leaves beats
  the control descriptions' own start symbol. Once the trace is laid, its sharp turns with no control nearby are
  **probed** for faint rings (`course.probe`, `probeTurns`) and the alignment redone; with ≥ 6 controls the fit becomes
  affine (a photographed page is skewed). Result on that photo: 6 rings read + 4 probed of 16, fit 6 m, scale 0.47 px/m,
  the rest placed by hand (clicks snap to a ring found on the spot; « Ajouter un poste » when no split times exist; the
  trace's visiting order renumbers them, two passes within 15 s are one control); a hand-placed point counts as reached
  within 30 m. Without split times the race clock is the runner's published start time, looked up in every list of
  the race (liveresultat's gives it when the organiser's does not), else the start symbol's departure, else the finish
  less the published total. The finish on the lake
  (purple over blue) cannot be read. `window.anDebug()` in the console returns the fit, offset, targets, detection,
  view and `place(x, y)` for support and scripted tests. Playback settings (owner, 2026-10-14): the trace's width
  (« Trait »), the map's and the trace's opacity, the curves under the map as toggle chips (pace plus any of the
  file's channels, each on its own scale), « suivre » off by default, all kept in `localStorage ocn.an.prefs`; the
  view opens zoomed on the race's trace (⤢; ▭ = the whole map); during the playback the pickers and the files card
  give way to one line (« Course et fichiers ▾ » opens them above the display, which stays; changing a choice there
  starts a new calibration). No « Recaler » and no « Postes » box on the display (owner, 2026-10-14): the calibration
  is finished and approved (« Voir la course ») before it, and the rings are drawn only while calibrating. **The calibration's
  actions in a bar** (owner, 2026-10-25: « Voir la course » was out of sight at the bottom of the side panel's scrolling text):
  the panel (`.an-side.an-cal`) scrolls its text only (`.an-side-body`), every action — « Voir la course », « Corriger à la main »
  / « Refaire le calage automatique », the manual mode's buttons, « Choisir <runner> (facultatif) » — sits in `.an-actions`
  under it, on a phone fixed at the window's bottom; choosing the runner the trace fits is optional (`an.switch.hint`: it adds
  their published times, else the race is read on the trace alone). The clock runs on a timer, not on
  requestAnimationFrame, which a hidden pane pauses. **Memory between visits** (owner, 2026-10-14): the files and the
  work stay in memory while the site is open (`memo`: a visit to another page and back finds them), the files are
  also kept in IndexedDB (`ocn-analyse`) for the tab's session (a tag in `sessionStorage ocn.an.tag`: a reload
  recovers them, a new tab does not; « Oublier les fichiers » drops them), the race/circuit/runner in
  `sessionStorage ocn.an.sel` (the menu's link carries no query), and a calibration is saved in localStorage with its
  geometry and a `done` flag (v2): it comes back as it was left, hand-placed controls included — **ready, not played**
  (owner, 2026-10-15: going straight into the playback hid the files, which could no longer be replaced): the page opens
  on the files and the calibration, « Voir la course » plays it. A calibration belongs to its trace (`traceSig`: start
  time and points; a cut trace's fit was reused for the complete file): another trace starts afresh. Files dropped
  anywhere on the page, on the map during the playback too, replace the current ones (an overlay says so).
  « Refaire le calage automatique » starts afresh. **Playback layout** (owner's review,
  2026-10-14): `body.an-theatre` hides the steps, the page head and the footer — the site's menus stay as on every page
  (owner, 2026-10-15: the second row hidden and the group's tab turned into a menu confused users), and the race's line
  (« Course et fichiers ▾ », the race, runner and files with the trace's length) sits in the map's top left corner
  (`showPanels` moves `#an-brief` into `.an-map`); the map and the side panel take
  `100vh − 252px − var(--an-strip)` so a desktop screen needs no scrollbar; the side panel is a compact list (transport,
  slider, stats as dt/dd, « Affichage » folded: trace colour with swatches and a picker, width, by pace, tail,
  opacities). Trace colour default dark purple `#3b0764`, width 2.4, the part to come at 0.45 alpha; by pace
  colours the whole race, with its legend in the map's bottom right corner (`paceLegend`: the 8 colours, the paces
  where they start, rapide → lent; owner, 2026-10-15). The curves are stacked rows, all of the file's open by default
  (the former default, pace + heart rate, counts as unset), each with its scale (owner, 2026-10-15: unusable without):
  the name and unit, round ticks on a value axis (pace at round min/km, its slow end capped at 20 min/km; labels never
  overlap; owner, 2026-10-15, « cadence: only 0 and 100 »: a tick every ~16 px of a row, the range from the 2nd to the 98th
  percentile rounded to the ticks, and for pace, cadence and power from the moments in motion only - above 40 % of the
  median - so that a stop at a control touches the floor instead of stretching the scale), the value at the cursor, and a shared race-time axis; altitude green, power orange, temperature gold;
  cadence explicit (owner, 2026-10-15): watches record one foot's strides or a bike's pedal turns, so on foot it is
  doubled to « pas/min », on a bike kept in « tr/min » — the activity the file names (FIT session/sport/lap `sport`,
  TCX `Sport`, GPX `trk/type`: `track.activity`), else foot unless the race is a VTT one (`cadence`, once per track,
  after the race is matched). The legs
  table and the numbered ticks only when the sequence is known complete (`sequenceKnown`: published splits or an IOF
  course) — numbering the controls found would mislead. The view opens on the first leg (`zoomTo(legs[0], 2.4)`);
  « Suivre » is a toggle button in the transport row; moving the map by hand turns it off, paused too (it snapped back to
  the runner). A published start time is ignored for a `dns` runner or when the
  first control's pass precedes it or comes over 30 min later. **The race of the trace** (owner, 2026-10-15: « stops at
  25:01 », then « nothing until control 7 » — the page opens on the account's latest race, a sprint of the next day where
  the owner ran 25:01, and Nadejda's night trace took that time as the race's length, then its start from the finish less
  25:01): a runner's published times apply only when the trace is of the race's day and their published start falls in
  the trace (`timesApply`; else the race is read on the trace alone and the page says why, `timesNote`). A trace dropped
  for another race switches to the race of its day and the runner whose run fits it at both ends (`runFit`: the trace
  covers the published start and start + time, the least slack wins — the start alone took Romane, one minute apart,
  for Nadejda), else the account's run that day (`matchRace`, « Course choisie d'après la trace »). The views fitted on
  the trace (⤢, the first leg) keep it below the race's line in the map's corner (`topReserved`), and wait for the map
  to have a size (`pendingFit`: a zoom of 0 could not be undone). **Layout, second review** (owner, 2026-10-14): the top
  menu stays during playback (hiding it saved no height) and `an-theatre` is removed in the page's cleanup — it had
  stayed on every page; the layout is a grid filling the window (`--an-h`, `fitHeight`), the curves on the left
  (default ≥ 1100 px) or under the map (« Affichage › Courbes »), collapsible (‹ or double-click on the splitter), the
  splitters resizing the curves and the side panel (`--an-gw`, `--an-gh`, `--an-sw`, kept in `ocn.an.prefs`), drags
  followed on the window; the map keeps its centre on a resize (`lastBox`); « Affichage » open; the first leg at
  margin 1.15 + 30 px; `fitTrace` restored (dropped by c00a655: ⤢ threw during playback). The race's length: the published
  time, else the finish's arrival, else the trace's end — never the last control found (it cut Nadejda's race at
  56:31 of 1:01:39 when the finish, over the lake, was not read). The trace still to run is hidden by default
  (« Trace à venir : masquée / estompée »); the trace colour shows only for the plain trace, under that choice.
  **A trace cut short** (owner, 2026-10-15: « the trace stops before control 5 », three times — the file the page had
  ended at 26:16 of the 1:01:39 race; reproduced exactly with the FIT cut there): nothing can show what the file lacks,
  so the page says it — the one line of the playback gives the trace's own length beside its name, and the calibration
  and the playback say « le fichier de trace semble incomplet » when the trace ends a minute or more before the published
  time, or over 200 m from the finish placed (`traceShortNote`). A cut trace can also be laid wrongly (24° on the cut
  Fougères FIT: the RANSAC fits all the rings to the first half of the race).
  **The finish's arrival** (owner, 2026-10-14: the race stopped at 25:01 near control 8, far from the finish): with only
  the first controls found, a finish read (or placed) where the course runs past it gave a mid-race « arrival ».
  `track.finishArrival` (used by `visitOrder` and `coursePasses`) takes a pass by the finish as the arrival only if the
  runner then stays within 300 m of it and stops running (the trace ends within a minute, or the next minute is run at
  under 60 % of the two minutes before); else the last such pass; else none — the race then runs to the trace's end
  (shared analyses: the first pass after the last control when every control was passed). Without a start, the race
  clock is the earliest control passed (it was the first in the list, not in time: the race began 26 min into the trace).
  **Map resolution** (2026-10-14): `detectCourse`'s tolerances are in pixels and were tuned on the owner's photo at
  960 × 1280 (overprint line 3 px); a phone's photo at 3000-4000 px read at 1800 px gave 4 px lines and the title's
  letters as rings (21 « circles », the trace laid at 18°). The image is now read at the size that makes the measured line
  width 3 px (`lw > 3`: scaled by 3 / lw): the ×2 and ×3 copies read as the original, the synthetic maps unchanged.
  **The finish's double circle** (owner, 2026-10-14): ISOM draws it 5 and 7 mm across around 6 mm control circles, so
  both rings come out near a control's size — the finish is now any two concentric rings 1.25-1.6 times apart (the
  outer-only rule kept as a fallback). On the owner's photo it is not purple at all (over yellow it comes out brown,
  over the lake dark blue, a building and a path across it): `course.probeFinish` reads the lightness ray by ray (light,
  dark ring, light, dark ring, light; 36 rays, half of them and three quarters of the circle), colour-blind — found at
  2 px, score 0.75. Shape alone is not unique on a forest map (texture, knolls' contours: up to 0.72 elsewhere on the
  same photo), so it is only looked for within 50 m of where the trace ends (`prepare`, the circuit editor's `auto`).
  **3D view, a prototype** (2026-10-24, owner: after the study of World of O's 3DRerun; on branch `claude/solo-3d-view-*`, not
  merged until the owner has reviewed it): « 3D » on the playback's map (`an-3d`) drapes the map over the ground. The heights:
  `trace/terrain.js` lays a grid on the map image (its nodes at map pixels, so the image is the mesh's texture as it is; ~40 000
  nodes, a step of 5 m at least, 320 a side at most: `gridPlan`), each node's lat/lon through the calibration (`pxLatLon`: the fit to
  the trace's metres, then the trace's own lat0/lon0), from IGN's RGE ALTI in France (`elevation.json` POST, 5 000 points a request
  at most, about one a second asked — three at a time here, no refusal seen; a 7 × 7 probe first sends a map mostly outside IGN's
  model to the tiles; IGN's holes — Monaco, the sea, a border; values under −50 m are its sea — filled from the tiles: source
  « ign+tiles ») else the AWS terrain tiles (Terrarium PNGs, ~30 m, zoom 15 at most); only the map's extent is sent, never the trace;
  kept in IndexedDB `ocn-analyse` (keys `dem:v2:…`, the last 12). The view: `trace/view3d.js`, three.js 0.185.1 vendored
  (`vendor.THREE`, loaded only when the view opens; no OrbitControls — its bare `import "three"` needs an import map — so a small
  orbit of its own): the ground mesh lit softly from the north-west, the texture reduced to 4096 px on phones and small screens
  (8192 elsewhere); the trace a ribbon whose two edges each sit on the ground (a level ribbon sank into steep slopes), coloured as in
  2D, the part run, the tail, the part to come faint or hidden; the runner a dot the same size on screen, seen through hills; the
  camera an orbit (drag, right/Shift-drag or two fingers to move, wheel or pinch) or, with « Suivre », a chase camera behind the
  runner turning with their heading, never under the ground; vertical exaggeration × 1-3 (`ocn.an.prefs` `ex3d`). It runs on the
  2D playback's clock (`clockNow`: interpolated between the timer's ticks), draws on requestAnimationFrame only when something
  changed, and goes with ↗ (`d3=1`) and full window. The credit of the heights' source in the view. Measured 2026-10-24 (headless
  Edge, Intel GPU, the invented test files): IGN grid 181 × 121 nodes at 5 m in 4.2-5.3 s (5 requests), 232 × 174 at 8.7 m in
  12.6 s by Monaco (IGN + tiles), cached: at once; 60 fps at 1280 × 800 and on a 390 × 844 phone viewport (pixel ratio 1.5), under
  1 ms of CPU a frame; three.js 751 KB (187 KB gzipped), the three modules 47 KB. `window.anDebug3d()` gives the grid and the
  frame stats. **The map's own contours** (`trace/contours.js`, « Relief › + courbes de la carte (essai) », off by default; the
  owner's question): a brown mask (red strongest, green about half, blue low and under green), thin lines only (course.js's
  opening), pieces ≥ 12 m long and across; each piece's level from the model along it, tied to its neighbours (pieces crossed one
  after the other along rows and columns step by what the model says: 0, ±1 or ±2 intervals; index contours, ~1.6 × wider, every
  fifth interval), the offset from the model's own heights along the lines; the surface = the model + a correction exact on the
  lines, a membrane between them solved coarse to fine. Measured on synthetic O-maps drawn from IGN's 2 m heights (5 m contours,
  index lines, paths, text, boulders, overprint; scratch `site/data/_trtest/contour-exp/`, git-ignored), RMS error to IGN's model
  with the mean bias removed: over the 30 m tiles, Vosges (250 m of relief) 4.36 → 2.52 m, Vercors (170 m) 7.03 → 4.61 m,
  Fontainebleau (26 m) 3.93 → 3.84 m (unbroken lines: 1.61, 3.74, 3.51); over IGN at 5 m nothing gained (0.34 → 0.27, 0.33 → 0.96,
  0.07 → 0.06) — in France the contours are mostly drawn from that same LiDAR; small features (knolls, re-entrants: the height
  less its 40 m mean) never better than the model (the membrane terraces between lines, a level off by one makes a step). On real
  maps (Purple Pen's OCAD tests rendered, against their own vector contours): Penistone Hill 97 % of the pixels read are contours,
  87 % of the contours read; Clouds 80 / 81 %; Ft Casey (1:5000) 86 / 77 %; twice as many pieces as contour objects (paths and text
  break them); Lake Sammamish's brown renders as rgb(128, 0, 0) and is not read. Not done: form lines (dashed half-interval lines,
  read as full contours), a map's brown learnt from the map itself, vector sources (OCAD/OMAP through `tracer/vmap/`, symbols
  101-103, or a PDF's brown paths: exact lines, the next step), Analyse multi.
- **Organisation › Direct** (`#/orga-direct`, `pages/orgdirect.js`; every account since 2026-10-15, owner — administrators
  only the same morning): an organiser feeds « En direct » from their timing software without liveresultat. **The page in three steps** (owner,
  2026-10-25: the MeOS and the file instructions were one block, « Le jour de la course » read as MeOS's too): 1. the race, 2. the
  sending — « Votre logiciel » MeOS | another (an exported file), only the chosen way's instructions and controls shown (`showVia`,
  `ocn.direct` `via`; default MeOS once it sent to the race) —, 3. « Résultats » after the race (the competition tied, « Publier
  maintenant »); the GPS tracking card apart; texts `content/orgdirect.*.js` `overview`, `meos`, `file`, `after`, `common`. The software exports
  its result list to a file every few seconds; the page, open on the arena PC in Chrome or Edge (File System Access API: the
  file is chosen once, its handle kept in IndexedDB `ocn-direct`, a reload asks one click), re-reads it on a timer run in a
  small Worker (hidden tabs slow their own timers), reads it in the browser (IOF XML 3.0 by its own reader `iofLive`, which
  keeps the runners still out and their splits; OE / MeOS HTML by `localparse.parseBytes`), turns it into liveresultat's
  compact class form (`toLive`) and posts only the classes that changed to `/api/live/push?id=`. Nothing is declared
  beforehand: classes, controls and runners come from the file. A broadcast is opened by name, date and organiser
  (`/api/live/broadcasts`) and numbered from 900 000 000 (liveresultat's ids are far below), registered by the live server's
  `Directory` object; each race is a `LiveRace` object that, for such numbers, never reads liveresultat and keeps what is
  pushed (one storage key per class), pushing changes to the pages watching as for a liveresultat race. O'CN reaches both
  objects through Durable Object bindings to its live relay `ocn-live` (`live/`) (`wrangler.toml` LIVE_RACE, LIVE_DIR) at internal paths (`/push`,
  `/broadcasts`) that no public route forwards (`functions/_lib/live.js`). Any account opens a broadcast (10 a day at most),
  and only the account that opened it, or an administrator, feeds it (`by`, the account's id, is never sent to others: the
  list says `mine`); the page lists one's own. « En direct » lists the last 3 days' broadcasts that sent something (and
  one's own before their first send; all to administrators). Local test as a regular account: launch config
  `pages-dev-user` (8792, ADMIN_EMAILS overridden). The live relay
  (`live/`) is deployed by hand. Local test: launch configs `ocn-live-dev` (8786) and `pages-dev-games` (8790; the local Pages
  dev binds to the running relay); `iofLive` / `toLive` are exported for checks.
  **MeOS pushes itself** (2026-10-22, after reading MeOSDjango — GPL, ideas only; MeOS's own `onlineresults.cpp` /
  `infoserver.cpp` read for the protocol): MeOS's service « Résultats en ligne » (« Online Results », tab « Services ») posts the
  MeOS Online Protocol (MOP 2.0: `<MOPComplete>` then `<MOPDiff>`, in chunks of 64 elements, zipped above 1 KB by default) to
  `/api/live/mop` (`functions/api/live/mop.js`, public in `_middleware.js`: no session) with headers `competition` (the broadcast's
  number; another number, 0 or empty: found by the password alone) and `pwd` (the broadcast's MeOS password, `mop`: 16 letters,
  made at creation or by « Nouveau mot de passe », POST `{ op: "mopkey", id }`; GET gives it to the opener and administrators only).
  Answers `<MOPStatus status="OK|BADCMP|BADPWD|NODATA|NOZIP|BADXML|ERROR">`. The body goes unread to the race's object (`/mop`),
  which reads it (`live/src/mop.js`: a small XML reader, the zip's first file by DecompressionStream), keeps MeOS's state —
  head `mop:h` (competition, controls, classes with their radio controls per leg, clubs, each runner's and team's class), each
  class's runners and teams under `mop:c:<id>`; card numbers not kept — and passes the classes touched, in the compact form, to the
  same `update` as the page's push (`prune`: classes MeOS no longer has go). MeOS status codes → liveresultat's (1 OK, 3 PM, 4
  DNF, 5 DSQ, 6 OT, 20/21 DNS, 2/15/99 NC; 0 = out when `competing` or a punch, else the start time decides); `prel="true"` (a
  radio finish before the card is read) is the row's 10th field, « provisoire » on « En direct ». Split times: the class's
  `radio` list (the controls ticked in the service); with « Envoyer tous les poinçons après lecture de la puce » it is the whole
  course and every split comes at the card's readout. The relay's ticker holds radio punches too (each at start + time), a
  runner seen for the first time being no news (the first send spans several pushes). The page's card « 2. Depuis MeOS »: the
  address, number and password with copy buttons, MeOS's last message (`mopAt`, `mopRunners`, from the directory's `touch` with
  `via: "mop"`). Tested locally with a simulated MeOS (scratch `mop_test.mjs`: chunks, zip, prel → readout, MP, deletion, a
  renamed class, a relay team, wrong password and number).
  **« En direct » estimates** (2026-10-22): a runner still out shows « arr. ≈ hh:mm » — start + their time at the last radio
  control ÷ the finishers' median there × the finishers' median time (the median time without a punch; 3 finishers at least;
  `live.js` `usualOf`, `eta`).
  **A broadcast published in « Résultats »** (owner, 2026-10-23: Ozimut's own answer to MeOSDjango's results sites, the
  dependency gone — a club sending MeOS to Ozimut keeps its results, splits and start list after the race; no public page,
  every account sees them, the CN columns for France's members as elsewhere): a broadcast is tied to a competition — at its
  creation (« Compétition »: the club's of France's agenda from yesterday to a week ahead, an administrator's all, or one
  declared outside France) or later (POST `{ op: "link", id, race }`, null unties) — by its organisers only
  (`api/live/broadcasts.js` `raceFor`: `_lib/club.js` `findRace` + `organises`, 403 « not organiser »); the directory keeps
  `race` and the competition's name, day and organiser. `mop.js` and `push.js` pass it to the race's object (`X-Race`), which
  saves the broadcast to R2 (relay binding `BUCKET` → `cn-state`, `live/wrangler.toml`) as `broadcasts/<number>.json` — the
  competition's key, its info, every class in the compact form — by its alarm, `SNAP_MS` (2 min) after a change (a pushed
  race's alarm serves nothing else), and at once on « Publier maintenant » (POST `{ op: "publish", id }`: the object's
  `/snapshot`, then a `prov` run by `upload.startRun`) or a relink. The workflow copies `broadcasts/` to
  `$CN_DATA_DIR/broadcasts`; `ffco_scraper/prov/sources/broadcast.py` makes each a document of its competition, source
  « direct » (`SOURCE_RANK` 5, as the organiser's site; « Diffusion en direct de l'organisateur » on the race page): its
  results once someone has finished (url `direct:<number>`; the runners still out counted in `live`, so the race shows « en
  cours » and the « mise en ligne » alert waits; with nobody out it counts as the organiser's final file), before that its
  start list (`direct:<number>/start`, kind « startlist »: the agenda's box, the start-time alerts; an organiser's deposit
  under « Horaires » wins); split times only for a class of 4 controls or more (MeOS's « all punches », or an export with
  them). An untied or retied broadcast takes its documents away from the former competition; a competition not yet in
  `prov_races` is tried at the next run. Tested locally end to end (scratch `e2e.mjs`: creation with a race, MeOS entries →
  start list, finishes → results with one runner out, publish, untie, relink, the page's own push, the alarm's save; the source
  and `run.build` on a test database) — not yet with a real MeOS.
  **MeOSDjango races** (2026-10-23, owner: the Pélussin City Race was live there and not on « En direct »): the relay lists the
  races of the MeOSDjango sites (`live/src/meosdjango.js`, `HOSTS` — append only: a race's number is 800 000 000 + the site's
  place × 1 000 000 + its competition number) of the last 3 and next 7 days beside liveresultat's, today's probed for their last
  punch (a few courses a call, `MD_LIST` requests at most; `MAX_INFO` lowered to 25 for the subrequest limit), the site's
  address named in the list. The race's object reads every course's JSON while someone watches (20 s while punches come, 60 s
  quiet, 5 min once the site says « finished »), one class per `class_name`, MeOS's « FAMILY, Given » turned round, and passes
  them to `update` as a broadcast's push. In `update`, a card read at the finish (the finish and over two splits new at once:
  MeOSDjango, MeOS's « all punches ») puts its finish on the punches' line, not every control; many splits new at once for a
  runner already through (a card read later, a mispunch) put nothing there.
  **O'Live races** (2026-10-24, owner: the CF Sprint, cancelled, replaced by « Sprint Labyrinthe - Le Bessat », live on
  co-live.fr): the relay lists O'Live's individual races (`live/src/olive.js`, `HOSTS` append only, numbers 700 000 000 + the
  site's place × 1 000 000 + its IdCourse; its address where the organiser goes: O'Live gives none), today's probed two circuits a
  call (`OL_LIST` requests; `MAX_INFO` lowered to 21), a race live while someone was seen « Run. » under `LIVE_S` ago — with a running time that moved since that page's last probe (`outSig`, `relayOutSig`, hashed in the probe's `sig`: a runner never cleared keeps a frozen « Run. » once O'Live stops importing; 2026-10-25). HTML only,
  no API: the race's object reads every circuit's results page (`OL_MAX` 24, the others in turn) — one class per category, a
  category on several circuits one per circuit —, then the cards (bloc.php `PointagesPuce`: each punch's time of day, so the
  exact start) of the runners through since, those just finished first (`OL_CARDS` 15 a wake-up), or for a backlog (a race
  joined under way) the circuit's split times page at once (`OL_BULK`; a page O'Live fails to make — A1 at Le Bessat, a PHP
  error — is not asked again). A runner out has a start estimated from their running time, which O'Live counts at its last
  import (frozen up to a minute): their start while waiting (« 12 h 46 »; « 00 h 00 » none) or their card's replaces it. « Arr »
  (finished, card unread) is a provisional result, « Arr? » not classified. 20 s while runners are out or cards wait, 60 s with
  only starts to come, 5 min after. The Agenda maps both ranges to « host/<n> » (`keyOfComp`, `run.LIVE_IDS`).
  **O'Live relays** (2026-10-25, owner: the CNE at Le Bessat; listed since, `isRelay` by the list's type « Course en Relais »;
  « Résultats » still leaves relays out): `readOlRelay` reads each category's page (« Ant », a leg sent off by the mass start, stays on the leg and its team once through: out only while it has no handover total, or, a team missing a leg, while its block is not « Arrive » — 2026-10-25, the CNE showed « live » all evening; `?Action=Result&IdCat=`, `relayCats`; up to
  ~470 KB, ~30 ms to read all six), a category with nobody out or to start again every 5 min only; `relay()` reads each team
  (place, bib, name, time so far, state, its place after each leg) and each leg (runner, leg time, place, state, the team's total at
  the handover); the legs sorted by their own numbers: O'Live's page does not always list them in order — « Cobs Dames »
  1, 2, 4, 5, 3 with its 3rd runner absent). `compactRelay`: one class per category, a row per leg's runner — leg place, leg time and gap to the leg's best,
  the leg's start, and a 11th field [team bib, leg, team total, team place, gap to the first team there] — and the class's `relay`
  { legs, teams: [[bib, name, place, total, status, gap, legs done]] }, which `update` keeps and compares (counts by team). No
  cards read: a leg's start is its team's start (the earliest seen from a runner out, now less their running time; `m.ol.t0`)
  plus the team's total before it, or what is seen when over 2 min apart (a mass start). « En direct » (`live.js` `relayTable`;
  owner, 2026-10-25): each team one line, a button (`.lv-tbtn`, kept to the visible width: its rank — at the finish, else after
  the last team in, in race order —, its name, its total at its last handover, ticking before the first) that opens its runners
  (`st.openTeams`, kept over the updates; a runner searched for, or picked in the club views, opens their team, marked and
  centred); racing teams grouped by the leg being run (« Relais 6/7 », the furthest first, then by the team's total — not a
  leg's own: a mass-started leg's total is lower); a team with a runner PM, abandoned, disqualified… is not ranked
  (« Non classées », at the bottom, under that runner's state). A runner: leg number, runner, start, leg time with its place and
  gap, the team's total and gap to the team O'Live ranks first there, « Rang » (the team's place when that runner came in),
  category (from the data), CN. Every redraw keeps the row tapped, else the row marked, else the first row in sight, where it was
  on the screen (`anchor` / `restore`; `overflow-anchor: none`: updates and taps scrolled the page). A runner's line opens their times at the
  radio controls (owner, 2026-10-25: as O'Live does; no link to the runner's page there): control, split, time from their start,
  place and time behind the first there, the finish last — O'Live's card readout (bloc.php `PointagesPuce`, `ol.punchList`), read
  by the relay when a page asks (`{ punch: { c, k } }` over the WebSocket → `{ t: "punch", rows }`; kept 20 s, one read a socket a
  second), by the leg's card number the category's page gives (`relay()` `card`), kept by the relay under `olc:<category>` and
  never sent to the pages; a runner out has a card once a radio control saw them. No score or
  expected place; the punches say « Fin du relais n » before the last leg (`legEnd`). Club views and the search use the rows.
  In the club views a runner PM, disqualified or over time counts as arrived (`ARRIVED`: listed after the classified of their
  course, their state in the time column; owner, 2026-10-25) A name in the club views opens the runner's
  circuit (a relay's: their team) with their line marked and scrolled to (owner, 2026-10-26; the runner's page no longer). A name in
  a circuit's table opens a window over the page (`openPop`, a `<dialog>`) about the runner, not what the table already says
  (owner, 2026-10-26): for the method chosen in the header only, one block per discipline the runner has a value in or raced in
  over 3 years, the race's own first (`TERRAINS`, `factsOf`): the value today, the place overall and in the category
  (`loadRanking` at the latest month), races and PM rate over 12 months, podiums and wins over 3 years; then their times at
  the radio controls; ✕, « Fermer », Échap or a tap beside it close it; « Sa page complète » opens the runner's page in a new tab,
  not offered in the app installed on a phone
  (the page left « En direct » with no way back in the installed app). **The official CN J-15** (owner, 2026-10-26: a runner's CN
  in « En direct » was their CN after their race of late August, their page showed today's, FFCO's J-15 lay between): the official history is FFCO's CN after each race **and the CN J-15
  FFCO printed for each race, dated 15 days before** (`build_site` `off_events`: FFCO's CN also moves between races, a race leaving
  its window, which only the next race's CN J-15 tells), and the build writes `snap/official_j15.json` (the official CN on the
  build day − 15, per discipline), which « En direct » uses when the race's J-15 is within 3 days of it, else the month-end before.
  **The official CN computed by day** (owner, 2026-10-26): in forest and sprint, while a runner's 12 months hold 2026 races only,
  the snapshots and that file compute the official CN from FFCO's race points (`build_site.off_value`, `cn.ffco_cn`; `cn.js`
  `trimmed` alike): the best 10 % and the worst 40 % dropped (rounded half away from zero), the mean of the rest **without its
  zeros**, 2 races for the CN FFCO publishes (its CN page: « Pas de CN : pas assez de course » with one; the snapshots), 1 for
  the CN J-15 it prints to value circuits (`official_j15.json`) — a race leaving the window then shows on its day, as in the
  Ozimut index; a window of zeros only has no CN (FFCO's page alike; the published values had kept the last one). FFCO prints a
  « nouveau CN » after a race when the window holds 2 races or more (3 616 of 3 624), never with one (1 200 of 1 200). FFCO
  trims the window again every day, but **a window a race leaving it brings down to one race keeps a CN — that race's points —
  only if the race counted in the CN computed after it** (not among the worst 40 % dropped then; `build_site.counted`: the CN
  FFCO printed after it is not above its points, else ranked against that window's races, the 2025 ones on their old scale).
  Found by reading FFCO's CN page at 30/09/2026 for every runner whose window held one 2026 race (owner, 2026-10-26: 1 037
  pages, 148 with a CN): this rule 995 exact, « 2 races or none » 86 %, the published values 802; windows of 2 races or more
  that lost a race since their last (150 pages): the daily trim 135 exact, the published values 14. The misses: races FFCO
  processed after the earlier race had left (a race of 20/09 with a 2025 race leaving on 22-28/09), its re-evaluated 2025
  points, races the database lacked. Measured against what FFCO
  prints (the 2026-09 database, 2026-only windows): the CN after a race 2 005 / 2 008 in forest, 387 / 387 in sprint; the CN J-15
  — the CN at the end of the race's day − 15, races of that day included — 1 067 / 1 068 and 100 / 100 (the misses: a race whose
  points FFCO changed). A window still holding a 2025 race keeps FFCO's published values: FFCO re-evaluated last season's races on
  its 2026 scale under new circuit ids, whose points only each runner's CN page gives (the old points match 9 %). VTT and ski
  keep the published values (no 2026 race in the database measured). Each build prints the match (« official CN computed
  against FFCO's »).
  **SPORTident Center events** (2026-10-24, owner): the relay lists the Center's public orienteering events of the last 3 and
  next 7 days, every country (`live/src/sportident.js`, numbers 600 000 000 + the event's id; its country from the event), today's
  probed by a HEAD of the results file (`SI_LIST` requests a call; `MAX_INFO` lowered to 17), the age being the time since the
  file last changed. The race's object asks the directory for the event's file (`/si?id=`), then reads it again with its ETag
  (a 304 costs nothing): 20 s while it changed in the last 5 min, 60 s with runners out or to start, 5 min after; one class per
  SPORTident class, splits and places at every control, « finished » not yet evaluated shown provisional; the event's time zone
  passed to `update` (`info.timezone`, otherwise Europe/Paris). The Agenda maps 600 000 000-699 999 999 too.
- **IA** (`#/ia`, `pages/ask.js`, menu « Classement » after Statistiques; owner, 2026-10-15; administrators only the first
  day, **every account since 2026-10-16** — 15 questions a day per account on the free model, administrators apart, `PER_DAY`
  in `api/ask.js`; the other Workers AI models of the menu are the administrators' tests): a question in plain French answered with a table, a chart or a few figures. A language model on **Workers AI**
  (`functions/api/ask.js`, binding `AI` in `wrangler.toml`; the account's free allowance, 10 000 neurons a day shared by the
  whole account — past it the calls fail until the next day, nothing billed on the free plan) turns the question into ONE
  DuckDB query and says how to show it (`functions/_lib/ask.js`: `TABLES`, the tables described for the model — keep them in
  step with `site_ask.py` —, `systemPrompt` with its rules and one worked example, `parseAnswer` tolerant of the models' JSON
  slips). The browser runs the query with **DuckDB-WASM** (1.32.0, vendored: the « eh » engine only, in two parts the page joins) on `site/data/ask/*.parquet`, loading only
  the tables the query names (`cn` 2.7 MB and `runners` 0.4 MB for most questions; `results` 8.8 MB): **the model never sees
  the data**, only the question, the tables' description, the asker's licence, today's date and the site's method and
  discipline. `checkSql` lets only one read run (no other statement, no file, no address); a query that fails goes back
  to the model once with its error. « Préciser cette réponse » sends the previous question and query with the next one.
  Model: `@cf/openai/gpt-oss-120b` at low reasoning effort (tested 2026-10-15 on 20 questions, scratch `ask_eval.py`: 19/20
  ran, about 105 neurons and 10-20 s a question, so roughly 90 questions a day for the whole site); Qwen3-30B was cheaper
  (57) but ignored the rules, and DeepSeek V4, Kimi and GLM 5.3 are not on the free plan. The models' mistakes found and
  answered in the prompt: columns that do not exist (cn has no category or season), disciplines mixed in one value,
  percentiles computed within the club instead of over France. 40 questions an hour per account (200 for administrators).
  The tables carry what the site publishes (anonymised runners included; the official CN and the CN Top only, not the
  analysis methods); nothing is stored; the privacy page's « Questions à l'IA » says where the questions go.
  **Own API key** (owner, 2026-10-15): « Votre propre clé d'API » lets a user pick OpenRouter, Anthropic, OpenAI or Google and a
  model, with their key (`site/assets/js/askbyok.js`: each provider's model list — OpenRouter's is public, 463 models on
  2026-10-15 with 18 free, loaded as soon as it is the provider; the newest of the preferred family suggested — and its call;
  errors in plain French). The models are a menu (owner, 2026-10-16: a text field with a suggestion list showed one model
  only, the browsers suggesting what contains the field's text): OpenRouter's free ones first, then one group per maker,
  newest first, with the price per million tokens; a filter above it, which keeps the user's pick. The browser
  calls the provider itself (all four accept it: checked with a dummy key, each answers a readable refusal); O'CN's server
  only gives the instructions (`/api/ask` with `promptOnly`: the messages, no model call, no quota), so the key never reaches
  O'CN. Kept in `sessionStorage ocn.ia.byok`, or `localStorage` with « Se souvenir », dropped by « Oublier la clé » and at logout
  (`auth.logout`); requests to the providers omit cookies and the referrer. The answer is read by `askparse.js`, shared with the
  server. The privacy page says where the questions go (« Questions à l'IA »). Tested with each provider's replies simulated
  (request shape, parsing, cost from OpenRouter's `usage.cost`); a real key is to be tried by its owner.
- **Category percentile and PM rate** (owner, 2026-10-15): `ranking.loadRanking` gives each row `pct[m]`, its percentile in
  its category over all of France at that month (percent_rank: the share of the category's ranked runners with a lower CN;
  100 = the best; `data.fmtPct` shows whole numbers), before any filter; « Classement » shows it as « Centile cat. » and the
  club page's « Membres » too, both sortable. The PM rate (`data.pmRate`: the share of « pm » among a runner's races of the
  discipline in the 12 months to the latest data) is the members' « PM 12 mois » column (since 2026-10-23 from the club's own
  file, `pm` {licence: {terrain: [n, pm]}} by `site_extras.member_pm` — it read every member's race file, up to a hundred
  requests a club; a member the file does not list still from their race file — filled in place) and the runner page's « PM sur 12 mois » tile (beside « Courses sur 12 mois »).
- **Catégories** (`#/categories`, `pages/categories.js`, menu « Classement » after « Classement »; owner, 2026-10-18, after a
  mockup on real data): at a month-end (`?date=`), for the site's method and discipline, each class's CN spread on one axis —
  a band from the 10th to the 90th percentile, the middle half darker, the median (white tick) and the mean (◆) —, women and
  men side by side per age (`?sexe=` D or H for one), the axis from a round value under the lowest band; the D21 and H21
  medians as dashed lines (`?ref=0` hides them). **The best of each class** (owner, 2026-10-18, second rule; one rule everywhere,
  written under the chart, `cg.rule`): in each class of at least 5 ranked runners (`MIN_SHOWN`), its best 2 % rounded down
  (`TOP_SHARE`) and at least its first, equal CNs at the cut all in — forest Top 62 runners (1 to 5 a class), sprint 31, VTT 25.
  The first rule (above Q3 + 1.5 × IQR, top 5 %, 20 runners or more) followed each class's spread: a D65 leader at 1.84 × her
  median was out while an H55 third at 1.63 × was in, D18 and women's veteran classes had nobody. Classes of 5-19 drawn pale
  (less certain percentiles). They are dots (a click opens the runner) and a table, by class then rank by default: CN, class
  rank (« 1er sur 76 »), × the class median, percentile in D21 / H21 (the share of that class below their CN).
  runner is ringed on their class's row; « Mon club » (`?club=1`) rings the club's runners. All computed in the browser from
  `loadRanking` (the monthly snapshots); the Documentation's « Les calculs du site › Coureurs » explains it.
- **Vocabulary** (owner, 2026-10-14, as the World Ranking separates them; renamed 2026-10-19): a race's points are the
  « score Ozimut » / « score officiel » (`ui.scoreLabel`, i18n `score.*`; « score Top » until 2026-10-19), a runner's ranking
  value the « indice Ozimut » / « CN officiel » (`ui.cnLabel`, `ui.cnWords`, `cn.*`; « CN Top » until 2026-10-19); the
  header's switch is « Classement : Officiel | Ozimut »; the Top's circuits are valued on the runners' « niveau habituel », which regular users never meet as a method —
  for analysts it is the « CN Fit » (it shares the Top's scores; the linear pair has its own « score linéaire »); the
  documentation never says « Fit ». The results
  tables' headers, the runner page's tiles and cards (`rn.current`, `rn.best`, `rn.calc`, `rn.cnHistory` take `{cn}`), the
  switch's tooltips and the documentation use these words.
- **Documentation** (`#/documentation` since 2026-10-24, `#/methodes` before and still opened, rewritten; `pages/methods.js`, title
  « Documentation », `page.methods`). **Since 2026-10-24 (owner: the page told the methods, not the site)** its tabs are « Le site »
  (the menus, country and language, account and alerts, the phone), « Courses » (Agenda, Résultats — the provisional scores —,
  En direct, Analyse de course — the split times' calculations —, the GPS analyses), « CN officiel » (France), « Méthode
  Ozimut », « Coureurs et clubs » (the former « Les calculs du site » less the split times, France only), « Entraînement »
  (Jeux, VMA, Analyse solo, Analyse multi), « Organisation » (who organises, Résultats, Horaires, Direct, GPS tracking, the
  multi analyses, declared competitions, the course setting) and « Le tracé »; the guide's four are `content/guide.fr.js` /
  `.en.js` (`build(X)`, the same chapters in step). « L'étude » has a panel but no button: the Ozimut method's tab leads to
  it (a notice after its lead) and it leads back; `?onglet=etude` still opens it; `?onglet=calculs&voir=resultats` opens
  « Courses › Analyse de course ». A country without a ranking of its own (Switzerland…) shows France's figures under a note
  (`data.countryJson`, `doc.country.none`). Before 2026-10-24, four tabs — « CN officiel » and « CN Top », each
  method's rules and formulas, facts only; « L'étude », the white paper in ten chapters (objectives, the point of departure,
  the measure, the base choices, the score and its mean, the circuit's value, the recalage, the results, the alternatives
  discarded, the conclusion) with the figures that support each decision, drawn as SVG from `site/assets/study.json` (the
  study of 2026-10-13's aggregate numbers, built by the scratch `study_json.py` from the evaluations under
  `C:\kerkia\cn-data\study`; public, nothing personal) and from the live `evaluation.json`; « Les calculs du site » (clubs,
  coureurs, réseau, résultats et temps intermédiaires, relais, limites). Chapters are a second row of tabs (`?voir=`); the old
  tab names (`essentiel`, `detail`, `analyses`, `autres`) still open the right tab. The page's texts are in the module (French), written for orienteers who are not mathematicians (owner, 2026-10-14): plain sentences, both sides of every comparison, each term explained with numbers, one worked circuit of six runners (`RACE6`, F got lost) used on every tab, the dated exploratory tables folded away (`more`).
  The PDF white paper (`site/assets/ozimut-methode.pdf` / `.en.pdf`, « La méthode Ozimut », public, linked from the study;
  `build.py` also writes copies under the former names `ocn-methode-top*.pdf` for old links) is LaTeX: `docs/whitepaper/`
  (`methode-ozimut.tex`, `figures.py` → `fig/*.pdf` and `tables.tex` from `study.json` and the study's evaluations,
  `build.py` runs it all with MiKTeX — per-user install, `winget install MiKTeX.MiKTeX --scope user`, packages fetched on the
  fly). Rebuild and commit the PDF when the study's numbers or texts change; the deploy serves it as any asset.
- **Every page for every account** (owner, 2026-10-15): « Entrainement » (Jeux, VMA, the analyses), « En direct », the
  analyses under « Courses » and « Organisation » (« Tracer » included, confirmed by the owner the same evening: what an
  event shows still depends on its team, not on the account's rights) were for the administrators (or the `users.live` right) until then;
  the gates are gone from `app.js` (the right stays in D1, unused). The admin page alone stays the administrators'.
- **Organisation** (menu group `orga`, the control flag's orange; owner, 2026-10-15): the organisers' pages —
  « Compétitions » (`#/orga-competitions`, route `orgRace`: the competitions of the last 60 days organised by one's
  club, one multi analysis each, « Ouvrir l'analyse multi » then its circuits), « Entraînements » (`#/orga-entrainements`,
  `orgTraining`: one's training events, « Nouvel entraînement »), « Résultats » (`#/orga-resultats`, `pages/orgresults.js`:
  the club's races with what « Résultats » shows of them, « Déposer les résultats » = `#/deposer?course=…&orga=1`), and
  « Direct » and « Tracer » (below). **An organiser** is a member of the
  race's organising club — the club of the account's latest race in the site's data against the race's `org` number
  (`functions/_lib/club.js`: `clubOf`, `orgCode`, `raceOf`) — or an administrator; any account may create a training
  event. A competition's analysis is created by its organisers only, once (a second ask returns the first, `existing`),
  and every member of the organising club manages it (`meta.orgClub`, `isOrganiser`). An organiser's results deposit
  (`X-Upload` `organiser: true`, checked the same way, 403 « not organiser » otherwise) is noted « déposé par
  l'organisateur », and its race is no longer looked for on the club's site or the platforms (`prov_meta` `org_races`,
  kept by `sources/upload.apply`, skipped in `run.run`'s loop): the organiser's file is used as it is.
- **Organisation › Horaires** (`#/orga-horaires`, route `orgStarts`, `pages/orgstarts.js`; owner, 2026-10-18): an organiser deposits
  the start list of a coming competition of their club (the agenda's competitions of today to +90 days, relays apart; administrators
  see all). Files: IOF XML StartList (best), CSV (a header row then a runner a row — Heure/Départ, Nom, Prénom or a whole name,
  Club, Catégorie, Circuit, in any order and with « ; », « , » or tabs —, or a grid: a circuit per column pair), HTML, OE/MeOS PDF,
  or a Google Sheets link shared to anyone with the link (`functions/api/sheet.js` fetches its CSV export: the browser cannot;
  60 a day an account). **Read in the browser** (`localstart.js`, pdf.js for PDFs, words of a run placed by Arial widths) as the
  server reads it (`parsers/startlist.py`: `_csv`, `_read_table`, `_grid`) — keep them in step; checked on 20 real files, 19
  identical —, shown with warnings (a name twice, unknown circuit, another date, registrations vs runners), then sent as upload
  kind « startlist » (`api/upload.js`: organisers only, until the race's day, an agenda race `a<id>` allowed; GET `?race=&kind=
  startlist` lists the race's deposits, DELETE `{id}` removes one, both organisers only; a `prov` run started at once).
  `sources/upload.py` reads it into a « startlist » document (the race's latest deposit by any organiser supersedes) and lists the
  race in `prov_meta` `org_starts`: liveresultat and the club's site are no longer read for its start list, and `run.build`
  publishes the organiser's alone, up to `ORG_START_DAYS` (90) ahead. The runners get their start time by push (below); by
  e-mail later (owner: the Resend plan is too small). **Draw checks and O Checklist** (2026-10-22, ideas of MeOSDjango's checker and
  « Vérifie moi » export, none of its GPL code): `startchecks.js` `check` warns of two runners of a club one after the other on a
  circuit (a category in a list by category), a start minute shared, runners without a
  start time, a card number (when the file has them) or a circuit, and informs of the interval and its vacant places, and last, folded,
  of the categories in several blocks on their circuit (owner: most races mix them on purpose, championships keep one each); the
  table marks the runners (« À vérifier »). `oChecklist` writes the start's file for the Android app O Checklist (Stigning's format, checked on
  stigning.se/startclock/template.html: UTF-8 without BOM, commas, Name, Club, Class, Bib, StartTime hh:mm:ss, Card, StartName, a
  « // » comment line as header, sorted by start), the class a runner's category or the circuit, a start's name per circuit if typed;
  for a file just read, and for the race's deposit (« Vérifier et exporter »: `GET /api/upload?race=&kind=startlist&id=` returns the
  file to its organisers). `localstart.js` keeps card numbers and bibs (IOF `ControlCard` / `BibNumber`, « Puce », « SI », « Dossard »
  columns, OE's chip in PDFs) and a table's rows without a start time (`nostart`), the browser's only: the server drops them. A race's
  published start list on « Résultats » gives its organisers (and administrators) the same file, without card numbers.
- **GPS tracking by another service** (owner, 2026-10-24, after the live tracking study, private artifact
  https://claude.ai/artifact/Y2kZZiMHpZsiPBczSaTVcb: no service grants a third party the right to show its positions, and a web
  page cannot track a phone once its screen locks): Ozimut tracks nobody; a competition's organisers give the link to the
  spectators' page of the service they use (Loggator, GPSSeuranta, TracTrac, Livelox, Routechoices…) in « Organisation › Direct »'s
  card 4 (their club's competitions of the agenda from a week ago to three months ahead, and their declared ones). `functions/api/tracking.js`:
  GET every link of a competition of the last 30 days on (any account; `private, max-age=300`), POST `{ race, url }` / DELETE `{ race }`
  by its organisers (`_lib/club.js` `findRace` + `organises`, https links only, 30 changes a day); R2 `tracking/<race>.json`, the link,
  day and name (percent-encoded) in the object's custom metadata (one R2 list). `site/assets/js/tracking.js` (`links`, read once per
  5 minutes; `linkOf`, `serviceOf`, `button`): Agenda's « Suivi GPS en direct » box and « GPS » tag (France's competitions by their
  agenda id, declared ones by key), the race page of « Résultats » (by its key or `a<agenda_id>`), « En direct »'s race page (the
  link of the same day whose competition's name fits, `sameRace`). The privacy page says only the link is published.
- **Alerts by e-mail and/or push** (owner, 2026-10-18): every alert of Réglages › Alertes (`pages/settings.js` `ALERTS`, a table
  E-mail | Notification) — « une de mes courses est en ligne » (`notify` / `push_results`, both on by default), « mon heure de
  départ est publiée » (`starts_alert`, migration 0011, off / `push_starts`, on; the e-mail `startMail`, once per race and again
  when the time changes, as the push), « nouvelle course dans mes régions » (`agenda_alert` / `push_agenda`) and
  « la clôture des inscriptions approche » (`deadline_alert` / `push_deadline`; push off until ticked) — goes by e-mail, push or
  both. Every alert's e-mail is a right the administrator grants (`users.alerts_allowed`, the admin page's « E-mails » column;
  the results' too since 2026-10-21, owner: the right allows or refuses all the alert e-mails, the account's own e-mails —
  registration, password — apart; without it the e-mail box is not offered; the Resend quota); push is open to everyone; one list of regions for both. **Web Push** without a library (`functions/_lib/push.js`: RFC 8291 aes128gcm encryption and RFC 8292 VAPID ES256 on
  WebCrypto — checked against Mozilla's `http_ece` and FCM, which answers 410 to an unknown token and 403 to a wrong key; only
  the browsers' push services are posted to, `validSubscription`). Keys: `VAPID_PUBLIC_KEY` in wrangler.toml, `VAPID_PRIVATE_KEY`
  a Pages secret (and `.dev.vars`), made by `tools/vapid.mjs` (the private key kept in `C:\kerkia\cn-data\vapid-private.txt`,
  never in the repository); without them push is off (`pushReady`) and Réglages says so. D1 (migration 0010): `users.push_*`,
  `push_subs` (one per device: endpoint, keys, label), `push_queue` (sent a few per call by `flushPush`, 8, the Functions' CPU
  budget; expired rows dropped), `push_sent` (the start time last sent per account and race: sent again only when it changes).
  `/api/notify` queues pushes beside the e-mails (results: `items`; agenda and deadlines: `agenda`; start times: `starts`, which
  `notify.run_push` reads from the provisional results' start lists after every deploy) and returns `pushLeft`;
  `notify._drain_push` calls again while some are left. `/api/push` (GET config, `subscribe`, `unsubscribe`, `test`). The browser:
  `push.js` (registers `/sw-push.js` on its own scope `/push/`, apart from the Tracer's offline `/sw.js`; renews this device's
  subscription once a visit, moving it to the account signed in; `offer`, a small card asking for this device — a browser asks
  only after a click —, again 14 days after « Plus tard »; dropped at logout), the device block of Réglages (state, turn on/off,
  « Envoyer un essai »). A tap opens the notification's page (the worker controls no page: a message to an open tab, else a new
  window). iPhones receive notifications only from the site added to the home screen: `site/manifest.webmanifest` and PNG icons
  (`assets/icon-*.png`, `apple-touch-icon.png`, `badge-96.png`, drawn from the favicon's shapes). The privacy page's
  « Notifications » says what is kept.
- **The installable app (PWA)** (owner, 2026-10-20; `pwa.js`, called first by `app.start` after the bridge): the manifest in the
  site's language (`manifest.webmanifest` / `manifest.en.webmanifest`, same `id` "/"; `pwa.boot` sets the link): shortcuts
  (Classement, Résultats, Agenda, Analyse solo), screenshots from the tour's synthetic pictures (`assets/tour/<lang>/`: never real
  data), `file_handlers` (GPX, FIT, TCX, KMZ → `launchQueue`) and `share_target` (POST `/partage`: traces, KMZ/KML, map photos and
  PDFs). **`/sw.js` is registered on every visit** (it was the Tracer's only, unregistered when no event was kept): a navigation
  without the network gets `offline.html` (served by Pages at `/offline`, its `.html` address redirects; kept in cache
  `ocn-shell-v2` at install; the logo inline), the share's files go to IndexedDB `ocn-inbox` (key "inbox", a day at most) and the
  app opens `/?recu=partage#/analyse-solo`; a file opened with the app goes to the same inbox; « Analyse solo » (and « Analyse »)
  takes it at render or on `ocn:inbox` — nothing is sent. The Tracer's network-first copy runs only while its cache
  `ocn-offline-v1` exists (offline.js tells the worker `{ type: "ocn-offline", on }`; otherwise other requests are not touched).
  « Installer l'application »: the user menu's item and Réglages › « L'application Ozimut » once the browser fires
  `beforeinstallprompt` (Chrome, Edge, Android), else how to (iPhone: Share › « Sur l'écran d'accueil »). An install made on
  ocn.kerkia.com stays on that origin (the bridge then moves its visitor to ozimut.com in a browser tab).
- **Organisation › Tracer** (`#/orga-tracer`, route `orgTracer`, `pages/tracer.js` + `site/assets/js/tracer/`; owner, 2026-10-15,
  after the Purple Pen study, private artifact https://claude.ai/artifact/Vi5wAeHwMkpsDtvo6x7gFv): course setting as Purple Pen
  does it (phases 1-3 of the study; OCAD and Mapper maps since the third pass, below), in the browser. **No AGPL code**: Purple
  Pen's own code is BSD (attribution `site/assets/tracer/LICENSE-PurplePen.txt`), its symbols and texts converted by
  `docs/tracer/symbols.py` into `site/assets/tracer/symbols.json` (fr/en) and `symbol-texts.json` (23 languages). The model
  (`model.js`) mirrors Purple Pen's EventDB, QueryEvent, CourseView and ChangeEvent (controls, courses as linked course controls,
  forks and loops, map exchanges, legs with bends, gaps and flagging, specials, print areas, all in map mm, y up); `ppen.js` reads
  and writes **.ppen** (round trip checked on 15 sample events; « Purple Pen » is named as the file format the Tracer supports);
  **the Ozimut file** (`ocnfile.js`, owner, 2026-10-17: ours to evolve; « fichier O'CN » until 2026-10-19) is a `.ozmt` zip
  (`.ocnt`, its former extension, still opens everywhere: `isOcnFile`, `ACCEPT`; the content marker stays `ocn-trace`) — `event.json` `{ format: "ocn-trace",
  version, app, saved, title, map: { file, type, size } | null, event }`, `event` being the model's own event (all a .ppen holds plus
  O'CN's additions: georeferencing, routes, publication links…, in the event's frame), and `map/<name>` the map file itself when
  included (Fichier › Exporter au format O'CN, the stored map's name from the event's meta; checked byte for byte and event for event
  on a round trip); a file of a newer `version` or model `v` is refused with a plain message; not encrypted, which the export says
  for an encrypted event; `layout.js` = CourseFormatter (number placement, automatic
  cuts), `draw.js` the canvas and PDF items, `descr.js` + `textify.js` the description sheets (symbols and text, any language),
  `pdf.js` the PDFs (pdf-lib, the PDF map embedded as a vector page; courses, per part, per variation or relay team and leg;
  descriptions; punch cards; print areas), `exports.js` IOF XML 3/2 (relay team assignments), GPX, KML, images with world file,
  RouteGadget; `relay.js` Purple Pen's relay variations with .NET's seeded random generator (seed 8713527: the same teams as
  Purple Pen; checked `Random(0)` = 1559595546); `reports.js` its five reports (summary, leg lengths, cross-reference, load,
  event audit) plus O'CN's checks (IOF distances per discipline, out-of-bounds areas and boundaries crossed, legs through another
  circle, dog-legs, short legs, codes < 31 or read upside down, courses that leave one start for the same first control, and as a
  reminder for first controls in nearly the same direction, under 15° — 2026-10-22), shown, printed or as CSV (« ; », UTF-8 BOM). The editor
  (`editor.js`, `actions.js`, `panes.js`, `dialogs.js`) is drawn in the page under the site's menus, as the analyses are (owner,
  2026-10-15: the former full-window overlay left no obvious way back to the site): `.tr-app` in `#main` (`ctx.container`), its
  height fitted to the window (`fitHeight`), `body.tr-open` widens the page and hides the footer. **The page opens the editor at
  once** (owner, 2026-10-17), empty (`ctx.blank`: read-only, no lock, no save, « Aucun événement ouvert »; a change, a drop or any
  menu but the views leads to the start screen), and over it **the start screen** (`pages/tracer.js` `startScreen`, `.tr-start` in
  the editor's root): Nouvel événement (a competition of one's club or a training; the map), Importer un événement (a .ocnt, its
  map inside, or a .ppen and its map), Ouvrir un événement (one's events, listed inside); each card says what it needs; files dropped
  on it choose (a map alone: new; a .ocnt or .ppen: import); Échap or « × » closes it; « Événements » (the top bar's first button)
  and Fichier › Nouvel / Ouvrir / Importer bring it back (`ctx.onStart`), over the open event; a link with `?id=` opens the event
  directly; a dialog given up with no event open goes back to it. Switching events closes the open one first (`closeEditor`:
  saved, lock released); the editor closing by itself (↗) leaves the empty editor and the start screen; the analyses' « ⤢ » / « ↗ » (`fullwin.js`) — ↗
  saves, opens the event alone in a tab and closes it here (`setTabHandler`; one event, one tab), Échap first cancels the
  editor's own pick, drawing, tool or selection (`setEscapeOwner`); a
  change of page closes it (saved). With Purple Pen's tools and insertion rule,
  undo (100), autosave 1.8 s after a change, a version every 30 min of work, an editing lock (`/lock`, 150 s, refreshed every
  minute; same account = no lock). **Who**: a competition's event is created by a member of the race's organising club (an agenda
  race `a<id>` or one of « Résultats »), a training's by anyone; only the **team** opens it (creator + licences added: setter,
  controller edit, viewer reads and comments) — **not the administrators**: the courses are secret. Optional **end-to-end
  encryption** (AES-GCM, PBKDF2 250 000 from the team's passphrase; header "OCN1"; the key in `sessionStorage ocn.tr.key.<id>`,
  cleared at logout): event, map, comments and versions unreadable by the server. Storage R2 only (`functions/api/tracer/[[path]].js`:
  `tracer-meta/<id>.json`, `tracer/<id>/event|map|v/<n>|comments|field|lock`), optimistic versions (409 → keep mine / reload).
  **Beyond Purple Pen** (`extras.js`, `race.js`, `team.js`): georeferencing (points clicked + lat/lon, world file + .prj, KMZ/KML;
  `ev.geo` affine (lon, lat) → mm, `ev.georefPts`); climb along the legs from IGN's elevations (`data.geopf.fr` elevationLine,
  RGE ALTI, every 10 m, light smoothing; CORS open; only coordinates are sent); winning times (the winners' pace on the last two
  seasons' races of the format, `competitions.json` + `c/*.json`, ln pace on ln official CN J-15, the categories' median winner CN
  as default, the length for a target time; climb not modelled — the reference files have none); loads and categories from FFCO's
  registration counts (`agenda.reg.circuits`); a pick-up plan (last starts from the published start lists, a slow pace, k-means
  sectors per collector); a review after the race from « Résultats »'s split times (per leg: best, median, share of mistakes as
  « Temps intermédiaires » counts them, missing punches); publication to « Analyse multi » (after the race date only for a
  competition; one circuit per course or variation, 12 at most, the map PNG with the course printed, controls in px, `geo`
  composed — checked to 0.1 px); a course read from a printed map (`trace/course.js` at full size, order by nearest neighbour to
  be checked); team comments pinned on the map; the **field mode** (phone GPS on the georeferenced map, nearest control with
  distance and bearing, states set/checked/collected/problem with the phone's position, queued in `localStorage
  ocn.tr.field.<id>` when offline); version differences; other courses shown faint. Account deletion hands an event to the first
  setter (else controller) of its team who has an account, else deletes it; the privacy page says so. Local tests: Purple Pen's
  samples in the git-ignored `site/data/_trtest/` (their .ppen were made for OCAD maps: controls can lie off the JPEG).
  **Second pass (owner, 2026-10-15: « complete phases 1-3 »).** Import: one dialog (`importEvent`), the .ppen and its map dropped
  together or one after the other (`dialogs.dropZone`), each file confirmed as read, or a .ocnt alone (opened as saved, in its own
  frame, when its map is inside or the same file is given; another map goes through the calage); files dropped on the start screen,
  « Nouvel événement », « Changer de carte » or the editor are taken too; the OCAD or Mapper file, or any PDF or image of the map (never assume OCAD is at hand). A map that is
  not the .ppen's own file is aligned by two clicks (`calage.js`: least-squares similarity; a .ppen keeps true map mm, so the
  scale found corrects the image's dpi or the PDF's scale, not the course), also Événement › Caler les postes sur la carte.
  TIFF read by `tiff.js` (strips/tiles, none/LZW/Deflate/PackBits, predictor, 1-16 bits, palette, planar; a GeoTIFF's
  tie point/scale/matrix + EPSG 2154/326xx/4326 georeferences the event; checked pixel for pixel against Pillow on 13
  variants); large images drawn from reduced copies (`mapsrc.withLevels`). Fonts as Purple Pen (`fonts.js`): Roboto and
  Roboto Condensed from fontsource (vendored) + fontkit, their widths for layout and description sheets
  (`DescriptionAppearance` sizes), embedded in the PDFs; Arial numbers = Helvetica (same widths); offline fallback to
  Helvetica and Purple Pen's « no Arial Narrow » sizes. **Every language** (2026-10-15): fontsource's subsets read from each
  face's CSS (unicode ranges), the basic Latin ones with the editor, the others (latin-ext, cyrillic, greek…) when a text needs
  them (`ensureText`, the editor's `fontCheck` over the event's strings and its language's symbol texts; « tr-fonts » lays out
  again), Chinese and Japanese from Noto Sans JP/TC/HK by the event's language (`setLanguage`); texts measured, drawn and
  printed run by run (`textRuns`), each subset embedded on its own. The language menu lists the symbol file's 23 languages.
  Text objects print in the font they name (`family`): Roboto, Roboto Condensed, sans serif faces in Helvetica, serif ones in
  Times, fixed-width ones in Courier (the PDF standard fonts, their widths in `STDW`), bold and italic (Roboto's italic faces
  loaded). Course images also in GIF (`gif.js`: exact palette up to 256 colours, else median cut; LZW; world file .gfw). PDFs: print areas larger than the paper tiled over pages (Purple
  Pen's layout), a drawn print area, even-odd fills (raw `f*`: pdf-lib has no helper). Description sheet by keyboard.
  Several files into a chosen folder (File System Access) or a zip (`dialogs.saveFiles`). Route tool (`ev.legs[].route`,
  not in .ppen, not printed) used by the IGN climb. Winning times: climb effect fitted on « Résultats »' circuits with
  climb (winner time vs the CN model, by m/km), shrunk toward the km-effort rule (+10 % per 10 m/km) by its precision.
  Field mode: photos (`/photo/<pid>`, 1600 px JPEG, queued in IndexedDB `ocn-tracer` offline), a warning when marking a
  control far from the map's spot. Offline (`offline.js`, `/sw.js` network-first, opt-in per event; the event and map
  re-encrypted with the event's key; saves wait in IndexedDB « pending » and go when online, a conflict asks; the worker
  and cache go when nothing is kept; logout drops copies without pending changes). « Envoyer les circuits à Résultats »
  (from the race day; upload kind « courses », see Uploads). Review after the race: routes taken from the published
  analysis's shared traces (`routes.js`; `meta.published.analysis` set by the publication). Documentation tab « Le tracé ».
  **Beta** (owner, 2026-10-16): see « Beta notices » below; the Tracer's notice says it is not yet advised for real competitions,
  fine for training maps.
  **French wording** (owner, 2026-10-15): « le tracé » (des circuits), never « le Tracer » — « Tracer » is the menu's verb, as
  « Déposer »; « la page « Tracer » » when the page is meant.
  « Analyse solo » ↗ passes its files' IndexedDB key and `play=1` (`fullwin.setTabParams`): the new tab goes on with the playback. Files read back there (or after a reload) keep the race, circuit and runner of the address: no new match from the trace (`take`'s `remember`), and a runner is looked for in the address's document first (owner, 2026-10-18: a runner chosen by hand was replaced by the matched one, whose calibration was not the one kept, and the tab stopped at the calibration).
  **Third pass (owner, 2026-10-15: « fix the small gaps, then the big ones »): OCAD and Mapper.** `tracer/vmap/` ports Purple
  Pen's MapModel (BSD): `ocad.js` reads OCAD 6-12 and 2018, `oom.js` OpenOrienteering Mapper (.omap/.xmap), into `map.js` (colours
  bottom to top, drawn one colour at a time; `draw(g, rect, { begin, end, overprint })` draws part of the colour table), `symdefs.js`
  (point/line/area/text/rectangle symbols, OCAD's « Bizzarro » dash metric, Mapper's Euclidean one), `sympath.js`, `geom.js`
  (.NET matrices, prepend order), `target.js` (canvas: strokes batched per colour, pattern tiles, 1 px minimum lines; PDF: vector
  operators, text through `pdf.makeFonts`). Checked against Purple Pen's reference renderings (scratch harness
  `site/data/_trtest/vmaptest.js`, git-ignored, with Purple Pen's test maps in `_trtest/ocad/`): most symbol tests ≤ 2 % of
  pixels, real maps 3-14 % (anti-aliased against GDI's aliasing), templates (other files a map refers to) not drawn. `mapsrc.openVector`:
  kind "vector", the frame 2 mm around what the map draws (`ox`, `oy` its corner in the file's mm, kept in `ev.map` with kind "ocad":
  the event reopens in the same frame), a base image ≤ 12 px/mm, sharp renders when zoomed (`renderRegion` with parts). `appear.js`:
  Purple Pen's course appearance against the map — the purple is the event's, else the map's (`FindPurple`), « layer » mode
  (`blend` "layer", `lowerPurpleLayer`, default `FindBestLowerPurpleLayer`: the lower purple — circles, legs, out-of-bounds — between the
  map's colours, the rest over the whole map, opaque) on screen, images and PDFs, `ocadOverprint` (colours flagged overprint drawn
  darkened). .ppen and IOF XML keep the OCAD file's own mm (`M.fileOffset`, `shiftToFile`; import with the OCAD map: no calage; round
  trip exact). Georeferencing from the file (`vmap/georef.js`): OCAD's grid ids → proj4 from Purple Pen's MapProjection table,
  Mapper's EPSG/UTM/PROJ.4, common EPSG codes (`site/assets/tracer/crs.json`, built by the scratch `gen_crs.py`), proj4js 2.12.1
  (vendored); numbers that can only be Lambert 93 without a grid. « Fichiers OCAD ou Mapper des circuits » (`coursefiles.js`,
  `vmap/ocadwrite.js` OCAD 9-12/2018, `vmap/oomwrite.js`; Purple Pen's Create OCAD Files): each course's drawing items as 7xx
  symbols (line, area with hatching, text with its white frame) in the course colours (Purple 11, Lower purple 12, 50 % 13, Black
  0, White 44), the map as template (the OCAD/Mapper file at offset 0, the image, a PDF as a PNG), the map's real-world
  coordinates; checked by reading back with our readers (all versions, every object; drawings equal to 1 px). **Icons and guide**
  (owner, 2026-10-16: the guide leaned on Purple Pen, as if one had to know it first): `tracer/icons.js` holds every icon (24 × 24
  line drawings) and the menus' structure (`MENUS`, `ACT_ICON`), used by the editor's menus, its right-click and special-objects
  menus, and by the Documentation's « Le tracé », now a guide of its own (13 chapters: starting, the map, the screen — a drawn,
  numbered diagram —, tools and controls, courses, descriptions, special objects, printing, checks, teamwork and the field, after
  the race, every menu entry, the calculations); Purple Pen is credited once, and named only for its .ppen files. Controls, finish,
  start, crossing points, the map issue point and point specials are **point symbols** (`coursefiles.pointOf`: circles and dot
  for controls and the finish, a map exchange's triangle turning the symbol; the others' drawing turned back by their
  orientation), a circle's gaps in the object (OCAD: angle pairs after the point, unshifted, 0.1°; Mapper has none: a line
  symbol « code.1 » and the arcs, as Purple Pen). Images placed on the map: OCAD 11+ layout images kept in the file (parameter
  27 with « F » = base 64), else files beside the course files as templates (OCAD 9-10: a PNG made a GIF; Mapper: in front of
  the map).
- **The Tracer's ribbon** (owner, 2026-10-17, after the ribbon study, private artifact
  https://claude.ai/artifact/Hgd25Hv125DLJohzSyyoqQ; **its only interface since 2026-10-24**: the « Purple Pen mode » — the menus
  and the tool bar — was retired with the Condes study's decision, `MENUS`, `E.ui`/`E.setUi`, `.tr-ui-*` and the guide's « Le mode
  Purple Pen » gone; an old `ocn.tr.prefs` `ui: "pp"` is ignored). The ribbon is data, `tracer/ribbon-data.js` (`TABS`: Fichier, Tracer, Circuits,
  Carte, Vérifier, Imprimer, Équipe et course; `CONTEXT`: Poste, Interposte, Objet, Tracé en cours, by the selection; `BACKSTAGE`: the
  « Fichier » page; `INFO`: what its settings and figures are; `where(act)`: a command's place in the interface in use, which the
  messages naming a command use), drawn by `tracer/ribbon.js` (`mountRibbon`; `E.ribbon.update()` after each refresh, tool change and
  drawing step). Every button runs the editor's own action (`dialogs.action`) or tool; the ribbon's own acts: `pdf-course` (the PDF of
  the course in hand with the last choices, `pdf.coursesDialog({ only })`; also the quick-access printer), `special-more`, `route-draw`,
  `finish-draw` / `cancel-draw` (`E.cancelPending`), `route-draw`, `overprint` — these in `dialogs.action` too —, `ribbon-full|line|folded|auto`,
  and the commands that need a point (`PICK`: « Ajouter un coude », « Couper le cercle »…, `E.pickOnce`, which the canvas now
  gives every click). **What applies to the selection** is one module, `tracer/context.js` (`ctxKind`, `applies`, `menuItems`): the
  contextual tabs and the **right-click menu** (`actions.contextMenu`) are both drawn from `CONTEXT`, the menu group by group and worded for
  the spot clicked (« Ajouter un coude ici », « Retirer ce coude » only over a bend's handle). A greyed button says
  why (`why()`: no event, read-only, no course, not a vector map, before the race day for the after-race ones); contextual commands that do
  not apply to the selection are left out (`applies()`). A contextual tab opens by itself when the object is chosen with Sélection from
  « Tracer » (not when just placed by a tool), else it waits and pulses; it goes when the selection does. In place: fields (description
  standard, language, map standard, print scale, circle/line/number sizes, intensity, a control's code — `A.changeCode`), choices with a
  preview (the purple's blend, a leg's flagging), a gallery of 8 special objects. Live figures: « Vérifier » counts the event audit's
  findings (`reports.audit`, 0.5 s after a change, `issueRows`: red for problems, amber for reminders only such as a climb not filled in)
  and lists the first three; « Équipe et course » counts open comments (`E.commentsData`, read once at opening). Tooltips: what it does,
  its key, why it is greyed, « Niveau avancé » for the advanced level's, F1 for the guide's chapter. Search (Alt+Q) over every command
  and the « Fichier » page: Entrée runs it and flashes its button. Key hints (Alt alone: tab letters, then button letters).
  Display (`ocn.tr.prefs` `ribbon` in the page, `ribbonFw` in full window; unset = automatic: tabs only in full window, one line under
  800 px of window height, else full): full, one line (labels dropped when too long), tabs only (Ctrl+F1, opens over the map); groups fold
  from the right into one button when the width is short; one line on a phone. **Keyboard**: one Tab stop for the tabs and one for the
  ribbon (roving `tabIndex`), ← → through tabs (each shown) and buttons, ↓ from a tab into its ribbon, ↑ within a pile or back to the
  tabs, Début / Fin. **Quick-access bar** (`QAT_DEFAULT`, owner 2026-10-17: « guess which buttons are used most »: undo, redo, the PDF of
  the course in hand, the event audit, the course's properties; `ocn.tr.prefs` `qat`, keys an action, `tool:<tool>`, `undo`, `redo`): its
  ▾ ticks `QAT_CHOICES`, a right-click on any ribbon button adds it, one in the bar removes it, Fichier › Options resets it. **Dialogs
  remember** their last choices (`dialogs.modal` `remember`: the exports — course and description PDFs, images, OCAD/Mapper files, the
  O'CN file —; `ocn.tr.prefs` `dialogs`, the courses ticked `c<id>`, files and passwords not kept). « Papier » in Circuits › Impression
  (paper × portrait / landscape / « selon le circuit », on the course's or part's print area). The left pane's object details give way to
  the contextual tab (`#tr-info` hidden while something is chosen). The guide (« Le tracé »): « L'écran » drawn with the ribbon, « Le
  ruban » (every tab, group and command from the data, the advanced level's groups tagged), « Le niveau avancé », and every
  « Menu › Commande » of its text as the ribbon's place (`W(act)` = `ribbonAt`). The home page's « Tracé » slide was taken again with the
  ribbon (`reel-tracer.webp`, same local demonstration event, scratch `shot_tracer2.mjs`: the beta notice acknowledged and the ribbon set
  in the headless profile, the left pane widened to 470 px so that the map fills the width with the whole course in view).
- **The Tracer's advanced level** (owner, 2026-10-24, after the Condes study, private artifact
  https://claude.ai/artifact/MfUEJDFRoYi1J4TYTa2FcV — 33 gaps against Condes, the plan decided): one tool at two levels. The
  **essential** level — what a .ppen holds and Ozimut's own tools — for everyone, unchanged; the **advanced** level — every Condes gap —
  **for administrators only for now** (`E.pro` = `auth.session().admin`, editor.js). `ribbon-data.js`: an item, group or tab marked
  `pro: true`; `PRO` = the acts and tools whose every place is pro (plus `special:<kind>` of `PRO_SPECIALS`), `isPro`; ribbon.js
  draws them for `E.pro` only (tabs, groups, the quick-access bar, the search, the « Fichier » page), context.js the right-click menu,
  `dialogs.action` refuses them to others (`trc.dlg.proOnly`); their buttons carry an orange dot (`[data-pro]`); dialogs show an
  « Niveau avancé » block of fields (`.tr-pro-h`) to `E.pro` only. An event using the advanced level opens, draws and prints for its
  whole team; only administrators change those parts. **The model** is version 2 (`model.js` VERSION, nothing to convert): diamond
  (phi) loops (`cc.phi`, `cc.phiMid`: the exit's first passage, whose `next` starts the way back, its last `next` 0 — `phiBack`,
  `phiReturns`, `addPhi`; variations AB/BA; relay.js counts them as a loop of two), random-order controls (`cc.rnd`, `randomSections`:
  no leg lines, a line in the descriptions in the event's language), course `form` ("string" | "trail") and `legLines`, `discipline`
  (course, else `ev.discipline`: "mtbo" lengths along routes, "ski" a centre dot), `lengthBy`, `rogaine`, `allControls`, `partMaps`;
  finish `atStart`; `ev.classes` (name, course, est → `secondary` and `load` by `syncDerived`, run by every `E.change`); control
  `units`, `locked`, `trail` { flags, answer }, `dual` (a second symbol per box); `ev.symbols` (SVG-made symbols, ids `x:<n>`,
  symbols.js `setCustomSymbols`); leg `alts` (other routes; `legLengthFor`); `ev.relayTeams` (imported, written back by the IOF
  export); course `relay.strategy`, `couple`, `table`; `ev.maps` (other maps: { name, map, tf (event mm → its sheet mm), template,
  hidden }); `ev.mapHidden`; `ev.fieldStates`; `ev.date`, `ev.dateInHeader`; specials `mtbo-*`, `inset` (src, factor), `mask`
  (holes). **.ppen is lossy**: `ppen.js` `ppenLosses` (listed before the export) and `ppenFlatten` (diamonds become forks, the rest
  left out); the .ozmt keeps everything, other maps as `maps/<n>/<file>`. **Modules**: `iofin.js` (IOF XML CourseData 3.0/2.0.3,
  ClassList, OCAD course-setting strings from `vmap/ocad.js` `map.courseSetting` — read after OCAD's format description, **not yet
  tried on a real OCAD course-setting file**; the start screen imports an IOF XML with its map), `classes.js`, `mysymbols.js` (SVG →
  Purple Pen's symbol strokes), `advview.js` (attack angles, close controls), `layoutx.js` (insets, mask holes), `printx.js`
  (imposition, backs, registration marks, ISO 32000 geospatial pages), `exportx.js` (GeoTIFF, SVG, KMZ with the map, MapRun, OCAD
  text, IOF 2.0.3 by variation, the Livelox package), `maps.js` (other maps: storage `tracer/<id>/maps/<n>` — API `maps/<n>`
  GET/PUT/DELETE —, placing by georeferencing, same frame or two points; editor and PDF drawing), `mapview.js` (hidden colours —
  `vmap/map.js` `draw({ hide })`, `mapsrc` `setHidden`, `appear.syncMap` — and OCAD templates from `map.templates`, string type 8).
  MTB-O's symbols are drawn after ISMTBOM 2022's descriptions (omapwiki refuses robots, the French PDF link is dead): **their sizes
  are to be checked**. Climb outside France: `trace/terrain.js` `tileHeights` (advanced level only; IGN unchanged for everyone).
  **Not built**: Condes's .wcd (closed format, needs Condes and sample files), a direct Livelox upload (needs Livelox's agreement:
  the package stands in), more interface languages (with the site's), EPS and IOF XML 1.0. Local tests: launch configs
  `pages-dev-tracer` (8781, the test account an administrator) and `pages-dev-tracer-user` (8782, not); the guide's chapter « Le niveau
  avancé » (`?onglet=tracer&voir=avance`).
- **Beta notices** (`beta.js`; owner, 2026-10-16): the tools just made and little tested — « Tracer », « Analyse multi » (the runners'
  and the organisers' pages, one notice for all) and « Organisation › Direct » — open with a notice to acknowledge (`betaNotice(tool)`:
  just made, little tested, a beta to try and to report on; Tracer: not yet for real competitions, fine for training maps; Analyse
  multi: errors may remain in calibrations, traces and times; Direct: not yet alone for a competition's live results, try it at a
  training or beside the usual live), once per browser and tool (`localStorage` `ocn.tr.beta`, `ocn.beta.multi`, `ocn.beta.direct`;
  bump a notice's `v` to show it again; Escape closes it unacknowledged), its links to « Nous écrire » (a bug report, subject
  « Tracé : », « Analyse multi : »… read by `contact.js` from `?sujet=`) and to the guide counting as acknowledged. A « Bêta » label
  (`betaTag`) on the page titles and the editors' top bars, a note under the head (`betaNote`), a small « bêta » after their names
  in the menus (`app.BETA_ROUTES`: lean pages have no title), and a callout in the Tracer's guide.
- **Full window** (`fullwin.js`; owner, 2026-10-15: room for the map, no stacked menus; one way for the analyses and the
  Tracer, the analyses'): the analyses' playback (« Analyse solo » transport row, « Analyse multi » right panel) and the
  Tracer's top bar have « ⤢ » (`body.full-win`: the site's bar and footer hidden, the layout
  refits on the resize event; Échap or « ⤡ » back) and « ↗ » (the same page alone in a new tab, `?fen=1`, kept by
  `app.replaceQuery`; opened by script without noopener, so « Analyse solo » finds its session's files). In full window the
  button is « ⤡ » « Revenir au menu (Échap) » everywhere, a `?fen=1` tab included (owner, 2026-10-15: its former « ✕ Fermer
  cet onglet » did not close it - a browser refuses to close a tab reloaded or not opened by script). Full window always has a
  way back (owner, 2026-10-17): while it is on, `fullwin.guard` shows a fixed « ⤡ Revenir au menu » (`#fw-guard`) whenever the page
  shows no « ⤡ » of its own (checked every 0.7 s; « Analyse solo »'s calibration step has none). Playback speeds × 1, 2,
  5, 10, 20, then every × 20 up to × 100 (owner, 2026-10-15; `SPEEDS` in `analysis.js` and `shared.js`).
- **Analyse solo / multi** (owner, 2026-10-14; « Analyse multi » = the former « Analyse club » and « Analyse compétition »,
  2026-10-15): « Analyse
  solo » (« Analyse perso » until 2026-10-15) exists twice — in « Courses » (`#/analyse`, route `analysis`, a race of « Résultats » chosen) and in « Entrainement »
  (`#/analyse-solo`, the old `#/analyse-perso` still opens it; route `analysisPerso`: the same `analysis.js` with no race — one pseudo-runner, three steps, its own
  memory `memos.perso` and IndexedDB key `files:perso`). « Analyse multi » under « Entrainement » (`#/analyse-club`,
  route `analysisClub`: training events) and under « Courses » (`#/analyse-competition`, `analysisRace`: competitions,
  tied to a race of `prov/index.json`, its circuits offered, the runners' published results beside their traces) lists
  the events their organisers have made ready (a circuit at least): the runner picks one and adds their trace — nothing
  to create there; the organisers manage them from « Organisation » (the same `pages/shared.js` in its organiser mode,
  `ORG_ROUTE`: the settings and circuits open, the replay below as the runners will see it, « Voir comme les coureurs »).
  **One's own curves** (owner, 2026-10-15: as in « Analyse solo », for oneself only): a column on the far left, folded by
  default (« Mes courbes › », kept in `ocn.sh.prefs`), the curves of `trace/curves.js` (shared with « Analyse solo »)
  over one's own race, from one's own file kept in this browser (IndexedDB `ocn-analyse`, key `own:<id>:<n>`, saved when
  one's trace is sent, dropped with it; else « Déposez votre fichier ») — the server keeps positions and times only, and
  the others never see them; the file must overlap one's shared trace in time. Both are `pages/shared.js` on `/api/analyses` (`functions/api/analyses/[[path]].js`):
  **no D1 table** — R2 (`cn-state`, binding `BUCKET`) holds `analyses-meta/<id>.json` (the analysis; its summary in the
  object's custom metadata, so the list is one R2 list), `analyses/<id>/map-<n>` (images) and
  `analyses/<id>/trace-<n>-<uid>.json` (one per account and circuit). CI never touches these prefixes (it copies only
  `uploads/`). Access: organiser and admins always; else `public` (every logged-in account), `club` (the organiser's club =
  the club of one's latest race in `site/data/r/<lic/10>.json`, read through `env.ASSETS`), or `password` (PBKDF2 as for
  accounts, checked once by `/unlock`, which returns an HMAC key of analysis + account + salt, sent as `X-Analysis-Key`;
  the browser keeps it in sessionStorage). Each account adds, replaces or removes **only its own** trace (the server sets
  name and licence from the account); the organiser may remove any. A shared trace keeps positions and times only
  (`trace/share.js`: whole seconds and 1e-6° deltas, ~20 KB for 40 min), cropped to the map's area + 300 m, consent asked;
  account deletion removes one's traces (`api/account/delete.js`); the privacy page says so. The organiser's circuit editor
  reads the map (`trace/mapfile.js`), detects the course, georeferences from a KMZ/KML, a world file (+ .prj), an IOF XML
  with coordinates, or the organiser's own trace (alignment); the controls' order from the IOF course, else the trace's
  visiting order, else as read, and can be clicked in order (snapping to the circles); stored as an affine (lon, lat) → px
  (`geoFromFit`/`fitFromGeo`). The replay (Livelox's features, checked on its documentation): clock time, mass start, mass
  start from a chosen control, « attente aux postes »; follow all / the selected runner / no one; tail; a leg view (routes on
  one leg synchronised at its start, the left list ranked by leg time with gap, distance and pace; ⏮ ⏭ step legs); the
  splits table (leg time, rank, cumulative; « Comparer à » gives the duel's gaps; a click on a control opens its leg).
  Passes: `coursePasses` (first visit within 25 m after the previous control, its closest point; start = departure,
  finish = arrival). Tested 2026-10-14 with four local test accounts (local D1 only) and synthetic traces: access rules,
  ownership, every mode; a search around a control is timed at its first approach (published splits would be better).
  **An administrator's test traces** (owner, 2026-10-24: one account could show one runner): under the runners' list,
  « Traces de test (administrateur) » takes several GPX/TCX/FIT files at once, each a runner « <admin's name> #k » (PUT
  `{ test: k }`, uid 1e9 + account × 1000 + k, no licence, `test` in the record; labelled #k on the map, tagged « test »),
  « Retirer mes traces de test » removes them (DELETE `…/trace/<n>/tests`); account deletion removes them too. Invented tracks
  for the « Entrainement Gif » test event (scanned map, invented georeferencing, routes over the map's colours, variants and
  mistakes): `C:\kerkia\cn-data\Test files\fake-tracks\gen_tracks.py`.
  **Runners shown**: a click on a name shows or hides that trace (any number; « Toutes », « Aucune », « Inverser », « La
  mienne »), ⌖ follows one runner; the timeline spans the runners shown; kept for the visit (`sessionStorage ocn.an.vis.*`).
  **Display** (owner, 2026-10-14: no curves per runner here, the map is what is compared): the right panel's « Affichage »
  as on « Analyse solo » — width (4 steps), « Trace à venir » (masquée by default / estompée: each runner's route to its
  finish, faint), tail, the map's and the traces' opacity, the course overlay — kept in `localStorage ocn.sh.prefs`.
  **A circuit's start and finish** are what was read on the map, or the organiser's first and last clicks (« Saisir
  l'ordre »): the editor no longer makes the first and last controls read the start and the finish (`relabel` only in
  the click mode) — that ended every race at the last control found. A circuit without its finish runs each trace to its
  end, without its start from the trace's start; a « finish » saved that way earlier only counts where the runner stops
  with under a quarter of the race left (`track.finishAfterAll`).
  **Maps are kept as long as their analysis** (owner, 2026-10-14: « forever »): the bucket has no expiry rule (only the
  default abort of unfinished multipart uploads), an organiser's account deletion keeps their analyses (owner 0, no
  name; the administrators manage them). **A stored map is never degraded** (owner, 2026-10-14; it was re-encoded as
  WebP and capped at 8000 px the same day): `mapfile.imageBlob` keeps a PNG, JPEG or WebP byte for byte, and stores a
  PDF's rendered page (4200 px at most), a GIF or a BMP as a lossless PNG; up to 80 MB a map (`MAX_MAP`, server and
  editor; Cloudflare takes 100 MB a request). R2's free 10 GB (420 MB used on 2026-10-14: the database and the site
  state) hold some 2000 phone photos of 5 MB; the administrators see the bucket's use on the list pages
  (`/api/analyses?stats=1`).
  **After 2DRerun** (study of 2026-10-23 against World of O's 2DRerun/3DRerun, from public write-ups; built 2026-10-24,
  one commit each, live GPS tracking and QuickRoute import out of scope): the routes can be **coloured by pace** (one scale for
  every runner shown, Solo's legend; `trace/pacecolour.js`, moved out of `analysis.js`), and in a leg's view by **leg time**
  (fastest to slowest) or by **variant**. Under the replay, `pages/sharedviews.js` draws five tabs: « Temps intermédiaires » (the
  splits against « Comparer à »), « Inter-postes » (one runner's legs as Solo: time, best and rank, time lost by the split-times
  page's rule — `trace/legs.js`, moved out of `analysis.js` —, route against the straight line, pace; never heart rate: only
  positions and times are shared), « Écarts » (each runner's gap to the leader at each control, the « superman » of best legs or a
  runner, against the controls or the course's km, `charts.gapChart`; a click near a point puts the replay at that pass and follows
  the runner; « Face-à-face »: time gained/lost leg by leg, `charts.duelChart`), « Variantes » (route choices, below) and
  « Exercices » (a training's only, below). **A competition's published split times** (`trace/published.js`): the runner's row in
  the circuit's class with splits (else any), the course matched to the class's controls by codes in order, else by count; the
  trace's clock offset from the published start when it agrees with the trace's passes within 2 min, else the median shift to them
  (passes over 60 s off dropped): passes, start and finish then come from the published times, and the legs, the leader and the
  superman are taken over the whole class (« officiel » tag). **The replay's state in the address** (`replaceQuery`, written once
  the replay is still 0.4 s, 1.5 s while playing): `c`, `m`, `from`, `t`, `leg`, `show` (uids shown), `sel`, `f`, `ref`, `v` (the
  tab), `lo`, `g`/`gx`/`gm`/`da` (gaps), `ex`; `?fen=1` kept. **The pace strip** under the map (`trace/pacestrip.js`, « Allure sous
  la carte », on by default): every runner shown as a line over the replay's own time axis, smoothed, the cursor; a click or drag
  seeks. **Route choices** (`trace/routes.js`): on a leg, each route resampled to 32 points by length, the discrete Fréchet distance,
  complete linkage under a threshold (a fifth of the straight leg, 30-120 m, a slider); variants lettered from the fastest, each with
  runners, best and median time, mean length; a hand edit (runner moved, merge, name) freezes the leg, a later trace joins the
  nearest variant within the threshold. Tags: the organiser's on the server with the circuit (shared with every runner,
  « Partager avec les coureurs »), anyone's own in `localStorage ocn.sh.var.<id>.<n>`, over the organiser's — a runner's tags need
  no right to write and change nothing for others. **Exercises** (`trace/corridor.js`, training analyses only): the organiser draws
  a corridor (a line clicked on the map, a width) on the whole course or a leg, or makes a leg a compass leg (the straight line
  between its controls); each runner's share of route inside (by distance), time outside, largest and mean deviation, and on a
  compass leg the bearing error (to halfway, positive to the right); the width recounts live — the organiser's is saved, a
  runner's is theirs for the visit. Both live in the circuit (`course.variants` {leg: {th, names, assign}}, `course.exercises`
  [{id, kind, leg, w, name, pts}]) through `PUT /api/analyses/<id>/extras/<n>` (organiser only, R2 as the rest, no D1), kept
  when the organiser edits the circuit. **A headcam video** (`pages/sharedvideo.js`, « 🎥 » in the map's tools): a local file
  (object URL, never sent) in step with one runner's race, the offset typed or set by « Caler ici »; plays at the replay's rate up
  to × 16, frame by frame beyond; runner and offset kept per analysis in `localStorage ocn.sh.video.<id>.<n>`. Tested locally
  with synthetic traces on the reel's invented map (scratch `mkmulti.mjs`, `mkrace.mjs`: four accounts, a route variant, a
  mistake loop, traces time-warped to a local race's published splits).
- **Computed route choices** (owner, 2026-10-24: « the best routes for each control, with time and climb »; a prototype,
  **administrators only**: the box « Itinéraires calculés » under « Affichage » of « Analyse solo »'s playback and of « Analyse
  multi »'s right panel, `me.admin`): `trace/routechoice.js` (pure, run in the worker `trace/routeworker.js`), `trace/routeplan.js`
  (the planner, the settings panel shared by both pages, the routes drawn, `autoPace`, `nearestRoute`). The map is read **by its
  colours only** (no vector map in the analyses): areas (white, the two yellows, three greens by depth, olive) and inks (purple,
  black, grey, brown, blue); each ink's thick parts (an opening a little wider than its own line width, within 3 × the black's;
  6 × 6 m at least) are areas — black a building or big cliff (impassable), grey a building in sprint or bare rock, brown paved,
  blue water —, thin black lines 30 m long or dashes chained (gap under 0.4 × their length) are paths, thin blue streams and
  (dense) marshes; contours, the course, text and dots are painted over by the nearest area. Cells of ~1.5 m (the most frequent
  area). Cost of a step = metres × terrain (speeds in % of white forest, `DEFAULTS.speeds`) × slope (up: 1 + climb × grade, 8 flat
  metres per metre by default; down: 1 − 0.6 × grade to 15 %, then + 2.5 per unit) × the **navigation caution** (1 + caution ×
  visibility × min(1, distance to a handrail / 50 m): handrails = paths, streams, edges between visibility groups, blocked areas'
  banks; caution 20 % by default); the times shown exclude the caution. Heights: `terrain.js`'s grid (IGN, else the tiles), flat
  if it fails. A* on 16 neighbours in an ellipse (0.65 L + 90 m); variants by penalising the found routes' corridors, each pulled
  tight without the penalty in a band around it and kept only if 30 % of it lies outside the others, it costs at most A + `extra`
  (25 %), and it is locally optimal (no 30 % stretch shortened by over 1 % + 3 m: an arc through uniform forest is no choice);
  4 s at most for the variants. A runner's route is measured on the same model (`lineRoute`), matched to a variant within 25 m.
  Pace: the one typed, else (solo) the median of the runner's legs' actual ÷ model time, (multi) the runners' median on the leg,
  clamped 3-20 min/km, else 6:00. Solo computes every leg (the current first) and adds the card « Itinéraires calculés » (Choix =
  model of one's route − A; Exécution = actual − model); multi computes the leg shown and lists the runners shown. Settings in
  `localStorage ocn.rc.prefs` (the map's kind from the race: sprint by its name/discipline), the box's state `ocn.rc.on`.
  « Voir le terrain tel que lu » draws the cells over the map. `window.anDebugRoutes()` on both pages. Measured 2026-10-24 on the
  reel's invented map (2160 × 1440, 0.42 m/px): the map read in ~2.5 s, a leg 0.5-2 s; on the local test analyses' scanned GIF
  the contours were first read as paved areas (fixed by each ink's own width). Documented in the guide (« Courses › Itinéraires
  calculés », `content/guide.*.js` chapter `routes`, shown to administrators only). **OCAD and Mapper maps** (owner, 2026-10-24):
  `trace/vectorroutes.js` reads them with the Tracer's `tracer/vmap/` (`readVector`: the frame of `mapsrc.openVector`, its
  `geoFromVector`) and draws the engine's layers on the image's pixels (`layers`; the worker's op `layers` instead of `init`, no
  colours read): areas by their fill colour (hatching: blue marsh, olive/purple out of bounds; pattern green/black: slow), colour by
  colour from the bottom of the colour table; lines by symbol number (501-508 paths drawn solid; 201, 515, 518, and 521/524 as
  lines block — a path crossing them stays open, an out-of-bounds area never; 202, 415, 416, 513-523's passable ones handrails;
  blue lines streams); contours, points, text and course left out. « Analyse solo »: a .ocd/.omap/.xmap dropped with no image is
  the map (rendered by `mapsrc.openMap`, georeferenced by its own grid: `files.geo.corners`), else (or from the routes box) a
  companion `files.vector` placed through its georeference and the calibration (`throughGeo`, refused under a fifth of the image
  covered: `cover`); « Analyse multi »: the routes box's file, placed through `course.geo`, this visit only. Tested 2026-10-24 on
  Purple Pen's samples (Clouds, Penistone Hill, Ft Casey, Lake Sammamish, SampleMap georeferenced in UTM 10 with a synthetic GPX;
  Mapper's HG_Mar28 sprint): the layers in 0.1-1.5 s, the companion's placing equal to the map's own to the pixel. Not done: learning
  the speeds from the shared traces, purple out-of-bounds hatching on an image map (erased with the course).
- **Languages: French and English** (owner, 2026-10-17; open to everyone since 2026-10-18, `i18n.OPEN` true). **Never write UI
  text in the code**: every text goes in the catalogues, `site/assets/js/i18n/fr.js` (the reference: a key exists there
  first) and `i18n/en.js` (same keys, same `{placeholders}`), read with `t(key, vars)` (and `tn(key, n)` for counts: keys
  `x.one` / `x.other`) from `i18n.js`; an area's own catalogues `i18n/<area>.fr.js` / `.en.js` (`loadArea`, the Tracer's);
  long texts (documentation, guides, legal pages) are whole modules per language, `site/assets/js/content/<name>.fr.js` /
  `.en.js` (privacy, vma, orgdirect; the Documentation's `methods.*.js` export `build(X)`: the page passes its neutral
  helpers and data, the module returns the tabs, panels and the charts that carry words — keep the two in step, same
  code, French the reference). The Tracer: its catalogue `i18n/tracer.fr.js` / `.en.js` (keys `trc.<module>.*`), loaded by
  `tracer/lang.js` with a top-level await — every Tracer module imports `t` from it, never from `i18n.js` directly. English
  vocabulary: `docs/i18n/glossary.md` (IOF terms, Purple Pen's English for the Tracer; FFCO's classes H/D shown M/W in
  English: `util.fmtCat`, `fmtSex`; `ui.dataTable` shows a column keyed `cat` through it). FFCO's formats word by word
  (`util.fmtFormat`: Nuit → Night, keys `format.<word>`), percentages `util.pct` / `pctN` (« 12 % » / « 12% »), a label
  and its colon `t("ui.colon", { a })`; a CSV's separator « ; » in French, « , » in English. Numbers and dates through
  `util.fmt` / `fmtDate` / `i18n.locale()`, never a hard-coded `fr-FR` (what the Tracer prints on an event's map follows
  the event's own description language, `ev.lang`). The language: the one chosen (`localStorage ocn.lang`: the language
  menu beside the theme on every page, signed in or not — `app.langMenu`, a globe and the code, each language in its own
  name —, Réglages, the registration form's first field, `?lang=`), else the browser's (the first of its preferred
  languages the site has, English when none). A change redraws the page (`setLang` reloads); the registration form keeps
  what is typed, passwords apart (`sessionStorage ocn.reg.draft`). **The account's language** (D1 `users.lang`, migration
  0009): set by the menu or Réglages when signed in, by registration (the form's language); every e-mail is written in its
  recipient's (`_lib/templates.js`, French and English side by side; the administrators' alerts in each administrator's).
  At login a language chosen on the device becomes the account's (`i18n.storedLang`), else the device takes the account's
  (`i18n.adoptLang`). « IA » answers in the asker's language (`systemPrompt({ lang })`) and its errors
  carry a `code` the page words. The white paper exists in both languages (`docs/whitepaper/methode-top.en.tex`,
  `site/assets/ocn-methode-top.en.pdf`). `?lang=xx`: a pseudo-language that marks every catalogue text, so what the code
  writes itself shows plain. `node tools/i18n_check.mjs` lists keys missing in a language, placeholders that differ,
  French written in the code and French typography between placeholders (`--list` for all; a line marked `i18n-ignore`,
  or the N lines after a comment `i18n-ignore-next N`, are patterns or names, not UI text).
- UI text lives in the catalogues (`i18n/fr.js`, `i18n/en.js`; above). Method keys: `official`, `top6w`, `top6w3`, `fair`, `fair3` (labels « Top » /
  « Fit » for the published pair, « Top géométrique » / « Fit géométrique » for the geometric one, since 2026-10-16). Old saved selections or links naming the removed
  `v2026`, `top6w2` or `fair2` are mapped in `store.js` (`RENAMED`).
- Runner race rows (`R`) and race result rows (`C`) carry each method's columns, the geometric pair (`f3*`, `t3*`)
  appended after the published linear ones (`f*`, `t6*`; `site_ask` reads the Top from `t6*`) (`data.js`: `SCORE_COL`, `CNAFTER_COL`, `CNJ15_COL`, `COUNTS_COL`, `WEIGHT_COL`,
  `C_SCORE`, `C_CNJ15`).
- The archived seasons (before 2024) are members-only on the FFCO site — listings and, since 2026, the race
  pages too: re-reading them needs a fresh `FFCO_SESSIONID` (the `sessionid` cookie of a logged-in member) in
  the environment; normal runs never need it. The workflow's `backfill` mode (manual) fetches every season's
  competitions not stored yet, with the repo secret `FFCO_SESSIONID` (the owner sets it, then deletes it).
- **Anonymised runners** (owner, 2026-10-15; `privacy.py`): on request (not to be shown, a minor's representative, erasure of
  results data) a licensee's name and licence are replaced all over the published site by a pseudonym — « Coureur anonyme N »,
  licence 9000000N (8 digits; real licences have at most 7; `data.isAnon` hides the licence and skips FFCO's lookups). Nothing
  is deleted: the database and every computation keep the real licence, so the others' places, circuit values and CNs are
  unchanged. The admin page's « Anonymisés » tab keeps the list in R2 (`privacy/anonymized.json`, `/api/admin/anonymized`);
  the workflow copies it to `CN_DATA_DIR/privacy/`; `update.sync_privacy` keeps the last list in `engine_meta`
  (`anonymized_list`) and restores it when the copy is missing (an empty list would publish the names again), and
  `update.apply_privacy` rebuilds the whole site data and the provisional results once when the list's fingerprint changes
  (`engine_meta` `anonymized`; an incremental build keeps old seasons). `build_site` maps every licence read from the database
  (`Anon.lic`), names come only from `runners.json`; the auth index keeps their real licence and name (they can still sign
  up). Provisional results: rows matched to their licence, unmatched rows by name (`privacy.anonymise_row`, birth year and
  bib dropped). Not covered: « En direct » (liveresultat relayed live).
- **Demo accounts** (owner, 2026-10-18: to let Swiss Orienteering, or any federation, league or club, see the site): made on the
  admin page's « Démo » tab (`functions/api/admin/demo.js`: label, sign-in — else `demo-<label>@ocn.invalid`, a domain that
  receives nothing —, days, language; a readable password shown once with a message to copy; +30 days, new password, disable /
  enable / delete through `/api/admin/user`). D1 `users.demo_until` (migration 0012, the last valid Paris day; NULL for every other
  account), no licence (`licence` ''), no alert. **Read-only**: the session cookie carries `demo` (`api.sessionCookie`, never
  longer than the account) and the login gate refuses every method but GET/HEAD/OPTIONS except `/api/track` and `/api/ask`
  (`DEMO_WRITES`, 403 `demo`); past its day the login says « disabled », `currentUser` and the gate's hourly check refuse it. Kept
  out of « Comptes » and « Inscrits ». In the app (`session.demo`): no « Ma page », the brand and the home page lead to
  the agenda (every account's since 2026-10-21), an orange line under the bar (`demo.strip`), Réglages reduced to what the account is and the language, no
  push offer. The privacy page names the exception to « accounts reserved to licensees ».
- **Privacy and legal notices** (`#/compte/confidentialite`, `pages/account.js` `privacy`, public; reviewed 2026-10-15): the
  GDPR's information (controller Yann Le Helloco, legal bases, licensees without an account and their right to object,
  processors Cloudflare / Resend / GitHub and their transfer safeguards, the IP-keyed rate limits, every right, the CNIL)
  and the legal notices (publisher, host). When the site starts keeping new data, say so there and update its date.
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
  **Welcome e-mail** (owner, 2026-10-21): the confirmed account gets one too (`templates.welcomeMail`, in its language: the
  site's four groups — the ranking's line only with France, else how a federation's rankings open —, the alerts by
  notification, an invitation to reply or to write through « Nous écrire »), once, priority 0, an account e-mail (the alert
  right does not apply); signed « L'équipe Ozimut » / "The Ozimut team"; sent while `WELCOME_MAIL` (wrangler.toml) is "1" (on since 2026-10-21, the
  owner having approved its text).
  « En direct » (`#/direct`, `pages/live.js`; menu « Courses »: Agenda, Résultats, En direct) for every account since
  2026-10-15 (the `users.live` right before: migration 0007; its admin page checkbox removed 2026-10-16, the column kept
  unread): liveresultat's races from O'CN's live relay (`live/`, Worker `ocn-live`), through O'CN's own Functions — `/api/live/list` (kept in the edge cache for the directory's lifetime, 2 min)
  and `/ws/<race>` (the WebSocket handed to the race's object) —, signed-in accounts only: the login gate passes the 101
  handshake on untouched (`_middleware.js`); each runner recognised by name (+ club number) and linked, their CN Top and
  official in the race's discipline (guessed from the names: sprint, VTT, ski, else forest) and the place their Top
  CN predicts (« Attendu »). The race page (owner, 2026-10-21/22, phone first): name, organiser and day beside the status and
  one ranking button; the latest punches on one line scrolling sideways (no filter there; ▾ opens them as a table); three
  selectors side by side, the one in use outlined — a course (each with its finishers / starters: the relay reads the classes
  nobody watches for their counts only, a few per wake-up, message `counts`), a club (« Mon club » first: France's runners of
  one's club recognised, the club names the race writes for them, else the club typed in one's countries; « Encore en
  course », everyone still out; then every club; `#/direct/<race>/~club/<key>`), the punches (all, or one's club's;
  `~passages/<all|mine>`); on a wide screen the course selector is the list at the left, headed by the same views
  (« Suivre »: Mon club, Encore en course, Tous les passages, Passages de mon club; owner, 2026-10-22); one search under them for a runner (opens their course, the row marked and scrolled to the middle)
  or a club. The club and punches views, the club list and the search watch the **whole race**: the page subscribes `"*"`,
  the relay then reads every class as a watched one (those just punched first, at most `MAX_READS` a wake-up; `ALL_NOW` at
  once when asked) and sends them all; it keeps every class under its own storage key (`c:<class>`, the former single
  « data » value migrated at the first save). Every table has the start time; no scrollbar of its own (the last columns may
  scroll sideways), every runner on two lines (place | name | [course] | club | start | time/gap | CN/expected | score/gap),
  the runner's category (from the data) when the class is not one, under the place on a phone; the first column (« Place », the
  punches' time of day) frozen when a table scrolls sideways (owner, 2026-10-24: opaque, the row's tint `--lv-tint` drawn over
  it). **One line per runner, a preview** (owner, 2026-10-24): each two-line cell split into two columns (Temps | Écart, CN |
  Attendu, Score | Écart {cnTo}, Catégorie, in « Passages » Nom | Club and Circuit | Cat.), nothing wraps, the table scrolls
  sideways (`live.js` `ONE`, `.lv-one`); shown only to the accounts whose D1 `users.preview` (migration 0015, features
  separated by commas, set by hand: `UPDATE users SET preview = 'live1line' WHERE id IN (…)`) names it (`_lib/api.js` `previewOf` →
  `preview: ["live1line"]` on `/api/account/me`, kept by `auth.fromUser`); local test: launch configs `ocn-live-1line` (the mock
  and the relay in one) + `pages-dev-1line` (8791; the flag set on the local test account in the local D1; start it once the relay
  is up, or the WebSocket fails); the punches' table (« Passages »,
  owner 2026-10-22): **every punch of the last 15 minutes**, derived from the courses' results (each radio control passed and
  each finish at start + its time; the relay's last 30 only for a course not held yet), else the latest 20 — time of day, the
  event (radio control ○ / finish ◎), runner and club, course and category, time and gap, place, start. **Recent ones
  coloured** in every table and on the punches' line: green within 3 min, yellow within 9 (a runner's last event: the finish,
  else the last radio control; redrawn every 30 s). « Passages de mon club » can **vibrate and beep** at each new punch
  (`localStorage ocn.live.buzz`; the sound starts from the box's tap, a test ring; silent until every course has arrived,
  then only for punches under 2 min; the screen kept on by the Wake Lock while ticked; no vibration on an iPhone). A runner's state is liveresultat's status first (9 started, 10 not
  started), then the start time against the clock. **The selectors are redrawn only when they change and never while one is
  open** (2026-10-22: an update arriving while a phone's selector was open replaced it, and the choice was lost — the « stuck
  on Derniers passages » report); on a phone they and the search are 16 px (a phone zooms into smaller fields). Local test:
  launch configs `lr-mock` (8795, a recording kept outside the repository; `--live --speed 1 --from <min>` replays it on today's clock) + `ocn-live-mock` (the relay reading it) +
  `pages-dev-games`. The list page: the site's country's races, a search looks in every country (the other countries' chips
  beside the search, 2026-10-21/22, are gone since 2026-10-23: Agenda and Résultats had none; `country.hint` says whose list it is
  and opens the header's menu). **The countries of its races join the country menu** (owner, 2026-10-29: Sweden, whose agenda
  Ozimut cannot read, had left it on 2026-10-24): `country.noteLive` keeps the list's countries in `localStorage
  ocn.liveCountries` (6 h; read at the start of a signed-in visit by `refreshLive`, and by the page), `withData` offers them,
  « ocn:countries » redraws the header. **Live now** (owner, 2026-10-22: « identify clearly which competitions are truly live »): the
  relay's `Directory`, when the list is asked for, reads the last passings of the races of their own today (with liveresultat's
  hash, at most every `PROBE_MS` 3 min a race and `MAX_PROBE` 15 a call; `probes` kept for today's races only) and adds to each
  race the age of its last punch in seconds (`comps[i][6]`, from the race's time zone, else liveresultat's offset from Swedish
  time); a race is live under `LIVE_S` (30 min). The page puts them in a box « En direct maintenant » on top (the latest
  punch first; no punch age shown, owner 2026-10-22), marks them « direct » in the list and sorts them first; a broadcast that
  sent something in that time is marked too. **Flags beside every country choice** (owner, 2026-10-22): `country.flagImg` in
  the header's menu (its button shows the site's country's flag), the registration's and Réglages' country fields (the flag
  of the country chosen beside the select: an option cannot hold an image) and the list of one's countries. `localStorage["ocn.liveBase"]` points it at another server for tests (unset: this site).
  Usage: the app posts each page view of a logged-in account to `/api/track` (route, Réseau views apart; a new
  browser session = a visit) into D1 `usage_daily` (account, Paris day, page, views; 13 months, deleted with the
  account); the admin page's « Utilisation » tab reads `/api/admin/usage` for any period. The privacy page says so. The
  « Inscrits » tab (2026-10-15, `/api/admin/members`: sign-up times, status, admin flag and the days seen, no names or
  e-mails) counts the registered accounts (confirmed, not disabled) and the active ones (a page view in the last 21 Paris
  days), today and day by day; visits are counted since 2026-10-07 (the window complete from 2026-10-27); a deleted
  account leaves no trace.
  Mail through Resend with daily/monthly quotas and a reserve for account mails (`wrangler.toml` vars).
- **Countries** (owner, 2026-10-20: Ozimut open to every orienteer; the plan in nine steps — data model, access by path in
  `_middleware.js`, a CN-free copy of the provisional results, the front end by profile, registration and Réglages « Mes pays »,
  admin, texts, an admin « Consommation » tab, a global country selector): an account joins countries (D1 `user_countries`,
  migration 0014: ISO alpha-2 code, club as typed, member id, status `ok` / `pending` / `refused`; every account of before
  backfilled as France). `functions/_lib/countries.js`: the IOF's member countries (`COUNTRIES`), each one's policy — France
  `ffco` (name + licence against the licensee index, `checkLicensee`), the others `open` (declared) —, `checkMembership`,
  `memberships` (in the order joined: the first accepted is the user's default country), `accountView` (the user and a fresh
  cookie). The session cookie carries `cc`, the accepted countries (a demo account: France), refreshed by the login gate's
  hourly check. France's membership is `users.licence` (joining sets it with FFCO's display name, leaving clears it and drops
  the relay runners). `/api/account/countries` GET / POST `{ country, club, id }` / DELETE `{ country }`; `/api/account/me`
  and the login return `countries`. A club typed by the user grants nothing; only clubs of an accepted country do. Registration
  takes `countries: [...]` (`licence` alone = France); `WORLD_OPEN` (wrangler.toml) "1" since 2026-10-20 evening (owner):
  registration open to every orienteer, no country required ("0" would require France again). **Cloudflare Turnstile** on registration (`_lib/turnstile.js`; the form loads
  challenges.cloudflare.com's script, the one script from another host, there only and only when `/api/account/status` gives a
  site key): `TURNSTILE_SITE_KEY` in wrangler.toml, `TURNSTILE_SECRET` a Pages secret (the owner's); either missing = no check.
  Locally, Cloudflare's always-pass test keys in `.dev.vars`.
  **Access by country** (step 2; by each country's folder since 2026-10-22, « Countries as modules »): the login gate refuses
  a country's data to a session its rule does not let in (403 `{ error: "country", need: "<cc>" }`, `_middleware.js` `needs`):
  `/data/<cc>/…` follows `_lib/access.js` `DATA_ACCESS` (France "members", Spain "all"; a country without a rule: nobody),
  but for `DATA_FOR_ALL` (a country's competitions, agenda, evaluation, validation; `prov/pub/`) and the public `meta.json`
  files; anything else under `/data/` (the provisional results' full files) is France's — deny by default, list a new file
  there only if it holds nothing personal — and so are the APIs of `FR_API` (`ffco-cn`, `ffco-history`, `ask`, `account/relay`). A cookie without `cc` (issued before) is
  checked at once. The Functions' own `env.ASSETS` reads (`_lib/club.js`) do not go through the gate. In the browser
  `auth.sees(cc)` (the session keeps `uid` and `countries`; one without a licence stays signed in; only a 401 signs out —
  `data.getJson`, Réglages, `app.route_`'s private boot —, never a refused or failed read, owner 2026-10-21; the gate keeps a
  handler's own session cookie instead of appending its hourly re-signed one, which overwrote a country just joined), and
  `data.bootPrivate({ fr })` leaves the runners empty without France. The pages are not yet adapted (step 4): until then
  `WORLD_OPEN` stays "0".
  **The provisional results without France** (step 3): `prov.run.build` writes beside each file a copy in `prov/pub/`
  (`public_copy`: runners without `PUB_RUNNER_DROP` — licence, FFCO figures, scores, CNs, `catCn`, birth year —, classes
  without `values`; the index without `PUB_INDEX_DROP` — `lics`, `rlics`, `matched`); `auth.provDir()` picks the folder (the
  pages through `provisional.getProv`, the Tracer's offline copy). Names, clubs, categories, times and splits stay: what the
  organisers publish (owner, 2026-10-20: as open as possible).
  **The pages by profile** (step 4): `app.FR_ROUTES` (the rankings and all they hold, « IA ») give an account without France
  `pages/needcountry.js` (what joining France opens, a link to Réglages › Mes pays) in their place (`r.from`: the page keeps
  its group and menu row, `menuKey`); the « Classement » group stays in the bar, it has no method switch and lands on the
  agenda (`homeOf`, every account's landing since 2026-10-21). **Gate by data, not by page** (owner, 2026-10-20, after « Organisation » opened on the join-France page
  and its pages looked locked): the organisers' pages are everyone's, their lists hold the competitions of the countries
  Ozimut reads (empty without France: `sh.org.noCountry`). A group's tab follows its memory (`ocn.nav.<group>`, the browser's,
  shared by every account signed in on it) only to a page of its own menu. Test a profile as a regular account
  (`pages-dev-user`: an administrator sees every organiser's list) and through the group tabs, after a session of another profile. Résultats and En direct drop their CN, score, expected-place and « matched » columns and tile without
  France; the Tracer's winning times need France. **The site's country** (`country.js`, owner, 2026-10-20: one global
  choice beside the language rather than a filter per page): the countries with data are `meta.json` `countries` (France
  alone when absent); the header's menu is the one place to choose it (owner, 2026-10-21: the Agenda's « Pays » field and En
  direct's own selector are gone) and offers **every country** (owner, 2026-10-29: a country is never left out of it; from 2026-10-24 to 29 only those with data
  were, which dropped Sweden): the account's own countries, a line, the countries with data (meta, plus « En direct »'s,
  `noteLive`), a line, every other IOF member (`MEMBERS`), each part by name, France first (`.cty-sep`). **Each page's « Choisir
  un autre pays »** (`country.hint(list)`, `hintList`; owner, 2026-10-29) offers only the countries that page has something for —
  the Agenda's those with an agenda, Résultats' and Analyse de course's those of their races, En direct's those of its list,
  Analyse multi's those of its analyses — in a small list under the line, then « Tous les pays… » (the header's menu); a pick
  goes through `app.pickCountry` (« ocn:country ») — anyone may race abroad:
  a country's agenda, results and live races are open to every account, without CN (they are not ranked there); default the
  first accepted membership with data (`localStorage ocn.country` once picked); the Agenda's, Résultats' and En direct's lists
  keep the current country's (`country.of`: an item's `country`, France when it has none); a search on En direct looks in every
  country (no « Tous les pays » toggle since 2026-10-21). **Whose list** (owner, 2026-10-23): above the lists of Agenda,
  Résultats, En direct and Analyse de course a line gives the country's flag and name and « Choisir un autre pays », which opens
  the header's menu (`country.hint`, keys `cty.hint.*`); on a wide screen the header's two buttons say « Pays » and « Langue »
  (`.tool-label`, hidden under 640 px: both show a code, « FR » twice for a French reader). **One filter bar for the lists of
  races** (owner, 2026-10-23; `racefilters.js` `raceFilters`): Résultats, En direct, Analyse de course, Analyse solo (its race
  selector) and Analyse multi — Résultats' « Afficher » (its own), Spécialité, Région, Coureur, Rechercher (name, place,
  organiser), each field only when the page's races carry it, the state in the address (`f t reg r who q`; Analyse solo keeps
  its own address: `address: false`). The runner is chosen by a search (France's runners, France's lists), shown with a ✕
  that removes them, beside a choice « Tous | Mes courses » in the look of « Afficher » (owner, 2026-10-29: a lone « Mes
  courses » button looked chosen when it was not): no link to their page any more. Résultats alone opens on one's own races. En
  direct's region and runners come from the same race on « Résultats » (same day, same name words: `live.js` `sameRace`).
  **Registration and Réglages** (step 5): with `WORLD_OPEN` "1" the form asks for countries (`country.membershipFields`,
  up to 5, none required; `country.MEMBERS` mirrors `_lib/countries.js` `COUNTRIES`), else France's licence alone as before.
  Réglages › « Mes pays » (`#/reglages?onglet=pays`, the card `#st-countries`) lists, edits, leaves (POST `leave: true`) and
  joins; France checked with the account's own name; a change restarts the page (the data loaded goes). The licence alerts
  (results, start times) show only with a licence. **Admin** (step 6): « Comptes » has a Countries column; the duplicate
  licence check and the new-account mail skip accounts without a licence (the mail lists the countries). An account without a
  licence is in no Tracer team (`"".split(",")` gave `[""]`: the event list showed demo accounts every team-less event's
  title).
  **Tracer teams by invitation** (owner, 2026-10-20: for everyone, FFCO licensees included; no lookup by name, licence or
  e-mail — an e-mail lookup told whether an address had an account, names have homonyms): « Équipe et partage » makes a link for
  a role (`POST /api/tracer/<id>/invites`, 7 days, 20 at most, only its token's sha-256 kept in R2 `tracer/<id>/invites`;
  listed and revoked there); `#/orga-tracer?id=…&invite=…` opened signed in posts `/join` and the account joins under its own
  name (`{ uid, lic?, name, role, joined }`). The team's PUT only changes roles or removes members (nobody is added there);
  members added by licence before keep their place (`roleOf` and the list match uid or licence; R2 custom metadata `team` =
  licences, `uids` = account ids); account deletion hands an event to a uid member too. An encrypted event's passphrase is
  passed on separately.
  **Texts** (step 7): the privacy page (`content/privacy.*.js` `body(SITE, { world })`) and the home page's tour
  (`tourHtml(counts, { world })`, `tour.*.world`) read `/api/account/status` `world`: they say what is true on either side
  of `WORLD_OPEN`; the countries kept are listed either way.
- **Countries as modules** (owner, 2026-10-22: Spain the first after France, other countries to follow; plan
  `~/.claude/plans/happy-wobbling-lantern.md`): `countries/` — `base.py` (`Country`: code, federation, access rule, database,
  time zones, the federation's ranking), one module per country (`countries/fr`: FFCO's fetch `fetch(args)`, its agenda
  `refresh_agenda`), `registry()`, `write_index` (`site/data/meta.json` = `{ v: 2, countries: { FR: { access, federation, agenda,
  ranking, methods, seasons, counts… } } }`, public). **Each country's files in `site/data/<cc>/`**, the same names in every
  country (France's moved there once by `countries.move_legacy_layout`, run by `update.py`: a rename, retried — Windows' antivirus
  locks a folder of thousands of new files a while —, else copied); the countries' index and the provisional results
  (`site/data/prov/`) at the root. `update.py --out` is the root; `build_site`, `site_extras`, `site_eval`, `site_ask` take a
  country's folder (France's by default). The browser: `data.js` reads the loaded country's folder (`root()`,
  `loadedCountry()`, `useCountry(cc)` on a change of country: its own files, and `store.useCountry` swaps the per-country
  selection — compare, clubs, lastRunner), `data.site()` the index; `country.info/access/ranks`; `auth.sees(cc)` by the
  country's rule; the ranking pages (`app.FR_ROUTES`) need a country that ranks and that the account sees (`ranksHere`), else
  `needCountry` (« no ranking yet » for a country without one). **Runner ids** carry their country: `#/coureur/fr1234567`
  (`link.runner`, `data.parseId` / `fullId` / `localId`; a bare number, the links of before, is France's; a runner of another
  country in the address makes it the site's); the files keep the number alone. `auth.myId()`: one's own number in the
  loaded country (France's licence).
- **Spain** (`countries/es`, owner 2026-10-22; open to every account: its results are all public). **Agenda**
  (`countries/es/__init__.py` `refresh_agenda`, the daily agenda run; `site/data/es/agenda.json` in France's agenda shape with
  Spain's communities and provinces — INE numbers, `countries/es/places.py`): SICO (`countries/es/sico.py`, sico.fedo.org: the
  calendar from today on and, by its month filter kept in the session, the past months; an event's page: stages « Pruebas »,
  registration window, website, announcement PDF, the public entries counted by stage and category — names not kept, IBANs
  struck from the notes) merged with O-Replay's events of Spain (`ffco_scraper/prov/sources/oreplay.py`; country, else its
  time zone), one row per stage — a race SICO lists once per league (« FEMADO: E1 … / solo Madrid », « NACIONAL: E1 … ») is
  one (`merge_stages`) —, ids `es<SICO id>[-<stage>]` or `eso<O-Replay stage>`, `src` the event's pages (« Voir sur SICO /
  O-Replay »); past events are not read again (`FRESH_DAYS`); ~110 requests a day. SICO's home page also lists Spain's licensees
  (name, club, regional federation, SportIdent, licence; ~260 pages): not read yet (runner identity, plan step 5).
  **Résultats**: `races.sync_country` makes the agenda's races (`prov_races.country` ES, key = the agenda's id, `links` the
  O-Replay stage the agenda names; trail-O, rogaines, raids left out: `races.TIMED`); `run.look` reads `links["oreplay"]`
  (classes one by one — a whole stage times out —, status codes 0 ok, 1 dns, 2 dnf, 3 mp…, splits by control code from the
  readings, start times in the event's time zone; `tzdata` in requirements for Windows), liveresultat in the race's country's
  time zones (`run.time_zones`); the organisers' sites are not searched outside France (French words). A runner's SportIdent
  card (`model.runner` `card`, and `sex`, kept only when a source gives them) is never published (`build` drops it). OE12 HTML
  in Spanish (FEDO's « Pos / Nombre / Club / Tiempo », « Error en tarj. », « Abandona »: `oe_html._COLS`,
  `model.STATUS_WORDS`). The pages: Agenda's places, CN column, FFCO link and the « pending » filter follow the country;
  Résultats has no runner filter outside France.
- **Spain's rankings** (plan steps 4-11, 2026-10-22; computed daily, **published** since the owner saw the method measured
  on Spain's races: `countries/es/ranking.py` `PUBLISH`). `update._countries` (the daily full run, `COUNTRY_BUDGET`
  900 s; O-Replay's history an hour a night, `BACKFILL_BUDGET`, until `oreplay_backfilled`) runs
  `countries.es.ranking.update`: SICO's licensees (`licensees.py`, monthly, ~263 requests: name, club, regional
  federation, card, licence — never published), FEDO's ranking files (`official.py`, every season 2017 on: licence, category,
  total, M1/M2/M3, points race by race — Spain's « official »: M1 else M2), the Liga Española's results (`fedo.py`, OE12 HTML
  else PDF — the PDF reader knows OE12's Spanish columns since 2026-10-22, the Spanish championships are often PDFs only; a file
  unread is tried again when `fedo.READER` goes up —, the file's print date as the race's day), the provisional results' Spanish races (`archive.from_prov`), O-Replay's
  past events (`archive.backfill_oreplay`, 2024 on, a budget per run until done). The archive: `CN_DATA_DIR/es.sqlite3` in
  France's tables (`archive.py`: a race = a competition, classes with the same controls = one circuit, `categorie` normalised by
  `categories.py` with `cat_src` kept, `NOT_RANKED`/`prune` leave out score-O, rogaines, relays, phone orienteering, training
  camps and sessions (« Entrenamiento », « PNTD », « Tecnificación », « Concentración »: the national team's camp put a runner at
  25 440), school leagues (« Liga escolar »: children racing among themselves, outside the federation's races, as France's CN
  leaves school sport out), a runner's second run (« Name #2 », `REPEAT`) and, as « nc », a finish under a quarter of its
  circuit's median (`TOO_FAST`: a run cut short) and the non-competitive classes (`OPEN_CLASS`: « OPEN NARANJA », « Familiar »,
  « Iniciación »…, 6 % of the rows, even on a course shared with ranked classes: a 5-runner « OPEN ROJO F » gave 12 602); O-Replay's
  multi-day totals, stage type « Overall », are not races — `oreplay.is_overall`, left out of the stages, the agenda and the
  archive, those read before dropped once by `archive.drop_overall`; a race FEDO's file and another source both hold keeps
  FEDO's only, owner 2026-10-22 — `archive.dedupe`: half the finishers with the same name and time, the copies noted
  « dup:<course> » and never imported again); who is who
  (`countries/identity.py`: names word by word in any order, particles aside, a first name cut to 3 letters; a licensee by card
  or by the one name that fits, the club deciding; else a person of its own by name and club; `persons` / `person_keys`, stable
  numbers = the runners' ids, es<n>); clubs (`clubs.py`: `canonical` — a town before the club, « Independiente », regions'
  teams —, then a number and the regional federation's letters, « 0026FADO »; `names` for the build). The engine: `bootstrap`
  (`cn_engine.py`: the first season from each runner's first category's usual level against H21 as measured in France,
  `prior` = `ranking.category_level` / `CATEGORY_LEVEL` — an equal start left every category on one level, a 12-year-old above
  the elites, since Spain's categories mostly race on courses of their own —, then from their own first level; `days=None`,
  Spain's choice: the seeds never expire — FEDO's files have no sprint from 2020 to 2024, after which nobody held a sprint index
  to value a circuit again and the sprint and VTT indexes stopped), `title_weight` reads the league
  (`groupe`: Campeonato de España 2, Liga Española / nacional 1.5). **Spain's own parameters** (`Country.method_params`,
  `cn_engine.build_methods(overrides)`, also used by `build_site`): forest circuits valued on the fastest two-thirds; 2 races
  for an index, measured here first, France's rule too since 2026-10-23. The measure (2026-10-22, July 2025 - October 2026, the same runners, the scratch `es_eval.py` / `es_cmp.py` /
  `es_prior.py` kept in `C:\kerkia\cn-data\scratch-scripts\C--kerkia-CO\4475af57-627e-4f46-9da2-48f0d9da2385\scratchpad`): two-thirds +0.41 forest, 2 races
  +0.67 sprint, both with the category start +0.52 forest [0.32, 0.71] and +1.70 sprint [1.04, 2.38] over France's settings; the
  category start costs nothing (forest +0.35, sprint −0.55 ns); a 24-month window −1.1 to −1.6; against FEDO's rule on the day
  (winner / time × 100 within the category, the best 6 of 12 months) +3.8 forest [3.4, 4.3], +4.0 sprint [2.9, 4.9] on the
  2024-2026 archive, and with everything above on the archive from 2018 (`final`) +5.0 forest [4.5, 5.4], +5.4 sprint [4.3, 6.5]; against
  FEDO's published previous-season M1 +12 (most of it the ranking's age). **Known limit**: the veterans' level against H21
  drifts up over the seasons (the archive from 2018: H65 0.89 of H21's median in 2026, France 0.72; H55 0.90, France 0.82; a
  70-year-old third in sprint; France's settings alike) — the ranking across categories, not the duels within a circuit. Not an
  error the races show (2026-10-23, the scratch `es_bias.py`): on circuits where they meet H/D 21-34, the share of duels the
  index gives the veterans minus the share they win: forest 35-50 +3.6 [−0.7, 7.2], 55+ +5.1 [−6.6, 11.1], sprint +0.8, −2.0, none
  significant (France's juniors +2.3 to +3.9) — Spain's « H21 » holds the recreational B classes, which lower its median. Left as it is.
  Categories read from the printed class (`categories.normalise`, again over the whole archive by `prune`): « M-18E », « INF
  MAS », « CAD FEM », « M-Vet 45 », « M-SE », school years (« F-3ºESO »); still unknown: course letters (« A », « B »), « U-10 »
  without the runner's sex, colour courses (9 % of the rows). A name first met with letters its file could not hold (OE2010's
  windows-1252 exports: « Micha? Olejnik ») takes the same runner's spelling from another source (`identity.resolve`). Every runner of Spain's races is ranked,
  visitors included (the top of the 2026 forest list: veterans of the Maximus O Meeting, who beat Spain's own by minutes).
  `build_site --country ES` (names from the country module, no anonymisation list or login
  index, `official` only when the country has values, meta `country`); `site_extras` keeps France's elite, cfc and evaluation
  to France. CI keeps the other countries' databases in the site state (`ci/state.py` `other_dbs`, `OTHERS_BEFORE`).
  **FEDO's ranking** is not a method but a table of its own (`official.site_table` → `site/data/es/official.json`, meta
  `official_table`, the index's `official_table`): each season's and discipline's table as FEDO publishes it — its race columns
  in its order, named from its legend by the longest code a column starts with (« CEOM » → « CEO ») —, each runner linked when
  Ozimut knows the licence; shown in Classement's tab « Classement FEDO » (`pages/fedranking.js`) and the runner's « Saisons »
  card. So Spain's method switch has Ozimut alone (`store.available` is the loaded country's `methods`, `useCountry(cc,
  methods)`; `store.get().method` falls back to it without overwriting the saved choice; the switch is hidden with one method).
  **The pages outside France** (`data.loadedCountry() !== "FR"`): no licence column or badge (Spain's numbers are Ozimut's), clubs
  by name not number, « Fédération régionale » for France's « Ligue », no départements, no « Carte » tab, no FFCO links, no
  relay simulator, no « Points nationaux », no Statistiques › « Territoires », no « IA » (France's tables, `FR_API`); one's own
  runner (« Ma page » → `fr<licence>`, the « me » row, « Mon club ») only in France's data (`auth.myId`). The Documentation
  says what differs (`doc.country.ES`). **Files packed** (Pages takes 20 000 files a deployment; France ~14k): meta `bucket`
  (r/ and net/: a runner's number // 10 in France, // 100 elsewhere, `site_io.runner_bucket`, `data.bucketOf`) and
  `club_packs` (67, a prime: 64 left 10 files empty and one with 162 clubs; club/ and club_courses/ in `p<n>.json` by a hash of the club's code, `site_io.club_pack` = `data.clubPack`):
  Spain ~1,250 files instead of ~7,500.
- **Agendas of 29 more countries** (2026-10-23; the agenda only, the owner's request: « for every IOF country, its calendar
  where a clean way exists »). The study (six research agents, every IOF member, each source fetched with our user agent; samples
  kept in the session's scratch): a clean source is a public API, an export (CSV, iCal) or a stable server-rendered list, read
  without a login or a key, never behind a bot challenge. **Read**: AT (ANNE's JSON API, anne-api.oefol.at), BE (O'Punch's JSON
  list, both federations; NL/LU clubs on it left out; its clubs' contacts and bank details never kept), BG (bgof.org's list), BR
  (CBO's JSON service, a month a request), BY (orient.by's year table), CH (o-l.ch's CSV), CZ (ORIS's JSON API), DE (OManager's
  CSV, upcoming only), DK (DOF's « Stævnekalender », upcoming only), EE (EOL's month view over the window), GB (British
  Orienteering's finder, ~40 pages a day), HK (OAHK's public Google Calendar, iCal), IL (ISOA's grid), IT (FISO's CSV: the year's
  filter is set in the session first), JP (Japan-O-entrY's list), KR (KOF's board), LT (the calendar page's embedded JSON), RO
  (FRO's JSON API), RS (OSS's ORIS year table), TR (TOF's FullCalendar JSON in its home page), UA (FSOU's month form, POST), ZA
  (SAOF's yearly TablePress page). **Not read**: SE, NO, AU, IOF Eventor, Eventor World (HK), PT (OriOasis), CA's federation
  (Cloudflare challenges; Eventor's API needs a federation's key — the clean way, ask them), NZ (SiteGround captcha), MD (403),
  HU (mtfsz.hu resets the connection), RU and KZ (orgeo.ru, rufso.ru unreachable), FI (IRMA, a Vaadin app; Navisport has an open API
  but holds the clubs' training series, not the calendar), LV (lof.lv: a private base64 RPC, robots « Disallow: / »); partial,
  left for later: US (OUSA's Google Calendar, national races only; EventReg), CA (WhyJustRun, a dozen clubs), NL (a hand-edited
  page), CY, CO, AZ, TW (a PDF); nothing found for MX, AR, CL, EC, UY, MT, GR, BA, ME, XK, UZ, SG, MY, TH, PH, VN, IN, PK, MN, KE, MA, TN, IS.
  **Code**: one module a country, `countries/<cc>.py` (`COUNTRY` with `results=False`: its races are not taken into the provisional
  results, `prov/run.py`; `read(http, today[, prev])`), on `countries/agenda.py` (`event()` the agenda's row — discipline and format
  read from names in a score of languages, Cyrillic, Japanese, Chinese and Hebrew included, the cancelled words taken out —, `ics()`,
  `abroad()`, `hooks()` = `refresh_agenda`, `agenda_path`, `agenda_current`, the file's `sources` naming the « Voir sur … » links);
  `countries.AGENDA_ONLY` lists them, `functions/_lib/access.js` opens their folders to every account. Sources that list only the
  coming events (DE, BE, DK, GB, JP, IL) keep the last weeks' from the previous file. The Agenda page: an event's `end` (dates
  « du … au … », kept in the list while under way), `level` (« Niveau »: the source's own level or series), no « no online entry »
  box when a source gives no entries, no second place filter when the regions have no subdivisions. About 300 requests a day for
  all 22, ~3 min (the 06:00 agenda run); each agenda's own `AGENDA_VERSION` rebuilds it.
  **Seven more the same day** (the owner: « add the partial sources too »): PL (PZOS's year page, one row a competition, the
  stages' disciplines by their icons; « WRE zagraniczne », World Ranking races abroad, left out), SI (OZS's year calendar: the
  icon gives the discipline and the level, « _1 » the league, « _2 » a national championship; « drugo » events and races abroad
  left out; « ODPOVEDANO », « PRESTAVLJENO » struck through), SK (SZOŠ IS's year list, 30 rows a page, its robots.txt's
  Crawl-delay of 10 s kept: `hooks(…, pause=10.0)`, ~1 min), IE (Orienteering Ireland's fixtures, upcoming only; club-closed
  events left out), and HR, MK, GE from OrienteeringOnline.net (`countries/oonline.py`: the search form's GET then POST with
  the country's number and the window, the date pickers' `$State` JSON needed; a full page of 30 cut in two; each competition's
  page read once, when first seen — last day, organiser, place, website, entry deadline; its e-mail never kept —, then taken
  from the previous file; only the competitions taking entries there). About 30 more requests a day.
  **Regions and finer units** (owner, 2026-10-24: « the region/state/province/land… for all countries where this makes sense, even
  a more granular level »; every agenda's `AGENDA_VERSION` 2, BR and UA unchanged): events carry `region` and `dep` as France's and
  Spain's, the file `regions` [{name, depts}] and `depts` {code: name} of those met (`agenda.places_of`; `order` for JP's regions).
  A town, forest or park is placed by `countries/places.py` `locate(cc, text, expect=, region_only=)` on a table a country,
  `countries/places/<cc>.json.gz` (folded name → candidates [region, dept, log weight]), made **offline** from GeoNames (CC BY 4.0)
  by `tools/gazetteer.py` (`fetch` into `$CN_DATA_DIR/geonames`, `build [cc…]`; the levels, local names and renames per country in
  its `UNITS`/`RENAME`; names indexed in the calendar's script only; ~6 MB in all): no geocoding service at run time. The text is
  read part by part (postcode + town kept, a street and number dropped, « обл. » / « р-н » / « St. » written out, another country
  named → not placed: `agenda.abroad_of`), a whole part outweighing a word inside one, a bigger place a smaller; a name met in
  several regions is settled by the calendar's own region (`expect`) or not placed. `hooks(place=…)` places every row at each run,
  the past rows kept from the previous file too (even of an older version); a row still unplaced takes the region of all its
  organiser's other rows (`_by_org`, two at least). Per country: **AT** Land / Bezirk (« Graz (Stadt) », « Innsbruck (Land) »), the
  host's Land as `expect`; **BE** region (Bruxelles / Wallonie / Vlaanderen) / province, Flanders' federation → Vlaanderen when
  unplaced; **BG** oblast from the event's name only (clubs' names are villages too); **BY** oblast / raion from the place, the
  calendar's « Общереспубликанские » / « Международные » moved to `level`; **CH** the regional association (the CSV's own « region » column, always kept, even when the canton is another
  association's: Ticino's « Roveredo GR ») / canton by its
  letters: first from the CSV's own Swiss grid coordinates (`coord_x`/`coord_y`, LV03 or LV95, → `gps` by swisstopo's formulas,
  `ch.wgs84`; the CSV has no canton column, nor the event's page) against the table's `points` — every populated place's position
  and canton (`gazetteer.POINTS`), the 5 nearest within 8 km voting by 1/distance, `places.nearest`; 45 of 183 events on
  2026-10-24, the coming ones mostly without coordinates yet —, else letters after the place or after it in the name
  (« Roveredo GR »), else the name, else a word of the place or the title that is a village of the event's own association
  and of one canton there, a forest named after its village (« Allschwilerwald ») included (`ch._by_word`: « i.d.R. Magglingen »,
  too small a village for `locate`; a canton named in the title, « Basler », not taken) (145 of 183 with a canton; forest
  names such as « Bohärdli » are in no gazetteer); **CZ** kraj / okres, ORIS's section → its kraje
  as `expect` (one kraj: the region when unplaced); **DE** Land / Kreis (« Landkreis X » kept beside a city X); **DK** DOF's kreds (as the
  calendar) / kommune; **EE** maakond / vald or linn; **GB** British Orienteering's association (as the calendar) / county or unitary
  authority, the nation as `expect`; **HK** area (香港島, 九龍, 新界) / district, venue else name; **HR** županija / grad or općina; **IE**
  province / county (the calendar's county); **IL** district only (subdistricts not in Hebrew); **IT** region / province by FISO's
  « (TN) », else by name (the organising committee is not the place's); **JP** 地方 / prefecture (the calendar's); **KR** province /
  si-gun-gu; **LT** apskritis only; **MK**, **SI** the municipality (their first level; Slovenia's statistical regions are not in
  GeoNames); **PL** voivodeship of the organising club's town (« UKS Azymut 45, Gdynia »: the list gives no place), no finer unit;
  **RO** development region / județ by its letters; **RS** statistical region / okrug; **SK** kraj / okres; **TR** geographical region
  (Marmara, Ege…) / il; **ZA** province / district or metro; **GE** region only; **BR** state and **UA** oblast as the calendars give
  them. Placed on 2026-10-24: AT 115/139 events (100 with a Bezirk), BE 189/211, CH 183/183 (145 cantons), CZ 232/307, DE 109/126,
  GB 822/836 (747 counties), IT 162/162, JP 110/126, EE 100/128, IL 30/83, BG 12/34, PL 34/40, HK 12/54 (most without a venue).
  The Agenda page: each country's level names (`agd.region.<CC>` / `agd.dept.<CC>`, else « Région » / « Province »), a unit whose
  code is its name shown once, a short code in brackets, a name after « · », nothing when the place already says it (« (TN) »);
  the region its own column after the place, named as the country's level (« Association régionale » in Switzerland, the
  calendar's own column, « Land »…), under the place on a phone (owner, 2026-10-24: shown even where no finer unit is known).
  The filter bar's click handler took `<body data-group>` for a group chip: any click in the filters emptied the list (fixed).
- **The Agenda's map** (owner, 2026-10-25: « on a computer, a map of the chosen country, the competition's place shown as soon as
  the mouse is over it in the table, all the more once it is selected »): above the details (`.agenda-side`, sticky; hidden and
  not fetched under 980 px), `site/assets/js/agendamap.js` draws the country as SVG from `site/assets/geo/<cc>.json` — Natural
  Earth's 1:10m countries and first-level units (public domain), the land around the largest piece (overseas left out), the
  neighbours cut to the frame, simplified to ~a pixel, ~10-70 KB a country, made once by `tools/countrymaps.py` (`fetch` into
  `$CN_DATA_DIR/naturalearth`, `build`): no map service is asked anything. Every event of the table is a dot (one per place), the
  row under the mouse (or focused) and the selected event in the control flag's orange with their place's name; a dot shows its
  events on hover, a click selects them in turn (the row tinted `map-hover`); wheel or + − to zoom, drag to move, ⤢ the whole
  country; a selected event outside the view is brought into it. **Positions**: the organiser's `gps`, else `pos` [lat, lon] —
  its town, from GeoNames — or [lat, lon, 1], its finer unit's (else region's) centre, drawn hollow and dashed («  lieu
  approché »). `countries/agenda.py` `add_positions` (`places.position`: the place, else the event's name, within the event's
  unit — its code, else its name, Spain's INE numbers; a name of two places over 15 km apart in the unit is no town; a town
  before a unit of its name) runs after every agenda refresh and once on a file of an older `POS_VERSION` (`update._agenda`,
  `_agenda_positions`, the deploy-only run too); `comparable` keeps positions out of the « changed? » checks (hooks, Spain's,
  FFCO's `_digest`). The places tables carry the positions since (`v` 2, tools/gazetteer.py: a candidate's town to ~1 km, a 6th
  field 1 for a unit's centre, `rpos` and the depts' centres = the mean of their towns; the placement data unchanged, checked
  table by table) and France (régions, départements by number) and Spain were added for it. Measured 2026-10-25 on the local
  agendas: France 1 810 events by town, 28 by GPS, 172 at a centre, 10 not placed, of 2 020; Britain 752 / 28 of 836;
  Switzerland 45 GPS, 87 town, 51 centre; Poland 1 town (its list gives only the club's voivodeship). Lakes are not drawn.
- **No FFCO for those outside France** (owner, 2026-10-20): a visitor or an account that has not joined France never meets
  « FFCO » outside the site's rules (privacy page, « Indépendance et sources »): the home page, the footer, the shared pages
  (Agenda, Résultats, En direct, Réglages, registration, the Tracer, the organisers' deposits) and the e-mails speak of « la
  fédération », « officiel », « là où Ozimut a les résultats de votre fédération »; the CN column and tags show with France only
  (`auth.sees("FR")`). Exceptions: the France option's own licence field (« Numéro de licence FFCO », once France is chosen),
  the France-only pages, links to FFCO's own pages, and the Ozimut method's tab and study (validated on France's results). The
  country is chosen in the header only (always shown). The footer holds only the rules' link and
  the counts: the site's independence is said in the rules (owner, 2026-10-20). **The Documentation shows what the account
  sees** (owner, 2026-10-20): without France no « CN officiel » tab, and « Les calculs du site » keeps only the split times
  (`fr` passed to `content/methods.*.js`: `TABS`, `SITE_CHAPTERS`, the lede, the note); the Ozimut method and the study stay.
- **Competitions declared by their organisers** (owner, 2026-10-20: non-France organisers post their own competitions, start
  lists and results under their country). France's competitions come from FFCO's calendar; elsewhere an account with an accepted
  membership (France apart) declares one under « Organisation » — the card « Mes compétitions déclarées » (`site/assets/js/declare.js`)
  on Résultats, Horaires and Compétitions: country, club (the membership's by default), name, date (60 days back to ~13 months
  ahead), place, discipline, format, website. `functions/api/declared.js` (GET mine — an administrator's: all —, POST, PUT, DELETE =
  status « removed »; 20 a day) keeps it in R2 `declared/<id>.json` (`_lib/club.js` `DECLARED`, `loadDeclared`, `declaredRace`), race
  key `d<id>`, and starts a `prov` run. **One lookup and one organiser rule for every competition key** (`_lib/club.js`): `findRace`
  (a `d` key from its declaration — who declared it is never published —, else « Résultats », else the agenda's `a<id>`) and
  `organises` (an administrator; for a declared competition the account that declared it; else a member of the organising club),
  used by uploads (results — organiser only for a declared one —, start lists, courses), the multi analyses and the Tracer. An
  upload's meta.json carries the declaration (`declared`), so `sources/upload.race_for` adds a race the run has not seen yet. CI
  syncs `declared/` to `$CN_DATA_DIR/declared`; `sources/declared.py` upserts `prov_races` (column `country`, added by
  `store.connect`; NULL = France) and drops removed ones with their documents. `run.build`: declared races listed up to
  `ORG_START_DAYS` ahead even without a start list (index `country`, `url` = their website), their runners never matched to French
  licences nor scored (`foreign`); `races.merge_duplicates` only merges France's. Pages: the Agenda adds the index's coming `d` races
  as events of their country (`declaredEvent`: no registration box, no FFCO link; France's regions, départements and CN filter only
  when the country is France); the organisers' lists, the deposit and the Tracer's competition picker add the account's declared
  ones. The site's country menu offers the countries with data and those the account has joined (`country.withData`), the first
  joined by default. The race page shows France's CN notes, « ? » marks and scores only to France's members on a French race (`CN`).
  The privacy page says what a declaration keeps. Tested 2026-10-20 locally (a Swiss account: declare, start list, results, Agenda,
  Résultats, analysis, Tracer; France unchanged) and the pipeline on a database copy.
- **Admin › « Consommation »** (owner, 2026-10-20; `functions/api/admin/consumption.js`, `?onglet=consommation`): the free
  plans' use against their limits (`LIMITS`, checked by hand — change them there), the last 30 days as bars under the limit.
  E-mails and accounts from D1 (`mail_log` is never pruned); the rest from Cloudflare's GraphQL analytics and REST API —
  `workersInvocationsAdaptive` + `pagesFunctionsInvocationsAdaptiveGroups` (requests), `durableObjectsInvocationsAdaptiveGroups`,
  `aiInferenceAdaptiveGroups` (neurons), `d1AnalyticsAdaptiveGroups`, `r2OperationsAdaptiveGroups` (class A/B by action),
  `r2StorageAdaptiveGroups`, the D1 list's `file_size`, the Pages deployments of the month — each asked on its own, a failing
  one shown « indisponible » with its error. Needs the Pages secret `CF_ANALYTICS_TOKEN` (read-only: Account Analytics, D1 and
  Pages: Read; the owner's), optionally `CF_ACCOUNT_ID`; without it only D1's figures show. The dataset and field names were
  written from Cloudflare's documentation and not yet run against a real token.
- **Third-party code is served by the site itself** (owner, 2026-10-18: Safari reported cdn.jsdelivr.net as a tracker; no
  public CDN since): ECharts, pdf.js, pdf-lib, fontkit, fflate, proj4, the countries' flags (flag-icons' 4:3 SVGs, `vendor.flag`;
  `python tools/vendor.py build <package>` rebuilds one package alone), DuckDB-WASM (its browser module bundled with
  apache-arrow by esbuild) and the fontsource fonts (Roboto, Roboto Condensed, Noto Sans JP / TC / HK: their CSS and the .woff
  files the Tracer reads) live in `site/assets/vendor/<name>@<version>/` with their licences, built from npm by `tools/vendor.py`
  (`build`; nothing of a package's install scripts runs); files over Cloudflare Pages' 25 MiB are split in two parts that
  `vendor.joined` puts back together (DuckDB's engine, 34 MB). The code takes every path from `site/assets/js/vendor.js`
  (ECharts from `index.html`). **Check for updates regularly** — at least monthly, and whenever a library's security advisory
  comes out: `python tools/vendor.py check` lists newer releases; to update one, change its version in `tools/vendor.py`,
  `build`, change it in `vendor.js` (and `index.html` for ECharts), test the pages `vendor.js` names for it, commit. Major
  versions need reading their changelog first (pdf.js and DuckDB change their APIs). Never add a `<script>` or `import()` from
  another host: vendor it.
- **The move to ozimut.com** (owner, 2026-10-19; plan: private artifact https://claude.ai/artifact/HQuwgQwKg9nexvGioSK77M).
  The name « Ozimut » is written with a capital O, the rest lower case, and **its O in the control-flag orange** wherever it
  is drawn (`.brand-o`, the e-mails' header, the reel's `.rv-logo-o`); tagline « La course d'orientation, en cartes et en
  chiffres » / "Orienteering, in maps and numbers". Everything a browser keeps belongs to one address, so the old one keeps
  serving the whole site (data and API too: a page held there must still work) and **its pages send visitors on**
  (`assets/js/bridge.js`, called first by `app.start`): `leave()` on an `OLD` host reads an allowlist of localStorage
  (`KEEP`: theme, state, language, navigation memory, the tools' prefs, calibrations, relay, VMA, games, the Tracer's field
  queue; `NEVER`: `ocn.liveBase`, `ocn.ia.byok`, `cnx.session`), asks `/api/account/handoff` for a one-time token when
  signed in (signed with `SESSION_SECRET|handoff`, so never a session cookie; 60 s; used once — D1 `handoffs`, migration
  0013), and opens `https://ozimut.com/#oz=<deflate-raw, base64url>` (the fragment never reaches a server; calibrations
  dropped first past 60 000 characters); `arrive()` on the new address takes the payload out of the address at once,
  stores the settings it does not have, redeems the token (`auth.handoffLogin`), reloads on the page asked for. A browser
  whose Tracer still has saves or photos waiting (IndexedDB `ocn-tracer` « pending », « photos ») stays on the old address
  under a line saying why (`.bridge-note`). `OLD_HOSTS` (wrangler.toml) is the server's list (the hand-off issues tokens only
  there); push: `push_subs.origin` (migration 0013), a device subscribing again on the new address drops its old
  subscription of the same label. Local test: `OLD_HOSTS=localhost` and `SITE_URL=http://127.0.0.1:<port>` in `.dev.vars`,
  `localStorage["ocn.bridgeTo"] = "http://127.0.0.1:<port>"` on localhost. Internal names stay: Pages `observatoire-cn`, D1
  `ocn`, R2 `cn-state`, Worker `ocn-live`, repo `kerkia/CN`, the `ocn.*` / `cnx.*` browser keys, the method key `top6w`.
  **Switched on 2026-10-19 evening** (`bridge.ACTIVE` true, 348a5a5; before it, false moved only `?demenagement` visitors).
  The window about the move (`moved.js`, D1 `users.moved_notice` 0 = to show, set for the accounts of before the move) shows
  once on the new address. Mail goes from alert@ozimut.com (the Resend key's domain is « All domains »), replies to
  contact@ozimut.com (Proton). The ozimut.com zone's Browser Cache TTL is « Respect Existing Headers »: its default (4 h)
  overrode Pages' `max-age=0` on `/assets/` and kept old modules after a deploy. ocn.kerkia.com stays attached indefinitely.
- GitHub may occasionally fail runs on its own (e.g. "job was not acquired by Runner"): check
  githubstatus.com before suspecting the code; the next hourly run catches up.

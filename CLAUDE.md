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
| `ffco_scraper/prov/` | Provisional results (« Résultats »): organisers' results, often before FFCO publishes — races (`races.py`), sources (`sources/`: liveresultat, WinSplits, Helga, Orientation Data, the club's site), parsers (`parsers/`: OE/MeOS HTML, IOF XML, PDF), matching to licences (`match.py`), provisional scores (`compute.py`), run + output (`run.py`) |
| `notify.py` | E-mail digests (new results, new competitions in subscribed regions) through `/api/notify` |
| `site/` | Static single-page app (vanilla JS modules, no build step). `assets/js/pages/*.js` one module per page, `i18n.js` all French text, `cn.js` the CN computation mirrored in the browser, `data.js` data access and the column index maps `R` (runner race rows) and `C` (race result rows) |
| `functions/` | Cloudflare Pages Functions: `_middleware.js` (login gate, deny by default), `_lib/club.js` (an account's club, a race's organiser), `api/account/*` (accounts on D1), `api/admin/*`, `api/notify.js`, `api/ffco-history.js` and `api/ffco-cn.js` (proxies to FFCO pages, logged-in users only, cached and rate-limited), `api/analyses/[[path]].js` (the shared GPS analyses, in R2) |
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
  build_site.main(['--out','site/data','--db', <db>])"`. Test engine changes on a **copy** of
  `C:\kerkia\cn-data\ffco_results.sqlite3`, never on the original.
- To stop the dev server on Windows, kill `workerd` and the `node` processes running wrangler.
- After a JS change, check the page in a browser (console errors!) before pushing; the browser may cache
  modules — hard-reload.

## The CN methods

All methods share the race score: circuit value = mean of (CN J-15 × time) over a sample of the ranked runners holding
a CN (FFCO and the linear methods: the arithmetic mean over the fastest ⌈2N/3⌉; the retained methods: the geometric
mean, over every ranked CN holder in forest and the fastest ⌈2N/3⌉ in sprint — `CnParams.sample_fraction`, `cv_power`
0 = geometric, per terrain); score = circuit value ÷ time; PM / abandon / disqualified / over time score 0 and count.
12-month window. Four specialités, each ranked separately: forest (`For`: LD/MD/Nuit), sprint (`Spr`), VTT
(`VTT`, all formats together) and ski (`Ski`, all formats together) — FFCO's own split (`specialite=` on its
CN pages). In the DB `competitions.terrain` is "Forêt", "Sprint", "VTT" or "Ski"; the site uses the codes.
VTT (~30 competitions a season) and ski (2-4, on one or two weekends) have their own Fit/Top params
(`CnParams.by_terrain`, `for_terrain`; `meta.methods.*.params.by_terrain`, `cn.paramsFor` in the browser):
window 2 years (VTT) / 3 years (ski), best 70 % — with 12 months, too few riders held a CN to value the
circuits (VTT: half the circuits, 5 of 83 in 2021; ski: nothing after 2013). The official window stays 365 days.

1. **`official`** — FFCO's published values, copied verbatim (before 2026 FFCO had one pooled pedestrian
   ranking for forest and sprint, filed under "Ped": `build_site.official_terrain`, `data.snapTerrain`,
   `data.inSeries`; VTT and ski always had their own). The runner page's official calculation card reads FFCO's own
   CN page live (`/api/ffco-cn`): FFCO re-evaluates past-season races under **new circuit ids** that only that
   page links, so its points can differ from the race's results page.
2. **`fair`, « Méthode CN « Fit »** (« Juste » until 2026-10-12) — estimates each runner's **strength** (usual level); it also values the
   circuits. CN = weighted mean of the best 60 % of the window's scores (`top6_weighted` with an unlimited
   number of places). Weights by competition **name** (`cn.title_weight`): "Championnat de France" 2,
   "O'France" or "Nationale" 1.5, anything else 1 (Sélection races and Championnats de Ligue included, FFCO's
   A/B/C/D level not used). ≥ 3 races for a CN, a circuit needs ≥ 4 ranked CN holders.
3. **`top6w`, « Méthode CN « Top »** — ranks runners by **potential at their best** (suited to qualifications).
   **Derived from `fair`** (`CnEngine.derive`): same race scores, circuit values and recalage factors; only the
   CN differs — the best 60 % scores fill **6 weight places** from the best down, the last race only for the
   places left. Racing more can only raise it (monotonic).
4. **`fair3` and `top6w3`, the methods retained** (study of 2026-10-13, owner's go-ahead; ENGINE 8) — the same two
   methods with the CN as the **weighted cubic mean** of the kept scores (`cn_power` 3: computed at race level, a runner
   1 % slower than another gets 3 % fewer points and the CN is the plain mean of those scores, shown on the usual scale —
   the two are exactly equivalent once the circuit value is geometric) and the circuit valued by the **geometric mean of
   CN J-15 × time over every ranked CN holder in forest** (`sample_fraction` 1.0, `cv_power` 0), over the fastest ⌈2N/3⌉
   in sprint (geometric). FFCO's two-thirds leave out the runners who made mistakes: the value came out 4.8 % too low on
   average in forest, unevenly (sd 5.4 points, following the circuit's mistake rate — the junior circuits most), so a
   runner's score depended on the circuit's trap density; in sprint, where mistakes are half as frequent, the whole field
   loses. **One method for the four disciplines since 2026-10-14** (owner; ENGINE 9): VTT and ski follow sprint's rules
   (geometric value over the fastest two-thirds, cubic usual level; before: FFCO's arithmetic two-thirds and the quadratic
   mean) - only the window, the share of best scores and the share of the field valuing a circuit differ (the whole
   field in forest only: measured with the arithmetic Top, it costs sprint -0.21 [-0.29, -0.15], 9 seasons of 15 worse,
   and VTT -0.63 since July 2025, worse every season since 2022; forest gains about +0.6, every season). The sprint
   rules cost VTT -0.06 [-0.09, -0.03] (`eval_unify_n.json`, variants U1/U2 on study copies w7/w8). **Since 2026-10-15** (owner:
   no binary « all or two-thirds »; ENGINE 10) the share of the field is a **dial**, `CnParams.tail_k` (`cn.circuit_value`, mirrored
   by `cn.js circuitValue`): V = A^(1-w) x B^w, A = the fastest ceil(2n/3) (always: FFCO's « all four when only four » dropped)
   times the discipline's usual tail effect `tail_mean`, B = the whole field, w = n / (n + k). k chosen by one criterion - the
   best duels on 2012-2024 without a significant loss since July 2025 (`eval_tail*_n.json`, against the rules of 2026-10-14):
   forest 0 (whole field; k = 3 already -0.05), sprint 400 (+0.11; flat from 200 to 1000, the gain is the four-runner exception
   dropped), VTT 50 (+0.12; smaller k win on 2012-2024 but lose since 2025), ski 50 as VTT (unmeasurable). No physical reason is
   known for forest wanting the whole field and sprint almost none: a split-half test showed the slow tail as reliable in sprint
   as in forest at equal size, and one k for all loses forest every season. `top6w3` derives from `fair3`. **Since 2026-10-14** (owner: the rank built only from a
   weighted arithmetic average of the race scores; TOP6W_CN_VERSION 5) the Top `top6w3` is the weighted **arithmetic** mean of
   its 6 places in every discipline (`top3` in `build_methods`, and `Normalisation.anchor_cn_power` 1 so the recalage anchors
   on that Top); `fair3`, the usual level that values the circuits, keeps the cubic mean (quadratic in VTT and ski): the
   « 1 % slower, 3 % fewer points » reading above now describes the usual level only. Measured against the cubic Top on the
   same runners, 2012-2024 (study copy w6, `eval_arith_n.json`, `eval_vtt_arith_n.json`): duels forest −0.01 [−0.02, −0.00]
   (national 0.00), R² −1.1 pt; sprint −0.10 [−0.14, −0.07], R² −3.4; VTT −0.09 [−0.12, −0.06], R² −1.8; the median CN −0.2 %
   before recalage, one runner in ten −1 % or more. Best 50 % instead of 60 % did a little better in forest (+0.06) but was
   picked on the same seasons: not adopted, to confirm on fresh seasons. Their recalage (`Normalisation` of `fair3`) **anchors the
   Top's cohort** (`anchor_top_n` 6: at each CN point, the Top the raw scores would publish — `CnEngine._anchor_rows`) and
   corrects the **drift of the raw scale** (`mode` "monthly_drift": the 13-month mean carried `trend_ahead_months` 7
   past the month fitted for, by the slope of ln(level) over `drift_months` 121; in every discipline since 2026-10-14,
   counted in calendar months, `Normalisation.calendar_months`: a month without races keeps the previous level - before,
   only months with races counted, and ski's « 13 months » spanned years; carried 10 calendar months, not 7: in calendar
   months 7 left forest 2.7 % above 5600, 10 keeps forest, sprint and VTT within 2 % at every date checked; ski cannot be). Why: a CN keeps the best races and the next circuits are valued with those CNs, so the raw scale
   climbs (0.35 %/month with FFCO's value, 0.9 % with the geometric one) and the plain mean trails the scores it scales by
   18-20 months — the forest level sat at 6007/6144 (Fit/Top) instead of 5600, and would have sat at 6600. The
   quadratic pair `fair2`/`top6w2` (2026-10-07 to 13; ENGINE 6-7: the CN as a quadratic mean on FFCO's circuit value —
   a k from 1 to 3 on the circuit value cost on national races, so only the CN had it) was dropped: the study's full
   report is the private artifact https://claude.ai/artifact/1JSufP7jr3c9peCdSUwBuC. Also measured there and rejected:
   the Top as its own circuit valuer (the loss grows over the seasons: −0.001 in τ in 2015, −0.012 in 2026; Top-10
   halves it, Top-16 equals the Fit for nearly everyone — Top = Fit already for 62 % of forest runners), an
   elasticity per circuit (even the least-squares one), per-race information weights, a bent score, the
   maximum-likelihood level, Huber's circuit value, the fastest 85 %, the arithmetic whole field (no national gain),
   k = 4 (no national/sprint gain); the study's engine options are kept in git history (commit 9244b54).

**Who sees what**: everyone sees `official` and `top6w3` (« Top », the method retained); `top6w` (« Top linéaire »,
the method of origin, studied for reference) and the « Fit » methods `fair3`/`fair` are analysis methods, shown only
to accounts with the `analyst` right (granted on the admin page; `store.available()`, `store.setAnalyst`; display
only — the data files are the same for every logged-in user). The Méthodes page presents the Top and gives the
linear method's measured figures to everyone, as the variant studied for reference. **The documentation (page and PDF)
never names the Fit** (owner, 2026-10-14: misleading): the circuits are measured from the scores the runners present
earned in their previous races, their « niveau habituel », a step of the calculation and not a ranking. « A race more never
lowers the CN » is only said with « once the 6 places are filled » (before, the CN Top is an ordinary mean).

Key design decisions (each was measured — see "Evaluating" below — and agreed with the owner):
- **Circuits are valued with the Fit CN, never with Top's.** A capped best-of fed its selection back through
  circuit values: groups racing mostly among themselves (veterans, juniors) inflated, H21 deflated (~13 %).
- **No fallback on a runner's first official CN** after the archive's first season (`seed_until="2011-01-01"`):
  it was stale and on FFCO's scale, and valued a third of sprint circuits. Only runners with their own CN in the
  discipline value a circuit. Seeds are per ranking family (`cn_engine.family`: pedestrian, VTT, ski).
- **"nc" (non classé) result rows** take no part in anything (`cn.is_nc`): not in circuit values, not in the
  runner's results or statistics; the race page lists them as "NC". (PM/abandon *without* "nc" score 0 and count.)
- **Recalage**: no annual step. Each month a factor brings the mean of the best 20 % of CNs to **5600** (FFCO's
  2026 rule), per terrain, from the level 2 months earlier (13-month smoothing; for `fair3`/`top6w3` the Top's CNs,
  carried forward by the ten-year drift — see method 4). The factor of a race is that of
  its **day**: straight line between monthly knots, each monthly factor reached on the 1st of the following month
  (`cn_engine.daily_knots` / `factor_on`). A race's published score = raw score × factor of its day, **fixed once,
  never revised**; the CN is the aggregate of those published scores (no factor at CN level), so a CN only moves
  when a race enters or leaves the window. Never explain method artefacts in the UI — fix the method instead.
- The CN J-15 shown for computed methods is the runner's **published** CN 15 days before the race (the engine's
  own `cn_j15` column is on its internal scale).
- The engine takes a circuit's rules (sample, mean) from its discipline's params (`pt(terrain)` in `run_method`,
  2026-10-13); `cn.js` mirrors `circuit_value` as `circuitValue` for the live page's estimates (`meta.methods.*.params`
  carries `sample_fraction`, `cv_power`, `cn_power`, per terrain).
- Rejected after testing: Top with 10 places (6 works once circuits use Fit), best 70/80 % pools for forest
  and sprint (re-measured 2026-10-06: −0.4 to −1 point), 5 races minimum (fewer circuit valuers, worse),
  2 races minimum (2026-10-07: +11 % ranked in forest, +38 % in sprint, and those runners' Fit CN still beats
  their official one, but −0.1 to −0.4 point on the pairs already ranked; the owner kept 3), feedback on the
  recalage (oscillates), distance-pooled sprint circuit values (pace not comparable across circuits).

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
and are not read — the owner is telling Helga's developer), Orientation Data (heyries), and the organiser's site
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
FFCO's f-race and the agenda's x-race of the same day and organiser are merged (`races.merge_duplicates`, name words
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
that name no event are dropped. liveresultat's splits are kept when a class's « splitcontrols » cover the course (4 or more: MeOS feeds every
control, code 1000 + number, repeats 101031…; a radio control or two are not kept). A race's documents are
shown in the order `run.doc_priority` gives (`prio`, both sites follow it): uploads and the organiser's files, then
WinSplits / Orientation Data, Helga, liveresultat last (live results are not corrected afterwards); a document with
under half the runners of the fullest one drops. A split list without start times takes them, by name, from another
document of the race (`run.share_starts`, for « Groupes »). **Start lists** (2026-10-10): for the races of the next 7 days, the liveresultat
competition assigned to each is read every 6 h (`run.start_lists`, `LiveResultat.read(startlist=True)`: status
"start"); a coming race is not listed on « Résultats » (index `soon`, `startlist`, `agenda_id`): its start list is reached from « Agenda », and its page
shows start time, current CN Top / official and the expected place; « Agenda » shows a « Liste de départ publiée » box and a « départs » tag (today's races too). FFCO's public registration
list gives only the number of registrants per circuit (`agenda.circuit_counts`, races of the next 21 days, `reg.circuits`):
the names are members-only and not read. O'Cap's export skips the coming races. Organisers' sites too (`run.site_start_lists`,
`ClubSite.find(mode="start")`: files named départ / horaires / liste de départ / inscrits, posted in the 3 weeks before;
races of today to +7 days, 8 sites a run, each every 6 h): read by `parsers/startlist.py` (IOF XML StartList, HTML tables,
OE12 and MeOS PDFs by column positions and section lines; never by the results parsers: a start time is not a race
time) into kind "startlist", else linked (kind "startfile"); a weekend's files go by the days they print and their
first lines (`races.owners`, « SPRINT1 » split). The result pass leaves start lists alone; they rank after results. PDFs: MeOS's coded split list (`1 (54): 2:32 (2:32) …
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
2026-10-09): « Déposer » (`#/deposer`, `pages/deposit.js`, from « Résultats ») — 1. the file (IOF XML best, OE/MeOS
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
is published (owner's choice); the admin page's « Dépôts » tab lists them and removes one (meta status "removed"). pages « Résultats » (`#/resultats`, « Récemment » until 2026-10-12, in the
menu « Courses » after « Agenda »; `#/recemment` and `#/provisoires` still work) listing the last 60 days' races (`run.SHOW_DAYS`; 30 until 2026-10-08), and
« Temps intermédiaires » (`#/temps-inter`), linked from it — WinSplits' time loss (the leg against the runner's
usual pace, signed); a mistake = lost ≥ 20 % of the leg **and** ≥ 10 s (both adjustable); « Perdu » and « Sans temps
perdu » count the mistakes only; the Tableau keeps two lines a runner, the gap on hover (owner, 2026-10-10: as
WinSplits); Écarts against the superman (best legs) of everyone or of the runners compared; O'Cap's `analysis.js`
follows the same rules. By hand: `python -m ffco_scraper.prov --db <db>
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
seasons, 13 of 15 sprint. Top − Top linéaire: forest +0.45, R² +2.6 pt; sprint equal (0.00). The cubic Top of 2026-10-13
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
- The login page (`pages/overview.js`, public) shows on wide screens a reel of 17 slides (« Analyse GPS » and « Jeux »
  added 2026-10-14, drawn on a made-up orienteering map: `reel.terrain`, `course`) (`reel.js`: drawn views of the
  analyses with **made-up figures and blurred invented names** — the page and the repo are public, never real results
  or names there; texts `reel.*` in `i18n.js`; story-like bars, ‹ ›, pause, ←/→; paused on hover, when hidden, and not
  automatic under reduced motion); phones keep the short text (`.home-text`).
- **Coupe de France des clubs** (2026-10-10): `site_extras.cfc` -> `cfc.json`, FFCO's « Classement National des Clubs »
  rule of 2026 (annexe 2: each runner's 5 best official CN race scores of the year in foot + 5 best in VTT or ski, women
  x 1.4) applied to every season (not awarded 2023-2025); unofficial: every ranked runner counts (licence type unknown),
  a runner's club is that of their last race of the year. Shown on « Comparer des clubs » (seasons of the selected
  clubs, one season's ranking). FFCO's own cup pages are gone (404); nothing to scrape.
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
- **VMA** (`#/vma`, `pages/vma.js`, menu « Entrainement » after Jeux; 2026-10-14; every account since 2026-10-15): three tabs —
  Calculateur (demi-Cooper 6 min / Cooper 12 min: laps of a 400 m track in a chosen lane — lane 1 400 m measured 0.30 m from
  the kerb, lane n + 2π(1.22(n−1) − 0.10) m —, a 200 m indoor track or any loop, plus the last lap's metres, or a measured
  distance; VMA = mean speed ÷ the share of VMA held — 100 % over 6 min, over 12 min 95 % « bien entraîné » or 90 %
  « modérément entraîné », the level asked explicitly (owner, 2026-10-14: d/200 is the mean speed, not the VMA; no mean
  speed shown) —, VO2max = 3.5 × VMA (Cooper's (d − 504.9)/44.73 underestimates trained runners); training speeds and times
  per 200/400/1000 m by % VMA; entries kept in `localStorage ocn.vma`), Méthodes (lab, VAMEVAL, Léger-Boucher, demi-Cooper,
  Cooper, Luc Léger shuttle, 45-15), Applications (free, checked 2026-10-14: EZ BIPsVMA web app for VAMEVAL, EPS Test VMA
  for Léger-Boucher on Android and iOS; 20 m shuttle apps apart). Text inline in the module, as on Documentation.
- Tables: a `.table-wrap` (and `dataTable`'s `.table-scroll`) scrolls within the page's height with its header row frozen
  (owner, 2026-10-12: every long table); put new tables in one. The race results tables — Courses classées, Résultats, En direct —
  share one format (owner, 2026-10-12): Place, Coureur, Cat., Club, Temps, then per method the CN and the score with its
  coloured gap to that CN beside it (`ui.scoreCell`, `subHead`; the score column sorts by the gap).
- Navigation (owner, 2026-10-12; « Entrainement » and « Organisation » added 2026-10-14/15): the bar shows the groups as tabs — « Classement national » (Coureur, Classement, Courses
  classées = `#/courses`, Comparer, Clubs, Statistiques = `#/reseau`) and « Courses » (Agenda, formerly « Bientôt »;
  Résultats, formerly « Récemment »; En direct); a group's tab leads back to the page last seen in it
  (`localStorage ocn.nav.<group>`). The row under it shows the current group's pages. The runner search sits at the right
  end of the page's tab row (`app.placeSearch`, `.tabs-row`) on Coureur, Classement and Comparer only (`SEARCH_IN_TABS`). One's name opens a menu: Ma page, Documentation = `#/methodes`, Réglages, Nous écrire,
  Administration, Déconnexion. On a phone the menu button lists both groups under headings (`app.renderHeader`).
- **One method at a time** (owner, 2026-10-12): `store.method` (default `official`; `store.methods` = `[method]` for the
  pages that read a list), chosen with the switch at the right of the header's second row (`ui.methodSwitch`: « Calcul du
  CN » then Officiel | Top, each with a one-line tooltip `m.<method>.tip` — owner, 2026-10-13: the buttons alone did not say
  what they chose —, a list of every available method for analysts; `?m=` in a link sets it); no page has a method choice of its own
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
  yellow of open land), Forêt (`forest`, a greenish half-light), Sous-bois (`undergrowth`, dark green), Nuit (`dark`) —, each
  its own token set in `app.css` (`:root[data-theme=…]`; Forêt and Sous-bois share Nuit's series and landscape), chosen under
  the moon button (`app.js` `THEMES`, `themeMenu`: a swatch of each theme's ground and one colour of its own; `localStorage
  cnx.theme`); by default light on a computer, dark on a phone (`index.html`: a coarse pointer and ≤ 900 px).
- **Look** (owner, 2026-10-12): orienteering colours used mildly (`app.css` tokens `--flag`, `--forest`, `--water`,
  `--contour`): « Classement national » in the map's forest green, « Courses » in its water blue (`body[data-group]` →
  `--grp`: the group's dot and tab in the bar, the current page in the row under it, the active tab's underline), the main button
  (`.btn-primary`) in control-flag orange, contour lines behind the header's second row (`app.drawContours`, 2026-10-13: a
  relief of a few hills drawn on a canvas by marching squares in the map's brown, an index contour every fifth line, as on
  the study's page; redrawn with the bar and on resize). Logo: the original hourglass — a diamond whose top-right triangle is orange
  and bottom-left one in the text colour — without the blue square (app.js, favicon.svg; e-mails: ink name, orange button).
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
  a PDF's first page through pdf.js from jsdelivr, or a KMZ with its image), the trace (`trace/track.js`: GPX with
  Garmin's extensions, TCX, **FIT** — definition/data messages, compressed timestamp headers, developer fields skipped;
  channels altitude, heart rate, cadence, temperature, power), and optionally the map's georeferencing (`trace/georef.js`:
  KMZ/KML GroundOverlay with LatLonBox + rotation or gx:LatLonQuad; a world file + .prj, Lambert conformal conic and
  transverse Mercator inverted on GRS80, the system guessed from the numbers without .prj — Lambert 93, UTM) and an IOF
  XML 3.0 CourseData (Purple Pen, OCAD, Condes: the courses, the controls' codes and order, MapPosition in mm matched
  to the circles found by `geom.registerPoints`, Position lat/lng when the map is georeferenced). OCAD/OMAP files
  themselves are not read (vector maps: no renderer here; export the image with a world file or a KMZ).
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
  is finished and approved (« Voir la course ») before it, and the rings are drawn only while calibrating; the clock runs on a timer, not on
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
  overlap), the value at the cursor, and a shared race-time axis; altitude green, power orange, temperature gold;
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
- **Vocabulary** (owner, 2026-10-14, as the World Ranking separates them): a race's points are the « score Top » / « score
  officiel » (`ui.scoreLabel`, i18n `score.*`), a runner's ranking value the « CN Top » / « CN officiel » (`ui.cnLabel`,
  `cn.*`); the Top's circuits are valued on the runners' « niveau habituel », which regular users never meet as a method —
  for analysts it is the « CN Fit » (it shares the Top's scores; the linear pair has its own « score linéaire »); the
  documentation never says « Fit ». The results
  tables' headers, the runner page's tiles and cards (`rn.current`, `rn.best`, `rn.calc`, `rn.cnHistory` take `{cn}`), the
  switch's tooltips and the documentation use these words.
- **Documentation** (`#/methodes`, `pages/methods.js`; owner, 2026-10-14): four tabs — « CN officiel » and « CN Top », each
  method's rules and formulas, facts only; « L'étude », the white paper in ten chapters (objectives, the point of departure,
  the measure, the base choices, the score and its mean, the circuit's value, the recalage, the results, the alternatives
  discarded, the conclusion) with the figures that support each decision, drawn as SVG from `site/assets/study.json` (the
  study of 2026-10-13's aggregate numbers, built by the scratch `study_json.py` from the evaluations under
  `C:\kerkia\cn-data\study`; public, nothing personal) and from the live `evaluation.json`; « Les calculs du site » (clubs,
  coureurs, réseau, résultats et temps intermédiaires, relais, limites). Chapters are a second row of tabs (`?voir=`); the old
  tab names (`essentiel`, `detail`, `analyses`, `autres`) still open the right tab. The page's texts are in the module (French), written for orienteers who are not mathematicians (owner, 2026-10-14): plain sentences, both sides of every comparison, each term explained with numbers, one worked circuit of six runners (`RACE6`, F got lost) used on every tab, the dated exploratory tables folded away (`more`).
  The PDF white paper (`site/assets/ocn-methode-top.pdf`, public, linked from the study) is LaTeX: `docs/whitepaper/`
  (`methode-top.tex`, `figures.py` → `fig/*.pdf` and `tables.tex` from `study.json` and the study's evaluations,
  `build.py` runs it all with MiKTeX — per-user install, `winget install MiKTeX.MiKTeX --scope user`, packages fetched on the
  fly). Rebuild and commit the PDF when the study's numbers or texts change; the deploy serves it as any asset.
- **Every page for every account** (owner, 2026-10-15): « Entrainement » (Jeux, VMA, the analyses), « En direct », the
  analyses under « Courses » and « Organisation » were for the administrators (or the `users.live` right) until then;
  the gates are gone from `app.js` (the right stays in D1, unused). The admin page alone stays the administrators'.
- **Organisation** (menu group `orga`, the control flag's orange; owner, 2026-10-15): the organisers' pages —
  « Compétitions » (`#/orga-competitions`, route `orgRace`: the competitions of the last 60 days organised by one's
  club, one multi analysis each, « Ouvrir l'analyse multi » then its circuits), « Entraînements » (`#/orga-entrainements`,
  `orgTraining`: one's training events, « Nouvel entraînement »), « Résultats » (`#/orga-resultats`, `pages/orgresults.js`:
  the club's races with what « Résultats » shows of them, « Déposer les résultats » = `#/deposer?course=…&orga=1`), and
  « Direct », « Tracer » greyed (no page yet: an item without address, `.nav-off`). **An organiser** is a member of the
  race's organising club — the club of the account's latest race in the site's data against the race's `org` number
  (`functions/_lib/club.js`: `clubOf`, `orgCode`, `raceOf`) — or an administrator; any account may create a training
  event. A competition's analysis is created by its organisers only, once (a second ask returns the first, `existing`),
  and every member of the organising club manages it (`meta.orgClub`, `isOrganiser`). An organiser's results deposit
  (`X-Upload` `organiser: true`, checked the same way, 403 « not organiser » otherwise) is noted « déposé par
  l'organisateur », and its race is no longer looked for on the club's site or the platforms (`prov_meta` `org_races`,
  kept by `sources/upload.apply`, skipped in `run.run`'s loop): the organiser's file is used as it is.
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
- UI text lives in `i18n.js` (French). Method keys: `official`, `top6w3`, `top6w`, `fair3`, `fair` (labels « Top » /
  « Fit », the linear ones « Top linéaire » / « Fit linéaire »). Old saved selections or links naming the removed
  `v2026`, `top6w2` or `fair2` are mapped in `store.js` (`RENAMED`).
- Runner race rows (`R`) and race result rows (`C`) carry each method's columns, the retained pair (`f3*`, `t3*`)
  appended after the linear ones (`data.js`: `SCORE_COL`, `CNAFTER_COL`, `CNJ15_COL`, `COUNTS_COL`, `WEIGHT_COL`,
  `C_SCORE`, `C_CNJ15`).
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
  « En direct » (`#/direct`, `pages/live.js`; menu « Courses »: Agenda, Résultats, En direct) for every account since
  2026-10-15 (the `users.live` right before: migration 0007, admin page checkbox): liveresultat's races from O'Cap's live server
  (`LIVE` = https://ocap.pages.dev: its `/api/live/list`, open to other sites, and `/ws/<race>`), so live traffic
  never goes through O'CN's gate; each runner recognised by name (+ club number) and linked, their CN Top and
  official in the race's discipline (guessed from the names: sprint, VTT, ski, else forest) and the place their Top
  CN predicts (« Attendu »). `localStorage["ocn.liveBase"]` points it at a local O'Cap for tests.
  Usage: the app posts each page view of a logged-in account to `/api/track` (route, Réseau views apart; a new
  browser session = a visit) into D1 `usage_daily` (account, Paris day, page, views; 13 months, deleted with the
  account); the admin page's « Utilisation » tab reads `/api/admin/usage` for any period. The privacy page says so. The
  « Inscrits » tab (2026-10-15, `/api/admin/members`: sign-up times, status, admin flag and the days seen, no names or
  e-mails) counts the registered accounts (confirmed, not disabled) and the active ones (a page view in the last 21 Paris
  days), today and day by day; visits are counted since 2026-10-07 (the window complete from 2026-10-27); a deleted
  account leaves no trace.
  Mail through Resend with daily/monthly quotas and a reserve for account mails (`wrangler.toml` vars).
- GitHub may occasionally fail runs on its own (e.g. "job was not acquired by Runner"): check
  githubstatus.com before suspecting the code; the next hourly run catches up.

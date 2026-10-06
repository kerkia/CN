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
| `notify.py` | E-mail digests (new results, new competitions in subscribed regions) through `/api/notify` |
| `site/` | Static single-page app (vanilla JS modules, no build step). `assets/js/pages/*.js` one module per page, `i18n.js` all French text, `cn.js` the CN computation mirrored in the browser, `data.js` data access and the column index maps `R` (runner race rows) and `C` (race result rows) |
| `functions/` | Cloudflare Pages Functions: `_middleware.js` (login gate, deny by default), `api/account/*` (accounts on D1), `api/admin/*`, `api/notify.js`, `api/ffco-history.js` and `api/ffco-cn.js` (proxies to FFCO pages, logged-in users only, cached and rate-limited) |
| `migrations/` | D1 schema migrations |
| `ci/state.py` | Packs/unpacks the database and site state to/from Cloudflare R2 between CI runs |
| `.github/workflows/update.yml` | Hourly quick run, 03:00 Paris full run, 06:00 Paris agenda run, deploy on push |
| `run_cn.py`, `query_cn.py`, `merge_methods.py` | Developer tools (recompute one method, inspect a runner, merge DBs) |

Not in git (see `.gitignore`): the database and HTTP cache (`C:\cn-data` on the PC, `paths.py`, env `CN_DATA_DIR`),
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
  `C:\cn-data\ffco_results.sqlite3`, never on the original.
- To stop the dev server on Windows, kill `workerd` and the `node` processes running wrangler.
- After a JS change, check the page in a browser (console errors!) before pushing; the browser may cache
  modules — hard-reload.

## The three CN methods

All methods share the race score: circuit value = mean of (CN J-15 × time) over the fastest ⌈2N/3⌉ ranked
runners holding a CN; score = circuit value ÷ time; PM / abandon / disqualified / over time score 0 and count.
12-month window, forest and sprint ranked separately.

1. **`official`** — FFCO's published values, copied verbatim (before 2026 FFCO had one pooled pedestrian
   ranking, stored under each terrain / "Ped"). The runner page's official calculation card reads FFCO's own
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

Key design decisions (each was measured — see "Evaluating" below — and agreed with the owner):
- **Circuits are valued with the Juste CN, never with Top's.** A capped best-of fed its selection back through
  circuit values: groups racing mostly among themselves (veterans, juniors) inflated, H21 deflated (~13 %).
- **No fallback on a runner's first official CN** after the archive's first season (`seed_until="2011-01-01"`):
  it was stale and on FFCO's scale, and valued a third of sprint circuits. Only runners with their own CN in the
  discipline value a circuit.
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
- Rejected after testing: Top with 10 places (6 works once circuits use Juste), best 70/80 % pools, 5 races
  minimum (fewer circuit valuers, worse), feedback on the recalage (oscillates), distance-pooled sprint circuit
  values (pace not comparable across circuits).

## Changing a method: migrations

`update.py` holds version numbers stored in table `engine_meta`. Bumping one makes the next run of any kind
(including the CI deploy run) recompute once, everywhere, then rebuild the whole site:
- `ENGINE_VERSION` — the computation changed: drops data of methods that no longer exist, recomputes `fair` from
  2010 and derives `top6w` (~5 min on CI, ~12 min on the PC).
- `TOP6W_CN_VERSION` — only the recalage/aggregation changed: re-normalises `fair`, re-derives `top6w`.
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
Run variants with `run_method` / `derive` on DB copies with `dataclasses.replace(spec.params, ...)`.

## Conventions and gotchas

- Commit messages: a short title, a body explaining why, ending with the `Co-Authored-By` line the session
  provides. Commit and push only when the owner asks or has agreed to the change; usually: implement locally,
  test, then commit, push and confirm the CI run and the live site.
- Many files use CRLF line endings: edit them preserving line endings (read/write bytes in Python scripts).
  In Git Bash, heredocs with quotes break easily: write patch scripts to a file, then run them.
- UI text lives in `i18n.js` (French). Method keys: `official`, `fair`, `top6w` (labels « Juste », « Top »).
  Old saved selections of the removed `v2026` method are mapped to `fair` in `store.js`.
- The archived seasons (before 2024) are members-only on the FFCO site: a full re-check needs a fresh
  `FFCO_SESSIONID` in the environment; normal runs never need it.
- Accounts: e-mail + password with confirmation; registration checks name + licence against the licensee index
  (`site/auth`, never served); several accounts on one licence are allowed but flagged to the admin.
  Mail through Resend with daily/monthly quotas and a reserve for account mails (`wrangler.toml` vars).
- GitHub may occasionally fail runs on its own (e.g. "job was not acquired by Runner"): check
  githubstatus.com before suspecting the code; the next hourly run catches up.

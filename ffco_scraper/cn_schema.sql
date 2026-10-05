-- Derived CN data: per-race scores and the rolling national ranking.
--
-- Kept separate from the scraped tables so the raw scrape stays a faithful
-- copy of the site and can be re-imported without touching computed values.
--
-- Everything carries a `method` so the three rankings live side by side and
-- can be compared or graphed against each other in one query:
--
--   'official'  method 1 - the values published on the site, copied verbatim,
--               not recomputed.
--   'fair'      method 2 - weighted mean of the best 60 % of the scores, from 2010,
--               monthly recalage applied once to each race (no annual step).
--   'top6w'     method 3 - Fair's race scores, CN on the best 6 weight places.
--
-- Runner attributes are denormalised onto each score row deliberately: club,
-- category and sex change over time, so the value *at the time of the race*
-- is the meaningful one, and copying it avoids a join on every filtered query.

CREATE TABLE IF NOT EXISTS runners (
    licence      TEXT PRIMARY KEY,
    nom          TEXT,
    first_date   TEXT,
    last_date    TEXT,
    n_races      INTEGER,
    last_categorie TEXT,
    last_club    TEXT,
    sexe         TEXT
);

CREATE TABLE IF NOT EXISTS scores (
    method       TEXT NOT NULL,
    licence      TEXT NOT NULL,
    circuit_id   INTEGER NOT NULL,
    course_id    INTEGER NOT NULL,
    date_iso     TEXT NOT NULL,
    season       INTEGER NOT NULL,

    -- runner-tagged filters, as at the time of this race
    categorie    TEXT,
    sexe         TEXT,
    club         TEXT,

    -- race-tagged filters
    terrain      TEXT,
    epreuve      TEXT,
    groupe       TEXT,
    poids        REAL,           -- race-group weight used by method 3

    temps_s      INTEGER,
    status       TEXT NOT NULL,  -- ok / pm / abandon / disqualifie / hors_delai

    cn_j15       INTEGER,        -- CN entering the race, under this method
    score        INTEGER,        -- race score on the published scale
    score_raw    INTEGER,        -- before normalisation; = score when none applies
    counts_for_cn INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (method, licence, circuit_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_runner  ON scores(licence, method, date_iso);
CREATE INDEX IF NOT EXISTS idx_scores_cohort  ON scores(method, season, categorie);
CREATE INDEX IF NOT EXISTS idx_scores_terrain ON scores(method, terrain, date_iso);
CREATE INDEX IF NOT EXISTS idx_scores_club    ON scores(method, club, season);
CREATE INDEX IF NOT EXISTS idx_scores_circuit ON scores(circuit_id, method);

CREATE TABLE IF NOT EXISTS cn_history (
    method       TEXT NOT NULL,
    licence      TEXT NOT NULL,
    date_iso     TEXT NOT NULL,
    terrain      TEXT NOT NULL,
    cn           INTEGER,        -- normalised, i.e. what you would publish/graph
    cn_raw       INTEGER,        -- before normalisation (method 3)
    n_scores_window INTEGER,
    n_scores_kept   INTEGER,
    PRIMARY KEY (method, licence, terrain, date_iso)
);

CREATE INDEX IF NOT EXISTS idx_cnhist_runner ON cn_history(licence, method, date_iso);
CREATE INDEX IF NOT EXISTS idx_cnhist_date   ON cn_history(method, date_iso, terrain);

CREATE TABLE IF NOT EXISTS circuit_values (
    method       TEXT NOT NULL,
    circuit_id   INTEGER NOT NULL,
    date_iso     TEXT,
    n_finishers  INTEGER,
    n_ranked     INTEGER,
    n_sample     INTEGER,
    valeur       INTEGER,
    eligible     INTEGER,
    PRIMARY KEY (method, circuit_id)
);

-- Annual rescale factors actually applied (method 2). Stored so a CN can be
-- recomputed exactly at any date: a score earned in year Y is multiplied by
-- every factor applied on a 1 January after it. Absent year = factor 1.0.
CREATE TABLE IF NOT EXISTS rescale_factors (
    method       TEXT NOT NULL,
    year         INTEGER NOT NULL,
    factor       REAL NOT NULL,
    n_runners    INTEGER,
    PRIMARY KEY (method, year)
);

-- The smooth level anchor used by method 3, one row per day it changes.
CREATE TABLE IF NOT EXISTS normalisation (
    method       TEXT NOT NULL,
    terrain      TEXT NOT NULL,
    date_iso     TEXT NOT NULL,
    top_mean_raw REAL,           -- raw level of the reference cohort
    factor       REAL,           -- multiply raw CN by this
    PRIMARY KEY (method, terrain, date_iso)
);

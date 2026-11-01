-- « Nutrition » (Coach; owner, 2026-11-01): a blog of articles by theme and date, written by its authors, read by the
-- accounts given the right — functions/api/nutrition/[[path]].js, site/assets/js/pages/nutrition.js.
-- users.nutrition: '' (no access), 'reader' or 'author', set on the admin page; administrators are authors whatever it says.
-- Its first authors and readers (owner): Nadejda Le Helloco writes, Alec Le Helloco reads.
ALTER TABLE users ADD COLUMN nutrition TEXT NOT NULL DEFAULT '';
UPDATE users SET nutrition = 'author'
  WHERE lower(trim(first_name)) = 'nadejda' AND lower(replace(replace(last_name, ' ', ''), '-', '')) = 'lehelloco';
UPDATE users SET nutrition = 'reader'
  WHERE lower(trim(first_name)) = 'alec' AND lower(replace(replace(last_name, ' ', ''), '-', '')) = 'lehelloco';

-- the themes; names: {"fr": …, "en": …, "de": …, "es": …}, the languages not typed filled by the AI
CREATE TABLE nut_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  names      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE nut_posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id    INTEGER,                         -- NULL once the author's account is deleted (the article stays)
  author_name  TEXT NOT NULL,
  lang         TEXT NOT NULL,                   -- the language it is written in (fr, en, de, es)
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,                   -- HTML, cleaned again by the browser before it is shown
  cover        TEXT NOT NULL DEFAULT '',        -- an image of /api/nutrition/img/
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | published
  pinned       INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,                            -- ISO; a date to come = published that day
  words        INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 1,      -- +1 at each change: a translation of an older version is made again
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX nut_posts_pub ON nut_posts (status, published_at);

CREATE TABLE nut_post_cats (
  post_id INTEGER NOT NULL REFERENCES nut_posts(id) ON DELETE CASCADE,
  cat_id  INTEGER NOT NULL REFERENCES nut_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, cat_id)
);
CREATE INDEX nut_post_cats_cat ON nut_post_cats (cat_id);

-- the translations made by the AI, one per article and language, of the article's version it was made from
CREATE TABLE nut_translations (
  post_id    INTEGER NOT NULL REFERENCES nut_posts(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, lang)
);

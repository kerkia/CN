-- « Nutrition »: an alert when an article comes out, and likes (owner, 2026-11-01).
-- The alert by e-mail (off by default, the administrator's e-mail right applies as for every alert) and by push (on: it only
-- reaches the devices that turned notifications on), to the accounts that may read the articles (functions/_lib/nutrition.js).
ALTER TABLE users ADD COLUMN nut_mail INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN nut_push INTEGER NOT NULL DEFAULT 1;
-- when its readers were told: once, the first time the article is published and its day has come
ALTER TABLE nut_posts ADD COLUMN announced_at TEXT;
UPDATE nut_posts SET announced_at = updated_at WHERE status = 'published';

-- one like per account and article (no comments: owner)
CREATE TABLE nut_likes (
  post_id    INTEGER NOT NULL REFERENCES nut_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX nut_likes_user ON nut_likes (user_id);

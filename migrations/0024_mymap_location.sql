-- « Mes cartes »: where each map is (owner, 2026-11-06: a map of the library, filters and folders by country, region and
-- département, statistics). country: ISO 3166 alpha-2 (« FR »), '' unknown; region and dept: as the user or the folder import
-- gave them — in France the région's name and the département's number (« 77 »), elsewhere the names as typed. The position
-- stays in lat/lon (migration 0019): the georeference's centre, else a GPS track's first point; the library places a map
-- without one at its département's, region's or country's centre itself.
ALTER TABLE mymaps ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE mymaps ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE mymaps ADD COLUMN dept TEXT NOT NULL DEFAULT '';

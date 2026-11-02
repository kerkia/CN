-- « Mes cartes »: a comment on each run (owner, 2026-11-02, after RouteGadget: « a mistake at 4, a good choice at 7 »), written
-- in Mes cartes or when « Analyse solo » saves the run; plain text, its lines kept, 1 000 characters at most.
ALTER TABLE mymap_runs ADD COLUMN note TEXT NOT NULL DEFAULT '';

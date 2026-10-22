"""Spain's clubs as the site keys them (France's « 7707IF »: a number of four digits, then its league's letters): each club
gets a number of its own once and for all (table es_clubs), and its regional federation's letters (« 0026FADO »: COMA, of
the Andalusian federation). A club is what the lists print without the province before it (« Málaga COMA » -> coma); its
federation, that of most of its licensees in SICO's list, else the community of the province printed with it."""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from .places import PROVINCES, _key

SCHEMA = """
CREATE TABLE IF NOT EXISTS es_clubs (
  code       TEXT PRIMARY KEY,       -- '0026'
  key        TEXT UNIQUE NOT NULL,   -- 'coma'
  name       TEXT,                   -- as printed, the most common spelling (« COMA »)
  federation TEXT                    -- 'FADO'
);
"""
# the regional federations (SICO's codes) and the communities they serve
FEDERATIONS = {"FADO": "Andalucía", "FARO": "Aragón", "FBO": "Illes Balears", "FCOC": "Cataluña", "FECAMADO": "Castilla-La Mancha",
               "FEDOASTURIAS": "Asturias", "FEDOCANARIAS": "Canarias", "FEDOCANTABRIA": "Cantabria", "FEDOEUSKADI": "País Vasco",
               "FEDOCV": "Comunitat Valenciana", "FEGADO": "Galicia", "FEMADO": "Comunidad de Madrid", "FEXO": "Extremadura",
               "FOCYL": "Castilla y León", "FORM": "Región de Murcia", "LARIOJA": "La Rioja", "NAVARRA": "Navarra"}
BY_COMMUNITY = {v: k for k, v in FEDERATIONS.items()}
FOREIGN = "EX"            # a club of another country (« Portugal .COM »): its own letters


def letters(fed: str | None) -> str:
    return re.sub(r"[^A-Z]", "", (fed or "").upper())


# what lists print where a runner has no club: no club (« Independiente », « Sin club »), or a region's team in a
# championship of regional selections (« ANDALUCÍA », « CASTILLA Y LEÓN »)
NO_CLUB = {"independiente", "sin club", "sin licencia", "fedo", "fedo independiente", "individual", "libre", "ninguno", "no club",
           "catalunya", "euskadi", "euskal herria", "galiza", "comunidad valenciana", "espana", "seleccion"}


def canonical(con) -> dict:
    """Each row's club key, as the licensees' list spells its clubs where it can (« culleredo gallaecia raid » ->
    « gallaecia raid »: a town printed before the club), none where the list prints no club."""
    from .places import PROVINCES, REGION_CODES
    known = set()
    try:
        known = {re.sub(r"[^a-z0-9]+", " ", _key(c)).strip() for (c,) in con.execute("SELECT DISTINCT club FROM es_licensees WHERE club IS NOT NULL")}
    except Exception:
        pass
    regions = {re.sub(r"[^a-z0-9]+", " ", _key(x)).strip() for x in [*{c for _, c in PROVINCES.values()}, *REGION_CODES.values(),
                                                                       *(n for n, _ in PROVINCES.values())]}
    fixed = dropped = 0
    for (key,) in con.execute("SELECT DISTINCT club_key FROM results WHERE club_key IS NOT NULL").fetchall():
        new = key
        if key in NO_CLUB or key in regions:
            new = None
        elif key not in known:
            words = key.split()
            for i in range(1, len(words)):                 # a known club at the end, or at the start
                tail, head = " ".join(words[i:]), " ".join(words[:-i])
                if tail in known:
                    new = tail
                    break
                if head in known:
                    new = head
                    break
        if new != key:
            con.execute("UPDATE results SET club_key = ? WHERE club_key = ?", (new, key))
            fixed += new is not None
            dropped += new is None
    con.commit()
    return {"renamed": fixed, "no_club": dropped}


def assign(con) -> dict:
    """Every result row's club number (results.club = « 0026FADO »), new clubs numbered after the others."""
    con.executescript(SCHEMA)
    known = {r["key"]: r for r in con.execute("SELECT * FROM es_clubs")}
    # the federation of a club's licensees
    fed_of: dict[str, Counter] = defaultdict(Counter)
    spelt: dict[str, str] = {}                 # the licensees' list's own spelling of its clubs (« GALLAECIA_RAID »)
    try:
        for club, fed in con.execute("SELECT club, federation FROM es_licensees WHERE club IS NOT NULL"):
            k = re.sub(r"[^a-z0-9]+", " ", _key(club)).strip()
            fed_of[k][letters(fed)] += 1
            spelt[k] = club.replace("_", " ").strip()
    except Exception:
        pass
    seen: dict[str, Counter] = defaultdict(Counter)
    provs: dict[str, Counter] = defaultdict(Counter)
    for key, src in con.execute("SELECT club_key, club_src FROM results WHERE club_key IS NOT NULL"):
        seen[key][src] += 1
        first = _key(src).split(" ")[0] if src else ""
        for code, (name, comm) in PROVINCES.items():
            if _key(src or "").startswith(_key(name) + " "):
                provs[key][comm] += 1
                break
        else:
            if first in ("portugal", "francia", "finlandia", "suecia", "noruega", "italia", "suiza", "alemania", "reino"):
                provs[key][FOREIGN] += 1
    nxt = max((int(c) for c in [r["code"] for r in known.values()]), default=0) + 1
    for key, spellings in sorted(seen.items(), key=lambda kv: -sum(kv[1].values())):
        match = fed_of.get(re.sub(r"[^a-z0-9]+", " ", key).strip())
        fed = match.most_common(1)[0][0] if match else None
        if not fed and provs.get(key):
            comm = provs[key].most_common(1)[0][0]
            fed = FOREIGN if comm == FOREIGN else letters(BY_COMMUNITY.get(comm))
        # the name: the licensees' list's, else the most common spelling without what is printed before the club
        name = spelt.get(key)
        if not name:
            name = spellings.most_common(1)[0][0] or key
            low = _key(name)
            i = low.find(key.split(" ")[0]) if key else -1
            name = name[i:].strip(" .-") if i > 0 else name.strip(" .-")
        if key in known:
            con.execute("UPDATE es_clubs SET name = ?, federation = COALESCE(?, federation) WHERE key = ?", (name, fed, key))
        else:
            con.execute("INSERT INTO es_clubs (code, key, name, federation) VALUES (?,?,?,?)", (f"{nxt:04d}", key, name, fed))
            nxt += 1
    con.execute("""UPDATE results SET club = (SELECT c.code || COALESCE(c.federation, '') FROM es_clubs c WHERE c.key = results.club_key)
                   WHERE club_key IS NOT NULL""")
    con.commit()
    return {"clubs": con.execute("SELECT COUNT(*) FROM es_clubs").fetchone()[0]}


def names(con) -> dict:
    """The build's names (build_site `names`): clubs by number, the federations' letters as « ligues », no départements."""
    con.executescript(SCHEMA)
    clubs = {code: name for code, name in con.execute("SELECT code, name FROM es_clubs")}
    ligues = {letters(k): v for k, v in FEDERATIONS.items()}        # (a foreign club's EX: no name, the code shows)
    return {"clubs": clubs, "ligues": ligues, "depts": {}}

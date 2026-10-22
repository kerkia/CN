"""Who is who in a country whose results print no licence (Spain, 2026-10-22): each result row is given a person, a
stable number of Ozimut's (the runner's id on the site: es + that number), from what the row says — the name as printed,
the club, the SportIdent card, the sex — and, when the country publishes one, its list of licensees.

Names: compared word by word whatever their order (« Rodríguez Brome, Verónica » = « Verónica Rodríguez Brome »), accents
and case aside, the particles (de, del, la, y…) left out; a word may be cut short in a list (« Sevilla Saiz Ire » for Irene):
a word of three letters that starts another counts as it (Juan is not Juana). Two names are the same person's when every word of the
shorter has its own match in the longer and at least two words match.

A row is one licensee's when its card is that licensee's, or when exactly one licensee's name fits it (the club deciding
between several); otherwise it is a person of its own, by its full name and club. The same key always gives the same person
(table person_keys): a new run never renumbers anybody.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

PARTICLES = {"de", "del", "la", "las", "los", "el", "y", "i", "e", "da", "das", "do", "dos", "van", "von", "der", "le", "du", "di"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS persons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  licence    TEXT UNIQUE,            -- the federation's licence, when the person is one of its licensees (never published)
  name       TEXT NOT NULL,          -- as the site shows it (« Nombre Apellidos »)
  sex        TEXT,                   -- H | D
  club       TEXT,                   -- the latest seen
  first_seen TEXT,
  last_seen  TEXT
);
CREATE TABLE IF NOT EXISTS person_keys (key TEXT PRIMARY KEY, person INTEGER NOT NULL);
"""


def fold(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def words(name: str | None) -> list[str]:
    """The words that tell a name apart: « Ana de la Fuente, M. » -> ["ana", "fuente", "m"]."""
    return [w for w in fold(name).split() if w not in PARTICLES]


def _same(a: str, b: str) -> bool:
    """The same word, or one cut to three letters (the lists that shorten first names cut them there: « Ire » for Irene);
    a longer start is another name (Juan, Juana)."""
    return a == b or (len(a) == 3 and b.startswith(a)) or (len(b) == 3 and a.startswith(b))


def compatible(a: list[str], b: list[str]) -> bool:
    """Every word of the shorter name matched by its own word of the longer (equal, or one starting the other), two at least."""
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) < 2:
        return False
    left = list(long_)
    for w in short:
        hit = next((i for i, x in enumerate(left) if _same(w, x)), None)
        if hit is None:
            return False
        left.pop(hit)
    return True


def display(name: str) -> str:
    """« Rodríguez Brome, Verónica » -> « Verónica Rodríguez Brome »; a name already in that order is kept."""
    if "," in name:
        last, first = name.split(",", 1)
        name = f"{first.strip()} {last.strip()}"
    name = re.sub(r"\s+", " ", name).strip()
    return name.title() if name.isupper() or name.islower() else name


class Licensees:
    """A country's licensees, indexed by their names' words and their cards."""

    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.by_word: dict[str, list[int]] = defaultdict(list)
        self.by_card: dict[str, list[int]] = defaultdict(list)
        self.words = []
        for i, r in enumerate(rows):
            w = words(r["name"])
            self.words.append(w)
            for x in set(w):
                self.by_word[x].append(i)
            if r.get("card"):
                self.by_card[str(r["card"])].append(i)

    def find(self, name: str, club_key: str | None = None, card: str | None = None) -> dict | None:
        w = words(name)
        if card and len(self.by_card.get(str(card), [])) == 1:
            i = self.by_card[str(card)][0]
            if compatible(w, self.words[i]) or len(w) < 2:
                return self.rows[i]
        if len(w) < 2:
            return None
        # the candidates: the licensees sharing the name's rarest whole word (a cut word: those starting with it)
        full = [x for x in w if x in self.by_word] or w
        anchor = min(full, key=lambda x: len(self.by_word.get(x, [])) or 10 ** 9)
        pool = self.by_word.get(anchor) or [i for k, ids in self.by_word.items() if k.startswith(anchor) for i in ids]
        hits = [i for i in set(pool) if compatible(w, self.words[i])]
        if len(hits) > 1 and club_key:
            same = [i for i in hits if fold(self.rows[i].get("club")) == club_key]
            hits = same or hits
        return self.rows[hits[0]] if len(hits) == 1 else None


def resolve(con, licensees: Licensees | None) -> dict:
    """Give every result row without a person its person (results.licence = the person's number, as a string)."""
    con.executescript(SCHEMA)
    keys = dict(con.execute("SELECT key, person FROM person_keys").fetchall())
    rows = con.execute("""SELECT r.id, r.nom, r.club_key AS club, r.card, r.sex, r.categorie, comp.date_iso FROM results r
                          JOIN circuits c ON c.circuit_id = r.circuit_id JOIN competitions comp ON comp.course_id = c.course_id
                          WHERE r.licence IS NULL ORDER BY comp.date_iso""").fetchall()
    stats = {"rows": len(rows), "licensed": 0, "new": 0}
    for r in rows:
        sex = (r["sex"] or "").upper()[:1].replace("F", "D").replace("M", "H") or (r["categorie"] or "")[:1] or None
        lic = licensees.find(r["nom"], r["club"], r["card"]) if licensees else None
        key = f"L:{lic['licence']}" if lic else "N:" + " ".join(sorted(words(r["nom"]))) + "|" + (r["club"] or "")
        pid = keys.get(key)
        if pid is None:
            name = display(lic["name"]) if lic else display(r["nom"])
            cur = con.execute("INSERT INTO persons (licence, name, sex, club, first_seen, last_seen) VALUES (?,?,?,?,?,?)",
                              (lic["licence"] if lic else None, name, sex, r["club"], r["date_iso"], r["date_iso"]))
            pid = cur.lastrowid
            con.execute("INSERT INTO person_keys (key, person) VALUES (?, ?)", (key, pid))
            keys[key] = pid
            stats["new"] += 1
        else:
            con.execute("UPDATE persons SET last_seen = MAX(COALESCE(last_seen, ''), ?), club = COALESCE(?, club), "
                        "sex = COALESCE(sex, ?) WHERE id = ?", (r["date_iso"], r["club"], sex, pid))
        if lic:
            stats["licensed"] += 1
        con.execute("UPDATE results SET licence = ?, person_key = ? WHERE id = ?", (str(pid), key, r["id"]))
    con.commit()
    stats["persons"] = con.execute("SELECT COUNT(*) FROM persons").fetchone()[0]
    return stats

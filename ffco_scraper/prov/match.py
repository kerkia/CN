"""Who is who: an organiser's result row ("Jeanne DUPONT", "6307AR Balise 63") -> an FFCO licence.

No result file carries licence numbers, so a row is matched on the name (its words, in any order, accents and
case ignored, hyphens as spaces) among the runners seen in the last three years, then on the club number when
several share the name (any club they raced for in those years, since runners change clubs). A name that stays
ambiguous, or is unknown, is left unmatched rather than guessed.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta

from .model import plain

RECENT_YEARS = 3


def name_key(name: str) -> tuple[str, ...]:
    words = re.findall(r"[a-z]+", plain(name).replace("-", " ").replace("'", " "))
    return tuple(sorted(w for w in words if len(w) > 1 or len(words) <= 2))


class Matcher:
    def __init__(self, con, today: date):
        since = (today - timedelta(days=365 * RECENT_YEARS)).isoformat()
        self.by_name: dict[tuple, set[str]] = defaultdict(set)
        self.clubs: dict[str, set[str]] = defaultdict(set)
        self.info: dict[str, dict] = {}
        for r in con.execute("SELECT licence, nom, last_club, last_categorie, sexe FROM runners WHERE last_date >= ?", (since,)):
            self.by_name[name_key(r["nom"])].add(r["licence"])
            self.info[r["licence"]] = {"nom": r["nom"], "cat": r["last_categorie"], "sexe": r["sexe"]}
            if r["last_club"]:
                self.clubs[r["licence"]].add(r["last_club"][:4])
        # the clubs each of them raced for recently (a transfer leaves the old club in last_club for a while)
        for lic, club in con.execute("""SELECT DISTINCT r.licence, r.club FROM results r JOIN circuits c ON c.circuit_id = r.circuit_id
                                        JOIN competitions k ON k.course_id = c.course_id WHERE k.date_iso >= ? AND r.club IS NOT NULL""", (since,)):
            if lic in self.info:
                self.clubs[lic].add(str(club)[:4])

    def truncated(self, name: str) -> set[str]:
        """Split lists cut long names ("MARTINEAU Christo"): the last printed word may be the start of a word."""
        words = re.findall(r"[a-z]+", plain(name).replace("-", " ").replace("'", " "))
        if len(words) < 2 or len(words[-1]) < 3:
            return set()
        if not hasattr(self, "_by_word"):
            self._by_word = defaultdict(set)
            for key, lics in self.by_name.items():
                for w in key:
                    self._by_word[w] |= lics
        full = [w for w in words[:-1] if len(w) > 1]
        cands = set.intersection(*(self._by_word.get(w, set()) for w in full)) if full else set()
        return {l for l in cands if any(w.startswith(words[-1]) for w in name_key(self.info[l]["nom"]))}

    def match(self, row: dict) -> str | None:
        cands = self.by_name.get(name_key(row["name"]), set()) or self.truncated(row["name"])
        if not cands:
            return None
        if len(cands) == 1:
            lic = next(iter(cands))
            # the name's only bearer, unless the row's category says the other sex (a namesake not in our data)
            if row.get("category") and self.info[lic]["sexe"] and row["category"][0] != self.info[lic]["sexe"]:
                return None
            return lic
        if row.get("club_code"):
            same = [l for l in cands if row["club_code"] in self.clubs.get(l, ())]
            if len(same) == 1:
                return same[0]
        if row.get("category"):
            same = [l for l in cands if (self.info[l]["cat"] or "")[:1] == row["category"][:1]]
            if len(same) == 1:
                return same[0]
        return None

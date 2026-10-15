"""Anonymised runners (owner, 2026-10-15): a licensee who asks not to be shown any more — or a minor's legal
representative, or a request for erasure of the results data — has their name and licence number replaced, all over
the published site, by a pseudonym: « Coureur anonyme 3 », licence 90000003. Their results stay in the database and in
every computation (the others' places, circuit values and CNs are unchanged); only what is published changes, and
removing them from the list restores everything at the next rebuild.

The list is kept by the admin page (functions/api/admin/anonymized.js) in R2, privacy/anonymized.json:
    {"next": 4, "people": [{"lic": "123456", "name": "DUPONT Marie", "pseudo": "90000003", "since": "2026-10-15"}]}
and copied by the workflow to CN_DATA_DIR/privacy/anonymized.json before each run. Used by build_site.py (runners,
races, snapshots: every licence read from the database goes through `Anon.lic`), ffco_scraper/prov/run.py (organisers'
results: matched rows by licence, the others by name) and update.py (a change of the list rebuilds everything once).
Pseudonyms are 8 digits from 90000001: real licences have at most 7 (936809 in 2026), and the browser hides the
licence of a pseudonym (`data.isAnon`)."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path

import paths

FILE = paths.DATA_DIR / "privacy" / "anonymized.json"
LABEL = "Coureur anonyme"
BASE = 90_000_000
PSEUDO = re.compile(r"^9\d{7}$")
# what a results file may print that identifies a runner besides the name and the licence
DROP_FIELDS = ("birth", "bib")


def name_key(name: str | None) -> str:
    """A name compared without accents, case, punctuation or word order (« LE HELLOCO Nadejda » = « Nadejda Le Helloco »)."""
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return " ".join(sorted(re.sub(r"[^a-z0-9]+", " ", s).split()))


class Anon:
    """The anonymised runners: licence -> pseudonym, and their names' keys (for results that carry no licence)."""

    def __init__(self, people: list[dict]):
        self.people = [p for p in people if str(p.get("lic", "")).strip() and PSEUDO.match(str(p.get("pseudo", "")))]
        self.by_lic = {str(p["lic"]).strip(): str(p["pseudo"]) for p in self.people}
        self.names = {name_key(p["name"]) for p in self.people if name_key(p.get("name"))}
        self.fingerprint = hashlib.sha256(json.dumps(sorted(self.by_lic.items())).encode()).hexdigest()[:16]

    def __bool__(self) -> bool:
        return bool(self.by_lic)

    def has(self, lic) -> bool:
        return lic is not None and str(lic) in self.by_lic

    def lic(self, lic):
        """The licence as published: the pseudonym of an anonymised runner, else unchanged (same type)."""
        if lic is None:
            return lic
        p = self.by_lic.get(str(lic))
        return lic if p is None else (int(p) if isinstance(lic, int) else p)

    def named(self, name: str | None) -> bool:
        return bool(self.names) and name_key(name) in self.names


def is_pseudo(lic) -> bool:
    return lic is not None and bool(PSEUDO.match(str(lic)))


def label(pseudo=None) -> str:
    """The name shown for an anonymised runner: numbered when the pseudonym is known."""
    return f"{LABEL} {int(pseudo) - BASE}" if is_pseudo(pseudo) else LABEL


def load(path: Path | None = None) -> Anon:
    path = Path(path) if path else FILE
    try:
        people = json.loads(path.read_text(encoding="utf-8")).get("people", [])
    except (OSError, ValueError, AttributeError):
        people = []
    return Anon(people if isinstance(people, list) else [])


def anonymise_row(anon: Anon, r: dict) -> None:
    """An organiser's result row (prov model, its licence matched or not), anonymised in place when it is one of them."""
    if anon.has(r.get("lic")):
        r["lic"] = anon.lic(r["lic"])
        r["name"] = label(r["lic"])
    elif anon.named(r.get("name")):
        r["name"] = label()
    else:
        return
    for k in DROP_FIELDS:
        if k in r:
            r[k] = None

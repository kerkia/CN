"""What Ozimut knows of a country it reads (owner, 2026-10-22: France and Spain first, other countries to follow).

Each country is a module of this package (countries/fr, countries/es…) that describes itself with a `Country`: its
federation, who may see its data, where its database and its site data live, and the steps of its update. The shared
code — the CN engine, the site build, the provisional results, the pages — takes a country and never names one.

Data layout: every country's files under site/data/<code>/ (site/data/fr/, site/data/es/…), each with the same files
(meta.json, runners.json, r/, c/, snap/, competitions.json, agenda.json…); what is common to all — the index of the
countries (site/data/meta.json) and the provisional results (site/data/prov/) — at the root.

A runner's id on the site is the country's code and the country's own number: fr1234567 (an FFCO licence), es10000123.
Inside a country's files only the number is written (r/<n // 10>.json in that country's folder).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_DATA = ROOT / "site" / "data"
# who may read a country's data (functions/_lib/countries.js DATA_ACCESS — keep the two in step):
#   "members": the accounts that joined the country (France: FFCO's older seasons are members-only on its own site);
#   "all":     every signed-in account (Spain: every result is public, so what is computed from them is too; owner, 2026-10-22)
ACCESS = ("members", "all")


@dataclass(frozen=True)
class Country:
    code: str                          # ISO 3166-1 alpha-2, upper case: "FR"
    federation: str                    # its short name: "FFCO"
    access: str                        # one of ACCESS
    db: Path                           # its database: results, the computed methods, the runners
    time_zones: tuple[str, ...] = ()   # where its races are timed (liveresultat's competitions, the race clock)
    official: str | None = None        # its federation's own ranking, as the site names the method "official"
    extras: tuple[str, ...] = field(default_factory=tuple)   # site_extras parts only this country has (cfc, elite…)

    def __post_init__(self):
        if self.access not in ACCESS:
            raise ValueError(f"{self.code}: access {self.access!r}")

    @property
    def key(self) -> str:
        """Its code as written in paths and runner ids: "fr"."""
        return self.code.lower()

    def data_dir(self, root: Path = SITE_DATA) -> Path:
        """Its site data folder: site/data/fr."""
        return root / self.key

    def runner_id(self, local) -> str:
        """A runner's id on the site: fr1234567."""
        return f"{self.key}{local}"

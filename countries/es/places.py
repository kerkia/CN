"""Spain's provinces (their INE numbers, which SICO's own province ids follow) and autonomous communities — the agenda's
places, as France's départements and regions are FFCO's."""
from __future__ import annotations

import re
import unicodedata

# INE number: (name as SICO writes it, community)
PROVINCES = {
    "01": ("Álava", "País Vasco"), "02": ("Albacete", "Castilla-La Mancha"), "03": ("Alicante", "Comunitat Valenciana"),
    "04": ("Almería", "Andalucía"), "05": ("Ávila", "Castilla y León"), "06": ("Badajoz", "Extremadura"),
    "07": ("Baleares", "Illes Balears"), "08": ("Barcelona", "Cataluña"), "09": ("Burgos", "Castilla y León"),
    "10": ("Cáceres", "Extremadura"), "11": ("Cádiz", "Andalucía"), "12": ("Castellón", "Comunitat Valenciana"),
    "13": ("Ciudad Real", "Castilla-La Mancha"), "14": ("Córdoba", "Andalucía"), "15": ("La Coruña", "Galicia"),
    "16": ("Cuenca", "Castilla-La Mancha"), "17": ("Girona", "Cataluña"), "18": ("Granada", "Andalucía"),
    "19": ("Guadalajara", "Castilla-La Mancha"), "20": ("Guipúzcoa", "País Vasco"), "21": ("Huelva", "Andalucía"),
    "22": ("Huesca", "Aragón"), "23": ("Jaén", "Andalucía"), "24": ("León", "Castilla y León"), "25": ("Lérida", "Cataluña"),
    "26": ("La Rioja", "La Rioja"), "27": ("Lugo", "Galicia"), "28": ("Madrid", "Comunidad de Madrid"),
    "29": ("Málaga", "Andalucía"), "30": ("Murcia", "Región de Murcia"), "31": ("Navarra", "Navarra"),
    "32": ("Orense", "Galicia"), "33": ("Asturias", "Asturias"), "34": ("Palencia", "Castilla y León"),
    "35": ("Las Palmas", "Canarias"), "36": ("Pontevedra", "Galicia"), "37": ("Salamanca", "Castilla y León"),
    "38": ("Santa Cruz de Tenerife", "Canarias"), "39": ("Cantabria", "Cantabria"), "40": ("Segovia", "Castilla y León"),
    "41": ("Sevilla", "Andalucía"), "42": ("Soria", "Castilla y León"), "43": ("Tarragona", "Cataluña"),
    "44": ("Teruel", "Aragón"), "45": ("Toledo", "Castilla-La Mancha"), "46": ("Valencia", "Comunitat Valenciana"),
    "47": ("Valladolid", "Castilla y León"), "48": ("Vizcaya", "País Vasco"), "49": ("Zamora", "Castilla y León"),
    "50": ("Zaragoza", "Aragón"), "51": ("Ceuta", "Ceuta"), "52": ("Melilla", "Melilla"),
}
# other spellings met (co-official names, older ones)
ALIASES = {"a coruna": "15", "coruna": "15", "ourense": "32", "lleida": "25", "gerona": "17", "araba": "01", "alava": "01",
           "gipuzkoa": "20", "bizkaia": "48", "illes balears": "07", "islas baleares": "07", "castello": "12",
           "tenerife": "38", "gran canaria": "35", "alacant": "03", "valencia/valencia": "46", "navarra/nafarroa": "31"}
# O-Replay's organiser region codes (ISO 3166-2:ES communities) -> community
REGION_CODES = {"AN": "Andalucía", "AR": "Aragón", "AS": "Asturias", "IB": "Illes Balears", "CN": "Canarias", "CB": "Cantabria",
                "CM": "Castilla-La Mancha", "CL": "Castilla y León", "CT": "Cataluña", "VC": "Comunitat Valenciana",
                "EX": "Extremadura", "GA": "Galicia", "MD": "Comunidad de Madrid", "MC": "Región de Murcia", "NC": "Navarra",
                "PV": "País Vasco", "RI": "La Rioja", "CE": "Ceuta", "ML": "Melilla"}


def _key(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).strip()


_BY_NAME = {_key(n): code for code, (n, _) in PROVINCES.items()} | ALIASES


def province(name: str | None) -> str | None:
    """A province's INE number from its name, or None."""
    return _BY_NAME.get(_key(name or "")) if name else None


def community(code: str | None) -> str | None:
    return PROVINCES[code][1] if code in PROVINCES else None


def regions() -> list[dict]:
    """The agenda's regions: [{name, depts: [province numbers]}], as France's."""
    out: dict[str, list[str]] = {}
    for code, (_, comm) in sorted(PROVINCES.items()):
        out.setdefault(comm, []).append(code)
    return [{"name": n, "depts": d} for n, d in sorted(out.items(), key=lambda x: _key(x[0]))]


def depts() -> dict[str, str]:
    return {code: n for code, (n, _) in PROVINCES.items()}

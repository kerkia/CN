"""The places of the countries whose agenda Ozimut reads, for `countries/places.py`: which region (and finer unit — a
Bezirk, a county, a province…) a place named by a calendar lies in (owner, 2026-10-24: « showing the region/state/province/
land/etc. would be useful, for all countries where this makes sense »). The calendars give a town, a forest or a park;
nothing is asked of a geocoding service at run time: this tool turns GeoNames' country files (CC BY 4.0,
https://www.geonames.org) into one small table a country, countries/places/<cc>.json.gz, committed with the code.

    python tools/gazetteer.py fetch            # download GeoNames' files into $CN_DATA_DIR/geonames (once)
    python tools/gazetteer.py build [cc …]     # rebuild countries/places/<cc>.json.gz (all of UNITS by default)

The table: { v, regions: [name…], depts: [[code, name, region index]…], keys: { folded name: [[region, dept, weight]…] } }.
A name met in several regions keeps its candidates (a few, the weightiest first): `places.locate` decides with the other
words of the place. Each country's levels and names are set in UNITS below, in the country's own language.
"""
from __future__ import annotations

import gzip
import io
import json
import math
import re
import sys
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "countries" / "places"
DUMP = "https://download.geonames.org/export/dump/"


def src_dir() -> Path:
    import paths
    return Path(paths.DATA_DIR) / "geonames"


def fold(s: str) -> str:
    from countries.places import fold as f
    return f(s)


# feature classes and codes kept as names a calendar may give: populated places, administrative units, forests, parks and
# areas, mountains and hills, lakes
KEEP_T = {"MT", "MTS", "HLL", "HLLS", "PK", "PKS", "PLAT", "RDGE", "UPLD", "SPUR", "MSTS", "VAL", "VALS", "ISL", "ISLS", "PEN", "CAPE", "DUNE", "DUNS"}
KEEP_H = {"LK", "LKS", "RSV", "BAY", "LGN"}
KEEP_S = {"CSTL", "MNMT", "RUIN", "FT", "ZOO", "SCH", "UNIV", "STDM", "SPA", "HSE", "MSTY", "CH", "TOWR", "PAL", "RSRT"}


def weight(fclass: str, fcode: str, pop: int, small_adm2: bool = False) -> float:
    if fclass == "A" and fcode.startswith("ADM"):
        # a region, a district; a municipality (a village's often) weighs as a town of its size
        if fcode == "ADM1":
            return 1e8
        return 1e6 + pop if fcode == "ADM2" and not small_adm2 else 3000 + pop
    if fclass == "P":
        if fcode in ("PPLC", "PPLA", "PPLG"):
            return 1e7 + pop
        if fcode == "PPLA2":
            return 1e4 + pop
        return 1000 + pop if pop > 0 else 300
    return 100


def kept(fclass: str, fcode: str) -> bool:
    return (fclass in ("P", "V", "L") or (fclass == "A" and fcode.startswith("ADM")) or (fclass == "T" and fcode in KEEP_T)
            or (fclass == "H" and fcode in KEEP_H) or (fclass == "S" and fcode in KEEP_S))


CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
# words an administrative unit's name carries around its own (« Politischer Bezirk Zwettl », « Okres Znojmo »): the key
# without them is indexed too
ADMIN_WORDS = re.compile(
    r"^(?:politischer bezirk|bezirk|landkreis|kreis|stadtkreis|regionalverband|okres|powiat|gmina|miasto|provincia di|"
    r"provincia del|provincia della|provincia autonoma di|province de|province du|province d|provincie|province of|county|"
    r"comuna|oras|orasul|municipiul|obshtina|oblast|grad|opcina|opstina|opstina grad|rayon|raion|kanton|canton de|canton du|"
    r"cantone|region|regione|wahlkreis|district of|city of|municipality of|judetul|okrug|gradska opstina|ilce)\s+"
    r"|\s+(?:county|district|district municipality|local municipality|metropolitan municipality|municipality|oblast|voblasc|"
    r"rayon|raion|kommune|maakond|vald|linn|kraj|voivodeship|ilcesi|province|prefecture|ken|shi|gun|gu|si|do|"
    r"stadt|region|okrug|district council|council|island district|apskritis|savivaldybe|rajono savivaldybe|"
    r"miesto savivaldybe|zupanija|county council)$")


def keys_of(names) -> set[str]:
    out = set()
    for n in names:
        if not n:
            continue
        k = fold(n)
        if not k or k.isdigit():
            continue
        if CJK.search(k) or len(k) >= 3:
            out.add(k)
            for _ in range(2):
                k2 = ADMIN_WORDS.sub("", k).strip()
                if k2 and k2 != k and (CJK.search(k2) or len(k2) >= 3):
                    out.add(k2)
                k = k2
    return out


class Src:
    """A country's GeoNames files: its features, and the local names of its administrative units."""

    def __init__(self, cc: str, langs: tuple[str, ...]):
        self.cc, self.langs, self.script = cc, langs, SCRIPT.get(cc, "latin")
        d = src_dir()
        self.rows, self.adm = [], {}
        with zipfile.ZipFile(d / f"{cc}.zip") as z:
            for line in io.TextIOWrapper(z.open(f"{cc}.txt"), encoding="utf-8"):
                f = line.rstrip("\n").split("\t")
                gid, fcl, fco = int(f[0]), f[6], f[7]
                a1, a2, a3 = f[10], f[11], f[12]
                if fcl == "A" and fco in ("ADM1", "ADM2", "ADM3"):
                    key = (a1,) if fco == "ADM1" else (a1, a2) if fco == "ADM2" else (a1, a2, a3)
                    self.adm[key] = gid
                if kept(fcl, fco):
                    self.rows.append((gid, f[1], f[2], f[3], fcl, fco, a1, a2, a3, int(f[14] or 0), float(f[4]), float(f[5])))
        self.geo_name = {r[0]: r[1] for r in self.rows}
        want = set(self.adm.values())
        self.alt = defaultdict(list)        # geonameid -> [(lang, name, preferred, short)]
        with zipfile.ZipFile(d / f"alt_{cc}.zip") as z:
            for line in io.TextIOWrapper(z.open(f"{cc}.txt"), encoding="utf-8"):
                f = line.rstrip("\n").split("\t")
                gid = int(f[1])
                if gid in want and f[2] in langs and not (len(f) > 7 and f[7] == "1"):
                    self.alt[gid].append((f[2], f[3], f[4] == "1", f[5] == "1"))

    def local(self, key: tuple, short: bool = True) -> str | None:
        gid = self.adm.get(key)
        if gid is None:
            return None
        alts = [a for a in self.alt.get(gid) or [] if script_of(a[1]) == self.script] or self.alt.get(gid) or []
        for lang in self.langs:
            mine = [a for a in alts if a[0] == lang]
            for want in ((True, True), (True, False), (False, True), (False, False)) if short else \
                    ((True, False), (True, True), (False, False), (False, True)):
                got = [a[1] for a in mine if (a[2], a[3]) == want]
                if got:
                    return got[0]
        return self.geo_name.get(gid)


# ---- each country's levels: unit(src, a1, a2, a3) -> (region name | None, dept code | None, dept name | None) ----

def clean(name: str | None, *patterns: str) -> str | None:
    if not name:
        return name
    for p in patterns:
        name = re.sub(p, "", name).strip()
    return name


def simple(langs, region_pat=(), dep_level=2, dep_pat=(), short=True, dep_short=True):
    """Region = the first-level unit, dept = the second (or third) level's, both by their local names."""
    def unit(s: Src, a1, a2, a3):
        r = clean(s.local((a1,), short), *region_pat)
        if not r:
            return None, None, None
        dkey = (a1, a2) if dep_level == 2 else (a1, a2, a3) if dep_level == 3 else None
        d = clean(s.local(dkey, dep_short), *dep_pat) if dkey and (a2 or a3) else None
        return r, d, d
    return langs, unit


def region_only(langs, region_pat=(), short=True):
    return simple(langs, region_pat, dep_level=0, short=short)


# Austria: the Länder and the Bezirke; a statutory city's Bezirk « Graz (Stadt) », the Land's of the same name « (Land) »
AT_CITY = {"101", "102", "201", "202", "301", "302", "303", "304", "401", "402", "403", "501", "601", "701"}


def at_unit(s, a1, a2, a3):
    r = clean(s.local((a1,)), r"^Bundesland ", r"^Land ")
    if not r or not a2:
        return r, None, None
    def base(n):
        return clean(n, r"^Stadt ", r" Stadt$", r" Land$", r"^Politischer Bezirk ", r"^Bezirk ", r" an der Donau$",
                     r" am Wörthersee$").replace("Kitzbuehel", "Kitzbühel").replace("Sankt Pölten", "St. Pölten")
    name = base(s.local((a1, a2)) or "")
    if a2 in AT_CITY:
        name = f"{name} (Stadt)" if a2 != "900" else name
    elif any(base(s.local((a1, c)) or "") == name for c in AT_CITY if c[0] == a2[0]):
        name = f"{name} (Land)"
    return r, name, name


# Switzerland: Swiss Orienteering's regional associations (the calendar's « region ») over the cantons (dept: the canton's
# two letters), so that a race the CSV places keeps its association and the canton refines it
CH_ASSOC = {"ZH": "Zürich/Schaffhausen", "SH": "Zürich/Schaffhausen", "BE": "Bern/Solothurn", "SO": "Bern/Solothurn",
            "AG": "Aargau", "BS": "Nordwestschweiz", "BL": "Nordwestschweiz", "SG": "Nordostschweiz", "TG": "Nordostschweiz",
            "AR": "Nordostschweiz", "AI": "Nordostschweiz", "GL": "Glarus/Graubünden", "GR": "Glarus/Graubünden",
            "LU": "Zentralschweiz", "ZG": "Zentralschweiz", "SZ": "Zentralschweiz", "UR": "Zentralschweiz",
            "OW": "Zentralschweiz", "NW": "Zentralschweiz", "TI": "Ticino", "GE": "Suisse romande", "VD": "Suisse romande",
            "VS": "Suisse romande", "NE": "Suisse romande", "JU": "Suisse romande", "FR": "Suisse romande"}
CH_CANTON = {"ZH": "Zürich", "SH": "Schaffhausen", "BE": "Bern", "SO": "Solothurn", "AG": "Aargau", "BS": "Basel-Stadt",
             "BL": "Basel-Landschaft", "SG": "St. Gallen", "TG": "Thurgau", "AR": "Appenzell Ausserrhoden",
             "AI": "Appenzell Innerrhoden", "GL": "Glarus", "GR": "Graubünden", "LU": "Luzern", "ZG": "Zug", "SZ": "Schwyz",
             "UR": "Uri", "OW": "Obwalden", "NW": "Nidwalden", "TI": "Ticino", "GE": "Genève", "VD": "Vaud", "VS": "Valais",
             "NE": "Neuchâtel", "JU": "Jura", "FR": "Fribourg"}


def ch_unit(s, a1, a2, a3):
    return (CH_ASSOC[a1], a1, CH_CANTON[a1]) if a1 in CH_ASSOC else (None, None, None)


# Belgium: the three regions and the ten provinces, each in its own language (Brussels has no province)
BE_REGION = {"BRU": "Bruxelles / Brussel", "WAL": "Wallonie", "VLG": "Vlaanderen"}
BE_PROV = {"VAN": "Antwerpen", "VBR": "Vlaams-Brabant", "VLI": "Limburg", "VOV": "Oost-Vlaanderen", "VWV": "West-Vlaanderen",
           "WBR": "Brabant wallon", "WHT": "Hainaut", "WLG": "Liège", "WLX": "Luxembourg", "WNA": "Namur"}


def be_unit(s, a1, a2, a3):
    if a1 not in BE_REGION:
        return None, None, None
    return BE_REGION[a1], (BE_PROV.get(a2) if a2 else None), (BE_PROV.get(a2) if a2 else None)


# Great Britain: the region is the calendar's own (British Orienteering's associations); the dept, the county or unitary
# authority (GeoNames' second level)
GB_NATION = {"ENG": "England", "SCT": "Scotland", "WLS": "Wales", "NIR": "Northern Ireland"}


def gb_unit(s, a1, a2, a3):
    d = clean(s.local((a1, a2)) if a2 else None, r"^(?:City and County of|City of|County of|Royal Borough of|London Borough of"
                                                 r"|County Borough of|Borough of) ", r" (?:County Borough|District|Council)$")
    return GB_NATION.get(a1), d, d


# Ireland: the four provinces and the counties (the calendar gives the county)
def ie_unit(s, a1, a2, a3):
    r = s.local((a1,))
    d = clean(s.local((a1, a2)) if a2 else None, r"^County ")
    return r, d, d


# Italy: the region and the province, the province by its two letters (« (TN) » in FISO's places)
def it_unit(s, a1, a2, a3):
    r = clean(s.local((a1,)), r"^Regione (?:Autonoma )?", r"^Provincia autonoma di ")
    if not r:
        return None, None, None
    if a2:
        return r, a2, clean(s.local((a1, a2)), r"(?i)^(?:Libero consorzio comunale|Città metropolitana|Provincia(?: autonoma)?|"
                                                   r"Provincia del|Provincia della) (?:di |del |della |dell')?")
    return r, None, None


# Japan: the eight regions (地方) over the prefectures
JP_REGION = {
    "北海道": "北海道", "青森県": "東北", "岩手県": "東北", "宮城県": "東北", "秋田県": "東北", "山形県": "東北", "福島県": "東北",
    "茨城県": "関東", "栃木県": "関東", "群馬県": "関東", "埼玉県": "関東", "千葉県": "関東", "東京都": "関東", "神奈川県": "関東",
    "新潟県": "中部", "富山県": "中部", "石川県": "中部", "福井県": "中部", "山梨県": "中部", "長野県": "中部", "岐阜県": "中部",
    "静岡県": "中部", "愛知県": "中部", "三重県": "近畿", "滋賀県": "近畿", "京都府": "近畿", "大阪府": "近畿", "兵庫県": "近畿",
    "奈良県": "近畿", "和歌山県": "近畿", "鳥取県": "中国", "島根県": "中国", "岡山県": "中国", "広島県": "中国", "山口県": "中国",
    "徳島県": "四国", "香川県": "四国", "愛媛県": "四国", "高知県": "四国", "福岡県": "九州・沖縄", "佐賀県": "九州・沖縄",
    "長崎県": "九州・沖縄", "熊本県": "九州・沖縄", "大分県": "九州・沖縄", "宮崎県": "九州・沖縄", "鹿児島県": "九州・沖縄",
    "沖縄県": "九州・沖縄"}
JP_ORDER = ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"]


def jp_pref(s, a1):
    names = [a[1] for a in s.alt.get(s.adm.get((a1,)), []) if a[0] == "ja"]
    return next((n for n in names if n in JP_REGION), None) or \
        next((n + suf for n in names for suf in ("県", "府", "都") if n + suf in JP_REGION), None)


def jp_unit(s, a1, a2, a3):
    p = jp_pref(s, a1)
    return (JP_REGION[p], p, p) if p else (None, None, None)


# Hong Kong: the three areas over the eighteen districts (GeoNames' codes start with the area's letter)
HK_AREA = {"H": "香港島", "K": "九龍", "N": "新界"}


# Romania: the eight development regions over the counties (județe), each county by its usual two letters
RO_JUDET = {"Alba": "AB", "Arad": "AR", "Argeș": "AG", "Bacău": "BC", "Bihor": "BH", "Bistrița-Năsăud": "BN", "Botoșani": "BT",
            "Brașov": "BV", "Brăila": "BR", "București": "B", "Buzău": "BZ", "Caraș-Severin": "CS", "Călărași": "CL",
            "Cluj": "CJ", "Constanța": "CT", "Covasna": "CV", "Dâmbovița": "DB", "Dolj": "DJ", "Galați": "GL", "Giurgiu": "GR",
            "Gorj": "GJ", "Harghita": "HR", "Hunedoara": "HD", "Ialomița": "IL", "Iași": "IS", "Ilfov": "IF", "Maramureș": "MM",
            "Mehedinți": "MH", "Mureș": "MS", "Neamț": "NT", "Olt": "OT", "Prahova": "PH", "Satu Mare": "SM", "Sălaj": "SJ",
            "Sibiu": "SB", "Suceava": "SV", "Teleorman": "TR", "Timiș": "TM", "Tulcea": "TL", "Vaslui": "VS", "Vâlcea": "VL",
            "Vrancea": "VN"}
RO_REGION = {"Nord-Vest": "BH BN CJ MM SM SJ", "Centru": "AB BV CV HR MS SB", "Nord-Est": "BC BT IS NT SV VS",
             "Sud-Est": "BR BZ CT GL TL VN", "Sud-Muntenia": "AG CL DB GR IL PH TR", "București-Ilfov": "B IF",
             "Sud-Vest Oltenia": "DJ GJ MH OT VL", "Vest": "AR CS HD TM"}
RO_OF = {j: r for r, js in RO_REGION.items() for j in js.split()}
RO_FOLD = {fold(k).replace("-", " "): (k, v) for k, v in RO_JUDET.items()}


def ro_unit(s, a1, a2, a3):
    n = fold(clean(s.geo_name.get(s.adm.get((a1,)), "") or "", r"^Județul ", r"^Municipiul ")).replace("-", " ")
    n = {"bucuresti": "bucuresti", "municipiul bucuresti": "bucuresti"}.get(n, n)
    got = RO_FOLD.get(n)
    if not got:
        return None, None, None
    name, code = got
    return RO_OF[code], code, name


# Serbia: the statistical regions over the districts (okruzi), in Latin script as the calendar writes
RS_OKRUG = {"Belgrade": ("Beograd", "Grad Beograd"),
            "North Bačka": ("Vojvodina", "Severnobački"), "Central Banat": ("Vojvodina", "Srednjebanatski"),
            "North Banat": ("Vojvodina", "Severnobanatski"), "South Banat": ("Vojvodina", "Južnobanatski"),
            "West Bačka": ("Vojvodina", "Zapadnobački"), "South Bačka": ("Vojvodina", "Južnobački"),
            "Srem": ("Vojvodina", "Sremski"),
            "Zlatibor": ("Šumadija i Zapadna Srbija", "Zlatiborski"), "Kolubara": ("Šumadija i Zapadna Srbija", "Kolubarski"),
            "Mačva": ("Šumadija i Zapadna Srbija", "Mačvanski"), "Moravica": ("Šumadija i Zapadna Srbija", "Moravički"),
            "Pomoravlje": ("Šumadija i Zapadna Srbija", "Pomoravski"), "Rasina": ("Šumadija i Zapadna Srbija", "Rasinski"),
            "Raška": ("Šumadija i Zapadna Srbija", "Raški"), "Šumadija": ("Šumadija i Zapadna Srbija", "Šumadijski"),
            "Bor": ("Južna i Istočna Srbija", "Borski"), "Braničevo": ("Južna i Istočna Srbija", "Braničevski"),
            "Zaječar": ("Južna i Istočna Srbija", "Zaječarski"), "Jablanica": ("Južna i Istočna Srbija", "Jablanički"),
            "Nišava": ("Južna i Istočna Srbija", "Nišavski"), "Pirot": ("Južna i Istočna Srbija", "Pirotski"),
            "Podunavlje": ("Južna i Istočna Srbija", "Podunavski"), "Pčinja": ("Južna i Istočna Srbija", "Pčinjski"),
            "Toplica": ("Južna i Istočna Srbija", "Toplički")}
RS_FOLD = {fold(k): v for k, v in RS_OKRUG.items()}


def rs_unit(s, a1, a2, a3):
    if a2 in ("", None):
        return None, None, None
    n = fold(clean(s.geo_name.get(s.adm.get((a1, a2)), "") or "", r" (?:District|Okrug)$", r"^City of "))
    if a2 == "0" or n in ("beograd", "belgrade", "grad beograd"):
        n = "belgrade"
    got = RS_FOLD.get(n) or RS_FOLD.get(n.replace("branicevo", "branicevo"))
    if not got:
        return None, None, None
    return got[0], got[1], got[1]


# Türkiye: the seven geographical regions over the provinces (il)
TR_REGION = {
    "Marmara": "Edirne Kırklareli Tekirdağ İstanbul Kocaeli Yalova Sakarya Bilecik Bursa Balıkesir Çanakkale",
    "Ege": "İzmir Manisa Aydın Denizli Muğla Afyonkarahisar Kütahya Uşak",
    "Akdeniz": "Antalya Isparta Burdur Mersin Adana Hatay Osmaniye Kahramanmaraş",
    "İç Anadolu": "Ankara Konya Kayseri Eskişehir Sivas Kırıkkale Aksaray Karaman Kırşehir Niğde Nevşehir Yozgat Çankırı",
    "Karadeniz": "Rize Trabzon Artvin Sinop Tokat Çorum Amasya Samsun Zonguldak Bolu Düzce Bartın Kastamonu Karabük Giresun "
                 "Gümüşhane Ordu Bayburt",
    "Doğu Anadolu": "Erzurum Erzincan Malatya Elazığ Tunceli Bingöl Muş Bitlis Van Hakkari Ağrı Kars Iğdır Ardahan",
    "Güneydoğu Anadolu": "Gaziantep Kilis Adıyaman Şanlıurfa Diyarbakır Mardin Batman Siirt Şırnak"}
TR_OF = {fold(p): (r, p) for r, ps in TR_REGION.items() for p in ps.split()}


def tr_unit(s, a1, a2, a3):
    names = [s.geo_name.get(s.adm.get((a1,)), "")] + [a[1] for a in s.alt.get(s.adm.get((a1,)), []) if a[0] == "tr"]
    for n in names:
        k = fold(clean(n, r" (?:Province|İli|ili)$") or "")
        k = {"icel": "mersin", "afyon": "afyonkarahisar", "hakkâri": "hakkari"}.get(k, k)
        if k in TR_OF:
            r, p = TR_OF[k]
            return r, p, p
    return None, None, None


HK_DISTRICT = {"HCW": "中西區", "HEA": "東區", "HSO": "南區", "HWC": "灣仔區", "KKC": "九龍城區", "KKT": "觀塘區",
               "KSS": "深水埗區", "KWT": "黃大仙區", "KYT": "油尖旺區", "NIS": "離島區", "NKT": "葵青區", "NNO": "北區",
               "NSK": "西貢區", "NST": "沙田區", "NTM": "屯門區", "NTP": "大埔區", "NTW": "荃灣區", "NYL": "元朗區"}


def hk_unit(s, a1, a2, a3):
    area, d = HK_AREA.get(a1[:1]), HK_DISTRICT.get(a1)
    return (area, d, d) if area and d else (None, None, None)


# Israel: the six districts, in Hebrew (the subdistricts' names are not in Hebrew in GeoNames: no finer level)
IL_DISTRICT = {"01": "מחוז הדרום", "02": "מחוז המרכז", "03": "מחוז הצפון", "04": "מחוז חיפה", "05": "מחוז תל אביב",
               "06": "מחוז ירושלים", "WE": "יהודה ושומרון"}


def il_unit(s, a1, a2, a3):
    return IL_DISTRICT.get(a1), None, None


UNITS = {
    "AT": (("de",), at_unit),
    "BE": (("fr", "nl"), be_unit),
    "BG": simple(("bg",), region_pat=(r"^Област ", r"^област "), dep_pat=(r"^Община ", r"^община ")),
    "BY": simple(("ru",), dep_pat=()),
    "CH": (("de",), ch_unit),
    "CZ": simple(("cs",), dep_pat=(r"^[Oo]kres ",)),
    "DE": simple(("de",), dep_level=3, region_pat=(r"^Land ", r"^Freie und Hansestadt ", r"^Freie Hansestadt "),
                 dep_pat=(r"^Kreisfreie Stadt ", r"^Stadtkreis ", r"^Regionalverband ", r", (?:Stadt|Freie und Hansestadt)$")),
    "DK": simple(("da",), dep_pat=(r" Kommune$",)),
    "EE": simple(("et",)),
    "GB": (("en",), gb_unit),
    "GE": region_only(("en",)),
    "HK": (("zh",), hk_unit),
    "HR": simple(("hr",), dep_pat=(r"^Grad ", r"^Općina ", r"^Opcina ")),
    "IE": (("en",), ie_unit),
    "IL": (("he",), il_unit),
    "IT": (("it",), it_unit),
    "JP": (("ja",), jp_unit),
    "KR": simple(("ko",)),
    "LT": region_only(("lt",)),
    "MK": region_only(("en",)),
    "PL": simple(("pl",), region_pat=(r"^[Ww]ojewództwo ",), dep_pat=()),
    "RO": (("ro",), ro_unit),
    "RS": (("sr",), rs_unit),
    "SI": region_only(("sl",), region_pat=(r"^Občina ", r"^Mestna občina ", r"^Municipality of ")),
    "SK": simple(("sk",), dep_pat=(r"^[Oo]kres ",)),
    "TR": (("tr",), tr_unit),
    "ZA": simple(("en",), dep_pat=(r" District Municipality$", r" Metropolitan Municipality$", r" District$")),
}
# the script the country's calendar writes its places in: names in another script are not indexed (the table stays small)
SCRIPT = {"BG": "cyrillic", "BY": "cyrillic", "HK": "cjk", "IL": "hebrew", "JP": "cjk", "KR": "hangul"}


# a dept's administrative word dropped when no other dept of its region bears the name without it (« Landkreis Lörrach » ->
# « Lörrach », but « Landkreis Leipzig » beside the city of Leipzig)
STRIP_UNIQUE = {"DE": r"^(?:Landkreis|Kreis) "}


def script_of(n: str) -> str:
    if re.search(r"[Ѐ-ӿ]", n):
        return "cyrillic"
    if re.search(r"[가-힯]", n):
        return "hangul"
    if re.search(r"[぀-ヿ㐀-鿿]", n):
        return "cjk"
    if re.search(r"[֐-׿]", n):
        return "hebrew"
    if re.search(r"[^\W\d_]", n) and not re.search(r"[Ͱ-Ͽ԰-֏؀-ۿऀ-࿿Ⴀ-ჿ]", n):
        return "latin"
    return "other"


def _cap(n):
    return n[:1].upper() + n[1:] if n else n


def _cz_kraj(n):
    if n in ("Praha", "Vysočina", "Kraj Vysočina", "Hlavní město Praha"):
        return {"Vysočina": "Kraj Vysočina", "Hlavní město Praha": "Praha"}.get(n, n)
    return n if n.endswith(" kraj") else f"{n} kraj"


def _by(n):
    n = {"Gomelskaya Oblast": "Гомельская область"}.get(n, n)
    n = re.sub(r"\b(Область|Район)\b", lambda m: m.group(1).lower(), n)
    return re.sub(r" райо$", " район", n)


# the countries whose calendar gives coordinates: their table also holds every populated place's position and unit
# (`places.nearest`; Switzerland's CSV gives the Swiss grid's x and y of most events, o-l.ch, 2026-10-24)
POINTS = {"CH"}


# per country: (region, dept) names written over GeoNames' (casing, a spelling, a Latin transcription)
RENAME = {
    "BY": (_by, _by),
    "IT": (lambda n: n.replace("’", "'"), lambda n: re.sub(r"^(?:dell['’]|di |del )", "", re.sub(r"^dell['’]Aquila$", "L'Aquila", n))),
    "LT": (lambda n: n.replace(" Apskritis", " apskritis"), None),
    "CZ": (_cz_kraj, lambda n: re.sub(r"^Praha \d+$", "Praha", n.replace("ŭ", "ů"))),
    "PL": (_cap, lambda n: re.sub(r"^[Pp]owiat (.*)$", lambda m: "powiat " + m.group(1).lower(), n)),
    "SK": (lambda n: n if n.endswith(" kraj") else f"{n} kraj", None),
    "IE": (None, lambda n: "Dublin" if n in ("South Dublin", "Fingal", "Dún Laoghaire-Rathdown", "Dublin City") else
           re.sub(r" City$", "", n)),
}


def build(cc: str) -> dict:
    langs, unit = UNITS[cc]
    s = Src(cc, langs)
    regions, depts, rix, dix = [], [], {}, {}
    cache = {}
    script = SCRIPT.get(cc, "latin")
    small_adm2 = sum(1 for k in s.adm if len(k) == 2) > 400     # (Romania's communes, Croatia's municipalities…)
    ren_r, ren_d = RENAME.get(cc, (None, None))
    ren_r, ren_d = ren_r or (lambda n: n), ren_d or (lambda n: n)

    def place(a1, a2, a3):
        k = (a1, a2, a3)
        if k not in cache:
            r, dc, dn = unit(s, a1, a2, a3)
            r = ren_r(r) if r else r
            if dn:
                dc, dn = (ren_d(dn), ren_d(dn)) if dc == dn else (dc, ren_d(dn))
            ri = di = -1
            if r:
                if r not in rix:
                    rix[r] = len(regions)
                    regions.append(r)
                ri = rix[r]
                if dc:
                    dk = (dc, ri)
                    if dk not in dix:
                        dix[dk] = len(depts)
                        depts.append([dc, dn or dc, ri])
                    di = dix[dk]
            elif dc:                                # (GB: a county, the region from the calendar)
                dk = (dc, -1)
                if dk not in dix:
                    dix[dk] = len(depts)
                    depts.append([dc, dn or dc, -1])
                di = dix[dk]
            cache[k] = (ri, di)
        return cache[k]

    cands = defaultdict(dict)                     # key -> {(ri, di): weight}
    points = []                                   # (POINTS) [lat × 1e4, lon × 1e4, dept] of the populated places
    for gid, name, ascii_, alts, fcl, fco, a1, a2, a3, pop, lat, lon in s.rows:
        if not a1 or a1 == "00":
            continue
        if fco == "ADM1":
            a2 = a3 = ""
        elif fco == "ADM2":
            a3 = ""
        ri, di = place(a1, a2, a3)
        if ri < 0 and di < 0:
            continue
        if cc in POINTS and di >= 0 and (fcl == "P" or fco == "ADM3"):
            points.append([round(lat * 1e4), round(lon * 1e4), di])
        w = weight(fcl, fco, pop, small_adm2)
        names = [name, ascii_] + [a for a in alts.split(",") if a and (len(a) >= 4 or CJK.search(a))]
        if fcl == "A":
            k_ = (a1,) if fco == "ADM1" else (a1, a2) if fco == "ADM2" else (a1, a2, a3)
            names += [x[1] for x in s.alt.get(s.adm.get(k_), [])]
        names = [n for n in names if script_of(n) == script]
        for k in keys_of(names):
            c = cands[k]
            if c.get((ri, di), 0) < w:
                c[(ri, di)] = w
    if cc in STRIP_UNIQUE:
        names = {(d[1], d[2]) for d in depts}
        for d in depts:
            short = re.sub(STRIP_UNIQUE[cc], "", d[1])
            if short != d[1] and (short, d[2]) not in names:
                d[0] = d[1] = short
    # the units' own names
    for i, r in enumerate(regions):
        for k in keys_of([r]):
            cands[k][(i, -1)] = max(cands[k].get((i, -1), 0), 1e8)
    for i, (code, name, ri) in enumerate(depts):
        for k in keys_of([name] + ([code] if len(code) > 2 and not code.isupper() else [])):
            cands[k][(ri, i)] = max(cands[k].get((ri, i), 0), 1e8)

    keys = {}
    for k, c in cands.items():
        # a unit's own region-level entry and its finer entries: keep the finer ones (they carry the region too)
        top = sorted(c.items(), key=lambda kv: -kv[1])
        best = top[0][1]
        top = [(rd, w) for rd, w in top if w >= best / 50][:8]
        keys[k] = [[rd[0], rd[1], round(math.log10(w), 1)] for rd, w in top]
    out = {"v": 1, "source": "GeoNames (CC BY 4.0), https://www.geonames.org", "regions": regions, "depts": depts,
           "keys": keys}
    if points:
        out["points"] = sorted({tuple(p) for p in points})
    return out


def fetch(ccs):
    d = src_dir()
    d.mkdir(parents=True, exist_ok=True)
    for cc in ccs:
        for url, name in ((f"{DUMP}{cc}.zip", f"{cc}.zip"), (f"{DUMP}alternatenames/{cc}.zip", f"alt_{cc}.zip")):
            if not (d / name).exists():
                print("fetch", url)
                urllib.request.urlretrieve(url, d / name)


def main(argv):
    cmd, ccs = (argv[0] if argv else "build"), [c.upper() for c in argv[1:]] or sorted(UNITS)
    if cmd == "fetch":
        fetch(ccs)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for cc in ccs:
        t = build(cc)
        data = json.dumps(t, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        (OUT / f"{cc.lower()}.json.gz").write_bytes(gzip.compress(data, 9, mtime=0))
        print(f"{cc}: {len(t['regions'])} regions, {len(t['depts'])} depts, {len(t['keys'])} names, "
              f"{(OUT / f'{cc.lower()}.json.gz').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1:])

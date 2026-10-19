"""The white paper's figures and numbers (2026-10-16: the method published is the linear one; the text is shorter).
Sources: site/assets/study.json (the studies' aggregate figures: `fig.trunc`, `calib`, `onecn`, `mle_fit`, and `lineaire`,
the study of 2026-10-15/16) and site/data/evaluation.json (the published evaluation, rebuilt by every migration).
Writes fig/fig_trunc.pdf, fig/fig_share.pdf and numbers.tex (one \\newcommand per number quoted by methode-top.tex).
2026-10-17: `--lang en` writes the English ones instead, for methode-top.en.tex: fig/en/*.pdf and numbers.en.tex (same
macro names; decimal point, thousands comma, no space before %); French stays the default, its outputs unchanged.
Run from anywhere: py -3 docs/whitepaper/figures.py [--lang fr|en]"""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

_ap = argparse.ArgumentParser(description="The white paper's figures and numbers")
_ap.add_argument("--lang", choices=("fr", "en"), default="fr")
LANG = _ap.parse_args().lang
EN = LANG == "en"
HERE = Path(__file__).parent
ROOT = HERE.parent.parent
D = json.load(open(ROOT / "site" / "assets" / "study.json", encoding="utf-8"))
L = D["lineaire"]
EV = json.load(open(ROOT / "site" / "data" / "evaluation.json", encoding="utf-8"))
FIG = HERE / "fig" / "en" if EN else HERE / "fig"
FIG.mkdir(exist_ok=True)
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9, "legend.fontsize": 8,
                     "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150})
GREEN, BROWN, GREY, ORANGE, BLUE, INK = "#2f8a3e", "#ad6129", "#777777", "#e8641c", "#1c80bb", "#222222"
T = {"For": "Forest", "Spr": "Sprint", "VTT": "MTB"} if EN else {"For": "Forêt", "Spr": "Sprint", "VTT": "VTT"}
PC = "%" if EN else " %"                              # English: no space before the per cent sign
TXT = {   # the figures' words
    "fr": {"mean": "moyenne", "courses": "part des circuits",
           "trunc_x": "valeur sur tout le peloton, au-dessus de celle des deux tiers les plus rapides",
           "since": "depuis juillet 2025", "duels": "écart, points de duels",
           "share_x": "part du peloton qui mesure le circuit (%) ; en pointillé, la part retenue"},
    "en": {"mean": "mean", "courses": "share of courses",
           "trunc_x": "value over the whole field, above that over the fastest two thirds",
           "since": "since July 2025", "duels": "difference (points)",
           "share_x": "share of the field that values the course (%); dotted line: the share chosen"},
}[LANG]


def fr(x, dec=1):
    """A number for the text: '4{,}8' in French, '4.8' in English."""
    if EN:
        return f"{x:.{dec}f}"
    return f"{x:.{dec}f}".replace(".", "{,}").replace("-", "-")


def sg(x, dec=2):
    s = f"{x:+.{dec}f}" if EN else f"{x:+.{dec}f}".replace(".", "{,}")
    return s.replace("-", "$-$").replace("+", "$+$")


def neg(a):
    """-a for a [point, low, high] triple: the interval's ends swap."""
    return [-a[0], -a[2], -a[1]]


def ci(a, dec=2):
    """'+0,42 [+0,39 ; +0,45]' for LaTeX; a = [point, low, high] in points."""
    if not a:
        return "---"
    if EN:                                            # '+0.42 [+0.39, +0.45]'
        return f"{sg(a[0], dec)} [{sg(a[1], dec)}, {sg(a[2], dec)}]"
    return f"{sg(a[0], dec)} [{sg(a[1], dec)}~; {sg(a[2], dec)}]"


# ---- figure 1: the whole field over the fastest two-thirds -------------------------------------------------------
fig, axes = plt.subplots(1, 2, figsize=(6.4, 2.4))
for ax, t in zip(axes, ("For", "Spr")):
    d = D["fig"]["trunc"][t]
    edges, share = d["edges"], [c / d["n"] for c in d["count"]]
    ax.bar(edges[:-1], share, width=[edges[i + 1] - edges[i] for i in range(len(share))], align="edge", color=BROWN, linewidth=0, alpha=0.9)
    ax.axvline(d["mean"], color=INK, ls="--", lw=0.9)
    ax.axvline(1.0, color=GREY, lw=0.8)
    label = f"{TXT['mean']} {100 * (d['mean'] - 1):.1f}{PC}"
    ax.text(d["mean"] + 0.006, max(share) * 0.95, label if EN else label.replace(".", ","), fontsize=8)
    ticks = [1.0, 1.1, 1.2, 1.3, 1.4]
    ax.set_xticks(ticks, ["0" if r == 1 else f"+{round(100 * (r - 1))}{PC}" for r in ticks])
    ax.set_xlim(edges[0], edges[-1])
    ax.set_title(T[t])
    ax.yaxis.set_major_formatter(lambda v, _: f"{round(100 * v)}{PC}")
axes[0].set_ylabel(TXT["courses"])
fig.supxlabel(TXT["trunc_x"], fontsize=9)
fig.tight_layout()
fig.savefig(FIG / "fig_trunc.pdf")
plt.close(fig)

# ---- figure 2: the share of the field valuing a circuit, per discipline --------------------------------------------
fig, axes = plt.subplots(1, 3, figsize=(6.4, 2.4), sharey=False)
for ax, t in zip(axes, ("For", "Spr", "VTT")):
    rows = L["share"][t]["rows"]
    xs = [r["pct"] for r in rows]
    for sc, col, lab, dx in (("all_holdout", GREEN, "2012–2024", -0.6), ("all_tuned", ORANGE, TXT["since"], 0.6)):
        ys = [r[sc][0] for r in rows]
        ax.plot([x + dx for x in xs], ys, "-o", color=col, ms=3, lw=1.2, label=lab)
        ax.vlines([x + dx for x in xs], [r[sc][1] for r in rows], [r[sc][2] for r in rows], color=col, lw=0.8, alpha=0.6)
    if t == "For":                                    # 90 %: measured against the whole field
        base = next(r for r in rows if r["pct"] == 100)
        for sc, col, dx in (("all_holdout", GREEN, -0.6), ("all_tuned", ORANGE, 0.6)):
            ax.plot([90 + dx], [base[sc][0] + L["forest90"]["vs100"][sc][0]], "o", color=col, ms=3)
    pk = L["picked"][t]
    ax.axvline(pk, color=INK, lw=0.8, ls=":")
    ax.axhline(0, color=GREY, lw=0.6)
    ax.set_xticks([50, 67, 75, 90, 100], ["50", "⅔", "75", "90", "100"])
    ax.set_title(T[t])
axes[0].set_ylabel(TXT["duels"])
fig.supxlabel(TXT["share_x"], fontsize=9)
axes[2].legend(loc="lower left", frameon=False, fontsize=7)
fig.tight_layout()
fig.savefig(FIG / "fig_share.pdf")
plt.close(fig)

# ---- the numbers ---------------------------------------------------------------------------------------------------
cmd = {}
hf, hs = EV["rows"]["For"]["all"]["holdout"], EV["rows"]["Spr"]["all"]["holdout"]
hfn, hsn = EV["rows"]["For"]["nat"]["holdout"], EV["rows"]["Spr"]["nat"]["holdout"]
for key, e in (("F", hf), ("S", hs)):
    cmd[f"acc{key}off"] = fr(100 * e["acc"]["official"], 2)
    cmd[f"acc{key}top"] = fr(100 * e["acc"]["top6w"], 2)
    cmd[f"acc{key}geo"] = fr(100 * e["acc"]["top6w3"], 2)
    cmd[f"rr{key}off"] = fr(100 * e["r2"]["official"], 1)
    cmd[f"rr{key}top"] = fr(100 * e["r2"]["top6w"], 1)
    cmd[f"gain{key}"] = ci([100 * x for x in e["d"]["top6w-official"]["acc"]])
    cmd[f"gainR{key}"] = ci([100 * x for x in e["d"]["top6w-official"]["r2"]], 1)
    cmd[f"geo{key}"] = ci(neg([100 * x for x in e["d"]["top6w3-top6w"]["acc"]]))    # Top − geometric
    cmd[f"comps{key}"] = f"{e['comps']:,}" if EN else f"{e['comps']:,}".replace(",", "\\,")
for key, e in (("F", hfn), ("S", hsn)):
    cmd[f"gainN{key}"] = ci([100 * x for x in e["d"]["top6w-official"]["acc"]])
    cmd[f"geoN{key}"] = ci(neg([100 * x for x in e["d"]["top6w3-top6w"]["acc"]]))


def wins(tr, pair):
    rows = EV["rows"][tr]["all"]
    ss = [k for k in rows if k.isdigit()]
    return f"{sum(rows[y]['d'][pair]['acc'][1] > 0 for y in ss)} {'of' if EN else 'sur'} {len(ss)}"


cmd["winsF"], cmd["winsS"] = wins("For", "top6w-official"), wins("Spr", "top6w-official")
fl = L["forest90"]
cmd["nineVsAll"], cmd["nineVsAllN"] = ci(fl["vs100"]["all_holdout"]), ci(fl["vs100"]["nat_holdout"])
cmd["nineBetter"], cmd["nineWorse"] = str(fl["vs100"]["better"]), str(fl["vs100"]["worse"])
sh = {t: {r["pct"]: r for r in L["share"][t]["rows"]} for t in ("For", "Spr", "VTT")}
cmd["allVsTwoF"] = ci(sh["For"][100]["all_holdout"])
cmd["allVsTwoS"] = ci(sh["Spr"][100]["all_holdout"])
cmd["vttEightyFive"], cmd["vttEightyFiveT"] = ci(sh["VTT"][85]["all_holdout"]), ci(sh["VTT"][85]["all_tuned"])
cmd["vttSeventyFive"] = ci(sh["VTT"][75]["all_holdout"])
eg = L["eligible_grid"]["For"]
cmd["eligFifty"], cmd["eligSeventy"], cmd["eligAll"] = ci(eg["50"]["all_holdout"]), ci(eg["70"]["all_holdout"]), ci(eg["100"]["all_holdout"])
cmd["oneCn"], cmd["oneCnT"] = ci(D["onecn"]["For"]["all_holdout"]["ST6_t"]), ci(D["onecn"]["For"]["all_tuned"]["ST6_t"])
cmd["mleS"], cmd["mleF"] = sg(D["mle_fit"]["Spr"][0]), sg(D["mle_fit"]["For"][0])
vg = L.get("vs_geo", {})
cmd["geoVTT"] = ci(vg.get("VTT", {}).get("all_holdout"))
cmd["truncF"] = fr(100 * (D["fig"]["trunc"]["For"]["mean"] - 1), 1)
cmd["truncS"] = fr(100 * (D["fig"]["trunc"]["Spr"]["mean"] - 1), 1)
cmd["calibYoungOff"] = fr(D["calib"]["For"]["young"]["v"]["official"][0], 1)
# the juniors' races fading (study of 2026-10-19, adopted) and the runners far from the line (2026-10-18, not adopted)
J, E = D["jeunes"], D["ecarts"]
for key, tr in (("F", "For"), ("S", "Spr"), ("V", "VTT")):
    cmd[f"jun{key}"], cmd[f"jun{key}T"] = ci(J["J"][tr]["holdout"]), ci(J["J"][tr]["tuned"])
cmd["junFBetter"] = str(J["J"]["For"]["better"])
cmd["junAdult"], cmd["junBoth"] = ci(J["adults_best"]["For"]["holdout"]), ci(J["adults_and_juniors"]["For"]["holdout"])
cmd["junWin"], cmd["junTop"] = ci(J["window24"]["For"]["holdout"]), ci(J["top_only"]["For"]["holdout"])
cmd["junBiasBefore"], cmd["junBiasAfter"] = sg(J["J"]["For"]["junior_bias"][0], 1), sg(J["J"]["For"]["junior_bias"][1], 1)
cmd["outFast"], cmd["outFastFive"] = ci(E["fast_25"]["For"]["holdout"]), ci(E["fast_5"]["For"]["holdout"])
cmd["outLoop"] = fr(E["loop_fast_25"][0], 0)
cmd["outBothF"] = ci(E["both_25"]["For"]["holdout"])
cmd["outXS"], cmd["outXV"] = ci(E["both_and_no_juniors"]["Spr"]["holdout"]), ci(E["both_and_no_juniors"]["VTT"]["holdout"])
lines = ["% generated by figures.py --lang en: the numbers the English text quotes (2026-10-16)" if EN else
         "% generated by figures.py: the numbers the text quotes (2026-10-16)"]
for k, v in cmd.items():
    name = "N" + "".join(ch for ch in k if ch.isalpha())
    lines.append(f"\\newcommand{{\\{name}}}{{{v}}}")
(HERE / ("numbers.en.tex" if EN else "numbers.tex")).write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"figures and {len(cmd)} numbers written ({LANG})")

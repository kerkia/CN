"""The white paper's figures and tables, from the study's numbers (site/assets/study.json, aggregate figures only):
fig/*.pdf for LaTeX and tables.tex. Run from anywhere: py -3 docs/whitepaper/figures.py"""
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
D = json.load(open(ROOT / "site" / "assets" / "study.json", encoding="utf-8"))
FIG = HERE / "fig"
FIG.mkdir(exist_ok=True)
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9, "legend.fontsize": 8,
                     "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150})
GREEN, BROWN, GREY, ORANGE, BLUE, INK = "#2f8a3e", "#ad6129", "#777777", "#e8641c", "#1c80bb", "#222222"
T = {"For": "Forêt", "Spr": "Sprint"}


def fr(x, dec=1):
    return f"{x:.{dec}f}".replace(".", ",").replace("-", "−")


# ---- figure 1: a race's score around the runner's level ----------------------------------------------------------
fig, axes = plt.subplots(1, 2, figsize=(6.4, 2.5))
for ax, t in zip(axes, ("For", "Spr")):
    d = D["fig"]["dev"][t]
    edges, dens = d["edges"], d["density"]
    cut = math.log(0.8)
    for i, v in enumerate(dens):
        ax.bar(edges[i], v, width=edges[i + 1] - edges[i], align="edge", color=ORANGE if edges[i + 1] <= cut + 1e-9 else "#bbbbbb", linewidth=0)
    ax.plot(d["curve"]["x"], d["curve"]["y"], color=INK, lw=1, ls="--")
    ax.set_xlim(-1.0, 0.4)
    ticks = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4]
    ax.set_xticks([math.log(r) for r in ticks], [("1 ×" if r == 1 else fr(r, 1)) for r in ticks])
    ax.set_title(T[t])
    ax.text(cut - 0.05, max(dens) * 0.92, f"{fr(100 * d['below_08'])} % des courses", ha="right", fontsize=8, color=INK)
axes[0].set_ylabel("densité")
fig.supxlabel("score de la course ÷ niveau habituel du coureur (échelle logarithmique)", fontsize=9)
fig.tight_layout()
fig.savefig(FIG / "fig_dev.pdf")
plt.close(fig)

# ---- figure 2: the whole field over the fastest two-thirds -------------------------------------------------------
fig, axes = plt.subplots(1, 2, figsize=(6.4, 2.4))
for ax, t in zip(axes, ("For", "Spr")):
    d = D["fig"]["trunc"][t]
    edges, share = d["edges"], [c / d["n"] for c in d["count"]]
    ax.bar(edges[:-1], share, width=[edges[i + 1] - edges[i] for i in range(len(share))], align="edge", color=BROWN, linewidth=0, alpha=0.9)
    ax.axvline(d["mean"], color=INK, ls="--", lw=0.9)
    ax.axvline(1.0, color=GREY, lw=0.8)
    ax.text(d["mean"] + 0.006, max(share) * 0.95, f"moyenne {fr(100 * (d['mean'] - 1))} %", fontsize=8)
    ticks = [1.0, 1.1, 1.2, 1.3, 1.4]
    ax.set_xticks(ticks, ["0" if r == 1 else f"+{round(100 * (r - 1))} %" for r in ticks])
    ax.set_xlim(edges[0], edges[-1])
    ax.set_title(T[t])
    ax.yaxis.set_major_formatter(lambda v, _: f"{round(100 * v)} %")
axes[0].set_ylabel("part des circuits")
fig.supxlabel("valeur sur tout le peloton, au-dessus de celle des deux tiers les plus rapides", fontsize=9)
fig.tight_layout()
fig.savefig(FIG / "fig_trunc.pdf")
plt.close(fig)

# ---- figure 3: the gain in tau by k, per family --------------------------------------------------------------------
COL = {"gall": GREEN, "g23": INK, "aall": GREY, "race": ORANGE, "pow": BLUE}
DASH = {"g23": (0, (4, 2))}
fig, axes = plt.subplots(1, 2, figsize=(6.4, 2.8))
for ax, t in zip(axes, ("For", "Spr")):
    for fam in D["kcurves"][t]:
        pts = [(p["k"], p["all_holdout"]["tau"]) for p in fam["points"] if p["all_holdout"]["tau"]]
        if not pts:
            continue
        pts.sort()
        off = {"gall": -0.04, "g23": -0.02, "aall": 0, "race": 0.02, "pow": 0.04}[fam["key"]]
        xs = [k + off for k, _ in pts]
        ax.plot(xs, [a[0] for _, a in pts], color=COL[fam["key"]], lw=1.4, ls=DASH.get(fam["key"], "-"), label=fam["label"], marker="o", ms=3)
        ax.vlines(xs, [a[1] for _, a in pts], [a[2] for _, a in pts], color=COL[fam["key"]], lw=0.8, alpha=0.8)
        if fam["rec"]:
            kk, a = next((k, a) for k, a in pts if k == fam["rec"])
            ax.plot([kk + off], [a[0]], marker="o", ms=9, mfc="none", mec=INK, mew=1)
    ax.axhline(0, color=GREY, lw=0.8)
    ax.set_xticks([1, 1.5, 2, 3, 4])
    ax.set_title(T[t])
    ax.set_xlabel("k")
axes[0].set_ylabel("gain de τ sur le Top quadratique")
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=2, frameon=False, bbox_to_anchor=(0.5, -0.04), fontsize=7.5)
fig.tight_layout(rect=(0, 0.16, 1, 1))
fig.savefig(FIG / "fig_k.pdf", bbox_inches="tight")
plt.close(fig)

# ---- figure 4: the candidate's gain by season -----------------------------------------------------------------------
fig, axes = plt.subplots(1, 2, figsize=(6.4, 2.4))
for ax, t in zip(axes, ("For", "Spr")):
    s = D["seasons"][t]
    years = sorted(s)
    vals = [s[y]["tau"] for y in years]
    cols = [GREEN if a[1] > 0 else "#c62828" if a[2] < 0 else "#bbbbbb" for a in vals]
    x = range(len(years))
    ax.bar(x, [a[0] for a in vals], color=cols, width=0.65)
    ax.vlines(x, [a[1] for a in vals], [a[2] for a in vals], color=INK, lw=0.7)
    ax.axhline(0, color=GREY, lw=0.8)
    ax.set_xticks(list(x), [y[2:] for y in years], fontsize=7)
    ax.set_title(T[t])
axes[0].set_ylabel("gain de τ sur le Top quadratique")
fig.tight_layout()
fig.savefig(FIG / "fig_seasons.pdf")
plt.close(fig)

# ---- figure 5: the self-valued Top, season by season -----------------------------------------------------------
fig, ax = plt.subplots(figsize=(6.4, 2.3))
s = D["onecn_seasons"]["For"]
years = sorted(s)
for m, lab, col in (("ST6_t", "6 places", "#c62828"), ("ST10_t", "10 places", ORANGE), ("ST16_t", "16 places", GREY)):
    ax.plot(range(len(years)), [s[y][m][0] for y in years], marker="o", ms=3, lw=1.2, color=col, label=f"le Top à {lab} valorise lui-même les circuits")
ax.axhline(0, color=GREY, lw=0.8)
ax.set_xticks(range(len(years)), [y[2:] for y in years], fontsize=7)
ax.set_ylabel("écart de τ à la méthode retenue")
ax.set_title("Forêt")
ax.legend(frameon=False, loc="lower left")
fig.tight_layout()
fig.savefig(FIG / "fig_onecn.pdf")
plt.close(fig)


# ---- tables -------------------------------------------------------------------------------------------------------
def sg(v, dec=4, pt=False):
    if v is None:
        return "—"
    x = v * (100 if pt else 1)
    s = f"{x:+.{dec}f}".replace(".", ",").replace("-", "−").replace("+", "+")
    return s


def star(a):
    return r"\,\textbf{*}" if a and (a[1] > 0 or a[2] < 0) else ""


lines = []
# table: the variants vs the quadratic Top, forest and sprint (Top-type), holdout
ROWS = [("Références", None), ("official", "CN officiel de la FFCO"), ("L_t", "Valeur de circuit FFCO, moyenne simple (k = 1)"),
        ("k appliqué au score, sur la valeur de circuit FFCO, moyenne simple", None), ("k15_t", "k = 1,5"), ("k2_t", "k = 2"), ("k3_t", "k = 3"), ("k2p05_t", "k = 2 sur la valeur du circuit seule"),
        ("Puissance du CN seul, valeur FFCO", None), ("p3_t", "puissance 3"),
        ("Autres valeurs de circuit", None), ("g_t", "géométrique, ⅔ les plus rapides, k = 1"), ("gp2_t", "géométrique, ⅔, k = 2"), ("s100_t", "arithmétique, tout le peloton, k = 1"),
        ("s100p2_t", "arithmétique, tout le peloton, k = 2"), ("A3_t", "arithmétique, tout le peloton, k = 3"), ("E4_t", "arithmétique, 85 \% les plus rapides, k = 2"),
        ("V23_t", "géométrique, 85 \% les plus rapides, k = 3"), ("H1_t", "géométrique robuste (Huber), tout le peloton, k = 2"),
        ("Moyenne géométrique sur tout le peloton", None), ("G3_t", "k = 1"), ("G1_t", "k = 2"), ("G4_t", "k = 3 (retenu en forêt)"), ("G5_t", "k = 4"),
        ("Autres idées", None), ("kc_t", "élasticité estimée par circuit"), ("c30_t", "score courbé"), ("Me_t2", "niveau du maximum de vraisemblance")]
ev_full = json.load(open(Path(r"C:\kerkia\cn-data\study") / "eval_final.json", encoding="utf-8"))
for extra in ("eval_extra.json", "eval_extra2.json"):
    ex = json.load(open(Path(r"C:\kerkia\cn-data\study") / extra, encoding="utf-8"))
    for terr, r in ex["res"].items():
        for key, x in r.items():
            if key in ev_full["res"][terr] and key != "fits":
                for k_, v in x.items():
                    if isinstance(v, dict):
                        ev_full["res"][terr][key].setdefault(k_, {}).update({m: w for m, w in v.items() if m not in ev_full["res"][terr][key][k_]})


def cell(terr, scope, stat, m, pt=False):
    x = ev_full["res"][terr][scope]
    a = x.get(f"d_{stat}", {}).get(m)
    if not a:
        return "—"
    return sg(a[0], 2 if pt else 4, pt) + star(a)


lines.append(r"\begin{longtable}{@{}p{6.1cm}rrrr@{}}")
lines.append(r"\caption{Chaque variante (type Top) contre le Top quadratique, mêmes coureurs : $\tau$ de Kendall, 2012--2024, toutes courses ; $\tau$ sur les courses nationales ; $\tau$ depuis juillet 2025 ; R$^2$ (points). * : intervalle à 95 \% excluant 0.}\label{tab:variants}\\")
lines.append(r"\toprule Variante & $\tau$ & $\tau$ nat. & $\tau$ 2025-- & R$^2$ \\ \midrule \endfirsthead")
lines.append(r"\toprule Variante & $\tau$ & $\tau$ nat. & $\tau$ 2025-- & R$^2$ \\ \midrule \endhead")
for terr_code, terr in (("For", "Forêt"), ("Spr", "Sprint")):
    lines.append(rf"\multicolumn{{5}}{{@{{}}l}}{{\textsc{{{terr}}}}} \\")
    for m, lab in ROWS:
        if lab is None:
            lines.append(rf"\multicolumn{{5}}{{@{{}}l}}{{\emph{{{m}}}}} \\")
            continue
        if terr_code == "Spr" and m in ("G3_t", "G4_t", "G5_t", "E4_t", "A3_t"):
            continue
        if terr_code == "Spr" and m == "G1_t":
            lab = "k = 3, ⅔ les plus rapides (retenu en sprint)"
        if terr_code == "Spr" and m == "V23_t":
            lab = "géométrique, moitié la plus rapide, k = 3"
        lines.append(f"{lab} & {cell(terr, 'all/holdout', 'tau', m)} & {cell(terr, 'nat/holdout', 'tau', m)} & {cell(terr, 'all/tuned', 'tau', m)} & {cell(terr, 'all/holdout', 'r2', m, True)} \\\\")
lines.append(r"\bottomrule \end{longtable}")

# table: the recalage
RL = ["Aujourd'hui : moyenne des 13 mois se terminant 2 mois plus tôt", "Droite ajustée sur ces 13 mois, lue le jour où le facteur s'applique",
      "La même droite, lue 6 mois plus loin", "La moyenne de 13 mois, prolongée de 7 mois par la dérive sur 3 ans",
      "La moyenne de 13 mois, prolongée de 7 mois par la dérive sur 10 ans (retenue)"]
lines.append("\n" + r"\begin{table}[h]\centering\small")
lines.append(r"\caption{Le recalage en forêt : la moyenne des 20 \% meilleurs CN au 1\textsuperscript{er} octobre 2026 (Fit, Top), pour la méthode d'alors et pour la méthode retenue ; cible 5\,600.}\label{tab:recal}")
lines.append(r"\begin{tabular}{@{}p{7.2cm}rrrr@{}}\toprule & \multicolumn{2}{c}{Méthode d'alors} & \multicolumn{2}{c}{Méthode retenue} \\ Recalage & Fit & Top & Fit & Top \\ \midrule")
for lab, row in zip(RL, D["recal"]["rows"]):
    lines.append(f"{lab} & {row['today']['level'][0]} & {row['today']['level'][1]} & {row['cand']['level'][0]} & {row['cand']['level'][1]} \\\\")
lines.append(r"\bottomrule\end{tabular}\end{table}")

# table: the group calibration
lines.append("\n" + r"\begin{table}[h]\centering\small")
lines.append(r"\caption{Jeunes (20 ans et moins) et vétérans (55 ans et plus) face aux H/D\,21 : correction du CN qui mettrait le groupe à sa place (+ : le groupe est sous-évalué), 2012--2026, intervalle à 95 \%.}\label{tab:calib}")
lines.append(r"\begin{tabular}{@{}llrrr@{}}\toprule & & FFCO & Top quadratique & Méthode retenue \\ \midrule")
for t, name, cand in (("For", "Forêt", "G4_t"), ("Spr", "Sprint", "G1_t")):
    for g, gl in (("young", "jeunes"), ("old", "vétérans")):
        v = D["calib"][t][g]["v"]
        cells = " & ".join(f"{sg(v[m][0] / 100, 1, True)} % [{sg(v[m][1] / 100, 1, True)} ; {sg(v[m][2] / 100, 1, True)}]" for m in ("official", "Q_t", cand))
        lines.append(f"{name} & {gl} & {cells} \\\\")
lines.append(r"\bottomrule\end{tabular}\end{table}")
(HERE / "tables.tex").write_text("\n".join(lines).replace(" % [", " \\% [").replace("−", "$-$").replace("⅔", "2/3") + "\n",
                                 encoding="utf-8")
print("figures and tables written to", HERE)

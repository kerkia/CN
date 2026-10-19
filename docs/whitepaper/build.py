"""Build the white paper: the figures and tables from the study's numbers, pdflatex twice (MiKTeX, per-user
install; missing packages are fetched on the fly), the PDF moved to site/assets/ozimut-methode.pdf.
2026-10-17: the English one too (figures.py --lang en -> fig/en/ and numbers.en.tex), site/assets/ozimut-methode.en.pdf.
2026-10-19 (owner): the site and the method renamed Ozimut: sources methode-ozimut.tex / methode-ozimut.en.tex (formerly
methode-top*.tex), PDFs ozimut-methode*.pdf, each also copied to its former name, ocn-methode-top*.pdf, for old links.
Both by default; name one language to build only that one.

    py -3 docs/whitepaper/build.py [fr|en]
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
BIN = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "MiKTeX" / "miktex" / "bin" / "x64"
PDFLATEX = str(BIN / "pdflatex.exe") if (BIN / "pdflatex.exe").exists() else "pdflatex"
# language -> (LaTeX source's name without .tex, published PDF, the same PDF under its former name)
DOCS = {"fr": ("methode-ozimut", "ozimut-methode.pdf", "ocn-methode-top.pdf"),
        "en": ("methode-ozimut.en", "ozimut-methode.en.pdf", "ocn-methode-top.en.pdf")}

langs = sys.argv[1:] or list(DOCS)
for lang in langs:
    if lang not in DOCS:
        raise SystemExit(f"unknown language {lang!r} (fr, en)")
if (BIN / "initexmf.exe").exists():
    subprocess.run([str(BIN / "initexmf.exe"), "--set-config-value", "[MPM]AutoInstall=1"], check=False)
for lang in langs:
    name, published, former = DOCS[lang]
    subprocess.run([sys.executable, str(HERE / "figures.py"), "--lang", lang], check=True)
    for i in (1, 2):
        r = subprocess.run([PDFLATEX, "-interaction=nonstopmode", "-halt-on-error", f"{name}.tex"], cwd=HERE,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            tail = "\n".join(r.stdout.splitlines()[-40:])
            raise SystemExit(f"pdflatex failed ({name}.tex, pass {i}):\n{tail}")
    dst = ROOT / "site" / "assets" / published
    shutil.move(str(HERE / f"{name}.pdf"), dst)       # moved: nothing left beside the sources
    shutil.copyfile(dst, ROOT / "site" / "assets" / former)
    for ext in ("aux", "log", "out", "toc"):
        (HERE / f"{name}.{ext}").unlink(missing_ok=True)
    print(f"{dst} ({dst.stat().st_size // 1024} KB), copied to {former}")

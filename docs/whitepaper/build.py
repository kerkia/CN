"""Build the white paper: the figures and tables from the study's numbers, pdflatex twice (MiKTeX, per-user
install; missing packages are fetched on the fly), the PDF copied to site/assets/ocn-methode-top.pdf.

    py -3 docs/whitepaper/build.py
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

subprocess.run([sys.executable, str(HERE / "figures.py")], check=True)
if (BIN / "initexmf.exe").exists():
    subprocess.run([str(BIN / "initexmf.exe"), "--set-config-value", "[MPM]AutoInstall=1"], check=False)
for i in (1, 2):
    r = subprocess.run([PDFLATEX, "-interaction=nonstopmode", "-halt-on-error", "methode-top.tex"], cwd=HERE,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        tail = "\n".join(r.stdout.splitlines()[-40:])
        raise SystemExit(f"pdflatex failed (pass {i}):\n{tail}")
pdf = HERE / "methode-top.pdf"
dst = ROOT / "site" / "assets" / "ocn-methode-top.pdf"
shutil.copyfile(pdf, dst)
for ext in ("aux", "log", "out", "toc"):
    (HERE / f"methode-top.{ext}").unlink(missing_ok=True)
print(f"{dst} ({dst.stat().st_size // 1024} KB)")

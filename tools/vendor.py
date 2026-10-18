"""The third-party code and fonts O'CN serves itself, under site/assets/vendor/ (owner, 2026-10-18: no request to a public
CDN such as cdn.jsdelivr.net, which Safari reports as a tracker; they also keep working when the CDN does not).

    python tools/vendor.py check    # each package's pinned version against npm's latest
    python tools/vendor.py build    # download the pinned versions from npm and rebuild site/assets/vendor/

To update a library: change its version in PACKAGES, run `build`, then the version in site/assets/js/vendor.js (the paths the
code loads) and in site/index.html (ECharts' two <script> tags); check the pages that use it (vendor.js says which), commit.
Each package keeps its own file layout under <name>@<version>/, with its LICENSE. Files over 25 MiB (Cloudflare Pages' limit
per file) are split in two parts the browser joins (DuckDB's engine). Nothing here runs a package's install scripts.
"""
import io, json, re, shutil, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "site" / "assets" / "vendor"
SPLIT = 25 * 2**20

# npm name -> (version, folder under vendor/, files kept from the package)
PACKAGES = {
    "echarts": ("5.5.1", "echarts", ["dist/echarts.min.js", "i18n/langFR.js", "NOTICE"]),
    "pdfjs-dist": ("4.10.38", "pdfjs-dist", ["build/pdf.min.mjs", "build/pdf.worker.min.mjs"]),
    "pdf-lib": ("1.17.1", "pdf-lib", ["dist/pdf-lib.min.js"]),
    "@pdf-lib/fontkit": ("1.1.1", "pdf-lib-fontkit", ["dist/fontkit.umd.min.js"]),
    "fflate": ("0.8.2", "fflate", ["umd/index.js"]),
    "proj4": ("2.12.1", "proj4", ["dist/proj4.js"]),
    # the browser module is bundled with its dependency apache-arrow (below); the "eh" engine only: every browser since
    # 2022 has WebAssembly exceptions, and the "mvp" engine would add 39 MB
    "@duckdb/duckdb-wasm": ("1.32.0", "duckdb-wasm", ["dist/duckdb-browser-eh.worker.js", "dist/duckdb-eh.wasm"]),
    # fonts: the CSS of each face the Tracer reads and the .woff files it names (fontkit reads WOFF)
    "@fontsource/roboto": ("5.0.8", "fontsource/roboto", ["400", "700", "400-italic", "700-italic"]),
    "@fontsource/roboto-condensed": ("5.0.8", "fontsource/roboto-condensed", ["400", "700", "400-italic", "700-italic"]),
    "@fontsource/noto-sans-jp": ("5.0.19", "fontsource/noto-sans-jp", ["400", "700"]),
    "@fontsource/noto-sans-tc": ("5.0.19", "fontsource/noto-sans-tc", ["400", "700"]),
    "@fontsource/noto-sans-hk": ("5.0.19", "fontsource/noto-sans-hk", ["400", "700"]),
}
BUNDLE = {"apache-arrow": "17.0.0", "esbuild": "0.24.0"}      # to bundle DuckDB's browser module


def registry(name, what="latest"):
    with urllib.request.urlopen(f"https://registry.npmjs.org/{name.replace('/', '%2F')}/{what}", timeout=30) as r:
        return json.load(r)


def stable_latest(name):
    """The highest release without a pre-release tag (npm's « latest » can point to one: DuckDB's « -dev » builds)."""
    with urllib.request.urlopen(f"https://registry.npmjs.org/{name.replace('/', '%2F')}", timeout=30) as r:
        versions = [v for v in json.load(r)["versions"] if re.fullmatch(r"\d+\.\d+\.\d+", v)]
    return max(versions, key=lambda v: tuple(int(x) for x in v.split(".")))


def check():
    for name, (ver, *_rest) in PACKAGES.items():
        latest = stable_latest(name)
        cur, new = (tuple(int(x) for x in v.split(".")) for v in (ver, latest))
        flag = "" if new <= cur else f"   <- newer: {latest}" + ("  (major: read its changelog)" if new[0] > cur[0] else "")
        print(f"{name:32} {ver:10}{flag}")


def tarball(name, ver):
    url = registry(name, ver)["dist"]["tarball"]
    with urllib.request.urlopen(url, timeout=120) as r:
        return tarfile.open(fileobj=io.BytesIO(r.read()), mode="r:gz")


def member(tar, path):
    return tar.extractfile(tar.getmember("package/" + path)).read()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if len(data) > SPLIT:
        half = len(data) // 2
        path.with_name(path.name + ".part1").write_bytes(data[:half])
        path.with_name(path.name + ".part2").write_bytes(data[half:])
    else:
        path.write_bytes(data)


def licence(tar, dest):
    names = {m.name for m in tar.getmembers()}
    for lic in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"):
        if "package/" + lic in names:
            write(dest / "LICENSE", member(tar, lic))
            return


def bundle_duckdb(ver, dest):
    """DuckDB's browser module imports apache-arrow by its bare name: one ES module with it, as the CDNs' builds do."""
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "package.json").write_text("{}")
        pkgs = [f"@duckdb/duckdb-wasm@{ver}"] + [f"{k}@{v}" for k, v in BUNDLE.items()]
        subprocess.run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", *pkgs], cwd=d, check=True, shell=True)
        (d / "entry.mjs").write_text('export * from "@duckdb/duckdb-wasm";\n')
        subprocess.run(["npx", "esbuild", "entry.mjs", "--bundle", "--format=esm", "--platform=browser", "--minify",
                        "--legal-comments=eof", "--outfile=out.mjs"], cwd=d, check=True, shell=True)
        write(dest / "dist" / "duckdb-browser.mjs", (d / "out.mjs").read_bytes())
        write(dest / "LICENSE-apache-arrow", (d / "node_modules" / "apache-arrow" / "LICENSE.txt").read_bytes())


def build():
    if VENDOR.exists():
        shutil.rmtree(VENDOR)
    for name, (ver, folder, files) in PACKAGES.items():
        dest = VENDOR / f"{folder}@{ver}"
        tar = tarball(name, ver)
        if name.startswith("@fontsource/"):
            for face in files:
                try:
                    css = member(tar, f"{face}.css")
                except KeyError:
                    continue
                write(dest / f"{face}.css", css)
                for f in re.findall(r"url\(\./(files/[^)]+?\.woff)\)", css.decode("utf-8")):
                    write(dest / f, member(tar, f))
        else:
            for f in files:
                write(dest / f, member(tar, f))
        licence(tar, dest)
        if name == "@duckdb/duckdb-wasm":
            bundle_duckdb(ver, dest)
        print(f"{name}@{ver}")
    files = [f for f in VENDOR.rglob("*") if f.is_file()]
    print(f"{len(files)} files, {sum(f.stat().st_size for f in files) / 1e6:.1f} MB")


if __name__ == "__main__":
    {"check": check, "build": build}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: print(__doc__))()

"""Cartographier's « Plan de ville (sprint) » made on GitHub (.github/workflows/townmap.yml; owner, 2026-11-12: one engine for a
town's sprint map — the generator Pixel's races use —, quality before speed): each request the site wrote (functions/api/townmap:
R2 townmap/req/<id>.json, { id, lat, lon, w, h, by, at, status }) made by town_fetch.py (IGN's LiDAR HD, BD TOPO, BD ORTHO and
its infrared, the cadastre, OpenStreetMap) and town_map.py --clip (the ISSprOM 2019-2 objects, cut to the area asked for), the
objects written gzipped to R2 townmap/out/<id>.json.gz, the request marked done or failed, its progress written into it as it goes.

  python tools/virtually/townmap_ci.py --reqs <folder of the requests> --work <work folder>
  (env BUCKET=s3://cn-state, R2=<endpoint>: the aws CLI's address, AWS_* as lidarmap.yml; BUCKET=file://<folder> on the PC)

Requests and results older than 30 days are deleted. The work folder (the point clouds: hundreds of MB a km²) goes after each."""
import argparse, gzip, json, os, shutil, sys, time, traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ci                                                            # noqa: E402  (aws, get, put_json, run: the same R2 helpers)

PY = sys.executable
Q, OUT = "townmap/req/", "townmap/out/"
# the stages and their share of the bar
STAGES = {"queued": (0.0, 0.0), "fetch": (0.0, 0.5), "map": (0.5, 0.95), "upload": (0.95, 1.0)}
KEEP_DAYS = 30
now_iso = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
age_days = lambda iso: (time.time() - time.mktime(time.strptime((iso or "1970-01-01T00:00:00")[:19], "%Y-%m-%dT%H:%M:%S"))) / 86400


class Progress:
    """The request's stage and share done, written to R2 at most every 8 s (and at each new stage)."""
    def __init__(self, req: dict):
        self.req, self.last = req, 0.0

    def __call__(self, stage: str, inner: float = 0.0, note: str = ""):
        a, b = STAGES[stage]
        self.req["progress"] = {"stage": stage, "frac": round(a + (b - a) * max(0.0, min(1.0, inner)), 3), "note": note[:200], "at": now_iso()}
        now = time.monotonic()
        if now - self.last > 8 or inner == 0.0:
            self.last = now
            try:
                ci.put_json(f"{Q}{self.req['id']}.json", self.req)
            except Exception:
                pass


def make(req: dict, work: Path) -> dict:
    """One request: the open data fetched, the map made, the objects uploaded. Returns the result's summary."""
    rid, prog = req["id"], Progress(req)
    env = {**os.environ, "VIRTUAL_DATA": str(work), "PYTHONIOENCODING": "utf-8"}
    w, h = max(100, min(2000, float(req["w"]))), max(100, min(2000, float(req["h"])))
    if not ci.in_france(float(req["lat"]), float(req["lon"])):          # the API's box is rough: the border itself here
        raise RuntimeError("outside metropolitan France (IGN's data)")
    prog("fetch", 0, "IGN LiDAR HD, BD TOPO, BD ORTHO, cadastre, OpenStreetMap")
    ci.run([PY, HERE / "town_fetch.py", rid, req["lat"], req["lon"], w, h], prog, "fetch", est=60 + w * h / 4000, env=env, cwd=HERE)
    if not json.load(open(work / rid / "src" / "lidar.json", encoding="utf-8")):
        raise RuntimeError("no IGN LiDAR HD over this area yet")
    prog("map", 0)
    ci.run([PY, HERE / "town_map.py", rid, "--clip"], prog, "map", est=60 + w * h / 3000, env=env, cwd=HERE)
    rd = work / rid
    out = json.load(open(rd / "map_objects.json", encoding="utf-8"))
    area = json.load(open(rd / "area.json", encoding="utf-8"))
    lidar = json.load(open(rd / "src" / "lidar.json", encoding="utf-8")) if (rd / "src" / "lidar.json").exists() else {}
    out.update(area=area["box"], made=now_iso(), lidar={k: v.get("date", "") for k, v in lidar.items()},
               cadastre="pci" if (rd / "src" / "parcelles_pci.json").exists() else "etalab")
    prog("upload", 0)
    data = gzip.compress(json.dumps(out, separators=(",", ":")).encode("utf-8"))
    ci.aws("cp", "-", f"{ci.BUCKET}/{OUT}{rid}.json.gz", "--content-type", "application/json", data=data)
    return {"objects": len(out["objects"]), "bytes": len(data), "lidar": sorted(set(out["lidar"].values()))}


def sweep(reqs: list):
    """Requests and results older than KEEP_DAYS deleted (their objects were imported long ago or never will be)."""
    for r in reqs:
        if age_days(r.get("at")) > KEEP_DAYS:
            ci.aws("rm", f"{ci.BUCKET}/{Q}{r['id']}.json", check=False)
            ci.aws("rm", f"{ci.BUCKET}/{OUT}{r['id']}.json.gz", check=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reqs", required=True, type=Path)
    ap.add_argument("--work", required=True, type=Path)
    a = ap.parse_args()
    reqs = sorted((json.load(open(f, encoding="utf-8")) for f in a.reqs.glob("*.json")), key=lambda r: r.get("at", ""))
    sweep(reqs)
    # the queued ones, and those a run stopped short (no word of them for three hours)
    todo = [r for r in reqs if r.get("status") == "queued" and (not r.get("progress") or age_days(r["progress"].get("at")) > 0.125)]
    print(len(todo), "town maps to make", flush=True)
    for req in todo:
        t0 = time.monotonic()
        try:
            req.update(status="done", result=make(req, a.work), done=now_iso(), progress=None)
            print(req["id"], "done in", round(time.monotonic() - t0), "s", req["result"], flush=True)
        except Exception as ex:
            traceback.print_exc()
            req.update(status="failed", error=str(ex)[:300], done=now_iso(), progress=None)
        ci.put_json(f"{Q}{req['id']}.json", req)
        shutil.rmtree(a.work / req["id"], ignore_errors=True)


if __name__ == "__main__":
    main()

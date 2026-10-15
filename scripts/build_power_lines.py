#!/usr/bin/env python3
"""Build site/data/power_lines.json: OpenStreetMap transmission lines at or above a voltage threshold (default
250 kV), projected with the same Albers fit as provinces.json, simplified, split at province borders and grouped by
voltage class, with mapped route length per province.

Input (outside the repo: 1.5 GB, never committed or published as-is):
  _SCSP_export_large/EDWC_China_GIS/04_grid_transmission_osm/osm_china_infrastructure_2025-11.gpkg
  table energy_power_line: EPSG:3857 LINESTRINGs with the OSM tags max_voltage (volts), frequency, construction,
  disused (column names are truncated to 10 characters in the GeoPackage).

Rules and edge cases:
  - Every line is stored TWICE in this GeoPackage (and in 01_working/data/working/osm_filtered.gpkg): 22,376 OSM ids
    appear exactly twice with identical tags and geometry. Ways are de-duplicated by OSM id before anything else.
  - Voltage is OSM max_voltage. Ways without a voltage tag are dropped (about 30% of all power lines in China are
    untagged), as are ways tagged construction or disused.
  - China has no voltage class between 220 kV and 330 kV, so a 250 kV threshold keeps 330 kV and up (330/500/750 kV
    AC, ±400/±500/±660/±800/±1100 kV DC, 1000 kV UHV AC) and drops every 220 kV line.
  - Length is geodesic (haversine on the original vertices), counting each OSM way once. Two separate parallel lines
    count twice; a double-circuit line on one set of towers counts once. This is mapped route length, not the
    official circuit length published by the China Electricity Council.
  - Province attribution: each simplified segment carries the original length between its end vertices and goes to
    the province that contains its midpoint (snapped up to ~30 km for coastal rounding). Segments outside every
    outline (Taiwan, neighbouring countries) are dropped from both the drawing and the totals, and reported.

Licence: OpenStreetMap data (c) OpenStreetMap contributors, ODbL 1.0. power_lines.json is a derived database and
stays under the ODbL with that attribution (it is carried in the file's "source" block and in the map legend).

Usage (from china-dashboard/):
    python3 scripts/build_power_lines.py --edwc-root ..            # default threshold 250 kV
    python3 scripts/build_power_lines.py --edwc-root .. --min-kv 220
No third-party dependencies beyond numpy; reuses the projection and geometry helpers of build_dashboard_data.py.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import struct
import sys
import time
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_dashboard_data as bdd  # noqa: E402  (projection, simplification, point-in-polygon, province registry)

GPKG_REL = "_SCSP_export_large/EDWC_China_GIS/04_grid_transmission_osm/osm_china_infrastructure_2025-11.gpkg"
PROVINCES_REL = "01_working/data/preprocessed/china_province_map.geojson"
OUT = bdd.SITE_DATA / "power_lines.json"

# (key, label, lower bound in volts inclusive, upper bound exclusive). Order = drawing order (high voltage on top).
CLASSES = [
    ("220", "220 kV", 200_000, 250_000),          # only present if --min-kv is lowered below 250
    ("330", "330–400 kV", 250_000, 450_000),
    ("500", "500 kV", 450_000, 600_000),
    ("750", "660–750 kV", 600_000, 790_000),
    ("uhv", "UHV ≥800 kV", 790_000, 10_000_000),
]
SIMPLIFY_TOL = 0.2   # view-box units (~1 km); the map zooms to 12x
SNAP = 6.0           # view-box units (~30 km), as for the facility inventory
EARTH_KM = 6371.0088
WEB_MERC_R = 6378137.0

SOURCE = {
    "title": "OpenStreetMap power=line ways (China extract, November 2025), max_voltage at or above the threshold",
    "publisher": "© OpenStreetMap contributors",
    "licence": "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/); this file is a derived database under the same licence",
    "url": "https://www.openstreetmap.org/copyright",
    "unit": "km of mapped route",
    "tier": "C",
    "retrieved": "2025-11-12",
    "note": ("Volunteer-mapped; coverage is uneven and about 30% of power lines carry no voltage tag, so totals are a "
             "lower bound on route length, not official circuit length. Ways under construction or disused are excluded."),
}


def voltage_class(volts: float):
    for key, _label, lo, hi in CLASSES:
        if lo <= volts < hi:
            return key
    return None


def parse_gpkg_linestring(blob: bytes) -> np.ndarray:
    """GeoPackage binary -> (n, 2) array. Header: 'GP', version, flags, srs_id, optional envelope; then ISO WKB."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry blob")
    flags = blob[3]
    env = (flags >> 1) & 0b111
    off = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[env]
    bo = "<" if blob[off] == 1 else ">"
    gtype, n = struct.unpack_from(bo + "II", blob, off + 1)
    base, zm = gtype % 1000, gtype // 1000
    dims = {0: 2, 1: 3, 2: 3, 3: 4}[zm]
    if gtype & 0x80000000 or gtype & 0x40000000:  # EWKB-style Z/M flags
        base = gtype & 0xFF
        dims = 2 + bool(gtype & 0x80000000) + bool(gtype & 0x40000000)
    if base != 2:
        raise ValueError(f"expected LINESTRING, got WKB type {gtype}")
    return np.frombuffer(blob, dtype=np.dtype(bo + "f8"), count=n * dims, offset=off + 9).reshape(n, dims)[:, :2]


def mercator_to_lonlat(xy: np.ndarray):
    lon = np.degrees(xy[:, 0] / WEB_MERC_R)
    lat = np.degrees(2 * np.arctan(np.exp(xy[:, 1] / WEB_MERC_R)) - np.pi / 2)
    return lon, lat


def segment_km(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Haversine length of each consecutive segment, km."""
    la, lo = np.radians(lat), np.radians(lon)
    dla, dlo = np.diff(la), np.diff(lo)
    h = np.sin(dla / 2) ** 2 + np.cos(la[:-1]) * np.cos(la[1:]) * np.sin(dlo / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def dp_mask(points: np.ndarray, tol: float) -> np.ndarray:
    """Douglas–Peucker as in build_dashboard_data.douglas_peucker, but returning the keep mask so the original
    length between kept vertices can be carried onto each simplified segment."""
    n = len(points)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = points[a:b + 1]
        p0, p1 = seg[0], seg[-1]
        d = p1 - p0
        length = float(np.hypot(*d))
        if length == 0:
            dist = np.hypot(*(seg - p0).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p0[1]) - d[1] * (seg[:, 0] - p0[0])) / length
        i = int(np.argmax(dist))
        if dist[i] > tol:
            keep[a + i] = True
            stack.append((a, a + i))
            stack.append((a + i, b))
    return keep


def fmt(v: float) -> str:
    return f"{round(float(v), 1) + 0.0:g}"  # + 0.0 turns -0.0 into 0.0


def path_from_runs(runs: list[list[np.ndarray]]) -> str:
    """Polylines -> one SVG path ("M x,y x,y …" with implicit line-to). A run that starts where the previous one
    ended continues the same subpath. Runs that collapse to one point after rounding, or that repeat a run already
    drawn (parallel circuits mapped as separate ways land on the same rounded vertices), are not drawn; their length
    still counts in the totals."""
    out: list[str] = []
    last = None
    drawn: set = set()
    for run in runs:
        pts = []
        for p in run:
            q = (fmt(p[0]), fmt(p[1]))
            if not pts or pts[-1] != q:
                pts.append(q)
        if len(pts) < 2:
            continue
        key = tuple(pts)
        if key in drawn or key[::-1] in drawn:
            continue
        drawn.add(key)
        if last is not None and pts[0] == last:
            out.append(" " + " ".join(f"{x},{y}" for x, y in pts[1:]))
        else:
            out.append("M" + " ".join(f"{x},{y}" for x, y in pts))
        last = pts[-1]
    return "".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--edwc-root", default=str(bdd.ROOT.parent), help="EDWC project folder that holds the raw inputs")
    ap.add_argument("--gpkg", default=None, help=f"override the GeoPackage path (default: <edwc-root>/{GPKG_REL})")
    ap.add_argument("--min-kv", type=float, default=250.0, help="keep lines whose max_voltage is at least this (200-1000 kV)")
    args = ap.parse_args()
    if not 200 <= args.min_kv <= 1000:
        sys.exit("--min-kv must be between 200 and 1000")
    edwc = Path(args.edwc_root).resolve()
    gpkg = Path(args.gpkg) if args.gpkg else edwc / GPKG_REL
    if not gpkg.exists():
        sys.exit(f"GeoPackage not found: {gpkg}")
    t0 = time.time()
    min_v = args.min_kv * 1000

    # Same projection fit as provinces.json, or the lines would not sit on the drawn outlines.
    prov, proj, fit, to_view = bdd.load_provinces(edwc / PROVINCES_REL)
    published = json.loads((bdd.SITE_DATA / "provinces.json").read_text(encoding="utf-8"))["projection"]
    for k in ("scale", "offx", "offy"):
        if abs(published[k] - fit[k]) > 1e-4 * max(1.0, abs(fit[k])):
            sys.exit(f"projection {k} differs from provinces.json ({published[k]} vs {fit[k]}); rebuild provinces.json first")

    con = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    q = lambda sql, *a: con.execute(sql, a).fetchone()[0]  # noqa: E731
    stats = {
        "ways_total": q("select count(distinct id) from energy_power_line"),
        "untagged_ways": q("select count(distinct id) from energy_power_line where max_voltag is null or max_voltag <= 0"),
        "below_threshold_ways": q("select count(distinct id) from energy_power_line where max_voltag > 0 and max_voltag < ?", min_v),
        "duplicate_rows": 0, "construction_or_disused_ways": 0,
    }
    rows = con.execute("select id, max_voltag, constructi, disused, geom from energy_power_line "
                       "where max_voltag >= ? order by fid", (min_v,)).fetchall()
    seen: set = set()
    ways: list[tuple[str, np.ndarray]] = []
    for oid, volts, construction, disused, geom in rows:
        if oid in seen:
            stats["duplicate_rows"] += 1
            continue
        seen.add(oid)
        if construction or disused:
            stats["construction_or_disused_ways"] += 1
            continue
        cls = voltage_class(volts)
        if cls is None:
            continue
        a = parse_gpkg_linestring(geom)
        if len(a) >= 2:
            ways.append((cls, a))
    print(f"read {len(rows)} rows -> {len(ways)} ways at >= {args.min_kv:g} kV  ({time.time() - t0:.1f}s)")

    # Project every vertex in one go, then walk the ways.
    lens = np.array([len(a) for _, a in ways])
    starts = np.concatenate([[0], np.cumsum(lens)[:-1]])
    lon, lat = mercator_to_lonlat(np.concatenate([a for _, a in ways]))
    px, py = proj(lon, lat)
    vxy = to_view(np.column_stack([px, -py]))
    pieces = []  # (class, simplified view points (k,2), original km per simplified segment (k-1))
    mids = []
    for (cls, _a), s, n in zip(ways, starts, lens):
        v = vxy[s:s + n]
        ckm = np.concatenate([[0.0], np.cumsum(segment_km(lon[s:s + n], lat[s:s + n]))])
        idx = np.nonzero(dp_mask(v, SIMPLIFY_TOL))[0]
        pts = v[idx]
        pieces.append((cls, pts, ckm[idx[1:]] - ckm[idx[:-1]]))
        mids.append((pts[1:] + pts[:-1]) / 2)
    mid = np.concatenate(mids)
    print(f"simplified {int(lens.sum())} vertices to {sum(len(p) for _, p, _ in pieces)}; {len(mid)} segments  ({time.time() - t0:.1f}s)")
    seg_pid = bdd.assign_province(prov, mid[:, 0], mid[:, 1], snap_px=SNAP)
    print(f"assigned provinces  ({time.time() - t0:.1f}s)")

    runs = defaultdict(lambda: defaultdict(list))   # province -> class -> polylines
    km = defaultdict(lambda: defaultdict(float))     # province -> class -> km
    outside_km: Counter = Counter()
    k = 0
    for cls, pts, skm in pieces:
        run, run_pid = None, None
        for j in range(len(skm)):
            pid = seg_pid[k]
            k += 1
            if pid is None:
                outside_km[cls] += float(skm[j])
                run = None
                continue
            km[pid][cls] += float(skm[j])
            if run is not None and run_pid == pid:
                run.append(pts[j + 1])
            else:
                run, run_pid = [pts[j], pts[j + 1]], pid
                runs[pid][cls].append(run)

    order = [c[0] for c in CLASSES]
    classes_out = []
    for key, label, lo, hi in CLASSES:
        n = sum(1 for c, _ in ways if c == key)
        if not n:
            continue
        classes_out.append({"key": key, "label": label, "min_kv": lo / 1000, "max_kv": hi / 1000 if hi < 10_000_000 else None,
                            "ways": n, "km": round(sum(km[p][key] for p in km), 1)})
    paths = {}
    for pid in sorted(runs):
        d = {c: path_from_runs(runs[pid][c]) for c in order if runs[pid].get(c)}
        d = {c: s for c, s in d.items() if s}
        if d:
            paths[pid] = d
    doc = {
        "generated": date.today().isoformat(),
        "min_kv": args.min_kv,
        "source": SOURCE,
        "classes": classes_out,
        "paths": paths,
        "km_by_province": {pid: {c: round(km[pid][c], 1) for c in order if km[pid].get(c)} for pid in sorted(km)},
        "dropped": {**stats, "outside_outlines_km": {c: round(v, 1) for c, v in outside_km.items()}},
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"wrote {OUT.relative_to(bdd.ROOT)}: {OUT.stat().st_size / 1024:.0f} KB, {len(paths)} provinces  ({time.time() - t0:.1f}s)")
    for c in classes_out:
        print(f"  {c['label']:<24} {c['ways']:>6} ways  {c['km']:>10,.0f} km")
    print("  total", f"{sum(c['km'] for c in classes_out):,.0f} km")
    print("  dropped:", json.dumps(doc["dropped"]))


if __name__ == "__main__":
    main()

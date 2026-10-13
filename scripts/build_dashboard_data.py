#!/usr/bin/env python3
"""Build the map-dashboard data files in site/data/ from the research inputs.

Inputs (all outside the published site; paths relative to --edwc-root, the EDWC project folder):
  provinces   01_working/data/preprocessed/china_province_map.geojson
  DCM export  01_working/data/clean/datacentermap 2.csv            (licensed: published only without coordinates,
                                                                     addresses or links)
  baxtel      data/dc/data_center_data.csv                          (China subset of the baxtel crawl)
  DCKB        archive/DCKB_cleaned_latlon_CHINA.xlsx                (14 sites with IT power)
  dhi         dhi/data/hyperscale_datacenters.geojson, dhi/data/western_datacenters.geojson
  GEM plants  01_working/data/clean/ENERGY_CHINA_CLEAN/china_gem_{bioenergy,coal,hydro,nuclear,solar,wind}.csv
  indicators  china-dashboard/data_sources/*.csv  (hand-transcribed official tables, see data_sources/README.md)

Outputs (site/data/):
  provinces.json     province outlines projected to the 1000x620 SVG view box, centroids, hub flags, indicators
  facilities.json    the merged, de-duplicated data-center inventory, aggregated to PROVINCE LEVEL: no coordinates,
                     no addresses, no profile links are ever written
  power_plants.json  GEM power plants (public, CC BY) projected to the view box

Usage:
    python3 scripts/build_dashboard_data.py --edwc-root ..            # from china-dashboard/
    python3 scripts/build_dashboard_data.py --edwc-root .. --check    # build, then assert the privacy rules

No third-party dependencies beyond numpy (projection, simplification and point-in-polygon are implemented here).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SITE_DATA = ROOT / "site" / "data"
SOURCES = ROOT / "data_sources"

VIEW_W, VIEW_H, PAD = 1000, 620, 12

# ----------------------------------------------------------------------------------------------------------------
# Province registry. `geo` is the name used in the province GeoJSON; `zh` matches the NBS yearbook row labels.
# `hub` is the East Data West Computing national hub the province belongs to (NDRC et al., 2022), else None.
# ----------------------------------------------------------------------------------------------------------------
PROVINCES = [
    # id, geo name, en, zh, region, EDWC hub
    ("beijing", "Beijing", "Beijing", "北京", "North", "jingjinji"),
    ("tianjin", "Tianjin", "Tianjin", "天津", "North", "jingjinji"),
    ("hebei", "Hebei", "Hebei", "河北", "North", "jingjinji"),
    ("shanxi", "Shanxi", "Shanxi", "山西", "North", None),
    ("nei_mongol", "NeiMongol", "Inner Mongolia", "内蒙古", "North", "inner_mongolia"),
    ("liaoning", "Liaoning", "Liaoning", "辽宁", "Northeast", None),
    ("jilin", "Jilin", "Jilin", "吉林", "Northeast", None),
    ("heilongjiang", "Heilongjiang", "Heilongjiang", "黑龙江", "Northeast", None),
    ("shanghai", "Shanghai", "Shanghai", "上海", "East", "yangtze_delta"),
    ("jiangsu", "Jiangsu", "Jiangsu", "江苏", "East", "yangtze_delta"),
    ("zhejiang", "Zhejiang", "Zhejiang", "浙江", "East", "yangtze_delta"),
    ("anhui", "Anhui", "Anhui", "安徽", "East", "yangtze_delta"),
    ("fujian", "Fujian", "Fujian", "福建", "East", None),
    ("jiangxi", "Jiangxi", "Jiangxi", "江西", "East", None),
    ("shandong", "Shandong", "Shandong", "山东", "East", None),
    ("henan", "Henan", "Henan", "河南", "Central", None),
    ("hubei", "Hubei", "Hubei", "湖北", "Central", None),
    ("hunan", "Hunan", "Hunan", "湖南", "Central", None),
    ("guangdong", "Guangdong", "Guangdong", "广东", "South", "greater_bay"),
    ("guangxi", "Guangxi", "Guangxi", "广西", "South", None),
    ("hainan", "Hainan", "Hainan", "海南", "South", None),
    ("chongqing", "Chongqing", "Chongqing", "重庆", "Southwest", "chengdu_chongqing"),
    ("sichuan", "Sichuan", "Sichuan", "四川", "Southwest", "chengdu_chongqing"),
    ("guizhou", "Guizhou", "Guizhou", "贵州", "Southwest", "guizhou"),
    ("yunnan", "Yunnan", "Yunnan", "云南", "Southwest", None),
    ("xizang", "Xizang", "Tibet (Xizang)", "西藏", "Southwest", None),
    ("shaanxi", "Shaanxi", "Shaanxi", "陕西", "Northwest", None),
    ("gansu", "Gansu", "Gansu", "甘肃", "Northwest", "gansu"),
    ("qinghai", "Qinghai", "Qinghai", "青海", "Northwest", None),
    ("ningxia", "NingxiaHui", "Ningxia", "宁夏", "Northwest", "ningxia"),
    ("xinjiang", "XinjiangUygur", "Xinjiang", "新疆", "Northwest", None),
    ("hong_kong", "HongKong", "Hong Kong SAR", "香港", "South", "greater_bay"),
    ("macau", "Macau", "Macau SAR", "澳门", "South", "greater_bay"),
]
GEO_TO_ID = {geo: pid for pid, geo, *_ in PROVINCES}
ZH_TO_ID = {zh: pid for pid, _g, _e, zh, *_ in PROVINCES}
EN_TO_ID = {en: pid for pid, _g, en, *_ in PROVINCES}
EN_TO_ID.update({"Tibet": "xizang", "Xizang": "xizang", "Nei Mongol": "nei_mongol", "Hong Kong": "hong_kong",
                 "Ningxia Hui": "ningxia", "Xinjiang Uygur": "xinjiang", "Guangxi Zhuang": "guangxi"})

HUBS = {
    "jingjinji": {"name_en": "Beijing–Tianjin–Hebei hub", "name_zh": "京津冀枢纽", "cluster": "张家口集群"},
    "yangtze_delta": {"name_en": "Yangtze River Delta hub", "name_zh": "长三角枢纽", "cluster": "长三角生态绿色一体化发展示范区集群、芜湖集群"},
    "greater_bay": {"name_en": "Guangdong–Hong Kong–Macao hub", "name_zh": "粤港澳枢纽", "cluster": "韶关集群"},
    "chengdu_chongqing": {"name_en": "Chengdu–Chongqing hub", "name_zh": "成渝枢纽", "cluster": "天府集群、重庆集群"},
    "inner_mongolia": {"name_en": "Inner Mongolia hub", "name_zh": "内蒙古枢纽", "cluster": "和林格尔集群"},
    "guizhou": {"name_en": "Guizhou hub", "name_zh": "贵州枢纽", "cluster": "贵安集群"},
    "gansu": {"name_en": "Gansu hub", "name_zh": "甘肃枢纽", "cluster": "庆阳集群"},
    "ningxia": {"name_en": "Ningxia hub", "name_zh": "宁夏枢纽", "cluster": "中卫集群"},
}

# Status vocabulary shared with the US tracker: Operating, Development (under construction), Proposed, Unknown.
STATUS_MAP = {
    "operational": "Operating", "operating": "Operating", "Operational": "Operating",
    "under construction": "Development", "construction": "Development", "Under Construction": "Development",
    "planned": "Proposed", "Planned": "Proposed", "proposed": "Proposed",
}

CAPACITY_CLASSES = [  # (label, lower bound inclusive, upper bound exclusive)
    ("Mega campus (1,000+ MW)", 1000, math.inf),
    ("Hyperscale (100–999 MW)", 100, 1000),
    ("Large (51–99 MW)", 51, 100),
    ("Medium (11–50 MW)", 11, 51),
    ("Small (0–10 MW)", 0, 11),
]

# DataCenterMap "market" names for the export rows that carry no coordinates; they still belong to a province.
MARKET_TO_PROVINCE = {
    "Hong Kong": "hong_kong", "Zhangjiakou": "hebei", "Baoding": "hebei", "Qinhuangdao": "hebei", "Langfang": "hebei",
    "Dongguan": "guangdong", "Guangzhou": "guangdong", "Shenzhen": "guangdong", "Ordos City": "nei_mongol",
    "Ulanqab": "nei_mongol", "Hohhot": "nei_mongol", "Wuhu": "anhui", "Hefei": "anhui", "Zhongwei": "ningxia",
    "Nantong": "jiangsu", "Suzhou": "jiangsu", "Nanjing": "jiangsu", "Beijing": "beijing", "Shanghai": "shanghai",
    "Tianjin": "tianjin", "Chengdu": "sichuan", "Chongqing": "chongqing", "Guiyang": "guizhou", "Lanzhou": "gansu",
}

GEM_TECH = {"bioenergy": "Bioenergy", "coal": "Coal", "hydro": "Hydro", "nuclear": "Nuclear", "solar": "Solar", "wind": "Wind"}


# ----------------------------------------------------------------------------------------------------------------
# Geometry helpers (no GIS dependencies)
# ----------------------------------------------------------------------------------------------------------------
class Albers:
    """Albers equal-area conic projection, the usual choice for a China-wide map (standard parallels 25°N and 47°N)."""

    def __init__(self, lon0=105.0, lat0=0.0, lat1=25.0, lat2=47.0):
        self.lon0 = math.radians(lon0)
        p0, p1, p2 = map(math.radians, (lat0, lat1, lat2))
        self.n = (math.sin(p1) + math.sin(p2)) / 2
        self.c = math.cos(p1) ** 2 + 2 * self.n * math.sin(p1)
        self.rho0 = math.sqrt(self.c - 2 * self.n * math.sin(p0)) / self.n

    def __call__(self, lon, lat):
        lon = np.radians(np.asarray(lon, dtype=float))
        lat = np.radians(np.asarray(lat, dtype=float))
        rho = np.sqrt(self.c - 2 * self.n * np.sin(lat)) / self.n
        theta = self.n * (lon - self.lon0)
        return rho * np.sin(theta), self.rho0 - rho * np.cos(theta)


def mercator_to_lonlat(xy: np.ndarray) -> np.ndarray:
    """The province file is stored in EPSG:3857 (Web Mercator, metres). Return lon/lat degrees; pass-through
    if the values already look like degrees."""
    if np.abs(xy).max() <= 360:
        return xy
    r = 6378137.0
    lon = np.degrees(xy[:, 0] / r)
    lat = np.degrees(2 * np.arctan(np.exp(xy[:, 1] / r)) - np.pi / 2)
    return np.column_stack([lon, lat])


def douglas_peucker(points: np.ndarray, tol: float) -> np.ndarray:
    """Iterative Douglas–Peucker on an (n,2) array; keeps the end points."""
    n = len(points)
    if n < 3:
        return points
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
        length = math.hypot(*d)
        if length == 0:
            dist = np.hypot(*(seg - p0).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p0[1]) - d[1] * (seg[:, 0] - p0[0])) / length
        i = int(np.argmax(dist))
        if dist[i] > tol:
            keep[a + i] = True
            stack.append((a, a + i))
            stack.append((a + i, b))
    return points[keep]


def ring_area(ring: np.ndarray) -> float:
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def points_in_ring(px: np.ndarray, py: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """Vectorised even–odd ray casting. `ring` is (m,2); returns a boolean mask over the points."""
    inside = np.zeros(len(px), dtype=bool)
    x, y = ring[:, 0], ring[:, 1]
    xj, yj = np.roll(x, 1), np.roll(y, 1)
    for i in range(len(ring)):
        cond = (y[i] > py) != (yj[i] > py)
        if not cond.any():
            continue
        xint = (xj[i] - x[i]) * (py - y[i]) / (yj[i] - y[i] + 1e-300) + x[i]
        inside ^= cond & (px < xint)
    return inside


def path_d(rings: list[np.ndarray]) -> str:
    parts = []
    for r in rings:
        coords = [f"{x:.1f},{y:.1f}" for x, y in r]
        parts.append("M" + "L".join(coords) + "Z")
    return "".join(parts)


# ----------------------------------------------------------------------------------------------------------------
# Provinces
# ----------------------------------------------------------------------------------------------------------------
def load_provinces(path: Path):
    """Project, merge multi-feature provinces, simplify, and return per-province outlines + projected rings."""
    g = json.loads(path.read_text(encoding="utf-8"))
    proj = Albers()
    raw = defaultdict(list)  # province id -> list of (outer ring lon/lat array, [holes])
    for f in g["features"]:
        geo = f["properties"]["Province"]
        pid = GEO_TO_ID.get(geo)
        if pid is None:
            print(f"warning: unknown province name in GeoJSON: {geo!r}", file=sys.stderr)
            continue
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            raw[pid].append([mercator_to_lonlat(np.asarray(ring, dtype=float)[:, :2]) for ring in poly])

    # Project everything first so the fit (scale/translate) is computed from the whole country.
    projected = {}
    allx, ally = [], []
    for pid, polys in raw.items():
        pp = []
        for rings in polys:
            pr = []
            for ring in rings:
                x, y = proj(ring[:, 0], ring[:, 1])
                pr.append(np.column_stack([x, -y]))  # flip y: SVG grows downwards
            pp.append(pr)
            allx.append(pr[0][:, 0]); ally.append(pr[0][:, 1])
        projected[pid] = pp
    ax, ay = np.concatenate(allx), np.concatenate(ally)
    minx, maxx, miny, maxy = ax.min(), ax.max(), ay.min(), ay.max()
    scale = min((VIEW_W - 2 * PAD) / (maxx - minx), (VIEW_H - 2 * PAD) / (maxy - miny))
    offx = PAD + ((VIEW_W - 2 * PAD) - (maxx - minx) * scale) / 2 - minx * scale
    offy = PAD + ((VIEW_H - 2 * PAD) - (maxy - miny) * scale) / 2 - miny * scale

    def to_view(arr):
        return np.column_stack([arr[:, 0] * scale + offx, arr[:, 1] * scale + offy])

    out = {}
    for pid, polys in projected.items():
        rings_view, holes_view, paths = [], [], []
        best_area, best_ring = -1.0, None
        for rings in polys:
            outer = to_view(rings[0])
            area = abs(ring_area(outer))
            if area < 1.5 and pid not in ("hong_kong", "macau"):
                continue  # specks (islets) only add bytes
            simplified = douglas_peucker(outer, 0.55)
            if len(simplified) < 4:
                continue
            paths.append(simplified)
            rings_view.append(outer)
            for hole in rings[1:]:
                holes_view.append((outer, to_view(hole)))
            if area > best_area:
                best_area, best_ring = area, outer
        # Label/bubble anchor: centroid of the largest polygon (inside for every province here, checked below).
        cx, cy = polygon_centroid(best_ring)
        if not points_in_ring(np.array([cx]), np.array([cy]), best_ring)[0]:
            cx, cy = best_ring.mean(axis=0)
        out[pid] = {
            "path": path_d(paths),
            "cx": round(float(cx), 1), "cy": round(float(cy), 1),
            "_rings": rings_view, "_holes": holes_view,
            "_bbox": (min(r[:, 0].min() for r in rings_view), min(r[:, 1].min() for r in rings_view),
                      max(r[:, 0].max() for r in rings_view), max(r[:, 1].max() for r in rings_view)),
        }
    fit = {"type": "Albers equal-area conic", "lon0": 105, "lat1": 25, "lat2": 47, "scale": scale, "offx": offx, "offy": offy}
    return out, proj, fit, to_view


def polygon_centroid(ring: np.ndarray):
    x, y = ring[:, 0], ring[:, 1]
    xs, ys = np.roll(x, -1), np.roll(y, -1)
    cross = x * ys - xs * y
    a = cross.sum() / 2
    if abs(a) < 1e-9:
        return float(x.mean()), float(y.mean())
    return float(((x + xs) * cross).sum() / (6 * a)), float(((y + ys) * cross).sum() / (6 * a))


def assign_province(prov, xs: np.ndarray, ys: np.ndarray, snap_px: float = 0.0) -> list[str | None]:
    """Point-in-polygon against the projected province outlines (bounding-box prefilter, holes honoured).
    `snap_px` > 0 also assigns points that miss every outline to the nearest outline vertex within that many
    view-box pixels (coastal rounding, offshore wind, islets dropped from the simplified map)."""
    result: list[str | None] = [None] * len(xs)
    unassigned = np.ones(len(xs), dtype=bool)
    nan = np.isnan(xs) | np.isnan(ys)
    unassigned &= ~nan
    for pid, p in prov.items():
        x0, y0, x1, y1 = p["_bbox"]
        cand = unassigned & (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)
        if not cand.any():
            continue
        idx = np.nonzero(cand)[0]
        hit = np.zeros(len(idx), dtype=bool)
        for ring in p["_rings"]:
            hit |= points_in_ring(xs[idx], ys[idx], ring)
        for outer, hole in p["_holes"]:
            inside_hole = points_in_ring(xs[idx], ys[idx], hole)
            hit &= ~inside_hole
        for i in idx[hit]:
            result[i] = pid
            unassigned[i] = False
    if snap_px > 0 and unassigned.any():
        verts = [(pid, np.concatenate(p["_rings"])) for pid, p in prov.items()]
        for i in np.nonzero(unassigned)[0]:
            best, best_d = None, snap_px
            for pid, v in verts:
                d = float(np.min(np.hypot(v[:, 0] - xs[i], v[:, 1] - ys[i])))
                if d < best_d:
                    best, best_d = pid, d
            result[i] = best
    return result


# ----------------------------------------------------------------------------------------------------------------
# Data-center inventory
# ----------------------------------------------------------------------------------------------------------------
def fnum(v):
    try:
        v = str(v).strip().replace(",", "")
        return float(v) if v not in ("", "nan", "None") else None
    except ValueError:
        return None


FTYPE_MAP = {"Hyperscaler": "Hyperscale", "Owned by a Carrier, but operates as Carrier-Neutral": "Carrier-Neutral"}


def capacity_class(mw):
    if mw is None:
        return "Unknown"
    for label, lo, hi in CAPACITY_CLASSES:
        if lo <= mw < hi:
            return label
    return "Unknown"


def read_dcm(path: Path, flags: list[str]):
    """The DCM export has one record whose name field contains an unescaped quote, which splits two rows
    (Alibaba Ulanqab Building A/B) across three malformed lines. They are repaired explicitly here."""
    rows = list(csv.DictReader(path.open(encoding="utf-8", newline="")))
    out = []
    repaired = 0
    for r in rows:
        if r["stage"] not in STATUS_MAP:
            # malformed row(s): the two Alibaba Ulanqab buildings. Coordinates from the matching record in
            # dhi/data/western_datacenters.geojson (same export).
            if "Ulanqab" in (r.get("name") or "") or "Ulanqab" in (r.get("company_name") or ""):
                if repaired == 0:
                    for suffix in ("A", "B"):
                        out.append({"src": "dcm", "src_id": f"dcm:{'12115' if suffix == 'A' else '12126'}",
                                    "name": f"Alibaba Ulanqab - Building {suffix}", "operator": "Alibaba Cloud",
                                    "status": "Operating", "ftype": "Hyperscaler", "listing": "Facility",
                                    "lat": 40.982922, "lon": 113.240755, "mw": None, "pue": None, "year": None,
                                    "country": "China"})
                    repaired += 1
                continue
            flags.append(f"dcm: dropped unparseable row {r.get('id')!r} {r.get('name')!r}")
            continue
        out.append({
            "src": "dcm", "src_id": f"dcm:{r['id']}", "name": r["name"].strip(), "operator": r["company_name"].strip() or None,
            "status": STATUS_MAP[r["stage"]], "ftype": r["capacity_type"] or None, "listing": r["listing_type"] or None,
            "lat": fnum(r["latitude"]), "lon": fnum(r["longitude"]), "mw": fnum(r["power_builtout"]),
            "pue": fnum(r["pue"]), "year": int(fnum(r["year_operational"])) if fnum(r["year_operational"]) else None,
            "country": r["country"], "province_hint": MARKET_TO_PROVINCE.get((r.get("market") or "").strip()),
        })
    if repaired:
        flags.append("dcm: repaired the split Alibaba Ulanqab Building A/B rows (unescaped quote in the export)")
    # Campus listings duplicate the facilities inside them (parent_id). Keep facilities; keep a campus only when
    # it has no child rows in the export.
    ids = {r["src_id"] for r in out}
    parents = {f"dcm:{r['parent_id']}" for r in rows if r.get("parent_id") not in (None, "", "0")}
    before = len(out)
    out = [r for r in out if not (r["listing"] == "Campus" and r["src_id"] in parents)]
    if before != len(out):
        flags.append(f"dcm: dropped {before - len(out)} campus rows that only wrap facilities already listed")
    return out


def read_baxtel(path: Path):
    out = []
    for r in csv.DictReader(path.open(encoding="utf-8", newline="")):
        stage = (r.get("primary_stage") or "").strip().lower()
        out.append({
            "src": "baxtel", "src_id": f"baxtel:{r['id']}", "name": None, "operator": None,
            "status": STATUS_MAP.get(stage, "Unknown"), "ftype": r.get("company_type") or None, "listing": "Facility",
            "lat": fnum(r["Latitude"]), "lon": fnum(r["Longitude"]), "mw": None, "pue": None, "year": None, "country": "China",
        })
    return out


def read_xlsx_rows(path: Path):
    """Minimal .xlsx reader (first sheet) without openpyxl: shared strings + inline values."""
    with zipfile.ZipFile(path) as z:
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet.iter("{%s}row" % ns["m"]):
            vals = {}
            for c in row.findall("m:c", ns):
                ref = re.match(r"([A-Z]+)", c.get("r")).group(1)
                if c.get("t") == "inlineStr":
                    vals[ref] = "".join(t.text or "" for t in c.iter("{%s}t" % ns["m"]))
                    continue
                v = c.find("m:v", ns)
                if v is None:
                    continue
                if c.get("t") == "s":
                    vals[ref] = shared[int(v.text)]
                else:
                    vals[ref] = v.text
            rows.append(vals)
    header = rows[0]
    cols = sorted(header, key=lambda k: (len(k), k))
    return [{header[c]: r.get(c) for c in cols} for r in rows[1:]]


def read_dckb(path: Path):
    out = []
    for r in read_xlsx_rows(path):
        kw = fnum(r.get("TOTALITPOWER"))
        alloc = fnum(r.get("TOTALITPOWERALLOCATED"))
        # DCKB reports IT power in kW; "0" means not reported. Prefer total, fall back to allocated.
        mw = None
        for v in (kw, alloc):
            if v and v > 0:
                mw = round(v / 1000.0, 2)
                break
        out.append({
            "src": "dckb", "src_id": f"dckb:{hashlib.sha1(str(r.get('DATACENTERNAME')).encode()).hexdigest()[:8]}",
            "name": (r.get("DATACENTERNAME") or "").strip() or None, "operator": None,
            "status": STATUS_MAP.get(str(r.get("OPERATIONALSTATUS")), "Unknown"), "ftype": None, "listing": "Facility",
            "lat": fnum(r.get("LATITUDE")), "lon": fnum(r.get("LONGITUDE")), "mw": mw, "pue": None, "year": None, "country": "China",
        })
    return out


def read_dhi(hyper: Path, western: Path):
    out = []
    g = json.loads(hyper.read_text(encoding="utf-8"))
    for f in g["features"]:
        p = f["properties"]
        out.append({"src": "dhi_hyperscale", "src_id": f"dcm:{p['id']}", "name": p.get("name"), "operator": p.get("company_name"),
                    "status": STATUS_MAP.get(p.get("stage"), "Unknown"), "ftype": p.get("capacity_type"), "listing": p.get("listing_type"),
                    "lat": f["geometry"]["coordinates"][1], "lon": f["geometry"]["coordinates"][0],
                    "mw": fnum(p.get("power_builtout")), "pue": fnum(p.get("pue")),
                    "year": int(p["year_operational"]) if p.get("year_operational") else None, "country": p.get("country", "China")})
    g = json.loads(western.read_text(encoding="utf-8"))
    for f in g["features"]:
        p = f["properties"]
        out.append({"src": "dhi_western", "src_id": f"dhi:{p['id']}", "name": p.get("name"), "operator": None,
                    "status": "Unknown", "ftype": p.get("capacity_type"), "listing": "Facility",
                    "lat": f["geometry"]["coordinates"][1], "lon": f["geometry"]["coordinates"][0],
                    "mw": None, "pue": None, "year": int(p["year_operational"]) if p.get("year_operational") else None,
                    "country": p.get("country", "China")})
    return out


def norm_name(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def merge_inventory(records: list[dict], flags: list[str]):
    """De-duplicate across sources. Order of trust: DCM > dhi (DCM-derived) > DCKB > baxtel.
    Rules: identical source id (dhi hyperscale rows are DCM rows), same normalised name, or an unnamed record
    (baxtel) within 400 m of a named one. Merged records keep every source id and fill missing fields."""
    rank = {"dcm": 0, "dhi_hyperscale": 1, "dhi_western": 2, "dckb": 3, "baxtel": 4}
    records = sorted(records, key=lambda r: rank[r["src"]])
    merged: list[dict] = []
    by_id: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    dup = Counter()
    nocoord = Counter()

    def absorb(target, r, why):
        target["sources"].add(r["src"])
        target["source_ids"].add(r["src_id"])
        for k in ("name", "operator", "ftype", "mw", "pue", "year", "listing"):
            if target.get(k) in (None, "") and r.get(k) not in (None, ""):
                target[k] = r[k]
        if target["status"] == "Unknown" and r["status"] != "Unknown":
            target["status"] = r["status"]
        dup[why] += 1

    for r in records:
        if r["lat"] is None or r["lon"] is None:
            if not r.get("province_hint"):
                flags.append(f"{r['src']}: {r['src_id']} has no coordinates and no market hint; dropped")
                continue
            nocoord[r["src"]] += 1
        t = by_id.get(r["src_id"])
        if t is not None:
            absorb(t, r, "same source id")
            continue
        nn = norm_name(r["name"])
        if nn and nn in by_name and (r["lat"] is None or by_name[nn]["lat"] is None or
                                     haversine_km(r["lat"], r["lon"], by_name[nn]["lat"], by_name[nn]["lon"]) < 25):
            absorb(by_name[nn], r, "same name")
            by_id[r["src_id"]] = by_name[nn]
            continue
        if r["src"] in ("baxtel", "dckb", "dhi_western") and r["lat"] is not None:
            near = None
            for m in merged:
                if m["lat"] is not None and abs(m["lat"] - r["lat"]) < 0.01 and abs(m["lon"] - r["lon"]) < 0.01 and \
                        haversine_km(r["lat"], r["lon"], m["lat"], m["lon"]) < 0.4:
                    near = m
                    break
            if near is not None:
                absorb(near, r, "within 400 m of a listed facility")
                by_id[r["src_id"]] = near
                continue
        m = dict(r)
        m["sources"] = {r["src"]}
        m["source_ids"] = {r["src_id"]}
        merged.append(m)
        by_id[r["src_id"]] = m
        if nn:
            by_name[nn] = m
    for why, n in dup.items():
        flags.append(f"merge: {n} records folded ({why})")
    for src, n in nocoord.items():
        flags.append(f"{src}: {n} records without coordinates kept via their market name (province hint)")
    return merged


# ----------------------------------------------------------------------------------------------------------------
# Indicators (hand-transcribed official tables in data_sources/)
# ----------------------------------------------------------------------------------------------------------------
def read_csv_rows(path: Path):
    return list(csv.DictReader(path.open(encoding="utf-8", newline="")))


def load_indicators():
    ind = defaultdict(dict)
    for r in read_csv_rows(SOURCES / "nbs_2025_yearbook_9-19_generation_2024.csv"):
        pid = ZH_TO_ID[r["province_zh"]]
        ind[pid]["generation_2024"] = fnum(r["generation_2024_100m_kwh"])
        ind[pid]["hydro_generation_2024"] = fnum(r["hydro_2024_100m_kwh"])
    for r in read_csv_rows(SOURCES / "nbs_2025_yearbook_9-14_consumption.csv"):
        pid = ZH_TO_ID[r["province_zh"]]
        ind[pid]["consumption_2024"] = fnum(r["consumption_2024_100m_kwh"])
        ind[pid]["consumption_2020"] = fnum(r["consumption_2020_100m_kwh"])
    for r in read_csv_rows(SOURCES / "nbs_2025_yearbook_8-8_water_resources_2024.csv"):
        pid = ZH_TO_ID[r["province_zh"]]
        ind[pid]["water_total_2024"] = fnum(r["total_water_resources_100m_m3"])
        ind[pid]["water_surface_2024"] = fnum(r["surface_water_100m_m3"])
        ind[pid]["water_ground_2024"] = fnum(r["groundwater_100m_m3"])
        ind[pid]["water_per_capita_2024"] = fnum(r["per_capita_water_m3"])
    for r in read_csv_rows(SOURCES / "nbs_2025_yearbook_8-9_water_use_2024.csv"):
        pid = ZH_TO_ID[r["province_zh"]]
        ind[pid]["water_use_total_2024"] = fnum(r["total_water_use_100m_m3"])
        ind[pid]["water_use_industrial_2024"] = fnum(r["industrial_use_100m_m3"])
        ind[pid]["water_use_per_capita_2024"] = fnum(r["per_capita_use_m3"])
    for r in read_csv_rows(SOURCES / "tariff_china_briefing_may2025.csv"):
        pid = EN_TO_ID[r["province_en"]]
        ind[pid]["tariff_single_1_10kv"] = fnum(r["single_part_1_10kv_cny_kwh"])
        ind[pid]["tariff_two_part_1_10kv"] = fnum(r["two_part_energy_1_10kv_cny_kwh"])
        if r["note"]:
            ind[pid]["tariff_note"] = r["note"]
    # Derived, and labelled as such in the UI: water-use pressure = use / resources (both 2024, 亿 m³).
    for pid, d in ind.items():
        if d.get("water_total_2024") and d.get("water_use_total_2024") is not None:
            d["water_stress_ratio_2024"] = round(d["water_use_total_2024"] / d["water_total_2024"], 3)
        if d.get("generation_2024") is not None and d.get("consumption_2024") is not None:
            d["generation_balance_2024"] = round(d["generation_2024"] - d["consumption_2024"], 2)
    return ind


SOURCE_NOTES = {
    "generation": {"title": "中国统计年鉴 2025, 表 9-19 分地区主要能源产品产量 (发电量, 2024)", "publisher": "国家统计局 (NBS)",
                   "url": "https://www.stats.gov.cn/sj/ndsj/2025/html/C09-19.jpg", "unit": "亿千瓦时 (100 million kWh)", "tier": "A",
                   "retrieved": "2026-10-12", "note": "Full-caliber provincial generation; the table is published as an image and was transcribed by hand."},
    "consumption": {"title": "中国统计年鉴 2025, 表 9-14 分地区用电量", "publisher": "国家统计局 (data from 中国电力企业联合会)",
                    "url": "https://www.stats.gov.cn/sj/ndsj/2025/html/C09-14.jpg", "unit": "亿千瓦时", "tier": "A", "retrieved": "2026-10-12"},
    "water_resources": {"title": "中国统计年鉴 2025, 表 8-8 水资源情况 (2024)", "publisher": "国家统计局, from 水利部《中国水资源公报》",
                        "url": "https://www.stats.gov.cn/sj/ndsj/2025/html/C08-08.jpg", "unit": "亿立方米; 人均 立方米/人", "tier": "A", "retrieved": "2026-10-12"},
    "water_use": {"title": "中国统计年鉴 2025, 表 8-9 供水用水情况 (2024)", "publisher": "国家统计局, from 水利部《中国水资源公报》",
                  "url": "https://www.stats.gov.cn/sj/ndsj/2025/html/C08-09.jpg", "unit": "亿立方米; 人均 立方米/人", "tier": "A", "retrieved": "2026-10-12"},
    "tariff": {"title": "China's Industrial Power Rates 2025 (1–10 kV general industrial & commercial, non-TOU, as of May 2025)",
               "publisher": "China Briefing (Dezan Shira & Associates), compiled from provincial grid-company price tables",
               "url": "https://www.china-briefing.com/news/chinas-industrial-power-rates-category-electricity-usage-region-classification/",
               "unit": "元/千瓦时 (CNY per kWh)", "tier": "C", "retrieved": "2026-10-12",
               "note": "Secondary compilation. Jilin, Gansu, Tibet, Hong Kong and Macau are not listed; Inner Mongolia shows the eastern (State Grid) network only. Verify against each province's monthly 代理购电 price notice before citing."},
    "plants": {"title": "Global Energy Monitor plant trackers (coal, hydro, nuclear, solar, wind, bioenergy), China subset cleaned for the IGARSS workflow",
               "publisher": "Global Energy Monitor (CC BY 4.0)", "url": "https://globalenergymonitor.org/", "unit": "MW", "tier": "C", "retrieved": "2026-04-27",
               "note": "Operating units only (status was filtered upstream); a plant with several units appears once per unit at the same point. Gas, oil and waste plants were taken from OpenStreetMap in the IGARSS merge and are excluded here because their capacities are in kW."},
    "inventory": {"title": "Data-center inventory: DataCenterMap export (licensed), baxtel crawl (China subset), DCKB sample, UVA dhi geojsons",
                  "publisher": "various", "url": None, "unit": "facilities; MW where reported", "tier": "C",
                  "note": "Published at province level only. Coordinates, addresses and profile links are stripped by the build script and never written to site/data/."},
}


# ----------------------------------------------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edwc-root", default=str(ROOT.parent), help="EDWC project folder that holds the raw inputs")
    ap.add_argument("--check", action="store_true", help="after building, assert the privacy rules on the outputs")
    ap.add_argument("--publish-names", default="true", choices=["true", "false"],
                    help="write facility names/operators (false anonymises every record to its source and class)")
    args = ap.parse_args()
    edwc = Path(args.edwc_root).resolve()
    flags: list[str] = []

    prov, proj, fit, to_view = load_provinces(edwc / "01_working/data/preprocessed/china_province_map.geojson")
    missing = [pid for pid, *_ in PROVINCES if pid not in prov]
    if missing:
        sys.exit(f"provinces missing from the GeoJSON: {missing}")

    # ---- inventory --------------------------------------------------------------------------------------------
    records = []
    records += read_dcm(edwc / "01_working/data/clean/datacentermap 2.csv", flags)
    records += read_dhi(edwc / "dhi/data/hyperscale_datacenters.geojson", edwc / "dhi/data/western_datacenters.geojson")
    records += read_dckb(edwc / "archive/DCKB_cleaned_latlon_CHINA.xlsx")
    records += read_baxtel(edwc / "data/dc/data_center_data.csv")
    merged = merge_inventory(records, flags)

    lat = np.array([m["lat"] if m["lat"] is not None else np.nan for m in merged], dtype=float)
    lon = np.array([m["lon"] if m["lon"] is not None else np.nan for m in merged], dtype=float)
    x, y = proj(lon, lat)
    xy = to_view(np.column_stack([x, -y]))
    pids = assign_province(prov, xy[:, 0], xy[:, 1], snap_px=6.0)  # ~30 km at this scale
    facilities = []
    unplaced = 0
    for m, pid in zip(merged, pids):
        if pid is None and m.get("province_hint"):
            pid = m["province_hint"]
        if pid is None:
            unplaced += 1
            flags.append(f"inventory: {sorted(m['source_ids'])} falls outside every province outline (rounded {round(m['lat'])}, {round(m['lon'])}); dropped")
            continue
        fid = "dc_" + hashlib.sha1("|".join(sorted(m["source_ids"])).encode()).hexdigest()[:10]
        name = m["name"] if args.publish_names == "true" else None
        operator = m["operator"] if args.publish_names == "true" else None
        facilities.append({
            "id": fid,
            "name": name or f"Unnamed facility ({'/'.join(sorted(m['sources']))})",
            "operator": operator,
            "province": pid,
            "status": m["status"],
            "facilityType": FTYPE_MAP.get(m["ftype"], m["ftype"]) or "Unknown",
            "mw": m["mw"],
            "capacity": capacity_class(m["mw"]),
            "pue": m["pue"],
            "onlineYear": m["year"],
            "sources": sorted(m["sources"]),
        })
    facilities.sort(key=lambda f: (f["province"], f["name"]))

    # ---- power plants -----------------------------------------------------------------------------------------
    plants = []
    gem_dir = edwc / "01_working/data/clean/ENERGY_CHINA_CLEAN"
    for key, label in GEM_TECH.items():
        rows = read_csv_rows(gem_dir / f"china_gem_{key}.csv")
        plat = np.array([fnum(r["latitude"]) for r in rows], dtype=float)
        plon = np.array([fnum(r["longitude"]) for r in rows], dtype=float)
        pmw = np.array([fnum(r["capacity_mw"]) or 0.0 for r in rows], dtype=float)
        ok = ~np.isnan(plat) & ~np.isnan(plon)
        if (~ok).sum():
            flags.append(f"gem {key}: {(~ok).sum()} rows without coordinates dropped")
        px, py = proj(plon[ok], plat[ok])
        pxy = to_view(np.column_stack([px, -py]))
        ppid = assign_province(prov, pxy[:, 0], pxy[:, 1], snap_px=12.0)  # ~60 km: offshore wind, coastal rounding
        outside = sum(1 for p in ppid if p is None)
        if outside:
            flags.append(f"gem {key}: {outside} units are more than ~60 km outside every province outline; kept with province null")
        for (vx, vy), mw, pid in zip(pxy, pmw[ok], ppid):
            plants.append([label, round(float(mw), 1), round(float(vx), 1), round(float(vy), 1), pid])

    # ---- province summaries -----------------------------------------------------------------------------------
    indicators = load_indicators()
    inst = defaultdict(lambda: defaultdict(float))
    for label, mw, _x, _y, pid in plants:
        if pid:
            inst[pid][label] += mw
    provinces_out = []
    for pid, geo, en, zh, region, hub in PROVINCES:
        p = prov[pid]
        ind = dict(indicators.get(pid, {}))
        ind["installed_mw"] = {k: round(v, 1) for k, v in sorted(inst[pid].items())}
        ind["installed_mw_total"] = round(sum(inst[pid].values()), 1)
        provinces_out.append({"id": pid, "name": en, "nameZh": zh, "region": region, "hub": hub,
                              "path": p["path"], "cx": p["cx"], "cy": p["cy"], "indicators": ind})

    today = date.today().isoformat()
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    (SITE_DATA / "provinces.json").write_text(json.dumps({
        "generated": today, "viewBox": [0, 0, VIEW_W, VIEW_H], "projection": {k: (round(v, 6) if isinstance(v, float) else v) for k, v in fit.items()},
        "hubs": HUBS, "sources": SOURCE_NOTES, "provinces": provinces_out,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    (SITE_DATA / "facilities.json").write_text(json.dumps({
        "generated": today,
        "note": "Province-level inventory. Coordinates, addresses, cities and profile links are intentionally absent.",
        "sourceCounts": dict(Counter(s for f in facilities for s in f["sources"])),
        "facilities": facilities,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    (SITE_DATA / "power_plants.json").write_text(json.dumps({
        "generated": today, "fields": ["tech", "mw", "x", "y", "province"], "source": SOURCE_NOTES["plants"], "plants": plants,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"provinces: {len(provinces_out)}  facilities: {len(facilities)} (from {len(records)} source records, {len(merged)} after merge, {unplaced} unplaced)  plants: {len(plants)}")
    print("status:", dict(Counter(f['status'] for f in facilities)))
    print("capacity:", dict(Counter(f['capacity'] for f in facilities)))
    print("sources:", dict(Counter(s for f in facilities for s in f['sources'])))
    for fl in flags:
        print("  -", fl)

    if args.check:
        check_privacy()


FORBIDDEN_KEYS = {"lat", "lon", "latitude", "longitude", "address", "address_details", "postal", "city", "market",
                  "link_profile", "link_website", "coordinates", "geometry"}


def check_privacy():
    data = json.loads((SITE_DATA / "facilities.json").read_text(encoding="utf-8"))
    bad = []
    for f in data["facilities"]:
        for k in f:
            if k in FORBIDDEN_KEYS:
                bad.append((f["id"], k))
        for v in f.values():
            if isinstance(v, str) and ("datacentermap.com" in v or re.search(r"\d{1,3}\.\d{4,}", v)):
                bad.append((f["id"], v))
    if bad:
        sys.exit(f"privacy check FAILED: {bad[:5]}")
    print("privacy check passed: no coordinates, addresses, cities or links in facilities.json")


if __name__ == "__main__":
    main()

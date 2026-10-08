#!/usr/bin/env python3
"""Convert the hand-curated EDWC project spreadsheet into site/data/edwc_projects.json.

The sheet ("EWDC Projects") is a working document, not a database: section headers,
SUBTOTAL rows, summary tables and the odd orphan row sit between the project rows.
This script makes every assumption explicit and records anything it could not
interpret as a flag on the record instead of dropping or "fixing" it silently.

Usage:
    python scripts/convert_projects.py path/to/EDWC_11.11.xlsx [--out site/data/edwc_projects.json]
                                        [--compiled 2024-11-11] [--converted 2026-10-04]

Requires openpyxl (pip install -r requirements-dev.txt).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    print("openpyxl is required: pip install -r requirements-dev.txt", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent

# Section header (as typed in column A) -> (cluster id, site id). Section names are matched
# case-insensitively after trimming; anything not listed is reported and skipped.
SECTIONS: dict[str, tuple[str | None, str | None]] = {
    "guizhou": ("guian", None),
    "gansu qinyang": ("qingyang", None),
    "zhangjiakou, hebei": ("zhangjiakou", None),
    "inner mongolia": ("horinger", None),  # refined per row by city (see CITY_SITE)
    "zhongwei, ningxia": ("zhongwei", None),
    "shaoguan": ("shaoguan", None),
    "yangtze river delta project": ("csj_demo", None),
    "wuhu 芜湖": ("wuhu", None),
    "chengdu -chongqing": ("tianfu", None),  # refined per row by city
    "shanxi": (None, None),  # not an EDWC hub; the section is an empty stub
}

# Inner Mongolia: Ulanqab projects belong to the Jining site of the Horinger cluster.
CITY_SITE = {
    "乌兰察布": ("horinger", "horinger_jining"),
    "呼和浩特和林格尔": ("horinger", None),
}
# Chengdu–Chongqing: split by city.
CITY_CLUSTER = {
    "成都": "tianfu",
    "重庆": "chongqing",
}
# Cities in the Yangtze River Delta section that lie outside the demonstration-zone cluster's
# official start-up zone (青浦 / 吴江 / 嘉善). They stay attached to the cluster for context but are flagged.
CSJ_OUTSIDE_START_ZONE = {"无锡", "南京"}

# Company text -> normalised group. Matched by substring, first hit wins.
COMPANY_GROUPS: list[tuple[str, str]] = [
    ("电信", "china_telecom"),
    ("移动", "china_mobile"),
    ("联通", "china_unicom"),
    ("广电", "china_broadnet"),
    ("华为", "huawei"),
    ("阿里", "alibaba"),
    ("腾讯", "tencent"),
    ("GCBD", "gcbd_apple"),
    ("秦淮", "chindata"),
    ("世纪互联", "vnet"),
    ("优刻得", "ucloud"),
    ("金山云", "kingsoft"),
    ("银行", "bank_finance"),
    ("银保", "bank_finance"),
    ("农信", "bank_finance"),
    ("国家电投", "state_owned_other"),
    ("中国能建", "state_owned_other"),
    ("中交", "state_owned_other"),
    ("四川能投", "state_owned_other"),
]

COL = {
    "name_zh": 0,
    "name_en": 1,
    "city": 2,
    "sub_area": 3,
    "area_inv": 4,
    "specific": 5,
    "inv": 6,
    "compute": 7,
    "company": 8,
    "date": 9,
    "inv_sources": 10,
    "lat": 11,
    "lon": 12,
    "source": 13,
}

CJK = re.compile(r"[一-鿿]")
URL = re.compile(r"^https?://", re.I)


def cell(row: tuple, key: str) -> str:
    v = row[COL[key]]
    if v is None:
        return ""
    return str(v).strip()


def parse_number(text: str) -> float | None:
    """Accept plain numbers only. Prose such as '计划投资1377亿元/到2025年…' is NOT parsed (returned as None)."""
    if not text:
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def parse_date(text: str) -> str | None:
    if not text:
        return None
    t = text.strip().rstrip(".")
    for fmt in ("%B %d, %Y", "%Y-%m-%d", "%Y/%m/%d", "%Y年%m月%d日"):
        try:
            return datetime.strptime(t, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def company_group(company: str) -> str:
    if not company:
        return "unknown"
    for needle, group in COMPANY_GROUPS:
        if needle.lower() in company.lower():
            return group
    return "other"


def coord(row: tuple) -> tuple[list[float] | None, list[str]]:
    lat, lon = cell(row, "lat"), cell(row, "lon")
    if not lat and not lon:
        return None, []
    try:
        la, lo = float(lat), float(lon)
    except ValueError:
        return None, [f"unparseable coordinates lat={lat!r} lon={lon!r}"]
    problems = []
    # The sheet stores latitude in column L and longitude in M. A swapped pair would put a China latitude
    # (18–54) into the longitude slot (73–135): catch it instead of plotting in the Indian Ocean.
    if not (73.0 <= lo <= 135.5) or not (3.0 <= la <= 54.0):
        if 73.0 <= la <= 135.5 and 3.0 <= lo <= 54.0:
            problems.append(f"lat/lon appear swapped ({la}, {lo}); swapped back")
            la, lo = lo, la
        else:
            return None, [f"coordinates out of China range lat={la} lon={lo}; dropped"]
    return [round(lo, 6), round(la, 6)], problems


def is_section_header(vals: list[str]) -> bool:
    """A header is a lone value in column A that is either a known section name or a Latin-only label
    (the sheet writes headers in English, sometimes with the Chinese name appended, e.g. 'Wuhu 芜湖')."""
    if not vals[0] or any(vals[1:]) or vals[0].upper().startswith("SUBTOTAL"):
        return False
    return vals[0].lower() in SECTIONS or not CJK.search(vals[0])


def convert(xlsx: Path, compiled: str, converted: str) -> tuple[dict, list[str]]:
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb["EWDC Projects"]
    log: list[str] = []
    projects: list[dict] = []
    section: str | None = None
    counters: Counter[str] = Counter()
    seen_names: Counter[str] = Counter()

    for row_no, row in enumerate(ws.iter_rows(values_only=True), start=1):
        vals = [("" if c is None else str(c).strip()) for c in row[:14]]
        if not any(vals) or vals[0] == "Project_CN":
            continue  # blank line or the header row
        if is_section_header(vals):
            key = vals[0].lower()
            if key not in SECTIONS:
                log.append(f"row {row_no}: unknown section header {vals[0]!r}; following rows skipped until the next known header")
                section = "__unknown__"
            else:
                section = key
            continue
        if vals[0].upper().startswith("SUBTOTAL") or vals[0].upper().startswith("TOTAL"):
            continue
        if section is None or section == "__unknown__" or SECTIONS.get(section, (None, None))[0] is None:
            # summary tables at the bottom, the Shanxi stub, rows before the first header
            if CJK.search(vals[0]) or vals[1]:
                log.append(f"row {row_no}: project-looking row outside a mapped section, skipped: {vals[0] or vals[1]!r}")
            continue

        name_zh, name_en = vals[COL["name_zh"]], vals[COL["name_en"]]
        if not name_zh and not name_en:
            # orphan rows (e.g. a bare investment figure or URL on its own line)
            log.append(f"row {row_no}: no project name (values: inv={vals[COL['inv']]!r} company={vals[COL['company']]!r} url={vals[COL['source']][:40]!r}); skipped")
            continue

        cluster_id, site_id = SECTIONS[section]
        city = vals[COL["city"]]
        if section == "inner mongolia":
            if city in CITY_SITE:
                cluster_id, site_id = CITY_SITE[city]
            else:
                log.append(f"row {row_no}: Inner Mongolia row with unmapped city {city!r}; attached to the Horinger primary site")
        if section == "chengdu -chongqing":
            if city in CITY_CLUSTER:
                cluster_id = CITY_CLUSTER[city]
            elif not city:
                cluster_id = "tianfu"
                log.append(f"row {row_no}: Chengdu–Chongqing row without a city ({name_zh!r}); attached to Tianfu (source URL is cdht.gov.cn)")
            else:
                log.append(f"row {row_no}: Chengdu–Chongqing row with unmapped city {city!r}; attached to Tianfu")

        flags: list[str] = []
        notes: list[str] = []
        if not name_zh:
            flags.append("no_name_zh")
        # A leading '.' and a trailing '该' are typing slips in the sheet; keep the text but flag the second.
        if name_zh.startswith("."):
            name_zh = name_zh.lstrip(".")
        if name_zh.endswith("该") or name_zh.endswith("项"):
            flags.append("truncated_name")
        # Some cells hold the name pasted twice back-to-back ("ABCABC"); keep the single copy and say so.
        half = len(name_zh) // 2
        if name_zh and len(name_zh) % 2 == 0 and name_zh[:half] == name_zh[half:]:
            notes.append(f"Sheet cell repeats the name twice ({name_zh!r}); de-duplicated.")
            name_zh = name_zh[:half]
            flags.append("repeated_name_text")

        inv_text = vals[COL["inv"]]
        inv = parse_number(inv_text)
        area_text = vals[COL["area_inv"]]
        area_inv = parse_number(area_text)
        record_type = "project"
        if area_text and not inv_text:
            # A row carrying only an area-level figure describes a park/cluster, not a single facility.
            record_type = "park"
        if (inv_text and inv is None) or (area_text and area_inv is None):
            flags.append("unparsed_investment")

        source_url = vals[COL["source"]]
        if source_url and not URL.match(source_url):
            log.append(f"row {row_no}: source is not an http(s) URL, kept as note: {source_url[:60]!r}")
            notes.append(f"Source as typed: {source_url}")
            source_url = ""
        if not source_url:
            flags.append("no_source")

        company = vals[COL["company"]]
        group = company_group(company)
        # The sheet names the operator in the project title; when the company column disagrees, say so.
        title_group = company_group(name_zh[:12]) if name_zh else "unknown"
        if company and title_group not in ("unknown", "other") and title_group != group:
            flags.append("company_mismatch")
            notes.append(f"Project title suggests {title_group} but the company column says {company!r}.")

        coords, coord_problems = coord(row)
        for p in coord_problems:
            log.append(f"row {row_no}: {p}")
        precision = None
        if coords:
            precision = "point"

        if section == "yangtze river delta project" and city in CSJ_OUTSIDE_START_ZONE:
            flags.append("outside_start_zone")
            notes.append("Located outside the demonstration-zone cluster's official start-up zone (青浦/吴江/嘉善); kept for hub context.")

        date_text = vals[COL["date"]]
        date_opened = parse_date(date_text)
        if date_text and not date_opened:
            log.append(f"row {row_no}: date not parsed: {date_text!r}")

        display = name_zh or name_en
        seen_names[display] += 1

        counters[cluster_id] += 1
        pid = f"{cluster_id}_p{counters[cluster_id]:02d}"
        projects.append(
            {
                "id": pid,
                "cluster_id": cluster_id,
                "site_id": site_id,
                "record_type": record_type,
                "name_zh": name_zh or None,
                "name_en": name_en or None,
                "city_zh": city or None,
                "sub_area_zh": vals[COL["sub_area"]] or None,
                "company": company or None,
                "company_group": group,
                "investment_planned_100m_cny": inv,
                "investment_text": (inv_text if inv is None and inv_text else None) or (area_text if area_inv is None and area_text else None),
                "area_investment_100m_cny": area_inv,
                "date_opened": date_opened,
                "date_text": date_text or None,
                "investment_sources_text": vals[COL["inv_sources"]] or None,
                "coordinates": coords,
                "location_precision": precision,
                "source_url": source_url or None,
                "flags": flags,
                "verified": False,
                "placeholder": False,
                "note": " ".join(notes) or None,
                "sheet_row": row_no,
            }
        )

    # Shared centroids: several rows in one cluster with the identical coordinate pair cannot all be exact sites.
    coord_count = Counter(tuple(p["coordinates"]) for p in projects if p["coordinates"])
    for p in projects:
        if p["coordinates"] and coord_count[tuple(p["coordinates"])] >= 3:
            p["flags"].append("shared_centroid")
            p["location_precision"] = "city"
            p["note"] = ((p["note"] + " ") if p["note"] else "") + "Coordinates are a shared centroid used for several projects, not the facility position."
        elif p["coordinates"] and coord_count[tuple(p["coordinates"])] == 2:
            p["location_precision"] = "area"
    for p in projects:
        if seen_names[p["name_zh"] or p["name_en"]] > 1:
            p["flags"].append("duplicate_name_suspected")

    doc = {
        "source": {
            "title": "EDWC project inventory (author's compilation), sheet 'EWDC Projects'",
            "file": xlsx.name,
            "sheet": "EWDC Projects",
            "compiled": compiled,
            "converted": converted,
            "licence_note": "Author's own compilation from public announcements. Licence to be confirmed before publication.",
        },
        "projects": projects,
    }
    return doc, log


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx", type=Path)
    ap.add_argument("--out", type=Path, default=ROOT / "site" / "data" / "edwc_projects.json")
    ap.add_argument("--compiled", default=None, help="date of the spreadsheet version (default: file mtime)")
    ap.add_argument("--converted", default=date.today().isoformat())
    args = ap.parse_args(argv)

    compiled = args.compiled or date.fromtimestamp(args.xlsx.stat().st_mtime).isoformat()
    doc, log = convert(args.xlsx, compiled, args.converted)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    projects = [p for p in doc["projects"] if p["record_type"] == "project"]
    parks = [p for p in doc["projects"] if p["record_type"] == "park"]
    with_inv = [p for p in projects if p["investment_planned_100m_cny"] is not None]
    print(f"wrote {args.out} — {len(projects)} projects + {len(parks)} park rows")
    print(f"  with planned investment: {len(with_inv)} (sum {sum(p['investment_planned_100m_cny'] for p in with_inv):.2f} 亿元)")
    print(f"  with coordinates: {sum(1 for p in projects if p['coordinates'])}; with source URL: {sum(1 for p in projects if p['source_url'])}")
    print("  by cluster:", dict(Counter(p["cluster_id"] for p in projects)))
    print("  flags:", dict(Counter(f for p in doc["projects"] for f in p["flags"])))
    for line in log:
        print("  LOG", line)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Validate the dashboard data files.

Two layers:
  1. JSON Schema validation (shape, types, enums).
  2. Cross-file / semantic checks that a schema cannot express (referential
     integrity, direction vs. sign of change, coordinate order and range, date
     ordering, placeholder flags vs. dataset status).

Usage:
    python scripts/validate_data.py            # validate site/data against schemas/
    python scripts/validate_data.py --strict   # warnings also fail the run

Exit code: 0 = ok, 1 = errors (or warnings with --strict), 2 = could not run.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover - environment problem, not a data problem
    print("jsonschema is required: pip install -r requirements-dev.txt", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent

# (data file, schema file)
FILES = {
    "meta": ("meta.json", "meta.schema.json"),
    "targets": ("plan_targets.json", "plan_targets.schema.json"),
    "actuals": ("plan_actuals.json", "plan_actuals.schema.json"),
    "legislation": ("legislation.json", "legislation.schema.json"),
    "hubs": ("edwc_hubs.geojson", "edwc_hubs.schema.json"),
    "projects": ("edwc_projects.json", "edwc_projects.schema.json"),
}
# Files that may legitimately be absent (the project inventory is kept out of the public repo until its
# licence is confirmed). When present they are validated like every other file.
OPTIONAL = {"projects"}

# Rough bounding box that contains mainland China and its territorial extent.
# Used only to catch swapped lat/lon or sign errors, not to assert geography.
LON_RANGE = (73.0, 135.5)
LAT_RANGE = (3.0, 54.0)

EPS = 1e-9


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.notes: list[str] = []  # informational only; never fails the run, even with --strict

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append(f"{where}: {msg}")

    def note(self, where: str, msg: str) -> None:
        self.notes.append(f"{where}: {msg}")


def _load(path: Path, report: Report) -> Any | None:
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        report.error(path.name, "file not found")
    except json.JSONDecodeError as exc:
        report.error(path.name, f"invalid JSON at line {exc.lineno} col {exc.colno}: {exc.msg}")
    return None


def _schema_errors(data: Any, schema_path: Path, label: str, report: Report) -> bool:
    with schema_path.open(encoding="utf-8") as fh:
        schema = json.load(fh)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    ok = True
    for err in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in err.absolute_path) or "(root)"
        report.error(f"{label}:{where}", err.message)
        ok = False
    return ok


def _parse_iso(value: str | None) -> date | None:
    """Parse YYYY-MM-DD strictly. Returns None when absent or impossible (e.g. 2021-02-30)."""
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _dupes(values: list[str]) -> list[str]:
    return [k for k, n in Counter(values).items() if n > 1]


def check_targets(targets_doc: dict, actuals_doc: dict, meta: dict, report: Report) -> None:
    plans = {p["id"]: p for p in targets_doc["plans"]}
    for dup in _dupes([p["id"] for p in targets_doc["plans"]]):
        report.error("plans", f"duplicate plan id '{dup}'")
    for p in targets_doc["plans"]:
        if p["period"]["end"] <= p["period"]["start"]:
            report.error(f"plans/{p['id']}", "period.end must be after period.start")

    targets = {t["id"]: t for t in targets_doc["targets"]}
    for dup in _dupes([t["id"] for t in targets_doc["targets"]]):
        report.error("targets", f"duplicate target id '{dup}'")

    as_of = _parse_iso(meta.get("as_of"))

    for t in targets_doc["targets"]:
        where = f"targets/{t['id']}"
        if t["plan_id"] not in plans:
            report.error(where, f"unknown plan_id '{t['plan_id']}'")
        kind = t["kind"]
        base = t.get("baseline")
        tgt = t["target"]

        if kind == "level":
            if tgt["year"] <= base["year"]:
                report.error(where, "target.year must be after baseline.year")
            if abs(tgt["value"] - base["value"]) < EPS:
                report.error(where, "target equals baseline: progress is undefined (use kind 'threshold')")
            else:
                moves_up = tgt["value"] > base["value"]
                if moves_up != (t["direction"] == "increase"):
                    report.error(
                        where,
                        f"direction '{t['direction']}' contradicts baseline {base['value']} -> target {tgt['value']}. "
                        "If the goal is to stay above/below a value already reached, use kind 'threshold'.",
                    )
        elif kind == "rate":
            period = t["period"]
            if period["end"] <= period["start"]:
                report.error(where, "period.end must be after period.start")
            if tgt["year"] != period["end"]:
                report.error(where, "for kind 'rate', target.year must equal period.end")
            if base is not None:
                report.warn(where, "baseline is ignored for kind 'rate'")
        elif kind == "threshold":
            if base is not None:
                report.warn(where, "baseline is ignored for kind 'threshold'")

        plan = plans.get(t["plan_id"])
        if plan and not (plan["period"]["start"] - 5 <= tgt["year"] <= plan["period"]["end"] + 5):
            report.warn(where, f"target.year {tgt['year']} is far outside plan period {plan['period']}")
        if plan and kind == "level" and base["year"] > plan["period"]["start"]:
            report.warn(where, f"baseline.year {base['year']} is after the plan period starts ({plan['period']['start']})")
        if kind == "level" and base["year"] < 1949:
            report.error(where, "baseline.year is not plausible")

    seen: set[tuple[str, int]] = set()
    for i, a in enumerate(actuals_doc["actuals"]):
        where = f"actuals[{i}]"
        t = targets.get(a["target_id"])
        if t is None:
            report.error(where, f"unknown target_id '{a['target_id']}'")
            continue
        key = (a["target_id"], a["year"])
        if key in seen:
            report.error(where, f"duplicate actual for {a['target_id']} in {a['year']}")
        seen.add(key)
        if as_of and a["year"] > as_of.year:
            report.error(where, f"year {a['year']} is after the dataset as_of date {meta['as_of']}")
        if t["kind"] == "level" and a["year"] < t["baseline"]["year"]:
            report.warn(where, f"year {a['year']} precedes baseline year {t['baseline']['year']}; it will be ignored")
        if t["kind"] == "rate" and not (t["period"]["start"] <= a["year"] <= t["period"]["end"]):
            report.warn(where, f"year {a['year']} is outside period {t['period']}; it will be ignored")
        if t["placeholder"] != a["placeholder"]:
            report.warn(where, "placeholder flag differs from its target's flag")
        as_of_str = a.get("as_of")
        if as_of_str is not None:
            a_as_of = _parse_iso(as_of_str)
            if a_as_of is None:
                report.error(where, f"as_of '{as_of_str}' is not a real calendar date")
            else:
                if a_as_of.year != a["year"]:
                    report.error(where, f"as_of {as_of_str} is not in the record's year {a['year']}")
                if as_of and a_as_of > as_of:
                    report.error(where, f"as_of {as_of_str} is after the dataset as_of date {meta['as_of']}")
                # A mid-year value in the target year can never settle the verdict; say so where it matters.
                if (a_as_of.month, a_as_of.day) != (12, 31) and t["kind"] != "rate" and a["year"] == t["target"]["year"]:
                    report.note(where, f"{a['target_id']}: partial-year value (as of {as_of_str}) in the target year {a['year']}; the target reads 'unresolved' until a year-end figure is added")
        conf = (a.get("source") or {}).get("confidence")
        if conf == "low" and not a["placeholder"]:
            report.warn(where, "source.confidence is 'low'; consider placeholder=true or a better source")


def check_legislation(doc: dict, plan_ids: set[str], report: Report) -> None:
    docs = doc["documents"]
    ids = {d["id"] for d in docs}
    for dup in _dupes([d["id"] for d in docs]):
        report.error("legislation", f"duplicate document id '{dup}'")

    for d in docs:
        where = f"legislation/{d['id']}"
        adopted = _parse_iso(d["date_adopted"])
        if adopted is None:
            report.error(where, f"date_adopted '{d['date_adopted']}' is not a real calendar date")
        effective = _parse_iso(d.get("date_effective"))
        if d.get("date_effective") is not None and effective is None:
            report.error(where, f"date_effective '{d['date_effective']}' is not a real calendar date")
        if adopted and effective and effective < adopted:
            report.error(where, "date_effective is before date_adopted")
        if d["date_precision"] == "month" and adopted and adopted.day != 1:
            report.warn(where, "date_precision is 'month' but the day is not 01")
        if d["date_precision"] == "year" and adopted and (adopted.month, adopted.day) != (1, 1):
            report.warn(where, "date_precision is 'year' but the date is not 01-01")
        for pid in d["related_plan_ids"]:
            if pid not in plan_ids:
                report.error(where, f"unknown related plan id '{pid}'")
        sup = d.get("superseded_by")
        if sup is not None and sup not in ids:
            report.error(where, f"superseded_by '{sup}' does not exist")
        if d["status"] == "superseded" and not sup:
            report.warn(where, "status is 'superseded' but superseded_by is empty")
        if d["status"] != "superseded" and sup:
            report.warn(where, f"superseded_by is set but status is '{d['status']}'")
        if d["verified"] and d["source"]["url"] is None:
            report.error(where, "verified=true requires a source.url")


def _parse_ym(value: str | None) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(f"{value}-01")
    except ValueError:
        return None


def check_hubs(doc: dict, meta: dict, report: Report) -> None:
    feats = doc["features"]
    as_of = _parse_iso(meta.get("as_of"))
    for dup in _dupes([f["properties"]["id"] for f in feats]):
        report.error("hubs", f"duplicate hub id '{dup}'")
    by_id = {f["properties"]["id"]: f["properties"] for f in feats}
    for f in feats:
        props = f["properties"]
        where = f"hubs/{props['id']}"
        parent = props.get("part_of")
        if parent is not None:
            if parent == props["id"]:
                report.error(where, "part_of points at itself")
            elif parent not in by_id:
                report.error(where, f"part_of '{parent}' does not exist")
            elif by_id[parent].get("part_of"):
                report.error(where, f"part_of '{parent}' is itself a secondary site; point at the primary feature")
            else:
                for key in ("hub", "region", "province", "status"):
                    if props.get(key) != by_id[parent].get(key):
                        report.warn(where, f"{key} differs from its primary feature '{parent}'")
                if props.get("racks_k") is not None and by_id[parent].get("racks_k") is not None:
                    report.warn(where, "both the primary feature and this site carry racks_k; cluster totals would double-count")
        for key in ("designated", "racks_as_of", "compute_as_of"):
            val = props.get(key)
            if val is None:
                continue
            d = _parse_ym(val)
            if d is None:
                report.error(where, f"{key} '{val}' is not a real year-month")
            elif as_of and d > as_of:
                report.error(where, f"{key} {val} is after the dataset as_of date {meta['as_of']}")
        if props.get("racks_k") is not None and props.get("racks_as_of") is None:
            report.warn(where, "racks_k is set but racks_as_of is missing (readers cannot tell how old the figure is)")
        if props.get("compute_eflops") is not None and props.get("compute_as_of") is None:
            report.warn(where, "compute_eflops is set but compute_as_of is missing")
        if (props.get("racks_k") is not None or props.get("compute_eflops") is not None) and not props.get("metrics_source"):
            report.warn(where, "metrics are set but metrics_source is missing")
        if props["verified"] and not props.get("approval_url"):
            report.warn(where, "verified=true but no approval_url to check against")
        lon, lat = f["geometry"]["coordinates"]
        if not (LON_RANGE[0] <= lon <= LON_RANGE[1]) or not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            hint = ""
            if (LON_RANGE[0] <= lat <= LON_RANGE[1]) and (LAT_RANGE[0] <= lon <= LAT_RANGE[1]):
                hint = " (looks like latitude/longitude are swapped; GeoJSON order is [lon, lat])"
            report.error(where, f"coordinates [{lon}, {lat}] fall outside the expected China bounding box{hint}")


def check_projects(doc: dict, hubs: dict, meta: dict, report: Report) -> None:
    """Project inventory: every project must hang off a real cluster feature, coordinates must be [lon, lat] inside
    China, and the data-quality flags must agree with the fields they describe (a flag that lies is worse than none)."""
    feats = {f["properties"]["id"]: f["properties"] for f in hubs["features"]}
    projects = doc["projects"]
    for dup in _dupes([p["id"] for p in projects]):
        report.error("projects", f"duplicate project id '{dup}'")
    as_of = _parse_iso(meta.get("as_of"))
    compiled = _parse_iso(doc["source"].get("compiled"))
    converted = _parse_iso(doc["source"].get("converted"))
    if compiled is None:
        report.error("projects/source", "compiled is not a real calendar date")
    if converted and compiled and converted < compiled:
        report.error("projects/source", "converted date is before the compiled date")
    if as_of and compiled and compiled > as_of:
        report.error("projects/source", f"compiled {doc['source']['compiled']} is after the dataset as_of date {meta['as_of']}")

    coord_count = Counter(tuple(p["coordinates"]) for p in projects if p.get("coordinates"))
    for p in projects:
        where = f"projects/{p['id']}"
        cluster = feats.get(p["cluster_id"])
        if cluster is None:
            report.error(where, f"cluster_id '{p['cluster_id']}' is not a feature in edwc_hubs.geojson")
        elif cluster.get("part_of"):
            report.error(where, f"cluster_id '{p['cluster_id']}' is a secondary site; use the primary cluster id and set site_id")
        site = p.get("site_id")
        if site is not None:
            sp = feats.get(site)
            if sp is None:
                report.error(where, f"site_id '{site}' is not a feature in edwc_hubs.geojson")
            elif sp.get("part_of") != p["cluster_id"]:
                report.error(where, f"site_id '{site}' is not part_of cluster '{p['cluster_id']}'")
        if not p.get("name_zh") and not p.get("name_en"):
            report.error(where, "project has neither name_zh nor name_en")
        if not p.get("name_zh") and "no_name_zh" not in p["flags"]:
            report.warn(where, "name_zh is empty but the no_name_zh flag is missing")
        if p.get("source_url") is None and "no_source" not in p["flags"]:
            report.warn(where, "source_url is null but the no_source flag is missing")
        if p.get("source_url") is not None and "no_source" in p["flags"]:
            report.warn(where, "no_source flag set although source_url is present")
        if p["record_type"] == "park" and p.get("investment_planned_100m_cny") is not None:
            report.warn(where, "park rows should carry area_investment_100m_cny, not a project investment figure")
        if p.get("investment_text") and p.get("investment_planned_100m_cny") is not None and p.get("area_investment_100m_cny") is None:
            report.warn(where, "investment_text is set although the investment was parsed")
        coords = p.get("coordinates")
        if coords is None:
            if p.get("location_precision") is not None:
                report.error(where, "location_precision is set but there are no coordinates")
            continue
        if p.get("location_precision") is None:
            report.error(where, "coordinates are set but location_precision is null")
        lon, lat = coords
        if not (LON_RANGE[0] <= lon <= LON_RANGE[1]) or not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            hint = " (looks like latitude/longitude are swapped; order is [lon, lat])" if (LON_RANGE[0] <= lat <= LON_RANGE[1] and LAT_RANGE[0] <= lon <= LAT_RANGE[1]) else ""
            report.error(where, f"coordinates [{lon}, {lat}] fall outside the expected China bounding box{hint}")
        shared = coord_count[tuple(coords)] >= 3
        if shared and "shared_centroid" not in p["flags"]:
            report.warn(where, f"coordinate pair is shared by {coord_count[tuple(coords)]} projects but the shared_centroid flag is missing")
        if shared and p.get("location_precision") == "point":
            report.warn(where, "shared coordinate pair cannot be an exact 'point' position")
        # a project should sit in the same part of the country as its cluster (catches a row filed under the wrong section)
        if cluster is not None:
            clon, clat = next(f["geometry"]["coordinates"] for f in hubs["features"] if f["properties"]["id"] == (site or p["cluster_id"]))
            if abs(clon - lon) > 4 or abs(clat - lat) > 4:
                report.warn(where, f"project is {abs(clon - lon):.1f}° lon / {abs(clat - lat):.1f}° lat away from its cluster point; check the section it was filed under")


def check_placeholders(meta: dict, docs: dict[str, list[dict]], report: Report) -> None:
    """A dataset marked 'live' must not contain placeholder or unverified records."""
    if meta.get("data_status") != "live":
        return
    for label, records in docs.items():
        for r in records:
            rid = r.get("id") or r.get("target_id") or "?"
            if r.get("placeholder"):
                report.error(f"{label}/{rid}", "placeholder record present while meta.data_status is 'live'")
            if r.get("verified") is False:
                report.error(f"{label}/{rid}", "unverified record present while meta.data_status is 'live'")


def validate_all(data_dir: Path, schema_dir: Path) -> Report:
    report = Report()
    loaded: dict[str, Any] = {}
    shape_ok = True
    for key, (data_name, schema_name) in FILES.items():
        if key in OPTIONAL and not (data_dir / data_name).exists():
            report.note(data_name, "optional file not present; skipped")
            continue
        data = _load(data_dir / data_name, report)
        if data is None:
            shape_ok = False
            continue
        if not _schema_errors(data, schema_dir / schema_name, data_name, report):
            shape_ok = False
        loaded[key] = data

    # Semantic checks only make sense on structurally valid data.
    if not shape_ok:
        return report

    plan_ids = {p["id"] for p in loaded["targets"]["plans"]}
    check_targets(loaded["targets"], loaded["actuals"], loaded["meta"], report)
    check_legislation(loaded["legislation"], plan_ids, report)
    check_hubs(loaded["hubs"], loaded["meta"], report)
    if "projects" in loaded:
        check_projects(loaded["projects"], loaded["hubs"], loaded["meta"], report)
    check_placeholders(
        loaded["meta"],
        {
            "targets": loaded["targets"]["targets"],
            "actuals": loaded["actuals"]["actuals"],
            "legislation": loaded["legislation"]["documents"],
            "hubs": [f["properties"] for f in loaded["hubs"]["features"]],
            "projects": loaded["projects"]["projects"] if "projects" in loaded else [],
        },
        report,
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "site" / "data")
    parser.add_argument("--schema-dir", type=Path, default=ROOT / "schemas")
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = parser.parse_args(argv)

    report = validate_all(args.data_dir, args.schema_dir)

    for n in report.notes:
        print(f"NOTE  {n}")
    for w in report.warnings:
        print(f"WARN  {w}")
    for e in report.errors:
        print(f"ERROR {e}")

    print(f"\n{len(report.errors)} error(s), {len(report.warnings)} warning(s), {len(report.notes)} note(s)")
    if report.errors or (args.strict and report.warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
import re
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
    "provinces": ("provinces.json", "provinces.schema.json"),
    "facilities": ("facilities.json", "facilities.schema.json"),
    "plants": ("power_plants.json", "power_plants.schema.json"),
}
OPTIONAL: set[str] = set()

# Keys that must never appear on a published facility record: the inventory is province-level by design.
FORBIDDEN_FACILITY_KEYS = {"lat", "lon", "latitude", "longitude", "coordinates", "geometry", "address", "address_details",
                           "postal", "city", "market", "link_profile", "link_website", "x", "y"}
# Capacity classes as (label, lower bound inclusive, upper bound exclusive); must match the build script.
CAPACITY_CLASSES = [
    ("Mega campus (1,000+ MW)", 1000, float("inf")), ("Hyperscale (100–999 MW)", 100, 1000), ("Large (51–99 MW)", 51, 100),
    ("Medium (11–50 MW)", 11, 51), ("Small (0–10 MW)", 0, 11),
]

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



def _capacity_class(mw: float | None) -> str:
    if mw is None:
        return "Unknown"
    for label, lo, hi in CAPACITY_CLASSES:
        if lo <= mw < hi:
            return label
    return "Unknown"


def check_provinces(doc: dict, report: Report) -> None:
    provs = doc["provinces"]
    for dup in _dupes([p["id"] for p in provs]):
        report.error("provinces", f"duplicate province id '{dup}'")
    if len(provs) < 31:
        report.error("provinces", f"expected at least the 31 mainland provinces, found {len(provs)}")
    x0, y0, w, h = doc["viewBox"]
    for p in provs:
        where = f"provinces/{p['id']}"
        if p["hub"] is not None and p["hub"] not in doc["hubs"]:
            report.error(where, f"hub '{p['hub']}' is not defined in hubs")
        if not (x0 <= p["cx"] <= x0 + w and y0 <= p["cy"] <= y0 + h):
            report.error(where, f"anchor ({p['cx']}, {p['cy']}) falls outside the view box")
        ind = p["indicators"]
        gen, con = ind.get("generation_2024"), ind.get("consumption_2024")
        if gen is not None and con is not None and ind.get("generation_balance_2024") is not None:
            if abs(ind["generation_balance_2024"] - (gen - con)) > 0.05:
                report.error(where, "generation_balance_2024 does not equal generation minus consumption")
        tot, use = ind.get("water_total_2024"), ind.get("water_use_total_2024")
        if tot and use is not None and ind.get("water_stress_ratio_2024") is not None:
            if abs(ind["water_stress_ratio_2024"] - use / tot) > 0.002:
                report.error(where, "water_stress_ratio_2024 does not equal use divided by resources")
        if abs(sum(ind["installed_mw"].values()) - ind["installed_mw_total"]) > 0.5:
            report.error(where, "installed_mw_total does not equal the sum of installed_mw by technology")
    for key, src in doc["sources"].items():
        if src["tier"] == "A" and not src.get("url"):
            report.warn(f"sources/{key}", "tier A source without a URL")


def check_facilities(doc: dict, provinces: dict, report: Report) -> None:
    """Province-level inventory: ids unique, province ids real, no location detail, class consistent with MW."""
    ids = {p["id"] for p in provinces["provinces"]}
    facs = doc["facilities"]
    for dup in _dupes([f["id"] for f in facs]):
        report.error("facilities", f"duplicate facility id '{dup}'")
    counts: Counter[str] = Counter()
    for f in facs:
        where = f"facilities/{f['id']}"
        leaked = FORBIDDEN_FACILITY_KEYS & set(f)
        if leaked:
            report.error(where, f"location detail must not be published: {sorted(leaked)}")
        for v in f.values():
            if isinstance(v, str) and ("datacentermap.com" in v or re.search(r"\d{1,3}\.\d{4,}", v)):
                report.error(where, "a string field looks like a link or a coordinate")
        if f["province"] not in ids:
            report.error(where, f"province '{f['province']}' is not in provinces.json")
        if f["capacity"] != _capacity_class(f["mw"]):
            report.error(where, f"capacity class '{f['capacity']}' does not match mw={f['mw']}")
        for s in f["sources"]:
            counts[s] += 1
    for s, n in counts.items():
        if doc["sourceCounts"].get(s) != n:
            report.error("facilities/sourceCounts", f"sourceCounts[{s}]={doc['sourceCounts'].get(s)} but {n} records cite it")


def check_plants(doc: dict, provinces: dict, report: Report) -> None:
    ids = {p["id"] for p in provinces["provinces"]}
    x0, y0, w, h = provinces["viewBox"]
    outside = 0
    unknown_prov = Counter()
    for row in doc["plants"]:
        _tech, _mw, x, y, pid = row
        if not (x0 - 20 <= x <= x0 + w + 20 and y0 - 20 <= y <= y0 + h + 20):
            outside += 1
        if pid is not None and pid not in ids:
            unknown_prov[pid] += 1
    if outside:
        report.error("plants", f"{outside} units are projected outside the view box")
    for pid, n in unknown_prov.items():
        report.error("plants", f"{n} units reference unknown province '{pid}'")


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
    check_provinces(loaded["provinces"], report)
    check_facilities(loaded["facilities"], loaded["provinces"], report)
    check_plants(loaded["plants"], loaded["provinces"], report)
    check_placeholders(
        loaded["meta"],
        {
            "targets": loaded["targets"]["targets"],
            "actuals": loaded["actuals"]["actuals"],
            "legislation": loaded["legislation"]["documents"],
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

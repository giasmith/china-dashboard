"""Tests for scripts/validate_data.py - each test breaks the sample data one way
and asserts the validator notices. Run: python -m unittest discover -s tests/py -v
"""

from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("validate_data", ROOT / "scripts" / "validate_data.py")
vd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vd)  # type: ignore[union-attr]


class ValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.data = self.tmp / "data"
        shutil.copytree(ROOT / "site" / "data", self.data)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- helpers -----------------------------------------------------------
    def _edit(self, name: str, fn) -> None:
        path = self.data / name
        doc = json.loads(path.read_text(encoding="utf-8"))
        fn(doc)
        path.write_text(json.dumps(doc), encoding="utf-8")

    def _run(self) -> vd.Report:
        return vd.validate_all(self.data, ROOT / "schemas")

    def assertHasError(self, report: vd.Report, needle: str) -> None:
        self.assertTrue(
            any(needle in e for e in report.errors),
            f"expected an error containing {needle!r}; got {report.errors}",
        )

    # -- tests -------------------------------------------------------------
    def test_sample_data_is_clean(self) -> None:
        report = self._run()
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])

    def test_malformed_json_reports_line_and_column(self) -> None:
        (self.data / "legislation.json").write_text('{"documents": [,]}', encoding="utf-8")
        self.assertHasError(self._run(), "invalid JSON at line")

    def test_missing_file(self) -> None:
        (self.data / "plan_actuals.json").unlink()
        self.assertHasError(self._run(), "file not found")

    def test_actual_references_unknown_target(self) -> None:
        self._edit("plan_actuals.json", lambda d: d["actuals"][0].update(target_id="typo_id"))
        self.assertHasError(self._run(), "unknown target_id 'typo_id'")

    def test_duplicate_actual_for_same_year(self) -> None:
        self._edit("plan_actuals.json", lambda d: d["actuals"].append(copy.deepcopy(d["actuals"][0])))
        self.assertHasError(self._run(), "duplicate actual")

    def test_actual_in_the_future(self) -> None:
        self._edit("plan_actuals.json", lambda d: d["actuals"][0].update(year=2099))
        self.assertHasError(self._run(), "after the dataset as_of date")

    def test_direction_contradicts_baseline_to_target(self) -> None:
        def f(d):
            t = next(t for t in d["targets"] if t["id"] == "fyp14_urbanization")
            t["direction"] = "decrease"

        self._edit("plan_targets.json", f)
        self.assertHasError(self._run(), "contradicts baseline")

    def test_floor_target_already_met_must_use_threshold_not_level(self) -> None:
        """Regression for a real logic trap: 'at least 650' with a 2020 baseline of 669 looks like a
        *decrease* if modelled as kind=level, which would score every good year as 'behind'."""

        def f(d):
            t = next(t for t in d["targets"] if t["id"] == "fyp14_grain_capacity")
            t["kind"] = "level"
            t["baseline"] = {"year": 2020, "value": 6.7}  # already above the 6.5 floor

        self._edit("plan_targets.json", f)
        self.assertHasError(self._run(), "use kind 'threshold'")

    def test_target_equals_baseline(self) -> None:
        def f(d):
            t = next(t for t in d["targets"] if t["id"] == "fyp14_urbanization")
            t["target"]["value"] = t["baseline"]["value"]

        self._edit("plan_targets.json", f)
        self.assertHasError(self._run(), "progress is undefined")

    def test_target_year_not_after_baseline(self) -> None:
        def f(d):
            t = next(t for t in d["targets"] if t["id"] == "fyp14_urbanization")
            t["target"]["year"] = t["baseline"]["year"]

        self._edit("plan_targets.json", f)
        self.assertHasError(self._run(), "target.year must be after baseline.year")

    def test_rate_target_year_must_match_period_end(self) -> None:
        def f(d):
            t = next(t for t in d["targets"] if t["id"] == "fyp14_rd_growth")
            t["target"]["year"] = 2024

        self._edit("plan_targets.json", f)
        self.assertHasError(self._run(), "must equal period.end")

    def test_level_target_without_baseline_fails_schema(self) -> None:
        def f(d):
            t = next(t for t in d["targets"] if t["id"] == "fyp14_urbanization")
            t["baseline"] = None

        self._edit("plan_targets.json", f)
        self.assertTrue(self._run().errors)

    def test_unknown_plan_id(self) -> None:
        self._edit("plan_targets.json", lambda d: d["targets"][0].update(plan_id="99fyp"))
        self.assertHasError(self._run(), "unknown plan_id")

    def test_impossible_calendar_date(self) -> None:
        self._edit("legislation.json", lambda d: d["documents"][0].update(date_adopted="2021-02-30"))
        self.assertHasError(self._run(), "not a real calendar date")

    def test_effective_before_adopted(self) -> None:
        self._edit("legislation.json", lambda d: d["documents"][1].update(date_effective="2010-01-01"))
        self.assertHasError(self._run(), "date_effective is before date_adopted")

    def test_unknown_related_plan(self) -> None:
        self._edit("legislation.json", lambda d: d["documents"][0].update(related_plan_ids=["nope"]))
        self.assertHasError(self._run(), "unknown related plan id")

    def test_verified_requires_source_url(self) -> None:
        def f(d):
            d["documents"][0]["verified"] = True
            d["documents"][0]["source"]["url"] = None

        self._edit("legislation.json", f)
        self.assertHasError(self._run(), "verified=true requires a source.url")

    def test_javascript_url_rejected(self) -> None:
        def f(d):
            d["documents"][0]["source"]["url"] = "javascript:alert(1)"

        self._edit("legislation.json", f)
        self.assertTrue(self._run().errors)




    def test_live_dataset_rejects_placeholders_and_unverified(self) -> None:
        self._edit("meta.json", lambda d: d.update(data_status="live"))
        self._edit("plan_targets.json", lambda d: d["targets"][0].update(placeholder=True))
        report = self._run()
        self.assertHasError(report, "placeholder record present")
        self.assertHasError(report, "unverified record present")  # the data still has unverified legislation / clusters

    # -- as_of / partial-year values ------------------------------------------
    def _first_actual(self, target_id: str):
        doc = json.loads((self.data / "plan_actuals.json").read_text(encoding="utf-8"))
        return next(i for i, a in enumerate(doc["actuals"]) if a["target_id"] == target_id)

    def test_as_of_must_fall_in_the_records_year(self) -> None:
        i = self._first_actual("fyp14_urbanization")
        self._edit("plan_actuals.json", lambda d: d["actuals"][i].update(as_of="2030-06-30"))
        report = self._run()
        self.assertHasError(report, "is not in the record's year")

    def test_as_of_cannot_postdate_the_dataset(self) -> None:
        i = self._first_actual("ict15_ai_compute")  # a 2026 record
        self._edit("plan_actuals.json", lambda d: d["actuals"][i].update(as_of="2026-12-31"))
        self.assertHasError(self._run(), "after the dataset as_of date")

    def test_impossible_as_of_date(self) -> None:
        i = self._first_actual("fyp14_urbanization")
        self._edit("plan_actuals.json", lambda d: d["actuals"][i].update(as_of="2021-02-30"))
        self.assertHasError(self._run(), "not a real calendar date")

    def test_partial_year_value_in_target_year_is_a_note_not_a_failure(self) -> None:
        report = self._run()
        self.assertTrue(any("cpi23_storage" in n for n in report.notes))
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])

    def test_low_confidence_actual_is_flagged(self) -> None:
        i = self._first_actual("fyp14_urbanization")
        self._edit("plan_actuals.json", lambda d: d["actuals"][i]["source"].update(confidence="low"))
        self.assertTrue(any("confidence is 'low'" in w for w in self._run().warnings))

    def test_expired_plan_status_is_accepted_without_successor(self) -> None:
        def f(d):
            doc = next(x for x in d["documents"] if x["id"] == "fourteenth_fyp_digital_economy_plan")
            self.assertEqual(doc["status"], "expired")
            self.assertIsNone(doc["superseded_by"])

        self._edit("legislation.json", f)
        self.assertEqual(self._run().errors, [])



    # -- map dashboard files -------------------------------------------------
    def test_facility_location_detail_is_rejected(self) -> None:
        self._edit("facilities.json", lambda d: d["facilities"][0].update(lat=39.9, lon=116.4))
        report = self._run()
        self.assertTrue(report.errors)  # schema: additionalProperties false
        # even if the schema were loosened, the semantic check names the leak
        self.assertTrue(any("location detail" in e or "additional properties" in e.lower() for e in report.errors), report.errors)

    def test_facility_string_that_looks_like_a_coordinate_is_rejected(self) -> None:
        self._edit("facilities.json", lambda d: d["facilities"][0].update(operator="see 39.904211,116.407395"))
        self.assertHasError(self._run(), "looks like a link or a coordinate")

    def test_facility_profile_link_is_rejected(self) -> None:
        self._edit("facilities.json", lambda d: d["facilities"][0].update(name="https://www.datacentermap.com/china/x/"))
        self.assertHasError(self._run(), "looks like a link or a coordinate")

    def test_facility_province_must_exist(self) -> None:
        self._edit("facilities.json", lambda d: d["facilities"][0].update(province="atlantis"))
        self.assertHasError(self._run(), "not in provinces.json")

    def test_capacity_class_must_match_mw(self) -> None:
        self._edit("facilities.json", lambda d: d["facilities"][0].update(mw=250.0, capacity="Small (0–10 MW)"))
        self.assertHasError(self._run(), "does not match mw")

    def test_source_counts_must_agree_with_records(self) -> None:
        self._edit("facilities.json", lambda d: d["sourceCounts"].update(dcm=1))
        self.assertHasError(self._run(), "sourceCounts[dcm]")

    def test_duplicate_facility_id(self) -> None:
        self._edit("facilities.json", lambda d: d["facilities"].append(dict(d["facilities"][0])))
        self.assertHasError(self._run(), "duplicate facility id")

    def test_province_hub_must_be_defined(self) -> None:
        self._edit("provinces.json", lambda d: d["provinces"][0].update(hub="atlantis"))
        self.assertHasError(self._run(), "not defined in hubs")

    def test_province_anchor_must_be_inside_view_box(self) -> None:
        self._edit("provinces.json", lambda d: d["provinces"][0].update(cx=-50))
        self.assertHasError(self._run(), "outside the view box")

    def test_derived_balance_must_match_its_inputs(self) -> None:
        def fn(d):
            p = next(x for x in d["provinces"] if x["indicators"].get("generation_balance_2024") is not None)
            p["indicators"]["generation_balance_2024"] += 100
        self._edit("provinces.json", fn)
        self.assertHasError(self._run(), "generation_balance_2024")

    def test_installed_total_must_equal_the_sum_by_technology(self) -> None:
        def fn(d):
            p = next(x for x in d["provinces"] if x["indicators"]["installed_mw_total"] > 0)
            p["indicators"]["installed_mw_total"] += 10
        self._edit("provinces.json", fn)
        self.assertHasError(self._run(), "installed_mw_total")

    def test_plant_outside_view_box_is_rejected(self) -> None:
        self._edit("power_plants.json", lambda d: d["plants"][0].__setitem__(2, 5000))
        self.assertHasError(self._run(), "outside the view box")

    def test_plant_with_unknown_province_is_rejected(self) -> None:
        self._edit("power_plants.json", lambda d: d["plants"][0].__setitem__(4, "atlantis"))
        self.assertHasError(self._run(), "unknown province")

    def test_plant_with_unknown_technology_fails_schema(self) -> None:
        self._edit("power_plants.json", lambda d: d["plants"][0].__setitem__(0, "Fusion"))
        self.assertTrue(self._run().errors)

    # -- transmission lines (power_lines.json) ---------------------------------
    def test_line_province_must_exist(self) -> None:
        self._edit("power_lines.json", lambda d: d["paths"].__setitem__("atlantis", {"500": "M1,1 2,2"}))
        self.assertHasError(self._run(), "unknown province")

    def test_line_coordinates_must_stay_on_the_map(self) -> None:
        def fn(d):
            pid = next(iter(d["paths"]))
            key = next(iter(d["paths"][pid]))
            d["paths"][pid][key] += "M5000,10 5001,11"
        self._edit("power_lines.json", fn)
        self.assertHasError(self._run(), "outside the view box")

    def test_line_class_total_must_equal_the_province_sum(self) -> None:
        self._edit("power_lines.json", lambda d: d["classes"][0].__setitem__("km", d["classes"][0]["km"] + 100))
        self.assertHasError(self._run(), "does not equal the province sum")

    def test_line_attribution_is_required(self) -> None:
        self._edit("power_lines.json", lambda d: d["source"].__setitem__("licence", "public domain"))
        self.assertHasError(self._run(), "ODbL")

    def test_line_class_must_be_declared(self) -> None:
        def fn(d):
            d["classes"] = [c for c in d["classes"] if c["key"] != "uhv"]
        self._edit("power_lines.json", fn)
        self.assertHasError(self._run(), "is not declared")

    def test_line_path_with_letters_fails_schema(self) -> None:
        def fn(d):
            pid = next(iter(d["paths"]))
            key = next(iter(d["paths"][pid]))
            d["paths"][pid][key] = "M1,1 L<script>"
        self._edit("power_lines.json", fn)
        self.assertTrue(self._run().errors)

    def test_actual_qualifier_must_be_a_known_token(self) -> None:
        self._edit("plan_actuals.json", lambda d: d["actuals"][0].update(qualifier="roughly"))
        self.assertHasError(self._run(), "qualifier")

if __name__ == "__main__":
    unittest.main()

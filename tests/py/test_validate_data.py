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
        # The real project inventory is git-ignored (licence pending), so tests always use the synthetic fixture.
        shutil.copy(ROOT / "tests" / "fixtures" / "edwc_projects.sample.json", self.data / "edwc_projects.json")

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

    def test_swapped_lat_lon_is_called_out(self) -> None:
        def f(d):
            d["features"][0]["geometry"]["coordinates"] = [40.77, 114.89]

        self._edit("edwc_hubs.geojson", f)
        self.assertHasError(self._run(), "swapped")

    def test_negative_longitude_sign_error(self) -> None:
        def f(d):
            d["features"][0]["geometry"]["coordinates"] = [-114.89, 40.77]

        self._edit("edwc_hubs.geojson", f)
        self.assertHasError(self._run(), "outside the expected China bounding box")

    def test_negative_racks_rejected(self) -> None:
        self._edit("edwc_hubs.geojson", lambda d: d["features"][0]["properties"].update(racks_k=-5))
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

    # -- multi-site clusters -----------------------------------------------------
    def test_part_of_must_reference_a_primary_feature(self) -> None:
        def f(d):
            site = next(x for x in d["features"] if x["properties"]["id"] == "horinger_jining")
            site["properties"]["part_of"] = "nowhere"

        self._edit("edwc_hubs.geojson", f)
        self.assertHasError(self._run(), "does not exist")

    def test_part_of_cannot_chain_or_self_reference(self) -> None:
        def f(d):
            primary = next(x for x in d["features"] if x["properties"]["id"] == "horinger")
            primary["properties"]["part_of"] = "horinger"

        self._edit("edwc_hubs.geojson", f)
        report = self._run()
        self.assertHasError(report, "points at itself")
        self.assertHasError(report, "is itself a secondary site")

    def test_secondary_site_with_its_own_racks_warns_about_double_counting(self) -> None:
        def f(d):
            # Give BOTH the primary and the secondary site a rack figure; the data itself may carry neither.
            for fid in ("horinger", "horinger_jining"):
                site = next(x for x in d["features"] if x["properties"]["id"] == fid)
                site["properties"].update(racks_k=10, racks_as_of="2024-01")

        self._edit("edwc_hubs.geojson", f)
        self.assertTrue(any("double-count" in w for w in self._run().warnings))

    def test_future_rack_date_rejected(self) -> None:
        def f(d):
            d["features"][0]["properties"]["racks_as_of"] = "2031-01"

        self._edit("edwc_hubs.geojson", f)
        self.assertHasError(self._run(), "after the dataset as_of date")

    def test_metrics_without_a_source_warn(self) -> None:
        def f(d):
            d["features"][0]["properties"]["metrics_source"] = None

        self._edit("edwc_hubs.geojson", f)
        self.assertTrue(any("metrics_source is missing" in w for w in self._run().warnings))

    def test_expired_plan_status_is_accepted_without_successor(self) -> None:
        def f(d):
            doc = next(x for x in d["documents"] if x["id"] == "fourteenth_fyp_digital_economy_plan")
            self.assertEqual(doc["status"], "expired")
            self.assertIsNone(doc["superseded_by"])

        self._edit("legislation.json", f)
        self.assertEqual(self._run().errors, [])



    # -- project inventory -------------------------------------------------
    def test_project_inventory_is_optional(self) -> None:
        (self.data / "edwc_projects.json").unlink()
        report = self._run()
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])
        self.assertTrue(any("optional file not present" in n for n in report.notes), report.notes)

    def test_shared_centroid_needs_its_flag(self) -> None:
        def fn(d):
            base = d["projects"][0]
            for i in range(2):
                clone = dict(base, id=f"guian_x{i}", flags=[], sheet_row=90 + i)
                d["projects"].append(clone)
        self._edit("edwc_projects.json", fn)
        report = self._run()
        self.assertTrue(any("shared_centroid flag is missing" in w for w in report.warnings), report.warnings)

    def test_project_must_reference_an_existing_primary_cluster(self) -> None:
        self._edit("edwc_projects.json", lambda d: d["projects"][0].update(cluster_id="atlantis"))
        self.assertHasError(self._run(), "not a feature in edwc_hubs.geojson")
        self._edit("edwc_projects.json", lambda d: d["projects"][0].update(cluster_id="horinger_jining", site_id=None))
        self.assertHasError(self._run(), "secondary site")

    def test_project_site_must_belong_to_its_cluster(self) -> None:
        def fn(d):
            p = next(x for x in d["projects"] if x["cluster_id"] == "guian")
            p["site_id"] = "horinger_jining"
        self._edit("edwc_projects.json", fn)
        self.assertHasError(self._run(), "not part_of cluster")

    def test_project_swapped_coordinates_are_called_out(self) -> None:
        def fn(d):
            p = next(x for x in d["projects"] if x["coordinates"])
            p["coordinates"] = list(reversed(p["coordinates"]))
        self._edit("edwc_projects.json", fn)
        report = self._run()
        self.assertHasError(report, "swapped")

    def test_project_flags_must_match_fields(self) -> None:
        def fn(d):
            p = next(x for x in d["projects"] if x["source_url"] is None)
            p["flags"] = [f for f in p["flags"] if f != "no_source"]
        self._edit("edwc_projects.json", fn)
        report = self._run()
        self.assertTrue(any("no_source flag is missing" in w for w in report.warnings), report.warnings)

    def test_project_precision_and_coordinates_must_agree(self) -> None:
        def fn(d):
            p = next(x for x in d["projects"] if x["coordinates"] is None)
            p["location_precision"] = "point"
        self._edit("edwc_projects.json", fn)
        self.assertHasError(self._run(), "no coordinates")

    def test_project_far_from_its_cluster_warns(self) -> None:
        def fn(d):
            p = next(x for x in d["projects"] if x["cluster_id"] == "guian")
            p["coordinates"] = [115.1, 40.7]  # Zhangjiakou, not Guizhou
            p["location_precision"] = "point"
        self._edit("edwc_projects.json", fn)
        report = self._run()
        self.assertTrue(any("away from its cluster point" in w for w in report.warnings), report.warnings)

    def test_project_compiled_date_cannot_postdate_dataset(self) -> None:
        self._edit("edwc_projects.json", lambda d: d["source"].update(compiled="2099-01-01"))
        self.assertHasError(self._run(), "after the dataset as_of")

    def test_actual_qualifier_must_be_a_known_token(self) -> None:
        self._edit("plan_actuals.json", lambda d: d["actuals"][0].update(qualifier="roughly"))
        self.assertHasError(self._run(), "qualifier")

if __name__ == "__main__":
    unittest.main()

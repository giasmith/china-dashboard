"""Tests for read_dccom() in scripts/build_dashboard_data.py: the approved datacenters.com listings.
Run: python -m unittest discover -s tests/py -v
"""

from __future__ import annotations

import csv
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("build_dashboard_data", ROOT / "scripts" / "build_dashboard_data.py")
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)  # type: ignore[union-attr]

CSV = ROOT / "data_sources" / "datacenters_com_sites.csv"
COLUMNS = ["dccom_id", "name", "operator", "province", "status", "facility_type", "match", "note"]
ROW = {"dccom_id": "abc1234567", "name": "China Telecom Example IDC", "operator": "China Telecom", "province": "hubei",
       "status": "Operating", "facility_type": "", "match": "", "note": ""}


class ReadDccomTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, rows: list[dict]) -> Path:
        path = self.tmp / "datacenters_com_sites.csv"
        with path.open("w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(rows)
        return path

    def test_committed_file_has_only_the_allowed_columns(self) -> None:
        with CSV.open(encoding="utf-8", newline="") as fh:
            header = next(csv.reader(fh))
        self.assertEqual(header, COLUMNS, "no address, city, coordinate, slug or link columns")

    def test_committed_file_reads_cleanly(self) -> None:
        flags: list[str] = []
        recs = bd.read_dccom(CSV, flags)
        self.assertGreater(len(recs), 0)
        for r in recs:
            self.assertIsNone(r["lat"])
            self.assertIsNone(r["lon"])
            self.assertTrue(r["src_id"].startswith("dccom:"))
            self.assertEqual(r["src"], "dccom")

    def test_a_row_becomes_a_province_level_record(self) -> None:
        (r,) = bd.read_dccom(self._write([ROW]), [])
        self.assertEqual((r["province_hint"], r["status"], r["ftype"], r["mw"]), ("hubei", "Operating", None, None))

    def test_links_are_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            bd.read_dccom(self._write([dict(ROW, note="https://example.org/page")]), [])

    def test_unknown_province_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            bd.read_dccom(self._write([dict(ROW, province="taiwan")]), [])

    def test_repeated_id_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            bd.read_dccom(self._write([ROW, dict(ROW, name="Other")]), [])

    def test_bad_status_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            bd.read_dccom(self._write([dict(ROW, status="Live")]), [])

    def test_no_coordinates_merge_by_name_only(self) -> None:
        dcm = {"src": "dcm", "src_id": "dcm:1", "name": "China Telecom Example IDC", "operator": "CT", "status": "Operating",
               "ftype": "Colocation", "listing": "Facility", "lat": 30.5, "lon": 114.3, "mw": None, "pue": None, "year": None,
               "country": "China"}
        recs = bd.read_dccom(self._write([ROW, dict(ROW, dccom_id="zzz9999999", name="China Telecom Another IDC")]), [])
        merged = bd.merge_inventory([dcm] + recs, [])
        self.assertEqual(len(merged), 2, "same normalised name folds into the existing record; a new name stays separate")
        self.assertIn("dccom", next(m for m in merged if m["src_id"] == "dcm:1")["sources"])


if __name__ == "__main__":
    unittest.main()


DETAIL_COLUMNS = ["facility_id", "facility_name", "racks", "compute_pflops", "ai_accelerators", "building_area_m2", "pue",
                  "pue_basis", "basis", "note", "source", "retrieved"]
DETAIL = {"facility_id": "dc_0123456789", "facility_name": "Example DC", "racks": "100", "compute_pflops": "", "ai_accelerators": "",
          "building_area_m2": "", "pue": "1.25", "pue_basis": "design", "basis": "vendor-reported", "note": "",
          "source": "Example vendor case study, 2026", "retrieved": "2026-10-16"}


class FacilityDetailsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, rows: list[dict]) -> Path:
        path = self.tmp / "facility_details.csv"
        with path.open("w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=DETAIL_COLUMNS)
            w.writeheader()
            w.writerows(rows)
        return path

    def test_committed_file_loads(self) -> None:
        details = bd.load_facility_details(ROOT / "data_sources" / "facility_details.csv")
        self.assertGreater(len(details), 0)
        for fid, row in details.items():
            self.assertRegex(fid, r"^dc_[0-9a-f]{10}$")
            self.assertTrue(row["details"]["source"] and row["details"]["basis"])

    def test_a_row_is_parsed(self) -> None:
        d = bd.load_facility_details(self._write([DETAIL]))["dc_0123456789"]["details"]
        self.assertEqual((d["racks"], d["pue"], d["pueBasis"], d["basis"]), (100, 1.25, "design", "vendor-reported"))
        self.assertNotIn("note", d)

    def test_links_are_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            bd.load_facility_details(self._write([dict(DETAIL, source="https://example.org/case-study")]))

    def test_source_and_basis_are_required(self) -> None:
        for col in ("source", "basis"):
            with self.subTest(col=col), self.assertRaises(SystemExit):
                bd.load_facility_details(self._write([dict(DETAIL, **{col: ""})]))

    def test_bad_numbers_are_rejected(self) -> None:
        for col, v in (("racks", "12.5"), ("racks", "-3"), ("pue", "0.9"), ("compute_pflops", "lots")):
            with self.subTest(col=col, v=v), self.assertRaises(SystemExit):
                bd.load_facility_details(self._write([dict(DETAIL, **{col: v})]))

    def test_a_row_without_any_figure_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            bd.load_facility_details(self._write([dict(DETAIL, racks="", pue="")]))

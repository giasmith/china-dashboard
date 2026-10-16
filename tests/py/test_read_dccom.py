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

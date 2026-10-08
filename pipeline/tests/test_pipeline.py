"""Offline tests for the pipeline stub. Run: python -m unittest discover -s pipeline/tests -v"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from china_pipeline.fetch import (  # noqa: E402
    HostMismatch, PoliteFetcher, RobotsDisallowed, SourceNotEnabled, TooLarge,
)
from china_pipeline.models import Source  # noqa: E402
from china_pipeline.sources import SourceConfigError, load_sources  # noqa: E402


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200, ctype: str = "text/html"):
        self._body, self.status = body, status
        self.headers = {"Content-Type": ctype}

    def read(self, n: int = -1) -> bytes:
        return self._body if n < 0 else self._body[:n]


def make_opener(routes: dict[str, object], log: list[str]):
    """routes: url -> FakeResponse | int (HTTP error status) | Exception"""

    def opener(req, timeout=None):
        url = req.full_url
        log.append(url)
        r = routes.get(url, 404)
        if isinstance(r, Exception):
            raise r
        if isinstance(r, int):
            raise urllib.error.HTTPError(url, r, "err", {}, io.BytesIO(b""))
        return r

    return opener


SRC = Source("s", "Test", "https://example.gov.cn/", "legislation", "zh", "enabled", True)


class FetchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.log: list[str] = []
        self.sleeps: list[float] = []
        self.now = [0.0]

    def tearDown(self):
        self.tmp.cleanup()

    def fetcher(self, routes, **kw):
        return PoliteFetcher(
            Path(self.tmp.name), min_delay_s=2.0, opener=make_opener(routes, self.log),
            clock=lambda: self.now[0], sleep=lambda s: (self.sleeps.append(s), self.now.__setitem__(0, self.now[0] + s)), **kw,
        )

    ROBOTS_OK = FakeResponse(b"User-agent: *\nDisallow: /private/\n")

    def test_fetch_saves_raw_bytes_and_provenance(self):
        f = self.fetcher({"https://example.gov.cn/robots.txt": self.ROBOTS_OK, "https://example.gov.cn/law": FakeResponse("数据安全法".encode())})
        snap = f.fetch(SRC, "https://example.gov.cn/law")
        self.assertEqual(Path(snap.path).read_bytes(), "数据安全法".encode())
        self.assertEqual(len(snap.sha256), 64)
        sidecar = json.loads(Path(snap.path).with_suffix(".json").read_text())
        self.assertEqual(sidecar["url"], "https://example.gov.cn/law")
        self.assertRegex(snap.retrieved_at, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_refuses_source_that_is_not_enabled(self):
        planned = Source("p", "P", "https://example.gov.cn/", "policy", "zh", "planned", False)
        with self.assertRaises(SourceNotEnabled):
            self.fetcher({}).fetch(planned, "https://example.gov.cn/x")
        self.assertEqual(self.log, [])  # no request of any kind was made

    def test_refuses_other_hosts_and_non_http_schemes(self):
        f = self.fetcher({})
        for url in ("https://evil.example.com/x", "https://example.gov.cn.evil.com/x", "file:///etc/passwd", "ftp://example.gov.cn/x"):
            with self.assertRaises(HostMismatch, msg=url):
                f.fetch(SRC, url)
        self.assertEqual(self.log, [])

    def test_honours_robots_disallow(self):
        f = self.fetcher({"https://example.gov.cn/robots.txt": self.ROBOTS_OK, "https://example.gov.cn/private/a": FakeResponse(b"x")})
        with self.assertRaises(RobotsDisallowed):
            f.fetch(SRC, "https://example.gov.cn/private/a")
        self.assertNotIn("https://example.gov.cn/private/a", self.log)

    def test_missing_robots_txt_means_allowed(self):
        f = self.fetcher({"https://example.gov.cn/a": FakeResponse(b"ok")})  # robots.txt -> 404
        self.assertEqual(f.fetch(SRC, "https://example.gov.cn/a").bytes, 2)

    def test_robots_server_error_or_network_failure_means_do_not_fetch(self):
        for robots in (503, urllib.error.URLError("down"), TimeoutError()):
            self.log.clear()
            f = self.fetcher({"https://example.gov.cn/robots.txt": robots, "https://example.gov.cn/a": FakeResponse(b"ok")})
            with self.assertRaises(RobotsDisallowed, msg=repr(robots)):
                f.fetch(SRC, "https://example.gov.cn/a")

    def test_delay_between_requests_to_the_same_host(self):
        f = self.fetcher({"https://example.gov.cn/a": FakeResponse(b"a"), "https://example.gov.cn/b": FakeResponse(b"b")})
        f.fetch(SRC, "https://example.gov.cn/a")
        f.fetch(SRC, "https://example.gov.cn/b")
        self.assertTrue(self.sleeps and all(s > 0 for s in self.sleeps))
        self.assertGreaterEqual(sum(self.sleeps), 2.0)

    def test_response_size_cap(self):
        f = self.fetcher({"https://example.gov.cn/big": FakeResponse(b"x" * 101)}, max_bytes=100)
        with self.assertRaises(TooLarge):
            f.fetch(SRC, "https://example.gov.cn/big")

    def test_identical_content_is_stored_once(self):
        f = self.fetcher({"https://example.gov.cn/a": FakeResponse(b"same"), "https://example.gov.cn/b": FakeResponse(b"same")})
        a = f.fetch(SRC, "https://example.gov.cn/a")
        b = f.fetch(SRC, "https://example.gov.cn/b")
        self.assertEqual(a.sha256, b.sha256)
        self.assertEqual(a.path, b.path)


class SourcesTest(unittest.TestCase):
    def test_shipped_registry_loads_and_nothing_is_enabled_yet(self):
        sources = load_sources()
        self.assertGreaterEqual(len(sources), 4)
        self.assertTrue(all(s.status == "planned" and not s.access_checked for s in sources.values()))

    def _load(self, text: str):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.yml"
            p.write_text(text, encoding="utf-8")
            return load_sources(p)

    def test_cannot_enable_a_source_whose_access_has_not_been_checked(self):
        with self.assertRaisesRegex(SourceConfigError, "access_checked"):
            self._load("sources:\n - {id: a, name: A, base_url: 'https://a.gov.cn/', kind: policy, language: zh, status: enabled, access_checked: false}\n")

    def test_rejects_plain_http_duplicates_and_bad_enums(self):
        base = "{id: a, name: A, base_url: '%s', kind: %s, language: zh, status: planned, access_checked: false}"
        with self.assertRaisesRegex(SourceConfigError, "https"):
            self._load("sources:\n - " + base % ("http://a.gov.cn/", "policy"))
        with self.assertRaisesRegex(SourceConfigError, "kind"):
            self._load("sources:\n - " + base % ("https://a.gov.cn/", "news"))
        with self.assertRaisesRegex(SourceConfigError, "duplicate"):
            self._load("sources:\n - " + base % ("https://a.gov.cn/", "policy") + "\n - " + base % ("https://b.gov.cn/", "policy"))
        with self.assertRaisesRegex(SourceConfigError, "non-empty"):
            self._load("sources: []\n")


if __name__ == "__main__":
    unittest.main()

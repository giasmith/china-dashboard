"""Polite, auditable HTTP fetching.

Rules this module enforces (so individual scrapers cannot forget them):
  * only sources whose status is 'enabled' (a human has read the terms and robots.txt)
  * only URLs on the source's own host (no accidental crawling elsewhere)
  * robots.txt is honoured; if it cannot be read because of a server error, nothing is fetched
  * a minimum delay between requests to the same host, a timeout, and a response size cap
  * every download is saved raw with a provenance record (URL, UTC time, SHA-256), so any figure on the
    dashboard can be traced back to the exact bytes it came from

The network layer is injectable (`opener`, `clock`, `sleep`) so the logic is tested without touching the network.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from .models import Snapshot, Source

DEFAULT_UA = "china-dashboard-research/0.1 (+set-contact-url-or-email-here)"


class FetchError(RuntimeError):
    pass


class SourceNotEnabled(FetchError):
    pass


class HostMismatch(FetchError):
    pass


class RobotsDisallowed(FetchError):
    pass


class TooLarge(FetchError):
    pass


class PoliteFetcher:
    def __init__(
        self,
        raw_dir: Path,
        user_agent: str = DEFAULT_UA,
        min_delay_s: float = 2.0,
        timeout_s: float = 30.0,
        max_bytes: int = 25_000_000,
        opener: Callable = urllib.request.urlopen,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.raw_dir = Path(raw_dir)
        self.user_agent = user_agent
        self.min_delay_s = min_delay_s
        self.timeout_s = timeout_s
        self.max_bytes = max_bytes
        self._open = opener
        self._clock = clock
        self._sleep = sleep
        self._last_request: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}  # None = disallow everything

    # ------------------------------------------------------------------ robots.txt
    def _robots_for(self, origin: str) -> RobotFileParser | None:
        if origin in self._robots:
            return self._robots[origin]
        parser: RobotFileParser | None = RobotFileParser()
        try:
            resp = self._request(f"{origin}/robots.txt")
            parser.parse(resp.read(512_000).decode("utf-8", errors="replace").splitlines())
        except urllib.error.HTTPError as exc:
            # RFC 9309: 4xx means "no robots.txt, everything allowed"; 5xx means "unavailable, be conservative".
            if 400 <= exc.code < 500:
                parser.parse([])
            else:
                parser = None
        except (urllib.error.URLError, TimeoutError, OSError):
            parser = None
        self._robots[origin] = parser
        return parser

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        parser = self._robots_for(f"{parts.scheme}://{parts.netloc}")
        return parser is not None and parser.can_fetch(self.user_agent, url)

    # ------------------------------------------------------------------ requests
    def _throttle(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            wait = self.min_delay_s - (self._clock() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_request[host] = self._clock()

    def _request(self, url: str):
        host = urlsplit(url).hostname or ""
        self._throttle(host)
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": "*/*"})
        return self._open(req, timeout=self.timeout_s)

    def fetch(self, source: Source, url: str) -> Snapshot:
        if source.status != "enabled":
            raise SourceNotEnabled(f"source '{source.id}' is '{source.status}', not 'enabled'")
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or (parts.hostname or "").lower() != source.host:
            raise HostMismatch(f"{url} is not on {source.host}")
        if not self.allowed(url):
            raise RobotsDisallowed(f"robots.txt does not allow {url} (or it could not be read)")

        resp = self._request(url)
        body = resp.read(self.max_bytes + 1)
        if len(body) > self.max_bytes:
            raise TooLarge(f"{url} exceeds {self.max_bytes} bytes")

        digest = hashlib.sha256(body).hexdigest()
        out_dir = self.raw_dir / source.id
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{digest}.bin"
        path.write_bytes(body)

        snap = Snapshot(
            source_id=source.id,
            url=url,
            retrieved_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            status_code=getattr(resp, "status", 200),
            content_type=resp.headers.get("Content-Type") if getattr(resp, "headers", None) else None,
            sha256=digest,
            bytes=len(body),
            path=str(path),
        )
        (out_dir / f"{digest}.json").write_text(json.dumps(snap.__dict__, indent=2), encoding="utf-8")
        return snap

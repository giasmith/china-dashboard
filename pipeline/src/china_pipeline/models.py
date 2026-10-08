"""Plain data types shared by the pipeline stages."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

KINDS = ("legislation", "policy", "statistics")
STATUSES = ("planned", "enabled", "disabled")


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    base_url: str
    kind: str
    language: str
    status: str
    access_checked: bool
    access_notes: str = ""

    @property
    def host(self) -> str:
        return (urlsplit(self.base_url).hostname or "").lower()


@dataclass(frozen=True)
class Snapshot:
    """Provenance for one downloaded document. Every published number must trace back to one of these."""

    source_id: str
    url: str
    retrieved_at: str  # ISO 8601, UTC
    status_code: int
    content_type: str | None
    sha256: str
    bytes: int
    path: str

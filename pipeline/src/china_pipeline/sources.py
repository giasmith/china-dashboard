"""Load and validate the source registry (config/sources.yml)."""

from __future__ import annotations

from pathlib import Path

import yaml

from .models import KINDS, STATUSES, Source

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "config" / "sources.yml"


class SourceConfigError(ValueError):
    pass


def load_sources(path: Path = DEFAULT_PATH) -> dict[str, Source]:
    doc = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    raw = doc.get("sources")
    if not isinstance(raw, list) or not raw:
        raise SourceConfigError(f"{path}: 'sources' must be a non-empty list")

    sources: dict[str, Source] = {}
    for i, entry in enumerate(raw):
        where = f"{path}: sources[{i}]"
        if not isinstance(entry, dict):
            raise SourceConfigError(f"{where} must be a mapping")
        missing = [k for k in ("id", "name", "base_url", "kind", "language", "status", "access_checked") if k not in entry]
        if missing:
            raise SourceConfigError(f"{where} is missing {', '.join(missing)}")
        if entry["kind"] not in KINDS:
            raise SourceConfigError(f"{where}: kind must be one of {KINDS}")
        if entry["status"] not in STATUSES:
            raise SourceConfigError(f"{where}: status must be one of {STATUSES}")
        if not str(entry["base_url"]).startswith("https://"):
            raise SourceConfigError(f"{where}: base_url must be https")
        if entry["status"] == "enabled" and entry["access_checked"] is not True:
            raise SourceConfigError(f"{where}: cannot be 'enabled' until access_checked is true (read the terms and robots.txt first)")
        if entry["id"] in sources:
            raise SourceConfigError(f"{where}: duplicate id '{entry['id']}'")
        sources[entry["id"]] = Source(
            id=entry["id"], name=entry["name"], base_url=entry["base_url"], kind=entry["kind"],
            language=entry["language"], status=entry["status"], access_checked=entry["access_checked"],
            access_notes=entry.get("access_notes", ""),
        )
    return sources

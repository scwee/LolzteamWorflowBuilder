"""Market endpoint catalog loader."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parent / "data" / "endpoints.json"


@lru_cache(maxsize=1)
def load_catalog() -> list[dict[str, Any]]:
    if not CATALOG_PATH.exists():
        return []
    with CATALOG_PATH.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        return []
    return data


def get_endpoint(endpoint_id: str) -> dict[str, Any] | None:
    for item in load_catalog():
        if item.get("id") == endpoint_id:
            return item
    return None


def list_endpoints(*, q: str | None = None, tag: str | None = None) -> list[dict[str, Any]]:
    items = load_catalog()
    if tag:
        items = [e for e in items if e.get("tag") == tag]
    if q:
        needle = q.lower()
        items = [
            e
            for e in items
            if needle in str(e.get("id", "")).lower()
            or needle in str(e.get("summary", "")).lower()
            or needle in str(e.get("pathTemplate", "")).lower()
            or needle in str(e.get("tag", "")).lower()
        ]
    return items


def list_tags() -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for item in load_catalog():
        tag = str(item.get("tag") or "Other")
        counts[tag] = counts.get(tag, 0) + 1
    return [{"tag": tag, "count": count} for tag, count in sorted(counts.items(), key=lambda x: x[0].lower())]

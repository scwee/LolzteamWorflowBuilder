import json
from typing import Any

import yaml

from app.config import settings
from app.engine.errors import GraphExecutionError
from app.engine.http_util import request_capped_async
from app.engine.url_guard import validate_outbound_url

MAX_SPEC_BYTES = 5 * 1024 * 1024
MAX_YAML_DEPTH = 50


class SpecFetchError(Exception):
    pass


def parse_spec_content(raw: bytes, content_type: str = "") -> dict[str, Any]:
    if len(raw) > MAX_SPEC_BYTES:
        raise SpecFetchError("OpenAPI spec exceeds 5 MB limit")

    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        raise SpecFetchError("Empty spec content")

    if "yaml" in content_type or text.startswith("openapi:") or text.startswith("swagger:"):
        try:
            data = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise SpecFetchError(f"Invalid YAML: {exc}") from exc
    else:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            try:
                data = yaml.safe_load(text)
            except yaml.YAMLError:
                raise SpecFetchError(f"Invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise SpecFetchError("Spec must be a JSON/YAML object")
    _assert_depth(data, MAX_YAML_DEPTH)
    return data


def _assert_depth(obj: Any, limit: int, _depth: int = 0) -> None:
    if _depth > limit:
        raise SpecFetchError(f"Spec nesting too deep (max {limit})")
    if isinstance(obj, dict):
        for value in obj.values():
            _assert_depth(value, limit, _depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _assert_depth(item, limit, _depth + 1)


async def fetch_spec_from_url(url: str) -> dict[str, Any]:
    validated_url = validate_outbound_url(url)
    if settings.is_production and not validated_url.startswith("https://"):
        raise SpecFetchError("Only HTTPS URLs are allowed in production")

    # Pinned IP + streamed body capped at MAX_SPEC_BYTES (anti DNS-rebinding + anti OOM)
    try:
        response = await request_capped_async(
            "GET", validated_url, timeout=30.0, max_bytes=MAX_SPEC_BYTES
        )
    except GraphExecutionError as exc:
        raise SpecFetchError(str(exc)) from exc
    if response.status_code >= 400:
        raise SpecFetchError(f"Failed to fetch spec: HTTP {response.status_code}")
    content_type = response.headers.get("content-type", "")
    return parse_spec_content(response.content, content_type)

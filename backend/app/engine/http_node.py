"""Generic HTTP request node."""

from __future__ import annotations

import json as jsonlib
from typing import Any

from app.engine.errors import GraphExecutionError
from app.engine.http_util import request_capped
from app.engine.interpolator import interpolate_value


def _coerce_headers(raw: Any) -> dict[str, str]:
    """Accept a dict or a JSON / `Key: Value` newline string (UI отдаёт строку)."""
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        parsed = raw
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            loaded = jsonlib.loads(text)
            if not isinstance(loaded, dict):
                raise GraphExecutionError("http_request headers JSON must be an object")
            parsed = loaded
        except jsonlib.JSONDecodeError:
            parsed = {}
            for line in text.splitlines():
                if not line.strip():
                    continue
                if ":" not in line:
                    raise GraphExecutionError(f"Invalid header line: {line!r}")
                key, value = line.split(":", 1)
                parsed[key.strip()] = value.strip()
    else:
        raise GraphExecutionError("http_request headers must be an object or string")

    headers: dict[str, str] = {}
    for key, value in parsed.items():
        if value is None:
            continue
        k, v = str(key), str(value)
        # Prevent CRLF header injection
        if any(ch in k for ch in "\r\n") or any(ch in v for ch in "\r\n"):
            raise GraphExecutionError("Header names/values must not contain CR or LF")
        headers[k] = v
    return headers


def run_http_request(data: dict[str, Any], template_context: dict[str, Any]) -> dict[str, Any]:
    interpolated = interpolate_value(data or {}, template_context)
    if not isinstance(interpolated, dict):
        raise GraphExecutionError("http_request data must be an object")

    method = str(interpolated.get("method") or "GET").upper().strip()
    url_raw = str(interpolated.get("url") or "").strip()
    if not url_raw:
        raise GraphExecutionError("http_request requires url")

    headers = _coerce_headers(interpolated.get("headers"))

    query_raw = interpolated.get("query") or interpolated.get("params") or {}
    if query_raw and not isinstance(query_raw, dict):
        raise GraphExecutionError("http_request query must be an object")
    query = {str(k): v for k, v in (query_raw or {}).items() if v is not None} if query_raw else None

    timeout_raw = interpolated.get("timeout")
    try:
        timeout = float(timeout_raw) if timeout_raw is not None else 30.0
    except (TypeError, ValueError) as exc:
        raise GraphExecutionError("http_request timeout must be a number") from exc
    timeout = max(1.0, min(timeout, 120.0))

    json_body = interpolated.get("json")
    body = interpolated.get("body")
    content = None
    if json_body is None and body is not None and body != "":
        content = body if isinstance(body, (bytes, bytearray)) else str(body).encode("utf-8")

    response = request_capped(
        method,
        url_raw,
        headers=headers,
        params=query,
        json=json_body if json_body is not None else None,
        content=content,
        timeout=timeout,
    )

    content_type = (response.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        try:
            body_out: Any = response.json()
        except ValueError:
            body_out = response.text
    else:
        body_out = response.text

    return {
        "response": {
            "status": response.status_code,
            "headers": response.headers,
            "body": body_out,
        },
        "logs": [f"HTTP {method} {url_raw} → {response.status_code}"],
    }

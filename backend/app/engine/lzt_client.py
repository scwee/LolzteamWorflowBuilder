"""LZT Market HTTP client with 429 / retry_request / 502-504 retries."""

from __future__ import annotations

import re
import time
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import quote, urlencode, urlparse, urlunparse

import httpx

from app.config import settings
from app.engine.errors import GraphExecutionError
from app.engine.http_util import MAX_RESPONSE_BYTES, request_capped

REQUEST_TIMEOUT = 310.0
MAX_RETRY_REQUEST = 100
MAX_429_RETRIES = 10
MAX_RETRY_AFTER_SECONDS = 60.0
MAX_TRANSPORT_RETRIES = 5


def _has_retry_request(body: Any) -> bool:
    if not isinstance(body, dict):
        return False
    errors = body.get("errors")
    if isinstance(errors, dict):
        for val in errors.values():
            if isinstance(val, str) and re.search(r"retry_request", val, re.I):
                return True
    for key in ("message", "error"):
        val = body.get(key)
        if isinstance(val, str) and re.search(r"retry_request", val, re.I):
            return True
    return False


def _parse_retry_after(headers: dict[str, str]) -> float:
    retry_after = headers.get("retry-after")
    if retry_after:
        try:
            return float(retry_after)
        except ValueError:
            try:
                return max(0.0, parsedate_to_datetime(retry_after).timestamp() - time.time())
            except (TypeError, ValueError, OverflowError):
                pass
    reset = headers.get("x-ratelimit-reset")
    if reset:
        try:
            reset_ts = float(reset)
            reset_ms = reset_ts if reset_ts > 1e12 else reset_ts * 1000
            return max(0.0, (reset_ms / 1000) - time.time())
        except ValueError:
            pass
    return 5.0


def _substitute_path(path: str, params: dict[str, Any]) -> str:
    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        val = params.get(key)
        if val is None:
            raise ValueError(f"Missing path param: {key}")
        return quote(str(val), safe="")

    return re.sub(r"\{([^}]+)\}", repl, path)


def _build_url(path: str, query: dict[str, Any] | None = None) -> str:
    base_url = settings.lzt_market_base_url.rstrip("/")
    # Catalog paths are always relative; reject absolute URLs to prevent SSRF via path.
    if path.lower().lstrip().startswith(("http:", "https:", "//")):
        raise GraphExecutionError("Absolute URLs are not allowed in LZT endpoint path")
    base = f"{base_url}{path if path.startswith('/') else '/' + path}"
    if not query:
        return base
    parsed = urlparse(base)
    existing = parsed.query
    extra = urlencode({k: v for k, v in query.items() if v not in (None, "")})
    query_str = f"{existing}&{extra}" if existing and extra else extra or existing
    return urlunparse(parsed._replace(query=query_str))


def lzt_request(
    method: str,
    path: str,
    body: dict[str, Any] | None,
    token: str,
    *,
    retry_on_retry_request: bool = False,
    proxy: str | None = None,
) -> dict[str, Any]:
    method = method.upper()
    is_get = method in ("GET", "HEAD")
    payload = dict(body or {})
    path_params: dict[str, Any] = {}

    for key in list(payload.keys()):
        if f"{{{key}}}" in path:
            path_params[key] = payload.pop(key)

    resolved_path = _substitute_path(path, path_params)
    query_params: dict[str, Any] = {}
    if is_get:
        query_params = {k: v for k, v in payload.items() if v not in (None, "")}
        payload = {}

    attempt = 0
    retry_request_count = 0
    rate_limit_retries = 0

    while True:
        attempt += 1
        start = time.time()
        url = _build_url(resolved_path, query_params if is_get else None)
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        json_body = payload if not is_get and payload else None
        if json_body:
            headers["Content-Type"] = "application/json"

        try:
            response = request_capped(
                method,
                url,
                headers=headers,
                json=json_body,
                timeout=REQUEST_TIMEOUT,
                proxy=proxy,
                max_bytes=MAX_RESPONSE_BYTES,
                # base_url is trusted config, but a user proxy can MITM → keep pin off only for proxy
                pin=proxy is None,
            )
        except httpx.HTTPError:
            if attempt < MAX_TRANSPORT_RETRIES:
                time.sleep(attempt)
                continue
            raise

        duration = int((time.time() - start) * 1000)
        resp_headers = {k.lower(): v for k, v in response.headers.items()}

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                resp_body: Any = response.json()
            except Exception:
                resp_body = response.text
        else:
            resp_body = response.text

        if response.status_code == 429:
            rate_limit_retries += 1
            if rate_limit_retries > MAX_429_RETRIES:
                raise GraphExecutionError("LZT rate limit: exceeded retry budget (429)")
            wait = min(_parse_retry_after(resp_headers), MAX_RETRY_AFTER_SECONDS)
            time.sleep(max(0.0, wait))
            continue

        if (
            retry_on_retry_request
            and response.status_code == 403
            and _has_retry_request(resp_body)
        ):
            retry_request_count += 1
            if retry_request_count <= MAX_RETRY_REQUEST:
                time.sleep(1)
                continue

        if response.status_code >= 502 and response.status_code <= 504 and attempt < MAX_TRANSPORT_RETRIES:
            time.sleep(attempt)
            continue

        return {
            "status": response.status_code,
            "headers": resp_headers,
            "body": resp_body,
            "duration": duration,
        }

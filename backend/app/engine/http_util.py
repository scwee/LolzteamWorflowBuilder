"""Safe outbound HTTP: SSRF-pinning + hard response-size cap (anti-OOM).

All engine HTTP call sites go through here so that:
- the connection targets a validated/pinned IP (see url_guard),
- redirects are never followed,
- the response body is streamed and aborted once it exceeds a byte cap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.engine.errors import GraphExecutionError
from app.engine.url_guard import outbound_httpx_kwargs, validate_outbound_url
from app.security.request_context import REQUEST_ID_HEADER, get_request_id

MAX_RESPONSE_BYTES = 5 * 1024 * 1024


def _with_request_id(headers: dict[str, str]) -> dict[str, str]:
    """Propagate the current request_id downstream for cross-service correlation."""
    request_id = get_request_id()
    if request_id and request_id != "-" and not any(k.lower() == REQUEST_ID_HEADER.lower() for k in headers):
        headers = {**headers, REQUEST_ID_HEADER: request_id}
    return headers


@dataclass
class CappedResponse:
    status_code: int
    headers: dict[str, str]
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        import json as _json

        return _json.loads(self.content.decode("utf-8"))


def _check_declared_length(headers: httpx.Headers, max_bytes: int) -> None:
    declared = headers.get("content-length")
    if declared:
        try:
            if int(declared) > max_bytes:
                raise GraphExecutionError(
                    f"Response too large (declared {declared} > {max_bytes} bytes)"
                )
        except ValueError:
            pass


def _prepare(url: str, headers: dict[str, str] | None, pin: bool) -> tuple[str, dict[str, str], dict]:
    headers = _with_request_id(dict(headers or {}))
    if pin:
        kwargs = outbound_httpx_kwargs(url, headers)
        return str(kwargs["url"]), dict(kwargs["headers"]), dict(kwargs.get("extensions") or {})
    validate_outbound_url(url)
    return url, headers, {}


def request_capped(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json: Any | None = None,
    content: bytes | None = None,
    timeout: float = 30.0,
    verify: bool = True,
    proxy: str | None = None,
    max_bytes: int = MAX_RESPONSE_BYTES,
    pin: bool = True,
) -> CappedResponse:
    # Pinning rewrites the URL to an IP; it is incompatible with tunneling through a proxy,
    # so when a proxy is configured we validate the URL but skip the IP rewrite.
    do_pin = pin and not proxy
    req_url, req_headers, extensions = _prepare(url, headers, do_pin)

    client_kwargs: dict[str, Any] = {"timeout": timeout, "verify": verify}
    if proxy:
        client_kwargs["proxy"] = proxy

    with httpx.Client(**client_kwargs) as client:
        with client.stream(
            method,
            req_url,
            headers=req_headers,
            params=params,
            json=json,
            content=content,
            follow_redirects=False,
            extensions=extensions,
        ) as response:
            _check_declared_length(response.headers, max_bytes)
            body = bytearray()
            for chunk in response.iter_bytes():
                if len(body) + len(chunk) > max_bytes:
                    raise GraphExecutionError(f"Response exceeded {max_bytes} bytes")
                body.extend(chunk)
            return CappedResponse(response.status_code, dict(response.headers), bytes(body))


async def request_capped_async(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json: Any | None = None,
    timeout: float = 30.0,
    max_bytes: int = MAX_RESPONSE_BYTES,
    pin: bool = True,
) -> CappedResponse:
    req_url, req_headers, extensions = _prepare(url, headers, pin)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            method,
            req_url,
            headers=req_headers,
            params=params,
            json=json,
            follow_redirects=False,
            extensions=extensions,
        ) as response:
            _check_declared_length(response.headers, max_bytes)
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > max_bytes:
                    raise GraphExecutionError(f"Response exceeded {max_bytes} bytes")
                body.extend(chunk)
            return CappedResponse(response.status_code, dict(response.headers), bytes(body))

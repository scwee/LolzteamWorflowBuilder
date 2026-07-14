"""Outbound URL / proxy SSRF guards."""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse

from app.engine.errors import GraphExecutionError

BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata.google.internal",
    "metadata.google",
    # Docker Compose service names / common internal aliases
    "api",
    "web",
    "worker",
    "beat",
    "nginx",
    "postgres",
    "redis",
    "db",
    "database",
    "mysql",
    "mongo",
    "mongodb",
    "rabbitmq",
    "kafka",
    "minio",
}

BLOCKED_METADATA_IPS = {
    ipaddress.ip_address("169.254.169.254"),
    ipaddress.ip_address("fd00:ec2::254"),
}

HTTP_SCHEMES = {"http", "https"}
PROXY_SCHEMES = {"http", "https", "socks4", "socks5", "socks5h"}


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or ip in BLOCKED_METADATA_IPS
    )


def _resolve_host_ips(hostname: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise GraphExecutionError(f"Unable to resolve host: {hostname}") from exc

    ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip not in ips:
            ips.append(ip)
    if not ips:
        raise GraphExecutionError(f"Unable to resolve host: {hostname}")
    return ips


def _assert_hostname_allowed(host: str) -> None:
    host = host.lower().rstrip(".")
    if host in BLOCKED_HOSTNAMES or host.endswith(".localhost"):
        raise GraphExecutionError("Requests to localhost / internal hosts are not allowed")

    if host.endswith(".internal") or host.endswith(".local") or host.endswith(".lan"):
        raise GraphExecutionError("Requests to internal hostnames are not allowed")

    # Single-label names (no dot) resolve via Docker/search domains → SSRF risk
    if "." not in host:
        try:
            ipaddress.ip_address(host)
        except ValueError as exc:
            raise GraphExecutionError(
                "Single-label hostnames are not allowed (use a public FQDN or IP)"
            ) from exc


def _assert_resolved_safe(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        literal_ip = ipaddress.ip_address(host)
        if _is_blocked_ip(literal_ip):
            raise GraphExecutionError("Requests to private or metadata IPs are not allowed")
        return [literal_ip]
    except ValueError:
        pass

    ips = _resolve_host_ips(host)
    for ip in ips:
        if _is_blocked_ip(ip):
            raise GraphExecutionError("Requests to private or metadata IPs are not allowed")
    return ips


def validate_outbound_url(url: str) -> str:
    if not url or not isinstance(url, str):
        raise GraphExecutionError("HTTP request requires a valid URL")

    parsed = urlparse(url.strip())
    if parsed.scheme not in HTTP_SCHEMES:
        raise GraphExecutionError("Only http and https URLs are allowed")

    hostname = parsed.hostname
    if not hostname:
        raise GraphExecutionError("URL must include a hostname")

    _assert_hostname_allowed(hostname)
    _assert_resolved_safe(hostname.lower().rstrip("."))
    return url.strip()


def validate_proxy_url(proxy: str) -> str:
    """Validate user-controlled HTTP/SOCKS proxy URL (blocks internal SSRF targets)."""
    if not proxy or not isinstance(proxy, str):
        raise GraphExecutionError("Proxy URL is required")

    raw = proxy.strip()
    parsed = urlparse(raw)
    if parsed.scheme not in PROXY_SCHEMES:
        raise GraphExecutionError("Proxy must use http, https, socks4, socks5, or socks5h")

    hostname = parsed.hostname
    if not hostname:
        raise GraphExecutionError("Proxy URL must include a hostname")

    _assert_hostname_allowed(hostname)
    _assert_resolved_safe(hostname.lower().rstrip("."))
    return raw


@dataclass(frozen=True)
class PinnedOutbound:
    """URL rewritten to a pinned public IP to reduce DNS-rebinding TOCTOU."""

    connect_url: str
    host_header: str | None
    server_hostname: str | None  # for TLS SNI
    pinned_ip: str


def pin_outbound_url(url: str) -> PinnedOutbound:
    """Validate URL, resolve once, rewrite to pinned IP + Host/SNI of original hostname."""
    validated = validate_outbound_url(url)
    parsed = urlparse(validated)
    host = (parsed.hostname or "").lower().rstrip(".")
    ips = _assert_resolved_safe(host)
    pinned = ips[0]
    pinned_str = str(pinned)

    # Re-resolve and require the pinned IP still present (narrows rebinding window)
    ips_again = _assert_resolved_safe(host)
    if pinned not in ips_again:
        raise GraphExecutionError("DNS resolution changed; refusing request (possible rebinding)")

    try:
        literal = ipaddress.ip_address(host)
        is_literal = True
        _ = literal
    except ValueError:
        is_literal = False

    if is_literal:
        return PinnedOutbound(
            connect_url=validated,
            host_header=None,
            server_hostname=None,
            pinned_ip=pinned_str,
        )

    # Rebuild netloc with pinned IP, preserve port / userinfo
    userinfo = ""
    if parsed.username is not None:
        userinfo = parsed.username
        if parsed.password is not None:
            userinfo += f":{parsed.password}"
        userinfo += "@"

    port = parsed.port
    if pinned.version == 6:
        host_part = f"[{pinned_str}]"
    else:
        host_part = pinned_str
    if port:
        netloc = f"{userinfo}{host_part}:{port}"
    else:
        netloc = f"{userinfo}{host_part}"

    connect_url = urlunparse(
        (parsed.scheme, netloc, parsed.path or "", parsed.params, parsed.query, parsed.fragment)
    )
    return PinnedOutbound(
        connect_url=connect_url,
        host_header=host,
        server_hostname=host if parsed.scheme == "https" else None,
        pinned_ip=pinned_str,
    )


def httpx_request_args(url: str) -> tuple[str, dict[str, str], str | None]:
    """Return (connect_url, headers, tls_server_hostname) for a safe outbound call."""
    pinned = pin_outbound_url(url)
    headers: dict[str, str] = {}
    if pinned.host_header:
        headers["Host"] = pinned.host_header
    return pinned.connect_url, headers, pinned.server_hostname


def outbound_httpx_kwargs(
    url: str, headers: dict[str, str] | None = None
) -> dict[str, object]:
    """Build httpx request kwargs that connect to a pinned IP.

    Prevents DNS-rebinding TOCTOU: the URL is rewritten to the validated IP, while the
    original hostname is preserved for the Host header and TLS SNI/cert verification.
    """
    pinned = pin_outbound_url(url)
    merged: dict[str, str] = {
        str(k): str(v) for k, v in (headers or {}).items() if k.lower() != "host"
    }
    if pinned.host_header:
        merged["Host"] = pinned.host_header

    kwargs: dict[str, object] = {"url": pinned.connect_url, "headers": merged}
    if pinned.server_hostname:
        kwargs["extensions"] = {"sni_hostname": pinned.server_hostname}
    return kwargs

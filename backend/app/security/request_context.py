"""Per-request correlation id (request_id) shared across the request lifecycle.

The id is stored in a ContextVar so that any code (route handlers, engine,
logging) can read the current request's id without threading it through call
signatures. It is also injected into log records via `RequestIdLogFilter`.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar

REQUEST_ID_HEADER = "X-Request-ID"
# Accept a client-supplied id only if it looks sane; otherwise generate our own.
_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,128}$")

_request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


def new_request_id() -> str:
    return uuid.uuid4().hex


def normalize_request_id(value: str | None) -> str:
    """Return a safe request id: the client value if valid, else a fresh one."""
    if value and _ID_RE.match(value):
        return value
    return new_request_id()


def set_request_id(value: str) -> object:
    return _request_id_var.set(value)


def reset_request_id(token: object) -> None:
    try:
        _request_id_var.reset(token)  # type: ignore[arg-type]
    except (ValueError, LookupError):
        pass


def get_request_id() -> str:
    return _request_id_var.get()


class RequestIdLogFilter(logging.Filter):
    """Attach the current request_id to every log record for correlation."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True

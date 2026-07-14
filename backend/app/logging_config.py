"""Root logging setup that stamps every record with the current request_id."""

from __future__ import annotations

import logging

from app.security.request_context import RequestIdLogFilter

_LOG_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"
_configured = False


def configure_logging(level: int = logging.INFO) -> None:
    global _configured
    if _configured:
        return
    _configured = True

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    handler.addFilter(RequestIdLogFilter())

    root = logging.getLogger()
    root.setLevel(level)
    # Replace default handlers so the request_id filter/format always applies.
    root.handlers = [handler]

    # uvicorn keeps its own handlers; route them through ours for consistent format.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True

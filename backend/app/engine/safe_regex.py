"""ReDoS-hardened regex helpers.

User-controlled patterns run in a shared worker pool, so catastrophic backtracking would
otherwise stall every tenant on that worker. The stdlib `re` engine holds the GIL for the
whole match, so a thread-based timeout cannot actually interrupt it. We therefore use the
third-party `regex` engine, which supports a real `timeout=` that is checked *during*
matching and raises `TimeoutError`. We also cap pattern/input size and concurrency.
"""

from __future__ import annotations

import threading
from typing import Pattern

import regex as _regex

MAX_PATTERN_LEN = 1000
MAX_INPUT_LEN = 200_000
REGEX_TIMEOUT_SECONDS = 2.0
MAX_CONCURRENT_REGEX = 8

_regex_gate = threading.Semaphore(MAX_CONCURRENT_REGEX)


class RegexGuardError(ValueError):
    """Raised when a regex is rejected or exceeds the execution budget."""


def compile_pattern(pattern: str, flags: int = 0) -> Pattern[str]:
    if not isinstance(pattern, str):
        raise RegexGuardError("Regex pattern must be a string")
    if len(pattern) > MAX_PATTERN_LEN:
        raise RegexGuardError(f"Regex pattern too long (max {MAX_PATTERN_LEN})")
    try:
        return _regex.compile(pattern, flags)
    except _regex.error as exc:
        raise RegexGuardError(f"Invalid regex: {exc}") from exc


def _guarded(func_name: str, regex_obj: Pattern[str], text: str):
    if not _regex_gate.acquire(blocking=False):
        raise RegexGuardError("Too many regex evaluations in progress; try again later")
    try:
        method = getattr(regex_obj, func_name)
        return method(text[:MAX_INPUT_LEN], timeout=REGEX_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise RegexGuardError("Regex execution timed out (possible ReDoS)") from exc
    finally:
        _regex_gate.release()


def safe_search(pattern: str, text: str, flags: int = 0):
    return _guarded("search", compile_pattern(pattern, flags), str(text))


def safe_finditer(pattern: str, text: str, flags: int = 0) -> list:
    regex_obj = compile_pattern(pattern, flags)
    if not _regex_gate.acquire(blocking=False):
        raise RegexGuardError("Too many regex evaluations in progress; try again later")
    try:
        return list(regex_obj.finditer(str(text)[:MAX_INPUT_LEN], timeout=REGEX_TIMEOUT_SECONDS))
    except TimeoutError as exc:
        raise RegexGuardError("Regex execution timed out (possible ReDoS)") from exc
    finally:
        _regex_gate.release()

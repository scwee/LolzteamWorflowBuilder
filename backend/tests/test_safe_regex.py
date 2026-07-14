import pytest

from app.engine.safe_regex import (
    MAX_PATTERN_LEN,
    RegexGuardError,
    safe_finditer,
    safe_search,
)


def test_safe_search_matches():
    match = safe_search(r"(?P<value>\d+)", "order 12345 done")
    assert match is not None
    assert match.group("value") == "12345"


def test_safe_finditer_returns_all():
    matches = safe_finditer(r"\d+", "1 a 22 b 333")
    assert [m.group(0) for m in matches] == ["1", "22", "333"]


def test_invalid_pattern_rejected():
    with pytest.raises(RegexGuardError):
        safe_search(r"(unclosed", "text")


def test_pattern_length_capped():
    with pytest.raises(RegexGuardError):
        safe_search("a" * (MAX_PATTERN_LEN + 1), "text")


def test_catastrophic_pattern_is_bounded():
    """A classic catastrophic pattern must not hang the worker.

    The `regex` engine resists most ReDoS by construction; when it cannot, the
    built-in timeout raises RegexGuardError. Either way the call returns quickly.
    """
    import time

    start = time.time()
    try:
        safe_search(r"(a+)+$", "a" * 40 + "b")
    except RegexGuardError:
        pass
    assert time.time() - start < 5.0


def test_input_is_truncated():
    from app.engine.safe_regex import MAX_INPUT_LEN

    # Should not raise or hang on very long input.
    assert safe_search(r"z", "a" * (MAX_INPUT_LEN + 1000)) is None

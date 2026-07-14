"""Utility nodes: delay, variables, parse, pick value."""

from __future__ import annotations

import re
from typing import Any

from app.engine.interpolator import TEMPLATE_PATTERN, interpolate_value, resolve_path
from app.engine.safe_regex import RegexGuardError, safe_finditer, safe_search


def resolve_delay_seconds(data: dict[str, Any]) -> float:
    if data.get("delayMs") is not None or data.get("delay_ms") is not None:
        ms = float(data.get("delayMs") if data.get("delayMs") is not None else data.get("delay_ms"))
        seconds = ms / 1000.0
    else:
        seconds = float(data.get("seconds") or data.get("delay_seconds") or 1)
    return max(0.0, min(seconds, 600.0))


def _parse_assignments(raw: Any) -> dict[str, str]:
    if isinstance(raw, dict):
        return {str(k): "" if v is None else str(v) for k, v in raw.items()}
    text = str(raw or "")
    result: dict[str, str] = {}
    for line in text.replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        key = key.strip()
        if key:
            result[key] = value.strip()
    return result


def run_set_variables(data: dict[str, Any], template_context: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    assignments = _parse_assignments(data.get("assignments") or data.get("variables") or "")
    updated = dict(variables)
    applied: dict[str, Any] = {}
    for key, raw_value in assignments.items():
        value = interpolate_value(raw_value, {**template_context, "vars": updated, "variables": updated})
        updated[key] = value
        applied[key] = value
    return {
        "response": {"set": applied, "variables": updated},
        "variables": updated,
        "logs": [f"Set variables: {', '.join(applied.keys()) or '(empty)'}"],
    }


PRESET_PATTERNS = {
    "url": r"(?P<value>https?://[^\s<>\"']+)",
    "code_hash": r"(?P<value>#[A-Za-z0-9_-]+)",
    "code_alnum": r"(?P<value>\b[A-Z0-9]{4,}\b)",
    "email": r"(?P<value>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})",
    "number": r"(?P<value>\d+(?:[.,]\d+)?)",
}


def run_parse_message(data: dict[str, Any], template_context: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    source = interpolate_value(str(data.get("source") or "{{ message.text }}"), template_context)
    if source is None:
        source = ""
    source = str(source)

    preset = str(data.get("preset") or "custom")
    pattern = str(data.get("pattern") or "")
    if preset != "custom" and preset in PRESET_PATTERNS:
        pattern = PRESET_PATTERNS[preset]
    if not pattern:
        pattern = PRESET_PATTERNS["url"]

    flags = re.IGNORECASE if data.get("ignore_case", True) else 0
    match_all = bool(data.get("match_all", False))
    output_key = str(data.get("output_key") or "value")

    # ReDoS guard: size caps + wall-clock timeout for user-controlled patterns
    try:
        if match_all:
            matches = safe_finditer(pattern, source, flags)
        else:
            single_match = safe_search(pattern, source, flags)
    except RegexGuardError as exc:
        return {
            "response": {"matched": False, "error": str(exc), "source": source},
            "logs": [f"Parse regex error: {exc}"],
            "failed": True,
        }

    updated = dict(variables)
    groups: dict[str, Any] = {}
    values: list[str] = []

    if match_all:
        for match in matches:
            if match.groupdict():
                for key, val in match.groupdict().items():
                    if val is not None:
                        groups.setdefault(key, [])
                        if isinstance(groups[key], list):
                            groups[key].append(val)
                        values.append(val)
            elif match.groups():
                values.extend([g for g in match.groups() if g is not None])
            else:
                values.append(match.group(0))
        primary = values[0] if values else None
        if output_key:
            updated[output_key] = values if len(values) != 1 else primary
        for key, val in groups.items():
            updated[key] = val if len(val) != 1 else val[0]
    else:
        match = single_match
        if not match:
            return {
                "response": {"matched": False, "source": source, "pattern": pattern},
                "variables": updated,
                "logs": ["Parse: no match"],
            }
        if match.groupdict():
            groups = {k: v for k, v in match.groupdict().items() if v is not None}
            primary = groups.get("value") or next(iter(groups.values()), match.group(0))
        elif match.groups():
            primary = match.group(1)
            groups = {f"group_{i}": g for i, g in enumerate(match.groups(), start=1) if g is not None}
        else:
            primary = match.group(0)
        values = [primary] if primary is not None else []
        if output_key and primary is not None:
            updated[output_key] = primary
        updated.update(groups)

    return {
        "response": {
            "matched": True,
            "value": values[0] if values else None,
            "values": values,
            "groups": groups,
            "source": source,
            "pattern": pattern,
        },
        "variables": updated,
        "logs": [f"Parse matched: {values[:3]}"],
    }


def _coerce_number(value: Any) -> float | None:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _element_field(element: Any, field: str) -> Any:
    if not field:
        return element
    return resolve_path({"__": element}, f"__.{field}")


def _matches_condition(left: Any, operator: str, value: Any) -> bool:
    op = operator or "truthy"
    if op == "truthy":
        return bool(left)
    if op == "falsy":
        return not bool(left)
    if op == "eq":
        return str(left) == str(value)
    if op == "ne":
        return str(left) != str(value)
    if op == "contains":
        return str(value) in str(left)
    if op == "not_contains":
        return str(value) not in str(left)
    if op in {"gt", "lt", "gte", "lte"}:
        left_num, value_num = _coerce_number(left), _coerce_number(value)
        if left_num is None or value_num is None:
            return False
        return {
            "gt": left_num > value_num,
            "lt": left_num < value_num,
            "gte": left_num >= value_num,
            "lte": left_num <= value_num,
        }[op]
    if op == "matches":
        try:
            return safe_search(str(value), str(left), re.IGNORECASE) is not None
        except RegexGuardError:
            return False
    return False


def _resolve_array(source: Any, template_context: dict[str, Any], variables: dict[str, Any]) -> list[Any]:
    context = {**template_context, "vars": variables, "variables": variables}
    if isinstance(source, list):
        resolved: Any = source
    else:
        text = str(source or "").strip()
        match = TEMPLATE_PATTERN.fullmatch(text) if text else None
        path = match.group(1).strip() if match else text
        resolved = resolve_path(context, path) if path else None
        if resolved is None and source:
            resolved = interpolate_value(source, context)
    if isinstance(resolved, list):
        return resolved
    if resolved is None:
        return []
    return [resolved]


def run_filter(data: dict[str, Any], template_context: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    items = _resolve_array(data.get("source"), template_context, variables)
    operator = str(data.get("operator") or "truthy")
    field = str(data.get("field") or "").strip()
    output_key = str(data.get("output_key") or "filtered")
    raw_value = data.get("value")
    value = interpolate_value(raw_value, {**template_context, "vars": variables}) if raw_value is not None else None

    kept: list[Any] = []
    dropped = 0
    for element in items:
        left = _element_field(element, field)
        if _matches_condition(left, operator, value):
            kept.append(element)
        else:
            dropped += 1

    updated = dict(variables)
    updated[output_key] = kept
    return {
        "response": {
            "items": kept,
            "count": len(kept),
            "dropped": dropped,
            "input_count": len(items),
        },
        "variables": updated,
        "logs": [f"Filter: {len(kept)} оставлено, {dropped} отброшено"],
    }


def run_aggregate(data: dict[str, Any], template_context: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    items = _resolve_array(data.get("source"), template_context, variables)
    operation = str(data.get("operation") or "count")
    field = str(data.get("field") or "").strip()
    output_key = str(data.get("output_key") or "result")
    separator = data.get("separator")
    separator = "\n" if separator is None else str(separator)

    values = [_element_field(el, field) for el in items] if field else list(items)

    result: Any
    if operation == "count":
        result = len(items)
    elif operation == "unique":
        seen: set[str] = set()
        unique: list[Any] = []
        for v in values:
            key = str(v)
            if key not in seen:
                seen.add(key)
                unique.append(v)
        result = unique
    elif operation == "join":
        result = separator.join(str(v) for v in values if v is not None)
    elif operation in {"sum", "min", "max", "avg"}:
        nums = [n for n in (_coerce_number(v) for v in values) if n is not None]
        if not nums:
            result = 0
        elif operation == "sum":
            result = sum(nums)
        elif operation == "min":
            result = min(nums)
        elif operation == "max":
            result = max(nums)
        else:
            result = sum(nums) / len(nums)
    elif operation == "first":
        result = values[0] if values else None
    elif operation == "last":
        result = values[-1] if values else None
    else:
        result = len(items)

    updated = dict(variables)
    updated[output_key] = result
    return {
        "response": {
            "operation": operation,
            "value": result,
            "input_count": len(items),
        },
        "variables": updated,
        "logs": [f"Aggregate {operation} → {output_key}"],
    }


def _normalize_pick_path(path: str) -> str:
    """Accept both raw paths and {{ node.path }} templates from the UI."""
    stripped = path.strip()
    match = TEMPLATE_PATTERN.fullmatch(stripped)
    if match:
        return match.group(1).strip()
    return stripped


def run_pick_value(data: dict[str, Any], template_context: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
    path = _normalize_pick_path(str(data.get("path") or data.get("value_path") or ""))
    array_index = data.get("array_index")
    join_with = data.get("join_with")
    output_key = str(data.get("output_key") or "value")

    context = {**template_context, "vars": variables, "variables": variables}
    raw = resolve_path(context, path) if path else None

    selected: Any = raw
    if isinstance(raw, list):
        if join_with is not None and str(join_with) != "":
            selected = str(join_with).join(str(item) for item in raw)
        elif array_index not in (None, ""):
            try:
                idx = int(array_index)
                selected = raw[idx] if 0 <= idx < len(raw) else None
            except (TypeError, ValueError):
                selected = raw[0] if raw else None
        else:
            selected = raw[0] if raw else None

    updated = dict(variables)
    updated[output_key] = selected

    return {
        "response": {
            "path": path,
            "value": selected,
            "raw_type": type(raw).__name__ if raw is not None else None,
            "is_array": isinstance(raw, list),
            "array_length": len(raw) if isinstance(raw, list) else None,
        },
        "variables": updated,
        "value": selected,
        "logs": [f"Pick {path or '(empty)'} → {output_key}={selected!r}"],
    }

import json
import re
from typing import Any

TEMPLATE_PATTERN = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


def _split_path(path: str) -> list[str]:
    parts: list[str] = []
    buffer = ""
    i = 0
    while i < len(path):
        char = path[i]
        if char == ".":
            if buffer:
                parts.append(buffer)
                buffer = ""
            i += 1
            continue
        if char == "[":
            if buffer:
                parts.append(buffer)
                buffer = ""
            closing = path.find("]", i)
            if closing == -1:
                parts.append(path[i:])
                break
            parts.append(path[i + 1 : closing])
            i = closing + 1
            continue
        buffer += char
        i += 1
    if buffer:
        parts.append(buffer)
    return parts


def _resolve_path(context: dict[str, Any], path: str) -> Any:
    current: Any = context
    for part in _split_path(path):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            index = int(part)
            current = current[index] if 0 <= index < len(current) else None
        else:
            return None
    return current


def resolve_path(context: dict[str, Any], path: str) -> Any:
    return _resolve_path(context, path)


def interpolate_value(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        full_match = TEMPLATE_PATTERN.fullmatch(stripped)
        if full_match:
            resolved = _resolve_path(context, full_match.group(1).strip())
            return resolved if resolved is not None else value

        def replacer(match: re.Match[str]) -> str:
            resolved = _resolve_path(context, match.group(1).strip())
            if resolved is None:
                return match.group(0)
            if isinstance(resolved, (dict, list)):
                return json.dumps(resolved, ensure_ascii=False)
            return str(resolved)

        return TEMPLATE_PATTERN.sub(replacer, value)
    if isinstance(value, dict):
        return {key: interpolate_value(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [interpolate_value(item, context) for item in value]
    return value


def build_template_context(
    node_results: dict[str, dict[str, Any]],
    *,
    extra: dict[str, Any] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    context = {node_id: result for node_id, result in node_results.items()}
    vars_map = variables or {}
    context["vars"] = vars_map
    context["variables"] = vars_map
    if extra:
        context.update(extra)
        # keep vars accessible even if extra overwrites keys carefully
        if "vars" not in extra:
            context["vars"] = vars_map
        if "variables" not in extra:
            context["variables"] = vars_map
    return context


def make_context(state: Any, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return build_template_context(
        getattr(state, "node_results", {}) or {},
        variables=getattr(state, "variables", {}) or {},
        extra=extra,
    )

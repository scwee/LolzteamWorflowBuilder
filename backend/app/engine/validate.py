"""Static graph validation with human-readable RU messages."""

from __future__ import annotations

import re
from typing import Any

from app.flows.schemas import NODE_TYPES as BUILTIN_NODE_TYPES

# OpenAPI custom nodes use slugs like custom_get_users; also allow simple snake_case.
CUSTOM_SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{0,127}$")


def validate_graph(graph: dict[str, Any] | None) -> list[str]:
    errors: list[str] = []
    if not graph or not isinstance(graph, dict):
        return ["Граф пуст или имеет неверный формат"]

    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ["Граф имеет неверный формат: nodes/edges должны быть списками"]

    if not nodes:
        errors.append("Граф пуст: добавьте хотя бы один узел")
        return errors

    has_start = False
    has_webhook = False
    for node in nodes:
        if not isinstance(node, dict):
            errors.append("Узел имеет неверный формат")
            continue
        node_id = str(node.get("id") or "?")
        node_type = str(node.get("type") or "")

        if node_type == "flow_start":
            has_start = True
        if node_type == "webhook_trigger":
            has_webhook = True

        if node_type and node_type not in BUILTIN_NODE_TYPES and not CUSTOM_SLUG_RE.match(node_type):
            errors.append(f"Неизвестный тип узла «{node_type}» (узел {node_id})")

        if node_type == "execute_flow":
            data = node.get("data") or {}
            flow_id = data.get("flow_id") if isinstance(data, dict) else None
            if not flow_id:
                errors.append(f"Узел execute_flow «{node_id}» не содержит flow_id")

    if not has_start and not has_webhook:
        errors.append("В графе нет триггера: добавьте Старт или Webhook")

    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "if_condition":
            continue
        node_id = str(node.get("id") or "?")
        outgoing = [e for e in edges if isinstance(e, dict) and e.get("source") == node.get("id")]
        handles = {(e.get("source_handle") or "true") for e in outgoing}
        if "true" not in handles or "false" not in handles:
            errors.append(
                f"Предупреждение: узел IF «{node_id}» не имеет исходящих веток true и false"
            )

    return errors

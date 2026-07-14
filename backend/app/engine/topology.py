import logging
from collections import defaultdict, deque
from typing import Any

from app.engine.errors import GraphExecutionError
from app.flows.schemas import BRANCHING_NODE_TYPES, FlowGraph, GraphEdge, GraphNode

logger = logging.getLogger(__name__)

__all__ = ["GraphExecutionError", "topological_sort", "parse_flow_graph", "graph_needs_traversal", "get_execution_order", "get_next_nodes"]


def topological_sort(nodes: list[GraphNode], edges: list[GraphEdge]) -> list[GraphNode]:
    node_map = {node.id: node for node in nodes}
    in_degree: dict[str, int] = {node.id: 0 for node in nodes}
    adjacency: dict[str, list[str]] = defaultdict(list)

    for edge in edges:
        if edge.source not in node_map or edge.target not in node_map:
            raise GraphExecutionError(f"Unknown node in edge {edge.id}")
        adjacency[edge.source].append(edge.target)
        in_degree[edge.target] += 1

    queue = deque([node_id for node_id, degree in in_degree.items() if degree == 0])
    ordered_ids: list[str] = []

    while queue:
        node_id = queue.popleft()
        ordered_ids.append(node_id)
        for target in adjacency[node_id]:
            in_degree[target] -= 1
            if in_degree[target] == 0:
                queue.append(target)

    if len(ordered_ids) != len(nodes):
        raise GraphExecutionError("Graph contains a cycle")

    return [node_map[node_id] for node_id in ordered_ids]


def _has_branching(nodes: list[GraphNode]) -> bool:
    return any(node.type in BRANCHING_NODE_TYPES for node in nodes)


_FALSY_TOKENS = {"", "0", "false", "none", "null"}


def _evaluate_single(left_raw: Any, operator: str, right_raw: Any) -> bool:
    left = str(left_raw if left_raw is not None else "")
    right = str(right_raw if right_raw is not None else "")

    if operator == "empty":
        return left.strip() == ""
    if operator == "not_empty":
        return left.strip() != ""
    if operator == "truthy":
        return left.strip().lower() not in _FALSY_TOKENS
    if operator == "falsy":
        return left.strip().lower() in _FALSY_TOKENS
    if operator == "starts_with":
        return left.startswith(right)
    if operator == "ends_with":
        return left.endswith(right)
    if operator == "regex":
        from app.engine.safe_regex import RegexGuardError, safe_search

        try:
            return safe_search(right, left) is not None
        except RegexGuardError as exc:
            logger.warning("if_condition regex rejected: %s", exc)
            return False

    try:
        left_num = float(left)
        right_num = float(right)
        numeric = True
    except ValueError:
        numeric = False

    if operator == "eq":
        return left == right
    if operator == "neq":
        return left != right
    if operator == "gt":
        return numeric and left_num > right_num
    if operator == "gte":
        return numeric and left_num >= right_num
    if operator == "lt":
        return numeric and left_num < right_num
    if operator == "lte":
        return numeric and left_num <= right_num
    if operator == "contains":
        return right in left
    if operator == "not_contains":
        return right not in left
    return False


def _evaluate_condition(data: dict[str, Any]) -> bool:
    conditions = data.get("conditions")
    if isinstance(conditions, list) and conditions:
        match = str(data.get("match") or "all").lower()
        results: list[bool] = []
        for cond in conditions:
            if not isinstance(cond, dict):
                continue
            results.append(
                _evaluate_single(
                    cond.get("subject"),
                    str(cond.get("operator") or "truthy"),
                    cond.get("value"),
                )
            )
        if not results:
            return False
        return any(results) if match == "any" else all(results)

    # Legacy single-condition shape (left/operator/right).
    return _evaluate_single(data.get("left", ""), str(data.get("operator", "eq")), data.get("right", ""))


def _active_edge_handles(node: GraphNode, result: dict[str, Any], outgoing: list[GraphEdge]) -> list[GraphEdge]:
    if node.type == "if_condition":
        handle = "true" if _evaluate_condition(node.data) else "false"
        matched = [edge for edge in outgoing if (edge.source_handle or "true") == handle]
        return matched or outgoing[:1]

    if node.type == "switch":
        value = str(node.data.get("value", ""))
        cases = node.data.get("cases") or []
        if isinstance(cases, str):
            cases = [item.strip() for item in cases.split(",") if item.strip()]
        for index, case_value in enumerate(cases):
            if str(case_value) == value:
                handle = f"case_{index}"
                matched = [edge for edge in outgoing if edge.source_handle == handle]
                if matched:
                    return matched
        default_edges = [edge for edge in outgoing if (edge.source_handle or "default") == "default"]
        return default_edges or outgoing[:1]

    return outgoing


def get_execution_order(nodes: list[GraphNode], edges: list[GraphEdge]) -> list[GraphNode]:
    # Branching graphs are handled by _execute_traversal; this path is linear only.
    return topological_sort(nodes, edges)


def get_next_nodes(
    node: GraphNode,
    result: dict[str, Any],
    edges: list[GraphEdge],
    executed: set[str],
) -> list[str]:
    outgoing = [edge for edge in edges if edge.source == node.id]

    if result.get("failed"):
        error_edges = [edge for edge in outgoing if edge.source_handle == "error"]
        if error_edges:
            return [edge.target for edge in error_edges if edge.target not in executed]

    if node.type in BRANCHING_NODE_TYPES and node.type != "merge":
        active = _active_edge_handles(node, result, outgoing)
        return [edge.target for edge in active if edge.target not in executed]
    return [edge.target for edge in outgoing if edge.target not in executed]


def graph_needs_traversal(nodes: list[GraphNode], edges: list[GraphEdge]) -> bool:
    if _has_branching(nodes):
        return True
    return any(edge.source_handle for edge in edges)


def parse_flow_graph(graph_json: dict[str, Any]) -> FlowGraph:
    return FlowGraph.model_validate(graph_json)

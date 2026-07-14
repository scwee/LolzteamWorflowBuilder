from uuid import UUID

import asyncio
import copy
import json
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app.engine.http_node import run_http_request
from app.engine.interpolator import interpolate_value, make_context
from app.engine.lzt_nodes import run_account_status, run_api_call, run_file_source
from app.engine.openapi_handler import openapi_handler
from app.engine.registry import ExecutionState, registry
from app.engine.topology import (
    GraphExecutionError,
    get_execution_order,
    get_next_nodes,
    graph_needs_traversal,
    parse_flow_graph,
)
from app.engine.utility_nodes import (
    resolve_delay_seconds,
    run_aggregate,
    run_filter,
    run_parse_message,
    run_pick_value,
    run_set_variables,
)
from app.flows.schemas import GraphNode

_thread_pool = ThreadPoolExecutor(max_workers=16)


def shutdown_thread_pool() -> None:
    """Release worker threads on app/worker shutdown (avoids leaked threads on reload)."""
    _thread_pool.shutdown(wait=False, cancel_futures=True)


MAX_SUBFLOW_DEPTH = 3
MAX_FAN_OUT_ITEMS = 2000
DEFAULT_FAN_OUT_PARALLEL = 8


def _append_logs(state: ExecutionState, result: dict[str, Any]) -> None:
    logs = result.get("logs")
    if isinstance(logs, list):
        state.runtime_logs.extend(str(item) for item in logs)


def _apply_variables(state: ExecutionState, result: dict[str, Any]) -> None:
    if isinstance(result.get("variables"), dict):
        state.variables = dict(result["variables"])


class ApiCallHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = interpolate_value(node.data, template_context)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_thread_pool, lambda: run_api_call(data, state))


class FileSourceHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = interpolate_value(node.data, template_context)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_thread_pool, lambda: run_file_source(data, state))


class AccountStatusHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = interpolate_value(node.data, template_context)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_thread_pool, lambda: run_account_status(data, state))


class DelayHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = interpolate_value(node.data, template_context)
        # Non-blocking sleep so a delay node never holds a worker thread hostage.
        seconds = resolve_delay_seconds(data)
        await asyncio.sleep(seconds)
        result = {"response": {"delayed_seconds": seconds}, "logs": [f"Delay {seconds}s"]}
        _append_logs(state, result)
        return result


class FlowStartHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        note = str((node.data or {}).get("note") or "").strip()
        return {
            "response": {"marker": "start", "note": note or None},
            "logs": ["Start"],
        }


class FlowEndHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        note = str((node.data or {}).get("note") or "").strip()
        return {
            "response": {"marker": "end", "note": note or None},
            "logs": ["End"],
        }


class IfConditionHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = interpolate_value(node.data, template_context)
        node.data = {**node.data, **data}
        return {"response": {"evaluated": True, **data}}


class SwitchHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = interpolate_value(node.data, template_context)
        node.data = {**node.data, **data}
        return {"response": {"value": data.get("value"), "cases": data.get("cases")}}


class MergeHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        merged = {node_id: result for node_id, result in state.node_results.items()}
        return {"response": {"merged": merged}}


class ExecuteFlowHandler:
    def __init__(self, owner_user_id: UUID | None = None) -> None:
        self.owner_user_id = owner_user_id

    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        if state.subflow_depth >= MAX_SUBFLOW_DEPTH:
            raise GraphExecutionError("Sub-workflow depth limit exceeded")
        data = interpolate_value(node.data, template_context)
        subflow_id = data.get("flow_id")
        if not subflow_id:
            raise GraphExecutionError("execute_flow requires flow_id")

        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session, sessionmaker

        from app.config import settings
        from app.db.models import Flow
        from app.security.crypto import decrypt_graph_secrets

        engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
        SessionLocal = sessionmaker(bind=engine)
        session: Session = SessionLocal()
        try:
            flow = session.get(Flow, UUID(str(subflow_id)))
            if not flow:
                raise GraphExecutionError(f"Sub-flow not found: {subflow_id}")
            owner_id = state.owner_user_id
            # Fail closed: without a known owner we never grant cross-flow access.
            if not owner_id or flow.user_id != owner_id:
                raise GraphExecutionError("Sub-flow access denied")
            sub_graph = decrypt_graph_secrets(flow.graph_json or {})
            child_state = ExecutionState(
                subflow_depth=state.subflow_depth + 1,
                custom_node_specs=state.custom_node_specs,
                credentials=state.credentials,
                owner_user_id=owner_id,
                lzt_token=state.lzt_token,
                flow_proxy=state.flow_proxy,
            )
            input_context = data.get("input_context") or {}
            if isinstance(input_context, str):
                input_context = json.loads(input_context) if input_context else {}
            if not isinstance(input_context, dict):
                raise GraphExecutionError("input_context must be an object")
            child_state.node_results.update(input_context)
            result = await execute_graph(
                sub_graph,
                state=child_state,
                custom_node_specs=state.custom_node_specs,
                credentials=state.credentials,
            )
            return {"response": result}
        finally:
            session.close()
            engine.dispose()


class WebhookTriggerHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        payload = state.webhook_payload or {}
        return {"response": payload, "logs": ["Webhook trigger"]}


class SetVariablesHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = node.data or {}
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            lambda: run_set_variables(data, template_context, state.variables),
        )


class ParseMessageHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = node.data or {}
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            lambda: run_parse_message(data, template_context, state.variables),
        )


class PickValueHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = node.data or {}
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            lambda: run_pick_value(data, template_context, state.variables),
        )


class HttpRequestHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = node.data or {}
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            lambda: run_http_request(data, template_context),
        )


class FilterHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = node.data or {}
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            lambda: run_filter(data, template_context, state.variables),
        )


class AggregateHandler:
    async def execute(self, node: GraphNode, state: ExecutionState, template_context: dict[str, Any]) -> dict[str, Any]:
        data = node.data or {}
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            lambda: run_aggregate(data, template_context, state.variables),
        )


def _register_builtin_handlers() -> None:
    registry.register("flow_start", FlowStartHandler())
    registry.register("flow_end", FlowEndHandler())
    registry.register("api_call", ApiCallHandler())
    registry.register("file_source", FileSourceHandler())
    registry.register("delay", DelayHandler())
    registry.register("if_condition", IfConditionHandler())
    registry.register("switch", SwitchHandler())
    registry.register("merge", MergeHandler())
    registry.register("execute_flow", ExecuteFlowHandler())
    registry.register("webhook_trigger", WebhookTriggerHandler())
    registry.register("set_variables", SetVariablesHandler())
    registry.register("parse_message", ParseMessageHandler())
    registry.register("pick_value", PickValueHandler())
    registry.register("http_request", HttpRequestHandler())
    registry.register("filter", FilterHandler())
    registry.register("aggregate", AggregateHandler())
    registry.register("account_status", AccountStatusHandler())


_register_builtin_handlers()


def _get_execution_settings(node: GraphNode) -> dict[str, Any]:
    if node.execution:
        return node.execution.model_dump()
    data_settings = node.data.get("_execution") or {}
    return {
        "retry_count": int(data_settings.get("retry_count", 0)),
        "retry_delay_ms": int(data_settings.get("retry_delay_ms", 1000)),
        "continue_on_fail": bool(data_settings.get("continue_on_fail", False)),
    }


async def execute_node(
    node: GraphNode,
    state: ExecutionState,
    template_context: dict[str, Any],
) -> dict[str, Any]:
    settings = _get_execution_settings(node)
    last_error: Exception | None = None
    attempts = settings["retry_count"] + 1
    interpolated = GraphNode(
        id=node.id,
        type=node.type,
        data=interpolate_value(node.data, template_context),
        position=node.position,
        execution=node.execution,
    )

    for attempt in range(attempts):
        try:
            if registry.is_builtin(interpolated.type):
                handler = registry.get(interpolated.type)
                if not handler:
                    raise GraphExecutionError(f"No handler for node type: {interpolated.type}")
                exec_node = interpolated
                if interpolated.type in {"if_condition", "switch"}:
                    exec_node = GraphNode(
                        id=node.id,
                        type=node.type,
                        data={**node.data, **interpolated.data},
                        position=node.position,
                        execution=node.execution,
                    )
                    node.data = exec_node.data
                return await handler.execute(exec_node, state, template_context)
            if interpolated.type in state.custom_node_specs:
                return await openapi_handler.execute(interpolated, state, template_context)
            raise GraphExecutionError(f"Unsupported node type: {interpolated.type}")
        except Exception as exc:
            last_error = exc
            if attempt < attempts - 1:
                await asyncio.sleep(settings["retry_delay_ms"] / 1000)
            elif settings["continue_on_fail"]:
                return {"response": {}, "error": str(exc), "failed": True}

    raise GraphExecutionError(str(last_error))


def _clone_state_for_item(state: ExecutionState, source_node_id: str, item: dict[str, Any]) -> ExecutionState:
    child = ExecutionState(
        node_results=copy.deepcopy(state.node_results),
        lzt_token=state.lzt_token,
        flow_proxy=state.flow_proxy,
        webhook_payload=state.webhook_payload,
        trigger_node_id=state.trigger_node_id,
        trigger_timestamp=state.trigger_timestamp,
        custom_node_specs=state.custom_node_specs,
        credentials=state.credentials,
        subflow_depth=state.subflow_depth,
        owner_user_id=state.owner_user_id,
        variables=copy.deepcopy(state.variables),
    )
    order = item.get("order") if isinstance(item.get("order"), dict) else None
    message = item.get("message") if isinstance(item.get("message"), dict) else None
    response = item.get("response", order or message or item)
    payload: dict[str, Any] = {"response": response}
    for key in ("line", "login", "password", "email", "item_index", "order", "message", "proxy"):
        if key in item:
            payload[key] = item[key]
    child.node_results[source_node_id] = payload
    # Прокси из строки файла имеет приоритет над общим прокси flow для этой итерации.
    item_proxy = item.get("proxy")
    if isinstance(item_proxy, str) and item_proxy.strip():
        from app.engine.url_guard import validate_proxy_url

        try:
            child.flow_proxy = validate_proxy_url(item_proxy.strip())
        except Exception as exc:
            # Битый прокси в строке не должен ронять всю пачку — пропускаем итерацию.
            child.runtime_logs.append(f"Пропущен неверный прокси '{item_proxy}': {exc}")
    return child


async def _execute_nodes_sequence(
    nodes: list[GraphNode],
    state: ExecutionState,
    *,
    extra_context: dict[str, Any] | None = None,
    on_node_complete: Any | None = None,
    should_stop: Any | None = None,
    on_node_start: Any | None = None,
    iteration_suffix: str = "",
) -> dict[str, dict[str, Any]]:
    for node in nodes:
        if should_stop and should_stop():
            raise GraphExecutionError("Flow stopped by user")
        if on_node_start:
            await on_node_start(f"{node.id}{iteration_suffix}", node.type)
        template_context = make_context(state, extra_context)
        result = await execute_node(node, state, template_context)
        state.node_results[node.id] = result
        _apply_variables(state, result)
        _append_logs(state, result)
        if on_node_complete:
            await on_node_complete(
                f"{node.id}{iteration_suffix}",
                node.type,
                result,
                dict(state.node_results),
                result.get("error"),
            )
    return state.node_results


async def _fan_out_downstream(
    source_node: GraphNode,
    result: dict[str, Any],
    downstream: list[GraphNode],
    state: ExecutionState,
    *,
    on_node_complete: Any | None = None,
    should_stop: Any | None = None,
    on_node_start: Any | None = None,
) -> None:
    items = result.get("_items") or []
    if result.get("_skip_downstream") or not items:
        msg = "Нет элементов для обработки — downstream не запускается"
        if isinstance(result.get("logs"), list) and result["logs"]:
            msg = str(result["logs"][-1])
        state.runtime_logs.append(msg)
        return

    if len(items) > MAX_FAN_OUT_ITEMS:
        raise GraphExecutionError(
            f"Fan-out exceeds {MAX_FAN_OUT_ITEMS} items ({len(items)}); split the input"
        )

    # Always bound concurrency (deepcopy per item is memory-heavy).
    max_parallel = int(result.get("_max_parallel") or DEFAULT_FAN_OUT_PARALLEL)
    max_parallel = max(1, min(max_parallel, DEFAULT_FAN_OUT_PARALLEL * 4))
    semaphore = asyncio.Semaphore(max_parallel)

    async def run_item(index: int, item: dict[str, Any]) -> None:
        async def _inner() -> None:
            child = _clone_state_for_item(state, source_node.id, item)
            order = item.get("order") if isinstance(item.get("order"), dict) else None
            message = item.get("message") if isinstance(item.get("message"), dict) else None
            payload = item.get("response", order or message or item)
            extra: dict[str, Any] = {"item": payload, "item_index": item.get("item_index", index)}
            if order is not None:
                extra["order"] = order
            if message is not None:
                extra["message"] = message
            for key in ("line", "login", "password", "email", "proxy"):
                if key in item:
                    extra[key] = item[key]
            if item.get("line") is not None:
                suffix = f"#line:{index}"
            elif message is not None and order is None:
                suffix = f"#msg:{index}"
            else:
                suffix = f"#order:{index}"
            await _execute_nodes_sequence(
                downstream,
                child,
                extra_context=extra,
                on_node_complete=on_node_complete,
                should_stop=should_stop,
                on_node_start=on_node_start,
                iteration_suffix=suffix,
            )
            state.runtime_logs.extend(child.runtime_logs)
            if child.variables:
                state.variables.update(child.variables)
            if child.lzt_token:
                state.lzt_token = child.lzt_token

        async with semaphore:
            await _inner()

    await asyncio.gather(*[run_item(index, item) for index, item in enumerate(items)])


async def _execute_linear(
    ordered_nodes: list[GraphNode],
    state: ExecutionState,
    edges: list,
    *,
    on_node_complete: Any | None = None,
    should_stop: Any | None = None,
    on_node_start: Any | None = None,
) -> dict[str, dict[str, Any]]:
    index = 0
    while index < len(ordered_nodes):
        node = ordered_nodes[index]
        if should_stop and should_stop():
            raise GraphExecutionError("Flow stopped by user")

        if on_node_start:
            await on_node_start(node.id, node.type)

        template_context = make_context(state)
        result = await execute_node(node, state, template_context)
        state.node_results[node.id] = result
        _apply_variables(state, result)
        _append_logs(state, result)

        if on_node_complete:
            await on_node_complete(node.id, node.type, result, dict(state.node_results), None)

        if result.get("_fan_out"):
            downstream = ordered_nodes[index + 1 :]
            await _fan_out_downstream(
                node,
                result,
                downstream,
                state,
                on_node_complete=on_node_complete,
                should_stop=should_stop,
                on_node_start=on_node_start,
            )
            break

        index += 1

    return state.node_results


async def _execute_traversal(
    nodes: list[GraphNode],
    edges: list,
    state: ExecutionState,
    *,
    on_node_complete: Any | None = None,
    should_stop: Any | None = None,
    on_node_start: Any | None = None,
) -> dict[str, dict[str, Any]]:
    node_map = {node.id: node for node in nodes}
    in_degree: dict[str, int] = {node.id: 0 for node in nodes}
    for edge in edges:
        in_degree[edge.target] += 1

    queue: deque[str] = deque([node_id for node_id, degree in in_degree.items() if degree == 0])
    executed: set[str] = set()
    pending: deque[str] = deque()
    skipped: set[str] = set()

    while queue or pending:
        if not queue and pending:
            queue = pending
            pending = deque()

        node_id = queue.popleft()
        if node_id in executed or node_id in skipped:
            continue

        node = node_map[node_id]
        if node.type == "merge":
            parents = [edge.source for edge in edges if edge.target == node_id]
            mode = str((node.data or {}).get("mode") or "all")
            if parents:
                ready = [parent for parent in parents if parent in executed or parent in skipped]
                if mode == "any":
                    if not ready:
                        pending.append(node_id)
                        continue
                elif not all(parent in executed or parent in skipped for parent in parents):
                    pending.append(node_id)
                    continue

        if should_stop and should_stop():
            raise GraphExecutionError("Flow stopped by user")

        if on_node_start:
            await on_node_start(node.id, node.type)

        template_context = make_context(state)
        error_msg = None
        try:
            result = await execute_node(node, state, template_context)
        except Exception as exc:
            settings = _get_execution_settings(node)
            if settings["continue_on_fail"]:
                result = {"response": {}, "error": str(exc), "failed": True}
                error_msg = str(exc)
            else:
                raise

        state.node_results[node.id] = result
        executed.add(node_id)
        _apply_variables(state, result)
        _append_logs(state, result)

        if on_node_complete:
            await on_node_complete(node.id, node.type, result, dict(state.node_results), error_msg)

        if result.get("_fan_out"):
            downstream_ids: list[str] = []
            walk: deque[str] = deque(get_next_nodes(node, result, edges, executed))
            seen_walk = set(executed)
            while walk:
                nxt = walk.popleft()
                if nxt in seen_walk or nxt in skipped:
                    continue
                seen_walk.add(nxt)
                downstream_ids.append(nxt)
                walk.extend(get_next_nodes(node_map[nxt], {"response": {}}, edges, seen_walk))

            downstream_nodes = [node_map[nid] for nid in downstream_ids if nid in node_map]
            await _fan_out_downstream(
                node,
                result,
                downstream_nodes,
                state,
                on_node_complete=on_node_complete,
                should_stop=should_stop,
                on_node_start=on_node_start,
            )
            skipped.update(downstream_ids)
            continue

        for next_id in get_next_nodes(node, result, edges, executed):
            if next_id not in executed and next_id not in skipped and next_id not in queue and next_id not in pending:
                queue.append(next_id)

    return state.node_results


async def execute_graph(
    graph_json: dict[str, Any],
    *,
    webhook_payload: dict[str, Any] | None = None,
    trigger_node_id: str | None = None,
    trigger_timestamp: str | None = None,
    on_node_complete: Any | None = None,
    on_node_start: Any | None = None,
    should_stop: Any | None = None,
    state: ExecutionState | None = None,
    custom_node_specs: dict[str, dict[str, Any]] | None = None,
    credentials: dict[str, dict[str, Any]] | None = None,
    owner_user_id: UUID | None = None,
) -> dict[str, dict[str, Any]]:
    graph = parse_flow_graph(graph_json)
    exec_state = state or ExecutionState(
        webhook_payload=webhook_payload,
        trigger_node_id=trigger_node_id,
        trigger_timestamp=trigger_timestamp,
        owner_user_id=owner_user_id,
    )
    if owner_user_id and not exec_state.owner_user_id:
        exec_state.owner_user_id = owner_user_id
    if custom_node_specs:
        exec_state.custom_node_specs = custom_node_specs
    if credentials:
        exec_state.credentials = credentials

    settings_raw = (graph_json or {}).get("settings") or {}
    if not exec_state.flow_proxy:
        proxy = settings_raw.get("proxy")
        if isinstance(proxy, str) and proxy.strip():
            from app.engine.url_guard import validate_proxy_url

            exec_state.flow_proxy = validate_proxy_url(proxy)

    if graph_needs_traversal(graph.nodes, graph.edges):
        result = await _execute_traversal(
            graph.nodes,
            graph.edges,
            exec_state,
            on_node_complete=on_node_complete,
            on_node_start=on_node_start,
            should_stop=should_stop,
        )
    else:
        ordered_nodes = get_execution_order(graph.nodes, graph.edges)
        result = await _execute_linear(
            ordered_nodes,
            exec_state,
            graph.edges,
            on_node_complete=on_node_complete,
            on_node_start=on_node_start,
            should_stop=should_stop,
        )

    if exec_state.runtime_logs:
        result["__logs"] = {"response": exec_state.runtime_logs, "logs": exec_state.runtime_logs}
    return result

from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

from app.flows.schemas import GraphNode


@dataclass
class ExecutionState:
    node_results: dict[str, dict[str, Any]] = field(default_factory=dict)
    lzt_token: str | None = None
    flow_proxy: str | None = None
    webhook_payload: dict[str, Any] | None = None
    trigger_node_id: str | None = None
    trigger_timestamp: str | None = None
    custom_node_specs: dict[str, dict[str, Any]] = field(default_factory=dict)
    credentials: dict[str, dict[str, Any]] = field(default_factory=dict)
    subflow_depth: int = 0
    owner_user_id: UUID | None = None
    variables: dict[str, Any] = field(default_factory=dict)
    runtime_logs: list[str] = field(default_factory=list)


class NodeHandler(Protocol):
    async def execute(
        self,
        node: GraphNode,
        state: ExecutionState,
        template_context: dict[str, Any],
    ) -> dict[str, Any]: ...


class BuiltinNodeRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, NodeHandler] = {}

    def register(self, node_type: str, handler: NodeHandler) -> None:
        self._handlers[node_type] = handler

    def get(self, node_type: str) -> NodeHandler | None:
        return self._handlers.get(node_type)

    def is_builtin(self, node_type: str) -> bool:
        return node_type in self._handlers


registry = BuiltinNodeRegistry()

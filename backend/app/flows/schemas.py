from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.engine.errors import GraphExecutionError
from app.engine.url_guard import validate_proxy_url

# Kept in sync with crypto.SECRET_MASK; duplicated here to avoid an import cycle.
SECRET_MASK = "__kept_secret__"

MAX_NODES = 500
MAX_EDGES = 1000


class NodeExecutionSettings(BaseModel):
    retry_count: int = Field(default=0, ge=0, le=5)
    retry_delay_ms: int = Field(default=1000, ge=0, le=60_000)
    continue_on_fail: bool = False


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    source_handle: str | None = None
    target_handle: str | None = None


class GraphNode(BaseModel):
    id: str
    type: str
    data: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] | None = None
    execution: NodeExecutionSettings | None = None


class FlowSettings(BaseModel):
    loop: bool = False
    interval_seconds: int = Field(default=120, ge=1, le=86_400)
    cron_expression: str | None = Field(default=None, max_length=128)
    cron_timezone: str = Field(default="UTC", max_length=64)
    proxy: str | None = Field(default=None, max_length=512)

    @field_validator("proxy")
    @classmethod
    def proxy_must_be_safe(cls, value: str | None) -> str | None:
        if value is None or not str(value).strip():
            return None
        stripped = str(value).strip()
        # Masked placeholder is restored server-side; don't validate it as a URL.
        if stripped == SECRET_MASK:
            return stripped
        try:
            return validate_proxy_url(stripped)
        except GraphExecutionError as exc:
            raise ValueError(str(exc)) from exc


class FlowGraph(BaseModel):
    flow_id: str | None = None
    settings: FlowSettings = Field(default_factory=FlowSettings)
    nodes: list[GraphNode] = Field(max_length=MAX_NODES)
    edges: list[GraphEdge] = Field(max_length=MAX_EDGES)


NODE_TYPES = {
    "flow_start",
    "flow_end",
    "api_call",
    "file_source",
    "delay",
    "if_condition",
    "switch",
    "merge",
    "execute_flow",
    "webhook_trigger",
    "set_variables",
    "parse_message",
    "pick_value",
    "http_request",
    "filter",
    "aggregate",
    "account_status",
}

BRANCHING_NODE_TYPES = {"if_condition", "switch", "merge"}

import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.owner import get_owner
from app.config import settings
from app.db.models import Flow, FlowRun, FlowRunStatus, FlowSchedule, NodeRun, User, WebhookToken
from app.db.session import get_db
from app.engine.validate import validate_graph as validate_graph_structure
from app.flows.schemas import FlowGraph
from app.integrations.loader import (
    get_allowed_node_types_async,
    load_credentials_sync,
    load_custom_node_specs_sync,
)
from app.security.crypto import (
    decrypt_graph_secrets,
    encrypt_graph_secrets,
    mask_graph_secrets,
    redact_secrets,
    restore_masked_secrets,
)
from app.tasks.celery_app import celery_app

router = APIRouter(prefix="/flows", tags=["flows"])

MAX_PIN_BYTES = 512 * 1024


class FlowCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    graph_json: FlowGraph | None = None


class FlowUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    graph_json: FlowGraph | None = None
    is_active: bool | None = None


class FlowResponse(BaseModel):
    id: UUID
    name: str
    graph_json: dict
    settings: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime
    webhook_urls: dict[str, str] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class FlowRunResponse(BaseModel):
    id: UUID
    flow_id: UUID
    status: str
    context: dict
    error: str | None
    current_node_id: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class NodeRunResponse(BaseModel):
    id: UUID
    node_id: str
    node_type: str
    status: str
    input_snapshot: dict
    output_snapshot: dict
    error: str | None
    duration_ms: int | None
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class TestNodeRequest(BaseModel):
    node_id: str
    mock_context: dict = Field(default_factory=dict)
    node_data: dict | None = None
    node_type: str | None = None
    pin: bool = False


class ScheduleRequest(BaseModel):
    cron_expression: str = Field(min_length=1, max_length=128)
    timezone: str = Field(default="UTC", max_length=64)
    is_active: bool = True


async def validate_graph(graph: FlowGraph, db: AsyncSession, user_id: UUID) -> None:
    from app.engine.topology import GraphExecutionError, topological_sort

    allowed_types = await get_allowed_node_types_async(db, user_id)
    node_ids = {node.id for node in graph.nodes}
    if len(node_ids) != len(graph.nodes):
        raise HTTPException(status_code=400, detail="Duplicate node ids in graph")

    for node in graph.nodes:
        if node.type not in allowed_types:
            raise HTTPException(status_code=400, detail=f"Unknown node type: {node.type}")
        if node.type == "execute_flow":
            sub_id = (node.data or {}).get("flow_id")
            if sub_id:
                try:
                    sub_uuid = UUID(str(sub_id))
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail="execute_flow.flow_id must be a UUID") from exc
                owned = await db.execute(select(Flow).where(Flow.id == sub_uuid, Flow.user_id == user_id))
                if not owned.scalar_one_or_none():
                    raise HTTPException(status_code=400, detail="execute_flow references unknown or foreign flow")

    for edge in graph.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise HTTPException(status_code=400, detail=f"Edge references unknown node: {edge.id}")

    try:
        topological_sort(graph.nodes, graph.edges)
    except GraphExecutionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def enforce_flow_count_limit(db: AsyncSession, user_id: UUID) -> None:
    result = await db.execute(select(func.count()).select_from(Flow).where(Flow.user_id == user_id))
    count = int(result.scalar_one() or 0)
    if count >= settings.max_active_flows_per_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Достигнут лимит потоков ({settings.max_active_flows_per_user})",
        )


async def enforce_run_limits(db: AsyncSession, user_id: UUID) -> None:
    concurrent_result = await db.execute(
        select(func.count())
        .select_from(FlowRun)
        .join(Flow, Flow.id == FlowRun.flow_id)
        .where(
            Flow.user_id == user_id,
            FlowRun.status.in_([FlowRunStatus.PENDING.value, FlowRunStatus.RUNNING.value]),
        )
    )
    concurrent = int(concurrent_result.scalar_one() or 0)
    if concurrent >= settings.max_concurrent_runs_per_user:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Достигнут лимит одновременных запусков ({settings.max_concurrent_runs_per_user})",
        )

    since = datetime.now(timezone.utc) - timedelta(hours=1)
    hourly_result = await db.execute(
        select(func.count())
        .select_from(FlowRun)
        .join(Flow, Flow.id == FlowRun.flow_id)
        .where(Flow.user_id == user_id, FlowRun.created_at >= since)
    )
    hourly = int(hourly_result.scalar_one() or 0)
    if hourly >= settings.max_runs_per_hour:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Достигнут лимит запусков в час ({settings.max_runs_per_hour})",
        )


def default_graph() -> dict:
    return FlowGraph(nodes=[], edges=[]).model_dump()


async def sync_webhook_tokens(db: AsyncSession, flow: Flow) -> dict[str, str]:
    graph = flow.graph_json or {}
    nodes = graph.get("nodes", [])
    webhook_node_ids = {node["id"] for node in nodes if node.get("type") == "webhook_trigger"}

    result = await db.execute(select(WebhookToken).where(WebhookToken.flow_id == flow.id))
    existing = {token.node_id: token for token in result.scalars().all()}

    for node_id in webhook_node_ids:
        if node_id not in existing:
            token = WebhookToken(flow_id=flow.id, node_id=node_id, token=secrets.token_urlsafe(24))
            db.add(token)
            existing[node_id] = token

    for node_id, token in list(existing.items()):
        if node_id not in webhook_node_ids:
            await db.delete(token)
            del existing[node_id]

    await db.flush()
    return {
        node_id: f"{settings.webhook_base_url}/hooks/{token.token}"
        for node_id, token in existing.items()
    }


def _validate_cron(cron_expr: str, tz: str) -> str:
    """Return a safe timezone; raise 422 on an invalid cron expression."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    from croniter import croniter

    if not croniter.is_valid(cron_expr):
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {cron_expr}")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail=f"Unknown timezone: {tz}") from None
    return tz


async def sync_flow_schedule(db: AsyncSession, flow: Flow) -> None:
    settings_data = flow.settings or {}
    cron_expr = settings_data.get("cron_expression")
    result = await db.execute(select(FlowSchedule).where(FlowSchedule.flow_id == flow.id))
    schedule = result.scalar_one_or_none()

    if cron_expr:
        tz = _validate_cron(cron_expr, settings_data.get("cron_timezone") or "UTC")
        if schedule:
            schedule.cron_expression = cron_expr
            schedule.timezone = tz
            schedule.is_active = flow.is_active
        else:
            db.add(
                FlowSchedule(
                    flow_id=flow.id,
                    cron_expression=cron_expr,
                    timezone=tz,
                    is_active=flow.is_active,
                )
            )
    elif schedule:
        await db.delete(schedule)


def _persisted_settings(graph_settings: dict) -> dict:
    """Settings column keeps only scheduling/pin metadata; secrets (proxy) live
    exclusively in the encrypted graph_json."""
    clean = dict(graph_settings)
    clean.pop("proxy", None)
    return clean


def flow_to_response(flow: Flow, webhook_urls: dict[str, str] | None = None) -> FlowResponse:
    # Mask secrets so plaintext tokens/proxy never leave the backend.
    graph = mask_graph_secrets(decrypt_graph_secrets(flow.graph_json or default_graph()))
    return FlowResponse(
        id=flow.id,
        name=flow.name,
        graph_json=graph,
        settings=_persisted_settings(flow.settings or {}),
        is_active=flow.is_active,
        created_at=flow.created_at,
        updated_at=flow.updated_at,
        webhook_urls=webhook_urls or {},
    )


async def get_owned_flow(db: AsyncSession, flow_id: UUID, user: User) -> Flow:
    result = await db.execute(
        select(Flow)
        .options(selectinload(Flow.webhook_tokens))
        .where(Flow.id == flow_id, Flow.user_id == user.id)
    )
    flow = result.scalar_one_or_none()
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
    return flow


@router.get("", response_model=list[FlowResponse])
async def list_flows(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[FlowResponse]:
    result = await db.execute(
        select(Flow).where(Flow.user_id == current_user.id).order_by(Flow.updated_at.desc())
    )
    flows = result.scalars().all()
    responses: list[FlowResponse] = []
    for flow in flows:
        webhook_urls = await sync_webhook_tokens(db, flow)
        responses.append(flow_to_response(flow, webhook_urls))
    await db.commit()
    return responses


@router.post("", response_model=FlowResponse, status_code=status.HTTP_201_CREATED)
async def create_flow(
    payload: FlowCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowResponse:
    await enforce_flow_count_limit(db, current_user.id)
    graph = payload.graph_json or FlowGraph(nodes=[], edges=[])
    await validate_graph(graph, db, current_user.id)

    flow = Flow(
        user_id=current_user.id,
        name=payload.name,
        graph_json=encrypt_graph_secrets(restore_masked_secrets(graph.model_dump(), {})),
        settings=_persisted_settings(graph.settings.model_dump()),
    )
    db.add(flow)
    await db.flush()
    webhook_urls = await sync_webhook_tokens(db, flow)
    await sync_flow_schedule(db, flow)
    await db.commit()
    await db.refresh(flow)
    return flow_to_response(flow, webhook_urls)


@router.get("/{flow_id}", response_model=FlowResponse)
async def get_flow(
    flow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowResponse:
    flow = await get_owned_flow(db, flow_id, current_user)
    webhook_urls = await sync_webhook_tokens(db, flow)
    await db.commit()
    return flow_to_response(flow, webhook_urls)


@router.put("/{flow_id}", response_model=FlowResponse)
async def update_flow(
    flow_id: UUID,
    payload: FlowUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowResponse:
    flow = await get_owned_flow(db, flow_id, current_user)

    if payload.name is not None:
        flow.name = payload.name
    if payload.graph_json is not None:
        await validate_graph(payload.graph_json, db, current_user.id)
        restored = restore_masked_secrets(payload.graph_json.model_dump(), flow.graph_json or {})
        flow.graph_json = encrypt_graph_secrets(restored)
        prev_settings = dict(flow.settings or {})
        new_settings = _persisted_settings(payload.graph_json.settings.model_dump())
        # keep pin_data managed by the dedicated pins endpoint
        if "pin_data" in prev_settings:
            new_settings["pin_data"] = prev_settings["pin_data"]
        flow.settings = new_settings
    if payload.is_active is not None:
        flow.is_active = payload.is_active

    webhook_urls = await sync_webhook_tokens(db, flow)
    await sync_flow_schedule(db, flow)
    await db.commit()
    await db.refresh(flow)
    return flow_to_response(flow, webhook_urls)


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flow(
    flow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> None:
    flow = await get_owned_flow(db, flow_id, current_user)
    schedule_result = await db.execute(select(FlowSchedule).where(FlowSchedule.flow_id == flow.id))
    schedule = schedule_result.scalar_one_or_none()
    if schedule:
        await db.delete(schedule)
    await db.delete(flow)
    await db.commit()


@router.post("/{flow_id}/run", response_model=FlowRunResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_flow(
    flow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowRun:
    flow = await get_owned_flow(db, flow_id, current_user)
    graph = decrypt_graph_secrets(flow.graph_json or {})
    issues = validate_graph_structure(graph)
    blocking = [msg for msg in issues if not msg.startswith("Предупреждение:")]
    if blocking:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=blocking)

    await enforce_run_limits(db, current_user.id)

    settings_data = (flow.graph_json or {}).get("settings") or flow.settings or {}
    if settings_data.get("loop"):
        flow.is_active = True

    run = FlowRun(flow_id=flow.id, status=FlowRunStatus.PENDING.value)
    db.add(run)
    await db.commit()
    await db.refresh(run)

    celery_app.send_task("app.tasks.flow_tasks.execute_flow", args=[str(flow.id), str(run.id)])
    return run


@router.post("/{flow_id}/stop", response_model=FlowResponse)
async def stop_flow(
    flow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowResponse:
    flow = await get_owned_flow(db, flow_id, current_user)
    flow.is_active = False

    result = await db.execute(
        select(FlowRun).where(
            FlowRun.flow_id == flow.id,
            FlowRun.status.in_([FlowRunStatus.PENDING.value, FlowRunStatus.RUNNING.value]),
        )
    )
    for run in result.scalars().all():
        run.status = FlowRunStatus.STOPPED.value
        run.finished_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(flow)
    return flow_to_response(flow)


@router.get("/{flow_id}/pins")
async def get_pins(
    flow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> dict[str, Any]:
    flow = await get_owned_flow(db, flow_id, current_user)
    settings_data = flow.settings or {}
    pin_data = settings_data.get("pin_data")
    if isinstance(pin_data, dict) and pin_data:
        return pin_data

    run_result = await db.execute(
        select(FlowRun)
        .where(FlowRun.flow_id == flow.id, FlowRun.status == FlowRunStatus.SUCCESS.value)
        .order_by(FlowRun.finished_at.desc().nullslast(), FlowRun.created_at.desc())
        .limit(1)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        return {}

    nodes_result = await db.execute(
        select(NodeRun).where(
            NodeRun.flow_run_id == run.id,
            NodeRun.status == "success",
        )
    )
    return {
        node_run.node_id: node_run.output_snapshot
        for node_run in nodes_result.scalars().all()
        if node_run.output_snapshot
    }


@router.put("/{flow_id}/pins")
async def put_pins(
    flow_id: UUID,
    pin_data: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> dict[str, Any]:
    flow = await get_owned_flow(db, flow_id, current_user)
    clean = pin_data if isinstance(pin_data, dict) else {}
    if len(json.dumps(clean, default=str)) > MAX_PIN_BYTES:
        raise HTTPException(status_code=413, detail="Pin data too large (max 512 KB)")
    settings_data = dict(flow.settings or {})
    settings_data["pin_data"] = clean
    flow.settings = settings_data
    await db.commit()
    return {"status": "ok", "pin_data": settings_data["pin_data"]}


@router.get("/{flow_id}/runs", response_model=list[FlowRunResponse])
async def list_runs(
    flow_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[FlowRun]:
    await get_owned_flow(db, flow_id, current_user)
    result = await db.execute(
        select(FlowRun).where(FlowRun.flow_id == flow_id).order_by(FlowRun.created_at.desc()).limit(20)
    )
    return list(result.scalars().all())


@router.get("/{flow_id}/runs/{run_id}", response_model=FlowRunResponse)
async def get_run(
    flow_id: UUID,
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowRun:
    await get_owned_flow(db, flow_id, current_user)
    result = await db.execute(select(FlowRun).where(FlowRun.id == run_id, FlowRun.flow_id == flow_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/{flow_id}/runs/{run_id}/nodes", response_model=list[NodeRunResponse])
async def list_node_runs(
    flow_id: UUID,
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[NodeRun]:
    await get_owned_flow(db, flow_id, current_user)
    run_result = await db.execute(select(FlowRun).where(FlowRun.id == run_id, FlowRun.flow_id == flow_id))
    if not run_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Run not found")
    result = await db.execute(
        select(NodeRun)
        .where(NodeRun.flow_run_id == run_id)
        .order_by(NodeRun.started_at.asc())
        .limit(2000)
    )
    return list(result.scalars().all())


@router.get("/{flow_id}/runs/{run_id}/stream")
async def stream_run(
    flow_id: UUID,
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> StreamingResponse:
    await get_owned_flow(db, flow_id, current_user)

    async def event_generator():
        from app.db.session import async_session_factory

        last_node_id = None
        while True:
            async with async_session_factory() as stream_db:
                result = await stream_db.execute(
                    select(FlowRun).where(FlowRun.id == run_id, FlowRun.flow_id == flow_id)
                )
                run = result.scalar_one_or_none()
                if not run:
                    yield f"data: {json.dumps({'error': 'not_found'})}\n\n"
                    break

                payload = {
                    "status": run.status,
                    "current_node_id": run.current_node_id,
                    "error": run.error,
                }
                if run.current_node_id != last_node_id or run.status not in {
                    FlowRunStatus.PENDING.value,
                    FlowRunStatus.RUNNING.value,
                }:
                    last_node_id = run.current_node_id
                    yield f"data: {json.dumps(payload)}\n\n"

                if run.status not in {FlowRunStatus.PENDING.value, FlowRunStatus.RUNNING.value}:
                    break

            await asyncio.sleep(1)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/{flow_id}/test-node")
async def test_node(
    flow_id: UUID,
    payload: TestNodeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> dict:
    if len(json.dumps(payload.mock_context, default=str)) > MAX_PIN_BYTES:
        raise HTTPException(status_code=413, detail="mock_context too large (max 512 KB)")

    flow = await get_owned_flow(db, flow_id, current_user)
    graph = decrypt_graph_secrets(flow.graph_json or {})
    nodes = graph.get("nodes", [])
    target = next((node for node in nodes if node["id"] == payload.node_id), None)
    if not target and not (payload.node_type and payload.node_data is not None):
        raise HTTPException(status_code=404, detail="Node not found in flow")

    if target is None:
        target = {
            "id": payload.node_id,
            "type": payload.node_type,
            "data": payload.node_data or {},
        }
    elif payload.node_data is not None:
        target = {**target, "data": payload.node_data}
        if payload.node_type:
            target["type"] = payload.node_type

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        custom_specs = load_custom_node_specs_sync(session, current_user.id)
        credentials = load_credentials_sync(session, current_user.id)
    finally:
        session.close()
        engine.dispose()

    from app.engine.executor import execute_node
    from app.engine.interpolator import make_context
    from app.engine.registry import ExecutionState
    from app.flows.schemas import GraphNode

    state = ExecutionState(owner_user_id=current_user.id)
    state.node_results = payload.mock_context if isinstance(payload.mock_context, dict) else {}
    state.custom_node_specs = custom_specs
    state.credentials = credentials

    node = GraphNode.model_validate(target)

    try:
        result = await execute_node(node, state, make_context(state))
        if payload.pin:
            pinned = redact_secrets(result)
            if len(json.dumps(pinned, default=str)) > MAX_PIN_BYTES:
                raise HTTPException(status_code=413, detail="Node output too large to pin (max 512 KB)")
            settings_data = dict(flow.settings or {})
            pin_store = dict(settings_data.get("pin_data") or {})
            pin_store[payload.node_id] = pinned
            settings_data["pin_data"] = pin_store
            flow.settings = settings_data
            await db.commit()
        return {"status": "success", "result": result}
    except Exception as exc:
        return {"status": "failed", "error": str(exc)}


@router.put("/{flow_id}/schedule")
async def upsert_schedule(
    flow_id: UUID,
    payload: ScheduleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> dict:
    flow = await get_owned_flow(db, flow_id, current_user)

    from croniter import croniter
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    if not croniter.is_valid(payload.cron_expression):
        raise HTTPException(status_code=400, detail="Invalid cron expression")
    try:
        ZoneInfo(payload.timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid timezone") from exc

    result = await db.execute(select(FlowSchedule).where(FlowSchedule.flow_id == flow.id))
    schedule = result.scalar_one_or_none()

    if schedule:
        schedule.cron_expression = payload.cron_expression
        schedule.timezone = payload.timezone
        schedule.is_active = payload.is_active
    else:
        db.add(
            FlowSchedule(
                flow_id=flow.id,
                cron_expression=payload.cron_expression,
                timezone=payload.timezone,
                is_active=payload.is_active,
            )
        )

    settings_data = dict(flow.settings or {})
    settings_data["cron_expression"] = payload.cron_expression
    settings_data["cron_timezone"] = payload.timezone
    flow.settings = settings_data
    await db.commit()
    return {"status": "ok"}

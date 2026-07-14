import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db.models import Flow, FlowRun, FlowRunStatus, NodeRun
from app.engine.executor import execute_graph
from app.engine.registry import ExecutionState
from app.engine.topology import GraphExecutionError
from app.integrations.loader import load_credentials_sync, load_custom_node_specs_sync
from app.security.crypto import decrypt_graph_secrets, redact_secrets
from app.security.redis_lock import redis_lock
from app.security.request_context import set_request_id
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

sync_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
SyncSessionLocal = sessionmaker(bind=sync_engine, autocommit=False, autoflush=False)

MAX_PERSISTED_JSON_BYTES = 256 * 1024


def _get_sync_session() -> Session:
    return SyncSessionLocal()


def _sanitize_snapshot(data: dict) -> dict:
    """Redact secrets and cap size before persisting to DB / streaming to UI."""
    import json as _json

    redacted = redact_secrets(data)
    try:
        if len(_json.dumps(redacted, default=str)) > MAX_PERSISTED_JSON_BYTES:
            return {"_truncated": True, "note": "Output too large; truncated for storage"}
    except (TypeError, ValueError):
        return {"_truncated": True}
    return redacted


def _has_live_run(session: Session, flow_id: UUID) -> bool:
    existing = session.execute(
        select(FlowRun.id)
        .where(
            FlowRun.flow_id == flow_id,
            FlowRun.status.in_([FlowRunStatus.PENDING.value, FlowRunStatus.RUNNING.value]),
        )
        .limit(1)
    ).first()
    return existing is not None


def _should_stop_flow(session: Session, flow_id: UUID, run_id: UUID) -> bool:
    flow = session.get(Flow, flow_id)
    run = session.get(FlowRun, run_id)
    if not flow or not run:
        return True
    return not flow.is_active or run.status == FlowRunStatus.STOPPED.value


def _record_node_run(
    session: Session,
    run_id: UUID,
    node_id: str,
    node_type: str,
    started_at: datetime,
    result: dict,
    error: str | None,
    input_snapshot: dict | None = None,
) -> None:
    finished_at = datetime.now(timezone.utc)
    duration_ms = int((finished_at - started_at).total_seconds() * 1000)
    status = "failed" if error or result.get("failed") else "success"
    node_run = NodeRun(
        flow_run_id=run_id,
        node_id=node_id,
        node_type=node_type,
        status=status,
        input_snapshot=_sanitize_snapshot(input_snapshot or {}),
        output_snapshot=_sanitize_snapshot(result),
        error=error,
        duration_ms=duration_ms,
        started_at=started_at,
        finished_at=finished_at,
    )
    session.add(node_run)
    session.commit()


@celery_app.task(name="app.tasks.flow_tasks.execute_flow")
def execute_flow(
    flow_id: str,
    run_id: str,
    webhook_payload: dict | None = None,
    trigger_node_id: str | None = None,
) -> dict:
    # Correlate all worker logs / outbound requests of this run with the run id.
    set_request_id(f"run-{run_id}")
    try:
        return asyncio.run(
            _execute_flow_async(
                UUID(flow_id),
                UUID(run_id),
                webhook_payload=webhook_payload,
                trigger_node_id=trigger_node_id,
                trigger_timestamp=datetime.now(timezone.utc).isoformat(),
            )
        )
    finally:
        set_request_id("-")


async def _execute_flow_async(
    flow_id: UUID,
    run_id: UUID,
    *,
    webhook_payload: dict | None = None,
    trigger_node_id: str | None = None,
    trigger_timestamp: str | None = None,
) -> dict:
    session = _get_sync_session()
    try:
        flow = session.get(Flow, flow_id)
        run = session.get(FlowRun, run_id)
        if not flow or not run:
            return {"status": "missing"}

        if run.status == FlowRunStatus.STOPPED.value:
            return {"status": "stopped"}

        run.status = FlowRunStatus.RUNNING.value
        run.started_at = datetime.now(timezone.utc)
        run.context = {}
        session.commit()

        graph_json = decrypt_graph_secrets(flow.graph_json or {})
        custom_specs = load_custom_node_specs_sync(session, flow.user_id)
        credentials = load_credentials_sync(session, flow.user_id)

        node_starts: dict[str, datetime] = {}
        node_inputs: dict[str, dict] = {}
        settings_raw = graph_json.get("settings") or {}
        flow_proxy = settings_raw.get("proxy") if isinstance(settings_raw.get("proxy"), str) else None
        if flow_proxy and flow_proxy.strip():
            from app.engine.url_guard import validate_proxy_url

            flow_proxy = validate_proxy_url(flow_proxy)
        else:
            flow_proxy = None
        exec_state = ExecutionState(
            webhook_payload=webhook_payload,
            trigger_node_id=trigger_node_id,
            trigger_timestamp=trigger_timestamp,
            owner_user_id=flow.user_id,
            flow_proxy=flow_proxy,
            custom_node_specs=custom_specs,
            credentials=credentials,
        )

        async def on_node_start(node_id: str, node_type: str) -> None:
            node_starts[node_id] = datetime.now(timezone.utc)
            run.current_node_id = node_id
            session.commit()

        async def on_node_complete(
            node_id: str,
            node_type: str,
            result: dict,
            full_context: dict,
            error: str | None,
        ) -> None:
            run.current_node_id = node_id
            run.context = _sanitize_snapshot(full_context)
            session.commit()
            started = node_starts.get(node_id, datetime.now(timezone.utc))
            _record_node_run(
                session,
                run_id,
                node_id,
                node_type,
                started,
                result,
                error,
                input_snapshot=node_inputs.get(node_id),
            )

        def should_stop() -> bool:
            session.refresh(flow)
            session.refresh(run)
            return _should_stop_flow(session, flow_id, run_id)

        try:
            context = await execute_graph(
                graph_json,
                webhook_payload=webhook_payload,
                trigger_node_id=trigger_node_id,
                trigger_timestamp=trigger_timestamp,
                on_node_complete=on_node_complete,
                on_node_start=on_node_start,
                should_stop=should_stop,
                state=exec_state,
                custom_node_specs=custom_specs,
                credentials=credentials,
                owner_user_id=flow.user_id,
            )

            session.refresh(run)
            if run.status == FlowRunStatus.STOPPED.value:
                return {"status": "stopped"}
            run.status = FlowRunStatus.SUCCESS.value
            run.context = _sanitize_snapshot(context)
            run.finished_at = datetime.now(timezone.utc)
            session.commit()
            return {"status": "success"}
        except GraphExecutionError as exc:
            session.refresh(run)
            if "stopped" in str(exc).lower() or run.status == FlowRunStatus.STOPPED.value:
                run.status = FlowRunStatus.STOPPED.value
                run.error = None
                run.finished_at = datetime.now(timezone.utc)
                session.commit()
                return {"status": "stopped"}
            run.status = FlowRunStatus.FAILED.value
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            session.commit()
            return {"status": "failed", "error": str(exc)}
        except Exception as exc:
            session.refresh(run)
            if run.status == FlowRunStatus.STOPPED.value:
                return {"status": "stopped"}
            run.status = FlowRunStatus.FAILED.value
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            session.commit()
            return {"status": "failed", "error": str(exc)}
    finally:
        session.close()


@celery_app.task(name="app.tasks.flow_tasks.process_active_loops")
def process_active_loops() -> dict:
    with redis_lock("lztbuilder:process_active_loops", ttl_seconds=55) as acquired:
        if not acquired:
            return {"triggered": 0, "skipped": "lock_not_acquired"}

        session = _get_sync_session()
        triggered = 0
        try:
            flows = session.execute(select(Flow).where(Flow.is_active.is_(True))).scalars().all()
            now = datetime.now(timezone.utc)

            for flow in flows:
                settings_data = flow.settings or {}
                if not settings_data.get("loop"):
                    continue

                interval = max(int(settings_data.get("interval_seconds", 120)), 1)
                last_run = (
                    session.execute(
                        select(FlowRun)
                        .where(FlowRun.flow_id == flow.id)
                        .order_by(FlowRun.created_at.desc())
                        .limit(1)
                    )
                    .scalar_one_or_none()
                )

                if last_run and last_run.created_at:
                    elapsed = (now - last_run.created_at.replace(tzinfo=timezone.utc)).total_seconds()
                    if elapsed < interval:
                        continue

                # Don't stack runs if the previous one is still pending/running.
                if _has_live_run(session, flow.id):
                    continue

                run = FlowRun(flow_id=flow.id, status=FlowRunStatus.PENDING.value)
                session.add(run)
                session.commit()
                session.refresh(run)
                execute_flow.delay(str(flow.id), str(run.id))
                triggered += 1

            return {"triggered": triggered}
        finally:
            session.close()


@celery_app.task(name="app.tasks.flow_tasks.process_cron_schedules")
def process_cron_schedules() -> dict:
    from croniter import croniter

    from app.db.models import FlowSchedule

    with redis_lock("lztbuilder:process_cron_schedules", ttl_seconds=55) as acquired:
        if not acquired:
            return {"triggered": 0, "skipped": "lock_not_acquired"}

        session = _get_sync_session()
        triggered = 0
        try:
            schedules = (
                session.execute(select(FlowSchedule).where(FlowSchedule.is_active.is_(True)))
                .scalars()
                .all()
            )
            now_utc = datetime.now(timezone.utc)

            for schedule in schedules:
                flow = session.get(Flow, schedule.flow_id)
                if not flow or not flow.is_active:
                    continue

                try:
                    tz = ZoneInfo(schedule.timezone or "UTC")
                except ZoneInfoNotFoundError:
                    logger.warning(
                        "Unknown timezone %r for schedule %s, falling back to UTC",
                        schedule.timezone,
                        schedule.id,
                    )
                    tz = ZoneInfo("UTC")

                now_local = now_utc.astimezone(tz)
                try:
                    cron = croniter(schedule.cron_expression, now_local)
                    prev_run_local = cron.get_prev(datetime)
                except (ValueError, KeyError) as exc:
                    # one broken legacy cron must not kill the whole scheduler pass
                    logger.error("Invalid cron %r for schedule %s: %s", schedule.cron_expression, schedule.id, exc)
                    continue
                if prev_run_local.tzinfo is None:
                    prev_run_local = prev_run_local.replace(tzinfo=tz)
                prev_run_utc = prev_run_local.astimezone(timezone.utc)

                if schedule.last_triggered_at:
                    last = schedule.last_triggered_at
                    if last.tzinfo is None:
                        last = last.replace(tzinfo=timezone.utc)
                    if last >= prev_run_utc:
                        continue

                if _has_live_run(session, flow.id):
                    continue

                run = FlowRun(flow_id=flow.id, status=FlowRunStatus.PENDING.value)
                session.add(run)
                schedule.last_triggered_at = now_utc
                session.commit()
                session.refresh(run)
                execute_flow.delay(str(flow.id), str(run.id))
                triggered += 1

            return {"triggered": triggered}
        finally:
            session.close()

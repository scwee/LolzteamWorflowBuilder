from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Flow, FlowRun, FlowRunStatus, WebhookToken
from app.db.session import get_db
from app.integrations.cache import check_rate_limit_window
from app.tasks.celery_app import celery_app

router = APIRouter(tags=["webhooks"])

MAX_WEBHOOK_BYTES = 256 * 1024


class WebhookResponse(BaseModel):
    accepted: bool
    run_id: UUID | None = None


@router.post("/hooks/{token}", response_model=WebhookResponse)
async def receive_webhook(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> WebhookResponse:
    if len(token) < 16 or len(token) > 128:
        raise HTTPException(status_code=404, detail="Webhook not found")

    body = await request.body()
    if len(body) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="Webhook payload too large")

    client_host = request.client.host if request.client else "unknown"
    if not check_rate_limit_window(f"{token}:{client_host}", "webhook", limit=60, window_seconds=60):
        raise HTTPException(status_code=429, detail="Webhook rate limit exceeded")

    result = await db.execute(select(WebhookToken).where(WebhookToken.token == token))
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    flow_result = await db.execute(select(Flow).where(Flow.id == webhook.flow_id))
    flow = flow_result.scalar_one_or_none()
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")

    if not flow.is_active:
        raise HTTPException(status_code=409, detail="Flow is not active")

    # Same per-owner limits as manual runs (prevents unlimited task queuing)
    from app.flows.routes import enforce_run_limits

    await enforce_run_limits(db, flow.user_id)

    content_type = request.headers.get("content-type", "")
    payload: dict | list | str | int | float | bool | None
    if not body:
        payload = {}
    elif "application/json" in content_type or body[:1] in (b"{", b"["):
        import json

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc
    else:
        payload = body.decode("utf-8", errors="replace")[:10_000]

    normalized_payload = payload if isinstance(payload, dict) else {"payload": payload}
    run = FlowRun(flow_id=flow.id, status=FlowRunStatus.PENDING.value)
    db.add(run)
    await db.commit()
    await db.refresh(run)

    celery_app.send_task(
        "app.tasks.flow_tasks.execute_flow",
        args=[str(flow.id), str(run.id)],
        kwargs={"webhook_payload": normalized_payload, "trigger_node_id": webhook.node_id},
    )
    return WebhookResponse(accepted=True, run_id=run.id)

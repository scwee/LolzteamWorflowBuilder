"""Unified credentials listing for LZT + OpenAPI integrations."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.owner import get_owner
from app.db.models import CredentialEvent, Integration, LztAccount, User
from app.db.session import get_db

router = APIRouter(prefix="/credentials", tags=["credentials"])


class CredentialItem(BaseModel):
    id: str
    kind: str  # lzt | openapi
    name: str
    preview: str | None = None
    integration_id: str | None = None
    auth_type: str | None = None
    meta: dict[str, Any] = {}


class CredentialEventItem(BaseModel):
    id: UUID
    credential_kind: str
    credential_id: str | None
    action: str
    label: str | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[CredentialItem])
async def list_credentials(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[CredentialItem]:
    items: list[CredentialItem] = []

    lzt_result = await db.execute(
        select(LztAccount).where(LztAccount.user_id == current_user.id).order_by(LztAccount.created_at.desc())
    )
    for account in lzt_result.scalars().all():
        items.append(
            CredentialItem(
                id=str(account.id),
                kind="lzt",
                name=account.nickname or "LZT Market",
                preview=account.token_preview,
                meta={"balance": account.balance},
            )
        )

    integ_result = await db.execute(
        select(Integration)
        .where(Integration.user_id == current_user.id)
        .options(selectinload(Integration.credentials))
        .order_by(Integration.created_at.desc())
    )
    for integration in integ_result.scalars().unique().all():
        creds = integration.credentials or []
        if not creds:
            items.append(
                CredentialItem(
                    id=str(integration.id),
                    kind="openapi",
                    name=integration.name,
                    preview=integration.base_url,
                    integration_id=str(integration.id),
                    auth_type="none",
                )
            )
            continue
        for cred in creds:
            items.append(
                CredentialItem(
                    id=str(cred.id),
                    kind="openapi",
                    name=cred.name or integration.name,
                    preview=integration.base_url,
                    integration_id=str(integration.id),
                    auth_type=cred.auth_type,
                )
            )

    return items


@router.get("/events", response_model=list[CredentialEventItem])
async def list_credential_events(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[CredentialEvent]:
    result = await db.execute(
        select(CredentialEvent)
        .where(CredentialEvent.user_id == current_user.id)
        .order_by(CredentialEvent.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())

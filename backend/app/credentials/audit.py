"""Хелперы для записи и чтения audit-журнала кредов."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CredentialEvent


async def record_credential_event(
    db: AsyncSession,
    *,
    user_id: UUID,
    credential_kind: str,
    action: str,
    credential_id: str | None = None,
    label: str | None = None,
    ip_address: str | None = None,
    flow_id: UUID | None = None,
    commit: bool = True,
) -> None:
    """Пишет событие в журнал. Никогда не сохраняет сам секрет.

    По умолчанию коммитит, чтобы вызов был самодостаточным. Передайте
    commit=False, если событие пишется в уже открытой транзакции.
    """
    event = CredentialEvent(
        user_id=user_id,
        credential_kind=credential_kind,
        credential_id=credential_id,
        action=action,
        label=label,
        ip_address=ip_address,
        flow_id=flow_id,
    )
    db.add(event)
    if commit:
        await db.commit()

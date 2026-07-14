from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.owner import get_owner
from app.credentials.audit import record_credential_event
from app.db.models import LztAccount, User
from app.db.session import get_db
from app.security.crypto import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/lzt-accounts", tags=["lzt-accounts"])


class AccountCreateRequest(BaseModel):
    token: str = Field(min_length=8)
    nickname: str | None = None


class AccountRotateRequest(BaseModel):
    token: str = Field(min_length=8)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


class AccountResponse(BaseModel):
    id: UUID
    nickname: str
    token_preview: str
    balance: float | None
    last_refreshed_at: datetime | None

    model_config = {"from_attributes": True}


def _preview_token(token: str) -> str:
    key = token.strip()
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}…{key[-4:]}"


def _refresh_account_sync(token: str, proxy: str | None = None) -> dict:
    from app.engine.lzt_client import lzt_request

    result = lzt_request("GET", "/me", None, token, proxy=proxy)
    status_code = int(result.get("status") or 0)
    body = result.get("body")
    if status_code >= 400:
        raise RuntimeError(f"LZT /me failed with status {status_code}: {body!r}")
    if not isinstance(body, dict):
        raise RuntimeError("Unexpected /me response")

    user = body.get("user") if isinstance(body.get("user"), dict) else body
    nickname = (
        user.get("username")
        or user.get("user_name")
        or user.get("nickname")
        or body.get("username")
        or ""
    )
    balance = user.get("balance")
    if balance is None:
        balance = body.get("balance")
    return {
        "nickname": str(nickname or ""),
        "balance": float(balance) if balance is not None else None,
    }


@router.get("", response_model=list[AccountResponse])
async def list_accounts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[LztAccount]:
    result = await db.execute(
        select(LztAccount).where(LztAccount.user_id == current_user.id).order_by(LztAccount.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> LztAccount:
    token = payload.token.strip()
    account = LztAccount(
        user_id=current_user.id,
        nickname=payload.nickname or "",
        token_encrypted=encrypt_secret(token),
        token_preview=_preview_token(token),
    )
    db.add(account)
    await db.flush()
    await record_credential_event(
        db,
        user_id=current_user.id,
        credential_kind="lzt",
        action="created",
        credential_id=str(account.id),
        label=account.nickname or "LZT Market",
        ip_address=_client_ip(request),
        commit=False,
    )
    await db.commit()
    await db.refresh(account)
    return account


@router.post("/{account_id}/rotate", response_model=AccountResponse)
async def rotate_account_token(
    account_id: UUID,
    payload: AccountRotateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> LztAccount:
    result = await db.execute(
        select(LztAccount).where(LztAccount.id == account_id, LztAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    token = payload.token.strip()
    account.token_encrypted = encrypt_secret(token)
    account.token_preview = _preview_token(token)
    account.last_refreshed_at = None
    await record_credential_event(
        db,
        user_id=current_user.id,
        credential_kind="lzt",
        action="rotated",
        credential_id=str(account.id),
        label=account.nickname or "LZT Market",
        ip_address=_client_ip(request),
        commit=False,
    )
    await db.commit()
    await db.refresh(account)
    return account


@router.post("/{account_id}/refresh", response_model=AccountResponse)
async def refresh_account(
    account_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> LztAccount:
    result = await db.execute(
        select(LztAccount).where(LztAccount.id == account_id, LztAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    token = decrypt_secret(account.token_encrypted)
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=1) as pool:
        try:
            stats = await loop.run_in_executor(pool, lambda: _refresh_account_sync(token))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"LZT refresh failed: {exc}") from exc

    account.nickname = stats["nickname"] or account.nickname
    account.balance = stats["balance"]
    account.last_refreshed_at = datetime.now(timezone.utc)
    await record_credential_event(
        db,
        user_id=current_user.id,
        credential_kind="lzt",
        action="refreshed",
        credential_id=str(account.id),
        label=account.nickname or "LZT Market",
        ip_address=_client_ip(request),
        commit=False,
    )
    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> None:
    result = await db.execute(
        select(LztAccount).where(LztAccount.id == account_id, LztAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    label = account.nickname or "LZT Market"
    await db.delete(account)
    await record_credential_event(
        db,
        user_id=current_user.id,
        credential_kind="lzt",
        action="deleted",
        credential_id=str(account_id),
        label=label,
        ip_address=_client_ip(request),
        commit=False,
    )
    await db.commit()

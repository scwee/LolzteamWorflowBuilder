"""Upload / list / delete workflow files stored in DB."""

from __future__ import annotations

import base64
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.owner import get_owner
from app.config import settings
from app.db.models import Flow, FlowFile, User
from app.db.session import get_db

router = APIRouter(prefix="/flows/{flow_id}/files", tags=["flow-files"])


class FlowFileResponse(BaseModel):
    id: UUID
    flow_id: UUID
    node_id: str | None
    filename: str
    mime_type: str
    encoding: str
    size: int

    model_config = {"from_attributes": True}


class FlowFileContentResponse(FlowFileResponse):
    content_text: str | None = None


async def _owned_flow(db: AsyncSession, flow_id: UUID, user: User) -> Flow:
    result = await db.execute(select(Flow).where(Flow.id == flow_id, Flow.user_id == user.id))
    flow = result.scalar_one_or_none()
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
    return flow


@router.get("", response_model=list[FlowFileResponse])
async def list_files(
    flow_id: UUID,
    node_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[FlowFile]:
    await _owned_flow(db, flow_id, current_user)
    stmt = select(FlowFile).where(FlowFile.flow_id == flow_id, FlowFile.user_id == current_user.id)
    if node_id:
        stmt = stmt.where(FlowFile.node_id == node_id)
    result = await db.execute(stmt.order_by(FlowFile.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=FlowFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    flow_id: UUID,
    upload: UploadFile = File(...),
    node_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowFile:
    await _owned_flow(db, flow_id, current_user)
    max_bytes = settings.max_flow_file_bytes
    # Read in chunks and abort early so an oversized upload never fully buffers in memory.
    chunks = bytearray()
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        chunks.extend(chunk)
        if len(chunks) > max_bytes:
            raise HTTPException(status_code=400, detail=f"File too large (max {max_bytes} bytes)")
    raw = bytes(chunks)

    from pathlib import PurePosixPath

    filename = PurePosixPath(upload.filename or "file.txt").name or "file.txt"
    mime = upload.content_type or "application/octet-stream"
    is_text = mime.startswith("text/") or filename.lower().endswith((".txt", ".csv", ".log", ".json"))

    row = FlowFile(
        flow_id=flow_id,
        user_id=current_user.id,
        node_id=node_id,
        filename=filename,
        mime_type=mime,
        encoding="text" if is_text else "base64",
        size=len(raw),
        content_text=raw.decode("utf-8", errors="replace") if is_text else None,
        content_binary=None if is_text else raw,
    )
    if not is_text:
        row.content_text = base64.b64encode(raw).decode("ascii")
        row.encoding = "base64"

    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/{file_id}", response_model=FlowFileContentResponse)
async def get_file(
    flow_id: UUID,
    file_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> FlowFile:
    await _owned_flow(db, flow_id, current_user)
    result = await db.execute(
        select(FlowFile).where(
            FlowFile.id == file_id,
            FlowFile.flow_id == flow_id,
            FlowFile.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return row


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    flow_id: UUID,
    file_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> None:
    await _owned_flow(db, flow_id, current_user)
    result = await db.execute(
        select(FlowFile).where(
            FlowFile.id == file_id,
            FlowFile.flow_id == flow_id,
            FlowFile.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    await db.delete(row)
    await db.commit()

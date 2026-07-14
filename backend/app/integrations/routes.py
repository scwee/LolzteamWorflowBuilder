from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.owner import get_owner
from app.db.models import CustomNodeType, Integration, IntegrationCredential, User
from app.db.session import get_db
from app.integrations.cache import check_rate_limit, delete_preview, get_preview, store_preview
from app.engine.errors import GraphExecutionError
from app.engine.url_guard import validate_outbound_url
from app.integrations.fetcher import (
    MAX_SPEC_BYTES,
    SpecFetchError,
    fetch_spec_from_url,
    parse_spec_content,
)
from app.integrations.generator import generate_integration
from app.integrations.parser import OpenApiParseError, parse_openapi_spec
from app.integrations.schemas import (
    CredentialUpdateRequest,
    CustomNodeTypeResponse,
    IntegrationResponse,
    OpenApiImportRequest,
    OpenApiPreviewResponse,
    OperationPreview,
    SecuritySchemePreview,
)
from app.security.crypto import decrypt_credential_data, encrypt_credential_data

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _credential_to_dict(payload) -> dict:
    return {
        "auth_type": payload.auth_type,
        "token": payload.token,
        "api_key": payload.api_key,
        "header_name": payload.header_name,
        "query_name": payload.query_name,
        "username": payload.username,
        "password": payload.password,
    }


class OpenApiPreviewUrlRequest(BaseModel):
    url: str = Field(min_length=1)


@router.post("/openapi/preview", response_model=OpenApiPreviewResponse)
async def preview_openapi_url(
    payload: OpenApiPreviewUrlRequest,
    current_user: User = Depends(get_owner),
) -> OpenApiPreviewResponse:
    if not check_rate_limit(str(current_user.id), "preview"):
        raise HTTPException(status_code=429, detail="Preview rate limit exceeded (10/hour)")

    try:
        spec_dict = await fetch_spec_from_url(payload.url)
        parsed = parse_openapi_spec(spec_dict)
    except (SpecFetchError, OpenApiParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    preview_id = store_preview(
        str(current_user.id),
        {
            "spec_source_url": payload.url,
            **parsed,
        },
    )
    return OpenApiPreviewResponse(
        preview_id=preview_id,
        integration_name=parsed["integration_name"],
        base_url=parsed["base_url"],
        operations=[OperationPreview(**op) for op in parsed["operations"]],
        security_schemes=[SecuritySchemePreview(**s) for s in parsed["security_schemes"]],
    )


@router.post("/openapi/preview/upload", response_model=OpenApiPreviewResponse)
async def preview_openapi_upload(
    file: UploadFile = File(...),
    current_user: User = Depends(get_owner),
) -> OpenApiPreviewResponse:
    if not check_rate_limit(str(current_user.id), "preview"):
        raise HTTPException(status_code=429, detail="Preview rate limit exceeded (10/hour)")

    chunks = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        chunks.extend(chunk)
        if len(chunks) > MAX_SPEC_BYTES:
            raise HTTPException(status_code=400, detail="OpenAPI spec exceeds 5 MB limit")
    content = bytes(chunks)
    try:
        spec_dict = parse_spec_content(content, file.content_type or "")
        parsed = parse_openapi_spec(spec_dict)
    except (SpecFetchError, OpenApiParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    preview_id = store_preview(
        str(current_user.id),
        {
            "spec_source_url": None,
            **parsed,
        },
    )
    return OpenApiPreviewResponse(
        preview_id=preview_id,
        integration_name=parsed["integration_name"],
        base_url=parsed["base_url"],
        operations=[OperationPreview(**op) for op in parsed["operations"]],
        security_schemes=[SecuritySchemePreview(**s) for s in parsed["security_schemes"]],
    )


@router.post("/openapi/import", response_model=list[CustomNodeTypeResponse])
async def import_openapi(
    payload: OpenApiImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[CustomNodeTypeResponse]:
    if not check_rate_limit(str(current_user.id), "import"):
        raise HTTPException(status_code=429, detail="Import rate limit exceeded (10/hour)")

    preview = get_preview(payload.preview_id, str(current_user.id))
    if not preview:
        raise HTTPException(status_code=404, detail="Preview expired or not found")

    # Re-validate the base_url from the spec before persisting nodes that will call it.
    base_url = preview.get("base_url", "")
    if base_url:
        try:
            validate_outbound_url(base_url)
        except GraphExecutionError as exc:
            raise HTTPException(status_code=400, detail=f"Unsafe base_url in spec: {exc}") from exc

    credential_data = _credential_to_dict(payload.credential) if payload.credential else None
    try:
        integration, custom_nodes = await generate_integration(
            db,
            user_id=current_user.id,
            integration_name=payload.integration_name,
            base_url=preview.get("base_url", ""),
            spec_source_url=preview.get("spec_source_url"),
            spec_hash=preview.get("spec_hash"),
            openapi_version=preview.get("openapi_version"),
            security_schemes=preview.get("security_schemes", []),
            operation_ids=payload.operation_ids,
            operation_details=preview.get("operation_details", []),
            credential_data=credential_data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    delete_preview(payload.preview_id)

    result = await db.execute(
        select(Integration).where(Integration.id == integration.id)
    )
    saved_integration = result.scalar_one()
    return [_node_to_response(node, saved_integration) for node in custom_nodes]


@router.get("", response_model=list[IntegrationResponse])
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[IntegrationResponse]:
    result = await db.execute(
        select(Integration, func.count(CustomNodeType.id))
        .outerjoin(CustomNodeType, CustomNodeType.integration_id == Integration.id)
        .where(Integration.user_id == current_user.id)
        .group_by(Integration.id)
        .order_by(Integration.created_at.desc())
    )
    responses = []
    for integration, node_count in result.all():
        responses.append(
            IntegrationResponse(
                id=integration.id,
                name=integration.name,
                base_url=integration.base_url,
                spec_source_url=integration.spec_source_url,
                openapi_version=integration.openapi_version,
                security_scheme=integration.security_scheme or {},
                node_count=node_count,
                created_at=integration.created_at.isoformat(),
            )
        )
    return responses


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    integration_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> None:
    result = await db.execute(
        select(Integration).where(Integration.id == integration_id, Integration.user_id == current_user.id)
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    await db.delete(integration)
    await db.commit()


@router.put("/{integration_id}/credentials")
async def update_credentials(
    integration_id: UUID,
    payload: CredentialUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> dict:
    result = await db.execute(
        select(Integration)
        .options(selectinload(Integration.credentials))
        .where(Integration.id == integration_id, Integration.user_id == current_user.id)
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    credential_data = _credential_to_dict(payload)
    encrypted = encrypt_credential_data(credential_data)

    if integration.credentials:
        cred = integration.credentials[0]
        cred.name = payload.name
        cred.auth_type = payload.auth_type
        cred.encrypted_data = encrypted
    else:
        db.add(
            IntegrationCredential(
                integration_id=integration.id,
                user_id=current_user.id,
                name=payload.name,
                auth_type=payload.auth_type,
                encrypted_data=encrypted,
            )
        )
    await db.commit()
    return {"status": "ok"}


def _defaults_from_inputs(expected_inputs: list) -> dict:
    defaults: dict = {}
    for inp in expected_inputs:
        name = inp.get("name", "")
        if not name or name == "body":
            continue
        defaults[name] = ""
    return defaults


def _node_to_response(node: CustomNodeType, integration: Integration) -> CustomNodeTypeResponse:
    defaults = _defaults_from_inputs(node.expected_inputs or [])
    defaults["integration_id"] = str(integration.id)
    return CustomNodeTypeResponse(
        id=node.id,
        node_type_slug=node.node_type_slug,
        operation_id=node.operation_id,
        display_name=node.display_name,
        summary=node.summary,
        http_method=node.http_method,
        endpoint_path=node.endpoint_path,
        integration_id=integration.id,
        integration_name=integration.name,
        category=integration.name,
        expected_inputs=node.expected_inputs or [],
        defaults=defaults,
    )


@router.get("/node-types", response_model=list[CustomNodeTypeResponse])
async def list_node_types(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_owner),
) -> list[CustomNodeTypeResponse]:
    result = await db.execute(
        select(CustomNodeType, Integration)
        .join(Integration, Integration.id == CustomNodeType.integration_id)
        .where(CustomNodeType.user_id == current_user.id)
        .order_by(Integration.name, CustomNodeType.display_name)
    )
    return [_node_to_response(node, integration) for node, integration in result.all()]

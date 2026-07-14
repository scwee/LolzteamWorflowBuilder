from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.db.models import CustomNodeType, Integration, IntegrationCredential
from app.security.crypto import decrypt_credential_data


async def load_custom_node_specs_async(db: AsyncSession, user_id: UUID) -> dict[str, dict]:
    result = await db.execute(
        select(CustomNodeType, Integration)
        .join(Integration, Integration.id == CustomNodeType.integration_id)
        .where(CustomNodeType.user_id == user_id)
    )
    specs: dict[str, dict] = {}
    for node_type, integration in result.all():
        specs[node_type.node_type_slug] = {
            "base_url": integration.base_url,
            "http_method": node_type.http_method,
            "endpoint_path": node_type.endpoint_path,
            "expected_inputs": node_type.expected_inputs or [],
            "integration_id": str(integration.id),
        }
    return specs


def load_custom_node_specs_sync(session: Session, user_id: UUID) -> dict[str, dict]:
    result = session.execute(
        select(CustomNodeType, Integration)
        .join(Integration, Integration.id == CustomNodeType.integration_id)
        .where(CustomNodeType.user_id == user_id)
    )
    specs: dict[str, dict] = {}
    for node_type, integration in result.all():
        specs[node_type.node_type_slug] = {
            "base_url": integration.base_url,
            "http_method": node_type.http_method,
            "endpoint_path": node_type.endpoint_path,
            "expected_inputs": node_type.expected_inputs or [],
            "integration_id": str(integration.id),
        }
    return specs


def load_credentials_sync(session: Session, user_id: UUID) -> dict[str, dict]:
    result = session.execute(
        select(IntegrationCredential).where(IntegrationCredential.user_id == user_id)
    )
    credentials: dict[str, dict] = {}
    for cred in result.scalars().all():
        decrypted = decrypt_credential_data(cred.encrypted_data or {})
        decrypted["auth_type"] = cred.auth_type
        credentials[str(cred.id)] = decrypted
        # Prefer first credential per integration for fallback lookup
        integration_key = str(cred.integration_id)
        if integration_key not in credentials:
            credentials[integration_key] = decrypted
    return credentials


async def get_allowed_node_types_async(db: AsyncSession, user_id: UUID) -> set[str]:
    from app.flows.schemas import NODE_TYPES

    result = await db.execute(
        select(CustomNodeType.node_type_slug).where(CustomNodeType.user_id == user_id)
    )
    custom = set(result.scalars().all())
    return set(NODE_TYPES) | custom

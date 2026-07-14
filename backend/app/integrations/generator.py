import re
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CustomNodeType, Integration, IntegrationCredential
from app.integrations.parser import slugify_path
from app.security.crypto import encrypt_credential_data


def _make_slug(method: str, path: str, existing: set[str]) -> str:
    base = f"custom_{method.lower()}_{slugify_path(path)}"
    base = re.sub(r"_+", "_", base)[:100]
    slug = base
    counter = 2
    while slug in existing:
        slug = f"{base}_{counter}"
        counter += 1
    existing.add(slug)
    return slug


def _defaults_from_inputs(expected_inputs: list[dict[str, Any]]) -> dict[str, Any]:
    defaults: dict[str, Any] = {}
    for inp in expected_inputs:
        name = inp.get("name", "")
        if not name or name == "body":
            continue
        inp_type = inp.get("type", "string")
        if inp_type == "boolean":
            defaults[name] = False
        elif inp_type == "number":
            defaults[name] = ""
        else:
            defaults[name] = ""
    return defaults


async def generate_integration(
    db: AsyncSession,
    *,
    user_id: UUID,
    integration_name: str,
    base_url: str,
    spec_source_url: str | None,
    spec_hash: str | None,
    openapi_version: str | None,
    security_schemes: list[dict[str, Any]],
    operation_ids: list[str],
    operation_details: list[dict[str, Any]],
    credential_data: dict[str, Any] | None,
) -> tuple[Integration, list[CustomNodeType]]:
    existing_slugs_result = await db.execute(
        select(CustomNodeType.node_type_slug).where(CustomNodeType.user_id == user_id)
    )
    existing_slugs = set(existing_slugs_result.scalars().all())

    integration = Integration(
        user_id=user_id,
        name=integration_name,
        base_url=base_url.rstrip("/"),
        spec_source_url=spec_source_url,
        spec_hash=spec_hash,
        openapi_version=openapi_version,
        security_scheme={"schemes": security_schemes},
    )
    db.add(integration)
    await db.flush()

    if credential_data:
        encrypted = encrypt_credential_data(credential_data)
        db.add(
            IntegrationCredential(
                integration_id=integration.id,
                user_id=user_id,
                name="Default",
                auth_type=credential_data.get("auth_type", "none"),
                encrypted_data=encrypted,
            )
        )

    details_map = {item["id"]: item for item in operation_details}
    custom_nodes: list[CustomNodeType] = []
    missing = [op_id for op_id in operation_ids if op_id not in details_map]
    if missing and len(missing) == len(operation_ids):
        raise ValueError(f"None of the selected operations were found: {', '.join(missing[:5])}")

    for op_id in operation_ids:
        detail = details_map.get(op_id)
        if not detail:
            continue
        slug = _make_slug(detail["method"], detail["path"], existing_slugs)
        node = CustomNodeType(
            integration_id=integration.id,
            user_id=user_id,
            node_type_slug=slug,
            operation_id=op_id,
            display_name=detail.get("display_name", op_id),
            summary=detail.get("summary"),
            http_method=detail["method"],
            endpoint_path=detail["path"],
            expected_inputs=detail.get("expected_inputs", []),
            response_schema=detail.get("response_schema", {}),
        )
        db.add(node)
        custom_nodes.append(node)

    if not custom_nodes:
        raise ValueError("No valid operations to import")

    await db.flush()
    return integration, custom_nodes

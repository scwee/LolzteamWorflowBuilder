from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class OperationPreview(BaseModel):
    id: str
    method: str
    path: str
    summary: str = ""
    tags: list[str] = Field(default_factory=list)


class SecuritySchemePreview(BaseModel):
    type: str
    name: str = ""
    location: str = ""


class OpenApiPreviewResponse(BaseModel):
    preview_id: str
    integration_name: str
    base_url: str
    operations: list[OperationPreview]
    security_schemes: list[SecuritySchemePreview] = Field(default_factory=list)


class CredentialPayload(BaseModel):
    auth_type: Literal["none", "bearer", "api_key_header", "api_key_query", "basic"] = "none"
    token: str = Field(default="", max_length=4096)
    api_key: str = Field(default="", max_length=4096)
    header_name: str = Field(default="", max_length=128)
    query_name: str = Field(default="", max_length=128)
    username: str = Field(default="", max_length=256)
    password: str = Field(default="", max_length=1024)


class OpenApiImportRequest(BaseModel):
    preview_id: str
    integration_name: str = Field(min_length=1, max_length=255)
    operation_ids: list[str] = Field(min_length=1, max_length=300)
    credential: CredentialPayload | None = None


class CustomNodeTypeResponse(BaseModel):
    id: UUID
    node_type_slug: str
    operation_id: str
    display_name: str
    summary: str | None
    http_method: str
    endpoint_path: str
    integration_id: UUID
    integration_name: str
    category: str
    expected_inputs: list[dict[str, Any]]
    defaults: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class IntegrationResponse(BaseModel):
    id: UUID
    name: str
    base_url: str
    spec_source_url: str | None
    openapi_version: str | None
    security_scheme: dict[str, Any]
    node_count: int = 0
    created_at: str

    model_config = {"from_attributes": True}


class CredentialUpdateRequest(BaseModel):
    name: str = Field(default="Default", max_length=255)
    auth_type: Literal["none", "bearer", "api_key_header", "api_key_query", "basic"] = "none"
    token: str = Field(default="", max_length=4096)
    api_key: str = Field(default="", max_length=4096)
    header_name: str = Field(default="", max_length=128)
    query_name: str = Field(default="", max_length=128)
    username: str = Field(default="", max_length=256)
    password: str = Field(default="", max_length=1024)

import json
import logging
from typing import Any
from urllib.parse import quote, urlencode

from jsonschema import ValidationError, validate

from app.engine.http_util import request_capped_async
from app.engine.registry import ExecutionState
from app.engine.url_guard import validate_outbound_url
from app.flows.schemas import GraphNode
from app.security.crypto import decrypt_credential_data

logger = logging.getLogger(__name__)


def build_auth_headers(credential: dict[str, Any] | None) -> dict[str, str]:
    if not credential:
        return {}
    auth_type = credential.get("auth_type", "none")
    headers: dict[str, str] = {}
    if auth_type == "bearer":
        token = credential.get("token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    elif auth_type in {"api_key_header", "api_key"}:
        header_name = credential.get("header_name") or "X-API-Key"
        api_key = credential.get("api_key") or credential.get("token", "")
        if api_key:
            headers[header_name] = api_key
    elif auth_type == "basic":
        import base64

        username = credential.get("username", "")
        password = credential.get("password", "")
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {encoded}"
    return headers


def _validate_inputs(data: dict[str, Any], expected_inputs: list[dict[str, Any]]) -> None:
    for inp in expected_inputs:
        name = inp.get("name", "")
        if not name:
            continue
        if inp.get("required") and (name not in data or data[name] in ("", None)):
            raise ValueError(f"Missing required field: {name}")
        schema = inp.get("schema")
        if schema and name in data and data[name] not in ("", None):
            # Soft validation: skip OpenAPI-only keywords that break jsonschema
            cleaned = {
                key: value
                for key, value in schema.items()
                if key not in {"nullable", "example", "examples", "xml", "externalDocs"}
            }
            if "$ref" in cleaned or "oneOf" in cleaned or "anyOf" in cleaned:
                continue
            try:
                validate(instance=data[name], schema=cleaned)
            except ValidationError as exc:
                raise ValueError(f"Invalid field {name}: {exc.message}") from exc
            except Exception as exc:  # noqa: BLE001 - malformed schema shouldn't block execution
                logger.debug("Skipping unvalidatable schema for %s: %s", name, exc)
                continue


def _build_url(base_url: str, path: str, path_params: dict[str, Any]) -> str:
    built_path = path
    for key, value in path_params.items():
        built_path = built_path.replace(f"{{{key}}}", quote(str(value), safe=""))
    # Absolute endpoint_path from an imported spec must not override the vetted base_url.
    if built_path.lower().lstrip().startswith(("http:", "https:", "//")):
        raise ValueError("Absolute URLs in endpoint_path are not allowed")
    return validate_outbound_url(f"{base_url.rstrip('/')}/{built_path.lstrip('/')}")


class OpenApiNodeHandler:
    async def execute(
        self,
        node: GraphNode,
        state: ExecutionState,
        template_context: dict[str, Any],
    ) -> dict[str, Any]:
        spec = state.custom_node_specs.get(node.type)
        if not spec:
            raise ValueError(f"Custom node spec not found: {node.type}")

        data = dict(node.data)
        credential_id = data.pop("credential_id", None) or data.pop("_credential_id", None)
        credential = None
        if credential_id and str(credential_id) in state.credentials:
            credential = decrypt_credential_data(state.credentials[str(credential_id)])
        elif spec.get("integration_id") and str(spec["integration_id"]) in state.credentials:
            credential = decrypt_credential_data(state.credentials[str(spec["integration_id"])])

        expected_inputs = spec.get("expected_inputs", [])
        _validate_inputs(data, expected_inputs)

        path_params: dict[str, Any] = {}
        query_params: dict[str, Any] = {}
        headers: dict[str, str] = build_auth_headers(credential)
        body_data: dict[str, Any] = {}

        for inp in expected_inputs:
            name = inp.get("name", "")
            if not name or name not in data:
                continue
            location = inp.get("location", "body")
            value = data[name]
            if location == "path":
                path_params[name] = value
            elif location == "query":
                query_params[name] = value
            elif location == "header":
                header_value = str(value)
                if any(ch in name for ch in "\r\n") or any(ch in header_value for ch in "\r\n"):
                    raise ValueError("Header names/values must not contain CR or LF")
                headers[name] = header_value
            elif location == "cookie":
                cookie_value = str(value)
                if any(ch in name for ch in "\r\n;=") or any(ch in cookie_value for ch in "\r\n;"):
                    raise ValueError("Cookie names/values must not contain CR, LF or ';'")
                existing_cookie = headers.get("Cookie")
                pair = f"{name}={cookie_value}"
                headers["Cookie"] = f"{existing_cookie}; {pair}" if existing_cookie else pair
            elif location == "body":
                if name == "body" and isinstance(value, (dict, list)):
                    body_data = value if isinstance(value, dict) else {"value": value}
                else:
                    body_data[name] = value

        if credential and credential.get("auth_type") in {"api_key_query", "api_key"}:
            location = credential.get("location") or ("query" if credential.get("auth_type") == "api_key_query" else "header")
            if location == "query" or credential.get("auth_type") == "api_key_query":
                query_name = credential.get("query_name") or credential.get("header_name") or "api_key"
                api_key = credential.get("api_key") or credential.get("token", "")
                if api_key:
                    query_params[query_name] = api_key

        method = spec.get("http_method", "GET").upper()
        base_url = spec.get("base_url", "")
        endpoint_path = spec.get("endpoint_path", "")
        url = _build_url(base_url, endpoint_path, path_params)
        if query_params:
            url = f"{url}?{urlencode(query_params)}"

        json_body = body_data if body_data and method in {"POST", "PUT", "PATCH"} else None

        # Pinned IP + capped body (anti DNS-rebinding + anti OOM)
        response = await request_capped_async(
            method,
            url,
            headers=headers,
            json=json_body,
            timeout=30.0,
        )

        try:
            response_json: Any = response.json()
        except ValueError:
            response_json = {"text": response.text}

        return {
            "response": response_json,
            "status_code": response.status_code,
        }


openapi_handler = OpenApiNodeHandler()

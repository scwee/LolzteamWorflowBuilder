import hashlib
import json
import re
from typing import Any

from app.integrations.schemas import OperationPreview, SecuritySchemePreview

MAX_OPERATIONS = 300
MAX_REF_NODES = 20_000
MAX_RESOLVE_DEPTH = 40
MAX_RESOLVED_NODES = 200_000


class OpenApiParseError(Exception):
    pass


def _operation_id(method: str, path: str) -> str:
    return f"{method.upper()} {path}"


def _assert_only_internal_refs(obj: Any, _count: list[int] | None = None) -> None:
    """Reject remote/file $ref (SSRF): resolving them would trigger outbound fetches.

    Only local references (starting with '#') are permitted.
    """
    counter = _count if _count is not None else [0]
    counter[0] += 1
    if counter[0] > MAX_REF_NODES:
        raise OpenApiParseError("Spec too large / too many nodes to resolve safely")
    if isinstance(obj, dict):
        ref = obj.get("$ref")
        if isinstance(ref, str) and not ref.startswith("#"):
            raise OpenApiParseError(
                "External $ref is not allowed (only local '#/...' references are permitted)"
            )
        for value in obj.values():
            _assert_only_internal_refs(value, counter)
    elif isinstance(obj, list):
        for item in obj:
            _assert_only_internal_refs(item, counter)


def _lookup_pointer(root: dict[str, Any], pointer: str) -> Any:
    """Resolve a local JSON pointer like '#/components/schemas/Foo'."""
    if pointer == "#":
        return root
    if not pointer.startswith("#/"):
        raise OpenApiParseError(f"Unsupported $ref format: {pointer}")
    node: Any = root
    for raw_part in pointer[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list):
            try:
                node = node[int(part)]
            except (ValueError, IndexError):
                raise OpenApiParseError(f"Unresolvable $ref: {pointer}") from None
        else:
            raise OpenApiParseError(f"Unresolvable $ref: {pointer}")
    return node


def _resolve_refs(
    obj: Any,
    root: dict[str, Any],
    stack: tuple[str, ...],
    counter: list[int],
    depth: int,
) -> Any:
    """Inline local $ref with bounded depth/size; break cycles with an empty object."""
    counter[0] += 1
    if counter[0] > MAX_RESOLVED_NODES:
        raise OpenApiParseError("Spec expands too much during $ref resolution")
    if depth > MAX_RESOLVE_DEPTH:
        return {}
    if isinstance(obj, dict):
        ref = obj.get("$ref")
        if isinstance(ref, str):
            if ref in stack:
                # circular reference: stop expansion instead of blowing up memory
                return {}
            target = _lookup_pointer(root, ref)
            return _resolve_refs(target, root, stack + (ref,), counter, depth + 1)
        return {
            key: _resolve_refs(value, root, stack, counter, depth + 1)
            for key, value in obj.items()
        }
    if isinstance(obj, list):
        return [_resolve_refs(item, root, stack, counter, depth + 1) for item in obj]
    return obj


def _resolve_spec(spec_dict: dict[str, Any]) -> dict[str, Any]:
    _assert_only_internal_refs(spec_dict)
    try:
        resolved = _resolve_refs(spec_dict, spec_dict, (), [0], 0)
    except OpenApiParseError:
        raise
    except RecursionError as exc:
        raise OpenApiParseError("Spec is too deeply nested to resolve") from exc
    except Exception as exc:
        raise OpenApiParseError(f"Failed to parse OpenAPI spec: {exc}") from exc
    if not isinstance(resolved, dict):
        raise OpenApiParseError("OpenAPI spec must be an object")
    return resolved


def _extract_base_url(spec: dict[str, Any]) -> str:
    if "servers" in spec and spec["servers"]:
        url = spec["servers"][0].get("url", "")
        return url.rstrip("/")
    if "host" in spec:
        scheme = "https"
        if "schemes" in spec and spec["schemes"]:
            scheme = spec["schemes"][0]
        base_path = spec.get("basePath", "").rstrip("/")
        return f"{scheme}://{spec['host']}{base_path}".rstrip("/")
    return ""


def _extract_security_schemes(spec: dict[str, Any]) -> list[SecuritySchemePreview]:
    schemes: list[SecuritySchemePreview] = []
    components = spec.get("components", {})
    security_defs = components.get("securitySchemes", spec.get("securityDefinitions", {}))
    for _name, definition in security_defs.items():
        scheme_type = definition.get("type", definition.get("scheme", "unknown"))
        if scheme_type == "http" and definition.get("scheme") == "bearer":
            schemes.append(SecuritySchemePreview(type="bearer", name="Authorization", location="header"))
        elif scheme_type == "apiKey":
            location = definition.get("in", "header")
            schemes.append(
                SecuritySchemePreview(
                    type="api_key_query" if location == "query" else "api_key_header",
                    name=definition.get("name", ""),
                    location=location,
                )
            )
        elif scheme_type == "basic":
            schemes.append(SecuritySchemePreview(type="basic", name="Authorization", location="header"))
    return schemes


def _schema_type(schema: dict[str, Any] | None) -> str:
    if not schema:
        return "string"
    if "enum" in schema:
        return "enum"
    schema_type = schema.get("type", "string")
    if schema_type == "array":
        return "array"
    if schema_type == "integer":
        return "number"
    return str(schema_type)


def _extract_body_inputs(request_body: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not request_body:
        return []
    content = request_body.get("content", {})
    json_content = content.get("application/json") or next(iter(content.values()), None)
    if not json_content:
        return []
    schema = json_content.get("schema", {})
    if schema.get("type") == "object" and "properties" in schema:
        required_fields = set(schema.get("required", []))
        inputs = []
        for prop_name, prop_schema in schema["properties"].items():
            inputs.append(
                {
                    "name": prop_name,
                    "type": _schema_type(prop_schema),
                    "required": prop_name in required_fields,
                    "location": "body",
                    "description": prop_schema.get("description", ""),
                    "enum": prop_schema.get("enum"),
                    "schema": prop_schema,
                }
            )
        return inputs
    return [
        {
            "name": "body",
            "type": "object",
            "required": request_body.get("required", False),
            "location": "body",
            "description": "Request body",
            "schema": schema,
        }
    ]


def _extract_parameter_inputs(parameters: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not parameters:
        return []
    inputs = []
    for param in parameters:
        if "$ref" in param:
            continue
        location = param.get("in", "query")
        if location == "body":
            schema = param.get("schema", param)
            inputs.extend(_extract_body_inputs({"content": {"application/json": {"schema": schema}}}))
            continue
        schema = param.get("schema", {})
        inputs.append(
            {
                "name": param.get("name", ""),
                "type": _schema_type(schema or param),
                "required": param.get("required", False),
                "location": location,
                "description": param.get("description", ""),
                "enum": schema.get("enum") if schema else param.get("enum"),
                "schema": schema or {},
            }
        )
    return inputs


def extract_operations(spec_dict: dict[str, Any]) -> tuple[dict[str, Any], list[OperationPreview], list[dict[str, Any]]]:
    spec = _resolve_spec(spec_dict)
    paths = spec.get("paths", {})
    operations: list[OperationPreview] = []
    operation_details: list[dict[str, Any]] = []

    for path, path_item in paths.items():
        if len(operations) >= MAX_OPERATIONS:
            raise OpenApiParseError(f"Spec exceeds {MAX_OPERATIONS} operations")
        if not isinstance(path_item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            if method not in path_item:
                continue
            operation = path_item[method]
            if not isinstance(operation, dict):
                continue
            op_id = _operation_id(method, path)
            summary = operation.get("summary") or operation.get("operationId") or op_id
            operations.append(
                OperationPreview(
                    id=op_id,
                    method=method.upper(),
                    path=path,
                    summary=summary,
                    tags=operation.get("tags", []),
                )
            )
            parameters = list(operation.get("parameters", []))
            if "parameters" in path_item:
                parameters = list(path_item.get("parameters", [])) + parameters
            expected_inputs = _extract_parameter_inputs(parameters)
            expected_inputs.extend(_extract_body_inputs(operation.get("requestBody")))
            responses = operation.get("responses", {})
            response_schema: dict[str, Any] = {}
            for code in ("200", "201", "default"):
                if code in responses:
                    content = responses[code].get("content", {})
                    json_resp = content.get("application/json", {})
                    response_schema = json_resp.get("schema", {})
                    break
            operation_details.append(
                {
                    "id": op_id,
                    "method": method.upper(),
                    "path": path,
                    "summary": summary,
                    "display_name": summary,
                    "expected_inputs": expected_inputs,
                    "response_schema": response_schema,
                }
            )

    return spec, operations, operation_details


def parse_openapi_spec(spec_dict: dict[str, Any]) -> dict[str, Any]:
    spec, operations, operation_details = extract_operations(spec_dict)
    base_url = _extract_base_url(spec)
    integration_name = spec.get("info", {}).get("title", "Custom API")
    spec_hash = hashlib.sha256(json.dumps(spec_dict, sort_keys=True).encode()).hexdigest()
    return {
        "integration_name": integration_name,
        "base_url": base_url,
        "openapi_version": str(spec.get("openapi", spec.get("swagger", "unknown"))),
        "security_schemes": [s.model_dump() for s in _extract_security_schemes(spec)],
        "operations": [op.model_dump() for op in operations],
        "operation_details": operation_details,
        "spec_hash": spec_hash,
    }


def slugify_path(path: str) -> str:
    slug = re.sub(r"[^\w]+", "_", path.strip("/"))
    return slug.strip("_") or "root"

"""LZT Market node handlers: api_call and file_source."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.catalog.loader import get_endpoint
from app.engine.file_utils import (
    build_file_source_body,
    looks_like_csv,
    parse_csv_records,
    parse_line_credentials,
)
from app.engine.lzt_client import lzt_request
from app.engine.rate_limit import rate_limiter
from app.engine.registry import ExecutionState
from app.engine.topology import GraphExecutionError


def _load_lzt_account_token(account_id: str, owner_user_id: UUID | None) -> str:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.config import settings
    from app.db.models import LztAccount
    from app.security.crypto import decrypt_secret

    if not owner_user_id:
        raise GraphExecutionError("api_call: owner_user_id required for account_id")

    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        account = session.get(LztAccount, UUID(str(account_id)))
        if not account or account.user_id != owner_user_id:
            raise GraphExecutionError("LZT account not found")
        return decrypt_secret(account.token_encrypted)
    finally:
        session.close()
        engine.dispose()


def _load_flow_files(
    file_ids: list[str],
    owner_user_id: UUID | None,
) -> list[dict[str, Any]]:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.config import settings
    from app.db.models import FlowFile

    if not file_ids:
        return []
    if not owner_user_id:
        raise GraphExecutionError("file_source: owner_user_id required for file_ids")

    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        files: list[dict[str, Any]] = []
        for file_id in file_ids:
            row = session.get(FlowFile, UUID(str(file_id)))
            if not row or row.user_id != owner_user_id:
                raise GraphExecutionError(f"Flow file not found: {file_id}")
            content = row.content_text or ""
            if row.encoding == "base64" and content:
                import base64 as _b64

                try:
                    content = _b64.b64decode(content).decode("utf-8", errors="replace")
                except (ValueError, TypeError):
                    content = ""
            files.append(
                {
                    "name": row.filename,
                    "size": row.size,
                    "mimeType": row.mime_type,
                    "encoding": row.encoding,
                    "content": content,
                }
            )
        return files
    finally:
        session.close()
        engine.dispose()


def resolve_api_token(data: dict[str, Any], state: ExecutionState) -> str:
    account_id = data.get("account_id")
    if account_id:
        return _load_lzt_account_token(str(account_id), state.owner_user_id)

    inline_token = data.get("token")
    if isinstance(inline_token, str) and inline_token.strip():
        return inline_token.strip()

    if state.lzt_token:
        return state.lzt_token

    raise GraphExecutionError("api_call requires account_id or token")


def run_api_call(data: dict[str, Any], state: ExecutionState) -> dict[str, Any]:
    endpoint_id = data.get("endpoint_id")
    if not endpoint_id:
        raise GraphExecutionError("api_call requires endpoint_id")

    endpoint = get_endpoint(str(endpoint_id))
    if not endpoint:
        raise GraphExecutionError(f"Unknown endpoint: {endpoint_id}")

    token = resolve_api_token(data, state)
    state.lzt_token = token

    params = data.get("params") or {}
    if not isinstance(params, dict):
        raise GraphExecutionError("api_call params must be an object")

    method = str(endpoint.get("method") or "GET").upper()
    path = str(endpoint.get("pathTemplate") or endpoint.get("path") or "")
    bucket = str(endpoint.get("rateLimitBucket") or ("base-get" if method == "GET" else "base-non-get"))
    min_delay = endpoint.get("minDelayMs")
    min_delay_ms = int(min_delay) if min_delay is not None else None
    retry_on_retry = bool(endpoint.get("retryOnRetryRequest"))

    rate_limiter.wait_for_bucket(bucket, min_delay_ms)
    result = lzt_request(
        method,
        path,
        dict(params),
        token,
        retry_on_retry_request=retry_on_retry,
        proxy=state.flow_proxy,
    )

    status = int(result.get("status") or 0)
    body = result.get("body")
    if status >= 400:
        raise GraphExecutionError(f"LZT API error {status}: {body!r}")

    return {
        "response": body,
        "status": status,
        "headers": result.get("headers") or {},
        "duration_ms": result.get("duration"),
    }


def run_account_status(data: dict[str, Any], state: ExecutionState) -> dict[str, Any]:
    """Проверяет валидность LZT-токена через /me: возвращает nickname/баланс или ошибку."""
    token = resolve_api_token(data, state)
    state.lzt_token = token

    rate_limiter.wait_for_bucket("base-get")
    result = lzt_request("GET", "/me", None, token, proxy=state.flow_proxy)
    status = int(result.get("status") or 0)
    body = result.get("body")

    valid = 200 <= status < 300 and isinstance(body, dict)
    user = {}
    if isinstance(body, dict):
        user = body.get("user") if isinstance(body.get("user"), dict) else body

    nickname = ""
    balance = None
    if valid:
        nickname = str(
            user.get("username") or user.get("nickname") or body.get("username") or ""
        )
        raw_balance = user.get("balance")
        if raw_balance is None and isinstance(body, dict):
            raw_balance = body.get("balance")
        if raw_balance is not None:
            try:
                balance = float(raw_balance)
            except (TypeError, ValueError):
                balance = None

    return {
        "response": {
            "valid": valid,
            "status": status,
            "nickname": nickname,
            "balance": balance,
            "user_id": user.get("user_id") or user.get("id"),
        },
        "status": status,
        "logs": [f"Account status: {'valid' if valid else f'invalid ({status})'}"],
    }


def run_file_source(data: dict[str, Any], state: ExecutionState) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    inline = data.get("files")
    if isinstance(inline, list):
        for item in inline:
            if isinstance(item, dict):
                files.append(
                    {
                        "name": item.get("name") or item.get("filename") or "inline.txt",
                        "size": item.get("size") or len(str(item.get("content") or "")),
                        "mimeType": item.get("mimeType") or item.get("mime_type") or "text/plain",
                        "encoding": item.get("encoding") or "text",
                        "content": item.get("content") or "",
                    }
                )

    file_ids = data.get("file_ids") or []
    if isinstance(file_ids, list) and file_ids:
        files.extend(_load_flow_files([str(fid) for fid in file_ids], state.owner_user_id))

    body = build_file_source_body(files)
    iterate_lines = data.get("iterate_lines")
    if iterate_lines is None:
        iterate_lines = True

    if not iterate_lines:
        return {"response": body}

    records = _build_records(files, body, data)

    dedup = bool(data.get("dedup"))
    if dedup:
        records = _dedup_records(records)

    if not records:
        return {
            "response": {**body, "itemCount": 0},
            "_fan_out": True,
            "_items": [],
            "_skip_downstream": True,
            "logs": ["file_source: нет строк для обработки"],
        }

    items: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        payload = {**record, "item_index": index}
        item: dict[str, Any] = {**payload, "response": payload}
        proxy = record.get("proxy")
        if isinstance(proxy, str) and proxy.strip():
            item["proxy"] = proxy.strip()
        items.append(item)

    max_parallel = data.get("max_parallel")
    result: dict[str, Any] = {
        "response": {**body, "itemCount": len(items)},
        "_fan_out": True,
        "_items": items,
    }
    if isinstance(max_parallel, (int, float)) and int(max_parallel) > 0:
        result["_max_parallel"] = int(max_parallel)
    return result


def _build_records(
    files: list[dict[str, Any]],
    body: dict[str, Any],
    data: dict[str, Any],
) -> list[dict[str, Any]]:
    """Формирует список записей из файлов: CSV с заголовком или строки login:pass."""
    fmt = str(data.get("format") or "auto").lower()
    text_files = [f for f in files if f.get("encoding") == "text"]
    combined_text = "\n".join(str(f.get("content") or "") for f in text_files)

    use_csv = fmt == "csv" or (fmt == "auto" and looks_like_csv(combined_text))
    if use_csv:
        records: list[dict[str, Any]] = []
        for f in text_files:
            records.extend(parse_csv_records(str(f.get("content") or "")))
        return records

    records = []
    for line in body.get("lines") or []:
        creds = parse_line_credentials(str(line))
        records.append(
            {
                "line": line,
                "login": creds.get("login"),
                "password": creds.get("password"),
                "email": creds.get("email"),
            }
        )
    return records


def _dedup_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for record in records:
        key = record.get("line") or f"{record.get('login')}:{record.get('password')}"
        key = str(key)
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    return unique

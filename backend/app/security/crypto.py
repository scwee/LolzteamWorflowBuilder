import logging
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger(__name__)
_plaintext_warned = False

ENCRYPTED_PREFIX = "enc:v1:"
# Placeholder returned to clients instead of a stored secret; on save it is swapped back
# for the previously stored ciphertext so the plaintext never leaves the server.
SECRET_MASK = "__kept_secret__"

# Field names (case-insensitive) treated as secrets at any depth of a node's data.
SENSITIVE_KEY_NAMES = {
    "token",
    "api_key",
    "apikey",
    "password",
    "secret",
    "client_secret",
    "access_token",
    "refresh_token",
    "authorization",
}
SENSITIVE_NODE_FIELDS: dict[str, set[str]] = {
    "api_call": {"token"},
}


def _is_sensitive_key(key: str, node_type: str = "") -> bool:
    if key.lower() in SENSITIVE_KEY_NAMES:
        return True
    return key in SENSITIVE_NODE_FIELDS.get(node_type, set())


REDACTED = "***"
# Keys whose values are redacted anywhere they appear in persisted run data / logs.
REDACT_KEY_NAMES = SENSITIVE_KEY_NAMES | {"password"}


def redact_secrets(obj: Any, _depth: int = 0) -> Any:
    """Recursively replace values of secret-looking keys with '***'.

    Applied before persisting run context / node snapshots so credentials and
    account passwords don't leak into the DB or the UI.
    """
    if _depth > 30:
        return obj
    if isinstance(obj, dict):
        result: dict[str, Any] = {}
        for key, value in obj.items():
            if isinstance(key, str) and key.lower() in REDACT_KEY_NAMES and isinstance(value, str) and value:
                result[key] = REDACTED
            else:
                result[key] = redact_secrets(value, _depth + 1)
        return result
    if isinstance(obj, list):
        return [redact_secrets(item, _depth + 1) for item in obj]
    return obj


def _fernet() -> Fernet | None:
    if not settings.secrets_encryption_key:
        return None
    return Fernet(settings.secrets_encryption_key.encode())


def encrypt_secret(value: str) -> str:
    if not value:
        return value
    if is_encrypted(value):
        return value
    fernet = _fernet()
    if fernet is None:
        if settings.is_production:
            raise RuntimeError("SECRETS_ENCRYPTION_KEY is not configured")
        global _plaintext_warned
        if not _plaintext_warned:
            _plaintext_warned = True
            logger.warning(
                "SECRETS_ENCRYPTION_KEY is not set — secrets are stored in PLAINTEXT. "
                "Generate a key: python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\""
            )
        return value
    token = fernet.encrypt(value.encode()).decode()
    return f"{ENCRYPTED_PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    if not value:
        return value
    if not is_encrypted(value):
        return value
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("SECRETS_ENCRYPTION_KEY is required to decrypt stored secrets")
    token = value[len(ENCRYPTED_PREFIX) :]
    try:
        return fernet.decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Failed to decrypt stored secret") from exc


def is_encrypted(value: str) -> bool:
    return isinstance(value, str) and value.startswith(ENCRYPTED_PREFIX)


def encrypt_credential_data(data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in data.items():
        if _is_sensitive_key(key) and isinstance(value, str) and value:
            result[key] = encrypt_secret(value)
        else:
            result[key] = value
    return result


def decrypt_credential_data(data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in data.items():
        if _is_sensitive_key(key) and isinstance(value, str) and value:
            result[key] = decrypt_secret(value)
        else:
            result[key] = value
    return result


def _transform_data(value: Any, node_type: str, fn, _depth: int = 0) -> Any:
    """Recursively apply `fn(str)` to values under sensitive keys (any nesting depth)."""
    if _depth > 30:
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, val in value.items():
            if (
                isinstance(key, str)
                and _is_sensitive_key(key, node_type)
                and isinstance(val, str)
                and val
            ):
                out[key] = fn(val)
            else:
                out[key] = _transform_data(val, node_type, fn, _depth + 1)
        return out
    if isinstance(value, list):
        return [_transform_data(item, node_type, fn, _depth + 1) for item in value]
    return value


def _walk_graph(graph: dict[str, Any], fn) -> dict[str, Any]:
    result = dict(graph)
    nodes = []
    for node in graph.get("nodes", []):
        node_copy = dict(node)
        node_type = node.get("type", "")
        node_copy["data"] = _transform_data(node.get("data") or {}, node_type, fn)
        nodes.append(node_copy)
    result["nodes"] = nodes
    settings = dict(graph.get("settings") or {})
    proxy = settings.get("proxy")
    if isinstance(proxy, str) and proxy:
        settings["proxy"] = fn(proxy)
    result["settings"] = settings
    return result


def encrypt_graph_secrets(graph: dict[str, Any]) -> dict[str, Any]:
    return _walk_graph(graph, encrypt_secret)


def decrypt_graph_secrets(graph: dict[str, Any]) -> dict[str, Any]:
    return _walk_graph(graph, decrypt_secret)


def mask_graph_secrets(graph: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a (decrypted) graph with secret values replaced by SECRET_MASK.

    Used for API responses so plaintext secrets never leave the backend.
    """
    return _walk_graph(graph, lambda _v: SECRET_MASK)


def _restore_value(value: Any, prev: Any, node_type: str, _depth: int = 0) -> Any:
    if _depth > 30:
        return value
    if isinstance(value, dict):
        prev_dict = prev if isinstance(prev, dict) else {}
        out: dict[str, Any] = {}
        for key, val in value.items():
            if isinstance(key, str) and _is_sensitive_key(key, node_type) and val == SECRET_MASK:
                if key in prev_dict:
                    out[key] = prev_dict[key]
                # else: drop the masked placeholder entirely
            else:
                out[key] = _restore_value(val, prev_dict.get(key) if isinstance(prev, dict) else None, node_type, _depth + 1)
        return out
    if isinstance(value, list):
        prev_list = prev if isinstance(prev, list) else []
        return [
            _restore_value(item, prev_list[i] if i < len(prev_list) else None, node_type, _depth + 1)
            for i, item in enumerate(value)
        ]
    return value


def restore_masked_secrets(new_graph: dict[str, Any], stored_graph: dict[str, Any]) -> dict[str, Any]:
    """Swap SECRET_MASK placeholders in an incoming graph for the stored (encrypted) values.

    `stored_graph` is the raw graph_json from DB (still encrypted). Node identity is by id.
    """
    stored_nodes = {n.get("id"): (n.get("data") or {}) for n in stored_graph.get("nodes", [])}
    result = dict(new_graph)
    nodes = []
    for node in new_graph.get("nodes", []):
        node_copy = dict(node)
        node_type = node.get("type", "")
        prev = stored_nodes.get(node.get("id"), {})
        node_copy["data"] = _restore_value(node.get("data") or {}, prev, node_type)
        nodes.append(node_copy)
    result["nodes"] = nodes
    settings = dict(new_graph.get("settings") or {})
    if settings.get("proxy") == SECRET_MASK:
        stored_settings = stored_graph.get("settings") or {}
        if "proxy" in stored_settings:
            settings["proxy"] = stored_settings["proxy"]
        else:
            settings.pop("proxy", None)
    result["settings"] = settings
    return result

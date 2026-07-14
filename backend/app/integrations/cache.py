import json
import uuid
from typing import Any

import redis

from app.config import settings

PREVIEW_TTL_SECONDS = 900
RATE_LIMIT_WINDOW_SECONDS = 3600
RATE_LIMIT_MAX_REQUESTS = 10

# Atomic incr-with-expiry: sets TTL on first hit so a crash between INCR/EXPIRE
# can never leave a permanent key (which would ban a client forever).
_RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
"""

# Process-wide client with a bounded connection pool (avoids per-call pool churn).
_client: redis.Redis | None = None
_rate_script = None


def _redis_client() -> redis.Redis:
    global _client, _rate_script
    if _client is None:
        _client = redis.from_url(
            settings.redis_url, decode_responses=True, max_connections=50
        )
        _rate_script = _client.register_script(_RATE_LIMIT_LUA)
    return _client


def _incr_window(key: str, window_seconds: int) -> int:
    _redis_client()
    return int(_rate_script(keys=[key], args=[window_seconds]))


def check_rate_limit(user_id: str, action: str, *, limit: int = RATE_LIMIT_MAX_REQUESTS) -> bool:
    return check_rate_limit_window(user_id, action, limit=limit)


def check_rate_limit_window(
    key_id: str,
    action: str,
    *,
    limit: int,
    window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
) -> bool:
    count = _incr_window(f"rate:{action}:{key_id}", window_seconds)
    return count <= limit


def store_preview(user_id: str, data: dict[str, Any]) -> str:
    preview_id = str(uuid.uuid4())
    client = _redis_client()
    payload = {"user_id": user_id, **data}
    payload.pop("raw_spec", None)
    client.setex(f"openapi_preview:{preview_id}", PREVIEW_TTL_SECONDS, json.dumps(payload))
    return preview_id


def get_preview(preview_id: str, user_id: str) -> dict[str, Any] | None:
    client = _redis_client()
    raw = client.get(f"openapi_preview:{preview_id}")
    if not raw:
        return None
    data = json.loads(raw)
    if data.get("user_id") != user_id:
        return None
    return data


def delete_preview(preview_id: str) -> None:
    client = _redis_client()
    client.delete(f"openapi_preview:{preview_id}")

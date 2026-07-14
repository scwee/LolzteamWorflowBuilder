from contextlib import contextmanager
from typing import Iterator

import redis

from app.config import settings

# Process-wide client with a bounded pool; avoids opening a new pool per lock.
_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, max_connections=20)
    return _client


@contextmanager
def redis_lock(key: str, *, ttl_seconds: int = 55) -> Iterator[bool]:
    lock = _get_client().lock(key, timeout=ttl_seconds, blocking=False)
    acquired = lock.acquire(blocking=False)
    try:
        yield acquired
    finally:
        if acquired:
            try:
                lock.release()
            except redis.exceptions.LockError:
                pass

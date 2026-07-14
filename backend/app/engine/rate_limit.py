import time

BUCKET_DEFAULTS = {
    "base-get": 200,
    "base-non-get": 2000,
    "letters": 12000,
    "batch": 3000,
    "check-account": 200,
    "search": 3000,
    "edit": 60,
    "confirm-buy": 60,
    "email-code": 200,
}


class RateLimitManager:
    def __init__(self) -> None:
        self._buckets: dict[str, dict[str, float | int]] = {}

    def wait_for_bucket(self, bucket: str, min_delay_ms: int | None = None) -> None:
        delay = min_delay_ms or BUCKET_DEFAULTS.get(bucket, 500)
        state = self._buckets.get(bucket, {"last_request_at": 0.0, "min_delay_ms": delay})
        state["min_delay_ms"] = max(int(state["min_delay_ms"]), delay)
        now = time.time() * 1000
        elapsed = now - float(state["last_request_at"])
        if elapsed < state["min_delay_ms"]:
            time.sleep((state["min_delay_ms"] - elapsed) / 1000)
        state["last_request_at"] = time.time() * 1000
        self._buckets[bucket] = state


# Shared per-worker process (Celery worker / API process)
rate_limiter = RateLimitManager()

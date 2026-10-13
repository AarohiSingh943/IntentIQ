import asyncio
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings
from app.core.logging import get_logger, request_id_var

logger = get_logger("http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attaches a request id, measures latency, adds security headers and a timeout guard."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        token = request_id_var.set(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            if request.url.path.endswith("/stream"):
                response = await call_next(request)
            else:
                response = await asyncio.wait_for(
                    call_next(request), timeout=settings.request_timeout_seconds
                )
        except TimeoutError:
            logger.error("request timed out after %.1fs", settings.request_timeout_seconds)
            response = JSONResponse(
                status_code=504,
                content={"error": "timeout", "detail": "The request took too long."},
            )
        finally:
            request_id_var.reset(token)

        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["x-request-id"] = request_id
        response.headers["x-response-time-ms"] = f"{elapsed_ms:.1f}"
        response.headers.setdefault("x-content-type-options", "nosniff")
        response.headers.setdefault("x-frame-options", "DENY")
        response.headers.setdefault("referrer-policy", "strict-origin-when-cross-origin")
        if request.url.path.startswith("/api"):
            response.headers.setdefault("cache-control", "no-store")
        logger.info(
            "%s %s -> %s (%.0f ms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """A small in-process token bucket per client for the planning endpoints."""

    def __init__(self, app, limits: dict[str, int]):
        super().__init__(app)
        self.limits = {prefix: float(per_minute) for prefix, per_minute in limits.items()}
        self._buckets: dict[str, tuple[float, float]] = {}

    def _client_key(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "anonymous"

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        prefix = next((p for p in self.limits if request.url.path.startswith(p)), None)
        if prefix is None or request.method == "OPTIONS":
            return await call_next(request)

        capacity = self.limits[prefix]
        refill_per_second = capacity / 60.0
        key = f"{prefix}|{self._client_key(request)}"
        now = time.monotonic()
        tokens, last = self._buckets.get(key, (capacity, now))
        tokens = min(capacity, tokens + (now - last) * refill_per_second)
        if tokens < 1.0:
            retry_after = int((1.0 - tokens) / refill_per_second) + 1
            self._buckets[key] = (tokens, now)
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limited",
                    "detail": "Too many requests. Try again shortly.",
                },
                headers={"retry-after": str(retry_after)},
            )
        self._buckets[key] = (tokens - 1.0, now)
        if len(self._buckets) > 10_000:
            stale = [k for k, (_, t) in self._buckets.items() if now - t > 600]
            for k in stale:
                self._buckets.pop(k, None)
        return await call_next(request)

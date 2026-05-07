"""Rate limiting middleware using slowapi.

Apply to auth endpoints to prevent brute-force attacks.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse

limiter = Limiter(key_func=get_remote_address)


async def rate_limit_handler(_request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return a clean JSON 429 instead of slowapi's default plain text."""
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )

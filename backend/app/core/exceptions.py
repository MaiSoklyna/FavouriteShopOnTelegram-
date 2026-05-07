"""Application exceptions and FastAPI error handlers.

Every custom exception maps to an HTTP status code. Route handlers raise
these instead of constructing HTTPException directly — this keeps routes
thin and ensures a consistent JSON error envelope everywhere:

    {"detail": "Human-readable message"}

Register the handlers on your FastAPI app with `register_exception_handlers(app)`.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


# ── Base exception ──────────────────────────────────────────────


class AppError(Exception):
    """Base class for all application errors.

    Subclasses set `status_code` so the exception handler knows which
    HTTP status to return without routes having to specify it.
    """

    status_code: int = 500

    def __init__(self, detail: str = "Internal server error"):
        self.detail = detail
        super().__init__(detail)


# ── Auth errors (401) ───────────────────────────────────────────


class AuthenticationError(AppError):
    """Caller is not authenticated or token is invalid/expired."""

    status_code = 401

    def __init__(self, detail: str = "Not authenticated"):
        super().__init__(detail)


# ── Permission errors (403) ─────────────────────────────────────


class ForbiddenError(AppError):
    """Caller is authenticated but lacks the required role/permission."""

    status_code = 403

    def __init__(self, detail: str = "Insufficient permissions"):
        super().__init__(detail)


# ── Not found (404) ─────────────────────────────────────────────


class NotFoundError(AppError):
    """Requested resource does not exist."""

    status_code = 404

    def __init__(self, resource: str = "Resource", identifier: str | int = ""):
        detail = f"{resource} not found" if not identifier else f"{resource} #{identifier} not found"
        super().__init__(detail)


# ── Conflict (409) ──────────────────────────────────────────────


class ConflictError(AppError):
    """Action conflicts with current state (e.g. duplicate email)."""

    status_code = 409

    def __init__(self, detail: str = "Conflict"):
        super().__init__(detail)


# ── Validation / bad request (400) ──────────────────────────────


class BadRequestError(AppError):
    """Client sent a malformed or logically invalid request."""

    status_code = 400

    def __init__(self, detail: str = "Bad request"):
        super().__init__(detail)


# ── Rate limit (429) ───────────────────────────────────────────


class RateLimitError(AppError):
    """Caller has exceeded the allowed request rate."""

    status_code = 429

    def __init__(self, detail: str = "Too many requests, please try again later"):
        super().__init__(detail)


# ── Exception handlers ─────────────────────────────────────────


def register_exception_handlers(app: FastAPI) -> None:
    """Attach custom error handlers to the FastAPI application.

    Call this once during app setup, after creating the FastAPI instance.
    """

    @app.exception_handler(AppError)
    async def _app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Flatten pydantic errors into a human-readable message
        messages: list[str] = []
        for err in exc.errors():
            loc = " → ".join(str(part) for part in err["loc"] if part != "body")
            messages.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        return JSONResponse(
            status_code=422,
            content={"detail": "; ".join(messages)},
        )

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
        from app.config import settings

        detail = str(exc) if settings.DEBUG else "Internal server error"
        return JSONResponse(
            status_code=500,
            content={"detail": detail},
        )

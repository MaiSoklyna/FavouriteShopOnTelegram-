"""Shared schemas used across multiple domains."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE


class PaginationParams(BaseModel):
    """Common pagination query parameters."""

    page: int = Field(1, ge=1)
    page_size: int = Field(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


class PaginatedResponse(BaseModel):
    """Wrapper for paginated list responses."""

    data: list
    total: int
    page: int
    page_size: int
    total_pages: int


class SuccessResponse(BaseModel):
    """Simple success acknowledgement."""

    success: bool = True
    message: str | None = None

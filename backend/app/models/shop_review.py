"""Shop review schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ShopReviewCreate(BaseModel):
    order_id: int
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class VisibilityUpdate(BaseModel):
    is_visible: bool

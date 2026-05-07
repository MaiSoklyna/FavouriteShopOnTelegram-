"""Product review schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    product_id: int
    order_id: int | None = None
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=2000)


class ReviewResponse(BaseModel):
    id: int
    product_id: int
    user_id: int
    order_id: int | None = None
    rating: int
    comment: str | None = None
    user_name: str | None = None
    created_at: datetime | None = None

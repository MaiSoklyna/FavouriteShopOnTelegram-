"""Activity tracking schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ActivityIn(BaseModel):
    """One thing the browser saw the customer do. Add to cart and orders are recorded by the server itself."""
    type: Literal["product_view", "shop_view", "search"]
    session_id: str | None = Field(None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    product_id: int | None = Field(None, gt=0)
    merchant_id: int | None = Field(None, gt=0)
    query: str | None = Field(None, max_length=200)
    result_count: int | None = Field(None, ge=0, le=100000)

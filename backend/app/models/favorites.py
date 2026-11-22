"""Favorites schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SyncRequest(BaseModel):
    """Product ids hearted on this device before signing in."""
    product_ids: list[int] = Field(default_factory=list, max_length=500)

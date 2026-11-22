"""Coupon schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class GrantRequest(BaseModel):
    """Give a coupon to specific customers (by their id or Telegram id)."""

    user_ids: list[int] = Field(default_factory=list, max_length=500)
    telegram_ids: list[int] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def _someone(self):
        if not self.user_ids and not self.telegram_ids:
            raise ValueError("Choose at least one customer")
        return self

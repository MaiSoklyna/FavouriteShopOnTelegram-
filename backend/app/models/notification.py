"""Notification schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SendNotificationRequest(BaseModel):
    user_id: int | None = None
    user_ids: list[int] | None = None
    type: str = Field("promo", pattern=r"^(promo|order|system|loyalty)$")
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=2000)
    ref_id: int | None = None


class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: str
    title: str
    body: str
    ref_id: int | None = None
    is_read: bool = False
    sent_at: datetime | None = None
    user_name: str | None = None

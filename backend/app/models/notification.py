"""Notification schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# What the admin form calls a type -> what the database enum accepts (order_update | promo | system)
STORED_TYPE = {"promo": "promo", "order": "order_update", "order_update": "order_update",
               "system": "system", "loyalty": "system"}


class SendNotificationRequest(BaseModel):
    user_id: int | None = None
    user_ids: list[int] | None = None
    type: str = Field("promo", pattern=r"^(promo|order|order_update|system|loyalty)$")
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=2000)
    ref_id: int | None = None

    @property
    def stored_type(self) -> str:
        return STORED_TYPE[self.type]


class NotificationResponse(BaseModel):
    id: int
    user_id: int | None = None
    merchant_id: int | None = None
    type: str
    kind: str | None = None
    title: str
    body: str
    ref_id: int | None = None
    link: str | None = None
    is_read: bool = False
    sent_at: datetime | None = None
    user_name: str | None = None

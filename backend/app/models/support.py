"""Support ticket schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.core.constants import TicketStatus


class TicketCreate(BaseModel):
    merchant_id: int
    subject: str = Field(..., min_length=3, max_length=200)
    message: str = Field(..., min_length=5, max_length=2000)
    order_id: int | None = None


class TicketReply(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class TicketMessageResponse(BaseModel):
    id: int
    ticket_id: int
    sender_type: str  # customer | merchant
    sender_id: int | None = None
    body: str
    created_at: datetime | None = None


class TicketResponse(BaseModel):
    id: int
    subject: str
    status: str
    order_id: int | None = None
    customer_name: str | None = None
    customer_username: str | None = None
    last_message: str | None = None
    message_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    messages: list[TicketMessageResponse] = []

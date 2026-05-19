"""User (customer) schemas — end-users who shop via Telegram Mini App."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    """Fields a user can update on their own profile.

    Field names mirror columns in the ``users`` table verbatim — the route
    forwards model_dump() straight to PostgREST.
    """

    first_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=20)
    email: str | None = Field(None, max_length=150)
    address: str | None = Field(None, max_length=500)


class UserResponse(BaseModel):
    """Public user profile returned by API."""

    id: int
    telegram_id: int
    username: str | None = None
    first_name: str
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    language: str = "en"
    address: str | None = None
    is_active: bool = True
    created_at: datetime | None = None

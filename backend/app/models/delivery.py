"""Delivery schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DriverCreate(BaseModel):
    """Make a person (who has opened the bot once) a driver."""

    telegram_id: int = Field(..., gt=0)
    full_name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=6, max_length=20, pattern=r"^[0-9+ ()-]+$")
    vehicle: str | None = Field(None, max_length=60)
    # Super admin only: None = a platform driver any shop can use. A shop admin's driver is always their own.
    merchant_id: int | None = None


class DriverUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=100)
    phone: str | None = Field(None, min_length=6, max_length=20, pattern=r"^[0-9+ ()-]+$")
    vehicle: str | None = Field(None, max_length=60)
    is_active: bool | None = None


class AssignRequest(BaseModel):
    driver_id: int


class AvailabilityUpdate(BaseModel):
    is_available: bool


class FailRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


class JobActionRequest(BaseModel):
    """Optional details for a driver action: why it failed ("fail"), the customer's code ("deliver")."""
    reason: str | None = Field(None, max_length=300)
    code: str | None = Field(None, max_length=12)

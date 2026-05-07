"""Loyalty program schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.core.constants import LoyaltyTier


class LoyaltySettingsUpdate(BaseModel):
    is_enabled: bool = False
    points_per_dollar: float = Field(10.0, ge=0)
    points_value_cents: int = Field(1, ge=1)
    min_redeem_points: int = Field(100, ge=1)
    bronze_threshold: int = Field(0, ge=0)
    silver_threshold: int = Field(500, ge=0)
    gold_threshold: int = Field(2000, ge=0)
    silver_multiplier: float = Field(1.5, ge=1.0)
    gold_multiplier: float = Field(2.0, ge=1.0)


class LoyaltySettingsResponse(BaseModel):
    id: int
    is_enabled: bool
    points_per_dollar: float
    points_value_cents: int
    min_redeem_points: int
    bronze_threshold: int
    silver_threshold: int
    gold_threshold: int
    silver_multiplier: float
    gold_multiplier: float


class LoyaltyAccountResponse(BaseModel):
    id: int
    user_id: int
    balance: int = 0
    lifetime_points: int = 0
    tier: str = "bronze"
    created_at: datetime | None = None


class PointsAdjustRequest(BaseModel):
    account_id: int
    user_id: int | None = None
    points: int
    description: str = Field("Manual adjustment", max_length=500)


class PointsRedeemRequest(BaseModel):
    points: int = Field(..., gt=0)


class LoyaltyStatsResponse(BaseModel):
    totalMembers: int = 0
    tiers: dict[str, int] = {}
    totalEarned: int = 0
    totalRedeemed: int = 0

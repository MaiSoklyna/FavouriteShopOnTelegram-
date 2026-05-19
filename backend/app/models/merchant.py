"""Merchant schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MerchantCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    owner_name: str = Field(..., min_length=1, max_length=200)
    email: str = Field(..., min_length=3, max_length=254)
    phone: str | None = Field(None, max_length=20)
    tagline: str | None = Field(None, max_length=300)
    description: str | None = Field(None, max_length=2000)
    icon_emoji: str | None = None
    accent_color: str | None = Field(None, max_length=7)
    plan: str = "Basic"
    telegram_token: str | None = None
    deep_link_code: str | None = None
    fb_page: str | None = Field(None, max_length=300)
    instagram: str | None = Field(None, max_length=300)
    logo_url: str | None = Field(None, max_length=500)
    is_featured: bool = False
    telegram_group_id: int | None = None


class MerchantUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    owner_name: str | None = Field(None, min_length=1, max_length=200)
    email: str | None = Field(None, min_length=3, max_length=254)
    phone: str | None = Field(None, max_length=20)
    tagline: str | None = Field(None, max_length=300)
    description: str | None = Field(None, max_length=2000)
    icon_emoji: str | None = None
    accent_color: str | None = Field(None, max_length=7)
    plan: str | None = None
    telegram_token: str | None = None
    deep_link_code: str | None = None
    status: str | None = Field(None, pattern=r"^(active|suspended|pending)$")
    fb_page: str | None = Field(None, max_length=300)
    instagram: str | None = Field(None, max_length=300)
    logo_url: str | None = Field(None, max_length=500)
    is_featured: bool | None = None
    telegram_group_id: int | None = None


class MerchantResponse(BaseModel):
    id: int
    name: str
    slug: str
    owner_name: str
    email: str
    phone: str | None = None
    tagline: str | None = None
    description: str | None = None
    icon_emoji: str | None = None
    accent_color: str | None = None
    plan: str
    deep_link_code: str | None = None
    status: str
    fb_page: str | None = None
    instagram: str | None = None
    logo_url: str | None = None
    is_featured: bool = False
    telegram_group_id: int | None = None
    product_count: int = 0
    order_count: int = 0
    created_at: datetime | None = None

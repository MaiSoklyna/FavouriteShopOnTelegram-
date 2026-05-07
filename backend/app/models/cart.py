"""Cart schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SelectedVariant(BaseModel):
    variant_id: int
    option_id: int
    group_name: str
    label: str


class CartItemAdd(BaseModel):
    product_id: int
    quantity: int = Field(1, ge=1, le=99)
    selected_variants: list[SelectedVariant] = []


class CartItemUpdate(BaseModel):
    quantity: int = Field(..., ge=0, le=99)


class CartItemResponse(BaseModel):
    id: int
    cart_id: int
    product_id: int
    quantity: int
    selected_variants: list | None = None
    unit_price: float
    line_total: float
    product_name: str | None = None
    icon_emoji: str | None = None
    merchant_name: str | None = None
    primary_image: str | None = None
    created_at: datetime | None = None


class CartSummary(BaseModel):
    item_count: int
    subtotal: float
    items: list[CartItemResponse] = []

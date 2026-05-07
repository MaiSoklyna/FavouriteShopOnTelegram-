"""Order schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.core.constants import OrderStatus


class OrderCreate(BaseModel):
    merchant_id: int
    delivery_address: str = Field(..., min_length=5, max_length=500)
    delivery_province: str | None = Field(None, max_length=100)
    payment_method: str = Field("cod", pattern=r"^(khqr|cod|aba|wing)$")
    promo_code: str | None = Field(None, max_length=50)
    customer_note: str | None = Field(None, max_length=1000)


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    admin_note: str | None = Field(None, max_length=1000)
    payment_status: str | None = None


class OrderItemResponse(BaseModel):
    id: int
    product_id: int | None = None
    product_name: str
    product_sku: str | None = None
    selected_variants: list | None = None
    quantity: int
    unit_price: float
    subtotal: float


class OrderResponse(BaseModel):
    id: int
    order_code: str
    merchant_id: int
    merchant_name: str | None = None
    user_id: int
    customer_name: str | None = None
    customer_phone: str | None = None
    subtotal: float
    discount_amount: float = 0
    delivery_fee: float = 0
    total: float
    status: str
    payment_method: str
    payment_status: str
    delivery_address: str
    delivery_province: str | None = None
    customer_note: str | None = None
    admin_note: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[OrderItemResponse] | None = None


class PromoValidateRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=50)
    merchant_id: int
    cart_total: float = Field(..., gt=0)

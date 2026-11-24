"""Product and category schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


# ── Variants ────────────────────────────────────────────────────


class VariantOptionCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=100)
    hex_color: str | None = None
    price_adjust: float = 0.00
    stock_adjust: int = 0
    is_popular: bool = False
    sort_order: int = 0


class VariantGroupCreate(BaseModel):
    group_name: str = Field(..., min_length=1, max_length=100)
    type: str = Field("custom", pattern=r"^(size|color|weight|custom)$")
    sort_order: int = 0
    options: list[VariantOptionCreate] = []


class VariantOptionResponse(BaseModel):
    id: int
    label: str
    hex_color: str | None = None
    price_adjust: float
    stock_adjust: int
    is_popular: bool
    is_active: bool
    sort_order: int


class VariantGroupResponse(BaseModel):
    id: int
    group_name: str
    type: str
    sort_order: int
    options: list[VariantOptionResponse] = []


# ── Product Images ──────────────────────────────────────────────


class ProductImageResponse(BaseModel):
    id: int
    url: str
    alt_text: str | None = None
    sort_order: int


# ── Products ────────────────────────────────────────────────────


def _zero_is_none(v: int | None) -> int | None:
    """The admin form sends 0 for "no selection"; store that as NULL."""
    return v or None


class ProductCreate(BaseModel):
    # Owning shop. Required for super_admin; ignored for merchant_admin (their
    # own shop is always used).
    merchant_id: int | None = None
    category_id: int | None = None
    name: str = Field(..., min_length=1, max_length=200)
    slug: str | None = None
    description: str | None = Field(None, max_length=5000)
    sku: str | None = Field(None, max_length=50)
    base_price: float = Field(..., ge=0)
    compare_price: float | None = Field(None, ge=0)
    stock: int = Field(0, ge=0)
    weight: str | None = None
    delivery_days: int = Field(3, ge=0)
    icon_emoji: str | None = None
    is_featured: bool = False
    variants: list[VariantGroupCreate] = []

    _category_zero = field_validator("category_id", "merchant_id")(_zero_is_none)


class ProductUpdate(BaseModel):
    # Reassigning a product to another shop is super_admin only.
    merchant_id: int | None = None
    category_id: int | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=5000)
    sku: str | None = Field(None, max_length=50)
    base_price: float | None = Field(None, ge=0)
    compare_price: float | None = Field(None, ge=0)
    stock: int | None = Field(None, ge=0)
    weight: str | None = None
    delivery_days: int | None = Field(None, ge=0)
    icon_emoji: str | None = None
    is_featured: bool | None = None
    is_active: bool | None = None

    _category_zero = field_validator("category_id", "merchant_id")(_zero_is_none)


class ProductResponse(BaseModel):
    id: int
    merchant_id: int
    category_id: int | None = None
    name: str
    slug: str
    description: str | None = None
    sku: str | None = None
    base_price: float
    compare_price: float | None = None
    stock: int
    weight: str | None = None
    delivery_days: int
    icon_emoji: str | None = None
    rating_avg: float = 0.0
    review_count: int = 0
    is_active: bool = True
    is_featured: bool = False
    created_at: datetime | None = None
    merchant_name: str | None = None
    category_name: str | None = None
    primary_image: str | None = None
    images: list[ProductImageResponse] = []
    variants: list[VariantGroupResponse] = []


# ── Categories ──────────────────────────────────────────────────


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    name_kh: str | None = Field(None, max_length=100)
    icon_emoji: str | None = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    name_kh: str | None = Field(None, max_length=100)
    icon_emoji: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryResponse(BaseModel):
    id: int
    merchant_id: int | None = None
    name: str
    name_kh: str | None = None
    icon_emoji: str | None = None
    sort_order: int
    is_active: bool = True
    product_count: int = 0

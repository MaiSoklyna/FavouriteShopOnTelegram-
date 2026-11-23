"""Merchant collections: a shop's own curated, ordered product lists."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_COLLECTIONS_PER_SHOP = 20
MAX_PRODUCTS_PER_COLLECTION = 60


def _ordered_unique(ids: list[int]) -> list[int]:
    seen: set[int] = set()
    out = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


class CollectionIn(BaseModel):
    """Create or edit a collection. Only manual collections can be made today."""
    title: str = Field(..., min_length=1, max_length=80)
    description: str | None = Field(None, max_length=300)
    type: str = Field("manual", pattern=r"^(manual|smart)$")
    is_active: bool = True
    sort_order: int = Field(0, ge=0, le=10_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    merchant_id: int | None = None          # super admin only: which shop
    product_ids: list[int] | None = None    # create: the products, in order (optional)
    remove_cover: bool = False              # edit: drop the cover image

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Give the collection a title")
        return v

    @field_validator("description")
    @classmethod
    def _description(cls, v: str | None) -> str | None:
        return (v or "").strip() or None

    @field_validator("product_ids")
    @classmethod
    def _products(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        v = _ordered_unique(v)
        if len(v) > MAX_PRODUCTS_PER_COLLECTION:
            raise ValueError(f"A collection can hold up to {MAX_PRODUCTS_PER_COLLECTION} products")
        return v

    @model_validator(mode="after")
    def _dates(self):
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValueError("The end date must be after the start date")
        return self


class CollectionProducts(BaseModel):
    """The collection's products, in the order customers see them."""
    product_ids: list[int]

    @field_validator("product_ids")
    @classmethod
    def _products(cls, v: list[int]) -> list[int]:
        v = _ordered_unique(v)
        if len(v) > MAX_PRODUCTS_PER_COLLECTION:
            raise ValueError(f"A collection can hold up to {MAX_PRODUCTS_PER_COLLECTION} products")
        return v

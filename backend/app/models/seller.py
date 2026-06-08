"""Seller application schemas.

A mini-app user submits a SellerApplicationCreate. A super admin reviews it
and either approves (provisioning a merchant + merchant_admin login) or rejects.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class SellerApplicationCreate(BaseModel):
    # Seller type
    seller_type: Literal["individual", "company"] = "individual"

    # Applicant / KYC
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str = Field(..., min_length=3, max_length=150)
    phone: str | None = Field(None, max_length=30)
    gender: str | None = Field(None, max_length=20)
    date_of_birth: date | None = None
    company_name: str | None = Field(None, max_length=150)
    password: str = Field(..., min_length=8, max_length=128)

    # Store
    store_name: str = Field(..., min_length=2, max_length=150)
    store_description: str | None = Field(None, max_length=2000)
    logo_url: str | None = Field(None, max_length=500)

    # Store location
    province: str | None = Field(None, max_length=100)
    district: str | None = Field(None, max_length=100)
    commune: str | None = Field(None, max_length=100)
    address_line1: str | None = Field(None, max_length=255)
    address_line2: str | None = Field(None, max_length=255)

    # Terms
    agree_terms: bool = False


class SellerApplicationReview(BaseModel):
    """Body for approve/reject — an optional note shown to the applicant."""
    note: str | None = Field(None, max_length=2000)


class SellerApplicationResponse(BaseModel):
    id: int
    seller_type: str
    full_name: str
    email: str
    phone: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    company_name: str | None = None
    store_name: str
    store_description: str | None = None
    logo_url: str | None = None
    province: str | None = None
    district: str | None = None
    commune: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    status: str
    review_note: str | None = None
    merchant_id: int | None = None
    created_at: datetime | None = None
    reviewed_at: datetime | None = None

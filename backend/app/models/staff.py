"""Shop staff accounts (managed by the shop owner)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Roles an owner can give: shops have one owner, set when the shop is approved
AssignableRole = Literal["manager", "staff"]


def _clean_email(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if "@" not in v or v.startswith("@") or v.endswith("@") or " " in v:
        raise ValueError("Enter a valid email address")
    return v


def _clean_name(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip()
    if not v:
        raise ValueError("Enter the staff member's name")
    return v


class StaffCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    telegram_id: int | None = Field(None, gt=0)
    role: AssignableRole = "staff"

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return _clean_email(v)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v):
        return _clean_name(v)


class StaffUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=100)
    email: str | None = Field(None, min_length=3, max_length=254)
    new_password: str | None = Field(None, min_length=8, max_length=128)
    telegram_id: int | None = Field(None, gt=0)
    clear_telegram_id: bool = False
    is_active: bool | None = None
    role: AssignableRole | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return _clean_email(v)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v):
        return _clean_name(v)

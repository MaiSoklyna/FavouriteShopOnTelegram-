"""Authentication request/response schemas.

Consolidates models that were scattered across admin_auth.py,
telegram_auth.py, and miniapp_api.py into a single module.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ── Telegram Auth ───────────────────────────────────────────────


class TelegramWidgetPayload(BaseModel):
    """Payload from Telegram Login Widget (browser-side)."""

    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str


class TelegramMiniAppPayload(BaseModel):
    """Payload from Telegram Mini App (initData)."""

    telegram_id: int
    username: str = ""
    first_name: str = ""
    last_name: str = ""


class TelegramUser(BaseModel):
    """User object returned after Telegram auth."""

    id: str
    telegram_id: int
    name: str
    avatar_url: str | None = None


class TelegramAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: TelegramUser


# ── Admin Auth ──────────────────────────────────────────────────


class AdminLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1)
    role: str = Field("merchant", pattern=r"^(merchant|super_admin)$")


class AdminUser(BaseModel):
    """Admin user object returned in login responses."""

    id: int
    email: str
    name: str
    role: str
    merchant_id: int | None = None
    merchant_name: str | None = None


class AdminLoginResponse(BaseModel):
    access_token: str
    expires_in: int
    user: AdminUser


# ── Token ───────────────────────────────────────────────────────


class TokenResponse(BaseModel):
    """Generic token response used by refresh and session endpoints."""

    access_token: str
    expires_in: int
    token_type: str = "bearer"


# ── Login Sessions (Telegram → Dashboard polling) ──────────────


class LoginSessionResponse(BaseModel):
    session_id: str


class PollSessionResponse(BaseModel):
    status: str  # pending | completed | expired
    token: str | None = None
    user: dict[str, Any] | None = None


# ── Profile Management ──────────────────────────────────────────


class UpdateProfileRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: str = Field(..., min_length=3, max_length=254)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


# ── Merchant Admin Management ───────────────────────────────────


class CreateMerchantAdminRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=200)
    merchant_id: int
    role: str = "admin"
    telegram_id: int | None = None


class UpdateMerchantAdminRequest(BaseModel):
    """Super-admin can update any of these fields. All optional."""
    full_name: str | None = Field(None, min_length=1, max_length=200)
    email: str | None = Field(None, min_length=3, max_length=254)
    new_password: str | None = Field(None, min_length=8, max_length=128)
    telegram_id: int | None = None
    clear_telegram_id: bool = False
    is_active: bool | None = None

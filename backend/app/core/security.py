"""Single source of truth for authentication primitives.

Replaces the four duplicated JWT-minting functions that were scattered
across telegram_auth.py, admin_auth.py, miniapp_api.py, and bot/start.py,
plus the legacy utils/security.py helpers.

All tokens are Supabase-compatible: signed with SUPABASE_JWT_SECRET,
aud="authenticated", role="authenticated", with an `app_role` claim
that carries the application-level role (user / merchant_admin / super_admin).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import bcrypt
import jwt as pyjwt

from app.config import settings
from app.core.constants import (
    ADMIN_TOKEN_EXPIRY,
    JWT_ALGORITHM,
    JWT_AUDIENCE,
    JWT_ISSUER,
    Role,
    SESSION_TOKEN_EXPIRY,
    TELEGRAM_AUTH_MAX_AGE,
    USER_TOKEN_EXPIRY,
)

logger = logging.getLogger(__name__)


# ── Token claims dataclass ──────────────────────────────────────


@dataclass(frozen=True, slots=True)
class TokenClaims:
    """Parsed and validated JWT payload.

    Every authenticated request gets one of these via the dependency layer.
    Using a dataclass instead of a raw dict prevents typo-based bugs
    (e.g. claims["merhcant_id"]) and gives IDE autocompletion.
    """

    sub: str                          # User / admin ID (string)
    role: Role                        # Application role
    telegram_id: int | None = None
    merchant_id: int | None = None
    email: str | None = None
    name: str | None = None
    exp: int = 0
    iat: int = 0

    @property
    def is_super_admin(self) -> bool:
        return self.role == Role.SUPER_ADMIN

    @property
    def is_admin(self) -> bool:
        return self.role in (Role.MERCHANT_ADMIN, Role.SUPER_ADMIN)

    @property
    def is_user(self) -> bool:
        return self.role == Role.USER


# ── JWT minting ─────────────────────────────────────────────────


def mint_jwt(
    *,
    sub: str,
    role: Role,
    telegram_id: int | None = None,
    merchant_id: int | None = None,
    email: str | None = None,
    name: str | None = None,
    expires_in: int | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Create a Supabase-compatible HS256 JWT.

    This is the ONLY place in the codebase that creates tokens.
    The `role` claim is always "authenticated" (Supabase requirement).
    The actual application role goes into `app_role`.
    """
    now = int(time.time())

    if expires_in is None:
        expires_in = (
            ADMIN_TOKEN_EXPIRY if role != Role.USER else USER_TOKEN_EXPIRY
        )

    claims: dict[str, Any] = {
        "sub": sub,
        "role": "authenticated",
        "aud": JWT_AUDIENCE,
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + expires_in,
        "app_role": str(role),
    }

    if telegram_id is not None:
        claims["telegram_id"] = telegram_id
    if merchant_id is not None:
        claims["merchant_id"] = merchant_id
    if email is not None:
        claims["email"] = email
    if name is not None:
        claims["name"] = name
    if extra_claims:
        claims.update(extra_claims)

    return pyjwt.encode(claims, settings.SUPABASE_JWT_SECRET, algorithm=JWT_ALGORITHM)


def mint_session_token(
    *,
    sub: str,
    role: Role,
    telegram_id: int | None = None,
    name: str | None = None,
) -> str:
    """Short-lived token for Telegram widget auth (15 min)."""
    return mint_jwt(
        sub=sub,
        role=role,
        telegram_id=telegram_id,
        name=name,
        expires_in=SESSION_TOKEN_EXPIRY,
    )


# ── JWT verification ───────────────────────────────────────────


class InvalidTokenError(Exception):
    """Raised when a JWT cannot be verified or decoded."""

    def __init__(self, reason: str = "Invalid token"):
        self.reason = reason
        super().__init__(reason)


class TokenExpiredError(InvalidTokenError):
    """Raised when a JWT has expired."""

    def __init__(self) -> None:
        super().__init__("Token expired")


def verify_jwt(token: str) -> TokenClaims:
    """Decode and validate a JWT, returning structured claims.

    Raises InvalidTokenError or TokenExpiredError on failure.
    Only accepts tokens signed with SUPABASE_JWT_SECRET / HS256.
    The legacy SECRET_KEY fallback is intentionally removed.
    """
    try:
        raw: dict[str, Any] = pyjwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
        )
    except pyjwt.ExpiredSignatureError:
        raise TokenExpiredError()
    except pyjwt.InvalidTokenError as exc:
        raise InvalidTokenError(str(exc))

    # Map app_role string to Role enum, default to USER
    app_role_str = raw.get("app_role", "user")
    try:
        app_role = Role(app_role_str)
    except ValueError:
        app_role = Role.USER

    return TokenClaims(
        sub=str(raw.get("sub", "")),
        role=app_role,
        telegram_id=raw.get("telegram_id"),
        merchant_id=raw.get("merchant_id"),
        email=raw.get("email"),
        name=raw.get("name"),
        exp=raw.get("exp", 0),
        iat=raw.get("iat", 0),
    )


# ── Telegram verification ──────────────────────────────────────


def verify_telegram_hash(data: dict[str, Any], received_hash: str) -> bool:
    """Verify HMAC-SHA256 signature per Telegram Login Widget / WebApp spec.

    Args:
        data: All payload fields EXCEPT "hash".
        received_hash: The hash field from Telegram.

    Returns:
        True if the signature is valid.
    """
    secret = hashlib.sha256(settings.TELEGRAM_BOT_TOKEN.encode()).digest()
    parts = sorted(f"{k}={v}" for k, v in data.items() if v is not None)
    data_check_string = "\n".join(parts)
    computed = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, received_hash)


def is_telegram_auth_fresh(auth_date: int) -> bool:
    """Return True if auth_date is within the allowed window."""
    return (time.time() - auth_date) <= TELEGRAM_AUTH_MAX_AGE


# ── Deterministic UUID ──────────────────────────────────────────


def derive_user_uuid(telegram_id: int) -> str:
    """Deterministic UUID v5 from a Telegram user ID.

    Ensures the same Telegram user always maps to the same Supabase user UUID,
    regardless of which auth path they take (widget, bot, miniapp).
    """
    return str(uuid5(NAMESPACE_URL, f"telegram:{telegram_id}"))


# ── Password hashing ───────────────────────────────────────────


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Compare a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

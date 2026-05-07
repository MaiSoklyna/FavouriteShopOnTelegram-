"""Unified authentication routes.

Consolidates all auth flows into one module:
- Telegram widget/miniapp auth (users)
- Admin email/password login
- Telegram → Dashboard session-based login
- Token refresh
- Profile & password management

All JWT creation goes through ``core.security.mint_jwt``.
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.config import settings
from app.core.rate_limit import limiter
from app.core.constants import (
    ADMIN_TOKEN_EXPIRY,
    LOGIN_SESSION_PREFIX,
    LOGIN_SESSION_TTL,
    USER_TOKEN_EXPIRY,
    Role,
)
from app.core.dependencies import get_current_user, require_any_admin, require_role
from app.core.exceptions import (
    AuthenticationError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from app.core.security import (
    TokenClaims,
    derive_user_uuid,
    hash_password,
    is_telegram_auth_fresh,
    mint_jwt,
    verify_password,
    verify_telegram_hash,
)
from app.db.client import SupabaseClient
from app.models.auth import (
    AdminLoginRequest,
    AdminLoginResponse,
    AdminUser,
    ChangePasswordRequest,
    CreateMerchantAdminRequest,
    UpdateMerchantAdminRequest,
    LoginSessionResponse,
    PollSessionResponse,
    TelegramAuthResponse,
    TelegramMiniAppPayload,
    TelegramUser,
    TelegramWidgetPayload,
    TokenResponse,
    UpdateProfileRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Authentication"])


# ═══════════════════════════════════════════════════════════════
#  TELEGRAM AUTH (users — miniapp + widget)
# ═══════════════════════════════════════════════════════════════


@router.post("/telegram-widget", response_model=TelegramAuthResponse)
async def telegram_widget_auth(payload: TelegramWidgetPayload):
    """Authenticate via Telegram Login Widget (HMAC-verified)."""

    data = payload.model_dump(exclude={"hash"})
    if not verify_telegram_hash(data, payload.hash):
        raise AuthenticationError("Invalid Telegram hash")

    if not is_telegram_auth_fresh(payload.auth_date):
        raise AuthenticationError("Auth data is stale")

    user_uuid = derive_user_uuid(payload.id)
    name = payload.first_name
    if payload.last_name:
        name += f" {payload.last_name}"

    token = mint_jwt(
        sub=user_uuid,
        role=Role.USER,
        telegram_id=payload.id,
        name=name,
    )

    # Best-effort profile upsert
    await _upsert_telegram_user(payload.id, name, payload.username)

    return TelegramAuthResponse(
        access_token=token,
        expires_in=USER_TOKEN_EXPIRY,
        user=TelegramUser(
            id=user_uuid,
            telegram_id=payload.id,
            name=name,
            avatar_url=payload.photo_url,
        ),
    )


@router.post("/telegram", response_model=TelegramAuthResponse)
async def telegram_miniapp_auth(body: TelegramMiniAppPayload):
    """Authenticate from Telegram Mini App (initData already verified by bot).

    This endpoint is called after the backend has verified initData server-side.
    The miniapp sends the extracted user fields.
    """
    name = body.first_name or body.username or f"user_{body.telegram_id}"
    if body.last_name:
        name += f" {body.last_name}"

    user_uuid = derive_user_uuid(body.telegram_id)

    # Upsert user
    await _upsert_telegram_user(body.telegram_id, name, body.username)

    # Look up the actual DB user to get their integer ID
    async with SupabaseClient.service_role() as db:
        user = await db.from_("users").eq("telegram_id", body.telegram_id).select_one("id,telegram_id,username,first_name,last_name")

    token = mint_jwt(
        sub=user_uuid,
        role=Role.USER,
        telegram_id=body.telegram_id,
        name=name,
    )

    return TelegramAuthResponse(
        access_token=token,
        expires_in=USER_TOKEN_EXPIRY,
        user=TelegramUser(
            id=user_uuid,
            telegram_id=body.telegram_id,
            name=name,
        ),
    )


async def _upsert_telegram_user(telegram_id: int, name: str, username: Optional[str]) -> None:
    """Best-effort upsert — never fails the auth flow."""
    try:
        async with SupabaseClient.service_role() as db:
            parts = name.split(" ", 1)
            body = {
                "telegram_id": telegram_id,
                "first_name": parts[0],
                "last_name": parts[1] if len(parts) > 1 else "",
            }
            if username:
                body["username"] = username

            existing = await db.from_("users").eq("telegram_id", telegram_id).select_one("id")
            if existing:
                await db.from_("users").eq("telegram_id", telegram_id).update(body)
            else:
                await db.from_("users").insert(body)
    except Exception:
        logger.exception("Profile upsert failed (non-fatal)")


# ═══════════════════════════════════════════════════════════════
#  ADMIN EMAIL/PASSWORD LOGIN
# ═══════════════════════════════════════════════════════════════


@router.post("/admin-login", response_model=AdminLoginResponse)
@limiter.limit("5/minute")
async def admin_login(request: Request, body: AdminLoginRequest):
    """Authenticate admin via email/password."""

    async with SupabaseClient.service_role() as db:
        if body.role == "super_admin":
            return await _login_super_admin(db, body)
        return await _login_merchant_admin(db, body)


async def _login_super_admin(db, body: AdminLoginRequest) -> AdminLoginResponse:
    admin = await db.from_("super_admins").eq("email", body.email.strip()).select_one(
        "id,full_name,email,password_hash,is_active"
    )
    if not admin:
        raise AuthenticationError("Invalid credentials")
    if not admin.get("is_active"):
        raise AuthenticationError("Account is inactive")
    if not verify_password(body.password, admin["password_hash"]):
        raise AuthenticationError("Invalid credentials")

    await db.from_("super_admins").eq("id", admin["id"]).update(
        {"last_login": datetime.now(timezone.utc).isoformat()}
    )

    token = mint_jwt(
        sub=str(admin["id"]),
        role=Role.SUPER_ADMIN,
        email=admin["email"],
    )

    return AdminLoginResponse(
        access_token=token,
        expires_in=ADMIN_TOKEN_EXPIRY,
        user=AdminUser(
            id=admin["id"],
            email=admin["email"],
            name=admin["full_name"],
            role="super_admin",
        ),
    )


async def _login_merchant_admin(db, body: AdminLoginRequest) -> AdminLoginResponse:
    admin = await db.from_("merchant_admins").eq("email", body.email.strip()).select_one(
        "id,merchant_id,full_name,email,password_hash,role,is_active"
    )
    if not admin:
        raise AuthenticationError("Invalid credentials")
    if not admin.get("is_active"):
        raise AuthenticationError("Account is inactive")
    if not verify_password(body.password, admin["password_hash"]):
        raise AuthenticationError("Invalid credentials")

    # Check merchant not suspended
    merchant_name = None
    if admin.get("merchant_id"):
        merchant = await db.from_("merchants").eq("id", admin["merchant_id"]).select_one("name,status")
        if merchant:
            if merchant.get("status") == "suspended":
                raise ForbiddenError("Merchant account is suspended")
            merchant_name = merchant.get("name")

    await db.from_("merchant_admins").eq("id", admin["id"]).update(
        {"last_login": datetime.now(timezone.utc).isoformat()}
    )

    token = mint_jwt(
        sub=str(admin["id"]),
        role=Role.MERCHANT_ADMIN,
        merchant_id=admin["merchant_id"],
        email=admin["email"],
    )

    return AdminLoginResponse(
        access_token=token,
        expires_in=ADMIN_TOKEN_EXPIRY,
        user=AdminUser(
            id=admin["id"],
            email=admin["email"],
            name=admin["full_name"],
            role="merchant",
            merchant_id=admin["merchant_id"],
            merchant_name=merchant_name,
        ),
    )


# ═══════════════════════════════════════════════════════════════
#  TELEGRAM → DASHBOARD SESSION LOGIN (polling flow)
# ═══════════════════════════════════════════════════════════════


@router.post("/tg-session", response_model=LoginSessionResponse)
@limiter.limit("10/minute")
async def create_tg_session(request: Request):
    """Create a Telegram login session for the dashboard.

    The browser shows a QR/link to t.me/bot?start=SESSION_ID.
    The bot completes the session when the admin taps it.
    """
    session_id = LOGIN_SESSION_PREFIX + secrets.token_urlsafe(32)
    async with SupabaseClient.service_role() as db:
        await db.from_("login_sessions").insert({"session_id": session_id})
    return LoginSessionResponse(session_id=session_id)


@router.get("/poll-session", response_model=PollSessionResponse)
@limiter.limit("30/minute")
async def poll_tg_session(request: Request, session_id: str):
    """Poll a Telegram login session until completed or expired."""

    async with SupabaseClient.service_role() as db:
        row = await (
            db.from_("login_sessions")
            .eq("session_id", session_id)
            .select_one("session_id,jwt_token,user_id,status,created_at")
        )
        if not row:
            raise NotFoundError("Session")

        # Check expiry
        created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - created).total_seconds()
        if age > LOGIN_SESSION_TTL:
            await db.from_("login_sessions").eq("session_id", session_id).update({"status": "expired"})
            return PollSessionResponse(status="expired")

        if row["status"] != "completed" or not row.get("jwt_token"):
            return PollSessionResponse(status="pending")

        # Session completed — resolve admin user
        user_data = await _resolve_admin_user(db, row)

        # Clean up session
        await db.from_("login_sessions").eq("session_id", session_id).delete()

        return PollSessionResponse(
            status="completed",
            token=row["jwt_token"],
            user=user_data,
        )


async def _resolve_admin_user(db, session_row: dict) -> Optional[dict]:
    """Look up admin profile from a completed login session."""
    user_id = session_row.get("user_id")
    if not user_id:
        return None

    # Try super_admin first
    sa = await db.from_("super_admins").eq("id", user_id).select_one("id,full_name,email")
    if sa:
        return {
            "id": sa["id"],
            "email": sa["email"],
            "name": sa["full_name"],
            "role": "super_admin",
        }

    # Then merchant_admin
    admin = await db.from_("merchant_admins").eq("id", user_id).select_one(
        "id,merchant_id,full_name,email,role"
    )
    if admin:
        merchant_name = None
        if admin.get("merchant_id"):
            m = await db.from_("merchants").eq("id", admin["merchant_id"]).select_one("name")
            if m:
                merchant_name = m["name"]
        return {
            "id": admin["id"],
            "email": admin["email"],
            "name": admin["full_name"],
            "role": "merchant",
            "merchant_id": admin["merchant_id"],
            "merchant_name": merchant_name,
        }

    return None


# ═══════════════════════════════════════════════════════════════
#  TOKEN REFRESH
# ═══════════════════════════════════════════════════════════════


@router.post("/refresh-token", response_model=TokenResponse)
async def refresh_token(user: TokenClaims = Depends(get_current_user)):
    """Issue a new token with extended expiry."""
    token = mint_jwt(
        sub=user.sub,
        role=user.role,
        email=user.email,
        merchant_id=user.merchant_id,
        telegram_id=user.telegram_id,
    )
    expiry = ADMIN_TOKEN_EXPIRY if user.is_admin else USER_TOKEN_EXPIRY
    return TokenResponse(access_token=token, expires_in=expiry)


# ═══════════════════════════════════════════════════════════════
#  PROFILE MANAGEMENT (admin self-service)
# ═══════════════════════════════════════════════════════════════


@router.get("/me")
async def get_current_profile(user: TokenClaims = Depends(get_current_user)):
    """Get the authenticated user's profile."""

    async with SupabaseClient.service_role() as db:
        if user.is_super_admin:
            row = await db.from_("super_admins").eq("id", user.sub).select_one(
                "id,full_name,email,is_active"
            )
            if not row:
                raise NotFoundError("Admin", user.sub)
            return {"id": row["id"], "email": row["email"], "name": row["full_name"], "role": "super_admin"}

        if user.role == Role.MERCHANT_ADMIN:
            row = await db.from_("merchant_admins").eq("id", user.sub).select_one(
                "id,merchant_id,full_name,email,role,is_active"
            )
            if not row:
                raise NotFoundError("Admin", user.sub)
            merchant_name = None
            if row.get("merchant_id"):
                m = await db.from_("merchants").eq("id", row["merchant_id"]).select_one("name")
                if m:
                    merchant_name = m["name"]
            return {
                "id": row["id"], "email": row["email"], "name": row["full_name"],
                "role": "merchant", "merchant_id": row["merchant_id"],
                "merchant_name": merchant_name,
            }

        # Regular user
        row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one()
        if not row:
            raise NotFoundError("User")
        return row


@router.post("/update-profile")
async def update_profile(body: UpdateProfileRequest, user: TokenClaims = require_any_admin()):
    """Update admin name and email."""
    async with SupabaseClient.service_role() as db:
        table = "super_admins" if user.is_super_admin else "merchant_admins"
        await db.from_(table).eq("id", user.sub).update(
            {"full_name": body.name, "email": body.email}
        )
    return {"success": True}


@router.post("/change-password")
@limiter.limit("3/minute")
async def change_password(request: Request, body: ChangePasswordRequest, user: TokenClaims = require_any_admin()):
    """Change admin password (requires current password)."""
    async with SupabaseClient.service_role() as db:
        table = "super_admins" if user.is_super_admin else "merchant_admins"
        row = await db.from_(table).eq("id", user.sub).select_one("password_hash")
        if not row:
            raise NotFoundError("Admin", user.sub)

        if not verify_password(body.current_password, row["password_hash"]):
            raise BadRequestError("Current password is incorrect")

        await db.from_(table).eq("id", user.sub).update(
            {"password_hash": hash_password(body.new_password)}
        )
    return {"success": True}


# ═══════════════════════════════════════════════════════════════
#  MERCHANT ADMIN MANAGEMENT (super_admin only)
# ═══════════════════════════════════════════════════════════════


@router.post("/create-merchant-admin")
async def create_merchant_admin(
    body: CreateMerchantAdminRequest,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Create a merchant admin account."""
    async with SupabaseClient.service_role() as db:
        # Validate merchant exists
        m = await db.from_("merchants").eq("id", body.merchant_id).select_one("id")
        if not m:
            raise NotFoundError("Merchant", body.merchant_id)

        # Check email unique
        existing = await db.from_("merchant_admins").eq("email", body.email.strip()).select_one("id")
        if existing:
            raise ConflictError("Email already in use")

        row = {
            "email": body.email.strip(),
            "password_hash": hash_password(body.password),
            "full_name": body.full_name,
            "merchant_id": body.merchant_id,
            "role": body.role,
        }
        if body.telegram_id:
            row["telegram_id"] = body.telegram_id

        result = await db.from_("merchant_admins").insert(row)
    return {"success": True, "data": result}


@router.get("/merchant-admins")
async def list_merchant_admins(
    merchant_id: Optional[int] = None,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """List merchant admin accounts."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("merchant_admins").order("created_at", desc=True)
        if merchant_id:
            q = q.eq("merchant_id", merchant_id)
        return await q.select("id,merchant_id,full_name,email,role,is_active,last_login,created_at")


@router.patch("/merchant-admins/{admin_id}")
async def update_merchant_admin(
    admin_id: int,
    body: UpdateMerchantAdminRequest,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Super-admin: update a merchant admin's profile, password, or telegram_id."""
    async with SupabaseClient.service_role() as db:
        existing = await db.from_("merchant_admins").eq("id", admin_id).select_one("id,email")
        if not existing:
            raise NotFoundError("Merchant admin", admin_id)

        data: dict = {}
        if body.full_name is not None:
            data["full_name"] = body.full_name
        if body.email is not None:
            new_email = body.email.strip()
            if new_email != existing["email"]:
                clash = await (
                    db.from_("merchant_admins")
                    .eq("email", new_email)
                    .neq("id", admin_id)
                    .select_one("id")
                )
                if clash:
                    raise ConflictError("Email already in use")
                data["email"] = new_email
        if body.new_password is not None:
            data["password_hash"] = hash_password(body.new_password)
        if body.clear_telegram_id:
            data["telegram_id"] = None
        elif body.telegram_id is not None:
            data["telegram_id"] = body.telegram_id
        if body.is_active is not None:
            data["is_active"] = body.is_active

        if not data:
            raise BadRequestError("No fields to update")

        await db.from_("merchant_admins").eq("id", admin_id).update(data)
    return {"success": True}


@router.delete("/merchant-admins/{admin_id}")
async def delete_merchant_admin(
    admin_id: int,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Delete a merchant admin account."""
    async with SupabaseClient.service_role() as db:
        await db.from_("merchant_admins").eq("id", admin_id).delete()
    return {"success": True}

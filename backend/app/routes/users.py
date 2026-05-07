"""User management routes.

User self-service (profile update) + admin user listing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.user import ProfileUpdate

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me")
async def get_my_profile(user: TokenClaims = require_role(Role.USER)):
    """Get the current user's profile."""
    async with SupabaseClient.service_role() as db:
        row = await _get_db_user(db, user)
    return row


@router.patch("/me")
async def update_my_profile(body: ProfileUpdate, user: TokenClaims = require_role(Role.USER)):
    """Update the current user's profile."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        data = body.model_dump(exclude_none=True)
        if data:
            await db.from_("users").eq("id", db_user["id"]).update(data)
        updated = await db.from_("users").eq("id", db_user["id"]).select_one()
    return updated


# ═══════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("")
async def list_users(
    search: str | None = None,
    is_active: bool | None = None,
    page: int = 1,
    page_size: int = 25,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """List all users (super_admin only)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("users").order("created_at", desc=True)
        if is_active is not None:
            q = q.eq("is_active", is_active)
        if search:
            q = q.ilike("username", f"*{search}*")
        q = q.offset((page - 1) * page_size).limit(page_size)
        return await q.select()


@router.get("/{user_id}")
async def get_user(user_id: int, admin: TokenClaims = require_role(Role.SUPER_ADMIN)):
    """Get a single user's details (super_admin only)."""
    async with SupabaseClient.service_role() as db:
        row = await db.from_("users").eq("id", user_id).select_one()
        if not row:
            raise NotFoundError("User", user_id)
    return row


@router.patch("/{user_id}/status")
async def toggle_user_status(
    user_id: int,
    body: dict,
    admin: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Activate or deactivate a user (super_admin only)."""
    async with SupabaseClient.service_role() as db:
        is_active = body.get("is_active", True)
        await db.from_("users").eq("id", user_id).update({"is_active": is_active})
    return {"success": True}


# ── Helpers ─────────────────────────────────────────────────────


async def _get_db_user(db, user: TokenClaims) -> dict:
    if user.telegram_id:
        row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one()
        if row:
            return row
    raise NotFoundError("User")

"""Notification routes: the customer feed, the shop inbox, and the Super Admin broadcast tool."""

from __future__ import annotations

import httpx
from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_role, require_super_admin
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.notification import SendNotificationRequest
from app.services.notify import _error_code

router = APIRouter(prefix="/notifications", tags=["Notifications"])

# The app's tabs -> the stored type
GROUP_TYPES = {"orders": "order_update", "promos": "promo", "system": "system"}
MAX_PAGE = 50


async def _inbox(call, empty):
    """Run a shop-inbox query. Before migration 027 the table has no merchant_id column; the inbox is
    simply empty then, instead of an error."""
    try:
        return await call
    except httpx.HTTPStatusError as exc:
        if _error_code(exc) in ("42703", "PGRST204"):
            return empty
        raise


def _page(limit: int) -> int:
    return max(1, min(limit, MAX_PAGE))


async def _own_user_id(db, user: TokenClaims) -> int | None:
    """The database user behind the caller's Telegram login (None = no such user yet)."""
    if not user.telegram_id:
        return None
    row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
    return row["id"] if row else None


def _own_shop_id(user: TokenClaims) -> int:
    if user.merchant_id is None:
        raise ForbiddenError("This account is not linked to a shop")
    return user.merchant_id


def _scoped(db, column: str, owner_id: int):
    return db.from_("notifications").eq(column, owner_id)


async def _list(db, column: str, owner_id: int, *, limit: int, before: int | None, unread_only: bool, group: str | None):
    q = _scoped(db, column, owner_id)
    if unread_only:
        q = q.eq("is_read", False)
    if group:
        if group not in GROUP_TYPES:
            raise BadRequestError("group must be orders, promos or system")
        q = q.eq("type", GROUP_TYPES[group])
    if before is not None:
        q = q.lt("id", before)
    return await q.order("id", desc=True).limit(_page(limit)).select()


async def _unread(db, column: str, owner_id: int) -> int:
    return await _scoped(db, column, owner_id).eq("is_read", False).count()


async def _unread_capped(db, column: str, owner_id: int, cap: int = 100) -> int:
    """Unread count via a small select. Unlike count() (a HEAD request, whose errors carry no body) a failure
    here can be recognised, which the shop inbox needs before migration 027."""
    return len(await _scoped(db, column, owner_id).eq("is_read", False).limit(cap).select("id"))


async def _mark_one(db, column: str, owner_id: int, notification_id: int) -> None:
    rows = await _scoped(db, column, owner_id).eq("id", notification_id).update({"is_read": True})
    if not rows:
        # Someone else's notification looks exactly like one that does not exist
        raise NotFoundError("Notification", notification_id)


async def _mark_all(db, column: str, owner_id: int) -> int:
    rows = await _scoped(db, column, owner_id).eq("is_read", False).update({"is_read": True})
    return len(rows)


# ── Customer feed ───────────────────────────────────────────────


@router.get("")
async def list_my_notifications(
    limit: int = 30, before: int | None = None, unread_only: bool = False, group: str | None = None,
    user: TokenClaims = require_role(Role.USER),
):
    """The caller's notifications, newest first. `before` = last id seen (next page)."""
    async with SupabaseClient.service_role() as db:
        uid = await _own_user_id(db, user)
        if uid is None:
            return []
        return await _list(db, "user_id", uid, limit=limit, before=before, unread_only=unread_only, group=group)


@router.get("/unread-count")
async def my_unread_count(user: TokenClaims = require_role(Role.USER)):
    """Just the number, so the bell does not download the whole feed every 30 seconds."""
    async with SupabaseClient.service_role() as db:
        uid = await _own_user_id(db, user)
        if uid is None:
            return {"count": 0}
        return {"count": await _unread(db, "user_id", uid)}


@router.post("/read-all")
async def read_all_mine(user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        uid = await _own_user_id(db, user)
        return {"success": True, "count": await _mark_all(db, "user_id", uid) if uid else 0}


@router.patch("/{notification_id}/read")
async def mark_as_read(notification_id: int, user: TokenClaims = require_role(Role.USER)):
    """Mark one of the caller's notifications as read (not anyone else's)."""
    async with SupabaseClient.service_role() as db:
        uid = await _own_user_id(db, user)
        if uid is None:
            raise NotFoundError("Notification", notification_id)
        await _mark_one(db, "user_id", uid, notification_id)
    return {"success": True}


# ── Shop inbox (merchant admins) ────────────────────────────────


@router.get("/merchant")
async def list_shop_notifications(
    limit: int = 30, before: int | None = None, unread_only: bool = False,
    user: TokenClaims = require_role(Role.MERCHANT_ADMIN),
):
    shop_id = _own_shop_id(user)
    async with SupabaseClient.service_role() as db:
        return await _inbox(_list(db, "merchant_id", shop_id, limit=limit, before=before,
                                  unread_only=unread_only, group=None), [])


@router.get("/merchant/unread-count")
async def shop_unread_count(user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    shop_id = _own_shop_id(user)
    async with SupabaseClient.service_role() as db:
        return {"count": await _inbox(_unread_capped(db, "merchant_id", shop_id), 0)}


@router.post("/merchant/read-all")
async def read_all_shop(user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    shop_id = _own_shop_id(user)
    async with SupabaseClient.service_role() as db:
        return {"success": True, "count": await _inbox(_mark_all(db, "merchant_id", shop_id), 0)}


@router.patch("/merchant/{notification_id}/read")
async def mark_shop_notification_read(notification_id: int, user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    shop_id = _own_shop_id(user)
    async with SupabaseClient.service_role() as db:
        if await _inbox(_mark_one(db, "merchant_id", shop_id, notification_id), "missing") == "missing":
            raise NotFoundError("Notification", notification_id)
    return {"success": True}


# ── Super admin: broadcast tool ─────────────────────────────────
# Only the platform may message customers and see what was sent; a shop must not read or delete
# other people's notifications or write to arbitrary customers.


@router.get("/admin/list")
async def list_notifications_admin(type: str | None = None, user: TokenClaims = require_super_admin()):
    """Customer notifications that were sent (newest 100)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("notifications").order("sent_at", desc=True).limit(100)
        if type:
            q = q.eq("type", type)
        notifications = [n for n in await q.select() if n.get("user_id")]  # shop inbox rows are not customer mail

        if notifications:
            user_ids = list({n["user_id"] for n in notifications})
            users = await db.from_("users").in_("id", user_ids).select("id,first_name,last_name,username")
            user_map = {}
            for u in users:
                name = u.get("first_name", "")
                if u.get("last_name"):
                    name += f" {u['last_name']}"
                user_map[u["id"]] = name.strip() or u.get("username") or f"User #{u['id']}"
            for n in notifications:
                n["user_name"] = user_map.get(n["user_id"], f"User #{n['user_id']}")

    return notifications


@router.post("/admin/send")
async def send_notification(body: SendNotificationRequest, user: TokenClaims = require_super_admin()):
    """Send a notification to one or several customers."""
    ids = body.user_ids or ([body.user_id] if body.user_id else [])
    if not ids:
        raise BadRequestError("user_id or user_ids required")
    stored_type = body.stored_type  # the database enum has no 'order' or 'loyalty'
    # Old columns only, so this works with and without migration 027
    rows = [{"user_id": uid, "type": stored_type, "title": body.title, "body": body.body, "ref_id": body.ref_id} for uid in ids]
    async with SupabaseClient.service_role() as db:
        await db.from_("notifications").insert(rows)
    return {"success": True, "count": len(rows)}


@router.delete("/admin/{notification_id}")
async def delete_notification(notification_id: int, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        await db.from_("notifications").eq("id", notification_id).delete()
    return {"success": True}

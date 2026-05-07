"""Notification routes."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.notification import SendNotificationRequest

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("")
async def list_my_notifications(user: TokenClaims = require_role(Role.USER)):
    """List the current user's notifications."""
    async with SupabaseClient.service_role() as db:
        if user.telegram_id:
            db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
            if not db_user:
                return []
            return await (
                db.from_("notifications")
                .eq("user_id", db_user["id"])
                .order("sent_at", desc=True)
                .limit(50)
                .select()
            )
    return []


@router.patch("/{notification_id}/read")
async def mark_as_read(notification_id: int, user: TokenClaims = require_role(Role.USER)):
    """Mark a notification as read."""
    async with SupabaseClient.service_role() as db:
        await db.from_("notifications").eq("id", notification_id).update({"is_read": True})
    return {"success": True}


# ── Admin ───────────────────────────────────────────────────────


@router.get("/admin/list")
async def list_notifications_admin(
    type: str | None = None,
    user: TokenClaims = require_any_admin(),
):
    """List all notifications (admin)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("notifications").order("sent_at", desc=True).limit(100)
        if type:
            q = q.eq("type", type)
        notifications = await q.select()

        # Enrich with user names
        if notifications:
            user_ids = list({n["user_id"] for n in notifications if n.get("user_id")})
            if user_ids:
                users = await db.from_("users").in_("id", user_ids).select("id,first_name,last_name,username")
                user_map = {}
                for u in users:
                    name = u.get("first_name", "")
                    if u.get("last_name"):
                        name += f" {u['last_name']}"
                    user_map[u["id"]] = name.strip() or u.get("username") or f"User #{u['id']}"
                for n in notifications:
                    n["user_name"] = user_map.get(n.get("user_id"), f"User #{n.get('user_id')}")

    return notifications


@router.post("/admin/send")
async def send_notification(body: SendNotificationRequest, user: TokenClaims = require_any_admin()):
    """Send notification to one or multiple users (admin)."""
    async with SupabaseClient.service_role() as db:
        if body.user_ids:
            rows = [
                {"user_id": uid, "type": body.type, "title": body.title, "body": body.body, "ref_id": body.ref_id}
                for uid in body.user_ids
            ]
            await db.from_("notifications").insert(rows)
            return {"success": True, "count": len(rows)}
        elif body.user_id:
            await db.from_("notifications").insert({
                "user_id": body.user_id, "type": body.type,
                "title": body.title, "body": body.body, "ref_id": body.ref_id,
            })
            return {"success": True, "count": 1}
        raise BadRequestError("user_id or user_ids required")


@router.delete("/admin/{notification_id}")
async def delete_notification(notification_id: int, user: TokenClaims = require_any_admin()):
    """Delete a notification (admin)."""
    async with SupabaseClient.service_role() as db:
        await db.from_("notifications").eq("id", notification_id).delete()
    return {"success": True}

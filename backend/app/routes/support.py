"""Support ticket routes.

Users create tickets and send messages. Admins view and reply.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.support import TicketCreate, TicketReply

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/support", tags=["Support"])


# ═══════════════════════════════════════════════════════════════
#  USER ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.post("/tickets")
async def create_ticket(body: TicketCreate, user: TokenClaims = require_role(Role.USER)):
    """Create a support ticket."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)

        name = db_user.get("first_name", "")
        if db_user.get("last_name"):
            name += f" {db_user['last_name']}"

        ticket_data = {
            "subject": body.subject,
            "status": "open",
            "customer_name": name.strip() or f"User #{db_user['id']}",
            "customer_username": db_user.get("username"),
            "last_message": body.message[:200] if body.message else None,
            "message_count": 1 if body.message else 0,
        }
        if body.order_id:
            ticket_data["order_id"] = body.order_id

        rows = await db.from_("support_tickets").insert(ticket_data)
        ticket = rows[0] if rows else ticket_data

        # Insert first message
        if body.message:
            await db.from_("ticket_messages").insert({
                "ticket_id": ticket["id"],
                "sender_type": "customer",
                "sender_id": db_user["id"],
                "body": body.message,
            })

    return ticket


@router.get("/tickets")
async def list_my_tickets(user: TokenClaims = require_role(Role.USER)):
    """List the current user's support tickets."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)

        # Match by username (primary) or name (fallback)
        username = db_user.get("username")
        if username:
            tickets = await (
                db.from_("support_tickets")
                .eq("customer_username", username)
                .order("updated_at", desc=True)
                .select()
            )
        else:
            name = db_user.get("first_name", "")
            if db_user.get("last_name"):
                name += f" {db_user['last_name']}"
            tickets = await (
                db.from_("support_tickets")
                .eq("customer_name", name.strip())
                .order("updated_at", desc=True)
                .select()
            )
    return tickets


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: int, user: TokenClaims = require_role(Role.USER, Role.MERCHANT_ADMIN, Role.SUPER_ADMIN)):
    """Get a ticket with all messages."""
    async with SupabaseClient.service_role() as db:
        ticket = await db.from_("support_tickets").eq("id", ticket_id).select_one()
        if not ticket:
            raise NotFoundError("Ticket", ticket_id)

        messages = await (
            db.from_("ticket_messages")
            .eq("ticket_id", ticket_id)
            .order("created_at")
            .select()
        )
        ticket["messages"] = messages
    return ticket


@router.post("/tickets/{ticket_id}/messages")
async def send_ticket_message(
    ticket_id: int,
    body: TicketReply,
    user: TokenClaims = require_role(Role.USER, Role.MERCHANT_ADMIN, Role.SUPER_ADMIN),
):
    """Send a message on a ticket."""
    async with SupabaseClient.service_role() as db:
        ticket = await db.from_("support_tickets").eq("id", ticket_id).select_one("id,status")
        if not ticket:
            raise NotFoundError("Ticket", ticket_id)
        if ticket["status"] == "closed":
            raise BadRequestError("Ticket is closed")

        sender_type = "customer" if user.is_user else "merchant"
        sender_id = None
        if user.is_user:
            db_user = await _get_db_user(db, user)
            sender_id = db_user["id"]
        else:
            sender_id = int(user.sub) if user.sub else None

        rows = await db.from_("ticket_messages").insert({
            "ticket_id": ticket_id,
            "sender_type": sender_type,
            "sender_id": sender_id,
            "body": body.message,
        })

        new_status = "replied" if sender_type == "merchant" else "open"
        await db.from_("support_tickets").eq("id", ticket_id).update({
            "status": new_status,
            "last_message": body.message[:200],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    return {"success": True, "data": rows[0] if rows else None}


# ═══════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/tickets")
async def list_tickets_admin(
    status: str | None = None,
    user: TokenClaims = require_any_admin(),
):
    """List all support tickets (admin only)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("support_tickets").order("updated_at", desc=True)
        if status:
            q = q.eq("status", status)
        return await q.select()


@router.patch("/admin/tickets/{ticket_id}/close")
async def close_ticket(ticket_id: int, user: TokenClaims = require_any_admin()):
    """Close a support ticket (admin only)."""
    async with SupabaseClient.service_role() as db:
        await db.from_("support_tickets").eq("id", ticket_id).update({"status": "closed"})
    return {"success": True}


# ── Helpers ─────────────────────────────────────────────────────

async def _get_db_user(db, user: TokenClaims) -> dict:
    if user.telegram_id:
        row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one()
        if row:
            return row
    raise NotFoundError("User")

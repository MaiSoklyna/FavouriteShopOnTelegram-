"""Refunds owed to customers (platform admin).

Refunds are created by the system when a paid KHQR/card order is cancelled or a payment arrives
for a cancelled or expired order (services/refunds.py). The platform admin sends the money back
outside the app and marks the refund sent here with the transfer or Stripe refund reference.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.core.dependencies import require_super_admin
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import refunds

router = APIRouter(prefix="/refunds", tags=["Refunds"])


class CompleteRefund(BaseModel):
    reference: str = Field(..., min_length=1, max_length=200)
    note: str | None = Field(None, max_length=1000)


@router.get("/admin")
async def list_refunds(
    status: str = Query("pending", pattern="^(pending|refunded|all)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: TokenClaims = require_super_admin(),
):
    """Refunds to send (pending, oldest first) or already sent (newest first), plus what is owed."""
    async with SupabaseClient.service_role() as db:
        q = db.from_(refunds.TABLE)
        if status != "all":
            q = q.eq("status", status)
        q = q.order("created_at", desc=status != "pending")
        rows = await q.offset((page - 1) * page_size).limit(page_size).select(refunds.COLUMNS)

        pending = await db.from_(refunds.TABLE).eq("status", refunds.PENDING).select("amount")
        shop_ids = sorted({r["merchant_id"] for r in rows if r.get("merchant_id")})
        shops = {}
        if shop_ids:
            for s in await db.from_("merchants").in_("id", shop_ids).select("id,name"):
                shops[s["id"]] = s["name"]
    for r in rows:
        r["merchant_name"] = shops.get(r.get("merchant_id"))
        r["reason_text"] = refunds.REASONS.get(r.get("reason"), r.get("reason"))
    return {
        "data": rows,
        "summary": {
            "pending_count": len(pending),
            "pending_amount": str(sum((Decimal(str(p["amount"])) for p in pending), Decimal("0.00"))),
        },
    }


@router.post("/admin/{refund_id}/complete")
async def complete_refund(refund_id: int, body: CompleteRefund, user: TokenClaims = require_super_admin()):
    """Mark a refund as sent, with the transfer or Stripe refund reference."""
    async with SupabaseClient.service_role() as db:
        refund = await refunds.complete(db, refund_id, user, reference=body.reference, note=body.note)
    return {"success": True, "data": refund}

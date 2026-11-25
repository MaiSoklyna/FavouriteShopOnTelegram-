"""Refunds: money the platform collected for an order that did not go ahead.

KHQR and card payments are collected by the platform (settlement.PLATFORM_COLLECTED_METHODS). When
such an order is cancelled after it was paid, or a payment arrives for an order that was already
cancelled or had expired, the customer is owed that money back. This module records that as a
refund to do (`refunds`, migration 039); a platform admin sends the money back and marks it done.

Rules:
- One refund per order, for the full amount paid. Requesting it twice returns the first one.
- Recording a refund never breaks the cancellation or payment that caused it: failures are logged.
- Completing one is a single conditional update (pending -> refunded), so it happens once; the order's
  payment_status then becomes 'refunded'.
- The merchant's earning is not touched here (see the migration): cancellation already reversed it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

import httpx

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.core.security import TokenClaims
from app.services import audit, notify, settlement

logger = logging.getLogger(__name__)

TABLE = "refunds"
PENDING, REFUNDED = "pending", "refunded"
REASONS = {
    "order_cancelled": "The order was cancelled after it was paid",
    "paid_after_cancellation": "The payment arrived after the order was cancelled",
    "paid_after_expiry": "The payment arrived after the order had expired",
}
COLUMNS = ("id,order_id,merchant_id,user_id,order_code,amount,currency,payment_method,payment_ref,reason,status,"
           "refund_reference,note,requested_by_type,completed_by_name,created_at,completed_at")
_MISSING = ("PGRST205", "42P01")
_warned_missing = False


def _code(exc: httpx.HTTPStatusError) -> str | None:
    try:
        return exc.response.json().get("code")
    except Exception:
        return None


def _missing_table(exc: httpx.HTTPStatusError) -> bool:
    global _warned_missing
    if _code(exc) not in _MISSING:
        return False
    if not _warned_missing:
        logger.warning("Refunds are not recorded: run supabase/migrations/039_refunds.sql")
        _warned_missing = True
    return True


def reason_for_payment_on(status: str | None) -> str:
    return "paid_after_expiry" if status == "expired" else "paid_after_cancellation"


async def request(db, order: dict, reason: str, *, actor_type: str = "system",
                  actor_id: str | None = None) -> dict | None:
    """Record that `order`'s payment must be given back. Idempotent and never raises.

    Only for a paid order whose money the platform collected (KHQR, card). Returns the refund row
    (the existing one if it was already requested), or None if nothing is owed or it could not be saved."""
    order_id = order.get("id")
    try:
        if reason not in REASONS:
            raise ValueError(f"unknown refund reason {reason!r}")
        needed = "id,merchant_id,user_id,order_code,total,payment_method,payment_status,payment_ref,payway_tran_id,stripe_payment_intent_id"
        full = await db.from_("orders").eq("id", order_id).select_one(needed)
        if not full or full.get("payment_status") != "paid":
            return None  # not paid (or already refunded): nothing to give back
        if full.get("payment_method") not in settlement.PLATFORM_COLLECTED_METHODS:
            return None  # cash: the shop holds the money, not the platform

        row = {
            "order_id": order_id,
            "merchant_id": full.get("merchant_id"),
            "user_id": full.get("user_id"),
            "order_code": full.get("order_code"),
            "amount": str(Decimal(str(full.get("total") or 0)).quantize(Decimal("0.01"))),
            "payment_method": full.get("payment_method"),
            "payment_ref": full.get("payment_ref") or full.get("stripe_payment_intent_id") or full.get("payway_tran_id"),
            "reason": reason,
            "requested_by_type": actor_type,
            "requested_by_id": actor_id,
        }
        try:
            created = (await db.from_(TABLE).insert(row))[0]
        except httpx.HTTPStatusError as exc:
            if _missing_table(exc):
                logger.error("Order %s needs a refund of %s (%s)", order_id, row["amount"], reason)
                return None
            if _code(exc) == "23505":  # already requested for this order
                return await db.from_(TABLE).eq("order_id", order_id).select_one(COLUMNS)
            raise

        logger.warning("Refund %s recorded for order %s: %s %s (%s)",
                       created["id"], order_id, row["amount"], row["payment_method"], reason)
        await audit.record(
            db, None, merchant_id=full.get("merchant_id"), action="refund.requested",
            target_type="order", target_id=order_id, target_label=full.get("order_code"),
            new={"refund_id": created["id"], "amount": row["amount"], "reason": reason},
        )
        await _settlement_log(db, created, "refund.requested", actor_type, actor_id, note=REASONS[reason])
        await notify.notify_user(
            db, full.get("user_id"), "refund", "Refund on its way",
            f"You'll get ${row['amount']} back for order {full.get('order_code')}. We'll let you know when it's sent.",
            link=f"/shop/order/{order_id}", ref_id=order_id, dedupe_key=f"order:{order_id}:refund:requested",
        )
        return created
    except Exception:
        logger.exception("Could not record the refund for order %s (%s) — refund it by hand", order_id, reason)
        return None


async def complete(db, refund_id: int, admin: TokenClaims, *, reference: str, note: str | None = None) -> dict:
    """Mark a refund as sent. `reference` is the bank transfer or Stripe refund id."""
    reference = (reference or "").strip()
    if not reference:
        raise BadRequestError("Enter the transfer or Stripe refund reference")
    refund = await db.from_(TABLE).eq("id", refund_id).select_one(COLUMNS)
    if not refund:
        raise NotFoundError("Refund", refund_id)
    if refund["status"] != PENDING:
        raise ConflictError("This refund is already marked as sent")

    name = admin.name or admin.email or f"Admin #{admin.sub}"
    done = await db.from_(TABLE).eq("id", refund_id).eq("status", PENDING).update({
        "status": REFUNDED,
        "refund_reference": reference[:200],
        "note": ((note or "").strip()[:1000] or refund.get("note")),
        "completed_by_id": admin.sub,
        "completed_by_name": name,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    })
    if not done:
        raise ConflictError("This refund was just marked as sent by someone else")
    refund = done[0]

    await db.from_("orders").eq("id", refund["order_id"]).eq("payment_status", "paid").update(
        {"payment_status": "refunded"}
    )
    await audit.record(
        db, admin, merchant_id=refund.get("merchant_id"), action="refund.completed",
        target_type="order", target_id=refund["order_id"], target_label=refund.get("order_code"),
        old={"status": PENDING}, new={"status": REFUNDED, "amount": refund["amount"], "reference": refund["refund_reference"]},
    )
    await _settlement_log(db, refund, "refund.completed", "super_admin", admin.sub, note=refund["refund_reference"],
                          old={"status": PENDING})
    await notify.notify_user(
        db, refund.get("user_id"), "refund", "Refund sent",
        f"We sent back ${refund['amount']} for order {refund.get('order_code')}. It can take a few days to show.",
        link=f"/shop/order/{refund['order_id']}", ref_id=refund["order_id"],
        dedupe_key=f"order:{refund['order_id']}:refund:done",
    )
    return refund


async def for_order(db, order_id: int) -> dict | None:
    """The order's refund (or None) for the order pages. Never raises."""
    try:
        return await db.from_(TABLE).eq("order_id", order_id).select_one(
            "id,amount,currency,reason,status,refund_reference,created_at,completed_at"
        )
    except httpx.HTTPStatusError as exc:
        if _missing_table(exc):
            return None
        logger.exception("Could not read the refund of order %s", order_id)
        return None
    except Exception:
        logger.exception("Could not read the refund of order %s", order_id)
        return None


async def _settlement_log(db, refund: dict, action: str, actor_type: str, actor_id: str | None, *,
                          note: str | None = None, old: dict | None = None) -> None:
    """Platform money trail, next to earnings and payouts. Never raises."""
    try:
        await settlement.audit(
            db, entity_type="refund", entity_id=refund["id"], merchant_id=refund.get("merchant_id"),
            action=action, actor_type=actor_type, actor_id=actor_id, old_value=old,
            new_value={"order_id": refund["order_id"], "amount": str(refund["amount"]), "status": refund["status"]},
            note=note,
        )
    except Exception:
        logger.exception("Could not write settlement log for refund %s", refund.get("id"))

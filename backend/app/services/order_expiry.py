"""Unpaid online orders expire, so their stock goes back on sale.

A KHQR or card order takes its stock when it is placed (services/inventory.py). Each one gets a
payment deadline at the same moment (`orders.payment_expires_at`, from PAYMENT_EXPIRY_MINUTES per
payment method, migration 038). Cash on delivery gets none: it is paid at the door.

There is no always-on worker on Vercel, so expiry runs where it matters:
- whenever a specific order or a list of orders is looked at (customer or shop), those orders are
  checked straight away, so nobody ever sees an overdue order as still "waiting for payment";
- as a side effect of ordinary traffic (product pages, placing an order) every overdue order is
  swept, at most once a minute per server instance;
- POST /api/orders/expire-due lets an external scheduler (e.g. Supabase pg_cron) sweep on a timer.

Expiring one order:
1. Ask the payment provider one last time. A customer who paid at minute 29 whose callback was lost
   must get a paid order, not an expired one. If the provider cannot be reached, try again later.
2. Card: cancel the open PaymentIntent first, so the card can no longer be charged afterwards.
   (A PayWay QR cannot be cancelled; its lifetime is capped to the deadline when it is issued.)
3. Claim the change in one conditional update (still pending, still unpaid). Only one request can
   win, so stock and the coupon use are given back exactly once.
4. Give back stock and the coupon use, write the shop's activity log (actor: System) and tell the
   customer in the app.

A payment that still arrives after expiry is handled in payments.mark_order_paid: the order stays
expired, no earning is recorded and it is flagged for a refund.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.core.constants import EXPIRY_SWEEP_INTERVAL_SECONDS, PAYMENT_EXPIRY_MINUTES
from app.services import audit, coupons, inventory, notify, stripe_pay

logger = logging.getLogger(__name__)

EXPIRED = "expired"
_MISSING_COLUMN = ("42703", "PGRST204", "PGRST100")
_SWEEP_BATCH = 50

_last_sweep = 0.0
_warned_missing = False


# ── Deadlines ───────────────────────────────────────────────────

def payment_deadline(payment_method: str | None, placed_at: datetime) -> datetime | None:
    """When an order paid with `payment_method` and placed at `placed_at` expires (None = never)."""
    minutes = PAYMENT_EXPIRY_MINUTES.get((payment_method or "").lower())
    if not minutes:
        return None
    return placed_at + timedelta(minutes=minutes)


def parse_time(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def is_overdue(order: dict, now: datetime | None = None) -> bool:
    """True if `order` is pending, unpaid and past its payment deadline."""
    deadline = parse_time(order.get("payment_expires_at"))
    return (
        deadline is not None
        and order.get("status") == "pending"
        and order.get("payment_status") != "paid"
        and deadline <= (now or datetime.now(timezone.utc))
    )


def seconds_left(order: dict, now: datetime | None = None) -> int | None:
    """Seconds until the order's payment deadline (None = no deadline; 0 = already past)."""
    deadline = parse_time(order.get("payment_expires_at"))
    if deadline is None:
        return None
    return max(0, int((deadline - (now or datetime.now(timezone.utc))).total_seconds()))


# ── Finding overdue orders ──────────────────────────────────────

def _columns() -> str:
    from app.routes.payments import _ORDER_COLUMNS  # late import: payments imports this module
    return f"{_ORDER_COLUMNS},payment_expires_at"


async def _overdue(db, *, now: datetime, user_id: int | None = None, merchant_id: int | None = None,
                   order_id: int | None = None, limit: int = _SWEEP_BATCH) -> list[dict]:
    global _warned_missing
    q = (db.from_("orders").eq("status", "pending").neq("payment_status", "paid")
         .lte("payment_expires_at", now.isoformat()))
    if user_id is not None:
        q = q.eq("user_id", user_id)
    if merchant_id is not None:
        q = q.eq("merchant_id", merchant_id)
    if order_id is not None:
        q = q.eq("id", order_id)
    try:
        return await q.order("payment_expires_at").limit(limit).select(_columns())
    except httpx.HTTPStatusError as exc:
        code = None
        try:
            code = exc.response.json().get("code")
        except Exception:
            pass
        if code in _MISSING_COLUMN:
            if not _warned_missing:
                logger.warning("Order expiry is off: run supabase/migrations/038_order_expiry.sql")
                _warned_missing = True
            return []
        raise


async def expire_overdue(db, *, user_id: int | None = None, merchant_id: int | None = None,
                         order_id: int | None = None, now: datetime | None = None) -> list[int]:
    """Expire the overdue orders matching the filters (none = every shop). Returns the ids expired.
    Never raises: a failure here must not break the page that triggered it."""
    now = now or datetime.now(timezone.utc)
    expired: list[int] = []
    try:
        for order in await _overdue(db, now=now, user_id=user_id, merchant_id=merchant_id, order_id=order_id):
            if await expire_order(db, order, now=now):
                expired.append(order["id"])
    except Exception:
        logger.exception("Order expiry sweep failed")
    return expired


async def sweep_if_due(db) -> list[int]:
    """Expire overdue orders across every shop, at most once per EXPIRY_SWEEP_INTERVAL_SECONDS on
    this server instance. Cheap to call from busy routes. Never raises."""
    global _last_sweep
    if time.monotonic() - _last_sweep < EXPIRY_SWEEP_INTERVAL_SECONDS:
        return []
    _last_sweep = time.monotonic()
    return await expire_overdue(db)


# ── Expiring one order ──────────────────────────────────────────

async def _paid_at_provider(db, order: dict) -> bool | None:
    """Last look at the payment provider before giving up on an order.

    True = it was paid (and is now recorded as paid), False = not paid and no longer payable,
    None = the provider could not be asked; leave the order for the next try."""
    method = order.get("payment_method")
    if method == "khqr" and order.get("payway_tran_id"):
        from app.routes import payments  # late import: payments imports this module
        try:
            status = await payments._settle(db, order, order["payway_tran_id"], raise_errors=True)
        except Exception:
            logger.warning("Order %s: PayWay could not be checked before expiry; will retry", order["id"])
            return None
        return status == "paid"

    if method == "stripe" and order.get("stripe_payment_intent_id"):
        from app.routes import payments_stripe  # late import, same reason
        intent_id = order["stripe_payment_intent_id"]
        try:
            intent = await stripe_pay.retrieve_payment_intent(intent_id)
            if intent.get("status") == "processing":
                return None  # the bank is still deciding; ask again later
            if intent.get("status") == "succeeded":
                return await payments_stripe._settle(db, order, intent) == "paid"
            if intent.get("status") != "canceled":
                try:
                    await stripe_pay.cancel_payment_intent(intent_id)
                except stripe_pay.StripeError:
                    # It may have succeeded between the two calls: look once more
                    intent = await stripe_pay.retrieve_payment_intent(intent_id)
                    if intent.get("status") == "succeeded":
                        return await payments_stripe._settle(db, order, intent) == "paid"
                    if intent.get("status") != "canceled":
                        return None
        except Exception:
            logger.warning("Order %s: Stripe could not be checked before expiry; will retry", order["id"])
            return None
    return False


async def expire_order(db, order: dict, *, now: datetime | None = None) -> bool:
    """Expire one overdue order. True if this call expired it. Never raises."""
    order_id = order["id"]
    try:
        if not is_overdue(order, now):
            return False
        paid = await _paid_at_provider(db, order)
        if paid is None or paid:
            return False

        # Claim: only a still-pending, still-unpaid order can expire, and only once
        claimed = await (
            db.from_("orders").eq("id", order_id).eq("status", "pending").neq("payment_status", "paid")
            .update({"status": EXPIRED})
        )
        if not claimed:
            return False

        items = await db.from_("order_items").eq("order_id", order_id).select("product_id,quantity,selected_variants")
        await inventory.release_stock(db, items)
        await coupons.release_for_order(db, order_id)

        await audit.record(
            db, None, merchant_id=order.get("merchant_id"), action="order.expired",
            target_type="order", target_id=order_id, target_label=order.get("order_code"),
            old={"status": "pending", "payment_status": order.get("payment_status")},
            new={"status": EXPIRED, "payment_method": order.get("payment_method"),
                 "payment_expires_at": order.get("payment_expires_at")},
        )
        await notify.order_status_changed(db, order_id, EXPIRED)
        logger.info("Order %s expired unpaid (%s)", order_id, order.get("payment_method"))
        order["status"] = EXPIRED
        return True
    except Exception:
        logger.exception("Could not expire order %s", order_id)
        return False

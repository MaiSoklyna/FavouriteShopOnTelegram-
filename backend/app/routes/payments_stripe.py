"""Stripe test-mode payments (demo).

Flow:
1. Customer places an order with payment_method="stripe".
2. POST /payments/stripe/orders/{id}/intent -> PaymentIntent client_secret.
3. The browser confirms the card with Stripe.js (test cards: 4242 4242 4242 4242
   succeeds, 4000 0000 0000 0002 is declined).
4. The checkout page polls GET .../status; Stripe also calls POST /webhook.
   Both re-fetch the PaymentIntent from Stripe and only mark the order paid when
   Stripe says "succeeded" and the amount matches order.total.

Kept parallel to payments.py (KHQR) so either provider can be enabled.
"""

from __future__ import annotations

import asyncio
import json
import logging
import weakref

from fastapi import APIRouter, Request

from app.config import settings
from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import BadRequestError
from app.core.rate_limit import limiter
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.routes.payments import EXPIRED_MESSAGE, _ORDER_COLUMNS, _get_own_order, mark_order_paid
from app.services import order_expiry, payment_methods, stripe_pay

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payments/stripe", tags=["Payments"])

METHOD = "stripe"


@router.get("/config")
async def stripe_config():
    """Lets the frontend know whether card payment is available."""
    return {"data": {"enabled": stripe_pay.is_configured(), "test_mode": True}}


@router.post("/orders/{order_id}/intent")
@limiter.limit("10/minute")
async def create_intent(request: Request, order_id: int, user: TokenClaims = require_role(Role.USER)):
    if not stripe_pay.is_configured():
        raise BadRequestError("Card payment is not available right now. Please choose cash on delivery.")

    async with SupabaseClient.service_role() as db:
        return {"data": await ensure_payment_intent(db, order_id, user)}


# One lock per order inside this process. Locks vanish once nobody holds or waits
# on them. It is an optimisation (concurrent callers reuse the first caller's
# intent instead of all asking Stripe); the Idempotency-Key is the guarantee that
# also holds across serverless instances.
_order_locks: "weakref.WeakValueDictionary[int, asyncio.Lock]" = weakref.WeakValueDictionary()


def _lock_for(order_id: int) -> asyncio.Lock:
    lock = _order_locks.get(order_id)
    if lock is None:
        lock = _order_locks[order_id] = asyncio.Lock()
    return lock


async def ensure_payment_intent(db, order_id: int, user: TokenClaims) -> dict:
    """Return the order's one PaymentIntent, creating it only if none exists.

    Safe to call any number of times, concurrently: a double mount, a double
    tap, two tabs, a retry after a declined card. They all end up with the same
    PaymentIntent, so the id we store is always the one the customer pays.
    """
    async with _lock_for(order_id):
        # Read inside the lock so a waiting caller sees what the first one stored
        order = await _get_own_order(db, order_id, user)
        if order.get("payment_status") == "paid":
            return {"payment_status": "paid"}
        if order.get("payment_method") != METHOD:
            raise BadRequestError("This order is not set up for card payment")
        if not payment_methods.card_allowed(order.get("user_id")):
            raise BadRequestError("Card payment is not available right now. Please choose cash on delivery.")
        if order.get("status") == order_expiry.EXPIRED:
            raise BadRequestError(EXPIRED_MESSAGE)
        if order.get("status") != "pending":
            raise BadRequestError("Only pending orders can be paid")
        # Past the deadline: expire it (this also checks Stripe one last time and cancels the
        # open intent) instead of handing out a way to pay
        if order_expiry.is_overdue(order):
            if await order_expiry.expire_order(db, order):
                raise BadRequestError(EXPIRED_MESSAGE)
            fresh = await _get_own_order(db, order_id, user)
            if fresh.get("payment_status") == "paid":
                return {"payment_status": "paid"}

        existing = order.get("stripe_payment_intent_id")
        replaces = None
        if existing:
            try:
                intent = await stripe_pay.retrieve_payment_intent(existing)
            except stripe_pay.StripeError:
                # Never replace an intent we could not inspect: the customer may
                # already have paid it, and a replacement would orphan that payment.
                logger.warning("Could not check Stripe intent %s", existing, exc_info=True)
                raise BadRequestError("Could not check your card payment right now. Please try again in a moment.")
            status = intent["status"]
            if status == "succeeded":
                if await _settle(db, order, intent) != "paid":
                    # Stripe took a different amount than the order total: never call it paid
                    raise BadRequestError("We received a payment but could not match it to this order. Please contact support.")
                return {"payment_status": "paid"}
            if status in ("requires_payment_method", "requires_confirmation", "requires_action"):
                # Open intent: a retry after a declined card keeps the same one
                return _intent_payload(order, intent)
            if status != "canceled":
                # e.g. "processing": paying again could charge the card twice
                raise BadRequestError("Your payment is still being processed. Please check your order in a moment.")
            replaces = existing  # cancelled intent: start a fresh one below

        try:
            intent = await stripe_pay.create_payment_intent(
                amount=order["total"], currency=settings.CURRENCY,
                order_id=order["id"], order_code=order["order_code"],
                idempotency_key=stripe_pay.intent_idempotency_key(order["id"], order["total"], replaces),
            )
        except stripe_pay.StripeError as exc:
            logger.warning("Stripe intent failed for order %s: %s", order_id, exc)
            raise BadRequestError(f"Could not start card payment: {exc}")

        intent = await _claim_intent(db, order_id, intent, replaces)
    return _intent_payload(order, intent)


async def _claim_intent(db, order_id: int, intent: dict, replaces: str | None) -> dict:
    """Store `intent` on the order unless another request stored one first.

    First writer wins; a loser adopts the winner's intent, so the id on the
    order is always the one the customer was handed.
    """
    query = db.from_("orders").eq("id", order_id)
    query = query.eq("stripe_payment_intent_id", replaces) if replaces else query.is_("stripe_payment_intent_id", "null")
    if await query.update({"stripe_payment_intent_id": intent["id"]}):
        return intent
    stored = await db.from_("orders").eq("id", order_id).select_one("stripe_payment_intent_id")
    winner = (stored or {}).get("stripe_payment_intent_id")
    if not winner or winner == intent["id"]:
        return intent
    logger.warning("Order %s: adopting stored Stripe intent %s over %s", order_id, winner, intent["id"])
    try:
        return await stripe_pay.retrieve_payment_intent(winner)
    except stripe_pay.StripeError:
        raise BadRequestError("Could not start card payment. Please try again in a moment.")


@router.get("/orders/{order_id}/status")
@limiter.limit("60/minute")
async def payment_status(request: Request, order_id: int, user: TokenClaims = require_role(Role.USER)):
    async with SupabaseClient.service_role() as db:
        order = await _get_own_order(db, order_id, user)
        status = order.get("payment_status") or "pending"
        if status != "paid" and order.get("stripe_payment_intent_id"):
            try:
                intent = await stripe_pay.retrieve_payment_intent(order["stripe_payment_intent_id"])
                status = await _settle(db, order, intent)
            except stripe_pay.StripeError:
                logger.warning("Stripe status check failed for order %s", order_id, exc_info=True)
        if status != "paid" and order_expiry.is_overdue(order):
            await order_expiry.expire_order(db, order)
    return {"data": {"order_id": order_id, "payment_status": status, "order_status": order.get("status")}}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Stripe event notification. Signature-verified; result re-fetched, not trusted."""
    payload = await request.body()
    if not stripe_pay.verify_webhook(payload, request.headers.get("stripe-signature", "")):
        raise BadRequestError("Invalid signature")
    event = json.loads(payload)
    if event.get("type") != "payment_intent.succeeded":
        return {"received": True}

    intent_id = (event.get("data", {}).get("object") or {}).get("id")
    if not intent_id:
        return {"received": True}
    async with SupabaseClient.service_role() as db:
        order = await db.from_("orders").eq("stripe_payment_intent_id", intent_id).select_one(_ORDER_COLUMNS)
        if order and order.get("payment_status") != "paid":
            intent = await stripe_pay.retrieve_payment_intent(intent_id)
            await _settle(db, order, intent)
    return {"received": True}


def _intent_payload(order: dict, intent: dict) -> dict:
    return {
        "payment_status": "pending",
        "order_id": order["id"],
        "order_code": order["order_code"],
        "client_secret": intent["client_secret"],
        "amount": f"{stripe_pay.to_minor_units(order['total']) / 100:.2f}",
        "currency": settings.CURRENCY,
    }


async def _settle(db, order: dict, intent: dict) -> str:
    if intent.get("status") != "succeeded":
        return order.get("payment_status") or "pending"
    if intent.get("amount_received") != stripe_pay.to_minor_units(order["total"]):
        logger.error("Stripe amount mismatch on order %s: got %s", order["id"], intent.get("amount_received"))
        return order.get("payment_status") or "pending"
    return await mark_order_paid(
        db, order,
        fields={"payment_ref": intent["id"], "stripe_payment_intent_id": intent["id"]},
        actor_type="stripe", actor_id=intent["id"],
    )

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

import json
import logging

from fastapi import APIRouter, Request

from app.config import settings
from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import BadRequestError
from app.core.rate_limit import limiter
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.routes.payments import _ORDER_COLUMNS, _get_own_order, mark_order_paid
from app.services import stripe_pay

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
        order = await _get_own_order(db, order_id, user)
        if order.get("payment_status") == "paid":
            return {"data": {"payment_status": "paid"}}
        if order.get("payment_method") != METHOD:
            raise BadRequestError("This order is not set up for card payment")
        if order.get("status") != "pending":
            raise BadRequestError("Only pending orders can be paid")

        # Reuse an open intent so a retry after a declined card keeps one PaymentIntent.
        existing = order.get("stripe_payment_intent_id")
        if existing:
            try:
                intent = await stripe_pay.retrieve_payment_intent(existing)
                if intent["status"] == "succeeded":
                    await _settle(db, order, intent)
                    return {"data": {"payment_status": "paid"}}
                if intent["status"] in ("requires_payment_method", "requires_confirmation", "requires_action"):
                    return {"data": _intent_payload(order, intent)}
            except stripe_pay.StripeError:
                logger.warning("Could not reuse Stripe intent %s", existing, exc_info=True)

        try:
            intent = await stripe_pay.create_payment_intent(
                amount=order["total"], currency=settings.CURRENCY,
                order_id=order["id"], order_code=order["order_code"],
            )
        except stripe_pay.StripeError as exc:
            logger.warning("Stripe intent failed for order %s: %s", order_id, exc)
            raise BadRequestError(f"Could not start card payment: {exc}")

        await db.from_("orders").eq("id", order_id).update({"stripe_payment_intent_id": intent["id"]})

    return {"data": _intent_payload(order, intent)}


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
    return {"data": {"order_id": order_id, "payment_status": status}}


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

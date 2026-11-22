"""Stripe (test mode) — thin REST client for the university demo.

Uses Stripe's HTTP API directly (no SDK) so the serverless bundle stays small.
Only test keys (sk_test_...) are accepted: a live key is refused on purpose so
the demo can never charge a real card.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from decimal import Decimal

import httpx

from app.config import settings

API = "https://api.stripe.com/v1"
WEBHOOK_TOLERANCE_SECONDS = 300


class StripeError(Exception):
    pass


def is_configured() -> bool:
    return settings.STRIPE_SECRET_KEY.startswith("sk_test_")


def _headers() -> dict:
    if not is_configured():
        raise StripeError("Stripe test mode is not configured")
    return {"Authorization": f"Bearer {settings.STRIPE_SECRET_KEY}"}


def to_minor_units(amount) -> int:
    """USD/most currencies: dollars -> cents."""
    return int((Decimal(str(amount)) * 100).quantize(Decimal("1")))


def _error_message(r: httpx.Response) -> str:
    try:
        return r.json().get("error", {}).get("message", "Stripe error")
    except Exception:
        return "Stripe error"


async def create_payment_intent(*, amount, currency: str, order_id: int, order_code: str) -> dict:
    data = {
        "amount": to_minor_units(amount),
        "currency": currency.lower(),
        # Cards only for the demo (no Link / wallets / redirect methods)
        "payment_method_types[]": "card",
        "metadata[order_id]": str(order_id),
        "metadata[order_code]": order_code,
        "description": f"Favourite of Shop order {order_code} (demo)",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{API}/payment_intents", data=data, headers=_headers())
    if r.status_code >= 400:
        raise StripeError(_error_message(r))
    return r.json()


async def retrieve_payment_intent(intent_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{API}/payment_intents/{intent_id}", headers=_headers())
    if r.status_code >= 400:
        raise StripeError(_error_message(r))
    return r.json()


def verify_webhook(payload: bytes, signature_header: str) -> bool:
    """Check a Stripe-Signature header (t=...,v1=...) against the webhook secret."""
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret or not signature_header:
        return False
    parts = dict(p.split("=", 1) for p in signature_header.split(",") if "=" in p)
    ts, sig = parts.get("t"), parts.get("v1")
    if not ts or not sig or not ts.isdigit():
        return False
    if abs(time.time() - int(ts)) > WEBHOOK_TOLERANCE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

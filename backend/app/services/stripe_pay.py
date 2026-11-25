"""Stripe (test mode) — thin REST client for the university demo.

Uses Stripe's HTTP API directly (no SDK) so the serverless bundle stays small.
Only test keys (sk_test_...) are accepted: a live key is refused on purpose so
the demo can never charge a real card.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import time
from decimal import Decimal

import httpx

from app.config import settings

API = "https://api.stripe.com/v1"
WEBHOOK_TOLERANCE_SECONDS = 300
IDEMPOTENCY_ATTEMPTS = 5
IDEMPOTENCY_RETRY_SECONDS = 0.4


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


def intent_idempotency_key(order_id: int, amount, replaces: str | None = None) -> str:
    """Stripe Idempotency-Key for an order's PaymentIntent.

    Every request that starts a PaymentIntent for the same order (React Strict
    Mode double mount, double tap, two tabs, a retried request, two serverless
    instances) sends the same key, so Stripe returns the same PaymentIntent
    instead of creating another. The amount is part of the key because Stripe
    rejects a reused key whose parameters changed. `replaces` is the id of a
    cancelled intent being superseded; it gives the replacement a fresh key
    while every concurrent caller that saw the same cancelled intent still
    agrees on it.
    """
    return f"fos-pi-order-{order_id}-{to_minor_units(amount)}-{replaces or 'first'}"


async def create_payment_intent(
    *, amount, currency: str, order_id: int, order_code: str, idempotency_key: str | None = None,
) -> dict:
    data = {
        "amount": to_minor_units(amount),
        "currency": currency.lower(),
        # Cards only for the demo (no Link / wallets / redirect methods)
        "payment_method_types[]": "card",
        "metadata[order_id]": str(order_id),
        "metadata[order_code]": order_code,
        "description": f"Favourite of Shop order {order_code} (demo)",
    }
    headers = _headers()
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    for attempt in range(IDEMPOTENCY_ATTEMPTS):
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(f"{API}/payment_intents", data=data, headers=headers)
        # 409 = another request with this key is still in flight. Wait for it to
        # finish, then the same key replays its saved response (the same intent).
        if r.status_code == 409 and idempotency_key and attempt < IDEMPOTENCY_ATTEMPTS - 1:
            await asyncio.sleep(IDEMPOTENCY_RETRY_SECONDS * (attempt + 1))
            continue
        break
    if r.status_code >= 400:
        raise StripeError(_error_message(r))
    return r.json()


async def retrieve_payment_intent(intent_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{API}/payment_intents/{intent_id}", headers=_headers())
    if r.status_code >= 400:
        raise StripeError(_error_message(r))
    return r.json()


async def cancel_payment_intent(intent_id: str) -> dict:
    """Cancel an open intent so the card can no longer be charged. Stripe refuses (StripeError) if
    the intent already succeeded or is processing; the caller must then re-check it."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{API}/payment_intents/{intent_id}/cancel",
            data={"cancellation_reason": "abandoned"}, headers=_headers(),
        )
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

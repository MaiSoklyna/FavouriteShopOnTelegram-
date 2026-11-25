"""Which payment methods can actually be used right now.

Cash on delivery always works. Card (Stripe test mode) and KHQR (ABA PayWay) only when the server has
their keys. Checkout asks GET /api/payments/methods, and placing an order refuses a method that is not
available, so a customer can never end up with an online order nobody can pay (found in the
2026-11-25 production smoke test: card was offered, but the server had no Stripe key).
"""

from __future__ import annotations

from app.services import payway, stripe_pay

KNOWN = ("cod", "stripe", "khqr")


def available() -> list[str]:
    out = ["cod"]
    if stripe_pay.is_configured():
        out.append("stripe")
    if payway.is_configured():
        out.append("khqr")
    return out


def unavailable_message(method: str) -> str | None:
    """Why `method` can't be used now, or None if it can."""
    if method not in KNOWN:
        return "Unknown payment method"
    if method in available():
        return None
    name = {"stripe": "Card payment", "khqr": "KHQR payment"}.get(method, method)
    return f"{name} isn't available right now. Please choose cash on delivery."

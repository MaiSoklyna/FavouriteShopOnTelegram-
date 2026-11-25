"""Which payment methods can actually be used right now, and by whom.

Cash on delivery always works. KHQR (ABA PayWay) needs its keys. Card (Stripe test mode) needs a Stripe
test key AND is released in steps with CARD_PAYMENTS:

    off      nobody sees card
    testers  only the customers in CARD_TESTER_USER_IDS (users.id, comma-separated)   <- default
    on       everyone (the release)

So the keys can be added to production and the whole card flow (including Stripe's webhook) tested
there by a few accounts, before real customers see it (decision 2026-11-25: test fully, then release).

Checkout asks GET /api/payments/methods; placing an order and creating a card payment refuse a method
the customer may not use, so nobody ends up with an online order that can't be paid (found in the
2026-11-25 production smoke test: card was offered, but the server had no Stripe key).
"""

from __future__ import annotations

from app.config import settings
from app.services import payway, stripe_pay

KNOWN = ("cod", "stripe", "khqr")
CARD_MODES = ("off", "testers", "on")


def card_mode() -> str:
    mode = (settings.CARD_PAYMENTS or "testers").strip().lower()
    return mode if mode in CARD_MODES else "off"


def card_testers() -> set[int]:
    out = set()
    for part in (settings.CARD_TESTER_USER_IDS or "").split(","):
        part = part.strip()
        if part.isdigit():
            out.add(int(part))
    return out


def card_allowed(user_id: int | None) -> bool:
    if not stripe_pay.is_configured():
        return False
    mode = card_mode()
    return mode == "on" or (mode == "testers" and user_id is not None and user_id in card_testers())


def available(user_id: int | None = None) -> list[str]:
    out = ["cod"]
    if card_allowed(user_id):
        out.append("stripe")
    if payway.is_configured():
        out.append("khqr")
    return out


def unavailable_message(method: str, user_id: int | None = None) -> str | None:
    """Why this customer can't use `method` now, or None if they can."""
    if method not in KNOWN:
        return "Unknown payment method"
    if method in available(user_id):
        return None
    name = {"stripe": "Card payment", "khqr": "KHQR payment"}.get(method, method)
    return f"{name} isn't available right now. Please choose cash on delivery."


async def customer_id(db, user) -> int | None:
    """users.id of the signed-in customer (None for visitors and admins)."""
    if not user or not getattr(user, "telegram_id", None) or not getattr(user, "is_user", False):
        return None
    row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
    return (row or {}).get("id")

"""Merchant settlement — commission math and earning lifecycle.

One rule set for every payment path:

    subsidy           = order.platform_discount_amount  (discount the platform pays)
    merchant_gross    = order.total + subsidy        (what the sale is worth to the shop)
    commission_base   = merchant_gross - delivery_fee   (or merchant_gross, if
                        COMMISSION_INCLUDES_DELIVERY)
    commission_amount = round(commission_base * rate / 100, 2)
    net_amount        = merchant_gross - commission_amount   → owed to merchant

A platform-funded discount never reduces what the merchant earns: $100 sale,
$10 platform discount → customer pays $90, merchant is owed $100 - commission.
A shop-funded discount is already inside order.total, so the shop bears it.

`compute_split()` is used both when building a PayWay `payout` (future
ABA Split & Payout) and when recording the earning after payment, so the
amount ABA would send the seller and the amount our ledger says they're
owed can never diverge.

All ledger writes go through Postgres functions (migration 014) so they
are atomic, idempotent and audited.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import httpx

from app.config import settings
from app.core.exceptions import BadRequestError, NotFoundError

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")

# Orders where the platform receives the customer's money
PLATFORM_COLLECTED_METHODS = frozenset({"khqr"})


def money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Split:
    gross: Decimal              # what the platform received for the order
    subsidy: Decimal            # platform-funded discount, owed to the merchant by the platform
    commission_base: Decimal
    commission_rate: Decimal
    commission: Decimal
    net: Decimal


def default_commission_rate() -> Decimal:
    return money(settings.PLATFORM_COMMISSION_PERCENT)


def effective_commission_rate(merchant: dict | None) -> Decimal:
    rate = (merchant or {}).get("commission_rate")
    return money(rate) if rate is not None else default_commission_rate()


def compute_split(order: dict, rate: Decimal | None = None) -> Split:
    """Split an order's total between merchant and platform.

    Uses the commission rate frozen on the order when present.
    """
    gross = money(order["total"])
    subsidy = max(money(order.get("platform_discount_amount")), Decimal("0"))
    if rate is None:
        rate = (
            money(order["commission_rate"])
            if order.get("commission_rate") is not None
            else default_commission_rate()
        )
    merchant_gross = gross + subsidy
    base = merchant_gross if settings.COMMISSION_INCLUDES_DELIVERY else merchant_gross - money(order.get("delivery_fee"))
    base = max(base, Decimal("0"))
    commission = (base * rate / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    return Split(gross=gross, subsidy=subsidy, commission_base=base, commission_rate=rate,
                 commission=commission, net=merchant_gross - commission)


def subsidy_only_split(order: dict) -> Split:
    """Earning for an order the merchant collected (COD): only the platform-funded
    discount is owed. No commission, as on any COD order today."""
    subsidy = max(money(order.get("platform_discount_amount")), Decimal("0"))
    zero = Decimal("0.00")
    rate = money(order["commission_rate"]) if order.get("commission_rate") is not None else default_commission_rate()
    return Split(gross=zero, subsidy=subsidy, commission_base=zero, commission_rate=rate,
                 commission=zero, net=subsidy)


def split_payout_allowed(merchant: dict | None, order: dict | None = None) -> bool:
    """True when this payment may be routed through ABA Split & Payout.

    Needs the platform switch AND a verified, enabled merchant account.
    Otherwise the platform collects and the merchant is paid manually.
    An order with a platform-funded discount is always paid from the ledger:
    the merchant is owed more than ABA receives for it.
    """
    if order and money(order.get("platform_discount_amount")) > 0:
        return False
    m = merchant or {}
    return bool(
        settings.PAYWAY_PAYOUT_ENABLED
        and m.get("payout_enabled")
        and m.get("payout_verification_status") == "verified"
        and m.get("aba_account")
    )


# ── Ledger operations (Postgres RPC) ────────────────────────────


async def rpc(db, fn: str, params: dict) -> dict | None:
    """Call a settlement function; map its errors to API errors."""
    try:
        result = await db.rpc(fn, params)
    except httpx.HTTPStatusError as exc:
        try:
            body = exc.response.json()
        except ValueError:
            body = {}
        code, message = body.get("code"), body.get("message") or "Settlement error"
        if code == "P0001":
            raise BadRequestError(message) from exc
        if code == "P0002":
            raise NotFoundError(message) from exc
        raise
    if isinstance(result, list):
        result = result[0] if result else None
    if isinstance(result, dict) and result.get("id") is None:
        return None
    return result


async def record_order_earning(db, order: dict, *, actor_type: str = "system",
                               actor_id: str | None = None) -> dict | None:
    """Record what a paid order earns its merchant. Idempotent per order.

    Orders where the platform holds the money produce a full earning. A
    cash-on-delivery order produces one only when the platform funded part of
    the discount: the merchant holds the cash, so the platform owes just the
    subsidy (gross 0, no commission — COD commission isn't collected).
    """
    platform_collected = order.get("payment_method") in PLATFORM_COLLECTED_METHODS
    if not platform_collected and money(order.get("platform_discount_amount")) <= 0:
        return None
    if order.get("status") == "cancelled":
        # Customer paid a cancelled order — the platform owes the customer
        # a refund, not the merchant a payout.
        logger.error("Order %s paid after cancellation — refund customer, no earning", order["id"])
        return None

    if platform_collected:
        split = compute_split(order)
        method = "aba_split" if order.get("payout_mode") == "aba_split" else "manual"
        collected_by, description = "platform", None
    else:
        split = subsidy_only_split(order)
        method, collected_by = "manual", "merchant"
        description = "Platform-funded discount on a cash-on-delivery order"
    params = {
        "p_order_id": order["id"],
        "p_merchant_id": order["merchant_id"],
        "p_currency": settings.CURRENCY,
        "p_gross_amount": str(split.gross),
        "p_commission_base": str(split.commission_base),
        "p_commission_rate": str(split.commission_rate),
        "p_commission_amount": str(split.commission),
        "p_net_amount": str(split.net),
        "p_collected_by": collected_by,
        "p_settlement_method": method,
        "p_payway_tran_id": order.get("payway_tran_id"),
        "p_actor_type": actor_type,
        "p_actor_id": actor_id,
    }
    # Only sent when used, so plain orders keep working before migration 022.
    if split.subsidy > 0:
        params["p_platform_subsidy"] = str(split.subsidy)
    if description:
        params["p_description"] = description
    earning = await rpc(db, "record_order_earning", params)

    # Delivered before the payment was recorded (e.g. backfill)
    if earning and order.get("status") == "delivered":
        earning = await rpc(db, "mark_order_earning_ready", {
            "p_order_id": order["id"], "p_actor_type": actor_type, "p_actor_id": actor_id,
        }) or earning
    return earning


async def on_order_status_changed(db, order_id: int, new_status: str, *,
                                  actor_type: str, actor_id: str | None,
                                  reason: str | None = None) -> None:
    """Keep the earning in step with the order lifecycle."""
    if new_status == "delivered":
        await rpc(db, "mark_order_earning_ready", {
            "p_order_id": order_id, "p_actor_type": actor_type, "p_actor_id": actor_id,
        })
    elif new_status in ("cancelled", "refunded"):
        await rpc(db, "reverse_order_earning", {
            "p_order_id": order_id, "p_reason": reason or f"Order {new_status}",
            "p_actor_type": actor_type, "p_actor_id": actor_id,
        })


async def audit(db, *, entity_type: str, entity_id: int, merchant_id: int | None,
                action: str, actor_type: str, actor_id: str | None,
                old_value: dict | None = None, new_value: dict | None = None,
                note: str | None = None) -> None:
    await db.from_("settlement_audit_log").insert({
        "entity_type": entity_type,
        "entity_id": entity_id,
        "merchant_id": merchant_id,
        "action": action,
        "actor_type": actor_type,
        "actor_id": actor_id,
        "old_value": old_value,
        "new_value": new_value,
        "note": note,
    })


def mask_account(account: str | None) -> str | None:
    if not account:
        return account
    digits = account.replace(" ", "")
    return f"•••{digits[-4:]}" if len(digits) > 4 else "•••"

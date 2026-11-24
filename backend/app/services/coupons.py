"""Coupons: who may use a code, and using it exactly as many times as allowed.

A code can be public (listed; anyone may claim or use it) or private (hidden; only customers who were
given it, i.e. have it in their wallet). `per_user_limit` caps one customer's uses (NULL = unlimited, which
keeps recurring campaigns working), `max_uses` caps everyone's.

The authority is the database (migration 030): claim_promo_use() checks every limit and counts the use in
one transaction, so two orders racing for the last use cannot both succeed. The checks here only give the
customer a friendly reason early ("Spend $4 more", "You've already used this") before they pay.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import httpx

from app.core.exceptions import BadRequestError
from app.services import notify

logger = logging.getLogger(__name__)

# the table / column / function from migration 030 is not there yet
NOT_SET_UP = ("42P01", "PGRST205", "42703", "PGRST204", "PGRST202")


def _money(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _not_set_up(exc: httpx.HTTPStatusError) -> bool:
    return notify._error_code(exc) in NOT_SET_UP


def _expired(promo: dict, now: datetime) -> bool:
    exp = promo.get("expires_at")
    if not exp:
        return False
    try:
        return now > datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
    except ValueError:
        return False


def used_up(promo: dict) -> bool:
    return bool(promo.get("max_uses")) and (promo.get("used_count") or 0) >= promo["max_uses"]


def check(promo: dict, *, subtotal: Decimal | None, uses_by_user: int, in_wallet: bool,
          now: datetime | None = None) -> tuple[bool, str | None]:
    """(usable, reason it is not). `subtotal=None` skips the minimum-order check (a coupon list, not a cart)."""
    now = now or datetime.now(timezone.utc)
    if not promo.get("is_active", True):
        return False, "This coupon is no longer available"
    if promo.get("audience") == "private" and not in_wallet:
        return False, "This coupon is not valid for you"
    if _expired(promo, now):
        return False, "Expired"
    if used_up(promo):
        return False, "Fully used"
    limit = promo.get("per_user_limit")
    if limit and uses_by_user >= limit:
        return False, "You've already used this coupon" if limit == 1 else f"You've used this coupon {limit} times"
    minimum = _money(promo.get("min_order"))
    if subtotal is not None and minimum > 0 and subtotal < minimum:
        return False, f"Spend ${minimum - subtotal:.2f} more (minimum ${minimum:.2f})"
    return True, None


def status_of(promo: dict, *, uses_by_user: int, now: datetime | None = None) -> str:
    """available | used | expired | used_up | inactive (for the wallet list)."""
    now = now or datetime.now(timezone.utc)
    if not promo.get("is_active", True):
        return "inactive"
    if _expired(promo, now):
        return "expired"
    limit = promo.get("per_user_limit")
    if limit and uses_by_user >= limit:
        return "used"
    if used_up(promo):
        return "used_up"
    return "available"


def discount_text(promo: dict) -> str:
    value = float(promo.get("value") or 0)
    if promo.get("type") == "percent":
        return f"{value:g}% off"
    return f"${value:g} off"


# ── reading what a customer has / has used ──────────────────────────

async def user_use_counts(db, user_id: int | None, code_ids: list[int]) -> dict[int, int]:
    if not user_id or not code_ids:
        return {}
    rows = await db.from_("promo_usages").eq("user_id", user_id).in_("promo_code_id", code_ids).select("promo_code_id")
    counts: dict[int, int] = {}
    for r in rows:
        counts[r["promo_code_id"]] = counts.get(r["promo_code_id"], 0) + 1
    return counts


async def wallet_code_ids(db, user_id: int | None) -> set[int]:
    """The codes in this customer's wallet (empty before migration 030)."""
    if not user_id:
        return set()
    try:
        return {r["promo_code_id"] for r in await db.from_("coupon_wallet").eq("user_id", user_id).select("promo_code_id")}
    except httpx.HTTPStatusError as exc:
        if _not_set_up(exc):
            return set()
        raise


async def promotions_by_code(db, code_ids: list[int]) -> dict[int, dict]:
    """The promotion (campaign) behind each code, if any (none before migration 018)."""
    if not code_ids:
        return {}
    try:
        rows = await db.from_("promotions").in_("promo_code_id", code_ids).select()
    except httpx.HTTPStatusError:
        return {}
    return {r["promo_code_id"]: r for r in rows}


# ── using a coupon: claim before the order exists, attach after ─────

async def claim_use(db, promo: dict, user_id: int, discount) -> dict:
    """Count one use for this customer atomically. Raises BadRequestError with the reason if the coupon cannot
    be used any more (expired, fully used, already used by this customer, not theirs). Before migration 030 it
    returns {"legacy": True} and the use is recorded after the order, the old way."""
    try:
        usage_id = await db.rpc("claim_promo_use", {
            "p_code_id": promo["id"], "p_user_id": user_id, "p_discount": float(discount)})
    except httpx.HTTPStatusError as exc:
        if notify._error_code(exc) == "P0001":
            try:
                message = exc.response.json().get("message")
            except ValueError:
                message = None
            raise BadRequestError(message or "This coupon can't be used") from exc
        if _not_set_up(exc):
            logger.error("Migration 030 (coupons) is not applied: coupon limits are NOT protected from races")
            return {"legacy": True}
        raise
    return {"usage_id": usage_id}


async def finish_use(db, claim: dict | None, promo: dict, user_id: int, order_id: int, discount) -> None:
    """Tie the claimed use to its order (or, before migration 030, record it the old way)."""
    if not claim:
        return
    if claim.get("usage_id"):
        await db.from_("promo_usages").eq("id", claim["usage_id"]).update({"order_id": order_id})
        return
    await db.from_("promo_usages").insert({
        "promo_code_id": promo["id"], "user_id": user_id, "order_id": order_id, "discount_applied": float(discount)})
    await db.from_("promo_codes").eq("id", promo["id"]).update({"used_count": (promo.get("used_count") or 0) + 1})


async def release_use(db, claim: dict | None) -> None:
    """The order failed before it existed: give the use back. Never raises."""
    if not claim or not claim.get("usage_id"):
        return
    try:
        await db.rpc("release_promo_use", {"p_usage_id": claim["usage_id"]})
    except Exception:
        logger.exception("Could not give back coupon use %s", claim["usage_id"])


async def release_for_order(db, order_id: int) -> None:
    """A cancelled order gives its coupon use back. Never raises."""
    try:
        await db.rpc("release_promo_use_for_order", {"p_order_id": order_id})
    except httpx.HTTPStatusError as exc:
        if not _not_set_up(exc):
            logger.exception("Could not give back the coupon use of order %s", order_id)
            return
        try:  # before migration 030: the same thing, the long way round
            for u in await db.from_("promo_usages").eq("order_id", order_id).select("id,promo_code_id"):
                code = await db.from_("promo_codes").eq("id", u["promo_code_id"]).select_one("id,used_count")
                await db.from_("promo_usages").eq("id", u["id"]).delete()
                if code:
                    await db.from_("promo_codes").eq("id", code["id"]).update({"used_count": max((code.get("used_count") or 0) - 1, 0)})
        except Exception:
            logger.exception("Could not give back the coupon use of order %s", order_id)
    except Exception:
        logger.exception("Could not give back the coupon use of order %s", order_id)

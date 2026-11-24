"""Loyalty program: points customers earn, what they are worth, and what the program costs the platform.

Rules (the business decisions, in one place):
- Points are earned ONCE per DELIVERED order, on the amount the customer actually paid (the order total, after
  every discount). Nothing is earned when an order is placed, so a cancelled order earns nothing.
- A shop can opt out (merchants.loyalty_enabled); then its orders earn no points.
- A cancelled order that had earned points takes them back, once.
- Points are spent by turning them into a single-use coupon (My Coupons), paid for by the platform.
- Tier (bronze / silver / gold) follows lifetime points and multiplies what is earned.

The platform pays for points, so `sustainability()` compares what a point is worth with the commission the
platform earns on the same order.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

import httpx

from app.core.exceptions import BadRequestError, ConflictError
from app.services import notify, settlement

logger = logging.getLogger(__name__)

CAS_ATTEMPTS = 6
# What share of the commission the program may give back at its richest tier before it stops being comfortable
COMFORT_SHARE_OF_COMMISSION = 0.40
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L: easy to read out


# ── settings and tiers ──────────────────────────────────────────────

async def get_settings(db) -> dict | None:
    return await db.from_("loyalty_settings").select_one()


def multiplier_for(tier: str, ls: dict) -> float:
    if tier == "gold":
        return float(ls.get("gold_multiplier") or 2.0)
    if tier == "silver":
        return float(ls.get("silver_multiplier") or 1.5)
    return 1.0


def tier_for(lifetime: int, ls: dict | None) -> str:
    ls = ls or {}
    if lifetime >= int(ls.get("gold_threshold") or 2000):
        return "gold"
    if lifetime >= int(ls.get("silver_threshold") or 500):
        return "silver"
    return "bronze"


def points_for(amount, tier: str, ls: dict) -> int:
    """Whole points for an amount paid: the base rate, then the tier's multiplier."""
    base = int(Decimal(str(amount or 0)) * Decimal(str(ls.get("points_per_dollar") or 0)))
    return int(base * multiplier_for(tier, ls))


def points_to_dollars(points: int, ls: dict) -> Decimal:
    return (Decimal(points) * Decimal(int(ls.get("points_value_cents") or 1)) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def get_or_create_account(db, user_id: int) -> dict:
    row = await db.from_("loyalty_accounts").eq("user_id", user_id).select_one()
    if row:
        return row
    try:
        return (await db.from_("loyalty_accounts").insert({"user_id": user_id, "balance": 0, "lifetime_points": 0, "tier": "bronze"}))[0]
    except httpx.HTTPStatusError:
        row = await db.from_("loyalty_accounts").eq("user_id", user_id).select_one()  # lost a race: it exists now
        if row:
            return row
        raise


async def shop_takes_part(db, merchant_id: int | None) -> bool:
    """Does this shop take part in the program? (Everyone does before migration 031.)"""
    if not merchant_id:
        return True
    try:
        row = await db.from_("merchants").eq("id", merchant_id).select_one("id,loyalty_enabled")
    except httpx.HTTPStatusError as exc:
        if notify._error_code(exc) in ("42703", "PGRST204"):
            return True
        raise
    return bool(row) and row.get("loyalty_enabled") is not False


async def _change_account(db, account_id: int, change):
    """Update an account from its current values without losing a concurrent update: the write only
    succeeds if balance and lifetime are still what we read; otherwise read again and retry.
    `change(account) -> dict` may raise to abort. Returns (before, after)."""
    for _ in range(CAS_ATTEMPTS):
        before = await db.from_("loyalty_accounts").eq("id", account_id).select_one()
        if not before:
            raise ConflictError("Loyalty account not found")
        rows = await db.from_("loyalty_accounts").eq("id", account_id) \
            .eq("balance", before["balance"]).eq("lifetime_points", before["lifetime_points"]).update(change(before))
        if rows:
            return before, rows[0]
    raise ConflictError("Your points are being updated. Please try again.")


async def _txn(db, order_id: int, kind: str) -> dict | None:
    return await db.from_("points_transactions").eq("order_id", order_id).eq("type", kind).select_one()


# ── earning (after delivery) and taking back (on cancel) ───────────

async def award_for_order(db, order_id: int) -> dict | None:
    """Pay out the points for a delivered order. None if there is nothing to pay (program off, shop opted out,
    not delivered, already paid, zero points). Safe to call twice."""
    order = await db.from_("orders").eq("id", order_id).select_one("id,user_id,merchant_id,total,status")
    if not order or order["status"] != "delivered":
        return None
    ls = await get_settings(db)
    if not ls or not ls.get("is_enabled"):
        return None
    if not await shop_takes_part(db, order["merchant_id"]):
        return None
    if await _txn(db, order_id, "earn"):
        return None  # already paid (also covers points that used to be paid when the order was placed)

    account = await get_or_create_account(db, order["user_id"])
    mult = multiplier_for(account["tier"], ls)
    pts = points_for(order["total"], account["tier"], ls)
    if pts <= 0:
        return None

    # Claim the order first: the unique index lets exactly one request write this row, and only that
    # request touches the balance, so two requests can never both pay (or both take back) the same order.
    try:
        claim = (await db.from_("points_transactions").insert({
            "loyalty_account_id": account["id"], "type": "earn", "points": pts, "balance_after": account["balance"] + pts, "order_id": order_id,
            "description": f"Earned from order (x{mult:g} {account['tier']} bonus)" if mult > 1 else "Earned from order",
        }))[0]
    except httpx.HTTPStatusError as exc:
        if notify._error_code(exc) == "23505":
            return None  # someone else paid it a moment ago
        raise

    def add(acct: dict) -> dict:
        lifetime = acct["lifetime_points"] + pts
        return {"balance": acct["balance"] + pts, "lifetime_points": lifetime, "tier": tier_for(lifetime, ls)}

    try:
        before, after = await _change_account(db, account["id"], add)
    except Exception:
        await _drop(db, claim)  # the points were not added, so there must be no record that they were
        raise
    await db.from_("points_transactions").eq("id", claim["id"]).update({"balance_after": after["balance"]})
    if after["tier"] != before["tier"]:
        logger.info("User %s moved from %s to %s", order["user_id"], before["tier"], after["tier"])
    return {"points_earned": pts, "new_balance": after["balance"], "tier": after["tier"], "multiplier": mult, "user_id": order["user_id"]}


async def _drop(db, row: dict) -> None:
    try:
        await db.from_("points_transactions").eq("id", row["id"]).delete()
    except Exception:
        logger.exception("Could not remove points record %s", row.get("id"))


async def reverse_for_order(db, order_id: int) -> dict | None:
    """A cancelled order gives back the points it earned (once). None if it earned none or already gave them back."""
    earn = await _txn(db, order_id, "earn")
    if not earn or not earn.get("points") or await _txn(db, order_id, "reversal"):
        return None
    pts = earn["points"]
    ls = await get_settings(db)
    try:
        claim = (await db.from_("points_transactions").insert({
            "loyalty_account_id": earn["loyalty_account_id"], "type": "reversal", "points": -pts, "balance_after": 0,
            "order_id": order_id, "description": "Order cancelled: points returned"}))[0]
    except httpx.HTTPStatusError as exc:
        if notify._error_code(exc) == "23505":
            return None  # a concurrent cancel is already giving them back
        raise

    def take(acct: dict) -> dict:
        lifetime = max(acct["lifetime_points"] - pts, 0)
        return {"balance": max(acct["balance"] - pts, 0), "lifetime_points": lifetime, "tier": tier_for(lifetime, ls)}

    try:
        _, after = await _change_account(db, earn["loyalty_account_id"], take)
    except Exception:
        await _drop(db, claim)
        raise
    await db.from_("points_transactions").eq("id", claim["id"]).update({"balance_after": after["balance"]})
    return {"points_returned": pts, "new_balance": after["balance"]}


async def on_order_delivered(db, order_id: int) -> None:
    """Order delivered: pay the points and tell the customer. Never raises (a delivery must not fail on this)."""
    try:
        result = await award_for_order(db, order_id)
        if result:
            await notify.notify_user(
                db, result["user_id"], "loyalty", f"You earned {result['points_earned']:,} points",
                f"Thanks for your order! Your balance is now {result['new_balance']:,} points.",
                link="/shop/rewards", ref_id=order_id, dedupe_key=f"points:{order_id}")
    except Exception:
        logger.exception("Could not award loyalty points for order %s", order_id)


async def on_order_cancelled(db, order_id: int) -> None:
    """Order cancelled: take back any points it had earned. Never raises."""
    try:
        await reverse_for_order(db, order_id)
    except Exception:
        logger.exception("Could not return loyalty points for cancelled order %s", order_id)


# ── spending: points become a coupon ───────────────────────────────

def _new_code() -> str:
    return "PTS-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


async def redeem_for_coupon(db, user_id: int, points: int) -> dict:
    """Turn points into a single-use coupon in the customer's wallet (My Coupons), paid for by the platform."""
    ls = await get_settings(db)
    if not ls or not ls.get("is_enabled"):
        raise BadRequestError("The rewards program is not enabled")
    minimum = int(ls.get("min_redeem_points") or 1)
    if points < minimum:
        raise BadRequestError(f"You need at least {minimum} points to redeem")
    account = await get_or_create_account(db, user_id)
    if points > account["balance"]:
        raise BadRequestError("You don't have enough points")
    amount = points_to_dollars(points, ls)
    if amount <= 0:
        raise BadRequestError("That is not enough points for a coupon")

    def spend(acct: dict) -> dict:
        if acct["balance"] < points:  # someone (this customer, in another tab) spent them first
            raise BadRequestError("You don't have enough points")
        return {"balance": acct["balance"] - points}

    before, after = await _change_account(db, account["id"], spend)   # points leave first, so they cannot be spent twice
    days = int(ls.get("redeem_coupon_days") or 30)
    expires = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    code_id = None
    try:
        code = None
        for _ in range(5):
            code = _new_code()
            try:
                code_id = (await db.from_("promo_codes").insert({
                    "merchant_id": None, "code": code, "type": "fixed", "value": float(amount), "min_order": 0, "max_uses": 1,
                    "per_user_limit": 1, "audience": "private", "expires_at": expires, "is_active": True}))[0]["id"]
                break
            except httpx.HTTPStatusError as exc:
                if notify._error_code(exc) != "23505":
                    raise
        if code_id is None:
            raise ConflictError("Could not create your coupon. Please try again.")
        await db.from_("coupon_wallet").insert({"promo_code_id": code_id, "user_id": user_id, "source": "granted"})
        txn = {"loyalty_account_id": account["id"], "type": "redeem", "points": -points, "balance_after": after["balance"],
               "description": f"Redeemed for a ${amount:.2f} coupon"}
        try:
            await db.from_("points_transactions").insert({**txn, "promo_code_id": code_id})
        except httpx.HTTPStatusError as exc:
            if notify._error_code(exc) not in ("42703", "PGRST204"):
                raise
            await db.from_("points_transactions").insert(txn)  # before migration 031
    except Exception as exc:
        # Nothing was bought: give the points back and remove the half-made coupon
        await _change_account(db, account["id"], lambda a: {"balance": a["balance"] + points})
        if code_id is not None:
            try:
                await db.from_("promo_codes").eq("id", code_id).update({"is_active": False})
            except Exception:
                logger.exception("Could not switch off the coupon of a failed redemption")
        if isinstance(exc, httpx.HTTPStatusError) and notify._error_code(exc) in ("42703", "PGRST204", "42P01", "PGRST205"):
            raise BadRequestError("Coupons are not set up on the server yet. Your points were not used.") from exc
        raise
    return {"points_redeemed": points, "remaining_balance": after["balance"], "discount_amount": float(amount),
            "coupon": {"id": code_id, "code": code, "value": float(amount), "expires_at": expires}}


# ── what is on the way / what the program costs ────────────────────

async def pending_points(db, user_id: int) -> dict:
    """Points the customer will earn when their open orders are delivered (an estimate)."""
    ls = await get_settings(db)
    if not ls or not ls.get("is_enabled"):
        return {"points": 0, "orders": 0}
    account = await get_or_create_account(db, user_id)
    orders = await db.from_("orders").eq("user_id", user_id).in_("status", ["pending", "confirmed", "processing", "shipped"]).select("id,merchant_id,total")
    total = n = 0
    for o in orders:
        if await _txn(db, o["id"], "earn") or not await shop_takes_part(db, o["merchant_id"]):
            continue  # already paid, or the shop is not in the program
        pts = points_for(o["total"], account["tier"], ls)
        if pts > 0:
            total, n = total + pts, n + 1
    return {"points": total, "orders": n}


def _verdict(max_rebate_pct: float, commission_pct: float) -> str:
    if commission_pct <= 0:
        return "loss" if max_rebate_pct > 0 else "healthy"
    if max_rebate_pct <= commission_pct * COMFORT_SHARE_OF_COMMISSION:
        return "healthy"
    return "tight" if max_rebate_pct <= commission_pct else "loss"


async def sustainability(db) -> dict:
    """Is the program affordable? A point is worth `points_value_cents`; earning `points_per_dollar` of them per
    dollar returns a rebate on every order, which the platform pays out of the commission it earns on that order."""
    ls = await get_settings(db) or {}
    ppd = float(ls.get("points_per_dollar") or 0)
    value = int(ls.get("points_value_cents") or 1) / 100
    commission = float(settlement.default_commission_rate())            # percent of an order the platform keeps
    tiers = {}
    for tier in ("bronze", "silver", "gold"):
        mult = multiplier_for(tier, ls)
        rebate = round(ppd * mult * value * 100, 2)                       # % of what the customer pays
        tiers[tier] = {"multiplier": mult, "points_per_dollar": round(ppd * mult, 2), "rebate_pct": rebate,
                       "net_pct": round(commission - rebate, 2)}        # what the platform keeps after the rebate
    max_rebate = max(t["rebate_pct"] for t in tiers.values())
    max_mult = max(t["multiplier"] for t in tiers.values())
    target = commission * COMFORT_SHARE_OF_COMMISSION / 100
    recommended = round(target / (max_mult * value), 2) if max_mult * value > 0 else 0

    accounts = await db.from_("loyalty_accounts").select("balance")
    txns = await db.from_("points_transactions").select("type,points")
    revenue = sum(float(o["total"]) for o in await db.from_("orders").eq("status", "delivered").select("total"))
    outstanding = sum(a["balance"] for a in accounts)
    earned = sum(t["points"] for t in txns if t["type"] == "earn")
    redeemed = -sum(t["points"] for t in txns if t["type"] == "redeem")
    liability = round(outstanding * value, 2)
    commission_revenue = round(revenue * commission / 100, 2)
    return {
        "enabled": bool(ls.get("is_enabled")), "commission_pct": commission, "point_value": value,
        "points_per_dollar": ppd, "tiers": tiers, "max_rebate_pct": max_rebate, "verdict": _verdict(max_rebate, commission),
        "recommended_points_per_dollar": recommended,
        "recommended_max_rebate_pct": round(recommended * max_mult * value * 100, 2),
        "actual": {
            "delivered_revenue": round(revenue, 2), "commission_revenue": commission_revenue, "points_outstanding": outstanding,
            "liability": liability, "liability_pct_of_revenue": round(liability / revenue * 100, 1) if revenue else None,
            "liability_vs_commission": round(liability / commission_revenue, 2) if commission_revenue else None,
            "points_earned": earned, "points_redeemed": redeemed, "members": len(accounts),
        },
    }

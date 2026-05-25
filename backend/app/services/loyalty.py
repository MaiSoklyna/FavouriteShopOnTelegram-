"""Loyalty program service — points earning, redemption, and tier management."""

import logging
from app.services.rest import RestClient

logger = logging.getLogger(__name__)


async def get_settings() -> dict | None:
    """Get loyalty settings."""
    client = RestClient(service_role=True)
    rows = await client.get("loyalty_settings?limit=1&select=*")
    return rows[0] if rows else None


async def get_or_create_account(user_id: int) -> dict:
    """Get or create a loyalty account for a user."""
    client = RestClient(service_role=True)
    rows = await client.get(f"loyalty_accounts?user_id=eq.{user_id}&select=*&limit=1")
    if rows:
        return rows[0]

    result = await client.insert("loyalty_accounts", {
        "user_id": user_id,
        "balance": 0,
        "lifetime_points": 0,
        "tier": "bronze",
    })
    if isinstance(result, list) and result:
        return result[0]
    # Re-fetch in case of race condition
    rows = await client.get(f"loyalty_accounts?user_id=eq.{user_id}&select=*&limit=1")
    return rows[0] if rows else {"user_id": user_id, "balance": 0, "lifetime_points": 0, "tier": "bronze"}


async def earn_points(user_id: int, order_id: int, order_total: float) -> dict | None:
    """Award loyalty points for a completed purchase. Returns None if loyalty is disabled."""
    ls = await get_settings()
    if not ls or not ls.get("is_enabled"):
        return None

    account = await get_or_create_account(user_id)
    client = RestClient(service_role=True)

    # Calculate points with tier multiplier
    base_points = int(order_total * float(ls["points_per_dollar"]))
    multiplier = 1.0
    if account["tier"] == "silver":
        multiplier = float(ls.get("silver_multiplier", 1.5))
    elif account["tier"] == "gold":
        multiplier = float(ls.get("gold_multiplier", 2.0))

    points_earned = int(base_points * multiplier)
    if points_earned <= 0:
        return None

    new_balance = account["balance"] + points_earned
    new_lifetime = account["lifetime_points"] + points_earned

    # Calculate new tier based on lifetime points
    gold_threshold = int(ls.get("gold_threshold", 2000))
    silver_threshold = int(ls.get("silver_threshold", 500))

    if new_lifetime >= gold_threshold:
        new_tier = "gold"
    elif new_lifetime >= silver_threshold:
        new_tier = "silver"
    else:
        new_tier = "bronze"

    # Update account with new balance, lifetime, and tier
    await client.update(
        f"loyalty_accounts?id=eq.{account['id']}",
        {"balance": new_balance, "lifetime_points": new_lifetime, "tier": new_tier},
    )

    # Record transaction
    await client.insert("points_transactions", {
        "loyalty_account_id": account["id"],
        "type": "earn",
        "points": points_earned,
        "balance_after": new_balance,
        "order_id": order_id,
        "description": f"Earned from order (x{multiplier} {account['tier']} bonus)" if multiplier > 1 else "Earned from purchase",
    })

    if new_tier != account["tier"]:
        logger.info("User %s upgraded from %s to %s", user_id, account["tier"], new_tier)

    return {
        "points_earned": points_earned,
        "new_balance": new_balance,
        "tier": new_tier,
        "multiplier": multiplier,
    }


async def redeem_points(user_id: int, points: int) -> dict:
    """Redeem points for a discount. Returns discount amount in dollars."""
    ls = await get_settings()
    if not ls or not ls.get("is_enabled"):
        raise ValueError("Loyalty program is not enabled")

    account = await get_or_create_account(user_id)

    if points < ls["min_redeem_points"]:
        raise ValueError(f"Minimum {ls['min_redeem_points']} points required to redeem")
    if points > account["balance"]:
        raise ValueError("Insufficient points balance")

    client = RestClient(service_role=True)

    # Calculate discount: points * value_in_cents / 100
    discount_amount = round(points * ls["points_value_cents"] / 100, 2)
    new_balance = account["balance"] - points

    # Update account
    await client.update(
        f"loyalty_accounts?id=eq.{account['id']}",
        {"balance": new_balance},
    )

    # Record transaction
    await client.insert("points_transactions", {
        "loyalty_account_id": account["id"],
        "type": "redeem",
        "points": -points,
        "balance_after": new_balance,
        "description": f"Redeemed for ${discount_amount:.2f} discount",
    })

    return {
        "discount_amount": discount_amount,
        "points_redeemed": points,
        "remaining_balance": new_balance,
    }


async def adjust_points(user_id: int, points: int, description: str, admin_id: int) -> dict:
    """Manual admin adjustment of points."""
    account = await get_or_create_account(user_id)
    client = RestClient(service_role=True)
    ls = await get_settings()

    new_balance = max(account["balance"] + points, 0)
    new_lifetime = account["lifetime_points"] + points if points > 0 else account["lifetime_points"]

    # Recalculate tier
    gold_threshold = int(ls.get("gold_threshold", 2000)) if ls else 2000
    silver_threshold = int(ls.get("silver_threshold", 500)) if ls else 500
    if new_lifetime >= gold_threshold:
        new_tier = "gold"
    elif new_lifetime >= silver_threshold:
        new_tier = "silver"
    else:
        new_tier = "bronze"

    await client.update(
        f"loyalty_accounts?id=eq.{account['id']}",
        {"balance": new_balance, "lifetime_points": new_lifetime, "tier": new_tier},
    )

    await client.insert("points_transactions", {
        "loyalty_account_id": account["id"],
        "type": "adjust",
        "points": points,
        "balance_after": new_balance,
        "description": description or "Manual adjustment",
        "created_by": admin_id,
    })

    updated = await client.get(f"loyalty_accounts?id=eq.{account['id']}&select=*&limit=1")
    return updated[0] if updated else account

"""Loyalty program routes.

User-facing: view account, history, redeem points.
Admin-facing: settings, account listing, manual adjustments.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin, require_role
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.loyalty import (
    LoyaltySettingsUpdate,
    PointsAdjustRequest,
    PointsRedeemRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/loyalty", tags=["Loyalty"])


# ═══════════════════════════════════════════════════════════════
#  PUBLIC / USER ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("/settings")
async def get_loyalty_settings_public():
    """Get loyalty program settings (public)."""
    async with SupabaseClient.service_role() as db:
        row = await db.from_("loyalty_settings").select_one()
    return row


@router.get("/account")
async def get_my_loyalty_account(user: TokenClaims = require_role(Role.USER)):
    """Get the current user's loyalty account with tier info."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)

        settings_row = await db.from_("loyalty_settings").select_one()
        if not settings_row or not settings_row.get("is_enabled"):
            return {"enabled": False}

        account = await db.from_("loyalty_accounts").eq("user_id", db_user["id"]).select_one()
        if not account:
            rows = await db.from_("loyalty_accounts").insert({
                "user_id": db_user["id"],
                "balance": 0,
                "lifetime_points": 0,
                "tier": "bronze",
            })
            account = rows[0] if rows else {"balance": 0, "lifetime_points": 0, "tier": "bronze"}

        lifetime = account.get("lifetime_points", 0)
        tier = account.get("tier", "bronze")
        next_tier = None
        points_to_next = 0

        if tier == "bronze" and lifetime < settings_row.get("silver_threshold", 500):
            next_tier = "silver"
            points_to_next = settings_row["silver_threshold"] - lifetime
        elif tier == "silver" and lifetime < settings_row.get("gold_threshold", 2000):
            next_tier = "gold"
            points_to_next = settings_row["gold_threshold"] - lifetime

        return {
            "enabled": True,
            **account,
            "next_tier": next_tier,
            "points_to_next": max(0, points_to_next),
            "multiplier": _get_multiplier(tier, settings_row),
        }


@router.get("/history")
async def get_my_loyalty_history(
    limit: int = 20,
    offset: int = 0,
    user: TokenClaims = require_role(Role.USER),
):
    """Get the current user's loyalty transaction history."""
    async with SupabaseClient.service_role() as db:
        db_user = await _get_db_user(db, user)
        account = await db.from_("loyalty_accounts").eq("user_id", db_user["id"]).select_one("id")
        if not account:
            return []

        return await (
            db.from_("points_transactions")
            .eq("loyalty_account_id", account["id"])
            .order("created_at", desc=True)
            .offset(offset)
            .limit(limit)
            .select()
        )


@router.post("/redeem")
async def redeem_points(body: PointsRedeemRequest, user: TokenClaims = require_role(Role.USER)):
    """Redeem loyalty points for a discount."""
    try:
        from app.services.loyalty import redeem_points as do_redeem
        db_user_row = None
        async with SupabaseClient.service_role() as db:
            db_user_row = await _get_db_user(db, user)
        result = await do_redeem(db_user_row["id"], body.points)
        return {"success": True, "data": result}
    except ValueError as e:
        raise BadRequestError(str(e))


# ═══════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/settings")
async def get_loyalty_settings_admin(user: TokenClaims = require_any_admin()):
    """Get loyalty settings (admin)."""
    async with SupabaseClient.service_role() as db:
        return await db.from_("loyalty_settings").select_one()


@router.put("/admin/settings")
async def update_loyalty_settings(body: LoyaltySettingsUpdate, user: TokenClaims = require_any_admin()):
    """Update or create loyalty settings (admin)."""
    async with SupabaseClient.service_role() as db:
        data = body.model_dump()
        existing = await db.from_("loyalty_settings").select_one("id")
        if existing:
            await db.from_("loyalty_settings").eq("id", existing["id"]).update(data)
            return await db.from_("loyalty_settings").eq("id", existing["id"]).select_one()
        else:
            rows = await db.from_("loyalty_settings").insert(data)
            return rows[0] if rows else data


@router.get("/admin/accounts")
async def list_loyalty_accounts(
    tier: str | None = None,
    limit: int = 50,
    user: TokenClaims = require_any_admin(),
):
    """List loyalty accounts with user info (admin)."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("loyalty_accounts").order("lifetime_points", desc=True).limit(limit)
        if tier and tier != "all":
            q = q.eq("tier", tier)
        return await q.select("*,users!inner(username,first_name,last_name,telegram_id)")


@router.post("/admin/adjust")
async def adjust_loyalty_points(body: PointsAdjustRequest, user: TokenClaims = require_any_admin()):
    """Manually adjust a loyalty account's points (admin)."""
    async with SupabaseClient.service_role() as db:
        account = await db.from_("loyalty_accounts").eq("id", body.account_id).select_one("balance,lifetime_points")
        if not account:
            raise NotFoundError("Loyalty account", body.account_id)

        new_balance = max((account.get("balance") or 0) + body.points, 0)
        new_lifetime = (account.get("lifetime_points") or 0) + body.points if body.points > 0 else (account.get("lifetime_points") or 0)

        await db.from_("loyalty_accounts").eq("id", body.account_id).update({
            "balance": new_balance,
            "lifetime_points": new_lifetime,
        })

        await db.from_("points_transactions").insert({
            "loyalty_account_id": body.account_id,
            "type": "adjust",
            "points": body.points,
            "balance_after": new_balance,
            "description": body.description,
            "created_by": int(user.sub) if user.sub else None,
        })

    return {"newBalance": new_balance, "newLifetime": new_lifetime}


@router.get("/admin/stats")
async def get_loyalty_stats(user: TokenClaims = require_any_admin()):
    """Aggregated loyalty program stats (admin)."""
    async with SupabaseClient.service_role() as db:
        accounts = await db.from_("loyalty_accounts").select("tier")
        tiers = {"bronze": 0, "silver": 0, "gold": 0}
        for a in accounts:
            t = a.get("tier")
            if t in tiers:
                tiers[t] += 1

        txns = await db.from_("points_transactions").select("type,points")
        earned = sum(t.get("points", 0) for t in txns if t.get("type") == "earn")
        redeemed = sum(abs(t.get("points", 0)) for t in txns if t.get("type") == "redeem")

    return {
        "totalMembers": len(accounts),
        "tiers": tiers,
        "totalEarned": earned,
        "totalRedeemed": redeemed,
    }


# ── Helpers ─────────────────────────────────────────────────────


def _get_multiplier(tier: str, settings_row: dict) -> float:
    if tier == "gold":
        return settings_row.get("gold_multiplier", 2.0)
    if tier == "silver":
        return settings_row.get("silver_multiplier", 1.5)
    return 1.0


async def _get_db_user(db, user: TokenClaims) -> dict:
    if user.telegram_id:
        row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id,username,first_name,last_name")
        if row:
            return row
    raise NotFoundError("User")

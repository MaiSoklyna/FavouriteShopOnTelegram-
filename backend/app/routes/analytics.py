"""Analytics and dashboard stats routes (admin only)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin
from app.core.security import TokenClaims
from app.db.client import SupabaseClient

router = APIRouter(prefix="/analytics", tags=["Analytics"])

ORDER_MONEY = "merchant_discount_amount,platform_discount_amount"


def _num(v) -> float:
    return float(v or 0)


def order_revenue(order: dict, for_merchant: bool) -> float:
    """Revenue an order counts for.

    A shop's revenue includes the platform-funded discount (the platform pays
    it to the shop); platform-wide figures count what customers paid.
    """
    total = _num(order.get("total"))
    return total + _num(order.get("platform_discount_amount")) if for_merchant else total


@router.get("/dashboard")
async def get_dashboard_stats(user: TokenClaims = require_any_admin()):
    """High-level stats for the admin dashboard."""
    async with SupabaseClient.service_role() as db:
        merchant_filter = user.merchant_id if user.role == Role.MERCHANT_ADMIN else None

        # Products
        pq = db.from_("products").eq("is_active", True)
        if merchant_filter:
            pq = pq.eq("merchant_id", merchant_filter)
        products = await pq.select("id")

        # Orders
        oq = db.from_("orders")
        if merchant_filter:
            oq = oq.eq("merchant_id", merchant_filter)
        orders = await oq.select(f"id,status,total,created_at,{ORDER_MONEY}")

        for_merchant = bool(merchant_filter)
        live = [o for o in orders if o.get("status") != "cancelled"]
        total_revenue = sum(order_revenue(o, for_merchant) for o in live)
        # Discounts split by who paid them
        merchant_discounts = sum(_num(o.get("merchant_discount_amount")) for o in live)
        platform_discounts = sum(_num(o.get("platform_discount_amount")) for o in live)
        pending_orders = sum(1 for o in orders if o.get("status") == "pending")

        # Users (super admin only)
        total_users = 0
        if user.is_super_admin:
            users = await db.from_("users").select("id")
            total_users = len(users)

        # Today's orders
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today_orders = sum(1 for o in orders if o.get("created_at", "").startswith(today))
        today_revenue = sum(
            order_revenue(o, for_merchant) for o in live
            if o.get("created_at", "").startswith(today)
        )

    return {
        "totalProducts": len(products),
        "totalOrders": len(orders),
        "totalRevenue": round(total_revenue, 2),
        "pendingOrders": pending_orders,
        "totalUsers": total_users,
        "todayOrders": today_orders,
        "todayRevenue": round(today_revenue, 2),
        "merchantFundedDiscounts": round(merchant_discounts, 2),
        "platformFundedDiscounts": round(platform_discounts, 2),
    }


@router.get("/orders")
async def get_order_analytics(
    days: int = 30,
    user: TokenClaims = require_any_admin(),
):
    """Order analytics over time (admin only)."""
    async with SupabaseClient.service_role() as db:
        oq = db.from_("orders").order("created_at", desc=True).limit(1000)
        if user.role == Role.MERCHANT_ADMIN:
            oq = oq.eq("merchant_id", user.merchant_id)
        orders = await oq.select(f"id,status,total,payment_method,created_at,{ORDER_MONEY}")
    for_merchant = user.role == Role.MERCHANT_ADMIN

    # Group by date
    by_date: dict[str, dict] = {}
    for o in orders:
        date = o.get("created_at", "")[:10]
        if date not in by_date:
            by_date[date] = {"date": date, "orders": 0, "revenue": 0,
                             "merchant_discounts": 0, "platform_discounts": 0}
        by_date[date]["orders"] += 1
        if o.get("status") != "cancelled":
            by_date[date]["revenue"] += order_revenue(o, for_merchant)
            by_date[date]["merchant_discounts"] += _num(o.get("merchant_discount_amount"))
            by_date[date]["platform_discounts"] += _num(o.get("platform_discount_amount"))

    # Status breakdown
    status_counts: dict[str, int] = {}
    for o in orders:
        s = o.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

    return {
        "daily": sorted(by_date.values(), key=lambda x: x["date"]),
        "statusBreakdown": status_counts,
        "totalOrders": len(orders),
    }

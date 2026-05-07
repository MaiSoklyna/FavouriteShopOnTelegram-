"""Analytics and dashboard stats routes (admin only)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.constants import Role
from app.core.dependencies import require_any_admin
from app.core.security import TokenClaims
from app.db.client import SupabaseClient

router = APIRouter(prefix="/analytics", tags=["Analytics"])


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
        orders = await oq.select("id,status,total,created_at")

        total_revenue = sum(o.get("total", 0) for o in orders if o.get("status") != "cancelled")
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
            o.get("total", 0) for o in orders
            if o.get("created_at", "").startswith(today) and o.get("status") != "cancelled"
        )

    return {
        "totalProducts": len(products),
        "totalOrders": len(orders),
        "totalRevenue": round(total_revenue, 2),
        "pendingOrders": pending_orders,
        "totalUsers": total_users,
        "todayOrders": today_orders,
        "todayRevenue": round(today_revenue, 2),
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
        orders = await oq.select("id,status,total,payment_method,created_at")

    # Group by date
    by_date: dict[str, dict] = {}
    for o in orders:
        date = o.get("created_at", "")[:10]
        if date not in by_date:
            by_date[date] = {"date": date, "orders": 0, "revenue": 0}
        by_date[date]["orders"] += 1
        if o.get("status") != "cancelled":
            by_date[date]["revenue"] += o.get("total", 0)

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

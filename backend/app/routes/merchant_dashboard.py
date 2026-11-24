"""The shop dashboard: one call with everything the merchant home page shows.

- Order summary: what needs action now (every shop account sees this).
- Sales summary: today, this period vs the period before, average order value, a daily series.
- Top products: by units sold in the period, with revenue.
- Recent activity: the latest entries of the shop activity log.

Each part is included only when the person's role may see it (app/core/permissions.py):
sales and top products need `sales.view`, recent activity needs `activity.view`.
Revenue is counted the same way as the Analytics page: orders that were not cancelled, plus the
platform-funded part of any discount (the platform pays that to the shop).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import ForbiddenError
from app.core.permissions import Perm, role_can
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.routes.analytics import ORDER_MONEY, order_revenue
from app.services import audit
from app.services.delivery import SHOP_TZ

router = APIRouter(tags=["Shop dashboard"])

# Order statuses (app/core/constants.py ORDER_STATUS_TRANSITIONS): what the shop still has to
# accept, what is on its way, and how orders end
WAITING = ("pending",)
IN_PROGRESS = ("confirmed", "processing", "shipped")
DONE = ("delivered",)
CANCELLED = ("cancelled",)

TOP_PRODUCTS = 5
RECENT_ACTIVITY = 8
_ID_CHUNK = 150  # order ids per order_items query (keeps the URL short)


def _shop_day(iso: str) -> str:
    """The shop-local date (YYYY-MM-DD) of a stored timestamp."""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(SHOP_TZ).date().isoformat()
    except (ValueError, AttributeError):
        return (iso or "")[:10]


def _pct_change(now: float, before: float) -> float | None:
    if before <= 0:
        return None
    return round((now - before) / before * 100, 1)


@router.get("/merchant-dashboard")
async def merchant_dashboard(
    days: int = Query(30, ge=1, le=365, description="Length of the sales period in days"),
    user: TokenClaims = require_role(Role.MERCHANT_ADMIN),
):
    """Everything the shop's dashboard shows, trimmed to what the person's role may see."""
    if user.merchant_id is None:
        raise ForbiddenError("This account is not linked to a shop")
    shop = user.merchant_id
    role = user.shop_role
    can_sales = role_can(role, Perm.SALES_VIEW)
    can_activity = role_can(role, Perm.ACTIVITY_VIEW)

    now = datetime.now(SHOP_TZ)
    today = now.date()
    period_start = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), tzinfo=SHOP_TZ)
    previous_start = period_start - timedelta(days=days)

    async with SupabaseClient.service_role() as db:
        open_orders = await (
            db.from_("orders").eq("merchant_id", shop).in_("status", list(WAITING + IN_PROGRESS))
            .select("id,status")
        )
        recent = await (
            db.from_("orders").eq("merchant_id", shop)
            .gte("created_at", previous_start.astimezone(timezone.utc).isoformat())
            .select(f"id,status,total,created_at,{ORDER_MONEY}")
        )

        first_day = period_start.date().isoformat()
        period = [o for o in recent if _shop_day(o.get("created_at", "")) >= first_day]
        period_ids = {o["id"] for o in period}
        previous = [o for o in recent if o["id"] not in period_ids]

        today_iso = today.isoformat()
        todays = [o for o in period if _shop_day(o.get("created_at", "")) == today_iso]

        by_status: dict[str, int] = defaultdict(int)
        for o in period:
            by_status[o.get("status") or "unknown"] += 1

        result: dict = {
            "role": role,
            "period_days": days,
            "orders": {
                "waiting": sum(1 for o in open_orders if o.get("status") in WAITING),
                "in_progress": sum(1 for o in open_orders if o.get("status") in IN_PROGRESS),
                "today": len(todays),
                "period": len(period),
                "delivered": sum(by_status.get(s, 0) for s in DONE),
                "cancelled": sum(by_status.get(s, 0) for s in CANCELLED),
                "by_status": dict(by_status),
            },
            "sales": None,
            "top_products": None,
            "recent_activity": None,
        }

        if can_sales:
            def revenue(orders: list[dict]) -> float:
                return sum(order_revenue(o, True) for o in orders if o.get("status") not in CANCELLED)

            live = [o for o in period if o.get("status") not in CANCELLED]
            period_revenue = revenue(period)
            previous_revenue = revenue(previous)

            daily = {(period_start.date() + timedelta(days=i)).isoformat(): {"revenue": 0.0, "orders": 0}
                     for i in range(days)}
            for o in live:
                d = daily.get(_shop_day(o.get("created_at", "")))
                if d is not None:
                    d["revenue"] += order_revenue(o, True)
                    d["orders"] += 1

            result["sales"] = {
                "today": round(revenue(todays), 2),
                "period": round(period_revenue, 2),
                "previous_period": round(previous_revenue, 2),
                "change_pct": _pct_change(period_revenue, previous_revenue),
                "paid_orders": len(live),
                "average_order_value": round(period_revenue / len(live), 2) if live else 0.0,
                "daily": [{"date": k, "revenue": round(v["revenue"], 2), "orders": v["orders"]}
                          for k, v in sorted(daily.items())],
            }

            live_ids = [o["id"] for o in live]
            items: list[dict] = []
            for i in range(0, len(live_ids), _ID_CHUNK):
                items += await db.from_("order_items").in_("order_id", live_ids[i:i + _ID_CHUNK]).select(
                    "order_id,product_id,product_name,quantity,subtotal")
            top: dict = {}
            for it in items:
                key = it.get("product_id") or it.get("product_name")
                row = top.setdefault(key, {"product_id": it.get("product_id"), "name": it.get("product_name"),
                                           "quantity": 0, "revenue": 0.0})
                row["quantity"] += int(it.get("quantity") or 0)
                row["revenue"] += float(it.get("subtotal") or 0)
            ranked = sorted(top.values(), key=lambda r: (-r["quantity"], -r["revenue"], str(r["name"])))
            result["top_products"] = [{**r, "revenue": round(r["revenue"], 2)} for r in ranked[:TOP_PRODUCTS]]

        if can_activity:
            try:
                result["recent_activity"] = await (
                    db.from_(audit.TABLE).eq("merchant_id", shop)
                    .order("created_at", desc=True).order("id", desc=True).limit(RECENT_ACTIVITY)
                    .select("id,actor_type,actor_name,action,target_type,target_label,created_at")
                )
            except Exception:  # the log is optional (migration 034); the dashboard still loads
                result["recent_activity"] = []

    return result

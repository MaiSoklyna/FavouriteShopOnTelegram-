"""Activity tracking: what customers look at, search for, add to cart and order.

Rules:
- Tracking must never get in the way: recording never raises, and a customer action never fails because
  of it. Before migration 033 there is no table and everything is quietly skipped.
- What the server can see for itself it records itself (add to cart, order placed), so it cannot be faked.
  What only the browser knows (a product or shop was looked at, a search and its result count) arrives as a
  small event, and the server decides what it is about: the shop of a product is read from the database,
  unknown or inactive things are ignored, and staff browsing does not count.
- The same visitor looking at the same thing again within DEDUPE_MINUTES counts once (refreshes, back and
  forth, a double-mounting page).
- Privacy: no IP address or device details are stored. A visitor is the signed-in customer, or a random id the
  browser made up when signed out.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.core.constants import Role
from app.services import notify

logger = logging.getLogger(__name__)

EVENT_TYPES = ("product_view", "shop_view", "search", "add_to_cart", "order_placed")
DEDUPE_MINUTES = 30
MIN_QUERY_LEN = 2
MAX_QUERY_LEN = 100
NOT_SET_UP = ("42P01", "PGRST205", "42883", "PGRST202", "42703", "PGRST204")
MAX_DAYS = 365


def _not_set_up(exc: Exception) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and notify._error_code(exc) in NOT_SET_UP


def normalize_query(text: str | None) -> str | None:
    """Lower-case, single-spaced, at most MAX_QUERY_LEN; None when too short to mean anything."""
    q = " ".join((text or "").lower().split())[:MAX_QUERY_LEN].strip()
    return q if len(q) >= MIN_QUERY_LEN else None


async def record(db, event_type: str, *, user_id: int | None = None, session_id: str | None = None, product_id: int | None = None,
                 merchant_id: int | None = None, order_id: int | None = None, query: str | None = None,
                 result_count: int | None = None) -> bool:
    """Write one event. Never raises; returns whether it was written."""
    row = {"event_type": event_type, "user_id": user_id, "session_id": session_id, "product_id": product_id,
           "merchant_id": merchant_id, "order_id": order_id, "query": query, "result_count": result_count}
    try:
        await db.from_("activity_events").insert({k: v for k, v in row.items() if v is not None})
        return True
    except Exception as exc:  # noqa: BLE001 - tracking must never break the action it describes
        if _not_set_up(exc):
            logger.debug("Activity tracking is not set up yet (migration 033)")
        else:
            logger.warning("Could not record %s event: %s", event_type, exc)
        return False


async def _recently_seen(db, event_type: str, user_id: int | None, session_id: str | None, **target) -> bool:
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=DEDUPE_MINUTES)).isoformat()
    q = db.from_("activity_events").eq("event_type", event_type).gte("created_at", cutoff)
    q = q.eq("user_id", user_id) if user_id else q.eq("session_id", session_id)
    for col, val in target.items():
        q = q.eq(col, val)
    return bool(await q.select_one("id"))


async def ingest(db, claims, body) -> bool:
    """Handle one event sent by the browser. Never raises; returns whether it was recorded."""
    try:
        if claims is not None and claims.role != Role.USER:
            return False                                   # shop staff and the platform looking around do not count
        user_id = None
        if claims is not None and claims.telegram_id:
            person = await db.from_("users").eq("telegram_id", claims.telegram_id).select_one("id")
            user_id = person["id"] if person else None
        session_id = body.session_id
        if not user_id and not session_id:
            return False                                   # no way to tell visits apart
        t = body.type
        if t == "product_view":
            product = await db.from_("products").eq("id", body.product_id).select_one("id,merchant_id,is_active") if body.product_id else None
            if not product or not product.get("is_active"):
                return False
            target = {"product_id": product["id"], "merchant_id": product["merchant_id"]}
        elif t == "shop_view":
            shop = await db.from_("merchants").eq("id", body.merchant_id).select_one("id,status") if body.merchant_id else None
            if not shop or shop.get("status") != "active":
                return False
            target = {"merchant_id": shop["id"]}
        elif t == "search":
            query = normalize_query(body.query)
            if not query:
                return False
            target = {"query": query}
        else:
            return False
        if await _recently_seen(db, t, user_id, session_id, **target):
            return False
        extra = {"result_count": body.result_count} if t == "search" else {}
        return await record(db, t, user_id=user_id, session_id=session_id, **target, **extra)
    except Exception as exc:  # noqa: BLE001
        if not _not_set_up(exc):
            logger.warning("Could not handle activity event: %s", exc)
        return False


def _pct(part: int, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


async def summary(db, days: int, merchant_id: int | None = None) -> dict:
    """What customers did over the last `days` days (one shop, or everything when merchant_id is None)."""
    days = max(1, min(days, MAX_DAYS))
    try:
        data = await db.rpc("activity_summary", {"p_days": days, "p_merchant_id": merchant_id}) or {}
    except httpx.HTTPStatusError as exc:
        if _not_set_up(exc):
            return {"setup_needed": True, "days": days}
        raise
    totals = {t: int((data.get("totals") or {}).get(t, 0)) for t in EVENT_TYPES}
    funnel = data.get("funnel") or {}
    viewed, carted, ordered = (int(funnel.get(k, 0)) for k in ("viewed", "carted", "ordered"))

    # one row per day, zero where nothing happened, so a chart has no gaps
    by_date = {d["date"]: d for d in data.get("daily") or []}
    today = datetime.now(timezone.utc).date()
    daily = []
    for i in range(days - 1, -1, -1):
        date = (today - timedelta(days=i)).isoformat()
        d = by_date.get(date, {})
        daily.append({"date": date, **{t: int(d.get(t, 0)) for t in EVENT_TYPES}})

    top = data.get("top_products") or []
    names = {}
    if top:
        for p in await db.from_("products").in_("id", [t["product_id"] for t in top]).select("id,name,merchant_id"):
            names[p["id"]] = p
    top_products = [{"product_id": t["product_id"], "name": (names.get(t["product_id"]) or {}).get("name", "Removed product"),
                     "views": int(t["views"]), "carts": int(t["carts"]), "cart_rate_pct": _pct(int(t["carts"]), int(t["views"]))} for t in top]

    return {
        "setup_needed": False, "days": days, "merchant_id": merchant_id, "totals": totals,
        "funnel": {"viewed": viewed, "carted": carted, "ordered": ordered,
                   "view_to_cart_pct": _pct(carted, viewed), "cart_to_order_pct": _pct(ordered, carted)},
        "daily": daily, "top_products": top_products,
        "top_searches": [{"query": s["query"], "searches": int(s["searches"]), "no_results": int(s["no_results"])} for s in data.get("top_searches") or []],
    }

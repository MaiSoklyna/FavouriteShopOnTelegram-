"""Shop reviews: a customer rates a shop once their order is delivered.

Rules: only the person who ordered, only after Delivered, one review per order. The shop's average
lives on the merchant row (recalc_shop_rating keeps it right) so cards and lists need no maths.
"""

from __future__ import annotations

import logging

import httpx

from app.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.services import notify

logger = logging.getLogger(__name__)

# The table / column / function from migration 029 is not there yet
NOT_SET_UP = ("42P01", "PGRST205", "42703", "PGRST204", "PGRST202")


def _not_set_up(exc: httpx.HTTPStatusError) -> bool:
    return notify._error_code(exc) in NOT_SET_UP


def reviewer_name(person: dict | None) -> str:
    """First name and the initial of the last, e.g. "Mai S." Never a username or phone number."""
    person = person or {}
    first = (person.get("first_name") or "").strip()
    last = (person.get("last_name") or "").strip()
    if first and last:
        return f"{first} {last[0].upper()}."
    return first or "Customer"


async def submit(db, person: dict, order_id: int, rating: int, comment: str | None) -> dict:
    order = await db.from_("orders").eq("id", order_id).select_one("id,user_id,merchant_id,status,order_code")
    if not order:
        raise NotFoundError("Order", order_id)
    if order["user_id"] != person["id"]:
        raise ForbiddenError("You can only review your own orders")
    if order["status"] != "delivered":
        raise BadRequestError("You can review an order once it has been delivered")

    try:
        rows = await db.from_("shop_reviews").insert({
            "order_id": order_id, "user_id": person["id"], "merchant_id": order["merchant_id"],
            "rating": rating, "comment": comment,
        })
    except httpx.HTTPStatusError as exc:
        code = notify._error_code(exc)
        if code == "23505":
            raise ConflictError("You already reviewed this order")
        if _not_set_up(exc):
            raise BadRequestError("Reviews are not set up on the server yet. Please try again later.")
        raise
    review = rows[0]

    await recalc(db, order["merchant_id"])
    snippet = (comment[:120] + "…") if comment and len(comment) > 120 else (comment or "No comment")
    await notify.notify_merchant(
        db, order["merchant_id"], "review", f"New {rating}★ review", f"{reviewer_name(person)}: {snippet}",
        link="/reviews", ref_id=order_id, dedupe_key=f"review:{order_id}",
    )
    return review


async def recalc(db, merchant_id: int) -> None:
    """Refresh the shop's cached average and count. Never raises: the review itself is already saved."""
    try:
        await db.rpc("recalc_shop_rating", {"p_merchant_id": merchant_id})
    except Exception:
        logger.exception("Could not recalculate the rating of shop %s", merchant_id)


async def summary(db, merchant_id: int) -> dict:
    """Average, count and how many reviews gave each star (visible reviews only)."""
    rows = await db.from_("shop_reviews").eq("merchant_id", merchant_id).eq("is_visible", True).limit(5000).select("rating")
    distribution = {str(n): 0 for n in range(5, 0, -1)}
    for r in rows:
        distribution[str(r["rating"])] += 1
    count = len(rows)
    average = round(sum(r["rating"] for r in rows) / count, 2) if count else None
    return {"rating": average, "count": count, "distribution": distribution}


async def listing(db, merchant_id: int, *, limit: int, before: int | None, visible_only: bool = True) -> list[dict]:
    """Newest first, with the reviewer's first name and last initial (cursor: `before` = last id seen)."""
    limit = max(1, min(limit, 30))
    q = db.from_("shop_reviews").eq("merchant_id", merchant_id)
    if visible_only:
        q = q.eq("is_visible", True)
    if before is not None:
        q = q.lt("id", before)
    rows = await q.order("id", desc=True).limit(limit).select("id,order_id,user_id,rating,comment,is_visible,created_at")
    if not rows:
        return []
    people = {p["id"]: p for p in await db.from_("users").in_("id", list({r["user_id"] for r in rows})).select("id,first_name,last_name")}
    return [{"id": r["id"], "rating": r["rating"], "comment": r["comment"], "created_at": r["created_at"],
             "reviewer": reviewer_name(people.get(r["user_id"])), "is_visible": r["is_visible"]} for r in rows]


async def for_order(db, order_id: int) -> dict | None:
    """The review left for this order, if any (null before migration 029)."""
    try:
        row = await db.from_("shop_reviews").eq("order_id", order_id).select_one("id,rating,comment,created_at")
        return row
    except httpx.HTTPStatusError as exc:
        if _not_set_up(exc):
            return None
        raise
